# Indian Deal Ecosystem and UX Research

**Researched:** 2026-04-08
**Domain:** Indian deal-hunting communities, quick commerce deals, notification UX, deeplink patterns
**Confidence:** MEDIUM-HIGH (primary sources verified, some deeplink details inferred from platform configs)

---

## Indian Deal Ecosystem Overview

### Market Landscape

India's deal-hunting community is massive and primarily lives on Telegram. The ecosystem is driven by quick commerce platforms (Blinkit, Zepto, Swiggy Instamart) competing for market share through aggressive discounting, alongside traditional e-commerce sales (Amazon, Flipkart, Myntra). Blinkit holds over 50% market share in quick commerce as of late 2025, with Zepto and Swiggy Instamart fighting for the No. 2 position.

### Major Telegram Deal Channels

| Channel | Subscribers | Posts/Day | Focus |
|---------|------------|-----------|-------|
| GrowDealz | ~2.4M (main) + 233K (alt) | 21-26 | All e-commerce deals |
| No Big Deals | 65K+ | High | Electronics, fashion, home, personal care |
| IndiaDesire / IDOffers | Large | Active | Price errors, loot deals across platforms |
| Swiggy/Blinkit/Zepto Loots | Medium | Active | Quick commerce specific deals |
| CoolzTricks | 320K+ | Active | Loot deals, earning tricks |
| ExtraPe | 26K+ | Moderate | Verified genuine deals |

**Key insight:** The largest channels (GrowDealz at 2.4M) post 20-26 messages per day. Many are affiliate-driven -- admins automate scraping, change links to their affiliate tags, and forward deals. This means deal messages follow semi-structured patterns that are parseable.

### Message Volume and Signal-to-Noise

- **Estimated 20-50 messages/day** in active deal channels
- **Deal-to-chatter ratio varies wildly**: Channels (one-way broadcast) are almost 100% deals; groups (two-way) can be 30-50% chatter
- **Quick commerce loot channels** tend to be higher signal -- most messages are deals with direct buy links
- **Affiliate link presence**: Most deal messages include affiliate-tagged URLs (fkrt.co, amzn.to, shortened links)

### Pricing Dynamics

Quick commerce platforms change prices every millisecond -- products can drop from Rs 60 to Rs 55 between page refreshes. This extreme volatility creates:
- **Price error windows**: When a product is mispriced, it gets corrected within minutes
- **Flash deal timing**: Specific windows exist (e.g., Swiggy Instamart daily 9:00-9:20 PM for discounted produce at Rs 9-19)
- **Stock-limited loot**: Deals go OOS (out of stock) before price correction happens

---

## Deal Message Taxonomy

### Common Deal Message Formats

Based on analysis of multiple Telegram channels, deal messages fall into these patterns:

#### Pattern 1: Direct Product Deal (Most Common)
```
[emoji] [Product Name] [specs/size]
[Platform]: Rs [deal_price] (MRP Rs [original_price])
[discount_pct]% OFF
[Link]
[Optional: Coupon code]
[Optional: "Limited stock" / "Price error"]
```

Example:
```
🔥 Jensons Iron Roti Tawa | 25 cm
Blinkit: ₹149 (MRP ₹399)
63% OFF
https://blinkit.com/prn/...
Apply code: SAVE50
⚡ Limited stock - Order fast!
```

#### Pattern 2: Search-Based Deal (Quick Commerce)
```
[Platform] Loot [price] / Search: [product/brand]
[City availability]
[Optional: Coupon/bank offer]
```

Example:
```
Zepto Loot ₹10 / Search: Head & Shoulders
Delhi Available
Use HDFC card for extra 10% off
```

#### Pattern 3: Coupon Stack Deal
```
[Platform] [Sale Name]
[Base discount]
+ [Coupon code] for extra [X]% off
+ [Bank offer] for additional [Y]% off
= Effective price: Rs [final_price]
[Link]
```

Example:
```
Amazon Great Indian Festival
Boat Rockerz 450: ₹999 (MRP ₹2,990)
+ Code ELECTRONICS10 for extra 10%
+ SBI Card 10% instant discount
= Effective: ₹809
https://amzn.to/xxx
```

#### Pattern 4: Free/Loot Deal
```
🚨 LOOT DEAL / FREE / PRICE ERROR
[Product] at ₹[price] (or FREE)
[Platform]
[Link]
⚡ Grab fast before stock ends / price corrects!
```

### Fields to Parse For (Gemini Extraction Targets)

| Field | Priority | Where Found | Notes |
|-------|----------|-------------|-------|
| product_name | HIGH | First line usually | May include brand, size, specs |
| platform | HIGH | Explicit or inferred from URL | blinkit.com, zepto.co, swiggy.com, amzn.to, fkrt.co |
| deal_price | HIGH | Rs/₹ followed by number | Sometimes "at ₹X" or just "₹X" |
| original_price (MRP) | MEDIUM | "MRP ₹X" or "(₹X)" | Not always present |
| discount_pct | MEDIUM | "X% OFF" or "X% off" | Can be calculated if prices given |
| product_url | HIGH | URL in message | May be shortened (amzn.to, fkrt.co, bit.ly) |
| coupon_code | MEDIUM | "Code: X" or "Use X" | ALL CAPS typically |
| category | LOW | Inferred from product name | Electronics, grocery, fashion, etc. |
| city/location | MEDIUM | "Delhi Available" etc. | Important for quick commerce |
| deal_type | HIGH | Keywords: "loot", "price error", "free", "cashback" | Critical for priority scoring |
| expiry_signal | MEDIUM | "Limited stock", "Grab fast", time mentions | Urgency classification |
| bank_offer | LOW | "SBI/HDFC/ICICI X% off" | Stacking info |

### Deal Type Classification (for Gemini prompt)

| Type | Keywords | Urgency | Typical Duration |
|------|----------|---------|-----------------|
| **Price Error** | "price error", "glitch", "mistake", "loot" | CRITICAL (minutes) | 5-30 minutes |
| **Flash Deal** | "flash", "limited time", "ends in" | HIGH (hours) | 1-6 hours |
| **Coupon Deal** | "use code", "coupon", "apply" | MEDIUM (days) | 1-7 days |
| **Sale Price** | "sale", "% off", "discount" | NORMAL (days-weeks) | During sale period |
| **Cashback** | "cashback", "CB", "bank offer" | LOW (weeks) | Ongoing promo |
| **Free Sample** | "free", "sample", "₹0", "₹1" | HIGH (hours) | Until stock lasts |

---

## Notification UX Best Practices

### What Makes a Good Deal Notification

Based on analysis of DesiDime, Loot91, and notification UX research:

#### Information Hierarchy (in order)
1. **Deal type + urgency indicator** (emoji: fire for loot, clock for expiring)
2. **Product name** (concise, include brand)
3. **Price** (deal price prominent, MRP struck through or secondary)
4. **Discount percentage** (quick scanability)
5. **Platform** (which app to open)
6. **Action** (one-tap buy link)
7. **Expiry signal** (if time-limited)

#### Optimal Notification Format (ntfy)

```
Title: 🔥 LOOT: Cadbury Dairy Milk 150g
Body: ₹29 (MRP ₹120) | 76% OFF
      Blinkit | Limited Stock
Priority: 4 (high) or 5 (urgent for price errors)
Click: https://blinkit.com/prn/cadbury-dairy-milk/...
Tags: fire,blinkit,grocery
Actions: view, Buy Now, https://blinkit.com/prn/...
```

#### Optimal Telegram Bot Notification Format

```markdown
🔥 *LOOT DEAL*

*Cadbury Dairy Milk 150g*
~~₹120~~ → *₹29* (76% OFF)

📍 Blinkit | ✅ In Stock
⏰ Price error - grab fast!

🛒 [Buy Now](https://blinkit.com/prn/...)
```

### ntfy Best Practices for Deal Alerts

ntfy supports rich notification features ideal for deal alerts:

| Feature | How to Use | Deal Alert Application |
|---------|-----------|----------------------|
| Priority (1-5) | `X-Priority: 5` | 5 for price errors, 4 for flash deals, 3 for regular |
| Tags/Emoji | `X-Tags: fire,blinkit` | Platform tag + urgency emoji |
| Click URL | `X-Click: https://...` | Direct product link |
| Action buttons | `X-Actions: view, Buy, url` | "Buy Now" + "Copy Code" buttons |
| Markdown | `X-Markdown: yes` | Bold prices, strikethrough MRP |
| Title | `X-Title: 🔥 LOOT` | Deal type at a glance |
| Icons | `X-Icon: url` | Platform logo |

**Priority mapping:**
- 5 (urgent): Price errors, glitch deals -- vibrate + pop-over
- 4 (high): Flash deals, free samples -- vibrate + sound
- 3 (default): Regular coupon deals -- normal notification
- 2 (low): Sale announcements, cashback -- silent

### Key UX Principles

1. **Speed over completeness**: Send notification immediately on parse, verify in background. An "unverified" alert that arrives in 5 seconds beats a "verified" one that arrives in 30 seconds for price errors.

2. **Progressive disclosure**: Notification shows essentials (price, product, link). Dashboard shows full details (verification status, price history, similar deals).

3. **One-tap actionability**: The primary notification action should open the product page directly. No intermediate screens.

4. **Don't cry wolf**: Users with 71% app uninstall rates due to bad notifications. Reserve high priority for genuinely urgent deals. Use deal_type classification to set priority automatically.

5. **Batch non-urgent deals**: For coupon/sale deals, consider a daily digest mode rather than individual notifications.

6. **Deduplication**: Same deal from multiple groups should not trigger multiple notifications. Dedup by product URL or product_name + platform + price.

---

## Dashboard UX Patterns

### Design Inspiration from Existing Platforms

| Platform | Strength | Adopt |
|----------|----------|-------|
| Loot91 | Category browsing, timestamp on deals, minimalist mobile design | Category filters, clean card layout |
| DesiDime | Community voting, deal groups/filters, deep-link notifications | Filter by platform/category, deal status |
| BuyHatke | Price history graph, price drop alerts, cross-platform comparison | Price history visualization (future feature) |
| Quick Compare | Real-time multi-platform price comparison | Side-by-side price display |
| Slickdeals | Deal card with vote/temperature, expiry indicator | Deal "heat" scoring |

### Recommended Dashboard Layout

```
┌─────────────────────────────────────────────┐
│ [Logo] Deal Hunter          [Settings ⚙️]    │
├─────────────────────────────────────────────┤
│ Stats: 24 deals today | 8 verified | 3 loot │
├─────────────────────────────────────────────┤
│ Filters: [All] [Blinkit] [Zepto] [Swiggy]  │
│          [Loot] [Verified] [Expired]         │
├─────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────┐ │
│ │ 🔥 LOOT  Product Name          2m ago  │ │
│ │ ₹29 (₹120) 76% OFF                    │ │
│ │ Blinkit | ✅ Verified | In Stock       │ │
│ │ [Buy Now]                    [Details]  │ │
│ └─────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────┐ │
│ │ 💰 DEAL  Another Product       15m ago │ │
│ │ ₹499 (₹999) 50% OFF                   │ │
│ │ Amazon | ⏳ Unverified                  │ │
│ │ [Buy Now]                    [Details]  │ │
│ └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

### Key Dashboard Design Decisions

1. **Mobile-first**: Most Indian deal hunting happens on phones. Design for 360px width first. Quick commerce users are by definition on mobile (ordering groceries on the go).

2. **Information density**: Show 4-6 deal cards per screen. Each card needs: product name, price (deal + MRP), platform, verification status, time ago, and a buy button. Nothing more on the list view.

3. **Real-time feel**: Use "2m ago" timestamps instead of absolute times. Consider auto-refresh every 30-60 seconds or SSE (Server-Sent Events) for new deals appearing at top.

4. **Color coding by status**:
   - Green border: Verified + in stock
   - Yellow border: Unverified / pending
   - Red border: Expired / out of stock
   - Purple/gold border: LOOT deal (price error)

5. **Filters that matter** (in order of usefulness):
   - Platform (Blinkit/Zepto/Swiggy/Amazon/Flipkart)
   - Deal type (Loot/Flash/Coupon/Sale)
   - Verification status (Verified/Unverified/Expired)
   - Category (Grocery/Electronics/Fashion)
   - Time (Last hour / Today / This week)

6. **Detail view should show**:
   - Raw Telegram message (for context)
   - Parsed deal data
   - Verification result with timestamp
   - Direct buy link (prominent)
   - "Re-verify" button for manual check

---

## Deeplink Formats

### Blinkit

**Web domain:** `blinkit.com` (formerly Grofers)
**Android package:** `com.grofers.customerapp`
**iOS bundle:** `com.grofers.consumer` (Team ID: E7FS5EWD29)

**URL path patterns** (from Apple App Site Association):
| Path | Purpose |
|------|---------|
| `/prn/*` | Product page (product name slug) |
| `/cn/*` | Category page (e.g., `/cn/chocolates/cid/9/944`) |
| `/cln/*` | Collection page |
| `/s/*` | Search results |
| `/brand/*` | Brand page |
| `/cart` | Shopping cart |
| `/share/cart/*` | Shared cart |
| `/store/*` | Store page |

**Product URL format:**
```
https://blinkit.com/prn/{product-name-slug}/prid/{product_id}
```

Example: `https://blinkit.com/prn/cadbury-dairy-milk-chocolate/prid/12345`

**Category URL format:**
```
https://blinkit.com/cn/{category-slug}/cid/{category_id}/{subcategory_id}
```

**API endpoint** (from scraping research):
```
POST https://api2.grofers.com/v1/layout/feed
Headers:
  app_client: consumer_android
  lat: {latitude}
  lon: {longitude}
  auth_key: {token}
```

**Deeplink behavior:** Opening a `blinkit.com/prn/*` URL on a device with Blinkit installed will open the app directly to the product page (via Universal Links / App Links).

**Anti-scraping:** Uses Cloudflare with TLS/JA3 fingerprinting. HTTP 429 rate limiting. `curl_cffi` with Chrome impersonation is the standard bypass (already in the project plan).

### Zepto

**Web domain:** `www.zeptonow.com`
**Android package:** `com.zeptoconsumerapp`
**iOS bundle:** `com.zeptonow.customer` (Team ID: A2G5Q5P68Y)

**URL handling:** Wildcard (`"paths": ["*"]`) -- ALL paths on zeptonow.com trigger app open.

**Product URL format (inferred from web structure):**
```
https://www.zeptonow.com/product/{product-slug}/{product_id}
```

**Search URL:**
```
https://www.zeptonow.com/search?query={search_term}
```

**API endpoints:**
- Serviceability check: Unauthenticated endpoint returns `storeId` for coordinates
- Product data: `POST /lms/api/v2/get_page` at `api.zepto.com`
  - Requires Bearer token from logged-in session
  - Headers: `app_version: 26.3.1`, `User-Agent: okhttp/4.12.0`, `platform: android`

**Anti-scraping:** Cloudflare protected. Requires TLS fingerprint impersonation.

### Swiggy Instamart

**Web domain:** `www.swiggy.com/instamart/`
**Android packages:**
  - `in.swiggy.android` (main app)
  - `in.swiggy.android.instamart` (dedicated Instamart app)
**iOS bundle:** `bundl.swiggy` + `bundl.instamart` (Team ID: 9X7BN9YP4C)

**URL path patterns:**
| Path | Purpose |
|------|---------|
| `/instamart/*` | All Instamart pages |
| `/stores/instamart/*` | Store-specific Instamart pages |

**Product URL format (inferred):**
```
https://www.swiggy.com/instamart/item/{product-slug}/{product_id}
```

**API details:**
- Pod discovery: `select-location` API returns serviceable pod and `podId`
- Cart/product: `POST /api/instamart/checkout/v2/cart?pageType=INSTAMART_CART`
  - Requires geographic cookies: `lat=`, `lng=`
  - Request body includes `spinId` (internal product ID) and `podId`

**Anti-scraping:** WAF with silent circuit-breaking (returns HTTP 200 with empty/placeholder data). Low concurrency required (10-20 workers max).

### Amazon India

**Affiliate link format:**
```
https://www.amazon.in/dp/{ASIN}?tag={affiliate_id}-21
```

Where:
- `ASIN` = Amazon Standard Identification Number (10-character alphanumeric)
- `tag` = Associates ID in format `XXXXX-21`

**Shortened links:** `https://amzn.to/{short_code}` (resolves to full URL with tag)

**Key rules:**
- Must include `tag` parameter for affiliate tracking
- Cannot display prices unless served via Amazon API
- Temporary promotional claims must be removed on expiry

### Flipkart

**Standard affiliate link:**
```
https://www.flipkart.com/{product-slug}/p/{product_id}?affid={affiliate_id}
```

**Deeplink format (for mobile app tracking):**
```
https://dl.flipkart.com/dl/{product-slug}/p/{product_id}?affid={affiliate_id}
```

**Key change:** Replace `www` with `dl` and add `/dl` after domain to create mobile-trackable deeplinks. Standard www links do NOT track sales in the mobile app.

**Sub-ID parameters:** `affExtParam1` and `affExtParam2` for tracking (e.g., source, campaign).

**Shortened links:** `https://fkrt.co/{short_code}` (Flipkart's URL shortener)

### BigBasket

**Web domain:** `www.bigbasket.com`

**Product URL format:**
```
https://www.bigbasket.com/pd/{product_id}/{product-name-slug}/
```

**Deeplink behavior:** Opens in BigBasket app if installed via Universal Links.

---

## Existing Indian Price Trackers

### BuyHatke (buyhatke.com)

**Type:** Browser extension + mobile app
**Platforms tracked:** Amazon, Flipkart, Myntra, Ajio, Meesho, and more
**Key features:**
- **Price history graph**: 3-month price history for any product on supported e-commerce sites
- **Price drop alerts**: Set target price, get email/push notification when price drops
- **Auto coupon**: Automatically applies best available coupon at checkout
- **Price comparison**: Cross-store product lookups (find same product cheaper elsewhere)
- **Spend Lens**: Track total spending across Amazon, Flipkart, Zomato
- **Lookalike**: Find similar products across stores
- **Recent additions** (2025-2026): Grocery comparison, 300+ gift vouchers, cab comparison, voice search

**Relevance to Deal Hunter:** BuyHatke focuses on e-commerce (Amazon/Flipkart), not quick commerce. There is a gap for Blinkit/Zepto/Swiggy price tracking that Deal Hunter can fill.

### PriceHistory (pricehistory.app / pricehistoryapp.com)

**Type:** Browser extension + mobile app
**Key features:**
- Price tracking across e-commerce AND quick commerce platforms (including Blinkit, Zepto)
- Tracking List: Compare products on a single screen
- Wish List with price drop notifications
- Works on Amazon, Flipkart, and newer support for quick commerce

**Relevance:** Closest competitor to Deal Hunter's price verification feature. However, PriceHistory is extension-based (requires browser), not Telegram-based automation.

### Quick Compare (quickcompare.in)

**Type:** Web app + mobile app
**Platforms:** Blinkit, Zepto, Swiggy Instamart, Flipkart Minutes, BigBasket
**Key features:**
- Real-time price comparison across quick commerce platforms
- Delivery time estimates
- Smart price tracking
- Ad-supported (Google Ads, Mixpanel analytics)

**Relevance:** Direct competitor for price comparison aspect. Deal Hunter differentiates by being Telegram-native (passive monitoring vs. active searching).

### Savvio

**Type:** Mobile app
**Platforms:** Blinkit, Instamart, Zepto, BigBasket, Flipkart Minutes
**Key features:**
- Real-time price tracking across quick commerce platforms
- Claims up to Rs 2000/month savings
- Multi-platform comparison

### Dealulu (dealulu.in)

**Type:** Web app
**Key features:**
- Price, delivery time, and availability comparison across Blinkit, Swiggy Instamart, Zepto, BigBasket
- Shopping list management
- **Single-tap checkout with deeplinks to respective platforms** (directly relevant to Deal Hunter)

### Loot91 (loot91.com)

**Type:** Deal aggregator website
**Focus:** Price errors, loot deals, hidden coupons
**Key features:**
- Categories: Trending Deals, Fresh Loot Offers, Top Coupons, Price Drops, Festival Deals
- Minimalist mobile-optimized design (fast loading on slow networks)
- Scans marketplaces for price drops
- Verifies coupon codes
- Timestamps on all deals
- Redirects to original marketplace listings

**Relevance:** Closest in spirit to Deal Hunter, but web-based aggregator rather than real-time Telegram monitor. Loot91 explicitly focuses on price errors and loot deals -- the same high-value category Deal Hunter should prioritize.

### DesiDime (desidime.com)

**Type:** Community-driven deal platform (web + app)
**Key features:**
- Community posts deals, votes, and comments (Reddit-like)
- Front Page Deals (FPD): curated best deals
- Notification on new FPD or mega sale
- Filters: Electronics, Mobiles, Grocery, Fashion, Food, Flights, Hotels, etc.
- Store filters (Amazon, Flipkart, etc.)
- Deep-link notifications: tap notification -> goes to specific deal/discussion
- Groups for category-based browsing

**Relevance:** DesiDime's community validation model (voting) is interesting but out of scope for a personal tool. Their notification deep-linking and filter system are good UX references.

---

## Key Insights for Deal Hunter

### Priority 1: Speed is Everything

For the highest-value deals (price errors, glitch deals), the window is 5-30 minutes. The pipeline must be:
1. Telegram message received -> **<2 seconds** -> Gemini parse
2. Parse complete -> **<1 second** -> notification sent
3. Verification can happen async after notification

**Recommendation:** Send "unverified" notification immediately on successful parse if `deal_type` is "loot" or "price_error". Verify in background and update dashboard. For regular deals, verify first, then notify.

### Priority 2: Smart Deal Classification

Not all messages deserve the same urgency. The Gemini prompt should classify deals by type:
- **LOOT/PRICE_ERROR** -> Priority 5 ntfy, immediate Telegram DM
- **FLASH/FREE** -> Priority 4, immediate notify
- **COUPON/SALE** -> Priority 3, can batch
- **NOT_A_DEAL** -> Skip entirely

This prevents notification fatigue (the #1 reason users abandon deal alert tools).

### Priority 3: Deeplink to App

The biggest UX win is making the "buy" action one tap. Since Blinkit, Zepto, and Swiggy all support Universal Links / App Links:
- Blinkit: `https://blinkit.com/prn/{product-slug}/prid/{id}` opens Blinkit app
- Zepto: `https://www.zeptonow.com/*` (wildcard) opens Zepto app
- Swiggy: `https://www.swiggy.com/instamart/*` opens Swiggy app
- Amazon: Standard `amazon.in` links open Amazon app
- Flipkart: `dl.flipkart.com/dl/...` for app-tracked links

**No custom URI schemes needed.** Standard HTTPS links already trigger app opens on mobile devices where these apps are installed.

### Priority 4: Verification is Valuable but Fragile

All three quick commerce platforms have anti-scraping measures:
- Cloudflare TLS/JA3 fingerprinting (all three)
- Rate limiting / HTTP 429 (especially Blinkit)
- Silent circuit-breaking with fake 200 responses (Swiggy)
- Required location headers (lat/lng/pincode for all)

`curl_cffi` with Chrome TLS impersonation is the standard approach (already in the plan). Keep concurrency low (semaphore of 5-10). Accept that verification will fail sometimes -- the "notify even on failure" design decision in the plan is correct.

### Priority 5: Dashboard is Secondary

Most deal value is captured in the notification moment, not in browsing a dashboard later. The dashboard serves three purposes:
1. **Deal history** (what did I miss while AFK?)
2. **Verification details** (was this deal real?)
3. **Settings** (change pincode, notification preferences)

Keep the dashboard simple. Pico CSS (already in plan) is the right choice for a personal tool -- semantic HTML, no build step, mobile-responsive out of the box.

### Priority 6: Future Differentiators

Features that would make Deal Hunter uniquely valuable (post-MVP):
1. **Price history per product** (track prices over time on quick commerce -- gap in market)
2. **Cross-platform comparison** (same product on Blinkit vs Zepto vs Instamart)
3. **Deal scoring/ranking** (not just notify, but rank deals by value)
4. **Pincode-aware search** (deals available at YOUR location, not just posted)
5. **Bank offer tracking** (which credit card offers stack with which deals)

---

## Platform-Specific Technical Notes

### Location Headers for Verification

| Platform | Method | Headers/Cookies Required |
|----------|--------|-------------------------|
| Blinkit | API headers | `lat`, `lon` (GPS coordinates) |
| Zepto | Bearer token + headers | `app_version`, `platform: android`, `storeId` from serviceability check |
| Swiggy Instamart | Geographic cookies | `lat=`, `lng=` cookies, `podId` from location API |
| Amazon | Pincode cookie | `AMZN_Pin` cookie or address in account |
| Flipkart | Pincode parameter | `pincode` query parameter or cookie |
| BigBasket | Location API | Area/pincode selection via API |

### URL Shortener Resolution

Deal messages often use shortened URLs. Common patterns:
- `amzn.to/*` -> Amazon
- `fkrt.co/*` -> Flipkart
- `bit.ly/*`, `tinyurl.com/*` -> Generic (follow redirect)
- Direct `blinkit.com`, `zeptonow.com`, `swiggy.com` links are less commonly shortened

**Recommendation:** Follow redirects on shortened URLs to get the actual product URL before verification. Use `httpx` with `follow_redirects=True`.

### Affiliate Link Detection

Most deal channel messages contain affiliate-tagged URLs. For the purpose of Deal Hunter (personal tool), this doesn't matter -- the affiliate tag doesn't affect the deal price. However, if the user wants clean links, strip:
- `?tag=XXX-21` from Amazon URLs
- `?affid=XXX` from Flipkart URLs
- Various `utm_*` parameters

---

## Sources

### Primary (HIGH confidence)
- [Blinkit AASA file](https://blinkit.com/.well-known/apple-app-site-association) - Deeplink path patterns
- [Zepto AASA file](https://www.zeptonow.com/.well-known/apple-app-site-association) - Deeplink wildcard config
- [Swiggy AASA file](https://www.swiggy.com/.well-known/apple-app-site-association) - Instamart path patterns
- [ntfy publish docs](https://docs.ntfy.sh/publish/) - Notification features, priority, actions
- [Amazon Associates Linking Requirements](https://affiliate-program.amazon.in/help/operating/linking/) - Affiliate URL format
- [Flipkart Affiliate Mobile Tracking](https://affiliate.flipkart.com/tools/mobile-tracking-info) - Deeplink affiliate format

### Secondary (MEDIUM confidence)
- [ExtraPe Telegram channels list](https://www.extrape.com/blog/top-loot-deals-telegram-channels/) - Channel names, subscriber data
- [Loot91 review (Borok Times)](https://boroktimes.com/loot91-indias-emerging-deal-hub-for-indian-shoppers-a-complete-in-depth-review/) - Deal platform UX analysis
- [DesiDime discussion on deal sourcing](https://www.desidime.com/discussions/how-do-telegram-channel-admins-get-to-know-about-price-drop-loot-deals-etc) - How deal channels operate
- [Dark store scraping article (Medium)](https://jatin-dot-py.medium.com/how-i-scraped-most-dark-stores-in-india-blinkit-zepto-swiggy-instamart-ad939ff17af9) - API endpoints, anti-scraping details
- [Blinkit PDP scraper (GitHub)](https://github.com/meet-ashara/blinkit_pdp_api) - Product scraping patterns
- [Swiggy Loots Telegram channel](https://t.me/s/swiggyLoots) - Deal message format examples
- [Smashing Magazine notification UX](https://www.smashingmagazine.com/2025/07/design-guidelines-better-notifications-ux/) - Notification design best practices
- [GrowDealz TGStat](https://in.tgstat.com/channel/@growdealz) - Channel statistics
- [BuyHatke Chrome Web Store](https://chromewebstore.google.com/detail/price-history-tracker-spe/ojplmecpdpgccookcobabopnaifgidhf) - Feature list
- [Quick Compare app](https://quickcompare.in/) - Quick commerce price comparison
- [EarnKaro deal channels list](https://earnkaro.com/blog/loot-deals-telegram-channels/) - Channel subscriber data
- [Gadget Wisdom ntfy guide](https://www.gadgetwisdom.com/2025/12/01/ntfy-notification-system-integrations/) - ntfy best practices
- [DealsCue](https://www.dealscue.com/) - Indian deal types taxonomy
- [Inc42 quick commerce dark patterns](https://inc42.com/features/zepto-swiggy-blinkit-dark-patterns-quick-commerce-boom/) - Pricing dynamics
- [MetricsCart quick commerce monitoring](https://metricscart.com/insights/quick-commerce-monitoring-tools-india/) - Monitoring tools landscape
