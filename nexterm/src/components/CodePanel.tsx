import { useState, useEffect, useMemo, useRef } from "react";
import {
  Plus, Trash2, Play, Pencil, Check, X, Code2, Cloud, Cpu, Monitor,
  Download, ExternalLink, AlertTriangle, CheckCircle2,
  Hand, Zap, Eye, ChevronDown,
} from "lucide-react";
import { useAppStore } from "../store/appStore";
import type { CodeSession, SSHConnection, CodeEditMode } from "../store/appStore";
import { useT } from "../i18n";
import { CODE_AGENTS, getAgent } from "../data/codeAgents";

// UI metadata for each edit mode — icon, color, i18n key
const EDIT_MODES: Array<{ id: CodeEditMode; icon: typeof Hand; color: string; labelKey: string; descKey: string }> = [
  { id: "manual",      icon: Hand, color: "#58a6ff", labelKey: "code.modeManual",     descKey: "code.modeManualDesc" },
  { id: "auto-accept", icon: Zap,  color: "#d29922", labelKey: "code.modeAutoAccept", descKey: "code.modeAutoAcceptDesc" },
  { id: "plan",        icon: Eye,  color: "#7c5cff", labelKey: "code.modePlan",       descKey: "code.modePlanDesc" },
];

function getModeMeta(mode: CodeEditMode) {
  return EDIT_MODES.find((m) => m.id === mode) ?? EDIT_MODES[0];
}

let tauriCoreCache: typeof import("@tauri-apps/api/core") | null = null;
async function getTauriCore() {
  if (!tauriCoreCache) tauriCoreCache = await import("@tauri-apps/api/core");
  return tauriCoreCache;
}

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

const tierBadgeStyle = (tier: "free" | "free-tier" | "byok"): React.CSSProperties => {
  const colors = {
    free: { bg: "rgba(63,185,80,0.15)", fg: "#3fb950", border: "rgba(63,185,80,0.4)" },
    "free-tier": { bg: "rgba(88,166,255,0.15)", fg: "#58a6ff", border: "rgba(88,166,255,0.4)" },
    byok: { bg: "rgba(210,153,34,0.15)", fg: "#d29922", border: "rgba(210,153,34,0.4)" },
  };
  const c = colors[tier];
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    padding: "1px 6px",
    fontSize: 9,
    fontWeight: 600,
    borderRadius: 8,
    background: c.bg,
    color: c.fg,
    border: `1px solid ${c.border}`,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  };
};

export function CodePanel() {
  const codeSessions = useAppStore((s) => s.codeSessions);
  const sshConnections = useAppStore((s) => s.sshConnections);
  const addCodeSession = useAppStore((s) => s.addCodeSession);
  const updateCodeSession = useAppStore((s) => s.updateCodeSession);
  const removeCodeSession = useAppStore((s) => s.removeCodeSession);
  const launchCodeSession = useAppStore((s) => s.launchCodeSession);
  const t = useT();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formTargetKind, setFormTargetKind] = useState<"local" | "ssh">("local");
  const [formSshId, setFormSshId] = useState<string>("");
  const [formAgentId, setFormAgentId] = useState<string>(CODE_AGENTS[0].id);
  const [formWorkingDir, setFormWorkingDir] = useState("");
  const [formEditMode, setFormEditMode] = useState<CodeEditMode>("manual");

  // Per-card edit-mode dropdown (only one open at a time)
  const [openModeMenu, setOpenModeMenu] = useState<string | null>(null);
  const modeMenuRef = useRef<HTMLDivElement | null>(null);

  // Close mode dropdown on outside click / Escape
  useEffect(() => {
    if (!openModeMenu) return;
    const onClick = (e: MouseEvent) => {
      if (modeMenuRef.current && !modeMenuRef.current.contains(e.target as Node)) {
        setOpenModeMenu(null);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenModeMenu(null); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [openModeMenu]);

  // Per-session install detection cache (id → status)
  const [installStatus, setInstallStatus] = useState<Record<string, "checking" | "installed" | "missing" | "error" | "unknown">>({});

  // Install confirmation state
  const [installPrompt, setInstallPrompt] = useState<{ sessionId: string; agentName: string; cmd: string; isLocal: boolean } | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [installResult, setInstallResult] = useState<{ sessionId: string; ok: boolean; message: string } | null>(null);

  const resetForm = () => {
    setFormName("");
    setFormTargetKind("local");
    setFormSshId("");
    setFormAgentId(CODE_AGENTS[0].id);
    setFormWorkingDir("");
    setFormEditMode("manual");
    setEditingId(null);
    setShowForm(false);
  };

  const handleEdit = (sess: CodeSession) => {
    setFormName(sess.name);
    setFormTargetKind(sess.target.kind);
    setFormSshId(sess.target.kind === "ssh" ? sess.target.sshConnectionId : "");
    setFormAgentId(sess.agentId);
    setFormWorkingDir(sess.workingDir);
    setFormEditMode(sess.editMode || "manual");
    setEditingId(sess.id);
    setShowForm(true);
  };

  const handleSave = () => {
    if (!formName) return;
    if (formTargetKind === "ssh" && !formSshId) return;

    const target: CodeSession["target"] =
      formTargetKind === "local"
        ? { kind: "local" }
        : { kind: "ssh", sshConnectionId: formSshId };

    if (editingId) {
      // If the agent changed, the previous install status no longer applies —
      // reset the hint so the next auto-detect re-probes the new agent.
      const prev = codeSessions.find((c) => c.id === editingId);
      const agentChanged = prev && prev.agentId !== formAgentId;
      updateCodeSession(editingId, {
        name: formName,
        target,
        agentId: formAgentId,
        workingDir: formWorkingDir,
        editMode: formEditMode,
        ...(agentChanged ? { installedHint: "unknown", installedCheckedAt: undefined } : {}),
      });
      if (agentChanged) {
        setInstallStatus((p) => ({ ...p, [editingId]: "unknown" }));
      }
    } else {
      addCodeSession({
        name: formName,
        target,
        agentId: formAgentId,
        workingDir: formWorkingDir,
        editMode: formEditMode,
        installedHint: "unknown",
      });
    }
    resetForm();
  };

  // Build the launch command including the per-mode CLI flag.
  // Example: "claude" + auto-accept + Claude → "claude --dangerously-skip-permissions"
  const buildLaunchCmd = (sess: CodeSession): string | null => {
    const agent = getAgent(sess.agentId);
    if (!agent) return null;
    const flag = agent.flagsByMode[sess.editMode];
    return flag ? `${agent.launchCmd} ${flag}` : agent.launchCmd;
  };

  const handleLaunch = (sess: CodeSession) => {
    const cmd = buildLaunchCmd(sess);
    if (!cmd) return;
    launchCodeSession(sess.id, cmd);
  };

  // Quick mode change from the per-card dropdown — saves and closes the menu.
  const handleModeChange = (sessId: string, mode: CodeEditMode) => {
    updateCodeSession(sessId, { editMode: mode });
    setOpenModeMenu(null);
  };

  const handleDelete = (sess: CodeSession) => {
    removeCodeSession(sess.id);
    setInstallStatus((prev) => {
      const next = { ...prev };
      delete next[sess.id];
      return next;
    });
  };

  // ── Detect install per session (best-effort, non-blocking) ──
  // Local: spawn the agent's check command via the existing exec helper.
  // SSH: needs a live SSH session — if disconnected, show "unknown".
  const detect = async (sess: CodeSession) => {
    const agent = getAgent(sess.agentId);
    if (!agent) return;
    setInstallStatus((p) => ({ ...p, [sess.id]: "checking" }));
    try {
      const { invoke } = await getTauriCore();
      if (sess.target.kind === "local") {
        const isWin = navigator.platform.startsWith("Win");
        const out = await invoke<string>("code_panel_local_exec", {
          command: isWin ? agent.checkCmdWindows : agent.checkCmd,
          shell: isWin ? "powershell" : "sh",
        }).catch(() => "");
        const status = String(out).trim().toUpperCase().includes("OK") ? "installed" : "missing";
        setInstallStatus((p) => ({ ...p, [sess.id]: status }));
        updateCodeSession(sess.id, {
          installedHint: status === "installed" ? "yes" : "no",
          installedCheckedAt: Date.now(),
        });
      } else {
        const sshId = sess.target.sshConnectionId;
        const conn = sshConnections.find((c) => c.id === sshId);
        if (!conn || (!conn.sessionPassword && !conn.privateKey)) {
          // No live credentials — we don't trigger a fresh handshake just to probe.
          // User can connect via SSH panel first, then re-check.
          setInstallStatus((p) => ({ ...p, [sess.id]: "unknown" }));
          return;
        }
        const out = await invoke<string>("ssh_exec", {
          host: conn.host,
          port: conn.port,
          username: conn.username,
          password: conn.sessionPassword || null,
          privateKey: conn.privateKey || null,
          command: agent.checkCmd,
        }).catch(() => "");
        const status = String(out).trim().toUpperCase().includes("OK") ? "installed" : "missing";
        setInstallStatus((p) => ({ ...p, [sess.id]: status }));
        updateCodeSession(sess.id, {
          installedHint: status === "installed" ? "yes" : "no",
          installedCheckedAt: Date.now(),
        });
      }
    } catch {
      setInstallStatus((p) => ({ ...p, [sess.id]: "error" }));
    }
  };

  // Auto-detect on mount and when sessions change
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const sess of codeSessions) {
        if (cancelled) return;
        const cur = installStatus[sess.id];
        if (cur && cur !== "unknown") continue;
        await detect(sess);
      }
    })();
    return () => { cancelled = true; };
    // Re-run when set of session ids changes (not on every cache update)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeSessions.map((s) => s.id).join("|")]);

  const askInstall = (sess: CodeSession) => {
    const agent = getAgent(sess.agentId);
    if (!agent) return;
    const isLocal = sess.target.kind === "local";
    const isWin = isLocal && navigator.platform.startsWith("Win");
    const cmd = isLocal
      ? (isWin ? agent.installLocalWindows : agent.installRemote)
      : agent.installRemote;
    setInstallPrompt({ sessionId: sess.id, agentName: agent.name, cmd, isLocal });
  };

  const runInstall = async () => {
    if (!installPrompt) return;
    const sess = codeSessions.find((c) => c.id === installPrompt.sessionId);
    if (!sess) return;
    setInstallingId(sess.id);
    setInstallPrompt(null);
    try {
      const { invoke } = await getTauriCore();
      if (installPrompt.isLocal) {
        const isWin = navigator.platform.startsWith("Win");
        const out = await invoke<string>("code_panel_local_exec", {
          command: installPrompt.cmd,
          shell: isWin ? "powershell" : "sh",
        });
        setInstallResult({ sessionId: sess.id, ok: true, message: String(out).slice(-400) });
      } else {
        const sshId = (sess.target as { sshConnectionId: string }).sshConnectionId;
        const conn = sshConnections.find((c) => c.id === sshId);
        if (!conn) throw new Error("SSH connection no longer exists");
        if (!conn.sessionPassword && !conn.privateKey) {
          throw new Error("Connect via SSH panel first so we have credentials to run the installer");
        }
        const out = await invoke<string>("ssh_exec", {
          host: conn.host,
          port: conn.port,
          username: conn.username,
          password: conn.sessionPassword || null,
          privateKey: conn.privateKey || null,
          command: installPrompt.cmd,
        });
        setInstallResult({ sessionId: sess.id, ok: true, message: String(out).slice(-400) });
      }
      // Re-probe install
      await detect(sess);
    } catch (e) {
      setInstallResult({ sessionId: sess.id, ok: false, message: String(e).slice(0, 400) });
    } finally {
      setInstallingId(null);
    }
  };

  // Pre-compute SSH connection lookup
  const sshById = useMemo(() => {
    const map = new Map<string, SSHConnection>();
    for (const c of sshConnections) map.set(c.id, c);
    return map;
  }, [sshConnections]);

  return (
    <div style={{ padding: 16, height: "100%", overflowY: "auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: 8 }}>
            <Code2 size={18} style={{ color: "var(--accent-primary)" }} />
            {t("code.title")}
          </h2>
          <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-muted)" }}>
            {t("code.subtitle")}
          </p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(!showForm); }}
          style={{ ...btnStyle, background: "var(--accent-primary)", color: "white" }}
        >
          <Plus size={14} /> {t("code.newSession")}
        </button>
      </div>

      {/* Agent quick-reference strip */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
        gap: 8,
        marginBottom: 16,
      }}>
        {CODE_AGENTS.map((a) => (
          <div key={a.id} style={{
            padding: 8,
            background: "var(--bg-tertiary)",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border-subtle)",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{a.name}</span>
              <span style={tierBadgeStyle(a.costTier)}>{a.costNote}</span>
            </div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", lineHeight: 1.3 }}>
              {a.description}
            </div>
            <a
              href={a.docsUrl}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 10, color: "var(--accent-primary)", textDecoration: "none", marginTop: 4, display: "inline-flex", alignItems: "center", gap: 3 }}
            >
              <ExternalLink size={9} /> {t("code.docs")}
            </a>
          </div>
        ))}
      </div>

      {/* Connection Form */}
      {showForm && (
        <div style={{
          padding: 12,
          background: "var(--bg-tertiary)",
          borderRadius: "var(--radius-md)",
          marginBottom: 16,
          border: "1px solid var(--border-subtle)",
        }}>
          <div style={{ marginBottom: 8 }}>
            <label style={labelStyle}>{t("code.sessionName")}</label>
            <input
              placeholder={t("code.sessionNamePlaceholder")}
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: 8 }}>
            <label style={labelStyle}>{t("code.target")}</label>
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <button
                onClick={() => setFormTargetKind("local")}
                style={{
                  ...btnStyle,
                  flex: 1,
                  justifyContent: "center",
                  background: formTargetKind === "local" ? "var(--accent-primary)" : "var(--bg-active)",
                  color: formTargetKind === "local" ? "white" : "var(--text-secondary)",
                }}
              >
                <Cpu size={12} /> {t("code.localMachine")}
              </button>
              <button
                onClick={() => setFormTargetKind("ssh")}
                style={{
                  ...btnStyle,
                  flex: 1,
                  justifyContent: "center",
                  background: formTargetKind === "ssh" ? "var(--accent-primary)" : "var(--bg-active)",
                  color: formTargetKind === "ssh" ? "white" : "var(--text-secondary)",
                }}
              >
                <Cloud size={12} /> {t("code.sshRemote")}
              </button>
            </div>

            {formTargetKind === "ssh" && (
              <select
                value={formSshId}
                onChange={(e) => setFormSshId(e.target.value)}
                style={inputStyle}
              >
                <option value="">{t("code.selectSshConnection")}</option>
                {sshConnections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.username}@{c.host})
                  </option>
                ))}
              </select>
            )}

            {formTargetKind === "ssh" && sshConnections.length === 0 && (
              <div style={{ fontSize: 11, color: "var(--accent-warning)", marginTop: 4 }}>
                {t("code.noSshConnectionsHint")}
              </div>
            )}
          </div>

          <div style={{ marginBottom: 8 }}>
            <label style={labelStyle}>{t("code.agent")}</label>
            <select
              value={formAgentId}
              onChange={(e) => setFormAgentId(e.target.value)}
              style={inputStyle}
            >
              {CODE_AGENTS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} — {a.costNote}
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: 8 }}>
            <label style={labelStyle}>{t("code.editMode")}</label>
            <div style={{ display: "flex", gap: 4 }}>
              {EDIT_MODES.map((m) => {
                const Icon = m.icon;
                const agent = CODE_AGENTS.find((a) => a.id === formAgentId);
                const supported = m.id === "manual" || (agent?.flagsByMode[m.id] !== undefined);
                const isActive = formEditMode === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => setFormEditMode(m.id)}
                    disabled={!supported}
                    title={supported ? t(m.descKey) : t("code.modeNotSupported")}
                    style={{
                      ...btnStyle,
                      flex: 1,
                      justifyContent: "center",
                      flexDirection: "column",
                      alignItems: "stretch",
                      padding: "6px 4px",
                      background: isActive ? m.color : "var(--bg-active)",
                      color: isActive ? "white" : (supported ? "var(--text-secondary)" : "var(--text-muted)"),
                      opacity: supported ? 1 : 0.4,
                      cursor: supported ? "pointer" : "not-allowed",
                      border: isActive ? `1px solid ${m.color}` : "1px solid transparent",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, fontSize: 11, fontWeight: 600 }}>
                      <Icon size={11} /> {t(m.labelKey)}
                    </div>
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
              {t(getModeMeta(formEditMode).descKey)}
            </div>
          </div>

          <div style={{ marginBottom: 8 }}>
            <label style={labelStyle}>{t("code.workingDir")}</label>
            <input
              placeholder={
                formTargetKind === "local"
                  ? (navigator.platform.startsWith("Win") ? "C:\\Users\\me\\projects\\app" : "/home/me/projects/app")
                  : "/var/www/myapp"
              }
              value={formWorkingDir}
              onChange={(e) => setFormWorkingDir(e.target.value)}
              style={inputStyle}
            />
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
              {t("code.workingDirHint")}
            </div>
          </div>

          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button
              onClick={handleSave}
              disabled={!formName || (formTargetKind === "ssh" && !formSshId)}
              style={{
                ...btnStyle,
                flex: 1,
                justifyContent: "center",
                background: "var(--accent-primary)",
                color: "white",
                opacity: (!formName || (formTargetKind === "ssh" && !formSshId)) ? 0.5 : 1,
              }}
            >
              <Check size={12} />
              {editingId ? t("common.update") : t("common.save")}
            </button>
            <button
              onClick={resetForm}
              style={{ ...btnStyle, background: "var(--bg-active)", color: "var(--text-secondary)" }}
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      {/* Install Prompt Dialog */}
      {installPrompt && (
        <div style={{
          padding: 12,
          background: "var(--bg-tertiary)",
          borderRadius: "var(--radius-md)",
          marginBottom: 16,
          border: "1px solid var(--accent-warning)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <AlertTriangle size={14} style={{ color: "var(--accent-warning)" }} />
            <span style={{ fontSize: 12, fontWeight: 600 }}>
              {t("code.installPromptTitle")} {installPrompt.agentName}?
            </span>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 8 }}>
            {t("code.installPromptBody")} {installPrompt.isLocal ? t("code.thisMachine") : t("code.remoteServer")}:
          </div>
          <pre style={{
            margin: "0 0 8px",
            padding: 8,
            background: "var(--bg-secondary)",
            borderRadius: "var(--radius-sm)",
            fontSize: 11,
            color: "var(--text-primary)",
            overflowX: "auto",
            border: "1px solid var(--border-subtle)",
          }}>{installPrompt.cmd}</pre>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={runInstall}
              style={{ ...btnStyle, flex: 1, justifyContent: "center", background: "var(--accent-warning)", color: "#1a1b2e", fontWeight: 600 }}
            >
              <Download size={12} /> {t("code.runInstall")}
            </button>
            <button
              onClick={() => setInstallPrompt(null)}
              style={{ ...btnStyle, background: "var(--bg-active)", color: "var(--text-secondary)" }}
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      {/* Install Result Toast */}
      {installResult && (
        <div style={{
          padding: 10,
          background: installResult.ok ? "rgba(63,185,80,0.1)" : "rgba(248,81,73,0.1)",
          borderRadius: "var(--radius-md)",
          marginBottom: 16,
          border: `1px solid ${installResult.ok ? "rgba(63,185,80,0.4)" : "rgba(248,81,73,0.4)"}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            {installResult.ok
              ? <CheckCircle2 size={14} style={{ color: "#3fb950" }} />
              : <AlertTriangle size={14} style={{ color: "#f85149" }} />}
            <span style={{ fontSize: 12, fontWeight: 600 }}>
              {installResult.ok ? t("code.installOk") : t("code.installFailed")}
            </span>
            <button
              onClick={() => setInstallResult(null)}
              style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2 }}
            >
              <X size={12} />
            </button>
          </div>
          <pre style={{ margin: 0, fontSize: 10, color: "var(--text-muted)", whiteSpace: "pre-wrap", maxHeight: 100, overflowY: "auto" }}>
            {installResult.message}
          </pre>
        </div>
      )}

      {/* Session List */}
      {codeSessions.length === 0 && !showForm ? (
        <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 32, fontSize: 12 }}>
          <Code2 size={32} style={{ margin: "0 auto 12px", opacity: 0.4 }} />
          <div>{t("code.noSessionsYet")}</div>
          <div style={{ marginTop: 4 }}>{t("code.clickToCreate")}</div>
        </div>
      ) : (
        codeSessions.map((sess) => {
          const agent = getAgent(sess.agentId);
          const sshConn = sess.target.kind === "ssh" ? sshById.get(sess.target.sshConnectionId) : null;
          const status = installStatus[sess.id] || "unknown";
          const sshDisconnected = sess.target.kind === "ssh" && sshConn?.status !== "connected";
          const currentMode = sess.editMode || "manual";
          const modeMeta = getModeMeta(currentMode);
          const ModeIcon = modeMeta.icon;
          const modeMenuOpen = openModeMenu === sess.id;

          return (
            <div key={sess.id} className="ssh-connection-card" style={{ position: "relative" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--text-primary)", flexWrap: "wrap" }}>
                    {sess.target.kind === "local"
                      ? <Cpu size={11} style={{ color: "var(--accent-secondary)" }} />
                      : <Cloud size={11} style={{ color: "var(--accent-primary)" }} />}
                    {sess.name}
                    {agent && <span style={tierBadgeStyle(agent.costTier)}>{agent.costNote}</span>}
                    {/* Edit-mode pill (clickable → dropdown) */}
                    <button
                      onClick={(e) => { e.stopPropagation(); setOpenModeMenu(modeMenuOpen ? null : sess.id); }}
                      title={t(modeMeta.descKey)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 3,
                        padding: "1px 6px 1px 5px",
                        fontSize: 9,
                        fontWeight: 600,
                        borderRadius: 8,
                        background: `${modeMeta.color}26`,
                        color: modeMeta.color,
                        border: `1px solid ${modeMeta.color}66`,
                        cursor: "pointer",
                        textTransform: "uppercase",
                        letterSpacing: 0.3,
                        fontFamily: "inherit",
                      }}
                    >
                      <ModeIcon size={9} /> {t(modeMeta.labelKey)} <ChevronDown size={9} />
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                    <span style={{ color: "var(--accent-primary)" }}>{agent?.name || sess.agentId}</span>
                    {" → "}
                    {sess.target.kind === "local"
                      ? t("code.localMachine")
                      : (sshConn ? `${sshConn.username}@${sshConn.host}` : t("code.unknownConnection"))}
                    {sess.workingDir && <span> · {sess.workingDir}</span>}
                  </div>
                  {/* Install hint */}
                  <div style={{ marginTop: 4, fontSize: 10 }}>
                    {status === "checking" && <span style={{ color: "var(--text-muted)" }}>{t("code.checkingInstall")}</span>}
                    {status === "installed" && <span style={{ color: "#3fb950" }}>● {t("code.installed")}</span>}
                    {status === "missing" && <span style={{ color: "#d29922" }}>● {t("code.notInstalled")}</span>}
                    {status === "unknown" && <span style={{ color: "var(--text-muted)" }}>○ {t("code.statusUnknown")}</span>}
                    {status === "error" && <span style={{ color: "#f85149" }}>● {t("code.detectError")}</span>}
                    {sshDisconnected && (
                      <span style={{ marginLeft: 6, color: "var(--accent-warning)" }}>
                        · {t("code.sshNotConnected")}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
                <button
                  onClick={() => handleLaunch(sess)}
                  style={{
                    ...btnStyle,
                    flex: 1,
                    minWidth: 100,
                    justifyContent: "center",
                    background: "var(--accent-secondary)",
                    color: "white",
                  }}
                  title={status === "missing" ? t("code.willFailIfMissing") : ""}
                >
                  <Play size={12} /> {t("code.launch")}
                </button>

                {status === "missing" && (
                  <button
                    onClick={() => askInstall(sess)}
                    disabled={installingId === sess.id}
                    style={{
                      ...btnStyle,
                      background: "var(--accent-warning)",
                      color: "#1a1b2e",
                      opacity: installingId === sess.id ? 0.5 : 1,
                    }}
                    title={t("code.installAgent")}
                  >
                    <Download size={12} /> {t("code.install")}
                  </button>
                )}

                <button
                  onClick={() => detect(sess)}
                  style={{ ...btnStyle, background: "var(--bg-active)", color: "var(--text-secondary)" }}
                  title={t("code.recheck")}
                >
                  <Monitor size={12} />
                </button>

                <button
                  onClick={() => handleEdit(sess)}
                  style={{ ...btnStyle, background: "var(--bg-active)", color: "var(--text-secondary)" }}
                  title={t("common.edit")}
                >
                  <Pencil size={12} />
                </button>
                <button
                  onClick={() => handleDelete(sess)}
                  style={{ ...btnStyle, background: "var(--bg-active)", color: "var(--accent-error)" }}
                  title={t("common.delete")}
                >
                  <Trash2 size={12} />
                </button>
              </div>

              {/* Edit-mode dropdown (overlays the card) */}
              {modeMenuOpen && (
                <div
                  ref={modeMenuRef}
                  style={{
                    position: "absolute",
                    top: 32,
                    left: 12,
                    zIndex: 100,
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "var(--radius-md)",
                    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                    padding: 4,
                    minWidth: 220,
                  }}
                >
                  {EDIT_MODES.map((m) => {
                    const Icon = m.icon;
                    const supported = m.id === "manual" || (agent?.flagsByMode[m.id] !== undefined);
                    const isCurrent = currentMode === m.id;
                    return (
                      <button
                        key={m.id}
                        onClick={() => supported && handleModeChange(sess.id, m.id)}
                        disabled={!supported}
                        title={supported ? "" : t("code.modeNotSupported")}
                        style={{
                          width: "100%",
                          padding: "8px 10px",
                          background: isCurrent ? `${m.color}1f` : "transparent",
                          border: "none",
                          borderRadius: "var(--radius-sm)",
                          cursor: supported ? "pointer" : "not-allowed",
                          opacity: supported ? 1 : 0.4,
                          fontFamily: "inherit",
                          textAlign: "left",
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 8,
                          color: "var(--text-primary)",
                        }}
                        onMouseEnter={(e) => { if (supported && !isCurrent) (e.currentTarget as HTMLButtonElement).style.background = "var(--bg-tertiary)"; }}
                        onMouseLeave={(e) => { if (supported && !isCurrent) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                      >
                        <Icon size={14} style={{ color: m.color, flexShrink: 0, marginTop: 1 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                            {t(m.labelKey)}
                            {isCurrent && <Check size={11} style={{ color: m.color }} />}
                          </div>
                          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.3 }}>
                            {t(m.descKey)}
                          </div>
                          {!supported && (
                            <div style={{ fontSize: 10, color: "var(--accent-warning)", marginTop: 2 }}>
                              {t("code.modeNotSupported")}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
