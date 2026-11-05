'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assertPlausible, sorted } = require('../scripts/update-reforge-usage');
const saved = require('../data/reforge-usage.json');

test('a broken scan cannot replace good data', () => {
  assert.throws(() => assertPlausible({ groups: { SWORD: { count: 12, reforges: {} } } }), /old data was kept/);
  assert.throws(() => assertPlausible({ groups: {} }), /old data was kept/);
});

test('a normal scan passes, across every group', () => {
  assert.equal(assertPlausible({ groups: { SWORD: { count: 900 }, BOW: { count: 150 } } }), 1050);
});

test('sorting reaches every level, so the file only shows real changes', () => {
  const result = sorted({ b: { z: 1, a: { y: 1, x: 2 } }, a: 1 });
  assert.equal(JSON.stringify(result), '{"a":1,"b":{"a":{"x":2,"y":1},"z":1}}');
});

test('the saved data file has the shape the site needs', () => {
  assert.ok(assertPlausible(saved) > 0);
  assert.ok(!Number.isNaN(Date.parse(saved.scannedAt)));
  for (const group of ['SWORD', 'MAGE_SWORD', 'LONGSWORD', 'BOW']) assert.ok(saved.groups[group]?.count > 0, group);
  for (const bucket of [...Object.values(saved.weapons), ...Object.values(saved.groups)]) {
    const counted = Object.values(bucket.reforges).reduce((sum, uses) => sum + uses, 0);
    assert.equal(counted, bucket.count);
  }
});

test('saved reforge names are lowercase, which is how the site looks them up', () => {
  for (const { reforges } of Object.values(saved.weapons)) {
    for (const name of Object.keys(reforges)) assert.equal(name, name.toLowerCase());
  }
});
