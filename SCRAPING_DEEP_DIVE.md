# Scraping Deep Dive: Quick Commerce Platform Verification

**Researched:** 2026-04-08
**Domain:** Blinkit, Zepto, Swiggy Instamart, BigBasket -- reverse-engineered API endpoints, headers, response formats
**Confidence:** MEDIUM (endpoints confirmed via multiple GitHub repos and the March 2026 "dark stores" article, but internal APIs change frequently)

---

## Executive Summary

All four quick commerce platforms expose internal REST APIs that can be called directly without browser automation. The most reliable approach for our single-product verification use case combines two strategies:

1. **Direct API call** (primary): Call the platform's internal product detail API with lat/lon headers to get JSON with price, stock, and availability. Uses curl_cffi for TLS fingerprint impersonation.
2. **Page fetch + Gemini extraction** (fallback): Fetch the product URL as HTML, convert to markdown, send to Gemini for price/stock extraction. More resilient to API changes but slower and costs tokens.

The key technical discovery is that **Blinkit has a product detail API at `POST https://blinkit.com/v1/layout/product/{product_id}`** that returns rich JSON including price, MRP, availability, merchant_id, and images. This was confirmed by the `meet-ashara/blinkit_pdp_api` GitHub repo which uses curl_cffi with `impersonate="chrome101"` to call it directly. For Zepto, the authenticated API at `POST /lms/api/v2/get_page` requires a Bearer token, but product pages can be fetched unauthenticated for our simpler use case. Swiggy Instamart is the hardest due to silent circuit-breaking. BigBasket is the easiest with direct pincode header support.

**Primary recommendation:** For each platform, try the direct API first. If it fails, fall back to page fetch + Gemini. Always set location via lat/lng headers/cookies. Use curl_cffi with `impersonate="chrome131"` for all requests.

---

## Blinkit Scraping Guide

### Endpoint Details

**Product Detail API (CONFIRMED -- HIGH confidence)**

| Property | Value |
|----------|-------|
| URL | `POST https://blinkit.com/v1/layout/product/{product_id}` |
| Method | POST (empty body, content-length: 0) |
| Source | [meet-ashara/blinkit_pdp_api](https://github.com/meet-ashara/blinkit_pdp_api) |

**Category Listing API (CONFIRMED -- MEDIUM confidence)**

| Property | Value |
|----------|-------|
| URL | `POST https://api2.grofers.com/v1/layout/feed` |
| Method | POST |
| Source | [Jatin Banga Medium article (March 2026)](https://jatin-dot-py.medium.com/how-i-scraped-most-dark-stores-in-india-blinkit-zepto-swiggy-instamart-ad939ff17af9) |

**Search URL (browser-level)**

| Property | Value |
|----------|-------|
| URL | `https://blinkit.com/s/?q={search_term}` |
| Method | GET (browser navigation) |
| Source | [KshKnsl/QuickCom](https://github.com/KshKnsl/QuickCom) |

### Authentication

Blinkit does NOT require login for product detail/search APIs. However, the following headers are required:

```python
headers = {
    'accept': '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'access_token': 'null',              # Literal string "null"
    'app_client': 'consumer_web',
    'app_version': '1010101010',
    'auth_key': 'c761ec3633c22afad934fb17a66385c1c06c5472b4898b866b7306186d0bb477',
    'content-type': 'application/json',
    'device_id': '<generate-uuid4>',     # Random UUID per session
    'lat': '<user_latitude>',            # CRITICAL: location header
    'lon': '<user_longitude>',           # CRITICAL: location header
    'origin': 'https://blinkit.com',
    'rn_bundle_version': '1009003012',
    'session_uuid': '<generate-uuid4>',  # Random UUID per session
    'web_app_version': '1008010016',
}
```

**Source:** Extracted from [meet-ashara/blinkit_pdp_api config.py](https://github.com/meet-ashara/blinkit_pdp_api/blob/main/config.py)

**Key observations:**
- `auth_key` appears to be a static key shared across web sessions (not per-user)
- `lat` and `lon` headers are how location is set -- these determine which dark store serves the request
- `device_id` and `session_uuid` should be random UUIDs generated once per session
- `app_version` and `web_app_version` may need periodic updates as Blinkit deploys new versions

For the legacy `api2.grofers.com/v1/layout/feed` endpoint (dark store discovery), the headers differ slightly:
```python
headers_legacy = {
    'app_client': 'consumer_android',
    'lat': '<latitude>',
    'lon': '<longitude>',
    'auth_key': '<value>',
    'battery-level': 'EXCELLENT',
}
```

### Location Setting

**Mechanism:** HTTP headers `lat` and `lon` on every request.

There is NO cookie-based location. There is NO session-based location. Every single API call must include `lat` and `lon` headers. The dark store that serves the response is determined by proximity to these coordinates.

**How to convert pincode to lat/lng:** Use a static lookup table or the Google Geocoding API. For our use case, the user configures lat/lng once in `.env`.

### Product Lookup

**Extracting product_id from a Blinkit URL:**

Blinkit product URLs follow this pattern:
```
https://blinkit.com/prn/{product-name-slug}/prid/{product_id}
```

Extract product_id with regex:
```python
import re

def extract_blinkit_product_id(url: str) -> str | None:
    match = re.search(r"/prid/(\d+)", url)
    return match.group(1) if match else None
```

**Source:** [meet-ashara/blinkit_pdp_api utils.py](https://github.com/meet-ashara/blinkit_pdp_api/blob/main/utils.py)

### Response Format

The `/v1/layout/product/{prid}` endpoint returns a large JSON object with a `response.snippets` array. Product data is distributed across multiple snippets at various indices. Key fields (extracted via jmespath paths):

```python
# Price (selling price)
price_paths = [
    'response.snippets[9].data.stepper_data_v2.increment_actions.default[0].add_to_cart.cart_item.price',
    'response.snippets[9].tracking.impression_map.price',
    'response.snippets[2].tracking.common_attributes.price',
    'response.snippets[5].tracking.widget_meta.price',
]

# MRP (original price)
mrp_paths = [
    'response.snippets[9].data.stepper_data_v2.increment_actions.default[0].add_to_cart.cart_item.mrp',
    'response.snippets[9].tracking.impression_map.mrp',
    'response.snippets[2].tracking.common_attributes.mrp',
    'response.snippets[5].tracking.widget_meta.mrp',
]

# Product name
name_paths = [
    'response.snippets[0].data.itemList[0].tracking.widget_meta.child_widget_title',
    'response.snippets[2].data.title.text',
]

# Availability state ("AVAILABLE", "OUT_OF_STOCK", etc.)
availability_paths = [
    'response.snippets[2].tracking.common_attributes.state',
]

# Product ID
product_id_paths = [
    'response.snippets[2].data.identity.id',
    'response.snippets[2].tracking.common_attributes.product_id',
]

# Merchant/store ID
merchant_id_paths = [
    'response.snippets[5].tracking.widget_meta.merchant_id',
    'response.snippets[9].tracking.impression_map.merchant_id',
]
```

**Source:** [meet-ashara/blinkit_pdp_api scraper.py](https://github.com/meet-ashara/blinkit_pdp_api/blob/main/scraper.py)

**From category listing responses** (Rda99/Blinkit_Data_Scraping), each product snippet in `feedData.snippets` contains:
```json
{
  "data": {
    "identity": { "id": "425544" },
    "name": { "text": "Product Name" },
    "normal_price": { "text": "Rs 199" },
    "mrp": { "text": "Rs 249" },
    "variant": { "text": "500g" },
    "image": { "url": "https://cdn.grofers.com/..." },
    "eta_tag": { "title": { "text": "8 mins" } },
    "offer_tag": { "title": { "text": "20% OFF" } },
    "is_sold_out": false,
    "inventory": 15,
    "brand_name": { "text": "Brand" },
    "merchant_id": "12345"
  }
}
```

### Working Code Example

```python
import re
import uuid
from curl_cffi.requests import AsyncSession

BLINKIT_HEADERS = {
    'accept': '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'access_token': 'null',
    'app_client': 'consumer_web',
    'app_version': '1010101010',
    'auth_key': 'c761ec3633c22afad934fb17a66385c1c06c5472b4898b866b7306186d0bb477',
    'content-type': 'application/json',
    'device_id': str(uuid.uuid4()),
    'origin': 'https://blinkit.com',
    'rn_bundle_version': '1009003012',
    'session_uuid': str(uuid.uuid4()),
    'web_app_version': '1008010016',
}

async def verify_blinkit(product_url: str, lat: float, lng: float) -> dict:
    """Verify a Blinkit product's price and availability."""
    # Extract product ID from URL
    match = re.search(r"/prid/(\d+)", product_url)
    if not match:
        return {"available": False, "error": "Cannot extract product ID from URL"}

    prid = match.group(1)
    headers = {
        **BLINKIT_HEADERS,
        'lat': str(lat),
        'lon': str(lng),
    }

    async with AsyncSession(impersonate="chrome131") as session:
        try:
            resp = await session.post(
                f"https://blinkit.com/v1/layout/product/{prid}",
                headers=headers,
                timeout=15,
            )

            if resp.status_code == 429:
                return {"available": False, "error": "Rate limited (429)"}
            if resp.status_code != 200:
                return {"available": False, "error": f"HTTP {resp.status_code}"}

            data = resp.json()
            snippets = data.get("response", {}).get("snippets", [])

            # Extract price from known paths
            price = None
            mrp = None
            availability = None

            for snip in snippets:
                tracking = snip.get("tracking", {})
                common = tracking.get("common_attributes", {})
                widget = tracking.get("widget_meta", {})
                impression = tracking.get("impression_map", {})

                if common.get("price") and not price:
                    price = float(common["price"])
                if common.get("mrp") and not mrp:
                    mrp = float(common["mrp"])
                if common.get("state") and not availability:
                    availability = common["state"]

                if impression.get("price") and not price:
                    price = float(impression["price"])
                if impression.get("mrp") and not mrp:
                    mrp = float(impression["mrp"])
                if widget.get("price") and not price:
                    price = float(widget["price"])

            in_stock = availability == "AVAILABLE" if availability else None

            return {
                "available": True,
                "current_price": price,
                "mrp": mrp,
                "in_stock": in_stock,
                "error": None,
            }

        except Exception as e:
            return {"available": False, "error": str(e)}
```

### Rate Limits and Gotchas

| Behavior | Detail |
|----------|--------|
| Rate limiting | HTTP 429 after sustained requests. Blinkit uses Cloudflare with JA3 fingerprinting. |
| TLS defense | **Must use curl_cffi** with Chrome impersonation. Standard requests/httpx will be blocked immediately. |
| Cloudflare challenge | Sometimes returns 200 with a Cloudflare challenge page instead of JSON. Check `content-type` header and response body length. |
| IP type | Indian datacenter IPs work better than residential for bulk requests (per Jatin Banga). For our single-request use case, any Indian IP should work. |
| Auth key staleness | The `auth_key` may change periodically. If 403 errors start, capture a fresh one from browser dev tools. |
| Snippet indices | The indices in `response.snippets[N]` are NOT guaranteed stable. Different products may have data at different indices. The multi-path extraction approach (trying multiple paths) is essential. |
| Concurrency | Use `asyncio.Semaphore(3)` for Blinkit. More aggressive concurrency triggers rate limits faster. |
| Empty responses | If lat/lon doesn't map to a serviceable area, the response may be valid JSON but with empty/missing product data. This is NOT an error -- it means the product isn't available at that location. |

---

## Zepto Scraping Guide

### Endpoint Details

**Authenticated API (for bulk data -- CONFIRMED)**

| Property | Value |
|----------|-------|
| URL | `POST https://api.zepto.com/lms/api/v2/get_page` |
| Method | POST |
| Auth | Bearer token required |
| Source | [Jatin Banga Medium article (March 2026)](https://jatin-dot-py.medium.com/how-i-scraped-most-dark-stores-in-india-blinkit-zepto-swiggy-instamart-ad939ff17af9) |

**Unauthenticated serviceability check (for store discovery)**

| Property | Value |
|----------|-------|
| URL | Unauthenticated endpoint (exact URL not published) |
| Method | Send coordinates, get back storeId |
| Source | Jatin Banga article |

**Product search URL (browser-level)**

| Property | Value |
|----------|-------|
| URL | `https://www.zeptonow.com/search?query={term}` |
| Alt URL | `https://www.zeptonow.com/srp?q={term}` |
| Source | [KshKnsl/QuickCom](https://github.com/KshKnsl/QuickCom) |

**Product page URL pattern:**
```
https://www.zeptonow.com/pn/{product-slug}/pvid/{variant_id}
```

### Authentication

**For the authenticated API** (`/lms/api/v2/get_page`):

```python
headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer <token_from_web_session>',
    'app_version': '26.3.1',
    'User-Agent': 'okhttp/4.12.0',
    'tenant': 'ZEPTO',
    'platform': 'android',
}
```

The Bearer token must be obtained from a logged-in Zepto web/Android session. Token lifecycle is unclear -- it likely expires after hours/days and needs refresh.

**For product page fetching** (our primary approach): No authentication needed. Fetch the product page URL with location cookies.

### Location Setting

**For the authenticated API:** Location is sent in the request body:
```json
{
  "latitude": 19.0760,
  "longitude": 72.8777,
  "page_type": "HOME",
  "version": "v2"
}
```

**For page fetching:** Set location via cookies:
```python
cookies = {
    'lat': str(lat),
    'lng': str(lng),
}
```

Zepto resolves the nearest store from these coordinates. The response includes:
- `storeDetailsResponse.id` -- store ID
- `storeDetailsResponse.servicableGeofence` -- polygon of the delivery zone (note: misspelled "servicable" in their API)

### Response Format

**From the authenticated API** (`get_page`), product data in JSON:
```json
{
  "storeDetailsResponse": {
    "id": "store_123",
    "name": "Store Name",
    "latitude": 19.076,
    "longitude": 72.877,
    "servicableGeofence": [
      {"lat": 19.08, "lon": 72.88},
      {"lat": 19.07, "lon": 72.86}
    ]
  }
}
```

**From QuickCom HTML extraction** (product card data attributes):
```json
{
  "id": "product_variant_id",
  "name": "Product Name",
  "price": "Rs 176",
  "originalPrice": "Rs 190",
  "savings": "Rs 14",
  "quantity": "800 g X 2",
  "deliveryTime": "4 mins",
  "discount": "7% OFF",
  "rating": "4.7",
  "reviewCount": "951",
  "imageUrl": "https://cdn.zeptonow.com/...",
  "available": true
}
```

**Key HTML selectors on Zepto product pages** (from ScrapHero guide and QuickCom):
- Product card: `[data-testid="product-card"]`
- Product name: `[data-testid="product-card-name"]`
- Price: `.text-[20px].font-[700]`
- Original price (strikethrough): `.text-lg.font-[450].line-through`
- Discount badge: `.bg-[#E5FAEC]`
- Weight/quantity: `.text-base.font-[450].text-[#5A6477]`
- Out of stock indicator: `button[aria-label="Notify"]` (present = out of stock)
- Product image: `[data-testid="product-card-image"]`

### Working Code Example

```python
from curl_cffi.requests import AsyncSession
from markdownify import markdownify as md

async def verify_zepto(product_url: str, lat: float, lng: float) -> dict:
    """Verify a Zepto product's price and availability."""
    cookies = {
        'lat': str(lat),
        'lng': str(lng),
    }

    async with AsyncSession(impersonate="chrome131") as session:
        try:
            resp = await session.get(
                product_url,
                cookies=cookies,
                headers={
                    'accept': 'text/html,application/xhtml+xml',
                    'accept-language': 'en-US,en;q=0.9',
                },
                timeout=15,
            )

            if resp.status_code != 200:
                return {"available": False, "error": f"HTTP {resp.status_code}"}

            # Check for meaningful content (not a Cloudflare challenge)
            if len(resp.text) < 1000:
                return {"available": False, "error": "Empty or challenge page"}

            # Option A: Direct HTML parsing for key fields
            # (More reliable than Gemini for known selectors)
            html = resp.text

            # Check for "Notify" button (out of stock indicator)
            out_of_stock = 'aria-label="Notify"' in html

            # Fall back to Gemini for price extraction
            markdown = md(html, strip=["script", "style", "nav", "footer"])
            return await extract_with_gemini(markdown, out_of_stock_hint=out_of_stock)

        except Exception as e:
            return {"available": False, "error": str(e)}
```

### Rate Limits and Gotchas

| Behavior | Detail |
|----------|--------|
| Rate limiting | **Most permissive of all platforms.** "A single IP sustained tens of thousands of requests" (Jatin Banga). |
| TLS defense | Less aggressive than Blinkit. curl_cffi with Chrome impersonation works well but may not be strictly required for basic page fetching. |
| Token lifecycle | Bearer tokens for the authenticated API have unknown expiry. For our page-fetch approach, no token needed. |
| URL patterns | Two search URL formats exist: `/search?query=` and `/srp?q=`. Try both if one fails. |
| Product URLs | Pattern: `/pn/{slug}/pvid/{variant_id}`. The variant_id can be used for API lookups. |
| Concurrency | Use `asyncio.Semaphore(5)` -- Zepto can handle more concurrent requests. |
| Location cookies | Must be set as cookies, not headers. `lat` and `lng` (note: `lng` not `lon` unlike Blinkit). |

---

## Swiggy Instamart Scraping Guide

### Endpoint Details

**Cart/Product Check API (CONFIRMED -- MEDIUM confidence)**

| Property | Value |
|----------|-------|
| URL | `POST https://www.swiggy.com/api/instamart/checkout/v2/cart?pageType=INSTAMART_CART` |
| Method | POST |
| Source | [Jatin Banga Medium article (March 2026)](https://jatin-dot-py.medium.com/how-i-scraped-most-dark-stores-in-india-blinkit-zepto-swiggy-instamart-ad939ff17af9) |

**Location/Pod Discovery**

| Property | Value |
|----------|-------|
| URL | `select-location home API` (exact endpoint name not published) |
| Returns | `podId` (store ID), `spinId` (internal product identifier) |
| Source | Jatin Banga article |

**Product search URL (browser-level)**

| Property | Value |
|----------|-------|
| URL | `https://www.swiggy.com/instamart/search?query={term}` |
| Source | [ScrapHero guide](https://www.scrapehero.com/scrape-instamart/) |

### Authentication

No login required for page fetching. For the cart API, cookies are required:

```python
cookies = {
    'lat': str(lat),     # e.g., "19.076000"
    'lng': str(lng),     # e.g., "72.877700"
}
```

### Location Setting

**Mechanism:** Cookies named `lat` and `lng`.

The cookies must contain coordinates that are geographically within a pod's service zone. If coordinates don't match any pod, the API returns empty/placeholder data.

For the cart API, the request body also needs `podId` and `storeId`:

```json
{
  "data": {
    "items": [{
      "productId": "",
      "quantity": 1,
      "tradeFreebie": true,
      "spin": "<spinId>",
      "itemId": "T",
      "meta": {
        "type": "structure",
        "storeId": "<podId>",
        "freebie": false,
        "isGiftBag": false
      },
      "serviceLine": "INSTAMART"
    }],
    "cartMetaData": {
      "deliveryType": "INSTANT",
      "primaryStoreId": "<podId>",
      "storeIds": ["<podId>"]
    },
    "cartType": "INSTAMART"
  },
  "source": "userInitiated"
}
```

**Getting podId and spinId:** These are internal identifiers that must be discovered from the location/search APIs. For our product verification use case, we DO NOT need the cart API. We fetch the product page directly with lat/lng cookies.

### Response Format

The cart API returns:
```json
{
  "storesInfo": [
    {
      "id": "pod_123",
      "lat": 19.076,
      "lng": 72.877,
      "operational": true
    }
  ]
}
```

**HTML page data (from ScrapHero Selenium guide):**
- Product name, price, description, quantity
- Data contained in `div[data-testid="default_container"]` elements
- Text split by newlines, with conditional offset for "% OFF" and "Ad" badges

**Key HTML selectors:**
- Location button: `[data-testid="address-name"]`
- Search location: `[data-testid="search-location"]`
- Search input: `input[placeholder*="Search for area"]`
- Product container: `div[data-testid="default_container"]`
- Search input (products): `input[type="search"]`

### Working Code Example

```python
from curl_cffi.requests import AsyncSession
from markdownify import markdownify as md

async def verify_swiggy(product_url: str, lat: float, lng: float) -> dict:
    """Verify a Swiggy Instamart product's price and availability.

    WARNING: Swiggy silently circuit-breaks. A 200 response with empty body
    does NOT mean "out of stock" -- it means we were blocked. Always validate
    response content before accepting.
    """
    cookies = {
        'lat': str(lat),
        'lng': str(lng),
    }

    async with AsyncSession(impersonate="chrome131") as session:
        try:
            resp = await session.get(
                product_url,
                cookies=cookies,
                headers={
                    'accept': 'text/html,application/xhtml+xml',
                    'accept-language': 'en-US,en;q=0.9',
                },
                timeout=15,
            )

            if resp.status_code != 200:
                return {"available": False, "error": f"HTTP {resp.status_code}"}

            # CRITICAL: Swiggy returns 200 with empty/placeholder bodies
            # when circuit-breaking. Must validate content.
            if len(resp.text) < 2000:
                return {"available": False, "error": "Silent block (empty response)"}

            # Check for redirect to login/home (another form of blocking)
            if 'swiggy.com/instamart"' not in resp.text and 'instamart' not in resp.url:
                return {"available": False, "error": "Redirected away from product"}

            markdown = md(resp.text, strip=["script", "style", "nav", "footer"])
            return await extract_with_gemini(markdown)

        except Exception as e:
            return {"available": False, "error": str(e)}
```

### Rate Limits and Gotchas

| Behavior | Detail |
|----------|--------|
| Silent circuit-breaking | **The biggest danger.** Swiggy returns HTTP 200 with empty body or placeholder data. Does NOT return 429 or 403. You must validate response content, not just status code. |
| WAF threshold | Concurrency must stay LOW. Jatin Banga used 10-20 workers for bulk scraping. For our single-request use case, use `asyncio.Semaphore(2)`. |
| False "out of stock" | If you accept empty responses as "out of stock", you will send wrong notifications. Always check response body length and presence of product data before accepting. |
| Location precision | Cookies must be coordinates within a pod's service zone. If coordinates are slightly off, Swiggy silently routes to a different store or returns empty data. |
| Random delays | Add 3-8 second random delays between Swiggy requests to stay under WAF threshold. |
| Pod routing | API silently routes to nearby stores when target pod is offline. This means price/availability may be from a different store than expected. |

---

## BigBasket Scraping Guide

### Endpoint Details

**Product page (CONFIRMED -- MEDIUM confidence)**

| Property | Value |
|----------|-------|
| URL | `GET https://www.bigbasket.com/pd/{product_id}/{product-slug}/` |
| Alt URL | `GET https://www.bigbasket.com/custompage/sysgenpd/?type=pc&slug={product-slug}` |
| Method | GET |
| Sources | [niksoc/bigbasket-scraper](https://github.com/niksoc/bigbasket-scraper), [QuickCommerceAPI blog](https://quickcommerceapi.com/blog/platform-comparison-india) |

### Authentication

No login required. BigBasket is the least aggressive on anti-scraping.

### Location Setting

**Mechanism:** HTTP header `x-geolocation-pincode`.

This is the simplest location mechanism of all four platforms. Pass the pincode directly as a header:

```python
headers = {
    'x-geolocation-pincode': '400001',  # Mumbai pincode
}
```

**Source:** [QuickCommerceAPI platform comparison](https://quickcommerceapi.com/blog/platform-comparison-india) -- "To include the pincode header in your API requests, simply add `x-geolocation-pincode: 400001`"

BigBasket also works without a pincode header but returns more accurate (location-specific) results when one is provided.

### Response Format

BigBasket is a dynamic JavaScript-heavy site. Product pages make AJAX requests to a backend API. The JSON response from the backend includes:

```json
{
  "product_name": "Product Name",
  "price": "199",
  "mrp": "249",
  "discount": "20%",
  "brand": "Brand Name",
  "category": "Category",
  "quantity": "500g",
  "in_stock": true,
  "city_name": "Mumbai"
}
```

From existing scrapers, data fields include: product name, price, discount percentage, quantity, unit, brand, categories (multiple), city.

### Working Code Example

```python
from curl_cffi.requests import AsyncSession
from markdownify import markdownify as md

async def verify_bigbasket(product_url: str, pincode: str) -> dict:
    """Verify a BigBasket product's price and availability.

    BigBasket is the simplest platform to scrape. No TLS impersonation
    is strictly required, but we use it for consistency.
    """
    headers = {
        'x-geolocation-pincode': pincode,
        'accept': 'text/html,application/xhtml+xml',
        'accept-language': 'en-US,en;q=0.9',
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    }

    async with AsyncSession(impersonate="chrome131") as session:
        try:
            resp = await session.get(
                product_url,
                headers=headers,
                timeout=15,
            )

            if resp.status_code != 200:
                return {"available": False, "error": f"HTTP {resp.status_code}"}

            if len(resp.text) < 500:
                return {"available": False, "error": "Empty response"}

            markdown = md(resp.text, strip=["script", "style", "nav", "footer"])
            return await extract_with_gemini(markdown)

        except Exception as e:
            return {"available": False, "error": str(e)}
```

### Rate Limits and Gotchas

| Behavior | Detail |
|----------|--------|
| Rate limiting | Least aggressive. A crawl delay of ~10 seconds is recommended but not strictly enforced. |
| TLS defense | Minimal. Standard requests library may work. curl_cffi with impersonation is not strictly required but recommended for consistency. |
| JS rendering | BigBasket is JavaScript-heavy. Product pages may return a shell HTML that loads data via AJAX. If the response is too small or lacks product data, the page requires JS execution. |
| BB Now vs regular | BigBasket has two services: regular (slower delivery) and BB Now (quick commerce, ~10-30 min). Pricing and availability differ between them. BB Now is city-specific. |
| Pincode header | Use `x-geolocation-pincode` header. Without it, data may be incomplete or show a different city's pricing. |
| Concurrency | Can handle more concurrent requests than other platforms. `asyncio.Semaphore(5)` is safe. |

---

## Cross-Platform Patterns

### curl_cffi Best Practices

**Supported impersonation targets (current as of April 2026):**

| Target | Use When |
|--------|----------|
| `chrome131` | Default choice -- latest stable Chrome |
| `chrome110` | Confirmed working for Blinkit by Jatin Banga |
| `chrome101` | Used by meet-ashara/blinkit_pdp_api |
| `chrome` | Alias for latest Chrome -- auto-updates |
| `safari18_0` | Fallback if Chrome impersonation gets blocked |

**Only WebKit-based browsers are supported.** Firefox impersonation is NOT available in curl_cffi.

**AsyncSession pattern (recommended):**

```python
from curl_cffi.requests import AsyncSession
import asyncio

# Per-platform semaphores
SEMAPHORES = {
    'blinkit': asyncio.Semaphore(3),
    'zepto': asyncio.Semaphore(5),
    'swiggy_instamart': asyncio.Semaphore(2),
    'bigbasket': asyncio.Semaphore(5),
}

async def fetch_with_impersonation(
    url: str,
    platform: str,
    headers: dict | None = None,
    cookies: dict | None = None,
    method: str = "GET",
    impersonate: str = "chrome131",
    timeout: int = 15,
) -> tuple[int, str]:
    """Fetch a URL with TLS impersonation and platform-specific rate limiting."""
    sem = SEMAPHORES.get(platform, asyncio.Semaphore(3))

    async with sem:
        async with AsyncSession(impersonate=impersonate) as session:
            if method == "POST":
                resp = await session.post(url, headers=headers, cookies=cookies, timeout=timeout)
            else:
                resp = await session.get(url, headers=headers, cookies=cookies, timeout=timeout)
            return resp.status_code, resp.text
```

**Session reuse:** For multiple requests to the same platform, reuse the AsyncSession to maintain cookies:
```python
async with AsyncSession(impersonate="chrome131") as session:
    # First request sets cookies
    await session.get("https://blinkit.com/", headers=loc_headers)
    # Second request carries the cookies from first
    resp = await session.get(product_url, headers=loc_headers)
```

### HTML-to-Markdown Pipeline

```python
from markdownify import markdownify as md

def html_to_markdown(html: str) -> str:
    """Convert HTML to markdown, stripping non-content elements.

    Reduces token count by ~70% while preserving semantic structure.
    """
    return md(
        html,
        strip=["script", "style", "nav", "footer", "header", "iframe", "noscript"],
        heading_style="ATX",
        bullets="-",
    )
```

**Token reduction:** A typical product page is ~50,000 tokens as raw HTML. After markdownify: ~10,000-15,000 tokens. This saves significant Gemini costs.

**Additional optimization:** Before sending to Gemini, truncate the markdown to the first ~5000 characters. Product info is almost always in the top portion of the page.

### Gemini Extraction Prompt

```python
VERIFY_PROMPT = """Extract the current price and availability from this product page content.

Return a JSON object with these fields:
- current_price: The actual selling price in INR (number, not string). null if not found.
- mrp: The MRP/original price if different from selling price (number). null if same or not found.
- in_stock: true if the product is available for purchase, false if out of stock or unavailable.
- delivery_available: true if delivery is available at the user's location. false if "out of serviceable area" or similar message.
- product_name: The product name as shown on the page. null if not identifiable.
- error: null if extraction succeeded. Error message string if this page is a login wall, error page, CAPTCHA, or doesn't contain product information.

IMPORTANT RULES:
1. If this looks like a Cloudflare challenge page, login wall, or error page, set error="Not a product page" and all other fields to null.
2. current_price should be the DISCOUNTED price (what you actually pay), not the MRP.
3. If you see "Out of Stock", "Currently Unavailable", or "Notify Me" -- set in_stock=false.
4. Prices are in Indian Rupees. Strip the Rs/INR symbol and return as a number.
"""
```

### Error Handling Matrix

| Scenario | HTTP Status | Response Body | Our Action |
|----------|-------------|---------------|------------|
| Success | 200 | Product data present | Extract and verify |
| Rate limited | 429 | Error page | Retry after backoff |
| Cloudflare challenge | 200 or 403 | HTML with challenge JS | Mark as "verification failed" |
| Silent block (Swiggy) | 200 | Empty or placeholder | Mark as "verification failed" (NOT "out of stock") |
| Product not found | 404 | Error page | Mark as "product not found" |
| Server error | 500/502/503 | Error page | Retry with backoff |
| Redirect to login | 302 -> login page | Login form | Mark as "verification failed" |
| Not serviceable | 200 | Product data with "not in your area" | in_stock=false, delivery_available=false |
| Connection timeout | N/A | N/A | Retry with backoff |
| TLS error | N/A | N/A | Try different impersonation target |

**Retry strategy:**

```python
async def verify_with_retry(verify_fn, *args, max_retries=3, base_delay=1.0):
    """Retry verification with exponential backoff and jitter."""
    import random

    for attempt in range(max_retries + 1):
        result = await verify_fn(*args)
        if result.get("available") or result.get("in_stock") is not None:
            return result  # Got a real answer (even if out of stock)
        if "Rate limited" in (result.get("error") or ""):
            delay = min(base_delay * (2 ** attempt), 30)
            await asyncio.sleep(delay + random.uniform(0, delay * 0.5))
        elif attempt < max_retries:
            await asyncio.sleep(base_delay + random.uniform(0, 1))
        else:
            return result
    return result
```

### Platform Detection from URL

```python
import re
from urllib.parse import urlparse

PLATFORM_PATTERNS = {
    'blinkit': [r'blinkit\.com', r'grofers\.com'],
    'zepto': [r'zeptonow\.com', r'zepto\.co'],
    'swiggy_instamart': [r'swiggy\.com/instamart', r'swiggy\.com.*instamart'],
    'bigbasket': [r'bigbasket\.com', r'bb\.com'],
}

def detect_platform(url: str) -> str | None:
    """Detect which platform a URL belongs to."""
    for platform, patterns in PLATFORM_PATTERNS.items():
        for pattern in patterns:
            if re.search(pattern, url, re.IGNORECASE):
                return platform
    return None
```

---

## Open Source Reference Implementations

### Critical repos to study:

| Repo | What to learn | Key files |
|------|---------------|-----------|
| [meet-ashara/blinkit_pdp_api](https://github.com/meet-ashara/blinkit_pdp_api) | **Blinkit product detail API**: Exact endpoint URL, full headers, response JSON parsing with jmespath, curl_cffi usage | `config.py` (headers), `utils.py` (API call), `scraper.py` (response parsing) |
| [Rda99/Blinkit_Data_Scraping](https://github.com/Rda99/Blinkit_Data_Scraping) | **Blinkit category scraping**: Product snippet structure (feedData.snippets), field extraction (price, mrp, inventory, brand, image), multi-location support | `scraper.py` |
| [jatin-dot-py/darkstores](https://github.com/jatin-dot-py/darkstores) | **All three platforms**: API endpoints, auth headers, rate limit behavior, anti-bot defenses, curl_cffi impersonation | Companion to [Medium article](https://jatin-dot-py.medium.com/how-i-scraped-most-dark-stores-in-india-blinkit-zepto-swiggy-instamart-ad939ff17af9) |
| [KshKnsl/QuickCom](https://github.com/KshKnsl/QuickCom) | **Per-platform location setting + product search**: How each platform handles location differently via Puppeteer, product data extraction from HTML | `backend/blinkit/set-location.js`, `backend/zepto/set-location.js`, `backend/instamart/set-location.js`, `backend/*/searchHelpers.js` |
| [monizb/trivagro](https://github.com/monizb/trivagro) | **CORS bypass pattern**: Confirms backend proxy needed. Location hardcoded (confirms it's the hardest part). "Capture curl requests" approach. | Frontend source |
| [iamonjarvis/Blinkit-Zepto-product-backend](https://github.com/iamonjarvis/Blinkit-Zepto-product-backend) | **Puppeteer fallback**: When API calls fail, headless browser is the fallback. Concurrent scraping pattern. | `server.js` |
| [niksoc/bigbasket-scraper](https://github.com/niksoc/bigbasket-scraper) | **BigBasket scraping**: Selenium + BeautifulSoup approach. 10-second crawl delay. Multi-city support. | `storecoords.py`, main scraper |
| [Gaurang105/BigBasket_Scraper](https://github.com/Gaurang105/BigBasket_Scraper) | **BigBasket data export**: Product data to Excel + Google Sheets | Main scraper |

### Apify Actors (commercial reference):

| Actor | Platform | Link |
|-------|----------|------|
| Blinkit Search Scraper | Blinkit | [apify.com/smacient/blinkit-data-extractor](https://apify.com/smacient/blinkit-data-extractor) |
| Blinkit Product Scraper | Blinkit | [apify.com/krazee_kaushik/blinkit-search-results-scraper](https://apify.com/krazee_kaushik/blinkit-search-results-scraper) |
| Zepto Product Scraper | Zepto | [apify.com/shahidirfan/zepto-product-scraper](https://apify.com/shahidirfan/zepto-product-scraper) |

---

## Platform Comparison Summary

| Feature | Blinkit | Zepto | Swiggy Instamart | BigBasket |
|---------|---------|-------|-------------------|-----------|
| **Scraping difficulty** | Medium | Easy | Hard | Easy |
| **Direct API available?** | Yes (`/v1/layout/product/{id}`) | Yes (needs Bearer token) | Yes (needs podId/spinId) | Page fetch only |
| **Page fetch works?** | Yes | Yes | Unreliable | Yes |
| **Location mechanism** | `lat`/`lon` headers | `lat`/`lng` cookies | `lat`/`lng` cookies | `x-geolocation-pincode` header |
| **TLS impersonation required?** | Yes (Cloudflare) | Recommended | Recommended | Not required |
| **Rate limit severity** | Medium (429 after sustained) | Low (very permissive) | High (silent circuit-breaking) | Low |
| **Auth required?** | No (static auth_key) | No for pages, Yes for API | No for pages | No |
| **Recommended semaphore** | 3 | 5 | 2 | 5 |
| **Recommended delay** | 2-5 sec | 1-2 sec | 3-8 sec (random) | 1-2 sec |
| **Biggest gotcha** | Snippet indices vary per product | Two URL formats for search | Silent 200 with empty body | JS-rendered pages may need browser |

---

## Implementation Recommendations for deal_verifier.py

### Primary strategy: Dual approach per platform

```python
async def verify_deal(product_url: str, pincode: str, lat: float, lng: float) -> VerifyResult:
    platform = detect_platform(product_url)
    if not platform:
        return VerifyResult(available=False, error="Unknown platform")

    handler = {
        'blinkit': verify_blinkit_api,      # Try API first
        'zepto': verify_zepto_page,          # Page fetch (no token needed)
        'swiggy_instamart': verify_swiggy_page,
        'bigbasket': verify_bigbasket_page,
    }[platform]

    result = await verify_with_retry(handler, product_url, lat, lng)

    # If API approach failed, fall back to page fetch + Gemini
    if not result.get("available") and platform == 'blinkit':
        result = await verify_blinkit_page_fallback(product_url, lat, lng)

    return VerifyResult(**result)
```

### What to hard-code vs. make configurable

| Setting | Hard-code or Config? | Why |
|---------|---------------------|-----|
| Blinkit `auth_key` | Config (env var) | May change; needs periodic update |
| Lat/Lng | Config (env var) | User-specific |
| Pincode | Config (env var) | User-specific |
| Impersonation target | Hard-code `chrome131` | Change only if blocked |
| Semaphore limits | Hard-code per platform | Tuned to each platform's tolerance |
| Retry count | Config (default 3) | User may want to adjust |
| API endpoint URLs | Config (env or constant) | May need updating when platforms change |

---

## Sources

### Primary (HIGH confidence -- actual source code examined)

- [meet-ashara/blinkit_pdp_api](https://github.com/meet-ashara/blinkit_pdp_api) -- Blinkit product detail API endpoint, headers, response format, curl_cffi usage. **Source code read directly.**
- [Rda99/Blinkit_Data_Scraping](https://github.com/Rda99/Blinkit_Data_Scraping) -- Blinkit category scraping, product snippet structure. **Source code read directly.**
- [KshKnsl/QuickCom](https://github.com/KshKnsl/QuickCom) -- Per-platform Puppeteer location setting and product extraction. **All 6 backend files read directly.**
- [curl_cffi documentation](https://curl-cffi.readthedocs.io/) -- Impersonation targets, async API, session management.
- [Bright Data curl_cffi guide](https://brightdata.com/blog/web-data/web-scraping-with-curl-cffi) -- Impersonation targets list, async patterns, proxy configuration.

### Secondary (MEDIUM confidence -- verified from article + code)

- [Jatin Banga, "How I Scraped Most Dark Stores in India" (Medium, March 2026)](https://jatin-dot-py.medium.com/how-i-scraped-most-dark-stores-in-india-blinkit-zepto-swiggy-instamart-ad939ff17af9) -- API endpoints for all three platforms, rate limit behavior, anti-bot defenses, curl_cffi settings.
- [jatin-dot-py/darkstores (GitHub)](https://github.com/jatin-dot-py/darkstores) -- Companion repo, store count data.
- [QuickCommerceAPI platform comparison](https://quickcommerceapi.com/blog/platform-comparison-india) -- `x-geolocation-pincode` header for BigBasket, cross-platform pincode handling.
- [ScrapHero Zepto guide](https://www.scrapehero.com/scrape-zepto-data/) -- Selenium-based Zepto scraping, HTML selectors, location setting.
- [ScrapHero Instamart guide](https://www.scrapehero.com/scrape-instamart/) -- Selenium-based Instamart scraping, location setting, product extraction.

### Tertiary (LOW confidence -- commercial marketing, needs validation)

- [Apify Blinkit scraper](https://apify.com/smacient/blinkit-data-extractor) -- Commercial scraping tool, confirms data fields but no implementation details.
- [Apify Zepto scraper](https://apify.com/shahidirfan/zepto-product-scraper) -- Commercial scraping tool, confirms data fields.
- [FoodSpark Quick Commerce APIs](https://www.foodspark.io/understanding-quick-commerce-data-apis/) -- Commercial API service, confirms endpoint patterns.
- [Nextract Zepto API](https://nextract.dev/apis/zepto-api/) -- Commercial API service, confirms data fields.
- [niksoc/bigbasket-scraper](https://github.com/niksoc/bigbasket-scraper) -- BigBasket scraping with Selenium/PhantomJS. Older codebase but confirms basic approach.

---

## Open Questions

1. **Blinkit auth_key longevity:** The `auth_key` in the config.py of blinkit_pdp_api may be user-specific or may be a global web key. Need to test if it works from our VPS. If not, we need to capture one from our own browser session.

2. **Zepto page fetch with cookies only:** Confirmed that page fetch works without Bearer token, but need to verify that lat/lng cookies actually change the product availability/pricing in the response. It's possible the page always renders the same HTML and location is only applied client-side via JavaScript.

3. **Swiggy Instamart reliability:** This is the hardest platform. Our fallback of marking verification as "failed" rather than "out of stock" is the right approach, but it means Swiggy deals may rarely get verified. May need to accept this limitation for MVP.

4. **BigBasket JS rendering:** If BigBasket product pages require JavaScript execution, the HTML we fetch with curl_cffi may be a shell without product data. Need to test. If so, the Gemini approach won't work and we'd need to either: (a) find the AJAX endpoint BigBasket uses and call it directly, or (b) skip BigBasket verification and send "unverified" for BB deals.

5. **How frequently do endpoints change?** The `v1/layout/product` endpoint for Blinkit was confirmed working as of late June 2026 (from the blinkit_pdp_api repo's cookie dates). But endpoints can change without notice. Building the system to degrade gracefully (fall back to "unverified") is essential.
