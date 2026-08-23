/* Wortpool-Helfer, von beiden Imposter-Modi genutzt.
 * Eigene Datei, weil react-refresh in einer Komponenten-Datei keine
 * zusaetzlichen Exporte erlaubt. */

import { IMPOSTER_CATEGORIES } from '../constants/gameData.js';

/** Wortpool aus den gewaehlten Kategorien. 'custom' zieht die Lobby-Woerter dazu. */
export function buildWordPool(selectedCategories = [], customWords = []) {
    let pool = [];
    selectedCategories.forEach(catId => {
        if (catId === 'custom') {
            pool = [...pool, ...customWords];
        } else if (IMPOSTER_CATEGORIES[catId]) {
            pool = [...pool, ...IMPOSTER_CATEGORIES[catId].words];
        }
    });
    return pool;
}

/** Anzeigename der Kategorie, aus der ein Wort stammt (fuer den Imposter-Hinweis). */
export function categoryNameOfWord(word, selectedCategories = []) {
    const cat = Object.values(IMPOSTER_CATEGORIES)
        .find(c => selectedCategories.includes(c.id) && c.words.includes(word));
    return cat ? cat.name : 'Eigene Wörter';
}

/** Hoechstplatzierte Person(en) der einzigen Abstimmung ermitteln. */
export function resolveImposterVote(votes = {}, voterKeys = [], candidateKeys = []) {
    const voters = new Set(voterKeys);
    const candidates = new Set(candidateKeys);
    const counts = new Map();

    Object.entries(votes).forEach(([voter, target]) => {
        if (!voters.has(voter) || !candidates.has(target)) return;
        counts.set(target, (counts.get(target) || 0) + 1);
    });

    const highest = Math.max(0, ...counts.values());
    const tiedKeys = [...counts.entries()]
        .filter(([, count]) => count === highest)
        .map(([key]) => key);

    return {
        voteCount: [...counts.values()].reduce((sum, count) => sum + count, 0),
        targetKey: highest > 0 && tiedKeys.length === 1 ? tiedKeys[0] : null,
        tiedKeys: highest > 0 && tiedKeys.length > 1 ? tiedKeys : [],
    };
}

/** Bei Gleichstand entscheidet das Los unter den Hoechstplatzierten. */
export function chooseImposterVoteTarget(result, fallbackKey = null) {
    if (result?.targetKey) return result.targetKey;
    if (!result?.tiedKeys?.length) return fallbackKey;
    return result.tiedKeys[Math.floor(Math.random() * result.tiedKeys.length)];
}

/**
 * Punkte der Runde nach der einmaligen Abstimmung.
 * Rueckgabe als Objekt, damit sie direkt serialisierbar und leicht testbar ist.
 */
export function calculateImposterPoints(playerKeys = [], imposterKeys = [], votedOutKey, guessedCorrect = false) {
    const imposters = new Set(imposterKeys);
    const caught = imposters.has(votedOutKey);
    const points = {};

    imposterKeys.forEach((key) => {
        if (key === votedOutKey) return;
        points[key] = imposterKeys.length > 1 ? 2 : 4;
    });

    if (caught) {
        playerKeys.forEach((key) => {
            if (!imposters.has(key)) points[key] = (points[key] || 0) + 2;
        });
        if (guessedCorrect) points[votedOutKey] = (points[votedOutKey] || 0) + 4;
    }

    return points;
}
