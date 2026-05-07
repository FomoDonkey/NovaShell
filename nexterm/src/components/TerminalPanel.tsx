import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { CanvasAddon } from "@xterm/addon-canvas";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import { useAppStore } from "../store/appStore";
import { SearchOverlay } from "./SearchOverlay";
import { Autocomplete } from "./Autocomplete";
import { parseTerminalOutput } from "./DebugPanel";
import { scanForSecurityEvents } from "../utils/hackingAlerts";
import type { SnippetRunMode } from "../store/appStore";
import { isServerNavCommand, parseServerNavCommand, resolveServer, getConnectionCredentials, navigateToServer, listServers } from "../utils/serverNavigation";
import { CollabOverlay } from "./CollabOverlay";
import { useT } from "../i18n";
import { themeColors } from "../utils/themeColors";

let tauriCore: { invoke: typeof import("@tauri-apps/api/core")["invoke"] } | null = null;
let tauriEvent: { listen: typeof import("@tauri-apps/api/event")["listen"] } | null = null;

async function getTauriCore() {
  if (!tauriCore) tauriCore = await import("@tauri-apps/api/core");
  return tauriCore;
}

async function getTauriEvent() {
  if (!tauriEvent) tauriEvent = await import("@tauri-apps/api/event");
  return tauriEvent;
}

// Batched async debug log parsing - never blocks terminal rendering
// Uses a per-source buffer to properly handle lines split across PTY chunks
const debugBuffers = new Map<string, string>();
let debugParseScheduled = false;
const MAX_DEBUG_SOURCES = 32;

function queueDebugParse(data: string, source: string) {
  if (!useAppStore.getState().debugEnabled) return;
  // Cap number of tracked sources to prevent unbounded Map growth
  if (!debugBuffers.has(source) && debugBuffers.size >= MAX_DEBUG_SOURCES) return;
  // Append to per-source buffer (handles line splits across chunks)
  const existing = debugBuffers.get(source) || "";
  // Limit buffer size per source to prevent memory issues (64KB)
  const combined = existing + data;
  debugBuffers.set(source, combined.length > 65536 ? combined.slice(-32768) : combined);
  if (!debugParseScheduled) {
    debugParseScheduled = true;
    setTimeout(flushDebugParse, 200);
  }
}

function flushDebugParse() {
  debugParseScheduled = false;
  if (debugBuffers.size === 0) return;
  const store = useAppStore.getState();
  // Skip entire pipeline if debug is disabled
  if (!store.debugEnabled) {
    debugBuffers.clear();
    return;
  }
  const hackingActive = store.hackingMode;
  debugBuffers.forEach((data, source) => {
    const lastNewline = data.lastIndexOf("\n");
    if (lastNewline === -1) return;
    const complete = data.slice(0, lastNewline + 1);
    const remainder = data.slice(lastNewline + 1);
    debugBuffers.set(source, remainder);
    parseTerminalOutput(complete, source, store.addDebugLog);
    // Only scan for security events when hacking mode is active
    if (hackingActive) {
      for (const line of complete.split("\n")) {
        if (line.trim()) scanForSecurityEvents(line);
      }
    }
  });
}

interface TerminalRef {
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  sessionId: string | null;
  sessionType: "pty" | "ssh";
  disposables: Array<{ dispose: () => void }>;
  unlisteners: Array<() => void>;
}

// themeColors imported from ../utils/themeColors

// Sync session info to the TerminalRef Map (for snippet execution, autocomplete, resize, cleanup)
function syncTerminalRef(
  terminalsMap: Map<string, TerminalRef>,
  tabId: string,
  sessionId: string | null,
  sessionType: "pty" | "ssh",
) {
  const ref = terminalsMap.get(tabId);
  if (ref) {
    ref.sessionId = sessionId;
    ref.sessionType = sessionType;
  }
}

// Per-tab navigation listeners that must be cleaned on each navigation hop
const navListeners = new Map<string, Array<() => void>>();

function cleanNavListeners(tabId: string) {
  const listeners = navListeners.get(tabId);
  if (listeners) {
    listeners.forEach((fn) => fn());
    listeners.length = 0;
  }
}

async function handleServerNavigation(
  tabId: string,
  terminal: Terminal,
  serverName: string,
  path: string,
  currentTermRef: { sessionId: string | null; sessionType: "pty" | "ssh"; activeDataUnlisten: (() => void) | null },
  liveSession: { id: string | null; type: "pty" | "ssh" },
  terminalsMap: Map<string, TerminalRef>,
  unlisteners: Array<() => void>,
  disposables: Array<{ dispose: () => void }>,
) {
  // Clean previous navigation-specific listeners (exit/error) before setting up new ones
  cleanNavListeners(tabId);
  if (!navListeners.has(tabId)) navListeners.set(tabId, []);
  const store = useAppStore.getState();

  // Handle "ls /servers" listing
  if (serverName === "__list__") {
    terminal.write("\r\n" + listServers() + "\r\n");
    return;
  }

  const resolved = resolveServer(serverName);

  if (!resolved) {
    terminal.write(`\r\n\x1b[33m[NovaShell]\x1b[0m Server '\x1b[1m${serverName}\x1b[0m' not found.\r\n`);
    terminal.write(`\x1b[90mTip: Use 'ls /servers' to see available servers.\x1b[0m\r\n`);
    return;
  }

  if (resolved === "local") {
    // Navigate back to local — pop the entire stack to find the original local context
    const stack = store.navigationStacks[tabId];
    if (!stack || stack.length === 0) {
      terminal.write(`\r\n\x1b[33m[NovaShell]\x1b[0m Already on local machine.\r\n`);
      return;
    }

    // Find the first local context in the stack (bottom of stack)
    const localCtx = stack.find((ctx) => ctx.type === "local");
    if (!localCtx) {
      terminal.write(`\r\n\x1b[33m[NovaShell]\x1b[0m No local context found in navigation stack.\r\n`);
      return;
    }

    terminal.write(`\r\n\x1b[36m[NovaShell]\x1b[0m Returning to local machine...\r\n`);

    try {
      const { listen } = await getTauriEvent();
      const { invoke } = await getTauriCore();

      // Clear the entire navigation stack for this tab (we're going home)
      useAppStore.setState((s) => ({
        navigationStacks: { ...s.navigationStacks, [tabId]: [] },
      }));

      // Unsubscribe from previous session's data listener
      if (currentTermRef.activeDataUnlisten) {
        currentTermRef.activeDataUnlisten();
        currentTermRef.activeDataUnlisten = null;
      }

      const localSessionId = localCtx.sessionId;
      const tabName = store.tabs.find((t) => t.id === tabId)?.title || tabId;

      const unlistenData = await listen<string>(`pty-data-${localSessionId}`, (event) => {
        terminal.write(event.payload);
        queueDebugParse(event.payload, tabName);
      });
      unlisteners.push(unlistenData);
      currentTermRef.activeDataUnlisten = unlistenData;

      currentTermRef.sessionId = localSessionId;
      currentTermRef.sessionType = "pty";
      liveSession.id = localSessionId;
      liveSession.type = "pty";
      syncTerminalRef(terminalsMap, tabId, localSessionId, "pty");

      if (path && path !== "~") {
        await invoke("write_to_pty", { sessionId: localSessionId, data: `cd ${path}\r` });
      }

      store.updateTab(tabId, { title: `Terminal`, sessionId: localSessionId });
    } catch (e) {
      terminal.write(`\r\n\x1b[31m[NovaShell]\x1b[0m Error returning to local: ${e}\r\n`);
    }
    return;
  }

  // Navigate to SSH server
  const conn = resolved;
  terminal.write(`\r\n\x1b[36m[NovaShell]\x1b[0m Connecting to \x1b[1m${conn.name}\x1b[0m (${conn.host})...\r\n`);

  try {
    const credentials = await getConnectionCredentials(conn);
    if (!credentials) {
      terminal.write(`\x1b[31m[NovaShell]\x1b[0m No credentials available for ${conn.name}. Connect via SSH panel first.\r\n`);
      return;
    }

    // Save current context before switching
    if (!currentTermRef.sessionId) {
      terminal.write(`\r\n\x1b[31m[NovaShell]\x1b[0m No active session to save.\r\n`);
      return;
    }
    // Find current connection if we're on SSH
    const currentConn = currentTermRef.sessionType === "ssh"
      ? store.sshConnections.find((c) => c.sessionId === currentTermRef.sessionId)
      : null;
    store.pushServerContext(tabId, {
      type: currentTermRef.sessionType === "ssh" ? "ssh" : "local",
      connectionId: currentConn?.id,
      sessionId: currentTermRef.sessionId,
      serverName: currentConn?.name || "local",
    });

    const newSessionId = await navigateToServer(conn, path, credentials);

    // Unsubscribe from previous session's data listener before binding new one
    if (currentTermRef.activeDataUnlisten) {
      currentTermRef.activeDataUnlisten();
      currentTermRef.activeDataUnlisten = null;
    }

    // Set up SSH data listener
    const { listen } = await getTauriEvent();
    const tabName = store.tabs.find((t) => t.id === tabId)?.title || tabId;

    const unlistenData = await listen<string>(`ssh-data-${newSessionId}`, (event) => {
      terminal.write(event.payload);
      queueDebugParse(event.payload, tabName);
    });
    unlisteners.push(unlistenData);
    currentTermRef.activeDataUnlisten = unlistenData;

    const navL = navListeners.get(tabId)!;
    const unlistenExit = await listen(`ssh-exit-${newSessionId}`, () => {
      terminal.write(`\r\n\x1b[31m[NovaShell]\x1b[0m SSH connection to ${conn.name} lost.\r\n`);
      // Auto-restore previous context
      const prevCtx = store.popServerContext(tabId);
      if (prevCtx) {
        const restoredType = prevCtx.type === "local" ? "pty" as const : "ssh" as const;
        currentTermRef.sessionId = prevCtx.sessionId;
        currentTermRef.sessionType = restoredType;
        liveSession.id = prevCtx.sessionId;
        liveSession.type = restoredType;
        syncTerminalRef(terminalsMap, tabId, prevCtx.sessionId, restoredType);
        store.updateTab(tabId, { title: `Terminal` });
      }
    });
    navL.push(unlistenExit);
    unlisteners.push(unlistenExit);

    const unlistenError = await listen<string>(`ssh-error-${newSessionId}`, (event) => {
      terminal.write(`\r\n\x1b[31m[NovaShell]\x1b[0m SSH Error: ${event.payload}\r\n`);
    });
    navL.push(unlistenError);
    unlisteners.push(unlistenError);

    // Update current ref
    currentTermRef.sessionId = newSessionId;
    currentTermRef.sessionType = "ssh";
    liveSession.id = newSessionId;
    liveSession.type = "ssh";
    syncTerminalRef(terminalsMap, tabId, newSessionId, "ssh");

    // Update tab title
    // Clean up old debug buffer key before title change
    const oldTitle = store.tabs.find((t) => t.id === tabId)?.title || tabId;
    debugBuffers.delete(oldTitle);
    store.updateTab(tabId, { title: `${conn.name}: ${path}` });

    terminal.write(`\x1b[32m[NovaShell]\x1b[0m Connected! Navigating to ${path}\r\n`);
  } catch (e) {
    terminal.write(`\r\n\x1b[31m[NovaShell]\x1b[0m Connection failed: ${e}\r\n`);
  }
}

export function TerminalPanel() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const theme = useAppStore((s) => s.theme);
  const updateTab = useAppStore((s) => s.updateTab);
  const setExecuteSnippet = useAppStore((s) => s.setExecuteSnippet);
  const searchOpen = useAppStore((s) => s.searchOpen);
  const toggleSearch = useAppStore((s) => s.toggleSearch);
  const splitMode = useAppStore((s) => s.splitMode);
  const terminalsRef = useRef<Map<string, TerminalRef>>(new Map());
  const containersRef = useRef<Map<string, HTMLDivElement>>(new Map());

  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const inputBufferRef = useRef("");

  // Store suggestions in refs so initTerminal doesn't need them as deps
  const suggestionsRef = useRef(suggestions);
  const showAutocompleteRef = useRef(showAutocomplete);
  const selectedSuggestionRef = useRef(selectedSuggestion);
  suggestionsRef.current = suggestions;
  showAutocompleteRef.current = showAutocomplete;
  selectedSuggestionRef.current = selectedSuggestion;

  useEffect(() => {
    if (splitMode !== "none") {
      const timer = setTimeout(() => {
        terminalsRef.current.forEach((ref) => ref.fitAddon.fit());
      }, 50);
      return () => clearTimeout(timer);
    } else {
      const ref = terminalsRef.current.get(activeTabId);
      if (ref) {
        const timer = setTimeout(() => ref.fitAddon.fit(), 50);
        return () => clearTimeout(timer);
      }
    }
  }, [activeTabId, splitMode, tabs.length]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        toggleSearch();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSearch]);

  const handleSearch = useCallback((query: string, direction: "next" | "prev") => {
    const ref = terminalsRef.current.get(activeTabId);
    if (!ref || !query) return;
    if (direction === "next") {
      ref.searchAddon.findNext(query);
    } else {
      ref.searchAddon.findPrevious(query);
    }
  }, [activeTabId]);

  // Debounced suggestion fetcher
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchSuggestions = useCallback((prefix: string) => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (prefix.length < 2) {
      setSuggestions([]);
      setShowAutocomplete(false);
      return;
    }
    debounceTimerRef.current = setTimeout(async () => {
      try {
        const { invoke } = await getTauriCore();
        const result = await invoke<string[]>("get_command_suggestions", { prefix });
        setSuggestions(result);
        setSelectedSuggestion(0);
        setShowAutocomplete(result.length > 0);
      } catch {
        setSuggestions([]);
        setShowAutocomplete(false);
      }
    }, 300);
  }, []);

  useEffect(() => {
    setExecuteSnippet((command: string, runMode?: "stop-on-error" | "run-all") => {
      const ref = terminalsRef.current.get(activeTabId);
      if (!ref) return;

      // Split multiline into individual commands
      const commands = command.split("\n").map((c) => c.trim()).filter((c) => c.length > 0);

      // Join with shell-native separator so the shell handles sequencing
      // && = stop on first error, ; = run all regardless
      const separator = runMode === "run-all" ? " ; " : " && ";
      const joined = commands.length > 1 ? commands.join(separator) : commands[0] || "";

      if (ref.sessionId) {
        getTauriCore().then(({ invoke }) => {
          const writeCmd = ref.sessionType === "ssh" ? "ssh_write" : "write_to_pty";
          invoke(writeCmd, { sessionId: ref.sessionId, data: joined + "\r" });
        }).catch(() => {});
      } else {
        // Demo mode - execute first command only
        ref.terminal.write(joined);
        ref.terminal.write("\r\n");
        handleDemoCommand(ref.terminal, commands[0] || joined);
        ref.terminal.write("\x1b[32mnovashell\x1b[0m \x1b[34m~\x1b[0m $ ");
      }

      useAppStore.getState().incrementCommandCount();
      useAppStore.getState().addHistory({ command: joined, shell: "terminal" });
    });

    return () => setExecuteSnippet(null);
  }, [activeTabId, setExecuteSnippet]);

  const initTerminal = useCallback(
    async (tabId: string, container: HTMLDivElement) => {
      if (terminalsRef.current.has(tabId)) return;

      const currentTheme = useAppStore.getState().theme;
      const colors = themeColors[currentTheme] || themeColors.dark;
      const disposables: Array<{ dispose: () => void }> = [];
      const unlisteners: Array<() => void> = [];

      const terminal = new Terminal({
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        fontSize: 14,
        lineHeight: 1.4,
        cursorBlink: true,
        cursorStyle: "block",
        cursorWidth: 2,
        theme: colors,
        allowTransparency: false,
        allowProposedApi: true,
        scrollback: 1000,
        tabStopWidth: 4,
        rightClickSelectsWord: true,
      });

      const fitAddon = new FitAddon();
      const searchAddon = new SearchAddon();

      terminal.loadAddon(fitAddon);
      terminal.loadAddon(new WebLinksAddon());
      terminal.loadAddon(searchAddon);

      terminal.open(container);

      // Load canvas renderer AFTER open() for proper cursor, selection, and color rendering
      // Without this, xterm v5 uses DOM renderer which has issues in WebView2
      try {
        terminal.loadAddon(new CanvasAddon());
      } catch {
        // Canvas addon failed, DOM renderer will be used as fallback
      }

      fitAddon.fit();

      let sessionId: string | null = null;
      // Live session tracking — updated by cross-server navigation
      const liveSession = { id: null as string | null, type: "pty" as "pty" | "ssh" };

      // Fire-and-forget write — microtask batching, zero IPC wait
      let liveWriteQueue = "";
      let liveWriteFlushScheduled = false;
      const scheduleLiveWriteFlush = () => {
        if (liveWriteFlushScheduled) return;
        liveWriteFlushScheduled = true;
        queueMicrotask(() => {
          liveWriteFlushScheduled = false;
          if (liveWriteQueue && liveSession.id) {
            const toSend = liveWriteQueue;
            liveWriteQueue = "";
            const cmd = liveSession.type === "ssh" ? "ssh_write" : "write_to_pty";
            getTauriCore().then(({ invoke }) => {
              invoke(cmd, { sessionId: liveSession.id, data: toSend }).catch(() => {});
            }).catch(() => {});
          }
        });
      };
      const writeToLiveSession = (text: string) => {
        if (!liveSession.id) return;
        liveWriteQueue += text;
        scheduleLiveWriteFlush();
      };
      // Delegate to xterm.js paste(): it normalizes CRLF/LF → CR and wraps
      // with bracketed-paste markers ONLY when the remote app enabled BPM
      // (DECSET 2004). Routes through terminal.onData → liveWriteQueue.
      // Fixes: extra spaces / phantom newlines in nano, vim, bash prompt.
      const pasteToLiveSession = (text: string) => {
        terminal.paste(text);
      };

      // Copy: Ctrl+C with selection copies to clipboard (otherwise sends SIGINT)
      terminal.attachCustomKeyEventHandler((e) => {
        if (e.type !== "keydown") return true;
        // Ctrl+C with selection = copy
        if ((e.ctrlKey || e.metaKey) && e.key === "c" && terminal.hasSelection()) {
          navigator.clipboard.writeText(terminal.getSelection());
          terminal.clearSelection();
          return false; // prevent sending to PTY
        }
        // Ctrl+V = paste from clipboard
        if ((e.ctrlKey || e.metaKey) && e.key === "v") {
          e.preventDefault(); // Prevent browser native paste (avoids duplicate)
          navigator.clipboard.readText().then((text) => {
            if (text) pasteToLiveSession(text);
          });
          return false;
        }
        // Ctrl+Shift+C = copy (alternative)
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "C") {
          if (terminal.hasSelection()) {
            navigator.clipboard.writeText(terminal.getSelection());
            terminal.clearSelection();
          }
          return false;
        }
        // Ctrl+Shift+V = paste (alternative)
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "V") {
          e.preventDefault(); // Prevent browser native paste (avoids duplicate)
          navigator.clipboard.readText().then((text) => {
            if (text) pasteToLiveSession(text);
          });
          return false;
        }
        return true;
      });

      // Right-click context menu: copy if selection, paste if no selection
      const contextMenuHandler = (e: Event) => {
        e.preventDefault();
        if (terminal.hasSelection()) {
          navigator.clipboard.writeText(terminal.getSelection());
          terminal.clearSelection();
        } else {
          navigator.clipboard.readText().then((text) => {
            if (text) pasteToLiveSession(text);
          });
        }
      };
      container.addEventListener("contextmenu", contextMenuHandler);
      unlisteners.push(() => container.removeEventListener("contextmenu", contextMenuHandler));

      try {
        const { invoke } = await getTauriCore();
        const { listen } = await getTauriEvent();

        const tab = useAppStore.getState().tabs.find((t) => t.id === tabId);

        // ──── Collab Guest Mode ────
        // If this tab is a guest collab session, use collab data flow instead of PTY
        if (tab?.shellType === "collab-guest" && tab.sessionId) {
          const collabId = tab.sessionId;
          const collabSession = useAppStore.getState().collabSessions[collabId];

          // Apply terminal size from host
          if (collabSession?.terminalSize) {
            terminal.resize(collabSession.terminalSize.cols, collabSession.terminalSize.rows);
          }

          // Listen for scrollback (initial sync)
          const unlistenScrollback = await listen<string>(
            `collab-scrollback-${collabId}`,
            (event) => { terminal.write(event.payload); }
          );
          unlisteners.push(unlistenScrollback);

          // Listen for real-time PTY data from host
          const unlistenData = await listen<string>(
            `collab-pty-data-${collabId}`,
            (event) => { terminal.write(event.payload); }
          );
          unlisteners.push(unlistenData);

          // Listen for resize events from host
          const unlistenResize = await listen<{ cols: number; rows: number }>(
            `collab-resize-${collabId}`,
            (event) => {
              terminal.resize(event.payload.cols, event.payload.rows);
            }
          );
          unlisteners.push(unlistenResize);

          // Forward keyboard input to host via collab_send_input
          const collabInputDisposable = terminal.onData((data) => {
            invoke("collab_send_input", { collabId, data }).catch(() => {});
          });
          disposables.push(collabInputDisposable);

          sessionId = collabId;
          liveSession.id = collabId;
          liveSession.type = "pty"; // Not a real PTY, but same cleanup path

          terminal.write("\x1b[36m[NovaShell]\x1b[0m Connected to collaborative session\r\n");

          terminalsRef.current.set(tabId, {
            terminal, fitAddon, searchAddon,
            sessionId: collabId,
            sessionType: "pty",
            disposables, unlisteners,
          });
          return; // Skip normal PTY initialization
        }

        // ──── SSH Terminal Tab Mode ────
        // If this tab has sshConnectionId, connect directly to that SSH server
        if (tab?.sshConnectionId) {
          const store = useAppStore.getState();
          const conn = store.sshConnections.find((c) => c.id === tab.sshConnectionId);
          if (conn) {
            terminal.write(`\x1b[36m[NovaShell]\x1b[0m Connecting to \x1b[1m${conn.name}\x1b[0m (${conn.host})...\r\n`);
            try {
              const credentials = await getConnectionCredentials(conn);
              if (!credentials) {
                terminal.write(`\x1b[33m[NovaShell]\x1b[0m No saved credentials for ${conn.name}. Opening password prompt...\r\n`);
                // Route to SSH panel which will show the password prompt.
                // After the user authenticates there, they can click the
                // "+ tab" button on the connected card to spawn a new tab.
                useAppStore.getState().requestSSHConnect(conn.id);
                return;
              }
              const sshSessionId = await navigateToServer(conn, "~", credentials);

              const tabName = tab.title || tabId;
              const unlistenData = await listen<string>(`ssh-data-${sshSessionId}`, (event) => {
                terminal.write(event.payload);
                queueDebugParse(event.payload, tabName);
              });
              unlisteners.push(unlistenData);

              const unlistenExit = await listen(`ssh-exit-${sshSessionId}`, () => {
                terminal.write(`\r\n\x1b[31m[NovaShell]\x1b[0m SSH connection to ${conn.name} closed.\r\n`);
              });
              unlisteners.push(unlistenExit);

              const unlistenError = await listen<string>(`ssh-error-${sshSessionId}`, (event) => {
                terminal.write(`\r\n\x1b[31m[NovaShell]\x1b[0m SSH Error: ${event.payload}\r\n`);
              });
              unlisteners.push(unlistenError);

              // Wire input → SSH write via batched queue (matches SSHPanel's
              // optimised pattern: all keystrokes from the same microtask are
              // coalesced into a single IPC call, avoiding per-keystroke overhead).
              let sshTabWriteQueue = "";
              let sshTabFlushScheduled = false;
              const scheduleSshTabFlush = () => {
                if (sshTabFlushScheduled) return;
                sshTabFlushScheduled = true;
                queueMicrotask(() => {
                  sshTabFlushScheduled = false;
                  if (sshTabWriteQueue) {
                    const toSend = sshTabWriteQueue;
                    sshTabWriteQueue = "";
                    invoke("ssh_write", { sessionId: sshSessionId, data: toSend }).catch(() => {});
                  }
                });
              };
              const inputDisposable = terminal.onData((data) => {
                sshTabWriteQueue += data;
                scheduleSshTabFlush();
              });
              disposables.push(inputDisposable);

              sessionId = sshSessionId;
              liveSession.id = sshSessionId;
              liveSession.type = "ssh";
              updateTab(tabId, { sessionId: sshSessionId });

              terminalsRef.current.set(tabId, {
                terminal, fitAddon, searchAddon,
                sessionId: sshSessionId,
                sessionType: "ssh",
                disposables, unlisteners,
              });
              terminal.write(`\x1b[32m[NovaShell]\x1b[0m Connected to ${conn.name}\r\n`);

              // One-shot initial command (used by Code panel to launch an AI
              // agent inside the fresh SSH session). Delay 500ms so the remote
              // shell has finished its login banner / prompt before we type.
              if (tab.initialCommand) {
                const cmdToSend = tab.initialCommand;
                setTimeout(() => {
                  invoke("ssh_write", { sessionId: sshSessionId, data: cmdToSend + "\r" }).catch(() => {});
                }, 500);
                updateTab(tabId, { initialCommand: undefined });
              }

              return; // Skip normal PTY initialization
            } catch (e) {
              terminal.write(`\r\n\x1b[31m[NovaShell]\x1b[0m SSH connection failed: ${e}\r\n`);
              return;
            }
          } else {
            // Connection was deleted — show error instead of silently opening local shell
            terminal.write(`\x1b[31m[NovaShell]\x1b[0m SSH connection no longer exists. It may have been deleted.\r\n`);
            terminal.write(`\x1b[90mClose this tab and reconnect from the SSH panel.\x1b[0m\r\n`);
            return;
          }
        }

        // ──── Normal PTY Mode ────
        // shellType now stores the full path from get_available_shells
        const defaultShell = navigator.platform.startsWith("Win") ? "powershell.exe" : "/bin/bash";
        const shellPath = tab?.shellType || defaultShell;

        sessionId = await invoke<string>("create_pty_session", { shellPath });
        liveSession.id = sessionId;
        liveSession.type = "pty";
        updateTab(tabId, { sessionId });

        const tabName = tab?.title || tabId;
        const unlistenData = await listen<string>(`pty-data-${sessionId}`, (event) => {
          terminal.write(event.payload);
          // Feed to debug log asynchronously - don't block terminal rendering
          queueDebugParse(event.payload, tabName);
        });
        unlisteners.push(unlistenData);

        const unlistenExit = await listen(`pty-exit-${sessionId}`, () => {
          terminal.write("\r\n\x1b[31m[Process exited]\x1b[0m\r\n");
          useAppStore.getState().addDebugLog({
            level: "warn",
            message: "Process exited",
            source: tabName,
          });
        });
        unlisteners.push(unlistenExit);

        const unlistenError = await listen<string>(`pty-error-${sessionId}`, (event) => {
          terminal.write(`\r\n\x1b[31m[Error: ${event.payload}]\x1b[0m\r\n`);
          useAppStore.getState().addDebugLog({
            level: "error",
            message: event.payload,
            source: tabName,
          });
        });
        unlisteners.push(unlistenError);

        let ptyInputBuffer = "";
        const currentTermRef = { sessionId, sessionType: "pty" as "pty" | "ssh", activeDataUnlisten: unlistenData as (() => void) | null };

        // Fire-and-forget write — microtask batching, zero IPC wait
        let sessionWriteQueue = "";
        let sessionWriteFlushScheduled = false;
        const scheduleSessionWriteFlush = () => {
          if (sessionWriteFlushScheduled) return;
          sessionWriteFlushScheduled = true;
          queueMicrotask(() => {
            sessionWriteFlushScheduled = false;
            if (sessionWriteQueue && currentTermRef.sessionId) {
              const toSend = sessionWriteQueue;
              sessionWriteQueue = "";
              const cmd = currentTermRef.sessionType === "ssh" ? "ssh_write" : "write_to_pty";
              invoke(cmd, { sessionId: currentTermRef.sessionId, data: toSend }).catch(() => {});
            }
          });
        };
        const writeToSession = (d: string) => {
          sessionWriteQueue += d;
          scheduleSessionWriteFlush();
        };
        const dataDisposable = terminal.onData((data) => {
          // Check for cross-server navigation on Enter
          if ((data === "\r" || data === "\n") && isServerNavCommand(ptyInputBuffer)) {
            const parsed = parseServerNavCommand(ptyInputBuffer);
            if (parsed) {
              // Send Ctrl+U to cancel the pending command in the shell buffer
              writeToSession("\x15");
              // Handle navigation asynchronously
              handleServerNavigation(
                tabId, terminal, parsed.serverName, parsed.path,
                currentTermRef, liveSession, terminalsRef.current,
                unlisteners, disposables
              );
              ptyInputBuffer = "";
              setShowAutocomplete(false);
              return; // Don't forward Enter to shell
            }
          }

          // ── AI Natural Language → Command (prefix: ?) ──
          if ((data === "\r" || data === "\n") && ptyInputBuffer.trim().startsWith("?") && ptyInputBuffer.trim().length > 2) {
            const query = ptyInputBuffer.trim().slice(1).trim();
            const bufLen = ptyInputBuffer.length;
            writeToSession("\x7f".repeat(bufLen));
            ptyInputBuffer = "";
            setShowAutocomplete(false);
            // Helper: show status in shell prompt (as comment), then clear it
            const showStatus = (msg: string) => { writeToSession(msg); };
            const clearStatus = (len: number) => { writeToSession("\x7f".repeat(len)); };

            (async () => {
              const statusMsg = "# [AI] generating...";
              try {
                const inv = await getTauriCore();
                const AI_MODEL = "deepseek-coder:6.7b";
                // Auto-pull model if not available
                let needsPull = false;
                try {
                  const models = await inv.invoke<Array<{ name: string }>>("ai_list_models");
                  needsPull = !models.some((m) => m.name.startsWith(AI_MODEL.split(":")[0]));
                } catch { /* Ollama not running */ }

                if (needsPull) {
                  const dlMsg = "# [AI] downloading model (first time)...";
                  showStatus(dlMsg);
                  try { await inv.invoke("ai_pull_model", { model: AI_MODEL }); } catch { /* pull failed */ }
                  clearStatus(dlMsg.length);
                }

                showStatus(statusMsg);
                const osName = navigator.platform.startsWith("Win") ? "Windows" : navigator.platform.includes("Mac") ? "macOS" : "Linux";
                const shellName = (tab?.shellType || "").split(/[/\\]/).pop() || "shell";
                const response = await inv.invoke<string>("ai_chat", {
                  model: AI_MODEL,
                  systemPrompt: `You are a command translator. The user describes what they want to do and you reply with EXACTLY ONE shell command. OS: ${osName}. Shell: ${shellName}. Rules: reply with ONLY the command, nothing else. No explanations, no descriptions, no markdown, no backticks, no quotes. Just the raw command.`,
                  messages: [{ role: "user", content: query }],
                });
                clearStatus(statusMsg.length);
                // Extract just the command — strip markdown, explanations, pick first code-like line
                let cmd = (response || "").trim()
                  .replace(/^```[\w]*\n?/gm, "").replace(/\n?```$/gm, "") // strip code fences
                  .split("\n")
                  .map((l: string) => l.trim())
                  .filter((l: string) => l && !l.startsWith("#") && !l.startsWith("//") && !l.startsWith("El ") && !l.startsWith("The ") && !l.startsWith("This ") && !l.startsWith("Use ") && !l.startsWith("Note") && !l.startsWith("*") && !l.startsWith("-") && l.length < 200)
                  [0] || "";
                // Strip leading "$ " or "> " prompt markers
                cmd = cmd.replace(/^[$>]\s+/, "");
                if (cmd && ptyInputBuffer.length === 0) {
                  writeToSession(cmd);
                  ptyInputBuffer = cmd;
                }
              } catch {
                clearStatus(statusMsg.length);
              }
            })();
            return;
          }

          writeToSession(data);

          if (data === "\r" || data === "\n") {
            const cmd = ptyInputBuffer.trim();
            // Only record meaningful commands (not empty, not single chars, not escape sequences)
            if (cmd && cmd.length > 1 && !cmd.startsWith("\x1b")) {
              const entryData: { command: string; shell: string; screenshot?: string } = { command: cmd, shell: tab?.shellType || "shell" };
              useAppStore.getState().addHistory(entryData);
              useAppStore.getState().incrementCommandCount();
            }
            ptyInputBuffer = "";
            setShowAutocomplete(false);
          } else if (data === "\x7f" || data === "\b") {
            ptyInputBuffer = ptyInputBuffer.slice(0, -1);
            if (ptyInputBuffer.length > 0) {
              fetchSuggestions(ptyInputBuffer);
            } else {
              setShowAutocomplete(false);
            }
          } else if (data === "\t") {
            if (suggestionsRef.current.length > 0 && showAutocompleteRef.current) {
              const selected = suggestionsRef.current[selectedSuggestionRef.current] || suggestionsRef.current[0];
              const remaining = selected.slice(ptyInputBuffer.length);
              if (remaining) {
                writeToSession(remaining);
                ptyInputBuffer = selected;
              }
              setShowAutocomplete(false);
            }
          } else if (data === "\x1b[A" || data === "\x1b[B") {
            // Arrow up/down - clear buffer since shell is navigating history
            ptyInputBuffer = "";
          } else if (data === "\x03" || data === "\x15") {
            // Ctrl+C or Ctrl+U — shell line is being cancelled, clear input buffer
            ptyInputBuffer = "";
            setShowAutocomplete(false);
          } else if (data.charCodeAt(0) < 32) {
            // Other control characters - ignore for buffer
          } else if (data >= " ") {
            // Cap buffer to prevent unbounded growth (e.g. pasted large text)
            if (ptyInputBuffer.length < 4096) {
              ptyInputBuffer += data;
            }
            // Only suggest for first word of command (not arguments)
            const parts = ptyInputBuffer.split(/[|;&]/);
            const lastPart = parts[parts.length - 1].trim();
            if (!lastPart.includes(" ")) {
              fetchSuggestions(lastPart);
            } else {
              setShowAutocomplete(false);
            }
          }
        });
        disposables.push(dataDisposable);

        // Debounced resize — avoids flooding IPC during window drag
        let termResizeTimer: ReturnType<typeof setTimeout> | null = null;
        const resizeDisposable = terminal.onResize(({ cols, rows }) => {
          if (termResizeTimer) clearTimeout(termResizeTimer);
          termResizeTimer = setTimeout(() => {
            const resizeCmd = currentTermRef.sessionType === "ssh" ? "ssh_resize" : "resize_pty";
            invoke(resizeCmd, { sessionId: currentTermRef.sessionId, cols, rows });
          }, 50);
        });
        disposables.push(resizeDisposable);

        invoke("resize_pty", {
          sessionId,
          cols: terminal.cols,
          rows: terminal.rows,
        });

        // Load colored environment from init script file
        // Writing to file avoids PSReadLine input issues with long commands
        const colorSid = sessionId;
        const shellLower = shellPath.toLowerCase();
        let shellType = "unknown";
        if (shellLower.includes("powershell") || shellLower.includes("pwsh")) shellType = "powershell";
        else if (shellLower.includes("cmd")) shellType = "cmd";
        else if (shellLower.includes("bash")) shellType = "bash";
        else if (shellLower.includes("zsh")) shellType = "zsh";

        if (shellType !== "unknown") {
          (async () => {
            try {
              const scriptPath = await invoke<string>("write_shell_init_script", { shellType });
              // Wait for shell to be fully ready, then source the init script
              const sourceDelay = shellType === "powershell" ? 800 : 300;
              setTimeout(() => {
                let sourceCmd = "";
                if (shellType === "powershell") {
                  // Dot-source imports into current scope. Only escape single quotes (backslashes are literal in PS single-quoted strings)
                  const escaped = scriptPath.replace(/'/g, "''");
                  sourceCmd = `. '${escaped}'`;
                } else if (shellType === "cmd") {
                  sourceCmd = `"${scriptPath}"`;
                } else {
                  // bash / zsh
                  sourceCmd = `. "${scriptPath}"`;
                }
                invoke("write_to_pty", { sessionId: colorSid, data: sourceCmd + "\r" });
              }, sourceDelay);
            } catch {
              // Fallback: no colored init, shell still works
            }
          })();
        }
      } catch {
        terminal.writeln("\x1b[1;36m  _   _                  ____  _          _ _  \x1b[0m");
        terminal.writeln("\x1b[1;36m | \\ | | _____   ____ _/ ___|| |__   ___| | | \x1b[0m");
        terminal.writeln("\x1b[1;36m |  \\| |/ _ \\ \\ / / _` \\___ \\| '_ \\ / _ \\ | | \x1b[0m");
        terminal.writeln("\x1b[1;36m | |\\  | (_) \\ V / (_| |___) | | | |  __/ | | \x1b[0m");
        terminal.writeln("\x1b[1;36m |_| \\_|\\___/ \\_/ \\__,_|____/|_| |_|\\___|_|_| \x1b[0m");
        terminal.writeln("");
        terminal.writeln("\x1b[33m  Professional Terminal Emulator v1.0.0\x1b[0m");
        terminal.writeln("\x1b[90m  Running in demo mode (no Tauri backend)\x1b[0m");
        terminal.writeln("\x1b[90m  Ctrl+F: Search | Tab: Autocomplete\x1b[0m");
        terminal.writeln("");
        terminal.write("\x1b[32mnovashell\x1b[0m \x1b[34m~\x1b[0m $ ");

        let lineBuffer = "";
        const demoDisposable = terminal.onData((data) => {
          if (data === "\r") {
            terminal.writeln("");
            setShowAutocomplete(false);
            if (lineBuffer.trim()) {
              handleDemoCommand(terminal, lineBuffer.trim());
              useAppStore.getState().addHistory({ command: lineBuffer.trim(), shell: "demo" });
              useAppStore.getState().incrementCommandCount();
                    }
            lineBuffer = "";
            inputBufferRef.current = "";
            terminal.write("\x1b[32mnovashell\x1b[0m \x1b[34m~\x1b[0m $ ");
          } else if (data === "\x7f") {
            if (lineBuffer.length > 0) {
              lineBuffer = lineBuffer.slice(0, -1);
              inputBufferRef.current = lineBuffer;
              terminal.write("\b \b");
              if (lineBuffer.length > 0) {
                fetchSuggestions(lineBuffer);
              } else {
                setShowAutocomplete(false);
              }
            }
          } else if (data === "\t") {
            if (suggestionsRef.current.length > 0 && showAutocompleteRef.current) {
              const selected = suggestionsRef.current[selectedSuggestionRef.current] || suggestionsRef.current[0];
              const remaining = selected.slice(lineBuffer.length);
              terminal.write(remaining);
              lineBuffer = selected;
              inputBufferRef.current = lineBuffer;
              setShowAutocomplete(false);
            }
          } else if (data >= " ") {
            lineBuffer += data;
            inputBufferRef.current = lineBuffer;
            terminal.write(data);
            fetchSuggestions(lineBuffer);
          }
        });
        disposables.push(demoDisposable);
      }

      terminalsRef.current.set(tabId, {
        terminal,
        fitAddon,
        searchAddon,
        sessionId,
        sessionType: "pty",
        disposables,
        unlisteners,
      });

      // One-shot initial command (used by Code panel to launch an AI agent
      // inside a fresh local PTY). Wait for the shell prompt to appear —
      // PowerShell needs ~800ms (matches the existing init delay), bash ~300ms.
      // tab/invoke aren't in scope here (they live inside the try block above),
      // so we re-fetch both — sessionId IS in the outer scope.
      const ptyTab = useAppStore.getState().tabs.find((t) => t.id === tabId);
      if (ptyTab?.initialCommand && sessionId) {
        const cmdToSend = ptyTab.initialCommand;
        const initDelay = (ptyTab.shellType || "").toLowerCase().includes("powershell") ? 1200 : 400;
        const sidSnapshot = sessionId;
        setTimeout(() => {
          getTauriCore().then(({ invoke }) => {
            invoke("write_to_pty", { sessionId: sidSnapshot, data: cmdToSend + "\r" }).catch(() => {});
          }).catch(() => {});
        }, initDelay);
        updateTab(tabId, { initialCommand: undefined });
      }
    },
    [updateTab, fetchSuggestions]
  );

  useEffect(() => {
    const terminalTabs = tabs.filter((t) => t.type === "terminal" || !t.type);
    const currentTabIds = new Set(terminalTabs.map((t) => t.id));
    const toRemove: string[] = [];
    terminalsRef.current.forEach((_ref, tabId) => {
      if (!currentTabIds.has(tabId)) {
        toRemove.push(tabId);
      }
    });
    for (const tabId of toRemove) {
      const ref = terminalsRef.current.get(tabId);
      if (!ref) continue;
      // Remove from maps FIRST to prevent double-cleanup
      terminalsRef.current.delete(tabId);
      containersRef.current.delete(tabId);
      // Clean up debug buffer for this tab's source
      const tab = useAppStore.getState().tabs.find((t) => t.id === tabId);
      const tabName = tab?.title || tabId;
      debugBuffers.delete(tabName);
      cleanNavListeners(tabId);
      navListeners.delete(tabId);
      // Unsubscribe event listeners before closing PTY
      ref.unlisteners.forEach((fn) => fn());
      ref.disposables.forEach((d) => d.dispose());
      // Close PTY/SSH/Collab session, then dispose terminal after cleanup
      const sid = ref.sessionId;
      if (sid) {
        // Check if this is a collab guest session
        const collabSession = useAppStore.getState().collabSessions[sid];
        if (collabSession?.role === "guest") {
          useAppStore.getState().leaveCollabSession(sid).finally(() => {
            ref.terminal.dispose();
          });
        } else {
          const closeCmd = ref.sessionType === "ssh" ? "ssh_disconnect" : "close_pty_session";
          getTauriCore().then(({ invoke }) => {
            invoke(closeCmd, { sessionId: sid }).catch(() => {});
          }).catch(() => {}).finally(() => {
            ref.terminal.dispose();
          });
        }
      } else {
        ref.terminal.dispose();
      }
    }
  }, [tabs]);

  useEffect(() => {
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const handleResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        // Only fit the active terminal (or all visible in split mode)
        const currentSplit = useAppStore.getState().splitMode;
        if (currentSplit !== "none") {
          terminalsRef.current.forEach((termRef) => termRef.fitAddon.fit());
        } else {
          const active = terminalsRef.current.get(useAppStore.getState().activeTabId);
          if (active) active.fitAddon.fit();
        }
      }, 80);
    };
    const observer = new ResizeObserver(handleResize);
    const mainArea = document.querySelector(".terminal-panel");
    if (mainArea) observer.observe(mainArea);
    return () => { observer.disconnect(); if (resizeTimer) clearTimeout(resizeTimer); };
  }, []);

  const customTheme = useAppStore((s) => s.customTheme);
  useEffect(() => {
    let colors: Record<string, string>;
    if (theme === "custom") {
      colors = {
        background: customTheme.terminalBg, foreground: customTheme.terminalFg,
        cursor: customTheme.terminalCursor, cursorAccent: customTheme.terminalBg,
        selectionBackground: customTheme.accentPrimary + "66", selectionForeground: "#ffffff",
        black: "#484f58", red: "#ff7b72", green: "#3fb950", yellow: "#d29922",
        blue: customTheme.accentPrimary, magenta: "#bc8cff", cyan: customTheme.accentSecondary, white: "#b1bac4",
        brightBlack: "#6e7681", brightRed: "#ffa198", brightGreen: "#56d364", brightYellow: "#e3b341",
        brightBlue: customTheme.accentPrimary, brightMagenta: "#d2a8ff", brightCyan: customTheme.accentSecondary, brightWhite: "#f0f6fc",
      };
    } else {
      colors = themeColors[theme] || themeColors.dark;
    }
    terminalsRef.current.forEach((termRef) => {
      termRef.terminal.options.theme = colors;
    });
  }, [theme, customTheme]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      terminalsRef.current.forEach((ref) => {
        ref.disposables.forEach((d) => d.dispose());
        ref.unlisteners.forEach((fn) => fn());
        if (ref.sessionId) {
          // Check if this is a collab guest session
          const collabSession = useAppStore.getState().collabSessions[ref.sessionId];
          if (collabSession?.role === "guest") {
            useAppStore.getState().leaveCollabSession(ref.sessionId).catch(() => {});
          } else {
            const closeCmd = ref.sessionType === "ssh" ? "ssh_disconnect" : "close_pty_session";
            getTauriCore().then(({ invoke }) => {
              invoke(closeCmd, { sessionId: ref.sessionId });
            }).catch(() => {});
          }
        }
        ref.terminal.dispose();
      });
      terminalsRef.current.clear();
    };
  }, []);

  const handleSelectSuggestion = useCallback((cmd: string) => {
    const ref = terminalsRef.current.get(activeTabId);
    if (!ref) return;

    if (ref.sessionId) {
      getTauriCore().then(({ invoke }) => {
        const remaining = cmd.slice(inputBufferRef.current.length);
        if (remaining) {
          const writeCmd = ref.sessionType === "ssh" ? "ssh_write" : "write_to_pty";
          invoke(writeCmd, { sessionId: ref.sessionId, data: remaining });
        }
      }).catch(() => {});
    } else {
      const remaining = cmd.slice(inputBufferRef.current.length);
      ref.terminal.write(remaining);
      inputBufferRef.current = cmd;
    }
    setShowAutocomplete(false);
  }, [activeTabId]);

  const splitClass = splitMode === "horizontal" ? "split-horizontal" : splitMode === "vertical" ? "split-vertical" : "";

  return (
    <div className={`terminal-panel ${splitClass}`}>
      {searchOpen && (
        <SearchOverlay
          onSearch={handleSearch}
          onClose={toggleSearch}
        />
      )}
      <Autocomplete
        suggestions={suggestions}
        onSelect={handleSelectSuggestion}
        visible={showAutocomplete}
        selectedIndex={selectedSuggestion}
      />
      <div className="terminal-instances-container">
        {tabs.filter((t) => t.type === "terminal" || !t.type).map((tab) => (
          <div
            key={tab.id}
            className={`terminal-instance ${tab.id !== activeTabId && splitMode === "none" ? "hidden" : ""}`}
          >
            <CollabOverlay tabId={tab.id} />
            <div
              style={{ flex: 1, minHeight: 0 }}
              ref={(el) => {
                if (el && !containersRef.current.has(tab.id)) {
                  containersRef.current.set(tab.id, el);
                  initTerminal(tab.id, el);
                }
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function handleDemoCommand(terminal: Terminal, cmd: string) {
  const commands: Record<string, () => void> = {
    help: () => {
      terminal.writeln("\x1b[1;33mAvailable demo commands:\x1b[0m");
      terminal.writeln("  \x1b[36mhelp\x1b[0m      - Show this help");
      terminal.writeln("  \x1b[36mneofetch\x1b[0m  - System info");
      terminal.writeln("  \x1b[36mtheme\x1b[0m     - Show theme info");
      terminal.writeln("  \x1b[36mdate\x1b[0m      - Current date/time");
      terminal.writeln("  \x1b[36mclear\x1b[0m     - Clear terminal");
      terminal.writeln("  \x1b[36mmatrix\x1b[0m    - Matrix animation");
      terminal.writeln("  \x1b[36mcolors\x1b[0m    - Color palette");
      terminal.writeln("  \x1b[36mls\x1b[0m        - List files (demo)");
    },
    clear: () => terminal.clear(),
    date: () => terminal.writeln(`  ${new Date().toLocaleString()}`),
    ls: () => {
      terminal.writeln("  \x1b[1;34mDocuments/\x1b[0m  \x1b[1;34mDesktop/\x1b[0m  \x1b[1;34mDownloads/\x1b[0m");
      terminal.writeln("  \x1b[1;34m.config/\x1b[0m    \x1b[1;34m.ssh/\x1b[0m     \x1b[32mREADME.md\x1b[0m");
      terminal.writeln("  package.json  tsconfig.json  \x1b[32mvite.config.ts\x1b[0m");
    },
    neofetch: () => {
      terminal.writeln("\x1b[1;34m        .--.        \x1b[0m  \x1b[1;36mNovaShell v1.1.4\x1b[0m");
      terminal.writeln("\x1b[1;34m       |o_o |       \x1b[0m  \x1b[33mOS:\x1b[0m Demo Mode");
      terminal.writeln("\x1b[1;34m       |:_/ |       \x1b[0m  \x1b[33mShell:\x1b[0m NovaShell Demo");
      terminal.writeln("\x1b[1;34m      //   \\ \\      \x1b[0m  \x1b[33mTerminal:\x1b[0m xterm.js");
      terminal.writeln("\x1b[1;34m     (|     | )     \x1b[0m  \x1b[33mTheme:\x1b[0m Adaptive");
      terminal.writeln("\x1b[1;34m    /'\\_   _/`\\     \x1b[0m  \x1b[33mFont:\x1b[0m JetBrains Mono");
      terminal.writeln("\x1b[1;34m    \\___)=(___/     \x1b[0m");
    },
    colors: () => {
      terminal.writeln("\x1b[1m  Standard Colors:\x1b[0m");
      let line = "  ";
      for (let i = 0; i < 8; i++) line += `\x1b[48;5;${i}m   \x1b[0m`;
      terminal.writeln(line);
      line = "  ";
      for (let i = 8; i < 16; i++) line += `\x1b[48;5;${i}m   \x1b[0m`;
      terminal.writeln(line);
      terminal.writeln("\x1b[1m  256 Color Palette:\x1b[0m");
      for (let row = 0; row < 6; row++) {
        line = "  ";
        for (let col = 0; col < 36; col++) {
          const idx = 16 + row * 36 + col;
          line += `\x1b[48;5;${idx}m \x1b[0m`;
        }
        terminal.writeln(line);
      }
    },
    matrix: () => {
      terminal.writeln("\x1b[32m");
      for (let i = 0; i < 8; i++) {
        let line = "  ";
        for (let j = 0; j < 60; j++) {
          line += String.fromCharCode(0x30a0 + Math.random() * 96);
        }
        terminal.writeln(line);
      }
      terminal.writeln("\x1b[0m");
    },
    theme: () => {
      terminal.writeln("\x1b[1;35m  Current Theme Info:\x1b[0m");
      terminal.writeln("  Use the theme dots in the title bar to switch themes.");
      terminal.writeln("  Available: \x1b[90mDark\x1b[0m | \x1b[37mLight\x1b[0m | \x1b[36mCyberpunk\x1b[0m | \x1b[32mRetro\x1b[0m");
    },
  };

  if (commands[cmd]) {
    commands[cmd]();
  } else {
    terminal.writeln(`\x1b[31m  Command not found: ${cmd}\x1b[0m`);
    terminal.writeln("  \x1b[90mType 'help' for available commands\x1b[0m");
  }
}
