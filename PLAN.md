# Deal Hunter

Personal tool (1-3 users) that monitors a Telegram deals group, parses messages with Gemini AI, verifies price/stock at your pincode on quick commerce sites, and pings you via Telegram bot + ntfy push.

**Stack**: Python 3.13 async | Telethon | Gemini 2.5 Flash | FastAPI | PostgreSQL | curl_cffi | systemd

**Cost**: ~$0.30/day for 1000 messages on Gemini. Notifications free.

---

## How It Works

```
Telegram group message
  → Telethon listener (real-time)
  → Gemini parses into structured deal (product, price, platform, URL, coupon)
  → curl_cffi fetches product page with your pincode/lat-lng
  → Gemini extracts current price + stock from page
  → Telegram bot DM + ntfy push notification
  → Deal saved to PostgreSQL, viewable on web dashboard
```

Loot/price-error deals notify immediately (verify async). Regular deals verify first.

---

## Project Structure

```
deal_hunter/
├── .env                         # Your API keys, pincode, group ID (gitignored)
├── .env.example
├── .gitignore
├── pyproject.toml
├── deal-hunter.service          # systemd unit
├── deal_hunter/
│   ├── __init__.py
│   ├── main.py                  # Entry: runs listener + web + reverify loop
│   ├── config.py                # pydantic-settings from .env
│   ├── models.py                # ParsedDeal, VerifyResult, DealOut
│   ├── db.py                    # asyncpg pool + table creation
│   ├── deal_store.py            # SQL queries (no ORM)
│   ├── telegram_listener.py     # Telethon user client
│   ├── deal_parser.py           # Gemini structured extraction
│   ├── deal_verifier.py         # Platform-specific price/stock check
│   ├── notifier.py              # Telegram bot DM + ntfy push
│   ├── web/
│   │   ├── __init__.py
│   │   ├── app.py               # FastAPI + Jinja2
│   │   ├── routes.py            # /deals, /deals/{id}, /settings
│   │   ├── api.py               # POST /api/verify/{id}, GET /api/stats
│   │   ├── static/style.css
│   │   └── templates/           # base, deals, deal, settings (Pico CSS)
│   └── utils/
│       ├── __init__.py
│       └── retry.py             # Exponential backoff + jitter
└── data/                        # telethon.session (persists across restarts)
```

---

## .env Config

```env
# Telegram user account (Telethon - reads group messages)
TELEGRAM_API_ID=
TELEGRAM_API_HASH=
TELEGRAM_PHONE=+91XXXXXXXXXX
TELEGRAM_GROUP_ID=              # Group/channel ID to monitor

# Telegram bot (sends you DM notifications)
TELEGRAM_BOT_TOKEN=             # From @BotFather
TELEGRAM_NOTIFY_CHAT_ID=        # Your personal chat ID with the bot

# Gemini
GEMINI_API_KEY=

# Ntfy push notifications
NTFY_TOPIC=deal-hunter          # Pick any unique topic name
NTFY_SERVER=https://ntfy.sh     # Public server (free, zero battery impact)

# Your location
USER_PINCODE=560001
USER_LAT=12.9716
USER_LNG=77.5946

# Database
DATABASE_URL=postgresql://localhost/deal_hunter

# Web dashboard
WEB_PORT=8080
```

---

## Build Phases

### Phase 1: MVP — Parse + Notify (~4 hrs)

Get deals flowing: message in → Gemini parse → notification out. No verification yet.

| File | What |
|------|------|
| `pyproject.toml` | Dependencies |
| `.env.example` | Config template |
| `config.py` | pydantic-settings loads .env, validates at startup |
| `models.py` | `ParsedDeal` (Gemini schema), `VerifyResult`, `DealOut` |
| `db.py` | asyncpg pool, `CREATE TABLE deals`, init/close lifecycle |
| `deal_store.py` | `save_raw()`, `update_parsed()`, `mark_notified()`, `get_deals()` |
| `telegram_listener.py` | Telethon client, `@on(NewMessage)`, skip < 20 chars, dedup by message_id |
| `deal_parser.py` | Gemini 2.5 Flash + `response_schema=ParsedDeal`, classify deal type |
| `notifier.py` | httpx POST to Telegram Bot API + ntfy. Priority based on deal type |
| `main.py` | FastAPI lifespan runs listener + web via `asyncio.create_task()` |

**Test**: Send a deal message in your Telegram group → get a bot DM + phone push within 10 seconds.

### Phase 2: Verification — Check Price at Your Pincode (~3 hrs)

Fetch product URL, extract current price/stock, compare with deal claim.

| File | What |
|------|------|
| `utils/retry.py` | Exponential backoff with jitter |
| `deal_verifier.py` | Platform dispatch + dual approach (API first → page+Gemini fallback) |

**Per-platform approach** (from scraping research):

| Platform | Method | Location | Difficulty |
|----------|--------|----------|-----------|
| **Blinkit** | `POST /v1/layout/product/{prid}` with curl_cffi | `lat`/`lon` headers | Medium |
| **Zepto** | Page fetch with curl_cffi | `lat`/`lng` cookies | Easy |
| **Swiggy Instamart** | Page fetch with curl_cffi | `lat`/`lng` cookies | Hard (silent blocks) |
| **BigBasket** | Page fetch | `x-geolocation-pincode` header | Easy |

All use `markdownify` to convert HTML → markdown (70% token savings) before Gemini extraction.

**Key rule**: Notify even if verification fails. "Unverified" deal > missed deal.

### Phase 3: Web Dashboard (~2 hrs)

Simple FastAPI + Jinja2 + Pico CSS. No build step.

| Route | What |
|-------|------|
| `GET /deals` | Deal cards with platform/status filters, "2m ago" timestamps |
| `GET /deals/{id}` | Full detail: raw message, parsed data, verification result, buy link |
| `GET /settings` | Change pincode, notification prefs |
| `POST /api/verify/{id}` | Manual re-verify button |

Mobile-first layout. Color-coded: green=verified, yellow=pending, red=expired, purple=loot.

### Phase 4: Deploy (~1 hr)

```bash
# One-time: create DB
createdb deal_hunter

# One-time: Telethon phone auth (interactive)
python -m deal_hunter.main   # Enter phone code, creates data/telethon.session

# Install systemd service
sudo cp deal-hunter.service /etc/systemd/system/
sudo systemctl enable --now deal-hunter

# Optional: nginx reverse proxy for your domain
# proxy_pass http://127.0.0.1:8080;
```

systemd unit:
```ini
[Unit]
Description=Deal Hunter
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
MemoryMax=512M

[Install]
WantedBy=multi-user.target
```

---

## Database Schema

Single table. No ORM — raw asyncpg queries.

```sql
CREATE TABLE deals (
    id            SERIAL PRIMARY KEY,
    message_id    BIGINT UNIQUE NOT NULL,    -- Telegram msg ID (dedup key)
    raw_text      TEXT NOT NULL,

    -- Gemini-parsed fields
    product_name  TEXT,
    platform      TEXT,                       -- blinkit/zepto/swiggy/bigbasket/amazon/flipkart
    deal_price    NUMERIC,
    original_price NUMERIC,
    discount_pct  NUMERIC,
    coupon_code   TEXT,
    product_url   TEXT,
    category      TEXT,
    deal_type     TEXT DEFAULT 'deal',        -- deal/loot/price_error/coupon/free
    confidence    REAL,

    -- Verification
    verified      BOOLEAN DEFAULT FALSE,
    verified_at   TIMESTAMPTZ,
    current_price NUMERIC,
    in_stock      BOOLEAN,
    verify_error  TEXT,

    -- Notification
    notified      BOOLEAN DEFAULT FALSE,
    notified_at   TIMESTAMPTZ,

    -- Timestamps
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    expires_at    TIMESTAMPTZ
);

CREATE INDEX idx_deals_created ON deals (created_at DESC);
CREATE INDEX idx_deals_platform ON deals (platform);
```

Pool: `min_size=2, max_size=5` (personal use, no need for more).

---

## Notification Format

**Telegram Bot DM**:
```
🔥 LOOT DEAL

Cadbury Dairy Milk 150g
₹120 → ₹29 (76% OFF)

📍 Blinkit | ✅ In Stock at 560001
🎟 Code: SAVE50

🛒 Buy Now: https://blinkit.com/prn/...
```

**ntfy push**: Priority 5 for loot/price errors (urgent vibrate), 3 for regular deals. Click opens product URL directly.

---

## Key Decisions

1. **Personal tool** — no auth, no multi-tenancy, no rate limit tiers. Single .env config.
2. **Telethon user client** — bots can't read group messages without admin access.
3. **Gemini for everything** — parsing AND verification. One API, one bill (~$0.30/day).
4. **curl_cffi** — Cloudflare TLS bypass. Required for Blinkit, recommended for all.
5. **Notify on failure** — scraping breaks. "Unverified" alert beats missed deal.
6. **No Docker** — systemd + venv. Lower memory footprint on VPS.
7. **Pico CSS** — semantic HTML, zero build step, mobile-responsive.
8. **Public ntfy.sh** — uses FCM, zero battery impact on Android.

---

## Dependencies

```
telethon>=1.40
google-genai>=1.70
fastapi>=0.135
uvicorn[standard]>=0.44
jinja2>=3.1
asyncpg>=0.31
pydantic>=2.12
pydantic-settings>=2.13
curl-cffi>=0.15
httpx>=0.28
markdownify
python-multipart
python-dotenv
```

---

## Research Docs

Detailed research in `docs/research/`:
- `COMPETITORS.md` — Comparify, Toastr, OfferBot analysis + feature comparison
- `TECHNICAL.md` — Telethon, Gemini, asyncpg patterns + code examples
- `ECOSYSTEM.md` — Deal channels, message formats, deeplinks, dashboard UX
- `SCRAPING_DEEP_DIVE.md` — Exact API endpoints, headers, response formats per platform
