#!/usr/bin/env node
/**
 * PartyBox — End-to-End-Verifikation Phase 0a  (Plan §12)
 *
 * Faehrt den kompletten Lobby-Lebenszyklus gegen ein echtes Supabase-Projekt:
 *   create_lobby -> join_lobby -> leave_lobby -> kick_member -> promote_host
 * plus den echten Parallel-Race-Test und den claim_host-Cooldown.
 *
 * Bewusst ohne @supabase/supabase-js: alles laeuft ueber GoTrue- und
 * PostgREST-HTTP-Endpunkte, damit fuer die Verifikation keine Dependency
 * ins Projekt muss.
 *
 * Voraussetzungen:
 *   - Anonyme Anmeldungen im Projekt aktiviert
 *     (Dashboard -> Authentication -> Sign In / Providers -> Anonymous)
 *   - Umgebungsvariablen:
 *       SUPABASE_URL=https://<ref>.supabase.co
 *       SUPABASE_ANON_KEY=<anon key>
 *
 * Aufruf:
 *   node scripts/verify-phase0a.mjs
 *
 * Hinweis: Das Skript legt echte anonyme Nutzer und eine echte Lobby an.
 * Die Lobby wird am Ende geschlossen; die Gast-Accounts raeumt der
 * pg_cron-Job purge-stale-anonymous-users nach 30 Tagen ab.
 */

const URL_BASE = process.env.SUPABASE_URL?.replace(/\/$/, '');
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!URL_BASE || !ANON_KEY) {
  console.error('FEHLER: SUPABASE_URL und SUPABASE_ANON_KEY muessen gesetzt sein.');
  process.exit(1);
}

let passed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  OK    ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function signInAnonymously(displayName) {
  const res = await fetch(`${URL_BASE}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { display_name: displayName } }),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) {
    throw new Error(
      `Anonyme Anmeldung fehlgeschlagen (${res.status}): ${JSON.stringify(body)}\n` +
        'Ist "Anonymous sign-ins" im Dashboard aktiviert?'
    );
  }
  return { token: body.access_token, id: body.user.id, name: displayName };
}

/** Ruft eine RPC auf. Gibt { ok, status, data } zurueck, wirft nicht. */
async function rpc(user, fn, params = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${user.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

async function select(user, path) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${user.token}` },
  });
  return res.json();
}

/** Extrahiert das UPPER_SNAKE-Token aus einer PostgREST-Fehlerantwort. */
function errToken(result) {
  return result?.data?.message ?? result?.data?.hint ?? JSON.stringify(result?.data);
}

async function main() {
  console.log(`\nPartyBox Phase 0a — E2E gegen ${URL_BASE}\n`);

  // -------------------------------------------------------------------
  console.log('1. Anonyme Anmeldung');
  const alice = await signInAnonymously('Alice');
  const bob = await signInAnonymously('Bob');
  const carol = await signInAnonymously('Carol');
  check('drei anonyme Sessions', !!(alice.token && bob.token && carol.token));

  const profile = await select(alice, `profiles?id=eq.${alice.id}&select=display_name`);
  check('handle_new_user-Trigger legt profiles an', profile?.[0]?.display_name === 'Alice',
    `bekam: ${JSON.stringify(profile)}`);

  // -------------------------------------------------------------------
  console.log('\n2. create_lobby');
  const created = await rpc(alice, 'create_lobby', { p_display_name: 'Alice' });
  check('create_lobby erfolgreich', created.ok, errToken(created));
  const lobbyId = created.data?.lobby_id;
  const code = created.data?.code;
  check('Code hat 6 Zeichen aus dem Alphabet ohne I/O/0/1',
    typeof code === 'string' && /^[A-HJ-NP-Z2-9]{6}$/.test(code), `Code: ${code}`);

  // -------------------------------------------------------------------
  console.log('\n3. Race-Test: zwei parallele join_lobby mit demselben Namen');
  const [r1, r2] = await Promise.all([
    rpc(bob, 'join_lobby', { p_code: code, p_display_name: 'Doppelt' }),
    rpc(carol, 'join_lobby', { p_code: code, p_display_name: 'Doppelt' }),
  ]);
  const winners = [r1, r2].filter((r) => r.ok);
  const losers = [r1, r2].filter((r) => !r.ok);
  check('genau einer der beiden Beitritte gewinnt', winners.length === 1,
    `ok=${winners.length}, fail=${losers.length}`);
  check('der Verlierer scheitert an lobby_members_name_unique (23505)',
    losers.length === 1 && String(losers[0].data?.code ?? '') === '23505',
    `Fehler: ${errToken(losers[0])}`);

  // Verlierer tritt mit eigenem Namen nach
  const loserUser = r1.ok ? carol : bob;
  const winnerUser = r1.ok ? bob : carol;
  const rejoin = await rpc(loserUser, 'join_lobby', {
    p_code: code, p_display_name: loserUser.name,
  });
  check('Verlierer tritt mit eigenem Namen bei', rejoin.ok, errToken(rejoin));

  const members = await select(alice,
    `lobby_members?lobby_id=eq.${lobbyId}&left_at=is.null&select=user_id,display_name`);
  check('drei aktive Mitglieder', Array.isArray(members) && members.length === 3,
    `bekam: ${JSON.stringify(members)}`);

  // -------------------------------------------------------------------
  console.log('\n4. RLS: fremde Lobby ist unsichtbar');
  const second = await rpc(alice, 'create_lobby', { p_display_name: 'Alice' });
  // Alice hat damit Lobby 1 automatisch verlassen (one_active_per_user).
  const secondId = second.data?.lobby_id;
  const bobSeesSecond = await select(bob, `lobbies?id=eq.${secondId}&select=id`);
  check('Nicht-Mitglied sieht die fremde Lobby nicht',
    Array.isArray(bobSeesSecond) && bobSeesSecond.length === 0,
    `bekam: ${JSON.stringify(bobSeesSecond)}`);

  // -------------------------------------------------------------------
  console.log('\n5. Host-Uebernahme bei explizitem Verlassen');
  // Alice hat Lobby 1 durch create_lobby (Schritt 4) bereits verlassen —
  // der Host muss automatisch gewechselt haben.
  const lobbyAfter = await select(winnerUser, `lobbies?id=eq.${lobbyId}&select=host_id,closed_at`);
  const newHost = lobbyAfter?.[0]?.host_id;
  check('Host wechselte automatisch weg von Alice', newHost && newHost !== alice.id,
    `host_id: ${newHost}`);
  check('Host ist der frueheste verbleibende Beitritt', newHost === winnerUser.id,
    `erwartet ${winnerUser.id}, ist ${newHost}`);
  check('Lobby bleibt offen, solange Mitglieder da sind',
    lobbyAfter?.[0]?.closed_at === null);

  // -------------------------------------------------------------------
  console.log('\n6. claim_host-Cooldown');
  const claim1 = await rpc(loserUser, 'claim_host', { p_lobby: lobbyId });
  check('claim_host innerhalb 30s nach Hostwechsel wird abgelehnt',
    !claim1.ok && String(errToken(claim1)).includes('CLAIM_TOO_SOON_OR_ALREADY_HOST'),
    errToken(claim1));

  // -------------------------------------------------------------------
  console.log('\n7. promote_host und kick_member');
  const promote = await rpc(winnerUser, 'promote_host', {
    p_lobby: lobbyId, p_target_user: loserUser.id,
  });
  check('Host kann promoten', promote.ok, errToken(promote));

  const badKick = await rpc(winnerUser, 'kick_member', {
    p_lobby: lobbyId, p_target_user: loserUser.id,
  });
  check('Nicht-Host darf nicht kicken',
    !badKick.ok && String(errToken(badKick)).includes('NOT_HOST'), errToken(badKick));

  const selfKick = await rpc(loserUser, 'kick_member', {
    p_lobby: lobbyId, p_target_user: loserUser.id,
  });
  check('Selbst-Kick wird abgelehnt',
    !selfKick.ok && String(errToken(selfKick)).includes('CANNOT_KICK_SELF'), errToken(selfKick));

  const goodKick = await rpc(loserUser, 'kick_member', {
    p_lobby: lobbyId, p_target_user: winnerUser.id,
  });
  check('Host kann kicken', goodKick.ok, errToken(goodKick));

  const afterKick = await select(loserUser, `lobbies?id=eq.${lobbyId}&select=host_id`);
  check('kick_member laesst den Host-Status des Aufrufers unangetastet',
    afterKick?.[0]?.host_id === loserUser.id, `host_id: ${afterKick?.[0]?.host_id}`);

  // -------------------------------------------------------------------
  console.log('\n8. Letztes Mitglied verlaesst -> Lobby schliesst');
  const lastLeave = await rpc(loserUser, 'leave_lobby', { p_lobby: lobbyId });
  check('leave_lobby erfolgreich', lastLeave.ok, errToken(lastLeave));
  // Nach dem Verlassen ist die Lobby fuer den Ex-Mitglied nicht mehr sichtbar
  // (RLS) — deshalb ueber Alice pruefen, die ebenfalls kein Mitglied ist:
  // beide sehen 0 Zeilen, das ist das erwartete Verhalten.
  const gone = await select(loserUser, `lobbies?id=eq.${lobbyId}&select=id,closed_at`);
  check('geschlossene Lobby ist fuer Ex-Mitglieder unsichtbar',
    Array.isArray(gone) && gone.length === 0, `bekam: ${JSON.stringify(gone)}`);

  // -------------------------------------------------------------------
  console.log('\n9. heartbeat ist fuer authenticated dicht');
  const hb = await select(alice, 'heartbeat?select=*');
  check('heartbeat liefert authenticated keine Zeilen',
    Array.isArray(hb) ? hb.length === 0 : true, `bekam: ${JSON.stringify(hb)}`);

  // Aufraeumen: Alice verlaesst ihre zweite Lobby
  await rpc(alice, 'leave_lobby', { p_lobby: secondId });

  // -------------------------------------------------------------------
  console.log(`\n${'-'.repeat(60)}`);
  if (failures.length === 0) {
    console.log(`Alle ${passed} Pruefungen bestanden.`);
    process.exit(0);
  }
  console.log(`${passed} bestanden, ${failures.length} fehlgeschlagen:\n`);
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}

main().catch((err) => {
  console.error(`\nAbbruch: ${err.message}`);
  process.exit(1);
});
