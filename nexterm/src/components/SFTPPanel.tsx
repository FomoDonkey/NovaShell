import { useState, useEffect, useCallback, useRef } from "react";
import {
  Trash2,
  Play,
  Square,
  Loader2,
  Check,
  X,
  Server,
  Shield,
  ShieldCheck,
  Upload,
  Download,
  Folder,
  File,
  ArrowLeft,
  RefreshCw,
  FolderPlus,
  Edit3,
  ArrowUpDown,
  Eye,
} from "lucide-react";
import { useAppStore } from "../store/appStore";
import type { SSHConnection } from "../store/appStore";

let tauriCoreCache: typeof import("@tauri-apps/api/core") | null = null;
async function getTauriCore() {
  if (!tauriCoreCache) tauriCoreCache = await import("@tauri-apps/api/core");
  return tauriCoreCache;
}

interface RemoteFileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  permissions: number;
  modified: number;
}

interface LocalFileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  extension: string;
}

interface TransferItem {
  id: string;
  filename: string;
  direction: "upload" | "download";
  status: "pending" | "transferring" | "done" | "error";
  error?: string;
  size?: number;
}

type SFTPView = "connections" | "explorer";

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

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatPermissions(perm: number): string {
  const octal = (perm & 0o777).toString(8);
  return octal.padStart(3, "0");
}

export function SFTPPanel() {
  const { sshConnections } = useAppStore();
  const [view, setView] = useState<SFTPView>("connections");
  const [sftpSessionId, setSftpSessionId] = useState<string | null>(null);
  const [connectedName, setConnectedName] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const [passwordPrompt, setPasswordPrompt] = useState<{
    conn: SSHConnection;
    password: string;
    saveMode: "none" | "session" | "keychain";
  } | null>(null);

  const handleConnect = useCallback(async (conn: SSHConnection, password?: string) => {
    setConnecting(true);
    setConnectError(null);
    try {
      const { invoke } = await getTauriCore();
      const sessionId = await invoke<string>("sftp_connect", {
        host: conn.host,
        port: conn.port,
        username: conn.username,
        password: password || null,
        privateKey: conn.privateKey || null,
      });
      setSftpSessionId(sessionId);
      setConnectedName(conn.name);
      setView("explorer");
    } catch (e) {
      setConnectError(String(e));
    }
    setConnecting(false);
  }, []);

  const handleDisconnect = useCallback(async () => {
    if (!sftpSessionId) return;
    try {
      const { invoke } = await getTauriCore();
      await invoke("sftp_disconnect", { sessionId: sftpSessionId });
    } catch {}
    setSftpSessionId(null);
    setConnectedName("");
    setView("connections");
  }, [sftpSessionId]);

  const startConnect = async (conn: SSHConnection) => {
    if (conn.privateKey) {
      handleConnect(conn);
      return;
    }
    if (conn.sessionPassword) {
      handleConnect(conn, conn.sessionPassword);
      return;
    }
    try {
      const { invoke } = await getTauriCore();
      const keychainPass = await invoke<string | null>("keychain_get_password", { connectionId: conn.id });
      if (keychainPass) {
        handleConnect(conn, keychainPass);
        return;
      }
    } catch {}
    setPasswordPrompt({ conn, password: "", saveMode: "keychain" });
  };

  const submitPassword = async () => {
    if (!passwordPrompt) return;
    const { conn, password, saveMode } = passwordPrompt;
    if (saveMode === "session") {
      useAppStore.getState().updateSSHConnection(conn.id, { sessionPassword: password });
    } else if (saveMode === "keychain") {
      try {
        const { invoke } = await getTauriCore();
        await invoke("keychain_save_password", { connectionId: conn.id, password });
      } catch {}
    }
    handleConnect(conn, password);
    setPasswordPrompt(null);
  };

  if (view === "explorer" && sftpSessionId) {
    return (
      <SFTPExplorer
        sessionId={sftpSessionId}
        connName={connectedName}
        onDisconnect={handleDisconnect}
      />
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span className="sidebar-section-title" style={{ margin: 0 }}>SFTP File Transfer</span>
      </div>

      {connectError && (
        <div style={{
          padding: "8px 10px",
          borderRadius: "var(--radius-sm)",
          marginBottom: 8,
          fontSize: 11,
          background: "rgba(248,81,73,0.15)",
          color: "var(--accent-error)",
          border: "1px solid var(--accent-error)",
        }}>
          {connectError}
        </div>
      )}

      {passwordPrompt && (
        <div style={{
          padding: 12,
          background: "var(--bg-tertiary)",
          borderRadius: "var(--radius-md)",
          marginBottom: 12,
          border: "1px solid var(--accent-primary)",
        }}>
          <label style={labelStyle}>Password for {passwordPrompt.conn.name}</label>
          <input
            type="password"
            placeholder="Password..."
            value={passwordPrompt.password}
            onChange={(e) => setPasswordPrompt({ ...passwordPrompt, password: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") submitPassword(); }}
            style={{ ...inputStyle, marginBottom: 8 }}
            autoFocus
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
            {(["keychain", "session", "none"] as const).map((mode) => (
              <label key={mode} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-secondary)", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="sftpSaveMode"
                  checked={passwordPrompt.saveMode === mode}
                  onChange={() => setPasswordPrompt({ ...passwordPrompt, saveMode: mode })}
                  style={{ accentColor: "var(--accent-primary)" }}
                />
                {mode === "keychain" && <><ShieldCheck size={11} /> Save in system keychain</>}
                {mode === "session" && <><Shield size={11} /> Remember for this session</>}
                {mode === "none" && <>Don't save password</>}
              </label>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={submitPassword} style={{ ...btnStyle, flex: 1, justifyContent: "center", background: "var(--accent-primary)", color: "white" }}>
              <Play size={12} /> Connect
            </button>
            <button onClick={() => setPasswordPrompt(null)} style={{ ...btnStyle, background: "var(--bg-active)", color: "var(--text-secondary)" }}>
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      {connecting && (
        <div style={{ textAlign: "center", padding: 20, color: "var(--text-muted)", fontSize: 12 }}>
          <Loader2 size={20} style={{ margin: "0 auto 8px", animation: "spin 1s linear infinite" }} />
          Connecting via SFTP...
        </div>
      )}

      {sshConnections.length === 0 ? (
        <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 24, fontSize: 12 }}>
          <Server size={24} style={{ margin: "0 auto 8px", opacity: 0.5 }} />
          <div>No SSH connections configured.</div>
          <div style={{ marginTop: 4 }}>Add connections in the SSH tab first.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {sshConnections.map((conn) => (
            <div key={conn.id} style={{
              padding: "10px 12px",
              background: "var(--bg-tertiary)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border-subtle)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Server size={14} style={{ color: "var(--accent-primary)", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{conn.name}</div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{conn.username}@{conn.host}:{conn.port}</div>
                </div>
                <button
                  onClick={() => startConnect(conn)}
                  disabled={connecting}
                  style={{
                    ...btnStyle,
                    background: "var(--accent-primary)",
                    color: "white",
                    padding: "4px 10px",
                    fontSize: 11,
                    opacity: connecting ? 0.5 : 1,
                  }}
                >
                  <ArrowUpDown size={12} /> SFTP
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// SFTP Explorer — dual-panel file browser with drag & drop
// ============================================================

function SFTPExplorer({
  sessionId,
  connName,
  onDisconnect,
}: {
  sessionId: string;
  connName: string;
  onDisconnect: () => void;
}) {
  // Remote panel
  const [remotePath, setRemotePath] = useState("");
  const [remoteFiles, setRemoteFiles] = useState<RemoteFileEntry[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(true);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [selectedRemote, setSelectedRemote] = useState<Set<string>>(new Set());

  // Local panel
  const [localPath, setLocalPath] = useState("");
  const [localFiles, setLocalFiles] = useState<LocalFileEntry[]>([]);
  const [localLoading, setLocalLoading] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);
  const [selectedLocal, setSelectedLocal] = useState<Set<string>>(new Set());

  // Transfer state
  const [transfers, setTransfers] = useState<TransferItem[]>([]);
  const [activePanel, setActivePanel] = useState<"local" | "remote">("remote");
  const [transferring, setTransferring] = useState(false);

  // New folder / rename
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ path: string; name: string } | null>(null);

  // Preview
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState("");

  // Drag & drop
  const [dragOver, setDragOver] = useState<"local" | "remote" | null>(null);
  const dragDataRef = useRef<{ side: "local" | "remote"; files: Array<{ name: string; path: string; is_dir: boolean; size: number }> } | null>(null);
  const dragCounterLocal = useRef(0);
  const dragCounterRemote = useRef(0);

  // Cached invoke
  const invokeRef = useRef<typeof import("@tauri-apps/api/core")["invoke"] | null>(null);
  const getInvoke = useCallback(async () => {
    if (!invokeRef.current) {
      const core = await getTauriCore();
      invokeRef.current = core.invoke;
    }
    return invokeRef.current;
  }, []);

  // Load remote files (no chained effects — direct call)
  const loadRemote = useCallback(async (path: string) => {
    setRemoteLoading(true);
    setRemoteError(null);
    setSelectedRemote(new Set());
    try {
      const invoke = await getInvoke();
      const entries = await invoke<RemoteFileEntry[]>("sftp_list_dir", { sessionId, path });
      setRemoteFiles(entries);
      setRemotePath(path);
    } catch (e) {
      setRemoteError(String(e));
    }
    setRemoteLoading(false);
  }, [sessionId, getInvoke]);

  // Load local files
  const loadLocal = useCallback(async (path: string) => {
    setLocalLoading(true);
    setLocalError(null);
    setSelectedLocal(new Set());
    try {
      const invoke = await getInvoke();
      const entries = await invoke<LocalFileEntry[]>("list_directory", { path });
      setLocalFiles(entries);
      setLocalPath(path);
    } catch (e) {
      setLocalError(String(e));
    }
    setLocalLoading(false);
  }, [getInvoke]);

  // Initial load — phase 1: get home paths, phase 2: list both dirs in parallel
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    (async () => {
      const invoke = await getInvoke();

      // Phase 1: get home paths + local listing in parallel
      const [remoteHome, localEntries] = await Promise.allSettled([
        invoke<string>("sftp_home_dir", { sessionId }),
        invoke<LocalFileEntry[]>("list_directory", { path: null }),
      ]);

      // Resolve local path from entries
      let resolvedLocalPath = "/";
      if (localEntries.status === "fulfilled" && localEntries.value.length > 0) {
        const first = localEntries.value[0].path;
        const sep = first.includes("\\") ? "\\" : "/";
        resolvedLocalPath = first.substring(0, first.lastIndexOf(sep)) || (sep === "\\" ? "C:\\" : "/");
        setLocalPath(resolvedLocalPath);
        setLocalFiles(localEntries.value);
        setLocalLoading(false);
      }

      // Phase 2: load remote listing (local is already done from phase 1)
      const rHome = remoteHome.status === "fulfilled" ? remoteHome.value : "/";
      try {
        const entries = await invoke<RemoteFileEntry[]>("sftp_list_dir", { sessionId, path: rHome });
        setRemoteFiles(entries);
        setRemotePath(rHome);
      } catch (e) {
        setRemoteError(String(e));
      }
      setRemoteLoading(false);

      // If local failed in phase 1, load fallback
      if (localEntries.status !== "fulfilled" || localEntries.value.length === 0) {
        loadLocal(resolvedLocalPath);
      }
    })();
  }, [sessionId, getInvoke, loadLocal]);

  // Navigate
  const navigateRemote = (entry: RemoteFileEntry) => {
    if (entry.is_dir) loadRemote(entry.path);
  };
  const remoteGoUp = () => {
    const parent = remotePath.substring(0, remotePath.lastIndexOf("/")) || "/";
    loadRemote(parent);
  };
  const navigateLocal = (entry: LocalFileEntry) => {
    if (entry.is_dir) loadLocal(entry.path);
  };
  const localGoUp = () => {
    const sep = localPath.includes("\\") ? "\\" : "/";
    const parts = localPath.split(sep);
    parts.pop();
    const parent = parts.join(sep) || (sep === "\\" ? "C:\\" : "/");
    loadLocal(parent);
  };

  // Get local separator
  const localSep = localPath.includes("\\") ? "\\" : "/";

  // Download: remote -> local
  const handleDownload = useCallback(async () => {
    if (selectedRemote.size === 0 || !localPath || transferring) return;
    const files = remoteFiles.filter((f) => selectedRemote.has(f.path) && !f.is_dir);
    if (files.length === 0) return;

    setTransferring(true);
    const newTransfers: TransferItem[] = files.map((f) => ({
      id: crypto.randomUUID(),
      filename: f.name,
      direction: "download" as const,
      status: "pending" as const,
      size: f.size,
    }));
    setTransfers((prev) => [...newTransfers, ...prev]);

    const invoke = await getInvoke();
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const t = newTransfers[i];
      const localDest = `${localPath}${localSep}${f.name}`;

      setTransfers((prev) => prev.map((x) => x.id === t.id ? { ...x, status: "transferring" } : x));
      try {
        await invoke("sftp_download", { sessionId, remotePath: f.path, localPath: localDest });
        setTransfers((prev) => prev.map((x) => x.id === t.id ? { ...x, status: "done" } : x));
      } catch (e) {
        setTransfers((prev) => prev.map((x) => x.id === t.id ? { ...x, status: "error", error: String(e) } : x));
      }
    }
    setTransferring(false);
    loadLocal(localPath);
    setSelectedRemote(new Set());
  }, [selectedRemote, remoteFiles, localPath, localSep, sessionId, getInvoke, loadLocal, transferring]);

  // Upload: local -> remote
  const handleUpload = useCallback(async () => {
    if (selectedLocal.size === 0 || !remotePath || transferring) return;
    const files = localFiles.filter((f) => selectedLocal.has(f.path) && !f.is_dir);
    if (files.length === 0) return;

    setTransferring(true);
    const newTransfers: TransferItem[] = files.map((f) => ({
      id: crypto.randomUUID(),
      filename: f.name,
      direction: "upload" as const,
      status: "pending" as const,
      size: f.size,
    }));
    setTransfers((prev) => [...newTransfers, ...prev]);

    const invoke = await getInvoke();
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const t = newTransfers[i];
      const remoteDest = `${remotePath}/${f.name}`;

      setTransfers((prev) => prev.map((x) => x.id === t.id ? { ...x, status: "transferring" } : x));
      try {
        await invoke("sftp_upload", { sessionId, localPath: f.path, remotePath: remoteDest });
        setTransfers((prev) => prev.map((x) => x.id === t.id ? { ...x, status: "done" } : x));
      } catch (e) {
        setTransfers((prev) => prev.map((x) => x.id === t.id ? { ...x, status: "error", error: String(e) } : x));
      }
    }
    setTransferring(false);
    loadRemote(remotePath);
    setSelectedLocal(new Set());
  }, [selectedLocal, localFiles, remotePath, sessionId, getInvoke, loadRemote, transferring]);

  // Drag & drop transfer
  const handleDrop = useCallback(async (targetSide: "local" | "remote") => {
    dragCounterLocal.current = 0;
    dragCounterRemote.current = 0;
    setDragOver(null);
    const data = dragDataRef.current;
    if (!data || data.side === targetSide || transferring) return;
    dragDataRef.current = null;

    const files = data.files.filter((f) => !f.is_dir);
    if (files.length === 0) return;

    setTransferring(true);
    const direction = targetSide === "local" ? "download" : "upload";
    const newTransfers: TransferItem[] = files.map((f) => ({
      id: crypto.randomUUID(),
      filename: f.name,
      direction: direction as "upload" | "download",
      status: "pending" as const,
      size: f.size,
    }));
    setTransfers((prev) => [...newTransfers, ...prev]);

    const invoke = await getInvoke();
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const t = newTransfers[i];
      setTransfers((prev) => prev.map((x) => x.id === t.id ? { ...x, status: "transferring" } : x));

      try {
        if (direction === "download") {
          const localDest = `${localPath}${localSep}${f.name}`;
          await invoke("sftp_download", { sessionId, remotePath: f.path, localPath: localDest });
        } else {
          const remoteDest = `${remotePath}/${f.name}`;
          await invoke("sftp_upload", { sessionId, localPath: f.path, remotePath: remoteDest });
        }
        setTransfers((prev) => prev.map((x) => x.id === t.id ? { ...x, status: "done" } : x));
      } catch (e) {
        setTransfers((prev) => prev.map((x) => x.id === t.id ? { ...x, status: "error", error: String(e) } : x));
      }
    }
    setTransferring(false);

    // Refresh the target panel
    if (targetSide === "local") loadLocal(localPath);
    else loadRemote(remotePath);
  }, [localPath, localSep, remotePath, sessionId, getInvoke, loadLocal, loadRemote, transferring]);

  // Delete remote
  const handleDeleteRemote = async () => {
    if (selectedRemote.size === 0) return;
    const invoke = await getInvoke();
    for (const path of selectedRemote) {
      const entry = remoteFiles.find((f) => f.path === path);
      if (!entry) continue;
      try {
        await invoke("sftp_delete", { sessionId, path: entry.path, isDir: entry.is_dir });
      } catch {}
    }
    loadRemote(remotePath);
  };

  // Create remote folder
  const handleCreateRemoteFolder = async () => {
    if (!newFolderName.trim()) return;
    try {
      const invoke = await getInvoke();
      await invoke("sftp_mkdir", { sessionId, path: `${remotePath}/${newFolderName.trim()}` });
      setNewFolderName("");
      setShowNewFolder(false);
      loadRemote(remotePath);
    } catch {}
  };

  // Rename remote
  const handleRename = async () => {
    if (!renameTarget || !renameTarget.name.trim()) return;
    try {
      const invoke = await getInvoke();
      const parent = renameTarget.path.substring(0, renameTarget.path.lastIndexOf("/"));
      const newPath = `${parent}/${renameTarget.name.trim()}`;
      await invoke("sftp_rename", { sessionId, oldPath: renameTarget.path, newPath });
      setRenameTarget(null);
      loadRemote(remotePath);
    } catch {}
  };

  // Preview remote text file
  const handlePreview = async (entry: RemoteFileEntry) => {
    try {
      const invoke = await getInvoke();
      const content = await invoke<string>("sftp_read_text", { sessionId, path: entry.path });
      setPreviewContent(content);
      setPreviewName(entry.name);
    } catch (e) {
      setPreviewContent(`Error: ${e}`);
      setPreviewName(entry.name);
    }
  };

  // Toggle selection
  const toggleRemoteSelect = (path: string) => {
    setSelectedRemote((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };
  const toggleLocalSelect = (path: string) => {
    setSelectedLocal((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  const statusIcon = (status: TransferItem["status"]) => {
    switch (status) {
      case "pending": return <Loader2 size={10} style={{ color: "var(--text-muted)" }} />;
      case "transferring": return <Loader2 size={10} style={{ color: "var(--accent-primary)", animation: "spin 1s linear infinite" }} />;
      case "done": return <Check size={10} style={{ color: "var(--accent-secondary)" }} />;
      case "error": return <X size={10} style={{ color: "var(--accent-error)" }} />;
    }
  };

  // Drag handlers for file rows
  const onDragEnd = () => {
    dragDataRef.current = null;
    dragCounterLocal.current = 0;
    dragCounterRemote.current = 0;
    setDragOver(null);
  };

  const onDragStartLocal = (e: React.DragEvent, entries: LocalFileEntry[]) => {
    dragDataRef.current = {
      side: "local",
      files: entries.map((f) => ({ name: f.name, path: f.path, is_dir: f.is_dir, size: f.size })),
    };
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("text/plain", entries.map((f) => f.name).join(", "));
  };

  const onDragStartRemote = (e: React.DragEvent, entries: RemoteFileEntry[]) => {
    dragDataRef.current = {
      side: "remote",
      files: entries.map((f) => ({ name: f.name, path: f.path, is_dir: f.is_dir, size: f.size })),
    };
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("text/plain", entries.map((f) => f.name).join(", "));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 0 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexShrink: 0 }}>
        <button onClick={onDisconnect} style={{ ...btnStyle, background: "var(--bg-tertiary)", color: "var(--text-secondary)", padding: "4px 8px" }}>
          <X size={12} /> Back
        </button>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", flex: 1 }}>{connName}</span>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent-secondary)" }} />
        <button onClick={onDisconnect} style={{ ...btnStyle, background: "var(--accent-error)", color: "white", padding: "4px 8px" }}>
          <Square size={12} />
        </button>
      </div>

      {/* Preview modal */}
      {previewContent !== null && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 100, display: "flex", flexDirection: "column", padding: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", flex: 1 }}>{previewName}</span>
            <button onClick={() => setPreviewContent(null)} style={{ ...btnStyle, background: "var(--bg-tertiary)", color: "var(--text-secondary)", padding: "4px 8px" }}>
              <X size={12} /> Close
            </button>
          </div>
          <pre style={{
            flex: 1, overflow: "auto", background: "var(--bg-primary)", borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border-subtle)", padding: 10, fontSize: 11, color: "var(--text-primary)",
            fontFamily: "'JetBrains Mono', monospace", whiteSpace: "pre-wrap", wordBreak: "break-all", margin: 0,
          }}>
            {previewContent}
          </pre>
        </div>
      )}

      {/* Transfer buttons */}
      <div style={{ display: "flex", gap: 4, marginBottom: 6, flexShrink: 0 }}>
        <button
          onClick={handleUpload}
          disabled={selectedLocal.size === 0 || transferring}
          style={{
            ...btnStyle, flex: 1, justifyContent: "center",
            background: selectedLocal.size > 0 && !transferring ? "var(--accent-primary)" : "var(--bg-active)",
            color: selectedLocal.size > 0 && !transferring ? "white" : "var(--text-muted)",
            padding: "4px 8px", fontSize: 11,
          }}
          title="Upload selected local files to remote"
        >
          <Upload size={12} /> Upload ({selectedLocal.size})
        </button>
        <button
          onClick={handleDownload}
          disabled={selectedRemote.size === 0 || transferring}
          style={{
            ...btnStyle, flex: 1, justifyContent: "center",
            background: selectedRemote.size > 0 && !transferring ? "var(--accent-secondary)" : "var(--bg-active)",
            color: selectedRemote.size > 0 && !transferring ? "white" : "var(--text-muted)",
            padding: "4px 8px", fontSize: 11,
          }}
          title="Download selected remote files to local"
        >
          <Download size={12} /> Download ({selectedRemote.size})
        </button>
      </div>

      {/* Dual panels */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4, minHeight: 0 }}>
        {/* LOCAL PANEL */}
        <div
          style={{
            flex: 1, display: "flex", flexDirection: "column",
            border: `2px solid ${dragOver === "local" ? "var(--accent-primary)" : activePanel === "local" ? "var(--accent-primary)" : "var(--border-subtle)"}`,
            borderRadius: "var(--radius-sm)", overflow: "hidden", minHeight: 0,
            background: dragOver === "local" ? "rgba(88,166,255,0.05)" : undefined,
          }}
          onClick={() => setActivePanel("local")}
          onDragEnter={(e) => {
            if (dragDataRef.current?.side === "remote") {
              e.preventDefault();
              dragCounterLocal.current++;
              setDragOver("local");
            }
          }}
          onDragOver={(e) => {
            if (dragDataRef.current?.side === "remote") {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }
          }}
          onDragLeave={() => { dragCounterLocal.current--; if (dragCounterLocal.current <= 0) { dragCounterLocal.current = 0; setDragOver(null); } }}
          onDrop={(e) => { e.preventDefault(); dragCounterLocal.current = 0; handleDrop("local"); }}
        >
          <div style={{
            display: "flex", alignItems: "center", gap: 4, padding: "4px 6px",
            background: "var(--bg-tertiary)", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0,
          }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: "var(--accent-primary)", textTransform: "uppercase", letterSpacing: 1 }}>Local</span>
            <button onClick={localGoUp} style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: 2 }} title="Go up">
              <ArrowLeft size={11} />
            </button>
            <button onClick={() => loadLocal(localPath)} style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: 2 }} title="Refresh">
              <RefreshCw size={11} />
            </button>
            <div style={{ flex: 1, fontSize: 9, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "rtl", textAlign: "left" }}>
              {localPath}
            </div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }} className="hacking-log-container">
            {localLoading ? (
              <div style={{ textAlign: "center", padding: 12, color: "var(--text-muted)", fontSize: 11 }}>
                <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
              </div>
            ) : localError ? (
              <div style={{ padding: 8, fontSize: 10, color: "var(--accent-error)" }}>{localError}</div>
            ) : (
              localFiles.map((entry) => {
                const isSelected = selectedLocal.has(entry.path);
                return (
                  <div
                    key={entry.path}
                    draggable={!entry.is_dir}
                    onDragStart={(e) => {
                      const selected = localFiles.filter((f) => selectedLocal.has(f.path));
                      onDragStartLocal(e, selected.length > 0 && isSelected ? selected : [entry]);
                    }}
                    onDragEnd={onDragEnd}
                    onClick={() => toggleLocalSelect(entry.path)}
                    onDoubleClick={() => navigateLocal(entry)}
                    style={{
                      display: "flex", alignItems: "center", gap: 6, padding: "3px 6px", cursor: "pointer",
                      background: isSelected ? "rgba(88,166,255,0.15)" : "transparent",
                      borderBottom: "1px solid var(--border-subtle)", fontSize: 11,
                    }}
                  >
                    {entry.is_dir ? (
                      <Folder size={12} style={{ color: "var(--accent-primary)", flexShrink: 0 }} />
                    ) : (
                      <File size={12} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                    )}
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>
                      {entry.name}
                    </span>
                    {!entry.is_dir && (
                      <span style={{ fontSize: 9, color: "var(--text-muted)", flexShrink: 0 }}>{formatSize(entry.size)}</span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* REMOTE PANEL */}
        <div
          style={{
            flex: 1, display: "flex", flexDirection: "column",
            border: `2px solid ${dragOver === "remote" ? "var(--accent-secondary)" : activePanel === "remote" ? "var(--accent-primary)" : "var(--border-subtle)"}`,
            borderRadius: "var(--radius-sm)", overflow: "hidden", minHeight: 0,
            background: dragOver === "remote" ? "rgba(63,185,80,0.05)" : undefined,
          }}
          onClick={() => setActivePanel("remote")}
          onDragEnter={(e) => {
            if (dragDataRef.current?.side === "local") {
              e.preventDefault();
              dragCounterRemote.current++;
              setDragOver("remote");
            }
          }}
          onDragOver={(e) => {
            if (dragDataRef.current?.side === "local") {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }
          }}
          onDragLeave={() => { dragCounterRemote.current--; if (dragCounterRemote.current <= 0) { dragCounterRemote.current = 0; setDragOver(null); } }}
          onDrop={(e) => { e.preventDefault(); dragCounterRemote.current = 0; handleDrop("remote"); }}
        >
          <div style={{
            display: "flex", alignItems: "center", gap: 4, padding: "4px 6px",
            background: "var(--bg-tertiary)", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0,
          }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: "var(--accent-secondary)", textTransform: "uppercase", letterSpacing: 1 }}>Remote</span>
            <button onClick={remoteGoUp} style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: 2 }} title="Go up">
              <ArrowLeft size={11} />
            </button>
            <button onClick={() => loadRemote(remotePath)} style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: 2 }} title="Refresh">
              <RefreshCw size={11} />
            </button>
            <button onClick={() => setShowNewFolder(!showNewFolder)} style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: 2 }} title="New folder">
              <FolderPlus size={11} />
            </button>
            <button onClick={handleDeleteRemote} disabled={selectedRemote.size === 0} style={{ background: "none", border: "none", color: selectedRemote.size > 0 ? "var(--accent-error)" : "var(--text-muted)", cursor: selectedRemote.size > 0 ? "pointer" : "default", padding: 2 }} title="Delete selected">
              <Trash2 size={11} />
            </button>
            <div style={{ flex: 1, fontSize: 9, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "rtl", textAlign: "left" }}>
              {remotePath}
            </div>
          </div>

          {showNewFolder && (
            <div style={{ display: "flex", gap: 4, padding: "4px 6px", background: "var(--bg-tertiary)" }}>
              <input value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleCreateRemoteFolder(); }} placeholder="Folder name..." style={{ ...inputStyle, padding: "3px 6px", fontSize: 10 }} autoFocus />
              <button onClick={handleCreateRemoteFolder} style={{ background: "none", border: "none", color: "var(--accent-secondary)", cursor: "pointer", padding: 2 }}><Check size={12} /></button>
              <button onClick={() => { setShowNewFolder(false); setNewFolderName(""); }} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 2 }}><X size={12} /></button>
            </div>
          )}

          {renameTarget && (
            <div style={{ display: "flex", gap: 4, padding: "4px 6px", background: "var(--bg-tertiary)" }}>
              <input value={renameTarget.name} onChange={(e) => setRenameTarget({ ...renameTarget, name: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") handleRename(); }} style={{ ...inputStyle, padding: "3px 6px", fontSize: 10 }} autoFocus />
              <button onClick={handleRename} style={{ background: "none", border: "none", color: "var(--accent-secondary)", cursor: "pointer", padding: 2 }}><Check size={12} /></button>
              <button onClick={() => setRenameTarget(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 2 }}><X size={12} /></button>
            </div>
          )}

          <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }} className="hacking-log-container">
            {remoteLoading ? (
              <div style={{ textAlign: "center", padding: 12, color: "var(--text-muted)", fontSize: 11 }}>
                <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
              </div>
            ) : remoteError ? (
              <div style={{ padding: 8, fontSize: 10, color: "var(--accent-error)" }}>{remoteError}</div>
            ) : (
              remoteFiles.map((entry) => {
                const isSelected = selectedRemote.has(entry.path);
                return (
                  <div
                    key={entry.path}
                    draggable={!entry.is_dir}
                    onDragStart={(e) => {
                      const selected = remoteFiles.filter((f) => selectedRemote.has(f.path));
                      onDragStartRemote(e, selected.length > 0 && isSelected ? selected : [entry]);
                    }}
                    onDragEnd={onDragEnd}
                    onClick={() => toggleRemoteSelect(entry.path)}
                    onDoubleClick={() => navigateRemote(entry)}
                    style={{
                      display: "flex", alignItems: "center", gap: 6, padding: "3px 6px", cursor: "pointer",
                      background: isSelected ? "rgba(63,185,80,0.15)" : "transparent",
                      borderBottom: "1px solid var(--border-subtle)", fontSize: 11,
                    }}
                  >
                    {entry.is_dir ? (
                      <Folder size={12} style={{ color: "var(--accent-secondary)", flexShrink: 0 }} />
                    ) : (
                      <File size={12} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                    )}
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>
                      {entry.name}
                    </span>
                    <span style={{ fontSize: 8, color: "var(--text-muted)", flexShrink: 0 }}>{formatPermissions(entry.permissions)}</span>
                    {!entry.is_dir && (
                      <>
                        <button onClick={(e) => { e.stopPropagation(); handlePreview(entry); }} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 1 }} title="Preview">
                          <Eye size={10} />
                        </button>
                        <span style={{ fontSize: 9, color: "var(--text-muted)", flexShrink: 0 }}>{formatSize(entry.size)}</span>
                      </>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); setRenameTarget({ path: entry.path, name: entry.name }); }} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 1 }} title="Rename">
                      <Edit3 size={10} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Transfer log */}
      {transfers.length > 0 && (
        <div style={{ flexShrink: 0, marginTop: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 1 }}>Transfers</span>
            <button onClick={() => setTransfers([])} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 1, marginLeft: "auto" }}>
              <Trash2 size={9} />
            </button>
          </div>
          <div style={{ maxHeight: 80, overflowY: "auto" }} className="hacking-log-container">
            {transfers.map((t) => (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 4px", fontSize: 9, borderBottom: "1px solid var(--border-subtle)" }}>
                {statusIcon(t.status)}
                {t.direction === "upload" ? <Upload size={9} style={{ color: "var(--accent-primary)" }} /> : <Download size={9} style={{ color: "var(--accent-secondary)" }} />}
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>{t.filename}</span>
                {t.size !== undefined && <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>{formatSize(t.size)}</span>}
                {t.error && <span style={{ color: "var(--accent-error)", flexShrink: 0 }} title={t.error}>err</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
