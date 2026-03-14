import { useState } from "react";
import {
  Shield,
  Radar,
  Zap,
  Brain,
  AlertTriangle,
  Clock,
  Power,
  Wrench,
} from "lucide-react";
import { useAppStore } from "../store/appStore";
import { ReconView } from "./hacking/ReconView";
import { ExploitView } from "./hacking/ExploitView";
import { AiSecView } from "./hacking/AiSecView";
import { AlertsView } from "./hacking/AlertsView";
import { HistoryView } from "./hacking/HistoryView";
import { ToolsView } from "./hacking/ToolsView";

type HackingSubTab = "recon" | "exploit" | "tools" | "ai" | "alerts" | "history";

const subTabs: { id: HackingSubTab; icon: typeof Radar; label: string }[] = [
  { id: "recon", icon: Radar, label: "Recon" },
  { id: "exploit", icon: Zap, label: "Exploit" },
  { id: "tools", icon: Wrench, label: "Tools" },
  { id: "ai", icon: Brain, label: "AI Sec" },
  { id: "alerts", icon: AlertTriangle, label: "Alerts" },
  { id: "history", icon: Clock, label: "History" },
];

export function HackingPanel() {
  const hackingMode = useAppStore((s) => s.hackingMode);
  const toggleHackingMode = useAppStore((s) => s.toggleHackingMode);
  const alertCount = useAppStore((s) => s.hackingAlerts.length);
  const [activeSubTab, setActiveSubTab] = useState<HackingSubTab>("recon");

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100%",
      gap: 0,
    }}>
      {/* Panel Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "12px 16px 8px",
        flexShrink: 0,
      }}>
        <Shield size={16} style={{
          color: hackingMode ? "#00ff41" : "var(--text-muted)",
          filter: hackingMode ? "drop-shadow(0 0 4px rgba(0,255,65,0.5))" : "none",
        }} />
        <span style={{
          fontSize: 14,
          fontWeight: 700,
          color: hackingMode ? "#00ff41" : "var(--text-primary)",
          flex: 1,
        }}>
          Hacking Mode
        </span>
        <button
          onClick={toggleHackingMode}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 10px",
            borderRadius: 12,
            border: "1px solid",
            borderColor: hackingMode ? "#00ff41" : "var(--border-subtle)",
            background: hackingMode ? "rgba(0,255,65,0.1)" : "var(--bg-active)",
            color: hackingMode ? "#00ff41" : "var(--text-muted)",
            cursor: "pointer",
            fontSize: 10,
            fontWeight: 700,
          }}
        >
          <Power size={10} />
          {hackingMode ? "ACTIVE" : "OFF"}
        </button>
      </div>

      {!hackingMode ? (
        /* Inactive state */
        <div style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: 20,
        }}>
          <Shield size={40} style={{ color: "var(--text-muted)", opacity: 0.3 }} />
          <span style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>
            Enable Hacking Mode to access security tools
          </span>
          <span style={{ fontSize: 10, color: "var(--text-muted)", opacity: 0.6, textAlign: "center" }}>
            Recon - Exploit scripts - AI Security - Alerts
          </span>
          <button
            onClick={toggleHackingMode}
            style={{
              padding: "8px 20px",
              borderRadius: 8,
              background: "linear-gradient(135deg, #00ff41, #00d4ff)",
              border: "none",
              color: "#000",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              marginTop: 8,
            }}
          >
            Activate
          </button>
        </div>
      ) : (
        /* Active state */
        <>
          {/* Sub-tab navigation */}
          <div style={{
            display: "flex",
            padding: "0 16px",
            gap: 2,
            borderBottom: "1px solid var(--border-subtle)",
            flexShrink: 0,
          }}>
            {subTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveSubTab(tab.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "6px 10px",
                  fontSize: 10,
                  fontWeight: activeSubTab === tab.id ? 700 : 400,
                  color: activeSubTab === tab.id ? "var(--accent-primary)" : "var(--text-muted)",
                  background: "none",
                  border: "none",
                  borderBottom: activeSubTab === tab.id ? "2px solid var(--accent-primary)" : "2px solid transparent",
                  cursor: "pointer",
                  position: "relative",
                }}
              >
                <tab.icon size={11} />
                {tab.label}
                {tab.id === "alerts" && alertCount > 0 && (
                  <span style={{
                    background: "#ff0040",
                    color: "#fff",
                    borderRadius: 8,
                    padding: "0 4px",
                    fontSize: 8,
                    fontWeight: 700,
                    marginLeft: 2,
                  }}>
                    {alertCount}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Sub-tab content */}
          <div style={{
            flex: 1,
            overflowY: "auto",
            overflowX: "hidden",
            padding: "8px 16px 12px",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }} className="hacking-log-container">
            {activeSubTab === "recon" && <ReconView />}
            {activeSubTab === "exploit" && <ExploitView />}
            {activeSubTab === "tools" && <ToolsView />}
            {activeSubTab === "ai" && <AiSecView />}
            {activeSubTab === "alerts" && <AlertsView />}
            {activeSubTab === "history" && <HistoryView />}
          </div>
        </>
      )}
    </div>
  );
}
