# PartyBox — Codebase-Überblick

Bestandsaufnahme vom 30.07.2026, Stand Commit `bfc057d` ("Imposter"), Branch `main`.
Umfang: 12 Quelldateien, ~4.400 Zeilen JSX/JS in `src/`.

---

## 1. Tech-Stack & Setup

### 1.1 Kernentscheidungen

| Bereich | Wahl | Fundstelle |
|---|---|---|
| React | 19.2.4, `StrictMode` aktiv | `src/main.jsx` |
| Build | Vite 8.0.4 mit `@vitejs/plugin-react` (Oxc-basiert) | `vite.config.js` |
| Styling | Tailwind CSS 4.2 über das Vite-Plugin | `vite.config.js`, `src/index.css` |
| Icons | `lucide-react` 1.7 | alle Komponenten |
| Backend | Firebase 12.11 — Auth + Firestore | `src/utils/firebase.js` |
| State | 2 Custom Hooks + Prop-Drilling | `src/hooks/` |
| Routing | keins | `src/components/GameRouter.jsx` |
| Sprache | JavaScript, kein TypeScript (`@types/react` ist trotzdem installiert) | `package.json` |

`src/index.css` besteht aus vier Zeilen: `@import "tailwindcss";` plus ein
`background-color` auf `html, body`. Es gibt weder `tailwind.config.js` noch
`postcss.config.js` — Tailwind v4 konfiguriert sich per CSS, das Projekt nutzt aber
ausschließlich Default-Utilities.

### 1.2 State-Management im Detail

Es gibt keine State-Library und keinen React Context. Der komplette Zustand hängt an
zwei Hooks, die in `App.jsx` einmal initialisiert und dann als Objekte weitergereicht werden:

```
App.jsx
 ├── authLogic  = useAuth()                         → { user, userData, loading, ... }
 ├── lobbyLogic = useLobby(user, userData, updateUserProfile)
 └── GameRouter({ authLogic, lobbyLogic, uiProps })
      └── <XEngine {...{ lobby, user, isHost, db, updateLobbyStatus, leaveLobby }} />
```

Die Engines bekommen also ein flaches Prop-Bündel; `db` wird durchgereicht, obwohl es
in jeder Engine ohnehin per Import verfügbar wäre (`GameRouter.jsx:2` importiert `db` nur,
um es weiterzugeben).

### 1.3 Dependencies

Produktiv: `react`, `react-dom`, `firebase`, `lucide-react`, `@tailwindcss/vite`.
Alles auf aktuellen Major-Versionen; `npm outdated` meldet nur Patch-Abstände
(z. B. firebase 12.11 → 12.16, react 19.2.4 → 19.2.8). **Kein veraltetes Paket.**

Verwaist:
- `autoprefixer` und `postcss` — Tailwind v4 über das Vite-Plugin braucht keine
  PostCSS-Pipeline, und es existiert keine PostCSS-Config.
- `@types/react`, `@types/react-dom` — ohne TypeScript wirkungslos (allenfalls für IDE-Hints).

`node_modules` ist zum Zeitpunkt der Analyse nicht installiert; `npm install` ist also der
erste nötige Schritt.

### 1.4 Start & Test

```bash
npm install && npm run dev
```

Scripts in `package.json`: `dev`, `build`, `lint`, `preview`. **Kein `test`-Script, kein
Test-Runner, keine Testdatei im Repo.** ESLint 9 Flat Config (`eslint.config.js`) mit
`js/recommended`, `react-hooks` und `react-refresh`; einzige eigene Regel ist
`no-unused-vars` mit `varsIgnorePattern: '^[A-Z_]'` (deshalb schlagen die ungenutzten
`React`-Imports nicht an).

Es gibt kein Firebase-Emulator-Setup. Lokale Entwicklung spricht direkt gegen das
Produktionsprojekt `party-box-45d2b` — jeder `npm run dev` erzeugt echte Dokumente.

---

## 2. Firestore-Struktur

### 2.1 Collections

Zwei Top-Level-Collections, keine Subcollections.

#### `users/{uid}`

Angelegt in `useAuth.js:31-39` beim ersten `onAuthStateChanged` mit User.

| Feld | Typ | Bemerkung |
|---|---|---|
| `name` | string | Anzeigename, Default `'Player'` |
| `username` | string | Login-Name, `''` solange anonym |
| `role` | string | immer `'user'`; `AuthMenu.jsx:18` rendert ein Badge für abweichende Rollen — es gibt aber keinen Code, der die Rolle jemals ändert |
| `currentLobby` | string \| null | Lobby-Code für Auto-Reconnect |
| `photoURL` | string | `'/default-avatar.png'` **oder ein base64 JPEG data-URI** (`ProfileModal.jsx:33`) |

#### `lobbies/{CODE}`

`CODE` = 4 Zeichen aus `[A-Z0-9]` (`helpers.js:1-8`). Angelegt in `useLobby.js:93-113`.

| Feld | Typ | Bemerkung |
|---|---|---|
| `id` | string | redundant zur Doc-ID |
| `hostId` | string (uid) | einzige Quelle der Wahrheit für `isHost` |
| `status` | `'LOBBY_WAITING'` \| `'GAME_IN_PROGRESS'` | |
| `currentGame` | null \| Game-Key | `STADT_LAND_FLUSS`, `CODENAMES`, `WERWOLF`, `WER_BIN_ICH`, `IMPOSTER` |
| `settings` | `{ globalLeaderboard: bool }` | |
| `scoreHistory` | `{ [uid]: number }` | vom Host gespiegelter Höchststand, damit Rejoiner ihre Punkte behalten (`useLobby.js:63-80`, gelesen in `useLobby.js:152`) |
| `players` | Array von `{ id, name, isHost, globalScore, photoURL }` | **Array**, kein Subcollection-Dokument |
| `usedImposterWords` | string[] | verbrauchte Wörter, wächst unbegrenzt |
| `customImposterWords` | string[] | eigene Wörter des Hosts |
| `gameState` | Map | pro Spiel unterschiedlich, s. u.; wird beim Zurück-zur-Lobby auf `{}` gesetzt |

### 2.2 `gameState` je Spiel

Alle Felder werden über Punktpfade geschrieben (`'gameState.phase'`), das Objekt selbst
wird beim Spielstart aus `LobbyWaitingScreen.jsx:112-156` initialisiert.

**Stadt Land Fluss** (`StadtLandFlussEngine.jsx`)
Phasen: `SETUP → STARTING → PLAYING → SUBMITTING → REVIEW → (nextRound|FINAL_RESULTS)`
```
categories: string[]         maxRounds: number       timerLimit: number (30–240)
currentRound: number         excludedLetters: string[]  letter: string
startTimestamp: number       playingStartTime: number
answers: { [uid]: { [kategorie]: string } }
votes:   { [uid]: { [kategorie]: { reject: uid[], duplicate: uid[] } } }
gameScores: { [uid]: number }
```

**Codenames** (`CodenamesEngine.jsx`)
Phasen: `TEAM_SETUP → BOARD_SETUP → PLAYING → REVIEW`
```
teams: { red: uid[], blue: uid[] }      spymasters: { red: uid|null, blue: uid|null }
board: [{ id, word, color: 'red'|'blue'|'neutral'|'black', isRevealed }] (25 Karten)
turn: 'RED_SPYMASTER' | 'RED_OPERATIVE' | 'BLUE_...'
currentClue: { word, count, guessesLeft } | null
startingTeam, winner, customWords, pinnedWords
```

**Werwolf** (`WerwolfEngine.jsx`)
Zwei Modi über `settings.mode`, `WerwolfEngine.jsx` ist die Weiche.

*Mehrgeräte (`'MULTI'`)* — Phasen `SETUP → PLAYING → FINAL_RESULTS`
```
narrator: uid                dayNumber: number       isDay: bool
playerState: { [uid]: { role, alive, inLove, deathReason } }
recentDeaths: [{ id, reason }]
witchState: { healUsed, poisonUsed }
hunterShooting: uid | null   winningFaction: 'DORF'|'WERWOLFE'|'LIEBESPAAR'|'UNENTSCHIEDEN'|null
```

*Ein Handy (`'SINGLE'`, `WerwolfSingleDevice.jsx`)* — Phasen `SETUP → SINGLE_RUNNING`,
Fortschritt daneben in `sd`:
```
sd: { step: 'SETUP'|'REVEAL'|'PLAY'|'RESULT',
      roster: [{ key, name, userId }],  narratorKey,  roleCounts, rules,
      revealIndex, revealStage,
      game: { playerState: { [key]: { role, alive, inLove, deathReason } },
              dayNumber, isDay, stepIndex, witchState, wolfVictim, poisonVictim,
              healed, seerTarget, recentDeaths, pendingHunter, firstVictimKey, winner } }
```
Der Erzähler steht im `roster`, bekommt aber keinen `playerState`-Eintrag. Nachtschritte
werden aus den lebenden Rollen berechnet (`buildNightSteps`), Liebespaar- und Jäger-Ketten
löst `killPlayers` auf.

**Wer bin ich?** (`WerBinIchEngine.jsx`)
Phasen: `SETUP → INPUT → PLAYING → FINAL_RESULTS`
```
mode: 'POOL' | 'TARGETED'    assignments: { [schreiberUid]: zielUid } | null
inputArray: [{ userId, words: string[] }]     (per arrayUnion befüllt)
playerState: { [uid]: { word, guessed, rank } }
nextRank: number             activeTurnId: uid
```

**Imposter** (`ImposterEngine.jsx`)
Zwei Modi, umgeschaltet über `settings.mode`. `ImposterEngine.jsx` ist nur noch die
Weiche; `'SINGLE'` rendert `ImposterSingleDevice.jsx`.

*Mehrgeräte (`mode: 'MULTI'`, Voreinstellung)* — Phasen `SETUP → ROLE_REVEAL → PLAYING → RESULT`
```
settings: { imposterCount: 1–3, timerDuration: 180, selectedCategories: string[],
            mode: 'MULTI' | 'SINGLE', imposterHint: 'none' | 'category' }
word: string                 imposters: uid[]        votes: { [uid]: uid }
startTime: number
```

*Ein Handy (`mode: 'SINGLE'`)* — Phasen `SETUP → SINGLE_RUNNING`, der Rundenfortschritt
liegt daneben in `sd`:
```
sd: { step: 'SETUP' | 'REVEAL' | 'ORDER' | 'VOTE' | 'RESOLVE' | 'GUESS' | 'RESULT',
      roster: [{ key, name, userId }],   round: { word, categoryName, imposterKeys, startIndex },
      revealIndex, revealStage, votedOutKey, guessed: { [key]: bool },
      sessionUsed: string[], summary }
```
Der Host führt lokal (kein Roundtrip pro Kartendreher) und spiegelt jeden Schritt nach
`sd`; beim Mounten wird der lokale State daraus vorbelegt, ein Reload setzt die Runde also
fort. Nicht-Hosts rendern anhand von `phase === 'SINGLE_RUNNING'` einen "Spiel läuft…"-Schirm
mit Statuszeile aus `sd.step`. Details im Kopfkommentar von `ImposterSingleDevice.jsx`.

`settings.timerDuration` wird gesetzt, aber nirgends ausgewertet — es gibt in Imposter
keinen laufenden Timer.

### 2.3 Wo gelesen und geschrieben wird

| Ort | Operation | Ziel |
|---|---|---|
| `useAuth.js:26,38` | `getDoc` / `setDoc` | `users/{uid}` (Profil anlegen) |
| `useAuth.js:69,105` | `updateDoc` | `users/{uid}` (Username, Nickname, Avatar) |
| `useAuth.js:112,121` | `getDoc` + `updateDoc` | `lobbies/{code}` — Profiländerung ins `players`-Array spiegeln |
| `useLobby.js:23` | `getDoc` | `lobbies/{code}` — Reconnect-Check |
| `useLobby.js:38` | **`onSnapshot`** | `lobbies/{code}` — der einzige Live-Listener |
| `useLobby.js:28,45,53,193` | `updateDoc` | `users/{uid}.currentLobby` zurücksetzen |
| `useLobby.js:77` | `updateDoc` | `scoreHistory` (nur Host) |
| `useLobby.js:113,114` | `setDoc` ×2 | Lobby erstellen + `users/{uid}` verknüpfen |
| `useLobby.js:145,162,165` | `updateDoc`/`setDoc` | Beitreten |
| `useLobby.js:187,190,211,222` | `updateDoc` | Verlassen, Kick, Promote |
| `useLobby.js:204` | `updateDoc` | `updateLobbyStatus` — generischer Schreibpfad aller Engines |
| alle 5 Engines | `updateDoc` | `lobbies/{code}` mit `gameState.*`-Pfaden |

### 2.4 Aktive Listener pro Session

**Genau einer.** `useLobby.js:38` abonniert `lobbies/{lobbyCode}`, sobald ein Code gesetzt
ist; das Cleanup läuft über `unsubscribe()` im Effect-Return. Dazu kommt ein
`onAuthStateChanged`-Listener (`useAuth.js:21`), der aber kein Firestore-Listener ist.
`users/{uid}` wird ausschließlich per `getDoc` gelesen — deshalb bekommt ein Client
Änderungen am eigenen Profil aus einem anderen Tab nicht mit.

Praktische Konsequenz: **1 Listener × N Spieler**, aber jede einzelne Aktion (ein Vote, eine
aufgedeckte Karte, ein Tastendruck des Hosts an einem Slider) schreibt das Lobby-Dokument
und pusht es vollständig an alle N Clients — inklusive aller base64-Avatare im
`players`-Array. Bei 8 Spielern mit hochgeladenen Bildern sind das leicht 150–250 KB pro
Snapshot.

### 2.5 firestore.rules

**Die Datei existiert nicht** — weder im Arbeitsverzeichnis noch irgendwo in der
Git-History (`git log --all --diff-filter=A` liefert keinen Treffer). Es gibt auch keine
`firebase.json` und keine `.firebaserc`. Die Regeln liegen also ausschließlich in der
Firebase-Console und lassen sich aus dem Repo weder prüfen, reviewen noch versionieren.

Aus dem Client-Code lässt sich ableiten, was die Regeln **mindestens** erlauben müssen,
damit die App funktioniert:

- Jeder authentifizierte (auch anonyme) User muss **jedes** `lobbies/{code}` lesen dürfen —
  Beitreten funktioniert per `getDoc` auf einen geratenen 4-Zeichen-Code.
- Jeder Spieler muss beliebige Felder eines Lobby-Dokuments **schreiben** dürfen: das
  `players`-Array (Beitritt, Kick, Promote), `hostId`, `status`, `settings` und den
  kompletten `gameState`. Feldweise Einschränkung ist mit diesem Datenmodell praktisch
  nicht möglich, weil derselbe Schreibpfad (`updateLobbyStatus`) für alles benutzt wird.

Das heißt: Die Rules können bestenfalls „nur eingeloggte User" durchsetzen. Alles darüber
hinaus — wer Host ist, wer kicken darf, wer das Imposter-Wort setzt — ist mit der aktuellen
Struktur **nicht** regelbasiert absicherbar. Ob die Rules überhaupt Auth verlangen oder im
`allow read, write: if true`-Modus stehen, ist ohne Console-Zugriff nicht feststellbar und
sollte als Erstes geprüft werden.

---

## 3. Multiplayer-Architektur

### 3.1 Lobby erstellen

`useLobby.js:82-121`:

1. `generateLobbyCode()` würfelt 4 Zeichen — **ohne Kollisionsprüfung**.
2. `setDoc(lobbies/{code}, initialLobbyData)` — ohne `merge`, ohne vorheriges `getDoc`.
   Trifft der Zufall einen bereits vergebenen Code, wird die fremde Lobby **überschrieben**
   und deren Spieler fliegen raus (ihr Snapshot findet sich nicht mehr in `players` →
   `useLobby.js:41-45` wirft sie zurück auf den Welcome-Screen).
3. `setDoc(users/{uid}, { currentLobby, name }, { merge: true })`.
4. Lokaler `lobbyCode`-State wird gesetzt → der Snapshot-Effect startet.

Der Keyspace ist 36⁴ = 1.679.616. Bei ~1.400 gleichzeitig offenen Lobbys liegt die
Kollisionswahrscheinlichkeit schon bei ~50 % (Geburtstagsparadoxon) — und da Lobbys
**nie gelöscht werden** (s. 3.4), wächst der belegte Raum monoton.

### 3.2 Beitreten

`useLobby.js:123-172`: `getDoc` → prüfen (existiert? Name frei? `status === 'LOBBY_WAITING'`?)
→ `players`-Array lokal kopieren, Eintrag anhängen → `updateDoc` mit dem ganzen Array.

Das ist ein klassisches Read-Modify-Write ohne Transaction. Treten zwei Spieler
gleichzeitig bei, gewinnt der letzte Schreibvorgang und der andere Beitritt geht verloren
— der Spieler landet dann sofort wieder auf dem Welcome-Screen. Dasselbe Muster steckt in
`kickPlayer`, `promotePlayer`, `leaveLobby` und in jeder Punktevergabe am Spielende.

Ein bereits bekannter Spieler (gleiche uid) aktualisiert stattdessen seinen Eintrag —
das ist der Reconnect-Pfad.

### 3.3 Zustands-Synchronisation

Ein einziger `onSnapshot` (`useLobby.js:34-61`) schreibt das komplette Lobby-Dokument in
`currentLobby`. `GameRouter` leitet daraus ab, was gerendert wird:

```
!currentLobby                    → WelcomeScreen
status === 'LOBBY_WAITING'       → LobbyWaitingScreen
sonst switch(currentGame)        → *Engine
```

Innerhalb einer Engine steuert `gameState.phase` das Rendering. Es gibt keinen lokalen
Spiegel des Spielzustands: jede Aktion ist ein `updateDoc`, das per Snapshot zurückkommt.
Das ist einfach und robust gegen Divergenz, kostet aber eine Round-Trip-Latenz pro Klick
und macht optimistische UI unmöglich.

Zeitsynchronisation läuft über absolute Timestamps im Dokument:
`gameState.startTimestamp` (Countdown, `StadtLandFlussEngine.jsx:154`) und
`gameState.playingStartTime` (Rundentimer, Zeile 39). Beide werden mit `Date.now()` des
**Hosts** gesetzt und gegen `Date.now()` des **Clients** gerechnet — Uhrendrift zwischen
Geräten verschiebt den Timer entsprechend. `serverTimestamp()` wird nirgends benutzt.

### 3.4 Spiellogik & Cheat-Anfälligkeit

**Die gesamte Spiellogik läuft im Client.** Es gibt keine Cloud Functions, kein
`functions/`-Verzeichnis, keinen Server. Das hat zwei getrennte Konsequenzen:

**a) Geheime Informationen sind für alle lesbar.** Jeder Spieler abonniert das komplette
Lobby-Dokument. Die App versteckt Geheimnisse nur durch bedingtes Rendern:

| Spiel | Geheimnis | Liegt im Snapshot als |
|---|---|---|
| Imposter | wer Imposter ist, welches Wort | `gameState.imposters`, `gameState.word` |
| Werwolf | alle Rollen aller Spieler | `gameState.playerState[uid].role` |
| Codenames | Farbe jeder Karte | `gameState.board[i].color` |
| Wer bin ich? | das eigene Wort auf der Stirn | `gameState.playerState[meineUid].word` |

Ein Blick in den Network-Tab oder ein `console.log` in der Konsole reicht, um jedes dieser
Spiele vollständig zu brechen. Für eine Freundesrunde im selben Raum ist das vermutlich
akzeptabel; als Produktversprechen ist es nicht haltbar.

**b) Autorität ist nicht durchgesetzt.** `isHost` wird lokal aus `hostId === user.uid`
berechnet, und alle Host-Aktionen prüfen das nur clientseitig
(`updateLobbyStatus`: `if (!isHost) return;`). Da die Firestore-Rules diese Struktur nicht
prüfen können (s. 2.5), kann jeder Spieler mit der Firebase-SDK in der Konsole:
sich selbst zum Host machen, andere kicken, das Imposter-Wort umschreiben, seinen
`globalScore` setzen oder ein laufendes Spiel beenden.

Zusätzlich ist der Zufall clientseitig: Rollen-, Wort- und Board-Verteilung passieren mit
`Math.random()` auf dem Host-Gerät. Der Host sieht damit prinzipbedingt alles.

### 3.5 Reconnect & Disconnect

**Reconnect** ist implementiert: `users/{uid}.currentLobby` speichert die Lobby, und
`useLobby.js:20-32` holt den Spieler nach einem Reload automatisch zurück — inklusive
Plausibilitätscheck (steckt die uid noch in `players`? sonst Feld zurücksetzen). Anonyme
Firebase-Auth-Sessions überleben Reloads, die uid bleibt also stabil.

**Disconnect wird gar nicht behandelt.** Es gibt keine Presence, keinen Heartbeat, kein
`lastSeen`, kein `onDisconnect` (letzteres gäbe es ohnehin nur in der Realtime Database).
Wer den Tab schließt, bleibt für immer in `players`. Daraus folgt:

- Ghost-Spieler blockieren „alle bereit"-Gates, z. B. `allReady` in
  `WerBinIchEngine.jsx:74` (`inputArray.length === players.length`) — das Spiel lässt sich
  dann nicht mehr starten.
- Verlässt der Host als **letzter** Spieler, greift `useLobby.js:184` nicht
  (`remainingPlayers.length > 0` ist false): das Lobby-Dokument bleibt mit dem alten Host
  in `players` liegen. Es gibt keinerlei TTL oder Cleanup-Job, verwaiste Lobbys sammeln
  sich unbegrenzt an.
- Fällt der Host mitten im Spiel aus, ist die Runde tot: nur der Host kann Phasen
  weiterschalten, und Host-Wechsel passiert ausschließlich beim expliziten Verlassen.

---

## 4. Code-Qualität & Risiken

### 4.1 Duplikate

- **Punktevergabe + Rückkehr zur Lobby** existiert viermal in leicht abweichenden
  Varianten: `WerwolfEngine.jsx:650`, `StadtLandFlussEngine.jsx:572`,
  `WerBinIchEngine.jsx:210`, `CodenamesEngine.jsx:471`. Zwei nutzen `updateDoc` direkt,
  zwei `updateLobbyStatus`; Werwolf schreibt defensiv `(p.globalScore || 0)`, Codenames
  und SLF schreiben `p.globalScore + 5` (wird `NaN`, wenn das Feld fehlt).
- **Ranking mit Gleichstand** ist zweimal fast identisch implementiert
  (`StadtLandFlussEngine.jsx:433` und `:559`).
- **„Warte auf Host…"-Blockscreens** sind in vier Engines separat ausgeschrieben.
- **`window.confirm`-Wrapper** um destruktive Aktionen an mindestens sechs Stellen.

### 4.2 Fehlende Fehlerbehandlung

`useAuth` und `useLobby` fangen Fehler ab und setzen `errorMsg`. In den **Engines** hat
praktisch kein `updateDoc` ein `try/catch` — Ausnahmen sind `WerwolfEngine.jsx:167`
(Jägerschuss) und `WerBinIchEngine.jsx:114`. Schlägt ein Schreibvorgang fehl (Rules,
Offline, Netzwerk), passiert schlicht nichts sichtbares; der Spieler klickt erneut.

Weitere Lücken:
- `useLobby.js:23` — der `getDoc().then()` beim Reconnect hat kein `.catch()`.
- Mehrere `updateDoc(...).catch(() => {})` verschlucken Fehler stumm
  (`useLobby.js:28,45,53,77`).
- `ProfileModal.jsx:9-41` — Bild-Upload ohne Größen-/Typprüfung und ohne `reader.onerror`.

### 4.3 Konkrete Bugs

- **Mutation von Snapshot-Daten:** `WerBinIchEngine.jsx:176-178` macht nur eine flache
  Kopie (`{ ...gameState.playerState }`) und schreibt dann in
  `newPlayerState[targetId].guessed` — das mutiert das Objekt aus dem Firestore-Snapshot
  direkt. `WerwolfEngine.jsx:283` macht es an der analogen Stelle richtig (mit Kommentar
  „TIEFE KOPIE"), in `WerBinIch` fehlt die Korrektur.
- **`/default-avatar.png` existiert nicht.** `public/` enthält nur `icon.png`, `icons.svg`,
  `favicon.svg`, `manifest.json`. Der Pfad wird in `useAuth.js:36`, `useLobby.js:107,144,159`,
  `ProfileModal.jsx:55` und `AuthMenu.jsx:46` referenziert → 404 und kaputtes `<img>` für
  jeden Nutzer ohne eigenes Bild. `LobbyWaitingScreen.jsx:55` umgeht das mit einer
  expliziten Prüfung auf genau diesen String — der einzige Ort, an dem der Fallback klappt.
- **`lobby.settings.globalLeaderboard` ohne Optional Chaining** in `WerwolfEngine.jsx:653,704,740`,
  `StadtLandFlussEngine.jsx:573`, `WerBinIchEngine.jsx:221,615`, `CodenamesEngine.jsx:472` —
  wirft, sobald `settings` fehlt (alte Lobbys, oder wenn jemand das Feld überschreibt).
- **Fester 2,5-Sekunden-Sync** in `StadtLandFlussEngine.jsx:85`: der Host wartet pauschal,
  bis alle ihre Antworten hochgeladen haben. Auf langsamen Verbindungen gehen Antworten
  verloren.
- **Doppelte Rundenenden:** die Timer-Intervalle in `StadtLandFlussEngine.jsx:55` und `:32`
  arbeiten auf einem Closure-`gameState`; zwischen Ablauf und Phasenwechsel kann
  `triggerRoundEnd` mehrfach feuern.
- **`APP_VERSION = "v1.1.0"`** in `App.jsx:9` steht neben `"version": "0.0.0"` in
  `package.json` — zwei unabhängige, manuell gepflegte Wahrheiten.
- **Toter Code:** `src/App.css` (184 Zeilen) wird nirgends importiert, ebenso
  `src/assets/hero.png`, `react.svg`, `vite.svg`.
- **`README.md`** ist noch das unveränderte Vite-Template.

### 4.4 Hardcodierte Werte

- Firebase-Config komplett in `src/utils/firebase.js:10-17`.
- Punktetabellen (5/3/1, Werwolf 5/3/2) in jeder Engine einzeln.
- Wortlisten und Rollen in `constants/gameData.js` (immerhin zentral), die
  Stadt-Land-Fluss-Kategorien (`StadtLandFlussEngine.jsx:22`) und die VIP-Liste
  (`WerBinIchEngine.jsx:9`) dagegen inline in der jeweiligen Engine.
- Timer-Grenzen 30/240 s, Countdown 4000 ms, Sync-Delay 2500 ms, Avatar-Maxgröße 256 px,
  Codenames-Verteilung 9/8/7/1 — alles Magic Numbers.
- Der Fallback-Zweig `typeof __firebase_config !== 'undefined'` in `firebase.js:6`
  referenziert eine globale Variable, die im Projekt nirgends definiert wird — Rest aus
  einer anderen Ausführungsumgebung.

### 4.5 Sicherheit

| Punkt | Bewertung |
|---|---|
| Firebase Web-API-Key im Client | **Kein Fehler an sich** — der Key ist per Design öffentlich und identifiziert nur das Projekt. Die eigentliche Absicherung sind die Security Rules. |
| `.env` ist committed | Fehler. Die Datei steht in Git (`git ls-files` listet sie), aber **nicht** in `.gitignore`, und ihre Werte werden **nirgends gelesen** — `import.meta.env` kommt im Code nicht vor. Aktuell enthält sie nur die ohnehin öffentliche Config, aber die Gewohnheit ist gefährlich. |
| Keine `firestore.rules` im Repo | Der größte blinde Fleck. Der Sicherheitszustand des Projekts ist aus dem Code nicht feststellbar. |
| Autorität nur clientseitig | s. 3.4 — jeder Spieler kann jedes Lobby-Feld schreiben. |
| Geheimnisse im geteilten Dokument | s. 3.4 — alle Spiele sind per DevTools trivial zu brechen. |
| Fake-E-Mail-Auth | `useAuth.js:51-53` bildet Usernames auf `<name>@partybox.local` ab. Folgen: keine Passwort-Wiederherstellung möglich, keine Verifikation, und `registerWithUsername` meldet „Benutzername schon vergeben" — eine saubere User-Enumeration. Passwortregel ist nur Firebase-Default (6 Zeichen). |
| `registerWithUsername` bei nicht-anonymem User | `useAuth.js:59` — der ganze Body steht in `if (user && user.isAnonymous)`. Ist der User bereits eingeloggt, tut der Button nichts und meldet auch nichts. |
| Base64-Avatare in Firestore | `ProfileModal.jsx:33` speichert das Bild als data-URI im User-Dokument **und** kopiert es in jeden `players`-Eintrag jeder Lobby. 256 px JPEG q0.8 ≈ 10–30 KB base64 pro Spieler. Bei genug Spielern rückt das 1-MiB-Dokumentlimit von Firestore in Reichweite, und jeder Snapshot überträgt alle Bilder erneut. Firebase Storage wäre der richtige Ort. |
| Nutzereingaben ungefiltert | Nicknames, eigene Wörter, Kategorien werden ohne Längen- oder Inhaltsprüfung gespeichert und angezeigt. React escaped beim Rendern, XSS ist also unwahrscheinlich, aber Spam/Überlänge nicht abgefangen. |

### 4.6 Technische Schulden, die künftige Features bremsen

1. **Ein Dokument für alles.** Jedes neue Feature erweitert `gameState` im selben Doc.
   Firestore limitiert auf 1 MiB und ~1 Write/Sekunde pro Dokument — bei Spielen mit
   häufigen Updates (Live-Timer, Chat, Zeichnen) ist das die harte Grenze. Auch getrennte
   Sichtbarkeit ist strukturell unmöglich, solange alles in einem Dokument liegt.
2. **Kein Routing.** Ohne URL pro Lobby gibt es keine teilbaren Einladungslinks, keinen
   Zurück-Button, kein Deep-Linking in ein Spiel und keine sinnvolle Trennung von
   Lobby-Ansicht und Spiel-Ansicht.
3. **Prop-Drilling durch `GameRouter`.** Jede neue Engine braucht dieselben sechs Props;
   jede neue globale Fähigkeit muss durch zwei Ebenen durchgereicht werden.
4. **Kein Code-Splitting.** Alle fünf Engines und alle Wortlisten landen im Initial-Bundle
   (`GameRouter.jsx:7-11`, statische Imports). Bei aktuell ~4.400 Zeilen unkritisch, aber
   mit jedem weiteren Spiel schlechter.
5. **Keine Tests, keine Typen.** Die Spiellogik (Punktevergabe, Werwolf-Siegbedingungen,
   Codenames-Zugwechsel) ist reine Rechenlogik, die sich gut testen ließe — sie steckt aber
   in Render-Funktionen. Refactoring ohne Sicherheitsnetz ist entsprechend riskant.
6. **Keine Historie.** Es gibt keine `games`- oder `matches`-Collection; `scoreHistory` ist
   auf eine Lobby beschränkt und geht verloren, sobald die Lobby weg ist. Features wie
   Statistiken, Bestenlisten oder „letzte Partien" brauchen ein neues Datenmodell.
7. **Kein `serverTimestamp()`.** Alle Zeiten kommen von Client-Uhren.

---

## 5. Deployment

**Es gibt keins — jedenfalls nichts im Repository.**

| Aspekt | Stand |
|---|---|
| Hosting-Config | keine `firebase.json`, keine `.firebaserc`, kein `vercel.json`/`netlify.toml` |
| CI/CD | kein `.github/`, keine Pipeline-Datei |
| Env-Variablen | `.env` existiert, ist committed und wird nicht gelesen; Config steht hartcodiert im Quelltext. Kein `.env.example` |
| Build-Artefakt | `dist/` per `.gitignore` ausgeschlossen, `npm run build` erzeugt einen statischen Vite-Build |
| PWA | `public/manifest.json` mit `display: standalone` und `start_url: /` ist verlinkt, aber es fehlen `icons` im Manifest und ein Service Worker — installierbar ist die App damit nicht |
| Favicon | `index.html:5` deklariert `type="image/svg+xml"`, verweist aber auf `/icon.png` |
| Titel | `index.html` trägt noch `party-game` statt „Party Box" |

Ein Deploy passiert derzeit also manuell (vermutlich `firebase deploy` oder Drag-and-Drop
von `dist/`) und ist nirgends dokumentiert. Ohne `firebase.json` lassen sich Rules und
Indizes auch nicht per CLI ausrollen.

---

## 6. Priorisierte Liste — Risiken & Quick Wins

Nur benannt, nicht umgesetzt. Reihenfolge = Empfehlung fürs Angehen.

| # | Thema | Typ | Warum zuerst |
|---|---|---|---|
| 1 | **`firestore.rules` prüfen und ins Repo holen** (samt `firebase.json`) | Risiko | Der aktuelle Sicherheitszustand ist unbekannt. Steht dort `if true`, ist die gesamte Datenbank für jeden im Internet les- und schreibbar. Alles andere ist zweitrangig, bis das geklärt ist. |
| 2 | **`.env` aus Git entfernen und in `.gitignore` aufnehmen** — oder ganz löschen und die hartcodierte Config auf `import.meta.env` umstellen | Quick Win | 10 Minuten Arbeit. Aktuell stehen dort nur öffentliche Werte, aber die Datei ist eine gestellte Falle für den nächsten echten Secret. |
| 3 | **Geheime Spielinformation aus dem geteilten Dokument holen** (Subcollection `lobbies/{code}/secrets/{uid}` oder Cloud Function) | Risiko | Imposter, Werwolf, Codenames und Wer-bin-ich sind per DevTools vollständig lesbar. Das ist der einzige Punkt, der die Kernfunktion der Spiele betrifft. |
| 4 | **Lobby-Code-Kollision beim Erstellen abfangen** (`getDoc` vor `setDoc`, oder `runTransaction`) | Quick Win | Eine Zeile Prüfung verhindert, dass eine fremde laufende Lobby stillschweigend überschrieben wird. |
| 5 | **`/default-avatar.png` anlegen** (oder alle Referenzen auf den Initialen-Fallback umstellen) | Quick Win | Sichtbarer Fehler für jeden Nutzer ohne Profilbild, Aufwand ~15 Minuten. |
| 6 | **`players` von Read-Modify-Write auf Transactions/`arrayUnion` umstellen** | Risiko | Gleichzeitige Beitritte, Kicks und Punktevergaben verlieren heute Daten. Betrifft jede Lobby mit mehr als zwei aktiven Spielern. |
| 7 | **Presence/Disconnect-Handling + Cleanup verwaister Lobbys** (`lastSeen`-Feld, TTL-Job) | Schuld | Ghost-Spieler blockieren „alle bereit"-Gates; tote Lobbys sammeln sich unbegrenzt an und verkleinern zusätzlich den 4-Zeichen-Keyspace. |
| 8 | **Avatare nach Firebase Storage auslagern**, statt base64 im Dokument | Schuld | Entlastet jeden Snapshot um bis zu einige hundert KB und nimmt Druck vom 1-MiB-Dokumentlimit. |

Knapp darunter, falls Kapazität bleibt: gemeinsame `distributePoints`-Hilfsfunktion für die
vier duplizierten Implementierungen, Optional Chaining bei `lobby.settings`, die flache
Kopie in `WerBinIchEngine.jsx:176` reparieren, `README.md` ersetzen und ein erstes
Test-Setup für die reine Spiellogik.
