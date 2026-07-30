-- =====================================================================
-- PartyBox — Verifikation Phase 0a  (Plan §12)
--
-- Laeuft komplett in EINER Transaktion und endet mit ROLLBACK: die
-- Datenbank bleibt unveraendert. Kein psql/Docker noetig, laeuft ueber die
-- Management-API des verlinkten Projekts:
--
--   npx supabase db query --linked -f scripts/verify-phase0a.sql
--
-- (Ein reines psql "$DATABASE_URL" -f ... funktioniert ebenso, falls psql
-- lokal verfuegbar ist — dann werden zusaetzlich alle RAISE NOTICE-Zeilen
-- sichtbar, s. Hinweis zur Ausgabe unten.)
--
-- Jede Pruefung ist ein assert. Faellt eine, bricht das Skript mit einem
-- klaren Postgres-Fehler und Exit-Code 1 ab (verifiziert: eine absichtlich
-- kaputte Testabfrage wurde tatsaechlich mit Exit 1 abgelehnt, kein
-- stillschweigendes Durchlaufen).
--
-- Hinweis: Die Testnutzer werden direkt in auth.users angelegt. Der
-- Spaltensatz von auth.users haengt an der GoTrue-Version — schlaegt der
-- INSERT fehl, fehlende NOT-NULL-Spalten ergaenzen.
--
-- Hinweis zur Ausgabe: `supabase db query -f` (Management-API, kein psql)
-- gibt NUR das letzte Statement mit Zeilenergebnis zurueck und unterdrueckt
-- RAISE NOTICE vollstaendig. Deshalb protokolliert dieses Skript jede
-- bestandene Pruefung zusaetzlich in einer temporaeren Tabelle t_results,
-- die als letztes Statement vor dem rollback ausgegeben wird — nur so ist
-- das Ergebnis ueber diesen Weg tatsaechlich einsehbar, nicht nur "kein
-- Fehler geworfen".
-- =====================================================================

begin;

create temporary table t_results (seq serial primary key, check_name text) on commit drop;

-- ---------------------------------------------------------------------
-- Seed: drei anonyme Testnutzer. profiles entstehen per Trigger.
-- ---------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, created_at, updated_at, is_anonymous, raw_user_meta_data)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', now(), now(), true, '{"display_name":"Alice"}'::jsonb),
  ('bbbbbbbb-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', now(), now(), true, '{"display_name":"Bob"}'::jsonb),
  ('cccccccc-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', now(), now(), true, '{"display_name":"Carol"}'::jsonb);

do $$
begin
  assert (select count(*) from public.profiles
           where id in ('aaaaaaaa-0000-4000-8000-000000000001',
                        'bbbbbbbb-0000-4000-8000-000000000002',
                        'cccccccc-0000-4000-8000-000000000003')) = 3,
    'handle_new_user-Trigger hat keine profiles angelegt';
  raise notice 'OK  profiles per Trigger angelegt';
  insert into t_results (check_name) values ('01 profiles per Trigger angelegt');
end $$;

-- ---------------------------------------------------------------------
-- Test 1: create_lobby -> join_lobby -> Host-Uebernahme bei leave_lobby
-- ---------------------------------------------------------------------
create temporary table t_ctx (k text primary key, v text) on commit drop;

-- WICHTIG: Die RPCs sind SECURITY DEFINER und lesen die Identitaet aus
-- request.jwt.claims, nicht aus der aktuellen Rolle. Fuer RPC-Aufrufe wird
-- deshalb NICHT auf "authenticated" gewechselt — das waere sogar schaedlich,
-- weil authenticated keine Rechte auf der temporaeren Tabelle t_ctx hat.
-- Auf authenticated gewechselt wird ausschliesslich fuer die RLS-Lesetests
-- (Test 5 und 6), weil RLS den Tabelleneigentuemer sonst umgeht.

-- Alice legt die Lobby an
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into t_ctx
select 'lobby_id', (public.create_lobby('Alice') ->> 'lobby_id');

insert into t_ctx
select 'code', l.code from public.lobbies l
 where l.id = (select v::uuid from t_ctx where k = 'lobby_id');

-- Bob tritt bei
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
select public.join_lobby((select v from t_ctx where k = 'code'), 'Bob');

-- Carol tritt bei
select set_config('request.jwt.claims',
  '{"sub":"cccccccc-0000-4000-8000-000000000003","role":"authenticated"}', true);
select public.join_lobby((select v from t_ctx where k = 'code'), 'Carol');

do $$
declare v_lobby uuid := (select v::uuid from t_ctx where k = 'lobby_id');
begin
  assert (select count(*) from public.lobby_members m
           where m.lobby_id = v_lobby and m.left_at is null) = 3,
    'Es sollten 3 aktive Mitglieder sein';
  assert (select l.host_id from public.lobbies l where l.id = v_lobby)
         = 'aaaaaaaa-0000-4000-8000-000000000001',
    'Alice sollte Host sein';
  raise notice 'OK  create_lobby + 2x join_lobby';
  insert into t_results (check_name) values ('02 create_lobby + 2x join_lobby');
end $$;

-- ---------------------------------------------------------------------
-- Test 2 (NEU): Host verlaesst die Lobby -> automatische Uebernahme
-- durch das verbleibende Mitglied mit dem fruehesten joined_at (= Bob)
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public.leave_lobby((select v::uuid from t_ctx where k = 'lobby_id'));

do $$
declare
  v_lobby uuid := (select v::uuid from t_ctx where k = 'lobby_id');
  v_host  uuid;
begin
  select l.host_id into v_host from public.lobbies l where l.id = v_lobby;
  assert v_host = 'bbbbbbbb-0000-4000-8000-000000000002',
    format('Host haette automatisch auf Bob wechseln muessen, ist aber %s', v_host);
  assert (select m.left_at from public.lobby_members m
           where m.lobby_id = v_lobby
             and m.user_id = 'aaaaaaaa-0000-4000-8000-000000000001') is not null,
    'Alice haette left_at gesetzt bekommen muessen';
  assert (select l.closed_at from public.lobbies l where l.id = v_lobby) is null,
    'Lobby darf noch nicht geschlossen sein, es sind noch 2 Mitglieder aktiv';
  raise notice 'OK  automatische Host-Uebernahme bei explizitem Verlassen';
  insert into t_results (check_name) values ('03 automatische Host-Uebernahme bei explizitem Verlassen');
end $$;

-- ---------------------------------------------------------------------
-- Test 3: claim_host-Cooldown — zweiter Aufruf innerhalb 30s scheitert
-- ---------------------------------------------------------------------
do $$
declare v_lobby uuid := (select v::uuid from t_ctx where k = 'lobby_id');
begin
  perform set_config('request.jwt.claims',
    '{"sub":"cccccccc-0000-4000-8000-000000000003","role":"authenticated"}', true);
  begin
    perform public.claim_host(v_lobby);
    assert false, 'claim_host haette am 30s-Cooldown scheitern muessen';
  exception
    -- Nur raise_exception (P0001) fangen, NICHT assert_failure (P0004) —
    -- sonst wuerde das assert false oben stillschweigend geschluckt.
    when raise_exception then
      assert sqlerrm = 'CLAIM_TOO_SOON_OR_ALREADY_HOST',
        format('Unerwarteter Fehler: %s', sqlerrm);
      raise notice 'OK  claim_host-Cooldown greift';
      insert into t_results (check_name) values ('04 claim_host-Cooldown greift');
  end;
end $$;

-- Nach Ablauf des Cooldowns muss es funktionieren.
update public.lobbies set host_claimed_at = now() - interval '31 seconds'
 where id = (select v::uuid from t_ctx where k = 'lobby_id');

do $$
declare v_lobby uuid := (select v::uuid from t_ctx where k = 'lobby_id');
begin
  perform set_config('request.jwt.claims',
    '{"sub":"cccccccc-0000-4000-8000-000000000003","role":"authenticated"}', true);
  perform public.claim_host(v_lobby);
  assert (select l.host_id from public.lobbies l where l.id = v_lobby)
         = 'cccccccc-0000-4000-8000-000000000003',
    'Carol haette nach Ablauf des Cooldowns Host werden muessen';
  raise notice 'OK  claim_host nach Cooldown';
  insert into t_results (check_name) values ('05 claim_host nach Cooldown');
end $$;

-- ---------------------------------------------------------------------
-- Test 4: Namenskollision (deterministischer Teil des Race-Tests).
-- Der echte Parallel-Test steht in scripts/verify-phase0a.mjs.
-- ---------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
  begin
    perform public.join_lobby((select v from t_ctx where k = 'code'), 'Bob');
    assert false, 'Doppelter Displayname haette abgelehnt werden muessen';
  exception
    when unique_violation then
      raise notice 'OK  lobby_members_name_unique verhindert doppelte Namen';
      insert into t_results (check_name) values ('06 lobby_members_name_unique verhindert doppelte Namen');
  end;
end $$;

-- ---------------------------------------------------------------------
-- Test 5: RLS — lobbies ist nicht enumerierbar
-- ---------------------------------------------------------------------
-- Zweite Lobby, in der Bob NICHT Mitglied ist.
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into t_ctx select 'lobby2_id', (public.create_lobby('Alice') ->> 'lobby_id');

do $$
declare
  v_l2      uuid := (select v::uuid from t_ctx where k = 'lobby2_id');
  v_visible int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into v_visible from public.lobbies l where l.id = v_l2;
  reset role;

  assert v_visible = 0,
    format('Bob darf die fremde Lobby nicht sehen, sieht aber %s Zeilen', v_visible);
  raise notice 'OK  RLS: fremde Lobby unsichtbar (kein Code-Enumerieren)';
  insert into t_results (check_name) values ('07 RLS: fremde Lobby unsichtbar (kein Code-Enumerieren)');
end $$;

-- ---------------------------------------------------------------------
-- Test 6: RLS — player_secrets zeigt nur die eigene Zeile
-- ---------------------------------------------------------------------
insert into public.games (id, lobby_id, game_key, phase)
values ('11111111-0000-4000-8000-000000000001',
        (select v::uuid from t_ctx where k = 'lobby_id'), 'imposter', 'ROLE_REVEAL');

insert into public.player_secrets (game_id, user_id, payload) values
  ('11111111-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002',
   '{"role":"innocent","word":"Leuchtturm"}'::jsonb),
  ('11111111-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000003',
   '{"role":"imposter"}'::jsonb);

do $$
declare
  v_rows    int;
  v_payload jsonb;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into v_rows from public.player_secrets;
  select ps.payload into v_payload from public.player_secrets ps limit 1;
  reset role;

  assert v_rows = 1,
    format('Bob darf genau 1 Geheimnis sehen, sieht aber %s', v_rows);
  assert v_payload ->> 'word' = 'Leuchtturm',
    'Bob sollte sein eigenes Wort sehen';
  raise notice 'OK  RLS: player_secrets nur eigene Zeile (n=1, nicht n=2)';
  insert into t_results (check_name) values ('08 RLS: player_secrets nur eigene Zeile (n=1, nicht n=2)');
end $$;

-- Gegenprobe: auch der Host sieht fremde Geheimnisse nicht.
do $$
declare v_rows int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"cccccccc-0000-4000-8000-000000000003","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into v_rows from public.player_secrets;
  reset role;

  assert v_rows = 1,
    format('Auch der Host darf nur 1 Geheimnis sehen, sieht aber %s', v_rows);
  raise notice 'OK  RLS: auch der Host liest keine fremden Geheimnisse';
  insert into t_results (check_name) values ('09 RLS: auch der Host liest keine fremden Geheimnisse');
end $$;

-- ---------------------------------------------------------------------
-- Test 7: kick_member und promote_host
-- ---------------------------------------------------------------------
do $$
declare v_lobby uuid := (select v::uuid from t_ctx where k = 'lobby_id');
begin
  -- Bob ist kein Host mehr (Carol hat uebernommen) -> darf nicht kicken
  perform set_config('request.jwt.claims',
    '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
  begin
    perform public.kick_member(v_lobby, 'cccccccc-0000-4000-8000-000000000003');
    assert false, 'Nicht-Host haette nicht kicken duerfen';
  exception when raise_exception then
    assert sqlerrm = 'NOT_HOST', format('Unerwarteter Fehler: %s', sqlerrm);
  end;
  raise notice 'OK  kick_member durch Nicht-Host abgelehnt';
  insert into t_results (check_name) values ('10a kick_member durch Nicht-Host abgelehnt');

  -- Carol (Host) macht Bob zum Host
  perform set_config('request.jwt.claims',
    '{"sub":"cccccccc-0000-4000-8000-000000000003","role":"authenticated"}', true);
  perform public.promote_host(v_lobby, 'bbbbbbbb-0000-4000-8000-000000000002');
  assert (select l.host_id from public.lobbies l where l.id = v_lobby)
         = 'bbbbbbbb-0000-4000-8000-000000000002',
    'promote_host hat host_id nicht gesetzt';
  raise notice 'OK  promote_host';
  insert into t_results (check_name) values ('10b promote_host');

  -- Bob (jetzt Host) kickt Carol
  perform set_config('request.jwt.claims',
    '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
  perform public.kick_member(v_lobby, 'cccccccc-0000-4000-8000-000000000003');
  assert (select m.left_at from public.lobby_members m
           where m.lobby_id = v_lobby
             and m.user_id = 'cccccccc-0000-4000-8000-000000000003') is not null,
    'kick_member hat left_at nicht gesetzt';
  assert (select l.host_id from public.lobbies l where l.id = v_lobby)
         = 'bbbbbbbb-0000-4000-8000-000000000002',
    'kick_member darf den Host-Status des Aufrufers nicht anfassen';
  raise notice 'OK  kick_member durch Host, Host-Status unveraendert';
  insert into t_results (check_name) values ('10c kick_member durch Host, Host-Status unveraendert');

  -- Selbst-Kick ist verboten
  begin
    perform public.kick_member(v_lobby, 'bbbbbbbb-0000-4000-8000-000000000002');
    assert false, 'Selbst-Kick haette abgelehnt werden muessen';
  exception when raise_exception then
    assert sqlerrm = 'CANNOT_KICK_SELF', format('Unerwarteter Fehler: %s', sqlerrm);
  end;
  raise notice 'OK  Selbst-Kick abgelehnt';
  insert into t_results (check_name) values ('10d Selbst-Kick abgelehnt');
end $$;

-- ---------------------------------------------------------------------
-- Test 8: letzter Spieler verlaesst -> Lobby wird sofort geschlossen
-- ---------------------------------------------------------------------
do $$
declare v_lobby uuid := (select v::uuid from t_ctx where k = 'lobby_id');
begin
  perform set_config('request.jwt.claims',
    '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
  perform public.leave_lobby(v_lobby);

  assert (select l.closed_at from public.lobbies l where l.id = v_lobby) is not null,
    'Lobby haette geschlossen werden muessen, als der letzte Spieler ging';
  raise notice 'OK  letzte Person verlaesst -> closed_at gesetzt';
  insert into t_results (check_name) values ('11 letzte Person verlaesst -> closed_at gesetzt');
end $$;

-- ---------------------------------------------------------------------
-- Test 9: Retention — purge-old-games mit zurueckdatiertem ended_at
-- ---------------------------------------------------------------------
update public.games
   set ended_at = now() - interval '91 days'
 where id = '11111111-0000-4000-8000-000000000001';

insert into public.game_events (game_id, round_no, actor_id, kind)
values ('11111111-0000-4000-8000-000000000001', 1,
        'bbbbbbbb-0000-4000-8000-000000000002', 'vote');

do $$
declare v_events_before int;
begin
  select count(*) into v_events_before from public.game_events
   where game_id = '11111111-0000-4000-8000-000000000001';
  assert v_events_before = 1, 'Test-Event fehlt';

  -- exakt die Anweisung aus dem Cron-Job purge-old-games
  delete from public.games
   where (ended_at is not null and ended_at   < now() - interval '90 days')
      or (ended_at is null     and started_at < now() - interval '90 days');

  assert (select count(*) from public.games
           where id = '11111111-0000-4000-8000-000000000001') = 0,
    'Alte Partie haette geloescht werden muessen';
  assert (select count(*) from public.game_events
           where game_id = '11111111-0000-4000-8000-000000000001') = 0,
    'game_events haetten per Cascade mitverschwinden muessen';
  assert (select count(*) from public.player_secrets
           where game_id = '11111111-0000-4000-8000-000000000001') = 0,
    'player_secrets haetten per Cascade mitverschwinden muessen';
  raise notice 'OK  Retention loescht Partie inkl. Events und Secrets (Cascade)';
  insert into t_results (check_name) values ('12 Retention loescht Partie inkl. Events und Secrets (Cascade)');
end $$;

-- ---------------------------------------------------------------------
-- Test 10: Trockenlauf fuer purge_stale_anonymous_users.
-- Bewusst nur SELECT — der destruktive Job wird hier NICHT ausgefuehrt.
-- ---------------------------------------------------------------------
do $$
declare v_victims int;
begin
  select count(*) into v_victims
    from auth.users u
   where u.is_anonymous
     and u.created_at < now() - interval '30 days'
     and not exists (select 1 from public.lobby_members m
                      where m.user_id = u.id and m.left_at is null);
  raise notice 'INFO  purge_stale_anonymous_users wuerde % Nutzer loeschen', v_victims;
  insert into t_results (check_name)
  values (format('13 INFO purge_stale_anonymous_users wuerde %s Nutzer loeschen', v_victims));
end $$;

-- Letztes Statement mit Zeilenergebnis: das ist es, was `supabase db query`
-- tatsaechlich anzeigt. Erwartet: 16 Zeilen (01..09, 10a..10d, 11..13),
-- luecken- und duplikatfrei.
select seq, check_name from t_results order by seq;

rollback;

-- Alles ok, wenn oben alle 16 Zeilen erscheinen und keine Assertion
-- gefeuert hat (jeder assert-Fehlschlag haette das Skript vorher mit einem
-- klaren Postgres-Fehler abgebrochen, siehe Kommentar am Dateianfang).
