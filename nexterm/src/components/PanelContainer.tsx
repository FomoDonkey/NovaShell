import { lazy, Suspense } from "react";
import type { PanelTabType } from "../store/appStore";

// EditorPanel loaded directly — CodeMirror's CSS injection breaks with lazy loading
import { EditorPanel } from "./EditorPanel";
const DebugPanel = lazy(() => import("./DebugPanel").then(m => ({ default: m.DebugPanel })));
import { AIPanel } from "./AIPanel";
import { SessionDocPanel } from "./SessionDocPanel";

const SSHPanel = lazy(() => import("./SSHPanel").then(m => ({ default: m.SSHPanel })));
const SFTPPanel = lazy(() => import("./SFTPPanel").then(m => ({ default: m.SFTPPanel })));
const RDPPanel = lazy(() => import("./RDPPanel").then(m => ({ default: m.RDPPanel })));
const InfraMonitorPanel = lazy(() => import("./InfraMonitorPanel").then(m => ({ default: m.InfraMonitorPanel })));
const HackingPanel = lazy(() => import("./HackingPanel").then(m => ({ default: m.HackingPanel })));
const ServerMapPanel = lazy(() => import("./ServerMapPanel").then(m => ({ default: m.ServerMapPanel })));
const CollabPanel = lazy(() => import("./CollabPanel").then(m => ({ default: m.CollabPanel })));
const BackupPanel = lazy(() => import("./BackupPanel").then(m => ({ default: m.BackupPanel })));

const LazyFallback = () => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 120, color: "var(--text-muted)", fontSize: 12 }}>
    Loading...
  </div>
);

export function PanelContainer({ panelType }: { panelType: PanelTabType }) {
  return (
    <div className="panel-tab-content">
      {panelType === "ssh" && <Suspense fallback={<LazyFallback />}><SSHPanel /></Suspense>}
      {panelType === "sftp" && <Suspense fallback={<LazyFallback />}><SFTPPanel /></Suspense>}
      {panelType === "rdp" && <Suspense fallback={<LazyFallback />}><RDPPanel /></Suspense>}
      {panelType === "servermap" && <Suspense fallback={<LazyFallback />}><ServerMapPanel /></Suspense>}
      {panelType === "editor" && <EditorPanel />}
      {panelType === "debug" && <Suspense fallback={<LazyFallback />}><DebugPanel /></Suspense>}
      {panelType === "ai" && <AIPanel />}
      {panelType === "docs" && <SessionDocPanel />}
      {panelType === "hacking" && <Suspense fallback={<LazyFallback />}><HackingPanel /></Suspense>}
      {panelType === "infra" && <Suspense fallback={<LazyFallback />}><InfraMonitorPanel /></Suspense>}
      {panelType === "collab" && <Suspense fallback={<LazyFallback />}><CollabPanel /></Suspense>}
      {panelType === "backups" && <Suspense fallback={<LazyFallback />}><BackupPanel /></Suspense>}
    </div>
  );
}
