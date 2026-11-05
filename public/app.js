'use strict';

const app = document.getElementById('app');
const form = document.getElementById('search');
const nameInput = document.getElementById('name');
const statusLine = document.getElementById('status');

const state = { player: null, profileId: null, selected: 0, filter: '', requestId: 0 };
const USERNAME = /^[A-Za-z0-9_]{1,16}$/;

const MC_COLORS = {
  0: '#000000', 1: '#0000AA', 2: '#00AA00', 3: '#00AAAA', 4: '#AA0000', 5: '#AA00AA', 6: '#FFAA00', 7: '#AAAAAA',
  8: '#555555', 9: '#5555FF', a: '#55FF55', b: '#55FFFF', c: '#FF5555', d: '#FF55FF', e: '#FFFF55', f: '#FFFFFF',
};
const MARKS = { done: '✔', partial: '▲', todo: '+', skip: '–', pick: '•' };

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
  text.replace(/(\[(?:§.)*)[\uE000-\uF8FF]((?:§.)*\])/g, '$1◆$2').replace(/[\uE000-\uF8FF]/g, '');

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
const formatTime = (iso) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const coinFormat = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const formatCoins = (coins) => `${coinFormat.format(coins)} coins`;

/** Adds a price to a row's note. Null means there's no market price to go on. */
function withCoins(note, coins, prefix = 'About') {
  const price = coins === null ? 'No market price' : coins > 0 ? `${prefix} ${formatCoins(coins)}` : null;
  return [note, price].filter(Boolean).join('. ');
}

const currentProfile = () => state.player.profiles.find((profile) => profile.id === state.profileId);

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
  const { ultimate, ultimateOptions, cheapestUltimate, upgrade, missing, pickOne, skippable, maxed, other, oneForAll } = enchants;
  const ultimateLeft = ultimate ? (ultimate.max !== null && ultimate.level < ultimate.max ? 1 : 0) : ultimateOptions.length ? 1 : 0;

  let ultimateRow = null;
  if (ultimate) {
    const isMax = ultimate.max === null || ultimate.level >= ultimate.max;
    ultimateRow = row(isMax ? 'done' : 'partial', ultimate.name, isMax ? roman(ultimate.level) : `${roman(ultimate.level)} → ${roman(ultimate.max)}`, withCoins(undefined, ultimate.coins));
  } else if (ultimateOptions.length) {
    const choices = ultimateOptions.map((o) => `${o.name} ${roman(o.max)}`).join(', ');
    const warning = ultimateOptions.some((o) => o.id === 'ultimate_one_for_all') ? ' One For All removes every other enchant.' : '';
    const cheapest = cheapestUltimate ? ` Cheapest is ${cheapestUltimate.name} ${roman(cheapestUltimate.max)}, about ${formatCoins(cheapestUltimate.coins)}.` : '';
    ultimateRow = row('todo', 'No ultimate enchant', 'Pick one', `${choices}.${warning}${cheapest}`);
  }

  const leftCount = ultimateLeft + upgrade.length + missing.length + pickOne.length;

  return section(
    'Enchantments',
    leftCount,
    oneForAll && h('p', { class: 'callout' }, "One For All is on this weapon, and it replaces every other enchant, so there's nothing else to add."),
    group('Ultimate', ultimateRow ? [ultimateRow] : []),
    group('Not maxed yet', upgrade.map((e) => row('partial', e.name, `${roman(e.level)} → ${roman(e.max)}`, withCoins(e.note, e.coins)))),
    group('Missing', missing.map((e) => row('todo', e.name, `Add ${roman(e.max)}`, withCoins(e.note, e.coins)))),
    group(
      'Missing, pick one of each',
      pickOne.map((choice) =>
        row('todo', choice.options.map((o) => o.name).join(' or '), `Add ${roman(Math.max(...choice.options.map((o) => o.max)))}`, withCoins(undefined, choice.coins, 'Cheapest is about')),
      ),
    ),
    group('Not required', skippable.map((e) => row('skip', e.name, e.level ? `${roman(e.level)} → ${roman(e.max)}` : `Add ${roman(e.max)}`, e.note))),
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
  return rows.map((r) => row(r.optional && r.status !== 'done' ? 'skip' : r.status, r.label, r.value, withCoins(r.note, r.coins)));
}

function costSection({ cost }) {
  if (!cost || (cost.total === 0 && !cost.unpriced.length)) return null;
  const parts = [
    ['Enchantments', cost.enchants],
    ['Books and upgrades', cost.upgrades],
    ['Gemstones', cost.gems],
  ].filter(([, coins]) => coins > 0);
  return h(
    'section',
    { class: 'panel' },
    h('h3', {}, 'Estimated cost to max', h('span', { class: 'cost-total' }, formatCoins(cost.total))),
    h('p', { class: 'muted section-intro' }, 'Uses current Bazaar and auction prices, and the cheapest option wherever you have a choice.'),
    group(null, parts.map(([label, coins]) => row('pick', label, coinFormat.format(coins)))),
    cost.unpriced.length > 0 && h('p', { class: 'muted' }, `Not included, because there's no market price: ${cost.unpriced.join(', ')}.`),
  );
}

function reforgeSection({ reforge }) {
  if (!reforge) return null;
  const listings = plural(reforge.count, 'upgraded listing');
  const basis =
    reforge.basedOn === 'weapon'
      ? `What players use on ${listings} of this weapon on the auction house.`
      : `Too few of this exact weapon are listed, so this is what players use on ${listings} of similar weapons.`;
  return section(
    'Reforge suggestions',
    0,
    h('p', { class: 'muted section-intro' }, basis),
    group(
      null,
      reforge.picks.map((pick) =>
        row(
          pick.isCurrent ? 'done' : 'pick',
          pick.isCurrent ? `${pick.name} (yours)` : pick.name,
          `${pick.share}%`,
          [pick.coins > 0 ? `${pick.source}, about ${formatCoins(pick.coins)}` : pick.source, pick.stats, pick.ability].filter(Boolean).join('. '),
        ),
      ),
    ),
  );
}

function weaponDetail(weapon) {
  const { progress, upgrades, gems, cost } = weapon;
  const pending = (rows) => rows.filter((r) => !r.optional && r.status !== 'done').length;
  const isMaxed = progress.left === 0;
  const headline = [`${progress.percent}% maxed`, cost?.total > 0 && `about ${formatCoins(cost.total)} to max`].filter(Boolean).join(' · ');

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
        h('span', { class: 'muted' }, headline),
      ),
      bar(progress.percent, `${plainText(weapon.name)} is ${progress.percent}% maxed`),
    ),
    h(
      'div',
      { class: 'detail-body' },
      h(
        'div',
        { class: 'checklist' },
        costSection(weapon),
        enchantSection(weapon.enchants),
        section('Books and upgrades', pending(upgrades), group(null, statusRows(upgrades))),
        reforgeSection(weapon),
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
  const detail = weaponDetail(currentProfile().weapons[index]);
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
  const matches = currentProfile()
    .weapons
    .map((weapon, index) => ({ weapon, index }))
    .filter(({ weapon }) => plainText(weapon.name).toLowerCase().includes(needle));
  if (!matches.length) return h('p', { class: 'muted' }, 'No weapon matches that name.');
  return h('ul', {}, matches.map(({ weapon, index }) => h('li', {}, weaponButton(weapon, index))));
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

const ERROR_TITLES = {
  player_not_found: 'Player not found',
  no_profiles: 'No SkyBlock profiles',
  bad_name: 'Check that username',
  rate_limited: 'Slow down a little',
  no_key: 'Searches are down',
  bad_key: 'Searches are down',
  hypixel_blocked: 'Searches are down',
};

function playerBar(player) {
  const select = h(
    'select',
    {
      id: 'profile',
      onchange: (event) => {
        // Every profile came back in the first response, so switching needs no download.
        state.profileId = event.target.value;
        state.selected = 0;
        state.filter = '';
        renderResults();
      },
    },
    player.profiles.map((p) =>
      h('option', { value: p.id, selected: p.id === state.profileId }, `${p.name}${p.mode ? ` (${p.mode})` : ''}${p.selected ? ' · active' : ''}`),
    ),
  );
  return h(
    'div',
    { class: 'player-bar' },
    h('img', { src: `https://mc-heads.net/avatar/${player.uuid}/40`, alt: '', width: 40, height: 40 }),
    h('strong', { class: 'player-name' }, player.name),
    h('label', { for: 'profile', class: 'visually-hidden' }, 'Profile'),
    select,
    h('span', { class: 'muted updated' }, `Data from ${formatTime(player.updatedAt)}`),
  );
}

function renderResults() {
  const { player } = state;
  const profile = currentProfile();
  const parts = [playerBar(player)];

  if (profile.unreadable > 0) {
    parts.push(h('p', { class: 'callout' }, `${plural(profile.unreadable, 'storage container')} couldn't be read, so some weapons may be missing.`));
  }

  if (profile.inventoryOff) {
    parts.push(renderInventoryOff(player.name));
  } else if (!profile.weapons.length) {
    parts.push(renderMessage('No weapons found', `${player.name} has no swords or bows in their inventory, ender chest, backpacks or vault on this profile.`));
  } else {
    const matches = h('div', { id: 'weapon-matches' }, weaponMatches());
    const filter = h('input', {
      type: 'search',
      class: 'filter',
      placeholder: `Filter ${plural(profile.weapons.length, 'weapon')}`,
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
        weaponDetail(profile.weapons[state.selected]),
      ),
    );
  }

  app.replaceChildren(...parts);
}

async function search(name) {
  const requestId = ++state.requestId;
  const show = (view, status) => {
    statusLine.textContent = status;
    app.replaceChildren(view);
  };
  document.body.classList.remove('landing');
  nameInput.value = name;
  history.replaceState(null, '', `#${encodeURIComponent(name)}`);

  if (!USERNAME.test(name)) {
    show(renderMessage('Check that username', "That isn't a valid Minecraft username."), 'Invalid username');
    return;
  }
  show(h('p', { class: 'loading-text' }, `Looking up ${name}...`), `Looking up ${name}`);

  try {
    // Lowercase, so different capitalisations of a name share one cached answer.
    const response = await fetch(`/api/weapons?name=${name.toLowerCase()}`);
    const body = await response.json();
    if (requestId !== state.requestId) return; // A newer search has started.
    if (!response.ok) {
      show(renderMessage(ERROR_TITLES[body.error] ?? "That didn't work", body.message), body.message);
      return;
    }
    // Never show the wrong player's weapons, even if a cache somewhere mixes up two searches.
    if (body.name.toLowerCase() !== name.toLowerCase()) throw new Error(`Asked for ${name}, got ${body.name}`);

    state.player = body;
    state.profileId = (body.profiles.find((profile) => profile.selected) ?? body.profiles[0]).id;
    state.selected = 0;
    state.filter = '';
    document.title = `${body.name} · Hexcheck`;
    statusLine.textContent = `Found ${plural(currentProfile().weapons.length, 'weapon')} for ${body.name}`;
    renderResults();
  } catch {
    if (requestId !== state.requestId) return;
    show(renderMessage("Couldn't load that", 'Check your connection and try again.'), "Couldn't load that");
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();
  if (name) search(name);
});

function hashName() {
  try {
    return decodeURIComponent(location.hash.slice(1));
  } catch {
    return '';
  }
}

function start() {
  const fromLink = hashName();
  if (fromLink) search(fromLink);
  else nameInput.focus();
}

start();
