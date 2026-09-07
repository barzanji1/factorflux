import crypto from "crypto";

function vaultKey(): Buffer {
  const secret = process.env.VAULT_SECRET || process.env.SESSION_SECRET || "vault-default-secret-key";
  return crypto.scryptSync(secret, "vault-salt-v1", 32);
}

export function encryptVault(plaintext: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", vaultKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptVault(encryptedText: string): string {
  try {
    const parts = encryptedText.split(":");
    if (parts.length !== 3) return "***LEGACY***";
    const [ivHex, authTagHex, encryptedHex] = parts;
    const decipher = crypto.createDecipheriv("aes-256-gcm", vaultKey(), Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    return decipher.update(Buffer.from(encryptedHex, "hex")) + decipher.final("utf8");
  } catch {
    return "***DECRYPTION ERROR***";
  }
}