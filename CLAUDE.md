# PartyBox — CLAUDE.md

Multiplayer-Partyspiel-App (5 Minispiele) für Freundesgruppen im selben Raum.
React SPA + Supabase, deutschsprachige UI. Ausführliche Analyse:
[docs/codebase-overview.md](docs/codebase-overview.md).

> **Migration zu Supabase: Phase 0 (a+b) abgeschlossen, Phase 1 (Imposter) als nächstes.**
> Schema, RLS-Design und Phasenplan: [docs/supabase-migration-plan.md](docs/supabase-migration-plan.md),
> Betriebsdetails: [supabase/README.md](supabase/README.md).
>
> Phase 0a lieferte Schema, RLS, RPCs, Storage und Cron; Phase 0b stellte den
> React-Client um (Auth, Lobby, Presence, Reconnect, Avatare) und entfernte Firebase.
> **Die Firestore-Abschnitte weiter unten sind damit historisch** — sie beschreiben
> den Stand vor der Migration und werden mit den Phasen 1–5 schrittweise ersetzt.
>
> Übergangscode, der in Phase 1 wieder verschwindet: `src/lib/firestoreBridge.js`
> und `legacy_apply_patch()` / `lobbies.legacy_state` (beide mit `TRANSITIONAL`-Header).
> Die fünf Engines schreiben weiterhin clientseitig und ohne Geheimnis-Trennung —
> das ist Absicht und Aufgabe der Phasen 1–5.
>
> Vermessene, bewusst offen gelassene Punkte: [docs/known-issues.md](docs/known-issues.md).

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
Es gibt **kein** `npm test`. Firebase-Projekt `party-box-45d2b` wird direkt aus dem
Client angesprochen — kein Emulator-Setup, lokale Entwicklung schreibt in die Produktions-DB.

## Struktur

```
src/
  main.jsx                    Entry, rendert <App/> in StrictMode
  App.jsx                     Orchestriert useAuth + useLobby, globale Modals
  utils/firebase.js           Firebase-Init (Config HARDCODED, s.u.)
  utils/helpers.js            generateLobbyCode, shuffleArray, ALPHABET
  constants/gameData.js       Wortlisten (Codenames, Imposter) + Werwolf-Rollen
  hooks/useAuth.js            Auth-State, Profil, Registrierung/Login
  hooks/useLobby.js           Lobby CRUD + einziger onSnapshot-Listener
  components/GameRouter.jsx   Welcome → Lobby → Spiel-Engine (switch)
  components/GameHeader.jsx   "Spiel beenden"/"verlassen"-Leiste
  components/auth/            AuthMenu, ProfileModal
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
