import { assertRuntimeSecrets, getConfig } from "./config.js";
import { Database } from "./db.js";
import { SwiggyMcpClient } from "./mcp.js";
import { runMonitor, runWithDatabaseLock } from "./monitor.js";
import { NtfyNotifier, notifyAuthorizationRequiredOnce } from "./ntfy.js";
import { createAuthorizationUrl, finishAuthorization, getTokenStatus, loadValidToken } from "./oauth.js";
import type { AppConfig, Env, RunSource, SavedAddress } from "./types.js";
import { AppError } from "./types.js";
import { escapeHtml, redactError } from "./utils.js";

const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "cache-control": "no-store"
};

function json(payload: unknown, status = 200): Response {
  return Response.json(payload, { status, headers: SECURITY_HEADERS });
}

function html(content: string, status = 200): Response {
  return new Response(content, {
    status,
    headers: { ...SECURITY_HEADERS, "content-type": "text/html; charset=utf-8" }
  });
}

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { ...SECURITY_HEADERS, location } });
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function secureEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([digest(left), digest(right)]);
  if (leftHash.length !== rightHash.length) return false;
  let different = 0;
  for (let index = 0; index < leftHash.length; index += 1) {
    different |= (leftHash[index] ?? 0) ^ (rightHash[index] ?? 0);
  }
  return different === 0;
}

async function isAdmin(request: Request, env: Env): Promise<boolean> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Basic ")) return false;
  try {
    const decoded = atob(authorization.slice(6));
    const separator = decoded.indexOf(":");
    if (separator < 0) return false;
    const username = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);
    const [usernameMatches, passwordMatches] = await Promise.all([
      secureEqual(username, env.ADMIN_USERNAME),
      secureEqual(password, env.ADMIN_PASSWORD)
    ]);
    return usernameMatches && passwordMatches;
  } catch {
    return false;
  }
}

function unauthorized(): Response {
  return new Response("Authentication required", {
    status: 401,
    headers: { ...SECURITY_HEADERS, "www-authenticate": 'Basic realm="NOICE Deal Monitor", charset="UTF-8"' }
  });
}

function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new AppError("ORIGIN_REJECTED", "Cross-origin form submission rejected", 403);
  }
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root{color-scheme:light dark;font-family:system-ui,sans-serif}body{max-width:760px;margin:3rem auto;padding:0 1rem;line-height:1.5}
    main{border:1px solid #8885;border-radius:14px;padding:1.5rem}dl{display:grid;grid-template-columns:max-content 1fr;gap:.5rem 1rem}
    dt{font-weight:700}dd{margin:0}.actions{display:flex;gap:.75rem;flex-wrap:wrap;margin:1.5rem 0}a,button{font:inherit}
    a.button,button{display:inline-block;padding:.65rem 1rem;border:0;border-radius:8px;background:#f36c21;color:#fff;text-decoration:none;cursor:pointer}
    .muted{opacity:.7}.good{color:#198754}.bad{color:#dc3545}fieldset{margin:1rem 0;padding:1rem;border-radius:8px}label{display:block;margin:.6rem 0}
    code{overflow-wrap:anywhere}
  </style>
</head>
<body><main><h1>${escapeHtml(title)}</h1>${body}</main></body>
</html>`;
}

async function executeMonitor(env: Env, source: RunSource) {
  assertRuntimeSecrets(env);
  const config = getConfig(env);
  const db = new Database(env.DB);
  const addressId = await db.getSetting("selected_address_id");
  if (!addressId) throw new AppError("ADDRESS_REQUIRED", "Choose a saved Swiggy address before checking", 409);
  const token = await loadValidToken(db, env);
  const catalog = new SwiggyMcpClient(db, config, token.accessToken);
  const notifier = new NtfyNotifier(env, config);
  return runWithDatabaseLock(db, async () => {
    const result = await runMonitor({ catalog, store: db, notifier }, addressId, source);
    await db.cleanupOldData(new Date());
    return result;
  });
}

async function renderStatus(env: Env, config: AppConfig, db: Database): Promise<Response> {
  const [token, addressId, latestRun, stats] = await Promise.all([
    getTokenStatus(db),
    db.getSetting("selected_address_id"),
    db.getLatestRun(),
    db.getProductStats()
  ]);
  const authClass = token.valid ? "good" : "bad";
  const runDetails = latestRun
    ? `${escapeHtml(latestRun.status)} at ${escapeHtml(latestRun.finished_at ?? latestRun.started_at)} (${latestRun.variant_count} variants, ${latestRun.alert_count} alerts)${latestRun.error_message ? ` — ${escapeHtml(latestRun.error_message)}` : ""}`
    : "No checks have run yet";
  const addressLabel = addressId ? `Selected (…${escapeHtml(addressId.slice(-6))})` : "Not selected";
  const tokenLabel = token.configured
    ? `${token.valid ? "Valid" : "Expired"}${token.expiresAt ? ` until ${escapeHtml(token.expiresAt)}` : ""}`
    : "Not authorized";

  return html(
    page(
      "NOICE Deal Monitor",
      `<p>Checks Instamart every five minutes and alerts when a variant costs ≤ ₹${config.maxPrice} or is ≥ ${config.minDiscountPct}% off.</p>
     <dl>
       <dt>Swiggy</dt><dd class="${authClass}">${tokenLabel}</dd>
       <dt>Address</dt><dd>${addressLabel}</dd>
       <dt>Tracked</dt><dd>${stats.tracked} variants (${stats.activeDeals} active deals)</dd>
       <dt>Last run</dt><dd>${runDetails}</dd>
     </dl>
     <div class="actions">
       <a class="button" href="/auth/start">Authorize Swiggy</a>
       ${token.valid ? '<a class="button" href="/admin/addresses">Choose address</a>' : ""}
       ${addressId && token.valid ? '<form method="post" action="/admin/check"><button type="submit">Check now</button></form>' : ""}
     </div>
       <p class="muted">The page stores only an opaque Swiggy address ID. OAuth tokens are encrypted before D1 storage.</p>`
    )
  );
}

function renderAddressSelection(addresses: SavedAddress[], selected?: string): Response {
  if (addresses.length === 0) {
    return html(page(
      "Choose delivery address",
      '<p>No saved Swiggy addresses were returned. Add an address in Swiggy, then reload this page.</p><p><a href="/">Back</a></p>'
    ));
  }
  const options = addresses
    .map(
      address =>
        `<label><input type="radio" name="addressId" value="${escapeHtml(address.id)}" ${address.id === selected ? "checked" : ""} required> ${escapeHtml(address.label)}</label>`
    )
    .join("");
  return html(page(
    "Choose delivery address",
    `<form method="post" action="/admin/address"><fieldset><legend>Saved Swiggy addresses</legend>${options}</fieldset><button type="submit">Use this address</button></form><p><a href="/">Back</a></p>`
  ));
}

async function handleAdminRequest(request: Request, env: Env, config: AppConfig, db: Database): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/" && request.method === "GET") return renderStatus(env, config, db);

  if (url.pathname === "/auth/start" && request.method === "GET") {
    return redirect(await createAuthorizationUrl(db, config));
  }

  if (url.pathname === "/admin/addresses" && request.method === "GET") {
    const token = await loadValidToken(db, env);
    const addresses = await new SwiggyMcpClient(db, config, token.accessToken).getAddresses();
    return renderAddressSelection(addresses, await db.getSetting("selected_address_id"));
  }

  if (url.pathname === "/admin/address" && request.method === "POST") {
    assertSameOrigin(request);
    const form = await request.formData();
    const addressId = form.get("addressId");
    if (typeof addressId !== "string" || !addressId.trim() || addressId.length > 256) {
      throw new AppError("ADDRESS_INVALID", "Choose a valid saved address", 400);
    }
    const token = await loadValidToken(db, env);
    const addresses = await new SwiggyMcpClient(db, config, token.accessToken).getAddresses();
    if (!addresses.some(address => address.id === addressId)) {
      throw new AppError("ADDRESS_INVALID", "The selected address was not returned by Swiggy", 400);
    }
    await db.setSetting("selected_address_id", addressId);
    return redirect("/");
  }

  if (url.pathname === "/admin/check" && request.method === "POST") {
    assertSameOrigin(request);
    const result = await executeMonitor(env, "manual");
    if (request.headers.get("accept")?.includes("application/json")) return json(result);
    return redirect("/");
  }

  return json({ error: "not_found" }, 404);
}

async function handleFetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/healthz" && request.method === "GET") {
    return json({ ok: true, service: "noice-deal-monitor" });
  }

  assertRuntimeSecrets(env);
  const config = getConfig(env);
  const db = new Database(env.DB);

  if (url.pathname === "/auth/callback" && request.method === "GET") {
    const oauthError = url.searchParams.get("error");
    if (oauthError) throw new AppError("OAUTH_DENIED", `Swiggy authorization failed: ${oauthError}`, 400);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) throw new AppError("OAUTH_CALLBACK_INVALID", "OAuth callback is missing code or state", 400);
    await finishAuthorization(db, config, env, code, state);
    return redirect("/admin/addresses");
  }

  if (!(await isAdmin(request, env))) return unauthorized();
  return handleAdminRequest(request, env, config, db);
}

async function handleScheduled(env: Env): Promise<void> {
  const db = new Database(env.DB);
  try {
    await executeMonitor(env, "cron");
  } catch (error) {
    const appError = error instanceof AppError ? error : new AppError("MONITOR_FAILED", redactError(error));
    console.error(JSON.stringify({ event: "scheduled_check_failed", code: appError.code, error: redactError(appError) }));
    if (appError.code === "AUTH_REQUIRED") {
      try {
        assertRuntimeSecrets(env);
        await notifyAuthorizationRequiredOnce(db, new NtfyNotifier(env, getConfig(env)), appError.message);
      } catch (notificationError) {
        console.error(JSON.stringify({ event: "auth_notice_failed", error: redactError(notificationError) }));
      }
    }
    throw appError;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleFetch(request, env);
    } catch (error) {
      const appError = error instanceof AppError ? error : new AppError("INTERNAL_ERROR", redactError(error));
      console.error(JSON.stringify({ event: "request_failed", code: appError.code, error: redactError(appError) }));
      const wantsJson = request.headers.get("accept")?.includes("application/json");
      if (wantsJson) return json({ error: appError.code, message: appError.message }, appError.status);
      return html(page("Request failed", `<p>${escapeHtml(appError.message)}</p><p><a href="/">Back</a></p>`), appError.status);
    }
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleScheduled(env));
  }
} satisfies ExportedHandler<Env>;
