# PartyBox — CLAUDE.md

Multiplayer-Partyspiel-App (5 Minispiele) für Freundesgruppen im selben Raum.
React SPA + Supabase, deutschsprachige UI. Ausführliche Analyse:
[docs/codebase-overview.md](docs/codebase-overview.md).

> **Migration zu Supabase: Phase 0 (a+b+c) abgeschlossen. Welches Spiel als
> nächstes serverseitig wird, ist offen** — der ursprünglich geplante
> Imposter-Pilot bringt vor allem Schummelschutz, spürbaren Nutzen hätte
> Stadt Land Fluss (Rundenende zur selben Serverzeit statt 2,5-Sekunden-Hack).
> Schema, RLS-Design und Phasenplan: [docs/supabase-migration-plan.md](docs/supabase-migration-plan.md),
> Betriebsdetails: [supabase/README.md](supabase/README.md).
>
> Phase 0a lieferte Schema, RLS, RPCs, Storage und Cron; Phase 0b stellte den
> React-Client um (Auth, Lobby, Presence, Reconnect, Avatare) und entfernte Firebase;
> Phase 0c brachte Benutzernamen mit Code, Freundesliste, Online-Status und
> Lobby-Einladungen.
> Übergangscode, der mit der ersten Spiele-Phase verschwindet: `src/lib/firestoreBridge.js`
> und `legacy_apply_patch()` / `lobbies.legacy_state` (beide mit `TRANSITIONAL`-Header).
> Die fünf Engines schreiben weiterhin clientseitig und ohne Geheimnis-Trennung —
> das ist Absicht und Aufgabe der Phasen 1–5. Geheimnisse im Klartext sind im
> Freundes-/Familienkreis bewusst akzeptiert und kein Blocker.
>
> Vermessene, bewusst offen gelassene Punkte: [docs/known-issues.md](docs/known-issues.md).

## Identität: es gibt genau zwei Namen

Häufigste Verwechslung beim Arbeiten an diesem Code.

| Begriff | Spalte | Wo sichtbar | Verhalten |
|---|---|---|---|
| **Benutzername** `Kaan#1234` | `profiles.username` + `profiles.discriminator` | oben rechts, Profil, Freundesliste | dauerhaft, nur mit Account, damit fügt man sich hinzu |
| **Anzeigename / Nickname** | `lobby_members.display_name` | Spielerliste, alle fünf Spiele | frei getippt vor dem Erstellen/Beitreten |

`profiles.display_name` ist **kein dritter Name**, sondern nur der zuletzt
benutzte Nickname als Vorbelegung des Eingabefelds
([useLobby.js](src/hooks/useLobby.js): `typedName ?? userData?.name`).

Eindeutig ist das **Paar** aus Name und Code (`profiles_handle_unique` auf
`lower(username), discriminator`) — der Name allein absichtlich nicht. Beide
Namen sind auf **20 Zeichen** begrenzt. Bei jeder Änderung des Benutzernamens
würfelt `set_username()` einen **neuen** Code aus; sonst könnte man sich
gezielt an eine fremde Wunschkombination heranarbeiten.

## Supabase-Projektkonfiguration

`supabase/config.toml` ist die Quelle der Wahrheit und wird per
`npx supabase config push` angewendet — **nicht** über das Dashboard, sonst
divergieren die Stände.

Zwei Einstellungen sind nicht optional:

- `enable_anonymous_sign_ins = true` — die App meldet jeden Besucher zuerst
  anonym an. Auf `false` legt ein `config push` die App komplett lahm.
- `enable_confirmations = false` — einstufige Registrierung. Auf `true`
  verschickt `updateUser({email})` eine Bestätigungsmail, läuft in
  `email_sent = 2`/Stunde und der Account wird **nicht** angelegt.

`additional_redirect_urls` muss die Origin enthalten, von der aus der
Passwort-Reset angefordert wird (aktuell nur localhost — Vercel-URL fehlt noch).

## Tech-Stack

| Bereich      | Wahl                                                             |
|--------------|------------------------------------------------------------------|
| UI           | React 19.2 (`StrictMode`), JSX, keine TypeScript-Typen           |
| Build        | Vite 8 (`@vitejs/plugin-react`, Oxc)                             |
| Styling      | Tailwind CSS v4 via `@tailwindcss/vite` — keine `tailwind.config`, keine `postcss.config` |
| Icons        | `lucide-react`                                                    |
| Backend      | Supabase: Auth (anonym + Email/Passwort), Postgres, Realtime, Storage, pg_cron |
| State        | Vier eigene Hooks (`useAuth`, `useLobby`, `usePresence`, `useFriends`) + Prop-Drilling. Kein Redux/Zustand/Context |
| Routing      | Keins. `GameRouter` schaltet per `switch` auf `lobby.currentGame` |
| Tests        | Keine. Kein Test-Runner installiert                               |
| CI/CD        | Keine. Kein Hosting-/Deploy-Config im Repo                        |

## Befehle

```bash
npm install
```

```bash
npm run dev
```

`npm run build` (Vite-Build nach `dist/`), `npm run preview`, `npm run lint` (ESLint 9 Flat Config).
Es gibt **kein** `npm test`; stattdessen die Verifikationsskripte in `scripts/`
(`verify-phase0*.sql` über `npx supabase db query --linked -f …`,
`verify-phase0*.mjs` über `node`). Supabase-Projekt `wlgvwpkqtiymlpctgufb` wird direkt
angesprochen — kein Emulator-Setup, lokale Entwicklung schreibt in die Produktions-DB.

> **Lint-Baseline:** `npm run lint` meldet 10 Probleme (8 Fehler, 2 Warnungen), alle
> vorbestehend in `StadtLandFlussEngine.jsx` und `WerBinIchEngine.jsx`. Neue Arbeit
> muss diese Zahl halten, nicht auf null bringen — die Engines werden in den
> Phasen 1–5 ohnehin neu geschrieben.

## Struktur

```
src/
  main.jsx                    Entry, rendert <App/> in StrictMode
  App.jsx                     Orchestriert useAuth + useLobby + useFriends, globale Overlays
  lib/supabase.js             Client-Singleton + measureClockOffset()
  lib/firestoreBridge.js      TRANSITIONAL: Firestore-kompatibler Shim für die Engines
  utils/helpers.js            shuffleArray, ALPHABET, relativeTimeDe
  constants/gameData.js       Wortlisten (Codenames, Imposter) + Werwolf-Rollen
  hooks/useAuth.js            Auth, Profil, Benutzername, Avatar
  hooks/useLobby.js           Lobby-RPCs + 3 postgres_changes-Subscriptions
  hooks/usePresence.js        Lobby-Presence-Kanal + globaler touch_presence-Herzschlag
  hooks/useFriends.js         Freunde, Anfragen, Einladungen (Realtime + Poll)
  components/GameRouter.jsx   Welcome → Lobby → Spiel-Engine (switch)
  components/GameHeader.jsx   "Spiel beenden"/"verlassen"-Leiste
  components/auth/            AuthMenu (oben rechts), ProfileModal (Reiter Profil/Freunde)
  components/friends/         FriendsPanel, InviteToasts
  components/lobby/           WelcomeScreen, LobbyWaitingScreen (Spielekatalog)
  games/*Engine.jsx           5 Engines: StadtLandFluss, Codenames, Werwolf,
                              WerBinIch, Imposter (je 400–770 Zeilen)
  games/ImposterSingleDevice.jsx  Imposter auf EINEM Handy (pass the phone)
  games/ImposterSetupPanels.jsx   Kategorien-/Wörter-Panels, von beiden Imposter-Modi genutzt
  games/imposterWords.js          Wortpool-Helfer (eigene Datei wegen react-refresh)
```

## Imposter: zwei Modi

`ImposterEngine.jsx` ist nur noch eine Weiche auf `gameState.settings.mode`:

- **`'MULTI'` (Voreinstellung)** — der bisherige Ablauf, jeder spielt auf seinem Gerät.
- **`'SINGLE'`** — ein Handy wandert reihum ([ImposterSingleDevice.jsx](src/games/ImposterSingleDevice.jsx)).
  Alle anderen Lobby-Mitglieder sehen nur "Spiel läuft…".

Zustandshaltung im Einzelgerät-Modus: **lokaler State zuerst, Server hinterher.** Jeder
Schritt setzt sofort den React-State — ein weitergereichtes Handy darf nicht auf einen
Roundtrip warten — und spiegelt ihn danach nach `gameState.sd` (`step`, `roster`, `round`,
`revealIndex`, `revealStage`, `votedOutKey`, `guessed`, `sessionUsed`, `summary`). Beim
Mounten wird der lokale State aus `gameState.sd` vorbelegt: lädt der Host mitten in der
Runde neu, geht es genau dort weiter. `gameState.phase` (`'SETUP'` / `'SINGLE_RUNNING'`)
trägt den Nicht-Host-Schirm und die Weiche in `ImposterEngine.jsx`.

Dass damit auch das Geheimwort bei allen Clients liegt, ist bewusst in Kauf genommen —
genau wie im Mehrgeräte-Modus (siehe Kopf dieser Datei: Klartext-Geheimnisse sind im
Freundeskreis akzeptiert).

**Falle:** Ein Patch mit `status: 'LOBBY_WAITING'` beendet die `games`-Zeile und verwirft
alle `gameState`-Keys desselben Patches. "Nächste Runde" und "Einstellungen ändern" dürfen
die Lobby deshalb nie anfassen, sonst ist die Mitspielerliste weg.

## Spielzustand: `games.state` (Kurzform)

Pro Spiel komplett anders geformt (Werwolf: `playerState`, `narrator`, `witchState`;
Codenames: `board`, `teams`, `spymasters`; SLF: `answers`, `votes`, `gameScores`; …).
Vollständiges Schema: [docs/supabase-migration-plan.md](docs/supabase-migration-plan.md) §4.
Die Engines schreiben weiterhin über die `TRANSITIONAL`-Brücke (siehe oben), nicht direkt.

## Konventionen

- **Sprache:** UI-Texte, Kommentare und Commit-Messages auf Deutsch. Code-Bezeichner englisch.
- **Engine-Writes über die Bridge:** Punkt-Pfade (`'gameState.phase'`), Arrays per
  `arrayUnion`. Firestore-Semantik, aber serverseitig auf `games.state` aufgelöst
  (`legacy_apply_patch`, s. Kopf dieser Datei) — keine Transactions, kein Batch.
- **Host-Autorität:** rein clientseitig (`if (!isHost) return;`). Nicht als Sicherheitsgrenze behandeln.
- **Engine-Signatur:** `({ lobby, user, isHost, db, updateLobbyStatus, leaveLobby })`.
  `db` wird als Prop durchgereicht, obwohl es importierbar wäre.
- **Phasen-Rendering:** Engines rendern per `if (gameState.phase === 'X') return (...)`,
  fallen am Ende auf `return null`. **Alle Hooks müssen ganz oben stehen** — steht so als
  Kommentar in `WerwolfEngine.jsx` und `WerBinIchEngine.jsx`.
- **Bestätigungen:** `window.confirm(...)` für destruktive Aktionen.
- **Styling:** Tailwind-Utilities inline, keine CSS-Klassen-Abstraktion. Dunkles
  `slate-900`-Theme, `rounded-3xl`-Karten, Gradient-Buttons.
- Einrückung ist uneinheitlich (4 Space in den meisten Dateien, 2 Space in
  `CodenamesEngine.jsx` / `StadtLandFlussEngine.jsx`). Bestehende Datei-Konvention beibehalten.

## Multiplayer-Modell (Kurz)

- **Sync:** drei `postgres_changes`-Subscriptions (`lobbies`, `lobby_members`, `games`) auf
  einem Kanal pro Lobby ([useLobby.js](src/hooks/useLobby.js)), refetcht bei jedem Event
  den vollen Zustand aus den drei Tabellen statt den Payload zu verwenden.
- **Spiellogik läuft weiterhin zu 100 % im Client** (Übergang, s. Kopf dieser Datei).
  Schreibzugriffe laufen über RPCs bzw. `legacy_apply_patch`, nie über direkte
  Tabellen-Updates vom Client.
- **Reconnect** über `lobby_members` (aktive Mitgliedschaft), **Presence** über einen
  öffentlichen Kanal (`usePresence.js`) plus periodischem Herzschlag.

## Fallen beim Arbeiten am Code

- **Zwei getrennte Env-Variablensätze für Vercel:** `VITE_SUPABASE_URL` /
  `VITE_SUPABASE_ANON_KEY` (mit `VITE_`-Präfix, backt Vite zur **Build-Zeit** in den
  Client-Bundle ein — ohne sie wirft [supabase.js](src/lib/supabase.js) beim Laden und die
  App bleibt leer) vs. `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (ohne Präfix, nur für
  `api/keep-alive.js`, niemals im Client). Nach Ändern der `VITE_`-Variablen ist ein
  Redeploy nötig, ein reines Hinzufügen reicht nicht.
- **Realtime liefert verpasste Events nach einem Verbindungsabriss nicht nach.** Bricht der
  WebSocket kurz ab (Displaysperre, Hintergrund-Tab) und reconnectet automatisch, bleibt der
  Client sonst auf altem Stand eingefroren. `useLobby.js` refetcht deshalb bei jedem
  `SUBSCRIBED`-Status aktiv; `useFriends.js` hat diese Absicherung **noch nicht**.
- `src/App.css` und `src/assets/*` werden nirgends importiert (toter Code).
- `autoprefixer` + `postcss` sind DevDependencies ohne Config — Tailwind v4 braucht sie nicht.
