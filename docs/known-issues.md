# Bekannte Probleme

Vermessene, aber bewusst nicht behobene Punkte. Zweck: die Design-Phase soll
nicht neu ausmessen müssen, was hier schon belegt ist.

---

## 1. Spielerliste: Namen werden auf 0 px gequetscht

**Datei:** [src/components/lobby/LobbyWaitingScreen.jsx](../src/components/lobby/LobbyWaitingScreen.jsx),
Spielerzeile (`div.space-y-3 > div`)

**Symptom:** In der Lobby-Spielerliste ist der Spielername unsichtbar. Der Text
steht korrekt im DOM (`"Anna"`, `"Ben"`) und die Barrierefreiheits-Struktur
liest ihn vor — er hat nur keine Breite. Bei der eigenen Zeile bleibt ein
Rest von ~10 px, bei fremden Zeilen 0 px.

**Status:** vorbestehend, unabhängig von der Supabase-Migration. Tritt mit
Firestore genauso auf; die Migration hat es nur sichtbar gemacht, weil beim
Testen längere Namen benutzt wurden.

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

### Offene Alternativen für die Design-Phase

1. Zweizeilige Spielerzeile (oben belegt, kostet Höhe).
2. Spielerspalte im Grid verbreitern — aktuell `lg:col-span-1` von
   `lg:grid-cols-3` innerhalb `max-w-4xl`.
3. Punkte-Badge oder Host-Buttons anders unterbringen (Kontextmenü, nur bei
   Hover, kompaktere Darstellung).

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
