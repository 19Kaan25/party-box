-- ---------------------------------------------------------------------
-- Bugfix: go_offline() loeschte bisher die komplette user_status-Zeile.
-- Das machte zwar sofort "offline" (last_seen_at ist dann NULL, coalesce()
-- in list_friends() faellt auf false zurueck), zerstoerte dabei aber genau
-- den Zeitstempel, den relativeTimeDe() fuer "zuletzt online vor X" braucht
-- -- FriendsPanel zeigte danach "unbekannt" statt "vor 1 Min.".
--
-- Fix: last_seen_at nur so weit zurueckdatieren, dass die 90-Sekunden-
-- Online-Pruefung sofort fehlschlaegt (91 statt 90 Sekunden Puffer), die
-- Zeile selbst bleibt bestehen. relativeTimeDe() zeigt dann sofort
-- "vor 1 Min." -- nah genug an "gerade eben verlassen".
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
  update public.user_status
     set last_seen_at = now() - interval '91 seconds'
   where user_id = v_uid;
end $$;
