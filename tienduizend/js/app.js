/*
 * Tienduizend - schermen, invoer en synchronisatie.
 * Zelfde opzet als Flip 7: de host heeft de echte stand, gasten sturen zetten.
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

const nf = new Intl.NumberFormat('nl-NL');

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

/* -------------------------------------------------------------- zetten */

function act(kind, seat, index) {
  if (app.mode === 'guest') {
    app.net.send({ t: 'act', a: kind, index });
    return;
  }
  apply(seat, kind, index);
}

function apply(seat, kind, index) {
  try {
    if (kind === 'roll') E.roll(app.state, seat);
    else if (kind === 'toggle') E.toggle(app.state, seat, index);
    else if (kind === 'rollOn') E.rollOn(app.state, seat);
    else if (kind === 'bank') E.bank(app.state, seat);
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
  $('hud-target').textContent = nf.format(s.target);
  $('hud-entry').textContent = s.entry ? `Instap ${nf.format(s.entry)}` : 'Geen instap';
  $('hud-entry').hidden = !s.entry;

  renderMat();
  renderTable();
  renderFeed();
  renderActionBar();
}

/** Het dobbelvlak: vastgelegde dobbels, de open worp en het beurttotaal. */
function renderMat() {
  const s = app.state;
  const a = E.actor(s);
  const mat = $('mat');
  mat.replaceChildren();
  mat.hidden = !a; // na de laatste beurt geen leeg dobbelvlak laten staan
  if (!a) return;

  const p = s.players[a.seat];
  const mine = canControl(a.seat);
  const fresh = s.rollId > app.seenRoll;
  app.seenRoll = Math.max(app.seenRoll, s.rollId);

  if (s.aside.length) {
    mat.append(row('Vastgelegd', '', s.aside.map((v) => die(v, { aside: true, small: true }))));
  }

  if (s.poedel) {
    const dead = s.poedel.roll.map((v) => die(v, { dead: true }));
    mat.append(row('Poedel', '', dead));
    const p2 = document.createElement('p');
    p2.className = 'poedel';
    p2.innerHTML = `Poedel!<small>${escape(s.players[s.poedel.seat].name)} verliest de punten van die beurt.</small>`;
    mat.append(p2);
  } else if (s.rolling) {
    const dice = s.roll.map((v, i) =>
      die(v, {
        picked: s.picked.includes(i),
        pickable: mine,
        rolled: fresh,
        onClick: mine ? () => act('toggle', a.seat, i) : null,
      }),
    );
    mat.append(
      row(
        mine ? 'Tik aan wat je vastlegt' : `${p.name} kiest…`,
        a.selection.valid ? `+${nf.format(a.selection.score)}` : '',
        dice,
      ),
    );
  } else {
    const wachten = document.createElement('p');
    wachten.className = 'waiting';
    wachten.textContent = mine
      ? `Je hebt ${a.diceLeft} ${a.diceLeft === 1 ? 'dobbel' : 'dobbels'} om te gooien.`
      : `${p.name} moet gooien.`;
    mat.append(wachten);
  }

  const tot = document.createElement('div');
  tot.className = 'turn-total';
  const extra = a.selection.valid && s.rolling ? a.selection.score : 0;
  tot.innerHTML = `
    <span class="lbl">Deze beurt</span>
    <span class="big">${nf.format(s.banked)}</span>
    ${extra ? `<span class="plus">+ ${nf.format(extra)}</span>` : ''}`;
  mat.append(tot);
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
  6: [0, 2, 3, 5, 6, 8],
};

function die(value, o = {}) {
  const el = document.createElement(o.onClick ? 'button' : 'div');
  el.className = 'die';
  if (o.small) el.classList.add('small');
  if (o.aside) el.classList.add('aside');
  if (o.dead) el.classList.add('dead');
  if (o.picked) el.classList.add('picked');
  if (o.pickable) el.classList.add('pickable');
  if (o.rolled) el.classList.add('rolled');
  el.setAttribute('aria-label', String(value));
  for (let cell = 0; cell < 9; cell++) {
    const span = document.createElement('span');
    if (PIPS[value].includes(cell)) span.className = 'pip';
    el.append(span);
  }
  if (o.onClick) el.addEventListener('click', o.onClick);
  return el;
}

function renderTable() {
  const s = app.state;
  const a = E.actor(s);
  const me = mySeat();
  $('table').replaceChildren(
    ...s.players.map((p, i) => {
      const seat = document.createElement('div');
      seat.className = 'seat';
      if (a && a.seat === i) seat.classList.add('active');
      if (i === me) seat.classList.add('me');
      if (!p.connected) seat.classList.add('offline');
      seat.innerHTML = `
        <span class="avatar">${escape(initials(p.name))}</span>
        <span class="seat-name">${escape(p.name)}${i === me ? ' <span class="you">(jij)</span>' : ''}</span>
        ${p.onBoard ? '' : '<span class="badge wacht">nog niet binnen</span>'}
        ${p.connected ? '' : '<span class="badge">offline</span>'}
        <span class="total">${nf.format(p.total)}</span>`;
      const bar = document.createElement('span');
      bar.className = 'bar';
      bar.style.width = Math.min(100, (p.total / s.target) * 100) + '%';
      seat.append(bar);
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
      ? `<b>${escape(p.name)}</b> is offline - gooi voor hen`
      : app.mode === 'local'
        ? `<b>${escape(p.name)}</b> is aan de beurt`
        : 'Jouw beurt';

  if (a.kind === 'roll') {
    const label = s.banked
      ? `<b>Gooi verder</b><small>${a.diceLeft} ${a.diceLeft === 1 ? 'dobbel' : 'dobbels'}</small>`
      : `<b>Gooien</b><small>6 dobbels</small>`;
    inner.append(prompt, button('btn roll', label, () => act('roll', a.seat)));
  } else {
    const duo = document.createElement('div');
    duo.className = 'duo';
    const rollBtn = button(
      'btn roll',
      a.hotDice
        ? `<b>Alles telt!</b><small>opnieuw met 6</small>`
        : `<b>Gooi verder</b><small>${a.diceLeft} ${a.diceLeft === 1 ? 'dobbel' : 'dobbels'}</small>`,
      () => act('rollOn', a.seat),
    );
    const bankBtn = button(
      'btn hold',
      `<b>Stoppen</b><small>${a.canBank ? nf.format(a.turnScore) + ' punten' : 'instap ' + nf.format(s.entry)}</small>`,
      () => act('bank', a.seat),
    );
    rollBtn.disabled = !a.selection.valid;
    bankBtn.disabled = !a.canBank;
    duo.append(rollBtn, bankBtn);
    if (!a.selection.valid) {
      prompt.innerHTML = s.picked.length
        ? 'Deze selectie levert niets op'
        : 'Tik de dobbels aan die je vastlegt';
    }
    inner.append(prompt, duo);
  }
  bar.replaceChildren(inner);
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
  $('end-title').textContent =
    winners.length > 1 ? 'Gelijkspel!' : `${winners[0].name} wint!`;
  $('end-scores').replaceChildren(
    ...[...s.players]
      .sort((x, y) => y.total - x.total)
      .map((p) => {
        const li = document.createElement('li');
        if (s.winners.includes(p.id)) li.classList.add('win');
        li.innerHTML = `
          <span class="avatar">${escape(initials(p.name))}</span>
          <span>${escape(p.name)}</span>
          <span class="total">${nf.format(p.total)}</span>`;
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

/** De regels tonen de gekozen instellingen, zodat er geen discussie over is. */
function renderRules() {
  const s = app.state;
  const entry = $('rule-entry');
  const target = $('rule-target');
  if (!s) return;
  entry.innerHTML = s.entry
    ? `<b>Binnenkomen:</b> je eerste keer stoppen mag pas met ${nf.format(s.entry)} punten of meer in één beurt.`
    : '<b>Binnenkomen:</b> er is geen drempel; je mag altijd stoppen.';
  target.innerHTML = `<b>Einde:</b> wie ${nf.format(s.target)} punten haalt, sluit het spel; iedereen krijgt nog één beurt en de hoogste score wint.`;
  document
    .querySelectorAll('.extra-rule')
    .forEach((el) => (el.hidden = !s.extras));
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
  if (seat !== app.state.turn) {
    app.net.send(token, { t: 'err', msg: 'Je bent niet aan de beurt.' });
    return;
  }
  apply(seat, msg.a, msg.index);
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
    renderRules();
    render();
    return;
  }
  if (msg.t === 'state') {
    app.state = msg.state;
    renderRules();
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
    const s = app.state;
    s.target = Number($('target-select').value) || E.DEFAULT_TARGET;
    s.entry = Number($('entry-select').value) || 0;
    s.extras = $('extras-select').value === 'ja';
    try {
      E.startGame(s);
    } catch (err) {
      return toast(err.message);
    }
    app.seenRoll = s.rollId || 0;
    renderRules();
    publish();
    render();
  });

  $('btn-copy').addEventListener('click', () => copyCode(app.net.code));
  $('btn-share').addEventListener('click', () => shareInvite(app.net.code, 'Tienduizend'));

  document.querySelectorAll('[data-open-rules]').forEach((b) =>
    b.addEventListener('click', () => {
      renderRules();
      $('sheet-rules').hidden = false;
    }),
  );
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
