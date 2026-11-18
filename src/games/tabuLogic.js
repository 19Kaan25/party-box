/**
 * Tabu — reine Spiellogik ohne React und ohne Kartendaten, damit
 * scripts/verify-tabu-logic.mjs sie direkt unter Node prüfen kann.
 *
 * "Seite" = wer punktet: im Teams-Modus ein Team-Schlüssel (red/blue/…),
 * bei "Jeder gegen jeden" die Spieler-ID. So laufen Wertung, Reihenfolge und
 * Spielende für beide Modi durch denselben Code.
 */
import { shuffled } from './activityLogic.js';

export const MIN_PLAYERS = 3;
/** Teams-Modus erst ab 4 (zwei Teams à 2). */
export const MIN_TEAM_PLAYERS = 4;

/**
 * Punkte eines Zuges.
 *  entries: Liste der gezeigten Karten in Reihenfolge, je { r: 'OK'|'SKIP'|'TABU', g? } oder
 *           null (Karte lief bei Zeitablauf, nicht abgeschlossen).
 *  steal:   'OK' | 'MISS' | null — gilt nur für eine offene letzte Karte.
 * Rückgabe: { delta: { seite: punkte }, explained: erratene Karten des Erklärers }
 */
export function scoreTurn({ entries, side, solo, cfg, steal = null, stealSide = null }) {
    const delta = {};
    const add = (s, n) => { if (s && n) delta[s] = (delta[s] || 0) + n; };
    let explained = 0;
    entries.forEach((e, i) => {
        if (!e) {
            if (i === entries.length - 1 && steal === 'OK') add(stealSide, 1);
            return;
        }
        if (e.r === 'OK') {
            explained += 1;
            add(side, 1);
            // Jeder gegen jeden: Ratender (g) bekommt ebenfalls einen Punkt. Nicht `by` —
            // das ist der Buzzer, und ein zu Unrecht gebuzzerter Eintrag darf ihm nichts bringen.
            if (solo && e.g && e.g !== side) add(e.g, 1);
        } else if (e.r === 'SKIP') add(side, cfg.skipPenalty || 0);
        else if (e.r === 'TABU') add(side, cfg.tabuPenalty || 0);
    });
    return { delta, explained };
}

export const applyDelta = (scores, delta) => {
    const out = { ...scores };
    Object.entries(delta).forEach(([s, n]) => { out[s] = (out[s] || 0) + n; });
    return out;
};

/**
 * Nächste Seite nach `current`, übersprungen werden Seiten ohne anwesende Spieler.
 * wrapped = ein Umlauf ist damit vollständig (nur dann darf das Spiel enden).
 */
export function nextSide(order, current, isActive) {
    const start = current == null ? -1 : order.indexOf(current);
    for (let s = 1; s <= order.length; s++) {
        const idx = (start + s) % order.length;
        if (isActive(order[idx])) return { side: order[idx], wrapped: start >= 0 && idx <= start };
    }
    return { side: null, wrapped: true };
}

/** Erklärer einer Seite: reihum unter den Anwesenden. */
export function pickExplainer(members, count, isPresent) {
    const live = members.filter(isPresent);
    return live.length ? live[count % live.length] : null;
}

/**
 * Anzahl Umläufe bei Spielende "Rundenzahl": jeder erklärt `rounds`-mal; bei
 * ungleich großen Teams zählt das größte, damit alle Teams gleich viele Züge haben.
 */
export const totalCycles = (rounds, members) => rounds * Math.max(1, ...Object.values(members).map((m) => m.length));

/** Nur am Ende eines Umlaufs aufrufen. */
export function isGameOver({ scores, cfg, cyclesDone, cycles }) {
    if (cfg.endMode === 'ROUNDS') return cyclesDone >= cycles;
    return Object.values(scores).some((v) => v >= cfg.target);
}

/** Stapel der Partie: Indizes in den Pool, ungesehene Karten zuerst. */
export function buildDeck(words, seen, random = Math.random) {
    const all = shuffled([...words.keys()], random);
    return [...all.filter((i) => !seen.has(words[i])), ...all.filter((i) => seen.has(words[i]))];
}

/**
 * Karteneinträge eines Zuges. Jeder Eintrag trägt die Zugnummer `n`; Einträge mit
 * fremder Nummer (verspätete Korrektur aus dem Vorzug) zählen nicht. `shown` = beim
 * Zeitablauf gemerkte Kartenzahl, Ergebnisse jenseits davon zählen trotzdem mit.
 * Ein Eintrag mit r: null ist eine in der Auswertung auf "Zeit um" zurückgesetzte Karte.
 */
export function turnEntries(results = {}, shown = 0, n) {
    const own = Object.entries(results).filter(([, e]) => e && e.n === n);
    const byNr = Object.fromEntries(own);
    const len = Math.max(shown, 0, ...own.map(([k]) => Number(k) + 1));
    return Array.from({ length: len }, (_, i) => (byNr[i]?.r ? byNr[i] : null));
}

/** Erste noch offene Kartennummer dieses Zuges (Ergebnisse kommen lückenlos vom Erklärer). */
export const currentNr = (results = {}, n) => {
    let i = 0;
    while (results[i]?.r && results[i].n === n) i++;
    return i;
};
