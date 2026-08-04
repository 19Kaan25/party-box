-- ---------------------------------------------------------------------
-- Beitrittsanfragen: Kehrseite von lobby_invites. Nicht der Lobby-
-- Mitgliedstoss laedt jemanden ein, sondern jemand ohne Lobby fragt einen
-- Freund, der schon in einer sitzt, ob er reinkommen darf.
--
-- Bewusst KEIN direkter Beitritt bei Zustimmung: respond_join_request()
-- legt stattdessen dieselbe Zeile an, die invite_friend_to_lobby() auch
-- anlegen wuerde (lobby_invites, from_user=Antwortender, to_user=
-- Anfragender). Der Anfragende sieht sie im schon bestehenden
-- "Einladungen"-Reiter und nimmt sie ueber denselben Weg an wie jede
-- andere Einladung -- inklusive 24-Stunden-Ablauf, Realtime, Toasts. Kein
-- zweiter Beitritts-Pfad im Client noetig.
-- ---------------------------------------------------------------------

create table public.lobby_join_requests (
  id         uuid primary key default gen_random_uuid(),
  lobby_id   uuid not null references public.lobbies(id) on delete cascade,
  from_user  uuid not null references public.profiles(id) on delete cascade,
  to_user    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (lobby_id, from_user)
);

create index lobby_join_requests_to_user_idx on public.lobby_join_requests (to_user);

alter table public.lobby_join_requests enable row level security;

-- ---------------------------------------------------------------------
-- request_to_join_lobby: die zu Zieluser p_to_user aktuell gehoerende
-- Lobby wird serverseitig aufgeloest, nicht vom Client mitgegeben --
-- list_friends() gibt bewusst keinen Lobby-Code heraus (Plan-Prinzip),
-- der Anfragende kennt die Lobby also gar nicht.
-- ---------------------------------------------------------------------
create or replace function public.request_to_join_lobby(p_to_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_lobby public.lobbies%rowtype;
  v_id    uuid;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if v_uid = p_to_user then
    raise exception 'CANNOT_FRIEND_SELF';
  end if;
  if not exists (select 1 from public.friendships f
                  where f.user_low  = least(v_uid, p_to_user)
                    and f.user_high = greatest(v_uid, p_to_user)
                    and f.status    = 'accepted') then
    raise exception 'NOT_FRIENDS';
  end if;

  select l.* into v_lobby
    from public.lobbies l
    join public.lobby_members m on m.lobby_id = l.id
   where m.user_id = p_to_user and m.left_at is null and l.closed_at is null;

  if not found then
    raise exception 'FRIEND_NOT_IN_LOBBY';
  end if;
  if v_lobby.status <> 'waiting' then
    raise exception 'GAME_IN_PROGRESS';
  end if;
  if exists (select 1 from public.lobby_members m
              where m.lobby_id = v_lobby.id and m.user_id = v_uid and m.left_at is null) then
    raise exception 'ALREADY_IN_LOBBY';
  end if;

  -- Gleiches Muster wie bei invite_friend_to_lobby (Migration
  -- 20260806090000): eine eigene, laenger als 2 Minuten unbeantwortete
  -- Anfrage blockiert keinen erneuten Versuch mehr.
  delete from public.lobby_join_requests
   where lobby_id = v_lobby.id and from_user = v_uid
     and created_at < now() - interval '2 minutes';

  insert into public.lobby_join_requests (lobby_id, from_user, to_user)
  values (v_lobby.id, v_uid, p_to_user)
  returning id into v_id;

  return jsonb_build_object('request_id', v_id, 'lobby_id', v_lobby.id);
exception
  when unique_violation then
    raise exception 'ALREADY_REQUESTED';
end $$;

create or replace function public.list_my_join_requests()
returns table (
  id            uuid,
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
  select r.id, r.from_user,
         p.username, p.discriminator, p.display_name, p.avatar_path,
         r.created_at
    from public.lobby_join_requests r
    join public.lobbies  l on l.id = r.lobby_id
    join public.profiles p on p.id = r.from_user
   where r.to_user = auth.uid()
     and l.closed_at is null
     and l.status = 'waiting'
     -- Nur noch relevant, solange der Antwortende selbst aktives
     -- Mitglied ist -- sonst koennte er die Anfrage gar nicht mehr
     -- erfuellen (respond_join_request wuerde NOT_A_MEMBER werfen).
     and exists (select 1 from public.lobby_members m
                  where m.lobby_id = l.id and m.user_id = auth.uid() and m.left_at is null)
   order by r.created_at desc;
$$;

create or replace function public.respond_join_request(p_request uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_req public.lobby_join_requests%rowtype;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into v_req from public.lobby_join_requests
   where id = p_request and to_user = v_uid;
  if not found then
    raise exception 'REQUEST_NOT_FOUND';
  end if;

  delete from public.lobby_join_requests where id = p_request;

  if not p_accept then
    return;
  end if;

  if not exists (select 1 from public.lobby_members m
                  join public.lobbies l on l.id = m.lobby_id
                 where m.lobby_id = v_req.lobby_id and m.user_id = v_uid
                   and m.left_at is null and l.closed_at is null and l.status = 'waiting') then
    raise exception 'NOT_A_MEMBER';
  end if;
  if exists (select 1 from public.lobby_members m
              where m.lobby_id = v_req.lobby_id and m.user_id = v_req.from_user and m.left_at is null) then
    raise exception 'ALREADY_IN_LOBBY';
  end if;

  -- Dieselbe Zielzeile wie invite_friend_to_lobby. on conflict statt
  -- Fehler: falls der Antwortende die Person parallel schon direkt
  -- eingeladen hatte, wird deren Einladung nur aufgefrischt.
  insert into public.lobby_invites (lobby_id, from_user, to_user)
  values (v_req.lobby_id, v_uid, v_req.from_user)
  on conflict (lobby_id, to_user) do update set created_at = now();
end $$;

revoke all on public.lobby_join_requests from anon, authenticated;
grant select on public.lobby_join_requests to authenticated;

create policy lobby_join_requests_select_own on public.lobby_join_requests
  for select to authenticated
  using ((select auth.uid()) in (from_user, to_user));

revoke all on function public.request_to_join_lobby(uuid)          from public, anon;
revoke all on function public.list_my_join_requests()               from public, anon;
revoke all on function public.respond_join_request(uuid, boolean)   from public, anon;

grant execute on function public.request_to_join_lobby(uuid)        to authenticated;
grant execute on function public.list_my_join_requests()            to authenticated;
grant execute on function public.respond_join_request(uuid, boolean) to authenticated;

-- Wie bei lobby_invites: REPLICA IDENTITY FULL, sonst traegt ein DELETE-
-- Ereignis nur die id und der Filter to_user=eq.<uid> greift nicht.
alter table public.lobby_join_requests replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'lobby_join_requests'
  ) then
    execute 'alter publication supabase_realtime add table public.lobby_join_requests';
  end if;
end $$;

-- Kuerzere Lebensdauer als lobby_invites (24h): eine Beitrittsanfrage ist
-- ein spontanes "bin ich willkommen?", keine Einladung, auf die man einen
-- Tag lang reagieren koennte -- bleibt sie zwei Stunden unbeantwortet, hat
-- sich die Situation ohnehin meist erledigt.
select cron.schedule(
  'purge-old-join-requests',
  '12 * * * *',
  $job$
    delete from public.lobby_join_requests
     where created_at < now() - interval '2 hours';
  $job$
);
