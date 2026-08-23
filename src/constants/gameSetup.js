/**
 * Eine einzige Quelle fuer den Einstieg in die Einstellungen jedes Spiels.
 * Wird sowohl vom Spielekatalog als auch vom globalen "Spiel neu starten"
 * verwendet, damit beide Wege garantiert in derselben Phase landen.
 */
export function createInitialGameState(gameKey) {
    switch (gameKey) {
        case 'STADT_LAND_FLUSS':
            return { phase: 'SETUP', letter: '', answers: {}, readyPlayers: [], gameScores: {} };
        case 'CODENAMES':
            return { phase: 'TEAM_SETUP', teams: { red: [], blue: [] }, spymasters: { red: null, blue: null } };
        case 'WERWOLF':
            return { phase: 'SETUP', settings: { mode: 'MULTI' } };
        case 'WER_BIN_ICH':
            return { phase: 'SETUP' };
        case 'IMPOSTER':
            return {
                phase: 'SETUP',
                settings: {
                    imposterCount: 1,
                    timerDuration: 180,
                    selectedCategories: ['orte'],
                    mode: 'MULTI',
                    imposterHint: 'none',
                },
            };
        case 'SPRUECHE_KLOPFER':
            return { phase: 'SETUP' };
        default:
            return { phase: 'SETUP' };
    }
}

/** Nur definierte Werte uebernehmen, damit im JSON keine leeren Keys landen. */
function defined(object) {
    return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

/**
 * Laufende Partie verwerfen und zu ihren Einstellungen zurueckkehren.
 * Bei den Einzelgeraet-Modi bleibt die muehsam zusammengestellte Spielerliste
 * erhalten; Geheimnisse und der eigentliche Rundenfortschritt verschwinden.
 */
export function createRestartGameState(gameKey, previousState = {}) {
    const initial = createInitialGameState(gameKey);
    const restartVersion = (previousState.restartVersion || 0) + 1;

    if (gameKey === 'IMPOSTER') {
        const settings = { ...initial.settings, ...(previousState.settings || {}) };
        const sd = previousState.sd || {};
        return defined({
            phase: 'SETUP',
            restartVersion,
            settings,
            sd: settings.mode === 'SINGLE' ? defined({
                step: 'SETUP',
                roster: sd.roster,
                sessionUsed: sd.sessionUsed,
            }) : undefined,
        });
    }

    if (gameKey === 'WERWOLF') {
        const settings = { ...initial.settings, ...(previousState.settings || {}) };
        const sd = previousState.sd || {};
        return defined({
            phase: 'SETUP',
            restartVersion,
            settings,
            sd: settings.mode === 'SINGLE' ? defined({
                step: 'SETUP',
                roster: sd.roster,
                narratorKey: sd.narratorKey,
                roleCounts: sd.roleCounts,
                rules: sd.rules,
            }) : undefined,
        });
    }

    if (gameKey === 'STADT_LAND_FLUSS') {
        return defined({
            ...initial,
            restartVersion,
            categories: previousState.categories,
            maxRounds: previousState.maxRounds,
            timerLimit: previousState.timerLimit,
            excludedLetters: previousState.excludedLetters,
        });
    }

    return { ...initial, restartVersion };
}
