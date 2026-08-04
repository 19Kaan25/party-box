-- ---------------------------------------------------------------------
-- go_offline(): explizites "ich geh jetzt" statt auf den 90-Sekunden-
-- Timeout in list_friends() zu warten.
--
-- Vorher gab es kein Signal beim Verlassen -- nur touch_presence() alle
-- 45 Sekunden, solange die Seite offen ist. Wer die App schliesst, blieb
-- fuer die volle 90-Sekunden-Toleranz "online". Der Client ruft diese RPC
-- jetzt zusaetzlich beim pagehide-Event (siehe usePresence.js), per
-- fetch(..., {keepalive: true}) statt supabase.rpc() -- der Seitenwechsel
-- darf nicht auf eine Antwort warten.
--
-- Loeschen statt "auf einen Zeitpunkt in der Vergangenheit setzen": die
-- Zeile hat sonst keinen weiteren Zweck, list_friends() behandelt fehlende
-- user_status wie eine abgelaufene ohnehin identisch (coalesce(..., false)).
-- ---------------------------------------------------------------------
create or replace function public.go_offline()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  delete from public.user_status where user_id = v_uid;
end $$;

revoke all on function public.go_offline() from public, anon;
grant execute on function public.go_offline() to authenticated;
