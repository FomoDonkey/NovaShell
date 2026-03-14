import { useState, useCallback } from "react";
import { Brain, Send, Loader2, AlertTriangle, Copy, Trash2 } from "lucide-react";
import { useAppStore } from "../../store/appStore";

let tauriCoreCache: typeof import("@tauri-apps/api/core") | null = null;
async function getTauriCore() {
  if (!tauriCoreCache) tauriCoreCache = await import("@tauri-apps/api/core");
  return tauriCoreCache;
}

const SECURITY_MODES = [
  { id: "analyze", label: "Analyze", prompt: "You are a security analyst. Analyze the following security context and identify risks, vulnerabilities, and attack vectors. Be specific with your findings." },
  { id: "escalation", label: "Priv Esc", prompt: "You are a penetration tester specializing in privilege escalation. Based on the context, suggest specific privilege escalation paths. Include the exact commands to run. Only suggest techniques for authorized pentesting." },
  { id: "audit", label: "Audit", prompt: "You are a security auditor. Review the system configuration and services described. Generate a comprehensive security audit report with remediation steps. Prioritize findings by risk level." },
  { id: "fix", label: "Harden", prompt: "You are a system hardening expert. Based on the security findings, generate specific shell commands and configuration changes to fix each vulnerability. Provide copy-paste ready commands." },
] as const;

interface ChatEntry {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode: string;
}

export function AiSecView() {
  const reconResults = useAppStore((s) => s.hackingReconResults);
  const addHackingLog = useAppStore((s) => s.addHackingLog);

  const [ollamaOnline, setOllamaOnline] = useState<boolean | null>(null);
  const [models, setModels] = useState<{ name: string; size: number }[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [secMode, setSecMode] = useState<string>("analyze");
  const [query, setQuery] = useState("");
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const checkOllama = useCallback(async () => {
    try {
      const { invoke } = await getTauriCore();
      const healthy = await invoke<boolean>("ai_health");
      setOllamaOnline(healthy);
      if (healthy) {
        const modelList = await invoke<{ name: string; size: number }[]>("ai_list_models");
        setModels(modelList);
        if (modelList.length > 0 && !selectedModel) {
          setSelectedModel(modelList[0].name);
        }
      }
    } catch {
      setOllamaOnline(false);
    }
  }, [selectedModel]);

  // Auto-check on first render
  if (ollamaOnline === null) {
    checkOllama();
  }

  const buildContext = () => {
    const parts: string[] = [];
    if (reconResults) {
      parts.push(`Environment: ${reconResults.environment.type}`);
      parts.push(`OS: ${reconResults.environment.os}`);
      parts.push(`Hostname: ${reconResults.environment.hostname}`);
      parts.push(`IP: ${reconResults.environment.ip}`);
      if (reconResults.environment.vulnerabilityHints.length > 0) {
        parts.push(`Security Hints: ${reconResults.environment.vulnerabilityHints.join(", ")}`);
      }
      const openPorts = reconResults.openPorts.filter((p) => p.state === "open");
      if (openPorts.length > 0) {
        parts.push(`Open Ports: ${openPorts.map((p) => `${p.port}/${p.service} (${p.risk} risk)`).join(", ")}`);
      }
      if (reconResults.services.length > 0) {
        parts.push(`Services: ${reconResults.services.map((s) => `${s.name}:${s.port} v${s.version}`).join(", ")}`);
      }
    }
    return parts.length > 0 ? parts.join("\n") : "No recon data available. Run a scan first for better results.";
  };

  const sendMessage = useCallback(async () => {
    if (!query.trim() || !selectedModel || loading) return;

    const mode = SECURITY_MODES.find((m) => m.id === secMode) || SECURITY_MODES[0];
    const userMsg = query.trim();
    setQuery("");

    const userEntry: ChatEntry = {
      id: crypto.randomUUID(),
      role: "user",
      content: userMsg,
      mode: mode.id,
    };
    setChat((prev) => [...prev, userEntry]);
    setLoading(true);

    try {
      const { invoke } = await getTauriCore();
      const context = buildContext();
      const systemPrompt = `${mode.prompt}\n\nCurrent system context:\n${context}`;

      // Build full conversation history for context-aware responses
      const history = chat.map((e) => ({ role: e.role, content: e.content }));
      history.push({ role: "user", content: userMsg });
      const response = await invoke<string>("ai_chat", {
        model: selectedModel,
        systemPrompt,
        messages: history,
      });

      const assistantEntry: ChatEntry = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: response,
        mode: mode.id,
      };
      setChat((prev) => [...prev, assistantEntry]);

      addHackingLog({
        level: "info",
        message: `AI Security analysis (${mode.label}): ${userMsg.slice(0, 60)}...`,
        source: "AI Security",
        category: "ai",
      });
    } catch (err) {
      const errorEntry: ChatEntry = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Error: ${err}`,
        mode: "error",
      };
      setChat((prev) => [...prev, errorEntry]);
    }

    setLoading(false);
  }, [query, selectedModel, loading, secMode, addHackingLog, reconResults]);

  const quickActions = [
    { label: "Analyze my environment", query: "Analyze this environment for security risks. What are the main attack vectors?" },
    { label: "Suggest hardening", query: "What specific hardening steps should I take for this system? Provide exact commands." },
    { label: "Check open ports", query: "Analyze the open ports. Which ones are most dangerous and why? How should I secure them?" },
    { label: "Privilege escalation paths", query: "Based on this environment, what privilege escalation techniques might work? List specific methods." },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Brain size={12} style={{ color: "var(--accent-purple)" }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-primary)", flex: 1 }}>
          AI Security Copilot
        </span>
        {ollamaOnline === false && (
          <span style={{ fontSize: 9, color: "#ff0040", display: "flex", alignItems: "center", gap: 3 }}>
            <AlertTriangle size={9} /> Ollama offline
          </span>
        )}
      </div>

      {/* Model + Mode selectors */}
      <div style={{ display: "flex", gap: 6 }}>
        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          style={{
            flex: 1,
            background: "var(--bg-primary)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-sm)",
            color: "var(--text-primary)",
            padding: "3px 6px",
            fontSize: 10,
            outline: "none",
          }}
        >
          {models.length === 0 && <option value="">No models</option>}
          {models.map((m) => (
            <option key={m.name} value={m.name}>{m.name}</option>
          ))}
        </select>
      </div>

      {/* Security mode pills */}
      <div style={{ display: "flex", gap: 4 }}>
        {SECURITY_MODES.map((mode) => (
          <button
            key={mode.id}
            onClick={() => setSecMode(mode.id)}
            style={{
              flex: 1,
              padding: "3px 6px",
              fontSize: 9,
              fontWeight: 600,
              borderRadius: 8,
              border: "1px solid",
              borderColor: secMode === mode.id ? "var(--accent-primary)" : "var(--border-subtle)",
              background: secMode === mode.id ? "var(--accent-primary)" : "var(--bg-tertiary)",
              color: secMode === mode.id ? "#000" : "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            {mode.label}
          </button>
        ))}
      </div>

      {/* Quick actions */}
      {chat.length === 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 9, color: "var(--text-muted)" }}>Quick actions:</span>
          {quickActions.map((action, i) => (
            <button
              key={i}
              onClick={() => { setQuery(action.query); }}
              style={{
                background: "var(--bg-tertiary)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-sm)",
                color: "var(--text-secondary)",
                padding: "5px 8px",
                fontSize: 10,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      {/* Chat messages */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {chat.map((entry) => (
          <div
            key={entry.id}
            style={{
              padding: "8px 10px",
              borderRadius: "var(--radius-sm)",
              background: entry.role === "user" ? "var(--bg-active)" : "var(--bg-tertiary)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <div style={{
              fontSize: 9,
              color: entry.role === "user" ? "var(--accent-primary)" : "var(--accent-purple)",
              fontWeight: 700,
              marginBottom: 4,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}>
              {entry.role === "user" ? "You" : "AI Security"}
              {entry.role === "assistant" && (
                <button
                  onClick={() => navigator.clipboard.writeText(entry.content).catch(() => {})}
                  style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 0 }}
                >
                  <Copy size={9} />
                </button>
              )}
            </div>
            <div style={{
              fontSize: 10,
              color: entry.mode === "error" ? "#ff0040" : "var(--text-primary)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily: entry.role === "assistant" ? "'JetBrains Mono', monospace" : "inherit",
              lineHeight: 1.5,
            }}>
              {entry.content}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: 8, color: "var(--text-muted)", fontSize: 10 }}>
            <Loader2 size={12} className="animate-pulse" />
            <span>Analyzing...</span>
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{ display: "flex", gap: 6 }}>
        {chat.length > 0 && (
          <button
            onClick={() => setChat([])}
            style={{
              background: "var(--bg-active)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-sm)",
              color: "var(--text-muted)",
              padding: "4px 8px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
            }}
            title="Clear chat"
          >
            <Trash2 size={10} />
          </button>
        )}
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder={`Ask about security (${SECURITY_MODES.find((m) => m.id === secMode)?.label} mode)...`}
          style={{
            flex: 1,
            background: "var(--bg-primary)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-sm)",
            color: "var(--text-primary)",
            padding: "5px 8px",
            fontSize: 11,
            outline: "none",
          }}
          disabled={!ollamaOnline || loading}
        />
        <button
          onClick={sendMessage}
          disabled={!query.trim() || !ollamaOnline || loading}
          style={{
            background: query.trim() && ollamaOnline ? "var(--accent-primary)" : "var(--bg-active)",
            border: "none",
            borderRadius: "var(--radius-sm)",
            color: query.trim() && ollamaOnline ? "#000" : "var(--text-muted)",
            padding: "4px 10px",
            cursor: query.trim() && ollamaOnline ? "pointer" : "default",
            display: "flex",
            alignItems: "center",
          }}
        >
          <Send size={12} />
        </button>
      </div>
    </div>
  );
}
