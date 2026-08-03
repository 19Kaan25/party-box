/* =====================================================================
 *  Clientseitiges Gegenstueck zu legacy_apply_patch().
 *
 *  Warum: jeder Klick ging bisher als RPC raus, wurde per Realtime
 *  zurueckgemeldet und erst nach einem vollen Refetch sichtbar -- 300-600 ms
 *  pro Tastendruck. Schlimmer noch: zwei schnelle Klicks auf dieselbe Liste
 *  (Imposter-Kategorien) lasen beide denselben alten Serverstand, der zweite
 *  ueberschrieb also den ersten. Klicks gingen schlicht verloren.
 *
 *  Deshalb wendet der Client denselben Patch sofort lokal an und zeigt das
 *  Ergebnis, bis der Server nachgezogen hat (siehe useLobby.js). Alle
 *  Operationen sind idempotent -- die Ueberlagerung darf also gefahrlos noch
 *  eine Weile ueber einem Serverstand liegen, der sie bereits enthaelt.
 *
 *  Bewusst NICHT ueberlagert werden gemeinsame Momente (Phasenwechsel,
 *  Spielstart): dort wuerde der Ausloeser die neue Phase Millisekunden vor
 *  allen anderen sehen und haette bei Spielen um Schnelligkeit einen
 *  Vorsprung. Siehe isSyncedMoment().
 *
 *  Serverseitiges Original:
 *  supabase/migrations/20260730220000_phase0b_legacy_bridge.sql
 * ===================================================================== */

/** arrayUnion-Sentinel aufloesen, sonst der Wert selbst. */
function resolveOp(current, value) {
    if (value && value.__op === 'arrayUnion') {
        const base = Array.isArray(current) ? current : [];
        return [...new Set([...base, ...value.values])];
    }
    return value;
}

/** Unveraenderliches Setzen entlang eines Pfades; Zwischenobjekte entstehen. */
function setDeep(target, path, value) {
    const [head, ...rest] = path;
    const base = (target && typeof target === 'object' && !Array.isArray(target)) ? target : {};
    if (rest.length === 0) {
        return { ...base, [head]: resolveOp(base[head], value) };
    }
    return { ...base, [head]: setDeep(base[head], rest, value) };
}

/**
 * Patches, die einen fuer alle sichtbaren Moment ausloesen. Sie bleiben
 * bewusst unoptimistisch: erst wenn der Server bestaetigt hat, sieht sie
 * jemand -- und dann alle ungefaehr gleichzeitig.
 */
export function isSyncedMoment(patch) {
    return Object.keys(patch).some(
        (key) => key === 'status'
            || key === 'currentGame'
            || key === 'gameState'          // vollstaendiger Ersatz, traegt praktisch immer eine neue Phase
            || key === 'gameState.phase'
    );
}

/**
 * Wendet einen Patch auf das Kompatibilitaets-Objekt aus useLobby an.
 * Gleiche Semantik wie legacy_apply_patch, nur auf der alten Firestore-Form.
 */
export function applyLegacyPatch(view, patch) {
    if (!view) return view;
    let next = view;

    // Kuerzere Keys zuerst -- 'gameState' muss vor 'gameState.x' laufen.
    // Serverseitig ergibt sich diese Reihenfolge aus jsonb_each.
    const entries = Object.entries(patch).sort(([a], [b]) => a.length - b.length);

    for (const [key, value] of entries) {
        if (key === 'status') {
            next = { ...next, status: value };
        } else if (key === 'currentGame') {
            next = { ...next, currentGame: value };
        } else if (key === 'settings') {
            next = { ...next, settings: { ...next.settings, ...value } };
        } else if (key === 'players') {
            const byId = new Map((value || []).map((p) => [p.id, p]));
            next = {
                ...next,
                players: next.players.map((p) => {
                    const upd = byId.get(p.id);
                    return upd && upd.globalScore != null
                        ? { ...p, globalScore: Math.max(0, upd.globalScore) }
                        : p;
                }),
            };
        } else if (key === 'usedImposterWords' || key === 'customImposterWords') {
            next = { ...next, [key]: resolveOp(next[key], value) };
        } else if (key === 'gameState') {
            next = { ...next, gameState: resolveOp(next.gameState, value) };
        } else if (key.startsWith('gameState.')) {
            next = { ...next, gameState: setDeep(next.gameState, key.slice(10).split('.'), value) };
        }
        // Alles andere ignoriert der Server ebenfalls stillschweigend.
    }

    // Zurueck in die Lobby beendet die Partie: der Server verwirft dann alle
    // gameState-Keys desselben Patches und leert current_game.
    if (patch.status && patch.status !== 'GAME_IN_PROGRESS') {
        next = { ...next, gameState: {}, currentGame: null };
    }

    return next;
}
