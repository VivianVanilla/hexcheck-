'use strict';

// Everything that knows about SkyBlock lives here: decoding inventory blobs and
// working out what is left to do on a weapon. No network or HTTP in this file.

const zlib = require('node:zlib');

const WEAPON_CATEGORIES = new Set(['SWORD', 'LONGSWORD', 'BOW', 'GAUNTLET']);
const NECRON_BLADES = new Set(['NECRON_BLADE', 'HYPERION', 'ASTRAEA', 'SCYLLA', 'VALKYRIE']);
const WITHER_SCROLLS = ['IMPLOSION_SCROLL', 'SHADOW_WARP_SCROLL', 'WITHER_SHIELD_SCROLL'];
const MASTER_STARS = ['First', 'Second', 'Third', 'Fourth', 'Fifth'];
const NO_RECOMB_TIERS = new Set(['SPECIAL', 'VERY_SPECIAL', 'UNOBTAINABLE']);
const SKIPPABLE = { knockback: 'Most players leave this off' };
// NEU's lists are slightly too generous: these books' own "Applied To" text leaves out these weapon types.
const NOT_APPLIED_TO = {
  BOW: ['ultimate_chimera'],
  GAUNTLET: ['ultimate_one_for_all', 'ultimate_soul_eater', 'ultimate_swarm'],
};
const HOT_POTATO_LIMIT = 10;
const POTATO_LIMIT = 15;
const TUNER_LIMIT = 4;
const GEM_ORDER = ['ROUGH', 'FLAWED', 'FINE', 'FLAWLESS', 'PERFECT'];

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
 */
function buildGameData(items, neu, skyhanni) {
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

  return {
    items: new Map(items.items.map((item) => [item.id, item])),
    enchants,
    lists,
    pools: neu.enchant_pools.map((pool) => pool.map(canon)),
    canon,
  };
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

function analyzeEnchants(extra, category, game) {
  const applied = new Map(
    Object.entries(extra.enchantments ?? {}).map(([id, level]) => [game.canon(id), num(level)]),
  );
  const result = {
    ultimate: null,
    ultimateOptions: [],
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
      };
    } else if (!info) {
      // Removed or brand new enchants: we can show them but cannot judge them.
      result.other.push({ id, name: titleCase(id), level });
    } else if (level >= info.max) {
      result.maxed.push({ id, name: info.name, level });
    } else {
      const entry = { id, name: info.name, level, max: info.max, note: SKIPPABLE[id] ?? stackNote(info, extra) };
      (SKIPPABLE[id] ? result.skippable : result.upgrade).push(entry);
    }
  }

  const list = game.lists[category] ?? [];
  const available = (id) => {
    const info = game.enchants.get(id);
    return { id, name: info.name, max: info.max, note: SKIPPABLE[id] ?? stackNote(info, extra) };
  };

  if (!result.ultimate) {
    // Not filtered by conflicts: One For All replaces whatever is already on the weapon.
    result.ultimateOptions = list.filter(isUltimate).map(available).sort(byName);
  }

  if (!result.oneForAll) {
    const isBlocked = (id) => game.pools.some((pool) => pool.includes(id) && pool.some((other) => other !== id && applied.has(other)));
    const open = new Set(list.filter((id) => !isUltimate(id) && !applied.has(id) && !isBlocked(id)));

    for (const pool of game.pools) {
      if (pool.some(isUltimate)) continue;
      const options = pool.filter((id) => open.has(id));
      if (options.length > 1) {
        result.pickOne.push({ options: options.map(available).sort(byName) });
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

function analyzeUpgrades(extra, apiItem, lore, name, game) {
  const rows = [];
  const add = (label, status, value, note, optional = false) => rows.push({ label, status, value, note, optional });
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
  );

  if (!NO_RECOMB_TIERS.has(apiItem.tier)) {
    const recomb = num(extra.rarity_upgrades);
    add('Recombobulator 3000', applied(recomb), recomb ? 'Applied' : 'Not applied');
  }

  const artOfWar = num(extra.art_of_war_count);
  add('The Art of War', applied(artOfWar), artOfWar ? 'Applied' : 'Not applied');

  add(
    'Reforge',
    extra.modifier ? 'done' : 'todo',
    extra.modifier ? reforgeName(extra, apiItem, name) : 'None',
    extra.modifier ? 'The best one depends on your build' : undefined,
  );

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
      );
    }
  }

  if (NECRON_BLADES.has(extra.id)) {
    const scrolls = extra.ability_scroll ?? [];
    const owned = scrolls.includes('ULTIMATE_WITHER_SCROLL') ? WITHER_SCROLLS : WITHER_SCROLLS.filter((id) => scrolls.includes(id));
    const lacking = WITHER_SCROLLS.filter((id) => !owned.includes(id)).map((id) => game.items.get(id)?.name ?? titleCase(id));
    add(
      'Wither Scrolls',
      lacking.length === 0 ? 'done' : owned.length ? 'partial' : 'todo',
      `${owned.length} / ${WITHER_SCROLLS.length}`,
      lacking.length ? `Needs ${lacking.join(', ')}` : undefined,
    );
  }

  if (apiItem.can_have_power_scroll || /Ability:.*RIGHT CLICK/.test(loreText)) {
    const scroll = extra.power_ability_scroll;
    add(
      'Power Scroll',
      scroll ? 'done' : 'todo',
      scroll ? (game.items.get(scroll)?.name ?? titleCase(scroll)).replace(' Power Scroll', '') : 'None',
      scroll ? undefined : 'Any one of them, for its right-click buff',
    );
  }

  if (/Ability:.*Transmission/.test(loreText) || extra.tuned_transmission !== undefined) {
    const tuners = num(extra.tuned_transmission);
    add('Transmission Tuners', tuners >= TUNER_LIMIT ? 'done' : tuners > 0 ? 'partial' : 'todo', `${tuners} / ${TUNER_LIMIT}`);
  }

  if (extra.id === 'ASPECT_OF_THE_VOID') {
    const merged = num(extra.ethermerge);
    add('Etherwarp', applied(merged), merged ? 'Applied' : 'Not applied', merged ? undefined : 'Etherwarp Conduit, needs Enderman Slayer 7');
  }

  const hasStatsBook = extra.stats_book !== undefined;
  add('Book of Stats', applied(hasStatsBook ? 1 : 0), hasStatsBook ? `${whole.format(num(extra.stats_book))} kills` : 'Not applied', 'Cosmetic, only tracks kills', true);

  return rows;
}

function analyzeGems(extra, apiItem, game) {
  const gems = { ...(extra.gems ?? {}) };
  const unlocked = [...(gems.unlocked_slots ?? [])];
  delete gems.unlocked_slots;

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
      };
    }

    const free = !slot.costs?.length;
    const unlockedIndex = unlocked.findIndex((k) => k.startsWith(prefix));
    if (free || unlockedIndex !== -1) {
      if (!free) unlocked.splice(unlockedIndex, 1);
      return { label, status: 'todo', value: 'Empty', note: 'Add a Perfect gem' };
    }
    return {
      label,
      status: 'todo',
      value: 'Locked',
      note: `Unlock for ${summarizeCosts(slot.costs, game)}, then add a Perfect gem`,
    };
  });
}

function summarize(enchants, upgrades, gems) {
  let done = enchants.maxed.length;
  let left = enchants.upgrade.length + enchants.missing.length + enchants.pickOne.length;
  if (enchants.ultimate) {
    const { level, max } = enchants.ultimate;
    if (max === null || level >= max) done += 1;
    else left += 1;
  } else if (enchants.ultimateOptions.length) {
    left += 1;
  }
  for (const row of [...upgrades, ...gems]) {
    if (row.optional) continue;
    if (row.status === 'done') done += 1;
    else left += 1;
  }
  const total = done + left;
  // Rounded down so a weapon only ever reads 100% when nothing is left.
  return { done, left, total, percent: total ? Math.floor((done / total) * 100) : 100 };
}

function analyzeWeapon(item, source, game) {
  const extra = item?.tag?.ExtraAttributes;
  const apiItem = extra?.id && game.items.get(extra.id);
  if (!apiItem || !WEAPON_CATEGORIES.has(apiItem.category)) return null;

  const { category } = apiItem;
  const lore = item.tag.display?.Lore ?? [];
  const name = item.tag.display?.Name ?? apiItem.name;
  const enchants = analyzeEnchants(extra, category, game);
  const upgrades = analyzeUpgrades(extra, apiItem, lore, name, game);
  const gems = analyzeGems(extra, apiItem, game);
  return { id: extra.id, name, lore, source, category, enchants, upgrades, gems, progress: summarize(enchants, upgrades, gems) };
}

/** Finds and scores every weapon a profile member owns. */
function analyzeMember(member, game) {
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
        const weapon = analyzeWeapon(item, source, game);
        if (weapon) weapons.push(weapon);
      }
    } catch {
      unreadable += 1;
    }
  }

  weapons.sort((a, b) => b.progress.percent - a.progress.percent || b.progress.done - a.progress.done);
  return { inventoryOff: !inventory?.inv_contents?.data, weapons, unreadable };
}

module.exports = { parseNbt, decodeItems, buildGameData, analyzeWeapon, analyzeMember };
