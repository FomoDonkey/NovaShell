import { useState } from "react";
import { Minus, Square, X, Terminal, Maximize2, PanelRight, Focus } from "lucide-react";
import { useAppStore } from "../store/appStore";
import type { ThemeName } from "../store/appStore";

export function TitleBar() {
  const { theme, setTheme, toggleSidebar, toggleFocusMode } = useAppStore();

  const themes: { name: ThemeName; label: string }[] = [
    { name: "dark", label: "Dark" },
    { name: "light", label: "Light" },
    { name: "cyberpunk", label: "Cyber" },
    { name: "retro", label: "Retro" },
  ];

  const handleMinimize = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    getCurrentWindow().minimize();
  };

  const handleMaximize = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    if (await win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  };

  const handleClose = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    getCurrentWindow().close();
  };

  return (
    <div className="titlebar">
      <div className="titlebar-left">
        <div className="titlebar-logo">
          <Terminal size={18} />
          <span>NovaTerm</span>
        </div>
        <div className="theme-selector">
          {themes.map((t) => (
            <button
              key={t.name}
              className={`theme-dot ${t.name} ${theme === t.name ? "active" : ""}`}
              onClick={() => setTheme(t.name)}
              title={t.label}
            />
          ))}
        </div>
      </div>
      <div className="titlebar-center">Professional Terminal</div>
      <div className="titlebar-right">
        <button className="titlebar-btn" onClick={toggleFocusMode} title="Focus Mode">
          <Focus size={14} />
        </button>
        <button className="titlebar-btn" onClick={toggleSidebar} title="Toggle Sidebar">
          <PanelRight size={14} />
        </button>
        <button className="titlebar-btn" onClick={handleMinimize}>
          <Minus size={14} />
        </button>
        <button className="titlebar-btn" onClick={handleMaximize}>
          <Maximize2 size={14} />
        </button>
        <button className="titlebar-btn close" onClick={handleClose}>
          <X size={14} />
        </button>
      </div>
    </div>
  );
}