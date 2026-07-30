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
