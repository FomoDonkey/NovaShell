import { useState, useCallback, useEffect, useRef } from "react";
import {
  Server, Loader2, RefreshCw, X, Play, Square, FileText, RotateCcw,
  Globe, Database, Shield, Container, Cpu, Wifi, ChevronDown, ChevronRight,
  Activity, HardDrive, MemoryStick, Timer, Layers, Network,
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

interface ServerSystemInfo {
  os: string;
  kernel: string;
  uptime: string;
  cpu_count: string;
  ram_usage: string;
  disk_usage: string;
}

interface ServerQuickStats {
  cpu_percent: string;
  mem_percent: string;
  disk_percent: string;
  load_avg: string;
  top_processes: string[];
}

interface ServerScan {
  connectionId: string;
  connectionName: string;
  services: DetectedService[];
  scannedAt: number;
  systemInfo?: ServerSystemInfo;
  quickStats?: ServerQuickStats;
}

// ── Helpers ──

const statusColor = (status: string): string => {
  const s = status.toLowerCase();
  if (s.includes("running") || s.includes("active") || s.includes("listening") || s.includes("up")) return "#10B981";
  if (s.includes("exited") || s.includes("dead") || s.includes("failed") || s.includes("stopped")) return "#EF4444";
  return "#F59E0B";
};

const serviceIcon = (kind: string, name: string) => {
  const n = name.toLowerCase();
  if (kind === "docker") return <Container size={13} style={{ color: "#2496ED" }} />;
  if (n.includes("postgres") || n.includes("mysql") || n.includes("mongo") || n.includes("redis") || n.includes("elastic"))
    return <Database size={13} style={{ color: "#F59E0B" }} />;
  if (n.includes("http") || n.includes("nginx") || n.includes("apache") || n.includes("grafana") || n.includes("prometheus"))
    return <Globe size={13} style={{ color: "#10B981" }} />;
  if (n.includes("ssh") || n.includes("firewall") || n.includes("ufw") || n.includes("fail2ban"))
    return <Shield size={13} style={{ color: "#8B5CF6" }} />;
  if (n.includes("node") || n.includes("python") || n.includes("java") || n.includes("go") || n.includes("php"))
    return <Cpu size={13} style={{ color: "#EC4899" }} />;
  return <Wifi size={13} style={{ color: "var(--text-muted)" }} />;
};

const btnS: React.CSSProperties = {
  padding: "3px 6px", border: "none", borderRadius: "var(--radius-sm)",
  fontSize: 9, cursor: "pointer", fontFamily: "inherit",
  display: "inline-flex", alignItems: "center", gap: 3,
};

function ProgressBar({ value, color, label }: { value: number; color: string; label: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "var(--text-muted)", marginBottom: 2 }}>
        <span>{label}</span><span style={{ color }}>{value.toFixed(0)}%</span>
      </div>
      <div style={{ height: 4, background: "var(--bg-active)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${Math.min(value, 100)}%`, height: "100%", background: color, borderRadius: 2, transition: "width 0.3s" }} />
      </div>
    </div>
  );
}

// ── Main Component ──

export function ServerMapPanel() {
  const { sshConnections } = useAppStore();
  const [scans, setScans] = useState<Map<string, ServerScan>>(new Map());
  const [scanning, setScanning] = useState<string | null>(null);
  const [actionOutput, setActionOutput] = useState<{ title: string; content: string } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(["docker", "systemd", "port"]));
  const [passwordPrompt, setPasswordPrompt] = useState<{ conn: SSHConnection; password: string } | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [countdown, setCountdown] = useState(30);
  const autoRefreshRef = useRef(false);
  const credCacheRef = useRef<Map<string, { password: string | null; privateKey: string | null }>>(new Map());

  const getCredentials = useCallback(async (conn: SSHConnection): Promise<{ password: string | null; privateKey: string | null } | null> => {
    const cached = credCacheRef.current.get(conn.id);
    if (cached) return cached;
    if (conn.privateKey) { const c = { password: null, privateKey: conn.privateKey }; credCacheRef.current.set(conn.id, c); return c; }
    if (conn.sessionPassword) { const c = { password: conn.sessionPassword, privateKey: null }; credCacheRef.current.set(conn.id, c); return c; }
    try {
      const { invoke } = await getTauriCore();
      const keychainPass = await invoke<string | null>("keychain_get_password", { connectionId: conn.id });
      if (keychainPass) { const c = { password: keychainPass, privateKey: null }; credCacheRef.current.set(conn.id, c); return c; }
    } catch {}
    return null;
  }, []);

  const scanServer = useCallback(async (conn: SSHConnection, password?: string) => {
    setScanning(conn.id);
    try {
      let creds = password ? { password, privateKey: null } : await getCredentials(conn);
      if (!creds) { setPasswordPrompt({ conn, password: "" }); setScanning(null); return; }
      if (password) credCacheRef.current.set(conn.id, creds);
      const { invoke } = await getTauriCore();
      const connArgs = { host: conn.host, port: conn.port, username: conn.username, password: creds.password, privateKey: creds.privateKey };

      // Run scan, system info, and quick stats in parallel
      const [services, sysInfo, stats] = await Promise.allSettled([
        invoke<DetectedService[]>("server_map_scan", connArgs),
        invoke<ServerSystemInfo>("server_map_system_info", connArgs),
        invoke<ServerQuickStats>("server_map_quick_stats", connArgs),
      ]);

      setScans((prev) => {
        const next = new Map(prev);
        next.set(conn.id, {
          connectionId: conn.id, connectionName: conn.name,
          services: services.status === "fulfilled" ? services.value : [],
          scannedAt: Date.now(),
          systemInfo: sysInfo.status === "fulfilled" ? sysInfo.value : undefined,
          quickStats: stats.status === "fulfilled" ? stats.value : undefined,
        });
        return next;
      });
      setExpanded((prev) => new Set(prev).add(conn.id));
    } catch (e) {
      setActionOutput({ title: `Scan failed: ${conn.name}`, content: String(e) });
    }
    setScanning(null);
  }, [getCredentials]);

  // Auto-refresh
  useEffect(() => {
    autoRefreshRef.current = autoRefresh;
    if (!autoRefresh) { setCountdown(30); return; }
    let count = 30;
    setCountdown(30);
    const timer = setInterval(() => {
      count--;
      setCountdown(count);
      if (count <= 0) {
        count = 30;
        setCountdown(30);
        // Rescan all previously scanned servers
        scans.forEach((_scan, connId) => {
          const conn = sshConnections.find((c) => c.id === connId);
          if (conn && !scanning) scanServer(conn);
        });
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [autoRefresh, scans, sshConnections, scanServer, scanning]);

  const refreshStats = async (conn: SSHConnection) => {
    const creds = await getCredentials(conn);
    if (!creds) return;
    try {
      const { invoke } = await getTauriCore();
      const stats = await invoke<ServerQuickStats>("server_map_quick_stats", {
        host: conn.host, port: conn.port, username: conn.username,
        password: creds.password, privateKey: creds.privateKey,
      });
      setScans((prev) => {
        const next = new Map(prev);
        const existing = next.get(conn.id);
        if (existing) next.set(conn.id, { ...existing, quickStats: stats });
        return next;
      });
    } catch {}
  };

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
          case "status": cmd = `docker inspect --format 'Status: {{.State.Status}}\nImage: {{.Config.Image}}\nCreated: {{.Created}}\nStarted: {{.State.StartedAt}}\nPorts: {{range $p, $conf := .NetworkSettings.Ports}}{{$p}}->{{range $conf}}{{.HostPort}}{{end}} {{end}}\nNetworks: {{range $k, $v := .NetworkSettings.Networks}}{{$k}}({{$v.IPAddress}}) {{end}}' ${svc.name} 2>&1`; break;
          case "logs": cmd = `docker logs --tail 100 ${svc.name} 2>&1`; break;
          case "restart": cmd = `docker restart ${svc.name} 2>&1 && echo '✓ Restarted'`; break;
          case "stop": cmd = `docker stop ${svc.name} 2>&1 && echo '✓ Stopped'`; break;
          case "stats": cmd = `docker stats --no-stream --format 'CPU: {{.CPUPerc}}\nMEM: {{.MemUsage}} ({{.MemPerc}})\nNET: {{.NetIO}}\nDISK: {{.BlockIO}}\nPIDs: {{.PIDs}}' ${svc.name} 2>&1`; break;
          case "top": cmd = `docker top ${svc.name} -eo pid,user,%cpu,%mem,comm 2>&1`; break;
        }
      } else if (svc.kind === "systemd") {
        switch (action) {
          case "status": cmd = `systemctl status ${svc.name} --no-pager -l 2>&1`; break;
          case "logs": cmd = `journalctl -u ${svc.name} -n 100 --no-pager 2>&1`; break;
          case "restart": cmd = `sudo systemctl restart ${svc.name} 2>&1 && systemctl is-active ${svc.name} 2>&1`; break;
          case "stop": cmd = `sudo systemctl stop ${svc.name} 2>&1 && echo '✓ Stopped'`; break;
          case "config": cmd = `systemctl cat ${svc.name} 2>&1`; break;
          case "errors": cmd = `journalctl -u ${svc.name} -p err -n 30 --no-pager 2>&1`; break;
        }
      } else {
        switch (action) {
          case "status": cmd = `ss -tlnp 'sport = :${svc.port}' 2>/dev/null || netstat -tlnp 2>/dev/null | grep :${svc.port}`; break;
          case "logs": cmd = `journalctl --no-pager -n 50 2>/dev/null | grep -i '${svc.name}' || echo 'No logs found'`; break;
          default: cmd = `echo 'Action not available for port-based services'`; break;
        }
      }

      if (!cmd) { setActionOutput({ title: action, content: "Not available" }); setActionLoading(false); return; }

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

  const toggleExpand = (id: string) => setExpanded((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleGroup = (key: string) => setExpandedGroups((p) => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n; });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 0 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexShrink: 0 }}>
        <span className="sidebar-section-title" style={{ margin: 0 }}>Server Map</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
          {autoRefresh && <span style={{ fontSize: 8, color: "var(--accent-primary)" }}>{countdown}s</span>}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            style={{
              ...btnS, padding: "3px 8px",
              background: autoRefresh ? "var(--accent-primary)" : "var(--bg-tertiary)",
              color: autoRefresh ? "white" : "var(--text-secondary)",
            }}
            title={autoRefresh ? "Stop auto-refresh" : "Auto-refresh every 30s"}
          >
            <Timer size={9} /> {autoRefresh ? "Live" : "Auto"}
          </button>
        </div>
      </div>

      {/* Password prompt */}
      {passwordPrompt && (
        <div style={{ padding: 10, background: "var(--bg-tertiary)", borderRadius: "var(--radius-sm)", marginBottom: 8, border: "1px solid var(--accent-primary)", flexShrink: 0 }}>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 6 }}>Password for {passwordPrompt.conn.name}</div>
          <input type="password" value={passwordPrompt.password}
            onChange={(e) => setPasswordPrompt({ ...passwordPrompt, password: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") submitPassword(); }}
            placeholder="Password..." autoFocus
            style={{ width: "100%", padding: "6px 8px", background: "var(--bg-secondary)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: 11, fontFamily: "inherit", outline: "none", marginBottom: 6 }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={submitPassword} style={{ ...btnS, flex: 1, justifyContent: "center", background: "var(--accent-primary)", color: "white", padding: "6px" }}><Play size={10} /> Scan</button>
            <button onClick={() => setPasswordPrompt(null)} style={{ ...btnS, background: "var(--bg-active)", color: "var(--text-secondary)", padding: "6px" }}><X size={10} /></button>
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
            <button onClick={() => setActionOutput(null)} style={{ ...btnS, background: "var(--bg-tertiary)", color: "var(--text-secondary)", padding: "4px 8px" }}><X size={12} /> Close</button>
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
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }} className="hacking-log-container">
        {sshConnections.length === 0 ? (
          <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 24, fontSize: 12 }}>
            <Server size={24} style={{ margin: "0 auto 8px", opacity: 0.5 }} />
            <div>No SSH connections configured.</div>
            <div style={{ marginTop: 4 }}>Add connections in the SSH tab first.</div>
          </div>
        ) : (
          sshConnections.map((conn) => {
            const scan = scans.get(conn.id);
            const isExpanded = expanded.has(conn.id);
            const isScanning = scanning === conn.id;

            // Group services by kind
            const groups = scan ? {
              docker: scan.services.filter((s) => s.kind === "docker"),
              systemd: scan.services.filter((s) => s.kind === "systemd"),
              port: scan.services.filter((s) => s.kind === "port"),
            } : null;

            return (
              <div key={conn.id} style={{ marginBottom: 10 }}>
                {/* Server header */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
                  background: "var(--bg-tertiary)", borderRadius: "var(--radius-sm)",
                  border: `1px solid ${scan ? "var(--accent-secondary)" : "var(--border-subtle)"}`,
                  cursor: "pointer",
                }} onClick={() => scan && toggleExpand(conn.id)}>
                  {/* Health dot */}
                  <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: scan ? "#10B981" : "var(--text-muted)" }} />
                  <Server size={14} style={{ color: scan ? "var(--accent-secondary)" : "var(--accent-primary)", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{conn.name}</div>
                    <div style={{ fontSize: 9, color: "var(--text-muted)" }}>
                      {conn.username}@{conn.host}:{conn.port}
                      {scan && ` \u2014 ${scan.services.length} services`}
                    </div>
                  </div>
                  {scan && (isExpanded ? <ChevronDown size={12} style={{ color: "var(--text-muted)" }} /> : <ChevronRight size={12} style={{ color: "var(--text-muted)" }} />)}
                  <button
                    onClick={(e) => { e.stopPropagation(); scanServer(conn); }}
                    disabled={isScanning}
                    style={{ ...btnS, background: "var(--accent-primary)", color: "white", opacity: isScanning ? 0.5 : 1, padding: "4px 8px" }}
                  >
                    {isScanning ? <Loader2 size={10} style={{ animation: "spin 1s linear infinite" }} /> : <RefreshCw size={10} />}
                    {scan ? "Rescan" : "Scan"}
                  </button>
                </div>

                {/* Expanded content */}
                {scan && isExpanded && (
                  <div style={{ marginTop: 4, marginLeft: 8, borderLeft: "2px solid var(--border-subtle)", paddingLeft: 8 }}>

                    {/* System info bar */}
                    {scan.systemInfo && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "6px 8px", background: "var(--bg-secondary)", borderRadius: "var(--radius-sm)", marginBottom: 6, fontSize: 9, color: "var(--text-muted)" }}>
                        {scan.systemInfo.os && <span title="OS"><Cpu size={9} style={{ verticalAlign: "middle" }} /> {scan.systemInfo.os}</span>}
                        {scan.systemInfo.kernel && <span title="Kernel">{scan.systemInfo.kernel}</span>}
                        {scan.systemInfo.uptime && <span title="Uptime"><Timer size={9} style={{ verticalAlign: "middle" }} /> {scan.systemInfo.uptime}</span>}
                        {scan.systemInfo.cpu_count && <span title="CPUs">{scan.systemInfo.cpu_count} CPUs</span>}
                        {scan.systemInfo.ram_usage && <span title="RAM"><MemoryStick size={9} style={{ verticalAlign: "middle" }} /> {scan.systemInfo.ram_usage}</span>}
                        {scan.systemInfo.disk_usage && <span title="Disk"><HardDrive size={9} style={{ verticalAlign: "middle" }} /> {scan.systemInfo.disk_usage}</span>}
                      </div>
                    )}

                    {/* Quick stats bars */}
                    {scan.quickStats && (
                      <div style={{ display: "flex", gap: 8, padding: "6px 8px", background: "var(--bg-secondary)", borderRadius: "var(--radius-sm)", marginBottom: 6, alignItems: "center" }}>
                        <ProgressBar value={parseFloat(scan.quickStats.cpu_percent) || 0} color="#3B82F6" label="CPU" />
                        <ProgressBar value={parseFloat(scan.quickStats.mem_percent) || 0} color="#8B5CF6" label="RAM" />
                        <ProgressBar value={parseFloat(scan.quickStats.disk_percent) || 0} color="#F59E0B" label="Disk" />
                        {scan.quickStats.load_avg && <span style={{ fontSize: 8, color: "var(--text-muted)", whiteSpace: "nowrap" }}>Load: {scan.quickStats.load_avg}</span>}
                        <button onClick={() => refreshStats(conn)} title="Refresh stats" style={{ ...btnS, background: "none", color: "var(--text-muted)", padding: "1px" }}><Activity size={9} /></button>
                      </div>
                    )}

                    {/* Service groups */}
                    {groups && (
                      <>
                        {(["docker", "systemd", "port"] as const).map((kind) => {
                          const svcs = groups[kind];
                          if (svcs.length === 0) return null;
                          const isGroupOpen = expandedGroups.has(kind);
                          const label = kind === "docker" ? "Docker Containers" : kind === "systemd" ? "Systemd Services" : "Listening Ports";
                          const runningCount = svcs.filter((s) => statusColor(s.status) === "#10B981").length;
                          const badgeColor = kind === "docker" ? "#2496ED" : kind === "systemd" ? "#10B981" : "#8B5CF6";

                          return (
                            <div key={kind} style={{ marginBottom: 4 }}>
                              {/* Group header */}
                              <div
                                onClick={() => toggleGroup(kind)}
                                style={{
                                  display: "flex", alignItems: "center", gap: 6, padding: "4px 6px",
                                  cursor: "pointer", fontSize: 10, fontWeight: 600, color: badgeColor,
                                  borderBottom: "1px solid var(--border-subtle)",
                                }}
                              >
                                {isGroupOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                                {label}
                                <span style={{ fontSize: 8, fontWeight: 400, color: "var(--text-muted)" }}>
                                  {runningCount}/{svcs.length} active
                                </span>
                              </div>

                              {/* Services in this group */}
                              {isGroupOpen && svcs.map((svc, i) => (
                                <div key={`${svc.name}-${svc.port}-${i}`} style={{
                                  display: "flex", alignItems: "center", gap: 5, padding: "5px 6px",
                                  background: "var(--bg-secondary)", borderRadius: "var(--radius-sm)",
                                  marginTop: 2, fontSize: 11,
                                }}>
                                  {/* Health dot */}
                                  <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: statusColor(svc.status) }} />
                                  {serviceIcon(svc.kind, svc.name)}
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 11 }}>
                                      {svc.name}
                                      {svc.port != null && <span style={{ fontWeight: 400, color: "var(--text-muted)", marginLeft: 4 }}>:{svc.port}</span>}
                                    </div>
                                    {svc.detail && (
                                      <div style={{ fontSize: 8, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{svc.detail}</div>
                                    )}
                                  </div>
                                  {/* Action buttons */}
                                  <div style={{ display: "flex", gap: 1, flexShrink: 0 }}>
                                    <button onClick={() => execAction(conn, svc, "status")} title="Status" style={{ ...btnS, background: "var(--bg-active)", color: "var(--text-secondary)" }}><FileText size={8} /></button>
                                    <button onClick={() => execAction(conn, svc, "logs")} title="Logs" style={{ ...btnS, background: "var(--bg-active)", color: "var(--text-secondary)" }}><FileText size={8} /></button>
                                    {svc.kind === "systemd" && (
                                      <>
                                        <button onClick={() => execAction(conn, svc, "config")} title="View config" style={{ ...btnS, background: "var(--bg-active)", color: "var(--text-secondary)" }}><Layers size={8} /></button>
                                        <button onClick={() => execAction(conn, svc, "errors")} title="Recent errors" style={{ ...btnS, background: "rgba(239,68,68,0.1)", color: "#EF4444" }}><X size={8} /></button>
                                      </>
                                    )}
                                    {svc.kind === "docker" && (
                                      <>
                                        <button onClick={() => execAction(conn, svc, "stats")} title="Container stats" style={{ ...btnS, background: "var(--bg-active)", color: "var(--text-secondary)" }}><Activity size={8} /></button>
                                        <button onClick={() => execAction(conn, svc, "top")} title="Processes" style={{ ...btnS, background: "var(--bg-active)", color: "var(--text-secondary)" }}><Layers size={8} /></button>
                                      </>
                                    )}
                                    <button onClick={() => execAction(conn, svc, "restart")} title="Restart" style={{ ...btnS, background: "rgba(245,158,11,0.1)", color: "#F59E0B" }}><RotateCcw size={8} /></button>
                                    <button onClick={() => execAction(conn, svc, "stop")} title="Stop" style={{ ...btnS, background: "rgba(239,68,68,0.1)", color: "#EF4444" }}><Square size={8} /></button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </>
                    )}

                    {/* Top processes */}
                    {scan.quickStats && scan.quickStats.top_processes.length > 0 && (
                      <div style={{ marginTop: 4, padding: "4px 6px", fontSize: 8, color: "var(--text-muted)" }}>
                        <span style={{ fontWeight: 600, marginBottom: 2, display: "block" }}>Top processes:</span>
                        {scan.quickStats.top_processes.map((p, i) => (
                          <div key={i} style={{ fontFamily: "'JetBrains Mono', monospace" }}>{p}</div>
                        ))}
                      </div>
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
