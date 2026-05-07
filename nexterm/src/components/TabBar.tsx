import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Plus, X, Users, Share2, Monitor, FolderSync, Activity, Terminal,
  Edit3, Bug, Sparkles, FileText, Shield, Gauge, LayoutGrid, HardDrive, Code2,
} from "lucide-react";
import { useAppStore } from "../store/appStore";
import type { PanelTabType, SSHConnection } from "../store/appStore";
import { useT } from "../i18n";

const shellIcons: Record<string, string> = {
  powershell: "PS",
  cmd: ">_",
  bash: "$",
  zsh: "%",
  fish: "><>",
  wsl: "~",
};

const panelIconMap: Record<PanelTabType, React.ReactNode> = {
  ssh: <Monitor size={14} />,
  sftp: <FolderSync size={14} />,
  rdp: <LayoutGrid size={14} />,
  servermap: <Activity size={14} />,
  collab: <Users size={14} />,
  editor: <Edit3 size={14} />,
  debug: <Bug size={14} />,
  ai: <Sparkles size={14} />,
  docs: <FileText size={14} />,
  hacking: <Shield size={14} />,
  infra: <Gauge size={14} />,
  backups: <HardDrive size={14} />,
  code: <Code2 size={14} />,
};

const panelTabIconMap: Record<PanelTabType, React.ReactNode> = {
  ssh: <Monitor size={10} />,
  sftp: <FolderSync size={10} />,
  rdp: <LayoutGrid size={10} />,
  servermap: <Activity size={10} />,
  collab: <Users size={10} />,
  editor: <Edit3 size={10} />,
  debug: <Bug size={10} />,
  ai: <Sparkles size={10} />,
  docs: <FileText size={10} />,
  hacking: <Shield size={10} />,
  infra: <Gauge size={10} />,
  backups: <HardDrive size={10} />,
  code: <Code2 size={10} />,
};

interface MenuGroup {
  label: string;
  items: { type: PanelTabType; label: string; desc: string }[];
}

const menuGroups: MenuGroup[] = [
  {
    label: "Connections",
    items: [
      { type: "ssh", label: "SSH", desc: "Remote terminal sessions" },
      { type: "sftp", label: "SFTP", desc: "File transfer" },
      { type: "rdp", label: "RDP", desc: "Remote Desktop launcher" },
      { type: "servermap", label: "Server Map", desc: "Network discovery" },
      { type: "collab", label: "Collaboration", desc: "Share sessions" },
    ],
  },
  {
    label: "Tools",
    items: [
      { type: "code", label: "Code Agents", desc: "Launch Claude/Gemini/Aider on local or SSH" },
      { type: "editor", label: "Editor", desc: "Code editor" },
      { type: "debug", label: "Debug", desc: "Logs & analysis" },
      { type: "ai", label: "AI Assistant", desc: "Local AI chat" },
      { type: "docs", label: "Session Docs", desc: "Documentation" },
      { type: "backups", label: "Backup Manager", desc: "Server backups" },
    ],
  },
  {
    label: "Advanced",
    items: [
      { type: "hacking", label: "Hacking", desc: "Pentest tools" },
      { type: "infra", label: "Infra Monitor", desc: "Server dashboards" },
    ],
  },
];

interface ShellInfo {
  name: string;
  path: string;
  available: boolean;
}

export function TabBar() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const addTab = useAppStore((s) => s.addTab);
  const openPanelTab = useAppStore((s) => s.openPanelTab);
  const closeTab = useAppStore((s) => s.closeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const collabSessions = useAppStore((s) => s.collabSessions);
  const sshConnections = useAppStore((s) => s.sshConnections);
  const addSSHTab = useAppStore((s) => s.addSSHTab);
  const requestSSHConnect = useAppStore((s) => s.requestSSHConnect);
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const [availableShells, setAvailableShells] = useState<ShellInfo[]>([]);
  const toolsBtnRef = useRef<HTMLButtonElement>(null);
  const t = useT();

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch available shells from backend (platform-aware)
  useEffect(() => {
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke<ShellInfo[]>("get_available_shells").then(setAvailableShells).catch(() => {
        // Fallback for demo mode
        setAvailableShells([
          { name: "PowerShell", path: "powershell.exe", available: true },
          { name: "CMD", path: "cmd.exe", available: true },
        ]);
      });
    }).catch(() => {});
  }, []);

  // Close menu on outside click
  useEffect(() => {
    if (!showToolsMenu) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (toolsBtnRef.current && toolsBtnRef.current.contains(target)) return;
      if (dropdownRef.current && dropdownRef.current.contains(target)) return;
      setShowToolsMenu(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showToolsMenu]);

  const toggleToolsMenu = useCallback(() => {
    if (!showToolsMenu && toolsBtnRef.current) {
      const rect = toolsBtnRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 4, left: rect.left });
    }
    setShowToolsMenu((v) => !v);
  }, [showToolsMenu]);

  return (
    <div className="tab-bar">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`tab ${tab.id === activeTabId ? "active" : ""}`}
          onClick={() => setActiveTab(tab.id)}
        >
          <span className="tab-icon" style={{ fontSize: 10, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 3 }}>
            {(() => {
              // Panel tab → use panel icon
              if (tab.type && tab.type !== "terminal") {
                return panelTabIconMap[tab.type] || <Edit3 size={10} />;
              }
              // Terminal tab → use shell icon
              const s = tab.shellType.toLowerCase();
              if (s === "collab-guest") return <Users size={10} style={{ color: "#3fb950" }} />;
              if (tab.sshConnectionId) return <Monitor size={10} style={{ color: "#58a6ff" }} />;
              if (s.includes("powershell")) return "PS";
              if (s.includes("cmd")) return ">_";
              if (s.includes("zsh")) return "%";
              if (s.includes("fish")) return "><>";
              if (s.includes("wsl")) return "~";
              if (s.includes("bash")) return "$";
              return ">_";
            })()}
            {/* Show sharing indicator if this tab is being hosted */}
            {tab.sessionId && collabSessions[tab.sessionId]?.role === "host" &&
              collabSessions[tab.sessionId]?.status === "active" && (
              <Share2 size={8} style={{ color: "#58a6ff" }} />
            )}
          </span>
          <span>{tab.title}</span>
          {tabs.length > 1 && (
            <span
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
            >
              <X size={10} />
            </span>
          )}
        </button>
      ))}
      <button
        className="tab-add"
        onClick={() => addTab()}
        title={t("tabbar.newTab")}
      >
        <Plus size={14} />
      </button>
      <button
        ref={toolsBtnRef}
        className="tab-add"
        onClick={toggleToolsMenu}
        title="Tools & Shells"
        style={showToolsMenu ? { color: "var(--accent-primary)" } : undefined}
      >
        <LayoutGrid size={14} />
      </button>
      {showToolsMenu && createPortal(
        <div
          ref={dropdownRef}
          className="new-tab-menu animate-slide-up"
          style={{
            position: "fixed",
            top: menuPos.top,
            left: menuPos.left,
            zIndex: 10000,
          }}
        >
          {/* Terminals group */}
          <div className="new-tab-menu-group">
            <div className="new-tab-menu-group-header">
              <Terminal size={12} />
              <span>Terminals</span>
            </div>
            <div className="new-tab-menu-items">
              {availableShells.map((shell) => {
                const key = shell.name.toLowerCase().replace(/\s+/g, "").replace("gitbash", "bash");
                return (
                  <button
                    key={shell.path}
                    className="new-tab-menu-item"
                    onClick={() => { addTab(shell.path); setShowToolsMenu(false); }}
                  >
                    <span className="new-tab-menu-item-icon">{shellIcons[key] || ">_"}</span>
                    <div className="new-tab-menu-item-text">
                      <span className="new-tab-menu-item-label">{shell.name}</span>
                      <span className="new-tab-menu-item-desc">Shell session</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* SSH Servers — connected servers get "New Terminal" buttons */}
          {sshConnections.length > 0 && (
            <div className="new-tab-menu-group">
              <div className="new-tab-menu-group-header">
                <Monitor size={12} />
                <span>SSH Servers</span>
              </div>
              <div className="new-tab-menu-items">
                {sshConnections.map((conn: SSHConnection) => (
                  <button
                    key={conn.id}
                    className="new-tab-menu-item"
                    onClick={() => {
                      // If already connected, spawn a new terminal tab on it.
                      // If not, route to SSH panel which prompts for password
                      // (avoids the dead-end "no credentials" error for old
                      // saved connections without a stored password/key).
                      if (conn.status === "connected") {
                        addSSHTab(conn.id);
                      } else {
                        requestSSHConnect(conn.id);
                      }
                      setShowToolsMenu(false);
                    }}
                    style={{ opacity: conn.status === "connected" ? 1 : 0.5 }}
                  >
                    <span className="new-tab-menu-item-icon">
                      <span style={{
                        width: 7, height: 7, borderRadius: "50%", display: "inline-block",
                        background: conn.status === "connected" ? "#3fb950" : conn.status === "connecting" ? "#d29922" : "#484f58",
                        boxShadow: conn.status === "connected" ? "0 0 4px #3fb950" : "none",
                      }} />
                    </span>
                    <div className="new-tab-menu-item-text">
                      <span className="new-tab-menu-item-label">{conn.name}</span>
                      <span className="new-tab-menu-item-desc">{conn.username}@{conn.host}:{conn.port}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Panel groups */}
          {menuGroups.map((group) => (
            <div key={group.label} className="new-tab-menu-group">
              <div className="new-tab-menu-group-header">
                <span>{group.label}</span>
              </div>
              <div className="new-tab-menu-items">
                {group.items.map((item) => (
                  <button
                    key={item.type}
                    className="new-tab-menu-item"
                    onClick={() => { openPanelTab(item.type); setShowToolsMenu(false); }}
                  >
                    <span className="new-tab-menu-item-icon">{panelIconMap[item.type]}</span>
                    <div className="new-tab-menu-item-text">
                      <span className="new-tab-menu-item-label">{item.label}</span>
                      <span className="new-tab-menu-item-desc">{item.desc}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
