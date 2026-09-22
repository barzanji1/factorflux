import { eq } from "drizzle-orm";
import { db } from "../../db";
import { integrationSettings } from "@shared/schema";
import { decryptVault, encryptVault } from "../vaultCrypto";

const FMCSA_KEY_SETTING = "fmcsa_web_key";

function requireEncryptionSecret(): void {
  if (!process.env.VAULT_SECRET) {
    throw new Error("FMCSA key encryption is not configured");
  }
}

function isDecryptedKey(value: string): boolean {
  return value !== "***LEGACY***" && value !== "***DECRYPTION ERROR***" && value.length > 0;
}

export async function getConfiguredFmcsaWebKey(): Promise<string | null> {
  const [setting] = await db
    .select({ encryptedValue: integrationSettings.encryptedValue })
    .from(integrationSettings)
    .where(eq(integrationSettings.key, FMCSA_KEY_SETTING))
    .limit(1);

  if (setting) {
    requireEncryptionSecret();
    const decrypted = decryptVault(setting.encryptedValue);
    if (!isDecryptedKey(decrypted)) {
      throw new Error("The saved FMCSA Web Key could not be decrypted");
    }
    return decrypted;
  }

  return process.env.FMCSA_WEBKEY?.trim() || process.env.FMCSA_WEBKEY_KEY?.trim() || null;
}

export async function saveConfiguredFmcsaWebKey(webKey: string, userId: string): Promise<void> {
  requireEncryptionSecret();
  const normalized = webKey.trim();
  await db
    .insert(integrationSettings)
    .values({
      key: FMCSA_KEY_SETTING,
      encryptedValue: encryptVault(normalized),
      updatedBy: userId,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: integrationSettings.key,
      set: {
        encryptedValue: encryptVault(normalized),
        updatedBy: userId,
        updatedAt: new Date(),
      },
    });
}

export async function getFmcsaKeyStatus(): Promise<{
  configured: boolean;
  maskedKey: string | null;
  source: "database" | "environment" | null;
}> {
  const [setting] = await db
    .select({ encryptedValue: integrationSettings.encryptedValue })
    .from(integrationSettings)
    .where(eq(integrationSettings.key, FMCSA_KEY_SETTING))
    .limit(1);

  let key: string | null = null;
  let source: "database" | "environment" | null = null;
  if (setting) {
    requireEncryptionSecret();
    const decrypted = decryptVault(setting.encryptedValue);
    if (!isDecryptedKey(decrypted)) {
      throw new Error("The saved FMCSA Web Key could not be decrypted");
    }
    key = decrypted;
    source = "database";
  } else if (process.env.FMCSA_WEBKEY?.trim() || process.env.FMCSA_WEBKEY_KEY?.trim()) {
    key = process.env.FMCSA_WEBKEY?.trim() || process.env.FMCSA_WEBKEY_KEY?.trim() || null;
    source = "environment";
  }

  return {
    configured: !!key,
    maskedKey: key ? `••••••••${key.slice(-4)}` : null,
    source,
  };
}