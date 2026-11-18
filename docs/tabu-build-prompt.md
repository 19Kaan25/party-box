# Auftrag: Spiel „Tabu" in PartyBox einbauen

Du baust das achte Minispiel **Tabu** in diese App. Lies zuerst
[CLAUDE.md](../CLAUDE.md) vollständig (Konventionen, Bridge, optimistische
Überlagerung, „alle Hooks ganz oben", deutsche UI/Kommentare, Lint-Baseline).
Deine Vorlage ist **Activity**, das jüngste Spiel:
[ActivityEngine.jsx](../src/games/ActivityEngine.jsx),
[ActivitySetup.jsx](../src/games/ActivitySetup.jsx),
[ActivityPanels.jsx](../src/games/ActivityPanels.jsx),
[activityLogic.js](../src/games/activityLogic.js),
[activityUi.js](../src/games/activityUi.js). Fast alles, was Tabu technisch
braucht, existiert dort schon: Teams, Timer in Serverzeit, Pause, Kartenstapel
mit Gedächtnis, Ergebnis-Verrechnung genau einmal, Regeln-Dialog, globale
Punkte. **Wiederverwenden statt neu schreiben** — gemeinsame reine Helfer
dürfen dafür aus `activityLogic.js` / `activityUi.js` importiert oder minimal
verallgemeinert werden (Activity darf sich dabei im Verhalten nicht ändern;
`node scripts/verify-activity-logic.mjs` muss grün bleiben).

Tabu in Activity ist **eine** Karte pro Versuch. Hier wird Tabu so gespielt,
wie man es kennt: **so viele Karten wie möglich in einer Runde**, Gegner
passen mit dem Buzzer auf. Dazu viele Einstellungen, damit jede Gruppe es
sich zurechtdrehen kann.

Arbeitsteilung: **Du programmierst und gestaltest selbst.** Subagenten
erzeugen nur die neuen Kartendaten (Abschnitt 3); weitere Subagenten nach
eigenem Ermessen (Abschnitt 5). Rückfragen an den Nutzer nur dort, wo dieser
Auftrag nichts festlegt.

Nicht committen, nicht pushen, nicht deployen — der Nutzer testet selbst und
entscheidet danach. Pantomime soll später ebenfalls ein eigenes Spiel werden;
baue dafür **nichts** vor.

## 1. So wird Tabu gespielt (Referenz)

- Zwei (oder mehr) Teams, abwechselnd am Zug. Pro Zug erklärt **ein**
  Teammitglied (der **Erklärer**, reihum), das eigene Team rät laut.
- Jede Karte: ein **Begriff** + **5 Tabu-Wörter**. Verboten sind der Begriff
  selbst, Wortteile, abgeleitete Formen und die Tabu-Wörter. Außerdem:
  Gesten, Geräusche, Reime/„klingt wie", Anfangsbuchstaben, Übersetzungen.
- Eine Sanduhr (ca. 1 Minute) läuft. Erraten → nächste Karte. Überspringen
  ist erlaubt.
- Ein Gegner schaut dem Erklärer über die Schulter und **buzzert**, sobald ein
  Tabu-Wort fällt — die Karte ist dann weg.
- Wertung: jede erratene Karte +1, jede gebuzzerte −1 (in vielen Runden auch
  übersprungene −1). Gespielt wird bis zu einer Zielpunktzahl oder einer
  festen Rundenzahl.

## 2. Wie das in der App aussieht (Entscheidungen — so umsetzen)

Jeder hat sein eigenes Handy, alle im selben Raum. **Geraten wird laut, nicht
per Texteingabe.** Der Erklärer tippt „Richtig" / „Überspringen", Aufpasser
tippen „Tabu!".

### 2a. Einstellungen (Setup, Host; vor jeder Partie änderbar)

Fett = Standard. Bau sie im Stil von `ActivitySetup.jsx` (Chips, Stepper,
Abschnitte mit Hinweistext).

| Einstellung | Werte |
|---|---|
| Spielmodus | **Teams** · Jeder gegen jeden (2b) |
| Teams | Anzahl **2**–4 (je ≥ 2 Personen), Zufall oder manuell — wie Activity |
| Rundenzeit | 30 · 45 · **60** · 90 · 120 s |
| Spielende | **Zielpunktzahl** (Stepper, Standard 30) · Rundenzahl (jeder Spieler erklärt N-mal, Standard 2) |
| Tabu-Wörter anzeigen | **5** · 3 · 0 („nur Begriff", für Anfänger/Kinder) |
| Schwierigkeit | Mischung **3/4/5** · nur leicht · nur mittel · nur schwer (Mehrfachauswahl wie die Kategorien) |
| Kategorien | alle aus Abschnitt 3, Mehrfachauswahl, Standard **alle** |
| Überspringen | **unbegrenzt** · Anzahl pro Zug (Stepper) · aus |
| Strafe Überspringen | **0** · −1 |
| Strafe Tabu | **−1** · 0 |
| Aufpasser (wer sieht die Karte und darf buzzern) | **Alle Gegner** · Ein Gegner reihum · Keiner („am Tisch" — Gegner schauen real aufs Handy, buzzern trotzdem) |
| Letzte Karte bei Zeitablauf | **verfällt** · Klauen: das nächste Team darf einmal raten, richtig = +1 für dieses Team |

Bei genau 3 Spielern ist „Jeder gegen jeden" fest gesetzt. Mindestzahl 3
(`MIN_PLAYERS`), Teams-Modus erst ab 4.

### 2b. Spielmodus „Jeder gegen jeden"

Kein Team. Der Erklärer wechselt reihum, **alle anderen** raten. Bei
„Richtig" tippt der Erklärer an, **wer** es erraten hat (Namensliste, große
Knöpfe) — Erklärer und Ratender bekommen je +1. Tabu/Überspringen-Strafen
treffen nur den Erklärer. Aufpasser = alle anderen. Dieselbe Spielende-Logik
(Zielpunktzahl gilt pro Person).

### 2c. Ablauf eines Zuges

1. **Bereit:** Alle sehen, welches Team dran ist und wer erklärt. Der Erklärer
   sieht „Los" (Begriff erst danach sichtbar, wie in Activity).
2. **Läuft:** 3-2-1-Countdown, dann Timer bei allen.
   - **Erklärer:** Karte groß (Begriff + Tabu-Wörter laut Einstellung), zwei
     riesige Knöpfe „Richtig" / „Überspringen", einhändig bedienbar. Zähler
     für Punkte dieses Zuges.
   - **Aufpasser:** dieselbe Karte, Knopf „Tabu!" (riesig, rot), Hinweis
     „Du passt auf — nicht mitraten".
   - **Ratende:** keine Karte; Timer, Erklärer, Punkte dieses Zuges, die
     Anzahl bereits erratener Karten.
   - Bei jedem Ergebnis kurzes Feedback bei allen (grün/gelb/rot aufblitzen).
     „Tabu!" zusätzlich mit kurzem Ton (Web Audio, kein Asset) und
     `navigator.vibrate`, wo verfügbar. Zeitablauf ebenfalls mit Ton.
3. **Zeit um:** letzte Karte nach Einstellung (verfällt / Klauen).
4. **Auswertung:** Liste aller Karten des Zuges mit Ergebnis (✓ / ↷ / ✗).
   **Host und Erklärer** können einzelne Einträge umschalten (falsch getippt,
   Buzzer zu Unrecht), dann „Weiter" → Punkte werden verbucht, nächstes Team.
   Alle sehen hier die Begriffe — das ist auch der Moment, in dem jedes Gerät
   sie sich merkt (Gedächtnis, 2e).
5. Spielende prüfen **nur am Ende eines vollen Umlaufs** (jedes Team gleich
   viele Züge), sonst hätte das erste Team einen Vorteil. Gleichstand =
   geteilter Platz (`rankOf`).

Pause (Host) wie in Activity: Restzeit speichern, nicht Endzeit. Ein
„?"-Regeln-Dialog im Spiel (Muster `RulesDialog`).

### 2d. Zustand und Gleichzeitigkeit (hier liegt die eigentliche Arbeit)

Anders als in Activity schreiben während eines Zuges **mehrere** Geräte
schnell hintereinander (Erklärer tippt, Aufpasser buzzern). Es gibt keine
Transaktionen; ein Patch auf denselben Pfad überschreibt. Vorgaben:

- **Kartenreihenfolge der Partie einmal beim Start ziehen** (Host), als Liste
  von Indizes in `gameState` — wie die Sätze in `SpruecheklopferEngine`, damit
  niemand pro Karte auf einen Roundtrip wartet. Ungesehene Karten des
  Host-Geräts zuerst (Gedächtnis, 2e). Ein Zeiger auf den Stapel wird erst
  bei der Auswertung um die verbrauchten Karten weitergerückt.
- Während des Zuges schreibt **nur der Erklärer** den Kartenfortschritt
  (`turn.results.{nr}` = `'OK' | 'SKIP' | 'TABU'`, ggf. wer geraten hat). Die
  aktuelle Karte ergibt sich aus der Anzahl der Einträge.
- Ein Aufpasser schreibt **nur** `turn.buzz.{nr}` (Kartennummer, die er
  gesehen hat). Der Erklärer-Client sieht den Buzzer und schließt genau diese
  Karte als `TABU` ab. Gehört der Buzzer zu einer Karte, die schon
  abgeschlossen ist, wird er ignoriert — so kann ein später Buzzer nie die
  falsche (nächste) Karte treffen. Tippt der Erklärer gleichzeitig
  „Richtig", gewinnt, was zuerst beim Erklärer-Client ankommt; die
  Auswertung (2c Schritt 4) korrigiert den Rest.
- Ergebnisse dürfen optimistisch erscheinen (keine Phasenwechsel). Bereit →
  Läuft → Auswertung → nächster Zug sind **gemeinsame Momente**: über
  `gameState.phase` bzw. das `writeSynced`-Muster aus Activity schreiben.
- Zeitablauf dürfen Host **und** Erklärer auslösen, die Auswertung verbucht
  nur der Host, genau einmal (Muster `turn.result` / `appliedN` in Activity).
- Verlässt der Erklärer die Lobby oder hängt sein Gerät: Host kann den Zug
  abbrechen (wie in Activity), Punkte bis dahin bleiben.

Die genaue Form von `gameState` entscheidest du; dokumentiere sie kurz in
`docs/codebase-overview.md` §2.2.

### 2e. Karten-Gedächtnis

Wie Activity (`seenWords` / `rememberWord`), aber mit eigenem Schlüssel
`tabu-seen-v1` und einer Grenze unter der Gesamtkartenzahl. Verallgemeinere
die Helfer in `activityUi.js` dafür minimal (Schlüssel + Grenze als
Parameter) statt sie zu kopieren.

### 2f. Punkte und Gestaltung

- Spielstand = Teampunkte (bzw. Personenpunkte). Am Ende globale Punkte 5/3/1
  für Platz 1–3 wie in Activity/Sprücheklopfer; alle Mitglieder eines Teams
  bekommen die Punkte ihres Teams.
- Ergebnisbildschirm: Platzierung, Punkte, „Beste Erklärer" (meiste
  erratene Karten pro Person, aus den Auswertungen mitgezählt), „Nochmal"
  (Einstellungen und Teams bleiben — `createRestartGameState`).
- Dunkles `slate-900`-Theme, `rounded-3xl`-Karten, Gradient-Buttons.
  Spielfarbe **`cyan`** (neu in der `colorMap` von `GameCard`; `lime` bleibt
  für Pantomime frei). Die Tabu-Karte selbst darf auffallen: Begriff groß
  oben, Tabu-Wörter in einem roten Block darunter.

## 3. Kartendaten

**Bestehende Karten wiederverwenden:**
[activityTabu.json](../src/constants/activityTabu.json) (216 Karten, 3
Kategorien `alltag`, `tiere_natur`, `freizeit_kultur`, je 72, Schwierigkeit
3/4/5, je 5 Tabu-Wörter). Tabu liest diese Datei mit; Activity bleibt
unverändert und nutzt die neuen Kategorien **nicht** (Malen/Pantomime haben
sie nicht).

**Neue Kategorien** in einer neuen Datei `src/constants/tabuCards.json`,
gleiches Schema (oberste Ebene = Kategorie-Schlüssel, Einträge
`{ word, difficulty: 3|4|5, forbidden: [5 Wörter] }`), **je 60 Karten (20 pro
Stufe)**:

| Schlüssel | Anzeigename | Inhalt |
|---|---|---|
| `film_musik` | Film, Serien & Musik | Filme, Serien, Genres, Instrumente, Bands-Begriffe, Kino |
| `sport_spiele` | Sport & Spiele | Sportarten, Ausrüstung, Brett-/Videospiele, Wettkampf |
| `wissen` | Schule & Wissen | Fächer, Naturwissenschaft, Geschichte, Erfindungen |
| `welt_reisen` | Länder & Reisen | Länder, Städte, Sehenswürdigkeiten, Urlaub, Verkehr |
| `technik` | Technik & Internet | Geräte, Apps, Internet, Social Media, Computer |
| `koerper_gefuehle` | Mensch & Gefühle | Körper, Gesundheit, Gefühle, Eigenschaften, Beziehungen |

Zusammen 576 Karten. Anzeigenamen für alle neun Kategorien in einer Tabu-
eigenen Namensliste (die drei alten Namen wie in `activityUi.js`).

**Drei Subagenten (Sonnet), parallel im Hintergrund, als Erstes starten.**
Jeder übernimmt zwei Kategorien und schreibt nur
`src/constants/tabu-parts/<schlüssel>.json` (eine Datei pro Kategorie); du
fügst sie danach zu `tabuCards.json` zusammen und löschst den Ordner. Gib
jedem die Regeln unten und die Liste aller vorhandenen Begriffe aus
`activityTabu.json` mit (Duplikatvermeidung).

**Qualitätsregeln:** Deutsch, jugendfrei, keine Beleidigungen, keine
Politik/Religion, keine realen lebenden Personen; Begriffe ein bis drei
Wörter, korrekte Groß-/Kleinschreibung, echte Umlaute. Genau **5
Tabu-Wörter**, einzelne Wörter, und zwar die naheliegendsten Umschreibungen —
die, die man als Erstes sagen würde. Keines darf den Begriff enthalten, in
ihm enthalten sein oder ein Wortteil/eine Ableitung sein; keine zwei
Tabu-Wörter einer Karte sind Varianten voneinander. Die **Reihenfolge** der
Tabu-Wörter: das naheliegendste zuerst (die Einstellung „3 Tabu-Wörter" zeigt
die ersten drei). 3 = jeder kennt es, 5 = anspruchsvoll, aber fair. Keine
Duplikate innerhalb der Datei und keine mit `activityTabu.json`.

Die vorhandenen Karten in `activityTabu.json` bleiben unangetastet, auch ohne
diese Reihenfolge (dort zeigt „3 Tabu-Wörter" einfach die ersten drei).

**Prüfskript:** erweitere [scripts/validate-activity-cards.mjs](../scripts/validate-activity-cards.mjs)
um `tabuCards.json` (Kategorien vollständig, 20 je Stufe, genau 5 Tabu-Wörter,
Teilwort-Prüfung, Duplikate auch gegen `activityTabu.json`) — oder ein
eigenes kleines Skript, falls das klarer ist. Agenten bessern nach, bis es
grün ist; danach prüfst du stichprobenartig selbst ein paar Karten.

## 4. Technische Anbindung — Checkliste

Bridge-Schreibweise `TABU`, Datenbank `tabu`. Orientiere dich an allem, was
`ACTIVITY` / `activity` tut:

- `src/games/TabuEngine.jsx` + nach Bedarf `TabuSetup.jsx`, `tabuLogic.js`
  (reine Logik: Wertung, Zugreihenfolge, Spielende, Erklärer-Rotation).
  Engine-Signatur wie die anderen, **alle Hooks ganz oben**.
- [GameRouter.jsx](../src/components/GameRouter.jsx): Import + `case 'TABU'`.
- [LobbyWaitingScreen.jsx](../src/components/lobby/LobbyWaitingScreen.jsx):
  neue `GameCard` + `cyan` in der `colorMap`.
- [GamePausedScreen.jsx](../src/components/lobby/GamePausedScreen.jsx):
  `GAME_NAMES`-Eintrag.
- [gameSetup.js](../src/constants/gameSetup.js): `createInitialGameState`,
  `createRestartGameState`.
- [useLobby.js](../src/hooks/useLobby.js): `GAME_KEY_TO_OLD`.
- **Zwei Migrationen**, Zeitstempel nach `20260809090100`:
  1. `alter type public.game_key add value if not exists 'tabu';` (eigene
     Datei, Begründung im Kopf von `20260809090000_game_key_activity.sql`)
  2. `legacy_apply_patch()` komplett aus
     `20260809090100_legacy_patch_activity.sql` übernehmen, nur
     `when 'TABU' then 'tabu'` ergänzen.
  **Nicht selbst anwenden.** Sag dem Nutzer, dass er
  `npx supabase db push --remote` ausführen muss, bevor das Spiel startbar ist.
  Tabelle in [supabase/README.md](../supabase/README.md) ergänzen.
- Docs: kurzer Abschnitt „Tabu" in [CLAUDE.md](../CLAUDE.md) (nur
  Nicht-Offensichtliches: Schreibrechte Erklärer/Aufpasser, Buzzer pro
  Kartennummer, Spielende nur am Umlaufende, Kartenquellen), Struktur-Liste
  dort und Spielliste in `docs/codebase-overview.md`.
- Lint-Baseline halten, keine neuen Pakete.

## 5. Subagenten

- **Pflicht:** die drei Kartenagenten aus Abschnitt 3.
- **Empfohlen am Ende:** ein read-only Review-Agent gegen die Checkliste aus
  Abschnitt 4, gezielt auf Hooks unterhalb eines `return`, Phasenwechsel ohne
  `gameState.phase`, doppelt verbuchbare Auswertungen und Buzzer, die eine
  falsche Karte treffen können.
- Alles Weitere nach eigenem Ermessen.

## 6. Tests

1. Kartenprüfskript grün, `node scripts/verify-activity-logic.mjs` grün.
2. Für `tabuLogic.js` ein kleines `scripts/verify-tabu-logic.mjs` (Wertung mit
   allen Strafen-Varianten, Spielende nur am Umlaufende, Gleichstand,
   Erklärer-Rotation, Jeder-gegen-jeden).
3. `npm run lint` (Baseline gehalten) und `npm run build`.
4. Browser (`preview_start` `partybox-dev`): mit dem Spielerlabor
   (`/?devLab=1`, 4 Spieler) einen Zug komplett durchspielen — Richtig,
   Überspringen, Tabu-Buzzer, Zeitablauf, Auswertung mit Korrektur. Geht nur,
   wenn der Nutzer die Migrationen schon angewendet hat; sonst frag danach
   oder lass den Schritt weg und sag es.

## 7. Abschlussbericht

Kurz und ehrlich: was gebaut ist, welche Migrationen der Nutzer noch
anwenden muss, welche Entscheidungen aus Abschnitt 2 du geändert oder
weggelassen hast und warum, die gewählte `gameState`-Form in drei Zeilen, und
was du **nicht** geprüft hast (insbesondere gleichzeitige Buzzer auf echten
Geräten).
