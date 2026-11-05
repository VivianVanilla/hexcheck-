'use strict';

// Rewrites data/reforge-usage.json from the live auction house, which needs no API key. Scanning
// every page takes too long to do during a search, so the result is saved in the repo instead.
// A GitHub Action runs this once a month, or run it yourself with: npm run update-reforges

const fs = require('node:fs');
const path = require('node:path');
const { decodeItems, addReforgeUsage } = require('../analyze');

const OUTPUT = path.join(__dirname, '..', 'data', 'reforge-usage.json');
const ITEMS_URL = 'https://api.hypixel.net/v2/resources/skyblock/items';
const AUCTIONS_URL = 'https://api.hypixel.net/v2/skyblock/auctions';

const REQUEST_TIMEOUT = 30 * 1000;
const RETRY_DELAYS = [5 * 1000, 20 * 1000];
const PAUSE_BETWEEN_PAGES = 300;
// Far below a normal scan, which counts over a thousand, so a broken scan can't replace good data.
const MIN_PLAUSIBLE_LISTINGS = 200;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Retries network errors, rate limits and server errors. Anything else is a real answer. */
async function fetchWithRetry(url) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT) });
      if ((response.status !== 429 && response.status < 500) || attempt >= RETRY_DELAYS.length) return response;
    } catch (error) {
      if (attempt >= RETRY_DELAYS.length) throw error;
    }
    await sleep(RETRY_DELAYS[attempt]);
  }
}

async function fetchJson(url) {
  const response = await fetchWithRetry(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

/** Reads every auction house page. A page or two can vanish mid-scan, as listings move around. */
async function scan(items) {
  const itemsById = new Map(items.items.map((item) => [item.id, item]));
  const usage = { weapons: {}, groups: {} };
  const addPage = (page) => {
    for (const auction of page.auctions) {
      for (const item of decodeItems(auction.item_bytes)) addReforgeUsage(usage, item, itemsById);
    }
  };

  const first = await fetchJson(`${AUCTIONS_URL}?page=0`);
  addPage(first);
  let pagesRead = 1;
  for (let page = 1; page < first.totalPages; page++) {
    await sleep(PAUSE_BETWEEN_PAGES);
    try {
      const response = await fetchWithRetry(`${AUCTIONS_URL}?page=${page}`);
      if (response.ok) {
        addPage(await response.json());
        pagesRead += 1;
      }
    } catch (error) {
      console.warn(`Skipped auction page ${page}: ${error.message}`);
    }
  }
  if (pagesRead < first.totalPages / 2) throw new Error(`Only read ${pagesRead} of ${first.totalPages} auction pages.`);
  console.log(`Read ${pagesRead} of ${first.totalPages} auction pages.`);
  return usage;
}

function assertPlausible(usage) {
  const listings = Object.values(usage.groups).reduce((sum, group) => sum + group.count, 0);
  if (listings < MIN_PLAUSIBLE_LISTINGS) throw new Error(`Only found ${listings} upgraded weapons, so the old data was kept.`);
  return listings;
}

/** Sorted, so the file only shows real changes when it's updated. */
function sorted(value) {
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sorted(value[key])]),
  );
}

async function main() {
  const usage = await scan(await fetchJson(ITEMS_URL));
  const listings = assertPlausible(usage);
  const output = { scannedAt: new Date().toISOString(), ...sorted(usage) };
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(output, null, 1)}\n`);
  console.log(`Saved reforge usage from ${listings} upgraded weapons.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Update failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { assertPlausible, sorted };
