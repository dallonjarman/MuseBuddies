// Passphrase-encrypted backup of the whole client store (identity, keys, contacts, history).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const FORMAT = "musebuddies-backup";
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

interface BackupFile {
  format: typeof FORMAT;
  version: 1;
  createdAt: string;
  kdf: { name: "scrypt"; N: number; r: number; p: number; salt: string };
  nonce: string;
  ciphertext: string;
}

function deriveKey(passphrase: string, salt: Buffer, params: { N: number; r: number; p: number }): Buffer {
  return crypto.scryptSync(passphrase.normalize("NFKC"), salt, 32, { ...params, maxmem: SCRYPT.maxmem });
}

const header = (createdAt: string): Buffer => Buffer.from(`${FORMAT}/1/${createdAt}`, "utf8");

export function checkPassphrase(passphrase: string | undefined): string {
  if (!passphrase || passphrase.length < 12) throw new Error("A backup passphrase of at least 12 characters is required");
  return passphrase;
}

export function encryptBackup(dbBytes: Buffer, passphrase: string): string {
  const createdAt = new Date().toISOString();
  const salt = crypto.randomBytes(16);
  const nonce = crypto.randomBytes(12);
  const key = deriveKey(passphrase, salt, SCRYPT);
  const cipher = crypto.createCipheriv("chacha20-poly1305", key, nonce, { authTagLength: 16 });
  const plaintext = zlib.gzipSync(dbBytes);
  cipher.setAAD(header(createdAt), { plaintextLength: plaintext.length });
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  const file: BackupFile = {
    format: FORMAT,
    version: 1,
    createdAt,
    kdf: { name: "scrypt", N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, salt: salt.toString("base64") },
    nonce: nonce.toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
  return JSON.stringify(file, null, 2) + "\n";
}

export function decryptBackup(contents: string, passphrase: string): { dbBytes: Buffer; createdAt: string } {
  let file: BackupFile;
  try {
    file = JSON.parse(contents) as BackupFile;
  } catch {
    throw new Error("Not a MuseBuddies backup file");
  }
  if (file.format !== FORMAT || file.version !== 1 || file.kdf?.name !== "scrypt") throw new Error("Unsupported backup format");
  const { N, r, p } = file.kdf;
  if (![N, r, p].every(Number.isInteger) || N > 1 << 20 || r > 32 || p > 16) throw new Error("Backup KDF parameters out of range");
  const key = deriveKey(passphrase, Buffer.from(file.kdf.salt, "base64"), { N, r, p });
  const data = Buffer.from(file.ciphertext, "base64");
  const decipher = crypto.createDecipheriv("chacha20-poly1305", key, Buffer.from(file.nonce, "base64"), { authTagLength: 16 });
  const body = data.subarray(0, data.length - 16);
  decipher.setAAD(header(file.createdAt), { plaintextLength: body.length });
  decipher.setAuthTag(data.subarray(data.length - 16));
  let plaintext: Buffer;
  try {
    plaintext = Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new Error("Wrong passphrase or corrupted backup");
  }
  return { dbBytes: zlib.gunzipSync(plaintext), createdAt: file.createdAt };
}

export function writePrivateFile(file: string, contents: string | Buffer): void {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, contents, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}
