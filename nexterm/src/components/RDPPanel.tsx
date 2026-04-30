import { useState, useEffect } from "react";
import {
  Plus, Trash2, Play, Pencil, Loader2, Check, X, Monitor,
  Shield, ShieldCheck,
} from "lucide-react";
import { useAppStore } from "../store/appStore";
import { useT } from "../i18n";
import type { RDPConnection } from "../store/appStore";

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

const RES_PRESETS: Array<{ label: string; w: number; h: number }> = [
  { label: "1280×800", w: 1280, h: 800 },
  { label: "1366×768", w: 1366, h: 768 },
  { label: "1600×900", w: 1600, h: 900 },
  { label: "1920×1080", w: 1920, h: 1080 },
  { label: "2560×1440", w: 2560, h: 1440 },
];

export function RDPPanel() {
  const rdpConnections = useAppStore((s) => s.rdpConnections);
  const addRDPConnection = useAppStore((s) => s.addRDPConnection);
  const updateRDPConnection = useAppStore((s) => s.updateRDPConnection);
  const removeRDPConnection = useAppStore((s) => s.removeRDPConnection);
  const t = useT();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [keychainIds, setKeychainIds] = useState<Set<string>>(new Set());

  // Form state
  const [formName, setFormName] = useState("");
  const [formHost, setFormHost] = useState("");
  const [formPort, setFormPort] = useState(3389);
  const [formUser, setFormUser] = useState("");
  const [formDomain, setFormDomain] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formSavePassword, setFormSavePassword] = useState<"keychain" | "none">("keychain");
  const [formFullscreen, setFormFullscreen] = useState(false);
  const [formWidth, setFormWidth] = useState(1280);
  const [formHeight, setFormHeight] = useState(800);
  const [formMultimon, setFormMultimon] = useState(false);
  const [formAdmin, setFormAdmin] = useState(false);

  // Password prompt state (for connections without stored password)
  const [passwordPrompt, setPasswordPrompt] = useState<{ connId: string; password: string; saveMode: "none" | "keychain" } | null>(null);

  // Discover which connections have a saved password in the OS keychain
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { invoke } = await getTauriCore();
        const results = await Promise.allSettled(
          rdpConnections.map(async (conn) => {
            const pass = await invoke<string | null>("keychain_get_password", { connectionId: conn.id });
            return pass ? conn.id : null;
          })
        );
        if (cancelled) return;
        const ids = new Set<string>();
        for (const r of results) {
          if (r.status === "fulfilled" && r.value) ids.add(r.value);
        }
        setKeychainIds(ids);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [rdpConnections.length]);

  const resetForm = () => {
    setFormName("");
    setFormHost("");
    setFormPort(3389);
    setFormUser("");
    setFormDomain("");
    setFormPassword("");
    setFormSavePassword("keychain");
    setFormFullscreen(false);
    setFormWidth(1280);
    setFormHeight(800);
    setFormMultimon(false);
    setFormAdmin(false);
    setEditingId(null);
    setShowForm(false);
  };

  const handleEdit = (conn: RDPConnection) => {
    setFormName(conn.name);
    setFormHost(conn.host);
    setFormPort(conn.port);
    setFormUser(conn.username);
    setFormDomain(conn.domain || "");
    setFormPassword("");
    setFormSavePassword(keychainIds.has(conn.id) ? "keychain" : "none");
    setFormFullscreen(!!conn.fullscreen);
    setFormWidth(conn.width || 1280);
    setFormHeight(conn.height || 800);
    setFormMultimon(!!conn.multimon);
    setFormAdmin(!!conn.admin);
    setEditingId(conn.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!formName || !formHost || !formUser) return;

    const connData: Omit<RDPConnection, "id" | "status"> = {
      name: formName,
      host: formHost,
      port: formPort,
      username: formUser,
      domain: formDomain || undefined,
      fullscreen: formFullscreen,
      width: formFullscreen ? undefined : formWidth,
      height: formFullscreen ? undefined : formHeight,
      multimon: formMultimon,
      admin: formAdmin,
    };

    if (editingId) {
      updateRDPConnection(editingId, connData);
    } else {
      addRDPConnection(connData);
    }

    // Save password to keychain if the user typed one + opted in. After
    // addRDPConnection, the freshly-created entry is at the end of the list
    // (Zustand set is synchronous, so the read below sees the new state).
    if (formPassword && formSavePassword === "keychain") {
      const list = useAppStore.getState().rdpConnections;
      const targetId = editingId ?? list[list.length - 1]?.id;
      if (targetId) {
        try {
          const { invoke } = await getTauriCore();
          await invoke("keychain_save_password", { connectionId: targetId, password: formPassword });
          setKeychainIds((prev) => new Set(prev).add(targetId));
        } catch {}
      }
    }

    resetForm();
  };

  const handleConnect = async (conn: RDPConnection, password?: string) => {
    updateRDPConnection(conn.id, { status: "launching", errorMessage: undefined });
    try {
      const { invoke } = await getTauriCore();
      await invoke("rdp_connect", {
        host: conn.host,
        port: conn.port,
        username: conn.username,
        domain: conn.domain || null,
        password: password || null,
        fullscreen: conn.fullscreen ?? false,
        width: conn.width ?? null,
        height: conn.height ?? null,
        multimon: conn.multimon ?? false,
        admin: conn.admin ?? false,
      });
      // mstsc spawns its own window — once launched we go back to disconnected
      // so the user can launch again.
      updateRDPConnection(conn.id, { status: "disconnected" });
    } catch (e) {
      updateRDPConnection(conn.id, { status: "error", errorMessage: String(e) });
    }
  };

  const startConnect = async (conn: RDPConnection) => {
    if (conn.sessionPassword) {
      handleConnect(conn, conn.sessionPassword);
      return;
    }
    try {
      const { invoke } = await getTauriCore();
      const stored = await invoke<string | null>("keychain_get_password", { connectionId: conn.id });
      if (stored) {
        handleConnect(conn, stored);
        return;
      }
    } catch {}
    // No stored password — let mstsc prompt the user (works fine), or open
    // our own prompt so we can also save to the keychain.
    setPasswordPrompt({ connId: conn.id, password: "", saveMode: "keychain" });
  };

  const handleDelete = async (conn: RDPConnection) => {
    try {
      const { invoke } = await getTauriCore();
      await invoke("keychain_delete_password", { connectionId: conn.id });
    } catch {}
    removeRDPConnection(conn.id);
  };

  const statusColor = (status: RDPConnection["status"]) => {
    switch (status) {
      case "launching": return "var(--accent-warning)";
      case "error": return "var(--accent-error)";
      default: return "var(--text-muted)";
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span className="sidebar-section-title" style={{ margin: 0 }}>{t("rdp.connections")}</span>
        <button
          onClick={() => { resetForm(); setShowForm(!showForm); }}
          style={{ background: "none", border: "none", color: "var(--accent-primary)", cursor: "pointer", padding: 4 }}
          aria-label={t("rdp.addConnection")}
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Connection Form */}
      {showForm && (
        <div style={{
          padding: 12,
          background: "var(--bg-tertiary)",
          borderRadius: "var(--radius-md)",
          marginBottom: 12,
          border: "1px solid var(--border-subtle)",
        }}>
          <div style={{ marginBottom: 8 }}>
            <label style={labelStyle}>{t("rdp.connectionName")}</label>
            <input
              placeholder={t("rdp.myDesktop")}
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>{t("rdp.hostIp")}</label>
              <input
                placeholder="192.168.1.50"
                value={formHost}
                onChange={(e) => setFormHost(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div style={{ width: 80 }}>
              <label style={labelStyle}>{t("rdp.port")}</label>
              <input
                type="number"
                value={formPort}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "") { setFormPort(0); return; }
                  const num = parseInt(val, 10);
                  if (!isNaN(num) && num >= 0 && num <= 65535) setFormPort(num);
                }}
                onBlur={() => { if (!formPort || formPort <= 0) setFormPort(3389); }}
                min={1}
                max={65535}
                style={inputStyle}
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>{t("rdp.username")}</label>
              <input
                placeholder="Administrator"
                value={formUser}
                onChange={(e) => setFormUser(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>{t("rdp.domain")}</label>
              <input
                placeholder={t("rdp.domainPlaceholder")}
                value={formDomain}
                onChange={(e) => setFormDomain(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>

          <div style={{ marginBottom: 8 }}>
            <label style={labelStyle}>{t("rdp.password")}</label>
            <input
              type="password"
              placeholder={t("rdp.passwordPlaceholder")}
              value={formPassword}
              onChange={(e) => setFormPassword(e.target.value)}
              style={inputStyle}
            />
            {formPassword && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-secondary)", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="rdpSavePassword"
                    checked={formSavePassword === "keychain"}
                    onChange={() => setFormSavePassword("keychain")}
                    style={{ accentColor: "var(--accent-primary)" }}
                  />
                  <ShieldCheck size={11} />
                  {t("rdp.saveKeychain")}
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-secondary)", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="rdpSavePassword"
                    checked={formSavePassword === "none"}
                    onChange={() => setFormSavePassword("none")}
                    style={{ accentColor: "var(--accent-primary)" }}
                  />
                  {t("rdp.dontSave")}
                </label>
              </div>
            )}
          </div>

          <div style={{ marginBottom: 8 }}>
            <label style={labelStyle}>{t("rdp.display")}</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
              <button
                onClick={() => setFormFullscreen(true)}
                style={{
                  ...btnStyle,
                  padding: "4px 10px",
                  fontSize: 11,
                  background: formFullscreen ? "var(--accent-primary)" : "var(--bg-active)",
                  color: formFullscreen ? "white" : "var(--text-secondary)",
                }}
              >
                {t("rdp.fullscreen")}
              </button>
              {RES_PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => { setFormFullscreen(false); setFormWidth(p.w); setFormHeight(p.h); }}
                  style={{
                    ...btnStyle,
                    padding: "4px 10px",
                    fontSize: 11,
                    background: !formFullscreen && formWidth === p.w && formHeight === p.h
                      ? "var(--accent-primary)"
                      : "var(--bg-active)",
                    color: !formFullscreen && formWidth === p.w && formHeight === p.h
                      ? "white"
                      : "var(--text-secondary)",
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, marginBottom: 8, fontSize: 11, color: "var(--text-secondary)" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={formMultimon}
                onChange={(e) => setFormMultimon(e.target.checked)}
                style={{ accentColor: "var(--accent-primary)" }}
              />
              {t("rdp.useMultimon")}
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={formAdmin}
                onChange={(e) => setFormAdmin(e.target.checked)}
                style={{ accentColor: "var(--accent-primary)" }}
              />
              {t("rdp.adminSession")}
            </label>
          </div>

          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button
              onClick={handleSave}
              disabled={!formName || !formHost || !formUser}
              style={{
                ...btnStyle,
                flex: 1,
                justifyContent: "center",
                background: "var(--accent-primary)",
                color: "white",
                opacity: !formName || !formHost || !formUser ? 0.5 : 1,
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

      {/* Password Prompt Dialog */}
      {passwordPrompt && (
        <div style={{
          padding: 12,
          background: "var(--bg-tertiary)",
          borderRadius: "var(--radius-md)",
          marginBottom: 12,
          border: "1px solid var(--accent-primary)",
        }}>
          <label style={labelStyle}>
            {t("rdp.enterPassword")} {rdpConnections.find((c) => c.id === passwordPrompt.connId)?.name}
          </label>
          <input
            type="password"
            placeholder={t("rdp.passwordPlaceholder")}
            value={passwordPrompt.password}
            onChange={(e) => setPasswordPrompt({ ...passwordPrompt, password: e.target.value })}
            onKeyDown={async (e) => {
              if (e.key === "Enter") {
                const conn = rdpConnections.find((c) => c.id === passwordPrompt.connId);
                if (conn) {
                  if (passwordPrompt.saveMode === "keychain") {
                    try {
                      const { invoke } = await getTauriCore();
                      await invoke("keychain_save_password", { connectionId: conn.id, password: passwordPrompt.password });
                      setKeychainIds((prev) => new Set(prev).add(conn.id));
                    } catch {}
                  }
                  handleConnect(conn, passwordPrompt.password);
                }
                setPasswordPrompt(null);
              }
            }}
            style={{ ...inputStyle, marginBottom: 8 }}
            autoFocus
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-secondary)", cursor: "pointer" }}>
              <input
                type="radio"
                name="rdpPromptSaveMode"
                checked={passwordPrompt.saveMode === "keychain"}
                onChange={() => setPasswordPrompt({ ...passwordPrompt, saveMode: "keychain" })}
                style={{ accentColor: "var(--accent-primary)" }}
              />
              <ShieldCheck size={11} />
              {t("rdp.saveKeychain")}
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-secondary)", cursor: "pointer" }}>
              <input
                type="radio"
                name="rdpPromptSaveMode"
                checked={passwordPrompt.saveMode === "none"}
                onChange={() => setPasswordPrompt({ ...passwordPrompt, saveMode: "none" })}
                style={{ accentColor: "var(--accent-primary)" }}
              />
              <Shield size={11} />
              {t("rdp.dontSave")}
            </label>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={async () => {
                const conn = rdpConnections.find((c) => c.id === passwordPrompt.connId);
                if (conn) {
                  if (passwordPrompt.saveMode === "keychain") {
                    try {
                      const { invoke } = await getTauriCore();
                      await invoke("keychain_save_password", { connectionId: conn.id, password: passwordPrompt.password });
                      setKeychainIds((prev) => new Set(prev).add(conn.id));
                    } catch {}
                  }
                  handleConnect(conn, passwordPrompt.password);
                }
                setPasswordPrompt(null);
              }}
              style={{ ...btnStyle, flex: 1, justifyContent: "center", background: "var(--accent-primary)", color: "white" }}
            >
              <Play size={12} /> {t("common.connect")}
            </button>
            <button
              onClick={() => setPasswordPrompt(null)}
              style={{ ...btnStyle, background: "var(--bg-active)", color: "var(--text-secondary)" }}
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      {/* Connection List */}
      {rdpConnections.length === 0 && !showForm ? (
        <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 24, fontSize: 12 }}>
          <Monitor size={24} style={{ margin: "0 auto 8px", opacity: 0.5 }} />
          <div>{t("rdp.noConnectionsYet")}</div>
          <div style={{ marginTop: 4 }}>{t("rdp.clickToAdd")}</div>
        </div>
      ) : (
        rdpConnections.map((conn) => (
          <div key={conn.id} className="ssh-connection-card">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                className="ssh-status-dot"
                style={{ background: statusColor(conn.status) }}
                title={conn.status}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
                  {conn.name}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4 }}>
                  <span>
                    {conn.domain ? `${conn.domain}\\` : ""}{conn.username}@{conn.host}:{conn.port}
                  </span>
                  {keychainIds.has(conn.id) && (
                    <span title={t("rdp.keychainSavedTitle")} style={{ display: "inline-flex", flexShrink: 0 }}>
                      <ShieldCheck size={10} style={{ color: "var(--accent-secondary)" }} />
                    </span>
                  )}
                </div>
              </div>
            </div>

            {conn.status === "error" && conn.errorMessage && (
              <div style={{ fontSize: 10, color: "var(--accent-error)", marginTop: 6, padding: "4px 6px", background: "rgba(248,81,73,0.1)", borderRadius: "var(--radius-sm)" }}>
                {conn.errorMessage}
              </div>
            )}

            <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
              <button
                onClick={() => startConnect(conn)}
                disabled={conn.status === "launching"}
                style={{
                  ...btnStyle,
                  flex: 1,
                  justifyContent: "center",
                  background: "var(--accent-secondary)",
                  color: "white",
                  opacity: conn.status === "launching" ? 0.6 : 1,
                }}
              >
                {conn.status === "launching"
                  ? <Loader2 size={12} className="animate-pulse" />
                  : <Play size={12} />}
                {t("common.connect")}
              </button>
              <button
                onClick={() => handleEdit(conn)}
                style={{ ...btnStyle, background: "var(--bg-active)", color: "var(--text-secondary)" }}
                title={t("common.edit")}
              >
                <Pencil size={12} />
              </button>
              <button
                onClick={() => handleDelete(conn)}
                style={{ ...btnStyle, background: "var(--bg-active)", color: "var(--accent-error)" }}
                title={t("common.delete")}
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
