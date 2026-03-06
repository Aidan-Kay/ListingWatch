# ListingWatch

A desktop application for monitoring eBay and Vinted listings in real time. ListingWatch polls the eBay Browse API and the Vinted catalogue API on configurable intervals and aggregates new listings into one feed.

Built with [Electron](https://www.electronjs.org/) and [Tailwind CSS](https://tailwindcss.com/).

---

## Features

- **Live feed** — New listings appear at the top of the feed as they are found
- **Multi-source** — Monitor **eBay** and **Vinted** searches in the same feed
- **Multiple saved searches** — Run any number of keyword/category searches simultaneously
- **Per-search configuration** — Source, site/locale, keywords, price range, and more per search
- **eBay-specific filters** — Category, item location, buying format (Auction / Buy It Now), item condition, and category-specific filters (e.g. Brand, Colour)
- **Vinted-specific filters** — Category ID and category-specific filters (e.g. `video_game_platform_ids`)
- **Customisable refresh intervals** — Global and per-search minimum/maximum poll intervals (randomised to avoid rate-limit patterns)
- **Windows notifications** — Native toast notifications for new listings, configurable per buying format and per search. Clicking a notification focuses the app and scrolls to the relevant listing(s)
- **Per-search card colours** — Colour-code searches for at-a-glance identification in the feed
- **Feed filtering** — Filter bar with live text search, platform select, saved-search select, and buying-format select; all filters are session-only and can be combined freely
- **Feed sorting** — Sort by Newest First (default), Oldest First, Price: Low → High, or Price: High → Low
- **Image count badge** — Thumbnail overlay shows the total image count for each listing
- **Search duplication** — One-click clone of an existing search (starts paused)
- **Export / Import** — Back up and restore all searches and settings as a JSON file
- **Taskbar badge** — Unread new-listing count shown in the Windows taskbar

---

## Screenshots

<img src="./screenshots/main-window.png?raw=true" width="800" />

---

## Requirements

- [Node.js](https://nodejs.org/) 18 or later
- For **eBay searches**: an [eBay Developer](https://developer.ebay.com/) account with a **Production** application key pair (Client ID and Client Secret)
- Vinted searches require no API credentials

> eBay limits the Browse API to **5,000 calls per day** on a free developer account. Set your refresh intervals accordingly.

---

## Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/Aidan-Kay/ListingWatch.git
   cd ListingWatch
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Run the app**

   ```bash
   npm start
   ```

   This compiles the Tailwind stylesheet and launches Electron.

4. **Enter your eBay API credentials** _(required only for eBay searches)_

   Open the **Settings** tab, enter your eBay Production **Client ID** and **Client Secret**, then click **Test Connection** to verify and **Save Settings**.

---

## eBay API notes

ListingWatch uses the [Browse API](https://developer.ebay.com/api-docs/buy/browse/overview.html) (`item_summary/search`) with OAuth client credentials flow.

- Supported marketplaces: **US, UK, DE, AU, CA, FR, IT, ES**
- Aspect filters use the eBay `aspect_filter` query parameter format, e.g. `Brand:Next,Primark`

---

## Vinted notes

ListingWatch accesses the public Vinted catalogue API directly (no developer account required). Authentication is handled transparently via a cookie jar that fetches session cookies before the first request.

- Supported sites: **UK, FR, DE, BE, ES, IT, NL, PL, US**
- The Vinted category ID can be found in the URL when browsing a category on vinted.co.uk (e.g. `/catalog?catalog[]=1904`)
- Category-specific filters (e.g. platform, brand) are entered as key/value pairs in the **Category Filters** section of the search modal. The key should be the API parameter name without the `[]` suffix. For example:
  - Key: `video_game_platform_ids` → Value: `1270,1269`

---

## Notification behaviour

- Notifications fire for **new** listings only (not on the initial scan of each search, unless **Show recent listings on start** is configured in Settings to include listings from the past N hours)
- Suppressed by default when ListingWatch is the active window (configurable in Settings)
- Can be disabled entirely per-search via the **Notify** toggle on the Searches screen or in the search modal
- Global format filter (Auction / Buy It Now) available in Settings

---

## License

ISC
