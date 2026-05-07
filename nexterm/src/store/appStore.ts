import { create } from "zustand";

export type ThemeName = "dark" | "light" | "cyberpunk" | "retro" | "hacking" | "custom";

export interface CustomThemeColors {
  bgPrimary: string;
  bgSecondary: string;
  textPrimary: string;
  accentPrimary: string;
  accentSecondary: string;
  terminalBg: string;
  terminalFg: string;
  terminalCursor: string;
}
export type SidebarTab = "history" | "snippets" | "preview" | "plugins" | "stats";
export type PanelTabType = "ssh" | "sftp" | "rdp" | "editor" | "ai" | "debug" | "hacking" | "infra" | "collab" | "servermap" | "docs" | "backups" | "code";
export type AppLanguage = "en" | "es";

// === Backup Manager Types ===
export interface BackupTemplate {
  id: string;
  name: string;
  category: "database" | "system" | "custom";
  engine: string;
  command: string;
  description: string;
}

export interface BackupJob {
  id: string;
  name: string;
  connectionId: string;
  templateId: string | null;
  command: string;
  remotePath: string;
  downloadLocal: boolean;
  localPath: string;
  schedule: string | null;
  enabled: boolean;
  lastRun: number | null;
  lastStatus: "success" | "failed" | null;
  // Notifications
  notifyEmail: boolean;
  notifyTelegram: boolean;
  notifyOn: "always" | "failure" | "success";
  // Cloud upload
  cloudEnabled: boolean;
  cloudCommand: string; // e.g. rclone copy {FILE} remote:backups/
}

export interface BackupSmtpConfig {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  password: string;
  fromAddress: string;
  toAddress: string;
  useTls: boolean;
}

export interface BackupTelegramConfig {
  enabled: boolean;
  botToken: string;
  chatId: string;
}

export interface BackupRecord {
  id: string;
  jobId: string;
  jobName: string;
  serverName: string;
  timestamp: number;
  status: "success" | "failed" | "running";
  duration: number;
  sizeMB: number;
  output: string;
  error: string | null;
  downloaded: boolean;
}

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

export interface Tab {
  id: string;
  title: string;
  type: "terminal" | PanelTabType;
  shellType: string;
  sessionId: string | null;
  sshConnectionId?: string; // If set, this terminal tab is an SSH session
  // One-shot command sent to the shell once it has spawned. Used by the Code
  // panel to launch an AI agent inside a fresh terminal. TerminalPanel reads
  // it after spawn, writes it via the existing write-queue, then clears it.
  initialCommand?: string;
}

// === Code Panel — launchable AI coding agents ===
export type CodeEditMode = "manual" | "auto-accept" | "plan";

export interface CodeSession {
  id: string;
  name: string;
  // Where to run the agent: a local PTY or an SSH connection
  target: { kind: "local" } | { kind: "ssh"; sshConnectionId: string };
  agentId: string;       // matches CODE_AGENTS[].id
  workingDir: string;    // empty string = home dir
  // How the agent should treat edits/commands when launched. Maps to a CLI
  // flag per agent (Claude --dangerously-skip-permissions, Gemini --yolo, etc).
  // Default 'manual' = ask before every edit/command (the agent's normal default).
  editMode: CodeEditMode;
  lastUsed: number | null;
  // Detection cache (UI hint only — never trusted as ground truth):
  installedHint?: "yes" | "no" | "unknown";
  installedCheckedAt?: number;
}

export type SnippetRunMode = "stop-on-error" | "run-all";

interface Snippet {
  id: string;
  name: string;
  command: string;
  icon?: string;
  runMode?: SnippetRunMode;
  folderId?: string;
  subFolderId?: string;
  variables?: Array<{ name: string; defaultValue: string }>;
}

export interface SharedSubFolder {
  id: string;
  name: string;
  color: string;
}

// Config versioning
export interface ConfigVersion {
  id: string;
  connectionId: string;
  serverName: string;
  filePath: string;
  content: string;
  timestamp: number;
}

// Batch executor
export interface BatchOperation {
  id: string;
  name: string;
  steps: Array<{ serverId: string; serverName: string; command: string; status: "pending" | "running" | "success" | "failed" | "skipped"; output?: string }>;
  checkpointEvery: number;
  rollbackOnFail: boolean;
  status: "idle" | "running" | "paused" | "completed" | "failed";
  currentStep: number;
}

// Performance baseline
export interface PerformanceBaseline {
  connectionId: string;
  cpuAvg: number;
  memAvg: number;
  diskAvg: number;
  sampleCount: number;
  lastUpdated: number;
}

export interface SnippetFolder {
  id: string;
  name: string;
  color: string;
  sharedPath?: string;
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

export interface RDPConnection {
  id: string;
  name: string;
  host: string;
  port: number;          // default 3389
  username: string;
  domain?: string;
  fullscreen?: boolean;
  width?: number;        // ignored when fullscreen
  height?: number;       // ignored when fullscreen
  multimon?: boolean;
  admin?: boolean;       // /admin (console session)
  sessionPassword?: string; // In-memory only, never persisted to disk
  status: "disconnected" | "launching" | "error";
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

// === Cross-Server Navigation Types ===
export interface ServerContext {
  type: "local" | "ssh";
  connectionId?: string;
  sessionId: string;
  serverName: string;
}

// === Infrastructure Monitor Types ===
export interface ServerMetrics {
  timestamp: number;
  cpu: number;
  memPercent: number;
  memUsedMB: number;
  memTotalMB: number;
  diskPercent: number;
  netRxBytes: number;
  netTxBytes: number;
  loadAvg: [number, number, number];
  topProcesses: { name: string; cpu: number; mem: number }[];
  failedServices: string[];
  uptimeSecs: number;
  activeConnections: number;
}

export interface InfraAlert {
  id: string;
  timestamp: number;
  connectionId: string;
  serverName: string;
  severity: "warning" | "critical";
  metric: "cpu" | "memory" | "disk" | "service" | "anomaly";
  value: number;
  message: string;
  acknowledged: boolean;
}

export interface InfraTimelineEvent {
  id: string;
  timestamp: number;
  connectionId: string;
  serverName: string;
  type: "alert" | "metric" | "action" | "connection";
  severity?: "info" | "warning" | "critical";
  message: string;
}

export interface InfraThresholds {
  cpuWarning: number;
  cpuCritical: number;
  memWarning: number;
  memCritical: number;
  diskWarning: number;
  diskCritical: number;
}

// === Disk Analyzer Types (CCleaner-style) ===
export interface DiskPartition {
  mount: string;
  device: string;
  totalGB: number;
  usedGB: number;
  freeGB: number;
  usedPercent: number;
  fsType: string;
}

export interface DiskCategoryAction {
  label: string;
  cmd: string;
  danger?: boolean;
}

export interface DiskCategory {
  id: string;
  name: string;
  icon: string;
  sizeMB: number;
  items: number;
  reclaimable: boolean;
  cleanCmd?: string;
  previewCmd?: string;
  actions?: DiskCategoryAction[];
  description: string;
}

export interface DiskLargestDir {
  path: string;
  sizeMB: number;
}

export interface DiskAnalysis {
  connectionId: string;
  timestamp: number;
  partitions: DiskPartition[];
  categories: DiskCategory[];
  largestDirs: DiskLargestDir[];
  totalReclaimableMB: number;
}

// Disk growth tracking — stores previous scan sizes per connection
export interface DiskGrowthEntry {
  path: string;
  prevSizeMB: number;
  currSizeMB: number;
  deltaMB: number;
  timestamp: number;
}

// === Collaborative Terminal Types ===
export type CollabRole = "host" | "guest";
export type CollabPermission = "ReadOnly" | "FullControl";

export interface CollabUser {
  id: string;
  name: string;
  permission: CollabPermission;
  is_host: boolean;
}

export interface CollabChatMessage {
  id: string;
  sender: string;
  content: string;
  timestamp: number;
}

export interface CollabSessionInfo {
  id: string;                   // PTY session ID (host) or collab_id (guest)
  tabId: string;
  role: CollabRole;
  sessionCode: string;
  hostAddress: string;
  port: number;
  hostName: string;
  guestName?: string;           // Only for guest sessions — the local user's display name
  users: CollabUser[];
  chatMessages: CollabChatMessage[];
  status: "connecting" | "active" | "disconnected" | "error";
  errorMessage?: string;
  terminalSize?: { cols: number; rows: number };
}

// === File-based persistence (survives app updates) ===
interface PersistedConfig {
  theme?: ThemeName;
  customTheme?: CustomThemeColors;
  snippets?: Snippet[];
  snippetFolders?: SnippetFolder[];
  sshConnections?: Array<Omit<SSHConnection, "status" | "sessionId" | "errorMessage" | "sessionPassword">>;
  rdpConnections?: Array<Omit<RDPConnection, "status" | "errorMessage" | "sessionPassword">>;
  codeSessions?: CodeSession[];
  plugins?: PluginEntry[];
  history?: HistoryEntry[];
  debugPersist?: boolean;
  language?: AppLanguage;
  customExploits?: Array<{ id: string; name: string; description: string; category: string; risk: string; commands: string[] }>;
  workspaces?: Array<{ id: string; name: string; tabCount: number; splitMode: string; sidebarTab: string }>;
  backupJobs?: BackupJob[];
  backupHistory?: BackupRecord[];
  backupSmtp?: BackupSmtpConfig;
  backupTelegram?: BackupTelegramConfig;
}

let configLoaded = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

async function loadConfig(): Promise<PersistedConfig> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    // Pre-cache invoke so beforeunload can call it without an async import
    // race. Without this, closing the app before any save mutation has
    // happened leaves cachedInvoke=null and config never persists.
    cachedInvoke = invoke;
    const raw = await invoke<string>("load_app_config");
    return JSON.parse(raw) as PersistedConfig;
  } catch {
    return {};
  }
}

// Cache the invoke function so beforeunload can call it synchronously
let cachedInvoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;

function buildPersistedConfig(): PersistedConfig {
  const s = useAppStore.getState();
  return {
    theme: s.theme,
    customTheme: s.customTheme,
    snippets: s.snippets,
    snippetFolders: s.snippetFolders,
    sshConnections: s.sshConnections.map(({ status, sessionId, errorMessage, sessionPassword, ...rest }) => rest),
    rdpConnections: s.rdpConnections.length > 0
      ? s.rdpConnections.map(({ status, errorMessage, sessionPassword, ...rest }) => rest)
      : undefined,
    codeSessions: s.codeSessions.length > 0 ? s.codeSessions : undefined,
    plugins: s.plugins,
    history: s.history.slice(0, 200).map(({ screenshot, ...rest }) => rest),
    debugPersist: s.debugPersist,
    language: s.language,
    customExploits: s.customExploits.length > 0 ? s.customExploits : undefined,
    workspaces: s.workspaces.length > 0 ? s.workspaces : undefined,
    backupJobs: s.backupJobs.length > 0 ? s.backupJobs : undefined,
    backupHistory: s.backupHistory.length > 0 ? s.backupHistory.slice(0, 200) : undefined,
    backupSmtp: s.backupSmtp.enabled ? s.backupSmtp : undefined,
    backupTelegram: s.backupTelegram.enabled ? s.backupTelegram : undefined,
  };
}

let lastSavedJson = "";

function scheduleSave() {
  if (!configLoaded) return; // Don't save until initial config is loaded — prevents overwriting
  if (saveTimer) clearTimeout(saveTimer);
  // 800ms debounce: small enough that closing the app rarely loses data,
  // large enough to coalesce bursts of edits (terminal typing, resize, etc.)
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const config = buildPersistedConfig();
    const json = JSON.stringify(config);
    if (json === lastSavedJson) return; // Skip if unchanged
    lastSavedJson = json;
    if (cachedInvoke) {
      cachedInvoke("save_app_config", { data: json }).catch(() => {});
    } else {
      import("@tauri-apps/api/core").then(({ invoke }) => {
        cachedInvoke = invoke;
        invoke("save_app_config", { data: json }).catch(() => {});
      }).catch(() => {});
    }
  }, 800);
}

// Save shared folder data (snippets + subFolders) to its JSON file
async function _saveSharedFile(path: string, folderId: string) {
  const s = useAppStore.getState();
  const data = JSON.stringify({
    subFolders: s.sharedSubFolders[folderId] || [],
    snippets: s.sharedSnippets[folderId] || [],
  });
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("save_shared_snippets", { path, data });
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
  customTheme: CustomThemeColors;
  setCustomThemeColor: (key: keyof CustomThemeColors, value: string) => void;

  language: AppLanguage;
  setLanguage: (lang: AppLanguage) => void;

  tabs: Tab[];
  activeTabId: string;
  addTab: (shell?: string, initialCommand?: string) => void;
  addSSHTab: (connectionId: string, initialCommand?: string) => void;
  openPanelTab: (panelType: PanelTabType) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTab: (id: string, updates: Partial<Tab>) => void;

  sidebarOpen: boolean;
  sidebarTab: SidebarTab;
  toggleSidebar: () => void;
  setSidebarTab: (tab: SidebarTab) => void;

  pendingEditorFile: { path: string; name: string; content: string; source: "local" | "sftp"; sftpSessionId?: string; sshHost?: string; sshPort?: number; sshUsername?: string; sshPassword?: string | null; sshPrivateKey?: string | null } | null;
  setPendingEditorFile: (file: AppState["pendingEditorFile"]) => void;

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

  // Shared snippet folders
  sharedSnippets: Record<string, Snippet[]>;
  sharedSubFolders: Record<string, SharedSubFolder[]>;
  loadSharedFolder: (folderId: string) => Promise<void>;
  addSharedSnippet: (folderId: string, snippet: Omit<Snippet, "id">) => Promise<void>;
  removeSharedSnippet: (folderId: string, snippetId: string) => Promise<void>;
  updateSharedSnippet: (folderId: string, snippetId: string, updates: Partial<Snippet>) => Promise<void>;
  addSharedSnippetFolder: (name: string, color: string, sharedPath: string) => Promise<void>;
  addSharedSubFolder: (folderId: string, name: string, color: string) => Promise<void>;
  removeSharedSubFolder: (folderId: string, subFolderId: string) => Promise<void>;
  renameSharedSubFolder: (folderId: string, subFolderId: string, name: string) => Promise<void>;

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

  rdpConnections: RDPConnection[];
  addRDPConnection: (conn: Omit<RDPConnection, "id" | "status">) => void;
  updateRDPConnection: (id: string, updates: Partial<RDPConnection>) => void;
  removeRDPConnection: (id: string) => void;

  // Code panel — AI agent launch sessions
  codeSessions: CodeSession[];
  addCodeSession: (sess: Omit<CodeSession, "id" | "lastUsed">) => void;
  updateCodeSession: (id: string, updates: Partial<CodeSession>) => void;
  removeCodeSession: (id: string) => void;
  launchCodeSession: (id: string, agentLaunchCmd: string) => void;
  // Cross-component signal: when set, SSHPanel auto-triggers startConnect
  // for this connection (opens password prompt if needed). Used by TabBar
  // and TerminalPanel to recover from "no credentials" on saved connections.
  pendingSSHConnectId: string | null;
  requestSSHConnect: (connectionId: string) => void;
  clearPendingSSHConnect: () => void;

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
  workspaces: Array<{ id: string; name: string; tabCount: number; splitMode: string; sidebarTab: string }>;
  saveWorkspace: (name: string) => void;
  loadWorkspace: (id: string) => void;
  removeWorkspace: (id: string) => void;

  // Config versioning
  configVersions: ConfigVersion[];
  addConfigVersion: (version: Omit<ConfigVersion, "id" | "timestamp">) => void;
  getConfigHistory: (connectionId: string, filePath: string) => ConfigVersion[];

  // Batch executor
  batchOperations: BatchOperation[];
  addBatchOperation: (op: Omit<BatchOperation, "id" | "status" | "currentStep">) => void;
  updateBatchStep: (opId: string, stepIndex: number, updates: Partial<BatchOperation["steps"][0]>) => void;
  updateBatchStatus: (opId: string, status: BatchOperation["status"], currentStep?: number) => void;
  removeBatchOperation: (id: string) => void;

  // Performance baselines
  performanceBaselines: Record<string, PerformanceBaseline>;
  updateBaseline: (connectionId: string, cpu: number, mem: number, disk: number) => void;
  customExploits: Array<{ id: string; name: string; description: string; category: string; risk: string; commands: string[] }>;
  addCustomExploit: (exploit: { name: string; description: string; category: string; risk: string; commands: string[] }) => void;
  updateCustomExploit: (id: string, updates: Partial<{ name: string; description: string; category: string; risk: string; commands: string[] }>) => void;
  removeCustomExploit: (id: string) => void;
  hackingAlerts: HackingAlert[];
  addHackingAlert: (alert: Omit<HackingAlert, "id" | "timestamp">) => void;
  clearHackingAlerts: () => void;
  dismissHackingAlert: (id: string) => void;

  // Cross-Server Navigation
  navigationStacks: Record<string, ServerContext[]>;
  pushServerContext: (tabId: string, ctx: ServerContext) => void;
  popServerContext: (tabId: string) => ServerContext | null;
  getCurrentServer: (tabId: string) => ServerContext | null;

  // Infrastructure Monitor
  infraMonitors: Record<string, { metrics: ServerMetrics[]; status: string }>;
  infraAlerts: InfraAlert[];
  infraThresholds: InfraThresholds;
  infraPollingInterval: number;
  infraCompactMode: boolean;
  infraActiveMonitors: Set<string>;
  addInfraActiveMonitor: (connectionId: string) => void;
  removeInfraActiveMonitor: (connectionId: string) => void;
  addInfraMetrics: (connectionId: string, snapshot: ServerMetrics) => void;
  addInfraAlert: (alert: Omit<InfraAlert, "id" | "timestamp">) => void;
  acknowledgeInfraAlert: (id: string) => void;
  setInfraThresholds: (thresholds: Partial<InfraThresholds>) => void;
  setInfraPollingInterval: (interval: number) => void;
  toggleInfraCompactMode: () => void;
  clearInfraMonitor: (connectionId: string) => void;

  // Infrastructure Timeline
  infraTimeline: InfraTimelineEvent[];
  addInfraTimelineEvent: (event: Omit<InfraTimelineEvent, "id" | "timestamp">) => void;
  clearInfraTimeline: () => void;

  // Disk Analyzer
  diskAnalyses: Record<string, DiskAnalysis>;
  diskPreviousScans: Record<string, { dirs: Record<string, number>; timestamp: number }>;
  setDiskAnalysis: (connectionId: string, analysis: DiskAnalysis) => void;
  clearDiskAnalysis: (connectionId: string) => void;

  // Collaborative Terminal
  collabSessions: Record<string, CollabSessionInfo>;
  startCollabHosting: (tabId: string, sessionId: string, hostName: string, cols: number, rows: number) => Promise<void>;
  stopCollabHosting: (sessionId: string) => Promise<void>;
  joinCollabSession: (hostAddress: string, code: string, guestName: string) => Promise<string>;
  leaveCollabSession: (collabId: string) => Promise<void>;
  collabSendChat: (sessionId: string, content: string, senderName: string, isHost: boolean) => Promise<void>;
  collabSetPermission: (sessionId: string, guestId: string, permission: CollabPermission) => Promise<void>;
  collabKickGuest: (sessionId: string, guestId: string) => Promise<void>;
  addCollabChatMessage: (sessionId: string, msg: CollabChatMessage) => void;
  updateCollabUsers: (sessionId: string, users: CollabUser[]) => void;
  addCollabUser: (sessionId: string, user: CollabUser) => void;
  removeCollabUser: (sessionId: string, userId: string) => void;
  removeCollabSession: (sessionId: string) => void;

  // Backup Manager
  backupJobs: BackupJob[];
  backupHistory: BackupRecord[];
  backupSmtp: BackupSmtpConfig;
  backupTelegram: BackupTelegramConfig;
  addBackupJob: (job: Omit<BackupJob, "id" | "lastRun" | "lastStatus">) => void;
  updateBackupJob: (id: string, updates: Partial<BackupJob>) => void;
  removeBackupJob: (id: string) => void;
  addBackupRecord: (record: Omit<BackupRecord, "id">) => void;
  clearBackupHistory: () => void;
  setBackupSmtp: (config: Partial<BackupSmtpConfig>) => void;
  setBackupTelegram: (config: Partial<BackupTelegramConfig>) => void;

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
let debugIdCounter = 0;

export const useAppStore = create<AppState>((set, get) => ({
  theme: "dark",
  themesVisited: ["dark"] as string[],
  setTheme: (theme) => set((s) => {
    const visited = s.themesVisited.includes(theme) ? s.themesVisited : [...s.themesVisited, theme];
    scheduleSave();
    return { theme, themesVisited: visited };
  }),
  customTheme: {
    bgPrimary: "#1a1b2e",
    bgSecondary: "#16182d",
    textPrimary: "#e0e0f0",
    accentPrimary: "#7c5cff",
    accentSecondary: "#00d9a3",
    terminalBg: "#1a1b2e",
    terminalFg: "#e0e0f0",
    terminalCursor: "#7c5cff",
  },
  setCustomThemeColor: (key, value) => {
    set((s) => ({ customTheme: { ...s.customTheme, [key]: value } }));
    scheduleSave();
  },

  language: "en" as AppLanguage,
  setLanguage: (lang) => { set({ language: lang }); scheduleSave(); },

  tabs: [{ id: "tab-0", title: "Terminal 1", type: "terminal" as const, shellType: navigator.platform.startsWith("Win") ? "powershell.exe" : "/bin/bash", sessionId: null }],
  activeTabId: "tab-0",

  addTab: (shell = navigator.platform.startsWith("Win") ? "powershell.exe" : "/bin/bash", initialCommand) => {
    tabCounter++;
    const id = `tab-${tabCounter}`;
    set((s) => ({
      tabs: [...s.tabs, { id, title: `Terminal ${s.tabs.length + 1}`, type: "terminal" as const, shellType: shell, sessionId: null, initialCommand }],
      activeTabId: id,
    }));
  },

  addSSHTab: (connectionId: string, initialCommand) => {
    const conn = get().sshConnections.find((c) => c.id === connectionId);
    if (!conn) return;
    tabCounter++;
    const id = `tab-${tabCounter}`;
    set((s) => ({
      tabs: [...s.tabs, {
        id,
        title: `SSH: ${conn.name}`,
        type: "terminal" as const,
        shellType: "",
        sessionId: null,
        sshConnectionId: connectionId,
        initialCommand,
      }],
      activeTabId: id,
    }));
  },

  openPanelTab: (panelType) => {
    const existing = get().tabs.find((t) => t.type === panelType);
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }
    tabCounter++;
    const id = `tab-${tabCounter}`;
    const titles: Record<PanelTabType, string> = {
      ssh: "SSH", sftp: "SFTP", rdp: "RDP", editor: "Editor", ai: "AI Assistant",
      debug: "Debug", hacking: "Hacking", infra: "Infra Monitor",
      collab: "Collaboration", servermap: "Server Map", docs: "Session Docs",
      backups: "Backup Manager", code: "Code Agents",
    };
    set((s) => ({
      tabs: [...s.tabs, { id, title: titles[panelType], type: panelType, shellType: "", sessionId: null }],
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

  pendingEditorFile: null,
  setPendingEditorFile: (file) => set({ pendingEditorFile: file }),

  focusMode: false,
  toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),

  history: [],
  addHistory: (entry) => {
    set((s) => {
      const prev = s.history.length >= 200 ? s.history.slice(0, 199) : s.history;
      return {
        history: [{ ...entry, id: crypto.randomUUID(), timestamp: Date.now() }, ...prev],
      };
    });
    // Deferred save — history is not critical, avoid disk I/O on every command
    if (!saveTimer) scheduleSave();
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
    set((s) => {
      const folder = s.snippetFolders.find((f) => f.id === id);
      const newShared = { ...s.sharedSnippets };
      const newSubFolders = { ...s.sharedSubFolders };
      if (folder?.sharedPath) { delete newShared[id]; delete newSubFolders[id]; }
      return {
        snippetFolders: s.snippetFolders.filter((f) => f.id !== id),
        snippets: folder?.sharedPath ? s.snippets : s.snippets.map((sn) => sn.folderId === id ? { ...sn, folderId: undefined } : sn),
        sharedSnippets: newShared,
        sharedSubFolders: newSubFolders,
      };
    });
    scheduleSave();
  },
  renameSnippetFolder: (id, name) => {
    set((s) => ({
      snippetFolders: s.snippetFolders.map((f) => f.id === id ? { ...f, name } : f),
    }));
    scheduleSave();
  },

  // Shared snippet folders
  sharedSnippets: {},
  sharedSubFolders: {},
  loadSharedFolder: async (folderId) => {
    const folder = get().snippetFolders.find((f) => f.id === folderId);
    if (!folder?.sharedPath) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const raw = await invoke<string>("load_shared_snippets", { path: folder.sharedPath });
      const parsed = JSON.parse(raw);
      // Backward compatible: old format is Snippet[], new format is { subFolders, snippets }
      if (Array.isArray(parsed)) {
        set((s) => ({ sharedSnippets: { ...s.sharedSnippets, [folderId]: parsed }, sharedSubFolders: { ...s.sharedSubFolders, [folderId]: [] } }));
      } else {
        set((s) => ({ sharedSnippets: { ...s.sharedSnippets, [folderId]: parsed.snippets || [] }, sharedSubFolders: { ...s.sharedSubFolders, [folderId]: parsed.subFolders || [] } }));
      }
    } catch { /* file may not exist yet */ }
  },
  addSharedSnippet: async (folderId, snippet) => {
    const folder = get().snippetFolders.find((f) => f.id === folderId);
    if (!folder?.sharedPath) return;
    const newSnippet: Snippet = { ...snippet, id: crypto.randomUUID(), folderId };
    set((s) => ({ sharedSnippets: { ...s.sharedSnippets, [folderId]: [...(s.sharedSnippets[folderId] || []), newSnippet] } }));
    await _saveSharedFile(folder.sharedPath, folderId);
  },
  removeSharedSnippet: async (folderId, snippetId) => {
    const folder = get().snippetFolders.find((f) => f.id === folderId);
    if (!folder?.sharedPath) return;
    set((s) => ({ sharedSnippets: { ...s.sharedSnippets, [folderId]: (s.sharedSnippets[folderId] || []).filter((sn) => sn.id !== snippetId) } }));
    await _saveSharedFile(folder.sharedPath, folderId);
  },
  updateSharedSnippet: async (folderId, snippetId, updates) => {
    const folder = get().snippetFolders.find((f) => f.id === folderId);
    if (!folder?.sharedPath) return;
    set((s) => ({ sharedSnippets: { ...s.sharedSnippets, [folderId]: (s.sharedSnippets[folderId] || []).map((sn) => sn.id === snippetId ? { ...sn, ...updates } : sn) } }));
    await _saveSharedFile(folder.sharedPath, folderId);
  },
  addSharedSnippetFolder: async (name, color, sharedPath) => {
    const id = crypto.randomUUID();
    const filePath = sharedPath.endsWith(".json") ? sharedPath : sharedPath + "/shared_snippets.json";
    set((s) => ({
      snippetFolders: [...s.snippetFolders, { id, name, color, sharedPath: filePath }],
    }));
    scheduleSave();
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        const raw = await invoke<string>("load_shared_snippets", { path: filePath });
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          set((s) => ({ sharedSnippets: { ...s.sharedSnippets, [id]: parsed }, sharedSubFolders: { ...s.sharedSubFolders, [id]: [] } }));
        } else {
          set((s) => ({ sharedSnippets: { ...s.sharedSnippets, [id]: parsed.snippets || [] }, sharedSubFolders: { ...s.sharedSubFolders, [id]: parsed.subFolders || [] } }));
        }
      } catch {
        const empty = JSON.stringify({ subFolders: [], snippets: [] });
        await invoke("save_shared_snippets", { path: filePath, data: empty });
        set((s) => ({ sharedSnippets: { ...s.sharedSnippets, [id]: [] }, sharedSubFolders: { ...s.sharedSubFolders, [id]: [] } }));
      }
    } catch { /* best effort */ }
  },
  addSharedSubFolder: async (folderId, name, color) => {
    const folder = get().snippetFolders.find((f) => f.id === folderId);
    if (!folder?.sharedPath) return;
    const sub: SharedSubFolder = { id: crypto.randomUUID(), name, color };
    set((s) => ({ sharedSubFolders: { ...s.sharedSubFolders, [folderId]: [...(s.sharedSubFolders[folderId] || []), sub] } }));
    await _saveSharedFile(folder.sharedPath, folderId);
  },
  removeSharedSubFolder: async (folderId, subFolderId) => {
    const folder = get().snippetFolders.find((f) => f.id === folderId);
    if (!folder?.sharedPath) return;
    // Remove sub-folder and unassign its snippets
    set((s) => ({
      sharedSubFolders: { ...s.sharedSubFolders, [folderId]: (s.sharedSubFolders[folderId] || []).filter((sf) => sf.id !== subFolderId) },
      sharedSnippets: { ...s.sharedSnippets, [folderId]: (s.sharedSnippets[folderId] || []).map((sn) => sn.subFolderId === subFolderId ? { ...sn, subFolderId: undefined } : sn) },
    }));
    await _saveSharedFile(folder.sharedPath, folderId);
  },
  renameSharedSubFolder: async (folderId, subFolderId, name) => {
    const folder = get().snippetFolders.find((f) => f.id === folderId);
    if (!folder?.sharedPath) return;
    set((s) => ({ sharedSubFolders: { ...s.sharedSubFolders, [folderId]: (s.sharedSubFolders[folderId] || []).map((sf) => sf.id === subFolderId ? { ...sf, name } : sf) } }));
    await _saveSharedFile(folder.sharedPath, folderId);
  },

  systemStats: null,
  setSystemStats: (stats) => set((s) => {
    if (!stats) return { systemStats: stats };
    const maxPoints = 60;
    const cpu = s.metricsHistory.cpu.length >= maxPoints
      ? [...s.metricsHistory.cpu.slice(1), stats.cpu]
      : [...s.metricsHistory.cpu, stats.cpu];
    const memory = s.metricsHistory.memory.length >= maxPoints
      ? [...s.metricsHistory.memory.slice(1), stats.memoryPercent]
      : [...s.metricsHistory.memory, stats.memoryPercent];
    return { systemStats: stats, metricsHistory: { cpu, memory } };
  }),

  metricsHistory: { cpu: [], memory: [] },
  addMetricsSnapshot: (cpu, memory) => set((s) => {
    const maxPoints = 60;
    const cpuArr = s.metricsHistory.cpu.length >= maxPoints
      ? [...s.metricsHistory.cpu.slice(1), cpu]
      : [...s.metricsHistory.cpu, cpu];
    const memArr = s.metricsHistory.memory.length >= maxPoints
      ? [...s.metricsHistory.memory.slice(1), memory]
      : [...s.metricsHistory.memory, memory];
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

  rdpConnections: [],

  addRDPConnection: (conn) => {
    const newConn: RDPConnection = { ...conn, id: crypto.randomUUID(), status: "disconnected" };
    set((s) => ({ rdpConnections: [...s.rdpConnections, newConn] }));
    scheduleSave();
  },

  updateRDPConnection: (id, updates) => {
    set((s) => ({
      rdpConnections: s.rdpConnections.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    }));
    // Skip save when only runtime fields changed
    if (
      updates.name || updates.host || updates.port || updates.username ||
      updates.domain !== undefined || updates.fullscreen !== undefined ||
      updates.width || updates.height || updates.multimon !== undefined ||
      updates.admin !== undefined
    ) {
      scheduleSave();
    }
  },

  removeRDPConnection: (id) => {
    set((s) => ({ rdpConnections: s.rdpConnections.filter((c) => c.id !== id) }));
    scheduleSave();
  },

  // === Code panel — AI agent launch sessions ===
  codeSessions: [],

  addCodeSession: (sess) => {
    const newSess: CodeSession = {
      ...sess,
      id: crypto.randomUUID(),
      lastUsed: null,
    };
    set((s) => ({ codeSessions: [...s.codeSessions, newSess] }));
    scheduleSave();
  },

  updateCodeSession: (id, updates) => {
    set((s) => ({
      codeSessions: s.codeSessions.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    }));
    // Skip save when only the install hint or lastUsed changed (lightweight churn)
    if (updates.name || updates.target || updates.agentId || updates.workingDir !== undefined) {
      scheduleSave();
    }
  },

  removeCodeSession: (id) => {
    set((s) => ({ codeSessions: s.codeSessions.filter((c) => c.id !== id) }));
    scheduleSave();
  },

  launchCodeSession: (id, agentLaunchCmd) => {
    const sess = get().codeSessions.find((c) => c.id === id);
    if (!sess) return;

    // Note: agentLaunchCmd already includes the per-mode flag appended by the
    // caller (CodePanel reads agent.flagsByMode[sess.editMode] and concatenates).
    // We keep the flag-resolution out of the store so the store has zero
    // knowledge of the agent catalog.

    // Build a `cd <dir> && <agent>` one-shot. We use POSIX `&&` for SSH
    // (always Linux/macOS) and `;` on Windows local PowerShell. Empty
    // working dir → just run the agent.
    const dir = (sess.workingDir || "").trim();
    const isLocalWindows = sess.target.kind === "local" && navigator.platform.startsWith("Win");
    let cmd: string;
    if (!dir) {
      cmd = agentLaunchCmd;
    } else if (isLocalWindows) {
      cmd = `Set-Location -LiteralPath '${dir.replace(/'/g, "''")}'; ${agentLaunchCmd}`;
    } else {
      // POSIX: quote with single quotes, escape single quotes by closing-escape-reopening
      const safe = dir.replace(/'/g, "'\\''");
      cmd = `cd '${safe}' && ${agentLaunchCmd}`;
    }

    if (sess.target.kind === "local") {
      const shell = navigator.platform.startsWith("Win") ? "powershell.exe" : "/bin/bash";
      get().addTab(shell, cmd);
    } else {
      const sshConnectionId = sess.target.sshConnectionId;
      const conn = get().sshConnections.find((c) => c.id === sshConnectionId);
      if (!conn) return; // connection was deleted
      if (conn.status === "connected") {
        get().addSSHTab(sshConnectionId, cmd);
      } else {
        // SSH session not up yet — spawn the tab (it will trigger SSHPanel's
        // password/key flow via the existing dead-end recovery path) and the
        // initialCommand is preserved on the tab until TerminalPanel sends it
        // after the SSH handshake completes.
        get().addSSHTab(sshConnectionId, cmd);
        get().requestSSHConnect(sshConnectionId);
      }
    }

    // Stamp lastUsed on the session
    set((s) => ({
      codeSessions: s.codeSessions.map((c) => (c.id === id ? { ...c, lastUsed: Date.now() } : c)),
    }));
    scheduleSave();
  },

  pendingSSHConnectId: null,
  requestSSHConnect: (connectionId) => {
    // Switch to SSH panel tab so the password prompt becomes visible,
    // then signal SSHPanel to auto-trigger its connect/prompt flow.
    get().openPanelTab("ssh");
    set({ pendingSSHConnectId: connectionId });
  },
  clearPendingSSHConnect: () => set({ pendingSSHConnectId: null }),

  debugLogs: [],
  debugEnabled: true,
  debugPersist: true,
  addDebugLog: (entry) =>
    set((s) => {
      if (!s.debugEnabled) return s;
      const newEntry: DebugLogEntry = {
        ...entry,
        id: `dbg-${++debugIdCounter}`,
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
      });
      // Open hacking panel as a tab
      get().openPanelTab("hacking");
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
  workspaces: [],
  saveWorkspace: (name) => {
    const s = get();
    set((prev) => ({
      workspaces: [...prev.workspaces, {
        id: crypto.randomUUID(),
        name,
        tabCount: s.tabs.length,
        splitMode: s.splitMode,
        sidebarTab: s.sidebarTab,
      }],
    }));
    scheduleSave();
  },
  loadWorkspace: (id) => {
    const s = get();
    const ws = s.workspaces.find((w) => w.id === id);
    if (!ws) return;
    // Restore split mode, sidebar tab, and add missing tabs in a single set()
    const currentTabs = s.tabs;
    const newTabs = currentTabs.length < ws.tabCount
      ? [...currentTabs, ...Array.from({ length: ws.tabCount - currentTabs.length }, (_, i) => ({
          id: `tab-${Date.now()}-${i}`,
          title: `Terminal ${currentTabs.length + i + 1}`,
          type: "terminal" as const,
          shellType: navigator.platform.startsWith("Win") ? "powershell.exe" : "/bin/bash",
          sessionId: null,
        }))]
      : currentTabs;
    set({ splitMode: ws.splitMode as any, sidebarTab: ws.sidebarTab as any, sidebarOpen: true, tabs: newTabs });
  },
  removeWorkspace: (id) => {
    set((s) => ({ workspaces: s.workspaces.filter((w) => w.id !== id) }));
    scheduleSave();
  },

  // Config versioning
  configVersions: [],
  addConfigVersion: (version) => set((s) => {
    const newVersion: ConfigVersion = { ...version, id: crypto.randomUUID(), timestamp: Date.now() };
    // Keep max 50 versions total, 5 per file per server
    const filtered = s.configVersions.filter(
      (v) => !(v.connectionId === version.connectionId && v.filePath === version.filePath) ||
      s.configVersions.filter((x) => x.connectionId === version.connectionId && x.filePath === version.filePath).indexOf(v) < 4
    );
    return { configVersions: [newVersion, ...filtered].slice(0, 50) };
  }),
  getConfigHistory: (connectionId, filePath) => {
    return get().configVersions.filter((v) => v.connectionId === connectionId && v.filePath === filePath);
  },

  // Batch executor
  batchOperations: [],
  addBatchOperation: (op) => set((s) => ({
    batchOperations: [{ ...op, id: crypto.randomUUID(), status: "idle" as const, currentStep: 0 }, ...s.batchOperations].slice(0, 20),
  })),
  updateBatchStep: (opId, stepIndex, updates) => set((s) => ({
    batchOperations: s.batchOperations.map((op) =>
      op.id === opId ? { ...op, steps: op.steps.map((step, i) => i === stepIndex ? { ...step, ...updates } : step) } : op
    ),
  })),
  updateBatchStatus: (opId, status, currentStep) => set((s) => ({
    batchOperations: s.batchOperations.map((op) =>
      op.id === opId ? { ...op, status, ...(currentStep !== undefined ? { currentStep } : {}) } : op
    ),
  })),
  removeBatchOperation: (id) => set((s) => ({
    batchOperations: s.batchOperations.filter((op) => op.id !== id),
  })),

  // Performance baselines
  performanceBaselines: {},
  updateBaseline: (connectionId, cpu, mem, disk) => set((s) => {
    const existing = s.performanceBaselines[connectionId];
    if (existing) {
      const count = existing.sampleCount + 1;
      return {
        performanceBaselines: {
          ...s.performanceBaselines,
          [connectionId]: {
            connectionId,
            cpuAvg: (existing.cpuAvg * existing.sampleCount + cpu) / count,
            memAvg: (existing.memAvg * existing.sampleCount + mem) / count,
            diskAvg: (existing.diskAvg * existing.sampleCount + disk) / count,
            sampleCount: count,
            lastUpdated: Date.now(),
          },
        },
      };
    }
    return {
      performanceBaselines: {
        ...s.performanceBaselines,
        [connectionId]: { connectionId, cpuAvg: cpu, memAvg: mem, diskAvg: disk, sampleCount: 1, lastUpdated: Date.now() },
      },
    };
  }),
  customExploits: [],
  addCustomExploit: (exploit) => {
    set((s) => ({
      customExploits: [...s.customExploits, { ...exploit, id: crypto.randomUUID() }],
    }));
    scheduleSave();
  },
  updateCustomExploit: (id, updates) => {
    set((s) => ({
      customExploits: s.customExploits.map((e) => e.id === id ? { ...e, ...updates } : e),
    }));
    scheduleSave();
  },
  removeCustomExploit: (id) => {
    set((s) => ({
      customExploits: s.customExploits.filter((e) => e.id !== id),
    }));
    scheduleSave();
  },
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
  addAiMessage: (msg) => set((s) => {
    const msgs = [...s.aiMessages, { ...msg, id: crypto.randomUUID(), timestamp: Date.now() }];
    if (msgs.length > 200) msgs.splice(0, msgs.length - 200);
    return { aiMessages: msgs };
  }),
  clearAiMessages: () => set({ aiMessages: [] }),
  setAiLoading: (loading) => set({ aiLoading: loading }),

  // Cross-Server Navigation
  navigationStacks: {},
  pushServerContext: (tabId, ctx) => set((s) => {
    const stack = [...(s.navigationStacks[tabId] || []), ctx];
    return {
      navigationStacks: {
        ...s.navigationStacks,
        [tabId]: stack.length > 50 ? stack.slice(-50) : stack,
      },
    };
  }),
  popServerContext: (tabId) => {
    const stack = get().navigationStacks[tabId];
    if (!stack || stack.length === 0) return null;
    const popped = stack[stack.length - 1];
    set((s) => ({
      navigationStacks: {
        ...s.navigationStacks,
        [tabId]: stack.slice(0, -1),
      },
    }));
    return popped;
  },
  getCurrentServer: (tabId) => {
    const stack = get().navigationStacks[tabId];
    if (!stack || stack.length === 0) return null;
    return stack[stack.length - 1];
  },

  // Infrastructure Monitor
  infraMonitors: {},
  infraAlerts: [],
  infraThresholds: {
    cpuWarning: 80, cpuCritical: 95,
    memWarning: 80, memCritical: 95,
    diskWarning: 85, diskCritical: 95,
  },
  infraPollingInterval: 10,
  infraCompactMode: false,
  infraActiveMonitors: new Set<string>(),
  addInfraActiveMonitor: (connectionId) => set((s) => {
    if (s.infraActiveMonitors.has(connectionId)) return s;
    const next = new Set(s.infraActiveMonitors);
    next.add(connectionId);
    return { infraActiveMonitors: next };
  }),
  removeInfraActiveMonitor: (connectionId) => set((s) => {
    const next = new Set(s.infraActiveMonitors);
    next.delete(connectionId);
    return { infraActiveMonitors: next };
  }),

  addInfraMetrics: (connectionId, snapshot) => set((s) => {
    const existing = s.infraMonitors[connectionId] || { metrics: [], status: "monitoring" };
    const metrics = [...existing.metrics, snapshot];
    if (metrics.length > 60) metrics.splice(0, metrics.length - 60);

    // Check thresholds for alerts
    const th = s.infraThresholds;
    const conn = s.sshConnections.find((c) => c.id === connectionId);
    const serverName = conn?.name || connectionId;
    const candidateAlerts: Omit<InfraAlert, "id" | "timestamp">[] = [];

    if (snapshot.cpu >= th.cpuCritical) {
      candidateAlerts.push({ connectionId, serverName, severity: "critical", metric: "cpu", value: snapshot.cpu, message: `CPU at ${snapshot.cpu.toFixed(1)}%`, acknowledged: false });
    } else if (snapshot.cpu >= th.cpuWarning) {
      candidateAlerts.push({ connectionId, serverName, severity: "warning", metric: "cpu", value: snapshot.cpu, message: `CPU at ${snapshot.cpu.toFixed(1)}%`, acknowledged: false });
    }
    if (snapshot.memPercent >= th.memCritical) {
      candidateAlerts.push({ connectionId, serverName, severity: "critical", metric: "memory", value: snapshot.memPercent, message: `Memory at ${snapshot.memPercent.toFixed(1)}%`, acknowledged: false });
    } else if (snapshot.memPercent >= th.memWarning) {
      candidateAlerts.push({ connectionId, serverName, severity: "warning", metric: "memory", value: snapshot.memPercent, message: `Memory at ${snapshot.memPercent.toFixed(1)}%`, acknowledged: false });
    }
    if (snapshot.diskPercent >= th.diskCritical) {
      candidateAlerts.push({ connectionId, serverName, severity: "critical", metric: "disk", value: snapshot.diskPercent, message: `Disk at ${snapshot.diskPercent.toFixed(1)}%`, acknowledged: false });
    } else if (snapshot.diskPercent >= th.diskWarning) {
      candidateAlerts.push({ connectionId, serverName, severity: "warning", metric: "disk", value: snapshot.diskPercent, message: `Disk at ${snapshot.diskPercent.toFixed(1)}%`, acknowledged: false });
    }
    if (snapshot.failedServices.length > 0) {
      candidateAlerts.push({ connectionId, serverName, severity: "critical", metric: "service", value: snapshot.failedServices.length, message: `Failed services: ${snapshot.failedServices.join(", ")}`, acknowledged: false });
    }

    // Anomaly detection: exclude current point from mean/stddev calculation
    if (metrics.length >= 11) {
      const prevMetrics = metrics.slice(-31, -1); // Exclude the just-pushed snapshot
      const cpuValues = prevMetrics.map((m) => m.cpu);
      const cpuMean = cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length;
      const cpuStd = Math.sqrt(cpuValues.reduce((a, b) => a + (b - cpuMean) ** 2, 0) / cpuValues.length);
      if (cpuStd > 0 && snapshot.cpu > cpuMean + 2 * cpuStd && snapshot.cpu < th.cpuWarning) {
        candidateAlerts.push({ connectionId, serverName, severity: "warning", metric: "anomaly", value: snapshot.cpu, message: `CPU spike detected: ${snapshot.cpu.toFixed(1)}% (avg ${cpuMean.toFixed(1)}%)`, acknowledged: false });
      }
    }

    // Deduplicate: skip alert if same metric+server was alerted in last 60 seconds
    const now = Date.now();
    const newAlerts = candidateAlerts.filter((ca) => {
      const recent = s.infraAlerts.find(
        (a) => a.connectionId === ca.connectionId && a.metric === ca.metric && !a.acknowledged && (now - a.timestamp) < 60000
      );
      return !recent;
    });

    const alertEntries = newAlerts.map((a) => ({
      ...a, id: crypto.randomUUID(), timestamp: now,
    }));

    const allAlerts = [...alertEntries, ...s.infraAlerts];
    if (allAlerts.length > 200) allAlerts.length = 200;

    // Emit timeline events for new alerts
    const timelineEvents = alertEntries.map((a) => ({
      id: crypto.randomUUID(),
      timestamp: a.timestamp,
      connectionId: a.connectionId,
      serverName: a.serverName,
      type: "alert" as const,
      severity: a.severity,
      message: a.message,
    }));
    const newTimeline = [...timelineEvents, ...s.infraTimeline];
    if (newTimeline.length > 500) newTimeline.length = 500;

    return {
      infraMonitors: { ...s.infraMonitors, [connectionId]: { metrics, status: "monitoring" } },
      // Only update alerts/timeline if new alerts were actually generated
      ...(alertEntries.length > 0 ? { infraAlerts: allAlerts, infraTimeline: newTimeline } : {}),
    };
  }),

  // Auto-update baselines on every 10th metric poll
  // (done separately to avoid circular deps in addInfraMetrics)

  addInfraAlert: (alert) => set((s) => {
    const newAlert: InfraAlert = { ...alert, id: crypto.randomUUID(), timestamp: Date.now() };
    const alerts = [newAlert, ...s.infraAlerts];
    if (alerts.length > 200) alerts.length = 200;
    return { infraAlerts: alerts };
  }),

  acknowledgeInfraAlert: (id) => set((s) => ({
    infraAlerts: s.infraAlerts.map((a) => a.id === id ? { ...a, acknowledged: true } : a),
  })),

  setInfraThresholds: (thresholds) => set((s) => ({
    infraThresholds: { ...s.infraThresholds, ...thresholds },
  })),

  setInfraPollingInterval: (interval) => set({ infraPollingInterval: interval }),

  toggleInfraCompactMode: () => set((s) => ({ infraCompactMode: !s.infraCompactMode })),

  clearInfraMonitor: (connectionId) => set((s) => {
    const { [connectionId]: _, ...rest } = s.infraMonitors;
    return { infraMonitors: rest };
  }),

  // Infrastructure Timeline
  infraTimeline: [],
  addInfraTimelineEvent: (event) => set((s) => {
    const newEvent: InfraTimelineEvent = {
      ...event,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    };
    const timeline = [newEvent, ...s.infraTimeline];
    if (timeline.length > 500) timeline.length = 500;
    return { infraTimeline: timeline };
  }),
  clearInfraTimeline: () => set({ infraTimeline: [] }),

  // Disk Analyzer
  diskAnalyses: {},
  diskPreviousScans: {},
  setDiskAnalysis: (connectionId, analysis) => set((s) => {
    // Save current scan as "previous" for growth tracking
    const prev = s.diskAnalyses[connectionId];
    let diskPreviousScans = s.diskPreviousScans;
    if (prev && prev.largestDirs.length > 0) {
      const dirs: Record<string, number> = {};
      for (const d of prev.largestDirs) dirs[d.path] = d.sizeMB;
      diskPreviousScans = { ...diskPreviousScans, [connectionId]: { dirs, timestamp: prev.timestamp } };
    }
    return {
      diskAnalyses: { ...s.diskAnalyses, [connectionId]: analysis },
      diskPreviousScans,
    };
  }),
  clearDiskAnalysis: (connectionId) => set((s) => {
    const { [connectionId]: _, ...rest } = s.diskAnalyses;
    return { diskAnalyses: rest };
  }),

  // ──── Collaborative Terminal ────
  collabSessions: {},

  startCollabHosting: async (tabId, sessionId, hostName, cols, rows) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const info = await invoke<{ session_code: string; port: number; local_ips: string[] }>(
        "collab_start_hosting",
        { sessionId, hostName, cols, rows }
      );
      set((s) => ({
        collabSessions: {
          ...s.collabSessions,
          [sessionId]: {
            id: sessionId,
            tabId,
            role: "host",
            sessionCode: info.session_code,
            hostAddress: info.local_ips[0] || "127.0.0.1",
            port: info.port,
            hostName,
            users: [{ id: "host", name: hostName, permission: "FullControl", is_host: true }],
            chatMessages: [],
            status: "active",
            terminalSize: { cols, rows },
          },
        },
      }));
    } catch (e) {
      throw e;
    }
  },

  stopCollabHosting: async (sessionId) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("collab_stop_hosting", { sessionId });
    } catch {}
    set((s) => {
      const { [sessionId]: _, ...rest } = s.collabSessions;
      return { collabSessions: rest };
    });
  },

  joinCollabSession: async (hostAddress, code, guestName) => {
    const { invoke } = await import("@tauri-apps/api/core");
    const info = await invoke<{
      collab_id: string;
      host_name: string;
      permission: string;
      users: CollabUser[];
      terminal_size: [number, number];
    }>("collab_join_session", { hostAddress, sessionCode: code, guestName });

    const collabId = info.collab_id;

    // Create a new tab for the guest session
    tabCounter++;
    const tabId = `tab-${tabCounter}`;

    set((s) => ({
      tabs: [...s.tabs, {
        id: tabId,
        title: `Collab: ${info.host_name || "Host"}`,
        type: "terminal" as const,
        shellType: "collab-guest",
        sessionId: collabId,  // Store collabId as sessionId for reference
      }],
      activeTabId: tabId,
      collabSessions: {
        ...s.collabSessions,
        [collabId]: {
          id: collabId,
          tabId,
          role: "guest",
          sessionCode: code,
          hostAddress,
          port: 0,
          hostName: info.host_name,
          guestName,
          users: info.users,
          chatMessages: [],
          status: "active",
          terminalSize: { cols: info.terminal_size[0], rows: info.terminal_size[1] },
        },
      },
    }));
    return collabId;
  },

  leaveCollabSession: async (collabId) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("collab_leave_session", { collabId });
    } catch {}
    set((s) => {
      const { [collabId]: _, ...rest } = s.collabSessions;
      return { collabSessions: rest };
    });
  },

  collabSendChat: async (sessionId, content, senderName, isHost) => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("collab_send_chat", { sessionId, content, senderName, isHost });
    // Add to local state immediately (both host and guest see their own message)
    const msg: CollabChatMessage = {
      id: crypto.randomUUID(),
      sender: senderName,
      content,
      timestamp: Date.now(),
    };
    set((s) => {
      const session = s.collabSessions[sessionId];
      if (!session) return s;
      return {
        collabSessions: {
          ...s.collabSessions,
          [sessionId]: {
            ...session,
            chatMessages: [...session.chatMessages, msg].slice(-200),
          },
        },
      };
    });
  },

  collabSetPermission: async (sessionId, guestId, permission) => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("collab_set_permission", { sessionId, guestId, permission });
    set((s) => {
      const session = s.collabSessions[sessionId];
      if (!session) return s;
      return {
        collabSessions: {
          ...s.collabSessions,
          [sessionId]: {
            ...session,
            users: session.users.map((u) =>
              u.id === guestId ? { ...u, permission } : u
            ),
          },
        },
      };
    });
  },

  collabKickGuest: async (sessionId, guestId) => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("collab_kick_guest", { sessionId, guestId });
    set((s) => {
      const session = s.collabSessions[sessionId];
      if (!session) return s;
      return {
        collabSessions: {
          ...s.collabSessions,
          [sessionId]: {
            ...session,
            users: session.users.filter((u) => u.id !== guestId),
          },
        },
      };
    });
  },

  addCollabChatMessage: (sessionId, msg) => set((s) => {
    const session = s.collabSessions[sessionId];
    if (!session) return s;
    return {
      collabSessions: {
        ...s.collabSessions,
        [sessionId]: {
          ...session,
          chatMessages: [...session.chatMessages, msg].slice(-200),
        },
      },
    };
  }),

  updateCollabUsers: (sessionId, users) => set((s) => {
    const session = s.collabSessions[sessionId];
    if (!session) return s;
    return {
      collabSessions: {
        ...s.collabSessions,
        [sessionId]: { ...session, users },
      },
    };
  }),

  addCollabUser: (sessionId, user) => set((s) => {
    const session = s.collabSessions[sessionId];
    if (!session) return s;
    if (session.users.find((u) => u.id === user.id)) return s;
    return {
      collabSessions: {
        ...s.collabSessions,
        [sessionId]: {
          ...session,
          users: [...session.users, user],
        },
      },
    };
  }),

  removeCollabUser: (sessionId, userId) => set((s) => {
    const session = s.collabSessions[sessionId];
    if (!session) return s;
    return {
      collabSessions: {
        ...s.collabSessions,
        [sessionId]: {
          ...session,
          users: session.users.filter((u) => u.id !== userId),
        },
      },
    };
  }),

  removeCollabSession: (sessionId) => set((s) => {
    const { [sessionId]: _, ...rest } = s.collabSessions;
    return { collabSessions: rest };
  }),

  // Backup Manager
  backupJobs: [],
  backupHistory: [],
  backupSmtp: { enabled: false, host: "smtp.gmail.com", port: 587, username: "", password: "", fromAddress: "", toAddress: "", useTls: true },
  backupTelegram: { enabled: false, botToken: "", chatId: "" },

  addBackupJob: (job) => {
    set((s) => ({
      backupJobs: [...s.backupJobs, { ...job, id: crypto.randomUUID(), lastRun: null, lastStatus: null }],
    }));
    scheduleSave();
  },
  updateBackupJob: (id, updates) => {
    set((s) => ({
      backupJobs: s.backupJobs.map((j) => j.id === id ? { ...j, ...updates } : j),
    }));
    scheduleSave();
  },
  removeBackupJob: (id) => {
    set((s) => ({ backupJobs: s.backupJobs.filter((j) => j.id !== id) }));
    scheduleSave();
  },
  addBackupRecord: (record) => {
    set((s) => {
      const history = [{ ...record, id: crypto.randomUUID() }, ...s.backupHistory];
      if (history.length > 500) history.length = 500;
      return { backupHistory: history };
    });
    scheduleSave();
  },
  clearBackupHistory: () => { set({ backupHistory: [] }); scheduleSave(); },
  setBackupSmtp: (config) => { set((s) => ({ backupSmtp: { ...s.backupSmtp, ...config } })); scheduleSave(); },
  setBackupTelegram: (config) => { set((s) => ({ backupTelegram: { ...s.backupTelegram, ...config } })); scheduleSave(); },

  _hydrateFromConfig: (config) => {
    const updates: Partial<AppState> = {};
    if (config.theme) updates.theme = config.theme;
    if (config.customTheme) updates.customTheme = { ...get().customTheme, ...config.customTheme };
    if (config.snippets && config.snippets.length > 0) updates.snippets = config.snippets;
    if (config.snippetFolders) updates.snippetFolders = config.snippetFolders;
    if (config.plugins && config.plugins.length > 0) updates.plugins = config.plugins;
    if (config.history) updates.history = config.history;
    // debugEnabled is intentionally NOT restored — always starts ON
    if (config.debugPersist !== undefined) updates.debugPersist = config.debugPersist;
    if (config.language) updates.language = config.language;
    if (config.customExploits && config.customExploits.length > 0) updates.customExploits = config.customExploits;
    if (config.workspaces && config.workspaces.length > 0) updates.workspaces = config.workspaces;
    if (config.backupJobs?.length) updates.backupJobs = config.backupJobs;
    if (config.backupHistory?.length) updates.backupHistory = config.backupHistory;
    if (config.backupSmtp?.enabled) updates.backupSmtp = config.backupSmtp;
    if (config.backupTelegram?.enabled) updates.backupTelegram = config.backupTelegram;
    if (config.sshConnections && config.sshConnections.length > 0) {
      updates.sshConnections = config.sshConnections.map((c) => ({
        ...c,
        status: "disconnected" as const,
        sessionId: undefined,
        errorMessage: undefined,
      }));
    }
    if (config.rdpConnections && config.rdpConnections.length > 0) {
      updates.rdpConnections = config.rdpConnections.map((c) => ({
        ...c,
        status: "disconnected" as const,
        errorMessage: undefined,
      }));
    }
    if (config.codeSessions && config.codeSessions.length > 0) {
      // Default editMode to 'manual' for sessions saved before the field existed
      updates.codeSessions = config.codeSessions.map((c) => ({
        ...c,
        editMode: c.editMode ?? "manual",
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

// Flush ALL pending data on page unload (config + debug logs).
// Important: Tauri/browser unload doesn't await async work — we MUST use the
// pre-cached invoke (set during loadConfig) to avoid the dynamic import race.
// We listen on BOTH `pagehide` and `beforeunload` because pagehide is more
// reliable in Tauri webviews and beforeunload handles regular browser refresh.
function flushAllPendingSync() {
  // 1. Config — clear debounce, build current snapshot, fire-and-forget save
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (configLoaded) {
    try {
      const config = buildPersistedConfig();
      const json = JSON.stringify(config);
      if (json !== lastSavedJson && cachedInvoke) {
        lastSavedJson = json;
        // Fire-and-forget — no await possible during unload, but Tauri's
        // IPC kicks the request to Rust before the window closes.
        cachedInvoke("save_app_config", { data: json });
      }
    } catch { /* swallow — better to lose this save than block unload */ }
  }

  // 2. Debug logs — drain queue synchronously into one IPC call
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (debugPersistQueue.length > 0 && cachedInvoke) {
    try {
      const batch = debugPersistQueue.splice(0, debugPersistQueue.length);
      cachedInvoke("debug_log_save", {
        entries: batch.map((e) => ({
          id: e.id,
          timestamp: e.timestamp,
          level: e.level,
          message: e.message,
          source: e.source,
        })),
      });
    } catch { /* swallow */ }
  }
}

if (typeof window !== "undefined") {
  // pagehide fires reliably on Tauri window close (unlike beforeunload which
  // can be skipped if there are no listeners earlier in the chain).
  window.addEventListener("pagehide", flushAllPendingSync);
  window.addEventListener("beforeunload", flushAllPendingSync);
  // visibilitychange when going hidden — opportunistic flush in case the
  // window is being minimized/backgrounded before close.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushAllPendingSync();
  });
}
