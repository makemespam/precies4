/*
 * Regenwoezels - regels-engine.
 * Puur: geen DOM, geen netwerk. De host houdt de enige echte stand bij.
 *
 * 8 dobbels met de waarden 1 t/m 5 en een woezel (telt 5 punten).
 * 16 tegels 21 t/m 36 liggen op de grill. Op je beurt gooi je, kiest één
 * waarde en legt ALLE dobbels met die waarde apart. Dezelfde waarde mag je
 * daarna niet meer kiezen. Stop je, dan pak je met je totaal een tegel - maar
 * alleen als er minstens één woezel bij ligt.
 */

export const DICE = 8;
export const WORM = 'w'; // de woezel-zijde
export const FIRST_TILE = 21;
export const LAST_TILE = 36;
export const MAX_PLAYERS = 8;

export class GameError extends Error {}

/* ------------------------------------------------------------------ tegels */

/** Hoeveel woezels staan er op deze tegel? 21-24 = 1, ... 33-36 = 4. */
export function worms(tile) {
  return Math.floor((tile - FIRST_TILE) / 4) + 1;
}

export function fullRow() {
  const row = [];
  for (let n = FIRST_TILE; n <= LAST_TILE; n++) row.push(n);
  return row;
}

/* ------------------------------------------------------------------- score */

export const pips = (v) => (v === WORM ? 5 : v);

export const scoreDice = (dice) => dice.reduce((sum, v) => sum + pips(v), 0);

export const hasWorm = (dice) => dice.includes(WORM);

export function faceLabel(v) {
  return v === WORM ? 'woezel' : String(v);
}

/* ------------------------------------------------------------------- state */

export function newGame() {
  return {
    v: 1,
    phase: 'lobby', // lobby | turn | gameOver
    players: [],
    row: fullRow(), // tegels die nog te pakken zijn, van laag naar hoog
    gone: [], // omgedraaide tegels, uit het spel
    turn: 0,
    seq: 0,
    dice: [], // de open worp
    aside: [], // wat je deze beurt hebt vastgelegd
    used: [], // waarden die je deze beurt al gekozen hebt
    rolling: false, // ligt er een worp om uit te kiezen?
    rollId: 0,
    choice: null, // { seat, options } als er iets te kiezen valt
    bust: null, // { seat, reason, roll } van de laatste mislukking
    log: [],
    winners: null,
  };
}

function newPlayer(id, name) {
  return { id, name, connected: true, stack: [] };
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

export const publicState = (s) => s;

export function startGame(s) {
  if (s.players.length < 2) throw new GameError('Je hebt minstens 2 spelers nodig.');
  s.phase = 'turn';
  s.turn = 0;
  s.row = fullRow();
  s.gone = [];
  s.winners = null;
  for (const p of s.players) p.stack = [];
  resetTurn(s);
  s.log = [];
  log(s, `${s.players[0].name} mag beginnen. Er liggen 16 tegels.`);
  return s;
}

function resetTurn(s) {
  s.dice = [];
  s.aside = [];
  s.used = [];
  s.rolling = false;
  s.choice = null;
  s.bust = null;
}

/* ----------------------------------------------------------------- beurten */

export const top = (p) => (p.stack.length ? p.stack[p.stack.length - 1] : null);

export const diceLeft = (s) => DICE - s.aside.length;

/** De waarden in de open worp die je nog mag kiezen. */
export function choosable(s) {
  const seen = new Set();
  for (const v of s.dice) if (!s.used.includes(v)) seen.add(v);
  return [...seen];
}

/** De hoogste tegel op de grill die je met dit totaal mag pakken. */
export function rowTileFor(s, score) {
  let best = null;
  for (const n of s.row) if (n <= score && (best === null || n > best)) best = n;
  return best;
}

/** Wie kun je met dit totaal de bovenste tegel afpakken? */
export function stealTargets(s, seat, score) {
  const out = [];
  s.players.forEach((p, i) => {
    if (i !== seat && top(p) === score) out.push(i);
  });
  return out;
}

/** Wat kan de speler die aan zet is nu doen? */
export function actor(s) {
  if (s.phase !== 'turn') return null;
  if (s.choice) return { seat: s.choice.seat, kind: 'choose', options: s.choice.options };
  const score = scoreDice(s.aside);
  const worm = hasWorm(s.aside);
  return {
    seat: s.turn,
    kind: s.rolling ? 'keep' : 'roll',
    choosable: s.rolling ? choosable(s) : [],
    score,
    worm,
    diceLeft: diceLeft(s),
    canRoll: !s.rolling && diceLeft(s) > 0,
    canStop: !s.rolling && s.aside.length > 0 && worm && takeOptions(s, s.turn, score).length > 0,
  };
}

function requireTurn(s, seat) {
  if (s.phase !== 'turn') throw new GameError('Het spel is niet bezig.');
  const a = actor(s);
  if (!a || a.seat !== seat) throw new GameError('Je bent niet aan de beurt.');
  return a;
}

function rollDice(n, rnd) {
  const faces = [1, 2, 3, 4, 5, WORM];
  return Array.from({ length: n }, () => faces[Math.floor(rnd() * 6)]);
}

export function roll(s, seat, rnd = Math.random) {
  const a = requireTurn(s, seat);
  if (a.kind !== 'roll') throw new GameError('Kies eerst een waarde om apart te leggen.');
  if (!a.canRoll) throw new GameError('Je hebt geen dobbels meer.');
  const p = s.players[seat];
  s.bust = null;
  s.dice = rollDice(diceLeft(s), rnd);
  s.rolling = true;
  s.rollId = ++s.seq;

  if (!choosable(s).length) {
    log(s, `${p.name} gooit ${s.dice.map(faceLabel).join('-')} en heeft niets nieuws. Mislukt!`);
    fail(s, seat, 'geen nieuwe waarde');
  }
  return s;
}

/** Legt alle dobbels met deze waarde apart. */
export function keep(s, seat, value) {
  const a = requireTurn(s, seat);
  if (a.kind !== 'keep') throw new GameError('Gooi eerst.');
  if (s.used.includes(value)) throw new GameError('Die waarde heb je deze beurt al gekozen.');
  const taken = s.dice.filter((v) => v === value);
  if (!taken.length) throw new GameError('Die waarde ligt er niet.');

  s.aside.push(...taken);
  s.used.push(value);
  s.dice = [];
  s.rolling = false;
  const p = s.players[seat];
  log(
    s,
    `${p.name} legt ${taken.length}× ${faceLabel(value)} apart (${scoreDice(s.aside)} punten${
      hasWorm(s.aside) ? ', met woezel' : ', nog geen woezel'
    }).`,
  );
  // Alle acht dobbels vast: gooien kan niet meer, dus de beurt wordt hier
  // beslist (pakken als het kan, anders mislukt hij).
  if (diceLeft(s) === 0) return stop(s, seat);
  return s;
}

/** De tegels die je met dit totaal kunt pakken: van de grill of van een speler. */
function takeOptions(s, seat, score) {
  const options = [];
  const fromRow = rowTileFor(s, score);
  if (fromRow !== null) options.push({ kind: 'row', tile: fromRow });
  for (const target of stealTargets(s, seat, score)) {
    options.push({ kind: 'steal', seat: target, tile: score });
  }
  return options;
}

export function stop(s, seat) {
  const a = requireTurn(s, seat);
  if (a.kind !== 'roll') throw new GameError('Kies eerst een waarde om apart te leggen.');
  if (!s.aside.length) throw new GameError('Je hebt nog niets vastgelegd.');
  const p = s.players[seat];
  const score = scoreDice(s.aside);

  if (!hasWorm(s.aside)) {
    log(s, `${p.name} stopt op ${score} maar heeft geen woezel. Mislukt!`);
    return fail(s, seat, 'geen woezel');
  }
  const options = takeOptions(s, seat, score);
  if (!options.length) {
    log(s, `${p.name} stopt op ${score}, maar daar is geen tegel voor. Mislukt!`);
    return fail(s, seat, 'niets te pakken');
  }
  if (options.length === 1) return resolve(s, seat, options[0]);

  s.choice = { seat, options };
  return s;
}

export function choose(s, seat, index) {
  const a = requireTurn(s, seat);
  if (a.kind !== 'choose') throw new GameError('Er is niets te kiezen.');
  const option = s.choice.options[index];
  if (!option) throw new GameError('Die keuze bestaat niet.');
  s.choice = null;
  return resolve(s, seat, option);
}

function resolve(s, seat, option) {
  const p = s.players[seat];
  if (option.kind === 'row') {
    s.row.splice(s.row.indexOf(option.tile), 1);
    p.stack.push(option.tile);
    log(s, `${p.name} pakt tegel ${option.tile} van de grill (${worms(option.tile)} woezels).`);
  } else {
    const victim = s.players[option.seat];
    victim.stack.pop();
    p.stack.push(option.tile);
    log(s, `${p.name} pakt tegel ${option.tile} af van ${victim.name}!`);
  }
  return endTurn(s);
}

/**
 * Mislukt: je legt je bovenste tegel terug op de grill en daarna gaat de
 * hoogste tegel van de grill uit het spel - tenzij dat de tegel is die je
 * net hebt teruggelegd.
 */
function fail(s, seat, reason) {
  const p = s.players[seat];
  const returned = p.stack.pop() ?? null;
  if (returned !== null) {
    s.row.push(returned);
    s.row.sort((a, b) => a - b);
    log(s, `${p.name} legt tegel ${returned} terug.`);
  }
  const highest = s.row.length ? s.row[s.row.length - 1] : null;
  if (highest !== null && highest !== returned) {
    s.row.pop();
    s.gone.push(highest);
    log(s, `Tegel ${highest} gaat uit het spel.`);
  }
  s.bust = { seat, reason, roll: s.dice.slice(), score: scoreDice(s.aside) };
  return endTurn(s);
}

function endTurn(s) {
  if (!s.row.length) return finish(s);
  const bust = s.bust;
  const n = s.players.length;
  s.turn = (s.turn + 1) % n;
  resetTurn(s);
  s.bust = bust; // de mislukking blijft even zichtbaar
  return s;
}

export function wormCount(p) {
  return p.stack.reduce((sum, tile) => sum + worms(tile), 0);
}

function finish(s) {
  s.phase = 'gameOver';
  const best = Math.max(...s.players.map(wormCount));
  s.winners = s.players.filter((p) => wormCount(p) === best).map((p) => p.id);
  const names = s.players.filter((p) => s.winners.includes(p.id)).map((p) => p.name);
  log(
    s,
    names.length > 1
      ? `De grill is leeg. Gelijkspel: ${names.join(' en ')} met ${best} woezels.`
      : `De grill is leeg. ${names[0]} wint met ${best} woezels!`,
  );
  return s;
}

export function resetGame(s) {
  s.phase = 'lobby';
  s.turn = 0;
  s.row = fullRow();
  s.gone = [];
  s.winners = null;
  s.log = [];
  resetTurn(s);
  for (const p of s.players) p.stack = [];
  return s;
}
