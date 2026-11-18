// Anzeige-Konstanten für Activity — eigene Datei wegen react-refresh
// (eine .jsx-Datei darf nur Komponenten exportieren).
import { Pencil, PersonStanding, MessageCircle } from 'lucide-react';
import { TEAM_KEYS } from './activityLogic';

/** Darstellungsarten: Farbe + Symbol + Text (nicht nur Farbe, Farbfehlsichtigkeit). */
export const TYPE_INFO = {
    DRAW: { label: 'Zeichnen', Icon: Pencil, cell: 'bg-sky-500/25 border-sky-400/60 text-sky-200', text: 'text-sky-300' },
    MIME: { label: 'Pantomime', Icon: PersonStanding, cell: 'bg-amber-500/25 border-amber-400/60 text-amber-200', text: 'text-amber-300' },
    EXPLAIN: { label: 'Erklären', Icon: MessageCircle, cell: 'bg-emerald-500/25 border-emerald-400/60 text-emerald-200', text: 'text-emerald-300' },
};

/** Teams: Farbe + eigene Form, damit sie auch ohne Farbsehen unterscheidbar sind. */
export const TEAM_INFO = {
    red: { label: 'Rot', fill: '#ef4444', text: 'text-red-400', ring: 'border-red-500', bg: 'bg-red-500' },
    blue: { label: 'Blau', fill: '#3b82f6', text: 'text-blue-400', ring: 'border-blue-500', bg: 'bg-blue-500' },
    green: { label: 'Grün', fill: '#22c55e', text: 'text-green-400', ring: 'border-green-500', bg: 'bg-green-500' },
    yellow: { label: 'Gelb', fill: '#eab308', text: 'text-yellow-400', ring: 'border-yellow-500', bg: 'bg-yellow-500' },
};

export const CATEGORY_NAMES = {
    alltag: 'Alltag & Essen',
    tiere_natur: 'Tiere & Natur',
    freizeit_kultur: 'Freizeit & Kultur',
};

/** Effektive Einstellungen inkl. Standardwerte (hängen teils am Drei-Spieler-Modus). */
export function effectiveSetup(setup = {}, three) {
    return {
        teamCount: setup.teamCount ?? 2,
        teams: setup.teams || {},
        categories: setup.categories ?? Object.keys(CATEGORY_NAMES),
        watcher: setup.watcher ?? (three ? 'ONE_PLAYER' : 'OPPONENTS'),
        skips: setup.skips ?? 2,
        skipScope: setup.skipScope ?? 'GAME',   // 'GAME' = pro Team & Partie, 'TURN' = pro Zug
        referee: setup.referee ?? 'HOST',
        seconds: setup.seconds ?? 60,
        length: setup.length ?? (three ? 4 : 6),
    };
}

/** Team-Einteilung im Setup: weggegangene IDs fallen raus, wer in keinem Team steckt, ist "offen". */
export function teamLayout(players, setup) {
    const ids = players.map((p) => p.id);
    const maxTeams = Math.max(2, Math.min(4, Math.floor(players.length / 2)));
    const teamCount = Math.min(setup.teamCount, maxTeams);
    const teamKeys = TEAM_KEYS.slice(0, teamCount);
    const teams = Object.fromEntries(teamKeys.map((k) => [k, (setup.teams[k] || []).filter((id) => ids.includes(id))]));
    const assigned = new Set(Object.values(teams).flat());
    return { ids, maxTeams, teamCount, teamKeys, teams, unassigned: ids.filter((id) => !assigned.has(id)) };
}

/**
 * Gedächtnis pro Gerät: Begriffe, die hier schon aufgelöst oder getauscht
 * wurden. Wer zieht (der Darsteller), überspringt sie, solange noch
 * ungesehene im Stapel sind — sonst kommen dieselben Begriffe in jeder
 * neuen Partie wieder, weil jeder Stapel frisch gemischt wird.
 * shortcut: nur lokal pro Gerät; Begriffe, die ein anderer Darsteller schon
 * gezogen hat, kennt dieses Gerät nur, wenn es bei der Auflösung dabei war.
 */
const SEEN_KEY = 'activity-seen-v1';
const SEEN_LIMIT = 600; // unter der Kartenzahl, damit alte Begriffe irgendwann wieder drankommen

// key/limit als Parameter, damit Tabu ein eigenes Gedächtnis (tabu-seen-v1) nutzen kann.
const readSeen = (key) => {
    try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; }
};
export const seenWords = (key = SEEN_KEY) => new Set(readSeen(key));
export function rememberWord(word, key = SEEN_KEY, limit = SEEN_LIMIT) {
    if (!word) return;
    try {
        const list = readSeen(key).filter((w) => w !== word);
        list.push(word);
        localStorage.setItem(key, JSON.stringify(list.slice(-limit)));
    } catch { /* privater Modus: dann eben ohne Gedächtnis */ }
}
