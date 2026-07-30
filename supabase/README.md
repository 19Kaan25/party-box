# Supabase — Phase 0a (Infrastruktur)

Migrationen, RPCs und Wartungsjobs für das Fundament der Supabase-Migration.
Design und Begründungen: [../docs/supabase-migration-plan.md](../docs/supabase-migration-plan.md).

**Status: deployt und vollständig verifiziert.** Projekt `PartyBox`
(`wlgvwpkqtiymlpctgufb`, `eu-central-1`), vier Migrationen angewendet.
Datenbank nach jeder Verifikation wieder im Ausgangszustand — kein
Testrückstand außer den bewusst permanenten Fixtures (Sentinel-Account,
s. u.).

| Verifikation | Ergebnis |
|---|---|
| `scripts/verify-phase0a.sql` (SQL, 16 Prüfungen) | ✅ alle bestanden |
| `scripts/verify-phase0a.mjs` (echter HTTP/RPC-Pfad, 21 Prüfungen inkl. echtem Parallel-Race) | ✅ alle bestanden |
| `scripts/verify-purge-anonymous-users.sql` (echter DELETE-Pfad, 6 Fälle + 2 Regressionschecks) | ✅ alle bestanden, inkl. Sentinel-Fix |

Ausführung siehe „Verifizieren" unten.

## Migrationen

| Datei | Inhalt |
|---|---|
| `20260730120000_init_schema.sql` | Extensions, Enums, 8 Tabellen, Indizes, RLS-Aktivierung |
| `20260730120100_functions_and_rls.sql` | Trigger, RLS-Hilfspredikate, 7 RPCs, Grants, Policies |
| `20260730120200_realtime_storage_cron.sql` | Realtime-Publication, Storage-Bucket, 3 pg_cron-Jobs |
| `20260730213000_sentinel_host_reassignment.sql` | Sentinel-Account „Ehemaliger Host" + Fix für `purge_stale_anonymous_users()`, s. u. |

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
| `purge-stale-anonymous-users` | täglich 03:43 | Löscht anonyme Accounts > 30 Tage ohne aktive Mitgliedschaft — verwaiste Host-Lobbys werden vorher auf den Sentinel umgehängt, siehe unten |

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

Ein offener Punkt bleibt: geschlossene Lobbys mit Sentinel-Host sind für
Spieler über die aktuelle RLS-Policy auf `profiles` nicht auflösbar
(`profiles_select_visible` erlaubt nur die eigene Zeile oder Mitglieder
derselben aktiven Lobby — der Sentinel ist nie Mitglied). Für Phase 0a ohne
Belang (keine UI); relevant erst, falls Phase 0b jemals eine geschlossene
Lobby mit ihrem (Sentinel-)Host anzeigen will.

## Vercel Keep-Alive

`../api/keep-alive.js` + `../vercel.json` (täglich 04:00). Benötigte
Environment-Variablen im Vercel-Dashboard, Scope *Production*, **ohne**
`VITE_`-Präfix: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, optional
`CRON_SECRET`. Vorlage: [../.env.example](../.env.example).
