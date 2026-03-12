import { create } from "zustand";

export type ThemeName = "dark" | "light" | "cyberpunk" | "retro";
export type SidebarTab = "history" | "snippets" | "preview" | "plugins" | "stats" | "ssh" | "debug";

interface Tab {
  id: string;
  title: string;
  shellType: string;
  sessionId: string | null;
}

export type SnippetRunMode = "stop-on-error" | "run-all";

interface Snippet {
  id: string;
  name: string;
  command: string;
  icon?: string;
  runMode?: SnippetRunMode;
  folderId?: string;
}

export interface SnippetFolder {
  id: string;
  name: string;
  color: string;
}

interface HistoryEntry {
  id: string;
  command: string;
  timestamp: number;
  shell: string;
  exitCode?: number;
}

export interface PluginEntry {
  id: string;
  name: string;
  desc: string;
  enabled: boolean;
}

export interface SSHConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  privateKey?: string;
  sessionPassword?: string; // In-memory only, never persisted to disk
  status: "disconnected" | "connecting" | "connected" | "error";
  sessionId?: string;
  errorMessage?: string;
}

export type LogLevel = "error" | "warn" | "info" | "debug" | "trace" | "output";

export interface DebugLogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  message: string;
  source: string; // tab name or SSH connection
}

interface AppState {
  theme: ThemeName;
  themesVisited: string[];
  setTheme: (theme: ThemeName) => void;

  tabs: Tab[];
  activeTabId: string;
  addTab: (shell?: string) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTab: (id: string, updates: Partial<Tab>) => void;

  sidebarOpen: boolean;
  sidebarTab: SidebarTab;
  toggleSidebar: () => void;
  setSidebarTab: (tab: SidebarTab) => void;

  focusMode: boolean;
  toggleFocusMode: () => void;

  history: HistoryEntry[];
  addHistory: (entry: Omit<HistoryEntry, "id" | "timestamp">) => void;
  clearHistory: () => void;

  snippets: Snippet[];
  addSnippet: (snippet: Omit<Snippet, "id">) => void;
  removeSnippet: (id: string) => void;
  moveSnippetToFolder: (snippetId: string, folderId: string | undefined) => void;

  snippetFolders: SnippetFolder[];
  addSnippetFolder: (name: string, color: string) => void;
  removeSnippetFolder: (id: string) => void;
  renameSnippetFolder: (id: string, name: string) => void;

  systemStats: {
    cpu: number;
    memoryUsed: number;
    memoryTotal: number;
    memoryPercent: number;
    processes: number;
  } | null;
  setSystemStats: (stats: AppState["systemStats"]) => void;

  sessionStartTime: number;
  commandCount: number;
  errorCount: number;
  incrementCommandCount: () => void;
  incrementErrorCount: () => void;

  executeSnippet: ((command: string, runMode?: SnippetRunMode) => void) | null;
  setExecuteSnippet: (fn: ((command: string, runMode?: SnippetRunMode) => void) | null) => void;

  plugins: PluginEntry[];
  togglePlugin: (id: string) => void;

  gitBranch: string;
  setGitBranch: (branch: string) => void;

  searchOpen: boolean;
  toggleSearch: () => void;

  suggestions: string[];
  setSuggestions: (s: string[]) => void;

  previewFile: { name: string; content: string; extension: string } | null;
  setPreviewFile: (file: AppState["previewFile"]) => void;

  splitMode: "none" | "horizontal" | "vertical";
  setSplitMode: (mode: AppState["splitMode"]) => void;

  sshConnections: SSHConnection[];
  addSSHConnection: (conn: Omit<SSHConnection, "id" | "status">) => void;
  updateSSHConnection: (id: string, updates: Partial<SSHConnection>) => void;
  removeSSHConnection: (id: string) => void;

  debugLogs: DebugLogEntry[];
  debugEnabled: boolean;
  debugPersist: boolean;
  addDebugLog: (entry: Omit<DebugLogEntry, "id" | "timestamp">) => void;
  clearDebugLogs: () => void;
  toggleDebug: () => void;
  toggleDebugPersist: () => void;
}

let tabCounter = 0;

export const useAppStore = create<AppState>((set, get) => ({
  theme: "dark",
  themesVisited: ["dark"] as string[],
  setTheme: (theme) => set((s) => {
    const visited = s.themesVisited.includes(theme) ? s.themesVisited : [...s.themesVisited, theme];
    return { theme, themesVisited: visited };
  }),

  tabs: [{ id: "tab-0", title: "Terminal 1", shellType: "powershell", sessionId: null }],
  activeTabId: "tab-0",

  addTab: (shell = "powershell") => {
    tabCounter++;
    const id = `tab-${tabCounter}`;
    set((s) => ({
      tabs: [...s.tabs, { id, title: `Terminal ${s.tabs.length + 1}`, shellType: shell, sessionId: null }],
      activeTabId: id,
    }));
  },

  closeTab: (id) => {
    const { tabs, activeTabId } = get();
    if (tabs.length <= 1) return;
    const idx = tabs.findIndex((t) => t.id === id);
    const newTabs = tabs.filter((t) => t.id !== id);
    const newActive = activeTabId === id
      ? newTabs[Math.min(idx, newTabs.length - 1)].id
      : activeTabId;
    set({ tabs: newTabs, activeTabId: newActive });
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  updateTab: (id, updates) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    })),

  sidebarOpen: false,
  sidebarTab: "history",
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarTab: (tab) => set({ sidebarTab: tab, sidebarOpen: true }),

  focusMode: false,
  toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),

  history: [],
  addHistory: (entry) =>
    set((s) => ({
      history: [
        { ...entry, id: crypto.randomUUID(), timestamp: Date.now() },
        ...s.history,
      ].slice(0, 500),
    })),
  clearHistory: () => set({ history: [] }),

  snippets: [
    { id: "s1", name: "Git Status", command: "git status", icon: "git-branch" },
    { id: "s2", name: "List Files", command: "ls -la", icon: "folder" },
    { id: "s3", name: "Docker PS", command: "docker ps", icon: "container" },
    { id: "s4", name: "NPM Install", command: "npm install", icon: "package" },
    { id: "s5", name: "Git Quick Push", command: "git add .\ngit status\ngit commit -m \"update\"\ngit push", icon: "git-branch", runMode: "stop-on-error" },
  ],
  addSnippet: (snippet) =>
    set((s) => ({
      snippets: [...s.snippets, { ...snippet, id: crypto.randomUUID() }],
    })),
  removeSnippet: (id) =>
    set((s) => ({ snippets: s.snippets.filter((sn) => sn.id !== id) })),
  moveSnippetToFolder: (snippetId, folderId) =>
    set((s) => ({
      snippets: s.snippets.map((sn) => sn.id === snippetId ? { ...sn, folderId } : sn),
    })),

  snippetFolders: [],
  addSnippetFolder: (name, color) =>
    set((s) => ({
      snippetFolders: [...s.snippetFolders, { id: crypto.randomUUID(), name, color }],
    })),
  removeSnippetFolder: (id) =>
    set((s) => ({
      snippetFolders: s.snippetFolders.filter((f) => f.id !== id),
      // Move orphaned snippets to root
      snippets: s.snippets.map((sn) => sn.folderId === id ? { ...sn, folderId: undefined } : sn),
    })),
  renameSnippetFolder: (id, name) =>
    set((s) => ({
      snippetFolders: s.snippetFolders.map((f) => f.id === id ? { ...f, name } : f),
    })),

  systemStats: null,
  setSystemStats: (stats) => set({ systemStats: stats }),

  sessionStartTime: Date.now(),
  commandCount: 0,
  errorCount: 0,
  incrementCommandCount: () => set((s) => ({ commandCount: s.commandCount + 1 })),
  incrementErrorCount: () => set((s) => ({ errorCount: s.errorCount + 1 })),

  executeSnippet: null,
  setExecuteSnippet: (fn) => set({ executeSnippet: fn }),

  plugins: [
    { id: "git", name: "Git Integration", desc: "Branch, status, diff viewer", enabled: true },
    { id: "docker", name: "Docker", desc: "Container management & logs", enabled: true },
    { id: "k8s", name: "Kubernetes", desc: "Pod management & monitoring", enabled: false },
    { id: "python", name: "Python REPL", desc: "Inline Python execution", enabled: true },
    { id: "node", name: "Node.js Tools", desc: "NPM scripts, package info", enabled: false },
    { id: "ssh", name: "SSH Manager", desc: "Saved connections & tunnels", enabled: false },
  ],
  togglePlugin: (id) =>
    set((s) => ({
      plugins: s.plugins.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)),
    })),

  gitBranch: "main",
  setGitBranch: (branch) => set({ gitBranch: branch }),

  searchOpen: false,
  toggleSearch: () => set((s) => ({ searchOpen: !s.searchOpen })),

  suggestions: [],
  setSuggestions: (suggestions) => set({ suggestions }),

  previewFile: null,
  setPreviewFile: (previewFile) => set({ previewFile }),

  splitMode: "none",
  setSplitMode: (splitMode) => set({ splitMode }),

  sshConnections: (() => {
    try {
      const saved = localStorage.getItem("novaterm-ssh-connections");
      if (saved) {
        const parsed = JSON.parse(saved) as SSHConnection[];
        return parsed.map((c) => ({ ...c, status: "disconnected" as const, sessionId: undefined, errorMessage: undefined }));
      }
    } catch {}
    return [];
  })(),

  addSSHConnection: (conn) => {
    const newConn: SSHConnection = { ...conn, id: crypto.randomUUID(), status: "disconnected" };
    set((s) => {
      const updated = [...s.sshConnections, newConn];
      localStorage.setItem("novaterm-ssh-connections", JSON.stringify(updated.map(({ status, sessionId, errorMessage, sessionPassword, ...rest }) => rest)));
      return { sshConnections: updated };
    });
  },

  updateSSHConnection: (id, updates) =>
    set((s) => {
      const updated = s.sshConnections.map((c) => (c.id === id ? { ...c, ...updates } : c));
      localStorage.setItem("novaterm-ssh-connections", JSON.stringify(updated.map(({ status, sessionId, errorMessage, sessionPassword, ...rest }) => rest)));
      return { sshConnections: updated };
    }),

  removeSSHConnection: (id) =>
    set((s) => {
      const updated = s.sshConnections.filter((c) => c.id !== id);
      localStorage.setItem("novaterm-ssh-connections", JSON.stringify(updated.map(({ status, sessionId, errorMessage, sessionPassword, ...rest }) => rest)));
      return { sshConnections: updated };
    }),

  debugLogs: [],
  debugEnabled: false,
  debugPersist: (() => {
    try { return localStorage.getItem("novaterm-debug-persist") !== "false"; } catch { return true; }
  })(),
  addDebugLog: (entry) =>
    set((s) => {
      if (!s.debugEnabled) return s;
      const newEntry: DebugLogEntry = {
        ...entry,
        id: crypto.randomUUID(),
        timestamp: Date.now(),
      };
      const logs = [newEntry, ...s.debugLogs];
      if (logs.length > 1000) logs.length = 1000;
      // Queue for disk persistence
      if (s.debugPersist) {
        debugPersistQueue.push(newEntry);
        scheduleFlush();
      }
      return { debugLogs: logs };
    }),
  clearDebugLogs: () => set({ debugLogs: [] }),
  toggleDebug: () => set((s) => ({ debugEnabled: !s.debugEnabled })),
  toggleDebugPersist: () => set((s) => {
    const next = !s.debugPersist;
    localStorage.setItem("novaterm-debug-persist", String(next));
    return { debugPersist: next };
  }),
}));

// === Batched disk persistence for debug logs ===
const debugPersistQueue: DebugLogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flushToDisk, 2000);
}

async function flushToDisk() {
  flushTimer = null;
  if (debugPersistQueue.length === 0) return;
  const batch = debugPersistQueue.splice(0, debugPersistQueue.length);
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("debug_log_save", {
      entries: batch.map((e) => ({
        id: e.id,
        timestamp: e.timestamp,
        level: e.level,
        message: e.message,
        source: e.source,
      })),
    });
  } catch {
    // If save fails, don't crash — logs are still in memory
  }
}

// Flush on page unload
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    if (debugPersistQueue.length > 0) {
      flushToDisk();
    }
  });
}
