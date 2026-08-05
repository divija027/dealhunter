# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Deal Hunter — personal tool (1-3 users) that monitors a Telegram deals group for quick commerce deals (Blinkit, Zepto, Swiggy Instamart, BigBasket), parses them with Gemini AI, verifies price/stock at the user's pincode, and sends notifications via Telegram bot DM + ntfy push.

## Stack

- **Python 3.13**, fully async (asyncio throughout)
- **Telethon** — Telegram user client for reading group messages
- **google-genai** — Gemini 2.5 Flash for deal parsing + page content extraction
- **FastAPI + Jinja2 + Pico CSS** — web dashboard (no build step)
- **PostgreSQL + asyncpg** — data storage (no ORM, raw SQL)
- **curl_cffi** — HTTP with TLS fingerprint impersonation (Cloudflare bypass)
- **httpx** — async HTTP for Telegram Bot API + ntfy notifications
- **systemd** — process management on VPS (no Docker)

## Commands

```bash
# Setup
python -m venv .venv && source .venv/bin/activate
pip install -e .

# Run (first time — interactive Telethon phone auth)
python -m deal_hunter.main

# Run via systemd (after first auth)
sudo systemctl start deal-hunter

# Logs
journalctl -u deal-hunter -f

# Database
createdb deal_hunter                          # one-time
psql deal_hunter -c "SELECT count(*) FROM deals;"
```

## Architecture

Single async process running three concurrent tasks via FastAPI lifespan:

```
┌─ main.py (uvicorn) ──────────────────────────────────────┐
│                                                           │
│  Task 1: telegram_listener.py                             │
│    Telethon client → @on(NewMessage) → process_deal()     │
│                                                           │
│  Task 2: FastAPI web server (web/app.py)                  │
│    Dashboard routes + JSON API                            │
│                                                           │
│  Task 3: periodic_reverify()                              │
│    Re-checks deals verified >1hr ago                      │
└───────────────────────────────────────────────────────────┘
```

### Deal Pipeline

```
Telegram message → deal_parser.py (Gemini) → deal_store.save()
  → deal_verifier.py (curl_cffi + Gemini) → deal_store.update()
  → notifier.py (Telegram bot + ntfy)
```

Each stage can fail independently. Verification failure still triggers notification with "unverified" tag.

### Platform Verification

Each quick commerce platform has different scraping requirements:

| Platform | Location mechanism | Anti-bot | Concurrency limit |
|----------|-------------------|----------|-------------------|
| Blinkit | `lat`/`lon` headers | Cloudflare JA3 (curl_cffi required) | Semaphore(3) |
| Zepto | `lat`/`lng` cookies | Permissive | Semaphore(5) |
| Swiggy Instamart | `lat`/`lng` cookies | Silent circuit-breaking (200 + empty body) | Semaphore(2) |
| BigBasket | `x-geolocation-pincode` header | Minimal | Semaphore(5) |

Blinkit has a direct JSON API at `POST /v1/layout/product/{prid}`. Others use page fetch + markdownify + Gemini extraction.

### Key Patterns

- **Config**: `config.py` uses pydantic-settings `BaseSettings` loading from `.env`. Import as `from deal_hunter.config import settings`.
- **DB**: `db.py` manages a global asyncpg pool. Always use `async with pool.acquire() as conn:` — never hold connections across awaits.
- **Models**: `models.py` Pydantic models serve double duty — data validation AND Gemini `response_schema`.
- **Gemini**: Use `client.aio.models.generate_content()` with `response_schema=PydanticModel`. Access parsed result via `response.parsed`.
- **Scraping**: Always use `curl_cffi.requests.AsyncSession(impersonate="chrome131")`, never plain httpx/requests for product pages.
- **HTML→Markdown**: Run `markdownify(html, strip=["script","style","nav","footer"])` before sending page content to Gemini. Reduces tokens ~70%.

## Design Constraints

- **Personal use only** — no auth, no multi-tenancy, no rate limit tiers, single .env config
- **No Docker** — VPS has memory constraints, use systemd + venv
- **Notify even on failure** — "unverified" notification > missed deal. Scraping is fragile.
- **Swiggy 200 ≠ success** — always validate response body length before trusting Swiggy responses
- **Telethon catch_up=True is broken** — don't use it. Rely on systemd Restart=always for reconnection.

## Research

Detailed research in `docs/research/`:
- `COMPETITORS.md` — Comparify, Toastr, OfferBot feature analysis
- `TECHNICAL.md` — Library patterns, Telethon pitfalls, Gemini structured output, code examples
- `ECOSYSTEM.md` — Deal message formats, deeplink patterns, notification UX
- `SCRAPING_DEEP_DIVE.md` — Exact API endpoints, headers, response formats per platform

<!-- GSD:project-start source:PROJECT.md -->
## Project

**Deal Hunter**

A personal automation tool that monitors a public Telegram deals channel for quick commerce deals (Blinkit, Zepto, Swiggy Instamart, BigBasket), parses them with Gemini AI, verifies price and stock at the user's Bangalore pincode, and sends notifications via Telegram bot DM + ntfy push. Includes a lightweight web dashboard. Built for 1-3 users, not a public service.

**Core Value:** **Never miss a good deal at my pincode.** When a deal is posted in the Telegram channel, I should know about it within 30 seconds — verified if possible, "unverified" if not — so I can act before it expires.

### Constraints

- **Infrastructure**: VPS with memory constraints — no Docker, use systemd + venv
- **Database**: PostgreSQL already installed on VPS — use asyncpg, no ORM
- **Cost**: Use Gemini 2.5 Flash for AI (~$0.30/day for 1000 messages). Free notifications (Telegram bot + ntfy.sh)
- **Anti-scraping**: Quick commerce sites use Cloudflare TLS fingerprinting — must use curl_cffi with Chrome impersonation
- **Notification speed**: Verify first, then notify (10-30 sec acceptable). User prefers verified alerts over speed.
- **Scale**: 1-3 users max. No auth, no scaling concerns.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:STACK.md -->
## Technology Stack

Technology stack not yet documented. Will populate after codebase mapping or first phase.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
