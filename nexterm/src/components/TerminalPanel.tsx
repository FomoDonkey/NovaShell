import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import { useAppStore } from "../store/appStore";
import { SearchOverlay } from "./SearchOverlay";
import { Autocomplete } from "./Autocomplete";

interface TerminalRef {
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  sessionId: string | null;
  disposables: Array<{ dispose: () => void }>;
  unlisteners: Array<() => void>;
}

const themeColors: Record<string, Record<string, string>> = {
  dark: {
    background: "#0d1117",
    foreground: "#e6edf3",
    cursor: "#58a6ff",
    cursorAccent: "#0d1117",
    selectionBackground: "rgba(88,166,255,0.3)",
    black: "#484f58", red: "#ff7b72", green: "#3fb950", yellow: "#d29922",
    blue: "#58a6ff", magenta: "#bc8cff", cyan: "#39d2c0", white: "#b1bac4",
    brightBlack: "#6e7681", brightRed: "#ffa198", brightGreen: "#56d364", brightYellow: "#e3b341",
    brightBlue: "#79c0ff", brightMagenta: "#d2a8ff", brightCyan: "#56d4dd", brightWhite: "#f0f6fc",
  },
  light: {
    background: "#ffffff",
    foreground: "#1f2328",
    cursor: "#0969da",
    cursorAccent: "#ffffff",
    selectionBackground: "rgba(9,105,218,0.2)",
    black: "#24292f", red: "#cf222e", green: "#1a7f37", yellow: "#9a6700",
    blue: "#0969da", magenta: "#8250df", cyan: "#1b7c83", white: "#6e7781",
    brightBlack: "#57606a", brightRed: "#a40e26", brightGreen: "#2da44e", brightYellow: "#bf8700",
    brightBlue: "#218bff", brightMagenta: "#a475f9", brightCyan: "#3192aa", brightWhite: "#8c959f",
  },
  cyberpunk: {
    background: "#0a0a1a",
    foreground: "#00ffcc",
    cursor: "#00ffcc",
    cursorAccent: "#0a0a1a",
    selectionBackground: "rgba(0,255,204,0.2)",
    black: "#333366", red: "#ff3366", green: "#00ffcc", yellow: "#ffcc00",
    blue: "#3399ff", magenta: "#cc66ff", cyan: "#00ccff", white: "#ccccff",
    brightBlack: "#666699", brightRed: "#ff6699", brightGreen: "#33ffdd", brightYellow: "#ffdd33",
    brightBlue: "#66bbff", brightMagenta: "#dd88ff", brightCyan: "#33ddff", brightWhite: "#eeeeff",
  },
  retro: {
    background: "#1b2b1b",
    foreground: "#33ff33",
    cursor: "#33ff33",
    cursorAccent: "#1b2b1b",
    selectionBackground: "rgba(51,255,51,0.2)",
    black: "#0a150a", red: "#ff3333", green: "#33ff33", yellow: "#ccff33",
    blue: "#33ccff", magenta: "#33ffcc", cyan: "#66ff66", white: "#99cc99",
    brightBlack: "#448844", brightRed: "#ff6666", brightGreen: "#66ff66", brightYellow: "#ddff66",
    brightBlue: "#66ddff", brightMagenta: "#66ffdd", brightCyan: "#88ff88", brightWhite: "#ccffcc",
  },
};

export function TerminalPanel() {
  const {
    tabs, activeTabId, theme, updateTab, setExecuteSnippet,
    incrementCommandCount, addHistory, searchOpen, toggleSearch,
    splitMode, checkAchievements,
  } = useAppStore();
  const terminalsRef = useRef<Map<string, TerminalRef>>(new Map());
  const containersRef = useRef<Map<string, HTMLDivElement>>(new Map());

  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const inputBufferRef = useRef("");

  useEffect(() => {
    const ref = terminalsRef.current.get(activeTabId);
    if (ref) {
      setTimeout(() => ref.fitAddon.fit(), 50);
    }
  }, [activeTabId, splitMode]);

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

  useEffect(() => {
    const interval = setInterval(checkAchievements, 5000);
    return () => clearInterval(interval);
  }, [checkAchievements]);

  const handleSearch = useCallback((query: string, direction: "next" | "prev") => {
    const ref = terminalsRef.current.get(activeTabId);
    if (!ref || !query) return;
    if (direction === "next") {
      ref.searchAddon.findNext(query);
    } else {
      ref.searchAddon.findPrevious(query);
    }
  }, [activeTabId]);

  const fetchSuggestions = useCallback(async (prefix: string) => {
    if (prefix.length < 1) {
      setSuggestions([]);
      setShowAutocomplete(false);
      return;
    }
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<string[]>("get_command_suggestions", { prefix });
      setSuggestions(result);
      setSelectedSuggestion(0);
      setShowAutocomplete(result.length > 0);
    } catch {
      const demoCommands = [
        "help", "neofetch", "clear", "colors", "matrix", "theme", "date",
        "git status", "git add", "git commit", "git push", "git pull",
        "npm install", "npm run", "npm start", "docker ps", "docker images",
      ];
      const filtered = demoCommands.filter((c) => c.startsWith(prefix.toLowerCase()));
      setSuggestions(filtered.slice(0, 10));
      setSelectedSuggestion(0);
      setShowAutocomplete(filtered.length > 0);
    }
  }, []);

  useEffect(() => {
    setExecuteSnippet((command: string) => {
      const ref = terminalsRef.current.get(activeTabId);
      if (!ref) return;

      if (ref.sessionId) {
        import("@tauri-apps/api/core").then(({ invoke }) => {
          invoke("write_to_pty", { sessionId: ref.sessionId, data: command + "\r" });
        }).catch(() => {});
      } else {
        ref.terminal.write(command);
        ref.terminal.write("\r\n");
        handleDemoCommand(ref.terminal, command.trim());
        ref.terminal.write("\x1b[32mnovashell\x1b[0m \x1b[34m~\x1b[0m $ ");
      }
      incrementCommandCount();
      addHistory({ command, shell: "terminal" });
      checkAchievements();
    });

    return () => setExecuteSnippet(null);
  }, [activeTabId, setExecuteSnippet, incrementCommandCount, addHistory, checkAchievements]);

  const initTerminal = useCallback(
    async (tabId: string, container: HTMLDivElement) => {
      if (terminalsRef.current.has(tabId)) return;

      const colors = themeColors[theme] || themeColors.dark;
      const disposables: Array<{ dispose: () => void }> = [];
      const unlisteners: Array<() => void> = [];

      const terminal = new Terminal({
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        fontSize: 14,
        lineHeight: 1.4,
        cursorBlink: true,
        cursorStyle: "bar",
        theme: colors,
        allowProposedApi: true,
        scrollback: 10000,
        tabStopWidth: 4,
      });

      const fitAddon = new FitAddon();
      const searchAddon = new SearchAddon();

      terminal.loadAddon(fitAddon);
      terminal.loadAddon(new WebLinksAddon());
      terminal.loadAddon(searchAddon);

      terminal.open(container);
      fitAddon.fit();

      let sessionId: string | null = null;
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const { listen } = await import("@tauri-apps/api/event");

        const tab = tabs.find((t) => t.id === tabId);
        const shellMap: Record<string, string> = {
          powershell: "powershell.exe",
          cmd: "cmd.exe",
          bash: "C:\\Program Files\\Git\\bin\\bash.exe",
          wsl: "C:\\Windows\\System32\\wsl.exe",
        };
        const shellPath = shellMap[tab?.shellType || "powershell"] || "powershell.exe";

        sessionId = await invoke<string>("create_pty_session", { shellPath });
        updateTab(tabId, { sessionId });

        const unlistenData = await listen<string>(`pty-data-${sessionId}`, (event) => {
          terminal.write(event.payload);
        });
        unlisteners.push(unlistenData);

        const unlistenExit = await listen(`pty-exit-${sessionId}`, () => {
          terminal.write("\r\n\x1b[31m[Process exited]\x1b[0m\r\n");
        });
        unlisteners.push(unlistenExit);

        const unlistenError = await listen<string>(`pty-error-${sessionId}`, (event) => {
          terminal.write(`\r\n\x1b[31m[Error: ${event.payload}]\x1b[0m\r\n`);
        });
        unlisteners.push(unlistenError);

        let ptyInputBuffer = "";
        const dataDisposable = terminal.onData((data) => {
          invoke("write_to_pty", { sessionId, data });

          if (data === "\r" || data === "\n") {
            const cmd = ptyInputBuffer.trim();
            if (cmd) {
              addHistory({ command: cmd, shell: tab?.shellType || "powershell" });
              incrementCommandCount();
              checkAchievements();
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
            if (suggestions.length > 0 && showAutocomplete) {
              const selected = suggestions[selectedSuggestion] || suggestions[0];
              const remaining = selected.slice(ptyInputBuffer.length);
              if (remaining) {
                invoke("write_to_pty", { sessionId, data: remaining });
                ptyInputBuffer = selected;
              }
              setShowAutocomplete(false);
            }
          } else if (data === "\x1b[A" || data === "\x1b[B") {
          } else if (data >= " ") {
            ptyInputBuffer += data;
            const parts = ptyInputBuffer.split(/[|;&]/);
            const lastPart = parts[parts.length - 1].trim();
            fetchSuggestions(lastPart);
          }
        });
        disposables.push(dataDisposable);

        const resizeDisposable = terminal.onResize(({ cols, rows }) => {
          invoke("resize_pty", { sessionId, cols, rows });
        });
        disposables.push(resizeDisposable);

        invoke("resize_pty", {
          sessionId,
          cols: terminal.cols,
          rows: terminal.rows,
        });
      } catch {
        terminal.writeln("\x1b[1;36m  _   _          _____                   \x1b[0m");
        terminal.writeln("\x1b[1;36m | \\ | |        |_   _|                  \x1b[0m");
        terminal.writeln("\x1b[1;36m |  \\| | _____  __| | ___ _ __ _ __ ___  \x1b[0m");
        terminal.writeln("\x1b[1;36m | . ` |/ _ \\ \\/ /| |/ _ \\ '__| '_ ` _ \\ \x1b[0m");
        terminal.writeln("\x1b[1;36m | |\\  |  __/>  < | |  __/ |  | | | | | |\x1b[0m");
        terminal.writeln("\x1b[1;36m |_| \\_|\\___/_/\\_\\|_|\\___|_|  |_| |_| |_|\x1b[0m");
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
              addHistory({ command: lineBuffer.trim(), shell: "demo" });
              incrementCommandCount();
              checkAchievements();
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
            if (suggestions.length > 0 && showAutocomplete) {
              const selected = suggestions[selectedSuggestion] || suggestions[0];
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
        disposables,
        unlisteners,
      });
    },
    [theme, tabs, updateTab, incrementCommandCount, addHistory, checkAchievements, fetchSuggestions, suggestions, showAutocomplete, selectedSuggestion]
  );

  useEffect(() => {
    const currentTabIds = new Set(tabs.map((t) => t.id));
    terminalsRef.current.forEach((ref, tabId) => {
      if (!currentTabIds.has(tabId)) {
        ref.disposables.forEach((d) => d.dispose());
        ref.unlisteners.forEach((fn) => fn());
        if (ref.sessionId) {
          import("@tauri-apps/api/core").then(({ invoke }) => {
            invoke("close_pty_session", { sessionId: ref.sessionId });
          }).catch(() => {});
        }
        ref.terminal.dispose();
        terminalsRef.current.delete(tabId);
        containersRef.current.delete(tabId);
      }
    });
  }, [tabs]);

  useEffect(() => {
    const handleResize = () => {
      terminalsRef.current.forEach((termRef) => {
        termRef.fitAddon.fit();
      });
    };
    const observer = new ResizeObserver(handleResize);
    const mainArea = document.querySelector(".terminal-panel");
    if (mainArea) observer.observe(mainArea);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const colors = themeColors[theme] || themeColors.dark;
    terminalsRef.current.forEach((termRef) => {
      termRef.terminal.options.theme = colors;
    });
  }, [theme]);

  useEffect(() => {
    return () => {
      terminalsRef.current.forEach((ref) => {
        ref.disposables.forEach((d) => d.dispose());
        ref.unlisteners.forEach((fn) => fn());
        if (ref.sessionId) {
          import("@tauri-apps/api/core").then(({ invoke }) => {
            invoke("close_pty_session", { sessionId: ref.sessionId });
          }).catch(() => {});
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
      import("@tauri-apps/api/core").then(({ invoke }) => {
        const remaining = cmd.slice(inputBufferRef.current.length);
        if (remaining) {
          invoke("write_to_pty", { sessionId: ref.sessionId, data: remaining });
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
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`terminal-instance ${tab.id !== activeTabId && splitMode === "none" ? "hidden" : ""}`}
          ref={(el) => {
            if (el && !containersRef.current.has(tab.id)) {
              containersRef.current.set(tab.id, el);
              initTerminal(tab.id, el);
            }
          }}
        />
      ))}
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
      terminal.writeln("\x1b[1;34m        .--.        \x1b[0m  \x1b[1;36mNovaTerm v1.0.0\x1b[0m");
      terminal.writeln("\x1b[1;34m       |o_o |       \x1b[0m  \x1b[33mOS:\x1b[0m Demo Mode");
      terminal.writeln("\x1b[1;34m       |:_/ |       \x1b[0m  \x1b[33mShell:\x1b[0m NovaTerm Demo");
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
