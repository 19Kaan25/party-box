import { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';

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
 * denen list_friends() jemanden als offline zaehlt. Geschlossen wird der
 * Tab, hoert der Schlag ganz auf -- genau das ist das Signal.
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

        beat();
        const timer = setInterval(beat, HEARTBEAT_MS);
        // Beim Zurueckkommen sofort melden, statt auf den naechsten
        // (im Hintergrund gedrosselten) Lauf zu warten.
        document.addEventListener('visibilitychange', beat);

        return () => {
            stopped = true;
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
