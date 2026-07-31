-- =====================================================================
-- PartyBox — Phase 0a, Migration 3/3: Realtime, Storage, Wartungsjobs
-- Referenz: docs/supabase-migration-plan.md §6 und §8
--
-- Abweichung vom Plan (bewusste Korrektur): der Stale-Lobby-Job schliesst
-- Lobbys erst nach 24 Stunden ohne Aktivitaet, nicht nach 6.
-- Der 90-Tage-Retention-Job bleibt unveraendert.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Realtime: Postgres Changes nur fuer oeffentlichen Zustand.
--
-- Bewusst NICHT in der Publication: player_secrets, round_submissions,
-- heartbeat. Geheimnisse werden nicht gestreamt, sondern nach jedem
-- Phasenwechsel einmal gezielt nachgeladen — ein Request pro Phase statt
-- eines RLS-Checks pro Aenderung und Abonnent.
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['lobbies', 'lobby_members', 'games', 'game_events'] loop
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
-- Storage: Avatare  (Plan §8)
-- Ersetzt die base64-data-URIs, die heute bei jedem Snapshot erneut an alle
-- Clients gehen (bei 8 Spielern 150-250 KB pro Aenderung).
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,                                          -- Avatare sind fuer Mitspieler ohnehin sichtbar
  262144,                                        -- 256 KB; ein 256px-WebP liegt weit darunter
  array['image/webp', 'image/jpeg', 'image/png']
)
on conflict (id) do nothing;

-- Schreibrecht ausschliesslich im eigenen Ordner {user_id}/...
create policy "avatars_write_own_folder" on storage.objects
  for all to authenticated
  using      (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------
-- Wartungsjobs
-- ---------------------------------------------------------------------
create extension if not exists pg_cron;

-- 1) Verwaiste Lobbys schliessen. Ersetzt das heute komplett fehlende
--    Cleanup. 24 Stunden statt der im Plan genannten 6 — ein Spieleabend
--    mit langer Pause soll nicht mittendrin geschlossen werden.
select cron.schedule(
  'close-stale-lobbies',
  '*/15 * * * *',
  $job$
    update public.lobbies
       set closed_at = now()
     where closed_at is null
       and last_activity_at < now() - interval '24 hours';
  $job$
);

-- 2) Retention: Partien und Ereignisse nach 90 Tagen loeschen.
--    game_events, player_secrets und round_submissions haengen per
--    on delete cascade an games und verschwinden mit.
--    Der zweite Zweig faengt Partien ab, die nie sauber beendet wurden.
select cron.schedule(
  'purge-old-games',
  '17 3 * * *',
  $job$
    delete from public.games
     where (ended_at is not null and ended_at   < now() - interval '90 days')
        or (ended_at is null     and started_at < now() - interval '90 days');
  $job$
);

-- 3) Anonyme Gast-Accounts aufraeumen (Plan-Schritt 8, optional).
--
--    ACHTUNG, destruktiv und noch nicht gegen eine echte Datenbank
--    verifiziert: das Loeschen eines auth.users-Eintrags kaskadiert ueber
--    profiles auf lobbies (host_id) und damit auf games/game_events.
--    Fuer einen 30 Tage alten Gast ohne aktive Mitgliedschaft ist genau das
--    gewollt. Vor dem produktiven Scharfschalten einmal die SELECT-Variante
--    in scripts/verify-phase0a.sql laufen lassen.
create or replace function public.purge_stale_anonymous_users()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_deleted integer;
begin
  with victims as (
    select u.id
      from auth.users u
     where u.is_anonymous
       and u.created_at < now() - interval '30 days'
       and not exists (
         select 1 from public.lobby_members m
          where m.user_id = u.id and m.left_at is null
       )
  )
  delete from auth.users a
   using victims v
   where a.id = v.id;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

revoke all on function public.purge_stale_anonymous_users() from public, anon, authenticated;

select cron.schedule(
  'purge-stale-anonymous-users',
  '43 3 * * *',
  $job$ select public.purge_stale_anonymous_users(); $job$
);
