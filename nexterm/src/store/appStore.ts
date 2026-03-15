import { create } from "zustand";

export type ThemeName = "dark" | "light" | "cyberpunk" | "retro" | "hacking";
export type SidebarTab = "history" | "snippets" | "preview" | "plugins" | "stats" | "ssh" | "sftp" | "servermap" | "debug" | "ai" | "docs" | "hacking";

// === Hacking Mode Types ===
export type HackingLogLevel = "recon" | "exploit" | "alert" | "info" | "success" | "danger";
export type HackingCategory = "network" | "system" | "exploit" | "ai" | "general";

export interface HackingLogEntry {
  id: string;
  timestamp: number;
  level: HackingLogLevel;
  message: string;
  source: string;
  category: HackingCategory;
}

export interface EnvironmentInfo {
  type: "local" | "ssh" | "docker" | "wsl" | "vm";
  os: string;
  hostname: string;
  ip: string;
  vulnerabilityHints: string[];
}

export interface PortInfo {
  port: number;
  protocol: string;
  service: string;
  version: string;
  state: "open" | "filtered" | "closed";
  risk: "low" | "medium" | "high" | "critical";
}

export interface ServiceInfo {
  name: string;
  version: string;
  port: number;
  vulnerabilities: string[];
}

export interface ReconResult {
  environment: EnvironmentInfo;
  openPorts: PortInfo[];
  services: ServiceInfo[];
  networkMap: string;
  timestamp: number;
}

export interface CommandSnapshot {
  id: string;
  timestamp: number;
  command: string;
  output: string;
  canRollback: boolean;
  rollbackCommand?: string;
}

export interface HackingAlert {
  id: string;
  timestamp: number;
  severity: "info" | "warning" | "critical";
  title: string;
  details: string;
  category: string;
}

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
  screenshot?: string; // base64 PNG data URI of terminal at execution time
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

export type AiMode = "chat" | "explain" | "generate" | "fix";

export interface AiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode: AiMode;
  timestamp: number;
}

// === File-based persistence (survives app updates) ===
interface PersistedConfig {
  theme?: ThemeName;
  snippets?: Snippet[];
  snippetFolders?: SnippetFolder[];
  sshConnections?: Array<Omit<SSHConnection, "status" | "sessionId" | "errorMessage" | "sessionPassword">>;
  plugins?: PluginEntry[];
  history?: HistoryEntry[];
  debugPersist?: boolean;
}

let configLoaded = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

async function loadConfig(): Promise<PersistedConfig> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const raw = await invoke<string>("load_app_config");
    return JSON.parse(raw) as PersistedConfig;
  } catch {
    return {};
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const s = useAppStore.getState();
    const config: PersistedConfig = {
      theme: s.theme,
      snippets: s.snippets,
      snippetFolders: s.snippetFolders,
      sshConnections: s.sshConnections.map(({ status, sessionId, errorMessage, sessionPassword, ...rest }) => rest),
      plugins: s.plugins,
      history: s.history.slice(0, 200).map(({ screenshot, ...rest }) => rest), // persist last 200, strip screenshots
      debugPersist: s.debugPersist,
    };
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke("save_app_config", { data: JSON.stringify(config, null, 2) }).catch(() => {});
    }).catch(() => {});
  }, 500);
}

// Also migrate old localStorage data on first load
function migrateLocalStorage(): Partial<PersistedConfig> {
  const migrated: Partial<PersistedConfig> = {};
  try {
    const savedSSH = localStorage.getItem("novashell-ssh-connections");
    if (savedSSH) {
      migrated.sshConnections = JSON.parse(savedSSH);
      localStorage.removeItem("novashell-ssh-connections");
    }
    const savedDebug = localStorage.getItem("novashell-debug-persist");
    if (savedDebug !== null) {
      migrated.debugPersist = savedDebug !== "false";
      localStorage.removeItem("novashell-debug-persist");
    }
  } catch {}
  return migrated;
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
  updateSnippet: (id: string, updates: Partial<Snippet>) => void;
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

  // Metrics history for performance sparklines (last 60 snapshots)
  metricsHistory: { cpu: number[]; memory: number[] };
  addMetricsSnapshot: (cpu: number, memory: number) => void;

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

  // AI Assistant
  aiMessages: AiMessage[];
  aiLoading: boolean;
  addAiMessage: (msg: Omit<AiMessage, "id" | "timestamp">) => void;
  clearAiMessages: () => void;
  setAiLoading: (loading: boolean) => void;

  // Hacking Mode
  hackingMode: boolean;
  hackingPreviousTheme: ThemeName;
  toggleHackingMode: () => void;
  hackingLogs: HackingLogEntry[];
  addHackingLog: (entry: Omit<HackingLogEntry, "id" | "timestamp">) => void;
  clearHackingLogs: () => void;
  hackingReconResults: ReconResult | null;
  setHackingReconResults: (results: ReconResult | null) => void;
  hackingSnapshots: CommandSnapshot[];
  addHackingSnapshot: (snapshot: Omit<CommandSnapshot, "id" | "timestamp">) => void;
  hackingAlerts: HackingAlert[];
  addHackingAlert: (alert: Omit<HackingAlert, "id" | "timestamp">) => void;
  clearHackingAlerts: () => void;
  dismissHackingAlert: (id: string) => void;

  // Hydration from config file
  _hydrateFromConfig: (config: PersistedConfig) => void;
}

const DEFAULT_SNIPPETS: Snippet[] = [
  { id: "s1", name: "Git Status", command: "git status", icon: "git-branch" },
  { id: "s2", name: "List Files", command: "ls -la", icon: "folder" },
  { id: "s3", name: "Docker PS", command: "docker ps", icon: "container" },
  { id: "s4", name: "NPM Install", command: "npm install", icon: "package" },
  { id: "s5", name: "Git Quick Push", command: "git add .\ngit status\ngit commit -m \"update\"\ngit push", icon: "git-branch", runMode: "stop-on-error" },
];

const DEFAULT_PLUGINS: PluginEntry[] = [
  { id: "git", name: "Git Integration", desc: "Repository status, changed files, recent commits", enabled: true },
  { id: "docker", name: "Docker", desc: "Running containers & images", enabled: false },
  { id: "node", name: "Node.js", desc: "Package info & npm scripts", enabled: false },
  { id: "python", name: "Python", desc: "Python version & environment info", enabled: false },
  { id: "system", name: "System Info", desc: "Network, disk usage & uptime", enabled: false },
];

let tabCounter = 0;

export const useAppStore = create<AppState>((set, get) => ({
  theme: "dark",
  themesVisited: ["dark"] as string[],
  setTheme: (theme) => set((s) => {
    const visited = s.themesVisited.includes(theme) ? s.themesVisited : [...s.themesVisited, theme];
    scheduleSave();
    return { theme, themesVisited: visited };
  }),

  tabs: [{ id: "tab-0", title: "Terminal 1", shellType: navigator.platform.startsWith("Win") ? "powershell.exe" : "/bin/bash", sessionId: null }],
  activeTabId: "tab-0",

  addTab: (shell = navigator.platform.startsWith("Win") ? "powershell.exe" : "/bin/bash") => {
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
  addHistory: (entry) => {
    set((s) => ({
      history: [
        { ...entry, id: crypto.randomUUID(), timestamp: Date.now() },
        ...s.history,
      ].slice(0, 500),
    }));
    scheduleSave();
  },
  clearHistory: () => { set({ history: [] }); scheduleSave(); },

  snippets: [...DEFAULT_SNIPPETS],
  addSnippet: (snippet) => {
    set((s) => ({
      snippets: [...s.snippets, { ...snippet, id: crypto.randomUUID() }],
    }));
    scheduleSave();
  },
  removeSnippet: (id) => {
    set((s) => ({ snippets: s.snippets.filter((sn) => sn.id !== id) }));
    scheduleSave();
  },
  updateSnippet: (id, updates) => {
    set((s) => ({
      snippets: s.snippets.map((sn) => sn.id === id ? { ...sn, ...updates } : sn),
    }));
    scheduleSave();
  },
  moveSnippetToFolder: (snippetId, folderId) => {
    set((s) => ({
      snippets: s.snippets.map((sn) => sn.id === snippetId ? { ...sn, folderId } : sn),
    }));
    scheduleSave();
  },

  snippetFolders: [],
  addSnippetFolder: (name, color) => {
    set((s) => ({
      snippetFolders: [...s.snippetFolders, { id: crypto.randomUUID(), name, color }],
    }));
    scheduleSave();
  },
  removeSnippetFolder: (id) => {
    set((s) => ({
      snippetFolders: s.snippetFolders.filter((f) => f.id !== id),
      snippets: s.snippets.map((sn) => sn.folderId === id ? { ...sn, folderId: undefined } : sn),
    }));
    scheduleSave();
  },
  renameSnippetFolder: (id, name) => {
    set((s) => ({
      snippetFolders: s.snippetFolders.map((f) => f.id === id ? { ...f, name } : f),
    }));
    scheduleSave();
  },

  systemStats: null,
  setSystemStats: (stats) => {
    set({ systemStats: stats });
    // Also record metrics history for sparklines
    if (stats) {
      get().addMetricsSnapshot(stats.cpu, stats.memoryPercent);
    }
  },

  metricsHistory: { cpu: [], memory: [] },
  addMetricsSnapshot: (cpu, memory) => set((s) => {
    const maxPoints = 60;
    const cpuArr = [...s.metricsHistory.cpu, cpu];
    const memArr = [...s.metricsHistory.memory, memory];
    if (cpuArr.length > maxPoints) cpuArr.splice(0, cpuArr.length - maxPoints);
    if (memArr.length > maxPoints) memArr.splice(0, memArr.length - maxPoints);
    return { metricsHistory: { cpu: cpuArr, memory: memArr } };
  }),

  sessionStartTime: Date.now(),
  commandCount: 0,
  errorCount: 0,
  incrementCommandCount: () => set((s) => ({ commandCount: s.commandCount + 1 })),
  incrementErrorCount: () => set((s) => ({ errorCount: s.errorCount + 1 })),

  executeSnippet: null,
  setExecuteSnippet: (fn) => set({ executeSnippet: fn }),

  plugins: [...DEFAULT_PLUGINS],
  togglePlugin: (id) => {
    set((s) => ({
      plugins: s.plugins.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)),
    }));
    scheduleSave();
  },

  gitBranch: "",
  setGitBranch: (branch) => set({ gitBranch: branch }),

  searchOpen: false,
  toggleSearch: () => set((s) => ({ searchOpen: !s.searchOpen })),

  suggestions: [],
  setSuggestions: (suggestions) => set({ suggestions }),

  previewFile: null,
  setPreviewFile: (previewFile) => set({ previewFile }),

  splitMode: "none",
  setSplitMode: (splitMode) => set({ splitMode }),

  sshConnections: [],

  addSSHConnection: (conn) => {
    const newConn: SSHConnection = { ...conn, id: crypto.randomUUID(), status: "disconnected" };
    set((s) => ({ sshConnections: [...s.sshConnections, newConn] }));
    scheduleSave();
  },

  updateSSHConnection: (id, updates) => {
    set((s) => ({
      sshConnections: s.sshConnections.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    }));
    // Only save if non-runtime fields changed
    if (updates.name || updates.host || updates.port || updates.username || updates.privateKey) {
      scheduleSave();
    }
  },

  removeSSHConnection: (id) => {
    set((s) => ({ sshConnections: s.sshConnections.filter((c) => c.id !== id) }));
    scheduleSave();
  },

  debugLogs: [],
  debugEnabled: true,
  debugPersist: true,
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
  toggleDebug: () => {
    set((s) => ({ debugEnabled: !s.debugEnabled }));
    scheduleSave();
  },
  toggleDebugPersist: () => {
    set((s) => ({ debugPersist: !s.debugPersist }));
    scheduleSave();
  },

  // Hacking Mode
  hackingMode: false,
  hackingPreviousTheme: "dark" as ThemeName,
  toggleHackingMode: () => {
    const s = get();
    if (!s.hackingMode) {
      // Activate: save current theme, switch to hacking theme
      set({
        hackingMode: true,
        hackingPreviousTheme: s.theme,
        theme: "hacking" as ThemeName,
        sidebarTab: "hacking",
        sidebarOpen: true,
      });
      import("../utils/hackingAlerts").then((m) => m.startSecurityMonitor());
    } else {
      // Deactivate: restore previous theme
      set({
        hackingMode: false,
        theme: s.hackingPreviousTheme,
      });
      import("../utils/hackingAlerts").then((m) => m.stopSecurityMonitor());
    }
    scheduleSave();
  },
  hackingLogs: [],
  addHackingLog: (entry) => set((s) => {
    const newEntry: HackingLogEntry = {
      ...entry,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    };
    const logs = [newEntry, ...s.hackingLogs];
    if (logs.length > 500) logs.length = 500;
    return { hackingLogs: logs };
  }),
  clearHackingLogs: () => set({ hackingLogs: [] }),
  hackingReconResults: null,
  setHackingReconResults: (results) => set({ hackingReconResults: results }),
  hackingSnapshots: [],
  addHackingSnapshot: (snapshot) => set((s) => ({
    hackingSnapshots: [
      { ...snapshot, id: crypto.randomUUID(), timestamp: Date.now() },
      ...s.hackingSnapshots,
    ].slice(0, 100),
  })),
  hackingAlerts: [],
  addHackingAlert: (alert) => set((s) => {
    const newAlert: HackingAlert = {
      ...alert,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    };
    const alerts = [newAlert, ...s.hackingAlerts];
    if (alerts.length > 200) alerts.length = 200;
    return { hackingAlerts: alerts };
  }),
  clearHackingAlerts: () => set({ hackingAlerts: [] }),
  dismissHackingAlert: (id) => set((s) => ({
    hackingAlerts: s.hackingAlerts.filter((a) => a.id !== id),
  })),

  aiMessages: [],
  aiLoading: false,
  addAiMessage: (msg) => set((s) => ({
    aiMessages: [...s.aiMessages, { ...msg, id: crypto.randomUUID(), timestamp: Date.now() }],
  })),
  clearAiMessages: () => set({ aiMessages: [] }),
  setAiLoading: (loading) => set({ aiLoading: loading }),

  _hydrateFromConfig: (config) => {
    const updates: Partial<AppState> = {};
    if (config.theme) updates.theme = config.theme;
    if (config.snippets && config.snippets.length > 0) updates.snippets = config.snippets;
    if (config.snippetFolders) updates.snippetFolders = config.snippetFolders;
    if (config.plugins && config.plugins.length > 0) updates.plugins = config.plugins;
    if (config.history) updates.history = config.history;
    // debugEnabled is intentionally NOT restored — always starts ON
    if (config.debugPersist !== undefined) updates.debugPersist = config.debugPersist;
    if (config.sshConnections && config.sshConnections.length > 0) {
      updates.sshConnections = config.sshConnections.map((c) => ({
        ...c,
        status: "disconnected" as const,
        sessionId: undefined,
        errorMessage: undefined,
      }));
    }
    set(updates);
  },
}));

// === Load config on startup ===
(async () => {
  // First migrate any old localStorage data
  const migrated = migrateLocalStorage();

  // Load config from file
  const config = await loadConfig();

  // Merge: file config takes priority, localStorage migration fills gaps
  const merged: PersistedConfig = { ...config };
  if (!merged.sshConnections && migrated.sshConnections) {
    merged.sshConnections = migrated.sshConnections;
  }
  if (merged.debugPersist === undefined && migrated.debugPersist !== undefined) {
    merged.debugPersist = migrated.debugPersist;
  }

  useAppStore.getState()._hydrateFromConfig(merged);
  configLoaded = true;

  // If we migrated localStorage data, save it to the file immediately
  if (Object.keys(migrated).length > 0) {
    scheduleSave();
  }
})();

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

// Flush ALL pending data on page unload (config + debug logs)
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    // Flush config save immediately (synchronous)
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      const s = useAppStore.getState();
      const config: PersistedConfig = {
        theme: s.theme,
        snippets: s.snippets,
        snippetFolders: s.snippetFolders,
        sshConnections: s.sshConnections.map(({ status, sessionId, errorMessage, sessionPassword, ...rest }) => rest),
        plugins: s.plugins,
        history: s.history.slice(0, 200),
        debugPersist: s.debugPersist,
      };
      // Use synchronous XHR-style approach via navigator.sendBeacon isn't available for Tauri
      // Fire and forget — the invoke will execute before the page unloads
      import("@tauri-apps/api/core").then(({ invoke }) => {
        invoke("save_app_config", { data: JSON.stringify(config, null, 2) });
      }).catch(() => {});
    }
    if (debugPersistQueue.length > 0) {
      flushToDisk();
    }
  });
}
