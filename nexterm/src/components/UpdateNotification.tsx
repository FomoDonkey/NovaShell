import { useState, useEffect, useCallback, useRef, memo } from "react";
import { Download, X, RefreshCw, CheckCircle, AlertCircle, Loader } from "lucide-react";
import { useT } from "../i18n";

type VersionNote = { version: string; title: string; highlights: string[] };

type UpdateStatus =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "available"; version: string; body: string; allNotes: VersionNote[] }
  | { phase: "downloading"; progress: number }
  | { phase: "ready" }
  | { phase: "error"; message: string }
  | { phase: "up-to-date" };

let checkCache: typeof import("@tauri-apps/plugin-updater") | null = null;
async function getUpdater() {
  if (!checkCache) checkCache = await import("@tauri-apps/plugin-updater");
  return checkCache;
}

let processCache: typeof import("@tauri-apps/plugin-process") | null = null;
async function getProcess() {
  if (!processCache) processCache = await import("@tauri-apps/plugin-process");
  return processCache;
}

// Compare semver strings: returns -1, 0, or 1
function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
  }
  return 0;
}

// Extract user-friendly highlights from a GitHub release body
function extractHighlights(body: string): string[] {
  if (!body || typeof body !== "string") return [];
  const highlights: string[] = [];

  // Remove downloads/footer sections and tables
  const cleaned = body
    .replace(/## Downloads[\s\S]*$/i, "")
    .replace(/### Downloads[\s\S]*$/i, "")
    .replace(/---[\s\S]*$/i, "")
    .replace(/\|[^|]+\|[^|]+\|[^|]+\|[^\n]*\n/g, "") // Remove table rows
    .replace(/\|[-\s:]+\|[-\s:]+\|[^\n]*\n/g, "") // Remove table separators
    .trim();

  for (const line of cleaned.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("```") || trimmed.startsWith("|")) continue;

    // ## or ### Section headers → use as highlight
    if (/^#{2,3}\s/.test(trimmed)) {
      const title = trimmed.replace(/^#+\s*/, "").trim();
      if (title && title.length > 3 && !title.toLowerCase().includes("download") && !title.toLowerCase().includes("summary")) {
        highlights.push(title);
      }
    }
    // - **Bold item** → extract the bold part as a highlight
    else if (trimmed.startsWith("- **") || trimmed.startsWith("* **")) {
      const match = trimmed.match(/\*\*(.+?)\*\*/);
      if (match) {
        const afterBold = trimmed.slice(trimmed.indexOf("**", trimmed.indexOf("**") + 2) + 2).replace(/^\s*[—\-:]\s*/, "").trim();
        const text = afterBold && afterBold.length > 3 ? `${match[1]} — ${afterBold.slice(0, 80)}` : match[1];
        highlights.push(text);
      }
    }
    // - Regular bullet → use if short enough and meaningful
    else if (/^[-*]\s/.test(trimmed)) {
      const text = trimmed.slice(2).trim();
      if (text.length > 5 && text.length < 120 && !text.startsWith("`")) {
        highlights.push(text);
      }
    }
  }

  // Cap at 6 highlights per version to show enough context
  return highlights.slice(0, 6);
}

// Cache for GitHub release notes — avoids repeated API calls / rate limits
let releaseNotesCache: { key: string; notes: VersionNote[] } | null = null;

// Fetch all intermediate release notes from GitHub API (with retry)
async function fetchAllReleaseNotes(currentVersion: string, targetVersion: string): Promise<VersionNote[]> {
  const cacheKey = `${currentVersion}->${targetVersion}`;
  if (releaseNotesCache && releaseNotesCache.key === cacheKey) return releaseNotesCache.notes;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch("https://api.github.com/repos/FomoDonkey/NovaShell/releases?per_page=30");
      if (!res.ok) { if (attempt === 0) { await new Promise((r) => setTimeout(r, 1500)); continue; } return []; }
      const releases: Array<{ tag_name: string; name: string; body: string }> = await res.json();

      const notes: VersionNote[] = [];
      for (const rel of releases) {
        const ver = rel.tag_name.replace(/^v/, "");
        // Include versions that are > currentVersion AND <= targetVersion
        if (compareSemver(ver, currentVersion) > 0 && compareSemver(ver, targetVersion) <= 0) {
          const highlights = extractHighlights(rel.body || "");
          const title = (rel.name || rel.tag_name).replace(/^v?\d+\.\d+\.\d+\s*[—\-:]\s*/, "").trim() || rel.tag_name;
          if (highlights.length > 0 || title) {
            notes.push({ version: ver, title, highlights });
          }
        }
      }

      notes.sort((a, b) => compareSemver(b.version, a.version));
      releaseNotesCache = { key: cacheKey, notes };
      return notes;
    } catch {
      if (attempt === 0) { await new Promise((r) => setTimeout(r, 1500)); continue; }
      return [];
    }
  }
  return [];
}

// Build fallback notes from the updater body when GitHub API fails
function buildFallbackNotes(version: string, body: string): VersionNote[] {
  if (!body || !body.trim()) return [];

  // Skip known generic/redirect messages
  const lower = body.toLowerCase();
  if (lower.includes("see release notes for details") || lower.includes("see changelog") ||
      lower.includes("check github") || lower.includes("visit github")) {
    // Generic redirect — don't try to parse, return empty so the inline fallback shows
    return [];
  }

  const highlights = extractHighlights(body);
  if (highlights.length === 0) {
    const lines = body.split("\n").map((l) => l.trim()).filter((l) =>
      l.length > 10 && l.length < 120 && !l.startsWith("#") && !l.startsWith("|") &&
      !l.toLowerCase().includes("download") && !l.toLowerCase().includes("installer")
    );
    if (lines.length > 0) {
      return [{ version, title: `v${version}`, highlights: lines.slice(0, 5) }];
    }
  }
  const title = body.split("\n").find((l) => l.startsWith("## "))?.replace(/^##\s*/, "").trim() || `v${version}`;
  return highlights.length > 0 ? [{ version, title, highlights }] : [];
}

export const UpdateNotification = memo(function UpdateNotification() {
  const [status, setStatus] = useState<UpdateStatus>({ phase: "idle" });
  const [dismissed, setDismissed] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateInstalledRef = useRef(false);
  const pendingUpdateRef = useRef<any>(null);
  const t = useT();

  const checkForUpdates = useCallback(async (silent = true) => {
    if (updateInstalledRef.current) return;

    try {
      setStatus({ phase: "checking" });
      const { check } = await getUpdater();
      const update = await check();

      if (update) {
        // Fetch all intermediate release notes — with fallback to updater body
        const currentVer = typeof APP_VERSION === "string" ? APP_VERSION : "0.0.0";
        let allNotes = await fetchAllReleaseNotes(currentVer, update.version);

        // If GitHub API failed, build notes from the updater body
        if (allNotes.length === 0 && update.body) {
          allNotes = buildFallbackNotes(update.version, update.body);
        }

        setStatus({
          phase: "available",
          version: update.version,
          body: update.body || "",
          allNotes,
        });
        setDismissed(false);
        setMinimized(false);
      } else {
        setStatus({ phase: "up-to-date" });
        if (silent) {
          dismissTimerRef.current = setTimeout(() => setStatus({ phase: "idle" }), 3000);
        }
      }
    } catch (e) {
      if (!silent) {
        setStatus({ phase: "error", message: String(e) });
      } else {
        setStatus({ phase: "idle" });
      }
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    try {
      setStatus({ phase: "downloading", progress: 0 });
      const { check } = await getUpdater();
      const update = await check();

      if (!update) {
        setStatus({ phase: "up-to-date" });
        return;
      }

      let lastProgress = 0;
      let totalSize = 0;

      // Download only — do NOT install yet (on Windows/NSIS the installer
      // cannot replace the running exe; we install + exit atomically later)
      await update.download((event) => {
        if (event.event === "Started") {
          lastProgress = 0;
          totalSize = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          lastProgress += event.data.chunkLength;
          if (totalSize > 0) {
            setStatus({ phase: "downloading", progress: Math.min(99, Math.round((lastProgress / totalSize) * 100)) });
          }
        } else if (event.event === "Finished") {
          setStatus({ phase: "ready" });
        }
      });

      pendingUpdateRef.current = update;
      updateInstalledRef.current = true;
      setStatus({ phase: "ready" });
    } catch (e) {
      setStatus({ phase: "error", message: String(e) });
    }
  }, []);

  const relaunchApp = useCallback(async () => {
    try {
      console.log("[Updater] Restart Now clicked, pending update:", !!pendingUpdateRef.current);

      // Install the previously downloaded update, then exit so the
      // NSIS installer can replace files and restart the app.
      if (pendingUpdateRef.current) {
        console.log("[Updater] Calling update.install() — spawning NSIS installer...");
        await pendingUpdateRef.current.install();
        console.log("[Updater] install() returned. Waiting 1500ms grace period so the NSIS subprocess is fully spawned and attached before we release the .exe lock.");
        // Critical: without this delay, exit(0) below sometimes runs before
        // the NSIS subprocess is actually spawned & detached. Symptoms:
        // "update succeeds" toast, app closes, but reopening shows old
        // version because NSIS never actually replaced the .exe.
        await new Promise((r) => setTimeout(r, 1500));
      }

      console.log("[Updater] Calling exit(0) — releasing .exe lock so NSIS can replace files.");
      const { exit } = await getProcess();
      await exit(0);
    } catch (e) {
      console.error("[Updater] install + exit failed:", e);
      setStatus({ phase: "error", message: `Install failed: ${String(e)}. Try downloading the installer manually from GitHub.` });
      // Fallback: try relaunch if install+exit failed (last resort —
      // relaunch starts the OLD binary but at least the app comes back up).
      try {
        const { relaunch } = await getProcess();
        await relaunch();
      } catch (e2) {
        setStatus({ phase: "error", message: `Both install and relaunch failed: ${String(e2)}. Download the installer from github.com/FomoDonkey/NovaShell/releases` });
      }
    }
  }, []);

  // Auto-check on startup (30s delay to not block boot)
  useEffect(() => {
    const timer = setTimeout(() => checkForUpdates(true), 5000);
    const interval = setInterval(() => checkForUpdates(true), 4 * 60 * 60 * 1000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, [checkForUpdates]);

  // Don't render anything if idle or dismissed
  if (status.phase === "idle") return null;
  if (dismissed && status.phase !== "downloading" && status.phase !== "ready") return null;

  // Minimized badge
  if (minimized && status.phase === "available") {
    return (
      <button
        onClick={() => setMinimized(false)}
        style={{
          position: "fixed", bottom: 32, right: 16, width: 36, height: 36,
          borderRadius: "50%", background: "var(--accent-primary)",
          border: "2px solid var(--bg-primary)", color: "white", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 4px 12px rgba(0,0,0,0.4)", zIndex: 9999,
          animation: "pulse-glow 2s ease-in-out infinite",
        }}
        title="Update available"
      >
        <Download size={16} />
      </button>
    );
  }

  return (
    <div style={{
      position: "fixed", bottom: 32, right: 16, width: 380,
      background: "var(--bg-secondary)", border: "1px solid var(--border-subtle)",
      borderRadius: "var(--radius-md)", boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      zIndex: 9999, overflow: "hidden", fontFamily: "inherit",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "10px 12px",
        background: status.phase === "error" ? "rgba(255,123,114,0.1)" : status.phase === "ready" ? "rgba(63,185,80,0.1)" : "rgba(88,166,255,0.1)",
        borderBottom: "1px solid var(--border-subtle)",
      }}>
        {status.phase === "checking" && <Loader size={14} style={{ color: "var(--accent-primary)", animation: "spin 1s linear infinite" }} />}
        {status.phase === "available" && <Download size={14} style={{ color: "var(--accent-primary)" }} />}
        {status.phase === "downloading" && <Loader size={14} style={{ color: "var(--accent-primary)", animation: "spin 1s linear infinite" }} />}
        {status.phase === "ready" && <CheckCircle size={14} style={{ color: "var(--accent-secondary)" }} />}
        {status.phase === "error" && <AlertCircle size={14} style={{ color: "var(--accent-error)" }} />}
        {status.phase === "up-to-date" && <CheckCircle size={14} style={{ color: "var(--accent-secondary)" }} />}

        <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
          {status.phase === "checking" && t("update.checkingUpdates")}
          {status.phase === "available" && `Update v${status.version}`}
          {status.phase === "downloading" && t("update.downloadingUpdate")}
          {status.phase === "ready" && t("update.updateReady")}
          {status.phase === "error" && t("update.updateError")}
          {status.phase === "up-to-date" && t("update.upToDate")}
        </span>

        {status.phase !== "downloading" && status.phase !== "ready" && (
          <button
            onClick={() => { if (status.phase === "available") setMinimized(true); else setDismissed(true); }}
            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 2, display: "flex" }}
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: "10px 12px" }}>
        {status.phase === "checking" && (
          <p style={{ fontSize: 11, color: "var(--text-secondary)", margin: 0 }}>{t("update.connectingServer")}</p>
        )}

        {status.phase === "up-to-date" && (
          <p style={{ fontSize: 11, color: "var(--text-secondary)", margin: 0 }}>{t("update.latestVersion")}</p>
        )}

        {status.phase === "available" && (
          <>
            {/* Release notes — show all intermediate versions */}
            {(status.allNotes.length > 0 || (status.body && status.body.trim())) && (
              <>
                <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  {t("update.whatsNew")}
                </div>
                <div style={{
                  margin: "0 0 10px 0", maxHeight: 220, overflowY: "auto",
                  padding: "8px 10px", background: "var(--bg-primary)",
                  borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)",
                }}>
                  {status.allNotes.map((note, idx) => (
                    <div key={note.version} style={{ marginBottom: idx < status.allNotes.length - 1 ? 10 : 0 }}>
                      {/* Version header */}
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: "var(--accent-primary)", background: "rgba(88,166,255,0.1)", padding: "1px 6px", borderRadius: 4 }}>
                          v{note.version}
                        </span>
                        <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--text-primary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {note.title}
                        </span>
                      </div>
                      {/* Highlights */}
                      {note.highlights.map((h, i) => (
                        <div key={i} style={{ display: "flex", gap: 5, marginBottom: 1, paddingLeft: 4 }}>
                          <span style={{ color: "var(--accent-primary)", flexShrink: 0, fontSize: 9, lineHeight: "15px" }}>&#8226;</span>
                          <span style={{ fontSize: 10, color: "var(--text-secondary)", lineHeight: "15px" }}>{h}</span>
                        </div>
                      ))}
                      {/* Separator between versions */}
                      {idx < status.allNotes.length - 1 && (
                        <div style={{ borderBottom: "1px solid var(--border-subtle)", marginTop: 6 }} />
                      )}
                    </div>
                  ))}
                  {/* Fallback: if no structured notes available */}
                  {status.allNotes.length === 0 && (
                    <div style={{ fontSize: 10.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                      <div style={{ display: "flex", gap: 5, marginBottom: 2 }}>
                        <span style={{ color: "var(--accent-secondary)", flexShrink: 0 }}>&#10003;</span>
                        <span>Bug fixes and improvements</span>
                      </div>
                      <div style={{ display: "flex", gap: 5, marginBottom: 2 }}>
                        <span style={{ color: "var(--accent-secondary)", flexShrink: 0 }}>&#10003;</span>
                        <span>Performance and stability enhancements</span>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={downloadAndInstall}
                style={{
                  flex: 1, padding: "7px 12px", background: "var(--accent-primary)",
                  border: "none", borderRadius: "var(--radius-sm)", color: "white",
                  fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                }}
              >
                <Download size={12} />
                {t("update.installUpdate")}
              </button>
              <button
                onClick={() => setDismissed(true)}
                style={{
                  padding: "7px 12px", background: "var(--bg-tertiary)",
                  border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)",
                  color: "var(--text-secondary)", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
                }}
              >
                {t("update.later")}
              </button>
            </div>
          </>
        )}

        {status.phase === "downloading" && (
          <>
            <div style={{ width: "100%", height: 6, background: "var(--bg-active)", borderRadius: 3, overflow: "hidden", marginBottom: 6 }}>
              <div style={{ width: `${status.progress}%`, height: "100%", background: "var(--accent-primary)", borderRadius: 3, transition: "width 0.3s ease" }} />
            </div>
            <p style={{ fontSize: 10, color: "var(--text-muted)", margin: 0, textAlign: "center" }}>
              {status.progress > 0 ? `${status.progress}%` : t("update.startingDownload")}
            </p>
          </>
        )}

        {status.phase === "ready" && (
          <>
            <p style={{ fontSize: 11, color: "var(--text-secondary)", margin: "0 0 10px 0" }}>
              {t("update.updateInstalled")}
            </p>
            <button
              onClick={relaunchApp}
              style={{
                width: "100%", padding: "7px 12px", background: "var(--accent-secondary)",
                border: "none", borderRadius: "var(--radius-sm)", color: "white",
                fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}
            >
              <RefreshCw size={12} />
              {t("update.restartNow")}
            </button>
          </>
        )}

        {status.phase === "error" && (
          <>
            <p style={{ fontSize: 11, color: "var(--accent-error)", margin: "0 0 8px 0", maxHeight: 40, overflowY: "auto", wordBreak: "break-word" }}>
              {status.message}
            </p>
            <button
              onClick={() => checkForUpdates(false)}
              style={{
                width: "100%", padding: "6px 12px", background: "var(--bg-tertiary)",
                border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)",
                color: "var(--text-secondary)", fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}
            >
              <RefreshCw size={11} />
              {t("common.retry")}
            </button>
          </>
        )}
      </div>
    </div>
  );
});
