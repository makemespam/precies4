import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';

/** Genoeg nepwoorden om te kunnen spelen. */
function lijst(n = 40) {
  return Array.from({ length: n }, (_, i) => ({
    w: 'woord' + i,
    b: `de betekenis van nummer ${i} met een houten plank erin`,
  }));
}

function rig(namen, opts = {}) {
  const s = E.newGame({ woorden: lijst(opts.n ?? 40), rondes: opts.rondes ?? 10 });
  namen.forEach((naam, i) => E.addPlayer(s, 'p' + i, naam));
  E.startGame(s);
  return s;
}

/* --------------------------------------------- de regel van de kiezer */

test('de kiezer mag alleen woorden uit de omschrijving gebruiken', () => {
  const b = 'dikke plank overlangs buiten op een houten scheepsromp, tegen stoten';
  assert.deepEqual(E.verbodenWoorden('dikke plank tegen stoten', b), []);
  assert.deepEqual(E.verbodenWoorden('een plank op de romp', b), ['romp'], 'romp staat er niet los in');
  assert.deepEqual(E.verbodenWoorden('plank om de boot te beschermen', b), ['boot', 'beschermen']);
});

test('lidwoorden en voorzetsels mogen er altijd bij', () => {
  const b = 'plank langs een gevel';
  assert.deepEqual(E.verbodenWoorden('de plank onder in het van tot bij een gevel', b), []);
});

test('hoofdletters en leestekens tellen niet mee', () => {
  const b = 'Het kleinste botje van de schedel, in de binnenste ooghoek.';
  assert.deepEqual(E.verbodenWoorden('KLEINSTE BOTJE van de SCHEDEL!', b), []);
});

/* ---------------------------------------------------------- beurtverloop */

test('de kiezer krijgt 15 woorden zonder betekenis', () => {
  const s = rig(['A', 'B', 'C']);
  assert.equal(s.phase, 'kiezen');
  assert.equal(s.hand.length, 15);
  const view = E.viewFor(s, 1);
  assert.equal(view.hand.length, 15);
  assert.equal(typeof view.hand[0], 'string', 'alleen het woord, geen betekenis');
  assert.equal(view.woord, null);
});

test('alleen het gekozen woord raakt op, de andere veertien komen terug', () => {
  const s = rig(['A', 'B']);
  const voor = s.pool.length;
  E.kies(s, 0, 3);
  assert.equal(s.pool.length, voor - 1, 'precies één woord verbruikt');
  assert.equal(s.phase, 'schrijven');
});

test('alleen de kiezer kiest, en alleen uit zijn eigen vijftien', () => {
  const s = rig(['A', 'B']);
  assert.throws(() => E.kies(s, 1, 0), /niet de kiezer/);
  assert.throws(() => E.kies(s, 0, 99), /ligt er niet/);
});

test('de echte omschrijving blijft bij de kiezer tot de uitslag', () => {
  const s = rig(['A', 'B', 'C']);
  E.kies(s, 0, 0);
  assert.ok(E.viewFor(s, 0).woord.b, 'de kiezer ziet de betekenis');
  assert.equal(E.viewFor(s, 1).woord.b, undefined, 'de rest niet');
  assert.ok(E.viewFor(s, 1).woord.w, 'het woord zelf wel');
});

test('de kiezer wordt op de regel afgerekend, de rest niet', () => {
  const s = rig(['A', 'B']);
  E.kies(s, 0, 0);
  assert.throws(() => E.schrijf(s, 0, 'een volstrekt eigen verzinsel'), /staan niet in het boek/);
  E.schrijf(s, 0, 'de betekenis met een houten plank');
  E.schrijf(s, 1, 'iets totaal anders wat ik zelf verzin');
  assert.equal(s.entries.length, 2);
});

test('twee keer inleveren mag niet', () => {
  const s = rig(['A', 'B', 'C']);
  E.kies(s, 0, 0);
  E.schrijf(s, 1, 'mijn verzinsel');
  assert.throws(() => E.schrijf(s, 1, 'nog een'), /al ingeleverd/);
});

test('zodra iedereen heeft ingeleverd wordt er gestemd', () => {
  const s = rig(['A', 'B', 'C']);
  E.kies(s, 0, 0);
  E.schrijf(s, 0, 'de betekenis met een plank');
  E.schrijf(s, 1, 'verzinsel van B');
  assert.equal(s.phase, 'schrijven');
  E.schrijf(s, 2, 'verzinsel van C');
  assert.equal(s.phase, 'stemmen');
  assert.equal(s.order.length, 3, 'alle drie geschud');
});

test('bij het stemmen zie je niet van wie iets is, wel welke van jou is', () => {
  const s = rig(['A', 'B', 'C']);
  E.kies(s, 0, 0);
  E.schrijf(s, 0, 'de betekenis met een plank');
  E.schrijf(s, 1, 'verzinsel van B');
  E.schrijf(s, 2, 'verzinsel van C');
  const view = E.viewFor(s, 1);
  assert.equal(view.entries.length, 3);
  assert.equal(view.entries.every((e) => e.seat === undefined), true, 'geen namen');
  assert.equal(view.entries.filter((e) => e.mijn).length, 1, 'wel je eigen inzending');
  assert.equal(view.entries.every((e) => e.echt === undefined), true, 'en niet welke echt is');
});

test('de kiezer stemt niet en op je eigen inzending stemmen mag niet', () => {
  const s = rig(['A', 'B', 'C']);
  E.kies(s, 0, 0);
  E.schrijf(s, 0, 'de betekenis met een plank');
  E.schrijf(s, 1, 'verzinsel van B');
  E.schrijf(s, 2, 'verzinsel van C');
  const eigenB = s.entries.find((e) => e.seat === 1).id;
  assert.throws(() => E.stem(s, 0, eigenB), /weet het antwoord al/);
  assert.throws(() => E.stem(s, 1, eigenB), /eigen omschrijving/);
});

test('punten: twee voor de echte, één per stem op je verzinsel', () => {
  const s = rig(['A', 'B', 'C', 'D']);
  E.kies(s, 0, 0);
  E.schrijf(s, 0, 'de betekenis met een plank'); // A is kiezer, dit is de echte
  E.schrijf(s, 1, 'verzinsel van B');
  E.schrijf(s, 2, 'verzinsel van C');
  E.schrijf(s, 3, 'verzinsel van D');
  const id = (seat) => s.entries.find((e) => e.seat === seat).id;

  E.stem(s, 1, id(0)); // B vindt de echte
  E.stem(s, 2, id(1)); // C trapt in die van B
  E.stem(s, 3, id(1)); // D ook
  assert.equal(s.phase, 'uitslag');

  assert.equal(s.players[1].score, 2 + 2, 'B: 2 voor goed raden, 2 voor twee stemmen');
  assert.equal(s.players[2].score, 0);
  assert.equal(s.players[3].score, 0);
  assert.equal(s.players[0].score, 2, 'kiezer: 2 missers, maar het plafond is 2');
});

test('de bonus voor de kiezer is niet hoger dan twee', () => {
  const s = rig(['A', 'B', 'C', 'D', 'E']);
  E.kies(s, 0, 0);
  E.schrijf(s, 0, 'de betekenis met een plank');
  for (const seat of [1, 2, 3, 4]) E.schrijf(s, seat, 'verzinsel van speler ' + seat);
  const id = (seat) => s.entries.find((e) => e.seat === seat).id;
  E.stem(s, 1, id(2));
  E.stem(s, 2, id(1));
  E.stem(s, 3, id(1));
  E.stem(s, 4, id(1));
  assert.equal(s.players[0].score, 2, 'vier missers, toch maar 2');
  assert.equal(s.players[1].score, 3, 'drie stemmen op zijn verzinsel');
});

test('bij de uitslag ziet iedereen wie wat schreef en wat het echt betekent', () => {
  const s = rig(['A', 'B', 'C']);
  E.kies(s, 0, 0);
  E.schrijf(s, 0, 'de betekenis met een plank');
  E.schrijf(s, 1, 'verzinsel van B');
  E.schrijf(s, 2, 'verzinsel van C');
  E.stem(s, 1, s.entries.find((e) => e.seat === 2).id);
  E.stem(s, 2, s.entries.find((e) => e.seat === 0).id);
  const view = E.viewFor(s, 1);
  assert.ok(view.woord.b, 'nu ziet iedereen de echte betekenis');
  assert.equal(view.entries.every((e) => e.seat !== undefined), true);
  assert.equal(view.uitslag.regels.find((r) => r.echt).stemmen, 1);
});

test('de beurt om te kiezen gaat rond', () => {
  const s = rig(['A', 'B', 'C']);
  const speelRonde = (kiezer) => {
    E.kies(s, kiezer, 0);
    for (const seat of [0, 1, 2]) {
      E.schrijf(s, seat, seat === kiezer ? 'de betekenis met een plank' : 'verzinsel ' + seat);
    }
    for (const seat of [0, 1, 2]) {
      if (seat === kiezer) continue;
      const ander = s.entries.find((e) => e.seat !== seat).id;
      E.stem(s, seat, ander);
    }
    E.volgende(s);
  };
  speelRonde(0);
  assert.equal(s.chooser, 1);
  speelRonde(1);
  assert.equal(s.chooser, 2);
  speelRonde(2);
  assert.equal(s.chooser, 0);
  assert.equal(s.ronde, 4);
});

test('het spel stopt als de rondes op zijn', () => {
  const s = rig(['A', 'B'], { rondes: 2 });
  for (let r = 0; r < 2; r++) {
    const kiezer = s.chooser;
    E.kies(s, kiezer, 0);
    E.schrijf(s, kiezer, 'de betekenis met een plank');
    E.schrijf(s, 1 - kiezer, 'verzinsel');
    E.stem(s, 1 - kiezer, s.entries.find((e) => e.seat === kiezer).id);
    E.volgende(s);
  }
  assert.equal(s.phase, 'gameOver');
  assert.ok(s.winners.length >= 1);
});

test('het spel stopt ook als de voorraad op raakt', () => {
  const s = rig(['A', 'B'], { n: 16, rondes: 50 });
  assert.equal(s.pool.length, 16);
  const ronde = () => {
    const kiezer = s.chooser;
    E.kies(s, kiezer, 0);
    E.schrijf(s, kiezer, 'de betekenis met een plank');
    E.schrijf(s, 1 - kiezer, 'verzinsel');
    E.stem(s, 1 - kiezer, s.entries.find((e) => e.seat === kiezer).id);
    E.volgende(s);
  };
  ronde();
  assert.equal(s.phase, 'kiezen', 'met 15 over kan er nog precies één hand gelegd worden');
  assert.equal(s.pool.length, 15);
  ronde();
  assert.equal(s.phase, 'gameOver', 'met 14 over niet meer');
});

test('een compleet potje met vier spelers loopt niet vast', () => {
  let seed = 99;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const s = E.newGame({ woorden: lijst(120), rondes: 8 });
  ['A', 'B', 'C', 'D'].forEach((n, i) => E.addPlayer(s, 'p' + i, n));
  E.startGame(s, rnd);

  let guard = 0;
  while (s.phase !== 'gameOver' && guard++ < 500) {
    const a = E.actor(s);
    if (s.phase === 'uitslag') {
      E.volgende(s, rnd);
      continue;
    }
    if (a.kind === 'kiezen') {
      E.kies(s, a.seat, Math.floor(rnd() * s.hand.length));
      continue;
    }
    if (a.kind === 'schrijven') {
      const seat = a.wachtOp[0];
      E.schrijf(s, seat, seat === s.chooser ? 'de betekenis met een plank' : 'verzinsel ' + seat);
      continue;
    }
    const seat = a.wachtOp[0];
    const opties = s.entries.filter((e) => e.seat !== seat);
    E.stem(s, seat, opties[Math.floor(rnd() * opties.length)].id);
  }
  assert.equal(s.phase, 'gameOver');
  assert.ok(guard < 500, 'geen oneindige lus');
  assert.equal(s.ronde, 8);
  assert.equal(s.pool.length, 120 - 8, 'acht woorden verbruikt');
});
