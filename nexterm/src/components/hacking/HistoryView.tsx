import { useState, useCallback } from "react";
import { Clock, Download, Trash2, Lock, Unlock, Eye, EyeOff } from "lucide-react";
import { useAppStore } from "../../store/appStore";

let tauriCoreCache: typeof import("@tauri-apps/api/core") | null = null;
async function getTauriCore() {
  if (!tauriCoreCache) tauriCoreCache = await import("@tauri-apps/api/core");
  return tauriCoreCache;
}

export function HistoryView() {
  const hackingLogs = useAppStore((s) => s.hackingLogs);
  const clearHackingLogs = useAppStore((s) => s.clearHackingLogs);

  const [savedSessions, setSavedSessions] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadedContent, setLoadedContent] = useState<string | null>(null);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);

  const loadSessionList = useCallback(async () => {
    try {
      const { invoke } = await getTauriCore();
      const sessions = await invoke<string[]>("hacking_list_sessions");
      setSavedSessions(sessions);
    } catch {
      setSavedSessions([]);
    }
    setSessionsLoaded(true);
  }, []);

  if (!sessionsLoaded) {
    loadSessionList();
  }

  const saveSession = useCallback(async () => {
    if (hackingLogs.length === 0 || !password) return;
    setSaving(true);
    try {
      const { invoke } = await getTauriCore();
      const data = JSON.stringify(hackingLogs, null, 2);
      await invoke<string>("hacking_save_session", { data, password });
      await loadSessionList();
    } catch {
      // Save failed silently
    }
    setSaving(false);
  }, [hackingLogs, password, loadSessionList]);

  const loadSession = useCallback(async (filename: string) => {
    if (!password) return;
    try {
      const { invoke } = await getTauriCore();
      const content = await invoke<string>("hacking_load_session", { filename, password });
      setLoadedContent(content);
    } catch {
      setLoadedContent("Error: Could not decrypt. Wrong password?");
    }
  }, [password]);

  const deleteSession = useCallback(async (filename: string) => {
    try {
      const { invoke } = await getTauriCore();
      await invoke("hacking_delete_session", { filename });
      await loadSessionList();
    } catch {
      // Delete failed
    }
  }, [loadSessionList]);

  const levelColor = (level: string) => {
    switch (level) {
      case "recon": return "#00d4ff";
      case "exploit": return "#ff00ff";
      case "alert": return "#ffaf00";
      case "success": return "#00ff41";
      case "danger": return "#ff0040";
      default: return "var(--text-secondary)";
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minHeight: 0 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Clock size={12} style={{ color: "var(--text-secondary)" }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-primary)", flex: 1 }}>
          Session History
        </span>
        <span style={{ fontSize: 9, color: "var(--text-muted)" }}>
          {hackingLogs.length} entries
        </span>
      </div>

      {/* Encryption password */}
      <div style={{
        padding: "6px 10px",
        background: "var(--bg-tertiary)",
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--border-subtle)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <Lock size={10} style={{ color: "var(--accent-warning)" }} />
          <span style={{ fontSize: 9, color: "var(--text-muted)" }}>Encryption password</span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <div style={{ flex: 1, position: "relative" }}>
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password to encrypt/decrypt"
              style={{
                width: "100%",
                background: "var(--bg-primary)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-sm)",
                color: "var(--text-primary)",
                padding: "4px 28px 4px 8px",
                fontSize: 10,
                outline: "none",
              }}
            />
            <button
              onClick={() => setShowPassword(!showPassword)}
              style={{
                position: "absolute",
                right: 4,
                top: "50%",
                transform: "translateY(-50%)",
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                padding: 2,
              }}
            >
              {showPassword ? <EyeOff size={10} /> : <Eye size={10} />}
            </button>
          </div>
          <button
            onClick={saveSession}
            disabled={!password || hackingLogs.length === 0 || saving}
            style={{
              background: password && hackingLogs.length > 0 ? "var(--accent-primary)" : "var(--bg-active)",
              border: "none",
              borderRadius: "var(--radius-sm)",
              color: password && hackingLogs.length > 0 ? "#000" : "var(--text-muted)",
              padding: "4px 10px",
              fontSize: 10,
              fontWeight: 700,
              cursor: password && hackingLogs.length > 0 ? "pointer" : "default",
              display: "flex",
              alignItems: "center",
              gap: 3,
            }}
          >
            <Download size={10} />
            Save
          </button>
        </div>
      </div>

      {/* Saved Sessions */}
      {savedSessions.length > 0 && (
        <div style={{
          background: "var(--bg-tertiary)",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border-subtle)",
          padding: "6px 10px",
        }}>
          <span style={{ fontSize: 9, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
            Saved sessions ({savedSessions.length}):
          </span>
          {savedSessions.map((session) => (
            <div
              key={session}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "3px 0",
                borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              <Lock size={9} style={{ color: "var(--accent-warning)", flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 10, color: "var(--text-primary)", fontFamily: "monospace" }}>
                {session.replace("session_", "").replace(".enc", "")}
              </span>
              <button
                onClick={() => loadSession(session)}
                disabled={!password}
                style={{
                  background: "none",
                  border: "none",
                  color: password ? "var(--accent-secondary)" : "var(--text-muted)",
                  cursor: password ? "pointer" : "default",
                  padding: 2,
                  fontSize: 9,
                }}
                title="Load"
              >
                <Unlock size={10} />
              </button>
              <button
                onClick={() => deleteSession(session)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--accent-error)",
                  cursor: "pointer",
                  padding: 2,
                }}
                title="Delete"
              >
                <Trash2 size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Loaded session content */}
      {loadedContent && (
        <div style={{
          background: "var(--bg-primary)",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border-subtle)",
          padding: "8px 10px",
          maxHeight: 200,
          overflowY: "auto",
        }} className="hacking-log-container">
          <pre style={{
            fontSize: 9,
            color: "var(--accent-primary)",
            fontFamily: "'JetBrains Mono', monospace",
            whiteSpace: "pre-wrap",
            margin: 0,
          }}>
            {loadedContent}
          </pre>
        </div>
      )}

      {/* Current session logs */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        justifyContent: "space-between",
      }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-primary)" }}>Current Session</span>
        {hackingLogs.length > 0 && (
          <button
            onClick={clearHackingLogs}
            style={{
              background: "var(--bg-active)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-sm)",
              color: "var(--text-muted)",
              padding: "2px 6px",
              fontSize: 9,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 3,
            }}
          >
            <Trash2 size={9} />
            Clear
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }} className="hacking-log-container">
        {hackingLogs.map((log) => (
          <div
            key={log.id}
            style={{
              display: "flex",
              gap: 6,
              padding: "3px 0",
              borderBottom: "1px solid var(--border-subtle)",
              fontSize: 9,
              alignItems: "flex-start",
            }}
          >
            <span style={{ color: "var(--text-muted)", fontFamily: "monospace", flexShrink: 0, width: 50 }}>
              {new Date(log.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
            <span style={{
              fontWeight: 700,
              color: levelColor(log.level),
              width: 50,
              flexShrink: 0,
              textTransform: "uppercase",
              fontSize: 8,
            }}>
              {log.level}
            </span>
            <span style={{
              color: "var(--text-primary)",
              flex: 1,
              wordBreak: "break-word",
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              {log.message}
            </span>
          </div>
        ))}
        {hackingLogs.length === 0 && (
          <div style={{ padding: 16, textAlign: "center", fontSize: 10, color: "var(--text-muted)" }}>
            No hacking activity logged yet
          </div>
        )}
      </div>
    </div>
  );
}
