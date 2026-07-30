import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';

const W = E.WORM;

/** Spel met vaste worpen. Elke worp is een rij dobbelwaarden. */
function rig(names, rolls = []) {
  const s = E.newGame();
  names.forEach((n, i) => E.addPlayer(s, 'p' + i, n));
  E.startGame(s);
  const queue = rolls.slice();
  let pending = [];
  const faces = [1, 2, 3, 4, 5, W];
  const rnd = () => {
    if (!pending.length) pending = (queue.shift() || [1]).slice();
    return faces.indexOf(pending.shift()) / 6 + 0.01;
  };
  return [s, rnd];
}

/* ------------------------------------------------------------------ tegels */

test('woezels per tegel', () => {
  for (const n of [21, 22, 23, 24]) assert.equal(E.worms(n), 1);
  for (const n of [25, 26, 27, 28]) assert.equal(E.worms(n), 2);
  for (const n of [29, 30, 31, 32]) assert.equal(E.worms(n), 3);
  for (const n of [33, 34, 35, 36]) assert.equal(E.worms(n), 4);
  assert.equal(E.fullRow().length, 16);
  assert.equal(E.fullRow().reduce((sum, n) => sum + E.worms(n), 0), 40);
});

test('een woezel telt 5 punten', () => {
  assert.equal(E.pips(W), 5);
  assert.equal(E.scoreDice([4, 4, W]), 13);
  assert.equal(E.hasWorm([1, 2, 3]), false);
  assert.equal(E.hasWorm([1, W]), true);
});

/* ----------------------------------------------------------------- beurten */

test('je legt altijd alle dobbels met de gekozen waarde apart', () => {
  const [s, rnd] = rig(['A', 'B'], [[4, 4, 4, 1, 2, 3, 5, W]]);
  E.roll(s, 0, rnd);
  assert.equal(E.actor(s).kind, 'keep');
  E.keep(s, 0, 4);
  assert.deepEqual(s.aside, [4, 4, 4]);
  assert.equal(E.actor(s).score, 12);
  assert.equal(E.actor(s).diceLeft, 5);
  assert.equal(E.actor(s).worm, false);
});

test('dezelfde waarde mag je niet twee keer kiezen', () => {
  const [s, rnd] = rig(['A', 'B'], [[4, 4, 1, 1, 1, 1, 1, 1], [4, 4, 4, 4, 4, 4]]);
  E.roll(s, 0, rnd);
  E.keep(s, 0, 4);
  E.roll(s, 0, rnd);
  assert.deepEqual(E.actor(s).choosable, [], 'alleen vieren, en die had hij al');
  assert.equal(s.bust.reason, 'geen nieuwe waarde');
});

test('geen bruikbare waarde in de worp = mislukt', () => {
  const [s, rnd] = rig(['A', 'B'], [[2, 2, 3, 3, 3, 3, 3, 3], [2, 2, 2, 2, 2, 2]]);
  E.roll(s, 0, rnd);
  E.keep(s, 0, 2);
  E.roll(s, 0, rnd);
  assert.ok(s.bust, 'mislukt');
  assert.equal(s.turn, 1, 'beurt door');
});

test('stoppen zonder woezel is mislukt', () => {
  const [s, rnd] = rig(['A', 'B'], [[5, 5, 5, 5, 5, 1, 2, 3]]);
  E.roll(s, 0, rnd);
  E.keep(s, 0, 5); // 25 punten, geen woezel
  assert.equal(E.actor(s).score, 25);
  assert.equal(E.actor(s).canStop, false, 'zonder woezel mag je niet stoppen');
  E.stop(s, 0);
  assert.equal(s.bust.reason, 'geen woezel');
  assert.deepEqual(s.players[0].stack, []);
});

test('tegel pakken van de grill', () => {
  const [s, rnd] = rig(['A', 'B'], [[5, 5, 5, 5, 5, 1, 1, 1], [W, W, 1, 1]]);
  E.roll(s, 0, rnd);
  E.keep(s, 0, 5); // 25, geen woezel
  E.roll(s, 0, rnd);
  E.keep(s, 0, W); // +10 = 35, met woezel
  assert.equal(E.actor(s).score, 35);
  assert.equal(E.actor(s).canStop, true);
  E.stop(s, 0);
  assert.deepEqual(s.players[0].stack, [35], 'hoogste tegel <= 35');
  assert.equal(s.row.includes(35), false);
  assert.equal(s.row.length, 15);
  assert.equal(s.turn, 1);
});

test('precies gelijk aan de bovenste tegel van een ander = afpakken', () => {
  const [s, rnd] = rig(['A', 'B'], [
    [5, 5, 5, 5, 5, 1, 1, 1], // A legt vijf vijven apart: 25
    [W, 1, 1], // en daarna een woezel: 30
  ]);
  s.players[1].stack = [30];
  s.row = [31, 32]; // niets op de grill dat A met 30 mag pakken
  E.roll(s, 0, rnd);
  E.keep(s, 0, 5);
  E.roll(s, 0, rnd);
  E.keep(s, 0, W);
  assert.equal(E.actor(s).score, 30);
  assert.equal(E.actor(s).canStop, true);
  E.stop(s, 0);
  assert.deepEqual(s.players[0].stack, [30], 'afgepakt van B');
  assert.deepEqual(s.players[1].stack, [], 'B is zijn tegel kwijt');
  assert.equal(s.row.includes(30), false, 'de tegel kwam niet van de grill');
});

test('kunnen kiezen tussen grill en afpakken', () => {
  const [s, rnd] = rig(['A', 'B'], [
    [5, 5, 5, 5, 5, 1, 1, 1],
    [W, 1, 1],
  ]);
  s.players[1].stack = [30]; // B heeft 30 bovenop; 30 ligt dus niet op de grill
  s.row = s.row.filter((n) => n !== 30);
  E.roll(s, 0, rnd);
  E.keep(s, 0, 5);
  E.roll(s, 0, rnd);
  E.keep(s, 0, W); // 30
  assert.equal(E.actor(s).kind, 'roll');
  E.stop(s, 0);
  const c = E.actor(s);
  assert.equal(c.kind, 'choose');
  assert.equal(c.options.length, 2);
  assert.deepEqual(c.options[0], { kind: 'row', tile: 29 });
  assert.deepEqual(c.options[1], { kind: 'steal', seat: 1, tile: 30 });
  E.choose(s, 0, 1);
  assert.deepEqual(s.players[0].stack, [30]);
  assert.deepEqual(s.players[1].stack, []);
});

test('mislukken: bovenste tegel terug en de hoogste van de grill uit het spel', () => {
  const [s, rnd] = rig(['A', 'B'], [[2, 2, 3, 3, 3, 3, 3, 3], [2, 2, 2, 2, 2, 2]]);
  s.players[0].stack = [24];
  s.row = [22, 23, 25, 26];
  E.roll(s, 0, rnd);
  E.keep(s, 0, 2);
  E.roll(s, 0, rnd); // mislukt
  assert.deepEqual(s.players[0].stack, [], 'tegel 24 ingeleverd');
  assert.deepEqual(s.row, [22, 23, 24, 25], 'de 24 staat weer op zijn plek, 26 is weg');
  assert.deepEqual(s.gone, [26]);
});

test('mislukken zonder eigen tegel haalt alleen de hoogste van de grill weg', () => {
  const [s, rnd] = rig(['A', 'B'], [[2, 2, 3, 3, 3, 3, 3, 3], [2, 2, 2, 2, 2, 2]]);
  s.row = [21, 22, 23];
  E.roll(s, 0, rnd);
  E.keep(s, 0, 2);
  E.roll(s, 0, rnd);
  assert.deepEqual(s.row, [21, 22]);
  assert.deepEqual(s.gone, [23]);
});

test('is de teruggelegde tegel de hoogste, dan verdwijnt er niets', () => {
  const [s, rnd] = rig(['A', 'B'], [[2, 2, 3, 3, 3, 3, 3, 3], [2, 2, 2, 2, 2, 2]]);
  s.players[0].stack = [30];
  s.row = [21, 22];
  E.roll(s, 0, rnd);
  E.keep(s, 0, 2);
  E.roll(s, 0, rnd);
  assert.deepEqual(s.row, [21, 22, 30], 'de 30 is de hoogste en blijft liggen');
  assert.deepEqual(s.gone, []);
});

test('alle acht dobbels vast: de beurt wordt meteen beslist', () => {
  const [s, rnd] = rig(['A', 'B'], [
    [W, W, W, W, 1, 1, 1, 1],
    [3, 3, 3, 3],
  ]);
  E.roll(s, 0, rnd);
  E.keep(s, 0, W); // 4 woezels = 20
  E.roll(s, 0, rnd);
  assert.equal(E.actor(s).diceLeft, 4, 'vier woezels vast, vier dobbels over');
  E.keep(s, 0, 3); // 20 + 12 = 32, alle acht liggen vast
  assert.deepEqual(s.players[0].stack, [32], 'automatisch afgehandeld');
  assert.equal(s.turn, 1);
});

test('alle acht vast zonder woezel mislukt automatisch', () => {
  const [s, rnd] = rig(['A', 'B'], [
    [1, 1, 1, 1, 3, 3, 3, 3],
    [2, 2, 2, 2],
  ]);
  E.roll(s, 0, rnd);
  E.keep(s, 0, 1);
  E.roll(s, 0, rnd);
  E.keep(s, 0, 2);
  assert.ok(s.bust, 'geen woezel, dus mislukt');
  assert.equal(s.bust.reason, 'geen woezel');
});

test('te laag voor elke tegel = mislukt', () => {
  const [s, rnd] = rig(['A', 'B'], [[W, 1, 1, 1, 1, 1, 1, 1]]);
  s.row = [30, 31];
  E.roll(s, 0, rnd);
  E.keep(s, 0, W); // 5 punten, met woezel
  assert.equal(E.actor(s).canStop, false);
  E.stop(s, 0);
  assert.equal(s.bust.reason, 'niets te pakken');
});

test('alleen wie aan de beurt is mag iets doen', () => {
  const [s, rnd] = rig(['A', 'B'], [[1, 2, 3, 4, 5, W, 1, 1]]);
  assert.throws(() => E.roll(s, 1, rnd), E.GameError);
  E.roll(s, 0, rnd);
  assert.throws(() => E.keep(s, 1, 1), E.GameError);
  assert.throws(() => E.stop(s, 1), E.GameError);
});

test('het spel eindigt als de grill leeg is; de meeste woezels wint', () => {
  const [s, rnd] = rig(['A', 'B'], [[W, W, W, W, W, W, 1, 1]]);
  s.row = [21];
  s.players[0].stack = [36]; // 4 woezels
  s.players[1].stack = [25, 26]; // 2 + 2 = 4 woezels
  E.roll(s, 0, rnd);
  E.keep(s, 0, W); // 6 woezels = 30 punten
  E.stop(s, 0); // pakt de laatste tegel: 21
  assert.equal(s.phase, 'gameOver');
  assert.equal(E.wormCount(s.players[0]), 5, '36 plus de 21');
  assert.equal(E.wormCount(s.players[1]), 4);
  assert.deepEqual(s.winners, ['p0']);
});

test('een compleet potje loopt niet vast', () => {
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let potje = 0; potje < 40; potje++) {
    const s = E.newGame();
    ['A', 'B', 'C'].forEach((n, i) => E.addPlayer(s, 'p' + i, n));
    E.startGame(s);
    let guard = 0;
    while (s.phase === 'turn' && guard++ < 5000) {
      const a = E.actor(s);
      assert.ok(a, 'er is altijd iemand aan zet');
      if (a.kind === 'choose') {
        E.choose(s, a.seat, a.options.length - 1); // liever afpakken
        continue;
      }
      if (a.kind === 'keep') {
        // pak de waarde die het meeste oplevert, maar neem een woezel als je die nog niet hebt
        const opts = a.choosable;
        const best = opts.reduce((x, y) => {
          const w = (v) => (v === W && !a.worm ? 1000 : E.pips(v) * s.dice.filter((d) => d === v).length);
          return w(y) > w(x) ? y : x;
        });
        E.keep(s, a.seat, best);
        continue;
      }
      // aan zet om te gooien of te stoppen
      if (a.canStop && a.score >= 25) E.stop(s, a.seat);
      else if (a.canRoll) E.roll(s, a.seat, rnd);
      else E.stop(s, a.seat); // niets anders mogelijk: mislukt
    }
    assert.equal(s.phase, 'gameOver', `potje ${potje} liep niet af`);
    assert.equal(s.row.length, 0);
    // elke tegel is óf bij een speler, óf uit het spel
    const held = s.players.reduce((n, p) => n + p.stack.length, 0);
    assert.equal(held + s.gone.length, 16, `potje ${potje}: tegels kwijt`);
  }
});
