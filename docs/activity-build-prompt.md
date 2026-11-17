# Auftrag: Spiel „Activity" in PartyBox einbauen

Du baust das siebte Minispiel **Activity** in diese App. Lies zuerst
[CLAUDE.md](../CLAUDE.md) vollständig (Konventionen, Bridge, optimistische
Überlagerung, „alle Hooks ganz oben", deutsche UI/Kommentare) und danach
[src/games/SpruecheklopferEngine.jsx](../src/games/SpruecheklopferEngine.jsx) —
das jüngste Spiel und deine Vorlage für Aufbau und Stil.

Arbeitsteilung: **Du programmierst und gestaltest selbst** (Engine, Brett, UI,
Migrationen, Anbindung). **Subagenten erzeugen nur die Kartendaten** und
dürfen sonst nichts anfassen. Weitere Subagenten darfst du nach eigenem
Ermessen einsetzen, wo sie dir Zeit sparen (siehe „Subagenten").

Nicht committen, nicht pushen, nicht auf Firebase/Vercel deployen — der
Nutzer testet selbst und entscheidet danach.

## 1. So wird Activity gespielt (Referenz)

Mannschaftsspiel für 3–16 Personen im selben Raum. Ein Teammitglied (der
**Darsteller**) bringt seinem Team einen geheimen Begriff bei, ohne ihn zu
nennen; das Team rät laut. Pro Runde ist ein Team dran, der Darsteller
wechselt reihum. Erratene Begriffe bringen die Spielfigur des Teams auf dem
Spielplan voran; wer zuerst das Ziel erreicht, gewinnt.

Drei Darstellungsarten, die **Feldart** bestimmt, welche gilt:

| Art | Erlaubt | Verboten |
|---|---|---|
| **Zeichnen** | Zeichnung, Kopfnicken bei richtigen Wortteilen | Sprechen, Gesten, Buchstaben, Zahlen |
| **Pantomime** | nur der eigene Körper | Sprechen, Geräusche, Gegenstände benutzen oder auf sie zeigen |
| **Erklären** | Umschreiben mit Worten | den Begriff, Wortteile oder abgeleitete Formen nennen; in dieser App zusätzlich die **5 Tabu-Wörter** der Karte |

Weitere Regeln aus den Anleitungen:
- Zeit pro Versuch: **60 Sekunden** (Sanduhr).
- Der Darsteller wählt vor dem Ziehen eine **Schwierigkeit 3 / 4 / 5**;
  ein erratener Begriff zieht die Figur genau so viele Felder vor.
- **Offene Runde** (ein roter Begriff auf der Karte): alle Teams dürfen raten.
  Errät ein fremdes Team zuerst, zieht es 4 Felder und das Darsteller-Team 2;
  errät das eigene Team zuerst, zieht es 6. *(Zahlen aus einer
  Sekundärquelle, die Originalanleitung ließ sich nicht maschinell lesen —
  als Konstanten ganz oben in die Engine, damit sie leicht änderbar sind.)*
- Landet eine Figur auf dem Feld einer anderen, wandert diese **ein Feld
  zurück**.
- Regelverstoß (z. B. Wortteil genannt, Buchstabe gemalt, Ton bei der
  Pantomime) beendet den Versuch ohne Vorrücken; das nächste Team ist dran.
- **Drei Spieler:** jeder ist sein eigenes Team, es gibt nur offene Runden,
  Zurückschicken entfällt. *(Die App ändert das in Details, siehe 2d.)*
- Spielende: Ziel erreichen oder überschreiten. Die Schlussaufgabe des
  Originals (zwei Begriffe in Folge) lassen wir bewusst weg.

## 2. Wie das in der App aussieht (Entscheidungen — so umsetzen)

Jeder hat sein eigenes Handy, alle sitzen im selben Raum. **Geraten wird laut
im Raum, nicht per Texteingabe.** Den Begriff (und bei Erklären die
Tabu-Wörter) sieht der Darsteller und je nach Einstellung „Aufpasser" (siehe
2a) bestimmte Gegner; alle anderen sehen Brett, Feldart, Darsteller und
Timer. **Abschnitte 2a bis 2d sind genauso verbindlich wie 2** — sie
beschreiben Dinge, die beim Durchspielen sonst untergehen.

- **Setup (Host):** Teams bilden (2–4 Teams, je ≥ 2 Personen; per Zufall
  verteilen oder manuell, Muster: Team-Setup in `CodenamesEngine.jsx`),
  Kategorien wählen (Muster: Auswahl in `SpruecheklopferEngine.jsx` /
  `CategoryPicker.jsx`). Bei genau 3 Spielern entfällt die Teamwahl, es gilt
  der Drei-Spieler-Modus. Mindestzahl: 3 (`MIN_PLAYERS`). Weitere
  Einstellungen: **Aufpasser** (2a), **Begriff-Tausche** (2b Nr. 7), **Schiedsrichter** (2c: Host / Gruppe
  stimmt ab / aus), Zeit
  pro Versuch (45 / 60 / 90 s, Standard 60). Alle Einstellungen sind vor
  jeder Partie änderbar.
- **Spiellänge** (Setup): **Kurz = 3, Mittel = 4, Lang = 6 Bereiche** à 8
  Felder (24 / 32 / 48). Standard Lang, bei 3 Spielern Mittel (2d). Eine
  Partie mit 6 Bereichen dauert grob 45–60 Minuten — für Gruppen, die
  weniger Zeit haben, ist das der wichtigste Regler.
- **Spielplan:** bis zu 6 Bereiche × 8 Felder + Start + Ziel, als Schlangenpfad
  oder Ring in Tailwind/SVG, mobil gut lesbar. Pro Team eine farbige Figur,
  Felder nach Darstellungsart eingefärbt (Zeichnen / Pantomime / Erklären im
  gleichmäßigen Wechsel), Legende sichtbar. Der Plan ist der visuelle
  Mittelpunkt: Figuren bewegen sich sichtbar Feld für Feld.
- **Offene Runde:** statt einer roten Karte zieht jeder Versuch mit
  Wahrscheinlichkeit 1/6 einen offenen Begriff.
- **Ablauf einer Runde** (Phasennamen und Aufteilung entscheidest du):
  Darsteller wählt Schwierigkeit → sieht privat Begriff + Hinweis zur Feldart
  → tippt „Los" → 60 s Timer läuft bei allen → Darsteller tippt „Erraten"
  (bei offener Runde: welches Team zuerst) oder die Zeit läuft ab → Figur
  zieht, ggf. Rückschicken → nächstes Team. Regelverstöße meldet je nach
  Einstellung der Aufpasser bzw. jeder Gegner (Verfahren in 2a).
- **Timer:** gemeinsamer Startzeitpunkt im `gameState`, Restzeit pro Client
  mit `measureClockOffset()` aus [supabase.js](../src/lib/supabase.js)
  berechnet — schau, wie `ImposterEngine.jsx` das löst, und mach es
  genauso. Das Ablaufen auslösen darf Host **und** Darsteller (idempotent,
  Ref-Riegel wie in den anderen Engines), damit ein hängender Host das Spiel
  nicht blockiert.
- **Zeichnen:** eingebaute Zeichenfläche auf dem Handy des Darstellers
  (Finger, 4–5 Farben, Stiftdicke, Rückgängig, Alles löschen), die für alle
  anderen **live mitläuft**. Dafür **nicht** `gameState` verwenden — jeder
  Patch löst bei allen einen Refetch aus. Stattdessen ein ephemerer
  Supabase-Realtime-**Broadcast**-Kanal pro Lobby (Muster: wie
  [usePresence.js](../src/hooks/usePresence.js) einen Kanal nutzt), Striche
  gebündelt (~100 ms), Koordinaten auf 0–1 normiert, damit verschiedene
  Bildschirmgrößen passen. Keine Pointer-Bibliothek installieren — reine
  Pointer-Events + Canvas, wie `AvatarCropModal.jsx`. Die Regel „keine
  Buchstaben/Zahlen" lässt sich nicht technisch erzwingen, sie steht im
  Hinweis und der Regelverstoß-Knopf deckt sie ab.
- **Regeln-Dialog:** ein „?"-Knopf im Spiel mit den drei Tabellenzeilen oben
  in kurzem Deutsch.
- **Punkte:** Spielstand = Feldposition. Am Ende globale Punkte nach dem
  Muster, das `SpruecheklopferEngine` bei `RESULTS` für Platz 1–3 (5/3/1)
  verwendet — alle Mitglieder eines Teams bekommen die Punkte ihres Teams.
  Gäste gibt es hier nicht.
- **Gestaltung:** dunkles `slate-900`-Theme, `rounded-3xl`-Karten,
  Gradient-Buttons wie die anderen Spiele; Spielfarbe für die
  Spielekarte frei wählen (noch nicht vergeben: `orange`, `cyan`, `lime`).
  Große Touch-Ziele, die Darsteller-Ansicht muss auch bei laufendem Timer
  einhändig bedienbar sein.

## 2a. Aufpasser: wer prüft, dass der Darsteller sich an die Regeln hält?

Ohne Karte kann niemand sehen, ob der Erklärer ein Tabu-Wort sagt. Im echten
Spiel schaut jemand hinter dem Darsteller auf die Karte. Die App bildet das
als **Einstellung „Aufpasser"** im Setup ab (Host wählt, gilt für alle drei
Darstellungsarten; bei Zeichnen/Pantomime sieht der Aufpasser nur den
Begriff und prüft Wortteile, Buchstaben und ob „Erraten" ehrlich gedrückt
wurde):

| Wert | Wer sieht die Karte live | Hinweis |
|---|---|---|
| `NONE` „Am Tisch" | nur der Darsteller | Gegner schauen real über die Schulter; Regelverstoß-Knopf haben trotzdem alle Gegner |
| `OPPONENTS` „Alle Gegner" | alle Spieler außerhalb des Darsteller-Teams | **Standard** bei ≥ 2 Teams |
| `ONE_TEAM` „Ein Gegnerteam" | genau ein anderes Team, reihum | bei 2 Teams = `OPPONENTS` |
| `ONE_PLAYER` „Ein Aufpasser" | genau eine Person außerhalb des Darsteller-Teams, reihum gleichmäßig | im Versuch sichtbar, wer es ist |
| `REFEREE` „Spielleiter" *(nice-to-have)* | eine feste Person, die nicht mitspielt (Host wählt, wie der Erzähler im Werwolf) | zählt nicht für Teams; Mindestspielerzahl gilt für die übrigen |

Aufpasser-Ansicht: Begriff groß, bei Erklären die 5 Tabu-Wörter, Knopf
„Regelverstoß", Rollenhinweis „Du passt auf — nicht mitraten". Wer den
Begriff sieht, **darf nie mitraten**.

**Falle 1 — offene Runde:** Dort raten auch die Gegner. Wer die Karte sähe,
kennt die Lösung. Deshalb gilt in offenen Runden (außer `NONE`/`REFEREE`)
immer: **genau ein** Aufpasser aus den Gegnern sieht die Karte und rät
nicht mit, alle anderen Gegner sehen sie nicht.

**Falle 2 — Drei-Spieler-Modus:** Hier sind beide Mitspieler Gegner *und*
Rater. Die Lösung dafür steht in **2d** (dort durchgespielt) und ersetzt
jede abweichende Aussage in diesem Abschnitt.

**Zeichnen und Pantomime brauchen in offenen Runden keinen Aufpasser:**
Buchstaben auf der Zeichenfläche und Töne bei der Pantomime kann jeder
Gegner sehen bzw. hören, ohne den Begriff zu kennen. Nur bei **Erklären**
ist eine geheime Karte zum Prüfen nötig. Der Aufpasser mit Kartenansicht
gilt in offenen Runden also **nur für Erklären**; bei Zeichnen/Pantomime
meldet jeder Gegner, was er sieht oder hört (Verfahren unten).

**„Erraten" bestätigen** darf der Darsteller **oder** ein Aufpasser — beide
kennen den Begriff. Wichtig bei Pantomime: der Darsteller legt das Handy ab
und kommt nicht an den Knopf.

**Regelverstoß-Verfahren — eine Meldung beendet nie allein den Versuch.**
Ein einzelner Spaßvogel soll keinen Versuch abwürgen können. Dafür mehrere
Schichten, alle umsetzen:

1. **Meldung mit Grund.** Der Melder wählt einen Grund: bei Erklären tippt er
   das gefallene Tabu-Wort an (die 5 Wörter sind in seiner Aufpasser-Ansicht
   Tipp-Ziele) oder „Wortteil/abgeleitete Form"; sonst „Buchstabe/Zahl",
   „Ton/Sprechen", „Gegenstand", „Sonstiges". Das kostet ihn eine Sekunde und
   gibt allen konkrete Information statt eines anonymen Knopfdrucks.
2. **Timer pausiert** (Restzeit speichern, nicht die Endzeit), alle sehen
   „X meldet: *Grund*". Pro Versuch darf jeder **nur einmal** melden.
3. **Der Darsteller entscheidet:** „Stimmt" → Versuch endet, kein Vorrücken.
   „Stimmt nicht" → Timer läuft mit der Restzeit weiter, die Pause kostet
   das Team also nichts. Ein falscher Alarm schadet damit nur dem Melder.
4. **Einspruch** (je nach Schiedsrichter-Modus, 2c): Nach „Stimmt nicht"
   kann der Melder genau einmal Einspruch einlegen. In `HOST` entscheidet
   der Host (bindend, er kann auch jede Meldung jederzeit selbst
   entscheiden), in `VOTE` stimmt die Gruppe ab, in `OFF` gibt es keinen
   Einspruch — die Entscheidung des Darstellers gilt.
5. **Meldesperre:** Wird eine Meldung als unberechtigt entschieden (vom
   Darsteller mit „Stimmt nicht" ohne Einspruch oder vom Host), zählt das im
   `gameState` pro Spieler (`falseReports`). Bei **2** unberechtigten
   Meldungen verliert der Spieler das Melderecht für den Rest der Partie
   (der Aufpasser-Ansicht fehlt dann nur der Knopf, die Karte sieht er
   weiter). Aufheben oder Verhängen der Sperre gehört zu den Schiedsrichter-
   Werkzeugen (2c, nur in `HOST`/`VOTE`).

Unabhängig davon gilt: **Alles, was schiefgeht, kann der Host hinterher
korrigieren** (2c). Streitfälle klärt die Gruppe im Raum — die App liefert
nur Pause, Begründung und einen Entscheider, keine Beweisführung.

Wer Aufpasser ist, bestimmt **nur der Host-Client** beim Start des Versuchs
und schreibt es in den `gameState` — nie auf jedem Client einzeln auslosen.

## 2b. Durchgespielt: Randfälle, die du mitbauen musst

Beim gedanklichen Durchspielen zu dritt und mit 2–4 Teams fallen diese Punkte
auf. Setze sie um, soweit nicht ausdrücklich „nice-to-have":

1. **Gleichzeitige Aktionen.** „Erraten", Zeitablauf, Regelverstoß und Aufgeben
   können fast gleichzeitig von verschiedenen Clients kommen — es gibt
   keine Transaktionen. Jeder Versuch hat eine laufende Nummer; Ereignisse
   mit falscher Nummer werden verworfen, und **nur der Host** verrechnet das
   Ergebnis (Vorrücken, Rückschicken) genau einmal aus einem einzigen
   Ergebnisfeld. Sonst zieht eine Figur doppelt.
2. **Darsteller verschwindet** (App zu, Verbindung weg, Lobby verlassen,
   pausiert): Der Versuch darf das Spiel nicht blockieren. Host sieht einen
   Knopf „Versuch abbrechen", und fehlt der Darsteller (nicht mehr in
   `lobby.players` oder offline laut `onlineIds`), wird er automatisch
   übersprungen. Gleiches für Aufpasser (dann nächster Aufpasser).
3. **Spieler gehen/kommen in laufender Partie.** Teams dürfen schrumpfen;
   fehlende IDs ignorieren, Darsteller-Reihenfolge per Modulo über die
   *vorhandenen* Mitglieder. Fällt ein Team auf 0, wird es samt Figur
   entfernt; bleibt weniger als ein Gegner, beendet der Host mit
   Zwischenstand. **Nachzügler** kommen als Zuschauer rein (Brett + Timer,
   keine Rolle); der Host kann sie optional einem Team zuweisen.
4. **Host-Wechsel:** Alles Wichtige steht im `gameState` (inkl. Endzeitpunkt,
   Aufpasser, Versuchsnummer) und nichts nur im Host-Speicher, damit ein neuer
   Host nahtlos weitermacht.
5. **Reload/Reconnect mitten im Versuch:** Die Ansicht jedes Clients muss sich
   aus dem `gameState` rekonstruieren lassen. Die Zeichnung ist flüchtig (nur
   Broadcast): Ein Betrachter, der neu lädt oder später einsteigt, fordert
   per Broadcast den vollständigen Strichstand an, der Darsteller sendet ihn.
   Lädt der Darsteller selbst neu, ist die Zeichnung weg — akzeptiert, kurzer
   Hinweis genügt.
6. **Kartenstapel:** Pro Darstellungsart, Kategorie und Schwierigkeit einmal
   beim Start mischen und nur die Indizes samt Zeiger im `gameState` halten
   (nicht die Karten). Kein Begriff kommt in einer Partie zweimal; ist ein
   Stapel leer, neu mischen ohne sofortige Wiederholung.
7. **Begriff tauschen („Skips"), Einstellung im Setup:** Der Host legt vorher
   fest, wie oft getauscht werden darf: `0`, `2`, `5` oder `unbegrenzt`
   (Standard `2`; Auswahl als Chips). Das Budget gilt **pro Team für die
   ganze Partie** und wird im `gameState` geführt; alle sehen „Tausche übrig:
   n" (bei `unbegrenzt` ∞). Ein Tausch zieht einen neuen Begriff derselben
   Darstellungsart und Schwierigkeit und ist **vor „Los" und bei laufendem
   Timer** möglich — der Timer läuft bei einem Tausch weiter. Bei Zeichnen
   leert ein Tausch die Zeichenfläche (Broadcast „clear"), und der Aufpasser
   sieht sofort die neue Karte. Ist das Budget leer, ist der Knopf
   deaktiviert und sagt warum. Nicht jeder Begriff ist darstellbar — deshalb
   gibt es das überhaupt. Getauschte Begriffe kommen in dieser Partie nicht
   wieder. **„Aufgeben"** (unabhängig vom Tausch-Budget) beendet den Versuch
   ohne Vorrücken.
8. **Begriff abschirmen:** Der Begriff erscheint erst nach Tipp auf „Begriff
   anzeigen", damit niemand beim Weiterreichen oder Wählen der Schwierigkeit
   mitliest. Vor „Los" läuft keine Zeit (Lesezeit ist kostenlos); das „Los"
   startet bei allen einen kurzen 3-2-1-Countdown, dann den Timer.
9. **Handy schläft ein:** Beim Pantomimen berührt der Darsteller 60 Sekunden
   lang das Display nicht. Während des Versuchs bei allen Clients die
   Screen-Wake-Lock-API anfordern (`navigator.wakeLock`, mit try/catch,
   Fehler still ignorieren).
10. **Stumm bleiben:** Keine Töne, keine Vibration — in der Pantomime ist jedes
    Geräusch ein Regelverstoß. Ablauf des Timers nur visuell (Farbwechsel in
    den letzten 10 Sekunden).
11. **Zeichnen auf dem Handy:** `touch-action: none` und Auswahl/Kontextmenü
    sperren, sonst scrollt die Seite beim Malen oder Pull-to-Refresh schlägt
    zu. Zeichenfläche so groß wie möglich, Werkzeugleiste klein.
12. **Rollenhinweis für jeden, immer:** Ein deutliches Banner sagt, was man
    gerade ist: „Du bist dran", „Du rätst mit", „Du passt auf", „Du rätst
    nicht mit (Aufpasser)", „Warte, Team Blau ist dran". Dazu immer
    sichtbar: Team am Zug, Darsteller, Darstellungsart, Timer.
13. **Nicht nur Farbe:** Feldarten und Teams brauchen Symbol/Text neben der
    Farbe (Farbfehlsichtigkeit), Teams heißen „Team Rot/Blau/Grün/Gelb".
14. **Auflösung nach jedem Versuch:** Der Begriff wird allen kurz gezeigt
    (auch bei Misserfolg — sonst bleibt die Neugier), bei Zeichnen mit dem
    Endbild des Betrachterpuffers.
15. **Offene Runde:** Der Darsteller wählt, welches Team zuerst geraten hat
    (Team-Picker mit Teamfarben; nur mit der Option „niemand"). Im
    Drei-Spieler-Modus wählt er den Spieler (siehe 2d für Zeichnen/Pantomime;
    bei Erklären mit Aufpasser gibt es nur einen Rater, ein Knopf „Erraten"
    genügt). Der Aufpasser darf das ebenfalls auslösen.
16. **Rückschicken:** Mehrere Figuren dürfen auf einem Feld stehen. Zurückgeschickt
    wird nur ein Fremdteam auf dem Zielfeld, **nie** auf dem Startfeld und
    **ohne Kettenreaktion**; unter dem Startfeld geht es nicht.
17. **Darsteller-Reihenfolge:** Jedes Team hat einen eigenen Zähler, damit bei
    ungleich großen Teams jeder gleich oft dran ist.
18. **Team-Validierung im Setup:** Start sperren mit sichtbarer Begründung,
    solange ein Team < 2 Mitglieder hat oder jemand keinem Team zugeordnet
    ist. Ändert sich die Kopfzahl, verteilt „Neu mischen" neu.
19. **Neustart** („Spiel neu starten") behält Teams und Einstellungen und
    verwirft Stapel, Positionen, Versuche (`createRestartGameState`).
20. **Spielende:** Der Gewinner ist das Team, das zuerst Ziel erreicht oder
    überschreitet, die übrigen Plätze nach Feldposition, Gleichstand teilt
    den Platz (`rankOf()` wie im Sprücheklopfer).21. **Regeln-Dialog** erklärt auch die Aufpasser-Rolle und was „Regelverstoß"
    bedeutet; die Darsteller-Bereitschaftsansicht zeigt eine Zeile mit den
    Regeln der aktuellen Darstellungsart („Pantomime: kein Ton, keine
    Gegenstände").

**Nice-to-have, nur wenn Zeit bleibt:** Spielleiter-Modus `REFEREE`,
Nachzügler per Host einem Team zuweisen.

## 2c. Der Host als Schiedsrichter: Korrektur statt Vertrauen

Trolling, Fehlklicks („falsches Team zuerst erraten"), ein Streit um eine
Meldung oder ein Absturz mitten im Zug lassen sich nicht alle verhindern.
Deshalb bekommt der Host ein **Schiedsrichter-Werkzeug**, das nur er sieht
(kleiner Hammer-Knopf in der Spielansicht, öffnet ein Panel/Sheet), und das
Spiel führt dafür ein **Protokoll**.

**Wie viel Macht der Host hat, stellt die Gruppe vorher ein** — Setup-Einstellung
`refereeMode` „Schiedsrichter", änderbar vor jeder Partie. Gedacht ist das
Spiel für Freunde im selben Raum, nicht für Wettkampf; der Modus regelt nur,
*wer* bei Streit oder Fehlklick das letzte Wort hat:

| Wert | Wer entscheidet | Standard |
|---|---|---|
| `HOST` „Host entscheidet" | der Host direkt, alle Werkzeuge unten | **ja** |
| `VOTE` „Gruppe stimmt ab" | die Werkzeuge bleiben dieselben, aber jede **Korrektur** und jeder **Einspruch** wird als Vorschlag allen angezeigt und gilt erst mit einfacher Mehrheit aller aktiven Spieler (Ja/Nein, Gleichstand = bleibt wie es ist) | |
| `OFF` „Kein Schiedsrichter" | niemand: der Darsteller entscheidet über Meldungen endgültig, der Einspruch-Knopf entfällt, kein Korrekturwerkzeug | |

**Technische Notfälle gehören in jedem Modus dem Host allein** und sind keine
Machtfrage: hängenden Versuch abbrechen, Pause/Fortsetzen, Spielende, wenn
kein Gegner mehr übrig ist (2b Nr. 2 und 3). Ohne diese Ausnahme könnte ein
weggebrochener Darsteller im Modus `OFF` das ganze Spiel blockieren.

`VOTE` einfach halten: **ein** generischer Mechanismus
`gameState.proposal = { id, kind, payload, by, votes }` für alle
Abstimmungen (kein eigener Code pro Werkzeug). Der Vorschlagende stimmt
automatisch mit Ja, der Host wendet das Ergebnis an, sobald die Mehrheit
steht (oder nicht mehr erreichbar ist), und löscht den Vorschlag. Es gibt
immer nur einen offenen Vorschlag gleichzeitig; ein zweiter wartet. Der
Abstimmungsdialog muss auch für den Vorschlagenden und den Host sichtbar sein
und blockiert das Spiel nicht (Timer pausiert nur, wenn es um eine
Meldung im laufenden Versuch geht).

**Protokoll:** In `gameState.history` steht pro abgeschlossenem Versuch ein
Eintrag mit Nummer, Team, Darsteller, Darstellungsart, Begriff, Ergebnis
(`erraten` / `zeit` / `regelverstoss` / `aufgegeben` / `abgebrochen`), bei
offener Runde das erratende Team, den Positionen **vor** dem Versuch und den
Meldungen (wer, Grund, wie entschieden). Auf die letzten ~20 Einträge
begrenzen, damit der `gameState` klein bleibt.

**Was der Host darf** (in `HOST` sofort, in `VOTE` nach Abstimmung, in `OFF`
nichts davon außer den Notfällen oben; immer für alle sichtbar):
- **Ergebnis des letzten Versuchs ändern:** Erraten / nicht erraten /
  Regelverstoß (bei offener Runde: welches Team). Die App stellt die
  Positionen auf den gespeicherten Stand vor dem Versuch zurück und
  verrechnet das neue Ergebnis neu, inklusive Rückschicken. Mehr als den
  letzten Versuch zurückzudrehen ist *nice-to-have*; mit der Positionsanpassung
  (nächster Punkt) ist jeder Fehler ohnehin behebbar.
- **Felder per Hand anpassen:** Pro Team +1/−1 oder direkt setzen — die
  Notbremse für alles, was sonst keinen Knopf hat („Punkte geben/abziehen").
- **Laufenden Versuch pausieren/fortsetzen/abbrechen** (auch bei hängendem
  Darsteller, siehe 2b Nr. 2).
- **Offene Meldungen entscheiden** (Verfahren 2a, Punkt 4).
- **Melderecht entziehen oder zurückgeben** pro Spieler.
- **Tausch-Budget** eines Teams um ±1 ändern.

Jede dieser Aktionen schreibt einen Eintrag ins Protokoll („Host hat
Ergebnis geändert"), damit die Gruppe nachvollziehen kann, was passiert ist.
Nur der Host-Client führt sie aus (`if (!isHost) return;`, wie überall — das
ist keine Sicherheitsgrenze, s. CLAUDE.md). Nach einem Host-Wechsel besitzt
der neue Host diese Rechte automatisch.

**Ehrliche Grenze:** Ist der Host selbst Darsteller oder Melder, ist er
befangen; die App bildet das nicht ab (Freundeskreis). Das Panel zeigt in
dem Fall einen neutralen Hinweis „Du bist beteiligt".

## 2d. Drei-Spieler-Modus, durchgespielt (ersetzt die Drei-Spieler-Zeilen oben)

Die Kernidee „jeder ist ein Team mit einem Mitglied" trägt, aber die
unveränderte Originalregel (nur offene Runden, 4/2 Felder) geht beim
Durchspielen an drei Stellen nicht auf. So wird es gebaut:

1. **Schwierigkeit muss etwas bedeuten.** Mit festen 4/2 Feldern wählt jeder
   Darsteller immer die leichteste Stufe 3 — die Wahl wäre sinnlos. Darum
   im Drei-Spieler-Modus: **Rater bekommt die gewählte Stufe (3/4/5), der
   Darsteller `Stufe − 1`** (also 2/3/4). Beide profitieren von einem
   erratenen Begriff, die Wahl bleibt ein echtes Risiko. Als Konstanten
   oben in die Engine. (In Team-Partien bleiben die Zahlen 4/2/6 der
   offenen Runde wie in 1.)
2. **Erklären (Tabu) prüft ein Aufpasser, die anderen Arten nicht.** Zu dritt
   sind beide Gegner auch Rater — wer die Karte sähe, kennt die Lösung.
   - **Erklären** mit Aufpasser ≠ `NONE`: Von den zwei Mitspielern ist einer
     **alleiniger Rater**, der andere **Aufpasser** (sieht die Karte, rät
     nicht mit). Die Rollen wechseln so, dass über eine Runde jeder gleich
     oft Rater und Aufpasser war (Zähler pro Spieler im `gameState`).
   - **Zeichnen und Pantomime:** **beide raten**, wer zuerst richtig liegt,
     bekommt die Felder — ein Wettlauf, das ist der spaßigste Teil. Verstöße
     (Buchstaben, Ton, Gegenstand) sehen und hören beide ohnehin, jeder darf
     melden (Verfahren 2a).
   - Aufpasser `NONE`: bei Erklären raten beide, geprüft wird nicht (Ehrensache).
3. **Der Aufpasser darf nicht nur zuschauen.** Sonst ist ein Drittel jeder
   Runde Leerlauf. Er bekommt **+1 Feld**, wenn der Versuch durch Zeitablauf
   oder einen bestätigten Regelverstoß scheitert (nicht bei Aufgeben oder
   Abbruch). Konstante `WATCHER_BONUS`. So lohnt sich genaues Hinsehen, und
   das Duo hat einen Gegenspieler. Der Bonus gilt nur, wenn es im Zug
   überhaupt einen Aufpasser gab.
4. **Spiellänge:** Standard **Mittel (4 Bereiche)**, sonst dauert die Partie
   zu dritt rund eine Stunde. Das Zurückschicken entfällt wie im Original.
5. **Namen statt Teamnamen.** Zu dritt gibt es keine Teams im UI: jeder
   Spieler hat Farbe + eigenen Anzeigenamen („Anna · Rot"), „Team Rot"
   erscheint nur ab vier Spielern. Das Tausch-Budget gilt dann **pro Spieler**.
6. **Fällt jemand weg** (Verbindung, Lobby verlassen) und es sind nur noch
   zwei: **nicht beenden, sondern pausieren** („Warte auf einen dritten
   Spieler") — die Person kommt oft sofort zurück. Der Host darf mit
   Zwischenstand beenden. Gleiches gilt für Team-Partien, wenn nur noch ein
   Team übrig ist.
7. **Aufpasserkarte abschirmen:** Wer Aufpasser ist, sitzt direkt neben dem
   Rater. Die Ansicht zeigt einmalig den Hinweis „Handy abschirmen —
   der Rater darf nicht mitlesen".
8. **Der Sieger endet sofort**, auch wenn nicht alle gleich oft Darsteller
   waren. Das ist bei einem Wettlauf über viele Runden egal und einfacher.

**Standardwerte bei 3 Spielern:** Aufpasser an (der Alleinrater/Aufpasser-
Wechsel aus Punkt 2), Spiellänge Mittel, Schiedsrichter `HOST`.

## 3. Kartendaten — Aufgabe für Subagenten

**Drei Subagenten, parallel und im Hintergrund, starte sie als Erstes**,
bevor du selbst programmierst. Jeder schreibt genau **eine** Datei, damit
sich nichts überschneidet. Gib jedem das Schema und die Qualitätsregeln
unten wörtlich mit. Modell: Sonnet reicht.

**Kategorien (3, Schlüssel fest):**

| Schlüssel | Anzeigename | Inhalt |
|---|---|---|
| `alltag` | Alltag & Essen | Haushalt, Essen, Berufe, Orte, Verkehr |
| `tiere_natur` | Tiere & Natur | Tiere, Pflanzen, Wetter, Landschaft |
| `freizeit_kultur` | Freizeit & Kultur | Sport, Hobbys, Filme, Musik, Feste |

**Schwierigkeit** ist 3, 4 oder 5 (= Felder, die der Begriff wert ist), gleich
viele pro Stufe. 3 = jeder kennt es / leicht, 5 = anspruchsvoll, aber fair.

| Datei | Inhalt | Umfang je Kategorie |
|---|---|---|
| `src/constants/activityTabu.json` | Erklären-Karten | 36 (je 12 pro Stufe) |
| `src/constants/activityMalen.json` | Zeichnen-Begriffe | 45 (je 15 pro Stufe) |
| `src/constants/activityPantomime.json` | Pantomime-Begriffe | 45 (je 15 pro Stufe) |

**Schema** (oberste Ebene = Kategorie-Schlüssel):

```json
{ "alltag": [ { "word": "Hund", "difficulty": 3, "forbidden": ["Bellen", "Haustier", "Gassi", "Leine", "Knochen"] } ] }
```

Malen und Pantomime ohne `forbidden`, nur `word` + `difficulty`.

**Qualitätsregeln, für alle Dateien:** Deutsch, jugendfrei, keine Beleidigungen
oder Politik/Religion; Begriffe ein bis drei Wörter; **keine Duplikate**
innerhalb einer Datei und möglichst keine zwischen den drei Dateien;
Schreibweise mit korrekter Groß-/Kleinschreibung, Umlaute als echte Zeichen.

**Tabu (Erklären):** genau **5 Tabu-Wörter** pro Karte, einzelne Wörter, die
die naheliegendsten Umschreibungen sind — also genau die, die man als Erstes
sagen würde. Keines davon darf den Begriff enthalten, in ihm enthalten sein
oder ein Wortteil/eine abgeleitete Form sein (bei „Hund" kein „Hundehütte",
bei „Zahnarzt" kein „Zahn"). Keine zwei Tabu-Wörter einer Karte dürfen
Varianten voneinander sein.

**Malen:** sichtbar und mit Strichen darstellbar, auch ohne Buchstaben. Keine
reinen Abstrakta („Gerechtigkeit"), außer es gibt ein verbreitetes Bild dafür.
Stufe 3 = ein Gegenstand/Tier („Sonne"), Stufe 5 = Szene oder Zusammensetzung
(„Zahnarztbesuch").

**Pantomime:** **ohne Requisiten und ohne Ton** darstellbar — Handlungen,
Berufe, Tiere, Emotionen, Sportarten. Keine Begriffe, die nur über Sprache
oder ein Geräusch erkennbar sind („Telefonklingeln").

**Prüfskript (machst du):** schreibe `scripts/validate-activity-cards.mjs`,
das alle drei Dateien prüft (Kategorien vollständig, Anzahl je Stufe, genau
5 Tabu-Wörter, Tabu-Wörter nicht im Begriff enthalten und umgekehrt,
Duplikate). Lass die Agenten fehlerhafte Einträge nachbessern, bis es grün
ist. Danach prüfst du stichprobenartig selbst ein paar Tabu-Karten auf
Sinnhaftigkeit.

## 4. Technische Anbindung — Checkliste

Das neue Spiel heißt `ACTIVITY` (Bridge-Schreibweise) / `activity` (Datenbank).
Orientiere dich an allem, was `SPRUECHE_KLOPFER` / `sprueche_klopfer` tut:

- `src/games/ActivityEngine.jsx` (neu, ggf. aufgeteilt in Brett-, Zeichen- und
  Setup-Komponenten; Engine-Signatur wie in den anderen). **Alle Hooks ganz
  oben.** Phasenwechsel über `gameState.phase` (nicht optimistisch, siehe
  `isSyncedMoment`).
- [GameRouter.jsx](../src/components/GameRouter.jsx): Import + `case 'ACTIVITY'`.
- [LobbyWaitingScreen.jsx](../src/components/lobby/LobbyWaitingScreen.jsx):
  neue `GameCard` und neuer Eintrag in der `colorMap` von `GameCard`.
- [GamePausedScreen.jsx](../src/components/lobby/GamePausedScreen.jsx):
  `GAME_NAMES`-Eintrag.
- [gameSetup.js](../src/constants/gameSetup.js): `createInitialGameState` und
  — falls Teams/Einstellungen den Neustart überleben sollen —
  `createRestartGameState`.
- [useLobby.js](../src/hooks/useLobby.js): `GAME_KEY_TO_OLD`.
- **Zwei neue Migrationen**, in genau dieser Aufteilung (Begründung steht im
  Kopf von `20260805090000_game_key_sprueche_klopfer.sql`):
  1. `alter type public.game_key add value if not exists 'activity';`
  2. `legacy_apply_patch()` komplett neu anlegen — Ausgangspunkt ist die
     aktuelle Fassung in `20260805090100_legacy_patch_sprueche_klopfer.sql`,
     dazu die Zeile `when 'ACTIVITY' then 'activity'`. Sonst nichts ändern.
  Dateinamen mit Zeitstempel nach der letzten vorhandenen Migration. Anwenden
  wie in [supabase/README.md](../supabase/README.md) beschrieben
  (`npx supabase db push`; die Migrationen sind rein additiv, aber die lokale
  Entwicklung schreibt in die Produktions-DB — sag im Abschlussbericht
  ausdrücklich, dass du sie angewendet hast). Tabelle in `supabase/README.md`
  um die beiden Dateien ergänzen.
- Docs: kurzer Abschnitt „Activity" in [CLAUDE.md](../CLAUDE.md) (nur das
  Nicht-Offensichtliche: Broadcast statt `gameState` fürs Zeichnen, Konstanten
  der offenen Runde, Datenschema) und die Spielliste in
  `docs/codebase-overview.md`.
- Lint-Baseline halten (siehe CLAUDE.md), keine neuen Pakete.

## 5. Subagenten

- **Pflicht:** die drei Kartenagenten aus Abschnitt 3.
- **Empfohlen, parallel zu den Kartenagenten:** ein read-only
  Explore-Agent, der dir in unter 40 Zeilen berichtet, wie
  `CodenamesEngine` Teams aufbaut, wie `ImposterEngine` den Timer synchron
  hält und wie `SpruecheklopferEngine` globale Punkte vergibt — spart dir
  das Durchlesen dreier großer Dateien.
- **Empfohlen am Ende:** ein Review-Agent (read-only), der gegen die
  Checkliste aus Abschnitt 4 prüft, ob keine Anbindungsstelle fehlt, und
  gezielt nach Hooks unterhalb eines `return`, Phasenwechseln ohne
  `gameState.phase` und doppelt auslösbaren Aktionen sucht.
- Alles Weitere nach eigenem Ermessen.

## 6. Tests — bewusst nur ein schneller Rauchtest

Der Nutzer testet das Spiel danach ausführlich selbst. Du prüfst nur:

1. `node scripts/validate-activity-cards.mjs` grün.
2. `npm run lint` (Baseline gehalten) und `npm run build` laufen durch.
3. Ein Blick im Browser (`preview_start` `partybox-dev`): Lobby anlegen,
   Activity starten, Setup- und Brettansicht rendern ohne Konsolenfehler.
   Mehr nicht — keine Mehrspieler-Durchläufe (das Spielerlabor
   `src/components/dev` darfst du dafür nur nutzen, wenn es ohne Aufwand geht).

## 7. Abschlussbericht

Kurz und ehrlich: was gebaut ist, welche Migrationen du auf die DB angewendet
hast, welche Entscheidungen aus Abschnitt 2 bis 2c du verändert oder
weggelassen hast und warum, was
du **nicht** geprüft hast (insbesondere Zeichen-Livesync auf echten
Geräten und mehrere Spieler gleichzeitig) und welche Regelwerte unsicher sind.
