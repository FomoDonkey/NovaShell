import { useState, useCallback } from "react";
import {
  Radar,
  Globe,
  Server,
  AlertTriangle,
  RefreshCw,
  Copy,
  Shield,
  Wifi,
  ChevronDown,
  ChevronRight,
  FileText,
  Download,
} from "lucide-react";
import { useAppStore } from "../../store/appStore";
import type { EnvironmentInfo, PortInfo, ReconResult } from "../../store/appStore";

let tauriCoreCache: typeof import("@tauri-apps/api/core") | null = null;
async function getTauriCore() {
  if (!tauriCoreCache) tauriCoreCache = await import("@tauri-apps/api/core");
  return tauriCoreCache;
}

interface BackendEnvInfo {
  env_type: string;
  os: string;
  hostname: string;
  ip: string;
  vulnerability_hints: string[];
}

interface BackendPortResult {
  port: number;
  protocol: string;
  service: string;
  version: string;
  state: string;
  risk: string;
}

export function ReconView() {
  const reconResults = useAppStore((s) => s.hackingReconResults);
  const setReconResults = useAppStore((s) => s.setHackingReconResults);
  const addHackingLog = useAppStore((s) => s.addHackingLog);
  const addHackingAlert = useAppStore((s) => s.addHackingAlert);
  const addDebugLog = useAppStore((s) => s.addDebugLog);

  const [scanning, setScanning] = useState(false);
  const [scanTarget, setScanTarget] = useState("127.0.0.1");
  const [customPorts, setCustomPorts] = useState("");
  const [showMap, setShowMap] = useState(true);
  const [showPorts, setShowPorts] = useState(true);
  const [networkMap, setNetworkMap] = useState("");
  const [generating, setGenerating] = useState(false);

  const runFullRecon = useCallback(async () => {
    setScanning(true);
    addHackingLog({ level: "recon", message: "Starting full reconnaissance scan...", source: "Recon", category: "network" });
    addDebugLog({ level: "info", message: "[Hacking] Full recon scan started", source: "Hacking Mode" });

    try {
      const { invoke } = await getTauriCore();

      // Step 1: Detect environment
      const envResult = await invoke<BackendEnvInfo>("hacking_detect_environment");
      const environment: EnvironmentInfo = {
        type: envResult.env_type as EnvironmentInfo["type"],
        os: envResult.os,
        hostname: envResult.hostname,
        ip: envResult.ip,
        vulnerabilityHints: envResult.vulnerability_hints,
      };

      addHackingLog({
        level: "info",
        message: `Environment: ${environment.type} | Host: ${environment.hostname} | IP: ${environment.ip}`,
        source: "Recon",
        category: "system",
      });

      // Generate alerts from vulnerability hints
      for (const hint of environment.vulnerabilityHints) {
        addHackingAlert({
          severity: hint.toLowerCase().includes("warning") || hint.toLowerCase().includes("root") ? "critical" : "warning",
          title: "Security Finding",
          details: hint,
          category: "environment",
        });
      }

      // Step 2: Port scan
      const target = scanTarget || environment.ip;
      addHackingLog({ level: "recon", message: `Scanning ports on ${target}...`, source: "Recon", category: "network" });

      // Parse custom ports or use common scan
      let portResults: BackendPortResult[];
      if (customPorts.trim()) {
        const ports = customPorts.split(",").map((p) => {
          const trimmed = p.trim();
          if (trimmed.includes("-")) {
            const [start, end] = trimmed.split("-").map(Number);
            return Array.from({ length: end - start + 1 }, (_, i) => start + i);
          }
          return [Number(trimmed)];
        }).flat().filter((p) => p > 0 && p <= 65535);
        portResults = await invoke<BackendPortResult[]>("hacking_scan_custom_ports", { target, ports });
      } else {
        portResults = await invoke<BackendPortResult[]>("hacking_scan_ports", { target });
      }
      const openPorts: PortInfo[] = portResults.map((p) => ({
        port: p.port,
        protocol: p.protocol,
        service: p.service,
        version: p.version,
        state: p.state as PortInfo["state"],
        risk: p.risk as PortInfo["risk"],
      }));

      // Alert on critical/high risk ports
      for (const port of openPorts) {
        if (port.state === "open" && (port.risk === "critical" || port.risk === "high")) {
          addHackingAlert({
            severity: port.risk === "critical" ? "critical" : "warning",
            title: `${port.risk.toUpperCase()} Risk Port Open`,
            details: `Port ${port.port} (${port.service}) is open`,
            category: "network",
          });
        }
      }

      addHackingLog({
        level: "success",
        message: `Found ${openPorts.filter((p) => p.state === "open").length} open ports`,
        source: "Recon",
        category: "network",
      });

      // Step 3: Generate network map
      const backendEnv = {
        env_type: environment.type,
        os: environment.os,
        hostname: environment.hostname,
        ip: environment.ip,
        vulnerability_hints: environment.vulnerabilityHints,
      };
      const map = await invoke<string>("hacking_network_map", { env: backendEnv, ports: portResults });
      setNetworkMap(map);

      // Step 4: Try banner grab on open ports
      const services = [];
      for (const port of openPorts.filter((p) => p.state === "open").slice(0, 5)) {
        try {
          const banner = await invoke<string | null>("hacking_grab_banner", { host: target, port: port.port });
          if (banner) {
            port.version = banner;
            services.push({ name: port.service, version: banner, port: port.port, vulnerabilities: [] });
          }
        } catch {
          // Banner grab is best-effort
        }
      }

      const result: ReconResult = {
        environment,
        openPorts,
        services,
        networkMap: map,
        timestamp: Date.now(),
      };

      setReconResults(result);
      addHackingLog({ level: "success", message: "Reconnaissance scan complete", source: "Recon", category: "general" });
      addDebugLog({ level: "info", message: `[Hacking] Recon complete: ${openPorts.filter((p) => p.state === "open").length} open ports found`, source: "Hacking Mode" });
    } catch (err) {
      addHackingLog({ level: "danger", message: `Recon failed: ${err}`, source: "Recon", category: "general" });
    }

    setScanning(false);
  }, [scanTarget, addHackingLog, addHackingAlert, addDebugLog, setReconResults]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  const riskColor = (risk: string) => {
    switch (risk) {
      case "critical": return "#ff0040";
      case "high": return "#ff6633";
      case "medium": return "#ffaf00";
      default: return "#00ff41";
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Scan Controls */}
      <div style={{
        padding: "8px 10px",
        background: "var(--bg-tertiary)",
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--border-subtle)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
          <Radar size={12} style={{ color: "var(--accent-primary)" }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-primary)" }}>Smart Recon</span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            type="text"
            value={scanTarget}
            onChange={(e) => setScanTarget(e.target.value)}
            placeholder="Target IP (default: localhost)"
            style={{
              flex: 1,
              background: "var(--bg-primary)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-sm)",
              color: "var(--text-primary)",
              padding: "4px 8px",
              fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace",
              outline: "none",
            }}
          />
          <button
            onClick={runFullRecon}
            disabled={scanning}
            style={{
              background: scanning ? "var(--bg-active)" : "var(--accent-primary)",
              border: "none",
              borderRadius: "var(--radius-sm)",
              color: scanning ? "var(--text-muted)" : "#000",
              padding: "4px 12px",
              fontSize: 10,
              fontWeight: 700,
              cursor: scanning ? "default" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <RefreshCw size={10} className={scanning ? "animate-pulse" : ""} />
            {scanning ? "Scanning..." : "Scan"}
          </button>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          <input
            type="text"
            value={customPorts}
            onChange={(e) => setCustomPorts(e.target.value)}
            placeholder="Custom ports: 80,443,8000-8100 (empty = common)"
            style={{
              flex: 1,
              background: "var(--bg-primary)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-sm)",
              color: "var(--text-primary)",
              padding: "3px 8px",
              fontSize: 10,
              fontFamily: "'JetBrains Mono', monospace",
              outline: "none",
            }}
          />
          {reconResults && (
            <button
              onClick={async () => {
                setGenerating(true);
                try {
                  const { invoke } = await getTauriCore();
                  const backendEnv = {
                    env_type: reconResults.environment.type,
                    os: reconResults.environment.os,
                    hostname: reconResults.environment.hostname,
                    ip: reconResults.environment.ip,
                    vulnerability_hints: reconResults.environment.vulnerabilityHints,
                  };
                  const backendPorts = reconResults.openPorts.map((p) => ({
                    port: p.port, protocol: p.protocol, service: p.service,
                    version: p.version, state: p.state, risk: p.risk,
                  }));
                  const report = await invoke<string>("hacking_generate_report", { env: backendEnv, ports: backendPorts });
                  const filename = `security_report_${Date.now()}.md`;
                  await invoke<string>("export_file_to_downloads", { filename, content: report });
                  addHackingLog({ level: "success", message: `Report exported: ${filename}`, source: "Recon", category: "general" });
                } catch (err) {
                  addHackingLog({ level: "danger", message: `Export failed: ${err}`, source: "Recon", category: "general" });
                }
                setGenerating(false);
              }}
              disabled={generating}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 3,
                padding: "3px 8px",
                fontSize: 9,
                background: "var(--bg-active)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-sm)",
                color: "var(--text-secondary)",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
              title="Export security report to Downloads"
            >
              <Download size={9} />
              Report
            </button>
          )}
        </div>
      </div>

      {/* Environment Info */}
      {reconResults?.environment && (
        <div style={{
          padding: "8px 10px",
          background: "var(--bg-tertiary)",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border-subtle)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <Server size={12} style={{ color: "var(--accent-secondary)" }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)" }}>Environment</span>
            <span style={{
              fontSize: 9,
              padding: "1px 6px",
              borderRadius: 8,
              background: "var(--accent-primary)",
              color: "#000",
              fontWeight: 700,
              textTransform: "uppercase",
            }}>
              {reconResults.environment.type}
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, fontSize: 10 }}>
            <span style={{ color: "var(--text-muted)" }}>Host:</span>
            <span style={{ color: "var(--text-primary)", fontFamily: "monospace" }}>{reconResults.environment.hostname}</span>
            <span style={{ color: "var(--text-muted)" }}>IP:</span>
            <span style={{ color: "var(--text-primary)", fontFamily: "monospace" }}>{reconResults.environment.ip}</span>
            <span style={{ color: "var(--text-muted)" }}>OS:</span>
            <span style={{ color: "var(--text-primary)", fontFamily: "monospace", fontSize: 9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {reconResults.environment.os}
            </span>
          </div>
          {reconResults.environment.vulnerabilityHints.length > 0 && (
            <div style={{ marginTop: 6, borderTop: "1px solid var(--border-subtle)", paddingTop: 6 }}>
              {reconResults.environment.vulnerabilityHints.map((hint, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, color: "#ffaf00", marginBottom: 2 }}>
                  <AlertTriangle size={9} />
                  <span>{hint}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Network Map */}
      {networkMap && (
        <div style={{
          background: "var(--bg-tertiary)",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border-subtle)",
          overflow: "hidden",
        }}>
          <div
            onClick={() => setShowMap(!showMap)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px",
              cursor: "pointer",
              borderBottom: showMap ? "1px solid var(--border-subtle)" : "none",
            }}
          >
            {showMap ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            <Globe size={11} style={{ color: "var(--accent-secondary)" }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)", flex: 1 }}>Network Map</span>
            <button
              onClick={(e) => { e.stopPropagation(); copyToClipboard(networkMap); }}
              style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 2 }}
              title="Copy map"
            >
              <Copy size={10} />
            </button>
          </div>
          {showMap && (
            <pre style={{
              padding: "8px 10px",
              fontSize: 9,
              lineHeight: 1.4,
              color: "var(--accent-primary)",
              fontFamily: "'JetBrains Mono', monospace",
              overflowX: "auto",
              overflowY: "auto",
              maxHeight: 300,
              margin: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}>
              {networkMap}
            </pre>
          )}
        </div>
      )}

      {/* Open Ports */}
      {reconResults && reconResults.openPorts.length > 0 && (
        <div style={{
          background: "var(--bg-tertiary)",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border-subtle)",
          overflow: "hidden",
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}>
          <div
            onClick={() => setShowPorts(!showPorts)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px",
              cursor: "pointer",
              borderBottom: showPorts ? "1px solid var(--border-subtle)" : "none",
            }}
          >
            {showPorts ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            <Wifi size={11} style={{ color: "var(--accent-primary)" }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)", flex: 1 }}>
              Open Ports ({reconResults.openPorts.filter((p) => p.state === "open").length})
            </span>
          </div>
          {showPorts && (
            <div>
              {/* Table header */}
              <div style={{
                display: "flex",
                padding: "3px 10px",
                fontSize: 9,
                fontWeight: 700,
                color: "var(--text-muted)",
                borderBottom: "1px solid var(--border-subtle)",
                background: "var(--bg-primary)",
                position: "sticky",
                top: 0,
              }}>
                <span style={{ width: 50 }}>PORT</span>
                <span style={{ flex: 1 }}>SERVICE</span>
                <span style={{ width: 50 }}>STATE</span>
                <span style={{ width: 55, textAlign: "right" }}>RISK</span>
              </div>
              {reconResults.openPorts.map((port, idx) => (
                <div
                  key={`${port.port}-${idx}`}
                  style={{
                    display: "flex",
                    padding: "4px 10px",
                    fontSize: 10,
                    alignItems: "center",
                    borderBottom: "1px solid var(--border-subtle)",
                  }}
                >
                  <span style={{ width: 50, fontFamily: "monospace", color: "var(--text-primary)", fontWeight: 600 }}>
                    {port.port}
                  </span>
                  <span style={{ flex: 1, color: "var(--text-secondary)", fontSize: 9 }}>
                    {port.service}
                    {port.version && <span style={{ color: "var(--text-muted)", marginLeft: 4 }}>({port.version.slice(0, 30)})</span>}
                  </span>
                  <span style={{
                    width: 50,
                    fontSize: 9,
                    color: port.state === "open" ? "#00ff41" : "#ffaf00",
                  }}>
                    {port.state}
                  </span>
                  <span style={{
                    width: 55,
                    textAlign: "right",
                    fontSize: 9,
                    fontWeight: 700,
                    color: riskColor(port.risk),
                  }}>
                    {port.risk.toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!reconResults && !scanning && (
        <div style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          color: "var(--text-muted)",
        }}>
          <Shield size={28} style={{ opacity: 0.3 }} />
          <span style={{ fontSize: 11 }}>Click "Scan" to start reconnaissance</span>
          <span style={{ fontSize: 9, opacity: 0.6 }}>Detects environment, scans ports, grabs banners</span>
        </div>
      )}
    </div>
  );
}
