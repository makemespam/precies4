/*
 * Wartaal - schermen, invoer en synchronisatie.
 *
 * Anders dan bij de andere spellen ziet elke telefoon iets ánders: de echte
 * betekenis blijft bij de kiezer en tijdens het stemmen weet je niet van wie
 * een omschrijving is. De host stuurt daarom per speler een eigen kijkje op
 * de stand in plaats van één versie naar iedereen.
 */
import * as E from './engine.js';
import { WOORDEN } from './woorden.js';
import { startHost, joinRoom, randomCode } from '../../shared/js/net.js';
import {
  $, show, isVisible, toast, escape, initials, button,
  myToken, rememberedName, rememberName, keepAwake, shareInvite, copyCode,
} from '../../shared/js/ui.js';

const app = {
  mode: null, // host | guest | local
  net: null,
  state: null, // host/local: de volledige stand. guest: het eigen kijkje.
  myId: null,
  localSeat: 0, // wie heeft de telefoon vast (alleen bij 'op één telefoon')
  stageKey: null,
  draft: '',
};

/* ------------------------------------------------------------- helpers */

function mySeat() {
  if (app.mode === 'local') return app.localSeat;
  if (!app.state || !app.myId) return -1;
  const list = app.state.players || [];
  return list.findIndex((p) => p.id === app.myId);
}

/** Het kijkje op de stand voor wie er nu naar de telefoon kijkt. */
function currentView() {
  if (!app.state) return null;
  if (app.mode === 'guest') return app.state;
  return E.viewFor(app.state, Math.max(0, mySeat()));
}

const isDirector = () => app.mode === 'host' || app.mode === 'local';

/** Welke speler moet er nu iets privés doen? (voor het doorgeven bij 1 telefoon) */
function neededSeat(s) {
  if (s.phase === 'kiezen') return s.chooser;
  if (s.phase === 'schrijven' || s.phase === 'stemmen') {
    const a = E.actor(s);
    return a && a.wachtOp.length ? a.wachtOp[0] : null;
  }
  return null;
}

/* -------------------------------------------------------------- zetten */

function act(kind, arg) {
  if (app.mode === 'guest') {
    app.net.send({ t: 'act', a: kind, arg });
    return;
  }
  apply(mySeat(), kind, arg);
}

function apply(seat, kind, arg) {
  try {
    if (kind === 'kies') E.kies(app.state, seat, arg);
    else if (kind === 'schrijf') E.schrijf(app.state, seat, arg);
    else if (kind === 'stem') E.stem(app.state, seat, arg);
    else if (kind === 'volgende') E.volgende(app.state);
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
      return false;
    }
    throw err;
  }
  publish();
  render();
  return true;
}

/** Iedere gast krijgt zijn eigen kijkje op de stand. */
function publish() {
  if (app.mode !== 'host') return;
  app.state.players.forEach((p, i) => {
    if (p.id === app.myId) return;
    app.net.send(p.id, { t: 'state', state: E.viewFor(app.state, i) });
  });
}

/* -------------------------------------------------------------- render */

function render() {
  const view = currentView();
  if (!view) return;

  renderEndSheet(view);

  if (view.phase === 'lobby') {
    renderLobby(view);
    if (!isVisible('screen-lobby')) show('screen-lobby');
    return;
  }

  // Bij één telefoon: eerst doorgeven aan wie er aan de beurt is.
  if (app.mode === 'local') {
    const needed = neededSeat(app.state);
    if (needed !== null && needed !== app.localSeat) {
      showHandoff(needed);
      return;
    }
  }

  if (!isVisible('screen-game')) {
    show('screen-game');
    keepAwake(true);
  }

  $('hud-net').hidden = app.mode === 'local';
  $('hud-ronde').textContent = view.ronde;
  $('hud-rondes').textContent = view.rondes;
  $('hud-pool').textContent = `${view.poolLeft} woorden over`;

  renderStage(view);
  renderTable(view);
  renderActionBar(view);
}

/* ---------------------------------------------------------- doorgeven */

function showHandoff(seat) {
  const p = app.state.players[seat];
  const wat = {
    kiezen: 'kiest een woord',
    schrijven: 'schrijft een omschrijving',
    stemmen: 'moet stemmen',
  }[app.state.phase];
  $('handoff-name').textContent = p.name;
  $('handoff-what').textContent = wat;
  $('btn-handoff').onclick = () => {
    app.localSeat = seat;
    app.stageKey = null;
    app.draft = '';
    render();
  };
  show('screen-handoff');
}

/* ------------------------------------------------------------- stage */

/** Wanneer moet het middenstuk opnieuw gebouwd worden? Niet bij elke update,
 *  anders raak je kwijt wat je aan het typen bent. */
function stageKey(view) {
  const ik = view.ik;
  const ingeleverd = view.phase === 'schrijven' && (view.mijn !== null && view.mijn !== undefined);
  const gestemd = view.phase === 'stemmen' && view.votes[ik] !== undefined;
  return [view.phase, view.ronde, ik, ingeleverd, gestemd].join('|');
}

function renderStage(view) {
  const key = stageKey(view);
  if (key !== app.stageKey) {
    app.stageKey = key;
    buildStage(view);
  }
  updateWachten(view);
}

function buildStage(view) {
  const stage = $('stage');
  stage.replaceChildren();
  const ik = view.ik;

  if (view.phase === 'kiezen') {
    const kiezer = view.players[view.chooser];
    if (ik === view.chooser) {
      stage.append(kop('Kies een woord', 'Je ziet de betekenis pas ná je keuze.'));
      const grid = document.createElement('div');
      grid.className = 'woordgrid';
      view.hand.forEach((w, i) => {
        grid.append(
          button('woordknop', escape(w), () => act('kies', i)),
        );
      });
      stage.append(grid);
    } else {
      stage.append(kop(`${kiezer.name} kiest een woord`, 'Even geduld.'));
    }
    return;
  }

  if (view.phase === 'schrijven') {
    stage.append(woordKop(view));
    if (view.mijn) {
      stage.append(mijnInzending(view.mijn));
      return;
    }
    if (ik === view.chooser) {
      stage.append(schrijfKiezer(view));
    } else {
      stage.append(schrijfVerzinner(view));
    }
    return;
  }

  if (view.phase === 'stemmen') {
    stage.append(woordKop(view));
    if (ik === view.chooser) {
      stage.append(kop('Jij weet het antwoord', 'De rest zoekt jouw omschrijving.'));
      return;
    }
    if (view.votes[ik] !== undefined) {
      stage.append(kop('Je hebt gestemd', 'Wachten op de rest.'));
      return;
    }
    stage.append(kop('Welke is de echte?', 'Op je eigen omschrijving stemmen mag niet.'));
    const lijst = document.createElement('div');
    lijst.className = 'inzendingen';
    for (const e of view.entries) {
      const el = document.createElement(e.mijn ? 'div' : 'button');
      el.className = 'inzending' + (e.mijn ? ' mijn' : ' kiesbaar');
      el.innerHTML = `<span class="tekst">${escape(e.tekst)}</span>${
        e.mijn ? '<span class="merk">van jou</span>' : ''
      }`;
      if (!e.mijn) el.addEventListener('click', () => act('stem', e.id));
      lijst.append(el);
    }
    stage.append(lijst);
    return;
  }

  if (view.phase === 'uitslag' || view.phase === 'gameOver') {
    stage.append(woordKop(view));
    const echt = document.createElement('p');
    echt.className = 'echte';
    echt.innerHTML = `<span class="label">In het boek</span>${escape(view.woord?.b ?? '')}`;
    stage.append(echt);

    const lijst = document.createElement('div');
    lijst.className = 'inzendingen';
    for (const r of view.uitslag.regels) {
      const el = document.createElement('div');
      el.className = 'inzending uitslag' + (r.echt ? ' echt' : '');
      const stemmers = r.door.map((seat) => view.players[seat].name).join(', ');
      el.innerHTML = `
        <span class="tekst">${escape(r.tekst)}</span>
        <span class="regel-onder">
          <span class="auteur">${r.echt ? 'de echte' : escape(view.players[r.seat].name)}</span>
          ${r.stemmen ? `<span class="stemmen">${escape(stemmers)}</span>` : '<span class="stemmen leeg">geen stemmen</span>'}
        </span>`;
      lijst.append(el);
    }
    stage.append(lijst);
  }
}

function kop(titel, onder) {
  const d = document.createElement('div');
  d.className = 'stagekop';
  d.innerHTML = `<h3>${escape(titel)}</h3>${onder ? `<p class="hint">${escape(onder)}</p>` : ''}`;
  return d;
}

function woordKop(view) {
  const d = document.createElement('div');
  d.className = 'woordkop';
  d.innerHTML = `<span class="label">Het woord</span><strong>${escape(view.woord?.w ?? '')}</strong>`;
  return d;
}

function mijnInzending(tekst) {
  const d = document.createElement('div');
  d.className = 'stagekop';
  d.innerHTML = `<h3>Ingeleverd</h3><p class="eigen">${escape(tekst)}</p>`;
  return d;
}

function schrijfVerzinner(view) {
  const wrap = document.createElement('div');
  wrap.append(
    kop('Verzin een betekenis', 'Hoe geloofwaardiger, hoe meer mensen erin trappen.'),
  );
  wrap.append(tekstveld(view, null));
  return wrap;
}

function schrijfKiezer(view) {
  const wrap = document.createElement('div');
  wrap.append(
    kop('Schrijf de echte betekenis over', 'Inkorten mag. Alleen woorden uit het boek, plus lidwoorden en voorzetsels.'),
  );
  const boek = document.createElement('p');
  boek.className = 'echte';
  boek.innerHTML = `<span class="label">In het boek</span>${escape(view.woord.b)}`;
  wrap.append(boek);
  wrap.append(tekstveld(view, view.woord.b));
  return wrap;
}

function tekstveld(view, betekenis) {
  const wrap = document.createElement('div');
  const ta = document.createElement('textarea');
  ta.id = 'schrijfveld';
  ta.maxLength = E.MAX_TEKST;
  ta.rows = 3;
  ta.placeholder = betekenis ? 'de echte betekenis, ingekort…' : 'een geloofwaardige betekenis…';
  ta.value = app.draft;
  const melding = document.createElement('p');
  melding.className = 'hint';
  melding.id = 'schrijfmelding';

  const check = () => {
    app.draft = ta.value;
    const rest = E.MAX_TEKST - ta.value.length;
    if (betekenis) {
      const fout = E.verbodenWoorden(ta.value, betekenis);
      melding.classList.toggle('error', fout.length > 0);
      melding.textContent = fout.length
        ? `Niet toegestaan: ${fout.join(', ')}`
        : `Alleen woorden uit het boek. Nog ${rest} tekens.`;
    } else {
      melding.classList.remove('error');
      melding.textContent = `Nog ${rest} tekens.`;
    }
    const knop = document.querySelector('#actionbar .btn.primary');
    if (knop) knop.disabled = !kanInleveren(betekenis, ta.value);
  };
  ta.addEventListener('input', check);
  wrap.append(ta, melding);
  setTimeout(check, 0);
  return wrap;
}

function kanInleveren(betekenis, tekst) {
  if (tekst.trim().length < 3) return false;
  if (betekenis && E.verbodenWoorden(tekst, betekenis).length) return false;
  return true;
}

/** De regel "3 van 5 klaar" wordt los bijgewerkt, zodat je typwerk blijft staan. */
function updateWachten(view) {
  let el = $('wachten');
  if (!el) {
    el = document.createElement('p');
    el.id = 'wachten';
    el.className = 'wachten';
    $('stage').append(el);
  }
  if (view.phase === 'schrijven') {
    const klaar = view.entries.length;
    const totaal = view.players.filter((p) => p.connected).length;
    const namen = view.players
      .filter((p, i) => p.connected && !view.entries.some((e) => e.seat === i))
      .map((p) => p.name);
    el.textContent = `${klaar} van ${totaal} klaar${namen.length ? ' — wachten op ' + namen.join(', ') : ''}`;
    el.hidden = false;
  } else if (view.phase === 'stemmen') {
    const namen = view.players
      .filter((p, i) => p.connected && i !== view.chooser && view.votes[i] === undefined)
      .map((p) => p.name);
    el.textContent = namen.length ? 'Wachten op ' + namen.join(', ') : 'Iedereen heeft gestemd.';
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

/* -------------------------------------------------------------- tafel */

function renderTable(view) {
  const ik = view.ik;
  $('table').replaceChildren(
    ...view.players.map((p, i) => {
      const seat = document.createElement('div');
      seat.className = 'seat';
      if (i === view.chooser) seat.classList.add('kiezer');
      if (i === ik) seat.classList.add('me');
      if (!p.connected) seat.classList.add('offline');
      const klaar =
        view.phase === 'schrijven'
          ? view.entries.some((e) => e.seat === i)
          : view.phase === 'stemmen'
            ? i === view.chooser || view.votes[i] !== undefined
            : false;
      seat.innerHTML = `
        <span class="avatar">${escape(initials(p.name))}</span>
        <span class="seat-name">${escape(p.name)}${i === ik ? ' <span class="you">(jij)</span>' : ''}</span>
        ${i === view.chooser ? '<span class="badge kiezer">kiezer</span>' : ''}
        ${klaar ? '<span class="badge klaar">klaar</span>' : ''}
        <span class="punten">${p.score}</span>`;
      return seat;
    }),
  );
}

/* ---------------------------------------------------------- actionbar */

function renderActionBar(view) {
  const bar = $('actionbar');
  bar.replaceChildren();
  const inner = document.createElement('div');
  inner.className = 'inner';

  if (view.phase === 'schrijven' && !view.mijn) {
    const betekenis = view.ik === view.chooser ? view.woord.b : null;
    const knop = button('btn primary', '<b>Inleveren</b>', () => {
      const ta = $('schrijfveld');
      if (!ta) return;
      if (act('schrijf', ta.value)) app.draft = '';
    });
    knop.disabled = !kanInleveren(betekenis, app.draft);
    inner.append(knop);
  } else if (view.phase === 'uitslag') {
    if (isDirector()) {
      inner.append(button('btn primary', '<b>Volgende ronde</b>', () => act('volgende')));
    } else {
      const p = document.createElement('p');
      p.className = 'waiting';
      p.textContent = 'Wachten tot de host verder gaat…';
      inner.append(p);
    }
  } else {
    return;
  }
  bar.append(inner);
}

/* ------------------------------------------------------------ eindstand */

function renderEndSheet(view) {
  const sheet = $('sheet-end');
  if (view.phase !== 'gameOver') {
    sheet.hidden = true;
    $('end-actions').replaceChildren();
    return;
  }
  const winnaars = view.players.filter((p) => view.winners.includes(p.id));
  $('end-title').textContent = winnaars.length > 1 ? 'Gelijkspel!' : `${winnaars[0].name} wint!`;
  $('end-scores').replaceChildren(
    ...[...view.players]
      .sort((a, b) => b.score - a.score)
      .map((p) => {
        const li = document.createElement('li');
        if (view.winners.includes(p.id)) li.classList.add('win');
        li.innerHTML = `
          <span class="avatar">${escape(initials(p.name))}</span>
          <span>${escape(p.name)}</span>
          <span class="delta">${p.score}</span>`;
        return li;
      }),
  );
  const actions = $('end-actions');
  actions.replaceChildren();
  if (isDirector()) {
    actions.append(button('btn primary', '<b>Nieuw spel</b>', () => apply(0, 'restart')));
  } else {
    const p = document.createElement('p');
    p.className = 'waiting';
    p.textContent = 'Wachten op een nieuw spel…';
    actions.append(p);
  }
  sheet.hidden = false;
}

/* ---------------------------------------------------------- wachtkamer */

function renderLobby(view) {
  $('lobby-players').replaceChildren(
    ...view.players.map((p) => {
      const li = document.createElement('li');
      if (!p.connected) li.classList.add('offline');
      li.innerHTML = `
        <span class="avatar">${escape(initials(p.name))}</span>
        <span>${escape(p.name)}${p.id === app.myId ? ' <span class="you">(jij)</span>' : ''}</span>
        <span class="tag">${p.connected ? (p.id === app.myId && app.mode === 'host' ? 'host' : 'klaar') : 'offline'}</span>`;
      if (app.mode === 'local' && view.players.length > 2) {
        li.append(
          button('btn small', '×', () => {
            E.removePlayer(app.state, p.id);
            render();
          }),
        );
      }
      return li;
    }),
  );
  $('lobby-count').textContent = `${view.players.length}/${E.MAX_PLAYERS}`;
  $('lobby-host-only').hidden = !isDirector();
  $('local-add').hidden = app.mode !== 'local';
  $('code-card').hidden = app.mode === 'local';
  $('btn-start').disabled = view.players.length < 2;
  $('lobby-hint').textContent =
    view.players.length < 2
      ? app.mode === 'local'
        ? 'Voeg minstens 2 spelers toe.'
        : 'Wachten tot er nog iemand meedoet…'
      : isDirector()
        ? `Iedereen erin? Er staan ${WOORDEN.length} woorden klaar.`
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
    app.state = E.newGame({ woorden: WOORDEN });
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
  const bekend = s.players.some((p) => p.id === token);
  if (!bekend && s.phase !== 'lobby') {
    return conn.send({ t: 'denied', reason: 'Het spel is al begonnen.' });
  }
  let seat;
  try {
    seat = E.addPlayer(s, token, name);
  } catch (err) {
    return conn.send({ t: 'denied', reason: err.message });
  }
  conn.send({ t: 'welcome', you: token, state: E.viewFor(s, seat) });
  publish();
  toast(`${name} doet mee`);
  render();
}

function hostMessage(token, msg) {
  if (msg.t !== 'act') return;
  const seat = app.state.players.findIndex((p) => p.id === token);
  if (seat < 0 || msg.a === 'restart' || msg.a === 'volgende') return;
  try {
    if (msg.a === 'kies') E.kies(app.state, seat, msg.arg);
    else if (msg.a === 'schrijf') E.schrijf(app.state, seat, msg.arg);
    else if (msg.a === 'stem') E.stem(app.state, seat, msg.arg);
    else return;
  } catch (err) {
    if (!(err instanceof E.GameError)) throw err;
    app.net.send(token, { t: 'err', msg: err.message }); // de fout hoort bij de gast
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
  app.localSeat = 0;
  app.state = E.newGame({ woorden: WOORDEN });
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
  app.stageKey = null;
  app.draft = '';
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
    app.state.rondes = Number($('rondes-select').value) || 10;
    try {
      E.startGame(app.state);
    } catch (err) {
      return toast(err.message);
    }
    app.stageKey = null;
    app.localSeat = app.state.chooser;
    publish();
    render();
  });

  $('btn-copy').addEventListener('click', () => copyCode(app.net.code));
  $('btn-share').addEventListener('click', () => shareInvite(app.net.code, 'Wartaal'));

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
