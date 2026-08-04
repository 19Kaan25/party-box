import { useEffect, useState, useRef } from 'react';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../lib/supabase';

/**
 * Presence pro Lobby. Ersetzt das komplett fehlende Disconnect-Handling
 * des Firestore-Modells (dort blieb ein Spieler nach dem Schliessen des
 * Tabs fuer immer in der Lobby).
 *
 * Bewusst OEFFENTLICHER Kanal (Plan §6.2, Risiko-Mitigation): der Payload
 * enthaelt nur user_id, Displayname und Zeitstempel -- alles Daten, die
 * Lobby-Mitglieder ohnehin per RLS lesen duerfen. Der autoritative Zustand
 * haengt an der Tabellen-RLS, nicht am Kanal.
 *
 * Kein Heartbeat-Feld in der Datenbank: Presence lebt im Realtime-Server.
 * Deshalb kann Postgres sie auch nicht sehen -- die Host-Uebernahme laeuft
 * darum ueber die claim_host-RPC mit Bestaetigungsdialog statt automatisch.
 */
/** Abstand zweier Herzschlaege. list_friends() zieht die Grenze bei 90
 *  Sekunden, verkraftet also zwei verpasste Schlaege. */
const HEARTBEAT_MS = 45_000;

/**
 * Globaler Online-Status fuer die Freundesliste. Bewusst getrennt vom
 * Lobby-Kanal oben: Presence lebt nur im Realtime-Server, Postgres sieht
 * sie nicht. "Zuletzt online vor 3 Stunden" liesse sich daraus gar nicht
 * beantworten -- dafuer braucht es einen persistenten Zeitstempel.
 *
 * Schlaegt auch im Hintergrund-Tab weiter. "Online" soll heissen "die App
 * ist offen und die Person kann auf eine Einladung reagieren" -- wer kurz
 * die Tabs wechselt, ist nicht weg. Browser drosseln Timer im Hintergrund
 * auf etwa einen Lauf pro Minute; das bleibt unter den 90 Sekunden, ab
 * denen list_friends() jemanden als offline zaehlt.
 *
 * Fuer den Fall, dass die Seite ganz geschlossen/verlassen wird, reicht das
 * nicht: ohne eigenes Signal bliebe jemand bis zu 90 Sekunden lang faelschlich
 * "online" stehen. Deshalb zusaetzlich ein pagehide-Handler, der go_offline()
 * feuert -- bewusst per fetch(..., {keepalive: true}) statt supabase.rpc():
 * der Browser kann die Seite beenden, bevor ein Promise ueber den normalen
 * Client aufloest, keepalive-Requests ueberleben genau das. Kein Ersatz fuer
 * den Heartbeat, nur ein frueheres Signal fuer den haeufigsten Fall
 * (Tab/App schliessen) -- ein Absturz bleibt weiterhin auf die 90-Sekunden-
 * Toleranz angewiesen.
 */
export function usePresenceHeartbeat(user, lobbyId) {
    useEffect(() => {
        if (!user?.id) return undefined;

        let stopped = false;
        const beat = () => {
            if (stopped) return;
            supabase.rpc('touch_presence', { p_lobby: lobbyId ?? null }).then(({ error }) => {
                if (error) console.warn('Heartbeat fehlgeschlagen:', error.message);
            });
        };

        // pagehide darf nicht auf ein Promise warten -- Token deshalb
        // synchron nachhalten statt bei Bedarf per getSession() zu holen.
        let accessToken = null;
        supabase.auth.getSession().then(({ data }) => {
            accessToken = data.session?.access_token ?? null;
        });
        const { data: authSub } = supabase.auth.onAuthStateChange((_event, session) => {
            accessToken = session?.access_token ?? null;
        });

        const goOffline = () => {
            if (!accessToken) return;
            fetch(`${SUPABASE_URL}/rest/v1/rpc/go_offline`, {
                method: 'POST',
                keepalive: true,
                headers: {
                    'Content-Type': 'application/json',
                    apikey: SUPABASE_ANON_KEY,
                    Authorization: `Bearer ${accessToken}`,
                },
                body: '{}',
            }).catch(() => {});
        };

        beat();
        const timer = setInterval(beat, HEARTBEAT_MS);
        // Beim Zurueckkommen sofort melden, statt auf den naechsten
        // (im Hintergrund gedrosselten) Lauf zu warten.
        document.addEventListener('visibilitychange', beat);
        window.addEventListener('pagehide', goOffline);

        return () => {
            stopped = true;
            authSub.subscription.unsubscribe();
            window.removeEventListener('pagehide', goOffline);
            clearInterval(timer);
            document.removeEventListener('visibilitychange', beat);
        };
    }, [user?.id, lobbyId]);
}

export default function usePresence(lobbyCode, user, displayName) {
    const [onlineIds, setOnlineIds] = useState(() => new Set());
    const channelRef = useRef(null);

    useEffect(() => {
        if (!lobbyCode || !user?.id) return undefined;

        const channel = supabase.channel(`lobby:${lobbyCode}`, {
            config: { presence: { key: user.id } },
        });
        channelRef.current = channel;

        const sync = () => {
            const state = channel.presenceState();
            setOnlineIds(new Set(Object.keys(state)));
        };

        channel
            .on('presence', { event: 'sync' }, sync)
            .on('presence', { event: 'join' }, sync)
            .on('presence', { event: 'leave' }, sync)
            .subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await channel.track({
                        user_id: user.id,
                        display_name: displayName || 'Spieler',
                        online_at: new Date().toISOString(),
                    });
                }
            });

        return () => {
            channelRef.current = null;
            supabase.removeChannel(channel);
            setOnlineIds(new Set());
        };
    }, [lobbyCode, user?.id, displayName]);

    return onlineIds;
}
