# Bekannte Probleme

Vermessene, aber bewusst nicht behobene Punkte. Zweck: die Design-Phase soll
nicht neu ausmessen müssen, was hier schon belegt ist.

---

## 1. Spielerliste: Namen wurden auf 0 px gequetscht — GELÖST in Phase 0c

**Datei:** [src/components/lobby/LobbyWaitingScreen.jsx](../src/components/lobby/LobbyWaitingScreen.jsx),
Spielerzeile (`div.space-y-3 > div`)

**Symptom (behoben):** In der Lobby-Spielerliste war der Spielername
unsichtbar. Der Text stand korrekt im DOM (`"Anna"`, `"Ben"`) und die
Barrierefreiheits-Struktur las ihn vor — er hatte nur keine Breite. Bei der
eigenen Zeile blieb ein Rest von ~10 px, bei fremden Zeilen 0 px.

**Lösung:** `flex-wrap` auf der Zeile, `basis-full` auf dem linken Block
(Avatar + Name bekommen eine eigene Zeile) **plus** `overflow-wrap: anywhere`
statt `truncate` am Namen. Der zweite Teil ist nötig: bei 20 Zeichen reicht
auch die volle Zeilenbreite nicht, der Name muss umbrechen dürfen.

Gemessen nach der Umstellung, Viewport 1280×900:

| Name | vorher | nachher |
|---|---|---|
| `Carl` | — | 32 px, eine Zeile, vollständig |
| `Bartholomaeus-Anna12` (20 Zeichen) | abgeschnitten | 145 px über zwei Zeilen, vollständig |

Die Messung erfolgte über `scrollWidth <= clientWidth`, nicht per Augenschein.

Die Zahlen unten bleiben stehen, weil sie erklären, **warum** es zweizeilig
sein muss — eine einzeilige Lösung ist bei dieser Spaltenbreite rechnerisch
unmöglich.

### Gemessene Zahlen (Viewport 1280×900, `lg`-Layout)

| Größe | Wert |
|---|---|
| Zeilenbreite gesamt | **227 px** |
| davon Padding (`p-4`, links+rechts) | 32 px |
| davon Gap (`gap-4`) | 16 px |
| **verfügbare Inhaltsbreite** | **179 px** |
| rechter Block (`shrink-0`) | **149 px** |
| — Punkte-Badge (`whitespace-nowrap`) | 58 px |
| — Buttons Partyleiter/Rauswerfen + Trenner | 71 px |
| — Gap dazwischen | 12 px |
| **Rest für Avatar + Name** | **30 px** |
| Avatar (`w-9`, `shrink-0`) | 36 px |

Der linke Block bekommt also **weniger Platz, als der Avatar allein braucht**.
Für den Namen bleiben 0 px.

### Was geprüft wurde und nicht funktioniert

- **`min-w-0` auf dem Namens-Container und/oder dem Span** — wirkungslos.
  Gemessen nach der Änderung: unverändert 10 px bzw. 0 px. `min-w-0` erlaubt
  einem Flex-Element zu schrumpfen; es schafft keinen Platz.
- **`shrink-0` vom rechten Block entfernen** — hilft nur der Host-Zeile
  (linker Block 30 → 89 px), weil dort die beiden Buttons fehlen. Der Name
  blieb trotzdem bei 10 px, weil das `(Du)`-Label ~25 px + 6 px Gap belegt.
  Fremde Zeilen blieben unverändert bei 149 px rechts.
- **Rechnerische Untergrenze einzeilig:** Punkte-Badge (58, `nowrap`) +
  Buttons (71) = 129 px Minimum rechts, also 50 px links, davon 48 px für
  Avatar + Gap. **Eine einzeilige Lösung ist bei 227 px nicht möglich**,
  solange Avatar, Punkte und beide Buttons in einer Zeile stehen.

### Was funktioniert (belegt)

`flex-wrap` auf der Zeile plus `basis-full` auf dem linken Block — der Name
bekommt eine eigene Zeile:

| Name | Breite vorher | Breite nachher |
|---|---|---|
| `Clara` | 10 px | 41 px |
| `Maximilian` | 0 px | 83 px |

**Kosten:** Zeilenhöhe steigt von ~58 px auf ~115 px, die Spielerkarte wird
also etwa doppelt so hoch. Das ist eine sichtbare Design-Entscheidung und
wurde deshalb nicht einseitig umgesetzt.

### Verworfene Alternativen

2. Spielerspalte im Grid verbreitern — aktuell `lg:col-span-1` von
   `lg:grid-cols-3` innerhalb `max-w-4xl`. Verworfen: der Spielekatalog
   würde schmaler, und bei 20 Zeichen bräuchte es trotzdem den Umbruch.
3. Punkte-Badge oder Host-Buttons anders unterbringen (Kontextmenü, nur bei
   Hover, kompaktere Darstellung). Nicht weiterverfolgt, weil die
   Zweizeiligkeit das Problem ohne versteckte Bedienelemente löst.

---

## 2. Firebase-Namenskonvention `user.uid` lebt im Client weiter

**Betroffen:** 51 Stellen in `src/games/` (alle fünf Engines).

Supabase liefert `user.id`; die Engines lesen durchgängig `user.uid`. Damit
das funktioniert, setzt [src/hooks/useAuth.js](../src/hooks/useAuth.js) bewusst
einen Alias:

```js
{ ...currentUser, uid: currentUser.id, isAnonymous: !!currentUser.is_anonymous }
```

**Status:** Absicht, kein Defekt — dieselbe Kompatibilitäts-Entscheidung wie
`src/lib/firestoreBridge.js`. Ohne den Alias wäre `user.uid` überall
`undefined` und **jeder** Spieler-Vergleich still falsch (Imposter-Voting,
Werwolf-Rollen, Codenames-Teams).

Die Umstellung auf `.id` hieße, alle fünf Engines anzufassen. Das ist Aufgabe
der Phasen 1–5, die die Engines ohnehin neu schreiben.

---

## 3. E-Mail-Versand ist hart limitiert

`supabase/config.toml` → `[auth.rate_limit] email_sent = 2` (pro Stunde), und
der eingebaute Supabase-SMTP ist ohnehin nur für Tests gedacht.

Seit `enable_confirmations = false` (Phase 0b) verschickt die **Registrierung
keine E-Mail mehr** — sie ist einstufig. Betroffen ist nur noch der
**Passwort-Reset**. Wer den mehrfach hintereinander testet, läuft in
`over_email_send_rate_limit` (HTTP 429); die App zeigt dann „Zu viele E-Mails
in kurzer Zeit."

Vor dem Produktivgang: eigenen SMTP-Anbieter hinterlegen.

---

## 4. Online-Status hängt an einem Client-Herzschlag

`public.touch_presence()` wird vom Client alle 45 Sekunden gerufen,
`list_friends()` zählt jemanden nach 90 Sekunden ohne Schlag als offline.

Der Herzschlag läuft **auch im Hintergrund-Tab** weiter — „online" soll
heißen „die App ist offen", und wer kurz die Tabs wechselt, ist nicht weg.
Browser drosseln Hintergrund-Timer auf etwa einen Lauf pro Minute; das bleibt
unter den 90 Sekunden. Bei sehr aggressiver Drosselung (Safari, stark
ausgelastetes Gerät) kann jemand kurzzeitig fälschlich als offline gelten.
Der nächste Schlag korrigiert das, und beim Sichtbarwerden feuert sofort
einer.

Gegen einen hart abgestürzten Browser hilft das Verfahren korrekt: es kommt
schlicht kein Schlag mehr.

---

## 5. Lobby-Präsenz und Freundes-Präsenz sind zwei getrennte Systeme

Der grüne Punkt **in der Lobby** kommt aus dem Realtime-Presence-Kanal
(`usePresence`, sofort), der Punkt in der **Freundesliste** aus
`user_status.last_seen_at` (bis zu 90 Sekunden Verzug).

Das ist Absicht: Presence lebt nur im Realtime-Server, Postgres sieht sie
nicht — „zuletzt online vor 3 Stunden" ließe sich daraus nicht beantworten.
Umgekehrt wäre ein 90-Sekunden-Fenster in der Lobby zu träge. Die Folge:
dieselbe Person kann für ein paar Sekunden in der Lobby schon grün und in
der Freundesliste noch grau sein.
