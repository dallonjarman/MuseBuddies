// Noise_XXpsk3_25519_ChaChaPoly_SHA256, wire-compatible with the MuseTogether v1 protocol.
//
//   -> e
//   <- e, ee, s, es
//   -> s, se, psk
//
// The accepter of an invitation is the Noise initiator; the inviter is the responder.
// The 32-byte PSK travels out of band in the invitation URL fragment.
import crypto from "node:crypto";

export const PROTOCOL_NAME = "Noise_XXpsk3_25519_ChaChaPoly_SHA256";
export const PROLOGUE = Buffer.from("musetogether/v1", "utf8");
const DH_LEN = 32;
const TAG_LEN = 16;
const EMPTY = Buffer.alloc(0);

export interface KeyPair {
  pub: Buffer;
  priv: Buffer;
}

export function generateKeyPair(): KeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");
  const x = publicKey.export({ format: "jwk" }).x;
  const d = privateKey.export({ format: "jwk" }).d;
  if (!x || !d) throw new Error("Failed to export X25519 key");
  return { pub: Buffer.from(x, "base64url"), priv: Buffer.from(d, "base64url") };
}

export function dh(priv: Buffer, pub: Buffer): Buffer {
  if (pub.length !== DH_LEN) throw new Error("Invalid X25519 public key length");
  // DER prefixes for raw X25519 keys (PKCS#8 private, SPKI public).
  const privateKey = crypto.createPrivateKey({
    key: Buffer.concat([Buffer.from("302e020100300506032b656e04220420", "hex"), priv]),
    format: "der",
    type: "pkcs8"
  });
  const publicKey = crypto.createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b656e032100", "hex"), pub]),
    format: "der",
    type: "spki"
  });
  return crypto.diffieHellman({ privateKey, publicKey });
}

function nonceBytes(n: bigint): Buffer {
  const nonce = Buffer.alloc(12);
  nonce.writeBigUInt64LE(n, 4);
  return nonce;
}

export function encrypt(key: Buffer, n: bigint, ad: Buffer, plaintext: Buffer): Buffer {
  const cipher = crypto.createCipheriv("chacha20-poly1305", key, nonceBytes(n), { authTagLength: TAG_LEN });
  cipher.setAAD(ad, { plaintextLength: plaintext.length });
  return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}

export function decrypt(key: Buffer, n: bigint, ad: Buffer, data: Buffer): Buffer {
  if (data.length < TAG_LEN) throw new Error("Ciphertext too short");
  const ct = data.subarray(0, data.length - TAG_LEN);
  const decipher = crypto.createDecipheriv("chacha20-poly1305", key, nonceBytes(n), { authTagLength: TAG_LEN });
  decipher.setAAD(ad, { plaintextLength: ct.length });
  decipher.setAuthTag(data.subarray(data.length - TAG_LEN));
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

function hkdf(ck: Buffer, ikm: Buffer, outputs: 2 | 3): Buffer[] {
  const out = Buffer.from(crypto.hkdfSync("sha256", ikm, ck, EMPTY, 32 * outputs));
  return Array.from({ length: outputs }, (_, i) => out.subarray(i * 32, (i + 1) * 32));
}

const sha256 = (data: Buffer): Buffer => crypto.createHash("sha256").update(data).digest();

export interface SymmetricSnapshot {
  h: string;
  ck: string;
  k: string | null;
  n: string;
}

export class SymmetricState {
  h: Buffer;
  ck: Buffer;
  k: Buffer | null = null;
  n = 0n;

  constructor() {
    const name = Buffer.from(PROTOCOL_NAME, "utf8");
    this.h = name.length <= 32 ? Buffer.concat([name, Buffer.alloc(32 - name.length)]) : sha256(name);
    this.ck = Buffer.from(this.h);
    this.mixHash(PROLOGUE);
  }

  mixHash(data: Buffer): void {
    this.h = sha256(Buffer.concat([this.h, data]));
  }

  mixKey(ikm: Buffer): void {
    [this.ck, this.k] = hkdf(this.ck, ikm, 2);
    this.n = 0n;
  }

  mixKeyAndHash(ikm: Buffer): void {
    const [ck, th, k] = hkdf(this.ck, ikm, 3);
    this.ck = ck;
    this.mixHash(th);
    this.k = k;
    this.n = 0n;
  }

  encryptAndHash(pt: Buffer): Buffer {
    const ct = this.k ? encrypt(this.k, this.n++, this.h, pt) : pt;
    this.mixHash(ct);
    return ct;
  }

  decryptAndHash(ct: Buffer): Buffer {
    const pt = this.k ? decrypt(this.k, this.n++, this.h, ct) : ct;
    this.mixHash(ct);
    return pt;
  }

  split(): [Buffer, Buffer] {
    const [k1, k2] = hkdf(this.ck, EMPTY, 2);
    return [k1, k2];
  }

  snapshot(): SymmetricSnapshot {
    return { h: this.h.toString("base64url"), ck: this.ck.toString("base64url"), k: this.k?.toString("base64url") ?? null, n: this.n.toString() };
  }

  static restore(s: SymmetricSnapshot): SymmetricState {
    const st = new SymmetricState();
    st.h = Buffer.from(s.h, "base64url");
    st.ck = Buffer.from(s.ck, "base64url");
    st.k = s.k === null ? null : Buffer.from(s.k, "base64url");
    st.n = BigInt(s.n);
    return st;
  }
}

const b64 = (b: Buffer): string => b.toString("base64url");
const unb64 = (s: string): Buffer => Buffer.from(s, "base64url");

export interface TransportKeys {
  sendKey: Buffer;
  receiveKey: Buffer;
  peerStatic: Buffer;
}

// ---- Initiator (invitation accepter) ----

export interface InitiatorState {
  e: { pub: string; priv: string };
  sym: SymmetricSnapshot;
}

export function initiatorWriteMessage1(): { message: Buffer; state: InitiatorState } {
  const e = generateKeyPair();
  const sym = new SymmetricState();
  sym.mixHash(e.pub);
  const payload = sym.encryptAndHash(EMPTY);
  return { message: Buffer.concat([e.pub, payload]), state: { e: { pub: b64(e.pub), priv: b64(e.priv) }, sym: sym.snapshot() } };
}

export function initiatorReadMessage2WriteMessage3(
  state: InitiatorState,
  message2: Buffer,
  localStatic: KeyPair,
  psk: Buffer
): { message: Buffer; keys: TransportKeys } {
  if (message2.length < DH_LEN + DH_LEN + TAG_LEN + TAG_LEN) throw new Error("Handshake message 2 too short");
  const sym = SymmetricState.restore(state.sym);
  const ePriv = unb64(state.e.priv);
  const re = message2.subarray(0, DH_LEN);
  sym.mixHash(re);
  sym.mixKey(dh(ePriv, re));
  const rs = sym.decryptAndHash(message2.subarray(DH_LEN, DH_LEN * 2 + TAG_LEN));
  sym.mixKey(dh(ePriv, rs));
  sym.decryptAndHash(message2.subarray(DH_LEN * 2 + TAG_LEN));

  const encS = sym.encryptAndHash(localStatic.pub);
  sym.mixKey(dh(localStatic.priv, re));
  sym.mixKeyAndHash(psk);
  const payload = sym.encryptAndHash(EMPTY);
  const [k1, k2] = sym.split();
  return { message: Buffer.concat([encS, payload]), keys: { sendKey: k1, receiveKey: k2, peerStatic: rs } };
}

// ---- Responder (inviter) ----

export interface ResponderState {
  e: { pub: string; priv: string };
  sym: SymmetricSnapshot;
}

export function responderReadMessage1WriteMessage2(message1: Buffer, localStatic: KeyPair): { message: Buffer; state: ResponderState } {
  if (message1.length < DH_LEN) throw new Error("Handshake message 1 too short");
  const sym = new SymmetricState();
  const re = message1.subarray(0, DH_LEN);
  sym.mixHash(re);
  sym.decryptAndHash(message1.subarray(DH_LEN));

  const e = generateKeyPair();
  sym.mixHash(e.pub);
  sym.mixKey(dh(e.priv, re));
  const encS = sym.encryptAndHash(localStatic.pub);
  sym.mixKey(dh(localStatic.priv, re));
  const payload = sym.encryptAndHash(EMPTY);
  return { message: Buffer.concat([e.pub, encS, payload]), state: { e: { pub: b64(e.pub), priv: b64(e.priv) }, sym: sym.snapshot() } };
}

export function responderReadMessage3(state: ResponderState, message3: Buffer, psk: Buffer): TransportKeys {
  if (message3.length < DH_LEN + TAG_LEN + TAG_LEN) throw new Error("Handshake message 3 too short");
  const sym = SymmetricState.restore(state.sym);
  const rs = sym.decryptAndHash(message3.subarray(0, DH_LEN + TAG_LEN));
  sym.mixKey(dh(unb64(state.e.priv), rs));
  sym.mixKeyAndHash(psk);
  sym.decryptAndHash(message3.subarray(DH_LEN + TAG_LEN));
  const [k1, k2] = sym.split();
  return { sendKey: k2, receiveKey: k1, peerStatic: rs };
}
