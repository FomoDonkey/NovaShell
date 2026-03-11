import { useEffect, useRef, useState, useCallback, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TitleBar } from "./components/TitleBar";
import { TabBar } from "./components/TabBar";
import { TerminalPanel } from "./components/TerminalPanel";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { AchievementToast } from "./components/AchievementToast";
import { UpdateNotification } from "./components/UpdateNotification";
import { useAppStore } from "./store/appStore";

const MemoizedTerminalPanel = memo(TerminalPanel);
const MemoizedTabBar = memo(TabBar);
const MemoizedStatusBar = memo(StatusBar);

const MIN_SIDEBAR_WIDTH = 260;
const MAX_SIDEBAR_WIDTH = 700;
const DEFAULT_SIDEBAR_WIDTH = 320;

function App() {
  const theme = useAppStore((s) => s.theme);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const focusMode = useAppStore((s) => s.focusMode);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const isResizing = useRef(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      // Sidebar is on the right, so dragging left = wider
      const delta = startX - ev.clientX;
      const newWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, startWidth + delta));
      setSidebarWidth(newWidth);
    };

    const onMouseUp = () => {
      isResizing.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [sidebarWidth]);

  return (
    <div className={`app-container theme-${theme} ${focusMode ? "focus-mode" : ""}`}>
      <TitleBar />
      <div className="app-body">
        <div className="main-area">
          <MemoizedTabBar />
          <MemoizedTerminalPanel />
        </div>
        <AnimatePresence>
          {sidebarOpen && (
            <motion.div
              className="sidebar-wrapper"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: sidebarWidth, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
              style={{ position: "relative" }}
            >
              {/* Resize handle */}
              <div
                className="sidebar-resize-handle"
                onMouseDown={startResize}
              />
              <Sidebar />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <MemoizedStatusBar />
      <AchievementToast />
      <UpdateNotification />
    </div>
  );
}

export default App;
