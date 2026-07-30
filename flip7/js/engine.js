/*
 * Flip 7 - regels-engine.
 * Puur: geen DOM, geen netwerk. De host houdt de enige echte state bij en
 * stuurt die naar de andere telefoons.
 *
 * Kaarten:
 *   { k:'n', v:0..12 }              nummerkaart
 *   { k:'m', v:2|4|6|8|10 }         plus-modifier
 *   { k:'m', op:'x2' }              verdubbelaar
 *   { k:'a', a:'freeze'|'flip3'|'second' }   actiekaart
 */

export const MAX_UNIQUE = 7;
export const FLIP7_BONUS = 15;
export const DEFAULT_TARGET = 200;
export const MAX_PLAYERS = 12;

export class GameError extends Error {}

/* ---------------------------------------------------------------- kaarten */

export function createDeck() {
  const deck = [];
  deck.push({ k: 'n', v: 0 });
  for (let v = 1; v <= 12; v++) {
    for (let i = 0; i < v; i++) deck.push({ k: 'n', v });
  }
  for (const v of [2, 4, 6, 8, 10]) deck.push({ k: 'm', v });
  deck.push({ k: 'm', op: 'x2' });
  for (const a of ['freeze', 'flip3', 'second']) {
    for (let i = 0; i < 3; i++) deck.push({ k: 'a', a });
  }
  return deck;
}

export function shuffle(list, rnd = Math.random) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = list[i];
    list[i] = list[j];
    list[j] = t;
  }
  return list;
}

export function cardLabel(card) {
  if (!card) return '?';
  if (card.k === 'n') return String(card.v);
  if (card.k === 'm') return card.op === 'x2' ? '×2' : '+' + card.v;
  return { freeze: 'Freeze', flip3: 'Flip Three', second: 'Second Chance' }[card.a];
}

/* ------------------------------------------------------------------ state */

export function newGame(opts = {}) {
  return {
    v: 1,
    phase: 'lobby', // lobby | round | roundEnd | gameOver
    target: opts.target ?? DEFAULT_TARGET,
    round: 0,
    starter: 0,
    turn: 0,
    seq: 0,
    players: [],
    deck: [],
    discard: [],
    pending: [], // takenlijst; pending[0] is aan de beurt
    resolving: false,
    log: [],
    reel: [], // kaarten die door de laatste zet zijn omgedraaid (voor de animatie)
    reelId: 0,
    lastRound: null,
    lastFlip: null,
    flip7By: null,
    winners: null,
  };
}

function newPlayer(id, name) {
  return {
    id,
    name,
    connected: true,
    total: 0,
    numbers: [],
    plus: [],
    x2: false,
    sc: false, // heeft Second Chance
    status: 'active', // active | stayed | frozen | busted | flip7
    bust: null,
    roundScore: 0,
  };
}

export function addPlayer(s, id, name) {
  const existing = s.players.findIndex((p) => p.id === id);
  if (existing >= 0) {
    s.players[existing].name = name;
    s.players[existing].connected = true;
    return existing;
  }
  if (s.phase !== 'lobby') throw new GameError('Het spel is al begonnen.');
  if (s.players.length >= MAX_PLAYERS) throw new GameError(`Maximaal ${MAX_PLAYERS} spelers.`);
  s.players.push(newPlayer(id, name));
  return s.players.length - 1;
}

export function removePlayer(s, id) {
  const i = s.players.findIndex((p) => p.id === id);
  if (i < 0) return;
  if (s.phase === 'lobby') {
    s.players.splice(i, 1);
  } else {
    s.players[i].connected = false;
  }
}

export function seatOf(s, id) {
  const i = s.players.findIndex((p) => p.id === id);
  if (i < 0) throw new GameError('Onbekende speler.');
  return i;
}

function log(s, text) {
  s.log.push({ i: ++s.seq, text });
  if (s.log.length > 60) s.log.splice(0, s.log.length - 60);
}

/** State zonder geheime informatie (de deck-inhoud), om te versturen. */
export function publicState(s) {
  const { deck, discard, ...rest } = s;
  return { ...rest, deckLeft: deck.length, discardLeft: discard.length };
}

/* ------------------------------------------------------------------ ronde */

export function startRound(s, rnd = Math.random) {
  if (s.phase === 'gameOver') throw new GameError('Het spel is voorbij.');
  if (s.players.length < 2) throw new GameError('Je hebt minstens 2 spelers nodig.');

  // Alleen bij de start van het spel een nieuw deck; daarna wordt de
  // aflegstapel hergebruikt (draw() schudt opnieuw zodra het deck leeg is).
  if (s.round === 0) {
    s.deck = shuffle(createDeck(), rnd);
    s.discard = [];
  }

  for (const p of s.players) {
    for (const v of p.numbers) s.discard.push({ k: 'n', v });
    for (const v of p.plus) s.discard.push({ k: 'm', v });
    if (p.x2) s.discard.push({ k: 'm', op: 'x2' });
    if (p.sc) s.discard.push({ k: 'a', a: 'second' });
    p.numbers = [];
    p.plus = [];
    p.x2 = false;
    p.sc = false;
    p.status = 'active';
    p.bust = null;
    p.roundScore = 0;
  }

  s.round++;
  s.phase = 'round';
  s.pending = [];
  s.resolving = false;
  s.lastRound = null;
  s.lastFlip = null;
  s.flip7By = null;
  s.reel = [];
  s.reelId = ++s.seq;
  s.log = [];
  s.turn = s.starter % s.players.length;
  log(s, `Ronde ${s.round} begint. ${s.players[s.turn].name} mag beginnen.`);
  return s;
}

function draw(s, rnd) {
  if (!s.deck.length) {
    if (!s.discard.length) return null;
    s.deck = shuffle(s.discard.splice(0), rnd);
    log(s, 'De aflegstapel is opnieuw geschud.');
  }
  return s.deck.pop();
}

export function score(p) {
  if (p.status === 'busted') return 0;
  const num = p.numbers.reduce((a, b) => a + b, 0);
  let total = p.x2 ? num * 2 : num;
  total += p.plus.reduce((a, b) => a + b, 0);
  if (p.status === 'flip7') total += FLIP7_BONUS;
  return total;
}

/* ------------------------------------------------------------- beurtlogica */

/** Wie moet nu iets doen, en wat? */
export function actor(s) {
  if (s.phase !== 'round') return null;
  const t = s.pending[0];
  if (t) {
    if (t.t === 'choose') {
      return { seat: t.seat, kind: t.card.a, targets: eligible(s, t) };
    }
    return { seat: t.seat, kind: 'flipping', left: t.left };
  }
  return { seat: s.turn, kind: 'turn' };
}

function eligible(s, task) {
  const out = [];
  s.players.forEach((p, i) => {
    if (p.status !== 'active') return;
    if (task.card.a === 'second' && (p.sc || i === task.seat)) return;
    out.push(i);
  });
  return out;
}

function flipOne(s, batch, rnd) {
  const p = s.players[batch.seat];
  const card = draw(s, rnd);
  batch.left--;
  if (!card) {
    log(s, 'Geen kaarten meer.');
    return;
  }
  s.lastFlip = { i: ++s.seq, seat: batch.seat, card };
  s.reel.push({ seat: batch.seat, card });

  if (card.k === 'n') {
    if (p.numbers.includes(card.v)) {
      if (p.sc) {
        p.sc = false;
        s.discard.push(card, { k: 'a', a: 'second' });
        log(s, `${p.name} trekt nog een ${card.v} maar gebruikt Second Chance.`);
      } else {
        p.status = 'busted';
        p.bust = card.v;
        batch.left = 0;
        // De kaarten blijven liggen (zichtbaar) tot de volgende ronde begint;
        // startRound() gooit alles op de aflegstapel.
        s.discard.push(card);
        log(s, `${p.name} trekt een tweede ${card.v} en gaat kapot! 0 punten.`);
      }
    } else {
      p.numbers.push(card.v);
      p.numbers.sort((a, b) => a - b);
      log(s, `${p.name} trekt een ${card.v}.`);
      if (p.numbers.length === MAX_UNIQUE) {
        p.status = 'flip7';
        s.flip7By = p.id;
        batch.left = 0;
        log(s, `FLIP 7! ${p.name} heeft 7 verschillende kaarten (+${FLIP7_BONUS}).`);
        endRound(s);
      }
    }
    return;
  }

  if (card.k === 'm') {
    if (card.op === 'x2') p.x2 = true;
    else p.plus.push(card.v);
    log(s, `${p.name} trekt ${cardLabel(card)}.`);
    return;
  }

  // actiekaart
  if (card.a === 'second') {
    if (!p.sc) {
      p.sc = true;
      log(s, `${p.name} trekt Second Chance en houdt die.`);
    } else {
      const task = { t: 'choose', seat: batch.seat, card };
      if (eligible(s, task).length) {
        s.pending.unshift(task); // moet direct doorgegeven worden
        log(s, `${p.name} heeft al een Second Chance en moet deze weggeven.`);
      } else {
        s.discard.push(card);
        log(s, `${p.name} trekt Second Chance, maar niemand kan hem krijgen: afgelegd.`);
      }
    }
    return;
  }

  // Freeze / Flip Three: wordt afgehandeld nadat de huidige serie klaar is
  batch.queued.push(card);
  log(s, `${p.name} trekt ${cardLabel(card)}.`);
}

function drive(s, rnd) {
  let guard = 0;
  while (s.phase === 'round' && s.pending.length && guard++ < 1000) {
    const t = s.pending[0];

    if (t.t === 'batch') {
      if (t.left > 0) {
        flipOne(s, t, rnd);
        continue;
      }
      s.pending.shift();
      if (t.queued.length) {
        s.pending.unshift(...t.queued.map((card) => ({ t: 'choose', seat: t.seat, card })));
      }
      continue;
    }

    // 'choose': wachten op een keuze, tenzij er geen doelen (meer) zijn
    if (!eligible(s, t).length) {
      s.pending.shift();
      s.discard.push(t.card);
      log(s, `${cardLabel(t.card)} kan niemand raken en wordt afgelegd.`);
      continue;
    }
    return; // input nodig
  }
  settle(s);
}

function settle(s) {
  if (s.phase !== 'round' || s.pending.length) return;
  if (!s.players.some((p) => p.status === 'active')) {
    endRound(s);
    return;
  }
  if (!s.resolving) return;
  s.resolving = false;
  const n = s.players.length;
  for (let i = 1; i <= n; i++) {
    const seat = (s.turn + i) % n;
    if (s.players[seat].status === 'active') {
      s.turn = seat;
      return;
    }
  }
  endRound(s);
}

function endRound(s) {
  s.pending.length = 0;
  s.resolving = false;
  s.phase = 'roundEnd';
  for (const p of s.players) {
    p.roundScore = score(p);
    p.total += p.roundScore;
  }
  s.lastRound = s.players.map((p) => ({
    id: p.id,
    name: p.name,
    status: p.status,
    roundScore: p.roundScore,
    total: p.total,
  }));
  const best = Math.max(...s.players.map((p) => p.total));
  if (best >= s.target) {
    s.phase = 'gameOver';
    s.winners = s.players.filter((p) => p.total === best).map((p) => p.id);
  }
  s.starter = (s.starter + 1) % s.players.length;
}

/* ------------------------------------------------------------------ acties */

/** Elke zet begint met een schone animatie-reel. */
function beginMove(s) {
  s.reel = [];
  s.reelId = ++s.seq;
}

function requireTurn(s, seat) {
  if (s.phase !== 'round') throw new GameError('Niet aan de beurt.');
  const a = actor(s);
  if (!a || a.seat !== seat) throw new GameError('Niet aan de beurt.');
  return a;
}

export function hit(s, seat, rnd = Math.random) {
  const a = requireTurn(s, seat);
  if (a.kind !== 'turn') throw new GameError('Je moet eerst een keuze maken.');
  beginMove(s);
  s.resolving = true;
  s.pending.push({ t: 'batch', seat, left: 1, queued: [] });
  drive(s, rnd);
  return s;
}

export function stay(s, seat, rnd = Math.random) {
  const a = requireTurn(s, seat);
  if (a.kind !== 'turn') throw new GameError('Je moet eerst een keuze maken.');
  beginMove(s);
  const p = s.players[seat];
  p.status = 'stayed';
  log(s, `${p.name} stopt met ${score(p)} punten.`);
  s.resolving = true;
  drive(s, rnd);
  return s;
}

export function chooseTarget(s, seat, targetSeat, rnd = Math.random) {
  const a = requireTurn(s, seat);
  if (a.kind === 'turn' || a.kind === 'flipping') throw new GameError('Er is niets te kiezen.');
  if (!a.targets.includes(targetSeat)) throw new GameError('Die speler mag je niet kiezen.');

  beginMove(s);
  const task = s.pending.shift();
  const from = s.players[seat];
  const to = s.players[targetSeat];
  const self = seat === targetSeat ? 'zichzelf' : to.name;

  if (task.card.a === 'freeze') {
    s.discard.push(task.card);
    to.status = 'frozen';
    log(s, `${from.name} bevriest ${self} (${score(to)} punten veilig).`);
  } else if (task.card.a === 'flip3') {
    s.discard.push(task.card);
    log(s, `${from.name} laat ${self} 3 kaarten trekken.`);
    s.pending.unshift({ t: 'batch', seat: targetSeat, left: 3, queued: [] });
  } else {
    // Second Chance verhuist naar een andere speler i.p.v. de aflegstapel
    to.sc = true;
    log(s, `${from.name} geeft Second Chance aan ${to.name}.`);
  }

  drive(s, rnd);
  return s;
}

export function nextRound(s, rnd = Math.random) {
  if (s.phase !== 'roundEnd') throw new GameError('De ronde is nog niet klaar.');
  return startRound(s, rnd);
}

export function resetGame(s) {
  s.phase = 'lobby';
  s.round = 0;
  s.starter = 0;
  s.turn = 0;
  s.deck = [];
  s.discard = [];
  s.pending = [];
  s.resolving = false;
  s.log = [];
  s.lastRound = null;
  s.lastFlip = null;
  s.flip7By = null;
  s.reel = [];
  s.reelId = 0;
  s.winners = null;
  for (const p of s.players) {
    p.total = 0;
    p.numbers = [];
    p.plus = [];
    p.x2 = false;
    p.sc = false;
    p.status = 'active';
    p.bust = null;
    p.roundScore = 0;
  }
  return s;
}
