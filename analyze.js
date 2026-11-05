'use strict';

// Everything that knows about SkyBlock lives here: decoding inventory blobs and
// working out what is left to do on a weapon. No network or HTTP in this file.

const zlib = require('node:zlib');

const WEAPON_CATEGORIES = new Set(['SWORD', 'LONGSWORD', 'BOW', 'GAUNTLET']);
const NECRON_BLADES = new Set(['NECRON_BLADE', 'HYPERION', 'ASTRAEA', 'SCYLLA', 'VALKYRIE']);
const WITHER_SCROLLS = ['IMPLOSION_SCROLL', 'SHADOW_WARP_SCROLL', 'WITHER_SHIELD_SCROLL'];
const MASTER_STARS = ['First', 'Second', 'Third', 'Fourth', 'Fifth'];
const NO_RECOMB_TIERS = new Set(['SPECIAL', 'VERY_SPECIAL', 'UNOBTAINABLE']);
// Not required to count as maxed. They never change the score, whether they're on the weapon or not.
const SKIPPABLE = {
  knockback: 'Most players leave this off',
  punch: 'It only adds arrow knockback',
};
// NEU's lists are slightly too generous: these books' own "Applied To" text leaves out these weapon types.
const NOT_APPLIED_TO = {
  BOW: ['ultimate_chimera'],
  GAUNTLET: ['ultimate_one_for_all', 'ultimate_soul_eater', 'ultimate_swarm'],
};
const HOT_POTATO_LIMIT = 10;
const POTATO_LIMIT = 15;
const TUNER_LIMIT = 4;
const GEM_ORDER = ['ROUGH', 'FLAWED', 'FINE', 'FLAWLESS', 'PERFECT'];
// Reforge suggestions: how many listings of one weapon we need before trusting them over
// similar weapons, and how popular a reforge must be to get suggested.
const MIN_USAGE_SAMPLE = 8;
const MAX_REFORGE_PICKS = 3;
const MIN_PICK_SHARE = 10;
const MAGE_ABILITY_SCALING = 0.2;
const PERCENT_STATS = new Set(['crit_chance', 'crit_damage', 'attack_speed', 'ability_damage']);
const RARITY_PATTERN = /\b(VERY SPECIAL|SPECIAL|UNCOMMON|COMMON|RARE|EPIC|LEGENDARY|MYTHIC|DIVINE|ULTIMATE)\b/;
// An enchant one level short of max earns this much of a finished step towards the percentage.
const ONE_LEVEL_SHORT_CREDIT = 0.5;
// The top level of these isn't a book: it's the level below plus one of these items.
const ENCHANT_UPGRADE_ITEMS = {
  bane_of_arthropods: 'ENSNARED_SNAIL',
  ender_slayer: 'ENDSTONE_IDOL',
  scavenger: 'GOLDEN_BOUNTY',
  smite: 'SEVERED_HAND',
  venomous: 'FATEFUL_STINGER',
};
// These only come from the enchanting table, which costs XP rather than coins.
const TABLE_ONLY_ENCHANTS = new Set(['aiming', 'flame', 'impaling', 'knockback', 'piercing', 'punch', 'silk_touch', 'smelting_touch']);
const POWER_SCROLLS = ['AMBER', 'AMETHYST', 'JADE', 'JASPER', 'OPAL', 'RUBY', 'SAPPHIRE', 'TOPAZ'].map((gem) => `${gem}_POWER_SCROLL`);
// Slots that take more than one kind of gem, going by what real items have in them.
const UNIVERSAL_SLOT_GEMS = {
  COMBAT: ['AMETHYST', 'JASPER', 'ONYX', 'OPAL', 'RUBY', 'SAPPHIRE'],
  DEFENSIVE: ['AMETHYST', 'OPAL', 'RUBY'],
};

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat('en-US');

// Stars have been stored as both numbers and strings over the years.
const num = (value) => parseInt(String(value ?? 0).replace(/\D/g, ''), 10) || 0;
const plain = (text) => text.replace(/§./g, '');
const titleCase = (id) =>
  id
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
const isUltimate = (id) => id.startsWith('ultimate_');
const byName = (a, b) => a.name.localeCompare(b.name);

/**
 * What a shopping list costs. Each entry is { id, amount } or { coins }. Gives null if
 * something on the list has no known price, and undefined if there are no prices at all.
 */
function priceOf(needs, prices) {
  if (!prices) return undefined;
  let total = 0;
  for (const { id, amount = 1, coins } of needs) {
    if (coins !== undefined) {
      total += coins;
    } else if (amount > 0) {
      const price = prices.get(id);
      if (!price) return null;
      total += price * amount;
    }
  }
  return Math.round(total);
}

/** The cheapest of several prices, ignoring any with no known price. */
function lowest(costs) {
  if (costs.includes(undefined)) return undefined;
  const known = costs.filter((coins) => coins !== null);
  return known.length ? Math.min(...known) : null;
}

/** Turns Hypixel's star and gem slot costs into a shopping list. */
const costNeeds = (costs) =>
  costs.map((cost) => {
    if (cost.type === 'COINS') return { coins: cost.coins };
    if (cost.type === 'ESSENCE') return { id: `ESSENCE_${cost.essence_type}`, amount: cost.amount };
    return { id: cost.item_id, amount: cost.amount };
  });

function parseNbt(buffer) {
  let pos = 0;
  const readString = () => {
    const length = buffer.readUInt16BE(pos);
    pos += 2;
    const text = buffer.toString('utf8', pos, pos + length);
    pos += length;
    return text;
  };
  const readArray = (size, readOne) => {
    const length = buffer.readInt32BE(pos);
    pos += 4;
    const values = [];
    for (let i = 0; i < length; i++) {
      values.push(readOne(pos));
      pos += size;
    }
    return values;
  };
  const readLong = (at) => Number(buffer.readBigInt64BE(at));
  const readTag = (type) => {
    let value;
    switch (type) {
      case 1:
        value = buffer.readInt8(pos);
        pos += 1;
        return value;
      case 2:
        value = buffer.readInt16BE(pos);
        pos += 2;
        return value;
      case 3:
        value = buffer.readInt32BE(pos);
        pos += 4;
        return value;
      case 4:
        value = readLong(pos);
        pos += 8;
        return value;
      case 5:
        value = buffer.readFloatBE(pos);
        pos += 4;
        return value;
      case 6:
        value = buffer.readDoubleBE(pos);
        pos += 8;
        return value;
      case 7:
        return readArray(1, (at) => buffer.readInt8(at));
      case 8:
        return readString();
      case 9: {
        const itemType = buffer.readUInt8(pos);
        pos += 1;
        const length = buffer.readInt32BE(pos);
        pos += 4;
        const items = [];
        for (let i = 0; i < length; i++) items.push(readTag(itemType));
        return items;
      }
      case 10: {
        const compound = {};
        for (;;) {
          const childType = buffer.readUInt8(pos);
          pos += 1;
          if (childType === 0) return compound;
          const name = readString();
          compound[name] = readTag(childType);
        }
      }
      case 11:
        return readArray(4, (at) => buffer.readInt32BE(at));
      case 12:
        return readArray(8, readLong);
      default:
        throw new Error(`Unknown NBT tag ${type} at byte ${pos}`);
    }
  };
  const rootType = buffer.readUInt8(pos);
  pos += 1;
  readString();
  return readTag(rootType);
}

/** Hypixel stores inventories as base64 of gzipped NBT, with the slots under `i`. */
function decodeItems(base64) {
  return parseNbt(zlib.gunzipSync(Buffer.from(base64, 'base64'))).i ?? [];
}

/**
 * Combines the three upstream data sets:
 *   items    - Hypixel's item list (category, stars, gemstone slots)
 *   neu      - NEU repo enchants.json (which enchants fit which weapon type, conflicts)
 *   skyhanni - SkyHanni repo Enchants.json (display names and true max levels)
 * plus, for reforge suggestions:
 *   stones, basic - NEU repo reforgestones.json and reforges.json (stats by rarity)
 *   usage         - what upgraded weapons on the auction house use, see addReforgeUsage
 */
function buildGameData(items, neu, skyhanni, { stones = {}, basic = {}, usage = null } = {}) {
  const alias = { ultimate_duplex: 'ultimate_reiterate' };
  neu.enchant_mapping_id.forEach((from, i) => {
    alias[from.toLowerCase()] = neu.enchant_mapping_item[i].toLowerCase();
  });
  const canon = (name) => alias[name.toLowerCase()] ?? name.toLowerCase();

  const enchants = new Map();
  for (const group of Object.values(skyhanni)) {
    for (const entry of Object.values(group)) {
      enchants.set(canon(entry.nbtName), {
        name: entry.loreName,
        max: entry.maxLevel,
        stackKey: entry.nbtNum,
        stackLevels: entry.stackLevel,
      });
    }
  }

  const lists = {};
  for (const [category, ids] of Object.entries(neu.enchants)) {
    const excluded = NOT_APPLIED_TO[category] ?? [];
    lists[category] = [...new Set(ids.map(canon))].filter((id) => enchants.has(id) && !excluded.includes(id));
  }

  // Reforges are stored on items by a modifier id, which only sometimes differs from the name.
  const reforges = new Map();
  const addReforge = (entry, stone) => {
    reforges.set((entry.nbtModifier ?? entry.reforgeName).toLowerCase(), {
      name: entry.reforgeName,
      stone,
      types: entry.itemTypes,
      stats: entry.reforgeStats,
      ability: entry.reforgeAbility,
      costs: entry.reforgeCosts,
    });
  };
  for (const entry of Object.values(basic)) addReforge(entry, null);
  for (const [id, entry] of Object.entries(stones)) addReforge(entry, entry.internalName ?? id);

  return {
    items: new Map(items.items.map((item) => [item.id, item])),
    enchants,
    lists,
    pools: neu.enchant_pools.map((pool) => pool.map(canon)),
    canon,
    reforges,
    reforgeUsage: usage,
  };
}

const baseWeaponId = (id) => id.replace(/^STARRED_/, '');

function usageGroup(apiItem) {
  if (apiItem.category !== 'SWORD') return apiItem.category;
  return apiItem.ability_damage_scaling >= MAGE_ABILITY_SCALING ? 'MAGE_SWORD' : 'SWORD';
}

/**
 * Counts one auction house item towards the reforge suggestions. Only weapons with real
 * upgrades count, because freshly dropped ones just carry whatever reforge they rolled.
 */
function addReforgeUsage(usage, item, itemsById) {
  const extra = item?.tag?.ExtraAttributes;
  const apiItem = extra?.id && itemsById.get(extra.id);
  if (!apiItem || !WEAPON_CATEGORIES.has(apiItem.category) || !extra.modifier) return;

  const stars = Math.max(num(extra.dungeon_item_level), num(extra.upgrade_level));
  const enchantCount = Object.keys(extra.enchantments ?? {}).length;
  const upgraded = num(extra.hot_potato_count) >= HOT_POTATO_LIMIT || num(extra.rarity_upgrades) > 0 || (stars >= 5 && enchantCount >= 8);
  if (!upgraded) return;

  const modifier = extra.modifier.toLowerCase();
  const tally = (buckets, key) => {
    const bucket = (buckets[key] ??= { count: 0, reforges: {} });
    bucket.count += 1;
    bucket.reforges[modifier] = (bucket.reforges[modifier] ?? 0) + 1;
  };
  tally(usage.weapons, baseWeaponId(extra.id));
  tally(usage.groups, usageGroup(apiItem));
}

// Reforge text carries colour codes and icons from the game's private font.
const cleanText = (text) => plain(text).replace(/[\uE000-\uF8FF]/g, '').replace(/\s+/g, ' ').trim();

function itemRarity(lore, apiItem) {
  const line = lore.length ? plain(lore[lore.length - 1]) : '';
  return line.match(RARITY_PATTERN)?.[1].replace(' ', '_') ?? apiItem.tier;
}

function formatReforgeStats(stats) {
  return Object.entries(stats ?? {})
    .map(([stat, value]) => `${value > 0 ? '+' : ''}${value}${PERCENT_STATS.has(stat) ? '%' : ''} ${titleCase(stat)}`)
    .join(', ');
}

/** Item-locked stones like Gilded can't be borrowed from what similar weapons use. */
function fitsWeapon(reforge, id) {
  const locked = reforge?.types?.internalName;
  return !locked || locked.includes(id) || locked.includes(baseWeaponId(id));
}

function suggestReforges(extra, apiItem, lore, game, prices) {
  const usage = game.reforgeUsage;
  if (!usage) return null;

  const own = usage.weapons[baseWeaponId(extra.id)];
  const exact = own?.count >= MIN_USAGE_SAMPLE;
  const bucket = exact ? own : usage.groups[usageGroup(apiItem)];
  if (!bucket) return null;

  const eligible = Object.entries(bucket.reforges).filter(([id]) => exact || fitsWeapon(game.reforges.get(id), extra.id));
  const count = eligible.reduce((sum, [, uses]) => sum + uses, 0);
  const rarity = itemRarity(lore, apiItem);
  const current = extra.modifier?.toLowerCase();

  const picks = eligible
    .map(([id, uses]) => [id, Math.round((uses / count) * 100)])
    .filter(([, share]) => share >= MIN_PICK_SHARE)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_REFORGE_PICKS)
    .map(([id, share]) => {
      const reforge = game.reforges.get(id);
      const ability = typeof reforge?.ability === 'object' ? reforge.ability?.[rarity] : reforge?.ability;
      return {
        id,
        name: reforge?.name ?? titleCase(id),
        share,
        source: reforge?.stone ? (game.items.get(reforge.stone)?.name ?? titleCase(reforge.stone)) : 'Blacksmith roll',
        stats: formatReforgeStats(reforge?.stats?.[rarity]),
        ability: ability ? cleanText(ability) : undefined,
        isCurrent: id === current,
        // The stone plus the fee to apply it. Blacksmith rolls cost so little they aren't priced.
        coins: reforge?.stone ? priceOf([{ id: reforge.stone }, { coins: reforge.costs?.[rarity] ?? 0 }], prices) : undefined,
      };
    });
  return picks.length ? { basedOn: exact ? 'weapon' : 'group', count, picks } : null;
}

function stackNote(info, extra) {
  if (!info.stackLevels) return undefined;
  const target = info.stackLevels[info.max - 1];
  const progress = extra[info.stackKey];
  if (typeof progress === 'number' && target) {
    return `Levels up with use: ${compact.format(progress)} / ${compact.format(target)}`;
  }
  return 'Levels up with use';
}

const book = (id, level) => ({ id: `ENCHANTMENT_${id.toUpperCase()}_${level}` });

/** Every way to take an enchant from its current level (0 if it's missing) to max, as shopping lists. */
function waysToMax(id, level, max, game) {
  if (TABLE_ONLY_ENCHANTS.has(id)) return [[]];
  if (game.enchants.get(id).stackLevels) return [level > 0 ? [] : [book(id, 1)]]; // These level up with use.

  const upgradeItem = ENCHANT_UPGRADE_ITEMS[id];
  if (upgradeItem) return [[...(level < max - 1 ? [book(id, max - 1)] : []), { id: upgradeItem }]];

  const ways = [[book(id, max)]];
  // Two ultimate books of one level combine into the next, so the level already on the weapon
  // counts. Other enchants don't work like that: a Sharpness VII book costs far more than two VIs.
  if (isUltimate(id) && level > 0) {
    const steps = [];
    for (let step = level; step < max; step++) steps.push(book(id, step));
    ways.push(steps);
  }
  return ways;
}

const enchantCoins = (id, level, max, game, prices) => lowest(waysToMax(id, level, max, game).map((needs) => priceOf(needs, prices)));

function enchantNote(id, info, extra, game) {
  if (SKIPPABLE[id]) return SKIPPABLE[id];
  if (info.stackLevels) return stackNote(info, extra);
  if (TABLE_ONLY_ENCHANTS.has(id)) return 'From the enchanting table, which costs XP instead of coins';
  const upgradeItem = ENCHANT_UPGRADE_ITEMS[id];
  return upgradeItem ? `Last level uses ${game.items.get(upgradeItem)?.name ?? titleCase(upgradeItem)}` : undefined;
}

function analyzeEnchants(extra, category, game, prices) {
  const applied = new Map(
    Object.entries(extra.enchantments ?? {}).map(([id, level]) => [game.canon(id), num(level)]),
  );
  const result = {
    ultimate: null,
    ultimateOptions: [],
    cheapestUltimate: null,
    upgrade: [],
    missing: [],
    pickOne: [],
    skippable: [],
    maxed: [],
    other: [],
    oneForAll: applied.has('ultimate_one_for_all'),
  };

  for (const [id, level] of applied) {
    const info = game.enchants.get(id);
    if (isUltimate(id)) {
      result.ultimate = {
        id,
        name: info?.name ?? titleCase(id.replace('ultimate_', '')),
        level,
        max: info?.max ?? null,
        coins: info && level < info.max ? enchantCoins(id, level, info.max, game, prices) : undefined,
      };
    } else if (!info) {
      // Removed or brand new enchants: we can show them but cannot judge them.
      result.other.push({ id, name: titleCase(id), level });
    } else if (level >= info.max) {
      result.maxed.push({ id, name: info.name, level });
    } else {
      const entry = { id, name: info.name, level, max: info.max, note: enchantNote(id, info, extra, game) };
      if (SKIPPABLE[id]) result.skippable.push(entry);
      else result.upgrade.push({ ...entry, coins: enchantCoins(id, level, info.max, game, prices) });
    }
  }

  const list = game.lists[category] ?? [];
  const available = (id) => {
    const info = game.enchants.get(id);
    const coins = SKIPPABLE[id] ? undefined : enchantCoins(id, 0, info.max, game, prices);
    return { id, name: info.name, max: info.max, note: enchantNote(id, info, extra, game), coins };
  };

  if (!result.ultimate) {
    // Not filtered by conflicts: One For All replaces whatever is already on the weapon.
    result.ultimateOptions = list.filter(isUltimate).map(available).sort(byName);
    // It isn't a fair price to quote though, since it wipes every other enchant.
    const fairOptions = result.ultimateOptions.filter((option) => option.id !== 'ultimate_one_for_all' && typeof option.coins === 'number');
    result.cheapestUltimate = fairOptions.reduce((best, option) => (!best || option.coins < best.coins ? option : best), null);
  }

  if (!result.oneForAll) {
    const isBlocked = (id) => game.pools.some((pool) => pool.includes(id) && pool.some((other) => other !== id && applied.has(other)));
    const open = new Set(list.filter((id) => !isUltimate(id) && !applied.has(id) && !isBlocked(id)));

    for (const pool of game.pools) {
      if (pool.some(isUltimate)) continue;
      const options = pool.filter((id) => open.has(id));
      if (options.length > 1) {
        const choices = options.map(available).sort(byName);
        result.pickOne.push({ options: choices, coins: lowest(choices.map((choice) => choice.coins)) });
        options.forEach((id) => open.delete(id));
      }
    }

    for (const id of open) (SKIPPABLE[id] ? result.skippable : result.missing).push(available(id));
  }

  for (const key of ['upgrade', 'missing', 'skippable', 'maxed', 'other']) result[key].sort(byName);
  return result;
}

function summarizeCosts(costs, game) {
  const totals = new Map();
  const add = (label, amount) => totals.set(label, (totals.get(label) ?? 0) + amount);
  for (const cost of costs) {
    if (cost.type === 'COINS') add('coins', cost.coins);
    else if (cost.type === 'ESSENCE') add(`${titleCase(cost.essence_type)} Essence`, cost.amount);
    else if (cost.type === 'ITEM') add(game.items.get(cost.item_id)?.name ?? titleCase(cost.item_id), cost.amount);
  }
  return [...totals].map(([label, amount]) => `${whole.format(amount)} ${label}`).join(', ');
}

function reforgeName(extra, apiItem, name) {
  // The real reforge name is the prefix on the item name, the NBT id can differ from it.
  const prefix = plain(name).split(apiItem.name)[0].replace(/[^A-Za-z' -]/g, '').trim();
  return prefix || titleCase(extra.modifier.replace(/_(bow|sword)$/, ''));
}

function analyzeUpgrades(extra, apiItem, lore, name, reforge, game, prices) {
  const rows = [];
  const add = (label, status, value, note, { optional = false, needs, coins } = {}) => {
    const priced = coins !== undefined ? coins : needs ? priceOf(needs, prices) : undefined;
    rows.push({ label, status, value, note, optional, coins: status === 'done' ? undefined : priced });
  };
  const applied = (value) => (value > 0 ? 'done' : 'todo');
  const loreText = plain(lore.join('\n'));

  const potatoes = num(extra.hot_potato_count);
  const potatoNote =
    potatoes < HOT_POTATO_LIMIT
      ? `Add ${HOT_POTATO_LIMIT - potatoes} Hot Potato, then ${POTATO_LIMIT - HOT_POTATO_LIMIT} Fuming`
      : potatoes < POTATO_LIMIT
        ? `Add ${POTATO_LIMIT - potatoes} Fuming`
        : undefined;
  add(
    'Potato Books',
    potatoes >= POTATO_LIMIT ? 'done' : potatoes > 0 ? 'partial' : 'todo',
    `${potatoes} / ${POTATO_LIMIT}`,
    potatoNote,
    {
      needs: [
        { id: 'HOT_POTATO_BOOK', amount: HOT_POTATO_LIMIT - potatoes },
        { id: 'FUMING_POTATO_BOOK', amount: POTATO_LIMIT - Math.max(potatoes, HOT_POTATO_LIMIT) },
      ],
    },
  );

  if (!NO_RECOMB_TIERS.has(apiItem.tier)) {
    const recomb = num(extra.rarity_upgrades);
    add('Recombobulator 3000', applied(recomb), recomb ? 'Applied' : 'Not applied', undefined, { needs: [{ id: 'RECOMBOBULATOR_3000' }] });
  }

  const artOfWar = num(extra.art_of_war_count);
  add('The Art of War', applied(artOfWar), artOfWar ? 'Applied' : 'Not applied', undefined, { needs: [{ id: 'THE_ART_OF_WAR' }] });

  // Any reforge counts as done: the suggestions inform the choice, but only you know your build.
  const onAPick = reforge?.picks.some((pick) => pick.isCurrent);
  const reforgeNote = !reforge ? undefined : onAPick ? 'One of the most used' : `Most used: ${reforge.picks[0].name}`;
  add('Reforge', extra.modifier ? 'done' : 'todo', extra.modifier ? reforgeName(extra, apiItem, name) : 'None', reforgeNote, { coins: reforge?.picks[0].coins });

  const stars = Math.max(num(extra.dungeon_item_level), num(extra.upgrade_level));
  const starCosts = apiItem.upgrade_costs ?? [];
  if (starCosts.length) {
    const have = Math.min(stars, starCosts.length);
    const remaining = summarizeCosts(starCosts.slice(have).flat(), game);
    const convert = apiItem.dungeon_item_conversion_cost;
    const needsConverting = convert && !extra.dungeon_item && stars === 0;
    const convertNote = needsConverting ? `Convert to a dungeon item first (${convert.amount} ${titleCase(convert.essence_type)} Essence). ` : '';
    add(
      'Stars',
      have >= starCosts.length ? 'done' : have > 0 ? 'partial' : 'todo',
      `${have} / ${starCosts.length}`,
      remaining ? `${convertNote}Needs ${remaining}` : undefined,
      {
        needs: [
          ...costNeeds(starCosts.slice(have).flat()),
          ...(needsConverting ? [{ id: `ESSENCE_${convert.essence_type}`, amount: convert.amount }] : []),
        ],
      },
    );

    // Master Stars only go on 5-star dungeon items; 10-star Crimson gear has its own costs above.
    if (starCosts.length === MASTER_STARS.length && (apiItem.dungeon_item || convert)) {
      const master = Math.max(0, Math.min(stars - MASTER_STARS.length, MASTER_STARS.length));
      const next = MASTER_STARS.slice(master);
      add(
        'Master Stars',
        master >= MASTER_STARS.length ? 'done' : master > 0 ? 'partial' : 'todo',
        `${master} / ${MASTER_STARS.length}`,
        next.length ? `Needs ${next.join(', ')}` : undefined,
        { needs: next.map((star) => ({ id: `${star.toUpperCase()}_MASTER_STAR` })) },
      );
    }
  }

  if (NECRON_BLADES.has(extra.id)) {
    const scrolls = extra.ability_scroll ?? [];
    const owned = scrolls.includes('ULTIMATE_WITHER_SCROLL') ? WITHER_SCROLLS : WITHER_SCROLLS.filter((id) => scrolls.includes(id));
    const lacking = WITHER_SCROLLS.filter((id) => !owned.includes(id));
    add(
      'Wither Scrolls',
      lacking.length === 0 ? 'done' : owned.length ? 'partial' : 'todo',
      `${owned.length} / ${WITHER_SCROLLS.length}`,
      lacking.length ? `Needs ${lacking.map((id) => game.items.get(id)?.name ?? titleCase(id)).join(', ')}` : undefined,
      { needs: lacking.map((id) => ({ id })) },
    );
  }

  if (apiItem.can_have_power_scroll || /Ability:.*RIGHT CLICK/.test(loreText)) {
    const scroll = extra.power_ability_scroll;
    add(
      'Power Scroll',
      scroll ? 'done' : 'todo',
      scroll ? (game.items.get(scroll)?.name ?? titleCase(scroll)).replace(' Power Scroll', '') : 'None',
      scroll ? undefined : 'Any one of them, for its right-click buff',
      { coins: lowest(POWER_SCROLLS.map((id) => priceOf([{ id }], prices))) },
    );
  }

  if (/Ability:.*Transmission/.test(loreText) || extra.tuned_transmission !== undefined) {
    const tuners = num(extra.tuned_transmission);
    add('Transmission Tuners', tuners >= TUNER_LIMIT ? 'done' : tuners > 0 ? 'partial' : 'todo', `${tuners} / ${TUNER_LIMIT}`, undefined, {
      needs: [{ id: 'TRANSMISSION_TUNER', amount: TUNER_LIMIT - tuners }],
    });
  }

  if (extra.id === 'ASPECT_OF_THE_VOID') {
    const merged = num(extra.ethermerge);
    add('Etherwarp', applied(merged), merged ? 'Applied' : 'Not applied', merged ? undefined : 'Etherwarp Conduit, needs Enderman Slayer 7', {
      needs: [{ id: 'ETHERWARP_CONDUIT' }],
    });
  }

  const hasStatsBook = extra.stats_book !== undefined;
  add('Book of Stats', applied(hasStatsBook ? 1 : 0), hasStatsBook ? `${whole.format(num(extra.stats_book))} kills` : 'Not applied', 'Cosmetic, only tracks kills', { optional: true });

  return rows;
}

function analyzeGems(extra, apiItem, game, prices) {
  const gems = { ...(extra.gems ?? {}) };
  const unlocked = [...(gems.unlocked_slots ?? [])];
  delete gems.unlocked_slots;

  /** The cheapest Perfect gem a slot accepts, plus anything else that's needed first. */
  const perfectGemCoins = (slotType, firstNeeds = []) =>
    lowest((UNIVERSAL_SLOT_GEMS[slotType] ?? [slotType]).map((gem) => priceOf([...firstNeeds, { id: `PERFECT_${gem}_GEM` }], prices)));

  // Slots are matched by type rather than by index, because Hypixel does not
  // guarantee the numbers line up with the order in the item list.
  return (apiItem.gemstone_slots ?? []).map((slot) => {
    const prefix = `${slot.slot_type}_`;
    const label = `${titleCase(slot.slot_type)} slot`;
    const key = Object.keys(gems).find((k) => k.startsWith(prefix) && !k.endsWith('_gem'));

    if (key) {
      const raw = gems[key];
      const quality = (typeof raw === 'object' && raw !== null ? raw.quality : raw) ?? 'ROUGH';
      const type = gems[`${key}_gem`] ?? slot.slot_type;
      delete gems[key];
      delete gems[`${key}_gem`];
      const index = unlocked.indexOf(key);
      if (index !== -1) unlocked.splice(index, 1);
      const perfect = quality === GEM_ORDER[GEM_ORDER.length - 1];
      return {
        label,
        status: perfect ? 'done' : 'partial',
        value: `${titleCase(quality)} ${titleCase(type)}`,
        note: perfect ? undefined : `Replace with Perfect ${titleCase(type)}`,
        coins: perfect ? undefined : perfectGemCoins(type),
      };
    }

    const free = !slot.costs?.length;
    const unlockedIndex = unlocked.findIndex((k) => k.startsWith(prefix));
    if (free || unlockedIndex !== -1) {
      if (!free) unlocked.splice(unlockedIndex, 1);
      return { label, status: 'todo', value: 'Empty', note: 'Add a Perfect gem', coins: perfectGemCoins(slot.slot_type) };
    }
    return {
      label,
      status: 'todo',
      value: 'Locked',
      note: `Unlock for ${summarizeCosts(slot.costs, game)}, then add a Perfect gem`,
      coins: perfectGemCoins(slot.slot_type, costNeeds(slot.costs)),
    };
  });
}

function summarize(enchants, upgrades, gems) {
  const isOneLevelShort = (enchant) => enchant.level === enchant.max - 1;
  let done = enchants.maxed.filter((enchant) => !SKIPPABLE[enchant.id]).length;
  let left = enchants.upgrade.length + enchants.missing.length + enchants.pickOne.length;
  let oneLevelShort = enchants.upgrade.filter(isOneLevelShort).length;
  if (enchants.ultimate) {
    const { level, max } = enchants.ultimate;
    if (max === null || level >= max) {
      done += 1;
    } else {
      left += 1;
      if (isOneLevelShort(enchants.ultimate)) oneLevelShort += 1;
    }
  } else if (enchants.ultimateOptions.length) {
    left += 1;
  }
  for (const row of [...upgrades, ...gems]) {
    if (row.optional) continue;
    if (row.status === 'done') done += 1;
    else left += 1;
  }
  const total = done + left;
  const earned = done + oneLevelShort * ONE_LEVEL_SHORT_CREDIT;
  // Rounded down so a weapon only ever reads 100% when nothing is left.
  return { done, left, total, percent: total ? Math.floor((earned / total) * 100) : 100 };
}

/** Adds up what each to-do item costs, grouped the way the page shows them. */
function summarizeCost(enchants, upgrades, gems, prices) {
  if (!prices) return null;
  const unpriced = [];
  const sum = (entries) =>
    entries.reduce((total, { label, coins }) => {
      if (coins === null) unpriced.push(label);
      return total + (coins ?? 0);
    }, 0);

  const { ultimate, ultimateOptions, cheapestUltimate } = enchants;
  const enchantEntries = [
    ...enchants.upgrade.map(({ name, coins }) => ({ label: name, coins })),
    ...enchants.missing.map(({ name, coins }) => ({ label: name, coins })),
    ...enchants.pickOne.map(({ options, coins }) => ({ label: options.map((option) => option.name).join(' or '), coins })),
  ];
  if (ultimate) enchantEntries.push({ label: ultimate.name, coins: ultimate.coins });
  else if (ultimateOptions.length) enchantEntries.push({ label: 'Ultimate enchant', coins: cheapestUltimate?.coins ?? null });

  const enchantCoinsTotal = sum(enchantEntries);
  const upgradeCoinsTotal = sum(upgrades);
  const gemCoinsTotal = sum(gems);
  return {
    total: enchantCoinsTotal + upgradeCoinsTotal + gemCoinsTotal,
    enchants: enchantCoinsTotal,
    upgrades: upgradeCoinsTotal,
    gems: gemCoinsTotal,
    unpriced,
  };
}

function analyzeWeapon(item, source, game, prices = null) {
  const extra = item?.tag?.ExtraAttributes;
  const apiItem = extra?.id && game.items.get(extra.id);
  if (!apiItem || !WEAPON_CATEGORIES.has(apiItem.category)) return null;

  const { category } = apiItem;
  const lore = item.tag.display?.Lore ?? [];
  const name = item.tag.display?.Name ?? apiItem.name;
  const enchants = analyzeEnchants(extra, category, game, prices);
  const reforge = suggestReforges(extra, apiItem, lore, game, prices);
  const upgrades = analyzeUpgrades(extra, apiItem, lore, name, reforge, game, prices);
  const gems = analyzeGems(extra, apiItem, game, prices);
  return {
    id: extra.id,
    name,
    lore,
    source,
    category,
    enchants,
    upgrades,
    gems,
    reforge,
    progress: summarize(enchants, upgrades, gems),
    cost: summarizeCost(enchants, upgrades, gems, prices),
  };
}

/** Finds and scores every weapon a profile member owns. */
function analyzeMember(member, game, prices = null) {
  const inventory = member?.inventory;
  const sources = [
    ['Inventory', inventory?.inv_contents],
    ['Ender Chest', inventory?.ender_chest_contents],
    ['Personal Vault', inventory?.personal_vault_contents],
    ...Object.entries(inventory?.backpack_contents ?? {})
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([slot, contents]) => [`Backpack ${Number(slot) + 1}`, contents]),
  ];

  const weapons = [];
  let unreadable = 0;
  for (const [source, contents] of sources) {
    if (!contents?.data) continue;
    try {
      for (const item of decodeItems(contents.data)) {
        const weapon = analyzeWeapon(item, source, game, prices);
        if (weapon) weapons.push(weapon);
      }
    } catch {
      unreadable += 1;
    }
  }

  weapons.sort((a, b) => b.progress.percent - a.progress.percent || b.progress.done - a.progress.done);
  return { inventoryOff: !inventory?.inv_contents?.data, weapons, unreadable };
}

module.exports = { parseNbt, decodeItems, buildGameData, addReforgeUsage, analyzeWeapon, analyzeMember };
