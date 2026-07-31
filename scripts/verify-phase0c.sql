-- =====================================================================
-- PartyBox — Verifikation Phase 0c
--   Benutzername mit Code, Freundschaften, Online-Status, Einladungen
--
-- Laeuft in EINER Transaktion mit ROLLBACK am Ende -- es bleiben keine
-- Testdaten zurueck. Ausgabe ueber t_results, weil `supabase db query -f`
-- nur das letzte zeilenliefernde Statement zeigt und RAISE NOTICE
-- unterdrueckt. Ein gruener Exit-Code allein belegt gar nichts.
--
--   npx supabase db query --linked -f scripts/verify-phase0c.sql
-- =====================================================================

begin;

create temporary table t_results (seq serial primary key, check_name text, detail text)
  on commit drop;
create temporary table t_ctx (k text primary key, v text) on commit drop;

-- Vier Testnutzer. A und B werden Freunde, C ist der unbeteiligte Dritte,
-- D bleibt Fremder (fuer NOT_FRIENDS).
insert into auth.users
  (id, instance_id, aud, role, created_at, updated_at, is_anonymous, raw_user_meta_data)
values
  ('0c000001-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', now(), now(), false, '{"display_name":"Anna"}'::jsonb),
  ('0c000002-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', now(), now(), false, '{"display_name":"Ben"}'::jsonb),
  ('0c000003-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', now(), now(), false, '{"display_name":"Clara"}'::jsonb),
  ('0c000004-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', now(), now(), false, '{"display_name":"Dieter"}'::jsonb);

-- ---------------------------------------------------------------------
-- 01  Gleicher Benutzername, verschiedener Code -> erlaubt.
--     Das ist der ganze Zweck des Codes: der Name allein darf sich
--     wiederholen.
-- ---------------------------------------------------------------------
do $$
begin
  update public.profiles set username = 'Kaan', discriminator = '1234'
   where id = '0c000001-0000-4000-8000-000000000001';
  update public.profiles set username = 'kaan', discriminator = '5678'
   where id = '0c000002-0000-4000-8000-000000000002';

  assert (select count(*) from public.profiles
           where lower(username) = 'kaan') = 2,
    '01: zwei gleichnamige Profile erwartet';
  insert into t_results (check_name, detail)
  values ('01 gleicher Name, anderer Code', 'Kaan#1234 und kaan#5678 nebeneinander -> OK');
end $$;

-- ---------------------------------------------------------------------
-- 02  Gleicher Name UND gleicher Code -> unique_violation.
--     Gross-/Kleinschreibung darf dabei nicht helfen (lower-Index).
-- ---------------------------------------------------------------------
do $$
declare v_state text := 'kein Fehler';
begin
  begin
    update public.profiles set username = 'KAAN', discriminator = '1234'
     where id = '0c000003-0000-4000-8000-000000000003';
  exception when unique_violation then
    v_state := 'unique_violation';
  end;
  assert v_state = 'unique_violation', '02: unique_violation erwartet, war: ' || v_state;
  insert into t_results (check_name, detail)
  values ('02 gleicher Name UND Code', 'KAAN#1234 abgelehnt (' || v_state || ')');
end $$;

-- ---------------------------------------------------------------------
-- 03  Benutzername ohne Code (und umgekehrt) -> check_violation.
--     Ohne diese Kopplung wuerde der Teilindex solche Zeilen nicht
--     gegeneinander pruefen und der Name waere doppelt vergebbar.
-- ---------------------------------------------------------------------
do $$
declare v_state text := 'kein Fehler';
begin
  begin
    update public.profiles set username = 'Halb', discriminator = null
     where id = '0c000003-0000-4000-8000-000000000003';
  exception when check_violation then
    v_state := 'check_violation';
  end;
  assert v_state = 'check_violation', '03: check_violation erwartet, war: ' || v_state;
  insert into t_results (check_name, detail)
  values ('03 Name ohne Code', 'abgelehnt (' || v_state || ')');
end $$;

-- ---------------------------------------------------------------------
-- 04  set_username: 21 Zeichen -> USERNAME_INVALID, 20 Zeichen -> OK.
--     Die Grenze muss genau bei 20 liegen, nicht "ungefaehr".
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"0c000003-0000-4000-8000-000000000003","role":"authenticated"}', true);

do $$
declare
  v_state text := 'kein Fehler';
  v_res   jsonb;
begin
  begin
    perform public.set_username(repeat('a', 21));
  exception when others then
    v_state := sqlerrm;
  end;
  assert v_state = 'USERNAME_INVALID', '04: USERNAME_INVALID erwartet, war: ' || v_state;

  v_res := public.set_username(repeat('a', 20));
  assert v_res ->> 'discriminator' ~ '^[0-9]{4}$',
    '04: vierstelliger Code erwartet, war: ' || coalesce(v_res ->> 'discriminator', 'null');

  insert into t_results (check_name, detail)
  values ('04 set_username Laengengrenze',
          '21 Zeichen -> ' || v_state || ' | 20 Zeichen -> Code ' || (v_res ->> 'discriminator'));
end $$;

-- ---------------------------------------------------------------------
-- 05  find_profile_by_handle: richtiger Name, falscher Code -> 0 Zeilen.
--     Beweis, dass man nicht ueber den Namen allein jemanden findet.
-- ---------------------------------------------------------------------
do $$
declare v_hit int; v_miss int;
begin
  select count(*) into v_hit  from public.find_profile_by_handle('kaan', '1234');
  select count(*) into v_miss from public.find_profile_by_handle('Kaan', '9999');

  assert v_hit  = 1, '05: exakter Treffer erwartet, war: ' || v_hit;
  assert v_miss = 0, '05: 0 Zeilen bei falschem Code erwartet, war: ' || v_miss;
  insert into t_results (check_name, detail)
  values ('05 Suche verlangt Name UND Code',
          'kaan#1234 -> 1 Treffer | Kaan#9999 -> 0 Treffer');
end $$;

-- ---------------------------------------------------------------------
-- 06  Anfrage A->B, danach B->A: EINE Zeile, status accepted.
--     Der Primaerschluessel auf dem geordneten Paar macht die
--     Gegenanfrage strukturell zur Annahme statt zum Duplikat.
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"0c000001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public.send_friend_request('kaan', '5678');   -- A -> B

do $$
declare v_status text;
begin
  select f.status::text into v_status from public.friendships f;
  assert v_status = 'pending', '06a: pending erwartet, war: ' || coalesce(v_status, 'keine Zeile');
  insert into t_results (check_name, detail)
  values ('06a Anfrage A->B', 'eine Zeile, status = ' || v_status);
end $$;

select set_config('request.jwt.claims',
  '{"sub":"0c000002-0000-4000-8000-000000000002","role":"authenticated"}', true);
select public.send_friend_request('Kaan', '1234');   -- B -> A, also die Annahme

do $$
declare v_count int; v_status text;
begin
  select count(*) into v_count from public.friendships;
  select f.status::text into v_status from public.friendships f;
  assert v_count = 1, '06b: genau eine Zeile erwartet, war: ' || v_count;
  assert v_status = 'accepted', '06b: accepted erwartet, war: ' || v_status;
  insert into t_results (check_name, detail)
  values ('06b Gegenanfrage B->A wird zur Annahme',
          v_count || ' Zeile, status = ' || v_status);
end $$;

-- ---------------------------------------------------------------------
-- 07  Ein Dritter darf eine fremde Anfrage nicht beantworten, und der
--     Absender nicht seine eigene.
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"0c000001-0000-4000-8000-000000000001","role":"authenticated"}', true);

do $$
declare
  v_self  text := 'kein Fehler';
  v_third text := 'kein Fehler';
begin
  -- Offene Anfrage A -> D als Ausgangslage. Direkt eingefuegt (laeuft als
  -- postgres, nicht als authenticated), weil D bewusst keinen
  -- Benutzernamen hat -- send_friend_request braucht aber einen Handle.
  insert into public.friendships (user_low, user_high, requested_by)
  values (least('0c000001-0000-4000-8000-000000000001'::uuid,
                '0c000004-0000-4000-8000-000000000004'::uuid),
          greatest('0c000001-0000-4000-8000-000000000001'::uuid,
                   '0c000004-0000-4000-8000-000000000004'::uuid),
          '0c000001-0000-4000-8000-000000000001')
  on conflict do nothing;

  -- A ist der Absender und darf nicht selbst annehmen.
  begin
    perform public.respond_friend_request('0c000004-0000-4000-8000-000000000004', true);
  exception when others then
    v_self := sqlerrm;
  end;
  assert v_self = 'NOT_THE_RECIPIENT',
    '07a: NOT_THE_RECIPIENT erwartet, war: ' || v_self;

  -- C ist unbeteiligt: fuer ihn existiert das Paar gar nicht.
  perform set_config('request.jwt.claims',
    '{"sub":"0c000003-0000-4000-8000-000000000003","role":"authenticated"}', true);
  begin
    perform public.respond_friend_request('0c000004-0000-4000-8000-000000000004', true);
  exception when others then
    v_third := sqlerrm;
  end;
  assert v_third = 'REQUEST_NOT_FOUND',
    '07b: REQUEST_NOT_FOUND erwartet, war: ' || v_third;

  insert into t_results (check_name, detail)
  values ('07 nur der Empfaenger darf antworten',
          'Absender -> ' || v_self || ' | Dritter -> ' || v_third);
end $$;

-- ---------------------------------------------------------------------
-- 08  Lobby anlegen, Einladung an einen Nicht-Freund -> NOT_FRIENDS,
--     an einen Freund -> Einladung mit Code beim Empfaenger.
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"0c000001-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into t_ctx select 'lobby', (public.create_lobby('Anna') ->> 'lobby_id');
insert into t_ctx select 'code', l.code from public.lobbies l
 where l.id = (select v::uuid from t_ctx where k = 'lobby');

do $$
declare
  v_lobby  uuid := (select v::uuid from t_ctx where k = 'lobby');
  v_state  text := 'kein Fehler';
begin
  begin
    perform public.invite_friend_to_lobby(v_lobby, '0c000003-0000-4000-8000-000000000003');
  exception when others then
    v_state := sqlerrm;
  end;
  assert v_state = 'NOT_FRIENDS', '08a: NOT_FRIENDS erwartet, war: ' || v_state;
  insert into t_results (check_name, detail)
  values ('08a Einladung an Nicht-Freund', 'abgelehnt (' || v_state || ')');
end $$;

do $$
declare
  v_lobby uuid := (select v::uuid from t_ctx where k = 'lobby');
  v_code  text := (select v from t_ctx where k = 'code');
  v_seen  text;
  v_dup   text := 'kein Fehler';
begin
  perform public.invite_friend_to_lobby(v_lobby, '0c000002-0000-4000-8000-000000000002');

  -- Zweimal einladen darf nicht gehen.
  begin
    perform public.invite_friend_to_lobby(v_lobby, '0c000002-0000-4000-8000-000000000002');
  exception when others then
    v_dup := sqlerrm;
  end;
  assert v_dup = 'ALREADY_INVITED', '08b: ALREADY_INVITED erwartet, war: ' || v_dup;

  -- Der Empfaenger sieht die Einladung inklusive Code.
  perform set_config('request.jwt.claims',
    '{"sub":"0c000002-0000-4000-8000-000000000002","role":"authenticated"}', true);
  select i.lobby_code into v_seen from public.list_my_invites() i;
  assert v_seen = v_code,
    '08b: Code ' || v_code || ' erwartet, war: ' || coalesce(v_seen, 'null');

  insert into t_results (check_name, detail)
  values ('08b Einladung an Freund',
          'Empfaenger sieht Code ' || v_seen || ' | zweite Einladung -> ' || v_dup);
end $$;

-- ---------------------------------------------------------------------
-- 09  Beitritt loescht die Einladung.
--     Ohne das bliebe die Einladung stehen und die Toast-Anzeige haengen.
-- ---------------------------------------------------------------------
do $$
declare
  v_code  text := (select v from t_ctx where k = 'code');
  v_open  int;
begin
  perform public.join_lobby(v_code, 'Ben');
  select count(*) into v_open from public.list_my_invites();
  assert v_open = 0, '09: 0 offene Einladungen erwartet, war: ' || v_open;
  insert into t_results (check_name, detail)
  values ('09 Beitritt raeumt die Einladung ab', v_open || ' offene Einladungen');
end $$;

-- ---------------------------------------------------------------------
-- 10  touch_presence darf profiles.updated_at NICHT anfassen.
--     Sonst wechselt der Cache-Buster der Avatar-URL alle 45 Sekunden und
--     jedes Profilbild wird bei allen Mitspielern neu geladen.
-- ---------------------------------------------------------------------
do $$
declare
  v_before timestamptz;
  v_after  timestamptz;
  v_lobby  uuid := (select v::uuid from t_ctx where k = 'lobby');
  v_seen   timestamptz;
begin
  select p.updated_at into v_before from public.profiles p
   where p.id = '0c000002-0000-4000-8000-000000000002';

  perform public.touch_presence(v_lobby);

  select p.updated_at into v_after from public.profiles p
   where p.id = '0c000002-0000-4000-8000-000000000002';
  select s.last_seen_at into v_seen from public.user_status s
   where s.user_id = '0c000002-0000-4000-8000-000000000002';

  assert v_before = v_after,
    '10: updated_at unveraendert erwartet, war ' || v_before || ' -> ' || v_after;
  assert v_seen is not null, '10: user_status-Zeile erwartet';

  insert into t_results (check_name, detail)
  values ('10 touch_presence laesst updated_at in Ruhe',
          'updated_at unveraendert, last_seen_at gesetzt');
end $$;

-- ---------------------------------------------------------------------
-- 11  touch_presence uebernimmt eine fremde Lobby nicht ungeprueft.
-- ---------------------------------------------------------------------
do $$
declare
  v_lobby uuid := (select v::uuid from t_ctx where k = 'lobby');
  v_val   uuid;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"0c000003-0000-4000-8000-000000000003","role":"authenticated"}', true);
  perform public.touch_presence(v_lobby);        -- C ist kein Mitglied

  select s.current_lobby_id into v_val from public.user_status s
   where s.user_id = '0c000003-0000-4000-8000-000000000003';
  assert v_val is null,
    '11: null erwartet, war: ' || coalesce(v_val::text, 'null');
  insert into t_results (check_name, detail)
  values ('11 fremde Lobby wird nicht uebernommen', 'current_lobby_id bleibt null');
end $$;

-- ---------------------------------------------------------------------
-- 12  list_friends() gibt nirgends einen Lobby-Code heraus, meldet den
--     Freund aber als "in einer Lobby".
-- ---------------------------------------------------------------------
do $$
declare
  v_code  text := (select v from t_ctx where k = 'code');
  v_dump  text;
  v_in    boolean;
  v_on    boolean;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"0c000001-0000-4000-8000-000000000001","role":"authenticated"}', true);

  select string_agg(f::text, ' | ') into v_dump from public.list_friends() f;
  select f.in_lobby, f.online into v_in, v_on from public.list_friends() f
   where f.id = '0c000002-0000-4000-8000-000000000002';

  assert position(v_code in coalesce(v_dump, '')) = 0,
    '12: Lobby-Code ' || v_code || ' taucht in list_friends() auf: ' || v_dump;
  assert v_on  is true, '12: Ben sollte online sein';
  assert v_in  is true, '12: Ben sollte als "in Lobby" gelten';

  insert into t_results (check_name, detail)
  values ('12 list_friends ohne Lobby-Code',
          'Code nicht enthalten, online=' || v_on || ', in_lobby=' || v_in);
end $$;

-- ---------------------------------------------------------------------
-- 13  Offene Anfragen verraten den Online-Status NICHT.
--     Sonst koennte man jemanden allein durch eine unbeantwortete
--     Anfrage dauerhaft beobachten.
-- ---------------------------------------------------------------------
do $$
declare v_seen timestamptz; v_on boolean; v_dir text;
begin
  perform public.touch_presence(null);   -- laeuft als A; D bleibt ohne Status

  perform set_config('request.jwt.claims',
    '{"sub":"0c000004-0000-4000-8000-000000000004","role":"authenticated"}', true);
  perform public.touch_presence(null);   -- D ist jetzt nachweislich online

  perform set_config('request.jwt.claims',
    '{"sub":"0c000001-0000-4000-8000-000000000001","role":"authenticated"}', true);
  select f.last_seen_at, f.online, f.direction into v_seen, v_on, v_dir
    from public.list_friends() f
   where f.id = '0c000004-0000-4000-8000-000000000004';

  assert v_dir = 'outgoing', '13: outgoing erwartet, war: ' || coalesce(v_dir, 'null');
  assert v_seen is null, '13: last_seen_at soll bei offener Anfrage verborgen sein';
  assert v_on is false,  '13: online soll bei offener Anfrage false sein';

  insert into t_results (check_name, detail)
  values ('13 offene Anfrage verraet keinen Status',
          'direction=' || v_dir || ', last_seen_at=null, online=false');
end $$;

-- ---------------------------------------------------------------------
-- 14  Anzeigename: 21 Zeichen -> DISPLAY_NAME_TOO_LONG (nicht mehr 24).
-- ---------------------------------------------------------------------
do $$
declare v_20 text := 'kein Fehler'; v_21 text := 'kein Fehler';
begin
  perform set_config('request.jwt.claims',
    '{"sub":"0c000003-0000-4000-8000-000000000003","role":"authenticated"}', true);
  begin
    perform public.create_lobby(repeat('n', 21));
  exception when others then v_21 := sqlerrm;
  end;
  assert v_21 = 'DISPLAY_NAME_TOO_LONG',
    '14: DISPLAY_NAME_TOO_LONG erwartet, war: ' || v_21;

  begin
    perform public.create_lobby(repeat('n', 20));
  exception when others then v_20 := sqlerrm;
  end;
  assert v_20 = 'kein Fehler', '14: 20 Zeichen sollten durchgehen, war: ' || v_20;

  insert into t_results (check_name, detail)
  values ('14 Anzeigename max. 20', '21 -> ' || v_21 || ' | 20 -> angenommen');
end $$;

-- ---------------------------------------------------------------------
-- 15  Direktes Schreiben als authenticated ist abgeriegelt -- fuer alle
--     drei neuen Tabellen. RLS allein reicht dafuer nicht, es braucht das
--     REVOKE der Supabase-Default-Privileges.
-- ---------------------------------------------------------------------
do $$
declare
  v_fr  text := 'kein Fehler';
  v_st  text := 'kein Fehler';
  v_in  text := 'kein Fehler';
  v_sel text := 'kein Fehler';
begin
  perform set_config('request.jwt.claims',
    '{"sub":"0c000003-0000-4000-8000-000000000003","role":"authenticated"}', true);
  set local role authenticated;

  begin
    insert into public.friendships (user_low, user_high, requested_by)
    values ('0c000003-0000-4000-8000-000000000003',
            '0c000004-0000-4000-8000-000000000004',
            '0c000003-0000-4000-8000-000000000003');
  exception when others then v_fr := sqlstate;
  end;

  begin
    insert into public.user_status (user_id) values ('0c000003-0000-4000-8000-000000000003');
  exception when others then v_st := sqlstate;
  end;

  -- user_status hat auch kein SELECT-Recht: der Status ist nur ueber
  -- list_friends() sichtbar, also nur fuer bestaetigte Freunde.
  begin
    perform 1 from public.user_status;
  exception when others then v_sel := sqlstate;
  end;

  begin
    insert into public.lobby_invites (lobby_id, from_user, to_user)
    values ((select v::uuid from t_ctx where k = 'lobby'),
            '0c000003-0000-4000-8000-000000000003',
            '0c000004-0000-4000-8000-000000000004');
  exception when others then v_in := sqlstate;
  end;

  reset role;

  assert v_fr  = '42501', '15: friendships-INSERT sollte 42501 sein, war: ' || v_fr;
  assert v_st  = '42501', '15: user_status-INSERT sollte 42501 sein, war: ' || v_st;
  assert v_sel = '42501', '15: user_status-SELECT sollte 42501 sein, war: ' || v_sel;
  assert v_in  = '42501', '15: lobby_invites-INSERT sollte 42501 sein, war: ' || v_in;

  insert into t_results (check_name, detail)
  values ('15 kein Direktschreiben als authenticated',
          'friendships/user_status/lobby_invites -> 42501, user_status-SELECT -> 42501');
end $$;

-- ---------------------------------------------------------------------
-- 16  Fremde Freundschaftszeilen sind nicht lesbar (RLS-Policy).
-- ---------------------------------------------------------------------
do $$
declare v_rows int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"0c000003-0000-4000-8000-000000000003","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into v_rows from public.friendships;
  reset role;

  assert v_rows = 0, '16: 0 sichtbare Zeilen fuer Clara erwartet, war: ' || v_rows;
  insert into t_results (check_name, detail)
  values ('16 fremde Freundschaften unsichtbar', v_rows || ' Zeilen fuer Unbeteiligte');
end $$;

-- ---------------------------------------------------------------------
-- Ergebnis (letztes zeilenlieferndes Statement -- nur das zeigt die CLI)
-- ---------------------------------------------------------------------
select seq, check_name, detail from t_results order by seq;

rollback;
