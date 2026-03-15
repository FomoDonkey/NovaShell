import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  FileText, Save, X, AlertTriangle, Loader2, Sparkles, Check,
  Play, Square, RotateCcw, RefreshCw, Terminal, Eye, Settings,
  Zap, ScrollText, ChevronRight, ChevronDown, Package, FileCode,
  Folder, FolderOpen, File, Search, FolderOpenDot, ArrowLeft, Home, PanelLeftClose, PanelLeftOpen,
} from "lucide-react";
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightActiveLine, drawSelection } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, indentWithTab, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter, indentOnInput } from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { autocompletion, closeBrackets } from "@codemirror/autocomplete";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { yaml } from "@codemirror/lang-yaml";
import { markdown } from "@codemirror/lang-markdown";
import { sql } from "@codemirror/lang-sql";

let invokeCache: typeof import("@tauri-apps/api/core").invoke | null = null;
async function getInvoke() {
  if (!invokeCache) { const m = await import("@tauri-apps/api/core"); invokeCache = m.invoke; }
  return invokeCache;
}
let listenCache: typeof import("@tauri-apps/api/event").listen | null = null;
async function getListen() {
  if (!listenCache) { const m = await import("@tauri-apps/api/event"); listenCache = m.listen; }
  return listenCache;
}

interface OpenFile {
  path: string;
  name: string;
  content: string;
  source: "local" | "sftp";
  sftpSessionId?: string;
  sshHost?: string;
  sshPort?: number;
  sshUsername?: string;
  sshPassword?: string | null;
  sshPrivateKey?: string | null;
  modified: boolean;
}

// ── File Browser Types ──

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

// ── Infra Detection ──

interface InfraType {
  id: string;
  label: string;
  icon: React.ReactNode;
  actions: InfraAction[];
  logCommand?: string;
  logFile?: string; // for local
}

interface InfraAction {
  label: string;
  icon: React.ReactNode;
  cmd: string;
  dangerous?: boolean;
}

function detectInfra(name: string, content: string): InfraType | null {
  const n = name.toLowerCase();

  if (n === "docker-compose.yml" || n === "docker-compose.yaml" || n === "compose.yml" || n === "compose.yaml" || (n.endsWith(".yml") && content.includes("services:") && content.includes("image:"))) {
    const dir = "$(dirname {path})";
    return {
      id: "docker-compose", label: "Docker Compose", icon: <Package size={11} style={{ color: "#2496ED" }} />,
      logCommand: `cd ${dir} && docker compose logs --tail 80 -f 2>&1`,
      actions: [
        { label: "Validate", icon: <Zap size={9} />, cmd: `cd ${dir} && docker compose config --quiet 2>&1 && echo '✓ Valid' || echo '✗ Invalid'` },
        { label: "Start stack", icon: <Play size={9} />, cmd: `cd ${dir} && docker compose up -d 2>&1` },
        { label: "Stop stack", icon: <Square size={9} />, cmd: `cd ${dir} && docker compose down 2>&1`, dangerous: true },
        { label: "Status", icon: <Eye size={9} />, cmd: `cd ${dir} && docker compose ps 2>&1` },
        { label: "Restart", icon: <RotateCcw size={9} />, cmd: `cd ${dir} && docker compose restart 2>&1` },
      ],
    };
  }

  if (n === "dockerfile" || n.startsWith("dockerfile.")) {
    const dir = "$(dirname {path})";
    return {
      id: "dockerfile", label: "Dockerfile", icon: <Package size={11} style={{ color: "#2496ED" }} />,
      actions: [
        { label: "Build", icon: <Play size={9} />, cmd: `cd ${dir} && docker build -t novashell-build . 2>&1` },
        { label: "Show layers", icon: <Eye size={9} />, cmd: `cd ${dir} && docker history novashell-build 2>&1 || echo 'Build first'` },
      ],
    };
  }

  if (n.includes("nginx") || (n.endsWith(".conf") && (content.includes("server {") || content.includes("location ")))) {
    return {
      id: "nginx", label: "Nginx Config", icon: <FileCode size={11} style={{ color: "#10B981" }} />,
      logCommand: "tail -f /var/log/nginx/error.log 2>/dev/null",
      logFile: "/var/log/nginx/error.log",
      actions: [
        { label: "Test config", icon: <Zap size={9} />, cmd: "nginx -t 2>&1" },
        { label: "Reload", icon: <RefreshCw size={9} />, cmd: "sudo nginx -s reload 2>&1 && echo '✓ Reloaded'" },
        { label: "Error log", icon: <ScrollText size={9} />, cmd: "tail -30 /var/log/nginx/error.log 2>/dev/null" },
        { label: "Access log", icon: <ScrollText size={9} />, cmd: "tail -30 /var/log/nginx/access.log 2>/dev/null" },
      ],
    };
  }

  if (n.includes("apache") || n.includes("httpd") || (n.endsWith(".conf") && content.includes("VirtualHost"))) {
    return {
      id: "apache", label: "Apache Config", icon: <FileCode size={11} style={{ color: "#C53030" }} />,
      logCommand: "tail -f /var/log/apache2/error.log 2>/dev/null || tail -f /var/log/httpd/error_log 2>/dev/null",
      actions: [
        { label: "Test config", icon: <Zap size={9} />, cmd: "apache2ctl configtest 2>&1 || httpd -t 2>&1" },
        { label: "Reload", icon: <RefreshCw size={9} />, cmd: "sudo systemctl reload apache2 2>&1 || sudo systemctl reload httpd 2>&1" },
        { label: "Error log", icon: <ScrollText size={9} />, cmd: "tail -30 /var/log/apache2/error.log 2>/dev/null || tail -30 /var/log/httpd/error_log 2>/dev/null" },
      ],
    };
  }

  if (n === "package.json" && content.includes('"scripts"')) {
    const scripts: string[] = [];
    try {
      const parsed = JSON.parse(content);
      if (parsed.scripts) Object.keys(parsed.scripts).slice(0, 8).forEach((k) => scripts.push(k));
    } catch {}
    const dir = "$(dirname {path})";
    return {
      id: "package-json", label: "Node.js Project", icon: <Package size={11} style={{ color: "#68A063" }} />,
      actions: [
        { label: "Install", icon: <Play size={9} />, cmd: `cd ${dir} && npm install 2>&1` },
        { label: "Audit", icon: <AlertTriangle size={9} />, cmd: `cd ${dir} && npm audit 2>&1 | head -40` },
        ...scripts.map((s) => ({ label: `npm run ${s}`, icon: <Terminal size={9} /> as React.ReactNode, cmd: `cd ${dir} && npm run ${s} 2>&1` })),
      ],
    };
  }

  if (n.endsWith(".service") && content.includes("[Service]")) {
    const svcName = n.replace(".service", "");
    return {
      id: "systemd", label: "Systemd Unit", icon: <Settings size={11} style={{ color: "#8B5CF6" }} />,
      logCommand: `journalctl -u ${svcName} -f --no-pager -n 0 2>/dev/null`,
      actions: [
        { label: "Status", icon: <Eye size={9} />, cmd: `systemctl status ${svcName} --no-pager 2>&1` },
        { label: "Start", icon: <Play size={9} />, cmd: `sudo systemctl start ${svcName} 2>&1 && echo '✓ Started'` },
        { label: "Restart", icon: <RotateCcw size={9} />, cmd: `sudo systemctl restart ${svcName} 2>&1 && echo '✓ Restarted'` },
        { label: "Enable", icon: <Zap size={9} />, cmd: `sudo systemctl enable ${svcName} 2>&1 && echo '✓ Enabled'` },
        { label: "Stop", icon: <Square size={9} />, cmd: `sudo systemctl stop ${svcName} 2>&1 && echo '✓ Stopped'`, dangerous: true },
        { label: "Logs", icon: <ScrollText size={9} />, cmd: `journalctl -u ${svcName} -n 50 --no-pager 2>&1` },
      ],
    };
  }

  if (n === ".env" || n.endsWith(".env") || n === ".env.local" || n === ".env.production") {
    return {
      id: "env", label: "Environment File", icon: <Settings size={11} style={{ color: "#F59E0B" }} />,
      actions: [
        { label: "Check empty vars", icon: <AlertTriangle size={9} />, cmd: `grep -n '=$' {path} 2>/dev/null && echo '\\n⚠ Found empty variables' || echo '✓ All variables have values'` },
      ],
    };
  }

  if (n === "makefile" || n === "gnumakefile") {
    return {
      id: "makefile", label: "Makefile", icon: <Terminal size={11} style={{ color: "#EC4899" }} />,
      actions: [
        { label: "List targets", icon: <Eye size={9} />, cmd: `grep -E '^[a-zA-Z_-]+:' {path} | sed 's/:.*//' 2>/dev/null` },
      ],
    };
  }

  return null;
}

// ── Editor theme + lang ──

const novaTheme = EditorView.theme({
  "&": { backgroundColor: "var(--bg-primary)", color: "var(--text-primary)", fontSize: "12px", fontFamily: "'JetBrains Mono', 'Fira Code', monospace" },
  ".cm-content": { caretColor: "var(--accent-primary)", padding: "4px 0" },
  ".cm-cursor": { borderLeftColor: "var(--accent-primary)", borderLeftWidth: "2px" },
  ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.03)" },
  ".cm-activeLineGutter": { backgroundColor: "rgba(255,255,255,0.05)" },
  ".cm-gutters": { backgroundColor: "var(--bg-secondary)", color: "var(--text-muted)", border: "none", fontSize: "10px" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 4px", minWidth: "32px" },
  ".cm-selectionBackground": { backgroundColor: "rgba(88,166,255,0.2) !important" },
  ".cm-matchingBracket": { backgroundColor: "rgba(88,166,255,0.3)", outline: "1px solid rgba(88,166,255,0.5)" },
  ".cm-foldGutter": { padding: "0 2px" },
  ".cm-tooltip": { backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-subtle)", color: "var(--text-primary)" },
}, { dark: true });

function getLang(ext: string) {
  switch (ext.toLowerCase()) {
    case "js": case "jsx": case "mjs": case "cjs": return javascript();
    case "ts": case "tsx": return javascript({ typescript: true, jsx: ext.includes("x") });
    case "py": return python();
    case "json": return json();
    case "html": case "htm": return html();
    case "css": case "scss": case "less": return css();
    case "yml": case "yaml": return yaml();
    case "md": case "mdx": return markdown();
    case "sql": return sql();
    default: return [];
  }
}

const btnS: React.CSSProperties = {
  padding: "3px 6px", border: "none", borderRadius: "var(--radius-sm)",
  fontSize: 9, cursor: "pointer", fontFamily: "inherit",
  display: "inline-flex", alignItems: "center", gap: 3,
};

// ── Main Component ──

export function EditorPanel() {
  const [file, setFile] = useState<OpenFile | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [infra, setInfra] = useState<InfraType | null>(null);
  const [infraOpen, setInfraOpen] = useState(true);
  const [actionOutput, setActionOutput] = useState<{ title: string; content: string } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Live logs
  const [liveLogsOpen, setLiveLogsOpen] = useState(false);
  const [liveLogLines, setLiveLogLines] = useState<string[]>([]);
  const [logStreamId, setLogStreamId] = useState<string | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // File browser state
  const [browserOpen, setBrowserOpen] = useState(false);
  const [browserPath, setBrowserPath] = useState("");
  const [browserFiles, setBrowserFiles] = useState<FileEntry[]>([]);
  const [browserLoading, setBrowserLoading] = useState(false);
  const [browserFilter, setBrowserFilter] = useState("");
  const [browserMode, setBrowserMode] = useState<"file" | "folder">("file");

  // Folder tree state (shown when a folder is opened)
  const [folderRoot, setFolderRoot] = useState<string | null>(null);
  const [folderFiles, setFolderFiles] = useState<FileEntry[]>([]);
  const [folderTree, setFolderTree] = useState<TreeState>({ expanded: new Set(), children: new Map(), loading: new Set() });
  const [folderFilter, setFolderFilter] = useState("");
  const [folderTreeVisible, setFolderTreeVisible] = useState(true);

  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langCompartment = useRef(new Compartment());
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>();
  const contentRef = useRef("");

  // ── File Browser Functions ──

  const loadBrowserDir = useCallback(async (path?: string) => {
    setBrowserLoading(true);
    try {
      const invoke = await getInvoke();
      const entries = await invoke<FileEntry[]>("list_directory", { path: path || null });
      setBrowserFiles(entries);
      if (path) {
        setBrowserPath(path);
      } else if (entries.length > 0) {
        const firstPath = entries[0].path.replace(/\\/g, "/");
        const parent = firstPath.substring(0, firstPath.lastIndexOf("/"));
        setBrowserPath(parent);
      }
    } catch {
      setBrowserFiles([]);
    }
    setBrowserLoading(false);
  }, []);

  const openFileBrowser = useCallback((mode: "file" | "folder") => {
    setBrowserMode(mode);
    setBrowserOpen(true);
    setBrowserFilter("");
    loadBrowserDir();
  }, [loadBrowserDir]);

  const selectBrowserFile = useCallback(async (entry: FileEntry) => {
    if (entry.is_dir) {
      if (browserMode === "folder") {
        // Open this folder as the project folder
        setFolderRoot(entry.path);
        setFolderTreeVisible(true);
        setBrowserOpen(false);
        // Load folder contents
        try {
          const invoke = await getInvoke();
          const entries = await invoke<FileEntry[]>("list_directory", { path: entry.path });
          setFolderFiles(entries);
          setFolderTree({ expanded: new Set(), children: new Map(), loading: new Set() });
          setFolderFilter("");
        } catch {}
      } else {
        loadBrowserDir(entry.path);
      }
    } else {
      // Open file in editor
      try {
        const invoke = await getInvoke();
        const content = await invoke<string>("read_file_preview", { path: entry.path });
        setFile({ path: entry.path, name: entry.name, content, source: "local", modified: false });
        contentRef.current = content;
        setAiAnalysis(null);
        setShowAnalysis(false);
        setInfra(detectInfra(entry.name, content));
        stopLiveLogs();
        setBrowserOpen(false);
      } catch {}
    }
  }, [browserMode, loadBrowserDir]);

  const browserGoUp = useCallback(() => {
    const parent = browserPath.replace(/[/\\][^/\\]*$/, "");
    if (parent && parent !== browserPath) loadBrowserDir(parent);
  }, [browserPath, loadBrowserDir]);

  // ── Folder Tree Functions ──

  const loadFolderChildren = useCallback(async (dirPath: string) => {
    setFolderTree((prev) => ({
      ...prev,
      loading: new Set(prev.loading).add(dirPath),
    }));
    try {
      const invoke = await getInvoke();
      const entries = await invoke<FileEntry[]>("list_directory", { path: dirPath });
      setFolderTree((prev) => {
        const newChildren = new Map(prev.children);
        newChildren.set(dirPath, entries);
        const newExpanded = new Set(prev.expanded);
        newExpanded.add(dirPath);
        const newLoading = new Set(prev.loading);
        newLoading.delete(dirPath);
        return { expanded: newExpanded, children: newChildren, loading: newLoading };
      });
    } catch {
      setFolderTree((prev) => {
        const newLoading = new Set(prev.loading);
        newLoading.delete(dirPath);
        return { ...prev, loading: newLoading };
      });
    }
  }, []);

  const handleFolderDirClick = useCallback((dirPath: string) => {
    setFolderTree((prev) => {
      if (prev.expanded.has(dirPath)) {
        const newExpanded = new Set(prev.expanded);
        newExpanded.delete(dirPath);
        return { ...prev, expanded: newExpanded };
      }
      if (prev.children.has(dirPath)) {
        const newExpanded = new Set(prev.expanded);
        newExpanded.add(dirPath);
        return { ...prev, expanded: newExpanded };
      }
      return prev;
    });
    if (!folderTree.expanded.has(dirPath) && !folderTree.children.has(dirPath)) {
      loadFolderChildren(dirPath);
    }
  }, [folderTree, loadFolderChildren]);

  const handleFolderFileClick = useCallback(async (entry: FileEntry) => {
    try {
      const invoke = await getInvoke();
      const content = await invoke<string>("read_file_preview", { path: entry.path });
      setFile({ path: entry.path, name: entry.name, content, source: "local", modified: false });
      contentRef.current = content;
      setAiAnalysis(null);
      setShowAnalysis(false);
      setInfra(detectInfra(entry.name, content));
      stopLiveLogs();
    } catch {}
  }, []);

  const filterEntries = useCallback((files: FileEntry[], filter: string) =>
    filter ? files.filter((f) => f.name.toLowerCase().includes(filter.toLowerCase())) : files, []);

  // Open file from event
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const d = e.detail;
      setFile({ ...d, modified: false });
      contentRef.current = d.content;
      setAiAnalysis(null);
      setShowAnalysis(false);
      setInfra(detectInfra(d.name, d.content));
      stopLiveLogs();
    };
    window.addEventListener("novashell-open-editor" as any, handler as any);
    return () => window.removeEventListener("novashell-open-editor" as any, handler as any);
  }, []);

  // Memoize base CodeMirror extensions (never changes)
  const baseExtensions = useMemo(() => [
    lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), drawSelection(),
    bracketMatching(), closeBrackets(), autocompletion(), foldGutter(), indentOnInput(),
    history(), highlightSelectionMatches(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
    novaTheme, EditorView.lineWrapping,
  ], []);

  // CodeMirror instance
  useEffect(() => {
    if (!file || !editorRef.current) return;
    const ext = file.name.split(".").pop() || "";
    if (viewRef.current) { viewRef.current.destroy(); viewRef.current = null; }
    const fileNameRef = file.name; // capture for closure
    const state = EditorState.create({
      doc: file.content,
      extensions: [
        ...baseExtensions,
        langCompartment.current.of(getLang(ext)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            contentRef.current = update.state.doc.toString();
            setFile((prev) => prev ? { ...prev, modified: true } : null);
            if (debounceTimer.current) clearTimeout(debounceTimer.current);
            debounceTimer.current = setTimeout(() => analyzeContent(contentRef.current, fileNameRef), 3000);
          }
        }),
      ],
    });
    const view = new EditorView({ state, parent: editorRef.current });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
  }, [file?.path]);

  // Auto-scroll logs
  useEffect(() => {
    if (logContainerRef.current) logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
  }, [liveLogLines]);

  // Cleanup log stream on unmount
  useEffect(() => () => { if (logStreamId) stopLogStreamBackend(logStreamId); }, []);

  const saveFile = useCallback(async () => {
    if (!file) return;
    setSaving(true);
    try {
      const invoke = await getInvoke();
      if (file.source === "sftp" && file.sftpSessionId) {
        await invoke("sftp_write_text", { sessionId: file.sftpSessionId, path: file.path, content: contentRef.current });
      } else {
        await invoke("write_file", { path: file.path, content: contentRef.current });
      }
      setFile((prev) => prev ? { ...prev, modified: false, content: contentRef.current } : null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) { setActionOutput({ title: "Save failed", content: String(e) }); }
    setSaving(false);
  }, [file]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); saveFile(); } };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [saveFile]);

  const analyzeContent = async (content: string, filename: string) => {
    if (content.length < 10 || content.length > 50000) return;
    setAiLoading(true);
    try {
      const invoke = await getInvoke();
      const health = await invoke<boolean>("ai_health").catch(() => false);
      if (!health) { setAiLoading(false); return; }
      const ext = filename.split(".").pop() || "";
      const fileType = ext === "yml" || ext === "yaml" ? "YAML" : ext === "json" ? "JSON" :
        ext === "conf" || ext === "cfg" || filename.includes("nginx") ? "Nginx/Config" :
        ext === "env" ? "Environment" : ext === "toml" ? "TOML" :
        ext === "dockerfile" || filename.toLowerCase() === "dockerfile" ? "Dockerfile" :
        ext === "js" || ext === "ts" ? "JavaScript/TypeScript" : ext === "py" ? "Python" : ext;
      const result = await invoke<string>("ai_chat", {
        model: "llama3.2",
        systemPrompt: "You are a config file analyzer. Be concise. Only report ACTUAL issues — syntax errors, security risks, port conflicts, deprecated options, missing required fields. Use format: ⚠ line X: issue. If no issues found, say '✓ No issues detected'. Max 8 issues.",
        messages: [{ role: "user", content: `Analyze this ${fileType} file for errors, warnings, and potential issues:\n\n\`\`\`\n${content.slice(0, 8000)}\n\`\`\`` }],
      });
      setAiAnalysis(result);
      setShowAnalysis(true);
    } catch {}
    setAiLoading(false);
  };

  // Infra action execution
  const runInfraAction = async (action: InfraAction) => {
    if (!file) return;
    setActionLoading(true);
    setActionOutput({ title: action.label, content: "Running..." });
    try {
      const invoke = await getInvoke();
      const cmd = action.cmd.replace(/\{path\}/g, file.path);
      let output: string;
      if (file.source === "sftp" && file.sshHost) {
        output = await invoke<string>("ssh_exec", {
          host: file.sshHost, port: file.sshPort || 22, username: file.sshUsername || "",
          password: file.sshPassword, privateKey: file.sshPrivateKey, command: cmd,
        });
      } else {
        // Local: run via shell
        output = await invoke<string>("run_command_output", { command: "bash", args: ["-c", cmd], cwd: null })
          .catch(async () => {
            // Windows fallback
            return invoke<string>("run_command_output", { command: "powershell", args: ["-Command", cmd], cwd: null }).catch(() => "Command failed");
          });
      }
      setActionOutput({ title: action.label, content: output || "(no output)" });
    } catch (e) {
      setActionOutput({ title: `${action.label} failed`, content: String(e) });
    }
    setActionLoading(false);
  };

  // Live logs via SSH LogStream
  const startLiveLogs = async () => {
    if (!file || !infra?.logCommand) return;
    setLiveLogsOpen(true);
    setLiveLogLines(["Connecting..."]);

    if (file.source === "sftp" && file.sshHost) {
      try {
        const invoke = await getInvoke();
        const listen = await getListen();
        const streamId = await invoke<string>("start_log_stream", {
          host: file.sshHost, port: file.sshPort || 22, username: file.sshUsername || "",
          password: file.sshPassword, privateKey: file.sshPrivateKey,
          command: infra.logCommand,
        });
        setLogStreamId(streamId);
        setLiveLogLines([`Connected — streaming logs...`]);
        const unlisten = await listen<string>(`log-stream-data-${streamId}`, (event) => {
          setLiveLogLines((prev) => {
            const newLines = event.payload.split("\n").filter((l) => l.trim());
            const all = [...prev, ...newLines];
            return all.length > 500 ? all.slice(-500) : all;
          });
        });
        // Store unlisten for cleanup
        (window as any).__logStreamUnlisten = unlisten;
      } catch (e) {
        setLiveLogLines([`Error: ${e}`]);
      }
    } else if (infra.logFile) {
      // Local: read file
      try {
        const invoke = await getInvoke();
        const content = await invoke<string>("tail_local_file", { path: infra.logFile, lines: 50 });
        setLiveLogLines(content.split("\n"));
      } catch (e) {
        setLiveLogLines([`Error reading log: ${e}`]);
      }
    }
  };

  const stopLogStreamBackend = async (id: string) => {
    try {
      const invoke = await getInvoke();
      await invoke("stop_log_stream", { streamId: id });
    } catch {}
    if ((window as any).__logStreamUnlisten) {
      (window as any).__logStreamUnlisten();
      delete (window as any).__logStreamUnlisten;
    }
  };

  const stopLiveLogs = () => {
    if (logStreamId) { stopLogStreamBackend(logStreamId); setLogStreamId(null); }
    setLiveLogsOpen(false);
    setLiveLogLines([]);
  };

  // ── File Browser Modal ──
  const renderBrowser = () => {
    if (!browserOpen) return null;
    const pathParts = browserPath ? browserPath.replace(/\\/g, "/").split("/").filter(Boolean) : [];
    const filtered = browserFilter ? browserFiles.filter((f) => f.name.toLowerCase().includes(browserFilter.toLowerCase())) : browserFiles;
    return (
      <div style={{ position: "absolute", inset: 0, zIndex: 50, background: "var(--bg-primary)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Browser header */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", background: "var(--bg-tertiary)", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0 }}>
          <FolderOpenDot size={13} style={{ color: "var(--accent-primary)", flexShrink: 0 }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)", flex: 1 }}>
            {browserMode === "folder" ? "Open Folder" : "Open File"}
          </span>
          <button onClick={() => setBrowserOpen(false)} style={{ ...btnS, background: "none", color: "var(--text-muted)", padding: "2px" }}><X size={11} /></button>
        </div>
        {/* Navigation */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0 }}>
          <button onClick={() => loadBrowserDir()} title="Home" style={{ ...btnS, background: "none", color: "var(--text-muted)", padding: "2px" }}><Home size={12} /></button>
          <button onClick={browserGoUp} title="Up" style={{ ...btnS, background: "none", color: "var(--text-muted)", padding: "2px" }}><ArrowLeft size={12} /></button>
          <div style={{ flex: 1, fontSize: 10, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {pathParts.length > 3 ? `.../${pathParts.slice(-2).join("/")}` : pathParts.join("/")}
          </div>
          {browserMode === "folder" && browserPath && (
            <button onClick={() => selectBrowserFile({ name: browserPath.split(/[/\\]/).pop() || "folder", path: browserPath, is_dir: true, size: 0, extension: "" })}
              style={{ ...btnS, padding: "2px 8px", background: "var(--accent-primary)", color: "white", fontSize: 10 }}>
              Open this folder
            </button>
          )}
        </div>
        {/* Search */}
        <div style={{ padding: "4px 8px", flexShrink: 0 }}>
          <div style={{ position: "relative" }}>
            <Search size={11} style={{ position: "absolute", left: 6, top: 6, color: "var(--text-muted)" }} />
            <input type="text" value={browserFilter} onChange={(e) => setBrowserFilter(e.target.value)} placeholder="Filter..."
              style={{ width: "100%", padding: "4px 24px 4px 24px", background: "var(--bg-tertiary)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: 10, outline: "none" }} />
            {browserFilter && <button onClick={() => setBrowserFilter("")} style={{ position: "absolute", right: 4, top: 4, background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", display: "flex", padding: 1 }}><X size={10} /></button>}
          </div>
        </div>
        {/* File list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "2px 0" }}>
          {browserLoading ? (
            <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 20, fontSize: 11 }}>Loading...</div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 20, fontSize: 11 }}>Empty</div>
          ) : (
            filtered.map((entry) => (
              <div key={entry.path} onClick={() => selectBrowserFile(entry)}
                style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", cursor: "pointer", fontSize: 11, color: "var(--text-primary)", transition: "background 0.1s" }}
                onMouseOver={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}>
                {entry.is_dir ? <Folder size={13} style={{ color: "var(--accent-primary)", flexShrink: 0 }} /> : <File size={13} style={{ color: getExtColor(entry.extension), flexShrink: 0 }} />}
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name}</span>
                {!entry.is_dir && <span style={{ fontSize: 9, color: "var(--text-muted)", flexShrink: 0 }}>{formatSize(entry.size)}</span>}
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  // ── Folder Tree Renderer ──
  const renderFolderTreeItem = (entry: FileEntry, depth: number): React.ReactNode => {
    const isExpanded = folderTree.expanded.has(entry.path);
    const isLoading = folderTree.loading.has(entry.path);
    const children = folderTree.children.get(entry.path);
    const paddingLeft = 8 + depth * 14;
    const isActive = file?.path === entry.path;

    if (entry.is_dir) {
      return (
        <div key={entry.path}>
          <div onClick={() => handleFolderDirClick(entry.path)}
            style={{ display: "flex", alignItems: "center", gap: 3, padding: "2px 4px", paddingLeft, cursor: "pointer", fontSize: 11, color: "var(--text-primary)", transition: "background 0.1s" }}
            onMouseOver={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
            onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}>
            {isLoading ? <RefreshCw size={10} style={{ color: "var(--text-muted)", animation: "spin 1s linear infinite", flexShrink: 0 }} />
              : isExpanded ? <ChevronDown size={10} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              : <ChevronRight size={10} style={{ color: "var(--text-muted)", flexShrink: 0 }} />}
            {isExpanded ? <FolderOpen size={12} style={{ color: "var(--accent-primary)", flexShrink: 0 }} /> : <Folder size={12} style={{ color: "var(--accent-primary)", flexShrink: 0 }} />}
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>{entry.name}</span>
          </div>
          {isExpanded && children && filterEntries(children, folderFilter).map((child) => renderFolderTreeItem(child, depth + 1))}
        </div>
      );
    }

    return (
      <div key={entry.path} onClick={() => handleFolderFileClick(entry)}
        style={{ display: "flex", alignItems: "center", gap: 3, padding: "2px 4px", paddingLeft: paddingLeft + 14, cursor: "pointer", fontSize: 11,
          color: isActive ? "var(--accent-primary)" : "var(--text-secondary)", background: isActive ? "rgba(88,166,255,0.08)" : "transparent", transition: "background 0.1s" }}
        onMouseOver={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-hover)"; }}
        onMouseOut={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}>
        <File size={11} style={{ color: getExtColor(entry.extension), flexShrink: 0 }} />
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name}</span>
      </div>
    );
  };

  const renderFolderPanel = () => {
    if (!folderRoot || !folderTreeVisible) return null;
    const folderName = folderRoot.replace(/\\/g, "/").split("/").pop() || folderRoot;
    const filtered = filterEntries(folderFiles, folderFilter);
    return (
      <div style={{ width: 180, minWidth: 130, maxWidth: 220, borderRight: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", background: "var(--bg-secondary)", flexShrink: 0 }}>
        {/* Folder header */}
        <div style={{ display: "flex", alignItems: "center", gap: 3, padding: "5px 6px", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0 }}>
          <FolderOpen size={11} style={{ color: "var(--accent-primary)", flexShrink: 0 }} />
          <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-primary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={folderRoot}>
            {folderName}
          </span>
          <button onClick={async () => {
            try { const invoke = await getInvoke(); const entries = await invoke<FileEntry[]>("list_directory", { path: folderRoot }); setFolderFiles(entries); } catch {}
          }} style={{ ...btnS, background: "none", color: "var(--text-muted)", padding: "1px" }} title="Refresh"><RefreshCw size={9} /></button>
          <button onClick={() => { setFolderRoot(null); setFolderFiles([]); setFolderTree({ expanded: new Set(), children: new Map(), loading: new Set() }); }}
            style={{ ...btnS, background: "none", color: "var(--text-muted)", padding: "1px" }} title="Close folder"><X size={9} /></button>
        </div>
        {/* Search */}
        <div style={{ padding: "3px 4px", flexShrink: 0 }}>
          <div style={{ position: "relative" }}>
            <Search size={9} style={{ position: "absolute", left: 5, top: 5, color: "var(--text-muted)" }} />
            <input type="text" value={folderFilter} onChange={(e) => setFolderFilter(e.target.value)} placeholder="Filter..."
              style={{ width: "100%", padding: "3px 18px 3px 20px", background: "var(--bg-tertiary)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: 9, outline: "none" }} />
            {folderFilter && <button onClick={() => setFolderFilter("")} style={{ position: "absolute", right: 3, top: 3, background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", display: "flex", padding: 1 }}><X size={8} /></button>}
          </div>
        </div>
        {/* Tree */}
        <div style={{ flex: 1, overflowY: "auto", padding: "2px 0" }} className="hacking-log-container">
          {filtered.map((entry) => renderFolderTreeItem(entry, 0))}
        </div>
      </div>
    );
  };

  if (!file) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
        {renderBrowser()}
        {folderRoot && folderTreeVisible ? (
          <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
            {renderFolderPanel()}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 12, gap: 8 }}>
              <FileText size={28} style={{ opacity: 0.3 }} />
              <div style={{ fontSize: 11 }}>Select a file from the tree</div>
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 12, gap: 12 }}>
            <FileText size={32} style={{ opacity: 0.3 }} />
            <div>No file open</div>
            <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
              <button onClick={() => openFileBrowser("file")}
                style={{ ...btnS, padding: "5px 12px", fontSize: 10, background: "var(--accent-primary)", color: "white", borderRadius: "var(--radius-md)", gap: 5 }}>
                <File size={12} /> Open File
              </button>
              <button onClick={() => openFileBrowser("folder")}
                style={{ ...btnS, padding: "5px 12px", fontSize: 10, background: "var(--bg-active)", color: "var(--text-primary)", borderRadius: "var(--radius-md)", gap: 5 }}>
                <FolderOpenDot size={12} /> Open Folder
              </button>
            </div>
            <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 2 }}>or open files from Explorer / SFTP panel</div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 0, position: "relative" }}>
      {renderBrowser()}
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 6px", background: "var(--bg-tertiary)", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0, flexWrap: "wrap" }}>
        {folderRoot && (
          <button onClick={() => setFolderTreeVisible(!folderTreeVisible)} title={folderTreeVisible ? "Hide tree" : "Show tree"}
            style={{ ...btnS, background: "none", color: "var(--text-muted)", padding: "2px" }}>
            {folderTreeVisible ? <PanelLeftClose size={11} /> : <PanelLeftOpen size={11} />}
          </button>
        )}
        <FileText size={11} style={{ color: "var(--accent-primary)", flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120 }}>
          {file.name}{file.modified ? " *" : ""}
        </span>
        {file.source === "sftp" && <span style={{ fontSize: 7, padding: "1px 3px", borderRadius: 2, background: "rgba(36,150,237,0.15)", color: "#2496ED" }}>SFTP</span>}
        {infra && <span style={{ fontSize: 7, padding: "1px 3px", borderRadius: 2, background: "rgba(16,185,129,0.1)", color: "#10B981", display: "flex", alignItems: "center", gap: 2 }}>{infra.icon} {infra.label}</span>}
        <div style={{ marginLeft: "auto", display: "flex", gap: 2, alignItems: "center" }}>
          <button onClick={() => openFileBrowser("file")} title="Open File"
            style={{ ...btnS, padding: "2px 5px", background: "var(--bg-active)", color: "var(--text-secondary)" }}>
            <File size={8} />
          </button>
          <button onClick={() => openFileBrowser("folder")} title="Open Folder"
            style={{ ...btnS, padding: "2px 5px", background: "var(--bg-active)", color: "var(--text-secondary)" }}>
            <FolderOpenDot size={8} />
          </button>
          {aiLoading && <Loader2 size={9} style={{ color: "var(--accent-primary)", animation: "spin 1s linear infinite" }} />}
          {aiAnalysis && !aiLoading && (
            <button onClick={() => setShowAnalysis(!showAnalysis)}
              style={{ ...btnS, padding: "2px 5px", background: aiAnalysis.includes("✓") ? "rgba(16,185,129,0.1)" : "rgba(245,158,11,0.1)", color: aiAnalysis.includes("✓") ? "#10B981" : "#F59E0B" }}>
              {aiAnalysis.includes("✓") ? <Check size={8} /> : <AlertTriangle size={8} />}
            </button>
          )}
          <button onClick={() => analyzeContent(contentRef.current, file.name)} disabled={aiLoading}
            style={{ ...btnS, padding: "2px 5px", background: "var(--bg-active)", color: "var(--text-secondary)" }} title="AI Analyze">
            <Sparkles size={8} />
          </button>
          <button onClick={saveFile} disabled={saving || !file.modified}
            style={{ ...btnS, padding: "2px 6px", background: file.modified ? "var(--accent-primary)" : "var(--bg-active)", color: file.modified ? "white" : "var(--text-muted)" }}>
            {saving ? <Loader2 size={8} style={{ animation: "spin 1s linear infinite" }} /> : saved ? <Check size={8} /> : <Save size={8} />}
          </button>
          <button onClick={() => { stopLiveLogs(); setFile(null); setAiAnalysis(null); setInfra(null); }}
            style={{ ...btnS, padding: "2px 3px", background: "none", color: "var(--text-muted)" }}><X size={9} /></button>
        </div>
      </div>

      {/* Infra actions bar */}
      {infra && infraOpen && (
        <div style={{ display: "flex", gap: 3, padding: "3px 6px", background: "var(--bg-secondary)", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0, flexWrap: "wrap", alignItems: "center" }}>
          {infra.actions.map((a, i) => (
            <button key={i} onClick={() => runInfraAction(a)} title={a.label}
              style={{ ...btnS, padding: "2px 6px", background: a.dangerous ? "rgba(239,68,68,0.1)" : "var(--bg-active)", color: a.dangerous ? "#EF4444" : "var(--text-secondary)" }}>
              {a.icon} {a.label}
            </button>
          ))}
          {infra.logCommand && (
            <button onClick={liveLogsOpen ? stopLiveLogs : startLiveLogs}
              style={{ ...btnS, padding: "2px 6px", marginLeft: "auto", background: liveLogsOpen ? "rgba(239,68,68,0.1)" : "rgba(16,185,129,0.1)", color: liveLogsOpen ? "#EF4444" : "#10B981" }}>
              <ScrollText size={8} /> {liveLogsOpen ? "Stop Logs" : "Live Logs"}
            </button>
          )}
        </div>
      )}

      {/* AI Analysis */}
      {showAnalysis && aiAnalysis && (
        <div style={{ padding: "4px 8px", fontSize: 10, flexShrink: 0, maxHeight: 80, overflowY: "auto",
          background: aiAnalysis.includes("✓") ? "rgba(16,185,129,0.05)" : "rgba(245,158,11,0.05)",
          borderBottom: "1px solid var(--border-subtle)", fontFamily: "'JetBrains Mono', monospace",
          color: "var(--text-primary)", whiteSpace: "pre-wrap", lineHeight: 1.4,
        }} className="hacking-log-container">
          {aiAnalysis}
        </div>
      )}

      {/* Action output */}
      {actionOutput && (
        <div style={{ flexShrink: 0, maxHeight: 120, borderBottom: "1px solid var(--border-subtle)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 6px", background: "var(--bg-tertiary)" }}>
            {actionLoading && <Loader2 size={9} style={{ animation: "spin 1s linear infinite", color: "var(--accent-primary)" }} />}
            <span style={{ fontSize: 9, fontWeight: 600, color: "var(--text-primary)", flex: 1 }}>{actionOutput.title}</span>
            <button onClick={() => setActionOutput(null)} style={{ ...btnS, background: "none", color: "var(--text-muted)", padding: "1px" }}><X size={8} /></button>
          </div>
          <pre style={{ margin: 0, padding: "4px 8px", fontSize: 9, fontFamily: "'JetBrains Mono', monospace",
            background: "var(--bg-primary)", color: "var(--text-primary)", whiteSpace: "pre-wrap",
            maxHeight: 90, overflowY: "auto",
          }} className="hacking-log-container">{actionOutput.content}</pre>
        </div>
      )}

      {/* Main area: folder tree + editor + optional live logs */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Folder tree panel */}
        {renderFolderPanel()}
        {/* CodeMirror editor */}
        <div ref={editorRef} style={{ flex: 1, overflow: "auto", minWidth: 0 }} />

        {/* Live logs panel */}
        {liveLogsOpen && (
          <div style={{ width: "40%", maxWidth: 280, borderLeft: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", minWidth: 140 }}>
            <div style={{ padding: "3px 6px", background: "var(--bg-tertiary)", fontSize: 9, fontWeight: 600, color: "#10B981", display: "flex", alignItems: "center", gap: 4, flexShrink: 0, borderBottom: "1px solid var(--border-subtle)" }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#10B981", animation: "pulse 2s infinite" }} />
              Live Logs
              <span style={{ fontSize: 7, color: "var(--text-muted)", marginLeft: "auto" }}>{liveLogLines.length} lines</span>
            </div>
            <div ref={logContainerRef} style={{ flex: 1, overflowY: "auto", padding: "4px 6px", fontSize: 9, fontFamily: "'JetBrains Mono', monospace", color: "var(--text-primary)", lineHeight: 1.4 }} className="hacking-log-container">
              {liveLogLines.map((line, i) => (
                <div key={i} style={{ color: line.includes("error") || line.includes("ERROR") || line.includes("fatal") ? "#EF4444" : line.includes("warn") || line.includes("WARN") ? "#F59E0B" : "var(--text-primary)", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                  {line}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
