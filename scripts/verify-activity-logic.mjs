// Rauchtest für die reine Activity-Logik. Aufruf: node scripts/verify-activity-logic.mjs
import assert from 'node:assert/strict';
import {
    movesFor, applyMoves, drawFromDeck, pickWatchers, dealTeams, rankOf, typeAt, typeFor,
    OPEN_OWN, OPEN_OTHER, OPEN_ACTOR, WATCHER_BONUS,
} from '../src/games/activityLogic.js';

const GOAL = 25;
const base = { three: false, open: false, team: 'red', difficulty: 4 };

// Normaler Versuch: eigenes Team zieht die Stufe.
assert.deepEqual(movesFor(base, { kind: 'erraten' }), [['red', 4]]);
assert.deepEqual(movesFor(base, { kind: 'zeit' }), []);
// Offene Runde.
assert.deepEqual(movesFor({ ...base, open: true }, { kind: 'erraten', winner: 'red' }), [['red', OPEN_OWN]]);
assert.deepEqual(movesFor({ ...base, open: true }, { kind: 'erraten', winner: 'blue' }), [['blue', OPEN_OTHER], ['red', OPEN_ACTOR]]);
// Drei-Spieler-Modus: Rater Stufe, Darsteller Stufe - 1, Aufpasser-Bonus.
const three = { ...base, three: true, difficulty: 3, watcherTeams: ['green'] };
assert.deepEqual(movesFor(three, { kind: 'erraten', winner: 'blue' }), [['blue', 3], ['red', 2]]);
assert.deepEqual(movesFor(three, { kind: 'zeit' }), [['green', WATCHER_BONUS]]);
assert.deepEqual(movesFor(three, { kind: 'aufgegeben' }), []);

// Rückschicken: fremde Figur auf dem Zielfeld geht eins zurück, ohne Kette.
assert.deepEqual(applyMoves({ red: 2, blue: 6, green: 5 }, [['red', 4]], GOAL, false), { red: 6, blue: 5, green: 5 });
// Nicht auf dem Ziel, nicht im Drei-Spieler-Modus, Ziel wird gedeckelt.
assert.deepEqual(applyMoves({ red: 23, blue: 25 }, [['red', 5]], GOAL, false), { red: 25, blue: 25 });
assert.deepEqual(applyMoves({ red: 2, blue: 6 }, [['red', 4]], GOAL, true), { red: 6, blue: 6 });
// Von Feld 1 zurück auf Start ist erlaubt, darunter nicht.
assert.deepEqual(applyMoves({ red: 0, blue: 1 }, [['red', 1]], GOAL, false), { red: 1, blue: 0 });

// Stapel: jede Karte genau einmal, dann neu gemischt ohne sofortige Wiederholung.
let deck = null;
const seen = new Set();
for (let i = 0; i < 5; i++) { const r = drawFromDeck(deck, 5); deck = r.deck; seen.add(r.index); }
assert.equal(seen.size, 5);
for (let k = 0; k < 50; k++) {
    const last = deck.order[4];
    const r = drawFromDeck({ ...deck, ptr: 5 }, 5);
    assert.notEqual(r.index, last);
}

// Aufpasser.
const teams = { red: ['a', 'b'], blue: ['c', 'd'], green: ['e', 'f'] };
const present = () => true;
const ctx = { teams, present, watchCount: {}, teamWatchCount: {}, actorTeam: 'red', three: false, open: false, type: 'DRAW' };
assert.deepEqual(pickWatchers({ ...ctx, mode: 'OPPONENTS' }).watchers.sort(), ['c', 'd', 'e', 'f']);
assert.equal(pickWatchers({ ...ctx, mode: 'ONE_PLAYER' }).watchers.length, 1);
assert.equal(pickWatchers({ ...ctx, mode: 'ONE_TEAM', teamWatchCount: { blue: 1 } }).watchers.join(), 'e,f');
assert.deepEqual(pickWatchers({ ...ctx, mode: 'OPPONENTS', open: true }).watchers, []);
assert.equal(pickWatchers({ ...ctx, mode: 'OPPONENTS', open: true, type: 'EXPLAIN' }).watchers.length, 1);
const t3 = { red: ['a'], blue: ['b'], green: ['c'] };
const w3 = pickWatchers({ ...ctx, teams: t3, three: true, mode: 'ONE_PLAYER', type: 'EXPLAIN', watchCount: { b: 1 } });
assert.deepEqual(w3, { watchers: ['c'], guesser: 'b' });
assert.deepEqual(pickWatchers({ ...ctx, teams: t3, three: true, mode: 'ONE_PLAYER', type: 'MIME' }).watchers, []);

// Sonstiges.
const dealt = dealTeams(['1', '2', '3', '4', '5'], 2);
assert.equal(dealt.red.length + dealt.blue.length, 5);
assert.equal(rankOf(5, [7, 5, 5, 2]), 2);
assert.deepEqual([0, 1, 2, 3].map(typeAt), ['DRAW', 'MIME', 'EXPLAIN', 'DRAW']);

// Gemiedene Karten (schon gesehen) kommen erst dran, wenn nichts anderes übrig ist.
{
    const avoid = (x) => x !== 3;
    const r = drawFromDeck(undefined, 5, Math.random, avoid);
    assert.equal(r.index, 3);
    assert.equal(new Set(r.deck.order).size, 5);
    const rest = new Set();
    let d = r.deck;
    for (let i = 0; i < 4; i++) { const n = drawFromDeck(d, 5, Math.random, () => true); d = n.deck; rest.add(n.index); }
    assert.equal(rest.size, 4);
    assert.ok(!rest.has(3));
}
// Startfeld: alle drei Typen kommen vor, danach entscheidet das Feld.
{
    const types = new Set(Array.from({ length: 60 }, () => typeFor(0)));
    assert.equal(types.size, 3);
    assert.equal(typeFor(4), typeAt(4));
}
console.log('OK — Activity-Logik verhält sich wie erwartet.');
