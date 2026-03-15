import { useState, useCallback, useEffect, useRef } from "react";
import {
  Server, Loader2, RefreshCw, X, Play, Square, FileText, RotateCcw,
  Globe, Database, Shield, Container, Cpu, Wifi, ChevronDown, ChevronRight,
  Activity, HardDrive, MemoryStick, Timer, Layers, Search,
  Lock, AlertTriangle, Copy, Terminal, Eye, Settings, Zap,
} from "lucide-react";
import { useAppStore } from "../store/appStore";
import type { SSHConnection } from "../store/appStore";

let tauriCoreCache: typeof import("@tauri-apps/api/core") | null = null;
async function getTauriCore() {
  if (!tauriCoreCache) tauriCoreCache = await import("@tauri-apps/api/core");
  return tauriCoreCache;
}

interface DetectedService { name: string; kind: string; status: string; port: number | null; detail: string; }
interface ServerSystemInfo { os: string; kernel: string; uptime: string; cpu_count: string; ram_usage: string; disk_usage: string; }
interface ServerQuickStats { cpu_percent: string; mem_percent: string; disk_percent: string; load_avg: string; top_processes: string[]; }
interface ServerScan {
  connectionId: string; connectionName: string; services: DetectedService[];
  scannedAt: number; systemInfo?: ServerSystemInfo; quickStats?: ServerQuickStats;
}

// ── Smart Actions per service type ──
type SmartAction = { label: string; icon: React.ReactNode; cmd: string; copyOnly?: boolean };

function getSmartActions(svc: DetectedService): SmartAction[] {
  const n = svc.name.toLowerCase();
  const actions: SmartAction[] = [];

  // Common actions
  if (svc.kind === "docker") {
    actions.push(
      { label: "Status", icon: <Eye size={8} />, cmd: `docker inspect --format 'Status: {{.State.Status}}\\nImage: {{.Config.Image}}\\nStarted: {{.State.StartedAt}}\\nPorts: {{range $p,$c := .NetworkSettings.Ports}}{{$p}}->{{range $c}}{{.HostPort}}{{end}} {{end}}\\nNetworks: {{range $k,$v := .NetworkSettings.Networks}}{{$k}}({{$v.IPAddress}}) {{end}}' ${svc.name} 2>&1` },
      { label: "Logs", icon: <FileText size={8} />, cmd: `docker logs --tail 100 ${svc.name} 2>&1` },
      { label: "Stats", icon: <Activity size={8} />, cmd: `docker stats --no-stream --format 'CPU: {{.CPUPerc}}\\nMEM: {{.MemUsage}} ({{.MemPerc}})\\nNET: {{.NetIO}}\\nDISK: {{.BlockIO}}\\nPIDs: {{.PIDs}}' ${svc.name} 2>&1` },
      { label: "Processes", icon: <Layers size={8} />, cmd: `docker top ${svc.name} -eo pid,user,%cpu,%mem,comm 2>&1` },
      { label: "Volumes", icon: <HardDrive size={8} />, cmd: `docker inspect --format '{{range .Mounts}}{{.Type}}: {{.Source}} -> {{.Destination}}\\n{{end}}' ${svc.name} 2>&1` },
      { label: "Env Vars", icon: <Settings size={8} />, cmd: `docker inspect --format '{{range .Config.Env}}{{.}}\\n{{end}}' ${svc.name} 2>&1` },
      { label: "Networks", icon: <Globe size={8} />, cmd: `docker inspect --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}: IP={{$v.IPAddress}} GW={{$v.Gateway}}\\n{{end}}' ${svc.name} 2>&1` },
      { label: "Shell cmd", icon: <Copy size={8} />, cmd: `docker exec -it ${svc.name} bash`, copyOnly: true },
      { label: "Restart", icon: <RotateCcw size={8} />, cmd: `docker restart ${svc.name} 2>&1 && echo '✓ Restarted'` },
      { label: "Stop", icon: <Square size={8} />, cmd: `docker stop ${svc.name} 2>&1 && echo '✓ Stopped'` },
    );
  } else if (svc.kind === "systemd") {
    actions.push(
      { label: "Status", icon: <Eye size={8} />, cmd: `systemctl status ${svc.name} --no-pager -l 2>&1` },
      { label: "Logs", icon: <FileText size={8} />, cmd: `journalctl -u ${svc.name} -n 100 --no-pager 2>&1` },
      { label: "Errors only", icon: <AlertTriangle size={8} />, cmd: `journalctl -u ${svc.name} -p err -n 30 --no-pager 2>&1` },
      { label: "Config", icon: <Settings size={8} />, cmd: `systemctl cat ${svc.name} 2>&1` },
    );

    // Service-specific smart actions
    if (n.includes("nginx")) {
      actions.push(
        { label: "Test config", icon: <Zap size={8} />, cmd: `nginx -t 2>&1` },
        { label: "Reload", icon: <RefreshCw size={8} />, cmd: `sudo nginx -s reload 2>&1 && echo '✓ Reloaded'` },
        { label: "Sites enabled", icon: <Globe size={8} />, cmd: `ls -la /etc/nginx/sites-enabled/ 2>/dev/null || ls -la /etc/nginx/conf.d/ 2>/dev/null` },
        { label: "Error log", icon: <AlertTriangle size={8} />, cmd: `tail -30 /var/log/nginx/error.log 2>/dev/null` },
        { label: "Access log", icon: <FileText size={8} />, cmd: `tail -30 /var/log/nginx/access.log 2>/dev/null` },
      );
    } else if (n.includes("apache") || n.includes("httpd")) {
      actions.push(
        { label: "Test config", icon: <Zap size={8} />, cmd: `apache2ctl configtest 2>&1 || httpd -t 2>&1` },
        { label: "Reload", icon: <RefreshCw size={8} />, cmd: `sudo systemctl reload ${svc.name} 2>&1 && echo '✓ Reloaded'` },
        { label: "Error log", icon: <AlertTriangle size={8} />, cmd: `tail -30 /var/log/apache2/error.log 2>/dev/null || tail -30 /var/log/httpd/error_log 2>/dev/null` },
      );
    } else if (n.includes("postgres")) {
      actions.push(
        { label: "Databases", icon: <Database size={8} />, cmd: `sudo -u postgres psql -c '\\l' 2>&1 || psql -c '\\l' 2>&1` },
        { label: "Connections", icon: <Activity size={8} />, cmd: `sudo -u postgres psql -c "SELECT pid,usename,application_name,client_addr,state,query_start FROM pg_stat_activity WHERE state='active'" 2>&1` },
        { label: "Slow queries", icon: <Timer size={8} />, cmd: `sudo -u postgres psql -c "SELECT pid,now()-query_start AS duration,left(query,80) FROM pg_stat_activity WHERE state='active' AND query NOT LIKE '%pg_stat%' ORDER BY duration DESC LIMIT 10" 2>&1` },
        { label: "DB sizes", icon: <HardDrive size={8} />, cmd: `sudo -u postgres psql -c "SELECT datname,pg_size_pretty(pg_database_size(datname)) FROM pg_database ORDER BY pg_database_size(datname) DESC" 2>&1` },
      );
    } else if (n.includes("mysql") || n.includes("mariadb")) {
      actions.push(
        { label: "Databases", icon: <Database size={8} />, cmd: `mysql -e 'SHOW DATABASES' 2>&1` },
        { label: "Processlist", icon: <Activity size={8} />, cmd: `mysql -e 'SHOW PROCESSLIST' 2>&1` },
        { label: "Status", icon: <Zap size={8} />, cmd: `mysql -e 'SHOW GLOBAL STATUS' 2>&1 | head -40` },
      );
    } else if (n.includes("redis")) {
      actions.push(
        { label: "Info", icon: <Zap size={8} />, cmd: `redis-cli INFO server 2>&1 | head -20` },
        { label: "Memory", icon: <MemoryStick size={8} />, cmd: `redis-cli INFO memory 2>&1` },
        { label: "Clients", icon: <Activity size={8} />, cmd: `redis-cli CLIENT LIST 2>&1` },
        { label: "DB size", icon: <Database size={8} />, cmd: `redis-cli DBSIZE 2>&1` },
      );
    } else if (n.includes("mongo")) {
      actions.push(
        { label: "Status", icon: <Zap size={8} />, cmd: `mongosh --eval 'db.serverStatus().connections' 2>&1 || mongo --eval 'db.serverStatus().connections' 2>&1` },
        { label: "Databases", icon: <Database size={8} />, cmd: `mongosh --eval 'db.adminCommand("listDatabases")' 2>&1 || mongo --eval 'db.adminCommand("listDatabases")' 2>&1` },
      );
    }

    actions.push(
      { label: "Restart", icon: <RotateCcw size={8} />, cmd: `sudo systemctl restart ${svc.name} 2>&1 && systemctl is-active ${svc.name}` },
      { label: "Stop", icon: <Square size={8} />, cmd: `sudo systemctl stop ${svc.name} 2>&1 && echo '✓ Stopped'` },
    );
  } else {
    // Port-based
    actions.push(
      { label: "Who's listening", icon: <Eye size={8} />, cmd: `ss -tlnp 'sport = :${svc.port}' 2>/dev/null || netstat -tlnp 2>/dev/null | grep :${svc.port}` },
      { label: "Connections", icon: <Activity size={8} />, cmd: `ss -tnp 'sport = :${svc.port}' 2>/dev/null | head -20` },
    );
  }
  return actions;
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

const alertLevel = (stats?: ServerQuickStats): "ok" | "warn" | "critical" | null => {
  if (!stats) return null;
  const cpu = parseFloat(stats.cpu_percent) || 0;
  const mem = parseFloat(stats.mem_percent) || 0;
  const disk = parseFloat(stats.disk_percent) || 0;
  if (cpu > 90 || mem > 95 || disk > 95) return "critical";
  if (cpu > 80 || mem > 85 || disk > 85) return "warn";
  return "ok";
};

const alertBadge = (level: "ok" | "warn" | "critical" | null) => {
  if (!level || level === "ok") return null;
  return (
    <span style={{
      fontSize: 7, padding: "1px 4px", borderRadius: 3, fontWeight: 700, animation: level === "critical" ? "pulse 1s infinite" : undefined,
      background: level === "critical" ? "rgba(239,68,68,0.2)" : "rgba(245,158,11,0.2)",
      color: level === "critical" ? "#EF4444" : "#F59E0B",
    }}>
      {level === "critical" ? "CRITICAL" : "WARN"}
    </span>
  );
};

const btnS: React.CSSProperties = {
  padding: "3px 6px", border: "none", borderRadius: "var(--radius-sm)",
  fontSize: 9, cursor: "pointer", fontFamily: "inherit",
  display: "inline-flex", alignItems: "center", gap: 3,
};

function ProgressBar({ value, color, label }: { value: number; color: string; label: string }) {
  const barColor = value > 90 ? "#EF4444" : value > 80 ? "#F59E0B" : color;
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "var(--text-muted)", marginBottom: 2 }}>
        <span>{label}</span><span style={{ color: barColor, fontWeight: value > 80 ? 700 : 400 }}>{value.toFixed(0)}%</span>
      </div>
      <div style={{ height: 4, background: "var(--bg-active)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${Math.min(value, 100)}%`, height: "100%", background: barColor, borderRadius: 2, transition: "width 0.3s" }} />
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
  const [expandedService, setExpandedService] = useState<string | null>(null);
  const [passwordPrompt, setPasswordPrompt] = useState<{ conn: SSHConnection; password: string } | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [countdown, setCountdown] = useState(30);
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
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
      const creds = password ? { password, privateKey: null } : await getCredentials(conn);
      if (!creds) { setPasswordPrompt({ conn, password: "" }); setScanning(null); return; }
      if (password) credCacheRef.current.set(conn.id, creds);
      const { invoke } = await getTauriCore();
      const connArgs = { host: conn.host, port: conn.port, username: conn.username, password: creds.password, privateKey: creds.privateKey };
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

  useEffect(() => {
    if (!autoRefresh) { setCountdown(30); return; }
    let count = 30;
    setCountdown(30);
    const timer = setInterval(() => {
      count--;
      setCountdown(count);
      if (count <= 0) {
        count = 30;
        setCountdown(30);
        scans.forEach((_s, connId) => {
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

  const submitPassword = () => { if (!passwordPrompt) return; scanServer(passwordPrompt.conn, passwordPrompt.password); setPasswordPrompt(null); };

  const runAction = async (conn: SSHConnection, action: SmartAction) => {
    if (action.copyOnly) {
      navigator.clipboard.writeText(action.cmd).then(() => {
        setCopiedCmd(action.label);
        setTimeout(() => setCopiedCmd(null), 2000);
      });
      return;
    }
    setActionLoading(true);
    setActionOutput({ title: action.label, content: "Loading..." });
    try {
      const creds = await getCredentials(conn);
      if (!creds) { setActionOutput({ title: "Error", content: "No credentials" }); setActionLoading(false); return; }
      const { invoke } = await getTauriCore();
      const output = await invoke<string>("ssh_exec", {
        host: conn.host, port: conn.port, username: conn.username,
        password: creds.password, privateKey: creds.privateKey, command: action.cmd,
      });
      setActionOutput({ title: action.label, content: output || "(no output)" });
    } catch (e) {
      setActionOutput({ title: `${action.label} failed`, content: String(e) });
    }
    setActionLoading(false);
  };

  const runSecurityAudit = async (conn: SSHConnection) => {
    const cmd = `echo "=== SSH Config ===" && grep -E 'PermitRootLogin|PasswordAuthentication|Port |AllowUsers|MaxAuthTries' /etc/ssh/sshd_config 2>/dev/null; echo "\\n=== Failed Logins (last 10) ===" && journalctl _SYSTEMD_UNIT=sshd.service --no-pager -n 10 -p warning 2>/dev/null || tail -10 /var/log/auth.log 2>/dev/null; echo "\\n=== Firewall ===" && sudo ufw status 2>/dev/null || sudo iptables -L -n --line-numbers 2>/dev/null | head -25; echo "\\n=== Listening Ports ===" && ss -tlnp 2>/dev/null | head -20; echo "\\n=== Last Logins ===" && last -10 2>/dev/null; echo "\\n=== Updates Available ===" && apt list --upgradable 2>/dev/null | head -10 || yum check-update 2>/dev/null | head -10`;
    runAction(conn, { label: "Security Audit", icon: <Shield size={8} />, cmd });
  };

  const toggleExpand = (id: string) => setExpanded((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleGroup = (key: string) => setExpandedGroups((p) => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const toggleService = (key: string) => setExpandedService((p) => p === key ? null : key);

  // Filter services across all servers
  const filterServices = (svcs: DetectedService[]) => {
    if (!searchQuery) return svcs;
    const q = searchQuery.toLowerCase();
    return svcs.filter((s) => s.name.toLowerCase().includes(q) || s.kind.includes(q) || s.detail.toLowerCase().includes(q) || (s.port && String(s.port).includes(q)));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 0 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexShrink: 0 }}>
        <span className="sidebar-section-title" style={{ margin: 0 }}>Server Map</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
          {copiedCmd && <span style={{ fontSize: 8, color: "var(--accent-secondary)" }}>Copied!</span>}
          {autoRefresh && <span style={{ fontSize: 8, color: "var(--accent-primary)" }}>{countdown}s</span>}
          <button onClick={() => setAutoRefresh(!autoRefresh)} title={autoRefresh ? "Stop auto-refresh" : "Auto-refresh 30s"}
            style={{ ...btnS, padding: "3px 8px", background: autoRefresh ? "var(--accent-primary)" : "var(--bg-tertiary)", color: autoRefresh ? "white" : "var(--text-secondary)" }}>
            <Timer size={9} /> {autoRefresh ? "Live" : "Auto"}
          </button>
        </div>
      </div>

      {/* Search bar */}
      {scans.size > 0 && (
        <div style={{ position: "relative", marginBottom: 6, flexShrink: 0 }}>
          <Search size={10} style={{ position: "absolute", left: 8, top: 7, color: "var(--text-muted)" }} />
          <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search services across all servers..."
            style={{ width: "100%", padding: "5px 8px 5px 24px", background: "var(--bg-tertiary)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: 10, fontFamily: "inherit", outline: "none" }}
          />
        </div>
      )}

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
            <button onClick={() => navigator.clipboard.writeText(actionOutput.content)} title="Copy output" style={{ ...btnS, background: "var(--bg-tertiary)", color: "var(--text-secondary)", padding: "4px 8px" }}><Copy size={10} /></button>
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
            const alert = alertLevel(scan?.quickStats);
            const filteredServices = scan ? filterServices(scan.services) : [];
            const groups = scan ? {
              docker: filteredServices.filter((s) => s.kind === "docker"),
              systemd: filteredServices.filter((s) => s.kind === "systemd"),
              port: filteredServices.filter((s) => s.kind === "port"),
            } : null;

            return (
              <div key={conn.id} style={{ marginBottom: 10 }}>
                {/* Server header */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "8px 10px",
                  background: "var(--bg-tertiary)", borderRadius: "var(--radius-sm)",
                  border: `1px solid ${alert === "critical" ? "#EF4444" : alert === "warn" ? "#F59E0B" : scan ? "var(--accent-secondary)" : "var(--border-subtle)"}`,
                  cursor: "pointer",
                }} onClick={() => scan && toggleExpand(conn.id)}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: scan ? "#10B981" : "var(--text-muted)" }} />
                  <Server size={14} style={{ color: scan ? "var(--accent-secondary)" : "var(--accent-primary)", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: 4 }}>
                      {conn.name} {alertBadge(alert)}
                    </div>
                    <div style={{ fontSize: 9, color: "var(--text-muted)" }}>
                      {conn.username}@{conn.host}:{conn.port}
                      {scan && ` \u2014 ${scan.services.length} services`}
                    </div>
                  </div>
                  {scan && (isExpanded ? <ChevronDown size={12} style={{ color: "var(--text-muted)" }} /> : <ChevronRight size={12} style={{ color: "var(--text-muted)" }} />)}
                  {scan && (
                    <button onClick={(e) => { e.stopPropagation(); runSecurityAudit(conn); }} title="Security Audit"
                      style={{ ...btnS, background: "rgba(139,92,246,0.1)", color: "#8B5CF6", padding: "4px 6px" }}>
                      <Lock size={9} />
                    </button>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); scanServer(conn); }} disabled={isScanning}
                    style={{ ...btnS, background: "var(--accent-primary)", color: "white", opacity: isScanning ? 0.5 : 1, padding: "4px 8px" }}>
                    {isScanning ? <Loader2 size={10} style={{ animation: "spin 1s linear infinite" }} /> : <RefreshCw size={10} />}
                    {scan ? "Rescan" : "Scan"}
                  </button>
                </div>

                {/* Expanded content */}
                {scan && isExpanded && (
                  <div style={{ marginTop: 4, marginLeft: 8, borderLeft: "2px solid var(--border-subtle)", paddingLeft: 8 }}>
                    {/* System info */}
                    {scan.systemInfo && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "5px 8px", background: "var(--bg-secondary)", borderRadius: "var(--radius-sm)", marginBottom: 4, fontSize: 9, color: "var(--text-muted)" }}>
                        {scan.systemInfo.os && <span><Cpu size={8} style={{ verticalAlign: "middle" }} /> {scan.systemInfo.os}</span>}
                        {scan.systemInfo.uptime && <span><Timer size={8} style={{ verticalAlign: "middle" }} /> {scan.systemInfo.uptime}</span>}
                        {scan.systemInfo.cpu_count && <span>{scan.systemInfo.cpu_count} CPUs</span>}
                        {scan.systemInfo.ram_usage && <span><MemoryStick size={8} style={{ verticalAlign: "middle" }} /> {scan.systemInfo.ram_usage}</span>}
                        {scan.systemInfo.disk_usage && <span><HardDrive size={8} style={{ verticalAlign: "middle" }} /> {scan.systemInfo.disk_usage}</span>}
                      </div>
                    )}

                    {/* Stats bars */}
                    {scan.quickStats && (
                      <div style={{ display: "flex", gap: 8, padding: "5px 8px", background: "var(--bg-secondary)", borderRadius: "var(--radius-sm)", marginBottom: 4, alignItems: "center" }}>
                        <ProgressBar value={parseFloat(scan.quickStats.cpu_percent) || 0} color="#3B82F6" label="CPU" />
                        <ProgressBar value={parseFloat(scan.quickStats.mem_percent) || 0} color="#8B5CF6" label="RAM" />
                        <ProgressBar value={parseFloat(scan.quickStats.disk_percent) || 0} color="#F59E0B" label="Disk" />
                        {scan.quickStats.load_avg && <span style={{ fontSize: 7, color: "var(--text-muted)", whiteSpace: "nowrap" }}>Load: {scan.quickStats.load_avg}</span>}
                        <button onClick={() => refreshStats(conn)} title="Refresh stats" style={{ ...btnS, background: "none", color: "var(--text-muted)", padding: "1px" }}><Activity size={8} /></button>
                      </div>
                    )}

                    {/* Service groups */}
                    {groups && (["docker", "systemd", "port"] as const).map((kind) => {
                      const svcs = groups[kind];
                      if (svcs.length === 0) return null;
                      const isGroupOpen = expandedGroups.has(kind);
                      const label = kind === "docker" ? "Docker Containers" : kind === "systemd" ? "Systemd Services" : "Listening Ports";
                      const runningCount = svcs.filter((s) => statusColor(s.status) === "#10B981").length;
                      const badgeColor = kind === "docker" ? "#2496ED" : kind === "systemd" ? "#10B981" : "#8B5CF6";

                      return (
                        <div key={kind} style={{ marginBottom: 3 }}>
                          <div onClick={() => toggleGroup(kind)} style={{
                            display: "flex", alignItems: "center", gap: 5, padding: "3px 6px",
                            cursor: "pointer", fontSize: 10, fontWeight: 600, color: badgeColor,
                          }}>
                            {isGroupOpen ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
                            {label}
                            <span style={{ fontSize: 8, fontWeight: 400, color: "var(--text-muted)" }}>{runningCount}/{svcs.length}</span>
                          </div>

                          {isGroupOpen && svcs.map((svc, i) => {
                            const svcKey = `${conn.id}-${svc.name}-${svc.port}-${i}`;
                            const isServiceExpanded = expandedService === svcKey;
                            const actions = getSmartActions(svc);

                            return (
                              <div key={svcKey} style={{ marginBottom: 2 }}>
                                <div onClick={() => toggleService(svcKey)} style={{
                                  display: "flex", alignItems: "center", gap: 5, padding: "4px 6px",
                                  background: isServiceExpanded ? "var(--bg-tertiary)" : "var(--bg-secondary)",
                                  borderRadius: "var(--radius-sm)", fontSize: 11, cursor: "pointer",
                                  borderLeft: `3px solid ${statusColor(svc.status)}`,
                                }}>
                                  <span style={{ width: 5, height: 5, borderRadius: "50%", flexShrink: 0, background: statusColor(svc.status) }} />
                                  {serviceIcon(svc.kind, svc.name)}
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{svc.name}</span>
                                    {svc.port != null && <span style={{ color: "var(--text-muted)", marginLeft: 3 }}>:{svc.port}</span>}
                                    {svc.detail && <div style={{ fontSize: 8, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{svc.detail}</div>}
                                  </div>
                                  {isServiceExpanded ? <ChevronDown size={9} style={{ color: "var(--text-muted)" }} /> : <ChevronRight size={9} style={{ color: "var(--text-muted)" }} />}
                                </div>

                                {/* Expanded smart actions */}
                                {isServiceExpanded && (
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: 3, padding: "4px 6px 4px 14px", background: "var(--bg-tertiary)", borderRadius: "0 0 var(--radius-sm) var(--radius-sm)" }}>
                                    {actions.map((action, j) => {
                                      const isDanger = action.label === "Stop" || action.label === "Restart";
                                      const isCopy = action.copyOnly;
                                      return (
                                        <button key={j} onClick={() => runAction(conn, action)} title={isCopy ? `Copy: ${action.cmd}` : action.label}
                                          style={{
                                            ...btnS, padding: "3px 7px",
                                            background: isDanger ? (action.label === "Stop" ? "rgba(239,68,68,0.1)" : "rgba(245,158,11,0.1)")
                                              : isCopy ? "rgba(139,92,246,0.1)" : "var(--bg-active)",
                                            color: isDanger ? (action.label === "Stop" ? "#EF4444" : "#F59E0B")
                                              : isCopy ? "#8B5CF6" : "var(--text-secondary)",
                                          }}>
                                          {action.icon} {action.label}
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}

                    {/* Top processes */}
                    {scan.quickStats && scan.quickStats.top_processes.length > 0 && (
                      <div style={{ marginTop: 3, padding: "3px 6px", fontSize: 8, color: "var(--text-muted)" }}>
                        <span style={{ fontWeight: 600 }}>Top processes: </span>
                        {scan.quickStats.top_processes.map((p, i) => <span key={i} style={{ fontFamily: "'JetBrains Mono', monospace" }}>{p}{i < scan.quickStats!.top_processes.length - 1 ? " | " : ""}</span>)}
                      </div>
                    )}

                    <div style={{ fontSize: 7, color: "var(--text-muted)", paddingTop: 3 }}>
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
