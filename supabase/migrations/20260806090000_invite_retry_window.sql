-- ---------------------------------------------------------------------
-- invite_friend_to_lobby: eine unbeantwortete eigene Einladung blockiert
-- nach 2 Minuten keinen erneuten Versuch mehr.
--
-- Vorher warf der unique Index (lobby_id, to_user) bei JEDEM zweiten
-- Versuch ALREADY_INVITED, egal wie alt die erste Einladung war. Eine
-- abgelehnte Einladung war davon nie betroffen (decline_invite loescht die
-- Zeile), nur eine schlicht ignorierte.
--
-- Unveraendert aus 20260731090000_phase0c_identity_and_friends.sql
-- uebernommen, ergaenzt ist ausschliesslich das DELETE vor dem INSERT.
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

  delete from public.lobby_invites
   where lobby_id = p_lobby and to_user = p_to_user
     and created_at < now() - interval '2 minutes';

  insert into public.lobby_invites (lobby_id, from_user, to_user)
  values (p_lobby, v_uid, p_to_user)
  returning id into v_id;

  return jsonb_build_object('invite_id', v_id);
exception
  when unique_violation then
    raise exception 'ALREADY_INVITED';
end $$;
