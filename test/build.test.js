'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parsePlayerList, assertNoKey } = require('../scripts/build');

test('reads one name per line, ignoring comments and blank lines', () => {
  assert.deepEqual(parsePlayerList('# my friends\n\nSteve\n  Alex_2  # main account\n'), ['Steve', 'Alex_2']);
});

test('handles Windows line endings and a Notepad byte order mark', () => {
  assert.deepEqual(parsePlayerList('﻿Steve\r\nAlex\r\n'), ['Steve', 'Alex']);
});

test('an empty list is fine', () => {
  assert.deepEqual(parsePlayerList('# nobody yet\n'), []);
});

test('the same name twice only counts once, whatever the case', () => {
  assert.equal(parsePlayerList('Steve\nsteve\nSTEVE\n').length, 1);
});

test('rejects anything that could not be a username, since names become file names', () => {
  for (const bad of ['../../etc/passwd', 'has space', 'way_too_long_for_minecraft', 'name.json']) {
    assert.throws(() => parsePlayerList(bad), /isn't a valid Minecraft username/, bad);
  }
});

function tempSite(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hexcheck-'));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

test('a site with no key in it passes', (t) => {
  const dir = tempSite({ 'index.html': 'hello', 'data/players/steve.json': '{}' });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.doesNotThrow(() => assertNoKey(dir, 'secret-key-value'));
  assert.ok(fs.existsSync(dir));
});

test('finding the key anywhere, even deep down, stops the build and wipes the output', () => {
  const dir = tempSite({ 'index.html': 'hello', 'data/players/steve.json': '{"oops":"secret-key-value"}' });
  assert.throws(() => assertNoKey(dir, 'secret-key-value'), /nothing was published/);
  assert.ok(!fs.existsSync(dir));
});

test('an empty key has nothing to find', (t) => {
  const dir = tempSite({ 'index.html': 'hello' });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.doesNotThrow(() => assertNoKey(dir, ''));
});
