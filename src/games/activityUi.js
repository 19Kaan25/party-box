// Anzeige-Konstanten für Activity — eigene Datei wegen react-refresh
// (eine .jsx-Datei darf nur Komponenten exportieren).
import { Pencil, PersonStanding, MessageCircle } from 'lucide-react';

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
        referee: setup.referee ?? 'HOST',
        seconds: setup.seconds ?? 60,
        length: setup.length ?? (three ? 4 : 6),
    };
}
