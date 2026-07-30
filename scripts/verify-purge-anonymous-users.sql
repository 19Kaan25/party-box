-- =====================================================================
-- PartyBox — Verifikation des ECHTEN DELETE-Pfads von
-- public.purge_stale_anonymous_users() (nicht nur der Trockenlauf aus
-- verify-phase0a.sql Test 10).
--
-- Sechs synthetische Faelle, siehe Kommentare unten. Laeuft komplett in
-- EINER Transaktion und endet mit ROLLBACK — die Datenbank bleibt
-- unveraendert, unabhaengig davon, was die Funktion tatsaechlich tut.
--
--   npx supabase db query --linked -f scripts/verify-purge-anonymous-users.sql
--
-- Ausgabe-Hinweis (wie in verify-phase0a.sql): `supabase db query -f` zeigt
-- nur das letzte Statement mit Zeilenergebnis und unterdrueckt RAISE NOTICE.
-- Deshalb sammelt dieses Skript jede Beobachtung in t_results und gibt sie
-- als letztes Statement vor dem rollback aus.
--
-- Bewusster Unterschied zu Fall 1/2/4/5/6 (harte Asserts) vs. Fall 3
-- (rein beobachtend geloggt, kein Assert): genau das Verhalten von
-- lobbies.host_id beim Loeschen des Hosts ist die offene Frage, die dieses
-- Skript beantworten soll — nicht ein erwartetes Ergebnis pruefen, das wir
-- vorher schon kennen wuerden.
-- =====================================================================

begin;

create temporary table t_results (seq serial primary key, check_name text) on commit drop;

-- ---------------------------------------------------------------------
-- Testnutzer. created_at wird explizit zurueckdatiert, weil das die
-- einzige Bedingung ist, die purge_stale_anonymous_users() dafuer prueft.
--
--   c1 = Fall 1: 35 Tage, nie in einer Lobby
--   c2 = Fall 2: 35 Tage, alte verlassene lobby_members-Zeile
--   c3 = Fall 3: 35 Tage, war Host einer geschlossenen Lobby, hat sie verlassen
--   c4 = Fall 4: 35 Tage, AKTIVES Mitglied einer offenen Lobby
--   c5 = Fall 5: 10 Tage alt (zu jung)
--   c6 = Fall 6: registriert (is_anonymous=false), 400 Tage alt
--   c7 = Helferaccount, hostet die Lobby aus Fall 2, frisch & nicht anonym
--        betroffen -> dient nur als Gegenprobe, dass er unangetastet bleibt
-- ---------------------------------------------------------------------
insert into auth.users
  (id, instance_id, aud, role, created_at, updated_at, is_anonymous, email, raw_user_meta_data)
values
  ('aaaaaaa1-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', now() - interval '35 days', now(), true, null,
   '{"display_name":"Fall1"}'::jsonb),
  ('aaaaaaa2-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', now() - interval '35 days', now(), true, null,
   '{"display_name":"Fall2"}'::jsonb),
  ('aaaaaaa3-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', now() - interval '35 days', now(), true, null,
   '{"display_name":"Fall3"}'::jsonb),
  ('aaaaaaa4-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', now() - interval '35 days', now(), true, null,
   '{"display_name":"Fall4"}'::jsonb),
  ('aaaaaaa5-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', now() - interval '10 days', now(), true, null,
   '{"display_name":"Fall5"}'::jsonb),
  ('aaaaaaa6-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', now() - interval '400 days', now(), false,
   'fall6-registriert@example.test', '{"display_name":"Fall6"}'::jsonb),
  ('aaaaaaa7-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', now(), now(), true, null,
   '{"display_name":"Helfer"}'::jsonb);

do $$
begin
  assert (select count(*) from public.profiles
           where id in ('aaaaaaa1-0000-4000-8000-000000000001',
                        'aaaaaaa2-0000-4000-8000-000000000002',
                        'aaaaaaa3-0000-4000-8000-000000000003',
                        'aaaaaaa4-0000-4000-8000-000000000004',
                        'aaaaaaa5-0000-4000-8000-000000000005',
                        'aaaaaaa6-0000-4000-8000-000000000006',
                        'aaaaaaa7-0000-4000-8000-000000000007')) = 7,
    'handle_new_user-Trigger haette 7 profiles anlegen muessen';
  insert into t_results (check_name) values ('00 Setup: 7 Testnutzer + profiles angelegt');
end $$;

-- ---------------------------------------------------------------------
-- Fall 2: alte, laengst verlassene Mitgliedschaft in Helfers Lobby.
-- ---------------------------------------------------------------------
insert into public.lobbies (id, code, host_id, status, closed_at, created_at, last_activity_at)
values ('bbbbbbb2-0000-4000-8000-000000000002', 'LOBBYB',
        'aaaaaaa7-0000-4000-8000-000000000007', 'waiting', null,
        now() - interval '40 days', now() - interval '38 days');

insert into public.lobby_members (lobby_id, user_id, display_name, joined_at, left_at)
values ('bbbbbbb2-0000-4000-8000-000000000002', 'aaaaaaa7-0000-4000-8000-000000000007',
        'Helfer', now() - interval '40 days', null),
       ('bbbbbbb2-0000-4000-8000-000000000002', 'aaaaaaa2-0000-4000-8000-000000000002',
        'Fall2', now() - interval '39 days', now() - interval '38 days');

-- ---------------------------------------------------------------------
-- Fall 3: Fall3-Nutzer war Host, Lobby ist geschlossen, er selbst hat sie
-- (als letztes aktives Mitglied) verlassen. host_id zeigt weiterhin auf
-- ihn -- genau der reale Zustand, den leave_lobby_internal() erzeugt.
-- ---------------------------------------------------------------------
insert into public.lobbies (id, code, host_id, status, closed_at, created_at, last_activity_at)
values ('bbbbbbb3-0000-4000-8000-000000000003', 'LOBBYC',
        'aaaaaaa3-0000-4000-8000-000000000003', 'waiting',
        now() - interval '35 days', now() - interval '40 days', now() - interval '35 days');

insert into public.lobby_members (lobby_id, user_id, display_name, joined_at, left_at)
values ('bbbbbbb3-0000-4000-8000-000000000003', 'aaaaaaa3-0000-4000-8000-000000000003',
        'Fall3', now() - interval '40 days', now() - interval '35 days');

-- ---------------------------------------------------------------------
-- Fall 4: Fall4-Nutzer ist AKTIVES Mitglied (left_at NULL) einer offenen
-- Lobby, die er selbst hostet. Muss die Loeschung blockieren.
-- ---------------------------------------------------------------------
insert into public.lobbies (id, code, host_id, status, closed_at, created_at, last_activity_at)
values ('bbbbbbb4-0000-4000-8000-000000000004', 'LOBBYD',
        'aaaaaaa4-0000-4000-8000-000000000004', 'waiting', null,
        now() - interval '35 days', now());

insert into public.lobby_members (lobby_id, user_id, display_name, joined_at, left_at)
values ('bbbbbbb4-0000-4000-8000-000000000004', 'aaaaaaa4-0000-4000-8000-000000000004',
        'Fall4', now() - interval '35 days', null);

insert into t_results (check_name)
values ('01 Setup: Lobbies/Mitgliedschaften fuer Fall 2, 3, 4 angelegt');

-- ---------------------------------------------------------------------
-- Der eigentliche Test: den ECHTEN DELETE-Pfad ausfuehren.
-- Der verschachtelte begin/exception/end-Block ist defensiv: PL/pgSQL legt
-- dafuer automatisch einen impliziten Savepoint an und rollt bei einer
-- gefangenen Exception automatisch dorthin zurueck (kein explizites
-- SAVEPOINT/ROLLBACK TO noetig, das ist als eigenstaendiges Statement in
-- PL/pgSQL nicht gueltig). Sollte host_id entgegen der Schema-Definition
-- (on delete cascade) doch eine FK-Verletzung werfen, bricht das Skript
-- nicht unkontrolliert ab, sondern das wird als Ergebnis protokolliert und
-- die restlichen Faelle werden trotzdem geprueft.
-- ---------------------------------------------------------------------
do $$
declare v_deleted integer;
begin
  begin
    select public.purge_stale_anonymous_users() into v_deleted;
    insert into t_results (check_name)
    values (format('02 purge_stale_anonymous_users() lief ohne Fehler durch, meldet %s geloeschte Zeilen', v_deleted));
  exception
    when foreign_key_violation then
      insert into t_results (check_name)
      values (format('02 purge_stale_anonymous_users() SCHLUG FEHL mit FK-Verletzung: %s', sqlerrm));
  end;
end $$;

-- ---------------------------------------------------------------------
-- Fall 1: MUSS geloescht sein (harter Assert).
-- ---------------------------------------------------------------------
do $$
begin
  assert not exists (select 1 from auth.users where id = 'aaaaaaa1-0000-4000-8000-000000000001'),
    'Fall 1 (nie in Lobby, 35 Tage) haette geloescht werden muessen';
  assert not exists (select 1 from public.profiles where id = 'aaaaaaa1-0000-4000-8000-000000000001'),
    'Fall 1: profiles-Zeile haette per Cascade mitverschwinden muessen';
  insert into t_results (check_name) values ('03 Fall 1 (nie in Lobby): GELOESCHT, wie erwartet');
end $$;

-- ---------------------------------------------------------------------
-- Fall 2: MUSS geloescht sein, inkl. der verwaisten lobby_members-Zeile.
-- ---------------------------------------------------------------------
do $$
begin
  assert not exists (select 1 from auth.users where id = 'aaaaaaa2-0000-4000-8000-000000000002'),
    'Fall 2 (alte verlassene Mitgliedschaft, 35 Tage) haette geloescht werden muessen';
  assert not exists (
    select 1 from public.lobby_members
     where lobby_id = 'bbbbbbb2-0000-4000-8000-000000000002'
       and user_id  = 'aaaaaaa2-0000-4000-8000-000000000002'
  ), 'Fall 2: die verwaiste lobby_members-Zeile haette per Cascade verschwinden muessen';
  -- Gegenprobe: Helfer und dessen Lobby sind unberuehrt.
  assert exists (select 1 from auth.users where id = 'aaaaaaa7-0000-4000-8000-000000000007'),
    'Helfer haette NICHT geloescht werden duerfen';
  assert exists (select 1 from public.lobbies where id = 'bbbbbbb2-0000-4000-8000-000000000002'),
    'Helfers Lobby haette bestehen bleiben muessen (Helfer ist noch aktives Mitglied)';
  insert into t_results (check_name)
  values ('04 Fall 2 (alte verlassene Mitgliedschaft): GELOESCHT inkl. verwaister Zeile, wie erwartet; Helfer/dessen Lobby unberuehrt');
end $$;

-- ---------------------------------------------------------------------
-- Fall 3: der Kernfall. Nutzer MUSS geloescht sein (unstrittig, da
-- eligible). Was mit der Lobby (host_id) passiert, wird nur BEOBACHTET
-- und protokolliert, nicht als Erwartung geassert.
-- ---------------------------------------------------------------------
do $$
declare
  v_user_gone   boolean;
  v_lobby_gone  boolean;
  v_lobby_host  uuid;
  v_lobby_closed timestamptz;
begin
  v_user_gone := not exists (select 1 from auth.users where id = 'aaaaaaa3-0000-4000-8000-000000000003');

  assert v_user_gone,
    'Fall 3 (Host einer geschlossenen Lobby, selbst verlassen, 35 Tage) haette geloescht werden muessen';
  insert into t_results (check_name) values ('05 Fall 3: Nutzer GELOESCHT, wie erwartet (unstrittig eligible)');

  select not exists (select 1 from public.lobbies where id = 'bbbbbbb3-0000-4000-8000-000000000003')
    into v_lobby_gone;

  if v_lobby_gone then
    insert into t_results (check_name) values (
      '06 Fall 3 BEFUND: lobbies-Zeile ist EBENFALLS geloescht (stille Kaskade ueber host_id ON DELETE CASCADE) — die Lobby verschwindet mit, kein SET NULL, keine FK-Verletzung'
    );
  else
    select host_id, closed_at into v_lobby_host, v_lobby_closed
      from public.lobbies where id = 'bbbbbbb3-0000-4000-8000-000000000003';
    insert into t_results (check_name) values (
      format('06 Fall 3 BEFUND: lobbies-Zeile existiert NOCH. host_id=%s, closed_at=%s',
             coalesce(v_lobby_host::text, 'NULL'), coalesce(v_lobby_closed::text, 'NULL'))
    );
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Fall 4: DARF NICHT geloescht werden — aktives Mitglied einer offenen
-- Lobby. Kritischster Fall.
-- ---------------------------------------------------------------------
do $$
begin
  assert exists (select 1 from auth.users where id = 'aaaaaaa4-0000-4000-8000-000000000004'),
    'Fall 4 (aktives Mitglied, offene Lobby) haette NICHT geloescht werden duerfen';
  assert exists (select 1 from public.profiles where id = 'aaaaaaa4-0000-4000-8000-000000000004'),
    'Fall 4: profiles-Zeile haette bestehen bleiben muessen';
  assert (
    select left_at is null from public.lobby_members
     where lobby_id = 'bbbbbbb4-0000-4000-8000-000000000004'
       and user_id  = 'aaaaaaa4-0000-4000-8000-000000000004'
  ), 'Fall 4: die aktive Mitgliedschaft haette left_at=NULL behalten muessen';
  assert exists (select 1 from public.lobbies where id = 'bbbbbbb4-0000-4000-8000-000000000004'
                   and closed_at is null),
    'Fall 4: die Lobby haette offen bleiben muessen';
  insert into t_results (check_name)
  values ('07 Fall 4 (aktives Mitglied, offene Lobby): UNBERUEHRT, wie erwartet — kritischster Fall bestanden');
end $$;

-- ---------------------------------------------------------------------
-- Fall 5: DARF NICHT geloescht werden — zu jung (10 Tage).
-- ---------------------------------------------------------------------
do $$
begin
  assert exists (select 1 from auth.users where id = 'aaaaaaa5-0000-4000-8000-000000000005'),
    'Fall 5 (10 Tage alt) haette NICHT geloescht werden duerfen';
  insert into t_results (check_name) values ('08 Fall 5 (10 Tage alt): UNBERUEHRT, wie erwartet');
end $$;

-- ---------------------------------------------------------------------
-- Fall 6: DARF NIEMALS angefasst werden — registriert, trotz 400 Tage
-- und Inaktivitaet.
-- ---------------------------------------------------------------------
do $$
begin
  assert exists (select 1 from auth.users where id = 'aaaaaaa6-0000-4000-8000-000000000006'),
    'Fall 6 (registriert, 400 Tage, inaktiv) haette NIEMALS geloescht werden duerfen';
  insert into t_results (check_name) values ('09 Fall 6 (registriert, uralt, inaktiv): UNBERUEHRT, wie erwartet');
end $$;

-- Letztes Statement mit Zeilenergebnis: das zeigt `supabase db query`
-- tatsaechlich an. Erwartet: 10 Zeilen (00 .. 09), Fall 3 doppelt
-- (05 = Nutzer geloescht, 06 = Befund zur Lobby).
select seq, check_name from t_results order by seq;

rollback;

-- Alles ok, wenn oben alle 10 Zeilen erscheinen und keine Assertion
-- gefeuert hat. Die Datenbank ist danach unveraendert (ROLLBACK) — keine
-- manuelle Aufraeumung noetig, wie bei verify-phase0a.sql.
