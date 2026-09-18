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
  Upload,
  SquarePlus,
} from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { CanvasAddon } from "@xterm/addon-canvas";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { useAppStore } from "../store/appStore";
import { useT } from "../i18n";
import type { SSHConnection } from "../store/appStore";
import { parseTerminalOutput } from "./DebugPanel";
import { themeColors } from "../utils/themeColors";
import { describeSshKey, type SshKeyInfo } from "../utils/sshKeyFingerprint";

// Batched async SSH debug log parsing — mirrors TerminalPanel's queueDebugParse
// Never blocks terminal rendering; buffers data and flushes every 200ms
const sshDebugBuffers = new Map<string, string>();
let sshDebugParseScheduled = false;
const MAX_SSH_DEBUG_SOURCES = 16;

function queueSshDebugParse(data: string, source: string) {
  if (!useAppStore.getState().debugEnabled) return;
  if (!sshDebugBuffers.has(source) && sshDebugBuffers.size >= MAX_SSH_DEBUG_SOURCES) return;
  const existing = sshDebugBuffers.get(source) || "";
  const combined = existing + data;
  sshDebugBuffers.set(source, combined.length > 262144 ? combined.slice(-131072) : combined);
  if (!sshDebugParseScheduled) {
    sshDebugParseScheduled = true;
    setTimeout(flushSshDebugParse, 200);
  }
}

function flushSshDebugParse() {
  sshDebugParseScheduled = false;
  if (sshDebugBuffers.size === 0) return;
  const store = useAppStore.getState();
  if (!store.debugEnabled) { sshDebugBuffers.clear(); return; }
  for (const [source, buf] of sshDebugBuffers) {
    parseTerminalOutput(buf, source, store.addDebugLog);
  }
  sshDebugBuffers.clear();
}

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

// themeColors imported from ../utils/themeColors

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

function getTermColors(theme: string): Record<string, string> {
  if (theme === "custom") {
    const ct = useAppStore.getState().customTheme;
    return {
      background: ct.terminalBg, foreground: ct.terminalFg,
      cursor: ct.terminalCursor, cursorAccent: ct.terminalBg,
      selectionBackground: ct.accentPrimary + "66", selectionForeground: "#ffffff",
      black: "#484f58", red: "#ff7b72", green: "#3fb950", yellow: "#d29922",
      blue: ct.accentPrimary, magenta: "#bc8cff", cyan: ct.accentSecondary, white: "#b1bac4",
      brightBlack: "#6e7681", brightRed: "#ffa198", brightGreen: "#56d364", brightYellow: "#e3b341",
      brightBlue: ct.accentPrimary, brightMagenta: "#d2a8ff", brightCyan: ct.accentSecondary, brightWhite: "#f0f6fc",
    };
  }
  return themeColors[theme] || themeColors.dark;
}

export function SSHPanel() {
  const sshConnections = useAppStore((s) => s.sshConnections);
  const addSSHConnection = useAppStore((s) => s.addSSHConnection);
  const updateSSHConnection = useAppStore((s) => s.updateSSHConnection);
  const removeSSHConnection = useAppStore((s) => s.removeSSHConnection);
  const addSSHTab = useAppStore((s) => s.addSSHTab);
  const pendingSSHConnectId = useAppStore((s) => s.pendingSSHConnectId);
  const clearPendingSSHConnect = useAppStore((s) => s.clearPendingSSHConnect);
  const theme = useAppStore((s) => s.theme);
  const customTheme = useAppStore((s) => s.customTheme);
  const t = useT();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [keychainIds, setKeychainIds] = useState<Set<string>>(new Set());

  // Check which connections have keychain passwords stored (parallel, non-blocking)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { invoke } = await getTauriCore();
        const results = await Promise.allSettled(
          sshConnections.map(async (conn) => {
            const pass = await invoke<string | null>("keychain_get_password", { connectionId: conn.id });
            return pass ? conn.id : null;
          })
        );
        if (cancelled) return;
        const ids = new Set<string>();
        for (const r of results) {
          if (r.status === "fulfilled" && r.value) ids.add(r.value);
        }
        setKeychainIds(ids);
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

  // Identity of the key currently in the form (type + SHA256 fingerprint).
  // Shown under the textarea so a wrong key pair is visible BEFORE connecting —
  // otherwise the server just answers with the opaque
  // "Username/PublicKey combination invalid", which looks like a server problem.
  const [keyInfo, setKeyInfo] = useState<SshKeyInfo | null>(null);

  useEffect(() => {
    if (formAuthMode !== "key" || !formKey.trim()) {
      setKeyInfo(null);
      return;
    }
    let cancelled = false;
    describeSshKey(formKey).then((info) => {
      if (!cancelled) setKeyInfo(info);
    });
    return () => {
      cancelled = true;
    };
  }, [formKey, formAuthMode]);

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

  // Detect errors that mean "the encrypted private key needs a passphrase".
  // libssh2 surfaces these via several phrasings depending on key format.
  const isPassphraseError = (msg: string): boolean => {
    const m = msg.toLowerCase();
    return (
      m.includes("passphrase") ||
      m.includes("decrypt") ||
      m.includes("unable to extract public key") ||
      m.includes("unable to initialize private key") ||
      m.includes("callback returned error") // OpenSSH new-format encrypted
    );
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
      const errMsg = String(e);
      // If this was a private-key auth that failed because the key is
      // encrypted: silently check keychain for a stored passphrase and
      // retry once. Only show the prompt if the keychain has nothing.
      if (conn.privateKey && !password && isPassphraseError(errMsg)) {
        try {
          const { invoke: inv } = await getTauriCore();
          const storedPass = await inv<string | null>("keychain_get_password", { connectionId: conn.id });
          if (storedPass) {
            // Retry with stored passphrase — no UI flash
            handleConnect(conn, storedPass);
            return;
          }
        } catch { /* keychain unavailable — fall through to prompt */ }
        updateSSHConnection(conn.id, { status: "disconnected", errorMessage: undefined });
        setPasswordPrompt({ connId: conn.id, password: "", saveMode: "keychain", isPassphrase: true });
        return;
      }
      updateSSHConnection(conn.id, { status: "error", errorMessage: errMsg });
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

    const colors = getTermColors(theme);
    const terminal = new Terminal({
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: 14,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: "block",
      cursorWidth: 2,
      theme: colors,
      allowTransparency: false,
      allowProposedApi: true,
      scrollback: 1000,
      tabStopWidth: 4,
      rightClickSelectsWord: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(termContainerRef.current);

    // Load canvas renderer AFTER open() for proper cursor, selection, and color rendering
    try {
      terminal.loadAddon(new CanvasAddon());
    } catch {
      // Canvas addon failed, DOM renderer will be used as fallback
    }

    fitAddon.fit();

    // Shared write queue — accessible from key handlers AND async setup
    let writeQueue = "";
    let writeFlushScheduled = false;
    let invokeRef: typeof import("@tauri-apps/api/core")["invoke"] | null = null;

    // Fire-and-forget flush: batches all keystrokes from same microtask, sends one IPC call
    const scheduleWriteFlush = () => {
      if (writeFlushScheduled) return;
      writeFlushScheduled = true;
      queueMicrotask(() => {
        writeFlushScheduled = false;
        if (writeQueue && invokeRef) {
          const toSend = writeQueue;
          writeQueue = "";
          invokeRef("ssh_write", { sessionId: activeSessionId, data: toSend }).catch(() => {});
        }
      });
    };

    // Delegate to xterm.js paste(): it normalizes CRLF/LF → CR and wraps
    // with bracketed-paste markers ONLY when the remote app enabled BPM
    // (DECSET 2004). Routes through terminal.onData → writeQueue.
    // Fixes: extra spaces / phantom newlines in nano, vim, bash prompt.
    const pasteToSession = (text: string) => {
      terminal.paste(text);
    };

    // Copy/paste for SSH terminal — paste routes through writeQueue for optimal batching
    terminal.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      if ((e.ctrlKey || e.metaKey) && e.key === "c" && terminal.hasSelection()) {
        navigator.clipboard.writeText(terminal.getSelection());
        terminal.clearSelection();
        return false;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "v") {
        e.preventDefault();
        navigator.clipboard.readText().then((text) => {
          if (text) pasteToSession(text);
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
          if (text) pasteToSession(text);
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
        invokeRef = invoke; // Make invoke available to key handlers

        const connForLog = useAppStore.getState().sshConnections.find((c) => c.sessionId === activeSessionId);
        const sshSource = connForLog ? `SSH:${connForLog.name}` : "SSH";

        const unData = await listen<string>(`ssh-data-${activeSessionId}`, (event) => {
          terminal.write(event.payload);
          queueSshDebugParse(event.payload, sshSource);
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
          terminal.write("\r\n\x1b[33m[Connection lost. Click 'Disconnect' then reconnect.]\x1b[0m\r\n");
          useAppStore.getState().addDebugLog({ level: "error", message: event.payload, source: sshSource });
          // Mark connection as disconnected so UI shows reconnect option
          const conn = useAppStore.getState().sshConnections.find((c) => c.sessionId === activeSessionId);
          if (conn) {
            useAppStore.getState().updateSSHConnection(conn.id, { status: "error", errorMessage: event.payload, sessionId: undefined });
          }
        });
        unlisteners.push(unError);

        // Restore scrollback from previous session (if terminal was re-opened)
        try {
          const scrollback = await invoke<string>("ssh_get_scrollback", { sessionId: activeSessionId });
          if (scrollback) {
            terminal.write(scrollback);
          }
        } catch {
          // No scrollback available — fresh session
        }

        // Terminal input → fire-and-forget via writeQueue
        let sshInputBuffer = "";
        const dataDisposable = terminal.onData((data) => {
          // ── AI Natural Language → Command (prefix: ?) ──
          if ((data === "\r" || data === "\n") && sshInputBuffer.trim().startsWith("?") && sshInputBuffer.trim().length > 2) {
            const query = sshInputBuffer.trim().slice(1).trim();
            const bufLen = sshInputBuffer.length;
            writeQueue += "\x7f".repeat(bufLen);
            sshInputBuffer = "";
            scheduleWriteFlush();
            const sshShowStatus = (msg: string) => { writeQueue += msg; scheduleWriteFlush(); };
            const sshClearStatus = (len: number) => { writeQueue += "\x7f".repeat(len); scheduleWriteFlush(); };

            (async () => {
              const statusMsg = "# [AI] generating...";
              try {
                const AI_MODEL = "deepseek-coder:6.7b";
                let needsPull = false;
                try {
                  const models = await invoke<Array<{ name: string }>>("ai_list_models");
                  needsPull = !models.some((m) => m.name.startsWith(AI_MODEL.split(":")[0]));
                } catch { /* Ollama not running */ }

                if (needsPull) {
                  const dlMsg = "# [AI] downloading model (first time)...";
                  sshShowStatus(dlMsg);
                  try { await invoke("ai_pull_model", { model: AI_MODEL }); } catch { /* pull failed */ }
                  sshClearStatus(dlMsg.length);
                }

                sshShowStatus(statusMsg);
                const response = await invoke<string>("ai_chat", {
                  model: AI_MODEL,
                  systemPrompt: "Output ONLY the shell command. No explanation, no markdown, no backticks. One line.",
                  messages: [{ role: "user", content: query }],
                });
                sshClearStatus(statusMsg.length);
                const cmd = (response || "").trim().replace(/^```[\w]*\n?/, "").replace(/\n?```$/, "").trim().split("\n")[0];
                if (cmd && sshInputBuffer.length === 0) {
                  writeQueue += cmd;
                  sshInputBuffer = cmd;
                  scheduleWriteFlush();
                }
              } catch {
                sshClearStatus(statusMsg.length);
              }
            })();
            return;
          }

          // Track input buffer
          if (data === "\r" || data === "\n") {
            sshInputBuffer = "";
          } else if (data === "\x7f" || data === "\b") {
            sshInputBuffer = sshInputBuffer.slice(0, -1);
          } else if (data === "\x03" || data === "\x15") {
            sshInputBuffer = "";
          } else if (data >= " ") {
            if (sshInputBuffer.length < 4096) sshInputBuffer += data;
          }

          writeQueue += data;
          scheduleWriteFlush();
        });

        // Debounced resize — avoids flooding IPC during window drag
        let sshResizeTimer: ReturnType<typeof setTimeout> | null = null;
        const resizeDisposable = terminal.onResize(({ cols, rows }) => {
          if (sshResizeTimer) clearTimeout(sshResizeTimer);
          sshResizeTimer = setTimeout(() => {
            invoke("ssh_resize", { sessionId: activeSessionId, cols, rows });
          }, 50);
        });

        // Initial resize — also forces shell redraw when reconnecting
        // to an existing session (the terminal was disposed while away,
        // so a fresh xterm has no output). Changing cols briefly triggers
        // SIGWINCH on the remote shell, which redraws the prompt.
        invoke("ssh_resize", {
          sessionId: activeSessionId,
          cols: Math.max(1, terminal.cols - 1),
          rows: terminal.rows,
        });
        setTimeout(() => {
          invoke("ssh_resize", {
            sessionId: activeSessionId,
            cols: terminal.cols,
            rows: terminal.rows,
          }).catch(() => {});
        }, 80);

        unlisteners.push(() => dataDisposable.dispose());
        unlisteners.push(() => resizeDisposable.dispose());
      } catch {
        terminal.writeln("\x1b[33m[SSH terminal running in demo mode]\x1b[0m");
      }
    })();

    sshTermRef.current = { terminal, fitAddon, unlisteners };

    // Handle resize with debounce to avoid excessive fit() calls
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (sshTermRef.current) {
          sshTermRef.current.fitAddon.fit();
        }
      }, 100);
    });
    if (termContainerRef.current) {
      observer.observe(termContainerRef.current);
    }

    return () => {
      observer.disconnect();
      if (resizeTimer) clearTimeout(resizeTimer);
      // Clean up terminal and event listeners when activeSessionId changes
      if (sshTermRef.current) {
        sshTermRef.current.unlisteners.forEach((fn) => fn());
        sshTermRef.current.terminal.dispose();
        sshTermRef.current = null;
      }
    };
  }, [activeSessionId]);

  // Update terminal theme when it changes
  useEffect(() => {
    if (sshTermRef.current) {
      sshTermRef.current.terminal.options.theme = getTermColors(theme);
    }
  }, [theme, customTheme]);

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

  // Password prompt state. `isPassphrase` switches the UI text/labels to ask
  // for a private-key passphrase instead of a login password. The keychain
  // entry is shared (one entry per connectionId) — for keyed connections it
  // stores the passphrase, for password connections it stores the password.
  const [passwordPrompt, setPasswordPrompt] = useState<{ connId: string; password: string; saveMode: "none" | "session" | "keychain"; isPassphrase?: boolean } | null>(null);

  const startConnect = async (conn: SSHConnection) => {
    if (conn.privateKey) {
      // Fast path: try without passphrase first. Unencrypted keys succeed
      // instantly (same speed as v3.3.1). Encrypted keys fail fast and
      // handleConnect's catch detects passphrase error → opens prompt.
      // Keychain lookup moved INSIDE handleConnect's passphrase-error catch
      // so it never blocks the fast path.
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
    setPasswordPrompt({ connId: conn.id, password: "", saveMode: "keychain", isPassphrase: false });
  };

  // External request: another component (TabBar / TerminalPanel) asked to
  // connect a saved server. Trigger the same flow as clicking "Connect" so
  // the password prompt opens if no credentials are stored.
  useEffect(() => {
    if (!pendingSSHConnectId) return;
    const conn = sshConnections.find((c) => c.id === pendingSSHConnectId);
    clearPendingSSHConnect();
    if (conn && conn.status !== "connected" && conn.status !== "connecting") {
      startConnect(conn);
    }
    // startConnect / sshConnections intentionally not in deps:
    // we want to react only when a new request arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSSHConnectId]);

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
            <X size={12} /> {t("common.back")}
          </button>
          <span style={{ fontSize: 12, color: "var(--text-primary)", fontWeight: 600, flex: 1 }}>
            {activeConn?.name}
          </span>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent-secondary)" }} />
          <button
            onClick={() => activeConn && handleDisconnect(activeConn)}
            style={{ ...btnStyle, background: "var(--accent-error)", color: "white", padding: "4px 8px" }}
          >
            <Square size={12} /> {t("common.disconnect")}
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
        <span className="sidebar-section-title" style={{ margin: 0 }}>{t("ssh.connections")}</span>
        <button
          onClick={() => { resetForm(); setShowForm(!showForm); }}
          style={{ background: "none", border: "none", color: "var(--accent-primary)", cursor: "pointer", padding: 4 }}
          aria-label={t("ssh.addConnection")}
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
            <label style={labelStyle}>{t("ssh.connectionName")}</label>
            <input
              placeholder={t("ssh.myServer")}
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>{t("ssh.hostIp")}</label>
              <input
                placeholder="192.168.1.100"
                value={formHost}
                onChange={(e) => setFormHost(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div style={{ width: 80 }}>
              <label style={labelStyle}>{t("ssh.port")}</label>
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
            <label style={labelStyle}>{t("ssh.username")}</label>
            <input
              placeholder="root"
              value={formUser}
              onChange={(e) => setFormUser(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: 8 }}>
            <label style={labelStyle}>{t("ssh.authMethod")}</label>
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
                <Key size={12} /> {t("ssh.passwordAuth")}
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
                <Key size={12} /> {t("ssh.keyAuth")}
              </button>
            </div>
          </div>

          {formAuthMode === "password" ? (
            <div style={{ marginBottom: 8 }}>
              <label style={labelStyle}>{t("ssh.passwordNotSaved")}</label>
              <input
                type="password"
                placeholder={t("ssh.enterPasswordPlaceholder")}
                value={formPassword}
                onChange={(e) => setFormPassword(e.target.value)}
                style={inputStyle}
              />
            </div>
          ) : (
            <div style={{ marginBottom: 8 }}>
              <label style={labelStyle}>{t("ssh.privateKeyContent")}</label>
              <textarea
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..."
                value={formKey}
                onChange={(e) => setFormKey(e.target.value)}
                rows={4}
                style={{ ...inputStyle, resize: "vertical", minHeight: 80 }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                <button
                  onClick={() => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = ".pem,.key,.pub,.ppk,id_rsa,id_ed25519,id_ecdsa,*";
                    input.onchange = () => {
                      const file = input.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => {
                        const text = typeof reader.result === "string" ? reader.result : "";
                        if (text) {
                          setFormKey(text);
                        } else {
                          setTestResult({ type: "error", message: t("ssh.keyFileEmpty") || "Key file is empty or not readable as text." });
                        }
                      };
                      reader.onerror = () => {
                        setTestResult({ type: "error", message: (t("ssh.keyFileReadError") || "Failed to read key file: ") + (reader.error?.message ?? "unknown error") });
                      };
                      reader.readAsText(file);
                    };
                    input.click();
                  }}
                  style={{
                    ...btnStyle,
                    background: "var(--bg-active)",
                    color: "var(--text-secondary)",
                    padding: "4px 10px",
                    fontSize: 11,
                  }}
                >
                  <Upload size={12} /> {t("ssh.loadKeyFile")}
                </button>
                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  {t("ssh.orPasteKey")}
                </span>
              </div>

              {keyInfo && (
                <div
                  title={t("ssh.keyFingerprintHint")}
                  style={{
                    marginTop: 6,
                    padding: "5px 8px",
                    borderRadius: "var(--radius-sm)",
                    background: "var(--bg-active)",
                    fontSize: 10,
                    lineHeight: 1.5,
                    fontFamily: "var(--font-mono, monospace)",
                    color: keyInfo.problem === "ppk" || keyInfo.problem === "not-a-private-key"
                      ? "var(--accent-error)"
                      : "var(--text-secondary)",
                    wordBreak: "break-all",
                  }}
                >
                  <Key size={10} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
                  {keyInfo.problem === "ppk" ? (
                    t("ssh.keyPpk")
                  ) : keyInfo.problem === "not-a-private-key" ? (
                    t("ssh.keyNotPrivate")
                  ) : keyInfo.problem === "malformed" ? (
                    t("ssh.keyMalformed")
                  ) : (
                    <>
                      <b>{keyInfo.type}</b>
                      {keyInfo.bits ? ` ${keyInfo.bits}` : ""}
                      {keyInfo.fingerprint ? ` · ${keyInfo.fingerprint}` : ` · ${t("ssh.keyNoFingerprint")}`}
                      {keyInfo.comment ? ` · ${keyInfo.comment}` : ""}
                      {keyInfo.encrypted ? ` · ${t("ssh.keyEncrypted")}` : ""}
                    </>
                  )}
                </div>
              )}
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
              {t("common.test")}
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
              {editingId ? t("common.update") : t("common.save")}
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
          <label style={labelStyle}>
            {passwordPrompt.isPassphrase ? "Key passphrase for" : t("ssh.enterPassword")} {sshConnections.find((c) => c.id === passwordPrompt.connId)?.name}
          </label>
          <input
            type="password"
            placeholder={passwordPrompt.isPassphrase ? "Enter SSH key passphrase" : t("ssh.enterPasswordPlaceholder")}
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
              {t("ssh.saveKeychainPersistent")}
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
              {t("ssh.rememberSessionOnly")}
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-secondary)", cursor: "pointer" }}>
              <input
                type="radio"
                name="saveMode"
                checked={passwordPrompt.saveMode === "none"}
                onChange={() => setPasswordPrompt({ ...passwordPrompt, saveMode: "none" })}
                style={{ accentColor: "var(--accent-primary)" }}
              />
              {t("ssh.dontSavePassword")}
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
              <Play size={12} /> {t("common.connect")}
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
          <div>{t("ssh.noConnectionsYet")}</div>
          <div style={{ marginTop: 4 }}>{t("ssh.clickToAdd")}</div>
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
                    <span title={t("ssh.keychainSavedTitle")} style={{ display: "inline-flex", flexShrink: 0 }}>
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
                    <Play size={12} /> {t("ssh.openTerminal")}
                  </button>
                  <button
                    onClick={() => addSSHTab(conn.id)}
                    title={t("ssh.newTab")}
                    style={{ ...btnStyle, background: "var(--accent-primary)", color: "white", padding: "4px 8px" }}
                  >
                    <SquarePlus size={12} />
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
                  <Loader2 size={12} className="animate-pulse" /> {t("common.connecting")}
                </button>
              ) : (
                <button
                  onClick={() => startConnect(conn)}
                  style={{ ...btnStyle, flex: 1, justifyContent: "center", background: "var(--accent-primary)", color: "white", padding: "4px 8px" }}
                >
                  <Play size={12} /> {t("common.connect")}
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
