'use strict';

// Builds the site into dist/. This runs inside GitHub Actions, the only place the Hypixel key
// exists. The published site is only the finished results, so the key never reaches a browser.

const fs = require('node:fs');
const path = require('node:path');
const { buildGameData, addReforgeUsage, analyzeMember, decodeItems } = require('../analyze');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PLAYERS_FILE = path.join(ROOT, 'players.txt');

const NEU_REPO = 'https://raw.githubusercontent.com/NotEnoughUpdates/NotEnoughUpdates-REPO/master/constants';
const GAME_DATA_URLS = {
  items: 'https://api.hypixel.net/v2/resources/skyblock/items',
  neu: `${NEU_REPO}/enchants.json`,
  stones: `${NEU_REPO}/reforgestones.json`,
  basic: `${NEU_REPO}/reforges.json`,
  skyhanni: 'https://raw.githubusercontent.com/hannibal002/SkyHanni-REPO/main/constants/Enchants.json',
};
const AUCTIONS_URL = 'https://api.hypixel.net/v2/skyblock/auctions';

const REQUEST_TIMEOUT = 30 * 1000;
const RETRY_DELAYS = [5 * 1000, 20 * 1000];
const PAUSE_BETWEEN_REQUESTS = 300;
const USERNAME = /^[A-Za-z0-9_]{1,16}$/;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A problem with one player. It goes on their page instead of stopping the whole build. */
class PlayerProblem extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** One name per line. `#` starts a comment. Names are checked because they become file names. */
function parsePlayerList(text) {
  const names = new Map();
  for (const rawLine of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const name = rawLine.replace(/#.*/, '').trim();
    if (!name) continue;
    if (!USERNAME.test(name)) throw new Error(`players.txt: "${name}" isn't a valid Minecraft username.`);
    names.set(name.toLowerCase(), name);
  }
  return [...names.values()];
}

/** Last line of defence: refuse to publish a site that contains the key anywhere. */
function assertNoKey(dir, key) {
  if (!key) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    if (fs.readFileSync(file).includes(key)) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw new Error('The API key ended up in a published file, so nothing was published.');
    }
  }
}

/** Retries network errors, rate limits and server errors. Anything else is a real answer. */
async function fetchWithRetry(url, options = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT) });
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

async function loadRawGameData() {
  const entries = await Promise.all(Object.entries(GAME_DATA_URLS).map(async ([name, url]) => [name, await fetchJson(url)]));
  return Object.fromEntries(entries);
}

/** Reads every auction house page. A page or two can vanish mid-scan, as listings move around. */
async function scanReforgeUsage(items) {
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
    await sleep(PAUSE_BETWEEN_REQUESTS);
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

async function lookupPlayer(name) {
  const notFound = () => new PlayerProblem('player_not_found', `No Minecraft player is called "${name}".`);
  let mojangStatus = 0;
  try {
    const response = await fetchWithRetry(`https://api.mojang.com/users/profiles/minecraft/${name}`);
    mojangStatus = response.status;
    if (response.ok) {
      const { id, name: realName } = await response.json();
      return { uuid: id, name: realName };
    }
  } catch {
    // Mojang is down or blocking this machine, the backup below can still answer.
  }
  if (mojangStatus === 404 || mojangStatus === 204) throw notFound();

  const response = await fetchWithRetry(`https://playerdb.co/api/player/minecraft/${name}`);
  const body = await response.json().catch(() => null);
  if (body?.code === 'player.found') return { uuid: body.data.player.raw_id, name: body.data.player.username };
  if (body?.code === 'minecraft.invalid_username') throw notFound();
  throw new Error(`Couldn't look up "${name}": Mojang returned ${mojangStatus}, PlayerDB returned ${response.status}.`);
}

async function fetchProfiles(uuid, key) {
  const response = await fetchWithRetry(`https://api.hypixel.net/v2/skyblock/profiles?uuid=${uuid}`, { headers: { 'API-Key': key } });
  const body = await response.json().catch(() => null);
  if (response.status === 403) throw new Error('Hypixel rejected the HYPIXEL_API_KEY secret. It may have expired, so update it in the repo settings.');
  if (!response.ok || !body?.success) throw new Error(`Hypixel returned an error: ${body?.cause ?? response.status}`);
  return body.profiles ?? [];
}

async function buildPlayer(name, key, game) {
  const player = await lookupPlayer(name);
  const profiles = await fetchProfiles(player.uuid, key);

  // People who left a co-op stay listed on it, marked with a deletion notice.
  const usable = profiles.filter((p) => p.members?.[player.uuid] && !p.members[player.uuid].profile?.deletion_notice);
  if (!usable.length) throw new PlayerProblem('no_profiles', `${player.name} hasn't played SkyBlock.`);

  return {
    ...player,
    profiles: usable.map((p) => ({
      id: p.profile_id,
      name: p.cute_name,
      mode: p.game_mode ?? null,
      selected: Boolean(p.selected),
      ...analyzeMember(p.members[player.uuid], game),
    })),
  };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

async function main() {
  const key = process.env.HYPIXEL_API_KEY?.trim() ?? '';
  const names = parsePlayerList(fs.existsSync(PLAYERS_FILE) ? fs.readFileSync(PLAYERS_FILE, 'utf8') : '');
  if (names.length && !key) throw new Error('The HYPIXEL_API_KEY secret is missing. Add it in the repo under Settings, Secrets and variables, Actions.');

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.cpSync(PUBLIC_DIR, DIST, { recursive: true });

  const players = [];
  if (names.length) {
    const raw = await loadRawGameData();
    const usage = await scanReforgeUsage(raw.items);
    const game = buildGameData(raw.items, raw.neu, raw.skyhanni, { stones: raw.stones, basic: raw.basic, usage });

    for (const name of names) {
      let result;
      try {
        result = await buildPlayer(name, key, game);
        const weapons = result.profiles.reduce((sum, profile) => sum + profile.weapons.length, 0);
        console.log(`${result.name}: ${weapons} weapons on ${result.profiles.length} profiles.`);
      } catch (error) {
        // Anything else stops the build, which leaves the last good version of the site online.
        if (!(error instanceof PlayerProblem)) throw error;
        result = { name, error: error.code, message: error.message };
        console.warn(`${name}: ${error.message}`);
      }
      writeJson(path.join(DIST, 'data', 'players', `${name.toLowerCase()}.json`), { ...result, updatedAt: new Date().toISOString() });
      players.push({ name: result.name, file: name.toLowerCase() });
      await sleep(PAUSE_BETWEEN_REQUESTS);
    }
  }

  writeJson(path.join(DIST, 'data', 'index.json'), {
    updatedAt: new Date().toISOString(),
    repo: process.env.GITHUB_REPOSITORY ?? null,
    players,
  });
  assertNoKey(DIST, key);
  console.log(`Built the site for ${players.length} players.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Build failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { parsePlayerList, assertNoKey };
