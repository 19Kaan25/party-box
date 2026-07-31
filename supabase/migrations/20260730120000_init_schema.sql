-- =====================================================================
-- PartyBox — Phase 0a, Migration 1/3: Schema
-- Extensions, Enums, 8 Tabellen, Indizes, RLS-Aktivierung.
-- Referenz: docs/supabase-migration-plan.md §4
--
-- Abweichung vom Plan: username nutzt text + unique index on lower(username)
-- statt citext. Funktional identisch, spart die Extension und deren
-- search_path-Abhaengigkeit.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type public.lobby_status as enum ('waiting', 'in_progress');

create type public.game_key as enum (
  'imposter', 'werwolf', 'codenames', 'wer_bin_ich', 'stadt_land_fluss'
);

-- ---------------------------------------------------------------------
-- 1. profiles  (Plan §4.1)
-- ---------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 24),
  username     text unique,       -- null solange anonym
  avatar_path  text,              -- Storage-Objektpfad, NICHT base64, NICHT URL
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index profiles_username_lower_unique
  on public.profiles (lower(username)) where username is not null;

comment on column public.profiles.avatar_path is
  'Pfad im Storage-Bucket avatars, Form {user_id}/avatar.webp. Nie base64.';

-- ---------------------------------------------------------------------
-- 2. lobbies  (Plan §4.2)
-- ---------------------------------------------------------------------
create table public.lobbies (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique check (code ~ '^[A-Z2-9]{6}$'),
  host_id            uuid not null references public.profiles(id) on delete cascade,
  host_claimed_at    timestamptz not null default now(),
  status             public.lobby_status not null default 'waiting',
  current_game       public.game_key,
  global_leaderboard boolean not null default true,
  created_at         timestamptz not null default now(),
  last_activity_at   timestamptz not null default now(),
  closed_at          timestamptz
);

create index lobbies_open_activity
  on public.lobbies (last_activity_at) where closed_at is null;

comment on column public.lobbies.host_claimed_at is
  'Kein Heartbeat. Wird nur bei echter Host-Uebernahme geschrieben und dient
   claim_host() als 30-Sekunden-Cooldown gegen wechselseitiges Wegnehmen.';

-- ---------------------------------------------------------------------
-- 3. lobby_members  (Plan §4.3) — ersetzt das players-Array
-- ---------------------------------------------------------------------
create table public.lobby_members (
  lobby_id     uuid not null references public.lobbies(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 24),
  score        integer not null default 0 check (score >= 0),
  joined_at    timestamptz not null default now(),
  left_at      timestamptz,
  primary key (lobby_id, user_id)
);

-- Name innerhalb einer Lobby eindeutig, solange aktiv.
-- Ersetzt den racy Vorab-Check in useLobby.js:147.
create unique index lobby_members_name_unique
  on public.lobby_members (lobby_id, lower(display_name)) where left_at is null;

-- Ein Nutzer ist in hoechstens einer Lobby gleichzeitig aktiv.
-- Macht die Reconnect-Abfrage (Plan §7) deterministisch und ersetzt die
-- Invariante, die users/{uid}.currentLobby heute nur annimmt.
create unique index lobby_members_one_active_per_user
  on public.lobby_members (user_id) where left_at is null;

create index lobby_members_active_by_lobby
  on public.lobby_members (lobby_id, joined_at) where left_at is null;

-- ---------------------------------------------------------------------
-- 4. games  (Plan §4.4)
-- ---------------------------------------------------------------------
create table public.games (
  id               uuid primary key default gen_random_uuid(),
  lobby_id         uuid not null references public.lobbies(id) on delete cascade,
  game_key         public.game_key not null,
  phase            text not null,
  round_no         integer not null default 1 check (round_no >= 1),
  config           jsonb not null default '{}'::jsonb,
  state            jsonb not null default '{}'::jsonb,
  phase_started_at timestamptz not null default now(),
  phase_deadline   timestamptz,
  started_at       timestamptz not null default now(),
  ended_at         timestamptz
);

-- Genau ein aktives Spiel pro Lobby.
create unique index games_one_active_per_lobby
  on public.games (lobby_id) where ended_at is null;

create index games_retention on public.games (ended_at, started_at);

comment on column public.games.phase_deadline is
  'Serverseitige Deadline (now() in der RPC gesetzt). Clients rendern den
   Countdown lokal aus phase_deadline minus eigenem Uhren-Offset — waehrend
   der Runde fliesst dafuer kein Paket. Plan §3.1.';

-- ---------------------------------------------------------------------
-- 5. player_secrets  (Plan §4.5) — server-geschrieben, eigen-gelesen
-- ---------------------------------------------------------------------
create table public.player_secrets (
  game_id    uuid not null references public.games(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  payload    jsonb not null,
  created_at timestamptz not null default now(),
  primary key (game_id, user_id)
);

comment on table public.player_secrets is
  'Pro-Spieler-Projektion der Geheimnisse. Kein Client darf hier schreiben;
   RLS erlaubt ausschliesslich SELECT der eigenen Zeile. Aufloesung am
   Spielende erfolgt per Kopie nach games.state.reveal, nicht per Policy.';

-- ---------------------------------------------------------------------
-- 6. round_submissions  (Plan §4.6) — client-geschrieben, eigen-gelesen
-- ---------------------------------------------------------------------
create table public.round_submissions (
  game_id      uuid not null references public.games(id) on delete cascade,
  round_no     integer not null check (round_no >= 1),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  payload      jsonb not null,
  submitted_at timestamptz not null default now(),
  primary key (game_id, round_no, user_id)
);

comment on table public.round_submissions is
  'Einzige Tabelle mit Client-Schreibrecht (Plan Entscheidung 6). Bewusst von
   player_secrets getrennt: umgekehrte Schreibrichtung. Laegen beide in einer
   Tabelle, koennte ein Client seine eigene Imposter-Rolle ueberschreiben.';

-- ---------------------------------------------------------------------
-- 7. game_events  (Plan §4.7) — oeffentliche Aktionen, append-only
-- ---------------------------------------------------------------------
create table public.game_events (
  id         bigserial primary key,
  game_id    uuid not null references public.games(id) on delete cascade,
  round_no   integer not null check (round_no >= 1),
  actor_id   uuid not null references public.profiles(id) on delete cascade,
  kind       text not null,
  target_id  uuid references public.profiles(id) on delete set null,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Doppelabstimmung strukturell unmoeglich (heute nur disabled={hasVoted}).
create unique index game_events_one_vote_per_round
  on public.game_events (game_id, round_no, actor_id) where kind = 'vote';

create index game_events_game_round on public.game_events (game_id, round_no);

-- ---------------------------------------------------------------------
-- 8. heartbeat  (Plan §4.8) — Keep-Alive gegen die 7-Tage-Pausierung
-- ---------------------------------------------------------------------
create table public.heartbeat (
  id        smallint primary key default 1 check (id = 1),
  pinged_at timestamptz not null default now(),
  source    text
);

insert into public.heartbeat (id, source) values (1, 'init');

comment on table public.heartbeat is
  'Einzeilig. Wird ausschliesslich vom Vercel-Cron mit dem Service-Role-Key
   beschrieben. RLS ist aktiv, aber es gibt bewusst KEINE Policy — damit ist
   die Tabelle fuer anon und authenticated vollstaendig unerreichbar.';

-- ---------------------------------------------------------------------
-- updated_at-Trigger fuer profiles
-- ---------------------------------------------------------------------
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- RLS auf allen Tabellen aktivieren.
-- Policies folgen in Migration 2 — ohne Policy ist eine Tabelle mit
-- aktiviertem RLS fuer anon/authenticated komplett dicht (Fail-Closed).
-- ---------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.lobbies           enable row level security;
alter table public.lobby_members     enable row level security;
alter table public.games             enable row level security;
alter table public.player_secrets    enable row level security;
alter table public.round_submissions enable row level security;
alter table public.game_events       enable row level security;
alter table public.heartbeat         enable row level security;
