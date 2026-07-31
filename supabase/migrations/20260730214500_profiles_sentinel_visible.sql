-- =====================================================================
-- PartyBox — Phase 0a, Nachtrag 2: Sentinel-Profil oeffentlich lesbar
--
-- Bisher konnte nur ein Client sehen, dass eine geschlossene Lobby einen
-- Sentinel-Host hat (lobbies.host_id ist Teil der lobbies-Zeile, sichtbar
-- fuer alle Mitglieder dieser Lobby) -- das dazugehoerige profiles.
-- display_name war aber nicht auflösbar: profiles_select_visible erlaubt
-- nur die eigene Zeile oder shares_lobby_with(id), und der Sentinel ist
-- nie Mitglied einer Lobby, also greift shares_lobby_with fuer ihn nie.
--
-- Fix: eine zusaetzliche, permissive SELECT-Policy ausschliesslich fuer
-- die Sentinel-Zeile, unabhaengig von shares_lobby_with. Postgres-RLS
-- verknuepft mehrere permissive Policies fuer denselben Befehl per OR --
-- profiles_select_visible bleibt unveraendert, diese Policy erweitert nur
-- die sichtbare Menge um genau eine Zeile.
--
-- Kein Datenschutzproblem: der Sentinel enthaelt keine echten
-- Personendaten (kein Avatar, kein Username, display_name ist das
-- statische Label "Ehemaliger Host").
-- =====================================================================

-- sentinel_host_profile_id() wird ab jetzt auch im RLS-Kontext gewoehnlicher
-- authenticated-Queries ausgewertet (nicht mehr nur innerhalb von
-- SECURITY DEFINER-Funktionen wie purge_stale_anonymous_users). Die
-- vorherige Migration hat EXECUTE dafuer bewusst von authenticated
-- entzogen -- das muss hier gezielt wieder gewaehrt werden, sonst schlaegt
-- jede SELECT-Abfrage auf profiles mit "permission denied for function"
-- fehl, sobald diese Policy ausgewertet wird.
grant execute on function public.sentinel_host_profile_id() to authenticated;

create policy profiles_select_sentinel on public.profiles
  for select to authenticated
  using (id = public.sentinel_host_profile_id());
