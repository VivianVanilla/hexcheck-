'use strict';

// The only server code in Hexcheck, running as a Vercel Function. It's what lets the site search
// any username: the Hypixel key stays here as an environment variable, and the browser only ever
// receives the finished results.

const { buildGameData, analyzeMember } = require('../analyze');
const reforgeUsage = require('../data/reforge-usage.json');

const NEU_REPO = 'https://raw.githubusercontent.com/NotEnoughUpdates/NotEnoughUpdates-REPO/master/constants';
const GAME_DATA_URLS = {
  items: 'https://api.hypixel.net/v2/resources/skyblock/items',
  neu: `${NEU_REPO}/enchants.json`,
  stones: `${NEU_REPO}/reforgestones.json`,
  basic: `${NEU_REPO}/reforges.json`,
  skyhanni: 'https://raw.githubusercontent.com/hannibal002/SkyHanni-REPO/main/constants/Enchants.json',
};
const GAME_DATA_TTL = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT = 15 * 1000;
const USERNAME = /^[A-Za-z0-9_]{1,16}$/;

// Vercel's CDN answers repeat searches itself, so they don't reach Hypixel or use up the key's
// rate limit. Browsers don't keep a copy (max-age=0), so a search never gets stuck on old data.
const CACHE_RESULT = 'public, max-age=0, s-maxage=120, stale-while-revalidate=600';
const CACHE_NOT_FOUND = 'public, max-age=0, s-maxage=300';
const NO_CACHE = 'no-store';

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const timedFetch = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT) });

let gameData = null;
let gameDataAt = 0;
let gameDataLoading = null;

async function loadGameData() {
  const entries = await Promise.all(
    Object.entries(GAME_DATA_URLS).map(async ([name, url]) => {
      const response = await timedFetch(url);
      if (!response.ok) throw new Error(`${url} returned ${response.status}`);
      return [name, await response.json()];
    }),
  );
  const { items, neu, skyhanni, stones, basic } = Object.fromEntries(entries);
  return buildGameData(items, neu, skyhanni, { stones, basic, usage: reforgeUsage });
}

/** Kept in memory while Vercel keeps this function warm, so most searches skip the downloads. */
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
    throw new ApiError(502, 'data_down', "Couldn't load the enchantment and item data. Try again in a moment.");
  }
}

async function lookupPlayer(name) {
  const notFound = () => new ApiError(404, 'player_not_found', `No Minecraft player is called "${name}".`);
  let mojangStatus = 0;
  try {
    const response = await timedFetch(`https://api.mojang.com/users/profiles/minecraft/${name}`);
    mojangStatus = response.status;
    if (response.ok) {
      const { id, name: realName } = await response.json();
      return { uuid: id, name: realName };
    }
  } catch {
    // Mojang is down or blocking this server, the backup below can still answer.
  }
  if (mojangStatus === 404 || mojangStatus === 204) throw notFound();

  let body = null;
  try {
    const response = await timedFetch(`https://playerdb.co/api/player/minecraft/${name}`);
    body = await response.json();
  } catch {
    // Handled below, along with any other unusable answer.
  }
  if (body?.code === 'player.found') return { uuid: body.data.player.raw_id, name: body.data.player.username };
  if (body?.code === 'minecraft.invalid_username') throw notFound();
  throw new ApiError(502, 'lookup_down', "Couldn't look up that username right now. Try again in a moment.");
}

async function fetchProfiles(uuid) {
  const key = process.env.HYPIXEL_API_KEY?.trim();
  if (!key) throw new ApiError(503, 'no_key', "This site's Hypixel API key isn't set up yet.");

  let response;
  let body = null;
  try {
    response = await timedFetch(`https://api.hypixel.net/v2/skyblock/profiles?uuid=${uuid}`, { headers: { 'API-Key': key } });
    body = await response.json().catch(() => null);
  } catch {
    throw new ApiError(502, 'hypixel_down', "Couldn't reach Hypixel. Try again in a moment.");
  }

  if (response.status === 403) {
    // Hypixel explains a bad key in JSON. Any other 403 is a firewall refusing this server,
    // which replacing the key wouldn't fix, so the two need different messages.
    if (body?.cause) throw new ApiError(503, 'bad_key', `Hypixel rejected this site's API key. It said: ${body.cause}.`);
    throw new ApiError(502, 'hypixel_blocked', "Hypixel's firewall refused this server's request, so the API key isn't the problem. Try again later.");
  }
  if (response.status === 429) throw new ApiError(429, 'rate_limited', 'Hypixel says too many requests. Wait a minute and try again.');
  if (!response.ok || !body?.success) {
    throw new ApiError(502, 'hypixel_error', `Hypixel returned an error: ${body?.cause ?? response.status}`);
  }
  return body.profiles ?? [];
}

async function buildResult(name) {
  const player = await lookupPlayer(name);
  const [profiles, game] = await Promise.all([fetchProfiles(player.uuid), getGameData()]);

  // People who left a co-op stay listed on it, marked with a deletion notice.
  const usable = profiles.filter((p) => p.members?.[player.uuid] && !p.members[player.uuid].profile?.deletion_notice);
  if (!usable.length) throw new ApiError(404, 'no_profiles', `${player.name} hasn't played SkyBlock.`);

  return {
    ...player,
    updatedAt: new Date().toISOString(),
    // Every profile goes in one response, so switching between them on the page is instant.
    profiles: usable.map((p) => ({
      id: p.profile_id,
      name: p.cute_name,
      mode: p.game_mode ?? null,
      selected: Boolean(p.selected),
      ...analyzeMember(p.members[player.uuid], game),
    })),
  };
}

function jsonResponse(status, body, cacheControl) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cacheControl },
  });
}

/** GET /api/weapons?name=<username> */
async function GET(request) {
  const name = new URL(request.url).searchParams.get('name') ?? '';
  try {
    if (!USERNAME.test(name)) throw new ApiError(400, 'bad_name', "That isn't a valid Minecraft username.");
    return jsonResponse(200, await buildResult(name), CACHE_RESULT);
  } catch (error) {
    if (error instanceof ApiError) {
      return jsonResponse(error.status, { error: error.code, message: error.message }, error.status === 404 ? CACHE_NOT_FOUND : NO_CACHE);
    }
    console.error(error);
    return jsonResponse(500, { error: 'server_error', message: 'Something went wrong on the server.' }, NO_CACHE);
  }
}

module.exports = { GET };
