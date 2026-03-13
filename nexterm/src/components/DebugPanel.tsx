import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  Trash2,
  Search,
  Download,
  Pause,
  Play,
  AlertTriangle,
  AlertCircle,
  Info,
  Bug,
  FileText,
  ChevronDown,
  ChevronRight,
  Filter,
  X,
  HardDrive,
  FolderOpen,
  ArrowLeft,
  Clock,
} from "lucide-react";
import { useAppStore } from "../store/appStore";
import type { LogLevel, DebugLogEntry } from "../store/appStore";

let tauriCoreCache: typeof import("@tauri-apps/api/core") | null = null;
async function getTauriCore() {
  if (!tauriCoreCache) tauriCoreCache = await import("@tauri-apps/api/core");
  return tauriCoreCache;
}

interface LogSessionInfo {
  filename: string;
  created: number;
  size: number;
  entry_count: number;
}

const levelConfig: Record<LogLevel, { color: string; bg: string; icon: typeof AlertCircle; label: string }> = {
  error: { color: "#ff7b72", bg: "rgba(255,123,114,0.12)", icon: AlertCircle, label: "ERR" },
  warn: { color: "#d29922", bg: "rgba(210,153,34,0.12)", icon: AlertTriangle, label: "WRN" },
  info: { color: "#58a6ff", bg: "rgba(88,166,255,0.12)", icon: Info, label: "INF" },
  debug: { color: "#bc8cff", bg: "rgba(188,140,255,0.12)", icon: Bug, label: "DBG" },
  trace: { color: "#6e7681", bg: "rgba(110,118,129,0.08)", icon: FileText, label: "TRC" },
  output: { color: "#8b949e", bg: "transparent", icon: FileText, label: "OUT" },
};

export function DebugPanel() {
  const debugLogs = useAppStore((s) => s.debugLogs);
  const clearDebugLogs = useAppStore((s) => s.clearDebugLogs);
  const debugEnabled = useAppStore((s) => s.debugEnabled);
  const toggleDebug = useAppStore((s) => s.toggleDebug);
  const debugPersist = useAppStore((s) => s.debugPersist);
  const toggleDebugPersist = useAppStore((s) => s.toggleDebugPersist);
  const [searchFilter, setSearchFilter] = useState("");
  const [levelFilters, setLevelFilters] = useState<Set<LogLevel>>(
    new Set(["error", "warn", "info", "debug", "trace", "output"])
  );
  const [paused, setPaused] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [view, setView] = useState<"live" | "history">("live");
  const [sessions, setSessions] = useState<LogSessionInfo[]>([]);
  const [loadedSession, setLoadedSession] = useState<{ filename: string; entries: DebugLogEntry[] } | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pausedLogsRef = useRef<DebugLogEntry[]>([]);
  const autoScrollRef = useRef(true);

  // When paused, freeze the displayed logs
  useEffect(() => {
    if (paused) {
      pausedLogsRef.current = debugLogs;
    }
  }, [paused, debugLogs]);

  const displayLogs = paused ? pausedLogsRef.current : debugLogs;

  const filteredLogs = useMemo(() => displayLogs.filter((log) => {
    if (!levelFilters.has(log.level)) return false;
    if (sourceFilter && log.source !== sourceFilter) return false;
    if (searchFilter) {
      const q = searchFilter.toLowerCase();
      return log.message.toLowerCase().includes(q) || log.source.toLowerCase().includes(q);
    }
    return true;
  }), [displayLogs, levelFilters, sourceFilter, searchFilter]);

  // Auto-scroll to bottom when new logs arrive (if user hasn't scrolled up)
  useEffect(() => {
    if (!paused && autoScrollRef.current && scrollRef.current && view === "live") {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filteredLogs.length, paused, view]);

  // Detect if user scrolled up (disable auto-scroll) or back to bottom (re-enable)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
      autoScrollRef.current = atBottom;
    };
    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  // Get unique sources for source filter
  const sources = useMemo(() => [...new Set(displayLogs.map((l) => l.source))], [displayLogs]);

  const toggleLevel = (level: LogLevel) => {
    setLevelFilters((prev) => {
      const next = new Set(prev);
      if (next.has(level)) {
        next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exportLogs = useCallback(() => {
    const lines = filteredLogs
      .slice()
      .reverse()
      .map((log) => {
        const ts = new Date(log.timestamp).toISOString();
        return `[${ts}] [${log.level.toUpperCase()}] [${log.source}] ${log.message}`;
      })
      .join("\n");

    const blob = new Blob([lines], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `novashell-logs-${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredLogs]);

  const loadSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const { invoke } = await getTauriCore();
      const list = await invoke<LogSessionInfo[]>("debug_log_list_sessions");
      setSessions(list);
    } catch {
      setSessions([]);
    }
    setLoadingSessions(false);
  }, []);

  const openSession = useCallback(async (filename: string) => {
    try {
      const { invoke } = await getTauriCore();
      const entries = await invoke<DebugLogEntry[]>("debug_log_load_session", { filename });
      setLoadedSession({ filename, entries });
    } catch {}
  }, []);

  const deleteSession = useCallback(async (filename: string) => {
    try {
      const { invoke } = await getTauriCore();
      await invoke("debug_log_delete_session", { filename });
      setSessions((prev) => prev.filter((s) => s.filename !== filename));
      if (loadedSession?.filename === filename) setLoadedSession(null);
    } catch {}
  }, [loadedSession]);

  const cleanupOldLogs = useCallback(async () => {
    try {
      const { invoke } = await getTauriCore();
      const deleted = await invoke<number>("debug_log_cleanup");
      if (deleted > 0) loadSessions();
    } catch {}
  }, [loadSessions]);

  // Auto-cleanup on first mount
  useEffect(() => {
    getTauriCore().then(({ invoke }) => {
      invoke("debug_log_cleanup").catch(() => {});
    }).catch(() => {});
  }, []);

  // Level counts
  const levelCounts = useMemo(() => {
    const counts: Record<LogLevel, number> = {
      error: 0, warn: 0, info: 0, debug: 0, trace: 0, output: 0,
    };
    displayLogs.forEach((l) => counts[l.level]++);
    return counts;
  }, [displayLogs]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) +
      "." + String(d.getMilliseconds()).padStart(3, "0");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <span className="sidebar-section-title" style={{ margin: 0, flex: 1 }}>Debug Console</span>
        <button
          onClick={toggleDebugPersist}
          style={{
            background: debugPersist ? "var(--accent-primary)" : "var(--bg-active)",
            border: "none",
            borderRadius: "var(--radius-sm)",
            padding: "2px 5px",
            fontSize: 9,
            color: debugPersist ? "white" : "var(--text-muted)",
            cursor: "pointer",
            fontFamily: "inherit",
            display: "flex",
            alignItems: "center",
            gap: 3,
          }}
          title={debugPersist ? "Logs saved to disk" : "Logs not saved to disk"}
        >
          <HardDrive size={9} />
        </button>
        <button
          onClick={toggleDebug}
          style={{
            background: debugEnabled ? "var(--accent-secondary)" : "var(--bg-active)",
            border: "none",
            borderRadius: "var(--radius-sm)",
            padding: "2px 6px",
            fontSize: 10,
            color: debugEnabled ? "white" : "var(--text-muted)",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {debugEnabled ? "ON" : "OFF"}
        </button>
      </div>

      {/* View tabs: Live / History */}
      <div style={{ display: "flex", gap: 2, marginBottom: 8 }}>
        <button
          onClick={() => { setView("live"); setLoadedSession(null); }}
          style={{
            flex: 1,
            padding: "4px 0",
            border: "none",
            borderRadius: "var(--radius-sm)",
            background: view === "live" ? "var(--accent-primary)" : "var(--bg-tertiary)",
            color: view === "live" ? "white" : "var(--text-secondary)",
            fontSize: 11,
            cursor: "pointer",
            fontFamily: "inherit",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
          }}
        >
          <Bug size={11} /> Live
        </button>
        <button
          onClick={() => { setView("history"); loadSessions(); }}
          style={{
            flex: 1,
            padding: "4px 0",
            border: "none",
            borderRadius: "var(--radius-sm)",
            background: view === "history" ? "var(--accent-primary)" : "var(--bg-tertiary)",
            color: view === "history" ? "white" : "var(--text-secondary)",
            fontSize: 11,
            cursor: "pointer",
            fontFamily: "inherit",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
          }}
        >
          <Clock size={11} /> History
        </button>
      </div>

      {/* History View */}
      {view === "history" && !loadedSession && (
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>
              {loadingSessions ? "Loading..." : `${sessions.length} saved sessions`}
            </span>
            <button
              onClick={cleanupOldLogs}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                padding: 2,
                fontSize: 10,
                fontFamily: "inherit",
              }}
              title="Delete logs older than 7 days"
            >
              <Trash2 size={11} />
            </button>
          </div>
          {sessions.length === 0 && !loadingSessions ? (
            <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 24, fontSize: 12 }}>
              <FolderOpen size={24} style={{ margin: "0 auto 8px", opacity: 0.4, display: "block" }} />
              <div>No saved log sessions.</div>
              <div style={{ marginTop: 4, fontSize: 10 }}>Enable disk persistence to save logs.</div>
            </div>
          ) : (
            sessions.map((session) => (
              <div
                key={session.filename}
                style={{
                  padding: "8px 10px",
                  background: "var(--bg-tertiary)",
                  borderRadius: "var(--radius-sm)",
                  marginBottom: 4,
                  border: "1px solid var(--border-subtle)",
                  cursor: "pointer",
                  transition: "var(--transition-fast)",
                }}
                onClick={() => openSession(session.filename)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: "var(--text-primary)", fontWeight: 600 }}>
                    {session.filename.replace(".jsonl", "")}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteSession(session.filename); }}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--accent-error)",
                      cursor: "pointer",
                      padding: 2,
                    }}
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
                <div style={{ display: "flex", gap: 12, marginTop: 4, fontSize: 10, color: "var(--text-muted)" }}>
                  <span>{session.entry_count} entries</span>
                  <span>{formatFileSize(session.size)}</span>
                  <span>{new Date(session.created).toLocaleDateString()}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Loaded session view */}
      {view === "history" && loadedSession && (
        <HistorySessionView
          session={loadedSession}
          onBack={() => setLoadedSession(null)}
          formatTime={formatTime}
        />
      )}

      {/* === LIVE VIEW === */}
      {view === "live" && <>
      {/* Level filter badges */}
      <div style={{ display: "flex", gap: 3, marginBottom: 8, flexWrap: "wrap" }}>
        {(["error", "warn", "info", "debug", "trace", "output"] as LogLevel[]).map((level) => {
          const cfg = levelConfig[level];
          const active = levelFilters.has(level);
          return (
            <button
              key={level}
              onClick={() => toggleLevel(level)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 3,
                padding: "2px 6px",
                border: `1px solid ${active ? cfg.color : "var(--border-subtle)"}`,
                borderRadius: "var(--radius-sm)",
                background: active ? cfg.bg : "transparent",
                color: active ? cfg.color : "var(--text-muted)",
                fontSize: 10,
                cursor: "pointer",
                fontFamily: "inherit",
                opacity: active ? 1 : 0.5,
                transition: "var(--transition-fast)",
              }}
            >
              {cfg.label}
              {levelCounts[level] > 0 && (
                <span style={{
                  background: active ? cfg.color : "var(--text-muted)",
                  color: "var(--bg-primary)",
                  borderRadius: 8,
                  padding: "0 4px",
                  fontSize: 9,
                  fontWeight: 700,
                  minWidth: 14,
                  textAlign: "center",
                }}>
                  {levelCounts[level] > 99 ? "99+" : levelCounts[level]}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Search + toolbar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        <div style={{ flex: 1, position: "relative" }}>
          <Search size={11} style={{ position: "absolute", left: 7, top: 7, color: "var(--text-muted)" }} />
          <input
            type="text"
            placeholder="Filter logs..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            style={{
              width: "100%",
              padding: "5px 8px 5px 24px",
              background: "var(--bg-tertiary)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-sm)",
              color: "var(--text-primary)",
              fontSize: 11,
              fontFamily: "inherit",
              outline: "none",
            }}
          />
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          style={{
            background: showFilters || sourceFilter ? "var(--accent-primary)" : "var(--bg-tertiary)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-sm)",
            color: showFilters || sourceFilter ? "white" : "var(--text-secondary)",
            cursor: "pointer",
            padding: "0 6px",
            display: "flex",
            alignItems: "center",
          }}
        >
          <Filter size={11} />
        </button>
        <button
          onClick={() => setPaused(!paused)}
          style={{
            background: paused ? "var(--accent-warning)" : "var(--bg-tertiary)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-sm)",
            color: paused ? "white" : "var(--text-secondary)",
            cursor: "pointer",
            padding: "0 6px",
            display: "flex",
            alignItems: "center",
          }}
          title={paused ? "Resume" : "Pause"}
        >
          {paused ? <Play size={11} /> : <Pause size={11} />}
        </button>
        <button
          onClick={exportLogs}
          style={{
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-sm)",
            color: "var(--text-secondary)",
            cursor: "pointer",
            padding: "0 6px",
            display: "flex",
            alignItems: "center",
          }}
          title="Export logs"
        >
          <Download size={11} />
        </button>
        <button
          onClick={clearDebugLogs}
          style={{
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-sm)",
            color: "var(--accent-error)",
            cursor: "pointer",
            padding: "0 6px",
            display: "flex",
            alignItems: "center",
          }}
          title="Clear logs"
        >
          <Trash2 size={11} />
        </button>
      </div>

      {/* Source filter dropdown */}
      {showFilters && (
        <div style={{
          padding: 8,
          background: "var(--bg-tertiary)",
          borderRadius: "var(--radius-sm)",
          marginBottom: 8,
          border: "1px solid var(--border-subtle)",
        }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>Filter by source:</div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            <button
              onClick={() => setSourceFilter(null)}
              style={{
                padding: "2px 8px",
                border: `1px solid ${!sourceFilter ? "var(--accent-primary)" : "var(--border-subtle)"}`,
                borderRadius: "var(--radius-sm)",
                background: !sourceFilter ? "var(--accent-primary)" : "var(--bg-active)",
                color: !sourceFilter ? "white" : "var(--text-secondary)",
                fontSize: 10,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              All
            </button>
            {sources.map((src) => (
              <button
                key={src}
                onClick={() => setSourceFilter(src)}
                style={{
                  padding: "2px 8px",
                  border: `1px solid ${sourceFilter === src ? "var(--accent-primary)" : "var(--border-subtle)"}`,
                  borderRadius: "var(--radius-sm)",
                  background: sourceFilter === src ? "var(--accent-primary)" : "var(--bg-active)",
                  color: sourceFilter === src ? "white" : "var(--text-secondary)",
                  fontSize: 10,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {src}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Stats bar */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        fontSize: 10,
        color: "var(--text-muted)",
        marginBottom: 6,
        padding: "0 2px",
      }}>
        <span>{filteredLogs.length} entries{paused ? " (paused)" : ""}</span>
        <span>{displayLogs.length} total</span>
      </div>

      {/* Log entries */}
      <div
        ref={scrollRef}
        className="debug-log-container"
        style={{
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          minHeight: 0,
        }}
      >
        {filteredLogs.length === 0 ? (
          <div style={{
            textAlign: "center",
            color: "var(--text-muted)",
            padding: 24,
            fontSize: 12,
          }}>
            <Bug size={24} style={{ margin: "0 auto 8px", opacity: 0.4, display: "block" }} />
            {debugEnabled
              ? "No logs captured yet. Run commands in the terminal."
              : "Debug logging is disabled. Click ON to enable."}
          </div>
        ) : (
          filteredLogs.map((log) => {
            const cfg = levelConfig[log.level];
            const Icon = cfg.icon;
            const expanded = expandedIds.has(log.id);
            const isMultiline = log.message.includes("\n");

            return (
              <div
                key={log.id}
                className="debug-log-entry"
                style={{
                  borderLeft: `2px solid ${cfg.color}`,
                  background: cfg.bg,
                  padding: "4px 8px",
                  marginBottom: 1,
                  cursor: isMultiline ? "pointer" : "default",
                  transition: "var(--transition-fast)",
                }}
                onClick={isMultiline ? () => toggleExpand(log.id) : undefined}
              >
                <div style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 6,
                  minWidth: 0,
                }}>
                  {isMultiline && (
                    expanded
                      ? <ChevronDown size={10} style={{ color: cfg.color, marginTop: 2, flexShrink: 0 }} />
                      : <ChevronRight size={10} style={{ color: cfg.color, marginTop: 2, flexShrink: 0 }} />
                  )}
                  <Icon size={10} style={{ color: cfg.color, marginTop: 2, flexShrink: 0 }} />
                  <span style={{
                    fontSize: 9,
                    color: "var(--text-muted)",
                    fontFamily: "monospace",
                    flexShrink: 0,
                    marginTop: 1,
                    minWidth: 72,
                  }}>
                    {formatTime(log.timestamp)}
                  </span>
                  <span style={{
                    fontSize: 9,
                    color: cfg.color,
                    fontWeight: 700,
                    flexShrink: 0,
                    marginTop: 1,
                    minWidth: 24,
                  }}>
                    {cfg.label}
                  </span>
                  <span style={{
                    fontSize: 9,
                    color: "var(--accent-primary)",
                    flexShrink: 0,
                    marginTop: 1,
                    maxWidth: 60,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    {log.source}
                  </span>
                  <span style={{
                    fontSize: 11,
                    color: "var(--text-primary)",
                    fontFamily: "'JetBrains Mono', monospace",
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: expanded ? "pre-wrap" : "nowrap",
                    wordBreak: expanded ? "break-all" : undefined,
                  }}>
                    {expanded ? log.message : log.message.split("\n")[0]}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
      </>}
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function HistorySessionView({
  session,
  onBack,
  formatTime,
}: {
  session: { filename: string; entries: DebugLogEntry[] };
  onBack: () => void;
  formatTime: (ts: number) => string;
}) {
  const [filter, setFilter] = useState("");

  const filtered = session.entries.filter((log) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return log.message.toLowerCase().includes(q) || log.source.toLowerCase().includes(q) || log.level.includes(q);
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <button
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-secondary)",
            cursor: "pointer",
            padding: 2,
            display: "flex",
          }}
        >
          <ArrowLeft size={14} />
        </button>
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {session.filename.replace(".jsonl", "")}
        </span>
        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{session.entries.length} entries</span>
      </div>

      <div style={{ position: "relative", marginBottom: 8 }}>
        <Search size={11} style={{ position: "absolute", left: 7, top: 7, color: "var(--text-muted)" }} />
        <input
          type="text"
          placeholder="Search session..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            width: "100%",
            padding: "5px 8px 5px 24px",
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-sm)",
            color: "var(--text-primary)",
            fontSize: 11,
            fontFamily: "inherit",
            outline: "none",
          }}
        />
      </div>

      <div className="debug-log-container" style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {filtered.map((log) => {
          const cfg = levelConfig[log.level as LogLevel] || levelConfig.output;
          const Icon = cfg.icon;
          return (
            <div
              key={log.id}
              className="debug-log-entry"
              style={{
                borderLeft: `2px solid ${cfg.color}`,
                background: cfg.bg,
                padding: "4px 8px",
                marginBottom: 1,
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 6, minWidth: 0 }}>
                <Icon size={10} style={{ color: cfg.color, marginTop: 2, flexShrink: 0 }} />
                <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "monospace", flexShrink: 0, marginTop: 1, minWidth: 72 }}>
                  {formatTime(log.timestamp)}
                </span>
                <span style={{ fontSize: 9, color: cfg.color, fontWeight: 700, flexShrink: 0, marginTop: 1, minWidth: 24 }}>
                  {cfg.label}
                </span>
                <span style={{ fontSize: 9, color: "var(--accent-primary)", flexShrink: 0, marginTop: 1 }}>
                  {log.source}
                </span>
                <span style={{
                  fontSize: 11,
                  color: "var(--text-primary)",
                  fontFamily: "'JetBrains Mono', monospace",
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                  {log.message}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// === Log parser utility ===
// Strip ANSI escape codes from terminal output
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
}

// Detect log level from a line of text
function detectLevel(line: string): LogLevel {
  const upper = line.toUpperCase();

  // Error patterns
  if (/\b(FATAL|PANIC|CRITICAL)\b/.test(upper)) return "error";
  if (/\b(ERROR|ERR|FAIL(ED)?|EXCEPTION|CRASH)\b/.test(upper)) return "error";
  if (/^E\s|^E\//.test(line)) return "error"; // Android logcat style

  // Warning patterns
  if (/\b(WARN(ING)?|WRN|DEPRECAT(ED|ION))\b/.test(upper)) return "warn";
  if (/^W\s|^W\//.test(line)) return "warn";

  // Info patterns
  if (/\b(INFO|INF|NOTICE)\b/.test(upper)) return "info";
  if (/^I\s|^I\//.test(line)) return "info";

  // Debug patterns
  if (/\b(DEBUG|DBG)\b/.test(upper)) return "debug";
  if (/^D\s|^D\//.test(line)) return "debug";

  // Trace patterns
  if (/\b(TRACE|TRC|VERBOSE)\b/.test(upper)) return "trace";
  if (/^V\s|^V\//.test(line)) return "trace";

  return "output";
}

/**
 * Parse raw PTY output into debug log entries.
 * Called from TerminalPanel when data arrives.
 */
export function parseTerminalOutput(
  rawData: string,
  source: string,
  addLog: (entry: Omit<DebugLogEntry, "id" | "timestamp">) => void,
) {
  const clean = stripAnsi(rawData);
  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip pure prompt lines and very short noise
    if (/^[>$#%]\s*$/.test(trimmed)) continue;
    if (trimmed.length < 2) continue;
    // Skip common prompt patterns
    if (/^(PS\s)?[A-Z]:\\.*>$/i.test(trimmed)) continue;
    if (/^\w+@[\w.-]+[:\s~].*\$\s*$/.test(trimmed)) continue;

    const level = detectLevel(trimmed);

    // Only log meaningful entries — skip plain "output" level to avoid noise
    // Users see output in the terminal already; debug console is for errors/warnings/logs
    if (level === "output") continue;

    // Truncate very long messages to prevent memory issues
    const msg = trimmed.length > 2000 ? trimmed.slice(0, 2000) + "..." : trimmed;
    addLog({ level, message: msg, source });
  }
}
