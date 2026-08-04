# Supabase — Phase 0 (Infrastruktur, a + b + c)

Migrationen, RPCs und Wartungsjobs für das Fundament der Supabase-Migration.
Design und Begründungen: [../docs/supabase-migration-plan.md](../docs/supabase-migration-plan.md).

**Status: deployt und vollständig verifiziert.** Projekt `PartyBox`
(`wlgvwpkqtiymlpctgufb`, `eu-central-1`), sieben Migrationen angewendet.
Datenbank nach jeder Verifikation wieder im Ausgangszustand — kein
Testrückstand außer den bewusst permanenten Fixtures (Sentinel-Account,
s. u.).

| Verifikation | Ergebnis |
|---|---|
| `scripts/verify-phase0a.sql` (SQL, 16 Prüfungen) | ✅ alle bestanden |
| `scripts/verify-phase0a.mjs` (echter HTTP/RPC-Pfad, 21 Prüfungen inkl. echtem Parallel-Race) | ✅ alle bestanden |
| `scripts/verify-purge-anonymous-users.sql` (echter DELETE-Pfad, 6 Fälle + 2 Regressionschecks) | ✅ alle bestanden, inkl. Sentinel-Fix |
| `scripts/verify-sentinel-profile-visibility.sql` (RLS auf `profiles`, 4 Prüfungen) | ✅ alle bestanden |
| `scripts/verify-phase0b-bridge.sql` (Patch-Formen aller fünf Engines, 11 Prüfungen) | ✅ alle bestanden |
| `scripts/verify-phase0b.mjs` (zwei echte Clients, 30 Prüfungen) | ✅ alle bestanden |
| `scripts/verify-phase0c.sql` (Identität, Freunde, Status, Einladungen, 16 Prüfungen) | ✅ alle bestanden |
| `scripts/verify-phase0c.mjs` (zwei echte Clients, 30 Prüfungen inkl. 90-s-Ablauf) | ✅ alle bestanden |

Ausführung siehe „Verifizieren" unten.

## Migrationen

| Datei | Inhalt |
|---|---|
| `20260730120000_init_schema.sql` | Extensions, Enums, 8 Tabellen, Indizes, RLS-Aktivierung |
| `20260730120100_functions_and_rls.sql` | Trigger, RLS-Hilfspredikate, 7 RPCs, Grants, Policies |
| `20260730120200_realtime_storage_cron.sql` | Realtime-Publication, Storage-Bucket, 3 pg_cron-Jobs |
| `20260730213000_sentinel_host_reassignment.sql` | Sentinel-Account „Ehemaliger Host" + Fix für `purge_stale_anonymous_users()`, s. u. |
| `20260730214500_profiles_sentinel_visible.sql` | Zusätzliche SELECT-Policy: Sentinel-Profil für alle authentifizierten Nutzer lesbar, s. u. |
| `20260730220000_phase0b_legacy_bridge.sql` | **TRANSITIONAL**: `lobbies.legacy_state`, `server_now()`, `legacy_apply_patch()` — fällt mit der ersten Spiele-Phase weg |
| `20260731090000_phase0c_identity_and_friends.sql` | Benutzername + `discriminator`, Längengrenze 20, `friendships`, `user_status`, `lobby_invites` und ihre RPCs |
| `20260804133000_lobby_invites_24h_expiry.sql` | Einladungs-Ablauf 2 → 24 Stunden: `list_my_invites()`-Filter + `purge-old-invites`-Intervall |
| `20260805090000_game_key_sprueche_klopfer.sql` | Enum-Wert `sprueche_klopfer` für `lobbies.current_game` — bewusst allein in einer eigenen Datei, s. u. |
| `20260805090100_legacy_patch_sprueche_klopfer.sql` | `legacy_apply_patch()` mappt `'SPRUECHE_KLOPFER'` auf den neuen Enum-Wert |

## RPCs

| Funktion | Wer darf | Zweck |
|---|---|---|
| `create_lobby(p_display_name)` | jeder authentifizierte Nutzer | Legt Lobby + Mitgliedschaft an, Aufrufer wird Host. Verlässt vorher die alte Lobby. Gibt `{lobby_id, code}` zurück. |
| `join_lobby(p_code, p_display_name)` | jeder authentifizierte Nutzer | Atomar: nachschlagen, prüfen, beitreten. Namenskollision → `23505`. |
| `leave_lobby(p_lobby)` | aktives Mitglied | Verlässt gezielt. Host → automatische Übernahme durch frühesten Beitritt; letzter Spieler → `closed_at`. |
| `kick_member(p_lobby, p_target_user)` | nur Host | Setzt `left_at`. Selbst-Kick verboten. |
| `promote_host(p_lobby, p_target_user)` | nur Host | Überträgt `host_id`, setzt `host_claimed_at`. |
| `claim_host(p_lobby)` | jedes aktive Mitglied | **Nur für den stillen Disconnect.** 30-Sekunden-Cooldown gegen Griefing. |
| `leave_current_lobby_internal(p_except_lobby)` | niemand (intern) | Von `create_lobby`/`join_lobby` genutzt. |

### Identität, Freunde, Einladungen (Phase 0c)

| Funktion | Wer darf | Zweck |
|---|---|---|
| `set_username(p_username)` | jeder authentifizierte Nutzer | Setzt/ändert den Benutzernamen (3–20, `[A-Za-z0-9_]`) und **würfelt den vierstelligen Code neu**. |
| `find_profile_by_handle(p_username, p_discriminator)` | jeder authentifizierte Nutzer | Exakter Treffer auf Name **und** Code. Kein Präfix, kein `like` — sonst wäre die Nutzertabelle durchprobierbar. |
| `send_friend_request(p_username, p_discriminator)` | Nutzer mit eigenem Benutzernamen | Legt `pending` an; existiert die Gegenanfrage, wird daraus `accepted`. |
| `respond_friend_request(p_other, p_accept)` | nur der **Empfänger** | Annehmen oder ablehnen (löscht die Zeile). |
| `remove_friend(p_other)` | beide Seiten | Löscht das Paar — auch zum Zurückziehen einer eigenen Anfrage. |
| `list_friends()` | jeder authentifizierte Nutzer | Freunde und offene Anfragen mit `online` / `in_lobby` / `last_seen_at`. **Gibt keinen Lobby-Code heraus**; bei offenen Anfragen bleibt der Status verborgen. |
| `touch_presence(p_lobby)` | jeder authentifizierte Nutzer | Herzschlag alle 45 s. `p_lobby` wird nur übernommen, wenn der Aufrufer dort aktives Mitglied ist. |
| `invite_friend_to_lobby(p_lobby, p_to_user)` | aktives Mitglied **und** bestätigter Freund | Legt eine Einladung an. |
| `list_my_invites()` | Empfänger | Offene Einladungen **inklusive Lobby-Code**, jünger als 24 h — hier angebracht, man wurde ausdrücklich eingeladen. |
| `decline_invite(p_invite)` | Empfänger | Löscht die Einladung. `join_lobby` räumt sie beim Beitritt selbst ab. |

`friendships` nutzt das kanonisch geordnete Paar (`user_low < user_high`) als
Primärschlüssel — der **strukturelle** Schutz gegen Doppel- und
Gegenrichtungs-Einträge, dieselbe Denkweise wie die Teil-Unique-Indizes aus
Phase 0a. `user_status` hat bewusst **kein** SELECT-Grant: der Online-Status
ist ausschließlich über `list_friends()` sichtbar, also nur für bestätigte
Freunde. Er liegt aus einem konkreten Grund nicht auf `profiles`: der Trigger
`profiles_set_updated_at` würde `updated_at` mitziehen, und daraus baut der
Client den Cache-Buster der Avatar-URL — jedes Profilbild würde alle
45 Sekunden neu geladen.

Fehler sind stabile `UPPER_SNAKE`-Tokens in der Message:
`NOT_AUTHENTICATED`, `NOT_A_MEMBER`, `NOT_HOST`, `LOBBY_NOT_FOUND`,
`GAME_IN_PROGRESS`, `DISPLAY_NAME_REQUIRED`, `DISPLAY_NAME_TOO_LONG`,
`CANNOT_KICK_SELF`, `TARGET_NOT_ACTIVE_MEMBER`,
`CLAIM_TOO_SOON_OR_ALREADY_HOST`, `CODE_GENERATION_FAILED`,
`USERNAME_INVALID`, `USERNAME_TAKEN`, `PROFILE_NOT_FOUND`, `NO_USERNAME`,
`USER_NOT_FOUND`, `CANNOT_FRIEND_SELF`, `ALREADY_FRIENDS`, `REQUEST_PENDING`,
`REQUEST_NOT_FOUND`, `NOT_THE_RECIPIENT`, `NOT_FRIENDS`, `ALREADY_INVITED`,
`ALREADY_IN_LOBBY`.

## Wartungsjobs (pg_cron)

| Job | Takt | Wirkung |
|---|---|---|
| `close-stale-lobbies` | alle 15 min | `closed_at` für Lobbys ohne Aktivität seit **24 h** |
| `purge-old-games` | täglich 03:17 | Löscht Partien älter als 90 Tage (Cascade auf Events/Secrets) |
| `purge-stale-anonymous-users` | täglich 03:43 | Löscht anonyme Accounts > 30 Tage ohne aktive Mitgliedschaft — verwaiste Host-Lobbys werden vorher auf den Sentinel umgehängt, siehe unten |
| `purge-old-invites` | stündlich :07 | Löscht Lobby-Einladungen älter als 24 Stunden |

### Warum der Enum-Wert eine eigene Migrationsdatei bekommt

Postgres erlaubt seit Version 12 zwar `alter type … add value` innerhalb
einer Transaktion, der neue Wert darf darin aber noch nicht **benutzt**
werden. Da der CLI jede Migrationsdatei in einer eigenen Transaktion fährt,
ist die Reihenfolge damit garantiert: erst committen, dann in
`legacy_apply_patch()` referenzieren. Beides in einer Datei würde je nach
Planer-Zeitpunkt mit „unsafe use of new value of enum type" scheitern.

Dasselbe Muster gilt für jedes weitere neue Spiel.

## Deployen (bei künftigen Migrationen)

Der CLI-Login braucht ein TTY und muss deshalb aus einem echten Terminal laufen,
nicht aus dem Agent heraus — genauso wie beim ersten Mal:

```bash
npx supabase login
```

```bash
npx supabase link --project-ref <projekt-ref>
```

```bash
npx supabase db push
```

## Verifizieren

Kein Docker und kein `psql` nötig — beide Skripte laufen über den
Supabase-eigenen Weg. **Wichtig:** `supabase db query -f` (Management-API)
gibt nur das *letzte* Statement mit Zeilenergebnis zurück und unterdrückt
`RAISE NOTICE` komplett — ein einfaches „lief durch, sah kurz vor Schluss
ok aus" reicht nicht als Nachweis. Deshalb sammelt `verify-phase0a.sql`
jede bestandene Prüfung in einer temporären Tabelle und gibt sie als
allerletztes Statement aus; erwartet werden 16 lückenlose Zeilen `01`–`13`
(`10a`–`10d` als Teilschritte).

```bash
npx supabase db query --linked -f scripts/verify-phase0a.sql
```

```bash
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<anon-key> \
  node scripts/verify-phase0a.mjs
```

Der zweite Test fährt den kompletten Lobby-Lebenszyklus über den echten
HTTP/RPC-Pfad (inkl. eines echten parallelen `join_lobby`-Race, nicht nur
simuliert) und legt dafür drei anonyme Test-Nutzer an. Diese werden am Ende
nicht automatisch gelöscht — entweder manuell aufräumen oder den
30-Tage-Cron `purge-stale-anonymous-users` übernehmen lassen.

Vorher im Dashboard: **Authentication → Sign In / Providers → Anonymous** aktivieren.

```bash
npx supabase db query --linked -f scripts/verify-purge-anonymous-users.sql
```

Läuft komplett in einer Transaktion mit `ROLLBACK` am Ende — anders als der
Node-E2E-Test bleibt hier nichts zum manuellen Aufräumen übrig, auch wenn
die Funktion echte `DELETE`s ausführt (siehe Ergebnistabelle im Skript).

```bash
npx supabase db query --linked -f scripts/verify-sentinel-profile-visibility.sql
```

Ebenfalls in einer Transaktion mit `ROLLBACK`, kein manuelles Aufräumen.

### `purge-stale-anonymous-users`: Sentinel-Mechanismus

Der Job löscht `auth.users`-Zeilen. `lobbies.host_id` ist `on delete
cascade` — ohne Gegenmaßnahme würde eine geschlossene Lobby beim Löschen
ihres letzten (anonymen) Hosts stillschweigend mitverschwinden (kein
`SET NULL`, da die Spalte `NOT NULL` ist; keine FK-Verletzung — genau die
stille Variante, die man am wenigsten will).

**Fix:** ein permanenter, nicht-anonymer Sentinel-Account. Der UUID-Wert
ist an genau einer Stelle definiert —
[`sentinel_host_profile_id()`](migrations/20260730213000_sentinel_host_reassignment.sql)
in `20260730213000_sentinel_host_reassignment.sql`, aktuell
`deaddead-0000-4000-8000-000000000001` mit Profil-`display_name`
„Ehemaliger Host". `purge_stale_anonymous_users()` hängt vor jedem `DELETE`
alle betroffenen `lobbies.host_id` in einem einzigen `UPDATE` auf diesen
Sentinel um; sonst ändert sich an der Lobby nichts. Weil der Sentinel
`is_anonymous = false` ist, greift der bestehende „nur anonyme User"-Filter
des Jobs automatisch — der Sentinel kann sich selbst nie in die
Kandidatenmenge verirren, ohne dass es dafür eine eigene Ausschlussklausel
braucht. Niemand kann sich als dieser Account anmelden (kein Passwort,
keine E-Mail-Anmeldung, kein Client-Flow erzeugt oder verwendet ihn).

Mit `scripts/verify-purge-anonymous-users.sql` gegen sechs synthetische
Fälle plus zwei Regressionschecks getestet (echte `DELETE`s in einer
Transaktion mit `ROLLBACK`, nicht nur der Trockenlauf):

| Fall | Zustand | Ergebnis |
|---|---|---|
| 1 | nie in einer Lobby, 35 Tage | gelöscht |
| 2 | alte verlassene Mitgliedschaft, 35 Tage | gelöscht, inkl. der verwaisten `lobby_members`-Zeile |
| 3 | Host einer geschlossenen Lobby, selbst verlassen, 35 Tage | Nutzer gelöscht, **Lobby bleibt bestehen**, `host_id` zeigt auf den Sentinel, sonst nichts verändert |
| 4 | aktives Mitglied einer offenen Lobby, 35 Tage | unberührt (kritischster Fall), `host_id` unverändert |
| 5 | 10 Tage alt | unberührt (zu jung) |
| 6 | registriert, 400 Tage, inaktiv | unberührt (nie anonym) |
| Regression | Lobbys von nicht gelöschten Hosts (Fall 2/4) | `host_id` bleibt unverändert, nicht fälschlich auf den Sentinel umgehängt |
| Regression | Sentinel-Account selbst | vom Lauf unberührt |

### Sentinel-Profil lesbar für alle authentifizierten Nutzer

Ursprünglich war das ein offener Punkt: `profiles_select_visible` erlaubt
nur die eigene Zeile oder Mitglieder derselben aktiven Lobby — der Sentinel
ist nie Mitglied einer Lobby, `shares_lobby_with()` greift für ihn also
nie. Eine geschlossene Lobby mit Sentinel-Host wäre für Spieler nicht
auflösbar gewesen (Lobby sichtbar, aber `host_id` zeigt auf ein Profil, das
niemand lesen darf).

**Fix** (`20260730214500_profiles_sentinel_visible.sql`): eine zweite,
permissive SELECT-Policy `profiles_select_sentinel` ausschließlich für
`id = sentinel_host_profile_id()`, unabhängig von `shares_lobby_with`.
Mehrere permissive Policies für denselben Befehl werden von Postgres-RLS
per OR verknüpft — `profiles_select_visible` bleibt unverändert, diese
Policy erweitert die sichtbare Menge um genau eine Zeile. Kein
Datenschutzproblem: der Sentinel enthält keine echten Personendaten (kein
Avatar, kein Username, `display_name` ist das statische Label „Ehemaliger
Host").

Ein Nebeneffekt beim Umsetzen: `sentinel_host_profile_id()` wurde bislang
nur innerhalb von `SECURITY DEFINER`-Funktionen aufgerufen (wo Privilegien
über den Funktionsbesitzer laufen); jetzt wird sie auch direkt im
RLS-Kontext gewöhnlicher `authenticated`-Queries ausgewertet. Die vorherige
Migration hatte `EXECUTE` dafür bewusst von `authenticated` entzogen — ohne
ein gezieltes erneutes `GRANT` hätte jede `SELECT`-Abfrage auf `profiles`
mit „permission denied for function" fehlgeschlagen, sobald diese Policy
ausgewertet wird.

Mit `scripts/verify-sentinel-profile-visibility.sql` getestet: ein frischer
Testnutzer, der nie mit dem Sentinel in einer Lobby war, liest
`select * from profiles where id = sentinel_host_profile_id()` erfolgreich
(genau die im Auftrag vorgegebene Abfrage). Zwei Gegenproben bestanden
zusätzlich: derselbe Nutzer sieht weiterhin seine eigene Zeile
(`profiles_select_visible` unverändert), und er sieht **nicht** das Profil
eines unbeteiligten dritten Testnutzers — die neue Policy öffnet also
nicht versehentlich alle Profile, nur die eine Sentinel-Zeile.

## Vercel Keep-Alive

`../api/keep-alive.js` + `../vercel.json` (täglich 04:00). Benötigte
Environment-Variablen im Vercel-Dashboard, Scope *Production*, **ohne**
`VITE_`-Präfix: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, optional
`CRON_SECRET`. Vorlage: [../.env.example](../.env.example).
