/*
 * Flip 7 - schermen, invoer en synchronisatie.
 *
 * Drie modi:
 *   host   - deze telefoon heeft de echte spelstand en stuurt die rond
 *   guest  - stuurt zetten naar de host en toont wat die terugstuurt
 *   local  - alles op één telefoon, doorgeven aan elkaar
 */
import * as E from './engine.js';
import { startHost, joinRoom, randomCode } from '../../shared/js/net.js';
import {
  $, show, isVisible, toast, escape, initials, button,
  myToken, rememberedName, rememberName, keepAwake, shareInvite, copyCode,
} from '../../shared/js/ui.js';

const app = {
  mode: null,
  net: null,
  state: null,
  myId: null,
  seenReel: 0,
  handSizes: new Map(),
};

/* ------------------------------------------------------------ helpers */

function mySeat() {
  if (!app.state || !app.myId) return -1;
  return app.state.players.findIndex((p) => p.id === app.myId);
}

/** Mag ik voor deze stoel beslissen? */
function canControl(seat) {
  if (app.mode === 'local') return true;
  if (seat === mySeat()) return true;
  // De host neemt over voor iemand die de verbinding kwijt is.
  return app.mode === 'host' && app.state?.players[seat]?.connected === false;
}

const isDirector = () => app.mode === 'host' || app.mode === 'local';

/* -------------------------------------------------------------- zetten */

function act(kind, seat, target) {
  if (app.mode === 'guest') {
    app.net.send({ t: 'act', a: kind, seat, target });
    return;
  }
  apply(seat, kind, target);
}

function apply(seat, kind, target) {
  try {
    if (kind === 'hit') E.hit(app.state, seat);
    else if (kind === 'stay') E.stay(app.state, seat);
    else if (kind === 'choose') E.chooseTarget(app.state, seat, target);
    else if (kind === 'next') E.nextRound(app.state);
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
      return null;
    }
    throw err;
  }
  publish();
  render();
  return true;
}

function publish() {
  if (app.mode === 'host') app.net.broadcast({ t: 'state', state: E.publicState(app.state) });
}

/* --------------------------------------------------------------- render */

function render() {
  const s = app.state;
  if (!s) return;

  renderSheets(); // ook in de lobby: sluit een eindstand die nog openstaat

  if (s.phase === 'lobby') {
    renderLobby();
    if (!isVisible('screen-lobby')) show('screen-lobby');
    return;
  }

  if (!isVisible('screen-game')) {
    show('screen-game');
    keepAwake(true);
  }

  if (app.seenRound !== s.round) {
    app.seenRound = s.round;
    app.handSizes.clear();
  }

  $('hud-net').hidden = app.mode === 'local';
  $('hud-round').textContent = s.round;
  $('hud-target').textContent = s.target;
  $('hud-deck').textContent = s.deckLeft ?? s.deck.length;

  renderTable();
  renderFeed();
  renderActionBar();
  playReel();
}

function renderTable() {
  const s = app.state;
  const table = $('table');
  const a = E.actor(s);
  const me = mySeat();
  table.replaceChildren(
    ...s.players.map((p, i) => {
      const seat = document.createElement('div');
      seat.className = 'seat';
      if (a && a.seat === i) seat.classList.add('active');
      if (i === me) seat.classList.add('me');
      if (p.status !== 'active') seat.classList.add('done');
      if (p.status === 'busted') seat.classList.add('busted');
      if (!p.connected) seat.classList.add('offline');

      const head = document.createElement('div');
      head.className = 'seat-head';
      head.innerHTML = `
        <span class="avatar">${escape(initials(p.name))}</span>
        <span class="seat-name">${escape(p.name)}${i === me ? ' <span class="you">(jij)</span>' : ''}</span>
        ${statusBadge(p)}
        ${p.sc ? '<span class="badge sc">2e kans</span>' : ''}
        <span class="seat-score">
          <span class="now">${E.score(p)}</span>
          <span class="tot">totaal ${p.total}</span>
        </span>`;

      const hand = document.createElement('div');
      hand.className = 'hand';
      const grow = (app.handSizes.get(p.id) ?? 0);
      const cards = [
        ...p.numbers.map((v) => ({ k: 'n', v })),
        ...p.plus.map((v) => ({ k: 'm', v })),
        ...(p.x2 ? [{ k: 'm', op: 'x2' }] : []),
      ];
      cards.forEach((c, idx) => hand.append(cardEl(c, idx >= grow)));
      if (p.status === 'busted' && p.bust !== null) {
        hand.append(cardEl({ k: 'n', v: p.bust }, cards.length >= grow, 'dup'));
      }
      app.handSizes.set(p.id, cards.length);

      seat.append(head, hand);
      return seat;
    }),
  );
}

function statusBadge(p) {
  const map = {
    stayed: ['stayed', 'Gestopt'],
    frozen: ['frozen', 'Bevroren'],
    busted: ['busted', 'Kapot'],
    flip7: ['flip7', 'Flip 7!'],
  };
  const hit = map[p.status];
  if (!hit) return p.connected ? '' : '<span class="badge">offline</span>';
  return `<span class="badge ${hit[0]}">${hit[1]}</span>`;
}

function cardEl(card, isNew, extra) {
  const d = document.createElement('span');
  d.className = 'card' + (card.k === 'm' ? ' mod' : card.k === 'a' ? ' act' : '');
  if (extra) d.classList.add(extra);
  if (isNew) d.classList.add('new');
  if (card.k === 'n') d.style.setProperty('--h', String((card.v * 27) % 360));
  d.textContent = E.cardLabel(card);
  return d;
}

function renderFeed() {
  const items = app.state.log.slice(-6).reverse();
  $('feed').replaceChildren(
    ...items.map((l) => {
      const li = document.createElement('li');
      li.textContent = l.text;
      return li;
    }),
  );
}

function renderActionBar() {
  const s = app.state;
  const bar = $('actionbar');
  const inner = document.createElement('div');
  inner.className = 'inner';

  if (s.phase !== 'round') {
    bar.replaceChildren();
    return;
  }

  const a = E.actor(s);
  const p = s.players[a.seat];
  const mine = canControl(a.seat);
  const overriding = mine && a.seat !== mySeat() && app.mode !== 'local';

  const prompt = document.createElement('p');
  prompt.className = 'prompt';

  if (!mine) {
    prompt.innerHTML =
      a.kind === 'turn'
        ? `Wachten op <b>${escape(p.name)}</b>…`
        : `<b>${escape(p.name)}</b> deelt <b>${escape(actionName(a.kind))}</b> uit…`;
    inner.append(prompt);
    bar.replaceChildren(inner);
    return;
  }

  if (a.kind === 'turn') {
    prompt.innerHTML = overriding
      ? `<b>${escape(p.name)}</b> is offline - beslis voor hen`
      : app.mode === 'local'
        ? `<b>${escape(p.name)}</b> is aan de beurt`
        : 'Jouw beurt';
    const duo = document.createElement('div');
    duo.className = 'duo';
    duo.append(
      button('btn hit', `<b>Kaart trekken</b>`, () => act('hit', a.seat)),
      button('btn stay', `<b>Stoppen</b><small>${E.score(p)} punten veilig</small>`, () =>
        act('stay', a.seat),
      ),
    );
    inner.append(prompt, duo);
  } else {
    prompt.innerHTML = `${escape(actionName(a.kind))}: <b>kies een speler</b>`;
    const choices = document.createElement('div');
    choices.className = 'choices';
    for (const seat of a.targets) {
      const target = s.players[seat];
      const label = seat === a.seat ? `<b>Jezelf</b>` : `<b>${escape(target.name)}</b>`;
      choices.append(button('btn', label, () => act('choose', a.seat, seat)));
    }
    inner.append(prompt, choices);
  }
  bar.replaceChildren(inner);
}

function actionName(kind) {
  return { freeze: 'Freeze', flip3: 'Flip Three', second: 'Second Chance' }[kind] || kind;
}

/* ------------------------------------------------------ ronde-overzicht */

function renderSheets() {
  const s = app.state;
  const sheet = $('sheet-round');
  if (s.phase !== 'roundEnd' && s.phase !== 'gameOver') {
    sheet.hidden = true;
    $('round-actions').replaceChildren();
    return;
  }

  const over = s.phase === 'gameOver';
  const winners = over ? s.players.filter((p) => s.winners.includes(p.id)) : [];
  $('round-title').textContent = over
    ? winners.length > 1
      ? 'Gelijkspel!'
      : `${winners[0].name} wint!`
    : `Ronde ${s.round} afgelopen`;

  const rows = [...s.players].sort((x, y) => y.total - x.total);
  $('round-scores').replaceChildren(
    ...rows.map((p) => {
      const li = document.createElement('li');
      if (over && s.winners.includes(p.id)) li.classList.add('win');
      li.innerHTML = `
        <span class="avatar">${escape(initials(p.name))}</span>
        <span>${escape(p.name)}${p.status === 'flip7' ? ' 🎉' : ''}</span>
        <span class="delta ${p.roundScore ? '' : 'zero'}">+${p.roundScore}</span>
        <span class="total">${p.total}</span>`;
      return li;
    }),
  );

  const actions = $('round-actions');
  actions.replaceChildren();
  if (isDirector()) {
    actions.append(
      over
        ? button('btn primary', '<b>Nieuw spel</b>', () => apply(0, 'restart'))
        : button('btn primary', '<b>Volgende ronde</b>', () => apply(0, 'next')),
    );
  } else {
    const wait = document.createElement('p');
    wait.className = 'waiting';
    wait.textContent = over ? 'Wachten op een nieuw spel…' : 'Wachten tot de host verder gaat…';
    actions.append(wait);
  }
  sheet.hidden = false;
}

/* ---------------------------------------------------------- animatie */

function playReel() {
  const s = app.state;
  const reel = s.reel || [];
  if (!s.reelId || s.reelId <= app.seenReel || !reel.length) {
    app.seenReel = Math.max(app.seenReel, s.reelId || 0);
    return;
  }
  app.seenReel = s.reelId;

  const box = $('reveal');
  const queue = reel.slice(-3);
  let i = 0;
  const step = () => {
    if (i >= queue.length) {
      box.hidden = true;
      box.replaceChildren();
      return;
    }
    const { seat, card } = queue[i++];
    const big = document.createElement('div');
    big.className = 'big' + (card.k === 'm' ? ' mod' : card.k === 'a' ? ' act' : '');
    if (card.k === 'n') big.style.setProperty('--h', String((card.v * 27) % 360));
    big.textContent = E.cardLabel(card);
    const who = document.createElement('div');
    who.className = 'who';
    who.textContent = s.players[seat]?.name || '';
    box.replaceChildren(big, who);
    box.hidden = false;
    setTimeout(step, queue.length > 1 ? 480 : 620);
  };
  step();
}

/* ----------------------------------------------------------- wachtkamer */

function renderLobby() {
  const s = app.state;
  const list = $('lobby-players');
  list.replaceChildren(
    ...s.players.map((p) => {
      const li = document.createElement('li');
      if (!p.connected) li.classList.add('offline');
      li.innerHTML = `
        <span class="avatar">${escape(initials(p.name))}</span>
        <span>${escape(p.name)}${p.id === app.myId ? ' <span class="you">(jij)</span>' : ''}</span>
        <span class="tag">${p.connected ? (p.id === app.myId && app.mode === 'host' ? 'host' : 'klaar') : 'offline'}</span>`;
      if (app.mode === 'local' && s.players.length > 1) {
        li.append(
          button('btn small', '×', () => {
            E.removePlayer(s, p.id);
            render();
          }),
        );
      }
      list.append(li);
      return li;
    }),
  );
  $('lobby-count').textContent = `${s.players.length}/${E.MAX_PLAYERS}`;

  $('lobby-host-only').hidden = !isDirector();
  $('local-add').hidden = app.mode !== 'local';
  $('code-card').hidden = app.mode === 'local';
  const start = $('btn-start');
  start.disabled = s.players.length < 2;
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
    app.state = E.newGame({ target: 200 });
    app.myId = myToken();
    E.addPlayer(app.state, app.myId, name);
    app.mode = 'host';
    app.net = await startHost({ onJoin: hostJoin, onMessage: hostMessage, onLeave: hostLeave, onStatus: netStatus });
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
    conn.send({ t: 'denied', reason: 'Het spel is al begonnen.' });
    return;
  }
  if (!known && s.players.length >= E.MAX_PLAYERS) {
    conn.send({ t: 'denied', reason: 'De tafel is vol.' });
    return;
  }
  try {
    E.addPlayer(s, token, name);
  } catch (err) {
    conn.send({ t: 'denied', reason: err.message });
    return;
  }
  conn.send({ t: 'welcome', you: token, state: E.publicState(s) });
  publish();
  toast(`${name} doet mee`);
  render();
}

function hostMessage(token, msg) {
  if (msg.t !== 'act') return;
  const s = app.state;
  const seat = s.players.findIndex((p) => p.id === token);
  if (seat < 0) return;
  if (msg.a === 'next' || msg.a === 'restart') return; // alleen de host bepaalt dat
  const a = E.actor(s);
  if (!a || a.seat !== seat) {
    app.net.send(token, { t: 'err', msg: 'Je bent niet aan de beurt.' });
    return;
  }
  try {
    if (msg.a === 'hit') E.hit(s, seat);
    else if (msg.a === 'stay') E.stay(s, seat);
    else if (msg.a === 'choose') E.chooseTarget(s, seat, msg.target);
    else return;
  } catch (err) {
    if (!(err instanceof E.GameError)) throw err;
    app.net.send(token, { t: 'err', msg: err.message });
    return;
  }
  publish();
  render();
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
    $('room-code').textContent = app.net.code;
    app.seenReel = app.state.reelId || 0; // niet de geschiedenis naspelen
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
  app.state = E.newGame({ target: 200 });
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
  app.handSizes.clear();
  keepAwake(false);
  history.replaceState(null, '', location.pathname);
  show('screen-home');
}

function bind() {
  $('name-input').value = rememberedName();

  $('btn-host').addEventListener('click', beHost);
  $('btn-local').addEventListener('click', beLocal);
  $('btn-join').addEventListener('click', () => {
    if (!rememberName($('name-input').value.trim().slice(0, 16))) return toast('Vul eerst je naam in.');
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
    app.state.target = Number($('target-select').value) || 200;
    try {
      E.startRound(app.state);
    } catch (err) {
      return toast(err.message);
    }
    app.seenReel = app.state.reelId || 0;
    app.handSizes.clear();
    publish();
    render();
  });

  $('btn-copy').addEventListener('click', () => copyCode(app.net.code));
  $('btn-share').addEventListener('click', () => shareInvite(app.net.code, 'Flip 7'));

  document.querySelectorAll('[data-open-rules]').forEach((b) =>
    b.addEventListener('click', () => ($('sheet-rules').hidden = false)),
  );
  document.querySelectorAll('[data-close-sheet]').forEach((b) =>
    b.addEventListener('click', () => ($('sheet-rules').hidden = true)),
  );
  document.querySelectorAll('[data-goto]').forEach((b) =>
    b.addEventListener('click', () => show(b.dataset.goto)),
  );
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
      // Naam is al bekend: direct door naar verbinden.
      show('screen-join');
      setJoinHint('Klaar om mee te doen aan kamer ' + room + '.');
    } else {
      // Uitgenodigd via een link: maak duidelijk wat de volgende stap is.
      document.querySelector('.tagline').textContent =
        `Je bent uitgenodigd voor kamer ${room}. Vul je naam in en tik op "Meedoen met een code".`;
      $('btn-join').classList.add('primary');
      $('btn-host').classList.remove('primary');
      $('name-input').focus();
    }
  }
}

bind();
