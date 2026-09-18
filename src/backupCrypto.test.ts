import { describe, expect, it } from "vitest";
import { decryptBackup, encryptBackup, parseBackupEnvelope, validateNewPassword } from "./backupCrypto";

const snapshot = btoa("SQLite format 3\0sample ledger bytes");

describe("encrypted HomeLedger backups", () => {
  it("round-trips an encrypted snapshot with authenticated metadata", async () => {
    const encrypted = await encryptBackup(snapshot, "correct horse battery staple", { createdAt: new Date("2026-09-18T12:00:00Z"), iterations: 100_000 });
    expect(parseBackupEnvelope(encrypted)).toMatchObject({ format: "homeledger-encrypted-backup", version: 1, createdAt: "2026-09-18T12:00:00.000Z" });
    expect(await decryptBackup(encrypted, "correct horse battery staple")).toBe(snapshot);
  });

  it("rejects an incorrect password and authenticated-metadata tampering", async () => {
    const encrypted = await encryptBackup(snapshot, "correct horse battery staple", { iterations: 100_000 });
    await expect(decryptBackup(encrypted, "this password is wrong")).rejects.toThrow(/incorrect|altered/);
    const changed = JSON.parse(encrypted); changed.appVersion = "9.9.9";
    await expect(decryptBackup(JSON.stringify(changed), "correct horse battery staple")).rejects.toThrow(/incorrect|altered/);
  });

  it("rejects weak passwords and malformed envelopes", () => {
    expect(() => validateNewPassword("too-short")).toThrow(/12 characters/);
    expect(() => parseBackupEnvelope("not json")).toThrow(/valid HomeLedger/);
  });
});
