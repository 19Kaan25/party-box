import { supabase } from './supabase';

// Leer = derselbe Origin (Vercel). Auf der Firebase-Hosting-Kopie gibt es
// unter /api nichts -- dort muss die volle Vercel-URL gesetzt sein, sonst
// laeuft der Aufruf ins Leere. Siehe CLAUDE.md "Hosting" und den
// CORS-Kommentar in api/send-invite-push.js.
const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

/**
 * Loest eine Push-Benachrichtigung fuer eine bereits angelegte
 * Lobby-Einladung aus. Rein informativ -- schlaegt der Versand fehl (kein
 * Abo beim Empfaenger, Endpunkt nicht erreichbar, Netzwerkfehler), bleibt
 * die Einladung trotzdem gueltig und taucht ganz normal im
 * "Einladungen"-Reiter des Empfaengers auf, sobald er die App oeffnet.
 * Deshalb wirft diese Funktion nie, sie meldet nur Erfolg/Misserfolg.
 */
export async function sendInvitePush({ toUserId, lobbyCode, message }) {
    try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return false;

        const res = await fetch(`${API_BASE}/api/send-invite-push`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ toUserId, lobbyCode, message }),
        });
        return res.ok;
    } catch {
        return false;
    }
}
