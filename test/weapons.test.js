'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const realItem = require('./real-item.json');

const KEY = 'test-key-value';
const UUID = 'a'.repeat(32);

// Small copies of the upstream data, in their real shapes. The player owns a real Sting.
const GAME_DATA = {
  '/v2/resources/skyblock/items': { items: [{ id: 'STING', name: 'Sting', category: 'SWORD', tier: 'LEGENDARY' }] },
  '/constants/enchants.json': { enchants: { SWORD: ['sharpness'] }, enchant_pools: [], enchant_mapping_id: [], enchant_mapping_item: [] },
  '/constants/reforgestones.json': {},
  '/constants/reforges.json': { Sharp: { reforgeName: 'Sharp', itemTypes: 'SWORD/ROD', reforgeStats: { LEGENDARY: { crit_chance: 20 } } } },
  '/constants/Enchants.json': { NORMAL: { sharpness: { loreName: 'Sharpness', nbtName: 'sharpness', maxLevel: 7 } } },
  // The Art of War is on the Bazaar with nobody selling, so its auction price has to win.
  '/v2/skyblock/bazaar': {
    products: {
      ENCHANTMENT_SHARPNESS_7: { quick_status: { buyPrice: 100 } },
      THE_ART_OF_WAR: { quick_status: { buyPrice: 0 } },
    },
  },
  '/pricesV2.json': { ENCHANTMENT_SHARPNESS_7: 999, THE_ART_OF_WAR: 500 },
};

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const member = (inventory) => ({ inventory });
const profile = (id, members, extra = {}) => ({ profile_id: id, cute_name: id, members, ...extra });
const PROFILES = [
  profile('Mango', { [UUID]: member({ inv_contents: { data: realItem.data } }) }, { selected: true }),
  profile('Kiwi', { [UUID]: member({}) }, { game_mode: 'ironman' }),
  profile('LeftCoop', { [UUID]: { profile: { deletion_notice: { timestamp: 1 } } } }),
  profile('SomeoneElse', { [`${'b'.repeat(32)}`]: member({}) }),
];

/** Stands in for the whole internet, and records who was asked for what. */
function fakeNetwork(t, routes = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const { hostname, pathname } = new URL(url);
    calls.push({ hostname, pathname, key: options.headers?.['API-Key'] });
    if (hostname === 'api.mojang.com') return routes.mojang ? routes.mojang() : json({ id: UUID, name: 'Steve' });
    if (hostname === 'playerdb.co') return routes.playerdb ? routes.playerdb() : json({ code: 'minecraft.invalid_username' }, 400);
    if (pathname === '/v2/skyblock/profiles') return routes.profiles ? routes.profiles() : json({ success: true, profiles: PROFILES });
    if (routes.prices && /bazaar|pricesV2/.test(pathname)) return routes.prices(pathname);
    if (routes.gameData) return routes.gameData(pathname);
    const data = Object.entries(GAME_DATA).find(([suffix]) => pathname.endsWith(suffix));
    if (!data) throw new Error(`Unexpected request to ${url}`);
    return json(data[1]);
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  return calls;
}

/** Each test gets a fresh function, as if Vercel had just started it. */
function freshFunction(t, key = KEY) {
  const before = process.env.HYPIXEL_API_KEY;
  if (key) process.env.HYPIXEL_API_KEY = key;
  else delete process.env.HYPIXEL_API_KEY;
  t.after(() => {
    if (before === undefined) delete process.env.HYPIXEL_API_KEY;
    else process.env.HYPIXEL_API_KEY = before;
  });
  delete require.cache[require.resolve('../api/weapons')];
  return require('../api/weapons');
}

const get = (fn, name = 'steve') => fn.GET(new Request(`https://hexcheck.test/api/weapons?name=${encodeURIComponent(name)}`));
const silenceLogs = (t) => t.mock.method(console, 'error', () => {});

test('a search returns every usable profile and its weapons', async (t) => {
  fakeNetwork(t);
  const response = await get(freshFunction(t));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual([body.name, body.uuid], ['Steve', UUID]);
  assert.ok(!Number.isNaN(Date.parse(body.updatedAt)));
  assert.deepEqual(body.profiles.map((p) => p.id), ['Mango', 'Kiwi']); // Not the left co-op, or a stranger's.
  const [mango, kiwi] = body.profiles;
  assert.deepEqual([mango.selected, mango.inventoryOff, mango.weapons[0].id], [true, false, 'STING']);
  assert.deepEqual([kiwi.mode, kiwi.inventoryOff], ['ironman', true]);
});

test('results are cached by the CDN but not by browsers', async (t) => {
  fakeNetwork(t);
  const cache = (await get(freshFunction(t))).headers.get('Cache-Control');
  assert.match(cache, /public/);
  assert.match(cache, /max-age=0/);
  assert.match(cache, /s-maxage=\d+/);
});

test('the key only ever goes to Hypixel, and never comes back', async (t) => {
  const calls = fakeNetwork(t);
  const text = await (await get(freshFunction(t))).text();
  const withKey = calls.filter((call) => call.key);
  assert.deepEqual(withKey.map((call) => [call.hostname, call.pathname, call.key]), [['api.hypixel.net', '/v2/skyblock/profiles', KEY]]);
  assert.ok(!text.includes(KEY));
});

test('reforge suggestions come from the saved auction house data', async (t) => {
  fakeNetwork(t);
  const body = await (await get(freshFunction(t))).json();
  const { reforge } = body.profiles[0].weapons[0];
  assert.equal(reforge.basedOn, 'weapon');
  assert.ok(reforge.picks.length > 0);
});

const firstWeapon = async (response) => (await response.json()).profiles[0].weapons[0];
const artOfWar = (weapon) => weapon.upgrades.find((row) => row.label === 'The Art of War').coins;
const sharpness = (weapon) => weapon.enchants.upgrade.find((entry) => entry.id === 'sharpness').coins;
const down = () => new Response('down', { status: 500 });

test('prices use the Bazaar first, and auctions for anything not selling there', async (t) => {
  fakeNetwork(t);
  const weapon = await firstWeapon(await get(freshFunction(t)));
  assert.equal(sharpness(weapon), 100); // Bazaar's 100, not the auction price of 999.
  assert.equal(artOfWar(weapon), 500); // Nobody selling on the Bazaar.
  assert.ok(weapon.cost.total >= 600);
});

test('with both price sources down, searches still work with no estimate', async (t) => {
  silenceLogs(t);
  fakeNetwork(t, { prices: down });
  const response = await get(freshFunction(t));
  assert.equal(response.status, 200);
  const weapon = await firstWeapon(response);
  assert.equal(weapon.cost, null);
  assert.equal(weapon.progress.total > 0, true);
});

test('with only the Bazaar down, auction prices are used', async (t) => {
  fakeNetwork(t, { prices: (pathname) => (pathname.includes('bazaar') ? down() : json(GAME_DATA['/pricesV2.json'])) });
  const weapon = await firstWeapon(await get(freshFunction(t)));
  assert.equal(sharpness(weapon), 999);
});

test('with only auction prices down, Bazaar prices are used and the rest is flagged', async (t) => {
  fakeNetwork(t, { prices: (pathname) => (pathname.includes('bazaar') ? json(GAME_DATA['/v2/skyblock/bazaar']) : down()) });
  const weapon = await firstWeapon(await get(freshFunction(t)));
  assert.equal(sharpness(weapon), 100);
  assert.equal(artOfWar(weapon), null);
  assert.ok(weapon.cost.unpriced.includes('The Art of War'));
});

test('prices are reused for a while, then refreshed', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const calls = fakeNetwork(t);
  const fn = freshFunction(t);
  const bazaarCalls = () => calls.filter((call) => call.pathname.endsWith('/skyblock/bazaar')).length;
  await get(fn);
  t.mock.timers.tick(5 * 60 * 1000);
  await get(fn);
  assert.equal(bazaarCalls(), 1);
  t.mock.timers.tick(6 * 60 * 1000);
  await get(fn);
  assert.equal(bazaarCalls(), 2);
});

test('if a price refresh fails, the last good prices are kept', async (t) => {
  silenceLogs(t);
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  let broken = false;
  fakeNetwork(t, {
    prices: (pathname) => {
      if (broken) return down();
      return json(pathname.includes('bazaar') ? GAME_DATA['/v2/skyblock/bazaar'] : GAME_DATA['/pricesV2.json']);
    },
  });
  const fn = freshFunction(t);
  await get(fn);
  broken = true;
  t.mock.timers.tick(11 * 60 * 1000);
  const weapon = await firstWeapon(await get(fn));
  assert.equal(sharpness(weapon), 100);
});

test('bad usernames are refused before anything is looked up', async (t) => {
  const calls = fakeNetwork(t);
  const fn = freshFunction(t);
  for (const bad of ['', 'has space', '../../secret', 'way_too_long_for_minecraft', 'a%2Fb']) {
    const response = await get(fn, bad);
    assert.equal(response.status, 400, bad);
    assert.equal((await response.json()).error, 'bad_name');
  }
  assert.equal(calls.length, 0);
});

test('an unknown player is a cached 404, and Hypixel is never asked', async (t) => {
  const calls = fakeNetwork(t, { mojang: () => new Response(null, { status: 404 }) });
  const response = await get(freshFunction(t), 'nobody');
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, 'player_not_found');
  assert.match(response.headers.get('Cache-Control'), /s-maxage/);
  assert.ok(!calls.some((call) => call.pathname === '/v2/skyblock/profiles'));
});

test('if Mojang blocks the server, PlayerDB answers instead', async (t) => {
  fakeNetwork(t, {
    mojang: () => new Response('nope', { status: 403 }),
    playerdb: () => json({ code: 'player.found', data: { player: { raw_id: UUID, username: 'Steve' } } }),
  });
  const response = await get(freshFunction(t));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).name, 'Steve');
});

test('if Mojang is unreachable, PlayerDB can still say a player does not exist', async (t) => {
  fakeNetwork(t, {
    mojang: () => {
      throw new Error('network down');
    },
  });
  assert.equal((await (await get(freshFunction(t))).json()).error, 'player_not_found');
});

test('if both lookups fail, it says so and caches nothing', async (t) => {
  fakeNetwork(t, {
    mojang: () => {
      throw new Error('network down');
    },
    playerdb: () => new Response('<html>Bad gateway</html>', { status: 502 }),
  });
  const response = await get(freshFunction(t));
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, 'lookup_down');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('a player who never played SkyBlock is a cached 404', async (t) => {
  fakeNetwork(t, { profiles: () => json({ success: true, profiles: null }) });
  const response = await get(freshFunction(t));
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, 'no_profiles');
  assert.match(response.headers.get('Cache-Control'), /s-maxage/);
});

test('a missing key is explained, and Hypixel is never asked', async (t) => {
  const calls = fakeNetwork(t);
  const response = await get(freshFunction(t, null));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'no_key');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.ok(!calls.some((call) => call.pathname === '/v2/skyblock/profiles'));
});

test('a rejected key is explained, without repeating the key or caching it', async (t) => {
  fakeNetwork(t, { profiles: () => json({ success: false, cause: 'Invalid API key' }, 403) });
  const response = await get(freshFunction(t));
  const text = await response.text();
  assert.equal(response.status, 503);
  const body = JSON.parse(text);
  assert.equal(body.error, 'bad_key');
  assert.match(body.message, /Invalid API key/);
  assert.ok(!text.includes(KEY));
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('a firewall 403 does not blame the key', async (t) => {
  for (const reply of [() => new Response('<html>Access denied</html>', { status: 403 }), () => json({ success: false }, 403)]) {
    fakeNetwork(t, { profiles: reply });
    const response = await get(freshFunction(t));
    const body = await response.json();
    assert.equal(response.status, 502);
    assert.equal(body.error, 'hypixel_blocked');
    assert.match(body.message, /isn't the problem/);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
});

test('a Hypixel rate limit is passed along, and not cached', async (t) => {
  fakeNetwork(t, { profiles: () => json({ success: false }, 429) });
  const response = await get(freshFunction(t));
  assert.equal(response.status, 429);
  assert.equal((await response.json()).error, 'rate_limited');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('other Hypixel problems are explained and not cached', async (t) => {
  fakeNetwork(t, { profiles: () => new Response('<html>down</html>', { status: 503 }) });
  const response = await get(freshFunction(t));
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, 'hypixel_error');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('if the game data can not load at all, it says so', async (t) => {
  silenceLogs(t);
  fakeNetwork(t, { gameData: () => new Response('down', { status: 500 }) });
  const response = await get(freshFunction(t));
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, 'data_down');
});

test('game data is downloaded once, then reused', async (t) => {
  const calls = fakeNetwork(t);
  const fn = freshFunction(t);
  await get(fn);
  await get(fn);
  assert.equal(calls.filter((call) => call.pathname.endsWith('/skyblock/items')).length, 1);
});

test('searches at the same moment share one download', async (t) => {
  const calls = fakeNetwork(t);
  const fn = freshFunction(t);
  await Promise.all([get(fn), get(fn), get(fn)]);
  assert.equal(calls.filter((call) => call.pathname.endsWith('/skyblock/items')).length, 1);
});

test('old game data refreshes, and is kept if the refresh fails', async (t) => {
  silenceLogs(t);
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  let down = false;
  const calls = fakeNetwork(t, {
    gameData: (pathname) => {
      if (down) return new Response('down', { status: 500 });
      return json(Object.entries(GAME_DATA).find(([suffix]) => pathname.endsWith(suffix))[1]);
    },
  });
  const fn = freshFunction(t);
  await get(fn);

  t.mock.timers.tick(7 * 60 * 60 * 1000);
  await get(fn);
  assert.equal(calls.filter((call) => call.pathname.endsWith('/skyblock/items')).length, 2);

  t.mock.timers.tick(7 * 60 * 60 * 1000);
  down = true;
  const response = await get(fn);
  assert.equal(response.status, 200);
});

test('a surprise crash is a clean error with no details', async (t) => {
  silenceLogs(t);
  fakeNetwork(t, { profiles: () => json({ success: true, profiles: 'not a list' }) });
  const response = await get(freshFunction(t));
  const text = await response.text();
  assert.equal(response.status, 500);
  assert.deepEqual(JSON.parse(text), { error: 'server_error', message: 'Something went wrong on the server.' });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});
