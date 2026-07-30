# Supabase — Phase 0a (Infrastruktur)

Migrationen, RPCs und Wartungsjobs für das Fundament der Supabase-Migration.
Design und Begründungen: [../docs/supabase-migration-plan.md](../docs/supabase-migration-plan.md).

**Status: geschrieben, aber noch nicht deployt und noch nicht verifiziert.**
Siehe „Offene Schritte" unten.

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
| `purge-stale-anonymous-users` | täglich 03:43 | Löscht anonyme Accounts > 30 Tage ohne aktive Mitgliedschaft — **destruktiv und unverifiziert**, siehe unten |

## Offene Schritte

Diese Session konnte weder deployen noch verifizieren: der CLI-Login braucht ein
TTY (im Agent nicht verfügbar), Docker fehlt für den lokalen Stack, und die
Projektreferenz `wlgvwpkqtiymlpctgufb` ist über den MCP-Zugang nicht erreichbar.

```bash
npx supabase login
```

```bash
npx supabase link --project-ref <deine-projekt-ref>
```

```bash
npx supabase db push
```

Danach verifizieren:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/verify-phase0a.sql
```

```bash
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<anon> node scripts/verify-phase0a.mjs
```

Vorher im Dashboard: **Authentication → Sign In / Providers → Anonymous** aktivieren.

### Vor dem Scharfschalten von `purge-stale-anonymous-users`

Der Job löscht `auth.users`-Zeilen; das kaskadiert über `profiles` auf
`lobbies.host_id` und damit auf `games`/`game_events`. Für einen 30 Tage alten
Gast ohne aktive Mitgliedschaft ist das gewollt — geprüft ist es aber nicht.
Test 10 in `scripts/verify-phase0a.sql` zeigt als Trockenlauf, wie viele Nutzer
betroffen wären. Bis dahin bei Bedarf pausieren:

```sql
select cron.unschedule('purge-stale-anonymous-users');
```

## Vercel Keep-Alive

`../api/keep-alive.js` + `../vercel.json` (täglich 04:00). Benötigte
Environment-Variablen im Vercel-Dashboard, Scope *Production*, **ohne**
`VITE_`-Präfix: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, optional
`CRON_SECRET`. Vorlage: [../.env.example](../.env.example).
