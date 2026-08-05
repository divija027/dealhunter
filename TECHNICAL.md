# Deal Hunter - Technical Research

**Researched:** 2026-04-08
**Domain:** Telegram monitoring, quick commerce scraping, LLM parsing, push notifications
**Confidence:** MEDIUM-HIGH (platform APIs are undocumented and change frequently)

## Summary

This research covers the five core technical challenges in the Deal Hunter project: keeping Telethon alive long-term on a VPS, scraping quick commerce platforms (Blinkit, Zepto, Swiggy Instamart, BigBasket) for price/stock verification, using Gemini for structured deal message parsing, price verification patterns, and ntfy.sh reliability.

The most critical finding is that **all four quick commerce platforms have internal REST APIs** that can be called directly with `curl_cffi` (for TLS fingerprint impersonation) -- no browser automation needed. The key is setting location via lat/lng headers and cookies, not pincodes. Blinkit uses Cloudflare with JA3 fingerprinting; Zepto is the most permissive; Swiggy Instamart silently drops requests under load; BigBasket accepts a pincode header directly.

**Primary recommendation:** Use curl_cffi with Chrome impersonation for all platform API calls. Use Gemini 2.5 Flash with Pydantic `response_schema` for both deal parsing AND page content extraction. Keep Telethon running via systemd with `Restart=always` and handle FloodWaitError/disconnects in-process. Use public ntfy.sh (not self-hosted) for simplicity.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| telethon | 1.42.0 | Telegram user client for group monitoring | Only stable Python lib for user accounts (not bots). v2 is alpha, avoid it |
| google-genai | >=1.70.0 | Gemini 2.5 Flash for deal parsing + verification | Official Google SDK. Supports `response_schema` with Pydantic models directly |
| curl-cffi | >=0.15.0 | HTTP client with TLS fingerprint impersonation | Essential for bypassing Cloudflare on Blinkit. Impersonates Chrome TLS/JA3/HTTP2 fingerprints at socket level |
| fastapi | >=0.135.0 | Web dashboard + API | Async-native, lifespan events for background tasks |
| uvicorn | >=0.44.0 | ASGI server | Standard FastAPI server |
| asyncpg | >=0.31.0 | PostgreSQL async driver | Direct async queries, connection pool built-in, no ORM overhead |
| pydantic | >=2.12.0 | Data models and validation | Used for deal schemas, config, AND Gemini response_schema |
| pydantic-settings | >=2.13.0 | .env configuration | Validates all config at startup, type-safe |
| httpx | >=0.28.0 | Async HTTP for Telegram Bot API + ntfy | Already installed on system. Clean async API for bot sendMessage and ntfy POST |
| jinja2 | >=3.1.6 | HTML templates | Already installed. FastAPI Jinja2Templates integration |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| markdownify | latest | HTML to Markdown conversion | Before sending HTML to Gemini for verification -- reduces tokens by ~70% |
| python-dotenv | latest | .env file loading | Required by pydantic-settings for .env parsing |
| python-multipart | latest | Form parsing | Required by FastAPI for settings form POST |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| curl_cffi | playwright/puppeteer | 10x slower, 100x more memory, but handles JS-rendered pages. Not needed since platforms have REST APIs |
| curl_cffi | httpx/aiohttp | Will be blocked by Cloudflare on Blinkit immediately. No TLS impersonation |
| google-genai | regex/BeautifulSoup | Brittle, breaks on message format changes. LLM handles varied deal formats gracefully |
| asyncpg raw | SQLAlchemy async | ORM adds complexity for simple CRUD. asyncpg is faster and more predictable |
| Telethon | Pyrogram | Pyrogram is also viable but Telethon has larger community and more battle-tested for long-running |

**Installation:**
```bash
pip install telethon google-genai "curl-cffi>=0.15" fastapi uvicorn asyncpg pydantic pydantic-settings httpx jinja2 markdownify python-dotenv python-multipart
```

---

## Architecture Patterns

### Recommended Project Structure
```
deal_hunter/
├── deal_hunter/
│   ├── main.py              # Lifespan: start telethon + web together
│   ├── config.py            # pydantic-settings, validated at import
│   ├── models.py            # Pydantic models (also used as Gemini schemas)
│   ├── db.py                # asyncpg pool lifecycle
│   ├── deal_store.py        # SQL queries, not ORM
│   ├── telegram_listener.py # Telethon client with reconnect handling
│   ├── deal_parser.py       # Gemini structured extraction
│   ├── deal_verifier.py     # curl_cffi per-platform fetchers
│   ├── notifier.py          # Telegram bot DM + ntfy
│   ├── web/                 # FastAPI app
│   └── utils/retry.py       # Exponential backoff
└── data/                    # telethon.session file
```

### Pattern 1: Single-Process Async Pipeline with Lifespan

**What:** Run Telethon listener, periodic re-verification, and FastAPI web server in the same asyncio event loop using FastAPI's lifespan context manager.

**Why:** Simpler than multi-process. Telethon and FastAPI are both async-native. Shared database pool. No IPC needed.

**Example:**
```python
# main.py
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI

from deal_hunter.config import settings
from deal_hunter.db import init_db, close_db
from deal_hunter.telegram_listener import start_listener
from deal_hunter.web.app import create_app

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    pool = await init_db()
    listener_task = asyncio.create_task(start_listener(pool))
    reverify_task = asyncio.create_task(periodic_reverify(pool))
    yield
    # Shutdown
    listener_task.cancel()
    reverify_task.cancel()
    await close_db()

app = create_app(lifespan=lifespan)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=settings.web_host, port=settings.web_port)
```

Source: [FastAPI Issue #543 - Running async background tasks](https://github.com/fastapi/fastapi/issues/543)

### Pattern 2: Pipeline with Graceful Degradation

**What:** Each stage of the pipeline (parse -> verify -> notify) can fail independently without blocking the others. Verification failure still triggers notification with "unverified" tag.

**Example:**
```python
async def process_deal(raw_text: str, message_id: int, pool):
    # Stage 1: Parse (required)
    parsed = await parse_deal(raw_text)
    if not parsed or not parsed.is_deal:
        return

    deal_id = await deal_store.save(pool, message_id, raw_text, parsed)

    # Stage 2: Verify (optional, best-effort)
    verification = None
    if parsed.product_url:
        try:
            verification = await verify_deal(parsed, settings.pincode, settings.lat, settings.lng)
            await deal_store.update_verification(pool, deal_id, verification)
        except Exception as e:
            log.warning(f"Verification failed for {deal_id}: {e}")

    # Stage 3: Notify (always, with verification status)
    await notify(parsed, verification)
    await deal_store.mark_notified(pool, deal_id)
```

### Pattern 3: Per-Platform Verifier Dispatch

**What:** Route verification to platform-specific handlers based on URL pattern.

```python
PLATFORM_HANDLERS = {
    "blinkit.com": verify_blinkit,
    "grofers.com": verify_blinkit,  # old domain
    "zeptonow.com": verify_zepto,
    "swiggy.com/instamart": verify_swiggy,
    "bigbasket.com": verify_bigbasket,
}

async def verify_deal(deal, pincode, lat, lng):
    for domain, handler in PLATFORM_HANDLERS.items():
        if domain in (deal.product_url or ""):
            return await handler(deal.product_url, pincode, lat, lng)
    return VerifyResult(available=False, error="Unknown platform")
```

### Anti-Patterns to Avoid

- **Running Telethon with `client.run_until_disconnected()` as main entry:** This blocks the event loop. Use `asyncio.create_task(client.run_until_disconnected())` inside the lifespan instead.
- **Using `catch_up=True`:** Known broken in Telethon 1.42.0 -- events are not reliably fired after reconnection (Issue #4611, closed NOT_PLANNED). Instead, rely on systemd `Restart=always` and dedup by message_id in the database.
- **Sharing a single curl_cffi session across platforms:** Each platform needs different headers/cookies. Create per-platform session factories.
- **Calling Gemini for every message:** Many Telegram group messages are chatter, not deals. Filter first (min length, URL presence) before calling Gemini.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| TLS fingerprint impersonation | Custom header spoofing | curl_cffi `impersonate="chrome"` | Cloudflare checks JA3 fingerprint at TLS level, not HTTP headers. Pure Python HTTP clients are instantly detected |
| HTML-to-text for LLM | Custom tag stripping | markdownify library | Reduces tokens by ~70%, preserves semantic structure. Handles edge cases (tables, nested tags) |
| JSON schema for Gemini | Manual JSON prompt instructions | Pydantic model + `response_schema` | Gemini API enforces schema compliance at output level. Guarantees valid JSON matching your model |
| Exponential backoff | Simple sleep + retry | tenacity or custom with jitter | Need jitter to avoid thundering herd on rate limits. Simple retry causes synchronized retries |
| .env validation | os.environ.get() | pydantic-settings BaseSettings | Validates types, provides defaults, fails fast at startup if config missing |
| Telegram bot messaging | Raw urllib calls | httpx async POST | Connection pooling, timeouts, proper error handling built-in |

---

## Common Pitfalls

### Pitfall 1: Telethon Session Corruption on Unclean Shutdown

**What goes wrong:** If the process is killed (SIGKILL, OOM) without calling `client.disconnect()`, the SQLite session file can become corrupt. Next startup hangs indefinitely (Issue #4577).
**Why it happens:** Telethon writes session state to SQLite. Unclean shutdown = incomplete write.
**How to avoid:**
1. Handle SIGTERM in systemd service (systemd sends SIGTERM first, then SIGKILL after TimeoutStopSec)
2. Use `TimeoutStopSec=30` in systemd unit to give time for graceful shutdown
3. Keep session file on a reliable filesystem (not tmpfs)
4. Add signal handlers:
```python
import signal

def handle_shutdown(signum, frame):
    asyncio.get_event_loop().create_task(client.disconnect())

signal.signal(signal.SIGTERM, handle_shutdown)
```
**Warning signs:** Script hangs on startup with no errors. Check if `data/telethon.session` is corrupt.

### Pitfall 2: Blinkit 429 Rate Limiting

**What goes wrong:** Blinkit returns HTTP 429 after too many requests from the same IP.
**Why it happens:** Cloudflare rate limiting + JA3 fingerprint tracking.
**How to avoid:**
1. Use `curl_cffi` with `impersonate="chrome110"` or `impersonate="chrome131"` (must match a real browser)
2. Add 2-5 second delay between verification requests
3. Use `asyncio.Semaphore(3)` to limit concurrent Blinkit requests (not 10 as in the plan)
4. Cache verification results -- don't re-verify the same product URL within 30 minutes
**Warning signs:** Getting empty responses or 429 status codes. Blinkit may also return 200 with a Cloudflare challenge page.

### Pitfall 3: Swiggy Instamart Silent Failures

**What goes wrong:** Swiggy returns HTTP 200 with empty body or placeholder data instead of actual product info.
**Why it happens:** Silent circuit-breaking WAF. Swiggy doesn't return error codes -- it just silently drops you.
**How to avoid:**
1. Keep concurrency very low (max 2-3 concurrent Swiggy requests)
2. Validate response content -- check for expected fields before accepting
3. Add random delays (3-8 seconds) between Swiggy requests
4. Treat empty/placeholder responses as verification failures, not "out of stock"
**Warning signs:** All Swiggy verifications suddenly return "available=False" or have missing price data.

### Pitfall 4: FloodWaitError Cascading

**What goes wrong:** Telegram returns FloodWaitError, handler retries, gets another FloodWait with longer delay, enters a spiral.
**Why it happens:** Telethon auto-sleeps for FloodWaitError < `flood_sleep_threshold` (default 60s). But if you also have manual retry logic, you get double-sleeping.
**How to avoid:**
1. Set `flood_sleep_threshold=120` to let the library handle most flood waits automatically
2. Do NOT add your own FloodWaitError retry logic on top of Telethon's built-in handling
3. Avoid calling `get_entity()` or `get_participants()` which are common FloodWait triggers
4. For our use case (listening to events), FloodWait is very rare since we're not making API calls
**Warning signs:** Logs showing repeated "Sleeping for X seconds" messages.

### Pitfall 5: Gemini Returning Schema-Valid but Semantically Wrong Data

**What goes wrong:** Gemini returns valid JSON matching your schema, but with wrong values (e.g., original_price and deal_price swapped, wrong platform detected).
**Why it happens:** Structured output guarantees syntactic validity, not semantic correctness. The model can hallucinate values that fit the schema.
**How to avoid:**
1. Always validate business logic after parsing: `deal_price < original_price`, platform matches URL domain
2. Add a `confidence` field to your schema so Gemini can signal uncertainty
3. Include 3-5 few-shot examples in your system prompt for common deal message formats
4. Log the raw message alongside parsed output for debugging
**Warning signs:** Deals where discount_pct is negative, or platform says "Blinkit" but URL is from Zepto.

### Pitfall 6: asyncpg Pool Exhaustion

**What goes wrong:** All connections in the pool are acquired and never returned. New queries hang waiting for a connection.
**Why it happens:** Using `pool.acquire()` without a context manager, or long-running transactions holding connections.
**How to avoid:**
1. Always use `async with pool.acquire() as conn:` -- the context manager returns the connection on exit
2. Set `max_inactive_connection_lifetime=300` (5 min) to recycle idle connections
3. Use a reasonable pool size: `min_size=2, max_size=10` (we're a single-user app)
4. Keep transactions short -- fetch, process, return connection
**Warning signs:** Dashboard loads slowly or times out. Log "pool exhausted" warnings.

---

## Platform-Specific Notes

### Blinkit

**Confidence:** MEDIUM-HIGH (API endpoints confirmed by multiple sources)

**Internal API:**
- **Base URL:** `https://blinkit.com` (redirects from api2.grofers.com)
- **Product feed:** `POST https://blinkit.com/v6/search/products` (or v5 depending on endpoint)
- **Layout feed:** `POST https://api2.grofers.com/v1/layout/feed` (legacy, still works per March 2026 scraper report)
- **Required headers:**
  - `lat`: latitude (e.g., `28.6139`)
  - `lon`: longitude (e.g., `77.2090`)
  - `app_client`: `consumer_app` (or current app identifier)
  - `auth_key`: Can be empty string or obtained from web app
- **TLS defense:** Cloudflare with JA3 fingerprinting. **Must use curl_cffi** with Chrome impersonation.
- **Rate limit behavior:** HTTP 429 after sustained requests. Indian datacenter IPs work better than residential for bulk requests.

**For our use case (single product verification):**
The simplest approach is to fetch the product page URL (shared in the Telegram deal message) with curl_cffi and extract price/stock with Gemini. No need to call internal APIs directly unless the product URL doesn't work.

```python
async def verify_blinkit(product_url: str, lat: float, lng: float) -> VerifyResult:
    async with AsyncSession(impersonate="chrome131") as session:
        resp = await session.get(
            product_url,
            headers={
                "lat": str(lat),
                "lon": str(lng),
            },
        )
        if resp.status_code == 200:
            markdown = markdownify(resp.text)
            return await extract_price_with_gemini(markdown)
        return VerifyResult(available=False, error=f"HTTP {resp.status_code}")
```

**Source:** [How I Scraped Most Dark Stores in India (March 2026)](https://jatin-dot-py.medium.com/how-i-scraped-most-dark-stores-in-india-blinkit-zepto-swiggy-instamart-ad939ff17af9)

### Zepto

**Confidence:** MEDIUM-HIGH

**Internal API:**
- **Serviceability check:** Unauthenticated endpoint -- send coordinates, get back `storeId` if Zepto covers the area
- **Product data:** `POST /lms/api/v2/get_page`
- **Required headers:**
  - `Authorization: Bearer [token]` (obtained from web app session)
  - `app_version`: Current app version string
  - `User-Agent: okhttp/4.12.0` (Android app UA)
  - `tenant: ZEPTO`
  - `platform: android`
- **Anti-scraping:** Most permissive of all platforms. "A single IP sustained tens of thousands of requests" before any limiting.
- **Store response includes:** `storeDetailsResponse` with coordinates and `servicableGeofence` polygon (note: misspelled in their API as "servicable")

**For our use case:**
Zepto product URLs are straightforward to fetch. Set cookies/headers for location and fetch the page.

```python
async def verify_zepto(product_url: str, lat: float, lng: float) -> VerifyResult:
    async with AsyncSession(impersonate="chrome131") as session:
        # Zepto sets location via cookies
        session.cookies.set("lat", str(lat))
        session.cookies.set("lng", str(lng))
        resp = await session.get(product_url)
        if resp.status_code == 200:
            markdown = markdownify(resp.text)
            return await extract_price_with_gemini(markdown)
        return VerifyResult(available=False, error=f"HTTP {resp.status_code}")
```

### Swiggy Instamart

**Confidence:** MEDIUM (silent failures make this the hardest platform)

**Internal API:**
- **Location discovery:** `select-location` home API for pod/store discovery
- **Cart/product check:** `POST /api/instamart/checkout/v2/cart?pageType=INSTAMART_CART`
- **Required cookies:** `lat`, `lng` (must be geographically matched to a pod service zone)
- **Required payload:** `podId`, `spinId` (internal product identifier)
- **Anti-scraping:** Silent circuit-breaking. Returns 200 OK with empty/placeholder bodies. Very low concurrency threshold (10-20 workers for large-scale, recommend 2-3 for our use case).

**For our use case:**
Swiggy Instamart URLs often redirect or require specific cookies. The approach:
1. Set lat/lng cookies matching your pincode
2. Fetch the product URL
3. If you get a valid page, extract with Gemini
4. If empty/redirect, mark as "verification failed" (NOT "out of stock")

**Critical:** Always validate response content length and check for expected product data fields before accepting the response as valid.

### BigBasket

**Confidence:** MEDIUM

**Internal API:**
- **Location header:** `x-geolocation-pincode: 400001` (direct pincode, simpler than others)
- **Product page:** Standard web scraping approach works. BigBasket is the least aggressive on anti-scraping
- **API pattern:** BeautifulSoup or Selenium commonly used in existing scrapers (github.com/niksoc/bigbasket-scraper, github.com/Gaurang105/BigBasket_Scraper)
- **BB Now (quick commerce arm):** Product prices, vouchers and promos are city-specific

**For our use case:**
BigBasket is the simplest to scrape. curl_cffi with the pincode header should work without Chrome impersonation:

```python
async def verify_bigbasket(product_url: str, pincode: str) -> VerifyResult:
    async with AsyncSession() as session:  # No impersonation needed
        resp = await session.get(
            product_url,
            headers={"x-geolocation-pincode": pincode},
        )
        if resp.status_code == 200:
            markdown = markdownify(resp.text)
            return await extract_price_with_gemini(markdown)
        return VerifyResult(available=False, error=f"HTTP {resp.status_code}")
```

---

## Gemini Parsing Best Practices

### Using response_schema with Pydantic

**Confidence:** HIGH (verified from official docs and PyPI)

The google-genai SDK (>=1.70.0) supports passing Pydantic models directly to `response_schema`. The model output is guaranteed to be valid JSON conforming to your schema.

```python
from pydantic import BaseModel, Field
from typing import Optional
from google import genai
from google.genai import types

class ParsedDeal(BaseModel):
    product_name: str = Field(description="The product being sold")
    platform: str = Field(description="Platform: blinkit, zepto, swiggy_instamart, bigbasket, or unknown")
    original_price: Optional[float] = Field(None, description="MRP or original price before discount")
    deal_price: Optional[float] = Field(None, description="The discounted/deal price")
    discount_pct: Optional[float] = Field(None, description="Discount percentage if mentioned")
    coupon_code: Optional[str] = Field(None, description="Coupon code if mentioned")
    product_url: Optional[str] = Field(None, description="URL to the product page")
    category: Optional[str] = Field(None, description="Product category like groceries, electronics, etc.")
    is_deal: bool = Field(description="True if this message contains an actual deal, False for chatter/questions")
    confidence: float = Field(description="Your confidence in the extraction, 0.0-1.0")

client = genai.Client(api_key=settings.gemini_api_key)

async def parse_deal(raw_text: str) -> Optional[ParsedDeal]:
    response = await client.aio.models.generate_content(
        model="gemini-2.5-flash",
        contents=raw_text,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=ParsedDeal,
            system_instruction=SYSTEM_PROMPT,
        ),
    )
    parsed = response.parsed  # Returns ParsedDeal instance directly
    if not parsed.is_deal:
        return None
    return parsed
```

### Key Points

1. **response_schema vs response_json_schema:** You can pass the Pydantic class directly to `response_schema`. The SDK handles conversion. No need to call `.model_json_schema()` manually.

2. **response.parsed:** When using `response_schema` with a Pydantic class, `response.parsed` returns an instance of that class directly. No manual JSON parsing needed.

3. **Nested models work:** Issue #60 (nested Pydantic classes failing) was fixed in Jan 2025. Lists, nested models, and Optional fields all work.

4. **Enum edge case:** Enum properties can still occasionally cause validation errors. Use `Literal["blinkit", "zepto", "swiggy_instamart", "bigbasket", "unknown"]` instead of `Enum` for the platform field.

5. **Field descriptions matter:** Gemini uses the `description` in Field() to understand what each field should contain. Be specific.

### Cost Optimization

**Gemini 2.5 Flash pricing (April 2026):**
- Input: $0.15 per million tokens (under 200K context)
- Output: $0.60 per million tokens

**For deal parsing:** ~500 tokens input (deal message) + ~200 tokens output = ~$0.0001 per parse.
**For verification:** ~2000-5000 tokens input (markdown page) + ~100 tokens output = ~$0.0004 per verification.

**Optimization strategies:**
1. **Pre-filter messages:** Skip messages < 20 chars, no URL, or matching known non-deal patterns (e.g., "thanks", "which pincode")
2. **Convert HTML to Markdown before sending to Gemini:** Reduces tokens by ~70% using markdownify
3. **Cache verification results:** Don't re-verify the same product URL within 30 minutes
4. **Trim page content:** Strip navigation, footer, ads before sending to Gemini. Only send the product detail section if identifiable
5. **Batch parsing is NOT recommended:** Deal messages arrive one at a time; real-time notification is more important than batch savings

### System Prompt for Deal Parsing

```python
SYSTEM_PROMPT = """You are a deal extraction assistant for Indian quick commerce platforms
(Blinkit, Zepto, Swiggy Instamart, BigBasket).

Extract deal information from Telegram group messages. Messages may contain:
- Product names and prices
- Discount percentages or amounts
- Coupon codes (e.g., "use code SAVE20")
- Product URLs (blinkit.com, zeptonow.com, swiggy.com, bigbasket.com)
- Informal language, emojis, and abbreviations

Rules:
1. Set is_deal=false for: questions, thank you messages, delivery complaints, general chatter
2. Detect platform from URL domain. If no URL, infer from context or set "unknown"
3. Prices are in Indian Rupees (INR). Common formats: Rs.99, INR 99, 99/-, Rs 99
4. deal_price should ALWAYS be less than or equal to original_price
5. Set confidence lower if information is ambiguous or incomplete
6. product_url must be a valid URL or null. Do not hallucinate URLs.
"""
```

### Verification Prompt

```python
VERIFY_PROMPT = """Extract the current price and availability from this product page content.

Return:
- current_price: The actual selling price shown on the page (in INR)
- mrp: The MRP/original price if different from selling price
- in_stock: true if the product is available for purchase
- delivery_available: true if delivery is available (not "out of serviceable area")
- error: null if extraction succeeded, error message if page doesn't contain product info

If this page is a login wall, error page, or doesn't contain product information, set error accordingly.
"""
```

**Sources:**
- [Gemini Structured Output Docs](https://ai.google.dev/gemini-api/docs/structured-output)
- [Google GenAI SDK](https://googleapis.github.io/python-genai/)
- [Nested Pydantic Issue #60 (fixed)](https://github.com/googleapis/python-genai/issues/60)

---

## Telethon Long-Running Best Practices

### Confidence: MEDIUM-HIGH (gathered from official docs + GitHub issues + community experience)

### Client Configuration

```python
from telethon import TelegramClient, events

client = TelegramClient(
    session="data/telethon",  # .session extension auto-added
    api_id=settings.telegram_api_id,
    api_hash=settings.telegram_api_hash,
    # Production settings:
    connection_retries=5,        # Default, don't set to infinite (causes hangs)
    auto_reconnect=True,         # Default, re-establishes connection after network drops
    flood_sleep_threshold=120,   # Let library auto-sleep for FloodWait up to 2 min
)
```

### Event Handler Pattern

```python
@client.on(events.NewMessage(chats=[settings.telegram_group_id]))
async def on_new_message(event):
    """Process new messages from the deal group."""
    try:
        raw_text = event.message.text or ""
        if len(raw_text) < 20:
            return  # Skip short messages (reactions, emojis)

        message_id = event.message.id
        # Dedup check in database
        if await deal_store.exists(pool, message_id):
            return

        await process_deal(raw_text, message_id, pool)
    except Exception as e:
        log.error(f"Error processing message {event.message.id}: {e}", exc_info=True)
        # Do NOT re-raise -- uncaught exceptions are caught by Telethon
        # and logged, but we want our own logging
```

### Starting the Listener (as background task)

```python
async def start_listener(pool):
    """Start the Telethon client as a long-running background task."""
    await client.start(phone=settings.telegram_phone)
    log.info("Telethon client started, listening for deals...")

    try:
        await client.run_until_disconnected()
    except Exception as e:
        log.error(f"Telethon disconnected: {e}")
    finally:
        # This is critical for session file integrity
        await client.disconnect()
```

### Key Lessons from GitHub Issues

1. **Session broke after 10 minutes (Issue #1402):** Often caused by running the same session from two processes simultaneously. Only ONE process should use a session file at a time.

2. **All sessions terminated (Issue #4321):** Can happen if Telegram detects suspicious activity. Use a dedicated phone number, don't change VPS IP frequently.

3. **Corrupt session hangs forever (Issue #4577, March 2025):** If the session SQLite file is corrupt, Telethon hangs with no error. Solution: delete the .session file and re-authenticate. Keep a backup of a known-good session.

4. **catch_up is broken (Issue #4611):** `catch_up=True` does NOT reliably fire events for missed messages. Do not rely on it. Instead, accept that messages during downtime may be missed, and keep downtime minimal via systemd `Restart=always RestartSec=10`.

5. **Reconnection retries exhausted (Issue #270):** With `connection_retries=5`, after 5 failed reconnects, the client stops. systemd will restart the entire process, which is actually the correct behavior.

### systemd Integration

```ini
[Unit]
Description=Deal Hunter Monitor
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=hx0r
WorkingDirectory=/home/hx0r/deal_hunter
ExecStart=/home/hx0r/deal_hunter/.venv/bin/python -m deal_hunter.main
Restart=always
RestartSec=10
TimeoutStopSec=30
EnvironmentFile=/home/hx0r/deal_hunter/.env
# Memory protection
MemoryMax=512M

[Install]
WantedBy=multi-user.target
```

**Important:** Use `After=network-online.target` (not just `network.target`) to ensure DNS resolution works at startup. Use `Wants=network-online.target` so systemd actually waits for network.

### First-Run Authentication

Telethon requires interactive phone authentication the first time. This MUST be done manually before enabling the systemd service:

```bash
cd /home/hx0r/deal_hunter
.venv/bin/python -c "
from telethon.sync import TelegramClient
client = TelegramClient('data/telethon', API_ID, API_HASH)
client.start(phone=PHONE)
print('Session created successfully')
client.disconnect()
"
```

After this, `data/telethon.session` exists and systemd can use it.

**Sources:**
- [Telethon FAQ](https://docs.telethon.dev/en/stable/quick-references/faq.html)
- [Telethon Session Docs](https://docs.telethon.dev/en/stable/concepts/sessions.html)
- [Telethon Client Parameters](https://docs.telethon.dev/en/stable/modules/client.html)
- [Issue #4577 - Corrupt session hangs](https://github.com/LonamiWebs/Telethon/issues/4577)
- [Issue #4611 - catch_up broken](https://github.com/LonamiWebs/Telethon/issues/4611)
- [Issue #1402 - Session breaks](https://github.com/LonamiWebs/Telethon/issues/1402)

---

## Ntfy Best Practices

### Confidence: HIGH (official docs verified)

**Recommendation: Use the public ntfy.sh server, not self-hosted.**

Reasons:
1. Public ntfy.sh uses Firebase Cloud Messaging (FCM) for Android push -- zero battery impact
2. Self-hosted ntfy requires the Android app to maintain a persistent WebSocket connection -- 0-1% battery per 17 hours, more on 4G
3. Public ntfy.sh has had no outages in its first year (as of late 2022 report), and has been running since
4. The only reason to self-host is if you need privacy or higher rate limits, which we don't need for deal notifications

### Sending Notifications

```python
async def send_ntfy(deal: ParsedDeal, verification: Optional[VerifyResult]) -> None:
    """Send push notification via ntfy."""
    # Build notification
    verified_tag = "white_check_mark" if (verification and verification.available) else "warning"
    price_info = ""
    if deal.deal_price:
        price_info = f"Rs.{deal.deal_price}"
        if deal.original_price and deal.original_price > deal.deal_price:
            price_info += f" (was Rs.{deal.original_price})"

    message = f"{deal.product_name}\n{price_info}"
    if deal.coupon_code:
        message += f"\nCode: {deal.coupon_code}"
    if verification and not verification.available:
        message += f"\n{verification.error or 'Verification failed'}"

    payload = {
        "topic": settings.ntfy_topic,
        "title": f"Deal: {deal.platform.title()}",
        "message": message,
        "priority": 4 if verification and verification.available else 3,
        "tags": [verified_tag, deal.platform],
        "markdown": True,
        "click": deal.product_url or "",
    }
    if deal.product_url:
        payload["actions"] = [
            {"action": "view", "label": "Open Deal", "url": deal.product_url}
        ]

    async with httpx.AsyncClient() as client:
        await client.post(
            f"{settings.ntfy_server}",
            json=payload,
            timeout=10.0,
        )
```

### Key ntfy Features to Use

| Feature | Header/Field | Use Case |
|---------|-------------|----------|
| Title | `title` | Platform name + "Deal" |
| Priority | `priority` (1-5) | 4=high for verified deals, 3=default for unverified |
| Tags | `tags` (list) | Emoji tags: white_check_mark, warning, moneybag |
| Click URL | `click` | Open the product page directly |
| Markdown | `markdown: true` | Bold prices, formatted messages |
| Actions | `actions` | "Open Deal" button in notification |

### Android Battery Note

When using the **public ntfy.sh server** with the Google Play Store app, notifications use FCM (Firebase Cloud Messaging) which has zero additional battery impact. The F-Droid version uses a persistent connection which uses more battery. Recommend Google Play version.

**Sources:**
- [ntfy Publishing Docs](https://docs.ntfy.sh/publish/)
- [ntfy Battery FAQ](https://docs.ntfy.sh/faq/)
- [Issue #1195 - Battery usage](https://github.com/binwiederhier/ntfy/issues/1195)
- [Issue #687 - 4G battery drain](https://github.com/binwiederhier/ntfy/issues/687)

---

## Code Examples

### curl_cffi AsyncSession for Platform Verification

```python
from curl_cffi.requests import AsyncSession
from markdownify import markdownify as md
import asyncio

# Semaphore to limit concurrent requests per platform
blinkit_sem = asyncio.Semaphore(3)
zepto_sem = asyncio.Semaphore(5)  # Zepto is more permissive
swiggy_sem = asyncio.Semaphore(2)  # Swiggy is very sensitive

async def fetch_product_page(
    url: str,
    lat: float,
    lng: float,
    platform: str,
    impersonate: str = "chrome131",
) -> str | None:
    """Fetch a product page and return markdown content."""
    sem = {"blinkit": blinkit_sem, "zepto": zepto_sem, "swiggy_instamart": swiggy_sem}.get(platform)

    async with sem if sem else asyncio.Semaphore(5):
        async with AsyncSession(impersonate=impersonate) as session:
            headers = {"lat": str(lat), "lon": str(lng)}
            cookies = {"lat": str(lat), "lng": str(lng)}  # Zepto/Swiggy use cookies

            try:
                resp = await session.get(
                    url,
                    headers=headers,
                    cookies=cookies,
                    timeout=15,
                )
                if resp.status_code == 200 and len(resp.text) > 500:
                    # Convert HTML to markdown to reduce tokens
                    return md(resp.text, strip=["script", "style", "nav", "footer"])
                return None
            except Exception as e:
                log.warning(f"Failed to fetch {url}: {e}")
                return None
```

### asyncpg Connection Pool Lifecycle

```python
import asyncpg
from deal_hunter.config import settings

_pool: asyncpg.Pool | None = None

async def init_db() -> asyncpg.Pool:
    global _pool
    _pool = await asyncpg.create_pool(
        dsn=settings.database_url,
        min_size=2,
        max_size=10,
        max_inactive_connection_lifetime=300,  # Recycle idle connections after 5 min
    )

    # Create table if not exists
    async with _pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS deals (
                id SERIAL PRIMARY KEY,
                message_id BIGINT UNIQUE NOT NULL,
                raw_text TEXT NOT NULL,
                product_name TEXT,
                platform TEXT,
                original_price NUMERIC,
                deal_price NUMERIC,
                discount_pct NUMERIC,
                coupon_code TEXT,
                product_url TEXT,
                category TEXT,
                is_deal BOOLEAN DEFAULT TRUE,
                confidence REAL,
                -- Verification fields
                verified BOOLEAN DEFAULT FALSE,
                verified_at TIMESTAMPTZ,
                current_price NUMERIC,
                in_stock BOOLEAN,
                verify_error TEXT,
                -- Notification tracking
                notified BOOLEAN DEFAULT FALSE,
                notified_at TIMESTAMPTZ,
                -- Timestamps
                created_at TIMESTAMPTZ DEFAULT NOW(),
                expires_at TIMESTAMPTZ
            );

            CREATE INDEX IF NOT EXISTS idx_deals_created_at ON deals (created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_deals_platform ON deals (platform);
            CREATE INDEX IF NOT EXISTS idx_deals_verified ON deals (verified) WHERE is_deal = TRUE;
        """)

    return _pool

async def close_db():
    global _pool
    if _pool:
        await _pool.close()
        _pool = None

def get_pool() -> asyncpg.Pool:
    assert _pool is not None, "Database not initialized. Call init_db() first."
    return _pool
```

### Exponential Backoff with Jitter

```python
import asyncio
import random
from typing import TypeVar, Callable, Awaitable

T = TypeVar("T")

async def with_retry(
    fn: Callable[..., Awaitable[T]],
    *args,
    max_retries: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 60.0,
    **kwargs,
) -> T:
    """Retry an async function with exponential backoff and jitter."""
    last_exception = None
    for attempt in range(max_retries + 1):
        try:
            return await fn(*args, **kwargs)
        except Exception as e:
            last_exception = e
            if attempt == max_retries:
                break
            # Exponential backoff with full jitter
            delay = min(base_delay * (2 ** attempt), max_delay)
            jittered_delay = random.uniform(0, delay)
            log.warning(f"Retry {attempt + 1}/{max_retries} after {jittered_delay:.1f}s: {e}")
            await asyncio.sleep(jittered_delay)
    raise last_exception
```

### pydantic-settings Configuration

```python
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # Telegram - User Client (Telethon)
    telegram_api_id: int
    telegram_api_hash: str
    telegram_phone: str
    telegram_group_id: int

    # Telegram - Bot (for notifications)
    telegram_bot_token: str
    telegram_notify_chat_id: int

    # Gemini
    gemini_api_key: str

    # Ntfy
    ntfy_topic: str
    ntfy_server: str = "https://ntfy.sh"

    # Location
    user_pincode: str
    user_lat: float
    user_lng: float

    # Web
    web_host: str = "0.0.0.0"
    web_port: int = 8080

    # Database
    database_url: str = "postgresql://localhost/deal_hunter"

    # Session
    session_path: str = "data/telethon"

    # Tuning
    verify_concurrency: int = 5
    verify_cache_minutes: int = 30
    reverify_interval_minutes: int = 60

settings = Settings()
```

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python | Everything | Yes | 3.13.7 | -- |
| PostgreSQL | Data storage | Yes | 18.1 (accepting connections) | -- |
| systemd | Process management | Yes | 258 | -- |
| nginx | Reverse proxy (optional) | No | -- | Use uvicorn directly on port 8080, or install nginx later |
| certbot | SSL (optional) | No | -- | Skip SSL initially, add later with nginx |

**Missing dependencies with no fallback:** None -- all critical dependencies are available.

**Missing dependencies with fallback:**
- nginx/certbot: Not installed. Dashboard can be accessed directly via `http://IP:8080` during development. Install nginx + certbot later for production domain access with SSL.

---

## Open Questions

1. **Blinkit product URL format changes:**
   - What we know: Blinkit product URLs are shared in deal messages and can be fetched directly
   - What's unclear: Do product URLs return full price/stock info without JavaScript? Some SPAs render client-side only
   - Recommendation: Test with curl_cffi first. If the response is a JS shell, fall back to calling the internal API endpoint with product ID extracted from the URL

2. **Zepto auth token lifecycle:**
   - What we know: Zepto's product data API needs a Bearer token
   - What's unclear: How long do tokens last? Can we get one programmatically?
   - Recommendation: For MVP, fetch product pages (not API) with curl_cffi. API approach can be added later if page fetching fails

3. **Telegram account security:**
   - What we know: Running a user client 24/7 from a VPS can trigger Telegram security checks
   - What's unclear: How frequently does Telegram request re-verification? Does having 2FA help?
   - Recommendation: Enable 2FA on the Telegram account. Use the same VPS IP consistently. Avoid making frequent API calls beyond event listening

4. **Gemini rate limits on free tier:**
   - What we know: Gemini 2.5 Flash has generous free tier limits
   - What's unclear: Exact free tier limits for structured output mode
   - Recommendation: Start with free tier. At deal parsing volume (likely <100/day), costs would be <$0.01/day even on paid tier

---

## Sources

### Primary (HIGH confidence)
- [Gemini Structured Output - Official Docs](https://ai.google.dev/gemini-api/docs/structured-output) - Schema features, limitations, code patterns
- [Google GenAI SDK Documentation](https://googleapis.github.io/python-genai/) - Python SDK API reference
- [Telethon 1.42.0 Documentation](https://docs.telethon.dev/en/stable/) - Client parameters, session management, event handling
- [curl_cffi Documentation](https://curl-cffi.readthedocs.io/en/latest/) - AsyncSession, impersonation, proxy support
- [ntfy Publishing Docs](https://docs.ntfy.sh/publish/) - All notification features and formats
- [asyncpg Documentation](https://magicstack.github.io/asyncpg/current/usage.html) - Connection pool usage
- [FastAPI Settings](https://fastapi.tiangolo.com/advanced/settings/) - pydantic-settings integration

### Secondary (MEDIUM confidence)
- [How I Scraped Most Dark Stores in India - Medium (March 2026)](https://jatin-dot-py.medium.com/how-i-scraped-most-dark-stores-in-india-blinkit-zepto-swiggy-instamart-ad939ff17af9) - Blinkit/Zepto/Swiggy API endpoints, headers, anti-scraping defenses. Most valuable single source
- [Blinkit-Zepto-product-backend - GitHub](https://github.com/iamonjarvis/Blinkit-Zepto-product-backend) - Puppeteer-based scraper (confirms API approach is viable)
- [Blinkit_Data_Scraping - GitHub](https://github.com/Rda99/Blinkit_Data_Scraping) - Python scraper with lat/lng location
- [google-genai Issue #60](https://github.com/googleapis/python-genai/issues/60) - Nested Pydantic model fix confirmation
- [FastAPI Issue #543](https://github.com/fastapi/fastapi/issues/543) - asyncio background tasks with uvicorn pattern
- [niksoc/bigbasket-scraper - GitHub](https://github.com/niksoc/bigbasket-scraper) - BigBasket scraping approach
- [QuickCommerceAPI Platform Comparison](https://quickcommerceapi.com/blog/platform-comparison-india) - Pincode header format for BigBasket
- [Gemini API Structured Outputs Blog](https://blog.google/innovation-and-ai/technology/developers-tools/gemini-api-structured-outputs/) - Property ordering improvements

### Tertiary (LOW confidence -- needs validation during implementation)
- Blinkit internal API endpoints (api2.grofers.com/v1/layout/feed) -- may have changed since March 2026 report
- Zepto Bearer token mechanism -- lifecycle and programmatic acquisition unclear
- Swiggy podId/spinId internal identifiers -- not needed for page-fetching approach but relevant if API approach needed
- BigBasket BB Now specific endpoints -- limited documentation found

### Telethon GitHub Issues (HIGH confidence for specific bugs)
- [Issue #4577 - Corrupt session hangs](https://github.com/LonamiWebs/Telethon/issues/4577) (March 2025)
- [Issue #4611 - catch_up broken](https://github.com/LonamiWebs/Telethon/issues/4611) (closed NOT_PLANNED, Feb 2026)
- [Issue #1402 - Session breaks after 10 min](https://github.com/LonamiWebs/Telethon/issues/1402)
- [Issue #4321 - Sessions terminated](https://github.com/LonamiWebs/Telethon/issues/4321)
- [Issue #3180 - Disconnects on ARMv6](https://github.com/LonamiWebs/Telethon/issues/3180)

### ntfy GitHub Issues
- [Issue #1195 - Battery usage >10%](https://github.com/binwiederhier/ntfy/issues/1195)
- [Issue #687 - 4G battery drain](https://github.com/binwiederhier/ntfy/issues/687)
- [Issue #190 - WebSocket vs JSON stream battery](https://github.com/binwiederhier/ntfy/issues/190)
