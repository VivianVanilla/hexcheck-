'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildGameData, analyzeWeapon } = require('../analyze');

const essence = (essence_type, amount) => ({ type: 'ESSENCE', essence_type, amount });
const FIVE_STARS = [10, 20, 30, 40, 50].map((amount) => [essence('WITHER', amount)]);

// Small copies of the upstream data, in their real shapes.
const game = buildGameData(
  {
    items: [
      { id: 'BLADE', name: 'Blade', category: 'SWORD', tier: 'LEGENDARY' },
      { id: 'MAGE_BLADE', name: 'Mage Blade', category: 'SWORD', tier: 'LEGENDARY' },
      { id: 'DUNGEON_BLADE', name: 'Dungeon Blade', category: 'SWORD', tier: 'LEGENDARY', dungeon_item: true, upgrade_costs: FIVE_STARS },
      { id: 'CRIMSON_BLADE', name: 'Crimson Blade', category: 'SWORD', tier: 'EPIC', upgrade_costs: [[essence('WITHER', 5), { type: 'COINS', coins: 1000 }, { type: 'ITEM', item_id: 'SPELL_POWDER', amount: 2 }]] },
      { id: 'CONVERTIBLE', name: 'Convertible', category: 'SWORD', tier: 'EPIC', dungeon_item_conversion_cost: { essence_type: 'DRAGON', amount: 100 }, upgrade_costs: FIVE_STARS },
      { id: 'HYPERION', name: 'Hyperion', category: 'SWORD', tier: 'LEGENDARY' },
      { id: 'ASPECT_OF_THE_VOID', name: 'Aspect of the Void', category: 'SWORD', tier: 'EPIC' },
      {
        id: 'GEM_BLADE',
        name: 'Gem Blade',
        category: 'SWORD',
        tier: 'EPIC',
        gemstone_slots: [
          { slot_type: 'JASPER' },
          { slot_type: 'COMBAT' },
          { slot_type: 'SAPPHIRE', costs: [{ type: 'COINS', coins: 1000 }, { type: 'ITEM', item_id: 'FINE_SAPPHIRE_GEM', amount: 2 }] },
          { slot_type: 'DEFENSIVE' },
        ],
      },
      { id: 'PLAIN_BOW', name: 'Plain Bow', category: 'BOW', tier: 'RARE' },
      { id: 'SEVERED_HAND', name: 'Severed Hand' },
      { id: 'DRAGON_CLAW', name: 'Dragon Claw' },
    ],
  },
  {
    enchants: {
      SWORD: ['sharpness', 'smite', 'impaling', 'knockback', 'execute', 'PROSECUTE', 'champion', 'luck', 'ultimate_wise', 'ultimate_chimera', 'ultimate_one_for_all'],
      BOW: ['power', 'punch'],
    },
    enchant_pools: [['execute', 'PROSECUTE'], ['ultimate_wise', 'ultimate_chimera', 'ultimate_one_for_all']],
    enchant_mapping_id: [],
    enchant_mapping_item: [],
  },
  {
    NORMAL: {
      sharpness: { loreName: 'Sharpness', nbtName: 'sharpness', maxLevel: 7 },
      smite: { loreName: 'Smite', nbtName: 'smite', maxLevel: 7 },
      impaling: { loreName: 'Impaling', nbtName: 'impaling', maxLevel: 5 },
      knockback: { loreName: 'Knockback', nbtName: 'knockback', maxLevel: 2 },
      punch: { loreName: 'Punch', nbtName: 'punch', maxLevel: 2 },
      power: { loreName: 'Power', nbtName: 'power', maxLevel: 7 },
      execute: { loreName: 'Execute', nbtName: 'execute', maxLevel: 6 },
      prosecute: { loreName: 'Prosecute', nbtName: 'PROSECUTE', maxLevel: 6 },
      luck: { loreName: 'Luck', nbtName: 'luck', maxLevel: 7 },
    },
    ULTIMATE: {
      wise: { loreName: 'Ultimate Wise', nbtName: 'ultimate_wise', maxLevel: 5 },
      chimera: { loreName: 'Chimera', nbtName: 'ultimate_chimera', maxLevel: 5 },
      ofa: { loreName: 'One For All', nbtName: 'ultimate_one_for_all', maxLevel: 1 },
    },
    STACKING: {
      champion: { loreName: 'Champion', nbtName: 'champion', nbtNum: 'champion_combat_xp', maxLevel: 10, stackLevel: [0, 100, 200, 300, 400, 500, 600, 700, 800, 900] },
    },
  },
  {
    stones: { DRAGON_CLAW: { internalName: 'DRAGON_CLAW', reforgeName: 'Fabled', itemTypes: 'SWORD', reforgeStats: {}, reforgeCosts: { LEGENDARY: 100, EPIC: 50 } } },
    basic: { Heroic: { reforgeName: 'Heroic', itemTypes: 'SWORD/ROD', reforgeStats: {} } },
    usage: {
      weapons: {
        BLADE: { count: 10, reforges: { fabled: 8, heroic: 2 } },
        MAGE_BLADE: { count: 10, reforges: { heroic: 10 } },
      },
      groups: {},
    },
  },
);

const PRICES = new Map(
  Object.entries({
    ENCHANTMENT_SHARPNESS_6: 1_000,
    ENCHANTMENT_SHARPNESS_7: 100_000,
    ENCHANTMENT_SMITE_6: 500,
    SEVERED_HAND: 8_000,
    ENCHANTMENT_EXECUTE_6: 300,
    ENCHANTMENT_PROSECUTE_6: 200,
    ENCHANTMENT_CHAMPION_1: 77,
    ENCHANTMENT_ULTIMATE_WISE_3: 12,
    ENCHANTMENT_ULTIMATE_WISE_4: 20,
    ENCHANTMENT_ULTIMATE_WISE_5: 15,
    ENCHANTMENT_ULTIMATE_CHIMERA_3: 400,
    ENCHANTMENT_ULTIMATE_CHIMERA_4: 1_000,
    ENCHANTMENT_ULTIMATE_CHIMERA_5: 5_000,
    ENCHANTMENT_ULTIMATE_ONE_FOR_ALL_1: 1,
    HOT_POTATO_BOOK: 100,
    FUMING_POTATO_BOOK: 1_000,
    RECOMBOBULATOR_3000: 9_000,
    THE_ART_OF_WAR: 20_000,
    DRAGON_CLAW: 2_000,
    ESSENCE_WITHER: 3,
    ESSENCE_DRAGON: 4,
    SPELL_POWDER: 50,
    FIRST_MASTER_STAR: 10,
    SECOND_MASTER_STAR: 20,
    THIRD_MASTER_STAR: 30,
    FOURTH_MASTER_STAR: 40,
    FIFTH_MASTER_STAR: 50,
    IMPLOSION_SCROLL: 150,
    SHADOW_WARP_SCROLL: 160,
    WITHER_SHIELD_SCROLL: 170,
    RUBY_POWER_SCROLL: 650,
    AMETHYST_POWER_SCROLL: 600,
    TRANSMISSION_TUNER: 50,
    ETHERWARP_CONDUIT: 17_000,
    PERFECT_JASPER_GEM: 27,
    PERFECT_SAPPHIRE_GEM: 15,
    PERFECT_OPAL_GEM: 14,
    PERFECT_RUBY_GEM: 13,
    FINE_SAPPHIRE_GEM: 3,
  }),
);

const item = (extra, lore = ['§6§lLEGENDARY SWORD']) => ({ tag: { ExtraAttributes: { id: 'BLADE', ...extra }, display: { Lore: lore } } });
const analyze = (extra, lore, prices = PRICES) => analyzeWeapon(item(extra, lore), 'Inventory', game, prices);
const enchantRow = (weapon, list, id) => weapon.enchants[list].find((entry) => entry.id === id);
const rowOf = (weapon, label) => weapon.upgrades.find((row) => row.label === label);

// Every step finished, so each test can break just the one thing it's about.
const MAXED = {
  enchantments: { sharpness: 7, smite: 7, impaling: 5, execute: 6, champion: 10, luck: 7, ultimate_wise: 5 },
  hot_potato_count: 15,
  rarity_upgrades: 1,
  art_of_war_count: 1,
  modifier: 'fabled',
};
const with_ = (changes) => ({ ...MAXED, ...changes, enchantments: { ...MAXED.enchantments, ...changes.enchantments } });

test('a normal enchant costs its top book, because lower books do not combine', () => {
  const weapon = analyze(with_({ enchantments: { sharpness: 6 } }));
  assert.equal(enchantRow(weapon, 'upgrade', 'sharpness').coins, 100_000); // Not the VI book at 1,000.
});

test('a missing enchant costs the same top book', () => {
  const { enchantments } = MAXED;
  const { sharpness, ...rest } = enchantments;
  const weapon = analyze({ ...MAXED, enchantments: rest });
  assert.equal(enchantRow(weapon, 'missing', 'sharpness').coins, 100_000);
});

test('Smite VII is a VI book plus a Severed Hand, not a VII book', () => {
  const { smite, ...rest } = MAXED.enchantments;
  const missing = analyze({ ...MAXED, enchantments: rest });
  assert.equal(enchantRow(missing, 'missing', 'smite').coins, 500 + 8_000);
  assert.equal(enchantRow(missing, 'missing', 'smite').note, 'Last level uses Severed Hand');
  const low = analyze(with_({ enchantments: { smite: 4 } }));
  assert.equal(enchantRow(low, 'upgrade', 'smite').coins, 500 + 8_000);
});

test('Smite VI only needs the Severed Hand', () => {
  const weapon = analyze(with_({ enchantments: { smite: 6 } }));
  assert.equal(enchantRow(weapon, 'upgrade', 'smite').coins, 8_000);
});

test('enchants that level up with use only ever cost the first book', () => {
  const { champion, ...rest } = MAXED.enchantments;
  const missing = analyze({ ...MAXED, enchantments: rest });
  assert.equal(enchantRow(missing, 'missing', 'champion').coins, 77);
  const low = analyze(with_({ enchantments: { champion: 3 } }));
  assert.equal(enchantRow(low, 'upgrade', 'champion').coins, 0);
  assert.equal(low.cost.total, 0);
});

test('enchanting table enchants are free in coins, and say why', () => {
  const { impaling, ...rest } = MAXED.enchantments;
  const weapon = analyze({ ...MAXED, enchantments: rest });
  const row = enchantRow(weapon, 'missing', 'impaling');
  assert.equal(row.coins, 0);
  assert.match(row.note, /enchanting table/);
  assert.deepEqual(weapon.cost.unpriced, []);
});

test('ultimate books combine, so one more IV finishes a IV', () => {
  const chimera = analyze({ ...MAXED, enchantments: { sharpness: 7, ultimate_chimera: 4 } });
  assert.equal(chimera.enchants.ultimate.coins, 1_000); // One more IV, not the V at 5,000.
});

test('combining counts every level still to go', () => {
  const chimera = analyze({ ...MAXED, enchantments: { sharpness: 7, ultimate_chimera: 3 } });
  assert.equal(chimera.enchants.ultimate.coins, 400 + 1_000);
});

test('if the top ultimate book is cheaper than combining, it uses that', () => {
  const wise = analyze(with_({ enchantments: { ultimate_wise: 4 } }));
  assert.equal(wise.enchants.ultimate.coins, 15); // The V costs less than another IV at 20.
});

test('no ultimate quotes the cheapest real option, never One For All', () => {
  const { ultimate_wise, ...rest } = MAXED.enchantments;
  const weapon = analyze({ ...MAXED, enchantments: rest });
  assert.equal(weapon.enchants.cheapestUltimate.id, 'ultimate_wise');
  assert.equal(weapon.cost.enchants, 15); // One For All is listed at 1 coin, but wipes everything else.
});

test('a pick-one choice costs its cheapest option', () => {
  const { execute, ...rest } = MAXED.enchantments;
  const weapon = analyze({ ...MAXED, enchantments: rest });
  assert.equal(weapon.enchants.pickOne[0].coins, 200);
  assert.equal(weapon.cost.enchants, 200);
});

test('a pick-one choice skips options with no price, and only fails if all have none', () => {
  const { execute, ...rest } = MAXED.enchantments;
  const onlyOne = new Map(PRICES);
  onlyOne.delete('ENCHANTMENT_PROSECUTE_6');
  assert.equal(analyze({ ...MAXED, enchantments: rest }, undefined, onlyOne).enchants.pickOne[0].coins, 300);
  onlyOne.delete('ENCHANTMENT_EXECUTE_6');
  const neither = analyze({ ...MAXED, enchantments: rest }, undefined, onlyOne);
  assert.equal(neither.enchants.pickOne[0].coins, null);
  assert.deepEqual(neither.cost.unpriced, ['Execute or Prosecute']);
});

test('anything with no market price is listed, and left out of the total', () => {
  const weapon = analyze(with_({ enchantments: { luck: 4, sharpness: 6 } }));
  assert.equal(enchantRow(weapon, 'upgrade', 'luck').coins, null);
  assert.deepEqual(weapon.cost.unpriced, ['Luck']);
  assert.equal(weapon.cost.total, 100_000);
});

test('potato books price Hot Potato up to 10, and Fuming after that', () => {
  assert.equal(rowOf(analyze(with_({ hot_potato_count: 0 })), 'Potato Books').coins, 10 * 100 + 5 * 1_000);
  assert.equal(rowOf(analyze(with_({ hot_potato_count: 7 })), 'Potato Books').coins, 3 * 100 + 5 * 1_000);
  assert.equal(rowOf(analyze(with_({ hot_potato_count: 12 })), 'Potato Books').coins, 3 * 1_000);
  assert.equal(rowOf(analyze(MAXED), 'Potato Books').coins, undefined);
});

test('a Fuming price alone is enough when only Fuming is still needed', () => {
  const noHotPotato = new Map(PRICES);
  noHotPotato.delete('HOT_POTATO_BOOK');
  assert.equal(rowOf(analyze(with_({ hot_potato_count: 12 }), undefined, noHotPotato), 'Potato Books').coins, 3 * 1_000);
});

test('one-off upgrades only cost something when missing', () => {
  const missing = analyze(with_({ rarity_upgrades: 0, art_of_war_count: 0 }));
  assert.equal(rowOf(missing, 'Recombobulator 3000').coins, 9_000);
  assert.equal(rowOf(missing, 'The Art of War').coins, 20_000);
  const applied = analyze(MAXED);
  assert.equal(rowOf(applied, 'Recombobulator 3000').coins, undefined);
  assert.equal(rowOf(applied, 'The Art of War').coins, undefined);
});

test('no reforge costs the most used one: the stone plus the fee to apply it', () => {
  const weapon = analyze(with_({ modifier: undefined }));
  assert.equal(rowOf(weapon, 'Reforge').coins, 2_000 + 100);
  assert.equal(weapon.cost.upgrades, 2_100);
});

test('the fee follows the rarity of this exact item', () => {
  const epic = analyze(with_({ modifier: undefined }), ['§5§lEPIC SWORD']);
  assert.equal(rowOf(epic, 'Reforge').coins, 2_000 + 50);
});

test('any reforge already on means no reforge cost', () => {
  assert.equal(analyze(with_({ modifier: 'sharp' })).cost.total, 0);
});

test('each suggestion shows what switching would cost', () => {
  const { picks } = analyze(MAXED).reforge;
  assert.deepEqual(picks.map((pick) => [pick.id, pick.coins]), [['fabled', 2_100], ['heroic', undefined]]);
});

test('a Blacksmith roll is too cheap to price, and is not reported as unpriced', () => {
  const mage = analyze(with_({ id: 'MAGE_BLADE', modifier: undefined }));
  assert.equal(rowOf(mage, 'Reforge').coins, undefined);
  assert.deepEqual(mage.cost.unpriced, []);
});

test('a reforge stone with no price is flagged, not silently dropped', () => {
  const noStone = new Map(PRICES);
  noStone.delete('DRAGON_CLAW');
  const weapon = analyze(with_({ modifier: undefined }), undefined, noStone);
  assert.equal(rowOf(weapon, 'Reforge').coins, null);
  assert.deepEqual(weapon.cost.unpriced, ['Reforge']);
});

test('a power scroll with no prices at all is flagged, not silently dropped', () => {
  const noScrolls = new Map([...PRICES].filter(([id]) => !id.endsWith('_POWER_SCROLL')));
  const weapon = analyze(MAXED, ['§6Ability: Zap  §e§lRIGHT CLICK', '§6§lLEGENDARY SWORD'], noScrolls);
  assert.equal(rowOf(weapon, 'Power Scroll').coins, null);
  assert.deepEqual(weapon.cost.unpriced, ['Power Scroll']);
});

test('an unpriced upgrade that is already done is not flagged', () => {
  const noRecomb = new Map(PRICES);
  noRecomb.delete('RECOMBOBULATOR_3000');
  assert.deepEqual(analyze(MAXED, undefined, noRecomb).cost.unpriced, []);
});

test('stars cost the essence still to go', () => {
  const weapon = analyze(with_({ id: 'DUNGEON_BLADE', upgrade_level: 3 }));
  assert.equal(rowOf(weapon, 'Stars').coins, (40 + 50) * 3);
});

test('stars can also cost coins and items', () => {
  const weapon = analyze(with_({ id: 'CRIMSON_BLADE' }));
  assert.equal(rowOf(weapon, 'Stars').coins, 5 * 3 + 1_000 + 2 * 50);
});

test('an unconverted weapon also pays to become a dungeon item', () => {
  const weapon = analyze(with_({ id: 'CONVERTIBLE' }));
  assert.equal(rowOf(weapon, 'Stars').coins, (10 + 20 + 30 + 40 + 50) * 3 + 100 * 4);
  const converted = analyze(with_({ id: 'CONVERTIBLE', dungeon_item: 1 }));
  assert.equal(rowOf(converted, 'Stars').coins, (10 + 20 + 30 + 40 + 50) * 3);
});

test('master stars cost the ones still missing', () => {
  assert.equal(rowOf(analyze(with_({ id: 'DUNGEON_BLADE', upgrade_level: 5 })), 'Master Stars').coins, 10 + 20 + 30 + 40 + 50);
  assert.equal(rowOf(analyze(with_({ id: 'DUNGEON_BLADE', upgrade_level: 8 })), 'Master Stars').coins, 40 + 50);
  assert.equal(rowOf(analyze(with_({ id: 'DUNGEON_BLADE', upgrade_level: 10 })), 'Master Stars').coins, undefined);
});

test('wither scrolls cost the ones still missing', () => {
  const weapon = analyze(with_({ id: 'HYPERION', ability_scroll: ['IMPLOSION_SCROLL'] }));
  assert.equal(rowOf(weapon, 'Wither Scrolls').coins, 160 + 170);
});

test('a power scroll costs the cheapest one with a known price', () => {
  const weapon = analyze(MAXED, ['§6Ability: Zap  §e§lRIGHT CLICK', '§6§lLEGENDARY SWORD']);
  assert.equal(rowOf(weapon, 'Power Scroll').coins, 600);
});

test('transmission tuners and Etherwarp are priced', () => {
  const lore = ['§6Ability: Instant Transmission  §e§lRIGHT CLICK', '§5§lEPIC SWORD'];
  const weapon = analyze(with_({ id: 'ASPECT_OF_THE_VOID', tuned_transmission: 1 }), lore);
  assert.equal(rowOf(weapon, 'Transmission Tuners').coins, 3 * 50);
  assert.equal(rowOf(weapon, 'Etherwarp').coins, 17_000);
});

test('gems cost a Perfect of the same type, the cheapest that fits, and any unlock', () => {
  const { gems, cost } = analyze(
    with_({
      id: 'GEM_BLADE',
      gems: { JASPER_0: 'FINE' },
    }),
  );
  const [jasper, combat, sapphire, defensive] = gems;
  assert.equal(jasper.coins, 27);
  assert.equal(combat.coins, 13); // Ruby is the cheapest priced gem a combat slot takes.
  assert.equal(sapphire.coins, 1_000 + 2 * 3 + 15);
  assert.equal(defensive.coins, 13);
  assert.equal(cost.gems, 27 + 13 + 1_021 + 13);
});

test('a gem already in a universal slot prices the same type, not the cheapest', () => {
  const { gems } = analyze(with_({ id: 'GEM_BLADE', gems: { COMBAT_0: 'FLAWED', COMBAT_0_gem: 'JASPER' } }));
  assert.equal(gems[1].coins, 27);
});

test('a perfect gem costs nothing', () => {
  const { gems } = analyze(with_({ id: 'GEM_BLADE', gems: { JASPER_0: 'PERFECT' } }));
  assert.equal(gems[0].coins, undefined);
});

test('things that are not required never count towards the cost', () => {
  const without = analyze(MAXED).cost;
  const withStatsBookMissing = analyze(MAXED);
  assert.equal(rowOf(withStatsBookMissing, 'Book of Stats').coins, undefined);
  assert.equal(enchantRow(withStatsBookMissing, 'skippable', 'knockback').coins, undefined);
  assert.equal(without.total, 0);
});

test('a fully maxed weapon costs nothing', () => {
  const weapon = analyze(MAXED);
  assert.equal(weapon.progress.left, 0);
  assert.deepEqual(weapon.cost, { total: 0, enchants: 0, upgrades: 0, gems: 0, unpriced: [] });
});

test('the total is exactly the sum of what each row shows', () => {
  const weapon = analyze({ id: 'GEM_BLADE', enchantments: { sharpness: 5, smite: 6, ultimate_wise: 3 }, hot_potato_count: 3, gems: { JASPER_0: 'FINE' } });
  const { enchants, upgrades, gems, cost } = weapon;
  const rows = [
    ...enchants.upgrade,
    ...enchants.missing,
    ...enchants.pickOne,
    enchants.ultimate,
    ...upgrades,
    ...gems,
  ];
  const shown = rows.reduce((sum, row) => sum + (row.coins ?? 0), 0);
  assert.equal(cost.total, shown);
  assert.equal(cost.total, cost.enchants + cost.upgrades + cost.gems);
  assert.ok(cost.total > 0);
});

test('prices are whole coins', () => {
  const prices = new Map(PRICES);
  prices.set('RECOMBOBULATOR_3000', 9_032_945.4);
  assert.equal(rowOf(analyze(with_({ rarity_upgrades: 0 }), undefined, prices), 'Recombobulator 3000').coins, 9_032_945);
});

test('with no prices at all there is simply no estimate', () => {
  const weapon = analyzeWeapon(item(with_({ id: 'GEM_BLADE', rarity_upgrades: 0, enchantments: { sharpness: 6 } })), 'Inventory', game);
  assert.equal(weapon.cost, null);
  assert.equal(enchantRow(weapon, 'upgrade', 'sharpness').coins, undefined);
  assert.equal(rowOf(weapon, 'Recombobulator 3000').coins, undefined);
  assert.equal(weapon.gems[0].coins, undefined);
  const withSuggestions = analyzeWeapon(item(MAXED), 'Inventory', game);
  assert.equal(withSuggestions.reforge.picks[0].coins, undefined);
});
