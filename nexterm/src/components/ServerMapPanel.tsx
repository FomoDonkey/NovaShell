import { useState, useCallback } from "react";
import {
  Server, Loader2, RefreshCw, X, Play, Square, FileText, RotateCcw,
  Globe, Database, Shield, Container, Cpu, Wifi, ChevronDown, ChevronRight,
} from "lucide-react";
import { useAppStore } from "../store/appStore";
import type { SSHConnection } from "../store/appStore";

let tauriCoreCache: typeof import("@tauri-apps/api/core") | null = null;
async function getTauriCore() {
  if (!tauriCoreCache) tauriCoreCache = await import("@tauri-apps/api/core");
  return tauriCoreCache;
}

interface DetectedService {
  name: string;
  kind: string;
  status: string;
  port: number | null;
  detail: string;
}

interface ServerScan {
  connectionId: string;
  connectionName: string;
  services: DetectedService[];
  scannedAt: number;
}

const serviceIcon = (kind: string, name: string) => {
  const n = name.toLowerCase();
  if (kind === "docker") return <Container size={14} style={{ color: "#2496ED" }} />;
  if (n.includes("postgres") || n.includes("mysql") || n.includes("mongo") || n.includes("redis") || n.includes("elasticsearch"))
    return <Database size={14} style={{ color: "#F59E0B" }} />;
  if (n.includes("http") || n.includes("nginx") || n.includes("apache") || n.includes("grafana"))
    return <Globe size={14} style={{ color: "#10B981" }} />;
  if (n.includes("ssh") || n.includes("firewall")) return <Shield size={14} style={{ color: "#8B5CF6" }} />;
  if (n.includes("node") || n.includes("python") || n.includes("java") || n.includes("go"))
    return <Cpu size={14} style={{ color: "#EC4899" }} />;
  return <Wifi size={14} style={{ color: "var(--text-muted)" }} />;
};

const btnStyle: React.CSSProperties = {
  padding: "4px 8px", border: "none", borderRadius: "var(--radius-sm)",
  fontSize: 10, cursor: "pointer", fontFamily: "inherit",
  display: "flex", alignItems: "center", gap: 4,
};

export function ServerMapPanel() {
  const { sshConnections } = useAppStore();
  const [scans, setScans] = useState<Map<string, ServerScan>>(new Map());
  const [scanning, setScanning] = useState<string | null>(null);
  const [actionOutput, setActionOutput] = useState<{ title: string; content: string } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [passwordPrompt, setPasswordPrompt] = useState<{ conn: SSHConnection; password: string } | null>(null);

  const getCredentials = useCallback(async (conn: SSHConnection): Promise<{ password: string | null; privateKey: string | null } | null> => {
    if (conn.privateKey) return { password: null, privateKey: conn.privateKey };
    if (conn.sessionPassword) return { password: conn.sessionPassword, privateKey: null };
    try {
      const { invoke } = await getTauriCore();
      const keychainPass = await invoke<string | null>("keychain_get_password", { connectionId: conn.id });
      if (keychainPass) return { password: keychainPass, privateKey: null };
    } catch {}
    return null; // Will need password prompt
  }, []);

  const scanServer = useCallback(async (conn: SSHConnection, password?: string) => {
    setScanning(conn.id);
    try {
      const creds = password ? { password, privateKey: null } : await getCredentials(conn);
      if (!creds) {
        setPasswordPrompt({ conn, password: "" });
        setScanning(null);
        return;
      }
      const { invoke } = await getTauriCore();
      const services = await invoke<DetectedService[]>("server_map_scan", {
        host: conn.host, port: conn.port, username: conn.username,
        password: creds.password, privateKey: creds.privateKey,
      });
      setScans((prev) => {
        const next = new Map(prev);
        next.set(conn.id, {
          connectionId: conn.id, connectionName: conn.name,
          services, scannedAt: Date.now(),
        });
        return next;
      });
      setExpanded((prev) => new Set(prev).add(conn.id));
    } catch (e) {
      setActionOutput({ title: `Scan failed: ${conn.name}`, content: String(e) });
    }
    setScanning(null);
  }, [getCredentials]);

  const submitPassword = () => {
    if (!passwordPrompt) return;
    scanServer(passwordPrompt.conn, passwordPrompt.password);
    setPasswordPrompt(null);
  };

  const execAction = async (conn: SSHConnection, svc: DetectedService, action: string) => {
    setActionLoading(true);
    setActionOutput({ title: `${action}: ${svc.name}`, content: "Loading..." });
    try {
      const creds = await getCredentials(conn);
      if (!creds) { setActionOutput({ title: "Error", content: "No credentials available" }); setActionLoading(false); return; }

      let cmd = "";
      if (svc.kind === "docker") {
        switch (action) {
          case "status": cmd = `docker inspect --format '{{.State.Status}} — {{.Config.Image}} — Up since {{.State.StartedAt}}' ${svc.name} 2>&1`; break;
          case "logs": cmd = `docker logs --tail 80 ${svc.name} 2>&1`; break;
          case "restart": cmd = `docker restart ${svc.name} 2>&1`; break;
          case "stop": cmd = `docker stop ${svc.name} 2>&1`; break;
        }
      } else if (svc.kind === "systemd") {
        switch (action) {
          case "status": cmd = `systemctl status ${svc.name} --no-pager 2>&1`; break;
          case "logs": cmd = `journalctl -u ${svc.name} -n 80 --no-pager 2>&1`; break;
          case "restart": cmd = `sudo systemctl restart ${svc.name} 2>&1 && echo 'Restarted OK'`; break;
          case "stop": cmd = `sudo systemctl stop ${svc.name} 2>&1 && echo 'Stopped OK'`; break;
        }
      } else {
        // Port-based: generic info
        switch (action) {
          case "status": cmd = `ss -tlnp 'sport = :${svc.port}' 2>/dev/null || netstat -tlnp 2>/dev/null | grep :${svc.port}`; break;
          case "logs": cmd = `journalctl --no-pager -n 50 2>/dev/null | grep -i '${svc.name}' || echo 'No logs found for ${svc.name}'`; break;
          default: cmd = `echo 'Action not available for port-based services'`; break;
        }
      }

      if (!cmd) { setActionOutput({ title: action, content: "Action not available for this service type" }); setActionLoading(false); return; }

      const { invoke } = await getTauriCore();
      const output = await invoke<string>("ssh_exec", {
        host: conn.host, port: conn.port, username: conn.username,
        password: creds.password, privateKey: creds.privateKey,
        command: cmd,
      });
      setActionOutput({ title: `${action}: ${svc.name}`, content: output || "(no output)" });
    } catch (e) {
      setActionOutput({ title: `${action} failed`, content: String(e) });
    }
    setActionLoading(false);
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const connectedSSH = sshConnections;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span className="sidebar-section-title" style={{ margin: 0 }}>Server Map</span>
      </div>

      {/* Password prompt */}
      {passwordPrompt && (
        <div style={{ padding: 10, background: "var(--bg-tertiary)", borderRadius: "var(--radius-sm)", marginBottom: 8, border: "1px solid var(--accent-primary)" }}>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 6 }}>Password for {passwordPrompt.conn.name}</div>
          <input type="password" value={passwordPrompt.password}
            onChange={(e) => setPasswordPrompt({ ...passwordPrompt, password: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") submitPassword(); }}
            placeholder="Password..." autoFocus
            style={{ width: "100%", padding: "6px 8px", background: "var(--bg-secondary)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: 11, fontFamily: "inherit", outline: "none", marginBottom: 6 }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={submitPassword} style={{ ...btnStyle, flex: 1, justifyContent: "center", background: "var(--accent-primary)", color: "white" }}><Play size={10} /> Scan</button>
            <button onClick={() => setPasswordPrompt(null)} style={{ ...btnStyle, background: "var(--bg-active)", color: "var(--text-secondary)" }}><X size={10} /></button>
          </div>
        </div>
      )}

      {/* Action output modal */}
      {actionOutput && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 100, display: "flex", flexDirection: "column", padding: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", flex: 1 }}>
              {actionLoading && <Loader2 size={12} style={{ display: "inline", animation: "spin 1s linear infinite", marginRight: 6 }} />}
              {actionOutput.title}
            </span>
            <button onClick={() => setActionOutput(null)} style={{ ...btnStyle, background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}><X size={12} /> Close</button>
          </div>
          <pre style={{
            flex: 1, overflow: "auto", background: "var(--bg-primary)", borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border-subtle)", padding: 10, fontSize: 11, color: "var(--text-primary)",
            fontFamily: "'JetBrains Mono', monospace", whiteSpace: "pre-wrap", wordBreak: "break-all", margin: 0,
          }}>
            {actionOutput.content}
          </pre>
        </div>
      )}

      {/* Server list */}
      <div style={{ flex: 1, overflowY: "auto" }} className="hacking-log-container">
        {connectedSSH.length === 0 ? (
          <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 24, fontSize: 12 }}>
            <Server size={24} style={{ margin: "0 auto 8px", opacity: 0.5 }} />
            <div>No SSH connections configured.</div>
            <div style={{ marginTop: 4 }}>Add connections in the SSH tab first.</div>
          </div>
        ) : (
          connectedSSH.map((conn) => {
            const scan = scans.get(conn.id);
            const isExpanded = expanded.has(conn.id);
            const isScanning = scanning === conn.id;

            return (
              <div key={conn.id} style={{ marginBottom: 8 }}>
                {/* Server header */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
                  background: "var(--bg-tertiary)", borderRadius: "var(--radius-sm)",
                  border: `1px solid ${scan ? "var(--accent-secondary)" : "var(--border-subtle)"}`,
                  cursor: "pointer",
                }} onClick={() => scan && toggleExpand(conn.id)}>
                  <Server size={14} style={{ color: scan ? "var(--accent-secondary)" : "var(--accent-primary)", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{conn.name}</div>
                    <div style={{ fontSize: 9, color: "var(--text-muted)" }}>
                      {conn.username}@{conn.host}:{conn.port}
                      {scan && ` — ${scan.services.length} services`}
                    </div>
                  </div>
                  {scan && (isExpanded ? <ChevronDown size={12} style={{ color: "var(--text-muted)" }} /> : <ChevronRight size={12} style={{ color: "var(--text-muted)" }} />)}
                  <button
                    onClick={(e) => { e.stopPropagation(); scanServer(conn); }}
                    disabled={isScanning}
                    style={{ ...btnStyle, background: "var(--accent-primary)", color: "white", opacity: isScanning ? 0.5 : 1 }}
                  >
                    {isScanning ? <Loader2 size={10} style={{ animation: "spin 1s linear infinite" }} /> : <RefreshCw size={10} />}
                    {scan ? "Rescan" : "Scan"}
                  </button>
                </div>

                {/* Service list */}
                {scan && isExpanded && (
                  <div style={{ marginTop: 4, marginLeft: 12, borderLeft: "2px solid var(--border-subtle)", paddingLeft: 8 }}>
                    {scan.services.length === 0 ? (
                      <div style={{ fontSize: 11, color: "var(--text-muted)", padding: "8px 0" }}>No services detected</div>
                    ) : (
                      scan.services.map((svc, i) => (
                        <div key={`${svc.name}-${svc.port}-${i}`} style={{
                          display: "flex", alignItems: "center", gap: 6, padding: "6px 8px",
                          background: "var(--bg-secondary)", borderRadius: "var(--radius-sm)",
                          marginBottom: 3, fontSize: 11,
                        }}>
                          {serviceIcon(svc.kind, svc.name)}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                              {svc.name}
                              {svc.port && <span style={{ fontWeight: 400, color: "var(--text-muted)", marginLeft: 4 }}>:{svc.port}</span>}
                            </div>
                            {svc.detail && (
                              <div style={{ fontSize: 9, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {svc.detail}
                              </div>
                            )}
                          </div>
                          <span style={{
                            fontSize: 8, padding: "1px 5px", borderRadius: 3, fontWeight: 600,
                            background: svc.kind === "docker" ? "rgba(36,150,237,0.15)" : svc.kind === "systemd" ? "rgba(16,185,129,0.15)" : "rgba(139,92,246,0.15)",
                            color: svc.kind === "docker" ? "#2496ED" : svc.kind === "systemd" ? "#10B981" : "#8B5CF6",
                          }}>
                            {svc.kind}
                          </span>
                          {/* Action buttons */}
                          <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                            <button onClick={() => execAction(conn, svc, "status")} title="Status" style={{ ...btnStyle, background: "var(--bg-active)", color: "var(--text-secondary)", padding: "2px 4px" }}>
                              <FileText size={9} />
                            </button>
                            <button onClick={() => execAction(conn, svc, "logs")} title="Logs" style={{ ...btnStyle, background: "var(--bg-active)", color: "var(--text-secondary)", padding: "2px 4px" }}>
                              <FileText size={9} />
                            </button>
                            <button onClick={() => execAction(conn, svc, "restart")} title="Restart" style={{ ...btnStyle, background: "rgba(245,158,11,0.15)", color: "#F59E0B", padding: "2px 4px" }}>
                              <RotateCcw size={9} />
                            </button>
                            <button onClick={() => execAction(conn, svc, "stop")} title="Stop" style={{ ...btnStyle, background: "rgba(239,68,68,0.15)", color: "#EF4444", padding: "2px 4px" }}>
                              <Square size={9} />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                    <div style={{ fontSize: 8, color: "var(--text-muted)", paddingTop: 4 }}>
                      Scanned {new Date(scan.scannedAt).toLocaleTimeString()}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
