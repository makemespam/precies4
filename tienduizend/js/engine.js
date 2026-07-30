/*
 * Tienduizend - regels-engine.
 * Puur: geen DOM, geen netwerk. De host houdt de enige echte stand bij.
 *
 * Beurtverloop: je gooit met de open dobbels, legt minstens één scorende
 * dobbel vast, en kiest dan tussen verder gooien of stoppen. Levert een worp
 * niets op, dan ben je poedel en verlies je alles van deze beurt. Leg je alle
 * zes vast, dan mag je met alle zes verder ("alles telt").
 */

export const DICE = 6;
export const DEFAULT_TARGET = 10000;
export const DEFAULT_ENTRY = 500;
export const MAX_PLAYERS = 12;

export class GameError extends Error {}

/** Puntenaantallen in het logboek net zo schrijven als op het scherm. */
const nf = new Intl.NumberFormat('nl-NL');
const n = (x) => nf.format(x);

/* ----------------------------------------------------------------- score */

function tally(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  return counts;
}

const isStraight = (counts) => counts.size === 6;
const isThreePairs = (counts) =>
  [...counts.values()].length <= 3 && [...counts.values()].every((n) => n % 2 === 0);

/** Punten voor n gelijke: 1 = 1000, anders waarde × 100; elke extra dobbel verdubbelt. */
function setScore(value, n) {
  return (value === 1 ? 1000 : value * 100) * 2 ** (n - 3);
}

/**
 * Wat is deze selectie waard, en mag hij? Elke gekozen dobbel moet meedoen
 * aan een combinatie - een losse 3 erbij pakken mag dus niet.
 */
export function scoreDice(values, opts = {}) {
  if (!values.length) return { score: 0, valid: false };
  const extras = opts.extras !== false;
  const counts = tally(values);
  let best = null;

  if (values.length === DICE && extras) {
    if (isStraight(counts)) best = Math.max(best ?? 0, 1500);
    if (isThreePairs(counts)) best = Math.max(best ?? 0, 750);
  }

  let sum = 0;
  let ok = true;
  for (const [v, n] of counts) {
    if (n >= 3) sum += setScore(v, n);
    else if (v === 1) sum += 100 * n;
    else if (v === 5) sum += 50 * n;
    else ok = false;
  }
  if (ok) best = Math.max(best ?? 0, sum);

  return best === null ? { score: 0, valid: false } : { score: best, valid: true };
}

/** Zit er in deze worp überhaupt iets bruikbaars, of is het poedel? */
export function hasScore(values, opts = {}) {
  const extras = opts.extras !== false;
  const counts = tally(values);
  if (values.some((v) => v === 1 || v === 5)) return true;
  if ([...counts.values()].some((n) => n >= 3)) return true;
  if (values.length === DICE && extras && (isStraight(counts) || isThreePairs(counts))) return true;
  return false;
}

/** Beschrijft een selectie in woorden, voor het logboek. */
export function describe(values, opts = {}) {
  const counts = tally(values);
  if (values.length === DICE && opts.extras !== false) {
    if (isStraight(counts)) return 'een straat';
    if (isThreePairs(counts)) return 'drie paren';
  }
  const parts = [];
  for (const [v, n] of [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])) {
    if (n >= 3) parts.push(`${n}× de ${v}`);
    else parts.push(n === 1 ? `een ${v}` : `twee ${v}-en`);
  }
  return parts.join(' en ');
}

/* ------------------------------------------------------------------ state */

export function newGame(opts = {}) {
  return {
    v: 1,
    phase: 'lobby', // lobby | turn | gameOver
    target: opts.target ?? DEFAULT_TARGET,
    entry: opts.entry ?? DEFAULT_ENTRY,
    extras: opts.extras ?? true,
    players: [],
    turn: 0,
    seq: 0,
    banked: 0, // punten die deze beurt al vastliggen
    aside: [], // vastgelegde dobbels deze beurt
    roll: [], // de open dobbels van de laatste worp
    picked: [], // welke open dobbels nu geselecteerd zijn (indexen)
    rolling: false, // is er een open worp om uit te kiezen?
    rollId: 0, // loopt op bij elke worp, voor de animatie
    poedel: null, // { seat, roll } van de laatste mislukte worp
    closingBy: null, // wie de eindstreep haalde; iedereen krijgt nog één beurt
    log: [],
    winners: null,
  };
}

function newPlayer(id, name) {
  return { id, name, connected: true, total: 0, onBoard: false };
}

export function addPlayer(s, id, name) {
  const at = s.players.findIndex((p) => p.id === id);
  if (at >= 0) {
    s.players[at].name = name;
    s.players[at].connected = true;
    return at;
  }
  if (s.phase !== 'lobby') throw new GameError('Het spel is al begonnen.');
  if (s.players.length >= MAX_PLAYERS) throw new GameError(`Maximaal ${MAX_PLAYERS} spelers.`);
  s.players.push(newPlayer(id, name));
  return s.players.length - 1;
}

export function removePlayer(s, id) {
  const i = s.players.findIndex((p) => p.id === id);
  if (i < 0) return;
  if (s.phase === 'lobby') s.players.splice(i, 1);
  else s.players[i].connected = false;
}

function log(s, text) {
  s.log.push({ i: ++s.seq, text });
  if (s.log.length > 60) s.log.splice(0, s.log.length - 60);
}

/** Er is niets geheim in dit spel; alleen de vorm gelijk houden met Flip 7. */
export const publicState = (s) => s;

export function startGame(s) {
  if (s.players.length < 2) throw new GameError('Je hebt minstens 2 spelers nodig.');
  s.phase = 'turn';
  s.turn = 0;
  resetTurn(s);
  s.log = [];
  log(s, `${s.players[0].name} mag beginnen. Spelen tot ${n(s.target)}.`);
  return s;
}

function resetTurn(s) {
  s.banked = 0;
  s.aside = [];
  s.roll = [];
  s.picked = [];
  s.rolling = false;
  s.poedel = null;
}

/* ----------------------------------------------------------------- beurten */

/** Hoeveel dobbels liggen er nog om mee te gooien? */
export const diceLeft = (s) => DICE - s.aside.length;

/** De punten die nu geselecteerd staan. */
export function pickedScore(s) {
  return scoreDice(
    s.picked.map((i) => s.roll[i]),
    s,
  );
}

/** Wat kan de speler die aan zet is nu doen? */
export function actor(s) {
  if (s.phase !== 'turn') return null;
  const sel = pickedScore(s);
  const left = diceLeft(s) - s.picked.length;
  const p = s.players[s.turn];
  const wouldBank = s.banked + sel.score;
  return {
    seat: s.turn,
    kind: s.rolling ? 'pick' : 'roll',
    selection: sel,
    diceLeft: left === 0 ? DICE : left, // alles vastgelegd = opnieuw met zes
    hotDice: s.rolling && sel.valid && left === 0,
    turnScore: wouldBank,
    canBank: s.rolling && sel.valid && (p.onBoard || wouldBank >= s.entry),
    needsEntry: !p.onBoard,
  };
}

function requireTurn(s, seat) {
  if (s.phase !== 'turn') throw new GameError('Het spel is niet bezig.');
  if (seat !== s.turn) throw new GameError('Je bent niet aan de beurt.');
}

function rollDice(n, rnd) {
  return Array.from({ length: n }, () => 1 + Math.floor(rnd() * 6));
}

export function roll(s, seat, rnd = Math.random) {
  requireTurn(s, seat);
  if (s.rolling) throw new GameError('Leg eerst dobbels vast.');
  const p = s.players[seat];
  s.poedel = null;
  s.roll = rollDice(diceLeft(s), rnd);
  s.picked = [];
  s.rolling = true;
  s.rollId = ++s.seq;

  if (!hasScore(s.roll, s)) {
    log(s, `${p.name} gooit ${s.roll.join('-')} - poedel! ${n(s.banked)} punten weg.`);
    s.poedel = { seat, roll: s.roll.slice() };
    s.banked = 0;
    s.rolling = false;
    nextTurn(s);
  }
  return s;
}

export function toggle(s, seat, index) {
  requireTurn(s, seat);
  if (!s.rolling) throw new GameError('Gooi eerst.');
  if (index < 0 || index >= s.roll.length) throw new GameError('Die dobbel bestaat niet.');
  const at = s.picked.indexOf(index);
  if (at >= 0) s.picked.splice(at, 1);
  else s.picked.push(index);
  return s;
}

function validSelection(s) {
  const sel = pickedScore(s);
  if (!sel.valid) {
    throw new GameError(
      s.picked.length
        ? 'Deze selectie levert niets op - elke dobbel moet meedoen.'
        : 'Kies eerst welke dobbels je vastlegt.',
    );
  }
  return sel;
}

/** Legt de selectie vast; gooit daarna verder of stopt. */
function commit(s, seat) {
  const sel = validSelection(s);
  const p = s.players[seat];
  const kept = s.picked.map((i) => s.roll[i]);
  log(s, `${p.name} legt ${describe(kept, s)} vast (+${n(sel.score)}).`);

  s.banked += sel.score;
  s.aside.push(...kept);
  s.roll = [];
  s.picked = [];
  s.rolling = false;
  if (s.aside.length === DICE) {
    s.aside = []; // alles telt: opnieuw met zes
    log(s, `Alles telt! ${p.name} mag met zes dobbels verder.`);
  }
  return sel.score;
}

export function rollOn(s, seat, rnd = Math.random) {
  requireTurn(s, seat);
  if (!s.rolling) throw new GameError('Gooi eerst.');
  commit(s, seat);
  return roll(s, seat, rnd);
}

export function bank(s, seat) {
  requireTurn(s, seat);
  if (!s.rolling) throw new GameError('Gooi eerst.');
  const p = s.players[seat];
  const sel = validSelection(s);
  if (!p.onBoard && s.banked + sel.score < s.entry) {
    throw new GameError(`Je moet met minstens ${n(s.entry)} punten in één beurt binnenkomen.`);
  }
  commit(s, seat);
  p.total += s.banked;
  p.onBoard = true;
  log(s, `${p.name} stopt met ${n(s.banked)} punten. Totaal: ${n(p.total)}.`);

  if (p.total >= s.target && s.closingBy === null) {
    s.closingBy = seat;
    log(s, `${p.name} is over de ${n(s.target)}! Iedereen krijgt nog één beurt.`);
  }
  nextTurn(s);
  return s;
}

function nextTurn(s) {
  const n = s.players.length;
  const next = (s.turn + 1) % n;
  if (s.closingBy !== null && next === s.closingBy) {
    finish(s);
    return;
  }
  const poedel = s.poedel;
  s.turn = next;
  resetTurn(s);
  s.poedel = poedel; // de mislukte worp blijft even zichtbaar
}

function finish(s) {
  s.phase = 'gameOver';
  const best = Math.max(...s.players.map((p) => p.total));
  s.winners = s.players.filter((p) => p.total === best).map((p) => p.id);
  const names = s.players.filter((p) => s.winners.includes(p.id)).map((p) => p.name);
  log(s, names.length > 1 ? `Gelijkspel: ${names.join(' en ')}.` : `${names[0]} wint!`);
}

export function resetGame(s) {
  s.phase = 'lobby';
  s.turn = 0;
  s.closingBy = null;
  s.winners = null;
  s.log = [];
  resetTurn(s);
  for (const p of s.players) {
    p.total = 0;
    p.onBoard = false;
  }
  return s;
}
