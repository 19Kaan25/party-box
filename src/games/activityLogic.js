/**
 * Activity — reine Spiellogik ohne React und ohne Kartendaten, damit
 * scripts/verify-activity-logic.mjs sie direkt unter Node prüfen kann.
 * Eigene Datei auch wegen react-refresh (nur Komponenten-Exporte in .jsx).
 */

/** Darstellungsarten in der Reihenfolge, in der sie sich auf dem Brett abwechseln. */
export const TYPES = ['DRAW', 'MIME', 'EXPLAIN'];

export const MIN_PLAYERS = 3;
export const FIELDS_PER_AREA = 8;

/** Chance, dass ein Versuch eine offene Runde ist (statt roter Karte). */
export const OPEN_CHANCE = 1 / 6;
// Offene Runde in Team-Partien. Zahlen aus einer Sekundärquelle — die
// Originalanleitung ließ sich nicht maschinell lesen. Hier anpassen.
export const OPEN_OWN = 6;     // eigenes Team errät zuerst
export const OPEN_OTHER = 4;   // fremdes Team errät zuerst …
export const OPEN_ACTOR = 2;   // … und das Darsteller-Team bekommt trotzdem das
// Drei-Spieler-Modus: Rater bekommt die Stufe, der Darsteller Stufe minus das hier.
export const THREE_ACTOR_MALUS = 1;
/** Aufpasser im Drei-Spieler-Modus, wenn der Versuch an Zeit/Regelverstoß scheitert. */
export const WATCHER_BONUS = 1;

/** Nach 2 unberechtigten Meldungen ist das Melderecht weg. */
export const MAX_FALSE_REPORTS = 2;
/** Protokoll-Länge, damit der gameState klein bleibt. */
export const HISTORY_LIMIT = 20;

export const TEAM_KEYS = ['red', 'blue', 'green', 'yellow'];

/** Darstellungsart eines Feldes; das Startfeld (0) zählt wie ein Zeichnen-Feld. */
export const typeAt = (pos) => TYPES[pos % TYPES.length];

/** Fisher-Yates ohne Mutation. */
export function shuffled(list, random = Math.random) {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

/** Spieler gleichmäßig auf `count` Teams verteilen. */
export function dealTeams(ids, count, random = Math.random) {
    const teams = Object.fromEntries(TEAM_KEYS.slice(0, count).map((k) => [k, []]));
    shuffled(ids, random).forEach((id, i) => teams[TEAM_KEYS[i % count]].push(id));
    return teams;
}

/**
 * Nächste Karte aus einem Stapel ziehen. Ist er leer, wird neu gemischt —
 * so, dass die zuletzt gezogene Karte nicht gleich wieder oben liegt.
 * Rückgabe: { index, deck } mit dem fortgeschriebenen Stapel.
 */
export function drawFromDeck(deck, poolSize, random = Math.random, avoid = () => false) {
    let order = [...(deck?.order || [])];
    let ptr = deck?.ptr || 0;
    if (order.length !== poolSize || ptr >= order.length) {
        const last = order[ptr - 1];
        order = shuffled([...Array(poolSize).keys()], random);
        if (order.length > 1 && order[0] === last) [order[0], order[1]] = [order[1], order[0]];
        ptr = 0;
    }
    // Erste nicht zu meidende Karte nach vorn holen; die übersprungenen bleiben im Stapel.
    // Sind alle restlichen zu meiden, eben die nächste.
    let i = ptr;
    while (i < order.length && avoid(order[i])) i++;
    if (i < order.length) [order[ptr], order[i]] = [order[i], order[ptr]];
    return { index: order[ptr], deck: { order, ptr: ptr + 1 } };
}

/** Typ des Versuchs: auf dem Startfeld zufällig, sonst durch das Feld bestimmt. */
export function typeFor(position, random = Math.random) {
    return position === 0 ? TYPES[Math.floor(random() * TYPES.length)] : typeAt(position);
}

/** Wer am seltensten dran war, bei Gleichstand der Zufall. */
export function leastUsed(ids, counts, random = Math.random) {
    if (ids.length === 0) return null;
    const min = Math.min(...ids.map((id) => counts[id] || 0));
    const pool = ids.filter((id) => (counts[id] || 0) === min);
    return pool[Math.floor(random() * pool.length)];
}

/**
 * Aufpasser für einen Versuch bestimmen (nur der Host ruft das auf).
 *  - three: Drei-Spieler-Modus, nur bei Erklären ein Aufpasser, der andere
 *    ist Alleinrater.
 *  - offene Runde: genau ein Aufpasser, und auch nur bei Erklären.
 * Rückgabe: { watchers: [ids], guesser: id|null }
 */
export function pickWatchers({ mode, three, open, type, actorTeam, teams, present, watchCount, teamWatchCount }, random = Math.random) {
    const none = { watchers: [], guesser: null };
    if (mode === 'NONE') return none;
    const opponentTeams = Object.keys(teams).filter((k) => k !== actorTeam && teams[k].some(present));
    const opponents = opponentTeams.flatMap((k) => teams[k].filter(present));

    if (three) {
        if (type !== 'EXPLAIN' || opponents.length < 2) return none;
        const watcher = leastUsed(opponents, watchCount, random);
        return { watchers: [watcher], guesser: opponents.find((id) => id !== watcher) };
    }
    if (open) {
        return type === 'EXPLAIN' ? { watchers: [leastUsed(opponents, watchCount, random)].filter(Boolean), guesser: null } : none;
    }
    if (mode === 'OPPONENTS') return { watchers: opponents, guesser: null };
    if (mode === 'ONE_TEAM') {
        const team = leastUsed(opponentTeams, teamWatchCount, random);
        return { watchers: team ? teams[team].filter(present) : [], guesser: null };
    }
    // ONE_PLAYER
    return { watchers: [leastUsed(opponents, watchCount, random)].filter(Boolean), guesser: null };
}

/**
 * Feldbewegungen eines Versuchs als Liste [teamKey, felder] in der
 * Reihenfolge, in der sie gezogen werden.
 * result: { kind, winner } — winner ist bei offener Runde / Drei-Spieler-
 * Modus das Team (bzw. der Spieler-Team-Schlüssel), das zuerst erraten hat.
 */
export function movesFor(info, result) {
    const { three, open, team, difficulty: d, watcherTeams = [] } = info;
    const moves = [];
    if (result.kind === 'erraten') {
        if (three) {
            if (result.winner && result.winner !== team) moves.push([result.winner, d], [team, d - THREE_ACTOR_MALUS]);
        } else if (!open) {
            moves.push([team, d]);
        } else if (result.winner === team) {
            moves.push([team, OPEN_OWN]);
        } else if (result.winner) {
            moves.push([result.winner, OPEN_OTHER], [team, OPEN_ACTOR]);
        }
    } else if (three && (result.kind === 'zeit' || result.kind === 'regelverstoss')) {
        watcherTeams.forEach((t) => moves.push([t, WATCHER_BONUS]));
    }
    return moves.filter(([, n]) => n > 0);
}

/**
 * Bewegungen anwenden. Landet eine Figur auf einem Feld, auf dem schon
 * fremde Figuren stehen, wandern diese ein Feld zurück — nie vom/auf dem
 * Start, nie auf dem Ziel, ohne Kettenreaktion, nicht im Drei-Spieler-Modus.
 */
export function applyMoves(before, moves, goal, three) {
    const pos = { ...before };
    for (const [team, n] of moves) {
        pos[team] = Math.min(goal, (pos[team] || 0) + n);
        const landed = pos[team];
        if (three || landed <= 0 || landed >= goal) continue;
        Object.keys(pos).forEach((other) => {
            if (other !== team && pos[other] === landed) pos[other] = landed - 1;
        });
    }
    return pos;
}

/** Platz bei Gleichstand teilen (wie rankOf() im Sprücheklopfer). */
export function rankOf(value, values) {
    return values.filter((v) => v > value).length + 1;
}

/** 5/3/1 globale Punkte für Platz 1–3. */
export const globalPointsFor = (rank) => (rank === 1 ? 5 : rank === 2 ? 3 : rank === 3 ? 1 : 0);
