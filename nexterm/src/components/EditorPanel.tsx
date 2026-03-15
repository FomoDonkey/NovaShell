import { useState, useEffect, useRef, useCallback } from "react";
import {
  FileText, Save, X, AlertTriangle, Loader2, FolderOpen, Sparkles, Check,
} from "lucide-react";
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightActiveLine, drawSelection } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, indentWithTab, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter, indentOnInput } from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { autocompletion, closeBrackets } from "@codemirror/autocomplete";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { yaml } from "@codemirror/lang-yaml";
import { markdown } from "@codemirror/lang-markdown";
import { sql } from "@codemirror/lang-sql";

let invokeCache: typeof import("@tauri-apps/api/core").invoke | null = null;
async function getInvoke() {
  if (!invokeCache) { const m = await import("@tauri-apps/api/core"); invokeCache = m.invoke; }
  return invokeCache;
}

interface OpenFile {
  path: string;
  name: string;
  content: string;
  source: "local" | "sftp";
  sftpSessionId?: string;
  modified: boolean;
}

// Dark theme matching NovaShell
const novaTheme = EditorView.theme({
  "&": { backgroundColor: "var(--bg-primary)", color: "var(--text-primary)", fontSize: "12px", fontFamily: "'JetBrains Mono', 'Fira Code', monospace" },
  ".cm-content": { caretColor: "var(--accent-primary)", padding: "4px 0" },
  ".cm-cursor": { borderLeftColor: "var(--accent-primary)", borderLeftWidth: "2px" },
  ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.03)" },
  ".cm-activeLineGutter": { backgroundColor: "rgba(255,255,255,0.05)" },
  ".cm-gutters": { backgroundColor: "var(--bg-secondary)", color: "var(--text-muted)", border: "none", fontSize: "10px" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 4px", minWidth: "32px" },
  ".cm-selectionBackground": { backgroundColor: "rgba(88,166,255,0.2) !important" },
  ".cm-matchingBracket": { backgroundColor: "rgba(88,166,255,0.3)", outline: "1px solid rgba(88,166,255,0.5)" },
  ".cm-foldGutter": { padding: "0 2px" },
  ".cm-searchMatch": { backgroundColor: "rgba(245,158,11,0.3)" },
  ".cm-tooltip": { backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-subtle)", color: "var(--text-primary)" },
  ".cm-tooltip-autocomplete": { "& > ul > li[aria-selected]": { backgroundColor: "var(--accent-primary)", color: "white" } },
}, { dark: true });

function getLang(ext: string) {
  switch (ext.toLowerCase()) {
    case "js": case "jsx": case "mjs": case "cjs": return javascript();
    case "ts": case "tsx": return javascript({ typescript: true, jsx: ext.includes("x") });
    case "py": return python();
    case "json": return json();
    case "html": case "htm": return html();
    case "css": case "scss": case "less": return css();
    case "yml": case "yaml": return yaml();
    case "md": case "mdx": return markdown();
    case "sql": return sql();
    default: return [];
  }
}

const btnS: React.CSSProperties = {
  padding: "4px 8px", border: "none", borderRadius: "var(--radius-sm)",
  fontSize: 10, cursor: "pointer", fontFamily: "inherit",
  display: "inline-flex", alignItems: "center", gap: 4,
};

export function EditorPanel() {
  const [file, setFile] = useState<OpenFile | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langCompartment = useRef(new Compartment());
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>();
  const contentRef = useRef("");

  // Open file from event (dispatched by FileExplorer or SFTPPanel)
  useEffect(() => {
    const handler = (e: CustomEvent<{ path: string; name: string; content: string; source: "local" | "sftp"; sftpSessionId?: string }>) => {
      const d = e.detail;
      setFile({ path: d.path, name: d.name, content: d.content, source: d.source, sftpSessionId: d.sftpSessionId, modified: false });
      contentRef.current = d.content;
      setAiAnalysis(null);
      setShowAnalysis(false);
    };
    window.addEventListener("novashell-open-editor" as any, handler as any);
    return () => window.removeEventListener("novashell-open-editor" as any, handler as any);
  }, []);

  // Create/update CodeMirror instance when file changes
  useEffect(() => {
    if (!file || !editorRef.current) return;

    const ext = file.name.split(".").pop() || "";
    const lang = getLang(ext);

    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }

    const state = EditorState.create({
      doc: file.content,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        foldGutter(),
        indentOnInput(),
        history(),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        novaTheme,
        langCompartment.current.of(lang),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            contentRef.current = update.state.doc.toString();
            setFile((prev) => prev ? { ...prev, modified: true } : null);

            // Debounced AI analysis (3s after last keystroke)
            if (debounceTimer.current) clearTimeout(debounceTimer.current);
            debounceTimer.current = setTimeout(() => analyzeContent(contentRef.current, file.name), 3000);
          }
        }),
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({ state, parent: editorRef.current });
    viewRef.current = view;

    return () => { view.destroy(); viewRef.current = null; };
  }, [file?.path]); // Only recreate when file path changes

  // Save file
  const saveFile = useCallback(async () => {
    if (!file) return;
    setSaving(true);
    try {
      const invoke = await getInvoke();
      if (file.source === "sftp" && file.sftpSessionId) {
        await invoke("sftp_write_text", { sessionId: file.sftpSessionId, path: file.path, content: contentRef.current });
      } else {
        await invoke("write_file", { path: file.path, content: contentRef.current });
      }
      setFile((prev) => prev ? { ...prev, modified: false, content: contentRef.current } : null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      alert(`Save failed: ${e}`);
    }
    setSaving(false);
  }, [file]);

  // Ctrl+S handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        saveFile();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [saveFile]);

  // AI analysis
  const analyzeContent = async (content: string, filename: string) => {
    if (content.length < 10 || content.length > 50000) return;
    setAiLoading(true);
    try {
      const invoke = await getInvoke();
      const health = await invoke<boolean>("ai_health").catch(() => false);
      if (!health) { setAiLoading(false); return; }

      const ext = filename.split(".").pop() || "";
      const fileType = ext === "yml" || ext === "yaml" ? "YAML" : ext === "json" ? "JSON" :
        ext === "conf" || ext === "cfg" || filename.includes("nginx") ? "Nginx/Config" :
        ext === "env" ? "Environment" : ext === "toml" ? "TOML" :
        ext === "dockerfile" || filename.toLowerCase() === "dockerfile" ? "Dockerfile" :
        ext === "js" || ext === "ts" ? "JavaScript/TypeScript" :
        ext === "py" ? "Python" : ext;

      const result = await invoke<string>("ai_chat", {
        model: "llama3.2",
        systemPrompt: "You are a config file analyzer. Be concise. Only report ACTUAL issues — syntax errors, security risks, port conflicts, deprecated options, missing required fields. Use format: ⚠ line X: issue. If no issues found, say '✓ No issues detected'. Max 8 issues.",
        messages: [{ role: "user", content: `Analyze this ${fileType} file for errors, warnings, and potential issues:\n\n\`\`\`\n${content.slice(0, 8000)}\n\`\`\`` }],
      });
      setAiAnalysis(result);
      setShowAnalysis(true);
    } catch {
      // AI unavailable — silent fail
    }
    setAiLoading(false);
  };

  // No file open
  if (!file) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)", fontSize: 12, gap: 8 }}>
        <FileText size={32} style={{ opacity: 0.3 }} />
        <div>No file open</div>
        <div style={{ fontSize: 10 }}>Open files from Explorer or SFTP panel</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 0 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", background: "var(--bg-tertiary)", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0 }}>
        <FileText size={12} style={{ color: "var(--accent-primary)", flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {file.name}{file.modified ? " *" : ""}
        </span>
        {file.source === "sftp" && <span style={{ fontSize: 8, padding: "1px 4px", borderRadius: 3, background: "rgba(36,150,237,0.15)", color: "#2496ED" }}>SFTP</span>}
        {aiLoading && <Loader2 size={10} style={{ color: "var(--accent-primary)", animation: "spin 1s linear infinite" }} />}
        {aiAnalysis && !aiLoading && (
          <button onClick={() => setShowAnalysis(!showAnalysis)}
            style={{ ...btnS, padding: "2px 6px", background: aiAnalysis.includes("✓") ? "rgba(16,185,129,0.1)" : "rgba(245,158,11,0.1)", color: aiAnalysis.includes("✓") ? "#10B981" : "#F59E0B" }}>
            {aiAnalysis.includes("✓") ? <Check size={9} /> : <AlertTriangle size={9} />}
            AI
          </button>
        )}
        <button onClick={() => analyzeContent(contentRef.current, file.name)} disabled={aiLoading}
          style={{ ...btnS, padding: "2px 6px", background: "var(--bg-active)", color: "var(--text-secondary)" }} title="Analyze with AI">
          <Sparkles size={9} />
        </button>
        <button onClick={saveFile} disabled={saving || !file.modified}
          style={{ ...btnS, padding: "2px 8px", background: file.modified ? "var(--accent-primary)" : "var(--bg-active)", color: file.modified ? "white" : "var(--text-muted)" }}>
          {saving ? <Loader2 size={9} style={{ animation: "spin 1s linear infinite" }} /> : saved ? <Check size={9} /> : <Save size={9} />}
          {saved ? "Saved" : "Save"}
        </button>
        <button onClick={() => { setFile(null); setAiAnalysis(null); }}
          style={{ ...btnS, padding: "2px 4px", background: "none", color: "var(--text-muted)" }}>
          <X size={10} />
        </button>
      </div>

      {/* AI Analysis panel */}
      {showAnalysis && aiAnalysis && (
        <div style={{
          padding: "6px 10px", fontSize: 10, flexShrink: 0, maxHeight: 120, overflowY: "auto",
          background: aiAnalysis.includes("✓") ? "rgba(16,185,129,0.05)" : "rgba(245,158,11,0.05)",
          borderBottom: "1px solid var(--border-subtle)", fontFamily: "'JetBrains Mono', monospace",
          color: "var(--text-primary)", whiteSpace: "pre-wrap", lineHeight: 1.5,
        }} className="hacking-log-container">
          {aiAnalysis}
        </div>
      )}

      {/* File path */}
      <div style={{ padding: "2px 8px", fontSize: 8, color: "var(--text-muted)", background: "var(--bg-secondary)", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "rtl", textAlign: "left" }}>
        {file.path}
      </div>

      {/* CodeMirror editor */}
      <div ref={editorRef} style={{ flex: 1, overflow: "auto", minHeight: 0 }} />
    </div>
  );
}
