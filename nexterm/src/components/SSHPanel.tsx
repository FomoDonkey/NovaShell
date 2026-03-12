import { useState, useEffect, useRef, useCallback } from "react";
import {
  Plus,
  Trash2,
  Play,
  Square,
  Pencil,
  TestTube,
  Loader2,
  Check,
  X,
  Server,
  Key,
  Shield,
  ShieldCheck,
} from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useAppStore } from "../store/appStore";
import type { SSHConnection } from "../store/appStore";
import { parseTerminalOutput } from "./DebugPanel";

// Cached Tauri imports
let tauriCoreCache: typeof import("@tauri-apps/api/core") | null = null;
let tauriEventCache: typeof import("@tauri-apps/api/event") | null = null;
async function getTauriCore() {
  if (!tauriCoreCache) tauriCoreCache = await import("@tauri-apps/api/core");
  return tauriCoreCache;
}
async function getTauriEvent() {
  if (!tauriEventCache) tauriEventCache = await import("@tauri-apps/api/event");
  return tauriEventCache;
}

const themeColors: Record<string, Record<string, string>> = {
  dark: {
    background: "#0d1117", foreground: "#e6edf3", cursor: "#58a6ff", cursorAccent: "#0d1117",
    selectionBackground: "rgba(88,166,255,0.3)",
    black: "#484f58", red: "#ff7b72", green: "#3fb950", yellow: "#d29922",
    blue: "#58a6ff", magenta: "#bc8cff", cyan: "#39d2c0", white: "#b1bac4",
    brightBlack: "#6e7681", brightRed: "#ffa198", brightGreen: "#56d364", brightYellow: "#e3b341",
    brightBlue: "#79c0ff", brightMagenta: "#d2a8ff", brightCyan: "#56d4dd", brightWhite: "#f0f6fc",
  },
  light: {
    background: "#ffffff", foreground: "#1f2328", cursor: "#0969da", cursorAccent: "#ffffff",
    selectionBackground: "rgba(9,105,218,0.2)",
    black: "#24292f", red: "#cf222e", green: "#1a7f37", yellow: "#9a6700",
    blue: "#0969da", magenta: "#8250df", cyan: "#1b7c83", white: "#6e7781",
    brightBlack: "#57606a", brightRed: "#a40e26", brightGreen: "#2da44e", brightYellow: "#bf8700",
    brightBlue: "#218bff", brightMagenta: "#a475f9", brightCyan: "#3192aa", brightWhite: "#8c959f",
  },
  cyberpunk: {
    background: "#0a0a1a", foreground: "#00ffcc", cursor: "#00ffcc", cursorAccent: "#0a0a1a",
    selectionBackground: "rgba(0,255,204,0.2)",
    black: "#333366", red: "#ff3366", green: "#00ffcc", yellow: "#ffcc00",
    blue: "#3399ff", magenta: "#cc66ff", cyan: "#00ccff", white: "#ccccff",
    brightBlack: "#666699", brightRed: "#ff6699", brightGreen: "#33ffdd", brightYellow: "#ffdd33",
    brightBlue: "#66bbff", brightMagenta: "#dd88ff", brightCyan: "#33ddff", brightWhite: "#eeeeff",
  },
  retro: {
    background: "#1b2b1b", foreground: "#33ff33", cursor: "#33ff33", cursorAccent: "#1b2b1b",
    selectionBackground: "rgba(51,255,51,0.2)",
    black: "#0a150a", red: "#ff3333", green: "#33ff33", yellow: "#ccff33",
    blue: "#33ccff", magenta: "#33ffcc", cyan: "#66ff66", white: "#99cc99",
    brightBlack: "#448844", brightRed: "#ff6666", brightGreen: "#66ff66", brightYellow: "#ddff66",
    brightBlue: "#66ddff", brightMagenta: "#66ffdd", brightCyan: "#88ff88", brightWhite: "#ccffcc",
  },
};

interface SSHTerminalRef {
  terminal: Terminal;
  fitAddon: FitAddon;
  unlisteners: Array<() => void>;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  background: "var(--bg-tertiary)",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-sm)",
  color: "var(--text-primary)",
  fontSize: 12,
  fontFamily: "inherit",
  outline: "none",
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-secondary)",
  marginBottom: 4,
  display: "block",
};

const btnStyle: React.CSSProperties = {
  padding: "6px 12px",
  border: "none",
  borderRadius: "var(--radius-sm)",
  fontSize: 12,
  cursor: "pointer",
  fontFamily: "inherit",
  display: "flex",
  alignItems: "center",
  gap: 6,
};

export function SSHPanel() {
  const { sshConnections, addSSHConnection, updateSSHConnection, removeSSHConnection, theme } = useAppStore();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [keychainIds, setKeychainIds] = useState<Set<string>>(new Set());

  // Check which connections have keychain passwords stored
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { invoke } = await getTauriCore();
        const ids = new Set<string>();
        for (const conn of sshConnections) {
          const pass = await invoke<string | null>("keychain_get_password", { connectionId: conn.id });
          if (pass) ids.add(conn.id);
        }
        if (!cancelled) setKeychainIds(ids);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [sshConnections.length]);

  // Form state
  const [formName, setFormName] = useState("");
  const [formHost, setFormHost] = useState("");
  const [formPort, setFormPort] = useState(22);
  const [formUser, setFormUser] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formKey, setFormKey] = useState("");
  const [formAuthMode, setFormAuthMode] = useState<"password" | "key">("password");

  // Terminal refs
  const termContainerRef = useRef<HTMLDivElement>(null);
  const sshTermRef = useRef<SSHTerminalRef | null>(null);

  const resetForm = () => {
    setFormName("");
    setFormHost("");
    setFormPort(22);
    setFormUser("");
    setFormPassword("");
    setFormKey("");
    setFormAuthMode("password");
    setEditingId(null);
    setShowForm(false);
    setTestResult(null);
  };

  const handleEdit = (conn: SSHConnection) => {
    setFormName(conn.name);
    setFormHost(conn.host);
    setFormPort(conn.port);
    setFormUser(conn.username);
    setFormPassword("");
    setFormKey(conn.privateKey || "");
    setFormAuthMode(conn.privateKey ? "key" : "password");
    setEditingId(conn.id);
    setShowForm(true);
  };

  const handleSave = () => {
    if (!formName || !formHost || !formUser) return;

    const connData = {
      name: formName,
      host: formHost,
      port: formPort,
      username: formUser,
      privateKey: formAuthMode === "key" && formKey ? formKey : undefined,
    };

    if (editingId) {
      updateSSHConnection(editingId, connData);
    } else {
      addSSHConnection(connData);
    }
    resetForm();
  };

  const handleTestConnection = async () => {
    if (!formHost || !formUser) return;
    setTesting(true);
    setTestResult(null);

    try {
      const { invoke } = await getTauriCore();
      const result = await invoke<string>("ssh_test_connection", {
        host: formHost,
        port: formPort,
        username: formUser,
        password: formAuthMode === "password" && formPassword ? formPassword : null,
        privateKey: formAuthMode === "key" && formKey ? formKey : null,
      });
      setTestResult({ type: "success", message: result });
    } catch (e) {
      setTestResult({ type: "error", message: String(e) });
    }
    setTesting(false);
  };

  const handleConnect = useCallback(async (conn: SSHConnection, password?: string) => {
    updateSSHConnection(conn.id, { status: "connecting", errorMessage: undefined });

    try {
      const { invoke } = await getTauriCore();
      const sessionId = await invoke<string>("ssh_connect", {
        host: conn.host,
        port: conn.port,
        username: conn.username,
        password: password || null,
        privateKey: conn.privateKey || null,
      });

      updateSSHConnection(conn.id, { status: "connected", sessionId });
      setActiveSessionId(sessionId);
    } catch (e) {
      updateSSHConnection(conn.id, { status: "error", errorMessage: String(e) });
    }
  }, [updateSSHConnection]);

  const handleDisconnect = useCallback(async (conn: SSHConnection) => {
    if (!conn.sessionId) return;

    try {
      const { invoke } = await getTauriCore();
      await invoke("ssh_disconnect", { sessionId: conn.sessionId });
    } catch {}

    if (activeSessionId === conn.sessionId) {
      // Clean up terminal
      if (sshTermRef.current) {
        sshTermRef.current.unlisteners.forEach((fn) => fn());
        sshTermRef.current.terminal.dispose();
        sshTermRef.current = null;
      }
      setActiveSessionId(null);
    }

    updateSSHConnection(conn.id, { status: "disconnected", sessionId: undefined });
  }, [updateSSHConnection, activeSessionId]);

  const handleDelete = async (conn: SSHConnection) => {
    if (conn.status === "connected" && conn.sessionId) {
      await handleDisconnect(conn);
    }
    // Clean up keychain password if any
    try {
      const { invoke } = await getTauriCore();
      await invoke("keychain_delete_password", { connectionId: conn.id });
    } catch {}
    removeSSHConnection(conn.id);
  };

  // Initialize SSH terminal when activeSessionId changes
  useEffect(() => {
    if (!activeSessionId || !termContainerRef.current) return;

    // Clean up previous terminal
    if (sshTermRef.current) {
      sshTermRef.current.unlisteners.forEach((fn) => fn());
      sshTermRef.current.terminal.dispose();
      sshTermRef.current = null;
    }

    const colors = themeColors[theme] || themeColors.dark;
    const terminal = new Terminal({
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: "bar",
      theme: colors,
      allowProposedApi: true,
      scrollback: 3000,
      rightClickSelectsWord: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(termContainerRef.current);
    fitAddon.fit();

    // Copy/paste for SSH terminal
    const currentSessionId = activeSessionId;
    terminal.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      if ((e.ctrlKey || e.metaKey) && e.key === "c" && terminal.hasSelection()) {
        navigator.clipboard.writeText(terminal.getSelection());
        terminal.clearSelection();
        return false;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "v") {
        navigator.clipboard.readText().then((text) => {
          if (text) getTauriCore().then(({ invoke }) => invoke("ssh_write", { sessionId: currentSessionId, data: text }));
        });
        return false;
      }
      return true;
    });

    const sshContextMenu = (e: Event) => {
      e.preventDefault();
      if (terminal.hasSelection()) {
        navigator.clipboard.writeText(terminal.getSelection());
        terminal.clearSelection();
      } else {
        navigator.clipboard.readText().then((text) => {
          if (text) getTauriCore().then(({ invoke }) => invoke("ssh_write", { sessionId: currentSessionId, data: text }));
        });
      }
    };
    termContainerRef.current.addEventListener("contextmenu", sshContextMenu);

    const unlisteners: Array<() => void> = [];
    const containerEl = termContainerRef.current;
    unlisteners.push(() => containerEl.removeEventListener("contextmenu", sshContextMenu));

    (async () => {
      try {
        const { invoke } = await getTauriCore();
        const { listen } = await getTauriEvent();

        const connForLog = useAppStore.getState().sshConnections.find((c) => c.sessionId === activeSessionId);
        const sshSource = connForLog ? `SSH:${connForLog.name}` : "SSH";

        const unData = await listen<string>(`ssh-data-${activeSessionId}`, (event) => {
          terminal.write(event.payload);
          const store = useAppStore.getState();
          if (store.debugEnabled) {
            parseTerminalOutput(event.payload, sshSource, store.addDebugLog);
          }
        });
        unlisteners.push(unData);

        const unExit = await listen(`ssh-exit-${activeSessionId}`, () => {
          terminal.write("\r\n\x1b[31m[SSH session ended]\x1b[0m\r\n");
          const conn = useAppStore.getState().sshConnections.find((c) => c.sessionId === activeSessionId);
          if (conn) {
            useAppStore.getState().updateSSHConnection(conn.id, { status: "disconnected", sessionId: undefined });
          }
          useAppStore.getState().addDebugLog({ level: "warn", message: "SSH session ended", source: sshSource });
        });
        unlisteners.push(unExit);

        const unError = await listen<string>(`ssh-error-${activeSessionId}`, (event) => {
          terminal.write(`\r\n\x1b[31m[SSH Error: ${event.payload}]\x1b[0m\r\n`);
          useAppStore.getState().addDebugLog({ level: "error", message: event.payload, source: sshSource });
        });
        unlisteners.push(unError);

        const dataDisposable = terminal.onData((data) => {
          invoke("ssh_write", { sessionId: activeSessionId, data });
        });

        const resizeDisposable = terminal.onResize(({ cols, rows }) => {
          invoke("ssh_resize", { sessionId: activeSessionId, cols, rows });
        });

        // Initial resize
        invoke("ssh_resize", {
          sessionId: activeSessionId,
          cols: terminal.cols,
          rows: terminal.rows,
        });

        unlisteners.push(() => dataDisposable.dispose());
        unlisteners.push(() => resizeDisposable.dispose());
      } catch {
        terminal.writeln("\x1b[33m[SSH terminal running in demo mode]\x1b[0m");
      }
    })();

    sshTermRef.current = { terminal, fitAddon, unlisteners };

    // Handle resize
    const observer = new ResizeObserver(() => {
      if (sshTermRef.current) {
        sshTermRef.current.fitAddon.fit();
      }
    });
    if (termContainerRef.current) {
      observer.observe(termContainerRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [activeSessionId, theme]);

  // Update terminal theme when it changes
  useEffect(() => {
    if (sshTermRef.current) {
      const colors = themeColors[theme] || themeColors.dark;
      sshTermRef.current.terminal.options.theme = colors;
    }
  }, [theme]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (sshTermRef.current) {
        sshTermRef.current.unlisteners.forEach((fn) => fn());
        sshTermRef.current.terminal.dispose();
        sshTermRef.current = null;
      }
    };
  }, []);

  // Password prompt state for connections without stored keys
  const [passwordPrompt, setPasswordPrompt] = useState<{ connId: string; password: string; saveMode: "none" | "session" | "keychain" } | null>(null);

  const startConnect = async (conn: SSHConnection) => {
    if (conn.privateKey) {
      handleConnect(conn);
      return;
    }
    // Try session password first
    if (conn.sessionPassword) {
      handleConnect(conn, conn.sessionPassword);
      return;
    }
    // Try keychain
    try {
      const { invoke } = await getTauriCore();
      const keychainPass = await invoke<string | null>("keychain_get_password", { connectionId: conn.id });
      if (keychainPass) {
        handleConnect(conn, keychainPass);
        return;
      }
    } catch {}
    // No stored password found, prompt user
    setPasswordPrompt({ connId: conn.id, password: "", saveMode: "keychain" });
  };

  const statusColor = (status: SSHConnection["status"]) => {
    switch (status) {
      case "connected": return "var(--accent-secondary)";
      case "connecting": return "var(--accent-warning)";
      case "error": return "var(--accent-error)";
      default: return "var(--text-muted)";
    }
  };

  const activeConn = sshConnections.find((c) => c.sessionId === activeSessionId);

  // If there's an active SSH terminal, show it
  if (activeSessionId && activeConn?.status === "connected") {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <button
            onClick={() => {
              if (sshTermRef.current) {
                sshTermRef.current.unlisteners.forEach((fn) => fn());
                sshTermRef.current.terminal.dispose();
                sshTermRef.current = null;
              }
              setActiveSessionId(null);
            }}
            style={{ ...btnStyle, background: "var(--bg-tertiary)", color: "var(--text-secondary)", padding: "4px 8px" }}
          >
            <X size={12} /> Back
          </button>
          <span style={{ fontSize: 12, color: "var(--text-primary)", fontWeight: 600, flex: 1 }}>
            {activeConn?.name}
          </span>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent-secondary)" }} />
          <button
            onClick={() => activeConn && handleDisconnect(activeConn)}
            style={{ ...btnStyle, background: "var(--accent-error)", color: "white", padding: "4px 8px" }}
          >
            <Square size={12} /> Disconnect
          </button>
        </div>
        <div
          ref={termContainerRef}
          style={{
            flex: 1,
            minHeight: 200,
            background: "var(--bg-primary)",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border-subtle)",
            overflow: "hidden",
          }}
        />
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span className="sidebar-section-title" style={{ margin: 0 }}>SSH Connections</span>
        <button
          onClick={() => { resetForm(); setShowForm(!showForm); }}
          style={{ background: "none", border: "none", color: "var(--accent-primary)", cursor: "pointer", padding: 4 }}
          aria-label="Add SSH connection"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Connection Form */}
      {showForm && (
        <div style={{
          padding: 12,
          background: "var(--bg-tertiary)",
          borderRadius: "var(--radius-md)",
          marginBottom: 12,
          border: "1px solid var(--border-subtle)",
        }}>
          <div style={{ marginBottom: 8 }}>
            <label style={labelStyle}>Connection Name</label>
            <input
              placeholder="My Server"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Host / IP</label>
              <input
                placeholder="192.168.1.100"
                value={formHost}
                onChange={(e) => setFormHost(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div style={{ width: 80 }}>
              <label style={labelStyle}>Port</label>
              <input
                type="number"
                value={formPort}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "") {
                    setFormPort(0);
                  } else {
                    const num = parseInt(val, 10);
                    if (!isNaN(num) && num >= 0 && num <= 65535) {
                      setFormPort(num);
                    }
                  }
                }}
                onBlur={() => {
                  if (!formPort || formPort <= 0) setFormPort(22);
                }}
                min={1}
                max={65535}
                style={inputStyle}
              />
            </div>
          </div>

          <div style={{ marginBottom: 8 }}>
            <label style={labelStyle}>Username</label>
            <input
              placeholder="root"
              value={formUser}
              onChange={(e) => setFormUser(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: 8 }}>
            <label style={labelStyle}>Authentication</label>
            <div style={{ display: "flex", gap: 4 }}>
              <button
                onClick={() => setFormAuthMode("password")}
                style={{
                  ...btnStyle,
                  flex: 1,
                  justifyContent: "center",
                  background: formAuthMode === "password" ? "var(--accent-primary)" : "var(--bg-active)",
                  color: formAuthMode === "password" ? "white" : "var(--text-secondary)",
                }}
              >
                <Key size={12} /> Password
              </button>
              <button
                onClick={() => setFormAuthMode("key")}
                style={{
                  ...btnStyle,
                  flex: 1,
                  justifyContent: "center",
                  background: formAuthMode === "key" ? "var(--accent-primary)" : "var(--bg-active)",
                  color: formAuthMode === "key" ? "white" : "var(--text-secondary)",
                }}
              >
                <Key size={12} /> Private Key
              </button>
            </div>
          </div>

          {formAuthMode === "password" ? (
            <div style={{ marginBottom: 8 }}>
              <label style={labelStyle}>Password (not saved to disk)</label>
              <input
                type="password"
                placeholder="Enter password..."
                value={formPassword}
                onChange={(e) => setFormPassword(e.target.value)}
                style={inputStyle}
              />
            </div>
          ) : (
            <div style={{ marginBottom: 8 }}>
              <label style={labelStyle}>Private Key Content</label>
              <textarea
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..."
                value={formKey}
                onChange={(e) => setFormKey(e.target.value)}
                rows={4}
                style={{ ...inputStyle, resize: "vertical", minHeight: 80 }}
              />
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
                Paste your private key content here. It will be stored encrypted.
              </div>
            </div>
          )}

          {testResult && (
            <div style={{
              padding: "8px 10px",
              borderRadius: "var(--radius-sm)",
              marginBottom: 8,
              fontSize: 12,
              background: testResult.type === "success" ? "rgba(63,185,80,0.15)" : "rgba(248,81,73,0.15)",
              color: testResult.type === "success" ? "var(--accent-secondary)" : "var(--accent-error)",
              border: `1px solid ${testResult.type === "success" ? "var(--accent-secondary)" : "var(--accent-error)"}`,
            }}>
              {testResult.type === "success" ? <Check size={12} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} /> : <X size={12} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />}
              {testResult.message}
            </div>
          )}

          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button
              onClick={handleTestConnection}
              disabled={testing || !formHost || !formUser}
              style={{
                ...btnStyle,
                flex: 1,
                justifyContent: "center",
                background: "var(--bg-active)",
                color: "var(--text-secondary)",
                opacity: testing || !formHost || !formUser ? 0.5 : 1,
              }}
            >
              {testing ? <Loader2 size={12} className="animate-pulse" /> : <TestTube size={12} />}
              Test
            </button>
            <button
              onClick={handleSave}
              disabled={!formName || !formHost || !formUser}
              style={{
                ...btnStyle,
                flex: 1,
                justifyContent: "center",
                background: "var(--accent-primary)",
                color: "white",
                opacity: !formName || !formHost || !formUser ? 0.5 : 1,
              }}
            >
              <Check size={12} />
              {editingId ? "Update" : "Save"}
            </button>
            <button
              onClick={resetForm}
              style={{ ...btnStyle, background: "var(--bg-active)", color: "var(--text-secondary)" }}
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      {/* Password Prompt Dialog */}
      {passwordPrompt && (
        <div style={{
          padding: 12,
          background: "var(--bg-tertiary)",
          borderRadius: "var(--radius-md)",
          marginBottom: 12,
          border: "1px solid var(--accent-primary)",
        }}>
          <label style={labelStyle}>Enter password for {sshConnections.find((c) => c.id === passwordPrompt.connId)?.name}</label>
          <input
            type="password"
            placeholder="Password..."
            value={passwordPrompt.password}
            onChange={(e) => setPasswordPrompt({ ...passwordPrompt, password: e.target.value })}
            onKeyDown={async (e) => {
              if (e.key === "Enter") {
                const conn = sshConnections.find((c) => c.id === passwordPrompt.connId);
                if (conn) {
                  if (passwordPrompt.saveMode === "session") {
                    updateSSHConnection(conn.id, { sessionPassword: passwordPrompt.password });
                  } else if (passwordPrompt.saveMode === "keychain") {
                    try {
                      const { invoke } = await getTauriCore();
                      await invoke("keychain_save_password", { connectionId: conn.id, password: passwordPrompt.password });
                    } catch {}
                  }
                  handleConnect(conn, passwordPrompt.password);
                }
                setPasswordPrompt(null);
              }
            }}
            style={{ ...inputStyle, marginBottom: 8 }}
            autoFocus
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-secondary)", cursor: "pointer" }}>
              <input
                type="radio"
                name="saveMode"
                checked={passwordPrompt.saveMode === "keychain"}
                onChange={() => setPasswordPrompt({ ...passwordPrompt, saveMode: "keychain" })}
                style={{ accentColor: "var(--accent-primary)" }}
              />
              <ShieldCheck size={11} />
              Save in system keychain (persistent)
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-secondary)", cursor: "pointer" }}>
              <input
                type="radio"
                name="saveMode"
                checked={passwordPrompt.saveMode === "session"}
                onChange={() => setPasswordPrompt({ ...passwordPrompt, saveMode: "session" })}
                style={{ accentColor: "var(--accent-primary)" }}
              />
              <Shield size={11} />
              Remember for this session only
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-secondary)", cursor: "pointer" }}>
              <input
                type="radio"
                name="saveMode"
                checked={passwordPrompt.saveMode === "none"}
                onChange={() => setPasswordPrompt({ ...passwordPrompt, saveMode: "none" })}
                style={{ accentColor: "var(--accent-primary)" }}
              />
              Don't save password
            </label>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={async () => {
                const conn = sshConnections.find((c) => c.id === passwordPrompt.connId);
                if (conn) {
                  if (passwordPrompt.saveMode === "session") {
                    updateSSHConnection(conn.id, { sessionPassword: passwordPrompt.password });
                  } else if (passwordPrompt.saveMode === "keychain") {
                    try {
                      const { invoke } = await getTauriCore();
                      await invoke("keychain_save_password", { connectionId: conn.id, password: passwordPrompt.password });
                    } catch {}
                  }
                  handleConnect(conn, passwordPrompt.password);
                }
                setPasswordPrompt(null);
              }}
              style={{ ...btnStyle, flex: 1, justifyContent: "center", background: "var(--accent-primary)", color: "white" }}
            >
              <Play size={12} /> Connect
            </button>
            <button
              onClick={() => setPasswordPrompt(null)}
              style={{ ...btnStyle, background: "var(--bg-active)", color: "var(--text-secondary)" }}
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      {/* Connection List */}
      {sshConnections.length === 0 && !showForm ? (
        <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 24, fontSize: 12 }}>
          <Server size={24} style={{ margin: "0 auto 8px", opacity: 0.5 }} />
          <div>No SSH connections yet.</div>
          <div style={{ marginTop: 4 }}>Click + to add one.</div>
        </div>
      ) : (
        sshConnections.map((conn) => (
          <div key={conn.id} className="ssh-connection-card">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                className="ssh-status-dot"
                style={{ background: statusColor(conn.status) }}
                title={conn.status}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
                  {conn.name}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4 }}>
                  <span>{conn.username}@{conn.host}:{conn.port}</span>
                  {keychainIds.has(conn.id) && (
                    <span title="Password saved in system keychain" style={{ display: "inline-flex", flexShrink: 0 }}>
                      <ShieldCheck size={10} style={{ color: "var(--accent-secondary)" }} />
                    </span>
                  )}
                </div>
              </div>
            </div>

            {conn.status === "error" && conn.errorMessage && (
              <div style={{ fontSize: 10, color: "var(--accent-error)", marginTop: 6, padding: "4px 6px", background: "rgba(248,81,73,0.1)", borderRadius: "var(--radius-sm)" }}>
                {conn.errorMessage}
              </div>
            )}

            <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
              {conn.status === "connected" ? (
                <>
                  <button
                    onClick={() => {
                      if (conn.sessionId) setActiveSessionId(conn.sessionId);
                    }}
                    style={{ ...btnStyle, flex: 1, justifyContent: "center", background: "var(--accent-secondary)", color: "white", padding: "4px 8px" }}
                  >
                    <Play size={12} /> Open Terminal
                  </button>
                  <button
                    onClick={() => handleDisconnect(conn)}
                    style={{ ...btnStyle, background: "var(--accent-error)", color: "white", padding: "4px 8px" }}
                  >
                    <Square size={12} />
                  </button>
                </>
              ) : conn.status === "connecting" ? (
                <button
                  disabled
                  style={{ ...btnStyle, flex: 1, justifyContent: "center", background: "var(--bg-active)", color: "var(--text-muted)", padding: "4px 8px" }}
                >
                  <Loader2 size={12} className="animate-pulse" /> Connecting...
                </button>
              ) : (
                <button
                  onClick={() => startConnect(conn)}
                  style={{ ...btnStyle, flex: 1, justifyContent: "center", background: "var(--accent-primary)", color: "white", padding: "4px 8px" }}
                >
                  <Play size={12} /> Connect
                </button>
              )}
              <button
                onClick={() => handleEdit(conn)}
                disabled={conn.status === "connected"}
                style={{
                  ...btnStyle,
                  background: "var(--bg-active)",
                  color: "var(--text-secondary)",
                  padding: "4px 8px",
                  opacity: conn.status === "connected" ? 0.4 : 1,
                }}
              >
                <Pencil size={12} />
              </button>
              <button
                onClick={() => handleDelete(conn)}
                style={{ ...btnStyle, background: "var(--bg-active)", color: "var(--accent-error)", padding: "4px 8px" }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
