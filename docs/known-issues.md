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

**Ergänzt:** ein `pagehide`-Handler ruft zusätzlich `go_offline()` beim
Schließen von Tab/App — vorher gab es dafür kein Signal, jemand stand bis zu
90 Sekunden lang fälschlich online, obwohl er die App längst verlassen hatte.
`go_offline()` setzt `last_seen_at` auf „91 Sekunden in der Vergangenheit"
statt die `user_status`-Zeile zu löschen (**Bugfix vom 2026-08-07**: die
erste Fassung löschte die Zeile, damit zeigte die Freundesliste hinterher
„unbekannt" statt „vor 1 Min." — `relativeTimeDe()` braucht einen
Zeitstempel, kein `NULL`). Bewusst per `fetch(..., {keepalive: true})` statt
`supabase.rpc()`: der Browser kann die Seite beenden, bevor ein normales
Promise auflöst, ein `keepalive`-Request übersteht genau das. Deckt den
häufigsten Fall ab (aktives Schließen), **nicht** einen Absturz oder das
Trennen der Internetverbindung — dafür bleibt die 90-Sekunden-Toleranz oben
die einzige Absicherung. `usePresence.js`.

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

---

## 6. PWA: ein bereits hinzugefügtes Startbildschirm-Symbol repariert sich nicht von selbst

**Betrifft jeden, der PartyBox vor dem Zweig `feat/pwa-install` zum
Startbildschirm hinzugefügt hat.**

iOS legt Symbol, Name und Anzeigemodus **im Moment des Hinzufügens** fest und
schreibt sie in eine Verknüpfung. Danach liest es weder das Manifest noch die
`apple-*`-Meta-Tags erneut — auch nicht beim Start und auch nicht nach einem
Neuladen der Seite. Vorher hinzugefügte Verknüpfungen behalten deshalb für
immer das alte (falsche) Symbol und starten weiter mit Safari-Leiste.

**Was zu tun ist, einmalig pro Gerät:**

1. Altes PartyBox-Symbol vom Startbildschirm löschen.
2. Die Seite in Safari öffnen und neu laden (Manifest und Icons kommen frisch).
3. Teilen → „Zum Home-Bildschirm“ → hinzufügen.

Android/Chrome verhält sich in der Praxis genauso: das installierte Symbol
wird zwar gelegentlich nachgezogen, verlässlich ist auch dort nur
deinstallieren und neu installieren.

Nebenwirkung derselben Mechanik: der Hinweis-Banner (`InstallBanner`) kann auf
einem Gerät mit alter Verknüpfung weiterhin erscheinen, solange die Seite im
normalen Browser-Tab geöffnet wird — `display-mode: standalone` gilt nur für
das Fenster, das aus der Verknüpfung heraus gestartet wurde.

---

## 7. PWA: der Service Worker cacht bewusst nur Build-Artefakte

Kein Versehen, sondern die Bedingung dafür, dass ein Service Worker in einer
Live-Mehrspieler-App überhaupt vertretbar ist (Konfiguration:
[vite.config.js](../vite.config.js)):

- **Precache:** nur gehashte JS/CSS-Dateien, Bilder, Fonts. Kein `index.html`,
  kein `navigateFallback` — Navigationsanfragen gehen immer ans Netz.
- **Kein `runtimeCaching`:** ohne solche Regeln reicht Workbox alles durch,
  was nicht im Precache steht. Supabase-REST-Aufrufe, der
  Realtime-WebSocket und `/api/*` laufen also unverändert am Service Worker
  vorbei.

Eine gecachte Lobby oder ein gecachter Spielstand wäre nicht „etwas veraltet",
sondern falsch: der Mitspieler ist längst weiter. Der Preis dieser Entscheidung
ist, dass PartyBox **offline nicht startet** — was für ein Spiel, das ohne
Server ohnehin nichts tut, kein Verlust ist.

Wer hier später Caching-Regeln ergänzt: `registerType: 'autoUpdate'` sorgt
dafür, dass eine neue Version sofort übernimmt (`skipWaiting`,
`clientsClaim`). Ein Precache mit `index.html` würde genau diesen Effekt
aushebeln.

---

## 8. PWA-Icons stammen aus einer zu kleinen Quelldatei

Die Icons entstehen aus `public/icon.png` (Party-Pinguin) über
[scripts/generate-icons.mjs](../scripts/generate-icons.mjs). Die Datei misst
676×369, der sichtbare Pinguin darin nur **196×259 Pixel**.

| Ziel | Motivgröße | Skalierung |
|---|---|---|
| `icon-180.png` (apple-touch) | 104×137 | 0,53× |
| `icon-192.png` | 110×146 | 0,56× |
| `icon-512.png` | 294×389 | **1,50×** |
| `icon-512-maskable.png` | 232×307 | 1,19× |

Nur das 512er wird nennenswert hochgerechnet und ist dadurch leicht weich —
sichtbar praktisch nur in der Installations-Vorschau von Chrome, nicht auf dem
Startbildschirm. **Sobald eine höher aufgelöste Originaldatei existiert** (SVG
oder PNG ab 1024×1024):

```bash
node scripts/generate-icons.mjs pfad/zur/neuen-datei.png
```

Größen, Ränder und der Farbverlauf im Hintergrund bleiben dabei identisch. Die
Maskable-Varianten brauchen mehr Rand als die normalen (Android schneidet je
nach Launcher einen Kreis heraus); deshalb müssen beide Sätze immer gemeinsam
neu entstehen — von Hand geht das genau einmal gut.
