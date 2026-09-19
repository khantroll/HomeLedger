export const BACKUP_FORMAT = "homeledger-encrypted-backup";
export const BACKUP_VERSION = 1;
export const DEFAULT_PBKDF2_ITERATIONS = 600_000;

export interface EncryptedBackupEnvelope {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  createdAt: string;
  appVersion: string;
  kdf: { name: "PBKDF2-SHA256"; iterations: number; salt: string };
  cipher: { name: "AES-256-GCM"; iv: string };
  ciphertext: string;
}

export async function encryptBackup(
  snapshotBase64: string,
  password: string,
  options: { createdAt?: Date; iterations?: number; appVersion?: string } = {}
): Promise<string> {
  validateNewPassword(password);
  const iterations = options.iterations ?? DEFAULT_PBKDF2_ITERATIONS;
  validateIterations(iterations);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const envelope: EncryptedBackupEnvelope = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: (options.createdAt ?? new Date()).toISOString(),
    appVersion: options.appVersion ?? "0.16.0",
    kdf: { name: "PBKDF2-SHA256", iterations, salt: bytesToBase64(salt) },
    cipher: { name: "AES-256-GCM", iv: bytesToBase64(iv) },
    ciphertext: ""
  };
  const key = await deriveKey(password, salt, iterations, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: metadataBytes(envelope), tagLength: 128 },
    key,
    base64ToBytes(snapshotBase64)
  );
  envelope.ciphertext = bytesToBase64(new Uint8Array(encrypted));
  return JSON.stringify(envelope);
}

export async function decryptBackup(contents: string, password: string): Promise<string> {
  if (!password) throw new Error("Enter the backup password");
  const envelope = parseBackupEnvelope(contents);
  try {
    const salt = base64ToBytes(envelope.kdf.salt);
    const iv = base64ToBytes(envelope.cipher.iv);
    const key = await deriveKey(password, salt, envelope.kdf.iterations, ["decrypt"]);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: metadataBytes(envelope), tagLength: 128 },
      key,
      base64ToBytes(envelope.ciphertext)
    );
    return bytesToBase64(new Uint8Array(decrypted));
  } catch {
    throw new Error("The password is incorrect or the backup has been altered");
  }
}

export function parseBackupEnvelope(contents: string): EncryptedBackupEnvelope {
  let value: unknown;
  try { value = JSON.parse(contents); }
  catch { throw new Error("This is not a valid HomeLedger backup file"); }
  if (!value || typeof value !== "object") throw new Error("This is not a valid HomeLedger backup file");
  const envelope = value as Partial<EncryptedBackupEnvelope>;
  if (envelope.format !== BACKUP_FORMAT || envelope.version !== BACKUP_VERSION) throw new Error("This backup format or version is not supported");
  if (typeof envelope.createdAt !== "string" || Number.isNaN(Date.parse(envelope.createdAt))) throw new Error("The backup creation date is invalid");
  if (typeof envelope.appVersion !== "string" || !envelope.appVersion) throw new Error("The backup application version is missing");
  if (envelope.kdf?.name !== "PBKDF2-SHA256" || typeof envelope.kdf.iterations !== "number") throw new Error("The backup key settings are invalid");
  validateIterations(envelope.kdf.iterations);
  if (!isBase64(envelope.kdf.salt) || base64ToBytes(envelope.kdf.salt).length !== 16) throw new Error("The backup salt is invalid");
  if (envelope.cipher?.name !== "AES-256-GCM" || !isBase64(envelope.cipher.iv) || base64ToBytes(envelope.cipher.iv).length !== 12) throw new Error("The backup cipher settings are invalid");
  if (!isBase64(envelope.ciphertext) || base64ToBytes(envelope.ciphertext).length < 17) throw new Error("The encrypted backup payload is invalid");
  return envelope as EncryptedBackupEnvelope;
}

export function validateNewPassword(password: string): void {
  if (password.length < 12) throw new Error("Use a backup password of at least 12 characters");
  if (password.length > 1024) throw new Error("The backup password is too long");
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number, usages: KeyUsage[]): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    usages
  );
}

function metadataBytes(envelope: EncryptedBackupEnvelope): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify({
    format: envelope.format,
    version: envelope.version,
    createdAt: envelope.createdAt,
    appVersion: envelope.appVersion,
    kdf: envelope.kdf,
    cipher: envelope.cipher
  }));
}

function validateIterations(iterations: number): void {
  if (!Number.isInteger(iterations) || iterations < 100_000 || iterations > 2_000_000) throw new Error("The backup key-derivation work factor is invalid");
}

function isBase64(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return false;
  try { atob(value); return true; } catch { return false; }
}

function bytesToBase64(bytes: Uint8Array<ArrayBufferLike>): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
