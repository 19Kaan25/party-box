# PartyBox — Migrationsplan Firestore → Supabase

Stand 30.07.2026. Grundlage ist die Bestandsaufnahme in
[docs/codebase-overview.md](codebase-overview.md). Dieses Dokument ist der Entwurf, der vor
der Implementierung reviewt wird — es enthält **keinen** Anwendungscode und keine
ausführbaren Migrationen.

---

## 1. Warum

Fünf Probleme lassen sich mit dem heutigen Firestore-Datenmodell nicht beheben, weil sie
aus dem Modell selbst folgen:

1. **Ein Dokument für alles.** Der komplette Spielzustand aller 5 Spiele liegt in einem
   Lobby-Dokument, das jeder Spieler abonniert — inklusive Imposter-Wort, Werwolf-Rollen und
   Codenames-Farben. Versteckt wird ausschließlich durch bedingtes Rendern.
2. **`players` ist ein Array**, das per Read-Modify-Write ersetzt wird. Gleichzeitige
   Beitritte, Kicks und Punktevergaben verlieren Daten.
3. **Kein Disconnect-Handling.** Ghost-Spieler blockieren „alle bereit"-Gates, verwaiste
   Lobbys werden nie gelöscht.
4. **Avatare als base64** im Dokument — bei jeder Änderung gehen alle Bilder aller Spieler
   erneut an alle Clients.
5. **Timer über Client-Uhren.** `Date.now()` des Hosts gegen `Date.now()` des Clients: bei
   Stadt Land Fluss bekommt dadurch nicht jeder dieselbe Rundenzeit.

**Primärziel der Migration:** Die App muss sich flüssig anfühlen und die Bildschirme müssen
so synchron wie möglich sein — bei Verzögerungen entstehen bei Stadt Land Fluss echte
Spielnachteile. Alles Weitere ordnet sich dem unter.

**Nutzungskontext:** Familie und Freundeskreis, Weitergabe im Bekanntenkreis. Keine
App-Store-Veröffentlichung. Das Bedrohungsmodell ist entsprechend klein — der Nutzen der
serverseitigen Geheimnisse liegt in der **Spielintegrität** (eine offene Konsole verdirbt
die Runde für alle im Raum), nicht in der Abwehr von Angreifern.

---

## 2. Getroffene Entscheidungen

| # | Frage | Entscheidung | Begründung |
|---|---|---|---|
| 1 | Ort der Spiellogik | **Postgres-RPCs** (`SECURITY DEFINER`) | Latenz: ein Round-Trip statt Client→Edge Function→DB, keine Cold Starts. Nebeneffekt: Transaktionen lösen die Race Conditions gratis mit. |
| 2 | Auth | **Anonym + echte E-Mail** | `signInAnonymously()` als Default, Upgrade per `updateUser()` auf dieselbe uid. Echtes Passwort-Reset, keine Enumeration. |
| 3 | Cutover-Schnitt | **Foundation-Cutover** | Lobby/Auth/Presence/Storage gehen komplett zu Supabase; noch nicht migrierte Spiele laufen übergangsweise als jsonb-Blob weiter. Dual-Stack hieße zwei Quellen der Wahrheit für die Mitgliederliste. |
| 4 | Secret-Modell | **Pro-Spieler-Projektion** | Eine Tabelle, eine Policy-Zeile (`user_id = auth.uid()`). Zugleich die einfachste Variante *und* die einzige, die den invertierten Fall (Wer bin ich) direkt abdeckt. |
| 5 | Host-Übernahme | **`claim_host`-RPC** mit Bestätigungsdialog | Presence ist für Postgres unsichtbar, eine serverseitige „ist der Host wirklich weg"-Prüfung ist unmöglich. Jedes aktive Mitglied darf übernehmen; kein laufender DB-Write. |
| 6 | `round_submissions` | **client-geschrieben** | Spart bei Stadt Land Fluss einen Round-Trip. Einzige Client-Schreib-Policy im ganzen Design; Trade-off bewusst akzeptiert (s. Risiko 5). |
| 7 | Cross-Lobby-Bestenliste | **nicht in dieser Migration** | Schema hält es offen (`games` bleiben stehen), aber kein aktiver Scope. |
| 8 | Firestore-Datenimport | **entfällt** | `users` enthält ~70 Einträge, davon **ein** echter Account — der Rest sind wiederholt erzeugte anonyme Gast-Sessions ohne Bestand. Lobbys sind ohnehin ephemer. |
| 9 | Werwolf-Erzähler | **sieht alles**, unverändert | Seine Projektion *ist* die Masterliste. Spielregel, kein Leck. |
| 10 | Retention | **90 Tage** für beendete `games` und `game_events` | Eigener `pg_cron`-Job neben dem Lobby-Cleanup. |
| 11 | Rückfallebene | Firestore-Version bleibt **während der gesamten Migration** unter zweiter URL erreichbar | Nicht nur bis zum initialen Umschalten — auch wenn eine spätere Phase am Spieleabend Probleme macht. |

---

## 3. Latenz- & Sync-Design

Drei Transportwege mit sehr unterschiedlichen Kosten. Die Zuordnung entscheidet, wie
flüssig sich die App anfühlt:

| Weg | Typische Latenz | Wofür |
|---|---|---|
| **Broadcast** (Realtime, DB nicht beteiligt) | ~20–50 ms | Sofort-Feedback: „Runde beendet", „X wählt gerade", Aufdeck-Animationen |
| **Postgres Changes** (WAL → Realtime → RLS pro Abonnent) | ~100–500 ms | Autoritativer Zustand: Phasenwechsel, Mitgliederliste, Punkte |
| **Presence** (ephemer, kein DB-Write) | ~50 ms | Wer ist online, Ghost-Erkennung, „bereit"-Flags |

**Muster: Broadcast für den optischen Reiz, Postgres Changes als Wahrheit.** Der handelnde
Client sendet direkt nach dem RPC-Return einen Broadcast; alle Clients reagieren sofort
optisch und korrigieren, sobald das `UPDATE` auf `games` eintrifft.

### 3.1 Timer ohne Netzwerkverkehr

Das eigentliche Stadt-Land-Fluss-Problem löst sich ohne laufende Kommunikation:

1. `games.phase_deadline timestamptz` wird **serverseitig** in der RPC gesetzt
   (`now() + make_interval(secs => ...)`). Für alle Spieler identisch, per Definition.
2. Jeder Client bestimmt beim Lobby-Beitritt **einmal** seinen Uhren-Offset gegen den
   Server (mehrere `select now()`-Messungen, die mit der kleinsten RTT gewinnt).
3. Der Countdown rendert lokal aus `phase_deadline − (Date.now() + offset)`.

→ Während der gesamten Runde fließt **kein einziges Paket** für den Timer. Uhrendrift ist
eliminiert, alle sehen exakt dieselbe Restzeit. Ersetzt `startTimestamp` /
`playingStartTime` ([StadtLandFlussEngine.jsx:33,56](../src/games/StadtLandFlussEngine.jsx)).

### 3.2 Was ausdrücklich **kein** DB-Write wird

Tastatureingaben (Antworten bleiben lokal bis zum Submit), Timer-Ticks, „tippt gerade",
„schaut sich seine Rolle an", Hover-/Auswahl-Zustände, Notizfeld bei Wer bin ich.

### 3.3 Der 2,5-Sekunden-Hack entfällt

Heute wartet der Host pauschal 2500 ms, bis alle Antworten hochgeladen sind
([StadtLandFlussEngine.jsx:85](../src/games/StadtLandFlussEngine.jsx)) — auf langsamen
Verbindungen gehen Antworten verloren. Neu: `end_round()` snapshottet in einer Transaktion
genau das, was committed ist; Nachzügler werden mit 2 Sekunden Toleranz gegen
`phase_deadline` serverseitig abgelehnt statt stillschweigend verschluckt.

### 3.4 Region

Supabase-Projekt in `eu-central-1` (Frankfurt). Bei deutscher Nutzerschaft sind das
~50–100 ms weniger pro Round-Trip als us-east — der größte Einzelhebel für „flüssig".

---

## 4. Schema

Bewusst schlank: acht Tabellen. Öffentlicher Spielzustand bleibt als `jsonb` in
`games.state` — eine eigene Tabelle bekommt nur, was Constraints oder eigene Sichtbarkeit
braucht.

```sql
create extension if not exists pgcrypto;
create extension if not exists citext;

create type lobby_status as enum ('waiting', 'in_progress');
create type game_key as enum ('imposter','werwolf','codenames','wer_bin_ich','stadt_land_fluss');
```

### 4.1 `profiles`

```sql
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null check (char_length(display_name) between 1 and 24),
  username      citext unique,          -- null solange anonym
  avatar_path   text,                   -- Storage-Objektpfad, NICHT base64, NICHT URL
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
```

`role` aus Firestore entfällt (war immer `'user'`; das Badge in
[AuthMenu.jsx:18](../src/components/auth/AuthMenu.jsx) ist toter Code). `photoURL` wird zu
`avatar_path` — der Client baut die Public-URL selbst, damit nie wieder ein Bild im
Realtime-Payload landet.

Profilanlage per Trigger, nicht durch den Client:

```sql
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', 'Spieler'));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

### 4.2 `lobbies`

```sql
create table public.lobbies (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique check (code ~ '^[A-Z2-9]{6}$'),
  host_id            uuid not null references public.profiles(id),
  host_claimed_at    timestamptz not null default now(),   -- Cooldown für claim_host
  status             lobby_status not null default 'waiting',
  current_game       game_key,
  global_leaderboard boolean not null default true,
  created_at         timestamptz not null default now(),
  last_activity_at   timestamptz not null default now(),
  closed_at          timestamptz
);
```

**Code 6 statt 4 Zeichen**, Alphabet ohne `I O 0 1` (32 Zeichen → 32⁶ ≈ 1,07 Mrd. statt
1,68 Mio.). Zusammen mit `unique` + Retry auf `23505` verschwindet das Überschreiben
fremder Lobbys ([useLobby.js:90-113](../src/hooks/useLobby.js)) vollständig.

`host_claimed_at` ist **kein** Heartbeat — es wird nur bei einer tatsächlichen Übernahme
geschrieben und dient als Cooldown, damit sich zwei Spieler nicht gegenseitig den Host
wegnehmen können.

### 4.3 `lobby_members` — ersetzt das `players`-Array

```sql
create table public.lobby_members (
  lobby_id     uuid not null references public.lobbies(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  display_name text not null,
  score        integer not null default 0 check (score >= 0),
  joined_at    timestamptz not null default now(),
  left_at      timestamptz,
  primary key (lobby_id, user_id)
);

-- Name innerhalb einer Lobby eindeutig, solange aktiv
create unique index lobby_members_name_unique
  on public.lobby_members (lobby_id, lower(display_name))
  where left_at is null;

-- Ein Nutzer ist in höchstens einer Lobby gleichzeitig aktiv
create unique index lobby_members_one_active_per_user
  on public.lobby_members (user_id)
  where left_at is null;
```

Vier Probleme auf einmal erledigt:

- **PK `(lobby_id, user_id)`** macht Doppelbeitritt strukturell unmöglich.
- **Unique-Index auf den Namen** erzwingt „Name schon vergeben" in der DB statt im racy
  Client-Check ([useLobby.js:147](../src/hooks/useLobby.js)).
- **`left_at` statt Löschen** ersetzt die komplette `scoreHistory`-Map: die Zeile bleibt
  liegen, beim Rejoin wird `left_at` genullt und der Score ist einfach noch da. Der
  Host-Effect in [useLobby.js:63-80](../src/hooks/useLobby.js) entfällt ersatzlos.
- **`one_active_per_user`** macht die Reconnect-Abfrage (§7) deterministisch und erzwingt
  die Invariante, die das heutige `users/{uid}.currentLobby` nur *annimmt*.

`isHost` entfällt als Spalte — wird aus `lobbies.host_id` abgeleitet, damit es nicht
desynchronisieren kann.

### 4.4 `games`

```sql
create table public.games (
  id               uuid primary key default gen_random_uuid(),
  lobby_id         uuid not null references public.lobbies(id) on delete cascade,
  game_key         game_key not null,
  phase            text not null,
  round_no         integer not null default 1,
  config           jsonb not null default '{}'::jsonb,  -- öffentliche Einstellungen
  state            jsonb not null default '{}'::jsonb,  -- öffentlicher Zustand + Auflösung
  phase_started_at timestamptz not null default now(),
  phase_deadline   timestamptz,                          -- Serverzeit, s. §3.1
  started_at       timestamptz not null default now(),
  ended_at         timestamptz
);

create unique index games_one_active_per_lobby
  on public.games (lobby_id) where ended_at is null;
```

Der partielle Unique-Index garantiert **genau ein aktives Spiel pro Lobby** — heute ist das
nur implizit („was der Host zuletzt geschrieben hat").

Teams, Spymaster und Erzähler bleiben in `state` — das ist **öffentliche** Information und
braucht keine eigene Tabelle.

### 4.5 `player_secrets` — server-geschrieben, eigen-gelesen

```sql
create table public.player_secrets (
  game_id    uuid not null references public.games(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  payload    jsonb not null,
  created_at timestamptz not null default now(),
  primary key (game_id, user_id)
);
```

Der Server schreibt jedem Spieler seine **fertig projizierte Sicht** hinein:

| Spiel | `payload` des Spielers |
|---|---|
| Imposter | `{"role":"innocent","word":"Leuchtturm"}` bzw. `{"role":"imposter"}` |
| Werwolf | `{"role":"WERWOLF","packmates":[uid,…],"lover":uid}` — Erzähler: komplette Masterliste |
| Codenames | Spymaster: `{"key":[{"i":0,"color":"red"},…]}`; Ermittler: keine Zeile |
| Wer bin ich? | **invertiert**: `{"others":{uid:"Batman",…}}` — alles außer dem eigenen Wort |

Dass Codenames die Farbkarte in zwei Zeilen dupliziert, ist bewusst: dafür bleibt die
Policy ein einziges Prädikat.

**Auflösung am Spielende ohne Policy-Änderung:** die `end_*`-RPC kopiert die aufgelösten
Geheimnisse nach `games.state.reveal`. Die RLS auf `player_secrets` bleibt für immer
unverändert — keine zeitabhängigen Policies, kein „ab Phase X darf jeder".

**Nebeneffekt, der heute nicht möglich ist:** Rollen und Board werden per `random()` *in
der Datenbank* gewürfelt. Damit sieht auch der Host sein eigenes Spiel nicht mehr im
Voraus — die Analyse hält in §3.4 fest, dass das derzeit prinzipbedingt der Fall ist.

### 4.6 `round_submissions` — client-geschrieben, eigen-gelesen

Bewusst von `player_secrets` getrennt, weil die **Schreibrichtung umgekehrt** ist. Läge
beides in einer Tabelle, bräuchte der Client eine Insert-Policy — und könnte damit seine
eigene Imposter-Rolle überschreiben.

```sql
create table public.round_submissions (
  game_id      uuid not null references public.games(id) on delete cascade,
  round_no     integer not null,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  payload      jsonb not null,   -- SLF: {"Stadt":"Berlin",…} · WerBinIch: {"words":[…]}
  submitted_at timestamptz not null default now(),
  primary key (game_id, round_no, user_id)
);
```

Nutzung: Stadt-Land-Fluss-Antworten (geheim bis zur Review-Phase) und die Begriffseingabe
bei Wer bin ich. Beim Rundenende kopiert die RPC alles nach `games.state` — danach ist es
öffentlich, ohne dass eine Policy sich ändert.

### 4.7 `game_events` — öffentliche Aktionen, append-only

```sql
create table public.game_events (
  id         bigserial primary key,
  game_id    uuid not null references public.games(id) on delete cascade,
  round_no   integer not null,
  actor_id   uuid not null references public.profiles(id),
  kind       text not null,       -- 'vote','guess','clue','kill','heal','shot',…
  target_id  uuid references public.profiles(id),
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index game_events_one_vote_per_round
  on public.game_events (game_id, round_no, actor_id) where kind = 'vote';

create index game_events_game_round on public.game_events (game_id, round_no);
```

Der partielle Unique-Index macht Doppelabstimmung **strukturell** unmöglich — heute ist das
nur ein `disabled={hasVoted}` im Markup
([ImposterEngine.jsx:336](../src/games/ImposterEngine.jsx)). Dasselbe Muster deckt später
„ein Hinweis pro Zug" bei Codenames ab.

### 4.8 `heartbeat` — Keep-Alive gegen die 7-Tage-Pausierung

```sql
create table public.heartbeat (
  id        smallint primary key default 1 check (id = 1),
  pinged_at timestamptz not null default now(),
  source    text
);
insert into public.heartbeat (id) values (1);
```

Einzeilig. Ein Vercel-Cron ruft eine API-Route, die mit dem **Service-Role-Key**
serverseitig `update public.heartbeat set pinged_at = now()` ausführt.

> **Achtung:** Vercel Hobby erlaubt Cron nur **einmal täglich**. Für ein 7-Tage-Fenster
> reicht das mit großem Abstand. Der Service-Role-Key darf ausschließlich serverseitig
> stehen (Environment Variable ohne `VITE_`-Präfix), nie im Client-Bundle.

---

## 5. RLS-Policies

**Leitprinzip: Lesen über RLS, Schreiben ausschließlich über `SECURITY DEFINER`-RPCs.**
Bis auf `round_submissions` bekommt keine Tabelle eine Insert-/Update-/Delete-Policy. Genau
das ersetzt die heutige rein clientseitige Host-Autorität (`if (!isHost) return;`).

### 5.1 Hilfsfunktionen

`SECURITY DEFINER` ist hier nicht optional: eine Policy auf `lobby_members`, die selbst
`lobby_members` abfragt, würde sonst rekursiv in die eigene RLS laufen.

```sql
create or replace function public.is_lobby_member(p_lobby uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.lobby_members m
    where m.lobby_id = p_lobby and m.user_id = auth.uid() and m.left_at is null
  );
$$;

create or replace function public.is_game_member(p_game uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_lobby_member((select lobby_id from public.games where id = p_game));
$$;

create or replace function public.shares_lobby_with(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.lobby_members me
    join public.lobby_members other using (lobby_id)
    where me.user_id = auth.uid() and me.left_at is null
      and other.user_id = p_user and other.left_at is null
  );
$$;
```

### 5.2 Übersicht

| Tabelle | SELECT | Schreiben | Verhindert konkret |
|---|---|---|---|
| `profiles` | eigene Zeile **oder** `shares_lobby_with(id)` | nur Spalten-Grant auf `display_name`, `avatar_path` | Abzug der gesamten Nutzertabelle; Selbstvergabe von `username`/fremder Identität |
| `lobbies` | `is_lobby_member(id)` — **kein** öffentliches Lesen | keins (RPC) | Enumerieren fremder Lobby-Codes; Selbst-zum-Host-Machen; Beenden fremder Spiele |
| `lobby_members` | `is_lobby_member(lobby_id)` | keins (RPC) | Selbst-Beitritt unter Umgehung der Namensprüfung; Kicken durch Nicht-Hosts; **Setzen des eigenen `score`** |
| `games` | `is_game_member(id)` | keins (RPC) | Phasensprünge durch Nicht-Hosts; Manipulation von `phase_deadline` (Zeitbetrug bei SLF) |
| `player_secrets` | **`user_id = auth.uid()`** | keins, nie | Der eigentliche Punkt: Auslesen fremder Rollen/Wörter/Kartenfarben per DevTools — in Imposter, Werwolf, Codenames und Wer bin ich |
| `round_submissions` | `user_id = auth.uid()` | INSERT/UPDATE eigene Zeile, nur solange das Fenster offen ist | Abschreiben fremder SLF-Antworten vor der Auflösung; Nachreichen nach Ablauf der Deadline |
| `game_events` | `is_game_member(game_id)` | keins (RPC) | Abstimmen im Namen anderer; Mehrfachabstimmung (zusätzlich per Unique-Index) |
| `heartbeat` | **keine Policy** | **keine Policy** | Jeden Zugriff außer Service-Role; verhindert Spam durch anonyme Clients |

### 5.3 Die drei nicht-trivialen, ausformuliert

```sql
alter table public.player_secrets enable row level security;
revoke all on public.player_secrets from anon, authenticated;
grant select on public.player_secrets to authenticated;

create policy secrets_select_own on public.player_secrets
  for select to authenticated
  using (user_id = auth.uid());
-- Bewusst KEINE insert/update/delete-Policy: schreiben darf nur SECURITY DEFINER.
-- Auch der Host liest hier nichts Fremdes — sein Client ist ein Client wie jeder andere.
```

```sql
-- Einzige Tabelle mit Client-Schreibrecht (Entscheidung 6).
create or replace function public.submission_window_open(p_game uuid, p_round int)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.games g
    where g.id = p_game
      and g.round_no = p_round
      and g.ended_at is null
      and (g.phase_deadline is null or now() <= g.phase_deadline + interval '2 seconds')
  );
$$;

create policy rs_rw_own on public.round_submissions
  for all to authenticated
  using      (user_id = auth.uid())
  with check (user_id = auth.uid() and public.submission_window_open(game_id, round_no));
```

```sql
-- Spalten-Grants ergänzen RLS: RLS entscheidet über Zeilen, Grants über Spalten.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, avatar_path) on public.profiles to authenticated;

create policy profiles_select_visible on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.shares_lobby_with(id));
```

### 5.4 Beitritt ohne öffentliches Leserecht

Weil `lobbies` **kein** öffentliches SELECT hat, kann ein Beitritt nicht mehr per „Dokument
raten und lesen" laufen. Stattdessen erledigt eine RPC Nachschlagen, Prüfen und Einfügen
atomar:

```sql
create or replace function public.join_lobby(p_code text, p_display_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_lobby public.lobbies%rowtype;
begin
  select * into v_lobby from public.lobbies
   where code = upper(p_code) and closed_at is null
   for update;                                  -- serialisiert konkurrierende Beitritte
  if not found then raise exception 'LOBBY_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_lobby.status <> 'waiting' then raise exception 'GAME_IN_PROGRESS'; end if;

  -- Invariante one_active_per_user wahren: alte Lobby sauber verlassen
  -- (inkl. Host-Übergabe, falls der Aufrufer dort Host war).
  perform public.leave_current_lobby_internal(v_lobby.id);

  insert into public.lobby_members (lobby_id, user_id, display_name)
  values (v_lobby.id, auth.uid(), p_display_name)
  on conflict (lobby_id, user_id)
    do update set left_at = null, display_name = excluded.display_name;
  -- Namenskollision schlägt hier über lobby_members_name_unique fehl (23505)
  -- → sauberer Fehler statt des heutigen racy Vorab-Checks.

  update public.lobbies set last_activity_at = now() where id = v_lobby.id;
  return v_lobby.id;
end $$;
```

Das ist strikt besser als heute: in Firestore muss jeder authentifizierte Nutzer **jedes**
Lobby-Dokument lesen dürfen, damit Beitritt überhaupt funktioniert (Analyse §2.5).

### 5.5 Host-Übernahme (Entscheidung 5)

Presence lebt im Realtime-Server und ist für Postgres unsichtbar — eine RPC kann nicht
prüfen, ob der Host wirklich weg ist. Deshalb entscheidet der Mensch, die DB verhindert nur
Missbrauch:

```sql
create or replace function public.claim_host(p_lobby uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_lobby_member(p_lobby) then
    raise exception 'NOT_A_MEMBER';
  end if;

  update public.lobbies
     set host_id = auth.uid(),
         host_claimed_at = now(),
         last_activity_at = now()
   where id = p_lobby
     and host_id <> auth.uid()
     and now() - host_claimed_at > interval '30 seconds';   -- Anti-Grief-Cooldown

  if not found then raise exception 'CLAIM_TOO_SOON_OR_ALREADY_HOST'; end if;
end $$;
```

Der Client zeigt den Button erst, wenn Presence den aktuellen Host als offline meldet, und
fragt per Dialog nach („Der Partyleiter scheint weg zu sein. Übernehmen?"). Der Cooldown
verhindert, dass zwei Spieler sich den Host im Wechsel wegnehmen.

---

## 6. Realtime-Konfiguration

```sql
alter publication supabase_realtime add table public.lobbies;
alter publication supabase_realtime add table public.lobby_members;
alter publication supabase_realtime add table public.games;
alter publication supabase_realtime add table public.game_events;
```

**Bewusst nicht in der Publication:** `player_secrets`, `round_submissions`, `heartbeat`.
Geheimnisse werden nicht gestreamt, sondern nach jedem Phasenwechsel einmal gezielt
nachgeladen — ein Request pro Phase statt eines RLS-Checks pro Änderung und Abonnent.

### 6.1 Kanalaufteilung pro Lobby (`lobby:{code}`)

| Mechanismus | Verwendung |
|---|---|
| **Postgres Changes** | `lobbies` (Status/Spielwechsel/Hostwechsel), `lobby_members` (Beitritt/Verlassen/Punkte), `games` (Phase, `phase_deadline`, öffentlicher State), `game_events` (Live-Vote-Punkte) |
| **Presence** | Wer ist online → Ghost-Erkennung, „alle bereit"-Gates, Avatar-Ausgrauen, Sichtbarkeit des `claim_host`-Buttons. **Kein** Heartbeat-Feld in der DB. |
| **Broadcast** | Sofort-Feedback vor dem DB-Echo: `round_ended`, `player_choosing`, Aufdeck-Animationen, Erzähler-Hinweise bei Werwolf |

Ghost-Spieler-Logik: `lobby_members` liefert die Mitgliedschaft, Presence den
Online-Zustand. Gates wie `allReady`
([WerBinIchEngine.jsx:74](../src/games/WerBinIchEngine.jsx)) rechnen künftig gegen
**Mitglieder ∩ online** statt gegen alle je Beigetretenen.

### 6.2 Kanal-Autorisierung

Private Kanäle (Presence/Broadcast) werden über RLS auf `realtime.messages` abgesichert:
Nur wer Mitglied der Lobby mit dem Code aus dem Topic ist, darf den Kanal betreten.

> Die genaue API (`realtime.topic()`, Policy-Form auf `realtime.messages`) hat sich
> zwischen Supabase-Versionen mehrfach geändert — **vor der Implementierung gegen die
> aktuelle Doku verifizieren.** Fallback, falls die Autorisierung Probleme macht: Kanal
> öffentlich lassen und über Presence/Broadcast ausschließlich unkritische Daten schicken
> (der autoritative Zustand ist ohnehin durch die Tabellen-RLS geschützt).

### 6.3 Wartungsjobs (pg_cron)

```sql
-- 1) Verwaiste Lobbys schließen — ersetzt das heute komplett fehlende Cleanup
select cron.schedule('close-stale-lobbies', '*/15 * * * *', $$
  update public.lobbies
     set closed_at = now()
   where closed_at is null
     and last_activity_at < now() - interval '6 hours';
$$);

-- 2) Retention: Partien und Ereignisse nach 90 Tagen löschen (Entscheidung 10)
select cron.schedule('purge-old-games', '17 3 * * *', $$
  delete from public.games
   where (ended_at is not null and ended_at   < now() - interval '90 days')
      or (ended_at is null     and started_at < now() - interval '90 days');
$$);
```

Job 2 genügt für beides: `game_events`, `player_secrets` und `round_submissions` hängen per
`on delete cascade` an `games` und verschwinden mit. Der zweite Zweig fängt Partien ab, die
nie sauber beendet wurden (Abbruch, Verbindungsverlust).

> **Spannung zur zurückgestellten Bestenliste (Entscheidung 7):** Wer später Statistiken
> über alle Partien will, muss **vor** dem Löschen aggregieren. Wird die Bestenliste
> konkret, ist eine schmale `player_stats`-Tabelle einzuführen, die der Purge-Job nicht
> anfasst.

---

## 7. Reconnect nach Reload

Nach einem Seiten-Reload findet der Client seine aktive Lobby mit **einer** Abfrage:

```sql
select l.id, l.code, l.status, l.current_game, l.host_id,
       m.display_name, m.score
  from public.lobby_members m
  join public.lobbies l on l.id = m.lobby_id
 where m.user_id  = auth.uid()
   and m.left_at  is null
   and l.closed_at is null
 limit 1;
```

Wichtig für die Implementierung:

- **Es braucht dafür keine zusätzliche Policy.** `lobby_members` ist über
  `is_lobby_member(lobby_id)` für eigene Zeilen sichtbar, `lobbies` über
  `is_lobby_member(id)` — beide greifen bereits.
- **Der Zeiger `users/{uid}.currentLobby` entfällt ersatzlos.** Heute ist er ein
  denormalisiertes Feld, das auf jedem Ausstiegspfad genullt werden muss
  ([useLobby.js:28,45,53,193](../src/hooks/useLobby.js)) und trotzdem veralten kann. Neu
  wird die Zugehörigkeit aus der Mitgliedschaft selbst abgeleitet — die einzige Quelle der
  Wahrheit.
- **`limit 1` ist sicher**, weil `lobby_members_one_active_per_user` (§4.3) garantiert, dass
  es höchstens eine aktive Mitgliedschaft gibt.
- Die anonyme Supabase-Session überlebt den Reload im `localStorage`, die uid bleibt also
  stabil — genau wie heute bei Firebase Anonymous Auth.
- Direkt nach dem Reconnect: Uhren-Offset neu messen (§3.1), Presence-Kanal betreten,
  eigenes `player_secrets`-Payload einmal nachladen.

---

## 8. Storage: Avatare

```sql
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true);

create policy "avatar write own folder" on storage.objects
  for all to authenticated
  using      (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
```

Pfad `{user_id}/avatar.webp`, öffentlicher Bucket (Avatare sind für Mitspieler ohnehin
sichtbar), Schreibrecht nur im eigenen Ordner. `profiles.avatar_path` speichert den Pfad,
der Client baut die URL. Client-seitig weiter auf 256 px verkleinern wie heute
([ProfileModal.jsx:17-33](../src/components/auth/ProfileModal.jsx)), aber als WebP-Blob
hochladen statt als data-URI in die Zeile zu schreiben.

**Damit verschwindet der größte Payload-Treiber:** heute wandern bei jedem Snapshot alle
Avatare aller Spieler erneut über die Leitung — bei 8 Spielern schnell 150–250 KB pro
Änderung. Zugleich einer der spürbarsten Latenzgewinne der ganzen Migration.

Bestehende base64-Bilder werden nicht migriert (Entscheidung 8); der eine echte Account
lädt einmal neu hoch. Der fehlende `/default-avatar.png` (Analyse §4.3) wird bei der
Gelegenheit durch den Initialen-Fallback ersetzt, den
[LobbyWaitingScreen.jsx:55](../src/components/lobby/LobbyWaitingScreen.jsx) bereits korrekt
implementiert.

---

## 9. Auth-Mapping

| Heute (Firebase) | Neu (Supabase) |
|---|---|
| `signInAnonymously()` | `supabase.auth.signInAnonymously()` — echter `auth.users`-Datensatz |
| `linkWithCredential(user, EmailAuthProvider…)` | `supabase.auth.updateUser({ email, password })` — **dieselbe uid**, Mitgliedschaften und Punkte bleiben erhalten |
| `<name>@partybox.local` | echte E-Mail; `profiles.username` bleibt als eindeutiger Handle |
| `signInWithEmailAndPassword` | `signInWithPassword({ email, password })` |
| Kein Passwort-Reset möglich | `resetPasswordForEmail()` |

`useAuth.js:51-53` (`formatUsernameToEmail`) entfällt ersatzlos.

Das Login-Formular wechselt von „Benutzername" auf „E-Mail"; `username` bleibt
Anzeige-Handle. Der Registrierungs-Bug in [useAuth.js:59](../src/hooks/useAuth.js) (Body
komplett in `if (user.isAnonymous)`, sonst passiert stillschweigend nichts) wird dabei mit
erledigt.

**Bestandsaccounts:** Die `users`-Collection enthält ~70 Einträge, davon genau **einen**
echten Account — der Rest sind wiederholt erzeugte anonyme Gast-Sessions ohne Bestand. Es
gibt daher keinen Migrationsaufwand; der eine Account wird neu angelegt.

---

## 10. Phasenplan

Jede Phase ist eigenständig lauffähig und deploybar. Die **Firestore-Version bleibt während
der gesamten Migration unter einer zweiten URL erreichbar** (Entscheidung 11) — nicht nur
bis zum initialen Umschalten, sondern als Rückfallebene für jeden Spieleabend, an dem eine
frische Phase Probleme macht. Erst Phase 6 baut sie ab.

### Phase 0 — Fundament (kein Spiel)

**Liefert:** Supabase-Projekt (eu-central-1), Auth (anonym + E-Mail-Upgrade), `profiles` +
Trigger, `lobbies`, `lobby_members`, RPCs `create_lobby` / `join_lobby` / `leave_lobby` /
`kick_member` / `promote_host` / `claim_host`, Presence auf `lobby:{code}`, Reconnect-Pfad
(§7), Storage-Bucket, `heartbeat` + Vercel-Cron, beide `pg_cron`-Jobs, Kanal-Autorisierung,
Uhren-Offset-Helper.

Noch nicht migrierte Spiele laufen weiter mit clientseitiger Logik — ihr bisheriger
`gameState` wandert 1:1 als jsonb nach `games.state`. Sie funktionieren wie vorher, nur auf
Supabase statt Firestore.

**Abhängigkeit:** keine. Blockiert alles Weitere.

**Fertig, wenn:** Lobby erstellen/beitreten/verlassen/kicken läuft, ein Reload landet wieder
in der richtigen Lobby, Presence graut Offline-Spieler aus, `claim_host` funktioniert
inklusive Cooldown, ein Avatar-Upload landet in Storage, der Cron-Ping schreibt.

> **Quick Win, den man vorziehen sollte:** Das Deadline-/Uhren-Offset-Verfahren entsteht
> hier bereits. Es lässt sich sofort auf das noch nicht migrierte Stadt Land Fluss
> anwenden — die Timer-Fairness, die am wichtigsten ist, muss also **nicht** bis Phase 5
> warten.

### Phase 1 — Imposter (Pilot)

**Liefert:** `games`, `player_secrets`, `game_events`; RPCs `start_imposter`, `cast_vote`,
`end_imposter`. Wortwahl und Imposter-Auslosung per `random()` in der DB.

**Warum zuerst:** einfachstes Geheimnismodell (ein Wort, eine Rolle, keine Zustandsänderung
über die Zeit). Diese Phase etabliert das Muster, das alle folgenden Spiele kopieren:
Projektion schreiben → Phase per RPC schalten → am Ende nach `state.reveal` auflösen.

**Abhängigkeit:** Phase 0.

**Fertig, wenn:** ein zweiter Spieler mit offener Konsole das Imposter-Wort **nicht**
auslesen kann und zweimaliges Abstimmen an der DB scheitert.

### Phase 2 — Werwolf

**Neu gegenüber Phase 1:** *veränderliche* Geheimnisse über die Zeit (lebendig/tot,
Hexentränke) und **rollenabhängige Projektionen** (Wolfsrudel, Liebespaar,
Erzähler-Masterliste — letztere per Spielregel vollständig, Entscheidung 9).

RPCs: `start_werwolf`, `narrator_action` (töten/heilen/vergiften/verlieben), `hunter_shot`,
`toggle_day_night`, `end_werwolf` inklusive Siegbedingung serverseitig.

Nebeneffekt: die flache Kopie in [WerwolfEngine.jsx:283](../src/games/WerwolfEngine.jsx)
und ihr Gegenstück fallen weg, weil der Zustand nicht mehr im Client umgebaut wird.

**Abhängigkeit:** Phase 1 (Secret-Muster). Größte Einzelphase — 764 Zeilen Engine.

### Phase 3 — Codenames

**Neu:** **team-bezogene** Projektion (beide Spymaster bekommen dieselbe Farbkarte in ihre
eigene Zeile) und eine Zug-Zustandsmaschine mit „ein Hinweis pro Zug" als Unique-Index.

Board-Generierung (9/8/7/1) wandert in die RPC — damit sieht auch der Host die Karte nicht
mehr vorab.

**Abhängigkeit:** Phase 1.

### Phase 4 — Wer bin ich?

**Neu:** der **invertierte** Fall (ich sehe alle außer mir) und `round_submissions` — hier
schreiben ausnahmsweise die Spieler selbst (Begriffseingabe), die Verteilung macht der
Server.

Der TARGETED-Modus (jeder schreibt für eine bestimmte Person) wird zur Server-Zuweisung
statt zur Host-lokalen Shuffle-Logik.

**Abhängigkeit:** Phase 1; führt `round_submissions` ein, das Phase 5 wiederverwendet.

### Phase 5 — Stadt Land Fluss

**Neu:** serverseitige Deadlines im Produktiveinsatz, mehrrundiger Ablauf, Mehrheitsvoting
(reject/duplicate) und die Punkteberechnung (`calculateDynamicScores`) als RPC.

RPCs: `start_slf_round`, `end_slf_round` (atomarer Snapshot statt 2,5-Sekunden-Warten),
`toggle_slf_vote`, `finish_slf`.

**Warum zuletzt:** braucht die meisten neuen Primitive (Deadline, Submissions, Voting,
Scoring) — und profitiert am stärksten davon, dass sie in Phase 0/4 bereits im echten
Betrieb erprobt wurden.

**Abhängigkeit:** Phase 0 (Uhrensync) **und** Phase 4 (`round_submissions`).

### Phase 6 — Abbau

Parallele Firestore-URL abschalten, Firebase-Projekt archivieren, `firebase` aus
`package.json`, `src/utils/firebase.js` löschen, `.env` aus Git entfernen und in
`.gitignore` aufnehmen, toten Code (`src/App.css`, `src/assets/*`) löschen, README ersetzen.

---

## 11. Die 5 riskantesten Entscheidungen

| # | Entscheidung | Risiko | Umgang |
|---|---|---|---|
| 1 | **Spiellogik in PL/pgSQL** | Latenzoptimal, aber die gesamte Spiellogik landet in einer Sprache ohne Test-Setup und mit schlechterem Debugging. Bei Werwolf (764 Zeilen) die anstrengendste Umstellung. | Phase 1 (Imposter) bewusst als Probe behandeln. Fühlt es sich schlecht an, ist der Wechsel auf Edge Functions ab Phase 2 noch billig — das Schema bleibt unverändert. |
| 2 | **Broadcast + Postgres Changes parallel** | Zwei Wege für dieselbe Information: der optische Reiz kann vor der Wahrheit eintreffen oder ganz ausbleiben. Falsch gebaut sieht man Flackern oder inkonsistente Bildschirme. | Regel festschreiben: Broadcast darf **nie** den Zustand setzen, nur eine Übergangsanimation auslösen. Der DB-Event ist immer die Wahrheit. In Phase 1 an genau einem Ereignis erproben. |
| 3 | **Realtime-Kanal-Autorisierung** | Die RLS auf `realtime.messages` ist der Teil des Supabase-Stacks, der sich zuletzt am häufigsten geändert hat. Lässt sich Presence nicht sauber autorisieren, wackelt das gesamte Ghost-Spieler-Konzept. | Früh in Phase 0 prototypisch gegen die aktuelle Doku prüfen. Fallback dokumentiert (§6.2). |
| 4 | **Dauerhaft parallel erreichbare Firestore-Version** | Die Rückfallebene schafft ihr eigenes Problem: Spielen zwei Leute versehentlich auf unterschiedlichen URLs, gibt es zwei Wahrheiten und keine Zusammenführung. Bei längerer Doppelnutzung driften die Datenbestände auseinander. | Die alte URL nicht verlinken und nicht teilen — sie existiert nur als bewusst gezogener Notnagel. Klare Ansage in der Gruppe, welche URL „die echte" ist. Nach jedem Fallback-Abend prüfen, ob Zustand nachgezogen werden muss. |
| 5 | **`round_submissions` als einzige Client-Schreib-Policy** | Der bewusst akzeptierte Trade-off (Entscheidung 6): Hier ist der Client die einzige Stelle im Design, der geschrieben werden darf. Die Deadline-Prüfung in `submission_window_open` ist die *einzige* Schranke — ein Fehler darin erlaubt Nachreichen nach Rundenende. | Genau diese Policy in Phase 4 explizit testen (Insert nach Ablauf muss scheitern), bevor Phase 5 sie unter Zeitdruck nutzt. Bei Zweifeln ist die Rückkehr auf eine RPC ein kleiner, lokaler Eingriff. |

---

## 12. Verifikation

**Beim Review (jetzt):**
- Das Schema deckt alle 5 Spiele ab — gegen die `gameState`-Beschreibungen in
  [codebase-overview.md §2.2](codebase-overview.md) gegengelesen.
- Die 5 Risiken in §11 sind akzeptiert oder anders entschieden.

**Bei der Implementierung (ab Phase 0):**

- **RLS-Test in `psql`**, ohne laufende App, durch Simulieren des JWT-Kontexts:
  ```sql
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"<uid-spieler-b>"}';
  select count(*) from player_secrets where game_id = '<game>';  -- muss 1 sein, nicht n
  select count(*) from lobbies where code = '<fremder-code>';    -- muss 0 sein
  ```
- **Race-Test:** zwei parallele `join_lobby`-Aufrufe mit demselben Displaynamen — genau
  einer muss mit `23505` scheitern.
- **Deadline-Test:** `round_submissions`-Insert nach `phase_deadline + 3s` muss von der
  Policy abgelehnt werden (Risiko 5).
- **Reconnect-Test:** Reload mitten im Spiel landet wieder in derselben Lobby und Phase;
  `lobby_members_one_active_per_user` verhindert eine zweite aktive Mitgliedschaft.
- **`claim_host`-Test:** zweiter Aufruf innerhalb von 30 Sekunden muss scheitern.
- **Retention-Test:** `purge-old-games` mit künstlich zurückdatiertem `ended_at` — die
  zugehörigen `game_events` müssen per Cascade mitverschwinden.
- **Latenz-Messung in Phase 1:** Zeit von Klick bis zur Zustandsänderung auf einem
  **zweiten** Gerät, einmal über Broadcast und einmal über Postgres Changes. Das Ergebnis
  entscheidet, wie aggressiv Broadcast in Phase 2–5 eingesetzt wird.

---

## 13. Aktueller Stand

Planung abgeschlossen, alle offenen Fragen entschieden (§2). **Phase 0 steht noch aus** —
es existiert kein Supabase-Projekt, keine Migration und kein Anwendungscode.
