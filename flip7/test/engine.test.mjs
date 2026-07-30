import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';

/** Deterministische rng voor reproduceerbare shuffles. */
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Spel met een gestapelde deck: cards[0] wordt als eerste getrokken. */
function rig(names, cards) {
  const s = E.newGame();
  names.forEach((n, i) => E.addPlayer(s, 'p' + i, n));
  E.startRound(s, mulberry32(1));
  s.deck = cards.slice().reverse();
  s.discard = [];
  return s;
}

const num = (v) => ({ k: 'n', v });
const plus = (v) => ({ k: 'm', v });
const x2 = () => ({ k: 'm', op: 'x2' });
const act = (a) => ({ k: 'a', a });

test('deck heeft de juiste samenstelling', () => {
  const deck = E.createDeck();
  assert.equal(deck.length, 94);
  const numbers = deck.filter((c) => c.k === 'n');
  assert.equal(numbers.length, 79);
  assert.equal(numbers.filter((c) => c.v === 0).length, 1);
  for (let v = 1; v <= 12; v++) {
    assert.equal(numbers.filter((c) => c.v === v).length, v, `aantal ${v}-en`);
  }
  assert.equal(deck.filter((c) => c.k === 'm').length, 6);
  assert.equal(deck.filter((c) => c.k === 'a' && c.a === 'freeze').length, 3);
  assert.equal(deck.filter((c) => c.k === 'a' && c.a === 'flip3').length, 3);
  assert.equal(deck.filter((c) => c.k === 'a' && c.a === 'second').length, 3);
});

test('beurt gaat na één kaart naar de volgende speler', () => {
  const s = rig(['A', 'B'], [num(3), num(5)]);
  assert.equal(E.actor(s).seat, 0);
  E.hit(s, 0);
  assert.deepEqual(s.players[0].numbers, [3]);
  assert.equal(E.actor(s).seat, 1);
  E.hit(s, 1);
  assert.deepEqual(s.players[1].numbers, [5]);
  assert.equal(E.actor(s).seat, 0);
});

test('een speler die niet aan de beurt is krijgt een fout', () => {
  const s = rig(['A', 'B'], [num(3)]);
  assert.throws(() => E.hit(s, 1), E.GameError);
});

test('dubbele nummerkaart = kapot, 0 punten', () => {
  const s = rig(['A', 'B'], [num(9), num(2), num(9)]);
  E.hit(s, 0); // A: 9
  E.hit(s, 1); // B: 2
  E.hit(s, 0); // A: nog een 9 -> kapot
  assert.equal(s.players[0].status, 'busted');
  assert.equal(E.score(s.players[0]), 0);
  assert.equal(E.actor(s).seat, 1);
});

test('Second Chance vangt een dubbele kaart op en wordt verbruikt', () => {
  const s = rig(['A', 'B'], [act('second'), num(1), num(4), num(1), num(4), num(4)]);
  E.hit(s, 0); // A pakt Second Chance
  assert.equal(s.players[0].sc, true);
  E.hit(s, 1); // B: 1
  E.hit(s, 0); // A: 4
  E.hit(s, 1); // B: nog een 1 -> kapot (geen SC)
  assert.equal(s.players[1].status, 'busted');
  E.hit(s, 0); // A: nog een 4 -> SC gebruikt
  assert.equal(s.players[0].status, 'active');
  assert.equal(s.players[0].sc, false);
  assert.deepEqual(s.players[0].numbers, [4]);
  E.hit(s, 0); // A: nog een 4 -> nu wel kapot
  assert.equal(s.players[0].status, 'busted');
  assert.equal(s.phase, 'roundEnd');
});

test('Freeze zet een gekozen speler stil en bewaart de punten', () => {
  const s = rig(['A', 'B'], [num(6), num(8), act('freeze')]);
  E.hit(s, 0);
  E.hit(s, 1);
  E.hit(s, 0); // A trekt Freeze en moet kiezen
  const a = E.actor(s);
  assert.equal(a.kind, 'freeze');
  assert.equal(a.seat, 0);
  assert.deepEqual(a.targets, [0, 1]);
  E.chooseTarget(s, 0, 1);
  assert.equal(s.players[1].status, 'frozen');
  assert.equal(s.players[1].total === 0, true); // pas geteld aan het eind van de ronde
  assert.equal(E.actor(s).seat, 0); // B ligt eruit, A is weer aan de beurt
  E.stay(s, 0);
  assert.equal(s.phase, 'roundEnd');
  assert.equal(s.players[0].total, 6);
  assert.equal(s.players[1].total, 8);
});

test('Flip Three laat het doel drie kaarten trekken', () => {
  const s = rig(['A', 'B'], [act('flip3'), num(1), num(2), num(3), num(11)]);
  E.hit(s, 0);
  assert.equal(E.actor(s).kind, 'flip3');
  E.chooseTarget(s, 0, 1);
  assert.deepEqual(s.players[1].numbers, [1, 2, 3]);
  assert.equal(s.players[1].status, 'active');
  assert.equal(E.actor(s).seat, 1); // na de serie gaat de beurt normaal verder
});

test('Flip Three stopt zodra het doel kapot gaat', () => {
  const s = rig(['A', 'B'], [act('flip3'), num(5), num(5), num(7)]);
  E.hit(s, 0);
  E.chooseTarget(s, 0, 1);
  assert.equal(s.players[1].status, 'busted');
  assert.equal(s.deck.length, 1, 'de derde kaart is niet meer getrokken');
});

test('actiekaart binnen een Flip Three wordt na de serie opgelost', () => {
  const s = rig(['A', 'B'], [act('flip3'), num(1), act('freeze'), num(2), num(9)]);
  E.hit(s, 0);
  E.chooseTarget(s, 0, 1); // B trekt 1, Freeze, 2
  assert.deepEqual(s.players[1].numbers, [1, 2]);
  const a = E.actor(s);
  assert.equal(a.kind, 'freeze');
  assert.equal(a.seat, 1, 'B mag de Freeze uitdelen, want B trok hem');
  E.chooseTarget(s, 1, 1); // B bevriest zichzelf
  assert.equal(s.players[1].status, 'frozen');
});

test('dubbele Second Chance moet doorgegeven worden', () => {
  const s = rig(['A', 'B'], [act('second'), num(4), act('second')]);
  E.hit(s, 0);
  E.hit(s, 1);
  E.hit(s, 0);
  const a = E.actor(s);
  assert.equal(a.kind, 'second');
  assert.deepEqual(a.targets, [1], 'niet aan jezelf, en alleen aan wie er geen heeft');
  E.chooseTarget(s, 0, 1);
  assert.equal(s.players[1].sc, true);
});

test('dubbele Second Chance zonder ontvanger gaat op de aflegstapel', () => {
  const s = rig(['A', 'B'], [act('second'), act('second'), act('second')]);
  E.hit(s, 0); // A krijgt SC
  E.hit(s, 1); // B krijgt SC
  E.hit(s, 0); // A trekt nog een SC, B heeft er al een
  assert.equal(E.actor(s).kind, 'turn');
  assert.equal(s.discard.filter((c) => c.a === 'second').length, 1);
});

test('Flip 7 geeft 15 bonuspunten en beëindigt de ronde direct', () => {
  const s = rig(['A', 'B'], [num(1), num(2), num(3), num(4), num(5), num(6), num(7)]);
  for (let i = 0; i < 6; i++) E.hit(s, 0), assert.equal(s.phase, 'round'), (s.turn = 0);
  E.hit(s, 0);
  assert.equal(s.players[0].status, 'flip7');
  assert.equal(s.phase, 'roundEnd');
  assert.equal(s.players[0].total, 1 + 2 + 3 + 4 + 5 + 6 + 7 + 15);
  assert.equal(s.players[1].total, 0);
});

test('×2 verdubbelt alleen de nummerkaarten, plussen komen erna', () => {
  const p = { status: 'stayed', numbers: [3, 7], plus: [4], x2: true };
  assert.equal(E.score(p), (3 + 7) * 2 + 4);
  const q = { status: 'stayed', numbers: [], plus: [10], x2: true };
  assert.equal(E.score(q), 10);
  const r = { status: 'busted', numbers: [12], plus: [10], x2: true };
  assert.equal(E.score(r), 0);
});

test('spel eindigt zodra iemand de doelscore haalt', () => {
  const s = rig(['A', 'B'], [num(12), num(1)]);
  s.target = 10;
  E.hit(s, 0);
  E.stay(s, 1);
  E.stay(s, 0);
  assert.equal(s.phase, 'gameOver');
  assert.deepEqual(s.winners, ['p0']);
});

test('volgende ronde wisselt de startspeler en legt de kaarten af', () => {
  const s = rig(['A', 'B', 'C'], [num(12), num(11), num(10)]);
  E.hit(s, 0);
  E.hit(s, 1);
  E.hit(s, 2);
  E.stay(s, 0);
  E.stay(s, 1);
  E.stay(s, 2);
  assert.equal(s.phase, 'roundEnd');
  const before = s.deck.length + s.discard.length;
  E.nextRound(s, mulberry32(2));
  assert.equal(s.deck.length + s.discard.length, before + 3, 'de 3 kaarten zijn afgelegd');
  assert.equal(s.turn, 1);
  assert.deepEqual(s.players[0].numbers, []);
});

test('leeg deck wordt uit de aflegstapel opnieuw geschud', () => {
  const s = rig(['A', 'B'], [num(3)]);
  s.discard = [num(8), num(9)];
  E.hit(s, 0); // pakt de laatste kaart
  assert.equal(s.deck.length, 0);
  E.hit(s, 1); // moet reshuffelen
  assert.equal(s.players[1].numbers.length, 1);
  assert.equal(s.deck.length, 1);
});

test('volledig potje met echte shuffle loopt niet vast', () => {
  const rnd = mulberry32(42);
  const s = E.newGame({ target: 200 });
  ['A', 'B', 'C', 'D'].forEach((n, i) => E.addPlayer(s, 'p' + i, n));
  E.startRound(s, rnd);
  let guard = 0;
  while (s.phase !== 'gameOver' && guard++ < 5000) {
    if (s.phase === 'roundEnd') {
      E.nextRound(s, rnd);
      continue;
    }
    const a = E.actor(s);
    assert.ok(a, 'er is altijd iemand aan zet');
    if (a.kind === 'turn') {
      // eenvoudige strategie: doorgaan tot 3 kaarten
      if (s.players[a.seat].numbers.length < 3) E.hit(s, a.seat, rnd);
      else E.stay(s, a.seat, rnd);
    } else {
      E.chooseTarget(s, a.seat, a.targets[a.targets.length - 1], rnd);
    }
  }
  assert.equal(s.phase, 'gameOver');
  assert.ok(guard < 5000, 'geen oneindige lus');
  assert.ok(Math.max(...s.players.map((p) => p.total)) >= 200);
  // alle 94 kaarten zijn nog in omloop
  const held = s.players.reduce(
    (n, p) => n + p.numbers.length + p.plus.length + (p.x2 ? 1 : 0) + (p.sc ? 1 : 0),
    0,
  );
  assert.equal(s.deck.length + s.discard.length + held, 94);
});
