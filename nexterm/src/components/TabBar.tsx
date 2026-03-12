import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Plus, X } from "lucide-react";
import { useAppStore } from "../store/appStore";

const shellIcons: Record<string, string> = {
  powershell: "PS",
  cmd: ">_",
  bash: "$",
  zsh: "%",
};

const shells = [
  { id: "powershell", name: "PowerShell", icon: "PS" },
  { id: "cmd", name: "CMD", icon: ">_" },
  { id: "bash", name: "Git Bash", icon: "$" },
  { id: "wsl", name: "WSL", icon: "~" },
];

export function TabBar() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const addTab = useAppStore((s) => s.addTab);
  const closeTab = useAppStore((s) => s.closeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const [showShellMenu, setShowShellMenu] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!showShellMenu) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current && btnRef.current.contains(target)) return;
      if (dropdownRef.current && dropdownRef.current.contains(target)) return;
      setShowShellMenu(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showShellMenu]);

  const toggleMenu = useCallback(() => {
    if (!showShellMenu && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 4, left: rect.left });
    }
    setShowShellMenu((v) => !v);
  }, [showShellMenu]);

  return (
    <div className="tab-bar">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`tab ${tab.id === activeTabId ? "active" : ""}`}
          onClick={() => setActiveTab(tab.id)}
        >
          <span className="tab-icon" style={{ fontSize: 10, fontWeight: 700 }}>
            {shellIcons[tab.shellType] || ">_"}
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
        ref={btnRef}
        className="tab-add"
        onClick={toggleMenu}
        title="New Tab"
      >
        <Plus size={14} />
      </button>
      {showShellMenu && createPortal(
        <div
          ref={dropdownRef}
          className="shell-dropdown animate-slide-up"
          style={{
            position: "fixed",
            top: menuPos.top,
            left: menuPos.left,
            zIndex: 10000,
          }}
        >
          {shells.map((shell) => (
            <button
              key={shell.id}
              className="shell-option"
              onClick={() => {
                addTab(shell.id);
                setShowShellMenu(false);
              }}
            >
              <span style={{ fontWeight: 700, width: 24 }}>{shell.icon}</span>
              {shell.name}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
