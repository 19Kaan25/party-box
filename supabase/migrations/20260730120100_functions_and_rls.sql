-- =====================================================================
-- PartyBox — Phase 0a, Migration 2/3: Funktionen, RPCs, RLS
-- Referenz: docs/supabase-migration-plan.md §5
--
-- Leitprinzip: Lesen ueber RLS, Schreiben ausschliesslich ueber
-- SECURITY DEFINER-RPCs. Einzige Ausnahme: round_submissions.
--
-- Fehlerkonvention: die Message ist ein stabiles UPPER_SNAKE-Token, auf das
-- der Client matchen kann. errcode P0002 = "nicht gefunden",
-- P0001 (Default) = Regelverstoss.
--
-- Alle Funktionen laufen mit search_path = '' und voll qualifizierten Namen
-- (Schutz gegen search_path-Hijacking bei SECURITY DEFINER).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Profilanlage per Trigger auf auth.users — nicht durch den Client.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), 'Spieler'), 24)
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- RLS-Hilfspraedikate.
-- SECURITY DEFINER ist hier nicht optional: eine Policy auf lobby_members,
-- die selbst lobby_members abfragt, wuerde sonst rekursiv in die eigene RLS
-- laufen.
-- ---------------------------------------------------------------------
create or replace function public.is_lobby_member(p_lobby uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.lobby_members m
     where m.lobby_id = p_lobby
       and m.user_id = auth.uid()
       and m.left_at is null
  );
$$;

create or replace function public.is_game_member(p_game uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_lobby_member((select g.lobby_id from public.games g where g.id = p_game));
$$;

create or replace function public.shares_lobby_with(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.lobby_members me
      join public.lobby_members other using (lobby_id)
     where me.user_id = auth.uid()
       and me.left_at is null
       and other.user_id = p_user
       and other.left_at is null
  );
$$;

-- Schranke fuer die einzige Client-Schreib-Policy (Plan Risiko 5).
create or replace function public.submission_window_open(p_game uuid, p_round int)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.games g
     where g.id = p_game
       and g.round_no = p_round
       and g.ended_at is null
       and (g.phase_deadline is null or now() <= g.phase_deadline + interval '2 seconds')
  );
$$;

-- ---------------------------------------------------------------------
-- Lobby-Code: 6 Zeichen, Alphabet ohne I/O/0/1 (32 Zeichen -> 32^6 ~ 1,07 Mrd.)
-- ---------------------------------------------------------------------
create or replace function public.gen_lobby_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(
           substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1),
           ''
         )
    from generate_series(1, 6);
$$;

-- ---------------------------------------------------------------------
-- Kern der Austrittslogik. Wird von leave_current_lobby_internal,
-- leave_lobby und (ohne Host-Migration) kick_member genutzt.
--
-- Ein expliziter Austritt ist ein sicheres Signal — anders als ein stiller
-- Disconnect ueber Presence, wo der Server nie sicher weiss, ob die Person
-- wirklich weg ist. Deshalb hier AUTOMATISCHE Host-Uebernahme; das
-- hostless+claim_host-Verfahren bleibt ausschliesslich dem stillen
-- Disconnect vorbehalten.
-- ---------------------------------------------------------------------
create or replace function public.leave_lobby_internal(p_lobby uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host_id    uuid;
  v_next_host  uuid;
begin
  -- Zeile sperren: serialisiert gleichzeitige Austritte und Host-Uebergaben.
  select l.host_id into v_host_id
    from public.lobbies l
   where l.id = p_lobby
   for update;

  if not found then
    return;                                  -- Lobby existiert nicht (mehr)
  end if;

  update public.lobby_members
     set left_at = now()
   where lobby_id = p_lobby
     and user_id  = p_user
     and left_at is null;

  if not found then
    return;                                  -- war gar nicht (mehr) aktiv
  end if;

  if v_host_id = p_user then
    -- Naechster Host: verbleibendes aktives Mitglied mit dem fruehesten
    -- joined_at. user_id als deterministischer Tiebreak.
    select m.user_id into v_next_host
      from public.lobby_members m
     where m.lobby_id = p_lobby
       and m.left_at is null
     order by m.joined_at asc, m.user_id asc
     limit 1;

    if v_next_host is not null then
      update public.lobbies
         set host_id          = v_next_host,
             host_claimed_at  = now(),
             last_activity_at = now()
       where id = p_lobby;
    else
      -- Host war der letzte Spieler: Lobby sofort schliessen.
      update public.lobbies
         set closed_at        = now(),
             last_activity_at = now()
       where id = p_lobby;
    end if;
  else
    update public.lobbies set last_activity_at = now() where id = p_lobby;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5a) leave_current_lobby_internal()
-- Verlaesst die aktuell aktive Lobby des Aufrufers, falls vorhanden.
-- p_except_lobby erlaubt join_lobby/create_lobby, die Ziel-Lobby
-- auszunehmen (Rejoin in dieselbe Lobby soll kein Austritt sein).
-- ---------------------------------------------------------------------
create or replace function public.leave_current_lobby_internal(p_except_lobby uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_lobby_id uuid;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select m.lobby_id into v_lobby_id
    from public.lobby_members m
   where m.user_id = v_uid
     and m.left_at is null
     and (p_except_lobby is null or m.lobby_id <> p_except_lobby)
   limit 1;

  if v_lobby_id is null then
    return;
  end if;

  perform public.leave_lobby_internal(v_lobby_id, v_uid);
end $$;

-- ---------------------------------------------------------------------
-- 5b) create_lobby(p_display_name)
-- ---------------------------------------------------------------------
create or replace function public.create_lobby(p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_name     text := btrim(coalesce(p_display_name, ''));
  v_code     text;
  v_id       uuid;
  v_attempts int  := 0;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if v_name = '' then
    raise exception 'DISPLAY_NAME_REQUIRED';
  end if;
  if char_length(v_name) > 24 then
    raise exception 'DISPLAY_NAME_TOO_LONG';
  end if;

  perform public.leave_current_lobby_internal(null);

  -- Kollisionen sind bei 32^6 selten, werden aber sauber wiederholt statt
  -- wie in Firestore eine fremde Lobby zu ueberschreiben.
  loop
    v_attempts := v_attempts + 1;
    v_code := public.gen_lobby_code();
    begin
      insert into public.lobbies (code, host_id)
      values (v_code, v_uid)
      returning id into v_id;
      exit;
    exception
      when unique_violation then
        if v_attempts >= 10 then
          raise exception 'CODE_GENERATION_FAILED';
        end if;
    end;
  end loop;

  insert into public.lobby_members (lobby_id, user_id, display_name)
  values (v_id, v_uid, v_name);

  return jsonb_build_object('lobby_id', v_id, 'code', v_code);
end $$;

-- ---------------------------------------------------------------------
-- join_lobby(p_code, p_display_name)   (Plan §5.4)
-- Nachschlagen, Pruefen und Einfuegen atomar — weil lobbies KEIN
-- oeffentliches SELECT hat, ist "Code raten und lesen" nicht moeglich.
--
-- Bekannte Einschraenkung: die Funktion sperrt erst die Ziel-Lobby und dann
-- (via leave_current_lobby_internal) die alte Lobby. Wechseln zwei Nutzer
-- exakt gleichzeitig in entgegengesetzter Richtung zwischen denselben zwei
-- Lobbys, ist ein Deadlock moeglich; Postgres bricht dann eine der beiden
-- Transaktionen ab (40P01) und der Client kann es erneut versuchen.
-- Bewusst nicht wegoptimiert — der Fall ist im Party-Kontext praktisch
-- ausgeschlossen und die Alternative (globale Sperrreihenfolge) waere
-- deutlich komplexer.
-- ---------------------------------------------------------------------
create or replace function public.join_lobby(p_code text, p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_name  text := btrim(coalesce(p_display_name, ''));
  v_lobby public.lobbies%rowtype;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if v_name = '' then
    raise exception 'DISPLAY_NAME_REQUIRED';
  end if;
  if char_length(v_name) > 24 then
    raise exception 'DISPLAY_NAME_TOO_LONG';
  end if;

  select * into v_lobby
    from public.lobbies l
   where l.code = upper(btrim(coalesce(p_code, '')))
     and l.closed_at is null
   for update;                               -- serialisiert konkurrierende Beitritte

  if not found then
    raise exception 'LOBBY_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_lobby.status <> 'waiting'
     and not exists (select 1 from public.lobby_members m
                      where m.lobby_id = v_lobby.id and m.user_id = v_uid) then
    raise exception 'GAME_IN_PROGRESS';      -- Rejoin bleibt erlaubt
  end if;

  perform public.leave_current_lobby_internal(v_lobby.id);

  -- Namenskollision schlaegt hier ueber lobby_members_name_unique fehl (23505)
  -- statt ueber den heutigen racy Vorab-Check.
  insert into public.lobby_members (lobby_id, user_id, display_name)
  values (v_lobby.id, v_uid, v_name)
  on conflict (lobby_id, user_id)
    do update set left_at = null, display_name = excluded.display_name;

  update public.lobbies set last_activity_at = now() where id = v_lobby.id;

  return jsonb_build_object('lobby_id', v_lobby.id, 'code', v_lobby.code);
end $$;

-- ---------------------------------------------------------------------
-- 5c) leave_lobby(p_lobby)
-- ---------------------------------------------------------------------
create or replace function public.leave_lobby(p_lobby uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if not exists (
    select 1 from public.lobby_members m
     where m.lobby_id = p_lobby and m.user_id = v_uid and m.left_at is null
  ) then
    raise exception 'NOT_A_MEMBER';
  end if;

  perform public.leave_lobby_internal(p_lobby, v_uid);
end $$;

-- ---------------------------------------------------------------------
-- 5d) kick_member(p_lobby, p_target_user)
-- Ruehrt den Host-Status des Aufrufers nicht an. Selbst-Kick ist verboten,
-- damit der Host-Wechsel ausschliesslich ueber leave_lobby/promote_host laeuft.
-- ---------------------------------------------------------------------
create or replace function public.kick_member(p_lobby uuid, p_target_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if v_uid = p_target_user then
    raise exception 'CANNOT_KICK_SELF';
  end if;

  if not exists (
    select 1 from public.lobbies l
     where l.id = p_lobby and l.host_id = v_uid and l.closed_at is null
  ) then
    raise exception 'NOT_HOST';
  end if;

  update public.lobby_members
     set left_at = now()
   where lobby_id = p_lobby
     and user_id  = p_target_user
     and left_at is null;

  if not found then
    raise exception 'TARGET_NOT_ACTIVE_MEMBER' using errcode = 'P0002';
  end if;

  update public.lobbies set last_activity_at = now() where id = p_lobby;
end $$;

-- ---------------------------------------------------------------------
-- 5e) promote_host(p_lobby, p_target_user)
-- Nutzt denselben host_claimed_at-Mechanismus wie claim_host.
-- ---------------------------------------------------------------------
create or replace function public.promote_host(p_lobby uuid, p_target_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if not exists (
    select 1 from public.lobbies l
     where l.id = p_lobby and l.host_id = v_uid and l.closed_at is null
  ) then
    raise exception 'NOT_HOST';
  end if;

  if not exists (
    select 1 from public.lobby_members m
     where m.lobby_id = p_lobby and m.user_id = p_target_user and m.left_at is null
  ) then
    raise exception 'TARGET_NOT_ACTIVE_MEMBER' using errcode = 'P0002';
  end if;

  update public.lobbies
     set host_id          = p_target_user,
         host_claimed_at  = now(),
         last_activity_at = now()
   where id = p_lobby;
end $$;

-- ---------------------------------------------------------------------
-- claim_host(p_lobby)   (Plan §5.5)
-- Ausschliesslich fuer den stillen Disconnect: Presence meldet den Host als
-- offline, der Client fragt per Dialog nach. Postgres kann Presence nicht
-- sehen, deshalb entscheidet der Mensch — die DB verhindert nur Missbrauch.
-- ---------------------------------------------------------------------
create or replace function public.claim_host(p_lobby uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if not public.is_lobby_member(p_lobby) then
    raise exception 'NOT_A_MEMBER';
  end if;

  update public.lobbies
     set host_id          = v_uid,
         host_claimed_at  = now(),
         last_activity_at = now()
   where id = p_lobby
     and closed_at is null
     and host_id <> v_uid
     and now() - host_claimed_at > interval '30 seconds';   -- Anti-Grief-Cooldown

  if not found then
    raise exception 'CLAIM_TOO_SOON_OR_ALREADY_HOST';
  end if;
end $$;

-- =====================================================================
-- Grants
-- Supabase gewaehrt neuen Tabellen in public per Default-Privileges ALL an
-- anon und authenticated. Ohne die folgenden REVOKEs waeren alle Tabellen
-- direkt beschreibbar — RLS allein reicht dafuer nicht.
-- =====================================================================
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on public.profiles          to authenticated;
grant select on public.lobbies           to authenticated;
grant select on public.lobby_members     to authenticated;
grant select on public.games             to authenticated;
grant select on public.player_secrets    to authenticated;
grant select on public.game_events       to authenticated;

-- Spalten-Grants ergaenzen RLS: RLS entscheidet ueber Zeilen, Grants ueber
-- Spalten. Damit ist username/avatar-fremdes nicht selbst setzbar.
grant update (display_name, avatar_path) on public.profiles to authenticated;

-- Einzige Tabelle mit Client-Schreibrecht (Plan Entscheidung 6). Kein DELETE.
grant select, insert, update on public.round_submissions to authenticated;

-- heartbeat: bewusst KEIN Grant. Nur service_role (umgeht RLS) kommt heran.

-- =====================================================================
-- Policies
-- =====================================================================

-- profiles: eigene Zeile immer, fremde nur bei gemeinsamer aktiver Lobby.
-- Verhindert den Abzug der gesamten Nutzertabelle.
create policy profiles_select_visible on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.shares_lobby_with(id));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using      (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- lobbies: kein oeffentliches Lesen. Verhindert das Enumerieren fremder
-- Codes; Beitritt laeuft ausschliesslich ueber join_lobby().
create policy lobbies_select_member on public.lobbies
  for select to authenticated
  using (public.is_lobby_member(id));

-- lobby_members: nur Mitglieder derselben Lobby.
-- Kein Schreibrecht -> kein Selbst-Beitritt, kein Kick durch Nicht-Hosts,
-- kein Setzen des eigenen score.
create policy lobby_members_select_member on public.lobby_members
  for select to authenticated
  using (public.is_lobby_member(lobby_id));

-- games: nur Mitglieder der Lobby.
-- Kein Schreibrecht -> keine Phasenspruenge, keine Manipulation von
-- phase_deadline (Zeitbetrug bei Stadt Land Fluss).
create policy games_select_member on public.games
  for select to authenticated
  using (public.is_game_member(id));

-- player_secrets: der eigentliche Punkt der ganzen Migration.
-- Nur die eigene Zeile, niemals Schreibrecht. Auch der Host liest hier
-- nichts Fremdes — sein Client ist ein Client wie jeder andere.
create policy player_secrets_select_own on public.player_secrets
  for select to authenticated
  using (user_id = (select auth.uid()));

-- round_submissions: eigene Zeile lesen; schreiben nur solange das
-- Zeitfenster offen ist. Verhindert Abschreiben fremder SLF-Antworten und
-- Nachreichen nach Ablauf der Deadline.
create policy round_submissions_rw_own on public.round_submissions
  for all to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid())
              and public.submission_window_open(game_id, round_no));

-- game_events: oeffentlich innerhalb der Lobby (Live-Vote-Punkte).
-- Kein Schreibrecht -> kein Abstimmen im Namen anderer.
create policy game_events_select_member on public.game_events
  for select to authenticated
  using (public.is_game_member(game_id));

-- heartbeat: bewusst KEINE Policy. RLS ist aktiv, damit ist die Tabelle
-- fuer anon und authenticated vollstaendig dicht.

-- =====================================================================
-- Function-Grants
-- =====================================================================
revoke all on function public.leave_lobby_internal(uuid, uuid)      from public, anon, authenticated;
revoke all on function public.leave_current_lobby_internal(uuid)    from public, anon, authenticated;
revoke all on function public.gen_lobby_code()                      from public, anon, authenticated;

-- handle_new_user und tg_set_updated_at werden BEWUSST nicht eingeschraenkt:
-- Trigger-Funktionen koennen zur Laufzeit auf EXECUTE geprueft werden. Ein
-- REVOKE wuerde im schlimmsten Fall die Registrierung (auth.users-INSERT
-- durch supabase_auth_admin) bzw. jedes Profil-Update blockieren.
grant execute on function public.handle_new_user() to supabase_auth_admin;

revoke all on function public.is_lobby_member(uuid)                 from public, anon;
revoke all on function public.is_game_member(uuid)                  from public, anon;
revoke all on function public.shares_lobby_with(uuid)               from public, anon;
revoke all on function public.submission_window_open(uuid, int)     from public, anon;
grant execute on function public.is_lobby_member(uuid)              to authenticated;
grant execute on function public.is_game_member(uuid)               to authenticated;
grant execute on function public.shares_lobby_with(uuid)            to authenticated;
grant execute on function public.submission_window_open(uuid, int)  to authenticated;

revoke all on function public.create_lobby(text)                    from public, anon;
revoke all on function public.join_lobby(text, text)                from public, anon;
revoke all on function public.leave_lobby(uuid)                     from public, anon;
revoke all on function public.kick_member(uuid, uuid)               from public, anon;
revoke all on function public.promote_host(uuid, uuid)              from public, anon;
revoke all on function public.claim_host(uuid)                      from public, anon;
grant execute on function public.create_lobby(text)                 to authenticated;
grant execute on function public.join_lobby(text, text)             to authenticated;
grant execute on function public.leave_lobby(uuid)                  to authenticated;
grant execute on function public.kick_member(uuid, uuid)            to authenticated;
grant execute on function public.promote_host(uuid, uuid)           to authenticated;
grant execute on function public.claim_host(uuid)                   to authenticated;
