import { useState, useEffect } from "react";
import {
  History,
  Code2,
  Eye,
  Puzzle,
  BarChart3,
  Play,
  Trash2,
  Plus,
  Search,
  Cpu,
  MemoryStick,
  Activity,
  HardDrive,
  Trophy,
  Folder,
  File,
  ArrowLeft,
  Terminal,
  Zap,
  Flame,
  Crown,
  Palette,
  Layers,
  Clock,
  Columns,
} from "lucide-react";
import { useAppStore } from "../store/appStore";
import type { SidebarTab } from "../store/appStore";

const sidebarTabs: { id: SidebarTab; icon: typeof History; label: string }[] = [
  { id: "history", icon: History, label: "History" },
  { id: "snippets", icon: Code2, label: "Snippets" },
  { id: "preview", icon: Eye, label: "Preview" },
  { id: "plugins", icon: Puzzle, label: "Plugins" },
  { id: "stats", icon: BarChart3, label: "Stats" },
];

export function Sidebar() {
  const { sidebarTab, setSidebarTab } = useAppStore();

  return (
    <div className="sidebar">
      <div className="sidebar-tabs">
        {sidebarTabs.map((tab) => (
          <button
            key={tab.id}
            className={`sidebar-tab-btn ${sidebarTab === tab.id ? "active" : ""}`}
            onClick={() => setSidebarTab(tab.id)}
            title={tab.label}
            aria-label={tab.label}
          >
            <tab.icon size={16} />
          </button>
        ))}
      </div>
      <div className="sidebar-content">
        {sidebarTab === "history" && <HistoryPanel />}
        {sidebarTab === "snippets" && <SnippetsPanel />}
        {sidebarTab === "preview" && <PreviewPanel />}
        {sidebarTab === "plugins" && <PluginsPanel />}
        {sidebarTab === "stats" && <StatsPanel />}
      </div>
    </div>
  );
}

function HistoryPanel() {
  const { history, clearHistory, executeSnippet } = useAppStore();
  const [filter, setFilter] = useState("");

  const filtered = history.filter((h) =>
    h.command.toLowerCase().includes(filter.toLowerCase())
  );

  const handleRerun = (command: string) => {
    if (executeSnippet) executeSnippet(command);
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <div style={{ flex: 1, position: "relative" }}>
          <Search size={12} style={{ position: "absolute", left: 8, top: 7, color: "var(--text-muted)" }} />
          <input
            type="text"
            placeholder="Filter history..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter command history"
            style={{
              width: "100%", padding: "6px 8px 6px 28px",
              background: "var(--bg-tertiary)", border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-sm)", color: "var(--text-primary)",
              fontSize: 12, fontFamily: "inherit", outline: "none",
            }}
          />
        </div>
        {history.length > 0 && (
          <button onClick={clearHistory} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 4 }} title="Clear history" aria-label="Clear history">
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 20, fontSize: 12 }}>
          {history.length === 0 ? "No commands yet. Start typing!" : "No matches found"}
        </div>
      ) : (
        filtered.map((entry) => (
          <div key={entry.id} className="history-item" onClick={() => handleRerun(entry.command)} title="Click to re-run">
            <span className="history-command">{entry.command}</span>
            <span className="history-time">
              {new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

function SnippetsPanel() {
  const { snippets, addSnippet, removeSnippet, executeSnippet } = useAppStore();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCmd, setNewCmd] = useState("");

  const handleAdd = () => {
    if (newName && newCmd) {
      addSnippet({ name: newName, command: newCmd });
      setNewName(""); setNewCmd(""); setAdding(false);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span className="sidebar-section-title" style={{ margin: 0 }}>Quick Commands</span>
        <button onClick={() => setAdding(!adding)} style={{ background: "none", border: "none", color: "var(--accent-primary)", cursor: "pointer", padding: 4 }} aria-label="Add snippet">
          <Plus size={14} />
        </button>
      </div>

      {adding && (
        <div style={{ padding: 10, background: "var(--bg-tertiary)", borderRadius: "var(--radius-md)", marginBottom: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          <input placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)}
            style={{ padding: "6px 8px", background: "var(--bg-primary)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: 12, fontFamily: "inherit", outline: "none" }} />
          <input placeholder="Command" value={newCmd} onChange={(e) => setNewCmd(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            style={{ padding: "6px 8px", background: "var(--bg-primary)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: 12, fontFamily: "inherit", outline: "none" }} />
          <button onClick={handleAdd} style={{ padding: "6px", background: "var(--accent-primary)", border: "none", borderRadius: "var(--radius-sm)", color: "white", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
            Add Snippet
          </button>
        </div>
      )}

      {snippets.map((snippet) => (
        <div key={snippet.id} className="snippet-card">
          <div className="snippet-icon"><Code2 size={16} /></div>
          <div className="snippet-info">
            <div className="snippet-name">{snippet.name}</div>
            <div className="snippet-cmd">{snippet.command}</div>
          </div>
          <button className="snippet-run" title={`Run: ${snippet.command}`} aria-label={`Run ${snippet.name}`}
            onClick={() => executeSnippet && executeSnippet(snippet.command)}>
            <Play size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  extension: string;
}

function PreviewPanel() {
  const { previewFile, setPreviewFile } = useAppStore();
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [currentPath, setCurrentPath] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadDirectory = async (path?: string) => {
    setLoading(true);
    setError("");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const entries = await invoke<FileEntry[]>("list_directory", { path: path || null });
      setFiles(entries);
      if (path) setCurrentPath(path);
    } catch {
      setFiles([
        { name: "Documents", path: "/home/user/Documents", is_dir: true, size: 0, extension: "" },
        { name: "Desktop", path: "/home/user/Desktop", is_dir: true, size: 0, extension: "" },
        { name: "package.json", path: "/home/user/package.json", is_dir: false, size: 1234, extension: "json" },
        { name: "README.md", path: "/home/user/README.md", is_dir: false, size: 5678, extension: "md" },
        { name: "index.ts", path: "/home/user/index.ts", is_dir: false, size: 890, extension: "ts" },
        { name: "styles.css", path: "/home/user/styles.css", is_dir: false, size: 2345, extension: "css" },
        { name: "data.csv", path: "/home/user/data.csv", is_dir: false, size: 12000, extension: "csv" },
        { name: "config.yaml", path: "/home/user/config.yaml", is_dir: false, size: 456, extension: "yaml" },
      ]);
    }
    setLoading(false);
  };

  const openFile = async (file: FileEntry) => {
    if (file.is_dir) {
      loadDirectory(file.path);
      return;
    }
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const content = await invoke<string>("read_file_preview", { path: file.path });
      setPreviewFile({ name: file.name, content, extension: file.extension });
    } catch {
      const demoContent: Record<string, string> = {
        json: '{\n  "name": "novaterm",\n  "version": "1.0.0",\n  "description": "Professional Terminal"\n}',
        md: "# NovaTerm\n\n> Professional Terminal Emulator\n\n## Features\n- Multi-shell support\n- 4 themes\n- Split panes\n- Autocomplete",
        ts: 'import { useState } from "react";\n\nexport function App() {\n  const [count, setCount] = useState(0);\n  return <div>{count}</div>;\n}',
        css: ":root {\n  --bg-primary: #0d1117;\n  --text-primary: #e6edf3;\n  --accent: #58a6ff;\n}",
        csv: "Name,Age,City\nAlice,30,NYC\nBob,25,London\nCarla,28,Tokyo",
        yaml: "app:\n  name: NovaTerm\n  version: 1.0.0\n  theme: dark\n  plugins:\n    - git\n    - docker",
      };
      setPreviewFile({
        name: file.name,
        content: demoContent[file.extension] || `# Content of ${file.name}\n(Preview not available in demo mode)`,
        extension: file.extension,
      });
    }
  };

  const goUp = () => {
    const parent = currentPath.replace(/[/\\][^/\\]*$/, "");
    if (parent && parent !== currentPath) {
      loadDirectory(parent);
    }
  };

  useEffect(() => {
    loadDirectory();
  }, []);

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getExtColor = (ext: string) => {
    const colors: Record<string, string> = {
      js: "#f7df1e", ts: "#3178c6", tsx: "#3178c6", jsx: "#61dafb",
      json: "#a8b1ff", md: "#519aba", css: "#563d7c", html: "#e34f26",
      py: "#3572A5", rs: "#dea584", go: "#00ADD8", java: "#b07219",
      yaml: "#cb171e", yml: "#cb171e", toml: "#9c4221", csv: "#237346",
      txt: "var(--text-muted)", log: "var(--accent-warning)",
    };
    return colors[ext] || "var(--text-secondary)";
  };

  if (previewFile) {
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <button onClick={() => setPreviewFile(null)} style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: 2, display: "flex" }} aria-label="Back to files">
            <ArrowLeft size={14} />
          </button>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {previewFile.name}
          </span>
          <span style={{ fontSize: 10, color: getExtColor(previewFile.extension), fontWeight: 600, textTransform: "uppercase" }}>
            {previewFile.extension}
          </span>
        </div>
        <pre style={{
          padding: 12, background: "var(--bg-tertiary)", border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)", fontSize: 11, lineHeight: 1.5,
          color: "var(--text-primary)", overflow: "auto", maxHeight: "calc(100vh - 200px)",
          whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "inherit",
        }}>
          {previewFile.content}
        </pre>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span className="sidebar-section-title" style={{ margin: 0, flex: 1 }}>File Browser</span>
        {currentPath && (
          <button onClick={goUp} style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: 2, display: "flex" }} aria-label="Go up">
            <ArrowLeft size={14} />
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 20, fontSize: 12 }}>Loading...</div>
      ) : error ? (
        <div style={{ textAlign: "center", color: "var(--accent-error)", padding: 20, fontSize: 12 }}>{error}</div>
      ) : (
        files.map((file) => (
          <div key={file.path} className="history-item" onClick={() => openFile(file)} style={{ cursor: "pointer" }}>
            {file.is_dir ? (
              <Folder size={14} style={{ color: "var(--accent-primary)", flexShrink: 0 }} />
            ) : (
              <File size={14} style={{ color: getExtColor(file.extension), flexShrink: 0 }} />
            )}
            <span className="history-command" style={{ flex: 1 }}>{file.name}</span>
            <span className="history-time">{formatSize(file.size)}</span>
          </div>
        ))
      )}
    </div>
  );
}

function PluginsPanel() {
  const { plugins, togglePlugin } = useAppStore();

  return (
    <div>
      <span className="sidebar-section-title">Extensions</span>
      {plugins.map((plugin) => (
        <div key={plugin.id} className="plugin-card">
          <div className="plugin-header">
            <span className="plugin-name">{plugin.name}</span>
            <button className={`plugin-toggle ${plugin.enabled ? "active" : ""}`} onClick={() => togglePlugin(plugin.id)} aria-label={`${plugin.enabled ? "Disable" : "Enable"} ${plugin.name}`} />
          </div>
          <div className="plugin-desc">{plugin.desc}</div>
        </div>
      ))}
    </div>
  );
}

const achievementIcons: Record<string, typeof Terminal> = {
  terminal: Terminal, zap: Zap, flame: Flame, crown: Crown,
  palette: Palette, code: Code2, layers: Layers, eye: Eye,
  clock: Clock, columns: Columns,
};

function StatsPanel() {
  const { systemStats, sessionStartTime, commandCount, errorCount, achievements, checkAchievements } = useAppStore();
  const [sessionTime, setSessionTime] = useState("0m");

  useEffect(() => {
    const updateTime = () => {
      const elapsed = Math.floor((Date.now() - sessionStartTime) / 1000);
      if (elapsed < 60) setSessionTime(`${elapsed}s`);
      else if (elapsed < 3600) setSessionTime(`${Math.floor(elapsed / 60)}m`);
      else {
        const h = Math.floor(elapsed / 3600);
        const m = Math.floor((elapsed % 3600) / 60);
        setSessionTime(`${h}h ${m}m`);
      }
    };
    updateTime();
    const interval = setInterval(() => { updateTime(); checkAchievements(); }, 10000);
    return () => clearInterval(interval);
  }, [sessionStartTime, checkAchievements]);

  const stats = systemStats || { cpu: 23, memoryUsed: 8_500_000_000, memoryTotal: 16_000_000_000, memoryPercent: 53, processes: 142 };
  const formatBytes = (bytes: number) => `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;

  const unlockedCount = achievements.filter((a) => a.unlocked).length;

  return (
    <div>
      <span className="sidebar-section-title">System Monitor</span>
      <div className="stats-grid">
        <div className="stat-card">
          <Cpu size={16} style={{ color: "var(--accent-primary)", marginBottom: 6 }} />
          <div className="stat-value">{stats.cpu.toFixed(0)}%</div>
          <div className="stat-label">CPU</div>
          <div className="stat-bar"><div className="stat-bar-fill" style={{ width: `${Math.min(stats.cpu, 100)}%` }} /></div>
        </div>
        <div className="stat-card">
          <MemoryStick size={16} style={{ color: "var(--accent-purple)", marginBottom: 6 }} />
          <div className="stat-value">{stats.memoryPercent.toFixed(0)}%</div>
          <div className="stat-label">Memory</div>
          <div className="stat-bar"><div className="stat-bar-fill" style={{ width: `${Math.min(stats.memoryPercent, 100)}%` }} /></div>
        </div>
        <div className="stat-card">
          <Activity size={16} style={{ color: "var(--accent-secondary)", marginBottom: 6 }} />
          <div className="stat-value">{stats.processes}</div>
          <div className="stat-label">Processes</div>
        </div>
        <div className="stat-card">
          <HardDrive size={16} style={{ color: "var(--accent-warning)", marginBottom: 6 }} />
          <div className="stat-value">{formatBytes(stats.memoryUsed)}</div>
          <div className="stat-label">RAM Used</div>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <span className="sidebar-section-title">Session Stats</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          {[
            { label: "Commands Run", value: String(commandCount), color: "var(--text-primary)" },
            { label: "Session Time", value: sessionTime, color: "var(--text-primary)" },
            { label: "Errors", value: String(errorCount), color: errorCount > 0 ? "var(--accent-error)" : "var(--text-primary)" },
          ].map((item) => (
            <div key={item.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "8px 10px", background: "var(--bg-tertiary)", borderRadius: "var(--radius-sm)" }}>
              <span style={{ color: "var(--text-secondary)" }}>{item.label}</span>
              <span style={{ color: item.color, fontWeight: 600 }}>{item.value}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span className="sidebar-section-title" style={{ margin: 0 }}>Achievements</span>
          <span style={{ fontSize: 11, color: "var(--accent-primary)", fontWeight: 600 }}>
            {unlockedCount}/{achievements.length}
          </span>
        </div>

        <div className="stat-bar" style={{ marginBottom: 12 }}>
          <div className="stat-bar-fill" style={{ width: `${(unlockedCount / achievements.length) * 100}%` }} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {achievements.map((achievement) => {
            const Icon = achievementIcons[achievement.icon] || Trophy;
            return (
              <div
                key={achievement.id}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 10px",
                  background: achievement.unlocked ? "var(--bg-hover)" : "var(--bg-tertiary)",
                  border: `1px solid ${achievement.unlocked ? "var(--accent-primary)" : "var(--border-subtle)"}`,
                  borderRadius: "var(--radius-sm)",
                  opacity: achievement.unlocked ? 1 : 0.5,
                  transition: "all 0.3s ease",
                }}
              >
                <div style={{
                  width: 28, height: 28, borderRadius: "var(--radius-sm)",
                  background: achievement.unlocked ? "var(--accent-primary)" : "var(--bg-active)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: achievement.unlocked ? "white" : "var(--text-muted)",
                  flexShrink: 0,
                }}>
                  <Icon size={14} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: achievement.unlocked ? "var(--text-primary)" : "var(--text-muted)" }}>
                    {achievement.name}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {achievement.description}
                  </div>
                </div>
                {achievement.unlocked && (
                  <Trophy size={12} style={{ color: "var(--accent-warning)", flexShrink: 0 }} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
