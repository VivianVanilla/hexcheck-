'use strict';

// Small zero-dependency server. It exists so your Hypixel API key stays on this
// machine: the browser only ever talks to this server, never to Hypixel.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { exec } = require('node:child_process');
const { buildGameData, analyzeMember } = require('./analyze');

const PORT = Number(process.env.PORT) || 3737;
const HOST = process.env.HOST || '127.0.0.1';
const ENV_FILE = path.join(__dirname, '.env');
const PUBLIC_DIR = path.join(__dirname, 'public');

const STATIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  'img-src https://mc-heads.net',
].join('; ');

const GAME_DATA_URLS = {
  items: 'https://api.hypixel.net/v2/resources/skyblock/items',
  neu: 'https://raw.githubusercontent.com/NotEnoughUpdates/NotEnoughUpdates-REPO/master/constants/enchants.json',
  skyhanni: 'https://raw.githubusercontent.com/hannibal002/SkyHanni-REPO/main/constants/Enchants.json',
};
const GAME_DATA_TTL = 6 * 60 * 60 * 1000;
// Hypixel asks API users to cache, and its own profile data only refreshes about once a minute.
const PROFILE_TTL = 60 * 1000;
const PLAYER_TTL = 10 * 60 * 1000;
const REQUEST_TIMEOUT = 20 * 1000;

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Re-read every time so pasting a new key into .env works without a restart. */
function getApiKey() {
  if (process.env.HYPIXEL_API_KEY) return process.env.HYPIXEL_API_KEY.trim();
  try {
    const text = fs.readFileSync(ENV_FILE, 'utf8').replace(/^﻿/, '');
    const match = text.match(/^[ \t]*HYPIXEL_API_KEY[ \t]*=[ \t]*(\S*)[ \t]*$/m);
    return match ? match[1].replace(/^["']|["']$/g, '') : '';
  } catch {
    return '';
  }
}

const timedFetch = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT) });

let gameData = null;
let gameDataAt = 0;
let gameDataLoading = null;

async function loadGameData() {
  const [items, neu, skyhanni] = await Promise.all(
    Object.values(GAME_DATA_URLS).map(async (url) => {
      const response = await timedFetch(url);
      if (!response.ok) throw new Error(`${url} returned ${response.status}`);
      return response.json();
    }),
  );
  return buildGameData(items, neu, skyhanni);
}

async function getGameData() {
  if (gameData && Date.now() - gameDataAt < GAME_DATA_TTL) return gameData;
  gameDataLoading ??= loadGameData().finally(() => {
    gameDataLoading = null;
  });
  try {
    gameData = await gameDataLoading;
    gameDataAt = Date.now();
    return gameData;
  } catch (error) {
    console.error('Could not refresh game data:', error.message);
    if (gameData) return gameData; // A slightly old enchant list beats no answer.
    throw new ApiError(502, 'data_down', "Couldn't download the enchantment and item data. Check your connection and try again.");
  }
}

const playerCache = new Map();
const profileCache = new Map();

function remember(cache, key, value, ttl) {
  const now = Date.now();
  for (const [oldKey, entry] of cache) if (entry.expires < now) cache.delete(oldKey);
  cache.set(key, { value, expires: now + ttl });
  return value;
}

function recall(cache, key) {
  const entry = cache.get(key);
  return entry && entry.expires > Date.now() ? entry.value : undefined;
}

async function lookupPlayer(name) {
  const cacheKey = name.toLowerCase();
  const cached = recall(playerCache, cacheKey);
  if (cached) return cached;

  const notFound = () => new ApiError(404, 'player_not_found', `No Minecraft player is called "${name}".`);
  let mojangStatus = 0;
  try {
    const response = await timedFetch(`https://api.mojang.com/users/profiles/minecraft/${name}`);
    mojangStatus = response.status;
    if (response.ok) {
      const { id, name: realName } = await response.json();
      return remember(playerCache, cacheKey, { uuid: id, name: realName }, PLAYER_TTL);
    }
  } catch {
    // Mojang is down or slow, the backup below can still answer.
  }
  if (mojangStatus === 404 || mojangStatus === 204) throw notFound();

  try {
    const response = await timedFetch(`https://playerdb.co/api/player/minecraft/${name}`);
    const body = await response.json();
    if (body?.code === 'player.found') {
      const { raw_id: uuid, username } = body.data.player;
      return remember(playerCache, cacheKey, { uuid, name: username }, PLAYER_TTL);
    }
    if (response.status === 400 || response.status === 404) throw notFound();
  } catch (error) {
    if (error instanceof ApiError) throw error;
  }
  throw new ApiError(502, 'lookup_down', "Couldn't look up that username right now. Try again in a moment.");
}

async function fetchProfiles(uuid) {
  const cached = recall(profileCache, uuid);
  if (cached) return cached;

  const key = getApiKey();
  if (!key) throw new ApiError(503, 'no_key', 'No Hypixel API key is set up yet.');

  let response;
  let body = null;
  try {
    response = await timedFetch(`https://api.hypixel.net/v2/skyblock/profiles?uuid=${uuid}`, { headers: { 'API-Key': key } });
    body = await response.json().catch(() => null);
  } catch {
    throw new ApiError(502, 'hypixel_down', "Couldn't reach Hypixel. Try again in a moment.");
  }

  if (response.status === 403) throw new ApiError(403, 'bad_key', 'Hypixel rejected the API key. It may have expired.');
  if (response.status === 429) throw new ApiError(429, 'rate_limited', 'Hypixel says too many requests. Wait a minute and try again.');
  if (!response.ok || !body?.success) {
    throw new ApiError(502, 'hypixel_error', `Hypixel returned an error: ${body?.cause ?? response.status}`);
  }
  return remember(profileCache, uuid, body.profiles ?? [], PROFILE_TTL);
}

async function handleWeapons(url) {
  const name = url.searchParams.get('name') ?? '';
  if (!/^[A-Za-z0-9_]{1,16}$/.test(name)) {
    throw new ApiError(400, 'bad_name', "That isn't a valid Minecraft username.");
  }

  const player = await lookupPlayer(name);
  const [profiles, game] = await Promise.all([fetchProfiles(player.uuid), getGameData()]);

  // People who left a co-op stay listed on it, marked with a deletion notice.
  const usable = profiles.filter((p) => p.members?.[player.uuid] && !p.members[player.uuid].profile?.deletion_notice);
  if (!usable.length) {
    throw new ApiError(404, 'no_profiles', `${player.name} hasn't played SkyBlock.`);
  }

  const requested = url.searchParams.get('profile');
  const chosen = usable.find((p) => p.profile_id === requested) ?? usable.find((p) => p.selected) ?? usable[0];

  return {
    player,
    profile: chosen.profile_id,
    profiles: usable.map((p) => ({ id: p.profile_id, name: p.cute_name, mode: p.game_mode ?? null, selected: Boolean(p.selected) })),
    ...analyzeMember(chosen.members[player.uuid], game),
  };
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }

  try {
    if (url.pathname === '/api/status') {
      sendJson(res, 200, { hasKey: Boolean(getApiKey()) });
    } else if (url.pathname === '/api/weapons') {
      sendJson(res, 200, await handleWeapons(url));
    } else if (STATIC_FILES[url.pathname]) {
      const [file, type] = STATIC_FILES[url.pathname];
      const content = await fs.promises.readFile(path.join(PUBLIC_DIR, file));
      res.writeHead(200, { 'Content-Type': type, 'Content-Security-Policy': CONTENT_SECURITY_POLICY, 'Cache-Control': 'no-cache' });
      res.end(content);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    }
  } catch (error) {
    if (error instanceof ApiError) {
      sendJson(res, error.status, { error: error.code, message: error.message });
    } else {
      console.error(error);
      sendJson(res, 500, { error: 'server_error', message: 'Something went wrong on the server.' });
    }
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Hexcheck may already be running at http://localhost:${PORT}`);
    process.exit(1);
  }
  throw error;
});

server.listen(PORT, HOST, () => {
  const address = `http://localhost:${PORT}`;
  console.log(`Hexcheck is running at ${address}  (Ctrl+C to stop)`);
  if (!getApiKey()) console.log('No API key yet: paste one into the .env file. The page explains how.');
  getGameData().catch(() => {}); // Warm the cache so the first search is quick.
  if (process.argv.includes('--open')) exec(`start "" "${address}"`);
});
