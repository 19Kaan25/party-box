import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
    throw new Error(
        'VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY fehlen. ' +
        'Lege .env.local nach dem Muster von .env.example an.'
    );
}

// Fuer den einen Fall, der bewusst NICHT ueber den supabase-js-Client laeuft:
// das go_offline()-Signal beim pagehide-Event in usePresence.js braucht
// fetch(..., {keepalive: true}) mit synchron verfuegbarem Token, kein
// Promise-Umweg ueber den Client -- der Browser kann die Seite beenden,
// bevor das Promise aufloest.
export const SUPABASE_URL = url;
export const SUPABASE_ANON_KEY = anonKey;

// Singleton. Beide Werte sind per Design oeffentlich; die Absicherung leisten
// die RLS-Policies, nicht die Geheimhaltung dieser Keys.
export const supabase = createClient(url, anonKey, {
    auth: {
        persistSession: true,      // anonyme Session ueberlebt den Reload (Plan §7)
        autoRefreshToken: true,
        detectSessionInUrl: true,  // noetig fuer den Passwort-Reset-Link
    },
});

// ---------------------------------------------------------------------
// Uhren-Offset gegen die Serverzeit (Plan §3.1).
//
// Einmal messen, danach rendert jeder Countdown lokal aus
// phase_deadline - (Date.now() + offset). Waehrend einer Runde fliesst
// dafuer kein einziges Paket, und Uhrendrift zwischen Geraeten ist
// eliminiert -- das war die Ursache dafuer, dass bei Stadt Land Fluss
// nicht jeder dieselbe Rundenzeit bekam.
// ---------------------------------------------------------------------
let clockOffsetMs = 0;

export function getClockOffsetMs() {
    return clockOffsetMs;
}

/** Serverzeit in ms, korrigiert um den gemessenen Offset. */
export function serverNowMs() {
    return Date.now() + clockOffsetMs;
}

export async function measureClockOffset(samples = 3) {
    let best = null;

    for (let i = 0; i < samples; i++) {
        const t0 = Date.now();
        const { data, error } = await supabase.rpc('server_now');
        const t1 = Date.now();
        if (error || !data) continue;

        const rtt = t1 - t0;
        // Annahme: Hin- und Rueckweg gleich lang. Die Messung mit der
        // kleinsten Round-Trip-Zeit ist die genaueste.
        if (best === null || rtt < best.rtt) {
            best = { rtt, offset: new Date(data).getTime() - (t0 + rtt / 2) };
        }
    }

    if (best) clockOffsetMs = best.offset;
    return clockOffsetMs;
}
