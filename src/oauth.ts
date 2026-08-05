import { decryptSecret, encryptSecret, randomBase64Url, sha256Base64Url } from "./crypto.js";
import { Database } from "./db.js";
import type { AppConfig, Env, OAuthToken } from "./types.js";
import { AppError } from "./types.js";
import { isRecord, stringValue } from "./utils.js";

interface ClientRegistration {
  clientId: string;
  redirectUri: string;
}

function oauthUrl(base: string, path: string): string {
  return new URL(path, `${base}/`).toString();
}

async function ensureClientRegistration(
  db: Database,
  config: AppConfig,
  redirectUri: string
): Promise<ClientRegistration> {
  const saved = await db.getSetting("oauth_client_registration");
  if (saved) {
    try {
      const parsed = JSON.parse(saved) as unknown;
      if (isRecord(parsed) && parsed.redirectUri === redirectUri && typeof parsed.clientId === "string") {
        return { clientId: parsed.clientId, redirectUri };
      }
    } catch {
      // Replace malformed registration state below.
    }
  }

  const response = await fetch(oauthUrl(config.swiggyOauthBaseUrl, "/auth/register"), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_name: "NOICE Deal Monitor",
      client_uri: config.publicBaseUrl,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none"
    })
  });
  if (!response.ok) {
    throw new AppError("OAUTH_REGISTRATION_FAILED", `Swiggy client registration failed (${response.status})`, 502);
  }
  const payload = (await response.json()) as unknown;
  if (!isRecord(payload)) throw new AppError("OAUTH_REGISTRATION_FAILED", "Invalid registration response", 502);
  const clientId = stringValue(payload.client_id);
  if (!clientId) throw new AppError("OAUTH_REGISTRATION_FAILED", "Registration response has no client_id", 502);
  const registration = { clientId, redirectUri };
  await db.setSetting("oauth_client_registration", JSON.stringify(registration));
  return registration;
}

export async function createAuthorizationUrl(db: Database, config: AppConfig): Promise<string> {
  const redirectUri = `${config.publicBaseUrl}/auth/callback`;
  const registration = await ensureClientRegistration(db, config, redirectUri);
  const state = randomBase64Url(24);
  const verifier = randomBase64Url(48);
  const challenge = await sha256Base64Url(verifier);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await db.saveOauthAttempt(state, verifier, redirectUri, expiresAt);

  const url = new URL(oauthUrl(config.swiggyOauthBaseUrl, "/auth/authorize"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", registration.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("scope", "mcp:tools");
  return url.toString();
}

export async function finishAuthorization(
  db: Database,
  config: AppConfig,
  env: Pick<Env, "TOKEN_ENCRYPTION_KEY">,
  code: string,
  state: string
): Promise<void> {
  const attempt = await db.consumeOauthAttempt(state, new Date().toISOString());
  if (!attempt) throw new AppError("OAUTH_STATE_INVALID", "Authorization state is invalid or expired", 400);

  const response = await fetch(oauthUrl(config.swiggyOauthBaseUrl, "/auth/token"), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      code_verifier: attempt.code_verifier,
      redirect_uri: attempt.redirect_uri
    })
  });
  if (!response.ok) {
    throw new AppError("OAUTH_TOKEN_FAILED", `Swiggy token exchange failed (${response.status})`, 502);
  }
  const payload = (await response.json()) as unknown;
  if (!isRecord(payload)) throw new AppError("OAUTH_TOKEN_FAILED", "Invalid token response", 502);
  const accessToken = stringValue(payload.access_token);
  const expiresIn = Number(payload.expires_in);
  if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new AppError("OAUTH_TOKEN_FAILED", "Token response is missing required fields", 502);
  }
  const encrypted = await encryptSecret(accessToken, env.TOKEN_ENCRYPTION_KEY);
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  await db.saveEncryptedToken(encrypted, expiresAt, stringValue(payload.scope));
  await db.deleteSetting("mcp_session_id");
  await db.deleteNotificationState("auth_required");
}

export async function loadValidToken(
  db: Database,
  env: Pick<Env, "TOKEN_ENCRYPTION_KEY">,
  now = new Date()
): Promise<OAuthToken> {
  const row = await db.getEncryptedToken();
  if (!row) throw new AppError("AUTH_REQUIRED", "Swiggy authorization has not been completed", 401);
  if (Date.parse(row.expires_at) <= now.getTime() + 60_000) {
    throw new AppError("AUTH_REQUIRED", "Swiggy authorization has expired", 401);
  }
  return {
    accessToken: await decryptSecret(row.encrypted_access_token, env.TOKEN_ENCRYPTION_KEY),
    expiresAt: row.expires_at,
    scope: row.scope ?? undefined
  };
}

export async function getTokenStatus(db: Database): Promise<{ configured: boolean; expiresAt?: string; valid: boolean }> {
  const row = await db.getEncryptedToken();
  if (!row) return { configured: false, valid: false };
  return { configured: true, expiresAt: row.expires_at, valid: Date.parse(row.expires_at) > Date.now() + 60_000 };
}
