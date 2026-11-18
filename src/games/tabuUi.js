// Anzeige-Konstanten und Einstellungs-Standards für Tabu — eigene Datei wegen
// react-refresh (eine .jsx-Datei darf nur Komponenten exportieren).
import ACTIVITY_TABU from '../constants/activityTabu.json';
import TABU_CARDS from '../constants/tabuCards.json';
import { CATEGORY_NAMES as ACTIVITY_CATEGORY_NAMES } from './activityUi';
import { MIN_TEAM_PLAYERS } from './tabuLogic';

/** Die drei Activity-Kategorien plus sechs nur für Tabu. */
export const CARDS = { ...ACTIVITY_TABU, ...TABU_CARDS };
export const CATEGORY_NAMES = {
    ...ACTIVITY_CATEGORY_NAMES,
    film_musik: 'Film, Serien & Musik',
    sport_spiele: 'Sport & Spiele',
    wissen: 'Schule & Wissen',
    welt_reisen: 'Länder & Reisen',
    technik: 'Technik & Internet',
    koerper_gefuehle: 'Mensch & Gefühle',
};

/** Eigenes Gedächtnis, Grenze unter den 576 Karten, damit alte irgendwann wiederkommen. */
export const SEEN_KEY = 'tabu-seen-v1';
export const SEEN_LIMIT = 450;

/**
 * Kartenpool einer Partie. Reihenfolge fest nach CATEGORY_NAMES, damit jedes
 * Gerät aus denselben Einstellungen denselben Pool (und damit dieselben
 * Stapel-Indizes) baut.
 */
export const poolFor = (cfg) => Object.keys(CATEGORY_NAMES)
    .filter((c) => (cfg.categories || []).includes(c))
    .flatMap((c) => (CARDS[c] || []).filter((x) => (cfg.difficulties || []).includes(x.difficulty)));

/** Effektive Einstellungen inkl. Standardwerte. Bei 3 Spielern ist "Jeder gegen jeden" fest. */
export function effectiveSetup(setup = {}, playerCount) {
    const solo = playerCount < MIN_TEAM_PLAYERS || setup.mode === 'SOLO';
    return {
        mode: solo ? 'SOLO' : 'TEAMS',
        teamCount: setup.teamCount ?? 2,
        teams: setup.teams || {},
        seconds: setup.seconds ?? 60,
        endMode: setup.endMode ?? 'SCORE',
        target: setup.target ?? 30,
        rounds: setup.rounds ?? 2,
        tabuShown: setup.tabuShown ?? 5,
        difficulties: setup.difficulties ?? [3, 4, 5],
        categories: setup.categories ?? Object.keys(CATEGORY_NAMES),
        skips: setup.skips ?? -1,          // -1 = unbegrenzt, 0 = aus, sonst pro Zug
        skipPenalty: setup.skipPenalty ?? 0,
        tabuPenalty: setup.tabuPenalty ?? -1,
        watcher: setup.watcher ?? 'ALL',   // ALL | ONE | NONE
        // Klauen braucht ein "nächstes Team"; bei Jeder gegen jeden raten ohnehin alle.
        steal: !solo && (setup.steal ?? false),
    };
}
