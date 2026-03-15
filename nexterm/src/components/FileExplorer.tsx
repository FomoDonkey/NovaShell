import { useState, useEffect, useCallback, useRef } from "react";
import {
  Folder,
  FolderOpen,
  File,
  ChevronRight,
  ChevronDown,
  ArrowLeft,
  Home,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { useAppStore } from "../store/appStore";

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  extension: string;
}

interface TreeState {
  expanded: Set<string>;
  children: Map<string, FileEntry[]>;
  loading: Set<string>;
}

let invokeCache: typeof import("@tauri-apps/api/core").invoke | null = null;
async function getInvoke() {
  if (!invokeCache) {
    const mod = await import("@tauri-apps/api/core");
    invokeCache = mod.invoke;
  }
  return invokeCache;
}

const EXT_COLORS: Record<string, string> = {
  js: "#f7df1e", ts: "#3178c6", tsx: "#3178c6", jsx: "#61dafb",
  json: "#a8b1ff", md: "#519aba", css: "#563d7c", html: "#e34f26",
  py: "#3572A5", rs: "#dea584", go: "#00ADD8", java: "#b07219",
  yaml: "#cb171e", yml: "#cb171e", toml: "#9c4221", csv: "#237346",
  sh: "#89e051", bash: "#89e051", ps1: "#012456", bat: "#c1f12e",
  txt: "var(--text-muted)", log: "var(--accent-warning)",
  png: "#a259ff", jpg: "#a259ff", svg: "#ff9a00", gif: "#a259ff",
  exe: "var(--accent-error)", dll: "var(--accent-error)",
  lock: "var(--text-muted)", gitignore: "#f05032",
};

function getExtColor(ext: string): string {
  return EXT_COLORS[ext.toLowerCase()] || "var(--text-secondary)";
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileExplorer() {
  const previewFile = useAppStore((s) => s.previewFile);
  const setPreviewFile = useAppStore((s) => s.setPreviewFile);

  const [rootPath, setRootPath] = useState<string>("");
  const [rootFiles, setRootFiles] = useState<FileEntry[]>([]);
  const [tree, setTree] = useState<TreeState>({
    expanded: new Set(),
    children: new Map(),
    loading: new Set(),
  });
  const [filter, setFilter] = useState("");
  const [rootLoading, setRootLoading] = useState(false);
  const pathParts = rootPath ? rootPath.replace(/\\/g, "/").split("/").filter(Boolean) : [];

  const loadDirectory = useCallback(async (path?: string) => {
    setRootLoading(true);
    try {
      const invoke = await getInvoke();
      const entries = await invoke<FileEntry[]>("list_directory", { path: path || null });
      setRootFiles(entries);
      if (path) setRootPath(path);
      else if (entries.length > 0) {
        // Extract parent from first entry path
        const firstPath = entries[0].path.replace(/\\/g, "/");
        const parent = firstPath.substring(0, firstPath.lastIndexOf("/"));
        setRootPath(parent);
      }
      // Reset tree state when changing root
      setTree({ expanded: new Set(), children: new Map(), loading: new Set() });
    } catch {
      setRootFiles([]);
    }
    setRootLoading(false);
  }, []);

  const loadChildren = useCallback(async (dirPath: string) => {
    setTree((prev) => ({
      ...prev,
      loading: new Set(prev.loading).add(dirPath),
    }));
    try {
      const invoke = await getInvoke();
      const entries = await invoke<FileEntry[]>("list_directory", { path: dirPath });
      setTree((prev) => {
        const newChildren = new Map(prev.children);
        newChildren.set(dirPath, entries);
        const newExpanded = new Set(prev.expanded);
        newExpanded.add(dirPath);
        const newLoading = new Set(prev.loading);
        newLoading.delete(dirPath);
        return { expanded: newExpanded, children: newChildren, loading: newLoading };
      });
    } catch {
      setTree((prev) => {
        const newLoading = new Set(prev.loading);
        newLoading.delete(dirPath);
        return { ...prev, loading: newLoading };
      });
    }
  }, []);

  const toggleDir = useCallback((dirPath: string) => {
    setTree((prev) => {
      if (prev.expanded.has(dirPath)) {
        const newExpanded = new Set(prev.expanded);
        newExpanded.delete(dirPath);
        return { ...prev, expanded: newExpanded };
      }
      // If already loaded, just expand
      if (prev.children.has(dirPath)) {
        const newExpanded = new Set(prev.expanded);
        newExpanded.add(dirPath);
        return { ...prev, expanded: newExpanded };
      }
      return prev; // Will be loaded by the click handler
    });
  }, []);

  const handleDirClick = useCallback((dirPath: string) => {
    if (tree.expanded.has(dirPath)) {
      toggleDir(dirPath);
    } else if (tree.children.has(dirPath)) {
      toggleDir(dirPath);
    } else {
      loadChildren(dirPath);
    }
  }, [tree, toggleDir, loadChildren]);

  const handleFileClick = useCallback(async (file: FileEntry) => {
    try {
      const invoke = await getInvoke();
      const content = await invoke<string>("read_file_preview", { path: file.path });
      setPreviewFile({ name: file.name, content, extension: file.extension });
    } catch {
      setPreviewFile({ name: file.name, content: "(Cannot preview this file)", extension: file.extension });
    }
  }, [setPreviewFile]);

  const openInEditor = useCallback(async (file: FileEntry) => {
    try {
      const invoke = await getInvoke();
      const content = await invoke<string>("read_file_preview", { path: file.path });
      window.dispatchEvent(new CustomEvent("novashell-open-editor", {
        detail: { path: file.path, name: file.name, content, source: "local" },
      }));
      useAppStore.getState().setSidebarTab("editor");
    } catch {}
  }, []);

  const goUp = useCallback(() => {
    const parent = rootPath.replace(/[/\\][^/\\]*$/, "");
    if (parent && parent !== rootPath) {
      loadDirectory(parent);
    }
  }, [rootPath, loadDirectory]);

  const goHome = useCallback(() => { loadDirectory(); }, [loadDirectory]);

  useEffect(() => { loadDirectory(); }, [loadDirectory]);

  // File preview view
  if (previewFile) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--border-color)", flexShrink: 0 }}>
          <button onClick={() => setPreviewFile(null)} style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: 2, display: "flex" }}>
            <ArrowLeft size={14} />
          </button>
          <File size={14} style={{ color: getExtColor(previewFile.extension), flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {previewFile.name}
          </span>
          <button onClick={() => {
            // Open current preview file in editor
            window.dispatchEvent(new CustomEvent("novashell-open-editor", {
              detail: { path: rootPath + (rootPath.includes("\\") ? "\\" : "/") + previewFile.name, name: previewFile.name, content: previewFile.content, source: "local" },
            }));
            useAppStore.getState().setSidebarTab("editor");
          }} style={{ padding: "2px 6px", border: "none", borderRadius: "var(--radius-sm)", background: "var(--accent-primary)", color: "white", fontSize: 9, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 3 }}>
            Edit
          </button>
          <span style={{ fontSize: 10, color: getExtColor(previewFile.extension), fontWeight: 600, textTransform: "uppercase" }}>
            {previewFile.extension}
          </span>
        </div>
        <pre style={{
          flex: 1, margin: 0, padding: 12, background: "var(--bg-tertiary)",
          fontSize: 11, lineHeight: 1.6, color: "var(--text-primary)", overflow: "auto",
          whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "'Cascadia Code', 'Fira Code', monospace",
          counterReset: "line",
        }}>
          {previewFile.content.split("\n").map((line, i) => (
            <div key={i} style={{ display: "flex" }}>
              <span style={{ color: "var(--text-muted)", minWidth: 36, textAlign: "right", paddingRight: 12, userSelect: "none", fontSize: 10, opacity: 0.6 }}>{i + 1}</span>
              <span style={{ flex: 1 }}>{line || " "}</span>
            </div>
          ))}
        </pre>
      </div>
    );
  }

  // Filter files
  const filterFiles = (files: FileEntry[]) =>
    filter ? files.filter((f) => f.name.toLowerCase().includes(filter.toLowerCase())) : files;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6, padding: "10px 12px",
        borderBottom: "1px solid var(--border-color)", flexShrink: 0,
      }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)", flex: 1 }}>Explorer</span>
        <button onClick={goHome} title="Home" style={iconBtnStyle}><Home size={13} /></button>
        <button onClick={goUp} title="Go up" style={iconBtnStyle}><ArrowLeft size={13} /></button>
        <button onClick={() => loadDirectory(rootPath)} title="Refresh" style={iconBtnStyle}><RefreshCw size={13} /></button>
      </div>

      {/* Breadcrumb */}
      <div style={{
        display: "flex", alignItems: "center", gap: 2, padding: "6px 12px",
        borderBottom: "1px solid var(--border-subtle)", fontSize: 11, flexShrink: 0,
        overflow: "hidden", flexWrap: "nowrap",
      }}>
        {pathParts.length > 3 ? (
          <>
            <BreadcrumbItem
              label={pathParts[0]}
              onClick={() => loadDirectory(pathParts[0])}
            />
            <span style={{ color: "var(--text-muted)" }}>/</span>
            <span style={{ color: "var(--text-muted)" }}>...</span>
            <span style={{ color: "var(--text-muted)" }}>/</span>
            {pathParts.slice(-2).map((part, i) => (
              <span key={i} style={{ display: "flex", alignItems: "center", gap: 2 }}>
                {i > 0 && <span style={{ color: "var(--text-muted)" }}>/</span>}
                <BreadcrumbItem
                  label={part}
                  onClick={() => {
                    const idx = pathParts.length - 2 + i;
                    loadDirectory(pathParts.slice(0, idx + 1).join("/"));
                  }}
                />
              </span>
            ))}
          </>
        ) : (
          pathParts.map((part, i) => (
            <span key={i} style={{ display: "flex", alignItems: "center", gap: 2 }}>
              {i > 0 && <span style={{ color: "var(--text-muted)" }}>/</span>}
              <BreadcrumbItem
                label={part}
                onClick={() => loadDirectory(pathParts.slice(0, i + 1).join("/"))}
              />
            </span>
          ))
        )}
      </div>

      {/* Search */}
      <div style={{ padding: "6px 12px", flexShrink: 0 }}>
        <div style={{ position: "relative" }}>
          <Search size={12} style={{ position: "absolute", left: 8, top: 7, color: "var(--text-muted)" }} />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter files..."
            style={{
              width: "100%", padding: "5px 28px 5px 28px", background: "var(--bg-tertiary)",
              border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)",
              color: "var(--text-primary)", fontSize: 11, outline: "none",
            }}
          />
          {filter && (
            <button onClick={() => setFilter("")} style={{ position: "absolute", right: 6, top: 5, background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", display: "flex", padding: 2 }}>
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Tree */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
        {rootLoading ? (
          <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 20, fontSize: 12 }}>Loading...</div>
        ) : (
          filterFiles(rootFiles).map((file) => (
            <TreeItem
              key={file.path}
              file={file}
              depth={0}
              tree={tree}
              filter={filter}
              onDirClick={handleDirClick}
              onFileClick={handleFileClick}
              filterFiles={filterFiles}
            />
          ))
        )}
      </div>
    </div>
  );
}

function BreadcrumbItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "none", border: "none", color: "var(--accent-primary)", cursor: "pointer",
        padding: "1px 2px", fontSize: 11, fontWeight: 500, whiteSpace: "nowrap",
        borderRadius: 2,
      }}
      onMouseOver={(e) => (e.currentTarget.style.textDecoration = "underline")}
      onMouseOut={(e) => (e.currentTarget.style.textDecoration = "none")}
    >
      {label}
    </button>
  );
}

function TreeItem({
  file,
  depth,
  tree,
  filter,
  onDirClick,
  onFileClick,
  filterFiles,
}: {
  file: FileEntry;
  depth: number;
  tree: TreeState;
  filter: string;
  onDirClick: (path: string) => void;
  onFileClick: (file: FileEntry) => void;
  filterFiles: (files: FileEntry[]) => FileEntry[];
}) {
  const isExpanded = tree.expanded.has(file.path);
  const isLoading = tree.loading.has(file.path);
  const children = tree.children.get(file.path);
  const paddingLeft = 12 + depth * 16;

  if (file.is_dir) {
    return (
      <>
        <div
          onClick={() => onDirClick(file.path)}
          style={{
            display: "flex", alignItems: "center", gap: 4, padding: "3px 8px",
            paddingLeft, cursor: "pointer", fontSize: 12, color: "var(--text-primary)",
            transition: "background var(--transition-fast)",
          }}
          onMouseOver={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
          onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
        >
          {isLoading ? (
            <RefreshCw size={12} style={{ color: "var(--text-muted)", animation: "spin 1s linear infinite", flexShrink: 0 }} />
          ) : isExpanded ? (
            <ChevronDown size={12} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          ) : (
            <ChevronRight size={12} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          )}
          {isExpanded ? (
            <FolderOpen size={14} style={{ color: "var(--accent-primary)", flexShrink: 0 }} />
          ) : (
            <Folder size={14} style={{ color: "var(--accent-primary)", flexShrink: 0 }} />
          )}
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>
            {file.name}
          </span>
        </div>
        {isExpanded && children && filterFiles(children).map((child) => (
          <TreeItem
            key={child.path}
            file={child}
            depth={depth + 1}
            tree={tree}
            filter={filter}
            onDirClick={onDirClick}
            onFileClick={onFileClick}
            filterFiles={filterFiles}
          />
        ))}
      </>
    );
  }

  return (
    <div
      onClick={() => onFileClick(file)}
      style={{
        display: "flex", alignItems: "center", gap: 4, padding: "3px 8px",
        paddingLeft: paddingLeft + 16, cursor: "pointer", fontSize: 12,
        color: "var(--text-secondary)", transition: "background var(--transition-fast)",
      }}
      onMouseOver={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
      onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <File size={13} style={{ color: getExtColor(file.extension), flexShrink: 0 }} />
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {file.name}
      </span>
      <span style={{ fontSize: 10, color: "var(--text-muted)", flexShrink: 0 }}>{formatSize(file.size)}</span>
    </div>
  );
}

const iconBtnStyle: React.CSSProperties = {
  background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer",
  padding: 4, borderRadius: "var(--radius-sm)", display: "flex",
};
