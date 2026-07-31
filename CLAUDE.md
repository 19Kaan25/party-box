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
> **Die Firestore-Abschnitte weiter unten sind damit historisch** — sie beschreiben
> den Stand vor der Migration und werden mit den Phasen 1–5 schrittweise ersetzt.
>
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
| **Benutzername** `Kaan#1234` | `profiles.username` + `profiles.discriminator` | oben links, Profil, Freundesliste | dauerhaft, nur mit Account, damit fügt man sich hinzu |
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
| Backend      | Firebase 12: Auth (anonym + Email/Passwort) + Firestore           |
| State        | Zwei eigene Hooks (`useAuth`, `useLobby`) + Prop-Drilling. Kein Redux/Zustand/Context |
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
  components/auth/            AuthMenu (oben links), ProfileModal (Reiter Profil/Freunde)
  components/friends/         FriendsPanel, InviteToasts
  components/lobby/           WelcomeScreen, LobbyWaitingScreen (Spielekatalog)
  games/*Engine.jsx           5 Engines: StadtLandFluss, Codenames, Werwolf,
                              WerBinIch, Imposter (je 400–770 Zeilen)
```

## Firestore-Schema (Kurzform)

Nur zwei Collections. **Alles** an Spielzustand liegt in einem einzigen Lobby-Dokument.

```
users/{uid}
  name, username, role ('user'), currentLobby: string|null, photoURL (base64 data-URI!)

lobbies/{CODE}            // CODE = 4 Zeichen [A-Z0-9], via generateLobbyCode()
  id, hostId, status: 'LOBBY_WAITING' | 'GAME_IN_PROGRESS'
  currentGame: null | 'STADT_LAND_FLUSS' | 'CODENAMES' | 'WERWOLF' | 'WER_BIN_ICH' | 'IMPOSTER'
  settings: { globalLeaderboard: bool }
  scoreHistory: { [uid]: number }         // überlebt Verlassen/Rejoin
  players: [{ id, name, isHost, globalScore, photoURL }]   // Array, kein Subcollection
  usedImposterWords: string[], customImposterWords: string[]
  gameState: {}                            // spielabhängig, s. docs/
```

`gameState` ist pro Spiel komplett anders geformt (Werwolf: `playerState`, `narrator`,
`witchState`; Codenames: `board`, `teams`, `spymasters`; SLF: `answers`, `votes`,
`gameScores`; …). Beim Verlassen eines Spiels wird `gameState: {}` gesetzt.

## Konventionen

- **Sprache:** UI-Texte, Kommentare und Commit-Messages auf Deutsch. Code-Bezeichner englisch.
- **Firestore-Writes:** Punkt-Pfade bevorzugt (`'gameState.phase'`), Arrays werden
  read-modify-write ersetzt. Keine Transactions, kein `runTransaction`, kein Batch.
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

- **Sync:** genau **ein** `onSnapshot` pro Client, auf `lobbies/{code}`
  ([useLobby.js:38](src/hooks/useLobby.js#L38)). Jede Änderung eines beliebigen Spielers
  pusht das komplette Dokument (inkl. aller Avatare) an alle.
- **Spiellogik läuft zu 100 % im Client.** Keine Cloud Functions, keine Server-Validierung.
- **Reconnect** über `users/{uid}.currentLobby`; **kein** Disconnect-Handling, keine Presence,
  kein Cleanup verwaister Lobbys.

## Fallen beim Arbeiten am Code

- `.env` ist **committed** und wird **nirgends gelesen** — die Firebase-Config steht
  hartcodiert in [src/utils/firebase.js](src/utils/firebase.js). `import.meta.env` kommt im
  Code nicht vor.
- **Es gibt keine `firestore.rules` im Repo** (auch nie in der Git-History). Regeln existieren
  nur in der Firebase-Console und sind aus dem Code nicht verifizierbar.
- Geheime Spielinformationen (Imposter-Wort, Werwolf-Rollen, Codenames-Farben) liegen im
  Klartext im Lobby-Dokument, das jeder Spieler abonniert → per DevTools einsehbar.
- `/default-avatar.png` wird an vielen Stellen referenziert, existiert aber **nicht** in `public/`.
- `src/App.css` und `src/assets/*` werden nirgends importiert (toter Code).
- `autoprefixer` + `postcss` sind DevDependencies ohne Config — Tailwind v4 braucht sie nicht.
- `lobby.settings.globalLeaderboard` wird in 4 Engines **ohne** Optional Chaining gelesen.
