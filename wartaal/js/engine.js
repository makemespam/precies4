/*
 * Wartaal - regels-engine voor het woordenboekspel.
 * Puur: geen DOM, geen netwerk. De host houdt de enige echte stand bij.
 *
 * Ronde: de kiezer krijgt 15 woorden te zien zonder betekenis en kiest er één.
 * Daarna schrijft iedereen een omschrijving - de kiezer de echte, ingekort, en
 * alleen met woorden uit de echte omschrijving plus lidwoorden en voorzetsels.
 * De rest verzint er een. Alles wordt geschud en iedereen behalve de kiezer
 * stemt. Een gebruikt woord komt niet meer terug.
 */

export const HAND = 15;
export const MAX_PLAYERS = 10;
export const MAX_TEKST = 140;

export class GameError extends Error {}

/* ------------------------------------------------- regel van de kiezer */

/** Lidwoorden en voorzetsels mag de kiezer er altijd bij gebruiken. */
export const VRIJE_WOORDEN = [
  // lidwoorden
  'de', 'het', 'een', 'der', 'des', 'den',
  // voorzetsels
  'aan', 'achter', 'af', 'behalve', 'beneden', 'bij', 'binnen', 'boven',
  'buiten', 'door', 'gedurende', 'in', 'jegens', 'krachtens', 'langs', 'met',
  'na', 'naar', 'naast', 'nabij', 'om', 'omstreeks', 'onder', 'ondanks', 'op',
  'over', 'per', 'rond', 'rondom', 'sinds', 'te', 'tegen', 'tegenover', 'ten',
  'ter', 'tijdens', 'tot', 'tussen', 'uit', 'van', 'vanaf', 'via', 'volgens',
  'voor', 'voorbij', 'wegens', 'zonder',
];

/** Splitst een zin in losse, genormaliseerde woorden. */
export function woorden(tekst) {
  return String(tekst)
    .toLowerCase()
    .split(/[^a-z0-9àáâäèéêëìíîïòóôöùúûüçñ]+/i)
    .filter(Boolean);
}

/**
 * Welke woorden gebruikt de kiezer die niet mogen? Toegestaan zijn alleen
 * woorden uit de echte omschrijving, plus lidwoorden en voorzetsels.
 */
export function verbodenWoorden(tekst, betekenis) {
  const toegestaan = new Set([...woorden(betekenis), ...VRIJE_WOORDEN]);
  const fout = [];
  for (const w of woorden(tekst)) {
    if (!toegestaan.has(w) && !fout.includes(w)) fout.push(w);
  }
  return fout;
}

/* ------------------------------------------------------------------ state */

export function newGame(opts = {}) {
  return {
    v: 1,
    phase: 'lobby', // lobby | kiezen | schrijven | stemmen | uitslag | gameOver
    players: [],
    woordenlijst: opts.woorden ?? [], // [{ w, b }]
    pool: [], // indexen in woordenlijst die nog niet gebruikt zijn
    rondes: opts.rondes ?? 10,
    ronde: 0,
    chooser: 0,
    hand: [], // 15 indexen om uit te kiezen
    woord: null, // { w, b } van deze ronde
    entries: [], // [{ id, seat, tekst, echt }]
    order: [], // geschudde volgorde van entry-ids
    votes: {}, // seat -> entry-id
    uitslag: null,
    seq: 0,
    log: [],
    winners: null,
  };
}

function newPlayer(id, name) {
  return { id, name, connected: true, score: 0 };
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
  if (s.log.length > 40) s.log.splice(0, s.log.length - 40);
}

export function shuffle(list, rnd = Math.random) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/* ------------------------------------------------------------------ spel */

export function startGame(s, rnd = Math.random) {
  if (s.players.length < 2) throw new GameError('Je hebt minstens 2 spelers nodig.');
  if (s.woordenlijst.length < HAND) {
    throw new GameError(`De woordenlijst heeft minstens ${HAND} woorden nodig.`);
  }
  s.phase = 'kiezen';
  s.ronde = 0;
  s.chooser = 0;
  s.pool = s.woordenlijst.map((_, i) => i);
  for (const p of s.players) p.score = 0;
  s.log = [];
  s.winners = null;
  nieuweRonde(s, rnd);
  return s;
}

function nieuweRonde(s, rnd) {
  s.ronde++;
  s.phase = 'kiezen';
  s.woord = null;
  s.entries = [];
  s.order = [];
  s.votes = {};
  s.uitslag = null;
  s.hand = shuffle(s.pool.slice(), rnd).slice(0, HAND);
  log(s, `Ronde ${s.ronde}: ${s.players[s.chooser].name} kiest een woord.`);
}

/** Wie moet nu iets doen? */
export function actor(s) {
  if (s.phase === 'kiezen') return { kind: 'kiezen', seat: s.chooser };
  if (s.phase === 'schrijven') return { kind: 'schrijven', wachtOp: nogNietKlaar(s) };
  if (s.phase === 'stemmen') return { kind: 'stemmen', wachtOp: nogNietGestemd(s) };
  return null;
}

const meedoen = (s) => s.players.map((p, i) => i).filter((i) => s.players[i].connected);

function nogNietKlaar(s) {
  return meedoen(s).filter((i) => !s.entries.some((e) => e.seat === i));
}

function nogNietGestemd(s) {
  return meedoen(s).filter((i) => i !== s.chooser && s.votes[i] === undefined);
}

/** `pos` is de plek in de hand van 15, niet de index in de woordenlijst -
 *  een gast kent die lijst niet. */
export function kies(s, seat, pos) {
  if (s.phase !== 'kiezen') throw new GameError('Er valt nu niets te kiezen.');
  if (seat !== s.chooser) throw new GameError('Jij bent niet de kiezer.');
  const index = s.hand[pos];
  if (index === undefined) throw new GameError('Dat woord ligt er niet.');
  s.woord = { ...s.woordenlijst[index], i: index };
  s.pool = s.pool.filter((i) => i !== index); // alleen het gekozen woord is op
  s.phase = 'schrijven';
  log(s, `Het woord is "${s.woord.w}". Iedereen schrijft een omschrijving.`);
  return s;
}

/** Dient een omschrijving in. De kiezer is aan de regel van het boek gebonden. */
export function schrijf(s, seat, tekst) {
  if (s.phase !== 'schrijven') throw new GameError('Er wordt nu niet geschreven.');
  const schoon = String(tekst).trim().replace(/\s+/g, ' ').slice(0, MAX_TEKST);
  if (schoon.length < 3) throw new GameError('Schrijf iets meer.');
  if (s.entries.some((e) => e.seat === seat)) throw new GameError('Je hebt al ingeleverd.');

  const echt = seat === s.chooser;
  if (echt) {
    const fout = verbodenWoorden(schoon, s.woord.b);
    if (fout.length) {
      throw new GameError(
        `Deze woorden staan niet in het boek: ${fout.join(', ')}. Je mag alleen woorden uit de omschrijving gebruiken, plus lidwoorden en voorzetsels.`,
      );
    }
  }
  s.entries.push({ id: s.entries.length, seat, tekst: schoon, echt });
  const p = s.players[seat];
  log(s, `${p.name} heeft ingeleverd.`);
  if (!nogNietKlaar(s).length) naarStemmen(s);
  return s;
}

function naarStemmen(s, rnd = Math.random) {
  s.phase = 'stemmen';
  s.order = shuffle(s.entries.map((e) => e.id), rnd);
  log(s, 'Alles is binnen. Welke is de echte?');
  if (!nogNietGestemd(s).length) telOp(s); // niemand kan stemmen (te weinig spelers)
}

export function stem(s, seat, entryId) {
  if (s.phase !== 'stemmen') throw new GameError('Er wordt nu niet gestemd.');
  if (seat === s.chooser) throw new GameError('Jij weet het antwoord al.');
  if (s.votes[seat] !== undefined) throw new GameError('Je hebt al gestemd.');
  const entry = s.entries.find((e) => e.id === entryId);
  if (!entry) throw new GameError('Die omschrijving bestaat niet.');
  if (entry.seat === seat) throw new GameError('Op je eigen omschrijving stemmen mag niet.');
  s.votes[seat] = entryId;
  if (!nogNietGestemd(s).length) telOp(s);
  return s;
}

/**
 * Punten: 2 voor wie de echte vindt, 1 voor de schrijver van elke nep die een
 * stem krijgt, en maximaal 2 voor de kiezer als hij de waarheid onherkenbaar
 * wist te maken.
 */
function telOp(s) {
  const echt = s.entries.find((e) => e.echt);
  const perEntry = {};
  let missers = 0;

  for (const [seatKey, id] of Object.entries(s.votes)) {
    const voter = Number(seatKey);
    perEntry[id] = (perEntry[id] || 0) + 1;
    if (id === echt.id) {
      s.players[voter].score += 2;
    } else {
      missers++;
      const auteur = s.entries.find((e) => e.id === id).seat;
      s.players[auteur].score += 1;
    }
  }
  const bonus = Math.min(2, missers);
  s.players[s.chooser].score += bonus;

  s.uitslag = {
    echtId: echt.id,
    stemmen: perEntry,
    bonus,
    regels: s.entries.map((e) => ({
      id: e.id,
      seat: e.seat,
      tekst: e.tekst,
      echt: e.echt,
      stemmen: perEntry[e.id] || 0,
      door: Object.entries(s.votes)
        .filter(([, id]) => id === e.id)
        .map(([seat]) => Number(seat)),
    })),
  };
  s.phase = 'uitslag';
  const goed = s.uitslag.regels.find((r) => r.echt).stemmen;
  log(s, goed ? `${goed} speler(s) vonden de echte.` : 'Niemand vond de echte!');
}

export function volgende(s, rnd = Math.random) {
  if (s.phase !== 'uitslag') throw new GameError('De ronde is nog niet klaar.');
  if (s.ronde >= s.rondes || s.pool.length < HAND) return finish(s);
  s.chooser = (s.chooser + 1) % s.players.length;
  nieuweRonde(s, rnd);
  return s;
}

function finish(s) {
  s.phase = 'gameOver';
  const best = Math.max(...s.players.map((p) => p.score));
  s.winners = s.players.filter((p) => p.score === best).map((p) => p.id);
  const namen = s.players.filter((p) => s.winners.includes(p.id)).map((p) => p.name);
  log(s, namen.length > 1 ? `Gelijkspel: ${namen.join(' en ')}.` : `${namen[0]} wint!`);
  return s;
}

export function resetGame(s) {
  s.phase = 'lobby';
  s.ronde = 0;
  s.chooser = 0;
  s.pool = [];
  s.hand = [];
  s.woord = null;
  s.entries = [];
  s.order = [];
  s.votes = {};
  s.uitslag = null;
  s.winners = null;
  s.log = [];
  for (const p of s.players) p.score = 0;
  return s;
}

/* ------------------------------------------------------------ per speler */

/**
 * Wat mag deze telefoon zien? De echte betekenis blijft bij de kiezer, en
 * tijdens het schrijven en stemmen zie je niet wie wat heeft ingeleverd.
 */
export function viewFor(s, seat) {
  const { woordenlijst, pool, ...rest } = s;
  const view = {
    ...rest,
    poolLeft: pool.length,
    ik: seat,
    // de 15 woorden zelf, zonder betekenissen
    hand: s.hand.map((i) => woordenlijst[i]?.w ?? ''),
  };

  if (s.phase === 'lobby') return view;

  const isKiezer = seat === s.chooser;
  view.woord = s.woord ? { w: s.woord.w } : null;
  // Alleen de kiezer krijgt de echte omschrijving te zien, en pas bij de uitslag
  // ziet iedereen hem.
  if (s.woord && (isKiezer || s.phase === 'uitslag' || s.phase === 'gameOver')) {
    view.woord = { w: s.woord.w, b: s.woord.b };
  }

  if (s.phase === 'schrijven') {
    // wel wie klaar is, niet wat er staat
    view.entries = s.entries.map((e) => ({ id: e.id, seat: e.seat }));
    view.mijn = s.entries.find((e) => e.seat === seat)?.tekst ?? null;
  } else if (s.phase === 'stemmen') {
    view.entries = s.order.map((id) => {
      const e = s.entries.find((x) => x.id === id);
      return { id: e.id, tekst: e.tekst, mijn: e.seat === seat };
    });
  } else if (s.phase === 'uitslag' || s.phase === 'gameOver') {
    view.entries = s.entries.map((e) => ({ id: e.id, seat: e.seat, tekst: e.tekst, echt: e.echt }));
  } else {
    view.entries = [];
  }
  return view;
}
