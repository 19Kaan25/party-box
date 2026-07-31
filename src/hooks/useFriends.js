import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { isStaleSession } from './useAuth';

/** Nur waehrend der Freunde-Reiter offen ist. last_seen_at aendert sich alle
 *  45 Sekunden pro Freund und laesst sich per postgres_changes nicht auf eine
 *  Liste filtern -- also nachladen statt abonnieren, aber nur solange
 *  jemand hinschaut. */
const POLL_MS = 30_000;

/** RPC-Tokens -> deutsche Meldungen, gleiche Machart wie in useLobby.js. */
function mapFriendError(err) {
    const msg = err?.message || '';
    if (isStaleSession(err)) return 'Deine Sitzung war ungültig. Bitte lade die Seite neu.';
    if (msg.includes('NO_USERNAME')) return 'Lege zuerst deinen eigenen Benutzernamen fest.';
    if (msg.includes('USER_NOT_FOUND')) return 'Diesen Benutzernamen gibt es nicht. Achte auf den Code hinter dem #.';
    if (msg.includes('CANNOT_FRIEND_SELF')) return 'Das bist du selbst.';
    if (msg.includes('ALREADY_FRIENDS')) return 'Ihr seid bereits befreundet.';
    if (msg.includes('REQUEST_PENDING')) return 'Deine Anfrage läuft schon.';
    if (msg.includes('REQUEST_NOT_FOUND')) return 'Diese Anfrage gibt es nicht mehr.';
    if (msg.includes('NOT_THE_RECIPIENT')) return 'Deine eigene Anfrage kannst du nicht annehmen.';
    if (msg.includes('NOT_A_MEMBER')) return 'Du bist in keiner Lobby.';
    if (msg.includes('NOT_FRIENDS')) return 'Einladen geht nur bei bestätigter Freundschaft.';
    if (msg.includes('ALREADY_INVITED')) return 'Diese Person hast du bereits eingeladen.';
    if (msg.includes('ALREADY_IN_LOBBY')) return 'Diese Person ist schon in deiner Lobby.';
    if (msg.includes('NOT_AUTHENTICATED')) return 'Sitzung abgelaufen. Bitte lade die Seite neu.';
    return 'Da ist etwas schiefgelaufen. Bitte versuche es erneut.';
}

/**
 * Zerlegt "Kaan#1234". Der Code ist Pflicht — ohne ihn ist der Name nicht
 * eindeutig, und die Suche findet bewusst nichts, statt irgendeinen
 * gleichnamigen Treffer zu liefern.
 */
export function parseHandle(input) {
    const m = /^@?([A-Za-z0-9_]{3,20})#([0-9]{4})$/.exec((input || '').trim());
    return m ? { username: m[1], discriminator: m[2] } : null;
}

export default function useFriends(user, lobbyId, panelOpen) {
    const [friends, setFriends] = useState([]);
    const [invites, setInvites] = useState([]);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const mounted = useRef(true);

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    const refresh = useCallback(async () => {
        if (!user?.id) return;
        const [f, i] = await Promise.all([
            supabase.rpc('list_friends'),
            supabase.rpc('list_my_invites'),
        ]);
        if (!mounted.current) return;
        if (!f.error) setFriends(f.data || []);
        if (!i.error) setInvites(i.data || []);
    }, [user?.id]);

    // Realtime auf die Struktur (Anfrage kam rein, Einladung kam rein). Damit
    // stimmt der Zaehler am Profil-Knopf auch bei geschlossenem Reiter.
    useEffect(() => {
        if (!user?.id) return undefined;
        refresh();

        const channel = supabase
            .channel(`friends:${user.id}`)
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'friendships', filter: `user_low=eq.${user.id}` },
                refresh)
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'friendships', filter: `user_high=eq.${user.id}` },
                refresh)
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'lobby_invites', filter: `to_user=eq.${user.id}` },
                refresh)
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [user?.id, refresh]);

    // Der Online-Status altert im Hintergrund weiter; nur dafuer wird
    // gepollt, und nur bei offenem Reiter.
    useEffect(() => {
        if (!panelOpen || !user?.id) return undefined;
        const timer = setInterval(refresh, POLL_MS);
        return () => clearInterval(timer);
    }, [panelOpen, user?.id, refresh]);

    const run = useCallback(async (fn) => {
        setBusy(true);
        setError('');
        try {
            const { error: err } = await fn();
            if (err) { setError(mapFriendError(err)); return false; }
            await refresh();
            return true;
        } finally {
            setBusy(false);
        }
    }, [refresh]);

    const sendRequest = useCallback(async (handleText) => {
        const parsed = parseHandle(handleText);
        if (!parsed) {
            setError('Bitte in der Form Name#1234 eingeben.');
            return false;
        }
        return run(() => supabase.rpc('send_friend_request', {
            p_username: parsed.username,
            p_discriminator: parsed.discriminator,
        }));
    }, [run]);

    const respond = useCallback((otherId, accept) => run(
        () => supabase.rpc('respond_friend_request', { p_other: otherId, p_accept: accept })
    ), [run]);

    const removeFriend = useCallback((otherId) => run(
        () => supabase.rpc('remove_friend', { p_other: otherId })
    ), [run]);

    const inviteToLobby = useCallback((otherId) => {
        if (!lobbyId) { setError('Du bist in keiner Lobby.'); return Promise.resolve(false); }
        return run(() => supabase.rpc('invite_friend_to_lobby', {
            p_lobby: lobbyId, p_to_user: otherId,
        }));
    }, [run, lobbyId]);

    const declineInvite = useCallback((inviteId) => run(
        () => supabase.rpc('decline_invite', { p_invite: inviteId })
    ), [run]);

    const grouped = useMemo(() => ({
        accepted: friends.filter((f) => f.direction === 'accepted'),
        incoming: friends.filter((f) => f.direction === 'incoming'),
        outgoing: friends.filter((f) => f.direction === 'outgoing'),
    }), [friends]);

    return {
        friends: grouped.accepted,
        incoming: grouped.incoming,
        outgoing: grouped.outgoing,
        invites,
        // Was am Profil-Knopf einen Punkt verdient: fremde Anfragen und
        // Einladungen. Eigene offene Anfragen zaehlen nicht mit.
        badgeCount: grouped.incoming.length + invites.length,
        error,
        setError,
        busy,
        refresh,
        sendRequest,
        respond,
        removeFriend,
        inviteToLobby,
        declineInvite,
    };
}
