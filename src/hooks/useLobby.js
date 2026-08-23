import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase, measureClockOffset } from '../lib/supabase';
import { setActiveLobby, setPatchObserver } from '../lib/firestoreBridge';
import { applyLegacyPatch, isSyncedMoment } from '../lib/legacyPatch';
import { avatarUrl, isStaleSession, MAX_DISPLAY_NAME } from './useAuth';
import usePresence, { usePresenceHeartbeat } from './usePresence';

// Neues Schema <-> alte Firestore-Form. Die Engines und LobbyWaitingScreen
// sprechen weiterhin die alten Bezeichner, deshalb wird hin- und
// zurueckgemappt (TRANSITIONAL, faellt mit den Phasen 1-5 weg).
const GAME_KEY_TO_OLD = {
    imposter: 'IMPOSTER',
    werwolf: 'WERWOLF',
    codenames: 'CODENAMES',
    wer_bin_ich: 'WER_BIN_ICH',
    stadt_land_fluss: 'STADT_LAND_FLUSS',
    sprueche_klopfer: 'SPRUECHE_KLOPFER',
};

/** Vom Spielerlabor vorbelegter Nickname; ausserhalb des Dev-Modus wirkungslos. */
function initialDevPlayerName() {
    if (!import.meta.env.DEV) return null;

    const params = new URLSearchParams(window.location.search);
    if (!params.get('testSession')) return null;

    const name = params.get('testName')?.trim();
    return name ? name.slice(0, MAX_DISPLAY_NAME) : null;
}

/** RPC-Fehler-Tokens -> die bestehenden deutschen Meldungen. */
function mapRpcError(err) {
    const msg = err?.message || '';
    // Verwaiste Sitzung: der JWT zeigt auf einen Nutzer, dessen profiles-Zeile
    // es nicht mehr gibt -- die RPC scheitert dann am Fremdschluessel (23503).
    // Ohne diesen Zweig kaeme nur ein nichtssagendes "etwas schiefgelaufen".
    if (isStaleSession(err)) {
        return 'Deine Sitzung war ungültig. Bitte lade die Seite neu.';
    }
    if (err?.code === '23505' || /duplicate key|lobby_members_name_unique/.test(msg)) {
        return 'Dieser Name ist bereits in der Lobby vergeben.';
    }
    if (msg.includes('LOBBY_NOT_FOUND')) return 'Lobby nicht gefunden.';
    if (msg.includes('GAME_IN_PROGRESS')) return 'Spiel läuft bereits.';
    if (msg.includes('NOT_A_MEMBER')) return 'Du bist kein Mitglied dieser Lobby.';
    if (msg.includes('NOT_HOST')) return 'Nur der Partyleiter darf das.';
    if (msg.includes('CANNOT_KICK_SELF')) return 'Du kannst dich nicht selbst rauswerfen.';
    if (msg.includes('TARGET_NOT_ACTIVE_MEMBER')) return 'Dieser Spieler ist nicht mehr in der Lobby.';
    if (msg.includes('CLAIM_TOO_SOON_OR_ALREADY_HOST')) {
        return 'Gerade wurde schon gewechselt — bitte kurz warten.';
    }
    if (msg.includes('DISPLAY_NAME_REQUIRED')) return 'Bitte gib einen Nickname ein.';
    if (msg.includes('DISPLAY_NAME_TOO_LONG')) return 'Der Nickname ist zu lang (max. 20 Zeichen).';
    if (msg.includes('NOT_AUTHENTICATED')) return 'Sitzung abgelaufen. Bitte lade die Seite neu.';
    return 'Da ist etwas schiefgelaufen. Bitte versuche es erneut.';
}

export default function useLobby(user, userData, updateUserProfile) {
    const [lobbyRow, setLobbyRow] = useState(null);
    const [members, setMembers] = useState([]);
    const [gameRow, setGameRow] = useState(null);
    const [mySecret, setMySecret] = useState(null);
    // Eigene Schreibvorgaenge, die noch nicht als Serverstand zurueck sind.
    // Sie liegen als Ueberlagerung ueber currentLobby, damit ein Klick sofort
    // sichtbar ist und der naechste Klick den eigenen vorherigen schon sieht.
    const [pendingPatches, setPendingPatches] = useState([]);
    // null = der Nutzer hat noch nichts getippt -> Profilname gilt. Abgeleitet
    // statt per Effect gespiegelt, damit kein setState-im-Effect noetig ist.
    const [typedName, setTypedName] = useState(initialDevPlayerName);
    const [errorMsg, setErrorMsg] = useState('');

    const playerName = typedName ?? userData?.name ?? '';
    const setPlayerName = setTypedName;

    const lobbyId = lobbyRow?.id ?? null;
    const lobbyCode = lobbyRow?.code ?? '';
    const isHost = !!user && lobbyRow?.host_id === user.id;

    const onlineIds = usePresence(lobbyCode, user, playerName || userData?.name);
    // Fuer die Freundesliste: schlaegt auch ausserhalb jeder Lobby. lobbyId
    // steht in den Abhaengigkeiten, damit "in einer Lobby" beim Betreten und
    // Verlassen sofort umspringt statt erst beim naechsten Schlag.
    usePresenceHeartbeat(user, lobbyId);
    const leavingRef = useRef(false);
    const patchSeq = useRef(0);
    // Von der Realtime-Subscription gesetzt, damit ein bestaetigter eigener
    // Patch das Nachladen selbst anstossen kann.
    const refetchRef = useRef(null);

    // Der Shim braucht die Lobby-UUID, kennt aber nur den Code.
    useEffect(() => {
        setActiveLobby(lobbyId ? { id: lobbyId, code: lobbyCode } : null);
        return () => setActiveLobby(null);
    }, [lobbyId, lobbyCode]);

    // -----------------------------------------------------------------
    // Optimistische Ueberlagerung.
    // Nimmt einen Patch entgegen, zeigt ihn sofort an und gibt settle(ok)
    // zurueck. Gemeinsame Momente (Phasenwechsel) bleiben aussen vor, damit
    // niemand eine neue Phase frueher sieht als der Rest -- siehe
    // isSyncedMoment() in legacyPatch.js.
    // -----------------------------------------------------------------
    const trackPatch = useCallback((patch) => {
        if (isSyncedMoment(patch)) return () => {};

        const id = ++patchSeq.current;
        setPendingPatches((prev) => [...prev, { id, patch, settledAt: null }]);

        return (ok) => {
            setPendingPatches((prev) => ok
                // Zeitpunkt merken: ab jetzt liefert jeder frisch gestartete
                // Refetch diesen Patch mit, die Ueberlagerung darf dann weg.
                ? prev.map((e) => (e.id === id ? { ...e, settledAt: Date.now() } : e))
                : prev.filter((e) => e.id !== id));
            // Selbst nachladen statt auf postgres_changes zu warten: dessen
            // Event kann den Client VOR der RPC-Antwort erreichen, der Refetch
            // liefe dann zu frueh und die Ueberlagerung bliebe liegen.
            if (ok) refetchRef.current?.();
        };
    }, []);

    useEffect(() => {
        setPatchObserver(trackPatch);
        return () => setPatchObserver(null);
    }, [trackPatch]);

    // -----------------------------------------------------------------
    // Zustand aus den drei Tabellen laden.
    // -----------------------------------------------------------------
    const fetchLobbyState = useCallback(async (id) => {
        if (!id) return false;
        // Alles, was VOR diesem Zeitpunkt bestaetigt wurde, steckt im Ergebnis.
        const startedAt = Date.now();

        const [lobbyRes, memberRes, gameRes] = await Promise.all([
            supabase.from('lobbies')
                .select('id, code, host_id, status, current_game, global_leaderboard, closed_at, legacy_state')
                .eq('id', id).maybeSingle(),
            supabase.from('lobby_members')
                .select('user_id, display_name, score, joined_at, profiles(avatar_path, updated_at, username, discriminator)')
                .eq('lobby_id', id).is('left_at', null).order('joined_at', { ascending: true }),
            supabase.from('games')
                .select('id, game_key, phase, state, phase_deadline')
                .eq('lobby_id', id).is('ended_at', null).maybeSingle(),
        ]);

        // Kein Zugriff mehr (rausgeworfen oder Lobby geschlossen): RLS
        // liefert dann schlicht keine Zeile.
        if (lobbyRes.error || !lobbyRes.data || lobbyRes.data.closed_at) return false;
        const stillMember = (memberRes.data || []).some((m) => m.user_id === user?.id);
        if (!stillMember) return false;

        setLobbyRow(lobbyRes.data);
        setMembers(memberRes.data || []);
        // Bestaetigte eigene Patches fallen lassen -- dieser Datensatz
        // enthaelt sie bereits. Noch laufende bleiben ueberlagert.
        setPendingPatches((prev) => prev.filter(
            (e) => e.settledAt === null || e.settledAt > startedAt
        ));
        // Bei einem Fehler den letzten bekannten Spielzustand behalten statt ihn
        // stillschweigend auf null zu setzen -- sonst wuerde ein einzelner
        // fehlgeschlagener Request die laufende Partie fuer den Client beenden.
        if (!gameRes.error) setGameRow(gameRes.data || null);

        // Eigenes Geheimnis nachladen. In Phase 0b immer leer -- die Engines
        // halten ihre Geheimnisse noch im offenen Spielzustand. Der Aufruf
        // steht hier, damit Phase 1 (Imposter) nur noch die Anzeige braucht.
        if (gameRes.data?.id) {
            const { data: secret } = await supabase
                .from('player_secrets').select('payload')
                .eq('game_id', gameRes.data.id).maybeSingle();
            setMySecret(secret?.payload ?? null);
        } else {
            setMySecret(null);
        }
        return true;
    }, [user?.id]);

    const clearLobby = useCallback((message) => {
        setLobbyRow(null);
        setMembers([]);
        setGameRow(null);
        setMySecret(null);
        setPendingPatches([]);
        if (message) setErrorMsg(message);
    }, []);

    // -----------------------------------------------------------------
    // Reconnect nach Reload (Plan §7).
    // Leitet die Zugehoerigkeit aus der Mitgliedschaft selbst ab -- der
    // alte, dauernd zu pflegende Zeiger users/{uid}.currentLobby entfaellt
    // ersatzlos. limit(1) ist sicher durch lobby_members_one_active_per_user.
    // -----------------------------------------------------------------
    useEffect(() => {
        if (!user?.id || lobbyRow) return;
        let active = true;

        (async () => {
            const { data, error } = await supabase
                .from('lobby_members')
                .select('lobby_id, lobbies!inner(closed_at)')
                .eq('user_id', user.id)
                .is('left_at', null)
                .is('lobbies.closed_at', null)
                .limit(1)
                .maybeSingle();

            if (!active || error || !data) return;
            const ok = await fetchLobbyState(data.lobby_id);
            // Nach erfolgreichem Reconnect: Uhren-Offset neu messen. Den
            // Presence-Kanal betritt usePresence automatisch, sobald der
            // lobbyCode gesetzt ist; das Geheimnis laedt fetchLobbyState.
            if (ok && active) measureClockOffset();
        })();

        return () => { active = false; };
    }, [user?.id, lobbyRow, fetchLobbyState]);

    // -----------------------------------------------------------------
    // Realtime: drei Subscriptions statt des einen alten onSnapshot auf
    // das komplette Lobby-Dokument.
    // -----------------------------------------------------------------
    useEffect(() => {
        if (!lobbyId || !user?.id) return;

        // Ein einziger Schreibvorgang loest bis zu drei postgres_changes aus
        // (lobbies, lobby_members, games). Ohne Buendelung liefen dafuer drei
        // volle Refetches parallel. Waehrend einer laeuft, wird nur gemerkt,
        // dass danach noch einmal geladen werden muss.
        let inFlight = false;
        let queued = false;

        const refetch = async () => {
            if (leavingRef.current) return;
            if (inFlight) { queued = true; return; }

            inFlight = true;
            let ok;
            try {
                ok = await fetchLobbyState(lobbyId);
            } finally {
                inFlight = false;
            }
            if (!ok) return clearLobby('Du bist nicht mehr in dieser Lobby.');
            if (queued) { queued = false; refetch(); }
        };

        refetchRef.current = refetch;

        const channel = supabase
            .channel(`lobby-db:${lobbyId}`)
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'lobbies', filter: `id=eq.${lobbyId}` }, refetch)
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'lobby_members', filter: `lobby_id=eq.${lobbyId}` }, refetch)
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'games', filter: `lobby_id=eq.${lobbyId}` }, refetch)
            // SUBSCRIBED feuert auch nach jedem automatischen Reconnect (Displaysperre,
            // Tab im Hintergrund, kurzer Netzwerkabriss). Verpasste Events werden dabei
            // NICHT nachgeliefert -- ohne diesen Refetch bliebe der Client sonst auf dem
            // Stand vor der Unterbrechung eingefroren.
            .subscribe((status) => { if (status === 'SUBSCRIBED') refetch(); });

        return () => {
            refetchRef.current = null;
            supabase.removeChannel(channel);
        };
    }, [lobbyId, user?.id, fetchLobbyState, clearLobby]);

    // -----------------------------------------------------------------
    // Kompatibilitaets-Objekt in der alten Firestore-Form. Dadurch bleiben
    // alle fuenf Engines, LobbyWaitingScreen und GameHeader unveraendert.
    // -----------------------------------------------------------------
    const serverLobby = useMemo(() => {
        if (!lobbyRow) return null;
        const legacy = lobbyRow.legacy_state || {};
        return {
            id: lobbyRow.code,
            hostId: lobbyRow.host_id,
            status: lobbyRow.status === 'in_progress' ? 'GAME_IN_PROGRESS' : 'LOBBY_WAITING',
            currentGame: GAME_KEY_TO_OLD[lobbyRow.current_game] ?? null,
            settings: { globalLeaderboard: lobbyRow.global_leaderboard },
            players: members.map((m) => ({
                id: m.user_id,
                name: m.display_name,
                isHost: m.user_id === lobbyRow.host_id,
                globalScore: m.score,
                photoURL: avatarUrl(m.profiles?.avatar_path, m.profiles?.updated_at),
                // Nur gesetzt, wenn die Person einen Account mit Benutzernamen
                // hat -- daran haengt der Freundschaftsknopf in der Lobby.
                username: m.profiles?.username || null,
                discriminator: m.profiles?.discriminator || null,
            })),
            usedImposterWords: legacy.usedImposterWords || [],
            customImposterWords: legacy.customImposterWords || [],
            gameState: gameRow?.state || {},
        };
    }, [lobbyRow, members, gameRow]);

    // Serverstand plus die eigenen, noch nicht bestaetigten Schreibvorgaenge.
    const currentLobby = useMemo(
        () => pendingPatches.reduce((view, e) => applyLegacyPatch(view, e.patch), serverLobby),
        [serverLobby, pendingPatches]
    );

    // -----------------------------------------------------------------
    // Aktionen: alle ueber RPCs statt Read-Modify-Write auf einem Array.
    // -----------------------------------------------------------------
    const handleCreateLobby = async (e) => {
        e?.preventDefault?.();
        const name = playerName.trim();
        if (!user || !name) return setErrorMsg('Bitte gib einen Nickname ein.');

        const { data, error } = await supabase.rpc('create_lobby', { p_display_name: name });
        if (error) return setErrorMsg(mapRpcError(error));

        if (name !== userData?.name) await updateUserProfile(name, null);
        setErrorMsg('');
        await fetchLobbyState(data.lobby_id);
        measureClockOffset();
    };

    const handleJoinLobby = async (e, joinCode) => {
        e?.preventDefault?.();
        const name = playerName.trim();
        const code = (joinCode || '').toUpperCase().trim();
        if (!user || !name || !code) { setErrorMsg('Bitte fülle alle Felder aus.'); return false; }

        // Beim direkten Lobby-Wechsel erzeugt der Austritt aus der alten Lobby
        // Realtime-Events. Solange die atomare join_lobby-RPC laeuft, darf der
        // alte Refetch den gerade geladenen Zielzustand nicht wieder leeren.
        const switchingLobby = !!lobbyId;
        leavingRef.current = switchingLobby;
        const { data, error } = await supabase.rpc('join_lobby', {
            p_code: code, p_display_name: name,
        });
        if (error) {
            leavingRef.current = false;
            setErrorMsg(mapRpcError(error));
            return false;
        }

        try {
            if (name !== userData?.name) await updateUserProfile(name, null);
            setErrorMsg('');
            await fetchLobbyState(data.lobby_id);
            measureClockOffset();
            return true;
        } finally {
            if (switchingLobby) leavingRef.current = false;
        }
    };

    const leaveLobby = async () => {
        if (!lobbyId) return;
        leavingRef.current = true;
        const { error } = await supabase.rpc('leave_lobby', { p_lobby: lobbyId });
        leavingRef.current = false;
        if (error) return setErrorMsg(mapRpcError(error));
        clearLobby('');
        setErrorMsg('');
    };

    const kickPlayer = async (targetId) => {
        if (!lobbyId) return;
        if (!window.confirm('Möchtest du diesen Spieler wirklich rauswerfen?')) return;
        const { error } = await supabase.rpc('kick_member', {
            p_lobby: lobbyId, p_target_user: targetId,
        });
        if (error) setErrorMsg(mapRpcError(error));
    };

    const promotePlayer = async (targetId) => {
        if (!lobbyId) return;
        if (!window.confirm('Möchtest du diesen Spieler zum neuen Partyleiter ernennen?')) return;
        const { error } = await supabase.rpc('promote_host', {
            p_lobby: lobbyId, p_target_user: targetId,
        });
        if (error) setErrorMsg(mapRpcError(error));
    };

    /** Nur fuer den stillen Disconnect: Presence meldet den Host offline,
     *  der Client fragt nach. Postgres kann Presence nicht sehen, deshalb
     *  entscheidet der Mensch -- die DB verhindert nur Missbrauch (30s-Cooldown). */
    const claimHost = async () => {
        if (!lobbyId) return;
        if (!window.confirm('Der Partyleiter scheint weg zu sein. Übernehmen?')) return;
        const { error } = await supabase.rpc('claim_host', { p_lobby: lobbyId });
        if (error) setErrorMsg(mapRpcError(error));
    };

    /** Ersetzt die alte Firestore-Schreibfunktion. Signatur unveraendert,
     *  damit GameHeader, LobbyWaitingScreen und die Engines gleich bleiben.
     *  status darf null sein -- dann bleibt der Lobby-Status unberuehrt und
     *  der Patch gilt als reine Einstellungsaenderung (siehe isSyncedMoment). */
    const updateLobbyStatus = async (status, game = null, additionalData = {}) => {
        if (!lobbyId) return;
        const patch = {
            ...(status && { status }),
            ...(game && { currentGame: game }),
            ...additionalData,
        };
        const settle = trackPatch(patch);
        const { error } = await supabase.rpc('legacy_apply_patch', {
            p_lobby: lobbyId, p_patch: patch,
        });
        settle(!error);
        if (error) setErrorMsg(mapRpcError(error));
    };

    return {
        lobbyCode,
        lobbyId,          // fuer invite_friend_to_lobby, das die UUID braucht
        playerName,
        setPlayerName,
        currentLobby,
        errorMsg,
        isHost,
        onlineIds,
        mySecret,
        handleCreateLobby,
        handleJoinLobby,
        leaveLobby,
        updateLobbyStatus,
        kickPlayer,
        promotePlayer,
        claimHost,
    };
}
