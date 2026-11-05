'use strict';

const app = document.getElementById('app');
const form = document.getElementById('search');
const nameInput = document.getElementById('name');
const statusLine = document.getElementById('status');

const state = { data: null, selected: null, filter: '', requestId: 0 };

const MC_COLORS = {
  0: '#000000', 1: '#0000AA', 2: '#00AA00', 3: '#00AAAA', 4: '#AA0000', 5: '#AA00AA', 6: '#FFAA00', 7: '#AAAAAA',
  8: '#555555', 9: '#5555FF', a: '#55FF55', b: '#55FFFF', c: '#FF5555', d: '#FF55FF', e: '#FFFF55', f: '#FFFFFF',
};
const MARKS = { done: '✔', partial: '▲', todo: '+', skip: '–' };

/** All text goes in through append/textContent, so game data can never become HTML. */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key in el) el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
  return el;
}

const STAR_RUN = /([✪➊➋➌➍➎]+)/;

// Hypixel draws stat icons with a private game font that browsers don't have. Left in, they
// show as empty boxes, so they get dropped, except gem slots where "[]" would look broken.
const stripGameIcons = (text) =>
  text.replace(/(\[(?:§.)*)[-]((?:§.)*\])/g, '$1◆$2').replace(/[-] ?/g, '');

/** Renders Minecraft's § formatting codes as coloured spans. */
function mcText(text) {
  const root = h('span', { class: 'mc' });
  let color = null;
  let flags = new Set();
  for (const part of stripGameIcons(text).split(/(§.)/)) {
    if (/^§.$/.test(part)) {
      const code = part[1].toLowerCase();
      if (MC_COLORS[code]) {
        color = MC_COLORS[code];
        flags = new Set();
      } else if (code === 'r') {
        color = null;
        flags = new Set();
      } else {
        flags.add(code);
      }
    } else if (part && !flags.has('k')) {
      // §k is the game's scrambled text, which is just noise outside the game.
      for (const piece of part.split(STAR_RUN)) {
        if (!piece) continue;
        const classes = [...flags].map((flag) => `mc-${flag}`);
        if (STAR_RUN.test(piece)) classes.push('mc-star');
        const span = h('span', { class: classes.join(' ') }, piece);
        if (color) span.style.color = color;
        root.append(span);
      }
    }
  }
  return root;
}

const plainText = (text) => text.replace(/§./g, '');

function roman(value) {
  const numerals = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let left = value;
  let out = '';
  for (const [size, glyph] of numerals) {
    while (left >= size) {
      out += glyph;
      left -= size;
    }
  }
  return out || String(value);
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

function bar(percent, label) {
  const fill = h('span', { class: `bar-fill${percent >= 100 ? ' complete' : ''}` });
  fill.style.width = `${percent}%`;
  return h('span', { class: 'bar', role: 'progressbar', 'aria-valuenow': percent, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': label }, fill);
}

function row(mark, label, value, note) {
  return h(
    'li',
    { class: `row ${mark}` },
    h('span', { class: 'mark', 'aria-hidden': 'true' }, MARKS[mark]),
    h('span', { class: 'row-main' }, h('span', { class: 'row-label' }, label), note && h('small', {}, note)),
    h('span', { class: 'row-value' }, value),
  );
}

function group(title, rows) {
  if (!rows.length) return null;
  return h('div', { class: 'group' }, title && h('h4', {}, title), h('ul', { class: 'rows' }, rows));
}

function section(title, leftCount, ...content) {
  const body = content.flat().filter(Boolean);
  if (!body.length) return null;
  return h(
    'section',
    { class: 'panel' },
    h('h3', {}, title, leftCount > 0 && h('span', { class: 'left-count' }, `${leftCount} left`)),
    body,
  );
}

function enchantSection(enchants) {
  const { ultimate, ultimateOptions, upgrade, missing, pickOne, skippable, maxed, other, oneForAll } = enchants;
  const ultimateLeft = ultimate ? (ultimate.max !== null && ultimate.level < ultimate.max ? 1 : 0) : ultimateOptions.length ? 1 : 0;

  let ultimateRow = null;
  if (ultimate) {
    const isMax = ultimate.max === null || ultimate.level >= ultimate.max;
    ultimateRow = row(isMax ? 'done' : 'partial', ultimate.name, isMax ? roman(ultimate.level) : `${roman(ultimate.level)} → ${roman(ultimate.max)}`);
  } else if (ultimateOptions.length) {
    const choices = ultimateOptions.map((o) => `${o.name} ${roman(o.max)}`).join(', ');
    const warning = ultimateOptions.some((o) => o.id === 'ultimate_one_for_all') ? ' One For All removes every other enchant.' : '';
    ultimateRow = row('todo', 'No ultimate enchant', 'Pick one', `${choices}.${warning}`);
  }

  const leftCount = ultimateLeft + upgrade.length + missing.length + pickOne.length;

  return section(
    'Enchantments',
    leftCount,
    oneForAll && h('p', { class: 'callout' }, "One For All is on this weapon, and it replaces every other enchant, so there's nothing else to add."),
    group('Ultimate', ultimateRow ? [ultimateRow] : []),
    group('Not maxed yet', upgrade.map((e) => row('partial', e.name, `${roman(e.level)} → ${roman(e.max)}`, e.note))),
    group('Missing', missing.map((e) => row('todo', e.name, `Add ${roman(e.max)}`, e.note))),
    group(
      'Missing, pick one of each',
      pickOne.map((choice) => row('todo', choice.options.map((o) => o.name).join(' or '), `Add ${roman(Math.max(...choice.options.map((o) => o.max)))}`)),
    ),
    group('Skippable', skippable.map((e) => row('skip', e.name, e.level ? `${roman(e.level)} → ${roman(e.max)}` : `Add ${roman(e.max)}`, e.note))),
    maxed.length > 0 &&
      h(
        'details',
        { class: 'maxed' },
        h('summary', {}, `${plural(maxed.length, 'enchant')} already maxed`),
        h('ul', { class: 'chips' }, maxed.map((e) => h('li', {}, `${e.name} ${roman(e.level)}`))),
      ),
    other.length > 0 &&
      h('p', { class: 'muted' }, `Also on this weapon, but no max is known: ${other.map((e) => `${e.name} ${roman(e.level)}`).join(', ')}.`),
  );
}

function statusRows(rows) {
  return rows.map((r) => row(r.optional && r.status !== 'done' ? 'skip' : r.status, r.label, r.value, r.note));
}

function weaponDetail(weapon) {
  const { progress, upgrades, gems } = weapon;
  const pending = (rows) => rows.filter((r) => !r.optional && r.status !== 'done').length;
  const isMaxed = progress.left === 0;

  return h(
    'article',
    { class: 'detail' },
    h(
      'header',
      { class: 'detail-head panel' },
      h('h2', {}, mcText(weapon.name)),
      h('p', { class: 'muted' }, `${weapon.source} · ${weapon.category.toLowerCase()}`),
      h(
        'p',
        { class: 'summary' },
        h('strong', {}, isMaxed ? 'Fully maxed' : `${plural(progress.left, 'thing')} left`),
        h('span', { class: 'muted' }, `${progress.percent}% maxed`),
      ),
      bar(progress.percent, `${plainText(weapon.name)} is ${progress.percent}% maxed`),
    ),
    h(
      'div',
      { class: 'detail-body' },
      h(
        'div',
        { class: 'checklist' },
        enchantSection(weapon.enchants),
        section('Books and upgrades', pending(upgrades), group(null, statusRows(upgrades))),
        section('Gemstones', pending(gems), group(null, statusRows(gems))),
      ),
      h(
        'aside',
        { class: 'tooltip-wrap' },
        h(
          'div',
          { class: 'tooltip' },
          h('p', { class: 'tooltip-name' }, mcText(weapon.name)),
          weapon.lore.map((line) => h('p', {}, line.trim() ? mcText(line) : ' ')),
        ),
      ),
    ),
  );
}

function selectWeapon(index) {
  state.selected = index;
  // Only the detail panel changes, so the list keeps its scroll position and keyboard focus.
  const detail = weaponDetail(state.data.weapons[index]);
  document.querySelector('.detail').replaceWith(detail);
  for (const button of document.querySelectorAll('.weapon')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.index) === index));
  }
  if (window.matchMedia('(max-width: 760px)').matches) detail.scrollIntoView({ block: 'start' });
}

function weaponButton(weapon, index) {
  const { progress } = weapon;
  return h(
    'button',
    {
      type: 'button',
      class: 'weapon',
      'data-index': index,
      'aria-pressed': String(index === state.selected),
      onclick: () => selectWeapon(index),
    },
    h('span', { class: 'weapon-name' }, mcText(weapon.name)),
    h('span', { class: 'weapon-meta' }, h('span', {}, weapon.source), h('span', {}, progress.left === 0 ? 'Maxed' : `${progress.left} left`)),
    bar(progress.percent, `${progress.percent}% maxed`),
  );
}

function weaponMatches() {
  const needle = state.filter.trim().toLowerCase();
  const matches = state.data.weapons
    .map((weapon, index) => ({ weapon, index }))
    .filter(({ weapon }) => plainText(weapon.name).toLowerCase().includes(needle));
  if (!matches.length) return h('p', { class: 'muted' }, 'No weapon matches that name.');
  return h('ul', {}, matches.map(({ weapon, index }) => h('li', {}, weaponButton(weapon, index))));
}

function renderSetup(message) {
  return h(
    'section',
    { class: 'panel setup' },
    h('h2', {}, 'One-time setup: add an API key'),
    message && h('p', { class: 'error-text' }, message),
    h('p', {}, 'Hypixel only shares player data with a key. It stays in a file on this computer, and the page never sees it.'),
    h(
      'ol',
      {},
      h('li', {}, 'Go to ', h('a', { href: 'https://developer.hypixel.net/', target: '_blank', rel: 'noreferrer' }, 'developer.hypixel.net'), ', log in, and create a key.'),
      h('li', {}, 'Open the ', h('code', {}, '.env'), ' file in the Hexcheck folder.'),
      h('li', {}, 'Paste the key after ', h('code', {}, 'HYPIXEL_API_KEY='), ' and save.'),
      h('li', {}, 'Search again. No restart needed.'),
    ),
    h('p', { class: 'muted' }, "Developer keys expire now and then. If searches stop working, make a new key and do the same thing."),
  );
}

function renderMessage(title, message) {
  return h('section', { class: 'panel message' }, h('h2', {}, title), h('p', {}, message));
}

function renderInventoryOff(player) {
  return renderMessage(
    "This player's inventory is hidden",
    `${player} has the Inventory API turned off on this profile. To turn it on, open the SkyBlock Menu in game, then Settings, then API Settings. It can take a few minutes to show up here.`,
  );
}

function renderError(code, message) {
  if (code === 'no_key') return renderSetup();
  if (code === 'bad_key') return renderSetup(message);
  const titles = {
    player_not_found: 'Player not found',
    no_profiles: 'No SkyBlock profiles',
    bad_name: 'Check that username',
    rate_limited: 'Slow down a little',
  };
  return renderMessage(titles[code] ?? "That didn't work", message);
}

function playerBar(data) {
  const select = h(
    'select',
    {
      id: 'profile',
      onchange: (event) => search(data.player.name, event.target.value),
    },
    data.profiles.map((p) =>
      h('option', { value: p.id, selected: p.id === data.profile }, `${p.name}${p.mode ? ` (${p.mode})` : ''}${p.selected ? ' · active' : ''}`),
    ),
  );
  return h(
    'div',
    { class: 'player-bar' },
    h('img', { src: `https://mc-heads.net/avatar/${data.player.uuid}/40`, alt: '', width: 40, height: 40 }),
    h('strong', { class: 'player-name' }, data.player.name),
    h('label', { for: 'profile', class: 'visually-hidden' }, 'Profile'),
    select,
  );
}

function renderResults() {
  const { data } = state;
  const parts = [playerBar(data)];

  if (data.unreadable > 0) {
    parts.push(h('p', { class: 'callout' }, `${plural(data.unreadable, 'storage container')} couldn't be read, so some weapons may be missing.`));
  }

  if (data.inventoryOff) {
    parts.push(renderInventoryOff(data.player.name));
  } else if (!data.weapons.length) {
    parts.push(renderMessage('No weapons found', `${data.player.name} has no swords or bows in their inventory, ender chest, backpacks or vault on this profile.`));
  } else {
    const matches = h('div', { id: 'weapon-matches' }, weaponMatches());
    const filter = h('input', {
      type: 'search',
      class: 'filter',
      placeholder: `Filter ${plural(data.weapons.length, 'weapon')}`,
      'aria-label': 'Filter weapons by name',
      oninput: (event) => {
        state.filter = event.target.value;
        matches.replaceChildren(weaponMatches());
      },
    });

    parts.push(
      h(
        'div',
        { class: 'layout' },
        h('nav', { class: 'weapon-list', 'aria-label': 'Weapons' }, filter, matches),
        weaponDetail(data.weapons[state.selected]),
      ),
    );
  }

  app.replaceChildren(...parts);
}

async function search(name, profile) {
  const requestId = ++state.requestId;
  document.body.classList.remove('landing');
  nameInput.value = name;
  if (decodeURIComponent(location.hash.slice(1)) !== name) history.replaceState(null, '', `#${encodeURIComponent(name)}`);
  statusLine.textContent = `Looking up ${name}`;
  app.replaceChildren(h('p', { class: 'loading-text' }, `Looking up ${name}...`));

  try {
    const params = new URLSearchParams({ name });
    if (profile) params.set('profile', profile);
    const response = await fetch(`/api/weapons?${params}`);
    const body = await response.json();
    if (requestId !== state.requestId) return; // A newer search has started.
    if (!response.ok) {
      statusLine.textContent = body.message;
      app.replaceChildren(renderError(body.error, body.message));
      return;
    }
    state.data = body;
    state.selected = 0;
    state.filter = '';
    document.title = `${body.player.name} · Hexcheck`;
    statusLine.textContent = `Found ${plural(body.weapons.length, 'weapon')} for ${body.player.name}`;
    renderResults();
  } catch {
    if (requestId !== state.requestId) return;
    app.replaceChildren(renderMessage("Can't reach the Hexcheck server", 'Make sure it is still running, then try again.'));
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();
  if (name) search(name);
});

async function start() {
  const fromLink = decodeURIComponent(location.hash.slice(1));
  if (fromLink) {
    search(fromLink);
    return;
  }
  try {
    const response = await fetch('/api/status');
    const { hasKey } = await response.json();
    if (!hasKey) app.replaceChildren(renderSetup());
  } catch {
    // The search itself will report a dead server.
  }
  nameInput.focus();
}

start();
