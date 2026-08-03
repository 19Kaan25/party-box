/* Mitspielerliste der Einzelgeraet-Modi (Imposter, Werwolf).
 *
 * Ein Eintrag ist { key, name, userId }. userId ist null fuer Gaeste, die
 * nur am Tisch sitzen und keinen Account haben -- daran haengt, ob jemand
 * globale Punkte bekommen kann.
 *
 * Eigene Datei statt in RosterPanel.jsx: react-refresh erlaubt in einer
 * Komponenten-Datei keine zusaetzlichen Exporte. */

export const MAX_ROSTER = 20;
/** Wie lobby_members.display_name. */
export const NAME_MAX = 20;

/** Gespeicherte Liste bevorzugen, sonst alle Lobby-Mitglieder in Beitrittsreihenfolge. */
export const seedRoster = (saved, lobbyPlayers) => {
    if (Array.isArray(saved) && saved.length > 0) {
        return saved.map((r) => ({ key: r.key, name: r.name, userId: r.userId ?? null }));
    }
    return (lobbyPlayers || []).map((p) => ({ key: p.id, name: p.name, userId: p.id }));
};

export const newGuestKey = () =>
    (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? `guest-${crypto.randomUUID()}`
        : `guest-${Date.now()}-${Math.random().toString(36).slice(2)}`;
