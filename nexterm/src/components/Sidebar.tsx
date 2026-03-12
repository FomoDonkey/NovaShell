import { useState, useEffect, useRef, useCallback } from "react";
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
  Folder,
  FolderOpen,
  FolderPlus,
  File,
  ArrowLeft,
  Monitor,
  Bug,
  GripVertical,
  ChevronRight,
  ChevronDown,
  Edit3,
  X,
} from "lucide-react";
import { useAppStore } from "../store/appStore";
import type { SidebarTab } from "../store/appStore";
import { SSHPanel } from "./SSHPanel";
import { DebugPanel } from "./DebugPanel";

const sidebarTabs: { id: SidebarTab; icon: typeof History; label: string }[] = [
  { id: "history", icon: History, label: "History" },
  { id: "snippets", icon: Code2, label: "Snippets" },
  { id: "preview", icon: Eye, label: "Preview" },
  { id: "plugins", icon: Puzzle, label: "Plugins" },
  { id: "stats", icon: BarChart3, label: "Stats" },
  { id: "ssh", icon: Monitor, label: "SSH" },
  { id: "debug", icon: Bug, label: "Debug" },
];

export function Sidebar() {
  const sidebarTab = useAppStore((s) => s.sidebarTab);
  const setSidebarTab = useAppStore((s) => s.setSidebarTab);

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
        {sidebarTab === "ssh" && <SSHPanel />}
        {sidebarTab === "debug" && <DebugPanel />}
      </div>
    </div>
  );
}

function HistoryPanel() {
  const history = useAppStore((s) => s.history);
  const clearHistory = useAppStore((s) => s.clearHistory);
  const executeSnippet = useAppStore((s) => s.executeSnippet);
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

const FOLDER_COLORS = ["#58a6ff", "#f78166", "#3fb950", "#d29922", "#bc8cff", "#ff7b72", "#79c0ff", "#7ee787"];

function SnippetsPanel() {
  const snippets = useAppStore((s) => s.snippets);
  const addSnippet = useAppStore((s) => s.addSnippet);
  const removeSnippet = useAppStore((s) => s.removeSnippet);
  const executeSnippet = useAppStore((s) => s.executeSnippet);
  const moveSnippetToFolder = useAppStore((s) => s.moveSnippetToFolder);
  const folders = useAppStore((s) => s.snippetFolders);
  const addFolder = useAppStore((s) => s.addSnippetFolder);
  const removeFolder = useAppStore((s) => s.removeSnippetFolder);
  const renameFolder = useAppStore((s) => s.renameSnippetFolder);

  const [adding, setAdding] = useState(false);
  const [addToFolder, setAddToFolder] = useState<string | undefined>(undefined);
  const [newName, setNewName] = useState("");
  const [newCmd, setNewCmd] = useState("");
  const [newRunMode, setNewRunMode] = useState<"stop-on-error" | "run-all">("stop-on-error");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCmd, setEditCmd] = useState("");
  const [editRunMode, setEditRunMode] = useState<"stop-on-error" | "run-all">("stop-on-error");
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [addingFolder, setAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editFolderName, setEditFolderName] = useState("");
  const [dragSnippetId, setDragSnippetId] = useState<string | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const pendingDragId = useRef<string | null>(null);

  const handleAdd = () => {
    if (newName && newCmd) {
      addSnippet({ name: newName, command: newCmd, runMode: newRunMode, folderId: addToFolder });
      setNewName(""); setNewCmd(""); setNewRunMode("stop-on-error"); setAdding(false); setAddToFolder(undefined);
    }
  };

  const startEdit = (snippet: { id: string; name: string; command: string; runMode?: "stop-on-error" | "run-all" }) => {
    setEditingId(snippet.id);
    setEditName(snippet.name);
    setEditCmd(snippet.command);
    setEditRunMode(snippet.runMode || "stop-on-error");
  };

  const saveEdit = () => {
    if (editingId && editName && editCmd) {
      const { snippets: current } = useAppStore.getState();
      useAppStore.setState({
        snippets: current.map((s) => s.id === editingId ? { ...s, name: editName, command: editCmd, runMode: editRunMode } : s),
      });
      setEditingId(null);
    }
  };

  const handleAddFolder = () => {
    if (newFolderName.trim()) {
      const color = FOLDER_COLORS[folders.length % FOLDER_COLORS.length];
      addFolder(newFolderName.trim(), color);
      setNewFolderName("");
      setAddingFolder(false);
    }
  };

  const toggleFolder = (id: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Mouse-based drag (more reliable than HTML5 DnD in WebView2/Tauri)
  const handleMouseDown = (e: React.MouseEvent, snippetId: string) => {
    // Only left click, ignore if clicking buttons
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button")) return;
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    pendingDragId.current = snippetId;
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartPos.current || !pendingDragId.current) return;
      const dx = Math.abs(e.clientX - dragStartPos.current.x);
      const dy = Math.abs(e.clientY - dragStartPos.current.y);
      // Start drag after 5px movement threshold
      if (dx > 5 || dy > 5) {
        setDragSnippetId(pendingDragId.current);
        setIsDragging(true);
        dragStartPos.current = null;
      }
    };

    const handleMouseUp = () => {
      if (isDragging && dragSnippetId && dragOverFolder !== null) {
        moveSnippetToFolder(dragSnippetId, dragOverFolder === "root" ? undefined : dragOverFolder);
      }
      setDragSnippetId(null);
      setDragOverFolder(null);
      setIsDragging(false);
      dragStartPos.current = null;
      pendingDragId.current = null;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, dragSnippetId, dragOverFolder, moveSnippetToFolder]);

  const handleFolderMouseEnter = (folderId: string | null) => {
    if (isDragging) {
      setDragOverFolder(folderId);
    }
  };

  const handleFolderMouseLeave = () => {
    if (isDragging) {
      setDragOverFolder(null);
    }
  };

  const getCommandCount = (cmd: string) => cmd.split("\n").filter((l) => l.trim().length > 0).length;

  const inputBase: React.CSSProperties = {
    padding: "6px 8px",
    background: "var(--bg-primary)",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-sm)",
    color: "var(--text-primary)",
    fontSize: 12,
    fontFamily: "inherit",
    outline: "none",
    width: "100%",
  };

  const rootSnippets = snippets.filter((s) => !s.folderId);

  const renderSnippetCard = (snippet: typeof snippets[0]) => {
    const cmdCount = getCommandCount(snippet.command);
    const isMulti = cmdCount > 1;
    const isExpanded = expandedId === snippet.id;
    const isEditing = editingId === snippet.id;
    const lines = snippet.command.split("\n").filter((l) => l.trim());

    if (isEditing) {
      return (
        <div key={snippet.id} style={{ padding: 10, background: "var(--bg-tertiary)", borderRadius: "var(--radius-md)", marginBottom: 6, display: "flex", flexDirection: "column", gap: 6, border: "1px solid var(--accent-primary)" }}>
          <input value={editName} onChange={(e) => setEditName(e.target.value)} style={inputBase} />
          <textarea value={editCmd} onChange={(e) => setEditCmd(e.target.value)} rows={Math.max(3, lines.length + 1)} style={{ ...inputBase, resize: "vertical", minHeight: 60, lineHeight: 1.5 }} />
          {getCommandCount(editCmd) > 1 && (
            <div style={{ display: "flex", gap: 4 }}>
              <button onClick={() => setEditRunMode("stop-on-error")} style={{ flex: 1, padding: "4px", border: "none", borderRadius: "var(--radius-sm)", background: editRunMode === "stop-on-error" ? "var(--accent-primary)" : "var(--bg-active)", color: editRunMode === "stop-on-error" ? "white" : "var(--text-muted)", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>Stop on error (&&)</button>
              <button onClick={() => setEditRunMode("run-all")} style={{ flex: 1, padding: "4px", border: "none", borderRadius: "var(--radius-sm)", background: editRunMode === "run-all" ? "var(--accent-warning)" : "var(--bg-active)", color: editRunMode === "run-all" ? "white" : "var(--text-muted)", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>Run all (;)</button>
            </div>
          )}
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={saveEdit} style={{ flex: 1, padding: "5px", background: "var(--accent-primary)", border: "none", borderRadius: "var(--radius-sm)", color: "white", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>Save</button>
            <button onClick={() => setEditingId(null)} style={{ padding: "5px 8px", background: "var(--bg-active)", border: "none", borderRadius: "var(--radius-sm)", color: "var(--text-secondary)", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
          </div>
        </div>
      );
    }

    return (
      <div
        key={snippet.id}
        className="snippet-card"
        style={{
          flexDirection: "column",
          alignItems: "stretch",
          gap: 0,
          cursor: isDragging && dragSnippetId === snippet.id ? "grabbing" : "grab",
          opacity: isDragging && dragSnippetId === snippet.id ? 0.5 : 1,
          transition: "opacity 0.15s ease",
        }}
        onMouseDown={(e) => handleMouseDown(e, snippet.id)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <GripVertical size={12} style={{ color: "var(--text-muted)", opacity: 0.4, flexShrink: 0 }} />
          <div className="snippet-info" style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div className="snippet-name">{snippet.name}</div>
              {isMulti && (
                <>
                  <span style={{ fontSize: 9, background: "var(--accent-primary)", color: "white", padding: "0 5px", borderRadius: 8, fontWeight: 700, lineHeight: "16px", flexShrink: 0 }}>{cmdCount} cmds</span>
                  <span style={{ fontSize: 9, background: snippet.runMode === "run-all" ? "var(--accent-warning)" : "var(--accent-secondary)", color: "white", padding: "0 4px", borderRadius: 8, fontWeight: 700, lineHeight: "16px", flexShrink: 0 }}>{snippet.runMode === "run-all" ? ";" : "&&"}</span>
                </>
              )}
            </div>
            <div className="snippet-cmd" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{isMulti ? lines[0] + (lines.length > 1 ? ` (+${lines.length - 1} more)` : "") : snippet.command}</div>
          </div>
          <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
            {isMulti && (
              <button onClick={() => setExpandedId(isExpanded ? null : snippet.id)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 2, display: "flex" }} title="View sequence">
                {isExpanded ? <Activity size={13} /> : <Eye size={13} />}
              </button>
            )}
            <button onClick={() => startEdit(snippet)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 2, display: "flex" }} title="Edit"><Edit3 size={13} /></button>
            <button onClick={() => removeSnippet(snippet.id)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 2, display: "flex" }} title="Delete"><Trash2 size={13} /></button>
            <button className="snippet-run" title={`Run${isMulti ? " sequence" : ""}: ${snippet.name}`} aria-label={`Run ${snippet.name}`} onClick={() => executeSnippet && executeSnippet(snippet.command, snippet.runMode)}><Play size={14} /></button>
          </div>
        </div>
        {isExpanded && isMulti && (
          <div style={{ marginTop: 8, padding: "6px 8px", background: "var(--bg-primary)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
            {lines.map((line, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0", borderBottom: i < lines.length - 1 ? "1px solid var(--border-subtle)" : "none" }}>
                <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "monospace", minWidth: 16, textAlign: "right" }}>{i + 1}</span>
                <span style={{ fontSize: 11, color: "var(--text-primary)", fontFamily: "'JetBrains Mono', monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{line}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderAddForm = () => {
    if (!adding) return null;
    return (
      <div style={{ padding: 10, background: "var(--bg-tertiary)", borderRadius: "var(--radius-md)", marginBottom: 10, display: "flex", flexDirection: "column", gap: 6 }}>
        <input placeholder="Name (e.g. Deploy Script)" value={newName} onChange={(e) => setNewName(e.target.value)} style={inputBase} />
        <textarea placeholder={"Command or sequence (one per line):\ngit add .\ngit commit -m \"deploy\"\ngit push origin main"} value={newCmd} onChange={(e) => setNewCmd(e.target.value)} rows={3} style={{ ...inputBase, resize: "vertical", minHeight: 60, lineHeight: 1.5 }} />
        <div style={{ fontSize: 10, color: "var(--text-muted)", display: "flex", justifyContent: "space-between" }}>
          <span>One command per line for sequences</span>
          {newCmd && <span>{getCommandCount(newCmd)} cmd{getCommandCount(newCmd) !== 1 ? "s" : ""}</span>}
        </div>
        {folders.length > 0 && (
          <select
            value={addToFolder || ""}
            onChange={(e) => setAddToFolder(e.target.value || undefined)}
            style={{ ...inputBase, cursor: "pointer" }}
          >
            <option value="">No folder (root)</option>
            {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        )}
        {getCommandCount(newCmd) > 1 && (
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={() => setNewRunMode("stop-on-error")} style={{ flex: 1, padding: "4px", border: "none", borderRadius: "var(--radius-sm)", background: newRunMode === "stop-on-error" ? "var(--accent-primary)" : "var(--bg-active)", color: newRunMode === "stop-on-error" ? "white" : "var(--text-muted)", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>Stop on error (&&)</button>
            <button onClick={() => setNewRunMode("run-all")} style={{ flex: 1, padding: "4px", border: "none", borderRadius: "var(--radius-sm)", background: newRunMode === "run-all" ? "var(--accent-warning)" : "var(--bg-active)", color: newRunMode === "run-all" ? "white" : "var(--text-muted)", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>Run all (;)</button>
          </div>
        )}
        <button onClick={handleAdd} disabled={!newName || !newCmd} style={{ padding: "6px", background: !newName || !newCmd ? "var(--bg-active)" : "var(--accent-primary)", border: "none", borderRadius: "var(--radius-sm)", color: !newName || !newCmd ? "var(--text-muted)" : "white", fontSize: 12, cursor: !newName || !newCmd ? "default" : "pointer", fontFamily: "inherit" }}>Add Snippet</button>
      </div>
    );
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span className="sidebar-section-title" style={{ margin: 0 }}>Quick Commands</span>
        <div style={{ display: "flex", gap: 2 }}>
          <button onClick={() => { setAddingFolder(true); setAdding(false); }} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 4 }} title="New folder" aria-label="New folder">
            <FolderPlus size={14} />
          </button>
          <button onClick={() => { setAdding(!adding); setEditingId(null); setAddingFolder(false); }} style={{ background: "none", border: "none", color: "var(--accent-primary)", cursor: "pointer", padding: 4 }} aria-label="Add snippet">
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* Drag indicator */}
      {isDragging && dragSnippetId && (
        <div style={{
          padding: "6px 10px",
          marginBottom: 8,
          background: "rgba(88,166,255,0.1)",
          border: "1px dashed var(--accent-primary)",
          borderRadius: "var(--radius-sm)",
          fontSize: 11,
          color: "var(--accent-primary)",
          textAlign: "center",
          fontWeight: 500,
        }}>
          Drop on a folder to move "{snippets.find((s) => s.id === dragSnippetId)?.name}"
        </div>
      )}

      {/* Add folder form */}
      {addingFolder && (
        <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
          <input
            placeholder="Folder name..."
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddFolder()}
            autoFocus
            style={{ ...inputBase, flex: 1 }}
          />
          <button onClick={handleAddFolder} disabled={!newFolderName.trim()} style={{ padding: "4px 8px", background: newFolderName.trim() ? "var(--accent-primary)" : "var(--bg-active)", border: "none", borderRadius: "var(--radius-sm)", color: newFolderName.trim() ? "white" : "var(--text-muted)", fontSize: 11, cursor: newFolderName.trim() ? "pointer" : "default", fontFamily: "inherit" }}>Add</button>
          <button onClick={() => { setAddingFolder(false); setNewFolderName(""); }} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 2, display: "flex", alignItems: "center" }}><X size={14} /></button>
        </div>
      )}

      {/* Add snippet form */}
      {renderAddForm()}

      {/* Folders */}
      {folders.map((folder) => {
        const folderSnippets = snippets.filter((s) => s.folderId === folder.id);
        const isCollapsed = collapsedFolders.has(folder.id);
        const isDragOver = dragOverFolder === folder.id;
        const isEditingFolder = editingFolderId === folder.id;

        return (
          <div
            key={folder.id}
            style={{ marginBottom: 6 }}
            onMouseEnter={() => handleFolderMouseEnter(folder.id)}
            onMouseLeave={handleFolderMouseLeave}
          >
            {/* Folder header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 8px",
                background: isDragOver ? "rgba(88,166,255,0.15)" : "var(--bg-tertiary)",
                border: isDragOver ? "1px dashed var(--accent-primary)" : "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-sm)",
                cursor: "pointer",
                transition: "var(--transition-fast)",
              }}
              onClick={() => !isEditingFolder && toggleFolder(folder.id)}
            >
              {isCollapsed
                ? <ChevronRight size={12} style={{ color: folder.color, flexShrink: 0 }} />
                : <ChevronDown size={12} style={{ color: folder.color, flexShrink: 0 }} />
              }
              {isCollapsed
                ? <Folder size={14} style={{ color: folder.color, flexShrink: 0 }} />
                : <FolderOpen size={14} style={{ color: folder.color, flexShrink: 0 }} />
              }
              {isEditingFolder ? (
                <input
                  value={editFolderName}
                  onChange={(e) => setEditFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && editFolderName.trim()) { renameFolder(folder.id, editFolderName.trim()); setEditingFolderId(null); }
                    if (e.key === "Escape") setEditingFolderId(null);
                  }}
                  onBlur={() => { if (editFolderName.trim()) renameFolder(folder.id, editFolderName.trim()); setEditingFolderId(null); }}
                  onClick={(e) => e.stopPropagation()}
                  autoFocus
                  style={{ ...inputBase, padding: "2px 4px", fontSize: 11, flex: 1 }}
                />
              ) : (
                <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{folder.name}</span>
              )}
              <span style={{ fontSize: 9, color: "var(--text-muted)", flexShrink: 0 }}>{folderSnippets.length}</span>
              <button
                onClick={(e) => { e.stopPropagation(); setAddToFolder(folder.id); setAdding(true); setAddingFolder(false); if (collapsedFolders.has(folder.id)) toggleFolder(folder.id); }}
                style={{ background: "none", border: "none", color: "var(--accent-primary)", cursor: "pointer", padding: 2, display: "flex" }}
                title="Add snippet to folder"
              ><Plus size={10} /></button>
              <button
                onClick={(e) => { e.stopPropagation(); setEditingFolderId(folder.id); setEditFolderName(folder.name); }}
                style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 2, display: "flex" }}
                title="Rename folder"
              ><Edit3 size={10} /></button>
              <button
                onClick={(e) => { e.stopPropagation(); removeFolder(folder.id); }}
                style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 2, display: "flex" }}
                title="Delete folder"
              ><Trash2 size={10} /></button>
            </div>
            {/* Folder contents */}
            {!isCollapsed && (
              <div style={{ paddingLeft: 12, borderLeft: `2px solid ${folder.color}`, marginLeft: 10, marginTop: 4 }}>
                {folderSnippets.length === 0 ? (
                  <div style={{ padding: "8px 0", fontSize: 10, color: "var(--text-muted)", textAlign: "center" }}>
                    Drag snippets here
                  </div>
                ) : (
                  folderSnippets.map(renderSnippetCard)
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Root snippets (no folder) */}
      <div
        onMouseEnter={() => handleFolderMouseEnter("root")}
        onMouseLeave={handleFolderMouseLeave}
        style={{
          borderRadius: "var(--radius-sm)",
          border: dragOverFolder === "root" ? "1px dashed var(--accent-primary)" : "1px solid transparent",
          background: dragOverFolder === "root" ? "rgba(88,166,255,0.08)" : "transparent",
          transition: "var(--transition-fast)",
          minHeight: rootSnippets.length === 0 && folders.length > 0 ? 32 : undefined,
        }}
      >
        {rootSnippets.map(renderSnippetCard)}
        {rootSnippets.length === 0 && folders.length > 0 && (
          <div style={{ padding: "8px 0", fontSize: 10, color: "var(--text-muted)", textAlign: "center" }}>
            Unsorted commands
          </div>
        )}
      </div>
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
  const previewFile = useAppStore((s) => s.previewFile);
  const setPreviewFile = useAppStore((s) => s.setPreviewFile);
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
        json: '{\n  "name": "novashell",\n  "version": "1.0.0",\n  "description": "Professional Terminal"\n}',
        md: "# NovaShell\n\n> Professional Terminal Emulator\n\n## Features\n- Multi-shell support\n- 4 themes\n- Split panes\n- Autocomplete",
        ts: 'import { useState } from "react";\n\nexport function App() {\n  const [count, setCount] = useState(0);\n  return <div>{count}</div>;\n}',
        css: ":root {\n  --bg-primary: #0d1117;\n  --text-primary: #e6edf3;\n  --accent: #58a6ff;\n}",
        csv: "Name,Age,City\nAlice,30,NYC\nBob,25,London\nCarla,28,Tokyo",
        yaml: "app:\n  name: NovaShell\n  version: 1.0.0\n  theme: dark\n  plugins:\n    - git\n    - docker",
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
  const plugins = useAppStore((s) => s.plugins);
  const togglePlugin = useAppStore((s) => s.togglePlugin);
  const [pluginData, setPluginData] = useState<Record<string, { loading: boolean; data: string | null; error: string | null }>>({});

  const runCommand = useCallback(async (command: string, args: string[]): Promise<string> => {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("run_command_output", { command, args });
  }, []);

  const fetchPluginData = useCallback(async (pluginId: string) => {
    setPluginData((prev) => ({ ...prev, [pluginId]: { loading: true, data: null, error: null } }));
    try {
      let result = "";
      switch (pluginId) {
        case "git": {
          const [branch, status, log] = await Promise.allSettled([
            runCommand("git", ["branch", "--show-current"]),
            runCommand("git", ["status", "--short"]),
            runCommand("git", ["log", "--oneline", "-5"]),
          ]);
          const branchStr = branch.status === "fulfilled" ? branch.value.trim() : "N/A";
          const statusStr = status.status === "fulfilled" ? status.value.trim() : "";
          const logStr = log.status === "fulfilled" ? log.value.trim() : "";
          const changedFiles = statusStr ? statusStr.split("\n").length : 0;
          result = `Branch: ${branchStr}\nChanged files: ${changedFiles}`;
          if (statusStr) result += `\n\n--- Status ---\n${statusStr}`;
          if (logStr) result += `\n\n--- Recent commits ---\n${logStr}`;
          break;
        }
        case "docker": {
          const [ps, images] = await Promise.allSettled([
            runCommand("docker", ["ps", "--format", "table {{.Names}}\t{{.Status}}\t{{.Image}}"]),
            runCommand("docker", ["images", "--format", "table {{.Repository}}\t{{.Tag}}\t{{.Size}}"]),
          ]);
          const psStr = ps.status === "fulfilled" ? ps.value.trim() : "Docker not running or not installed";
          const imgStr = images.status === "fulfilled" ? images.value.trim() : "";
          result = `--- Containers ---\n${psStr}`;
          if (imgStr) result += `\n\n--- Images ---\n${imgStr}`;
          break;
        }
        case "node": {
          const [nodeV, npmV, pkgJson] = await Promise.allSettled([
            runCommand("node", ["--version"]),
            runCommand("npm", ["--version"]),
            runCommand("node", ["-e", "try{const p=require('./package.json');console.log('Name: '+p.name+'\\nVersion: '+p.version+'\\n\\nScripts:\\n'+Object.keys(p.scripts||{}).map(k=>'  '+k+': '+p.scripts[k]).join('\\n'))}catch{console.log('No package.json found')}"]),
          ]);
          const nodeStr = nodeV.status === "fulfilled" ? `Node: ${nodeV.value.trim()}` : "Node.js not installed";
          const npmStr = npmV.status === "fulfilled" ? `NPM: ${npmV.value.trim()}` : "";
          const pkgStr = pkgJson.status === "fulfilled" ? pkgJson.value.trim() : "";
          result = nodeStr;
          if (npmStr) result += `\n${npmStr}`;
          if (pkgStr) result += `\n\n${pkgStr}`;
          break;
        }
        case "python": {
          const [pyV, pipV, venv] = await Promise.allSettled([
            runCommand("python", ["--version"]),
            runCommand("pip", ["--version"]),
            runCommand("python", ["-c", "import sys; print('Prefix:', sys.prefix); print('Exec:', sys.executable); print('Platform:', sys.platform)"]),
          ]);
          const pyStr = pyV.status === "fulfilled" ? pyV.value.trim() : "Python not installed";
          const pipStr = pipV.status === "fulfilled" ? pipV.value.trim().split(" ").slice(0, 2).join(" ") : "";
          const venvStr = venv.status === "fulfilled" ? venv.value.trim() : "";
          result = pyStr;
          if (pipStr) result += `\n${pipStr}`;
          if (venvStr) result += `\n\n${venvStr}`;
          break;
        }
        case "system": {
          const isWin = navigator.platform.startsWith("Win");
          if (isWin) {
            const [hostname, uptime, netstat] = await Promise.allSettled([
              runCommand("hostname", []),
              runCommand("powershell", ["-Command", "[math]::Round((Get-Date).Subtract((Get-CimInstance Win32_OperatingSystem).LastBootUpTime).TotalHours, 1).ToString() + ' hours'"]),
              runCommand("powershell", ["-Command", "Get-NetAdapter | Where-Object {$_.Status -eq 'Up'} | Select-Object -First 3 Name, LinkSpeed | Format-Table -AutoSize | Out-String"]),
            ]);
            const hostStr = hostname.status === "fulfilled" ? `Hostname: ${hostname.value.trim()}` : "";
            const uptimeStr = uptime.status === "fulfilled" ? `Uptime: ${uptime.value.trim()}` : "";
            const netStr = netstat.status === "fulfilled" ? netstat.value.trim() : "";
            result = [hostStr, uptimeStr].filter(Boolean).join("\n");
            if (netStr) result += `\n\n--- Network ---\n${netStr}`;
          } else {
            const [hostname, uptime] = await Promise.allSettled([
              runCommand("hostname", []),
              runCommand("uptime", []),
            ]);
            result = [
              hostname.status === "fulfilled" ? `Hostname: ${hostname.value.trim()}` : "",
              uptime.status === "fulfilled" ? `Uptime: ${uptime.value.trim()}` : "",
            ].filter(Boolean).join("\n");
          }
          break;
        }
      }
      setPluginData((prev) => ({ ...prev, [pluginId]: { loading: false, data: result, error: null } }));
    } catch (e) {
      setPluginData((prev) => ({ ...prev, [pluginId]: { loading: false, data: null, error: String(e) } }));
    }
  }, [runCommand]);

  // Fetch data for enabled plugins on mount and when toggled
  useEffect(() => {
    plugins.forEach((p) => {
      if (p.enabled && !pluginData[p.id]) {
        fetchPluginData(p.id);
      }
    });
  }, [plugins, fetchPluginData]);

  const handleToggle = (id: string) => {
    const plugin = plugins.find((p) => p.id === id);
    togglePlugin(id);
    if (plugin && !plugin.enabled) {
      // Was disabled, now enabling — fetch data
      fetchPluginData(id);
    } else {
      // Disabling — clear data
      setPluginData((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  return (
    <div>
      <span className="sidebar-section-title">Extensions</span>
      <p style={{ fontSize: 10, color: "var(--text-muted)", margin: "0 0 10px 0" }}>
        Enable extensions to see live data from your system tools.
      </p>
      {plugins.map((plugin) => {
        const data = pluginData[plugin.id];
        return (
          <div key={plugin.id} className="plugin-card" style={{ marginBottom: 8 }}>
            <div className="plugin-header">
              <span className="plugin-name">{plugin.name}</span>
              <button
                className={`plugin-toggle ${plugin.enabled ? "active" : ""}`}
                onClick={() => handleToggle(plugin.id)}
                aria-label={`${plugin.enabled ? "Disable" : "Enable"} ${plugin.name}`}
              />
            </div>
            <div className="plugin-desc">{plugin.desc}</div>
            {plugin.enabled && data && (
              <div style={{ marginTop: 8 }}>
                {data.loading && (
                  <div style={{ fontSize: 10, color: "var(--text-muted)", padding: "4px 0" }}>Loading...</div>
                )}
                {data.error && (
                  <div style={{ fontSize: 10, color: "var(--accent-error)", padding: "4px 0", wordBreak: "break-word" }}>{data.error}</div>
                )}
                {data.data && (
                  <pre style={{
                    fontSize: 10,
                    lineHeight: 1.5,
                    color: "var(--text-secondary)",
                    background: "var(--bg-primary)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "var(--radius-sm)",
                    padding: "6px 8px",
                    margin: 0,
                    overflow: "auto",
                    maxHeight: 200,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontFamily: "inherit",
                  }}>{data.data}</pre>
                )}
                <button
                  onClick={() => fetchPluginData(plugin.id)}
                  style={{
                    marginTop: 4,
                    padding: "3px 8px",
                    background: "var(--bg-tertiary)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "var(--radius-sm)",
                    color: "var(--text-muted)",
                    fontSize: 10,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >Refresh</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StatsPanel() {
  const systemStats = useAppStore((s) => s.systemStats);
  const sessionStartTime = useAppStore((s) => s.sessionStartTime);
  const commandCount = useAppStore((s) => s.commandCount);
  const errorCount = useAppStore((s) => s.errorCount);
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
    const interval = setInterval(updateTime, 30000);
    return () => clearInterval(interval);
  }, [sessionStartTime]);

  const stats = systemStats || { cpu: 23, memoryUsed: 8_500_000_000, memoryTotal: 16_000_000_000, memoryPercent: 53, processes: 142 };
  const formatBytes = (bytes: number) => `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;

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
    </div>
  );
}
