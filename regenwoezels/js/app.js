/*
 * Regenwoezels - schermen, invoer en synchronisatie.
 * Zelfde opzet als de andere spellen: de host heeft de echte stand.
 */
import * as E from './engine.js';
import { startHost, joinRoom, randomCode } from '../../shared/js/net.js';
import {
  $, show, isVisible, toast, escape, initials, button,
  myToken, rememberedName, rememberName, keepAwake, shareInvite, copyCode,
} from '../../shared/js/ui.js';

const app = {
  mode: null, // host | guest | local
  net: null,
  state: null,
  myId: null,
  seenRoll: 0,
};

/* ------------------------------------------------------------- helpers */

function mySeat() {
  if (!app.state || !app.myId) return -1;
  return app.state.players.findIndex((p) => p.id === app.myId);
}

function canControl(seat) {
  if (app.mode === 'local') return true;
  if (seat === mySeat()) return true;
  return app.mode === 'host' && app.state?.players[seat]?.connected === false;
}

const isDirector = () => app.mode === 'host' || app.mode === 'local';

/** Een woezel als SVG, zodat we niet van emoji-ondersteuning afhankelijk zijn. */
function wormSvg(cls = 'worm') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M4 17c3 0 3-4 6-4s3 4 6 4 4-3 4-6');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke-width', '3.4');
  path.setAttribute('stroke-linecap', 'round');
  svg.append(path);
  return svg;
}

/* -------------------------------------------------------------- zetten */

function act(kind, seat, arg) {
  if (app.mode === 'guest') {
    app.net.send({ t: 'act', a: kind, arg });
    return;
  }
  apply(seat, kind, arg);
}

function apply(seat, kind, arg) {
  try {
    if (kind === 'roll') E.roll(app.state, seat);
    else if (kind === 'keep') E.keep(app.state, seat, arg);
    else if (kind === 'stop') E.stop(app.state, seat);
    else if (kind === 'choose') E.choose(app.state, seat, arg);
    else if (kind === 'restart') {
      E.resetGame(app.state);
      publish();
      render();
      show('screen-lobby');
      return;
    }
  } catch (err) {
    if (err instanceof E.GameError) {
      toast(err.message);
      return;
    }
    throw err;
  }
  publish();
  render();
}

function publish() {
  if (app.mode === 'host') app.net.broadcast({ t: 'state', state: E.publicState(app.state) });
}

/* -------------------------------------------------------------- render */

function render() {
  const s = app.state;
  if (!s) return;

  renderEndSheet();

  if (s.phase === 'lobby') {
    renderLobby();
    if (!isVisible('screen-lobby')) show('screen-lobby');
    return;
  }

  if (!isVisible('screen-game')) {
    show('screen-game');
    keepAwake(true);
  }

  $('hud-net').hidden = app.mode === 'local';
  $('hud-row').textContent = s.row.length;
  $('hud-gone').hidden = !s.gone.length;
  $('hud-gone').textContent = `${s.gone.length} uit het spel`;

  renderGrill();
  renderMat();
  renderTable();
  renderFeed();
  renderActionBar();
}

function tileEl(n, o = {}) {
  const el = document.createElement(o.onClick ? 'button' : 'div');
  el.className = 'tile' + (o.small ? ' small' : '') + (o.gone ? ' gone' : '');
  if (o.reach) el.classList.add('reach');
  if (o.onClick) {
    el.classList.add('take');
    el.addEventListener('click', o.onClick);
  }
  const num = document.createElement('span');
  num.className = 'n';
  num.textContent = n;
  const ws = document.createElement('span');
  ws.className = 'ws';
  for (let i = 0; i < E.worms(n); i++) ws.append(wormSvg());
  el.append(num, ws);
  el.setAttribute('aria-label', `tegel ${n}, ${E.worms(n)} woezels`);
  return el;
}

function renderGrill() {
  const s = app.state;
  const a = E.actor(s);
  const reach = a && a.worm ? E.rowTileFor(s, a.score) : null;
  $('grill').replaceChildren(
    ...s.row.map((n) => tileEl(n, { reach: n === reach })),
    ...s.gone.map((n) => tileEl(n, { small: true, gone: true })),
  );
}

/** De dobbelmat: wat vastligt, de open worp (per waarde gegroepeerd) en het totaal. */
function renderMat() {
  const s = app.state;
  const a = E.actor(s);
  const mat = $('mat');
  mat.replaceChildren();
  mat.hidden = !a;
  if (!a) return;

  const p = s.players[a.seat];
  const mine = canControl(a.seat);
  const fresh = s.rollId > app.seenRoll;
  app.seenRoll = Math.max(app.seenRoll, s.rollId);

  if (s.aside.length) {
    const group = groupBy(s.aside);
    const children = [...group.entries()].map(([v, list]) => {
      const g = document.createElement('span');
      g.className = 'group';
      list.forEach(() => g.append(dieEl(v, { aside: true, small: true })));
      return g;
    });
    mat.append(row('Vastgelegd', `${a.score} punten`, children));
  }

  if (s.bust) {
    const why = {
      'geen nieuwe waarde': 'niets nieuws om apart te leggen',
      'geen woezel': 'gestopt zonder woezel',
      'niets te pakken': 'te laag voor elke tegel',
    }[s.bust.reason];
    const el = document.createElement('p');
    el.className = 'fail';
    el.innerHTML = `Mislukt!<small>${escape(s.players[s.bust.seat].name)}: ${escape(why)}.</small>`;
    if (s.bust.roll.length) {
      const group = groupBy(s.bust.roll);
      const children = [...group.entries()].map(([v, list]) => {
        const g = document.createElement('span');
        g.className = 'group dim';
        list.forEach(() => g.append(dieEl(v, { small: true })));
        return g;
      });
      mat.append(row('Laatste worp', '', children));
    }
    mat.append(el);
  } else if (s.rolling) {
    const group = groupBy(s.dice);
    const children = [...group.entries()].map(([v, list]) => {
      const used = s.used.includes(v);
      const g = document.createElement(mine && !used ? 'button' : 'span');
      g.className = 'group' + (used ? ' dim' : mine ? ' pickable' : '');
      list.forEach(() => g.append(dieEl(v, { rolled: fresh })));
      const val = document.createElement('span');
      val.className = 'val';
      val.textContent = `${list.length}× ${E.pips(v) * list.length}`;
      g.append(val);
      if (mine && !used) g.addEventListener('click', () => act('keep', a.seat, v));
      g.setAttribute(
        'aria-label',
        `${list.length} keer ${E.faceLabel(v)}${used ? ', al gekozen' : ''}`,
      );
      return g;
    });
    mat.append(
      row(mine ? 'Kies één waarde om apart te leggen' : `${p.name} kiest…`, '', children),
    );
  } else if (a.kind === 'roll' && !s.aside.length) {
    const el = document.createElement('p');
    el.className = 'waiting';
    el.textContent = mine ? 'Gooi met alle acht dobbels.' : `${p.name} moet gooien.`;
    mat.append(el);
  }

  const tot = document.createElement('div');
  tot.className = 'turn-total';
  tot.innerHTML = `
    <span class="lbl">Deze beurt</span>
    <span class="big">${a.score}</span>
    ${
      s.aside.length
        ? a.worm
          ? '<span class="okworm">woezel ✓</span>'
          : '<span class="noworm">nog geen woezel</span>'
        : ''
    }`;
  mat.append(tot);
}

function groupBy(dice) {
  const map = new Map();
  for (const v of dice) {
    if (!map.has(v)) map.set(v, []);
    map.get(v).push(v);
  }
  return new Map([...map.entries()].sort((a, b) => E.pips(b[0]) - E.pips(a[0])));
}

function row(label, right, children) {
  const wrap = document.createElement('div');
  wrap.className = 'mat-row';
  const head = document.createElement('div');
  head.className = 'mat-label';
  head.innerHTML = `<span>${escape(label)}</span>${right ? `<b class="spacer">${escape(right)}</b>` : ''}`;
  const dice = document.createElement('div');
  dice.className = 'dice' + (children.length ? '' : ' empty');
  dice.append(...children);
  wrap.append(head, dice);
  return wrap;
}

const PIPS = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
};

function dieEl(value, o = {}) {
  const el = document.createElement('span');
  el.className = 'die';
  if (o.small) el.classList.add('small');
  if (o.aside) el.classList.add('aside');
  if (o.rolled) el.classList.add('rolled');
  if (value === E.WORM) {
    el.classList.add('wormface');
    el.append(wormSvg());
  } else {
    for (let cell = 0; cell < 9; cell++) {
      const span = document.createElement('span');
      if (PIPS[value].includes(cell)) span.className = 'pip';
      el.append(span);
    }
  }
  el.setAttribute('aria-label', E.faceLabel(value));
  return el;
}

function renderTable() {
  const s = app.state;
  const a = E.actor(s);
  const me = mySeat();
  const stealable = a && a.worm ? E.stealTargets(s, a.seat, a.score) : [];
  $('table').replaceChildren(
    ...s.players.map((p, i) => {
      const seat = document.createElement('div');
      seat.className = 'seat';
      if (a && a.seat === i) seat.classList.add('active');
      if (i === me) seat.classList.add('me');
      if (stealable.includes(i)) seat.classList.add('target');
      if (!p.connected) seat.classList.add('offline');
      seat.innerHTML = `
        <span class="avatar">${escape(initials(p.name))}</span>
        <span class="seat-name">${escape(p.name)}${i === me ? ' <span class="you">(jij)</span>' : ''}</span>`;

      const stack = document.createElement('span');
      stack.className = 'stack';
      const t = E.top(p);
      if (t === null) {
        const empty = document.createElement('span');
        empty.className = 'empty';
        empty.textContent = 'nog niets';
        stack.append(empty);
      } else {
        if (p.stack.length > 1) {
          const count = document.createElement('span');
          count.className = 'count';
          count.textContent = `+${p.stack.length - 1}`;
          stack.append(count);
        }
        stack.append(tileEl(t, { small: true }));
      }
      const wt = document.createElement('span');
      wt.className = 'wormtotal';
      wt.append(wormSvg());
      const n = document.createElement('span');
      n.textContent = E.wormCount(p);
      wt.append(n);
      stack.append(wt);
      seat.append(stack);
      return seat;
    }),
  );
}

function renderFeed() {
  $('feed').replaceChildren(
    ...app.state.log
      .slice(-6)
      .reverse()
      .map((l) => {
        const li = document.createElement('li');
        li.textContent = l.text;
        return li;
      }),
  );
}

function renderActionBar() {
  const s = app.state;
  const bar = $('actionbar');
  if (s.phase !== 'turn') {
    bar.replaceChildren();
    return;
  }
  const a = E.actor(s);
  const p = s.players[a.seat];
  const mine = canControl(a.seat);
  const inner = document.createElement('div');
  inner.className = 'inner';
  const prompt = document.createElement('p');
  prompt.className = 'prompt';

  if (!mine) {
    prompt.innerHTML = `Wachten op <b>${escape(p.name)}</b>…`;
    inner.append(prompt);
    bar.replaceChildren(inner);
    return;
  }

  prompt.innerHTML =
    a.seat !== mySeat() && app.mode !== 'local'
      ? `<b>${escape(p.name)}</b> is offline - speel voor hen`
      : app.mode === 'local'
        ? `<b>${escape(p.name)}</b> is aan de beurt`
        : 'Jouw beurt';

  if (a.kind === 'choose') {
    prompt.innerHTML = `<b>${a.options[0].tile <= a.score ? 'Kies je tegel' : 'Kies'}</b>`;
    const choices = document.createElement('div');
    choices.className = 'choices';
    a.options.forEach((o, i) => {
      const label =
        o.kind === 'row'
          ? `<b>Tegel ${o.tile}</b><small>van de grill</small>`
          : `<b>Tegel ${o.tile}</b><small>afpakken van ${escape(s.players[o.seat].name)}</small>`;
      choices.append(button('btn', label, () => act('choose', a.seat, i)));
    });
    inner.append(prompt, choices);
  } else if (a.kind === 'keep') {
    prompt.innerHTML = 'Tik een groepje dobbels aan';
    inner.append(prompt);
  } else {
    const duo = document.createElement('div');
    duo.className = 'duo';
    const rollBtn = button(
      'btn roll',
      `<b>${s.aside.length ? 'Gooi verder' : 'Gooien'}</b><small>${a.diceLeft} ${
        a.diceLeft === 1 ? 'dobbel' : 'dobbels'
      }</small>`,
      () => act('roll', a.seat),
    );
    rollBtn.disabled = !a.canRoll;
    const stopBtn = button(
      'btn hold',
      `<b>Stoppen</b><small>${stopHint(s, a)}</small>`,
      () => act('stop', a.seat),
    );
    stopBtn.disabled = !a.canStop;
    duo.append(rollBtn, stopBtn);
    inner.append(prompt, duo);
  }
  bar.replaceChildren(inner);
}

function stopHint(s, a) {
  if (!s.aside.length) return 'eerst gooien';
  if (!a.worm) return 'geen woezel';
  const row = E.rowTileFor(s, a.score);
  const steal = E.stealTargets(s, a.seat, a.score);
  if (steal.length) return `tegel ${a.score} afpakken`;
  if (row !== null) return `tegel ${row} pakken`;
  return 'geen tegel haalbaar';
}

function renderEndSheet() {
  const s = app.state;
  const sheet = $('sheet-end');
  if (s.phase !== 'gameOver') {
    sheet.hidden = true;
    $('end-actions').replaceChildren();
    return;
  }
  const winners = s.players.filter((p) => s.winners.includes(p.id));
  $('end-title').textContent = winners.length > 1 ? 'Gelijkspel!' : `${winners[0].name} wint!`;
  $('end-scores').replaceChildren(
    ...[...s.players]
      .sort((x, y) => E.wormCount(y) - E.wormCount(x))
      .map((p) => {
        const li = document.createElement('li');
        if (s.winners.includes(p.id)) li.classList.add('win');
        li.innerHTML = `
          <span class="avatar">${escape(initials(p.name))}</span>
          <span>${escape(p.name)} <span class="muted">${p.stack.length} ${
            p.stack.length === 1 ? 'tegel' : 'tegels'
          }</span></span>`;
        const wt = document.createElement('span');
        wt.className = 'wormtotal delta';
        wt.append(wormSvg());
        const n = document.createElement('span');
        n.textContent = E.wormCount(p);
        wt.append(n);
        li.append(wt);
        return li;
      }),
  );
  const actions = $('end-actions');
  actions.replaceChildren();
  if (isDirector()) {
    actions.append(button('btn primary', '<b>Nieuw spel</b>', () => apply(0, 'restart')));
  } else {
    const wait = document.createElement('p');
    wait.className = 'waiting';
    wait.textContent = 'Wachten op een nieuw spel…';
    actions.append(wait);
  }
  sheet.hidden = false;
}

/* ---------------------------------------------------------- wachtkamer */

function renderLobby() {
  const s = app.state;
  $('lobby-players').replaceChildren(
    ...s.players.map((p) => {
      const li = document.createElement('li');
      if (!p.connected) li.classList.add('offline');
      li.innerHTML = `
        <span class="avatar">${escape(initials(p.name))}</span>
        <span>${escape(p.name)}${p.id === app.myId ? ' <span class="you">(jij)</span>' : ''}</span>
        <span class="tag">${p.connected ? (p.id === app.myId && app.mode === 'host' ? 'host' : 'klaar') : 'offline'}</span>`;
      if (app.mode === 'local' && s.players.length > 2) {
        li.append(
          button('btn small', '×', () => {
            E.removePlayer(s, p.id);
            render();
          }),
        );
      }
      return li;
    }),
  );
  $('lobby-count').textContent = `${s.players.length}/${E.MAX_PLAYERS}`;
  $('lobby-host-only').hidden = !isDirector();
  $('local-add').hidden = app.mode !== 'local';
  $('code-card').hidden = app.mode === 'local';
  $('btn-start').disabled = s.players.length < 2;
  $('lobby-hint').textContent =
    s.players.length < 2
      ? app.mode === 'local'
        ? 'Voeg minstens 2 spelers toe.'
        : 'Wachten tot er nog iemand meedoet…'
      : isDirector()
        ? 'Iedereen erin? Start het spel.'
        : 'Wachten tot de host het spel start…';
}

/* ---------------------------------------------------------------- host */

async function beHost() {
  const name = rememberName($('name-input').value.trim().slice(0, 16));
  if (!name) return toast('Vul eerst je naam in.');
  const btn = $('btn-host');
  btn.disabled = true;
  btn.querySelector('small').textContent = 'Kamer openen…';
  try {
    app.state = E.newGame();
    app.myId = myToken();
    E.addPlayer(app.state, app.myId, name);
    app.mode = 'host';
    app.net = await startHost({
      onJoin: hostJoin,
      onMessage: hostMessage,
      onLeave: hostLeave,
      onStatus: netStatus,
    });
    $('room-code').textContent = app.net.code;
    history.replaceState(null, '', '?join=' + app.net.code);
    show('screen-lobby');
    render();
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.querySelector('small').textContent = 'Jij bent de tafel, anderen doen mee met een code';
  }
}

function hostJoin(token, name, conn) {
  const s = app.state;
  const known = s.players.some((p) => p.id === token);
  if (!known && s.phase !== 'lobby') {
    return conn.send({ t: 'denied', reason: 'Het spel is al begonnen.' });
  }
  try {
    E.addPlayer(s, token, name);
  } catch (err) {
    return conn.send({ t: 'denied', reason: err.message });
  }
  conn.send({ t: 'welcome', you: token, state: E.publicState(s) });
  publish();
  toast(`${name} doet mee`);
  render();
}

function hostMessage(token, msg) {
  if (msg.t !== 'act') return;
  const seat = app.state.players.findIndex((p) => p.id === token);
  if (seat < 0 || msg.a === 'restart') return;
  const a = E.actor(app.state);
  if (!a || a.seat !== seat) {
    app.net.send(token, { t: 'err', msg: 'Je bent niet aan de beurt.' });
    return;
  }
  apply(seat, msg.a, msg.arg);
}

function hostLeave(token) {
  const p = app.state.players.find((x) => x.id === token);
  if (!p) return;
  E.removePlayer(app.state, token);
  toast(`${p.name} is weg`);
  publish();
  render();
}

/* --------------------------------------------------------------- guest */

async function beGuest() {
  const name = rememberName($('name-input').value.trim().slice(0, 16));
  if (!name) {
    show('screen-home');
    return toast('Vul eerst je naam in.');
  }
  const code = $('code-input').value.trim().toUpperCase();
  if (code.length !== 4) return setJoinHint('Een kamercode bestaat uit 4 tekens.', true);
  const btn = $('btn-join-go');
  btn.disabled = true;
  btn.querySelector('b').textContent = 'Verbinden…';
  setJoinHint('Zoeken naar de kamer…');
  try {
    app.mode = 'guest';
    app.net = await joinRoom({
      code,
      token: myToken(),
      name,
      onMessage: guestMessage,
      onStatus: netStatus,
    });
    setJoinHint('Verbonden. Wachten op de tafel…');
  } catch (err) {
    app.mode = null;
    setJoinHint(err.message, true);
  } finally {
    btn.disabled = false;
    btn.querySelector('b').textContent = 'Verbinden';
  }
}

function guestMessage(msg) {
  if (msg.t === 'welcome') {
    app.myId = msg.you;
    app.state = msg.state;
    app.seenRoll = app.state.rollId || 0;
    $('room-code').textContent = app.net.code;
    render();
    return;
  }
  if (msg.t === 'state') {
    app.state = msg.state;
    render();
    return;
  }
  if (msg.t === 'err') return toast(msg.msg);
  if (msg.t === 'denied') {
    app.net?.close();
    app.net = null;
    app.mode = null;
    show('screen-join');
    setJoinHint(msg.reason, true);
  }
}

function setJoinHint(text, isError) {
  const h = $('join-hint');
  h.textContent = text;
  h.classList.toggle('error', !!isError);
}

function netStatus(kind, detail) {
  const pill = $('hud-net');
  const map = {
    online: ['online', 'verbonden'],
    reconnecting: ['warn', 'verbinden…'],
    offline: ['bad', 'offline'],
    error: ['bad', detail || 'fout'],
  };
  const [cls, label] = map[kind] || ['', kind];
  pill.className = 'pill status ' + cls;
  pill.textContent = label;
  if (kind === 'offline') toast('De verbinding is verbroken. Probeer de pagina te herladen.');
}

/* --------------------------------------------------------------- local */

function beLocal() {
  const name = rememberName($('name-input').value.trim().slice(0, 16));
  app.mode = 'local';
  app.myId = null;
  app.net = null;
  app.state = E.newGame();
  E.addPlayer(app.state, 'l0', name || 'Speler 1');
  E.addPlayer(app.state, 'l1', 'Speler 2');
  show('screen-lobby');
  render();
}

function addLocalPlayer() {
  const input = $('local-name');
  const name = input.value.trim() || `Speler ${app.state.players.length + 1}`;
  try {
    E.addPlayer(app.state, 'l' + randomCode(5), name.slice(0, 16));
  } catch (err) {
    return toast(err.message);
  }
  input.value = '';
  input.focus();
  render();
}

/* ------------------------------------------------------------ bindings */

function leave() {
  app.net?.close();
  app.net = null;
  app.mode = null;
  app.state = null;
  app.myId = null;
  keepAwake(false);
  history.replaceState(null, '', location.pathname);
  show('screen-home');
}

function bind() {
  $('name-input').value = rememberedName();

  $('btn-host').addEventListener('click', beHost);
  $('btn-local').addEventListener('click', beLocal);
  $('btn-join').addEventListener('click', () => {
    if (!rememberName($('name-input').value.trim().slice(0, 16))) {
      return toast('Vul eerst je naam in.');
    }
    show('screen-join');
    $('code-input').focus();
  });
  $('btn-join-go').addEventListener('click', beGuest);
  $('code-input').addEventListener('keydown', (e) => e.key === 'Enter' && beGuest());
  $('name-input').addEventListener('keydown', (e) => e.key === 'Enter' && e.target.blur());
  $('local-name').addEventListener('keydown', (e) => e.key === 'Enter' && addLocalPlayer());
  $('btn-local-add').addEventListener('click', addLocalPlayer);
  $('btn-leave').addEventListener('click', leave);

  $('btn-start').addEventListener('click', () => {
    try {
      E.startGame(app.state);
    } catch (err) {
      return toast(err.message);
    }
    app.seenRoll = app.state.rollId || 0;
    publish();
    render();
  });

  $('btn-copy').addEventListener('click', () => copyCode(app.net.code));
  $('btn-share').addEventListener('click', () => shareInvite(app.net.code, 'Regenwoezels'));

  document
    .querySelectorAll('[data-open-rules]')
    .forEach((b) => b.addEventListener('click', () => ($('sheet-rules').hidden = false)));
  document
    .querySelectorAll('[data-close-sheet]')
    .forEach((b) => b.addEventListener('click', () => ($('sheet-rules').hidden = true)));
  document
    .querySelectorAll('[data-goto]')
    .forEach((b) => b.addEventListener('click', () => show(b.dataset.goto)));
  $('sheet-rules').addEventListener('click', (e) => {
    if (e.target === $('sheet-rules')) $('sheet-rules').hidden = true;
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && app.state && app.state.phase !== 'lobby') keepAwake(true);
  });

  const code = new URLSearchParams(location.search).get('join');
  if (code) {
    const room = code.toUpperCase().slice(0, 4);
    $('code-input').value = room;
    if ($('name-input').value) {
      show('screen-join');
      setJoinHint('Klaar om mee te doen aan kamer ' + room + '.');
    } else {
      document.querySelector('.tagline').textContent =
        `Je bent uitgenodigd voor kamer ${room}. Vul je naam in en tik op "Meedoen met een code".`;
      $('btn-join').classList.add('primary');
      $('btn-host').classList.remove('primary');
      $('name-input').focus();
    }
  }
}

bind();
