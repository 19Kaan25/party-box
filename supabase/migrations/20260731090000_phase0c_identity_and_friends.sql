-- =====================================================================
-- PartyBox — Phase 0c: Benutzernamen mit Code, Freundschaften,
--                      Online-Status, Lobby-Einladungen
--
-- Konventionen wie in Phase 0a: Lesen ueber RLS, Schreiben ausschliesslich
-- ueber SECURITY DEFINER-RPCs mit search_path = '' und voll qualifizierten
-- Namen. Fehler sind stabile UPPER_SNAKE-Tokens, errcode P0002 heisst
-- "nicht gefunden".
--
-- Zwei Namen, nicht drei:
--   * Benutzername  profiles.username + profiles.discriminator ("Kaan#1234")
--     -> dauerhaft, eindeutig, nur mit echtem Account, dient dem Hinzufuegen.
--   * Anzeigename   lobby_members.display_name
--     -> frei getippt vor dem Erstellen/Beitreten, steht in der Spielerliste.
--   profiles.display_name ist KEIN dritter Name, sondern nur der zuletzt
--   benutzte Anzeigename als Vorbelegung des Eingabefeldes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Benutzername mit vierstelligem Code
--
-- Der Name allein ist ab hier bewusst NICHT mehr eindeutig -- genau das ist
-- der Zweck des Codes. Eindeutig ist erst das Paar (name, code).
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists discriminator text
  check (discriminator is null or discriminator ~ '^[0-9]{4}$');

-- Die alte globale Eindeutigkeit auf username faellt weg.
alter table public.profiles drop constraint if exists profiles_username_key;
drop index if exists public.profiles_username_lower_unique;

-- Bestandsdaten an die neuen Regeln anpassen, bevor die Constraints greifen.
-- Praktisch No-Ops: Phase 0b hat username nirgends gesetzt, der Trigger
-- handle_new_user schreibt nur display_name. Stehen sie trotzdem nicht hier,
-- scheitert die Migration an einer einzigen unerwarteten Zeile.
update public.profiles set username = left(username, 20)
 where username is not null and char_length(username) > 20;
update public.profiles
   set discriminator = lpad((floor(random() * 10000))::int::text, 4, '0')
 where username is not null and discriminator is null;

alter table public.profiles
  add constraint profiles_username_len
  check (username is null or char_length(username) between 3 and 20);

-- Ohne diese Kopplung koennte ein Profil einen Namen ohne Code tragen; der
-- Teilindex unten wuerde solche Zeilen nicht gegeneinander pruefen (NULLs
-- gelten als verschieden) und der Name waere doppelt vergebbar.
alter table public.profiles
  add constraint profiles_handle_complete
  check ((username is null) = (discriminator is null));

create unique index profiles_handle_unique
  on public.profiles (lower(username), discriminator)
  where username is not null;

comment on column public.profiles.discriminator is
  'Vierstelliger Code hinter dem Benutzernamen (Kaan#1234). Zusammen mit '
  'lower(username) eindeutig. Null genau dann, wenn username null ist.';

-- ---------------------------------------------------------------------
-- 2. Laengengrenze 20 fuer Anzeigenamen (bisher 24)
--
-- Reihenfolge zwingend: erst die Bestandsdaten kuerzen, sonst scheitert das
-- ALTER an jeder alten Zeile mit 21-24 Zeichen.
-- ---------------------------------------------------------------------
update public.profiles       set display_name = left(display_name, 20)
 where char_length(display_name) > 20;
update public.lobby_members  set display_name = left(display_name, 20)
 where char_length(display_name) > 20;

alter table public.profiles      drop constraint if exists profiles_display_name_check;
alter table public.lobby_members drop constraint if exists lobby_members_display_name_check;

alter table public.profiles
  add constraint profiles_display_name_len
  check (char_length(display_name) between 1 and 20);
alter table public.lobby_members
  add constraint lobby_members_display_name_len
  check (char_length(display_name) between 1 and 20);

-- Die beiden Lobby-RPCs aus Phase 0a pruefen noch gegen 24 Zeichen und
-- werden weiter unten neu angelegt -- erst nach den Tabellen, weil
-- join_lobby ab jetzt lobby_invites aufraeumt.

-- ---------------------------------------------------------------------
-- 3. Tabellen
-- ---------------------------------------------------------------------

create type public.friendship_status as enum ('pending', 'accepted');

-- Das kanonisch geordnete Paar (user_low < user_high) ist der STRUKTURELLE
-- Schutz gegen Doppeleintraege und gegenlaeufige Zeilen -- dieselbe
-- Denkweise wie die Teil-Unique-Indizes aus Phase 0a. Zwei gleichzeitige
-- Anfragen in beide Richtungen koennen deshalb nicht beide gewinnen: die
-- zweite laeuft in den Primaerschluessel und wird als Annahme gewertet.
create table public.friendships (
  user_low     uuid not null references public.profiles(id) on delete cascade,
  user_high    uuid not null references public.profiles(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  status       public.friendship_status not null default 'pending',
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  primary key (user_low, user_high),
  constraint friendships_ordered check (user_low < user_high)
);

create index friendships_user_high_idx on public.friendships (user_high);

-- Eigene Tabelle statt zweier Spalten auf profiles: profiles haengt am
-- Trigger profiles_set_updated_at, und useAuth.js baut aus updated_at den
-- Cache-Buster der Avatar-URL. Ein Heartbeat alle 45 Sekunden wuerde jedes
-- Profilbild bei allen Mitspielern staendig neu laden lassen.
create table public.user_status (
  user_id          uuid primary key references public.profiles(id) on delete cascade,
  last_seen_at     timestamptz not null default now(),
  current_lobby_id uuid references public.lobbies(id) on delete set null
);

create table public.lobby_invites (
  id         uuid primary key default gen_random_uuid(),
  lobby_id   uuid not null references public.lobbies(id) on delete cascade,
  from_user  uuid not null references public.profiles(id) on delete cascade,
  to_user    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (lobby_id, to_user)
);

create index lobby_invites_to_user_idx on public.lobby_invites (to_user);

alter table public.friendships   enable row level security;
alter table public.user_status   enable row level security;
alter table public.lobby_invites enable row level security;

-- ---------------------------------------------------------------------
-- 3b. Lobby-RPCs neu: Laengengrenze 20 statt 24, plus Aufraeumen der
--     angenommenen Einladung. Der Rest ist unveraendert aus Phase 0a.
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
  if char_length(v_name) > 20 then
    raise exception 'DISPLAY_NAME_TOO_LONG';
  end if;

  perform public.leave_current_lobby_internal(null);

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
  if char_length(v_name) > 20 then
    raise exception 'DISPLAY_NAME_TOO_LONG';
  end if;

  select * into v_lobby
    from public.lobbies l
   where l.code = upper(btrim(coalesce(p_code, '')))
     and l.closed_at is null
   for update;

  if not found then
    raise exception 'LOBBY_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_lobby.status <> 'waiting'
     and not exists (select 1 from public.lobby_members m
                      where m.lobby_id = v_lobby.id and m.user_id = v_uid) then
    raise exception 'GAME_IN_PROGRESS';
  end if;

  perform public.leave_current_lobby_internal(v_lobby.id);

  insert into public.lobby_members (lobby_id, user_id, display_name)
  values (v_lobby.id, v_uid, v_name)
  on conflict (lobby_id, user_id)
    do update set left_at = null, display_name = excluded.display_name;

  update public.lobbies set last_activity_at = now() where id = v_lobby.id;

  -- Eine angenommene Einladung hat sich erledigt.
  delete from public.lobby_invites i
   where i.lobby_id = v_lobby.id and i.to_user = v_uid;

  return jsonb_build_object('lobby_id', v_lobby.id, 'code', v_lobby.code);
end $$;

-- ---------------------------------------------------------------------
-- 4. Identitaets-RPCs
-- ---------------------------------------------------------------------

-- Benutzername setzen oder aendern. Der Code wird JEDES Mal neu gewuerfelt:
-- duerfte man ihn behalten oder frei waehlen, koennte man sich gezielt an
-- eine fremde Wunschkombination heranarbeiten.
create or replace function public.set_username(p_username text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_name     text := btrim(coalesce(p_username, ''));
  v_disc     text;
  v_attempts int := 0;
  v_rows     int;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if v_name !~ '^[A-Za-z0-9_]{3,20}$' then
    raise exception 'USERNAME_INVALID';
  end if;

  loop
    v_attempts := v_attempts + 1;
    v_disc := lpad((floor(random() * 10000))::int::text, 4, '0');
    begin
      update public.profiles
         set username = v_name, discriminator = v_disc
       where id = v_uid;
      -- Ohne diese Pruefung meldete die RPC Erfolg, obwohl gar nichts
      -- geschrieben wurde -- genau das Symptom der verwaisten Sitzung aus
      -- Phase 0b (JWT zeigt auf ein geloeschtes Profil).
      get diagnostics v_rows = row_count;
      if v_rows = 0 then
        raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
      end if;
      exit;
    exception
      when unique_violation then
        -- Alle 10 000 Codes zu diesem Namen belegt ist praktisch
        -- ausgeschlossen; nach 25 Fehlversuchen bricht es trotzdem sauber ab,
        -- statt endlos zu drehen.
        if v_attempts >= 25 then
          raise exception 'USERNAME_TAKEN';
        end if;
    end;
  end loop;

  return jsonb_build_object('username', v_name, 'discriminator', v_disc);
end $$;

-- Suche verlangt Name UND Code exakt. Kein Praefix, kein LIKE -- sonst
-- waere die Nutzertabelle trotz der strengen profiles-RLS durchprobierbar.
create or replace function public.find_profile_by_handle(
  p_username text, p_discriminator text
)
returns table (
  id            uuid,
  username      text,
  discriminator text,
  display_name  text,
  avatar_path   text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.username, p.discriminator, p.display_name, p.avatar_path
    from public.profiles p
   where p.username is not null
     and lower(p.username) = lower(btrim(coalesce(p_username, '')))
     and p.discriminator   = btrim(coalesce(p_discriminator, ''))
   limit 1;
$$;

-- ---------------------------------------------------------------------
-- 5. Freundschafts-RPCs
-- ---------------------------------------------------------------------

create or replace function public.send_friend_request(
  p_username text, p_discriminator text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_other  uuid;
  v_low    uuid;
  v_high   uuid;
  v_row    public.friendships%rowtype;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if not exists (select 1 from public.profiles p
                  where p.id = v_uid and p.username is not null) then
    raise exception 'NO_USERNAME';
  end if;

  select f.id into v_other
    from public.find_profile_by_handle(p_username, p_discriminator) f;

  if v_other is null then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_other = v_uid then
    raise exception 'CANNOT_FRIEND_SELF';
  end if;

  v_low  := least(v_uid, v_other);
  v_high := greatest(v_uid, v_other);

  select * into v_row
    from public.friendships f
   where f.user_low = v_low and f.user_high = v_high
   for update;

  if found then
    if v_row.status = 'accepted' then
      raise exception 'ALREADY_FRIENDS';
    end if;
    if v_row.requested_by = v_uid then
      raise exception 'REQUEST_PENDING';
    end if;
    -- Die Gegenseite hatte bereits angefragt: das hier ist die Annahme.
    update public.friendships
       set status = 'accepted', responded_at = now()
     where user_low = v_low and user_high = v_high;
    return jsonb_build_object('status', 'accepted', 'other', v_other);
  end if;

  insert into public.friendships (user_low, user_high, requested_by)
  values (v_low, v_high, v_uid);

  return jsonb_build_object('status', 'pending', 'other', v_other);
end $$;

create or replace function public.respond_friend_request(
  p_other uuid, p_accept boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_low  uuid;
  v_high uuid;
  v_row  public.friendships%rowtype;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  v_low  := least(v_uid, p_other);
  v_high := greatest(v_uid, p_other);

  select * into v_row
    from public.friendships f
   where f.user_low = v_low and f.user_high = v_high
   for update;

  if not found or v_row.status <> 'pending' then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- Nur der Empfaenger darf antworten. Ohne diese Pruefung koennte der
  -- Absender seine eigene Anfrage annehmen.
  if v_row.requested_by = v_uid then
    raise exception 'NOT_THE_RECIPIENT';
  end if;

  if p_accept then
    update public.friendships
       set status = 'accepted', responded_at = now()
     where user_low = v_low and user_high = v_high;
    return jsonb_build_object('status', 'accepted');
  end if;

  delete from public.friendships
   where user_low = v_low and user_high = v_high;
  return jsonb_build_object('status', 'declined');
end $$;

-- Auch fuer das Zuruecknehmen einer eigenen offenen Anfrage: beide Seiten
-- duerfen die Zeile jederzeit loeschen.
create or replace function public.remove_friend(p_other uuid)
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

  delete from public.friendships
   where user_low  = least(v_uid, p_other)
     and user_high = greatest(v_uid, p_other);
end $$;

-- Eine Zeile je Freund bzw. offener Anfrage.
--
-- Gibt bewusst KEINEN Lobby-Code heraus, nur in_lobby. Einladungen gehen
-- von dir nach aussen; ein Freund soll nicht ungefragt in deine Lobby
-- springen koennen. Bei noch nicht bestaetigten Anfragen bleibt der
-- Online-Status verborgen -- sonst koennte man jemanden allein durch eine
-- unbeantwortete Anfrage dauerhaft beobachten.
create or replace function public.list_friends()
returns table (
  id            uuid,
  username      text,
  discriminator text,
  display_name  text,
  avatar_path   text,
  status        public.friendship_status,
  direction     text,
  last_seen_at  timestamptz,
  online        boolean,
  in_lobby      boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select
      case when f.user_low = auth.uid() then f.user_high else f.user_low end as other_id,
      f.status,
      case
        when f.status = 'accepted'        then 'accepted'
        when f.requested_by = auth.uid()  then 'outgoing'
        else                                   'incoming'
      end as direction
      from public.friendships f
     where auth.uid() in (f.user_low, f.user_high)
  )
  select
    p.id,
    p.username,
    p.discriminator,
    p.display_name,
    p.avatar_path,
    m.status,
    m.direction,
    case when m.status = 'accepted' then s.last_seen_at end,
    case when m.status = 'accepted'
         then coalesce(s.last_seen_at > now() - interval '90 seconds', false)
         else false end,
    case when m.status = 'accepted'
         then coalesce(
                s.last_seen_at > now() - interval '90 seconds'
                and l.id is not null and l.closed_at is null,
                false)
         else false end
    from mine m
    join public.profiles p on p.id = m.other_id
    left join public.user_status s on s.user_id = m.other_id
    left join public.lobbies    l on l.id = s.current_lobby_id
   order by m.status desc, p.username;
$$;

-- ---------------------------------------------------------------------
-- 6. Online-Status
--
-- Der Client ruft das alle 45 Sekunden, solange der Tab sichtbar ist.
-- "Online" heisst in list_friends() last_seen_at > now() - 90 Sekunden,
-- also zwei verpasste Schlaege Toleranz.
-- ---------------------------------------------------------------------
create or replace function public.touch_presence(p_lobby uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_lobby uuid := null;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- Nicht ungeprueft uebernehmen: sonst koennte sich jeder als Mitglied
  -- einer beliebigen Lobby ausgeben.
  if p_lobby is not null and exists (
       select 1 from public.lobby_members m
        where m.lobby_id = p_lobby and m.user_id = v_uid and m.left_at is null
     ) then
    v_lobby := p_lobby;
  end if;

  insert into public.user_status (user_id, last_seen_at, current_lobby_id)
  values (v_uid, now(), v_lobby)
  on conflict (user_id)
    do update set last_seen_at = now(), current_lobby_id = v_lobby;
end $$;

-- ---------------------------------------------------------------------
-- 7. Lobby-Einladungen
-- ---------------------------------------------------------------------

create or replace function public.invite_friend_to_lobby(
  p_lobby uuid, p_to_user uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if not exists (select 1 from public.lobby_members m
                  where m.lobby_id = p_lobby and m.user_id = v_uid
                    and m.left_at is null) then
    raise exception 'NOT_A_MEMBER';
  end if;
  if not exists (select 1 from public.friendships f
                  where f.user_low  = least(v_uid, p_to_user)
                    and f.user_high = greatest(v_uid, p_to_user)
                    and f.status    = 'accepted') then
    raise exception 'NOT_FRIENDS';
  end if;
  if exists (select 1 from public.lobby_members m
              where m.lobby_id = p_lobby and m.user_id = p_to_user
                and m.left_at is null) then
    raise exception 'ALREADY_IN_LOBBY';
  end if;

  insert into public.lobby_invites (lobby_id, from_user, to_user)
  values (p_lobby, v_uid, p_to_user)
  returning id into v_id;

  return jsonb_build_object('invite_id', v_id);
exception
  when unique_violation then
    raise exception 'ALREADY_INVITED';
end $$;

-- Hier ist der Lobby-Code angebracht: man wurde ausdruecklich eingeladen.
create or replace function public.list_my_invites()
returns table (
  id            uuid,
  lobby_code    text,
  from_user     uuid,
  username      text,
  discriminator text,
  display_name  text,
  avatar_path   text,
  created_at    timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, l.code, i.from_user,
         p.username, p.discriminator, p.display_name, p.avatar_path,
         i.created_at
    from public.lobby_invites i
    join public.lobbies  l on l.id = i.lobby_id
    join public.profiles p on p.id = i.from_user
   where i.to_user = auth.uid()
     and l.closed_at is null
   order by i.created_at desc;
$$;

create or replace function public.decline_invite(p_invite uuid)
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
  delete from public.lobby_invites i
   where i.id = p_invite and i.to_user = v_uid;
end $$;

-- ---------------------------------------------------------------------
-- 8. Grants und Policies
--
-- Supabase gewaehrt neuen Tabellen in public per Default-Privileges ALL an
-- anon und authenticated. Das REVOKE aus Phase 0a galt nur fuer die damals
-- existierenden Tabellen -- die drei neuen brauchen es erneut, sonst waeren
-- sie trotz RLS direkt beschreibbar.
-- ---------------------------------------------------------------------
revoke all on public.friendships   from anon, authenticated;
revoke all on public.user_status   from anon, authenticated;
revoke all on public.lobby_invites from anon, authenticated;

-- Nur Lesen, und auch das nur fuer Realtime: der Client arbeitet ueber die
-- RPCs. Ohne SELECT-Grant plus Policy kaeme kein postgres_changes-Ereignis an.
grant select on public.friendships   to authenticated;
grant select on public.lobby_invites to authenticated;
-- user_status: bewusst KEIN Grant. Der Status ist ausschliesslich ueber
-- list_friends() sichtbar, also nur fuer bestaetigte Freunde.

create policy friendships_select_own on public.friendships
  for select to authenticated
  using ((select auth.uid()) in (user_low, user_high));

create policy lobby_invites_select_own on public.lobby_invites
  for select to authenticated
  using ((select auth.uid()) in (from_user, to_user));

revoke all on function public.set_username(text)                     from public, anon;
revoke all on function public.find_profile_by_handle(text, text)     from public, anon;
revoke all on function public.send_friend_request(text, text)        from public, anon;
revoke all on function public.respond_friend_request(uuid, boolean)  from public, anon;
revoke all on function public.remove_friend(uuid)                    from public, anon;
revoke all on function public.list_friends()                         from public, anon;
revoke all on function public.touch_presence(uuid)                   from public, anon;
revoke all on function public.invite_friend_to_lobby(uuid, uuid)     from public, anon;
revoke all on function public.list_my_invites()                      from public, anon;
revoke all on function public.decline_invite(uuid)                   from public, anon;

grant execute on function public.set_username(text)                    to authenticated;
grant execute on function public.find_profile_by_handle(text, text)    to authenticated;
grant execute on function public.send_friend_request(text, text)       to authenticated;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;
grant execute on function public.remove_friend(uuid)                   to authenticated;
grant execute on function public.list_friends()                        to authenticated;
grant execute on function public.touch_presence(uuid)                  to authenticated;
grant execute on function public.invite_friend_to_lobby(uuid, uuid)    to authenticated;
grant execute on function public.list_my_invites()                     to authenticated;
grant execute on function public.decline_invite(uuid)                  to authenticated;

-- ---------------------------------------------------------------------
-- 9. Realtime
--
-- REPLICA IDENTITY FULL fuer lobby_invites: der Primaerschluessel ist id,
-- bei einem DELETE traegt das Ereignis sonst nur diese Spalte -- der Filter
-- to_user=eq.<uid> wuerde nicht greifen und eine zurueckgezogene Einladung
-- bliebe beim Empfaenger stehen. Bei friendships steckt der Filter
-- (user_low/user_high) im Primaerschluessel, dort genuegt der Default.
-- ---------------------------------------------------------------------
alter table public.lobby_invites replica identity full;

do $$
declare t text;
begin
  foreach t in array array['friendships', 'lobby_invites'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 10. Wartung
--
-- Eigener Job statt einer zusaetzlichen Zeile in close-stale-lobbies: der
-- bestehende Job ist verifiziert und wird nicht angefasst.
-- ---------------------------------------------------------------------
select cron.schedule(
  'purge-old-invites',
  '7 * * * *',
  $job$
    delete from public.lobby_invites
     where created_at < now() - interval '2 hours';
  $job$
);
