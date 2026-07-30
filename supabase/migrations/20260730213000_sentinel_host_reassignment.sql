-- =====================================================================
-- PartyBox — Phase 0a, Nachtrag: Sentinel-Host statt stiller Kaskade
--
-- Befund aus scripts/verify-purge-anonymous-users.sql (voriger Commit,
-- Fall 3): lobbies.host_id ist ON DELETE CASCADE. Wird der letzte
-- (anonyme) Host einer bereits geschlossenen Lobby von
-- purge_stale_anonymous_users() geloescht, verschwindet die Lobby-Zeile
-- stillschweigend mit -- kein SET NULL (Spalte ist NOT NULL), keine
-- FK-Verletzung.
--
-- Fix: ein permanenter, NICHT-anonymer Sentinel-Account. Verwaiste
-- host_id-Referenzen werden unmittelbar vor dem DELETE auf ihn
-- umgehaengt, statt die Lobby mitzuloeschen.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Teil 1: Sentinel-Account
--
-- Fester UUID-Wert: deaddead-0000-4000-8000-000000000001
-- ("dead" als Eselsbruecke fuer "ehemaliger Host"). Einzige Quelle der
-- Wahrheit fuer diesen Wert ist die Funktion sentinel_host_profile_id()
-- unten -- nirgendwo sonst im Schema steht die UUID als Literal.
--
-- is_anonymous = false ist der eigentliche Mechanismus, nicht nur ein
-- Label: purge_stale_anonymous_users() filtert ausschliesslich
-- is_anonymous = true. Der Sentinel faellt dadurch automatisch aus jeder
-- Kandidatenmenge dieses Jobs heraus -- keine zusaetzliche
-- Ausschlussklausel noetig, das ist der Punkt.
--
-- Der Account hat kein Passwort und keine E-Mail-Anmeldung (genau wie ein
-- frischer anonymer Account) und wird von keinem Client-Flow je erzeugt
-- oder angesprochen -- niemand kann sich als dieser Nutzer anmelden.
--
-- Idempotent: ON CONFLICT DO NOTHING auf beiden Inserts. Der
-- profiles-Insert ist bewusst redundant zum on_auth_user_created-Trigger:
-- der Trigger legt das Profil beim ERSTEN Lauf bereits an; laeuft diese
-- Migration je erneut (z. B. `supabase db reset`), greift beim
-- auth.users-Insert der ON CONFLICT und der Trigger feuert dann NICHT --
-- der explizite profiles-Insert ist das Sicherheitsnetz fuer genau diesen
-- Fall.
-- ---------------------------------------------------------------------
insert into auth.users
  (id, instance_id, aud, role, created_at, updated_at, is_anonymous, email, raw_user_meta_data)
values (
  'deaddead-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', now(), now(), false, null,
  '{"display_name":"Ehemaliger Host"}'::jsonb
)
on conflict (id) do nothing;

insert into public.profiles (id, display_name)
values ('deaddead-0000-4000-8000-000000000001', 'Ehemaliger Host')
on conflict (id) do nothing;

create or replace function public.sentinel_host_profile_id()
returns uuid
language sql
immutable
set search_path = ''
as $$
  select 'deaddead-0000-4000-8000-000000000001'::uuid;
$$;

comment on function public.sentinel_host_profile_id() is
  'Permanenter, NICHT-anonymer Sentinel-Profil-Account ("Ehemaliger
   Host"). Ziel fuer lobbies.host_id, wenn purge_stale_anonymous_users()
   den urspruenglichen (anonymen) Host loescht -- verhindert, dass die
   Lobby per lobbies.host_id ON DELETE CASCADE stillschweigend
   mitverschwindet. Einzige Quelle der Wahrheit fuer den UUID-Wert.';

revoke all on function public.sentinel_host_profile_id() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Teil 2: purge_stale_anonymous_users() -- Reassignment vor dem DELETE
--
-- Ablauf pro Lauf: Kandidaten einmal ermitteln, ALLE Lobbies mit
-- host_id in dieser Menge in einem einzigen UPDATE auf den Sentinel
-- umhaengen, danach erst die Kandidaten loeschen. Das UPDATE aendert
-- ausschliesslich host_id -- status, closed_at, last_activity_at,
-- host_claimed_at und alles andere an der Lobby bleiben unangetastet.
-- ---------------------------------------------------------------------
create or replace function public.purge_stale_anonymous_users()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted    integer;
  v_victim_ids uuid[];
begin
  select array_agg(u.id) into v_victim_ids
    from auth.users u
   where u.is_anonymous
     and u.created_at < now() - interval '30 days'
     and not exists (
       select 1 from public.lobby_members m
        where m.user_id = u.id and m.left_at is null
     );

  if v_victim_ids is null then
    return 0;
  end if;

  -- Verwaiste Host-Referenzen umhaengen, BEVOR geloescht wird.
  update public.lobbies
     set host_id = public.sentinel_host_profile_id()
   where host_id = any(v_victim_ids);

  delete from auth.users a where a.id = any(v_victim_ids);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

revoke all on function public.purge_stale_anonymous_users() from public, anon, authenticated;
