import { AppError } from "./types.js";

function decodeBase64(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  try {
    return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
  } catch {
    throw new AppError("CONFIG_INVALID", "TOKEN_ENCRYPTION_KEY is not valid base64");
  }
}

function encodeBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importEncryptionKey(encodedKey: string): Promise<CryptoKey> {
  const raw = decodeBase64(encodedKey);
  if (raw.byteLength !== 32) {
    throw new AppError("CONFIG_INVALID", "TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  return crypto.subtle.importKey("raw", new Uint8Array(raw).buffer, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plaintext: string, encodedKey: string): Promise<string> {
  const key = await importEncryptionKey(encodedKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  return `${encodeBase64(iv)}.${encodeBase64(new Uint8Array(ciphertext))}`;
}

export async function decryptSecret(payload: string, encodedKey: string): Promise<string> {
  const [encodedIv, encodedCiphertext, extra] = payload.split(".");
  if (!encodedIv || !encodedCiphertext || extra) {
    throw new AppError("TOKEN_INVALID", "Stored token has an invalid encrypted format");
  }
  try {
    const key = await importEncryptionKey(encodedKey);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(decodeBase64(encodedIv)).buffer },
      key,
      new Uint8Array(decodeBase64(encodedCiphertext)).buffer
    );
    return new TextDecoder().decode(plaintext);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("TOKEN_DECRYPT_FAILED", "Stored Swiggy token could not be decrypted");
  }
}

export function randomBase64Url(byteLength = 32): string {
  return encodeBase64(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return encodeBase64(new Uint8Array(digest));
}
