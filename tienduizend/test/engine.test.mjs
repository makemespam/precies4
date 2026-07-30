import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';

const opts = { extras: true };
const score = (dice, o = opts) => E.scoreDice(dice, o).score;
const valid = (dice, o = opts) => E.scoreDice(dice, o).valid;

/* -------------------------------------------------------------- scoreDice */

test('losse 1-en en 5-en', () => {
  assert.equal(score([1]), 100);
  assert.equal(score([5]), 50);
  assert.equal(score([1, 5]), 150);
  assert.equal(score([1, 1]), 200);
  assert.equal(score([5, 5]), 100);
});

test('een selectie met een dobbel die niks doet mag niet', () => {
  assert.equal(valid([3]), false);
  assert.equal(valid([1, 3]), false, 'de losse 3 doet niet mee');
  assert.equal(valid([2, 2]), false, 'twee gelijke is geen combinatie');
  assert.equal(valid([]), false);
});

test('drie gelijke', () => {
  assert.equal(score([1, 1, 1]), 1000);
  assert.equal(score([2, 2, 2]), 200);
  assert.equal(score([3, 3, 3]), 300);
  assert.equal(score([4, 4, 4]), 400);
  assert.equal(score([5, 5, 5]), 500);
  assert.equal(score([6, 6, 6]), 600);
});

test('elke dobbel boven de drie verdubbelt', () => {
  assert.equal(score([2, 2, 2, 2]), 400);
  assert.equal(score([2, 2, 2, 2, 2]), 800);
  assert.equal(score([2, 2, 2, 2, 2, 2]), 1600);
  assert.equal(score([1, 1, 1, 1]), 2000);
  assert.equal(score([1, 1, 1, 1, 1, 1]), 8000);
});

test('straat en drie paren', () => {
  assert.equal(score([1, 2, 3, 4, 5, 6]), 1500);
  assert.equal(score([2, 2, 3, 3, 4, 4]), 750);
  assert.equal(valid([2, 2, 3, 3, 4, 4]), true);
  // vier gelijke plus een paar telt ook als drie paren
  assert.equal(score([2, 2, 2, 2, 3, 3]), 750);
});

test('de beste verdeling wint', () => {
  // drie 1-en als set (1000) is beter dan als losse enen (300)
  assert.equal(score([1, 1, 1]), 1000);
  // zes 2-en als set (1600) is beter dan als drie paren (750)
  assert.equal(score([2, 2, 2, 2, 2, 2]), 1600);
  // een straat (1500) is beter dan alleen de 1 en de 5 eruit (150)
  assert.equal(score([1, 2, 3, 4, 5, 6]), 1500);
  // combinatie: drie 6-en plus een losse 1
  assert.equal(score([6, 6, 6, 1]), 700);
});

test('zonder extra combinaties tellen straat en paren niet', () => {
  const zonder = { extras: false };
  assert.equal(valid([2, 2, 3, 3, 4, 4], zonder), false);
  assert.equal(valid([1, 2, 3, 4, 5, 6], zonder), false, 'de 2, 3, 4 en 6 mag je niet houden');
  assert.equal(score([1, 5], zonder), 150, 'alleen de 1 en de 5 pakken kan wel');
});

/* --------------------------------------------------------------- hasScore */

test('poedel herkennen', () => {
  assert.equal(E.hasScore([2, 3, 4, 6], opts), false);
  assert.equal(E.hasScore([2, 2, 3, 3], opts), false, 'twee paren uit vier dobbels is niks');
  assert.equal(E.hasScore([1, 2, 3], opts), true);
  assert.equal(E.hasScore([3, 3, 3], opts), true);
  assert.equal(E.hasScore([2, 2, 3, 3, 4, 4], opts), true, 'drie paren uit zes dobbels wel');
  assert.equal(E.hasScore([2, 2, 3, 3, 4, 4], { extras: false }), false);
});

/** De best scorende geldige selectie uit een worp (of null). */
function bestSubset(roll, opts) {
  let best = null;
  for (let mask = 1; mask < 1 << roll.length; mask++) {
    const indices = [];
    for (let i = 0; i < roll.length; i++) if (mask & (1 << i)) indices.push(i);
    const { score, valid } = E.scoreDice(indices.map((i) => roll[i]), opts);
    if (valid && (!best || score > best.score)) best = { indices, score };
  }
  return best;
}

/** Alle worpen van n dobbels. */
function* allRolls(n) {
  const dice = new Array(n).fill(1);
  for (let k = 0; k < 6 ** n; k++) {
    let rest = k;
    for (let i = 0; i < n; i++) {
      dice[i] = (rest % 6) + 1;
      rest = Math.floor(rest / 6);
    }
    yield dice;
  }
}

test('poedel betekent precies: er is geen enkele geldige selectie', () => {
  for (const extras of [true, false]) {
    const opts = { extras };
    for (let n = 1; n <= 6; n++) {
      for (const roll of allRolls(n)) {
        const kan = bestSubset(roll, opts) !== null;
        assert.equal(
          E.hasScore(roll, opts),
          kan,
          `worp ${roll.join('-')} (extras=${extras}): hasScore zegt ${E.hasScore(roll, opts)}, maar geldige selectie bestaat=${kan}`,
        );
      }
    }
  }
});

/* ---------------------------------------------------------------- beurten */

/** Spel met een vaste reeks worpen, zodat het potje voorspelbaar is. */
function rig(names, rolls) {
  const s = E.newGame();
  names.forEach((n, i) => E.addPlayer(s, 'p' + i, n));
  E.startGame(s);
  const queue = rolls.slice();
  let pending = [];
  // rnd() wordt per dobbel aangeroepen; we voeren de worpen dobbel-voor-dobbel.
  const rnd = () => {
    if (!pending.length) pending = (queue.shift() || [1]).slice();
    return (pending.shift() - 1) / 6 + 0.001;
  };
  return [s, rnd];
}

/** Selecteert de open dobbels met deze waarden (één per waarde-voorkomen). */
function pick(s, seat, values) {
  for (const v of values) {
    const idx = s.roll.findIndex((d, i) => d === v && !s.picked.includes(i));
    assert.notEqual(idx, -1, `dobbel ${v} niet in de worp ${s.roll.join('-')}`);
    E.toggle(s, seat, idx);
  }
}

test('gooien, vastleggen en stoppen', () => {
  const [s, rnd] = rig(['A', 'B'], [[1, 1, 2, 3, 4, 6]]);
  assert.equal(E.actor(s).kind, 'roll');
  E.roll(s, 0, rnd);
  assert.deepEqual(s.roll, [1, 1, 2, 3, 4, 6]);
  assert.equal(E.actor(s).kind, 'pick');

  pick(s, 0, [1, 1]);
  const a = E.actor(s);
  assert.equal(a.selection.score, 200);
  assert.equal(a.turnScore, 200);
  assert.equal(a.canBank, false, '200 is minder dan de instapdrempel van 500');

  assert.throws(() => E.bank(s, 0), /binnenkomen/);
});

test('je moet eerst binnenkomen, daarna mag je elk bedrag stoppen', () => {
  const [s, rnd] = rig(['A', 'B'], [
    [5, 5, 5, 2, 3, 4], // A: 500 -> mag stoppen
    [1, 2, 3, 4, 6, 6], // B: 100 -> mag niet stoppen
  ]);
  E.roll(s, 0, rnd);
  pick(s, 0, [5, 5, 5]);
  assert.equal(E.actor(s).canBank, true);
  E.bank(s, 0);
  assert.equal(s.players[0].total, 500);
  assert.equal(s.players[0].onBoard, true);
  assert.equal(s.turn, 1);

  E.roll(s, 1, rnd);
  pick(s, 1, [1]);
  assert.equal(E.actor(s).canBank, false);

  // A staat er nu op, dus die mag later ook met 50 punten stoppen
  s.turn = 0;
  s.rolling = true;
  s.roll = [5, 2];
  s.picked = [0];
  assert.equal(E.actor(s).canBank, true);
});

test('poedel kost alles van deze beurt', () => {
  const [s, rnd] = rig(['A', 'B'], [
    [1, 1, 1, 2, 3, 4], // A legt 1000 vast en gooit verder
    [2, 3, 4], // poedel
  ]);
  E.roll(s, 0, rnd);
  pick(s, 0, [1, 1, 1]);
  E.rollOn(s, 0, rnd);
  assert.ok(s.poedel, 'poedel gemarkeerd');
  assert.deepEqual(s.poedel.roll, [2, 3, 4], 'de mislukte worp blijft zichtbaar');
  assert.equal(s.poedel.seat, 0);
  assert.equal(s.players[0].total, 0, '1000 punten weg');
  assert.equal(s.turn, 1, 'beurt door naar B');
  assert.equal(E.actor(s).kind, 'roll');
});

test('alles vastgelegd = opnieuw met zes dobbels', () => {
  const [s, rnd] = rig(['A', 'B'], [
    [1, 1, 1, 5, 5, 5], // alle zes tellen: 1000 + 500
    [1, 2, 2, 3, 4, 6],
  ]);
  E.roll(s, 0, rnd);
  pick(s, 0, [1, 1, 1, 5, 5, 5]);
  assert.equal(E.actor(s).selection.score, 1500);
  assert.equal(E.actor(s).hotDice, true);
  E.rollOn(s, 0, rnd);
  assert.equal(s.banked, 1500);
  assert.equal(s.aside.length, 0, 'de zes dobbels liggen weer klaar');
  assert.equal(s.roll.length, 6);
});

test('verder gooien gebeurt met de dobbels die je liet liggen', () => {
  const [s, rnd] = rig(['A', 'B'], [
    [1, 5, 2, 3, 4, 6],
    [1, 1, 1, 1], // vier dobbels over
  ]);
  E.roll(s, 0, rnd);
  pick(s, 0, [1, 5]);
  E.rollOn(s, 0, rnd);
  assert.equal(s.roll.length, 4, 'twee vastgelegd, dus vier terug');
  assert.equal(s.banked, 150);
});

test('een ongeldige selectie wordt geweigerd', () => {
  const [s, rnd] = rig(['A', 'B'], [[1, 3, 2, 4, 6, 6]]);
  E.roll(s, 0, rnd);
  pick(s, 0, [1, 3]);
  assert.throws(() => E.rollOn(s, 0, rnd), /levert niets op/);
  assert.throws(() => E.bank(s, 0), /levert niets op/);
  // en zonder selectie ook niet
  for (const i of s.picked.slice()) E.toggle(s, 0, i);
  assert.equal(s.picked.length, 0);
  assert.throws(() => E.bank(s, 0), /Kies eerst/);
});

test('alleen wie aan de beurt is mag iets doen', () => {
  const [s, rnd] = rig(['A', 'B'], [[1, 1, 1, 2, 3, 4]]);
  assert.throws(() => E.roll(s, 1, rnd), E.GameError);
  E.roll(s, 0, rnd);
  assert.throws(() => E.toggle(s, 1, 0), E.GameError);
  assert.throws(() => E.bank(s, 1), E.GameError);
});

test('wie de eindstreep haalt, geeft iedereen nog één beurt', () => {
  const [s, rnd] = rig(['A', 'B', 'C'], [
    [1, 1, 1, 1, 1, 1], // A: 8000
    [1, 1, 1, 1, 1, 1], // A opnieuw (alles telt): 8000 -> 16000
    [5, 5, 5, 2, 3, 4], // B
    [1, 1, 1, 2, 3, 4], // C
  ]);
  s.target = 10000;
  E.roll(s, 0, rnd);
  pick(s, 0, [1, 1, 1, 1, 1, 1]);
  E.rollOn(s, 0, rnd);
  pick(s, 0, [1, 1, 1, 1, 1, 1]);
  E.bank(s, 0);
  assert.equal(s.players[0].total, 16000);
  assert.equal(s.closingBy, 0, 'A heeft de eindstreep gehaald');
  assert.equal(s.phase, 'turn');

  E.roll(s, 1, rnd);
  pick(s, 1, [5, 5, 5]);
  E.bank(s, 1);
  assert.equal(s.phase, 'turn', 'C mag nog');

  E.roll(s, 2, rnd);
  pick(s, 2, [1, 1, 1]);
  E.bank(s, 2);
  assert.equal(s.phase, 'gameOver');
  assert.deepEqual(s.winners, ['p0']);
});

test('een potje met echte dobbels loopt niet vast', () => {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const s = E.newGame({ target: 3000 });
  ['A', 'B', 'C'].forEach((n, i) => E.addPlayer(s, 'p' + i, n));
  E.startGame(s);

  let guard = 0;
  while (s.phase === 'turn' && guard++ < 4000) {
    const a = E.actor(s);
    if (a.kind === 'roll') {
      E.roll(s, a.seat, rnd);
      continue;
    }
    // strategie: pak de best scorende geldige selectie, stop zodra je 400+ hebt
    const best = bestSubset(s.roll, s);
    assert.ok(best, `niets te pakken uit ${s.roll.join('-')} - had poedel moeten zijn`);
    for (const i of best.indices) E.toggle(s, a.seat, i);
    const now = E.actor(s);
    if (now.canBank && now.turnScore >= 400) E.bank(s, a.seat);
    else E.rollOn(s, a.seat, rnd);
  }
  assert.equal(s.phase, 'gameOver');
  assert.ok(guard < 4000, 'geen oneindige lus');
  assert.ok(Math.max(...s.players.map((p) => p.total)) >= 3000);
});
