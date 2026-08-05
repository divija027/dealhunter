# NOICE Deal Monitor

A personal, location-aware Swiggy Instamart monitor deployed on Cloudflare Workers. It searches the official Swiggy Instamart MCP catalog for **NOICE** every five minutes and sends an [ntfy](https://ntfy.sh/) push when an in-stock variant:

- costs **₹25 or less**, or
- is **70% off or more**, calculated from selling price and MRP.

It alerts once when a variant enters the deal state. The same variant can alert again only after a successful check sees it leave the deal state or become unavailable and a later check sees it qualify again.

## Architecture

- Cloudflare Worker Cron Trigger: runs every five minutes.
- Swiggy Builders Club Instamart MCP: official address-aware catalog search.
- D1: selected opaque address ID, product state, 30-day price observations, runs, and alert deduplication.
- AES-GCM: encrypts the Swiggy access token before it is stored in D1.
- ntfy: sends deal and reauthorization notifications.
- Protected status page: Swiggy OAuth, saved-address selection, and manual checks.

This implementation does **not** scrape Telegram, run a browser, call Gemini, or place orders.

## External prerequisite: Swiggy access

Swiggy Builders Club production access is reviewed. Build and test using its local stub/staging flow, then apply with a short demo that clearly describes the personal five-minute background monitor. The Worker does not fall back to scraping when production access is unavailable.

Relevant official documentation:

- [Developer quickstart](https://mcp.swiggy.com/builders/docs/start/developer/)
- [`search_products`](https://mcp.swiggy.com/builders/docs/reference/instamart/search_products/)
- [OAuth](https://mcp.swiggy.com/builders/docs/start/authenticate/)
- [Access and onboarding](https://mcp.swiggy.com/builders/docs/operate/access/)

Swiggy access tokens currently expire after five days and v1 does not issue refresh tokens. The monitor sends one ntfy reauthorization notification, pauses checks, and resumes after you authorize again.

## Setup

Prerequisites:

- Node.js 22+
- A Cloudflare account with Workers enabled
- A saved delivery address in your Swiggy account
- An ntfy app subscription to a long, random topic name

Cloudflare website Pro and Workers Paid are separate subscriptions. Workers Paid is recommended for its scheduled CPU allowance.

### 1. Install and authenticate

```bash
npm install
npx wrangler login
```

### 2. Create D1

```bash
npx wrangler d1 create dealhunter-noice
```

Copy the returned database ID into `wrangler.jsonc`, replacing `REPLACE_WITH_D1_DATABASE_ID`, then apply the migration:

```bash
npm run db:migrate:remote
```

For local D1 instead:

```bash
npm run db:migrate:local
```

### 3. Configure secrets

Generate a 32-byte encryption key:

```bash
openssl rand -base64 32
```

Store the values interactively. Do not put them in `wrangler.jsonc`:

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put TOKEN_ENCRYPTION_KEY
npx wrangler secret put NTFY_TOPIC
```

Optional, for an authenticated or self-hosted ntfy topic:

```bash
npx wrangler secret put NTFY_ACCESS_TOKEN
```

`ADMIN_USERNAME` defaults to `admin`. Use a long random admin password and an unguessable ntfy topic.

For local development, copy `.dev.vars.example` to `.dev.vars` and fill it locally. `.dev.vars` is ignored by Git.

### 4. Set the public Worker URL

Deploy once to learn the assigned `workers.dev` URL:

```bash
npx wrangler deploy
```

Replace `https://REPLACE_WITH_WORKER_URL` in `wrangler.jsonc` with that exact HTTPS origin and deploy again. This must match the OAuth redirect registered with Swiggy:

```text
https://your-worker.example.workers.dev/auth/callback
```

For local OAuth testing, set `PUBLIC_BASE_URL` to `http://localhost:8787`, which Swiggy permits for development.

### 5. Authorize and select the address

Open the Worker URL. Your browser will request HTTP Basic credentials.

1. Choose **Authorize Swiggy** and finish phone/OTP consent.
2. Choose one of the saved delivery addresses returned by Swiggy.
3. Choose **Check now** to perform the first catalog check.
4. Confirm the run and tracked-variant counts on the status page.

The Cron Trigger then checks automatically every five minutes.

## Commands

```bash
npm run typecheck
npm test
npm run dev
npm run deploy
npm run db:migrate:local
npm run db:migrate:remote
```

To request a manual check as JSON:

```bash
curl -u 'admin:YOUR_PASSWORD' \
  -H 'Accept: application/json' \
  -X POST https://YOUR_WORKER/admin/check
```

Health checks require no credentials:

```bash
curl https://YOUR_WORKER/healthz
```

## Operational behavior

- A malformed or empty Swiggy response fails closed and preserves existing deal state.
- HTTP 401 pauses checks and triggers one reauthorization notification.
- HTTP 429 is not retried; its `Retry-After` value is retained on the application error.
- Other transient MCP and ntfy failures use bounded exponential backoff with jitter.
- A failed deal notification leaves that variant inactive so the next successful run retries it.
- Overlapping manual and scheduled checks are prevented with a ten-minute D1 lock.
- Price observations and run history are retained for 30 days.
- Logs contain error codes and redacted messages, not tokens, address bodies, or complete Swiggy payloads.

## Updating thresholds

Edit these string variables in `wrangler.jsonc`, then redeploy:

```json
"DEAL_MAX_PRICE": "25",
"DEAL_MIN_DISCOUNT_PCT": "70"
```

The rules are joined with **OR**. An available variant qualifies if either threshold matches.

## Known launch boundary

The public Swiggy reference describes the response conceptually but does not publish every nested pricing field. The normalizer accepts common documented representations and fails closed if none are recognizable. Before production, capture a non-sensitive staging fixture, add it to the normalization tests, and confirm the exact live response contract with the Builders Club reviewer.
