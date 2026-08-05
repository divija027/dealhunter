# Competitor & Ecosystem Analysis - Deal Hunter

**Researched:** 2026-04-08
**Domain:** Indian deal-hunting automation, quick commerce price verification, Telegram deal monitoring
**Confidence:** MEDIUM-HIGH (commercial tools well-documented, internal architectures are inferred)

---

## Executive Summary

The Indian deal-hunting ecosystem is large and fragmented. It spans three distinct segments: (1) **deal aggregation channels** (OfferBot, DesiDime, IndiaFreeStuff) that broadcast deals to mass audiences, (2) **price comparison apps** (Comparify, Toastr, QuickCompare, Dealulu) that let users compare prices across quick commerce platforms, and (3) **open-source price trackers** (Pricegram, PriceTrackerBot) that track individual product prices on Amazon/Flipkart.

**Critical gap our project fills:** No existing tool combines Telegram group monitoring + AI-powered deal parsing + pincode-specific verification + personal notification. Every existing tool either requires manual product input (price trackers), broadcasts to mass audiences without personalization (deal channels), or compares prices without monitoring deal sources (comparison apps). Our Deal Hunter is uniquely positioned as a **personal deal verification pipeline** -- it listens to a curated Telegram deals group, understands what's being posted via Gemini, verifies at YOUR pincode, and notifies YOU.

---

## Competitor Analysis

### 1. Comparify

**What it is:** India's leading cab fare + grocery price comparison app. Compares live prices across 8+ quick commerce platforms.

**Website:** https://comparify.pro/
**Platforms:** Android, iOS, Web
**Developer:** Akshat Kejriwal
**Rating:** 4.8/5 (500+ reviews)
**Pricing:** Free

**Features:**
- Real-time grocery price comparison across Blinkit, Swiggy Instamart, Zepto, BigBasket, Flipkart Minutes, JioMart, MilkBasket, DMart
- Per gram/ml price normalization (catches hidden markups on different pack sizes)
- Shopping list builder with total savings across stores
- Cab fare comparison (Uber, Ola, Rapido, Namma Yatri) using actual account prices
- One-tap deep-link to purchase on the chosen platform
- Savings tracking over time

**How it likely works (inferred -- no public tech docs):**
- Mobile app intercepts or calls the internal APIs of each quick commerce platform
- Uses user's actual location (GPS) to fetch location-specific pricing
- Likely uses account-level cookies/tokens for "account-specific deals" feature (their marketing claims this)
- React-based frontend (observed from stylesheet structure)

**What they get right:**
- Per-unit price normalization is brilliant -- different pack sizes at different per-gram prices is a real quick commerce trap
- Account-specific pricing (uses your actual coupons/credits)
- Broad platform coverage (8 platforms)

**What they get wrong / limitations:**
- No deal monitoring -- purely on-demand comparison
- No Telegram integration
- No notification system for price drops
- Manas Saloi (prominent Indian PM) criticized the model: "base price does not determine the final price you pay" -- add-on fees, delivery charges, platform fees vary by user segment and are invisible to scrapers
- No deal curation -- user must know what they want to compare

**Relevance to our project: LOW-MEDIUM.** Comparify solves a different problem (comparison shopping) vs. our project (deal monitoring + verification). However, their per-unit normalization approach is worth adopting for deal quality scoring.

---

### 2. Toastr

**What it is:** India's food delivery price comparison app. Compares restaurant/food prices across Zomato and Swiggy, plus grocery prices across quick commerce platforms.

**Website:** https://toastr.in/
**Platforms:** Android, iOS
**Developer:** Aman Tiwari (AT Innovations)
**Coverage:** 800+ Indian cities, 300+ pincodes
**Pricing:** Free

**Features:**
- Real-time food delivery price comparison (Swiggy vs Zomato)
- Grocery comparison across Blinkit, Swiggy Instamart, Zepto, JioMart, BigBasket
- Smart cart comparison (add items, see total across platforms)
- 80,000+ carts compared (as of 2026)
- Featured in NDTV Profit and MSN

**How it likely works (inferred):**
- Reverse-engineers Swiggy and Zomato APIs for restaurant pricing
- Uses location/pincode to fetch area-specific pricing
- Likely similar API-interception approach as Comparify for grocery platforms

**User feedback (from app store reviews):**
- Positive: "accurate prices," good product matching across platforms
- Negative: limited account connectivity, iOS functionality issues, not all restaurants matched correctly

**What they get right:**
- Cart-level comparison (not just individual items) -- total cost including fees matters more than item price
- Cross-category (food + groceries) in one app
- Wide pincode coverage

**What they get wrong / limitations:**
- Same as Comparify: no deal monitoring, no Telegram integration
- Restaurant menu matching across platforms is imperfect
- No notification/alerting system
- Passive tool -- requires user to actively compare

**Relevance to our project: LOW.** Toastr is primarily food delivery focused. The grocery comparison is secondary. No overlap with our deal monitoring + verification pipeline.

---

### 3. OfferBot

**What it is:** India's fastest deal alert service. Monitors 50+ e-commerce sites and sends verified deal alerts via Telegram and WhatsApp.

**Website:** https://offerbot.in/
**Telegram:** Active channel with 100,000+ subscribers
**Contact:** pankaj.jain@offerbot.in
**Pricing:** Free (monetized via affiliate links)

**Features:**
- Monitors 50+ Indian e-commerce sites (Amazon, Flipkart, Myntra, Ajio, Nykaa, BigBasket, Swiggy Instamart, Zepto)
- Alert speed: 28-35 seconds (claimed 3-5x faster than DesiDime and GrabOn)
- 100% deal verification claim -- every deal checked for price accuracy, stock availability, genuineness
- Combined automated + manual verification before sending
- 5,000+ daily deals across 8 categories
- No spam, no fake discounts, no shortened/affiliate-manipulated URLs
- Category filtering for subscribers
- Average user savings: Rs 2,400/month

**How it works (from their about page):**
1. AI-powered monitoring system scans retailers 24/7
2. Automated checks verify price accuracy + stock availability + genuine discount (vs. inflated MRP)
3. Manual review layer catches edge cases
4. Instant distribution to Telegram/WhatsApp within 30 seconds

**Verification approach (key insight for our project):**
- OfferBot verifies deals are "actually better than regular prices" -- they compare current deal price against historical/regular pricing
- They check stock availability (not just price)
- They remove "fake deals" where MRP was inflated before discount
- Combined automated + manual process

**Business model:** Affiliate commissions. They state: "we earn a small commission at no extra cost to you" but "never promote a deal just because it pays more."

**What they get right:**
- Speed (28-35 sec) is genuinely impressive for deal alerting
- Verification before sending builds trust
- Telegram + WhatsApp dual distribution
- Category filtering reduces noise

**What they get wrong / limitations:**
- Mass broadcast -- not personalized to your pincode/location
- No quick commerce pincode-specific verification (they track prices but not availability at YOUR location)
- 5,000 daily deals = information overload even with filtering
- Affiliate model means incentive alignment issues (they say they don't, but structural incentive exists)
- No personal dashboard or deal history
- Cannot verify quick commerce deals at specific pincodes

**Relevance to our project: HIGH.** OfferBot is the closest competitor to what we're building, but operates at mass scale with no pincode personalization. Our key differentiator is pincode-specific verification + personal curation from a trusted Telegram group (not mass scraping).

---

### 4. QuickCompare

**What it is:** Dedicated quick commerce price comparison website and app.

**Website:** https://quickcompare.in/
**Platforms:** Android, Web
**Coverage:** Major Indian cities

**Features:**
- Compare prices across Swiggy Instamart, Zepto, Blinkit, Flipkart Minutes, BigBasket
- Delivery time comparison
- Cart optimization (distributes items across platforms for lowest total)
- Enter delivery area + product -> get all options

**Architecture insight (from Medium case study):**
- Enter location -> fetch real-time data from multiple APIs -> display comparative pricing
- Cart calculator finds most cost-effective distribution across platforms
- Product standardization with consistent quantity/unit display

**What they get right:**
- Cart optimization across platforms is genuinely useful
- Delivery time as a comparison axis (not just price)
- Product standardization eliminates confusion

**Relevance to our project: LOW.** On-demand comparison tool, no monitoring or alerting.

---

### 5. Dealulu

**What it is:** Quick commerce shopping assistant app.

**Website:** https://www.dealulu.in/
**Platforms:** Android, iOS
**Developer:** Vishal Chopra

**Features:**
- Price comparison across Blinkit, Swiggy Instamart, Zepto, BigBasket
- Shopping list management
- Transparent fee display (shows all charges before purchase)
- Single-tap deep-link checkout to preferred platform
- Recent search tracking

**Relevance to our project: LOW.** Another comparison shopping app, no deal monitoring.

---

### 6. Buyhatke / Price History

**What it is:** India's most established price tracking platform. Browser extension + app for Amazon, Flipkart, Myntra price history.

**Website:** https://buyhatke.com/
**Users:** Millions (established since ~2013)

**Features:**
- 3-month price history graph for any product
- Price drop alerts (email, SMS, app notification, Telegram bot)
- Cross-platform price comparison (50+ online stores)
- Coupon auto-discovery at checkout
- "Lookalike" feature (find cheaper alternatives)
- "Spend Lens" (track lifetime spending)
- Recently added grocery comparison (Blinkit, Zepto, Instamart)

**How it works:**
- Browser extension intercepts product pages and shows price history overlay
- Backend scrapes prices on schedule (at least daily)
- Telegram bot (@buyhatke_bot) sends price drop alerts
- Uses affiliate links for monetization

**What they get right:**
- Price HISTORY is incredibly valuable -- shows if a "deal" is actually a deal or just regular pricing
- Chrome extension UX is seamless (shows history right on the product page)
- Telegram bot integration for alerts
- Massive dataset from years of tracking

**Relevance to our project: MEDIUM.** Their price history concept is directly applicable -- we should track deal prices over time to detect fake "discounts" where MRP was inflated. Their Telegram bot pattern is similar to our notification approach.

---

### 7. DesiDime / Deal Blast (IndiaFreeStuff)

**What it is:** Community-driven deal sharing platform + Telegram channel.

**DesiDime Telegram:** Avg alert speed 2 min 40 sec, 75K+ subscribers, 8% deal inaccuracy rate
**IndiaFreeStuff/DealBlast:** 100-200+ curated deals/day, 1200+ across all channels

**How Telegram deal channels work (from community discussion):**
1. **Web scraping** -- Python scripts scrape Flipkart, Amazon for price drops
2. **Affiliate API access** -- Special API endpoints for affiliate partners
3. **Cross-channel forwarding** -- Bots forward deals between channels, swapping affiliate links
4. **Manual curation** -- Some channels have human deal hunters

**Key community insight (DesiDime forum):**
> "They do web scraping. If you have python + some level of coding knowledge you also can get deals ahead of the telegram channels. They scrap out data from Flipkart, Amazon and more e-commerce platforms."

**Performance comparison (from OfferBot's analysis):**

| Channel | Alert Speed | Verification | Accuracy | Monthly Savings |
|---------|-------------|-------------|----------|-----------------|
| OfferBot | 30 sec | 100% | 100% | Rs 2,400 |
| DesiDime | 2-3 min | Partial | 92% | Rs 1,800 |
| CouponDunia | 3-5 min | Partial | ~95% | Rs 1,500 |
| GrabOn | 5-10 min | No | ~85% | Rs 1,200 |
| IndiaDeals24 | 10-15 min | No | ~80% | Rs 900 |

*Note: This data is from OfferBot's own blog, so take accuracy claims with salt. But relative rankings are likely directionally correct.*

**Relevance to our project: HIGH.** These are the Telegram groups our tool will likely monitor. Understanding their posting patterns, deal format, and accuracy rates is directly relevant.

---

### 8. Open Source Projects on GitHub

#### a) Blinkit-Zepto-product-backend
**Repo:** https://github.com/iamonjarvis/Blinkit-Zepto-product-backend
**Stack:** Node.js, Puppeteer, Express
**Stars:** 5

- Uses Puppeteer (headless Chrome) to scrape Blinkit and Zepto
- `POST /search-all` endpoint accepts `{location, product}` -> returns prices from both
- Location handling: accepts location string, sets it in the headless browser
- Runs in headless mode for efficiency, concurrent scraping of both platforms

**Key insight:** They use Puppeteer (browser automation) not direct API calls. This suggests direct API interception is fragile and browser-level scraping is more reliable for quick commerce.

#### b) QuickCom
**Repo:** https://github.com/KshKnsl/QuickCom
**Stack:** Node.js, Express, Puppeteer, WebSocket, React, TypeScript, Tailwind, Vite

- Full-stack app scraping Blinkit, Zepto, Swiggy Instamart
- **Critical architecture insight:** Each platform has dedicated `searchHelpers.js` + `set-location.js` modules
- WebSocket for real-time streaming of results as they're discovered
- Per-platform location setting (each platform handles location differently)

**Key insight:** The `set-location.js` per platform confirms that location handling is platform-specific and complex. Each platform has its own mechanism for setting delivery location.

#### c) trivagro
**Repo:** https://github.com/monizb/trivagro
**Stack:** JavaScript, Bun

- Compares Blinkit, BigBasket, Zepto, Instamart
- **Critical limitation acknowledged:** "Backend is needed to bypass CORS rules from the various APIs being used"
- Location is currently **hardcoded** -- roadmap item to make dynamic
- Developers note: "Capture curl requests from all the mentioned websites for their search endpoints and replace it in code to match your location"
- Product matching across platforms is acknowledged as a hard problem

**Key insight:** This project confirms the reverse-engineering approach: capture network requests from browser dev tools, extract API endpoints, replay with different parameters. Also confirms location is the hardest part.

#### d) Pricegram
**Repo:** https://github.com/AleG94/Pricegram
**Stack:** Node.js, MongoDB, Docker
**Stars:** Notable

- Telegram bot tracking Amazon prices
- 2-hour polling interval by default (configurable)
- Tracks price changes + availability changes
- User commands: /track (add URL), /list (manage), target price thresholds
- Cheerio for HTML parsing, Mongoose for MongoDB

**Key insight:** Simple, effective architecture. Poll-based (not event-driven). MongoDB for price history. Configurable polling interval is smart.

#### e) PriceTrackerBot
**Repo:** https://github.com/nuhmanpk/PriceTrackerBot
**Stack:** Python, MongoDB, Telethon

- Supports Flipkart + Amazon
- Uses Telethon (same library we're using)
- MongoDB for persistence
- Deploy to Koyeb with one click

---

## Feature Comparison Table

| Feature | Our Deal Hunter | OfferBot | Comparify | Toastr | QuickCompare | Buyhatke |
|---------|----------------|----------|-----------|--------|--------------|----------|
| **Telegram group monitoring** | Yes (Telethon) | No (scrapes directly) | No | No | No | No |
| **AI deal parsing** | Yes (Gemini) | Yes (proprietary) | No | No | No | No |
| **Pincode verification** | Yes (curl_cffi) | No | Yes (app) | Yes (app) | Yes (web) | No |
| **Personal notification** | Yes (bot DM + ntfy) | Broadcast only | No | No | No | Telegram bot |
| **Quick commerce focus** | Yes | Partial | Yes | Yes | Yes | Recently added |
| **Price history** | No (could add) | Unknown | No | No | No | Yes (3 months) |
| **Per-unit normalization** | No (should add) | Unknown | Yes | No | Unknown | No |
| **Deal verification** | Yes (price+stock) | Yes (price+stock) | N/A | N/A | N/A | Price only |
| **Web dashboard** | Yes (FastAPI) | No | App only | App only | Yes | Browser ext |
| **Self-hosted** | Yes | No | No | No | No | No |
| **Open source** | Yes | No | No | No | No | No |
| **Platforms monitored** | Via group deals | 50+ sites | 8 QC apps | 7 apps | 5 QC apps | 50+ stores |
| **Cost** | Free (self-hosted) | Free (ads) | Free | Free | Free | Free |

---

## Architecture Patterns (What Works)

### 1. Platform-Specific Location Modules
**Evidence:** QuickCom (GitHub) has separate `set-location.js` for each platform. Comparify handles 8 platforms. Every quick commerce platform handles location differently.

**Pattern:** Create a per-platform location adapter with a common interface:
```
class PlatformAdapter:
    async def set_location(pincode, lat, lng) -> session_context
    async def verify_product(url, session_context) -> VerifyResult
```

Each platform (Blinkit, Zepto, Instamart, BigBasket) gets its own implementation because:
- **Blinkit:** Needs lat/lng coordinates, sends via headers
- **Zepto:** Needs lat/lng, sends via different headers/cookies
- **Swiggy Instamart:** Needs location cookies
- **BigBasket:** Uses pincode directly

### 2. Hybrid Scraping (API Interception + Browser Fallback)
**Evidence:** curl_cffi (our planned tool) achieves 80% success rate on Cloudflare-protected sites. Puppeteer-based projects (QuickCom, Blinkit-Zepto-backend) use browser automation as fallback.

**Pattern:** Try API-level request first (faster, lighter), fall back to headless browser for platforms that block it. Our curl_cffi with Chrome TLS impersonation is the right first choice.

### 3. LLM-Based Data Extraction Over CSS Selectors
**Evidence:** Multiple Gemini web scraping guides confirm that LLM extraction is more resilient than CSS selectors for price/stock extraction. Quick commerce sites change layouts frequently. Gemini can handle layout changes without code updates.

**Pattern:** Fetch page -> convert to markdown (reduce tokens) -> send to Gemini -> extract structured data. This is exactly our planned approach and it's validated by the ecosystem.

### 4. Speed Matters -- Sub-30-Second Alert Pipeline
**Evidence:** OfferBot's competitive advantage is 28-35 second alerts. DesiDime at 2-3 minutes already loses 18% of lightning deals. At 5-10 minutes (GrabOn), 35% of deals are gone.

**Pattern:** Optimize the entire pipeline for speed:
- Telegram listener: instant (event-driven via Telethon)
- Gemini parsing: ~1-2 sec
- Verification: ~3-5 sec per platform
- Notification: ~1 sec
- Target: deal detected to notification in under 15 seconds

### 5. Verify Before Notify (But Don't Block on Failure)
**Evidence:** OfferBot's 100% verification is their strongest selling point. DesiDime's 8% inaccuracy erodes trust. But OfferBot's verification is NOT pincode-specific.

**Pattern:** Verify when possible, send "unverified" alert when verification fails. Our plan already does this. Never let a verification failure cause a missed deal notification.

---

## Common Pitfalls (What Doesn't Work)

### 1. Assuming Base Price = Final Price
**What goes wrong:** Quick commerce platforms add delivery fees, platform fees, handling charges, and subtract credits/coupons at checkout. The product page price is NOT the final price.
**Who fell into this:** Manas Saloi documented this about QuickCompare. All comparison apps show product prices, not cart totals.
**How we handle it:** For deal verification, focus on: (a) is the product available, (b) is the price at or below what the deal claims, (c) is it in stock. Don't try to compute final cart price -- that's a different product.

### 2. Hardcoding Location
**What goes wrong:** Location is the hardest part of quick commerce scraping. trivagro (GitHub) has location hardcoded. Apps that don't handle dynamic location are useless for personal use.
**How we handle it:** Config-driven pincode + lat/lng. Platform-specific location headers/cookies set per request. Our `.env` approach with USER_PINCODE, USER_LAT, USER_LNG is correct.

### 3. Relying on CSS Selectors for Price Extraction
**What goes wrong:** Quick commerce sites change their DOM constantly. CSS selectors break weekly. Traditional scrapers need constant maintenance.
**Evidence:** Multiple scraping service companies exist specifically because DIY selectors break too fast.
**How we handle it:** Gemini-based extraction. Feed the page content to Gemini, ask for structured price/stock data. Adapts to layout changes automatically.

### 4. Not Handling Platform-Specific Anti-Bot Measures
**What goes wrong:** Blinkit, Zepto, and Swiggy all use Cloudflare or similar anti-bot protection. Standard requests library gets blocked instantly. Even curl_cffi gets blocked 20% of the time on some sites.
**Evidence:** curl_cffi docs: 80% success rate on Cloudflare. Multiple scraping service companies advertise "bypass" as a key feature.
**How we handle it:** curl_cffi with Chrome TLS fingerprinting is the right first approach. Add retry with exponential backoff. Consider rotating User-Agent strings. Accept that verification will sometimes fail (our "unverified" notification handles this gracefully).

### 5. Over-Notifying (Deal Fatigue)
**What goes wrong:** OfferBot sends 5,000+ deals/day. Even with filtering, this causes notification fatigue. Users mute the channel.
**Evidence:** IndiaFreeStuff splits into Main Channel (100+ deals) vs. Loot Channel (2-5 deals) specifically to address this.
**How we handle it:** Our tool monitors a CURATED group (already filtered by group admins). We only notify for deals that verify at the user's pincode. Double filtering = much less noise.

### 6. Ignoring Deal Expiry
**What goes wrong:** Lightning deals and price errors expire within minutes. A notification that arrives 10+ minutes late is worse than no notification (user clicks, sees different price, loses trust).
**Evidence:** GrabOn's 5-10 minute delay means 35% of deals are expired on arrival.
**How we handle it:** Optimize for speed. Consider adding `expires_at` field and auto-expiring deals from the dashboard.

---

## Technical Approach to Pincode-Specific Verification

This is the hardest technical challenge and the key differentiator of our project. Here's what the ecosystem reveals:

### How Quick Commerce APIs Handle Location

**Blinkit:**
- No public API. Internal APIs discovered via network inspection.
- Location set via lat/lng in request headers
- Session-based authentication tokens
- Cloudflare protected
- Data points: product ID, name, MRP, selling price, delivery ETA, stock count, merchant/warehouse ID

**Zepto:**
- No public API. Internal APIs via network inspection.
- Location set via lat/lng parameters (format: `?lat=${lat}&lng=${lng}`)
- Session tokens for authentication
- Returns: product details, pricing, availability, delivery ETA by location

**Swiggy Instamart:**
- No public API. Internal APIs via network inspection.
- Location via lat/lng in URL parameters
- Cookie-based session management
- Returns JSON with product data

**BigBasket:**
- More straightforward -- pincode can be set directly
- Less aggressive anti-bot measures
- Returns standard product + availability data

### Our Verification Strategy

1. **curl_cffi with Chrome TLS impersonation** -- first attempt for all platforms
2. **Set location via platform-specific headers/cookies** -- each platform adapter handles this
3. **Fetch product page/API response** -- get raw HTML or JSON
4. **Feed to Gemini for extraction** -- "What is the current price and stock status?"
5. **Compare against deal claims** -- price match? in stock? available at pincode?
6. **Retry with backoff on failure** -- 3 retries with exponential backoff + jitter
7. **Send notification regardless** -- verified or "unverified" tag

### Anti-Bot Countermeasures

| Measure | Platform | Our Counter |
|---------|----------|-------------|
| Cloudflare TLS fingerprinting | Blinkit, Zepto | curl_cffi Chrome impersonation |
| Rate limiting | All platforms | asyncio.Semaphore(10) + delays |
| Session tokens | Blinkit, Zepto | Maintain session cookies per request |
| CAPTCHA/JS challenges | Occasional | Accept failure, send "unverified" |
| Endpoint changes | All platforms | Gemini extraction adapts; endpoints need manual update |

---

## Recommendations for Deal Hunter

### Features to Adopt

1. **Per-unit price normalization (from Comparify)** -- When parsing deals, calculate per-gram or per-ml price. Many "deals" are just different pack sizes at worse per-unit rates. Add `price_per_unit` field to ParsedDeal model. LOW effort, HIGH value.

2. **Deal genuineness check (from OfferBot)** -- Track prices over time in PostgreSQL. Flag deals where the "original price" was recently inflated (fake MRP trick). Compare deal price against 30-day average. MEDIUM effort, HIGH trust value.

3. **Speed optimization target: under 15 seconds (from OfferBot's 28-35 sec benchmark)** -- Our pipeline should be faster since we skip the mass scraping step (we listen to a pre-curated group). Target: Telegram message received -> notification sent in <15 seconds.

4. **Category filtering for notifications (from OfferBot)** -- Add a settings field for categories the user cares about. Skip deals in irrelevant categories. LOW effort via config.

5. **Dual-channel notification (from OfferBot)** -- We already have Telegram bot DM + ntfy. This matches OfferBot's Telegram + WhatsApp dual approach. Keep both.

### Features to Skip

1. **Mass e-commerce scraping (OfferBot approach)** -- We monitor a curated Telegram group, not 50+ websites. This is intentional -- the group does the curation for us. Don't add direct site monitoring.

2. **Cart-level price comparison (Comparify/Toastr approach)** -- This is a different product. We verify individual deals, not compare shopping carts. Adding cart optimization would dilute focus.

3. **Browser extension (Buyhatke approach)** -- Overkill for a personal tool. The Telegram bot + ntfy + web dashboard is sufficient.

4. **Multi-user support** -- This is a personal tool. Don't architect for multi-tenancy. Single pincode, single user, single notification target.

5. **Affiliate link injection** -- We're not monetizing. Keep deal links clean and original.

### Technical Approaches to Steal

1. **Per-platform location adapters (from QuickCom)** -- Each platform gets its own module for setting location and verifying products. Common interface, platform-specific implementation. This is the right architecture.

2. **HTML-to-markdown before LLM extraction (from Gemini scraping guides)** -- Convert fetched HTML to markdown using `markdownify` or similar before sending to Gemini. This reduces token count by 60-80% and improves extraction accuracy. Add `markdownify` to dependencies.

3. **Concurrent platform verification (from QuickCom's WebSocket streaming)** -- When a deal could be on multiple platforms (or when we want to check alternatives), verify concurrently with `asyncio.gather()`. Our plan already uses this pattern.

4. **Product matching heuristics (from trivagro's acknowledged limitation)** -- Product names differ across platforms. When verifying, match on: URL (exact match), product name (fuzzy), brand + weight/quantity. Use Gemini to confirm match.

### Mistakes to Avoid

1. **Don't rely on a single scraping approach** -- curl_cffi is great but has 20% failure rate on Cloudflare. Build the system to degrade gracefully. "Unverified" notification is better than no notification.

2. **Don't try to compute final cart price** -- Focus on product-level price verification. Cart-level pricing (delivery fees, platform fees, coupons) varies by user and is impossible to compute without the user's actual account.

3. **Don't poll platforms on a schedule** -- We don't need to. We're event-driven: a deal appears in Telegram -> we verify it. No need for 2-hour polling intervals like Pricegram. React to events, don't poll.

4. **Don't ignore the "fresh deal" window** -- Quick commerce deals and price errors last minutes, not hours. The re-verification background task should check recent deals (<1 hour) more frequently and older deals less frequently.

5. **Don't hardcode API endpoints** -- Quick commerce APIs change frequently. Move endpoint URLs and header configurations to a config file or database so they can be updated without code changes.

---

## State of the Art Summary

| Dimension | Current Best | Who | Our Target |
|-----------|-------------|-----|------------|
| Alert speed | 28-35 sec | OfferBot | <15 sec (smaller scope) |
| Verification accuracy | "100%" | OfferBot | High (pincode-specific) |
| Pincode specificity | App-level only | Comparify/Toastr | Full pipeline verification |
| Platform coverage (QC) | 8 platforms | Comparify | 4 platforms (Blinkit, Zepto, Instamart, BB) |
| AI parsing | Proprietary | OfferBot | Gemini 2.5 Flash |
| Self-hosted personal use | None found | - | Our unique position |
| Price history | 3 months | Buyhatke | Could add (PostgreSQL) |
| Per-unit normalization | Yes | Comparify | Should add |

---

## Open Questions

1. **Exact API endpoints for Blinkit/Zepto/Instamart** -- No public documentation exists. These must be reverse-engineered by inspecting network traffic in browser dev tools. This is a Phase 2 task requiring manual investigation per platform.

2. **How often do quick commerce API endpoints change?** -- Commercial scraping services exist (FoodSpark, Apify scrapers) specifically because these endpoints are unstable. Budget time for maintenance.

3. **Rate limits per platform** -- Unknown without testing. Start conservative (Semaphore(10) is our plan) and adjust based on observed blocking patterns.

4. **Session token lifecycle** -- How long do Blinkit/Zepto sessions last before requiring re-authentication? Must be tested empirically.

---

## Sources

### Primary (HIGH confidence)
- [Comparify website](https://comparify.pro/) - Features, pricing, platforms
- [Toastr website](https://toastr.in/) - Features, platforms, coverage
- [OfferBot website](https://offerbot.in/) - Features, verification claims, alert speed
- [OfferBot about page](https://offerbot.in/about) - Business model, verification process
- [OfferBot blog - channel comparison](https://offerbot.in/blog/best-deal-telegram-channels-india-comparison) - Speed/accuracy metrics
- [Buyhatke website](https://buyhatke.com/) - Features, price history, grocery addition

### Secondary (MEDIUM confidence)
- [QuickCom GitHub](https://github.com/KshKnsl/QuickCom) - Architecture, per-platform location modules
- [Blinkit-Zepto-backend GitHub](https://github.com/iamonjarvis/Blinkit-Zepto-product-backend) - Puppeteer scraping approach
- [trivagro GitHub](https://github.com/monizb/trivagro) - Location hardcoding challenge, API reverse engineering
- [Pricegram GitHub](https://github.com/AleG94/Pricegram) - Poll-based architecture, MongoDB schema
- [PriceTrackerBot GitHub](https://github.com/nuhmanpk/PriceTrackerBot) - Python + Telethon + MongoDB
- [Open Source For You article](https://www.opensourceforu.com/2026/02/building-a-real-time-grocery-price-comparison-system/) - FastAPI + Selenium + Docker architecture
- [Manas Saloi blog post](https://manassaloi.com/2025/02/17/quick-commerce-price-comparison.html) - Criticism of comparison model
- [DesiDime community discussion](https://www.desidime.com/discussions/how-do-telegram-channel-admins-get-to-know-about-price-drop-loot-deals-etc) - How deal channels work technically

### Tertiary (LOW confidence - marketing claims, needs validation)
- [Dealulu website](https://www.dealulu.in/) - Features
- [QuickCompare website](https://quickcompare.in/) - Features
- [curl_cffi docs](https://curl-cffi.readthedocs.io/) - 80% Cloudflare bypass rate
- [DealMorph dev.to](https://dev.to/omniradhanexus/dealmorph-automate-telegram-bot-7f3) - Telegram automation claims
- [Gemini web scraping guides](https://crawlbase.com/blog/how-to-leverage-gemini-ai-for-web-scraping/) - LLM extraction approach
- Various scraping service marketing pages (FoodSpark, Apify, ActowizSolutions) - API structure claims
