-- ---------------------------------------------------------------------
-- Push-Abos fuer Web-Push-Benachrichtigungen (Lobby-Einladung an einen
-- gerade nicht online sichtbaren Freund).
--
-- Nur ueber RPCs beschreibbar, kein direkter Grant -- gleiche Machart wie
-- friendships/lobby_invites. Gelesen wird die Tabelle NIE vom Client
-- (auch nicht die eigenen Zeilen): der Sende-Endpunkt in api/ laeuft mit
-- dem Service-Role-Key und braucht deshalb keine SELECT-Policy.
-- ---------------------------------------------------------------------

create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

create index push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

-- Ein Endpoint gehoert genau einem Geraet/Browser-Profil. Meldet sich
-- dasselbe Geraet erneut an (Reinstall, Berechtigung neu erteilt), wird
-- die bestehende Zeile aufgefrischt statt eine zweite anzulegen -- sonst
-- bekaeme diese Person doppelte Benachrichtigungen.
create or replace function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text
)
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
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (v_uid, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh  = excluded.p256dh,
        auth    = excluded.auth;
end $$;

-- Aufgerufen wenn der Nutzer die Berechtigung im Browser widerruft oder die
-- App das selbst erkennt (subscription.unsubscribe()).
create or replace function public.delete_push_subscription(p_endpoint text)
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
  delete from public.push_subscriptions
   where endpoint = p_endpoint and user_id = v_uid;
end $$;

revoke all on function public.save_push_subscription(text, text, text) from public, anon;
revoke all on function public.delete_push_subscription(text)           from public, anon;

grant execute on function public.save_push_subscription(text, text, text) to authenticated;
grant execute on function public.delete_push_subscription(text)           to authenticated;
