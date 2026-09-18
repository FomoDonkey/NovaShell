// Derive a human-readable identity (type, size, SHA256 fingerprint, comment)
// from a PRIVATE key, so the UI can show *which* key is loaded.
//
// Why: a connection that stores the wrong key pair fails with libssh2's opaque
// `[Session(-18)] Username/PublicKey combination invalid`, which looks exactly
// like a server-side problem. Showing the fingerprint next to the textarea makes
// a wrong-key mixup obvious before ever hitting Connect — compare it with
// `ssh-keygen -lf <file>` or with the server's authorized_keys.
//
// Everything is parsed in the renderer: the key never leaves the app.

export interface SshKeyInfo {
  /** Display type: "RSA", "ED25519", "ECDSA nistp256", "DSA"… or a PEM label. */
  type: string;
  /** Key size in bits, when it can be determined. */
  bits?: number;
  /** "SHA256:…" — same value `ssh-keygen -lf` prints. */
  fingerprint?: string;
  /** Key comment (usually user@host), when the key stores one unencrypted. */
  comment?: string;
  /** The private key material is passphrase-protected. */
  encrypted?: boolean;
  /** Why no fingerprint could be derived — one of the reason codes below. */
  problem?: "ppk" | "not-a-private-key" | "unsupported" | "malformed" | "no-crypto";
}

const PEM_RE = /-----BEGIN ([A-Z0-9 ]+?)-----\r?\n([\s\S]*?)-----END \1-----/;

/** Read a big-endian uint32. */
function u32(buf: Uint8Array, off: number): number {
  return ((buf[off] << 24) >>> 0) + (buf[off + 1] << 16) + (buf[off + 2] << 8) + buf[off + 3];
}

/** Sequential reader for the SSH wire format (length-prefixed strings). */
class Reader {
  constructor(private buf: Uint8Array, public off = 0) {}
  get remaining(): number {
    return this.buf.length - this.off;
  }
  /** Next length-prefixed blob, or null when it doesn't fit. */
  string(): Uint8Array | null {
    if (this.remaining < 4) return null;
    const len = u32(this.buf, this.off);
    if (len > this.remaining - 4) return null;
    const out = this.buf.subarray(this.off + 4, this.off + 4 + len);
    this.off += 4 + len;
    return out;
  }
}

const dec = new TextDecoder();
const asText = (b: Uint8Array) => dec.decode(b);

function b64decode(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64encode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Bit length of a big-endian unsigned integer (ignores leading zero bytes). */
function bitLength(bytes: Uint8Array): number {
  let i = 0;
  while (i < bytes.length && bytes[i] === 0) i++;
  if (i === bytes.length) return 0;
  let bits = (bytes.length - i - 1) * 8;
  for (let b = bytes[i]; b > 0; b >>= 1) bits++;
  return bits;
}

/** OpenSSH fingerprint: unpadded base64 of the SHA-256 of the public key blob. */
async function sha256Fingerprint(blob: Uint8Array): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  // Copy into a standalone ArrayBuffer — subarray views can't be hashed directly.
  const digest = await subtle.digest("SHA-256", new Uint8Array(blob).buffer);
  return "SHA256:" + b64encode(new Uint8Array(digest)).replace(/=+$/, "");
}

/** Pretty name for an SSH key type string, e.g. "ecdsa-sha2-nistp256" → "ECDSA nistp256". */
function prettyType(sshType: string): string {
  if (sshType === "ssh-rsa") return "RSA";
  if (sshType === "ssh-dss") return "DSA";
  if (sshType === "ssh-ed25519") return "ED25519";
  if (sshType === "sk-ssh-ed25519@openssh.com") return "ED25519-SK";
  if (sshType.startsWith("ecdsa-sha2-")) return "ECDSA " + sshType.slice("ecdsa-sha2-".length);
  if (sshType.startsWith("sk-ecdsa-sha2-")) return "ECDSA-SK " + sshType.slice("sk-ecdsa-sha2-".length);
  return sshType;
}

/** Bits implied by a public key blob (reader positioned right after the type string). */
function bitsFromPublicKey(sshType: string, r: Reader): number | undefined {
  if (sshType === "ssh-rsa") {
    r.string(); // e
    const n = r.string(); // modulus
    return n ? bitLength(n) : undefined;
  }
  if (sshType === "ssh-ed25519" || sshType === "sk-ssh-ed25519@openssh.com") return 256;
  const m = /nistp(\d+)/.exec(sshType);
  if (m) return parseInt(m[1], 10);
  return undefined;
}

/**
 * Parse a `-----BEGIN OPENSSH PRIVATE KEY-----` body.
 * Layout: "openssh-key-v1\0" | cipher | kdf | kdfopts | nkeys | pubkey | privsection
 * The public key section is never encrypted, so the fingerprint is always readable.
 */
async function parseOpenSshKey(body: Uint8Array): Promise<SshKeyInfo> {
  const MAGIC = "openssh-key-v1\0";
  if (asText(body.subarray(0, MAGIC.length)) !== MAGIC) return { type: "OpenSSH", problem: "malformed" };

  const r = new Reader(body, MAGIC.length);
  const cipher = r.string();
  r.string(); // kdfname
  r.string(); // kdfoptions
  if (!cipher || r.remaining < 4) return { type: "OpenSSH", problem: "malformed" };
  r.off += 4; // number of keys
  const pub = r.string();
  if (!pub) return { type: "OpenSSH", problem: "malformed" };

  const pubReader = new Reader(pub);
  const typeBlob = pubReader.string();
  if (!typeBlob) return { type: "OpenSSH", problem: "malformed" };
  const sshType = asText(typeBlob);

  const info: SshKeyInfo = {
    type: prettyType(sshType),
    bits: bitsFromPublicKey(sshType, pubReader),
    fingerprint: (await sha256Fingerprint(pub)) ?? undefined,
    encrypted: asText(cipher) !== "none",
  };
  if (!info.fingerprint) info.problem = "no-crypto";

  // The comment is the last string of the private section, which is only
  // readable when the key is not passphrase-protected.
  if (!info.encrypted) {
    const priv = r.string();
    if (priv && priv.length > 8) {
      const pr = new Reader(priv, 8); // skip the two check ints
      let last: Uint8Array | null = null;
      for (;;) {
        const s = pr.string();
        if (!s) break;
        last = s;
      }
      if (last && last.length > 0 && last.length < 256) {
        const text = asText(last);
        // eslint-disable-next-line no-control-regex
        if (!/[\x00-\x08\x0e-\x1f]/.test(text)) info.comment = text;
      }
    }
  }
  return info;
}

/** Minimal DER reader for the few INTEGERs we need out of a PKCS#1 RSA key. */
function derInteger(buf: Uint8Array, off: number): { value: Uint8Array; next: number } | null {
  if (off + 2 > buf.length || buf[off] !== 0x02) return null;
  let len = buf[off + 1];
  let start = off + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4 || start + n > buf.length) return null;
    len = 0;
    for (let i = 0; i < n; i++) len = (len << 8) | buf[start + i];
    start += n;
  }
  if (start + len > buf.length) return null;
  return { value: buf.subarray(start, start + len), next: start + len };
}

/**
 * Parse a PKCS#1 `-----BEGIN RSA PRIVATE KEY-----` body:
 * SEQUENCE { version, modulus n, publicExponent e, privateExponent, … }
 * DER INTEGER content uses the same encoding as an SSH mpint, so the bytes
 * can be spliced straight into the "ssh-rsa" public key blob.
 */
async function parsePkcs1Rsa(body: Uint8Array): Promise<SshKeyInfo> {
  if (body[0] !== 0x30) return { type: "RSA", problem: "malformed" };
  let off = 1;
  let len = body[off++];
  if (len & 0x80) off += len & 0x7f; // skip the long-form length bytes

  const version = derInteger(body, off);
  if (!version) return { type: "RSA", problem: "malformed" };
  const n = derInteger(body, version.next);
  if (!n) return { type: "RSA", problem: "malformed" };
  const e = derInteger(body, n.next);
  if (!e) return { type: "RSA", problem: "malformed" };

  const typeBytes = new TextEncoder().encode("ssh-rsa");
  const blob = new Uint8Array(4 + typeBytes.length + 4 + e.value.length + 4 + n.value.length);
  const view = new DataView(blob.buffer);
  let p = 0;
  for (const part of [typeBytes, e.value, n.value]) {
    view.setUint32(p, part.length);
    blob.set(part, p + 4);
    p += 4 + part.length;
  }

  const fingerprint = await sha256Fingerprint(blob);
  return {
    type: "RSA",
    bits: bitLength(n.value),
    fingerprint: fingerprint ?? undefined,
    problem: fingerprint ? undefined : "no-crypto",
  };
}

/**
 * Describe the private key pasted or loaded into the form.
 * Returns null for empty input; never throws.
 */
export async function describeSshKey(keyContent: string): Promise<SshKeyInfo | null> {
  const trimmed = keyContent.trim();
  if (!trimmed) return null;

  try {
    if (trimmed.startsWith("PuTTY-User-Key-File-")) return { type: "PuTTY .ppk", problem: "ppk" };

    const m = PEM_RE.exec(trimmed.replace(/\r\n/g, "\n"));
    if (!m) return { type: "?", problem: "not-a-private-key" };

    const label = m[1];
    const rawBody = m[2];
    // Classic PEM encryption headers (`Proc-Type: 4,ENCRYPTED`) precede the base64.
    const encryptedPem = /^\s*Proc-Type:\s*4,ENCRYPTED/m.test(rawBody);
    const base64 = rawBody
      .split("\n")
      .filter((line) => !line.includes(":") && line.trim() !== "")
      .join("");

    if (label === "OPENSSH PRIVATE KEY") return await parseOpenSshKey(b64decode(base64));

    if (label === "RSA PRIVATE KEY") {
      if (encryptedPem) return { type: "RSA", encrypted: true, problem: "unsupported" };
      return await parsePkcs1Rsa(b64decode(base64));
    }

    if (!label.includes("PRIVATE KEY")) return { type: label, problem: "not-a-private-key" };

    // EC/DSA SEC1 and PKCS#8 keys: name the format, but no fingerprint.
    return { type: label.replace(" PRIVATE KEY", ""), encrypted: encryptedPem, problem: "unsupported" };
  } catch {
    return { type: "?", problem: "malformed" };
  }
}
