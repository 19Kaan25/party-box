#!/usr/bin/env node
/**
 * PartyBox — Verifikation Phase 0b (Client-Umstellung auf Supabase)
 *
 * Fährt zwei unabhängige Spieler gegen das echte Projekt, mit demselben
 * @supabase/supabase-js, das auch der React-Client benutzt — inklusive
 * Realtime-Presence über WebSocket. Damit ist nachweisbar, was zwei Tabs im
 * eingebauten Browser nicht zeigen könnten (die teilen sich localStorage).
 *
 * Deckt ab:
 *   - Lobby erstellen / beitreten / kicken / verlassen
 *   - Reconnect nach "Reload" (frischer Client, dieselbe Session)
 *   - Presence: ein Spieler geht offline, der andere merkt es
 *   - claim_host inkl. 30-Sekunden-Cooldown
 *   - Smoke-Test aller fünf Engines über den Bridge-Layer
 *   - Kompletter Imposter-Durchlauf (Phase-1-Pilot)
 *
 * Aufruf:
 *   node scripts/verify-phase0b.mjs
 * (liest .env.local)
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

// .env.local einlesen (kein dotenv als Dependency nötig)
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
    if (ok) { passed++; console.log(`  OK    ${name}`); }
    else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wartet, bis die Bedingung zutrifft (oder das Zeitlimit reisst).
 *  Feste sleep()-Zeiten sind bei asynchroner Konvergenz unzuverlaessig --
 *  genau daran ist der Presence-Check zuerst gescheitert, obwohl die
 *  Implementierung korrekt war. */
async function waitFor(predicate, { timeout = 15000, interval = 250 } = {}) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (predicate()) return true;
        await sleep(interval);
    }
    return false;
}

function newClient() {
    return createClient(URL_BASE, ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
}

async function signInAnon(client, displayName) {
    const { data, error } = await client.auth.signInAnonymously({
        options: { data: { display_name: displayName } },
    });
    if (error) throw new Error(`Anonyme Anmeldung fehlgeschlagen: ${error.message}`);
    return data.user.id;
}

/** Presence wie im echten Client (usePresence.js). */
function joinPresence(client, code, userId, displayName) {
    const channel = client.channel(`lobby:${code}`, { config: { presence: { key: userId } } });
    const online = new Set();
    const sync = () => { online.clear(); Object.keys(channel.presenceState()).forEach((k) => online.add(k)); };
    channel.on('presence', { event: 'sync' }, sync)
        .on('presence', { event: 'join' }, sync)
        .on('presence', { event: 'leave' }, sync)
        .subscribe(async (s) => {
            if (s === 'SUBSCRIBED') {
                await channel.track({ user_id: userId, display_name: displayName, online_at: new Date().toISOString() });
            }
        });
    return { channel, online };
}

/** Liest den Zustand so zusammen, wie useLobby es tut. */
async function readState(client, lobbyId) {
    const [lob, mem, game] = await Promise.all([
        client.from('lobbies').select('*').eq('id', lobbyId).maybeSingle(),
        client.from('lobby_members').select('user_id, display_name, score').eq('lobby_id', lobbyId).is('left_at', null).order('joined_at'),
        client.from('games').select('id, game_key, phase, state').eq('lobby_id', lobbyId).is('ended_at', null).maybeSingle(),
    ]);
    return { lobby: lob.data, members: mem.data || [], game: game.data };
}

const patch = (client, lobbyId, p) => client.rpc('legacy_apply_patch', { p_lobby: lobbyId, p_patch: p });

async function main() {
    console.log(`\nPartyBox Phase 0b — Verifikation gegen ${URL_BASE}\n`);

    // ---------------------------------------------------------------
    console.log('1. Zwei unabhängige Sessions');
    const a = newClient(); const b = newClient();
    const aId = await signInAnon(a, 'Anna');
    const bId = await signInAnon(b, 'Ben');
    check('zwei getrennte anonyme Sessions', aId !== bId);

    const { data: aProfile } = await a.from('profiles').select('display_name').eq('id', aId).maybeSingle();
    check('handle_new_user-Trigger legt Profil an', !!aProfile, `bekam: ${JSON.stringify(aProfile)}`);

    // ---------------------------------------------------------------
    console.log('\n2. Lobby erstellen und beitreten (RPCs statt Read-Modify-Write)');
    const { data: created, error: cErr } = await a.rpc('create_lobby', { p_display_name: 'Anna' });
    check('create_lobby', !cErr, cErr?.message);
    const lobbyId = created.lobby_id; const code = created.code;

    const { error: jErr } = await b.rpc('join_lobby', { p_code: code, p_display_name: 'Ben' });
    check('join_lobby', !jErr, jErr?.message);

    let st = await readState(a, lobbyId);
    check('beide Spieler sind aktive Mitglieder', st.members.length === 2, `${st.members.length}`);
    check('Anna ist Host', st.lobby.host_id === aId);

    // ---------------------------------------------------------------
    console.log('\n3. Reconnect nach Reload (Plan §7)');
    // Neuer Client mit derselben Session = das, was ein Reload tut.
    const { data: bSession } = await b.auth.getSession();
    const bReload = newClient();
    await bReload.auth.setSession({
        access_token: bSession.session.access_token,
        refresh_token: bSession.session.refresh_token,
    });
    const { data: rec } = await bReload
        .from('lobby_members')
        .select('lobby_id, lobbies!inner(closed_at)')
        .eq('user_id', bId).is('left_at', null).is('lobbies.closed_at', null)
        .limit(1).maybeSingle();
    check('Reconnect findet exakt die aktive Lobby', rec?.lobby_id === lobbyId,
        `bekam: ${JSON.stringify(rec)}`);

    const { data: srvNow } = await bReload.rpc('server_now');
    check('server_now() für den Uhren-Offset erreichbar', !!srvNow);

    // ---------------------------------------------------------------
    console.log('\n4. Presence: offline wird bemerkt');
    const pa = joinPresence(a, code, aId, 'Anna');
    const pb = joinPresence(b, code, bId, 'Ben');

    const bothOnline = await waitFor(() => pa.online.has(aId) && pa.online.has(bId));
    check('Anna sieht beide online', bothOnline, `sieht: ${[...pa.online].length}`);

    // Nur aussagekraeftig, wenn Ben vorher wirklich als online gesehen wurde --
    // sonst waere der naechste Check auch dann gruen, wenn Presence gar nicht
    // funktioniert.
    await b.removeChannel(pb.channel);         // entspricht "Tab geschlossen"
    const benGone = await waitFor(() => pa.online.has(aId) && !pa.online.has(bId));
    check('nach Verbindungsabbruch sieht Anna Ben als offline',
        bothOnline && benGone, bothOnline ? `sieht noch: ${[...pa.online].length}` : 'Vorbedingung fehlte');

    // ---------------------------------------------------------------
    console.log('\n5. Smoke-Test aller fünf Engines über den Bridge-Layer');
    // Imposter: Start (status + currentGame + arrayUnion + ganzes gameState)
    await patch(a, lobbyId, {
        status: 'GAME_IN_PROGRESS', currentGame: 'IMPOSTER',
        usedImposterWords: { __op: 'arrayUnion', values: ['Leuchtturm'] },
        gameState: { phase: 'ROLE_REVEAL', word: 'Leuchtturm', imposters: [bId], votes: {} },
    });
    st = await readState(b, lobbyId);
    check('IMPOSTER: Start beim zweiten Client sichtbar',
        st.game?.game_key === 'imposter' && st.game.state.word === 'Leuchtturm',
        JSON.stringify(st.game?.state));
    check('IMPOSTER: usedImposterWords in legacy_state',
        JSON.stringify(st.lobby.legacy_state.usedImposterWords) === '["Leuchtturm"]');

    // Imposter: Vote durch den NICHT-Host (dynamischer Punktpfad)
    await patch(b, lobbyId, { [`gameState.votes.${bId}`]: aId });
    st = await readState(a, lobbyId);
    check('IMPOSTER: Vote des Nicht-Hosts synchron beim Host',
        st.game.state.votes[bId] === aId, JSON.stringify(st.game.state.votes));

    // Werwolf: neun Keys in einem Patch
    await patch(a, lobbyId, { status: 'GAME_IN_PROGRESS', currentGame: 'WERWOLF' });
    await patch(a, lobbyId, {
        'gameState.phase': 'PLAYING', 'gameState.narrator': aId,
        'gameState.dayNumber': 1, 'gameState.isDay': false,
        'gameState.playerState': { [bId]: { role: 'WERWOLF', alive: true, inLove: false, deathReason: null } },
        'gameState.recentDeaths': [], 'gameState.witchState': { healUsed: false, poisonUsed: false },
    });
    st = await readState(b, lobbyId);
    check('WERWOLF: Multi-Key-Patch synchron', st.game.state.playerState[bId].role === 'WERWOLF',
        JSON.stringify(st.game?.state?.playerState));

    // Codenames: verschachtelte Objekte
    await patch(a, lobbyId, { status: 'GAME_IN_PROGRESS', currentGame: 'CODENAMES' });
    await patch(a, lobbyId, {
        'gameState.teams': { red: [aId], blue: [bId] },
        'gameState.spymasters': { red: aId, blue: null },
    });
    st = await readState(b, lobbyId);
    check('CODENAMES: teams/spymasters synchron',
        st.game.state.teams.red[0] === aId && st.game.state.spymasters.red === aId);

    // Wer bin ich: arrayUnion mit Objekt-Element, von beiden Clients
    await patch(a, lobbyId, { status: 'GAME_IN_PROGRESS', currentGame: 'WER_BIN_ICH' });
    await patch(a, lobbyId, { 'gameState.inputArray': { __op: 'arrayUnion', values: [{ userId: aId, words: ['Batman'] }] } });
    await patch(b, lobbyId, { 'gameState.inputArray': { __op: 'arrayUnion', values: [{ userId: bId, words: ['Merkel'] }] } });
    st = await readState(a, lobbyId);
    check('WER BIN ICH: arrayUnion von zwei Clients ergibt 2 Einträge',
        st.game.state.inputArray?.length === 2, JSON.stringify(st.game?.state?.inputArray));

    // Stadt Land Fluss: Punktpfad mit fehlender Zwischenebene
    await patch(a, lobbyId, { status: 'GAME_IN_PROGRESS', currentGame: 'STADT_LAND_FLUSS' });
    await patch(b, lobbyId, { [`gameState.answers.${bId}`]: { Stadt: 'Bonn', Land: 'Belgien' } });
    st = await readState(a, lobbyId);
    check('STADT LAND FLUSS: verschachtelter Punktpfad synchron',
        st.game.state.answers?.[bId]?.Stadt === 'Bonn', JSON.stringify(st.game?.state?.answers));

    // ---------------------------------------------------------------
    console.log('\n6. Kompletter Imposter-Durchlauf (Phase-1-Pilot)');
    await patch(a, lobbyId, { status: 'LOBBY_WAITING', gameState: {} });
    await patch(a, lobbyId, {
        status: 'GAME_IN_PROGRESS', currentGame: 'IMPOSTER',
        gameState: { phase: 'SETUP', settings: { imposterCount: 1, selectedCategories: ['orte'] } },
    });
    await patch(a, lobbyId, {
        status: 'GAME_IN_PROGRESS', currentGame: 'IMPOSTER',
        usedImposterWords: { __op: 'arrayUnion', values: ['Krankenhaus'] },
        gameState: { phase: 'ROLE_REVEAL', word: 'Krankenhaus', imposters: [bId], votes: {} },
    });
    await patch(a, lobbyId, { status: 'GAME_IN_PROGRESS', currentGame: 'IMPOSTER', 'gameState.phase': 'PLAYING' });
    await patch(a, lobbyId, { [`gameState.votes.${aId}`]: bId });
    await patch(b, lobbyId, { [`gameState.votes.${bId}`]: aId });
    await patch(a, lobbyId, { status: 'GAME_IN_PROGRESS', currentGame: 'IMPOSTER', 'gameState.phase': 'RESULT' });

    st = await readState(b, lobbyId);
    check('Imposter-Durchlauf: Endphase RESULT bei beiden Clients', st.game.state.phase === 'RESULT');
    check('Imposter-Durchlauf: beide Votes erhalten',
        Object.keys(st.game.state.votes).length === 2, JSON.stringify(st.game.state.votes));
    check('Imposter-Durchlauf: zweites Wort ergänzt, nicht überschrieben',
        st.lobby.legacy_state.usedImposterWords.length === 2,
        JSON.stringify(st.lobby.legacy_state.usedImposterWords));

    // Zurück zur Lobby, mit Punktevergabe wie die Engine sie schreibt
    await patch(a, lobbyId, {
        status: 'LOBBY_WAITING',
        players: [{ id: aId, globalScore: 5 }, { id: bId, globalScore: 3 }],
        gameState: {},
    });
    st = await readState(a, lobbyId);
    check('Spielende: keine aktive Partie mehr', st.game === null);
    check('Spielende: Punkte in lobby_members.score',
        st.members.find((m) => m.user_id === aId).score === 5 &&
        st.members.find((m) => m.user_id === bId).score === 3,
        JSON.stringify(st.members.map((m) => m.score)));

    const { count: ended } = await a.from('games')
        .select('id', { count: 'exact', head: true })
        .eq('lobby_id', lobbyId).not('ended_at', 'is', null);
    check('alle Partien sauber beendet (ended_at gesetzt)', ended === 6, `beendete Partien: ${ended}`);

    // ---------------------------------------------------------------
    console.log('\n7. claim_host inklusive Cooldown');
    const { error: tooSoon } = await b.rpc('claim_host', { p_lobby: lobbyId });
    check('claim_host direkt nach Hostwechsel wird abgelehnt',
        !!tooSoon && tooSoon.message.includes('CLAIM_TOO_SOON_OR_ALREADY_HOST'),
        tooSoon?.message);

    // Cooldown künstlich ablaufen lassen ist ohne Service-Key nicht möglich;
    // stattdessen der reguläre Weg: der Host übergibt.
    const { error: promErr } = await a.rpc('promote_host', { p_lobby: lobbyId, p_target_user: bId });
    check('promote_host durch den Host', !promErr, promErr?.message);
    st = await readState(a, lobbyId);
    check('Host ist gewechselt', st.lobby.host_id === bId);

    // ---------------------------------------------------------------
    console.log('\n8. Kicken und Verlassen');
    const { error: kickErr } = await b.rpc('kick_member', { p_lobby: lobbyId, p_target_user: aId });
    check('kick_member durch den neuen Host', !kickErr, kickErr?.message);
    st = await readState(b, lobbyId);
    check('gekickter Spieler ist raus', st.members.length === 1 && st.members[0].user_id === bId);

    const aSees = await readState(a, lobbyId);
    check('gekickter Spieler sieht die Lobby nicht mehr (RLS)', aSees.lobby === null,
        `bekam: ${JSON.stringify(aSees.lobby)}`);

    const { error: leaveErr } = await b.rpc('leave_lobby', { p_lobby: lobbyId });
    check('leave_lobby des letzten Spielers', !leaveErr, leaveErr?.message);

    // ---------------------------------------------------------------
    await a.removeChannel(pa.channel);
    console.log(`\n${'-'.repeat(62)}`);
    if (failures.length === 0) {
        console.log(`Alle ${passed} Prüfungen bestanden.`);
        console.log(`Testnutzer: ${aId} / ${bId}`);
        process.exit(0);
    }
    console.log(`${passed} bestanden, ${failures.length} fehlgeschlagen:\n`);
    failures.forEach((f) => console.log(`  - ${f}`));
    console.log(`\nTestnutzer: ${aId} / ${bId}`);
    process.exit(1);
}

main().catch((e) => { console.error(`\nAbbruch: ${e.message}`); process.exit(1); });
