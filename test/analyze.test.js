'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeItems, buildGameData, analyzeWeapon, analyzeMember } = require('../analyze');
const realItem = require('./real-item.json');

// A cut-down copy of the three upstream data files, in their real shapes.
const SWORD_ENCHANTS = [
  'sharpness', 'smite', 'knockback', 'execute', 'PROSECUTE', 'first_strike', 'triple_strike', 'syphon', 'life_steal', 'mana_steal', 'champion',
  'ultimate_wise', 'ultimate_soul_eater', 'ultimate_one_for_all',
];
const game = buildGameData(
  {
    items: [
      { id: 'PLAIN_SWORD', name: 'Plain Sword', category: 'SWORD', tier: 'RARE' },
      { id: 'PLAIN_BOW', name: 'Plain Bow', category: 'BOW', tier: 'RARE' },
      { id: 'ROD', name: 'Rod', category: 'FISHING_ROD', tier: 'RARE' },
      { id: 'SHOVEL', name: 'Shovel', category: 'SPADE', tier: 'RARE' },
      {
        id: 'HYPERION',
        name: 'Hyperion',
        category: 'SWORD',
        tier: 'LEGENDARY',
        dungeon_item: true,
        upgrade_costs: [100, 200, 300, 400, 500].map((amount) => [{ type: 'ESSENCE', essence_type: 'WITHER', amount }]),
        gemstone_slots: [
          { slot_type: 'SAPPHIRE', costs: [{ type: 'COINS', coins: 250000 }, { type: 'ITEM', item_id: 'FLAWLESS_SAPPHIRE_GEM', amount: 4 }] },
          { slot_type: 'COMBAT', costs: [{ type: 'COINS', coins: 250000 }] },
          { slot_type: 'JASPER' },
        ],
      },
      {
        id: 'CRIMSON_BLADE',
        name: 'Crimson Blade',
        category: 'SWORD',
        tier: 'EPIC',
        upgrade_costs: Array.from({ length: 10 }, () => [{ type: 'ESSENCE', essence_type: 'CRIMSON', amount: 10 }]),
      },
      { id: 'FLAWLESS_SAPPHIRE_GEM', name: 'Flawless Sapphire Gemstone' },
      { id: 'IMPLOSION_SCROLL', name: 'Implosion' },
      { id: 'SHADOW_WARP_SCROLL', name: 'Shadow Warp' },
      { id: 'WITHER_SHIELD_SCROLL', name: 'Wither Shield' },
      { id: 'SAPPHIRE_POWER_SCROLL', name: 'Sapphire Power Scroll' },
    ],
  },
  {
    enchants: { SWORD: [...SWORD_ENCHANTS, 'ultimate_chimera'], BOW: ['sharpness', 'ultimate_chimera'] },
    enchant_pools: [
      ['ultimate_wise', 'ultimate_soul_eater', 'ultimate_one_for_all'],
      ['execute', 'PROSECUTE'],
      ['first_strike', 'triple_strike'],
      ['syphon', 'life_steal', 'mana_steal'],
      ['ultimate_one_for_all', 'sharpness'],
    ],
    enchant_mapping_id: ['prosecute'],
    enchant_mapping_item: ['PROSECUTE'],
  },
  {
    NORMAL: {
      sharpness: { loreName: 'Sharpness', nbtName: 'sharpness', maxLevel: 7 },
      smite: { loreName: 'Smite', nbtName: 'smite', maxLevel: 7 },
      knockback: { loreName: 'Knockback', nbtName: 'knockback', maxLevel: 2 },
      execute: { loreName: 'Execute', nbtName: 'execute', maxLevel: 6 },
      prosecute: { loreName: 'Prosecute', nbtName: 'PROSECUTE', maxLevel: 6 },
      first_strike: { loreName: 'First Strike', nbtName: 'first_strike', maxLevel: 5 },
      triple_strike: { loreName: 'Triple-Strike', nbtName: 'triple_strike', maxLevel: 5 },
      syphon: { loreName: 'Drain', nbtName: 'syphon', maxLevel: 5 },
      life_steal: { loreName: 'Life Steal', nbtName: 'life_steal', maxLevel: 5 },
      mana_steal: { loreName: 'Mana Steal', nbtName: 'mana_steal', maxLevel: 3 },
    },
    ULTIMATE: {
      wise: { loreName: 'Ultimate Wise', nbtName: 'ultimate_wise', maxLevel: 5 },
      soul: { loreName: 'Soul Eater', nbtName: 'ultimate_soul_eater', maxLevel: 5 },
      ofa: { loreName: 'One For All', nbtName: 'ultimate_one_for_all', maxLevel: 1 },
      chimera: { loreName: 'Chimera', nbtName: 'ultimate_chimera', maxLevel: 5 },
    },
    STACKING: {
      champion: { loreName: 'Champion', nbtName: 'champion', nbtNum: 'champion_combat_xp', maxLevel: 3, stackLevel: [0, 100, 3000000] },
    },
  },
);

const item = (extra, lore = ['§6§lLEGENDARY SWORD'], name) => ({
  tag: { ExtraAttributes: { id: 'PLAIN_SWORD', ...extra }, display: { Lore: lore, Name: name } },
});
const analyze = (extra, lore, name) => analyzeWeapon(item(extra, lore, name), 'Inventory', game);
const rowOf = (weapon, label) => weapon.upgrades.find((r) => r.label === label);
const ids = (list) => list.map((e) => e.id);

test('decodes a real item from the live auction house', () => {
  const [sting] = decodeItems(realItem.data);
  const extra = sting.tag.ExtraAttributes;
  assert.equal(extra.id, 'STING');
  assert.equal(extra.modifier, 'withered');
  assert.equal(extra.enchantments.PROSECUTE, 5);
  assert.equal(typeof extra.timestamp, 'number'); // A 64-bit long in the raw data.
  assert.match(sting.tag.display.Name, /Sting/);
});

test('sorts enchants into maxed, not maxed and missing', () => {
  const { enchants } = analyze({ enchantments: { sharpness: 7, smite: 5 } });
  assert.deepEqual(ids(enchants.maxed), ['sharpness']);
  assert.deepEqual(enchants.upgrade.map((e) => [e.id, e.level, e.max]), [['smite', 5, 7]]);
  assert.ok(!ids(enchants.missing).includes('sharpness'));
});

test('enchants that conflict with one already applied are not suggested', () => {
  const { enchants } = analyze({ enchantments: { first_strike: 5, PROSECUTE: 6 } });
  const everything = [...ids(enchants.missing), ...enchants.pickOne.flatMap((p) => ids(p.options))];
  assert.ok(!everything.includes('triple_strike'));
  assert.ok(!everything.includes('execute'));
  // Uppercase PROSECUTE in the item data still matches the lowercase name elsewhere.
  assert.deepEqual(ids(enchants.maxed), ['first_strike', 'prosecute']);
});

test('conflicting enchants that are both open become one pick-one choice', () => {
  const { enchants } = analyze({});
  const choices = enchants.pickOne.map((p) => ids(p.options).sort());
  assert.deepEqual(choices, [
    ['execute', 'prosecute'],
    ['first_strike', 'triple_strike'],
    ['life_steal', 'mana_steal', 'syphon'],
  ]);
  assert.ok(!ids(enchants.missing).includes('execute'));
});

test('ultimate enchants are a single slot', () => {
  const none = analyze({}).enchants;
  assert.equal(none.ultimate, null);
  assert.deepEqual(ids(none.ultimateOptions).sort(), ['ultimate_chimera', 'ultimate_one_for_all', 'ultimate_soul_eater', 'ultimate_wise']);

  const low = analyze({ enchantments: { ultimate_wise: 3 } }).enchants;
  assert.deepEqual(low.ultimate, { id: 'ultimate_wise', name: 'Ultimate Wise', level: 3, max: 5 });
  assert.deepEqual(low.ultimateOptions, []);
});

test('One For All is still offered when other enchants are on the weapon', () => {
  const { enchants } = analyze({ enchantments: { sharpness: 7 } });
  assert.ok(ids(enchants.ultimateOptions).includes('ultimate_one_for_all'));
});

test('a One For All weapon has nothing else to add', () => {
  const weapon = analyze({ enchantments: { ultimate_one_for_all: 1 } });
  assert.equal(weapon.enchants.oneForAll, true);
  assert.deepEqual(weapon.enchants.missing, []);
  assert.deepEqual(weapon.enchants.pickOne, []);
});

test('knockback never counts against the score', () => {
  const missing = analyze({}).enchants;
  assert.ok(ids(missing.skippable).includes('knockback'));
  assert.ok(!ids(missing.missing).includes('knockback'));
  const low = analyze({ enchantments: { knockback: 1 } }).enchants;
  assert.ok(ids(low.skippable).includes('knockback'));
  assert.ok(!ids(low.upgrade).includes('knockback'));
});

test('stacking enchants report their progress', () => {
  const { enchants } = analyze({ enchantments: { champion: 2 }, champion_combat_xp: 1500000.5 });
  assert.equal(enchants.upgrade[0].note, 'Levels up with use: 1.5M / 3M');
});

test('enchants with no known max are shown but not judged', () => {
  const weapon = analyze({ enchantments: { telekinesis: 1 } });
  assert.deepEqual(weapon.enchants.other, [{ id: 'telekinesis', name: 'Telekinesis', level: 1 }]);
  assert.ok(!ids(weapon.enchants.upgrade).includes('telekinesis'));
});

test('potato books count to 15 and name the right book', () => {
  assert.equal(rowOf(analyze({}), 'Potato Books').note, 'Add 10 Hot Potato, then 5 Fuming');
  assert.equal(rowOf(analyze({ hot_potato_count: 3 }), 'Potato Books').note, 'Add 7 Hot Potato, then 5 Fuming');
  const twelve = rowOf(analyze({ hot_potato_count: 12 }), 'Potato Books');
  assert.deepEqual([twelve.status, twelve.value, twelve.note], ['partial', '12 / 15', 'Add 3 Fuming']);
  assert.equal(rowOf(analyze({ hot_potato_count: 15 }), 'Potato Books').status, 'done');
});

test('stars read from either field, and master stars are split out', () => {
  const hype = (extra) => analyze({ id: 'HYPERION', ...extra });
  const three = rowOf(hype({ upgrade_level: 3 }), 'Stars');
  assert.deepEqual([three.status, three.value, three.note], ['partial', '3 / 5', 'Needs 900 Wither Essence']);
  assert.equal(rowOf(hype({ dungeon_item_level: 5 }), 'Stars').status, 'done');
  assert.equal(rowOf(hype({ upgrade_level: '5' }), 'Stars').status, 'done');

  const nine = hype({ upgrade_level: 9 });
  assert.equal(rowOf(nine, 'Stars').value, '5 / 5');
  const master = rowOf(nine, 'Master Stars');
  assert.deepEqual([master.value, master.note], ['4 / 5', 'Needs Fifth']);
});

test('10-star items have no separate master star row', () => {
  const weapon = analyze({ id: 'CRIMSON_BLADE', upgrade_level: 7 });
  assert.equal(rowOf(weapon, 'Stars').value, '7 / 10');
  assert.equal(rowOf(weapon, 'Master Stars'), undefined);
});

test('weapons without stars have no star rows', () => {
  assert.equal(rowOf(analyze({}), 'Stars'), undefined);
});

test('wither scrolls only appear on Necron blades', () => {
  assert.equal(rowOf(analyze({}), 'Wither Scrolls'), undefined);
  const row = rowOf(analyze({ id: 'HYPERION', ability_scroll: ['IMPLOSION_SCROLL', 'WITHER_SHIELD_SCROLL'] }), 'Wither Scrolls');
  assert.deepEqual([row.status, row.value, row.note], ['partial', '2 / 3', 'Needs Shadow Warp']);
  assert.equal(rowOf(analyze({ id: 'HYPERION', ability_scroll: ['ULTIMATE_WITHER_SCROLL'] }), 'Wither Scrolls').status, 'done');
});

test('power scrolls follow the weapon having a right click ability', () => {
  assert.equal(rowOf(analyze({}), 'Power Scroll'), undefined);
  const lore = ['§6Ability: Wither Impact  §e§lRIGHT CLICK', '§6§lLEGENDARY SWORD'];
  assert.equal(rowOf(analyze({}, lore), 'Power Scroll').status, 'todo');
  assert.equal(rowOf(analyze({ power_ability_scroll: 'SAPPHIRE_POWER_SCROLL' }, lore), 'Power Scroll').value, 'Sapphire');
  const leftClick = ['§6Ability: Salvation  §e§lLEFT CLICK', '§6§lLEGENDARY BOW'];
  assert.equal(rowOf(analyze({}, leftClick), 'Power Scroll'), undefined);
});

test('transmission tuners only appear on transmission items', () => {
  assert.equal(rowOf(analyze({}), 'Transmission Tuners'), undefined);
  const lore = ['§6Ability: Instant Transmission  §e§lRIGHT CLICK'];
  assert.equal(rowOf(analyze({ tuned_transmission: 2 }, lore), 'Transmission Tuners').value, '2 / 4');
});

test('the reforge name comes from the item name', () => {
  assert.equal(rowOf(analyze({ modifier: 'withered' }, [], '§dWithered Plain Sword §6✪✪✪'), 'Reforge').value, 'Withered');
  assert.equal(rowOf(analyze({ modifier: 'rich_bow' }, [], '§6Plain Sword'), 'Reforge').value, 'Rich');
  assert.equal(rowOf(analyze({}), 'Reforge').status, 'todo');
});

test('gemstones handle both data shapes, universal slots and locks', () => {
  const { gems } = analyze({
    id: 'HYPERION',
    gems: {
      JASPER_0: { uuid: 'x', quality: 'PERFECT' },
      COMBAT_0: 'FINE',
      COMBAT_0_gem: 'SAPPHIRE',
      unlocked_slots: ['COMBAT_0'],
    },
  });
  const [sapphire, combat, jasper] = gems;
  assert.deepEqual([sapphire.status, sapphire.value], ['todo', 'Locked']);
  assert.match(sapphire.note, /250,000 coins, 4 Flawless Sapphire Gemstone/);
  assert.deepEqual([combat.status, combat.value, combat.note], ['partial', 'Fine Sapphire', 'Replace with Perfect Sapphire']);
  assert.deepEqual([jasper.status, jasper.value], ['done', 'Perfect Jasper']);
});

test('an unlocked empty slot and a free empty slot both read as empty', () => {
  const { gems } = analyze({ id: 'HYPERION', gems: { unlocked_slots: ['SAPPHIRE_0'] } });
  assert.equal(gems[0].value, 'Empty');
  assert.equal(gems[1].value, 'Locked');
  assert.equal(gems[2].value, 'Empty');
});

test('a filled slot counts as unlocked on older items with no unlock list', () => {
  const { gems } = analyze({ id: 'HYPERION', gems: { SAPPHIRE_0: 'FLAWLESS' } });
  assert.equal(gems[0].value, 'Flawless Sapphire');
});

test('a fully maxed weapon reads 100% with nothing left', () => {
  const everything = {
    enchantments: {
      sharpness: 7, smite: 7, knockback: 2, execute: 6, first_strike: 5, syphon: 5, champion: 3, ultimate_wise: 5,
    },
    hot_potato_count: 15,
    rarity_upgrades: 1,
    art_of_war_count: 1,
    modifier: 'withered',
  };
  const { progress } = analyze(everything);
  assert.equal(progress.left, 0);
  assert.equal(progress.percent, 100);
});

test('a nearly maxed weapon never rounds up to 100%', () => {
  const { progress } = analyze({
    enchantments: { sharpness: 6, smite: 7, execute: 6, first_strike: 5, syphon: 5, champion: 3, ultimate_wise: 5 },
    hot_potato_count: 15,
    rarity_upgrades: 1,
    art_of_war_count: 1,
    modifier: 'withered',
  });
  assert.equal(progress.left, 1);
  assert.ok(progress.percent < 100);
});

test('the optional Book of Stats does not change the score', () => {
  const without = analyze({}).progress;
  const withBook = analyze({ stats_book: 42 });
  assert.deepEqual(withBook.progress, without);
  assert.equal(rowOf(withBook, 'Book of Stats').value, '42 kills');
});

test('skips non-weapons, empty slots and unknown items', () => {
  assert.equal(analyzeWeapon({}, 'Inventory', game), null);
  assert.equal(analyzeWeapon(item({ id: 'SHOVEL' }), 'Inventory', game), null);
  assert.equal(analyzeWeapon(item({ id: 'NOT_A_REAL_ITEM' }), 'Inventory', game), null);
  assert.equal(analyzeWeapon(item({ id: 'ROD' }), 'Inventory', game), null);
});

test('enchants whose book excludes a weapon type are not suggested for it', () => {
  assert.ok(game.lists.SWORD.includes('ultimate_chimera'));
  assert.ok(!game.lists.BOW.includes('ultimate_chimera'));
  assert.ok(game.lists.BOW.includes('sharpness'));
});

test('an enchant the book excludes is still recognised if an item really has it', () => {
  const { enchants } = analyzeWeapon(item({ id: 'PLAIN_BOW', enchantments: { ultimate_chimera: 5 } }), 'Inventory', game);
  assert.deepEqual([enchants.ultimate.id, enchants.ultimate.max], ['ultimate_chimera', 5]);
});

test('reports when the inventory API is off', () => {
  assert.equal(analyzeMember({}, game).inventoryOff, true);
  assert.equal(analyzeMember({ inventory: { backpack_icons: {} } }, game).inventoryOff, true);
});

test('one broken container does not lose the others', () => {
  const result = analyzeMember(
    {
      inventory: {
        inv_contents: { data: 'not real data' },
        ender_chest_contents: { data: realItem.data },
      },
    },
    { ...game, items: new Map([['STING', { id: 'STING', name: 'Sting', category: 'SWORD' }]]) },
  );
  assert.equal(result.unreadable, 1);
  assert.equal(result.weapons.length, 1);
  assert.equal(result.weapons[0].source, 'Ender Chest');
});
