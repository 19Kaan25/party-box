# PartyBox

## Entwicklungs-Spielerlabor

Der lokale Dev-Server kann zwei bis zehn voneinander getrennte PartyBox-Clients
gleichzeitig darstellen. Jeder Client besitzt eine eigene, über Reloads hinweg
gespeicherte Supabase-Sitzung und verhält sich damit wie ein separates Handy.

```bash
npm run dev
```

Danach `http://localhost:5173/?devLab=1` öffnen. Spieler 1 erstellt die Lobby.
Den angezeigten Code oben ins Labor eintragen und „Alle Spieler zur Lobby“
drücken: Alle Testspieler wechseln in diese Lobby und verlassen dabei eine
eventuell vorher aktive Testlobby automatisch. Das Labor ist nur im
Vite-Entwicklungsmodus erreichbar.

## Imposter

In beiden Geräte-Modi kann jede Spielerzahl zwischen einem Imposter und „alle
sind Imposter“ eingestellt werden. Optional sehen Imposter beim Aufdecken ihrer
Rolle die Kategorie des Geheimworts. Ist jeder Imposter, gibt es kein
Geheimwort. Ein zufällig bestimmter Startspieler wird angezeigt; danach läuft
die Diskussion ohne App-Timer. Es folgt genau eine Abstimmung, deren Auswahl
bis zur Auswertung geändert werden kann. Bei Gleichstand entscheidet das Los
unter den Höchstplatzierten. Ein rausgewählter Imposter darf das Wort einmal
erraten, sofern es mindestens einen Unschuldigen gab.

> Die lokale App verwendet die konfigurierte Supabase-Datenbank. Testlobbys und
> anonyme Testspieler sind daher echte Datensätze.

## Navigation während eines Spiels

Das globale „Spielmenü“ ist in jeder Phase aller sechs Spiele sichtbar. Hosts
können eine laufende Runde verwerfen und zu den Spieleinstellungen oder mit
allen zurück in die Lobby wechseln. Andere Spieler können in eine persönliche
Lobbyansicht wechseln, ohne die Lobby zu verlassen; solange sie dort sind,
blockieren sie keine laufenden Wartebedingungen oder Abstimmungen. „Zum
Hauptmenü“ verlässt die Lobby vollständig und übergibt die Spielleitung bei
Bedarf automatisch an den nächsten Spieler.

## Vite-Hinweise

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
