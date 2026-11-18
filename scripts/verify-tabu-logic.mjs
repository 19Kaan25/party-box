// Rauchtest für die reine Tabu-Logik. Aufruf: node scripts/verify-tabu-logic.mjs
import assert from 'node:assert/strict';
import {
    scoreTurn, applyDelta, nextSide, pickExplainer, totalCycles, isGameOver, buildDeck, turnEntries, currentNr,
} from '../src/games/tabuLogic.js';
import { rankOf } from '../src/games/activityLogic.js';

const OK = { r: 'OK' }, SKIP = { r: 'SKIP' }, TABU = { r: 'TABU' };
const std = { skipPenalty: 0, tabuPenalty: -1 };

// Wertung: Standard (Überspringen 0, Tabu -1).
assert.deepEqual(scoreTurn({ entries: [OK, SKIP, TABU, OK], side: 'red', cfg: std }), { delta: { red: 1 }, explained: 2 });
// Strenge Variante: Überspringen -1.
assert.deepEqual(scoreTurn({ entries: [OK, SKIP, TABU], side: 'red', cfg: { skipPenalty: -1, tabuPenalty: -1 } }).delta, { red: -1 });
// Milde Variante: keine Strafen.
assert.deepEqual(scoreTurn({ entries: [SKIP, TABU, OK], side: 'red', cfg: { skipPenalty: 0, tabuPenalty: 0 } }).delta, { red: 1 });
// Offene letzte Karte verfällt …
assert.deepEqual(scoreTurn({ entries: [OK, null], side: 'red', cfg: std }).delta, { red: 1 });
// … oder wird geklaut.
assert.deepEqual(scoreTurn({ entries: [OK, null], side: 'red', cfg: std, steal: 'OK', stealSide: 'blue' }).delta, { red: 1, blue: 1 });
assert.deepEqual(scoreTurn({ entries: [OK, null], side: 'red', cfg: std, steal: 'MISS', stealSide: 'blue' }).delta, { red: 1 });
// Klauen greift nicht, wenn die letzte Karte in der Auswertung doch abgeschlossen wurde.
assert.deepEqual(scoreTurn({ entries: [OK, OK], side: 'red', cfg: std, steal: 'OK', stealSide: 'blue' }).delta, { red: 2 });

// Jeder gegen jeden: Erklärer und Ratender je +1, Strafen nur beim Erklärer.
assert.deepEqual(
    scoreTurn({ entries: [{ r: 'OK', g: 'b' }, { r: 'OK', g: 'c' }, TABU, { r: 'OK' }], side: 'a', solo: true, cfg: std }),
    { delta: { a: 2, b: 1, c: 1 }, explained: 3 },
);
// Zu Unrecht gebuzzert, in der Auswertung auf Richtig gestellt: der Buzzer (by) bekommt nichts.
assert.deepEqual(scoreTurn({ entries: [{ r: 'OK', by: 'b' }], side: 'a', solo: true, cfg: std }).delta, { a: 1 });
assert.deepEqual(applyDelta({ a: 3, b: 1 }, { a: -1, c: 2 }), { a: 2, b: 1, c: 2 });

// Reihenfolge: Umlauf endet erst nach der letzten Seite; Abwesende werden übersprungen.
const all = () => true;
assert.deepEqual(nextSide(['r', 'b', 'g'], null, all), { side: 'r', wrapped: false });
assert.deepEqual(nextSide(['r', 'b', 'g'], 'r', all), { side: 'b', wrapped: false });
assert.deepEqual(nextSide(['r', 'b', 'g'], 'g', all), { side: 'r', wrapped: true });
assert.deepEqual(nextSide(['r', 'b', 'g'], 'b', (s) => s !== 'g'), { side: 'r', wrapped: true });
assert.deepEqual(nextSide(['r', 'b', 'g'], 'r', (s) => s === 'r'), { side: 'r', wrapped: true });

// Erklärer reihum unter den Anwesenden.
assert.equal(pickExplainer(['x', 'y', 'z'], 0, all), 'x');
assert.equal(pickExplainer(['x', 'y', 'z'], 4, all), 'y');
assert.equal(pickExplainer(['x', 'y', 'z'], 1, (id) => id !== 'y'), 'z');
assert.equal(pickExplainer(['x'], 3, () => false), null);

// Spielende nur nach vollen Umläufen; Rundenzahl richtet sich nach dem größten Team.
assert.equal(totalCycles(2, { r: ['a', 'b'], b: ['c', 'd', 'e'] }), 6);
assert.equal(totalCycles(2, { a: ['a'], b: ['b'], c: ['c'] }), 2);
assert.equal(isGameOver({ scores: { r: 29, b: 30 }, cfg: { endMode: 'SCORE', target: 30 } }), true);
assert.equal(isGameOver({ scores: { r: 29, b: 12 }, cfg: { endMode: 'SCORE', target: 30 } }), false);
assert.equal(isGameOver({ scores: {}, cfg: { endMode: 'ROUNDS' }, cyclesDone: 5, cycles: 6 }), false);
assert.equal(isGameOver({ scores: {}, cfg: { endMode: 'ROUNDS' }, cyclesDone: 6, cycles: 6 }), true);

// Gleichstand teilt sich den Platz.
assert.equal(rankOf(10, [10, 10, 4]), 1);
assert.equal(rankOf(4, [10, 10, 4]), 3);

// Stapel: ungesehene zuerst, alle Karten genau einmal.
const words = ['A', 'B', 'C', 'D', 'E'];
const deck = buildDeck(words, new Set(['A', 'C']));
assert.deepEqual([...deck].sort(), [0, 1, 2, 3, 4]);
assert.deepEqual(new Set(deck.slice(0, 3).map((i) => words[i])), new Set(['B', 'D', 'E']));

// Karteneinträge und aktuelle Karte (Einträge tragen die Zugnummer).
const t = (e, n = 7) => ({ ...e, n });
assert.deepEqual(turnEntries({ 0: t(OK), 1: t(TABU) }, 3, 7), [t(OK), t(TABU), null]);
assert.deepEqual(turnEntries({ 0: t(OK), 1: t(TABU), 2: t(OK) }, 2, 7), [t(OK), t(TABU), t(OK)]);
assert.deepEqual(turnEntries({}, 0, 7), []);
// Auf "Zeit um" zurückgesetzt: bleibt in der Liste, zählt als offen.
assert.deepEqual(turnEntries({ 0: t(OK), 1: t({ r: null }) }, 2, 7), [t(OK), null]);
assert.equal(currentNr({ 0: t(OK), 1: t(SKIP) }, 7), 2);
assert.equal(currentNr({}, 7), 0);
// Verspätete Korrektur aus Zug 6 landet in Zug 7: wird ignoriert.
assert.deepEqual(turnEntries({ 0: t(SKIP, 6) }, 0, 7), []);
assert.equal(currentNr({ 0: t(SKIP, 6) }, 7), 0);

console.log('OK — Tabu-Logik verhält sich wie erwartet.');
