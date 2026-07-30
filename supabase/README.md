# Supabase — Phase 0a (Infrastruktur)

Migrationen, RPCs und Wartungsjobs für das Fundament der Supabase-Migration.
Design und Begründungen: [../docs/supabase-migration-plan.md](../docs/supabase-migration-plan.md).

**Status: deployt und vollständig verifiziert.** Projekt `PartyBox`
(`wlgvwpkqtiymlpctgufb`, `eu-central-1`), alle drei Migrationen angewendet.
Datenbank nach der Verifikation wieder leer (0 Zeilen in allen Tabellen) —
kein Testrückstand.

| Verifikation | Ergebnis |
|---|---|
| `scripts/verify-phase0a.sql` (SQL, 16 Prüfungen) | ✅ alle bestanden |
| `scripts/verify-phase0a.mjs` (echter HTTP/RPC-Pfad, 21 Prüfungen inkl. echtem Parallel-Race) | ✅ alle bestanden |
| `scripts/verify-purge-anonymous-users.sql` (echter DELETE-Pfad, 6 synthetische Fälle) | ✅ alle wie erwartet — **mit einem Befund**, siehe unten |

Ausführung siehe „Verifizieren" unten.

**Befund `purge-stale-anonymous-users`:** Der DELETE-Pfad wurde mit echten,
zurückdatierten Testdaten gefahren (nicht nur der Trockenlauf). Löschen des
Hosts kaskadiert über `lobbies.host_id ... on delete cascade` **auf die
Lobby selbst** — keine `FK-Verletzung`, kein `SET NULL` (das Feld ist
`NOT NULL`, ein `SET NULL` wäre dort ohnehin nie möglich gewesen). Eine
bereits geschlossene Lobby verschwindet also stillschweigend mit, wenn ihr
letzter Host 30+ Tage inaktiv war. Für abgeschlossene Lobbys folgenlos
(sie sind ohnehin nur noch Datenleiche), aber es ist die stille Variante,
vor der im ursprünglichen Auftrag ausdrücklich gewarnt wurde. Nicht
behoben, nur protokolliert — Details im Testskript-Kopf und im
Git-Log dieses Commits.

## Migrationen

| Datei | Inhalt |
|---|---|
| `20260730120000_init_schema.sql` | Extensions, Enums, 8 Tabellen, Indizes, RLS-Aktivierung |
| `20260730120100_functions_and_rls.sql` | Trigger, RLS-Hilfspredikate, 7 RPCs, Grants, Policies |
| `20260730120200_realtime_storage_cron.sql` | Realtime-Publication, Storage-Bucket, 3 pg_cron-Jobs |

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

Fehler sind stabile `UPPER_SNAKE`-Tokens in der Message:
`NOT_AUTHENTICATED`, `NOT_A_MEMBER`, `NOT_HOST`, `LOBBY_NOT_FOUND`,
`GAME_IN_PROGRESS`, `DISPLAY_NAME_REQUIRED`, `DISPLAY_NAME_TOO_LONG`,
`CANNOT_KICK_SELF`, `TARGET_NOT_ACTIVE_MEMBER`,
`CLAIM_TOO_SOON_OR_ALREADY_HOST`, `CODE_GENERATION_FAILED`.

## Wartungsjobs (pg_cron)

| Job | Takt | Wirkung |
|---|---|---|
| `close-stale-lobbies` | alle 15 min | `closed_at` für Lobbys ohne Aktivität seit **24 h** |
| `purge-old-games` | täglich 03:17 | Löscht Partien älter als 90 Tage (Cascade auf Events/Secrets) |
| `purge-stale-anonymous-users` | täglich 03:43 | Löscht anonyme Accounts > 30 Tage ohne aktive Mitgliedschaft — **destruktiv, DELETE-Pfad verifiziert, kaskadiert auf Host-Lobbys**, siehe unten |

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

### `purge-stale-anonymous-users`: verifiziertes Verhalten

Der Job löscht `auth.users`-Zeilen; das kaskadiert über `profiles` auf
`lobbies.host_id` und damit auf `games`/`game_events`. Mit
`scripts/verify-purge-anonymous-users.sql` gegen sechs synthetische Fälle
getestet (echte `DELETE`s, nicht nur der Trockenlauf):

| Fall | Zustand | Ergebnis |
|---|---|---|
| 1 | nie in einer Lobby, 35 Tage | gelöscht |
| 2 | alte verlassene Mitgliedschaft, 35 Tage | gelöscht, inkl. der verwaisten `lobby_members`-Zeile |
| 3 | Host einer geschlossenen Lobby, selbst verlassen, 35 Tage | Nutzer gelöscht **und die Lobby kaskadiert mit** — kein `SET NULL`, keine FK-Verletzung |
| 4 | aktives Mitglied einer offenen Lobby, 35 Tage | unberührt (kritischster Fall) |
| 5 | 10 Tage alt | unberührt (zu jung) |
| 6 | registriert, 400 Tage, inaktiv | unberührt (nie anonym) |

Fall 3 ist der Punkt, den man vor dem produktiven Scharfschalten bewusst
entscheiden sollte: aktuell verschwindet eine geschlossene Lobby
stillschweigend, wenn ihr letzter Host 30+ Tage inaktiv war. Das betrifft
nur bereits geschlossene Lobbys (offene sind durch Fall 4 geschützt), ist
aber die stille Variante. Optionen, keine davon umgesetzt: `host_id` vor
dem Löschen auf einen Sentinel-„Deleted User"-Account umhängen, oder die
Lobby-Historie vor dem Löschen des Users separat aggregieren (deckt sich
mit der ohnehin zurückgestellten Cross-Lobby-Bestenliste, Plan §2).

Bis das entschieden ist, bei Bedarf pausieren:

```sql
select cron.unschedule('purge-stale-anonymous-users');
```

## Vercel Keep-Alive

`../api/keep-alive.js` + `../vercel.json` (täglich 04:00). Benötigte
Environment-Variablen im Vercel-Dashboard, Scope *Production*, **ohne**
`VITE_`-Präfix: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, optional
`CRON_SECRET`. Vorlage: [../.env.example](../.env.example).
