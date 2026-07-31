#!/usr/bin/env node
/**
 * PartyBox — Verifikation Phase 0c (Benutzernamen, Freunde, Einladungen)
 *
 * Zwei unabhängige Clients gegen das echte Projekt, mit demselben
 * @supabase/supabase-js wie der React-Client. Zwei Browser-Tabs gingen
 * nicht: die teilen sich localStorage und damit die Sitzung.
 *
 * Deckt ab:
 *   - Registrierung mit Benutzername (Handle Name#1234)
 *   - Suche nur bei exaktem Handle
 *   - Anfrage -> Annahme, Gegenanfrage wird zur Annahme
 *   - Online-Status über touch_presence, inkl. Ablauf nach 90 Sekunden
 *   - "in einer Lobby" ohne Herausgabe des Lobby-Codes
 *   - Einladung -> Beitritt über den Code aus der Einladung
 *   - Realtime: die Einladung erreicht den Empfänger ohne Nachfragen
 *
 * Am Ende gibt es die fertige DELETE-Anweisung für die angelegten
 * Testkonten aus. Bewusst nicht selbst gelöscht: dafür bräuchte es den
 * Service-Role-Key in .env.local, und der gehört nur in die serverseitigen
 * Vercel-Variablen.
 *
 * Aufruf:
 *   node scripts/verify-phase0c.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
    readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
        .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
        .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const URL_BASE = env.VITE_SUPABASE_URL;
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY;
if (!URL_BASE || !ANON_KEY) {
    console.error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY fehlen in .env.local');
    process.exit(1);
}

let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
    if (ok) { passed++; console.log(`  OK    ${name}${detail ? ` — ${detail}` : ''}`); }
    else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wartet auf Konvergenz statt fest zu schlafen. Feste sleep()-Zeiten waren
 *  in Phase 0b die Fehlerquelle: der Test schlug fehl, obwohl die
 *  Implementierung korrekt war. */
async function waitFor(predicate, { timeout = 15000, interval = 500 } = {}) {
    const deadline = Date.now() + timeout;
    for (;;) {
        if (await predicate()) return true;
        if (Date.now() >= deadline) return false;
        await sleep(interval);
    }
}

const newClient = () => createClient(URL_BASE, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
});

const stamp = Date.now();
const created = [];   // user-ids fuer das Aufraeumen

/** Anonym anmelden, dann per updateUser auf einen echten Account heben --
 *  exakt der Weg, den useAuth.registerWithEmail geht. */
async function register(label, username) {
    const c = newClient();
    const { data: anon, error: anonErr } = await c.auth.signInAnonymously();
    if (anonErr) throw new Error(`${label}: anonyme Anmeldung — ${anonErr.message}`);

    const email = `phase0c-${label}-${stamp}@example.com`;
    const { error: upErr } = await c.auth.updateUser({ email, password: `pw-${stamp}-${label}` });
    if (upErr) throw new Error(`${label}: Upgrade — ${upErr.message}`);

    const { data: handle, error: nameErr } = await c.rpc('set_username', { p_username: username });
    if (nameErr) throw new Error(`${label}: set_username — ${nameErr.message}`);

    created.push(anon.user.id);
    return { client: c, id: anon.user.id, email, ...handle };
}

async function main() {
    console.log('\n=== Phase 0c: Identität, Freunde, Einladungen ===\n');

    // -----------------------------------------------------------------
    console.log('-- Registrierung mit Benutzername');
    const A = await register('a', `PruefA${stamp % 10000}`);
    const B = await register('b', `PruefB${stamp % 10000}`);

    check('01 A bekommt einen vierstelligen Code',
        /^[0-9]{4}$/.test(A.discriminator), `${A.username}#${A.discriminator}`);
    check('02 B bekommt einen eigenen Handle',
        /^[0-9]{4}$/.test(B.discriminator), `${B.username}#${B.discriminator}`);

    // -----------------------------------------------------------------
    console.log('\n-- Suche');
    {
        const { data: hit } = await A.client.rpc('find_profile_by_handle', {
            p_username: B.username.toLowerCase(), p_discriminator: B.discriminator,
        });
        const { data: miss } = await A.client.rpc('find_profile_by_handle', {
            p_username: B.username, p_discriminator: '0000' === B.discriminator ? '1111' : '0000',
        });
        check('03 exakter Handle wird gefunden (auch klein geschrieben)',
            hit?.length === 1 && hit[0].id === B.id);
        check('04 falscher Code findet nichts', (miss?.length ?? 0) === 0);
    }

    // -----------------------------------------------------------------
    console.log('\n-- Freundschaft');
    {
        const { error } = await A.client.rpc('send_friend_request', {
            p_username: B.username, p_discriminator: B.discriminator,
        });
        check('05 A sendet Anfrage an B', !error, error?.message);

        const { data: bList } = await B.client.rpc('list_friends');
        const row = (bList || []).find((f) => f.id === A.id);
        check('06 B sieht die Anfrage als eingehend',
            row?.direction === 'incoming' && row?.status === 'pending', row?.direction);
        check('07 offene Anfrage verrät den Status nicht',
            row?.last_seen_at === null && row?.online === false,
            `last_seen_at=${row?.last_seen_at}, online=${row?.online}`);

        // Der Absender darf nicht selbst annehmen.
        const { error: selfErr } = await A.client.rpc('respond_friend_request', {
            p_other: B.id, p_accept: true,
        });
        check('08 A kann die eigene Anfrage nicht annehmen',
            !!selfErr && selfErr.message.includes('NOT_THE_RECIPIENT'), selfErr?.message);

        const { error: accErr } = await B.client.rpc('respond_friend_request', {
            p_other: A.id, p_accept: true,
        });
        check('09 B nimmt an', !accErr, accErr?.message);

        const { data: aList } = await A.client.rpc('list_friends');
        check('10 A hat genau einen Freund',
            (aList || []).filter((f) => f.direction === 'accepted').length === 1);
    }

    // -----------------------------------------------------------------
    console.log('\n-- Online-Status');
    {
        await B.client.rpc('touch_presence', { p_lobby: null });
        const { data } = await A.client.rpc('list_friends');
        const row = (data || []).find((f) => f.id === B.id);
        check('11 B gilt als online', row?.online === true, `online=${row?.online}`);
        check('12 B gilt noch nicht als "in Lobby"', row?.in_lobby === false);
    }

    // -----------------------------------------------------------------
    console.log('\n-- Lobby, Einladung, Beitritt');
    let lobbyId, lobbyCode;
    {
        const { data: lob, error } = await A.client.rpc('create_lobby', { p_display_name: 'Anna' });
        if (error) throw new Error(`create_lobby: ${error.message}`);
        lobbyId = lob.lobby_id;
        lobbyCode = lob.code;
        check('13 Lobby-Code ist sechsstellig', /^[A-Z2-9]{6}$/.test(lobbyCode), lobbyCode);

        await A.client.rpc('touch_presence', { p_lobby: lobbyId });
        const { data: bView } = await B.client.rpc('list_friends');
        const row = (bView || []).find((f) => f.id === A.id);
        check('14 B sieht A als "in einer Lobby"', row?.in_lobby === true);
        check('15 der Lobby-Code steht nirgends in list_friends',
            !JSON.stringify(bView).includes(lobbyCode));

        // Realtime: die Einladung muss ohne Nachfragen ankommen.
        let pushed = null;
        const channel = B.client
            .channel(`friends:${B.id}`)
            .on('postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'lobby_invites', filter: `to_user=eq.${B.id}` },
                (payload) => { pushed = payload.new; })
            .subscribe();
        await waitFor(async () => channel.state === 'joined', { timeout: 10000 });

        const { error: invErr } = await A.client.rpc('invite_friend_to_lobby', {
            p_lobby: lobbyId, p_to_user: B.id,
        });
        check('16 A lädt B ein', !invErr, invErr?.message);

        const arrived = await waitFor(async () => pushed !== null, { timeout: 15000 });
        check('17 die Einladung erreicht B per Realtime', arrived);
        B.client.removeChannel(channel);

        const { data: invites } = await B.client.rpc('list_my_invites');
        check('18 B sieht die Einladung inklusive Code',
            invites?.length === 1 && invites[0].lobby_code === lobbyCode,
            invites?.[0]?.lobby_code);
        check('19 die Einladung nennt den Absender',
            invites?.[0]?.username === A.username, invites?.[0]?.username);

        const { error: joinErr } = await B.client.rpc('join_lobby', {
            p_code: invites[0].lobby_code, p_display_name: 'Ben',
        });
        check('20 B tritt über den Code aus der Einladung bei', !joinErr, joinErr?.message);

        const { data: after } = await B.client.rpc('list_my_invites');
        check('21 der Beitritt räumt die Einladung ab', (after?.length ?? 0) === 0);

        const { data: members } = await A.client
            .from('lobby_members').select('user_id').eq('lobby_id', lobbyId).is('left_at', null);
        check('22 beide sind Mitglied', members?.length === 2, `${members?.length} Mitglieder`);
    }

    // -----------------------------------------------------------------
    console.log('\n-- Grenzen');
    {
        const { error: e1 } = await A.client.rpc('set_username', { p_username: 'a'.repeat(21) });
        check('23 21 Zeichen werden abgelehnt',
            !!e1 && e1.message.includes('USERNAME_INVALID'), e1?.message);

        const { error: e2 } = await A.client.rpc('set_username', { p_username: 'mit leerzeichen' });
        check('24 Leerzeichen werden abgelehnt',
            !!e2 && e2.message.includes('USERNAME_INVALID'), e2?.message);

        const { error: e3 } = await A.client.rpc('create_lobby', { p_display_name: 'n'.repeat(21) });
        check('25 Anzeigename über 20 Zeichen wird abgelehnt',
            !!e3 && e3.message.includes('DISPLAY_NAME_TOO_LONG'), e3?.message);

        const { error: e4 } = await A.client.from('friendships').insert({
            user_low: A.id, user_high: B.id, requested_by: A.id,
        });
        check('26 direktes Schreiben in friendships scheitert', !!e4, e4?.code);

        const { data: st, error: e5 } = await A.client.from('user_status').select('*');
        check('27 user_status ist für den Client nicht lesbar',
            !!e5 || (st?.length ?? 0) === 0, e5?.code ?? `${st?.length} Zeilen`);
    }

    // -----------------------------------------------------------------
    // Der Ablauf des Online-Status ist der einzige Punkt, der echte Zeit
    // braucht: list_friends() zieht die Grenze bei 90 Sekunden, und B hat
    // seit dem letzten touch_presence keinen Schlag mehr geschickt.
    console.log('\n-- Ablauf des Online-Status (dauert gut 90 Sekunden)');
    {
        const wentOffline = await waitFor(async () => {
            const { data } = await B.client.rpc('list_friends');
            return (data || []).find((f) => f.id === A.id)?.online === false;
        }, { timeout: 150000, interval: 5000 });

        const { data } = await B.client.rpc('list_friends');
        const row = (data || []).find((f) => f.id === A.id);
        check('28 A gilt ohne Herzschlag nach 90 s als offline', wentOffline,
            `online=${row?.online}`);
        check('29 "zuletzt online" bleibt für die Anzeige erhalten',
            !!row?.last_seen_at, row?.last_seen_at);
        check('30 und "in Lobby" fällt mit dem Status weg', row?.in_lobby === false);
    }

    // -----------------------------------------------------------------
    // Bewusst KEIN Löschen aus dem Skript heraus: dafür bräuchte es den
    // Service-Role-Key in .env.local, und der gehört ausschließlich in die
    // serverseitigen Vercel-Variablen. Stattdessen die fertige Anweisung
    // ausgeben — ausgeführt wird sie über die CLI, die ohnehin am Projekt
    // angemeldet ist.
    console.log('\n-- Aufräumen (über die CLI, nicht aus dem Skript)');
    console.log(`  delete from auth.users where id in (${created.map((i) => `'${i}'`).join(', ')});`);

    console.log(`\n=== ${passed} bestanden, ${failures.length} fehlgeschlagen ===`);
    if (failures.length) {
        failures.forEach((f) => console.log(`  - ${f}`));
        process.exit(1);
    }
}

main().catch((err) => { console.error('\nAbbruch:', err.message); process.exit(1); });
