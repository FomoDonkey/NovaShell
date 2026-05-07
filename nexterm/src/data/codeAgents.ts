// Catalog of AI coding agents that can be launched in a terminal session
// (local PTY or remote SSH). Each agent declares how to detect whether it's
// installed, how to install it, and how to launch it.
//
// `installRemote` runs on Linux/macOS shells via ssh_exec (most servers).
// `installLocalWindows` runs in a Windows PowerShell PTY tab.

export type AgentCostTier = "free" | "free-tier" | "byok";
//   free       — works fully offline / no API key required (e.g. Aider+Ollama)
//   free-tier  — free tier available with the vendor (Gemini CLI's 1k req/day)
//   byok       — bring-your-own-key, paid (Claude, Codex)

// How aggressively the agent auto-applies edits & shell commands. Mirrors
// Claude Desktop's Code-tab selector and translates to per-agent CLI flags.
export type EditMode = "manual" | "auto-accept" | "plan";

export interface CodeAgent {
  id: string;
  name: string;
  description: string;
  costTier: AgentCostTier;
  costNote: string;        // short label shown next to the badge
  launchCmd: string;       // command to start the agent (shell-agnostic)
  checkCmd: string;        // POSIX command to detect install: prints "OK" or nothing
  checkCmdWindows: string; // PowerShell equivalent
  installRemote: string;   // POSIX install one-liner (Linux/macOS)
  installLocalWindows: string; // PowerShell install one-liner
  installNote: string;     // human note shown in the confirm dialog
  docsUrl: string;
  needsApiKeyEnv?: string; // e.g. ANTHROPIC_API_KEY, OPENAI_API_KEY
  // CLI flag appended after the launch command for each edit mode. Empty/missing
  // = no flag (use the agent's default). Mode 'manual' is usually no flag (the
  // agent's default is already to ask before each edit/command).
  flagsByMode: Partial<Record<EditMode, string>>;
}

export const CODE_AGENTS: CodeAgent[] = [
  {
    id: "claude",
    name: "Claude Code",
    description: "Anthropic's official terminal agent. Best-in-class for code editing.",
    costTier: "byok",
    costNote: "API key required",
    launchCmd: "claude",
    checkCmd: "command -v claude >/dev/null 2>&1 && echo OK",
    checkCmdWindows: "if (Get-Command claude -ErrorAction SilentlyContinue) { 'OK' }",
    installRemote: "curl -fsSL https://claude.ai/install.sh | bash",
    installLocalWindows: "irm https://claude.ai/install.ps1 | iex",
    installNote: "Installs Claude Code CLI. Requires ANTHROPIC_API_KEY env var to run.",
    docsUrl: "https://docs.claude.com/claude-code",
    needsApiKeyEnv: "ANTHROPIC_API_KEY",
    // Claude Code: default asks per tool. --dangerously-skip-permissions
    // disables ALL permission prompts (auto-accept everything). Plan mode is
    // toggled inside the session with Shift+Tab — there's no startup flag, so
    // we set --permission-mode plan when supported (Claude Code ≥ 1.0.30).
    flagsByMode: {
      "auto-accept": "--dangerously-skip-permissions",
      "plan": "--permission-mode plan",
    },
  },
  {
    id: "codex",
    name: "Codex CLI",
    description: "OpenAI's official terminal agent. Powered by GPT-5/o4 family.",
    costTier: "byok",
    costNote: "API key required",
    launchCmd: "codex",
    checkCmd: "command -v codex >/dev/null 2>&1 && echo OK",
    checkCmdWindows: "if (Get-Command codex -ErrorAction SilentlyContinue) { 'OK' }",
    installRemote: "npm install -g @openai/codex",
    installLocalWindows: "npm install -g @openai/codex",
    installNote: "Installs Codex CLI via npm. Requires Node.js and an OPENAI_API_KEY.",
    docsUrl: "https://github.com/openai/codex",
    needsApiKeyEnv: "OPENAI_API_KEY",
    // Codex: --auto-edit auto-applies file edits (still asks for shell cmds).
    // --full-auto auto-applies everything including shell commands.
    flagsByMode: {
      "auto-accept": "--full-auto",
    },
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    description: "Google's terminal agent. Great free tier (~1000 req/day with personal Google account).",
    costTier: "free-tier",
    costNote: "Free tier (Google login)",
    launchCmd: "gemini",
    checkCmd: "command -v gemini >/dev/null 2>&1 && echo OK",
    checkCmdWindows: "if (Get-Command gemini -ErrorAction SilentlyContinue) { 'OK' }",
    installRemote: "npm install -g @google/gemini-cli",
    installLocalWindows: "npm install -g @google/gemini-cli",
    installNote: "Installs Gemini CLI via npm. Sign in with your Google account on first run — no API key needed for the free tier.",
    docsUrl: "https://github.com/google-gemini/gemini-cli",
    // Gemini CLI: --yolo (a.k.a. --yes-all) auto-accepts every action.
    flagsByMode: {
      "auto-accept": "--yolo",
    },
  },
  {
    id: "opencode",
    name: "OpenCode",
    description: "Model-agnostic terminal agent. Plug in Ollama, Gemini free, DeepSeek, Groq, etc.",
    costTier: "free",
    costNote: "Free (model-agnostic)",
    launchCmd: "opencode",
    checkCmd: "command -v opencode >/dev/null 2>&1 && echo OK",
    checkCmdWindows: "if (Get-Command opencode -ErrorAction SilentlyContinue) { 'OK' }",
    installRemote: "curl -fsSL https://opencode.ai/install | bash",
    installLocalWindows: "npm install -g opencode-ai",
    installNote: "Installs OpenCode. Works with any model — local Ollama, free APIs (Gemini/Groq/DeepSeek), or paid.",
    docsUrl: "https://opencode.ai",
    // OpenCode: edit-mode is configured per-session in TUI (Tab to cycle).
    // No documented launch flag for auto-accept yet, so we leave it default.
    flagsByMode: {},
  },
  {
    id: "aider",
    name: "Aider",
    description: "Veteran AI pair programmer. Works with any LLM including local Ollama.",
    costTier: "free",
    costNote: "Free (with local LLM)",
    launchCmd: "aider",
    checkCmd: "command -v aider >/dev/null 2>&1 && echo OK",
    checkCmdWindows: "if (Get-Command aider -ErrorAction SilentlyContinue) { 'OK' }",
    installRemote: "python3 -m pip install --user aider-install && aider-install",
    installLocalWindows: "python -m pip install aider-install; aider-install",
    installNote: "Installs Aider via pip. Pair with --model ollama/llama3 for 100% free local operation.",
    docsUrl: "https://aider.chat",
    // Aider: --yes-always auto-confirms every prompt (apply edit, run command).
    flagsByMode: {
      "auto-accept": "--yes-always",
    },
  },
  {
    id: "qwen",
    name: "Qwen Code",
    description: "Alibaba's open-weights agent fork of Gemini CLI. 100% free with Qwen models.",
    costTier: "free",
    costNote: "Free (open weights)",
    launchCmd: "qwen",
    checkCmd: "command -v qwen >/dev/null 2>&1 && echo OK",
    checkCmdWindows: "if (Get-Command qwen -ErrorAction SilentlyContinue) { 'OK' }",
    installRemote: "npm install -g @qwen-code/qwen-code",
    installLocalWindows: "npm install -g @qwen-code/qwen-code",
    installNote: "Installs Qwen Code via npm. Uses Alibaba's Qwen3-Coder model — sign up free at modelscope.cn for an API key.",
    docsUrl: "https://github.com/QwenLM/qwen-code",
    // Qwen Code is a Gemini CLI fork — same --yolo flag.
    flagsByMode: {
      "auto-accept": "--yolo",
    },
  },
];

export function getAgent(id: string): CodeAgent | undefined {
  return CODE_AGENTS.find((a) => a.id === id);
}
