-- =====================================================================
-- PartyBox — Verifikation: profiles_select_sentinel
-- (20260730214500_profiles_sentinel_visible.sql)
--
-- Kernfrage: kann ein authentifizierter Nutzer, der NIE mit dem Sentinel
-- in einer Lobby war, dessen Profil lesen? Zusaetzlich eine Gegenprobe,
-- dass die neue Policy nicht versehentlich alle Profile oeffnet.
--
-- Laeuft in EINER Transaktion mit ROLLBACK am Ende, wie die vorigen
-- Verifikationsskripte.
--
--   npx supabase db query --linked -f scripts/verify-sentinel-profile-visibility.sql
--
-- `supabase db query -f` zeigt nur das letzte Statement mit Zeilenergebnis
-- und unterdrueckt RAISE NOTICE -- deshalb wieder die t_results-Tabelle.
-- =====================================================================

begin;

create temporary table t_results (seq serial primary key, check_name text) on commit drop;

-- ---------------------------------------------------------------------
-- Zwei frische Testnutzer, keiner je in einer Lobby gewesen -- t1 ist der
-- eigentliche Testfall ("nie mit dem Sentinel in einer Lobby"), t2 dient
-- nur als Gegenprobe fuer den Scope der neuen Policy.
-- ---------------------------------------------------------------------
insert into auth.users
  (id, instance_id, aud, role, created_at, updated_at, is_anonymous, email, raw_user_meta_data)
values
  ('e0000001-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', now(), now(), true, null, '{"display_name":"T1"}'::jsonb),
  ('e0000002-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', now(), now(), true, null, '{"display_name":"T2"}'::jsonb);

do $$
begin
  assert (select count(*) from public.profiles
           where id in ('e0000001-0000-4000-8000-000000000001',
                        'e0000002-0000-4000-8000-000000000002')) = 2,
    'handle_new_user-Trigger haette 2 profiles anlegen muessen';
  insert into t_results (check_name) values ('00 Setup: 2 frische Testnutzer, keiner je in einer Lobby');
end $$;

-- ---------------------------------------------------------------------
-- Kerntest: t1 liest das Sentinel-Profil, exakt die vom Auftrag
-- vorgegebene Abfrage.
-- ---------------------------------------------------------------------
do $$
declare
  v_row public.profiles%rowtype;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"e0000001-0000-4000-8000-000000000001","role":"authenticated"}', true);
  set local role authenticated;

  select * into v_row from public.profiles where id = public.sentinel_host_profile_id();

  assert found,
    'T1 (nie mit dem Sentinel in einer Lobby) haette das Sentinel-Profil lesen koennen muessen';
  assert v_row.display_name = 'Ehemaliger Host',
    format('Sentinel-Profil: unerwarteter display_name %s', v_row.display_name);

  reset role;
  insert into t_results (check_name)
  values ('01 Kerntest: T1 liest Sentinel-Profil erfolgreich, display_name = "Ehemaliger Host"');
end $$;

-- ---------------------------------------------------------------------
-- Gegenprobe 1: T1 sieht weiterhin die eigene Zeile (unveraendertes
-- Verhalten von profiles_select_visible).
-- ---------------------------------------------------------------------
do $$
declare v_rows int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"e0000001-0000-4000-8000-000000000001","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into v_rows from public.profiles where id = 'e0000001-0000-4000-8000-000000000001';
  reset role;

  assert v_rows = 1, 'T1 haette die eigene profiles-Zeile weiterhin sehen muessen';
  insert into t_results (check_name) values ('02 Gegenprobe: T1 sieht weiterhin die eigene Zeile');
end $$;

-- ---------------------------------------------------------------------
-- Gegenprobe 2 (die eigentlich kritische): die neue Policy oeffnet NICHT
-- alle Profile. T1 und T2 waren nie in derselben Lobby -> T1 darf T2s
-- Profil NICHT sehen.
-- ---------------------------------------------------------------------
do $$
declare v_rows int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"e0000001-0000-4000-8000-000000000001","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into v_rows from public.profiles where id = 'e0000002-0000-4000-8000-000000000002';
  reset role;

  assert v_rows = 0,
    format('T1 haette T2s Profil NICHT sehen duerfen (kein gemeinsamer Lobby-Bezug), sieht aber %s Zeile(n)', v_rows);
  insert into t_results (check_name)
  values ('03 Gegenprobe: T1 sieht T2s Profil NICHT — Policy oeffnet nicht alle Profile');
end $$;

-- Letztes Statement mit Zeilenergebnis: erwartet 4 lueckenlose Zeilen 00..03.
select seq, check_name from t_results order by seq;

rollback;

-- Alles ok, wenn oben alle 4 Zeilen erscheinen und keine Assertion
-- gefeuert hat. Die Datenbank ist danach unveraendert (ROLLBACK) — keine
-- manuelle Aufraeumung noetig.
