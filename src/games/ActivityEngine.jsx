import React, { useEffect, useRef, useState } from 'react';
import { doc, updateDoc } from '../lib/firestoreBridge';
import { serverNowMs } from '../lib/supabase';
import {
    Eye, Check, X, Flag, SkipForward, Play, HelpCircle, Gavel, Trophy, Crown, ArrowRight, Hourglass, AlertTriangle, ShieldAlert,
} from 'lucide-react';

import TABU from '../constants/activityTabu.json';
import MALEN from '../constants/activityMalen.json';
import PANTOMIME from '../constants/activityPantomime.json';
import {
    TEAM_KEYS, MIN_PLAYERS, FIELDS_PER_AREA, MAX_FALSE_REPORTS, HISTORY_LIMIT,
    typeAt, shuffled, drawFromDeck, pickWatchers, movesFor, applyMoves, rankOf, globalPointsFor, OPEN_CHANCE,
} from './activityLogic';
import { TYPE_INFO, TEAM_INFO } from './activityUi';
import ActivityBoard from './ActivityBoard';
import ActivityCanvas from './ActivityCanvas';
import ActivitySetup from './ActivitySetup';
import { RulesDialog, RefereePanel, ProposalBanner } from './ActivityPanels';

/**
 * Activity — Begriffe zeichnen, pantomimisch darstellen oder erklären;
 * erratene Begriffe ziehen die Teamfigur über das Brett.
 *
 * Phasen: SETUP -> PLAYING -> RESULTS. Innerhalb von PLAYING trägt
 * `gameState.turn` einen Versuch mit eigener laufender Nummer `n` und den
 * Stufen CHOOSE (Schwierigkeit wählen) -> READY (Begriff lesen) -> RUNNING
 * (Timer, ggf. PAUSED bei Meldung) -> REVEAL (Auflösung).
 *
 * Gleichzeitigkeit ohne Transaktionen: Wer den Versuch beenden will
 * (Erraten, Zeitablauf, Regelverstoß, Aufgeben, Abbruch), schreibt nur das
 * eine Feld `turn.result` samt Versuchsnummer. Verrechnet wird es
 * AUSSCHLIESSLICH vom Host, genau einmal (`appliedN`). Ergebnisse mit
 * falscher Nummer verwirft er. So zieht keine Figur doppelt.
 *
 * Gemeinsame Momente (Los, Auflösung, nächster Versuch) tragen zusätzlich
 * `gameState.phase` im Patch und werden dadurch nicht optimistisch angezeigt
 * (isSyncedMoment). Die Zeichnung läuft gar nicht über gameState, sondern
 * per Broadcast (ActivityCanvas).
 *
 * Wie überall: Logik im Client, Host-Autorität ist nur `if (!isHost)`,
 * Begriffe stehen im Klartext im gameState (s. CLAUDE.md).
 */

const DATA = { DRAW: MALEN, MIME: PANTOMIME, EXPLAIN: TABU };
const COUNTDOWN_MS = 3000;
/** So lange darf ein Darsteller/Aufpasser offline sein, bevor der Host ihn überspringt. */
const MISSING_GRACE_MS = 8000;

const TYPE_RULES = {
    DRAW: 'Zeichnen: nicht sprechen, keine Gesten, keine Buchstaben oder Zahlen. Nicken bei richtigen Wortteilen ist erlaubt.',
    MIME: 'Pantomime: nur der eigene Körper — kein Ton, keine Gegenstände, nicht auf Dinge zeigen.',
    EXPLAIN: 'Erklären: Begriff, Wortteile, abgeleitete Formen und die 5 Tabu-Wörter sind verboten.',
};
const REPORT_REASONS = {
    DRAW: ['Buchstabe/Zahl', 'Sprechen/Gesten', 'Sonstiges'],
    MIME: ['Ton/Sprechen', 'Gegenstand', 'Sonstiges'],
    EXPLAIN: ['Wortteil/abgeleitete Form', 'Sonstiges'],
};
const RESULT_LABEL = {
    erraten: 'Erraten',
    zeit: 'Zeit abgelaufen',
    regelverstoss: 'Regelverstoß',
    aufgegeben: 'Nicht erraten',
    abgebrochen: 'Abgebrochen',
};

const poolFor = (type, d, cats) => cats.flatMap((c) => (DATA[type]?.[c] || []).filter((x) => x.difficulty === d));

export default function ActivityEngine({ lobby, user, isHost, db, updateLobbyStatus, onlineIds }) {
    const { gameState, players, id: lobbyCode } = lobby;
    const me = user.uid;

    // ---- Alle Hooks ganz oben, vor jedem phasenabhängigen return ----
    const [now, setNow] = useState(() => serverNowMs());
    const [revealedN, setRevealedN] = useState(-1);   // Darsteller hat "Begriff anzeigen" getippt
    const [rulesOpen, setRulesOpen] = useState(false);
    const [refereeOpen, setRefereeOpen] = useState(false);
    const [reportOpen, setReportOpen] = useState(false);
    const [shieldHintSeen, setShieldHintSeen] = useState(false);
    const appliedRef = useRef(-1);
    const expiredRef = useRef(-1);
    const proposalRef = useRef(null);
    const holdRef = useRef(-1);
    const stateRef = useRef(gameState);
    useEffect(() => { stateRef.current = gameState; });

    const turn = gameState.turn || null;
    const playing = gameState.phase === 'PLAYING';
    const teams = gameState.teams || {};
    const order = gameState.order || [];
    const cfg = gameState.cfg || {};
    const three = !!gameState.three;
    const goal = gameState.goal || 1;
    const positions = gameState.positions || {};

    const lobbyRef = () => doc(db, 'lobbies', lobbyCode);
    const write = (patch) => updateDoc(lobbyRef(), patch);
    /** Gemeinsamer Moment: mit gameState.phase, damit niemand ihn früher sieht. */
    const writeSynced = (patch) => updateDoc(lobbyRef(), { 'gameState.phase': 'PLAYING', ...patch });

    // Leeres Set = Presence noch nicht da/kaputt: dann niemanden für weg halten.
    const isPresent = (id) => players.some((p) => p.id === id)
        && (!onlineIds || onlineIds.size === 0 || onlineIds.has(id));
    const nameOf = (id) => players.find((p) => p.id === id)?.name || 'Weg';
    const teamOf = (id) => Object.keys(teams).find((k) => teams[k].includes(id)) || null;
    const teamName = (k) => (three ? `${nameOf(teams[k]?.[0])} · ${TEAM_INFO[k]?.label}` : `Team ${TEAM_INFO[k]?.label}`);
    const activeTeams = order.filter((k) => (teams[k] || []).some(isPresent));
    const notEnough = playing && (three ? activeTeams.length < MIN_PLAYERS : activeTeams.length < 2);

    const card = turn?.card != null ? poolFor(turn.type, turn.difficulty, cfg.categories || [])[turn.card] : null;
    const running = turn?.stage === 'RUNNING';
    const countdown = running && now < turn.startAt ? Math.ceil((turn.startAt - now) / 1000) : 0;
    const remainingMs = turn
        ? (turn.stage === 'PAUSED' ? turn.remainingMs : Math.max(0, Math.min(turn.endsAt - Math.max(now, turn.startAt), (cfg.seconds || 60) * 1000)))
        : 0;
    const actorMissing = playing && !!turn && turn.stage !== 'REVEAL' && !isPresent(turn.actor);
    const watchersMissing = playing && !!turn && turn.stage !== 'REVEAL' && !turn.result
        && (turn.watchers || []).length > 0 && !(turn.watchers || []).some(isPresent);

    // Uhr für Timer/Countdown (Serverzeit, s. measureClockOffset in useLobby).
    useEffect(() => {
        if (!playing) return undefined;
        const timer = setInterval(() => setNow(serverNowMs()), 250);
        return () => clearInterval(timer);
    }, [playing]);

    // Beim Pantomimen berührt niemand das Display — Bildschirm wach halten.
    const wakeWanted = playing && !!turn && ['READY', 'RUNNING', 'PAUSED'].includes(turn.stage);
    useEffect(() => {
        if (!wakeWanted || !navigator.wakeLock) return undefined;
        let lock = null;
        let cancelled = false;
        navigator.wakeLock.request('screen')
            .then((l) => { if (cancelled) l.release().catch(() => {}); else lock = l; })
            .catch(() => {});
        // shortcut: nach einem Tab-Wechsel wird der Lock nicht neu angefordert, erst beim nächsten Versuch.
        return () => { cancelled = true; lock?.release().catch(() => {}); };
    }, [wakeWanted]);

    // ---- Host: Ergebnis genau einmal verrechnen ----
    useEffect(() => {
        if (!isHost || !playing || !turn?.result || turn.stage === 'REVEAL') return;
        if (turn.result.n !== turn.n) {
            // Verspätetes Ereignis aus einem früheren Versuch.
            write({ 'gameState.turn.result': null });
            return;
        }
        if (gameState.appliedN === turn.n || appliedRef.current === turn.n) return;
        appliedRef.current = turn.n;
        // Schlägt der RPC fehl, Riegel lösen: der nächste Render versucht es erneut.
        applyResult(turn, turn.result).catch(() => { appliedRef.current = -1; });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isHost, playing, turn?.n, turn?.result, turn?.stage, gameState.appliedN]);

    // ---- Zeitablauf: Host UND Darsteller dürfen auslösen (idempotent) ----
    useEffect(() => {
        if (!playing || !running || turn.result || now < turn.endsAt) return;
        if (!(isHost || turn.actor === me) || expiredRef.current === turn.n) return;
        expiredRef.current = turn.n;
        write({ 'gameState.turn.result': { n: turn.n, kind: 'zeit', by: me } });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [now, playing, running, turn?.n, turn?.endsAt, turn?.result, isHost]);

    // ---- Host: verschwundenen Darsteller/Aufpasser nach kurzer Gnadenfrist behandeln ----
    useEffect(() => {
        if (!isHost || !(actorMissing || watchersMissing)) return undefined;
        const n = turn.n;
        const timer = setTimeout(() => {
            const gs = stateRef.current;
            if (gs.turn?.n !== n || gs.turn.result) return;
            if (actorMissing) {
                write({ 'gameState.turn.result': { n, kind: 'abgebrochen', by: me } });
                return;
            }
            const { watchers, guesser } = pickWatchers({
                mode: gs.cfg.watcher, three: gs.three, open: gs.turn.open, type: gs.turn.type, actorTeam: gs.turn.team,
                teams: gs.teams, present: isPresent, watchCount: gs.watchCount || {}, teamWatchCount: gs.teamWatchCount || {},
            });
            write({ 'gameState.turn.watchers': watchers, 'gameState.turn.guesser': guesser });
        }, MISSING_GRACE_MS);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isHost, actorMissing, watchersMissing, turn?.n]);

    // ---- Host: zu wenige Spieler -> laufenden Timer anhalten ----
    useEffect(() => {
        if (!isHost || !notEnough || !running || turn.result || holdRef.current === turn.n) return;
        holdRef.current = turn.n;
        hostPause();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isHost, notEnough, running, turn?.n]);

    // ---- Host: Abstimmung (Schiedsrichter-Modus VOTE) auswerten ----
    const proposal = gameState.proposal || null;
    useEffect(() => {
        if (!isHost || !proposal || proposalRef.current === proposal.id) return;
        const voters = players.map((p) => p.id);
        const yes = voters.filter((id) => proposal.votes?.[id] === true).length;
        const no = voters.filter((id) => proposal.votes?.[id] === false).length;
        // Einfache Mehrheit aller aktiven Spieler; Gleichstand = bleibt wie es ist.
        if (yes * 2 > voters.length) {
            proposalRef.current = proposal.id;
            // finally: auch wenn die Korrektur scheitert, darf die Abstimmung nicht ewig stehen bleiben.
            runTool(proposal.kind, proposal.payload, 'Gruppe').finally(() => write({ 'gameState.proposal': null }));
        } else if (no * 2 >= voters.length) {
            proposalRef.current = proposal.id;
            const reject = proposal.kind === 'report' ? decideReport(false, 'Gruppe') : Promise.resolve();
            reject.finally(() => write({ 'gameState.proposal': null }));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isHost, proposal, players]);

    // ---- Aktionen ----

    /** Nächsten Versuch zusammenstellen (nur Host). Liefert gameState-Teilwerte. */
    const buildTurn = (gs) => {
        const ord = gs.order;
        const start = gs.turn ? ord.indexOf(gs.turn.team) : -1;
        let team = null;
        for (let s = 1; s <= ord.length; s++) {
            const k = ord[(start + s) % ord.length];
            if (gs.teams[k].some(isPresent)) { team = k; break; }
        }
        if (!team) return null;
        const members = gs.teams[team].filter(isPresent);
        const count = gs.actorCount?.[team] || 0;
        const type = typeAt(gs.positions[team] || 0);
        const open = !gs.three && Math.random() < OPEN_CHANCE;
        const { watchers, guesser } = pickWatchers({
            mode: gs.cfg.watcher, three: gs.three, open, type, actorTeam: team, teams: gs.teams,
            present: isPresent, watchCount: gs.watchCount || {}, teamWatchCount: gs.teamWatchCount || {},
        });
        const watchCount = { ...(gs.watchCount || {}) };
        watchers.forEach((id) => { watchCount[id] = (watchCount[id] || 0) + 1; });
        const teamWatchCount = { ...(gs.teamWatchCount || {}) };
        if (gs.cfg.watcher === 'ONE_TEAM' && !open && !gs.three && watchers[0]) {
            const wt = Object.keys(gs.teams).find((k) => gs.teams[k].includes(watchers[0]));
            teamWatchCount[wt] = (teamWatchCount[wt] || 0) + 1;
        }
        return {
            turn: {
                n: (gs.turn?.n || 0) + 1, team, actor: members[count % members.length], type, open,
                watchers, guesser, stage: 'CHOOSE', difficulty: null, card: null,
                reporters: {}, report: null, reportLog: [], result: null, hold: false,
            },
            actorCount: { ...(gs.actorCount || {}), [team]: count + 1 },
            watchCount,
            teamWatchCount,
        };
    };

    const startGame = async (setup) => {
        if (!isHost) return;
        const isThree = players.length === MIN_PLAYERS;
        const ids = shuffled(players.map((p) => p.id));
        const gameTeams = isThree
            ? Object.fromEntries(ids.map((id, i) => [TEAM_KEYS[i], [id]]))
            : Object.fromEntries(Object.entries(setup.teams).filter(([, m]) => m.length > 0));
        const keys = Object.keys(gameTeams);
        const state = {
            phase: 'PLAYING',
            setup: gameState.setup,           // Rohwerte, überleben "Spiel neu starten"
            restartVersion: gameState.restartVersion,
            optedOut: gameState.optedOut,
            cfg: { ...setup, teams: undefined },
            three: isThree,
            teams: gameTeams,
            order: shuffled(keys),
            goal: setup.length * FIELDS_PER_AREA + 1,
            positions: Object.fromEntries(keys.map((k) => [k, 0])),
            skipsLeft: Object.fromEntries(keys.map((k) => [k, setup.skips])),
            falseReports: {},
            decks: {},
            history: [],
            appliedN: 0,
            proposal: null,
            turn: null,
        };
        await updateDoc(lobbyRef(), { gameState: { ...state, ...buildTurn(state) } });
    };

    const nextTurn = async () => {
        if (!isHost || turn?.stage !== 'REVEAL') return;
        if (order.some((k) => (positions[k] || 0) >= goal)) {
            await write({ 'gameState.phase': 'RESULTS' });
            return;
        }
        const next = buildTurn(gameState);
        if (!next) return;
        await writeSynced({
            'gameState.turn': next.turn,
            'gameState.actorCount': next.actorCount,
            'gameState.watchCount': next.watchCount,
            'gameState.teamWatchCount': next.teamWatchCount,
        });
    };

    /** Host: Ergebnis verrechnen, Protokoll schreiben, Auflösung zeigen. */
    const applyResult = async (t, result) => {
        const info = {
            three, open: t.open, team: t.team, difficulty: t.difficulty || 0,
            watcherTeams: (t.watchers || []).map(teamOf).filter(Boolean),
        };
        const before = { ...positions };
        const after = applyMoves(before, movesFor(info, result), goal, three);
        const word = t.card != null ? poolFor(t.type, t.difficulty, cfg.categories || [])[t.card]?.word : null;
        const entry = {
            n: t.n, team: t.team, actor: t.actor, type: t.type, open: t.open, difficulty: t.difficulty,
            watchers: t.watchers || [], word, kind: result.kind, winner: result.winner || null,
            before, reports: t.reportLog || [],
        };
        await writeSynced({
            'gameState.positions': after,
            'gameState.history': [...(gameState.history || []), entry].slice(-HISTORY_LIMIT),
            'gameState.appliedN': t.n,
            'gameState.turn.stage': 'REVEAL',
        });
    };

    const finish = (kind, winner = null) => {
        if (!turn || turn.result || turn.stage === 'REVEAL') return;
        write({ 'gameState.turn.result': { n: turn.n, kind, winner, by: me } });
    };

    const chooseDifficulty = (d) => {
        if (turn?.actor !== me || turn.stage !== 'CHOOSE') return;
        const pool = poolFor(turn.type, d, cfg.categories || []);
        if (!pool.length) return;
        const key = `${turn.type}${d}`;
        const { index, deck } = drawFromDeck(gameState.decks?.[key], pool.length);
        write({
            'gameState.turn.difficulty': d,
            'gameState.turn.card': index,
            'gameState.turn.stage': 'READY',
            [`gameState.decks.${key}`]: deck,
        });
    };

    const skipsLeft = turn ? gameState.skipsLeft?.[turn.team] ?? 0 : 0;
    const skipCard = () => {
        if (turn?.actor !== me || skipsLeft === 0 || turn.result || !['READY', 'RUNNING'].includes(turn.stage)) return;
        const pool = poolFor(turn.type, turn.difficulty, cfg.categories || []);
        const key = `${turn.type}${turn.difficulty}`;
        const { index, deck } = drawFromDeck(gameState.decks?.[key], pool.length);
        // Der Timer läuft beim Tausch bewusst weiter.
        write({
            'gameState.turn.card': index,
            [`gameState.decks.${key}`]: deck,
            ...(skipsLeft > 0 && { [`gameState.skipsLeft.${turn.team}`]: skipsLeft - 1 }),
        });
    };

    const go = () => {
        if (turn?.actor !== me || turn.stage !== 'READY') return;
        const startAt = serverNowMs() + COUNTDOWN_MS;
        writeSynced({
            'gameState.turn.stage': 'RUNNING',
            'gameState.turn.startAt': startAt,
            'gameState.turn.endsAt': startAt + (cfg.seconds || 60) * 1000,
        });
    };

    const currentRemaining = () => {
        const t = stateRef.current.turn;
        const n = serverNowMs();
        return Math.max(0, Math.min(t.endsAt - Math.max(n, t.startAt), (cfg.seconds || 60) * 1000));
    };
    const resumePatch = (remaining) => {
        const n = serverNowMs();
        return { 'gameState.turn.stage': 'RUNNING', 'gameState.turn.startAt': n, 'gameState.turn.endsAt': n + remaining, 'gameState.turn.hold': false };
    };

    // Regelverstoß-Verfahren (Meldung -> Darsteller entscheidet -> ggf. Einspruch)
    const falseReports = gameState.falseReports || {};
    const myTeam = teamOf(me);
    const isActor = turn?.actor === me;
    const isWatcher = !!turn?.watchers?.includes(me);
    const isOpponent = !!turn && !!myTeam && myTeam !== turn.team;
    const canReport = isOpponent && running && !countdown && !turn.result && !turn.reporters?.[me]
        && (falseReports[me] || 0) < MAX_FALSE_REPORTS;

    const report = (reason) => {
        setReportOpen(false);
        if (!canReport) return;
        write({
            'gameState.turn.stage': 'PAUSED',
            'gameState.turn.remainingMs': currentRemaining(),
            'gameState.turn.report': { by: me, reason, status: 'OPEN' },
            [`gameState.turn.reporters.${me}`]: true,
        });
    };

    /** valid = Regelverstoß bestätigt. decider: 'Darsteller' | 'Host' | 'Gruppe'. */
    const decideReport = async (valid, decider) => {
        const t = stateRef.current.turn;
        const rep = t?.report;
        if (!rep || !['OPEN', 'APPEALED'].includes(rep.status) || t.result) return;
        const log = [...(t.reportLog || []), { by: rep.by, reason: rep.reason, decision: valid ? 'stimmt' : 'stimmt nicht', decider }];
        const fr = stateRef.current.falseReports?.[rep.by] || 0;
        if (valid) {
            await write({
                'gameState.turn.report.status': 'CONFIRMED',
                'gameState.turn.reportLog': log,
                'gameState.turn.result': { n: t.n, kind: 'regelverstoss', by: me },
                // Ein erfolgreicher Einspruch nimmt die vorher gezählte Fehlmeldung zurück.
                ...(rep.status === 'APPEALED' && { [`gameState.falseReports.${rep.by}`]: Math.max(0, fr - 1) }),
            });
            return;
        }
        const appealable = rep.status === 'OPEN' && decider === 'Darsteller' && cfg.referee !== 'OFF';
        await write({
            'gameState.turn.report.status': appealable ? 'DENIED' : 'REJECTED',
            'gameState.turn.reportLog': log,
            ...(rep.status === 'OPEN' && { [`gameState.falseReports.${rep.by}`]: fr + 1 }),
            ...resumePatch(t.remainingMs ?? currentRemaining()),
        });
    };

    const appeal = () => {
        const rep = turn?.report;
        if (!rep || rep.by !== me || rep.status !== 'DENIED' || !running || turn.result) return;
        if (cfg.referee === 'VOTE' && proposal) return;
        write({
            'gameState.turn.stage': 'PAUSED',
            'gameState.turn.remainingMs': currentRemaining(),
            'gameState.turn.report.status': 'APPEALED',
            ...(cfg.referee === 'VOTE' && {
                'gameState.proposal': {
                    id: `${turn.n}-${Date.now()}`, kind: 'report', payload: { n: turn.n },
                    label: `Einspruch von ${nameOf(me)}: „${rep.reason}" — war das ein Regelverstoß?`, by: me, votes: { [me]: true },
                },
            }),
        });
    };

    // ---- Host-Werkzeuge (Notfälle immer, Korrekturen je nach Schiedsrichter-Modus) ----
    const hostLog = (text) => [...(stateRef.current.history || []), { host: true, n: stateRef.current.turn?.n, text }].slice(-HISTORY_LIMIT);

    const hostPause = () => {
        const t = stateRef.current.turn;
        if (!isHost || t?.stage !== 'RUNNING' || t.result) return;
        write({ 'gameState.turn.stage': 'PAUSED', 'gameState.turn.remainingMs': currentRemaining(), 'gameState.turn.hold': true });
    };
    const hostResume = () => {
        const t = stateRef.current.turn;
        if (!isHost || t?.stage !== 'PAUSED' || !t.hold) return;
        write(resumePatch(t.remainingMs));
    };
    const hostAbort = () => { if (isHost) finish('abgebrochen'); };
    const hostEnd = () => { if (isHost) write({ 'gameState.phase': 'RESULTS' }); };
    const assignSpectator = (id, team) => {
        if (!isHost || three || !teams[team]) return;
        write({ [`gameState.teams.${team}`]: [...teams[team], id], 'gameState.history': hostLog(`${nameOf(id)} spielt jetzt in ${teamName(team)} mit`) });
    };

    /** Korrekturen. In VOTE laufen sie erst über eine Abstimmung hierher. */
    const runTool = async (kind, payload, by = 'Host') => {
        if (!isHost) return;
        const gs = stateRef.current;
        if (kind === 'report') {
            await decideReport(true, by);
            return;
        }
        if (kind === 'result') {
            const hist = gs.history || [];
            const idx = hist.map((e) => !e.host && e.n === gs.appliedN).lastIndexOf(true);
            if (idx < 0) return;
            const e = hist[idx];
            const info = { three: gs.three, open: e.open, team: e.team, difficulty: e.difficulty || 0, watcherTeams: (e.watchers || []).map(teamOf).filter(Boolean) };
            // shortcut: rechnet vom Stand vor dem Versuch neu — eine danach gemachte
            // Feldkorrektur geht dabei verloren. Reicht, weil beides selten zusammenfällt.
            const after = applyMoves(e.before, movesFor(info, payload), gs.goal, gs.three);
            const updated = [...hist];
            updated[idx] = { ...e, kind: payload.kind, winner: payload.winner || null };
            const label = payload.winner ? `${RESULT_LABEL[payload.kind]} (${teamName(payload.winner)})` : RESULT_LABEL[payload.kind];
            await write({
                'gameState.positions': after,
                'gameState.history': [...updated, { host: true, n: gs.turn?.n, text: `${by} hat Versuch ${e.n} geändert: ${label}` }].slice(-HISTORY_LIMIT),
            });
            return;
        }
        if (kind === 'pos') {
            const value = Math.max(0, Math.min(gs.goal, payload.value));
            await write({ [`gameState.positions.${payload.team}`]: value, 'gameState.history': hostLog(`${by}: ${teamName(payload.team)} auf Feld ${value} gesetzt`) });
            return;
        }
        if (kind === 'skips') {
            const cur = gs.skipsLeft?.[payload.team] ?? 0;
            if (cur < 0) return;
            const value = Math.max(0, cur + payload.delta);
            await write({ [`gameState.skipsLeft.${payload.team}`]: value, 'gameState.history': hostLog(`${by}: Tausche von ${teamName(payload.team)} auf ${value}`) });
            return;
        }
        if (kind === 'ban') {
            await write({
                [`gameState.falseReports.${payload.id}`]: payload.banned ? MAX_FALSE_REPORTS : 0,
                'gameState.history': hostLog(`${by}: ${nameOf(payload.id)} ${payload.banned ? 'darf nicht mehr melden' : 'darf wieder melden'}`),
            });
        }
    };

    const propose = (kind, payload, label) => {
        if (proposal) return;
        write({ 'gameState.proposal': { id: `${Date.now()}`, kind, payload, label, by: me, votes: { [me]: true } } });
    };
    const vote = (yes) => { if (proposal) write({ [`gameState.proposal.votes.${me}`]: yes }); };
    /** Korrektur über das Werkzeug: direkt (HOST) oder als Vorschlag (VOTE). */
    const correction = (kind, payload, label) => {
        if (!isHost || cfg.referee === 'OFF') return;
        if (cfg.referee === 'VOTE') propose(kind, payload, label);
        else runTool(kind, payload);
    };

    // ---- Rangliste (Ende und Zwischenstand) ----
    const posValues = order.map((k) => positions[k] || 0);
    const ranking = [...order].sort((a, b) => (positions[b] || 0) - (positions[a] || 0));

    const finishGame = async () => {
        // ACHTUNG: status 'LOBBY_WAITING' verwirft alle gameState-Keys desselben Patches.
        if (lobby.settings?.globalLeaderboard) {
            const newPlayers = players.map((p) => {
                const t = teamOf(p.id);
                const added = t ? globalPointsFor(rankOf(positions[t] || 0, posValues)) : 0;
                return { ...p, globalScore: (p.globalScore ?? 0) + added };
            });
            await updateLobbyStatus('LOBBY_WAITING', null, { players: newPlayers, gameState: {} });
        } else {
            await updateLobbyStatus('LOBBY_WAITING', null, { gameState: {} });
        }
    };

    // ---- Phasen ----

    if (gameState.phase === 'SETUP') {
        return (
            <ActivitySetup
                players={players}
                setup={gameState.setup}
                isHost={isHost}
                updateSetup={(key, value) => isHost && write({ [`gameState.setup.${key}`]: value })}
                onStart={startGame}
            />
        );
    }

    if (gameState.phase === 'RESULTS') {
        return (
            <div className="min-h-screen bg-slate-900 text-white p-4 sm:p-8">
                <div className="max-w-2xl mx-auto flex flex-col items-center">
                    <h2 className="text-4xl sm:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-amber-300 mb-2 tracking-wider uppercase mt-10">
                        Endergebnis
                    </h2>
                    <p className="text-slate-400 mb-8">Wer ist zuerst im Ziel?</p>
                    <div className="w-full bg-slate-800 rounded-3xl p-5 sm:p-8 border border-slate-700 shadow-2xl mb-8 space-y-3">
                        {ranking.map((k) => {
                            const rank = rankOf(positions[k] || 0, posValues);
                            return (
                                <div key={k} className={`flex items-center gap-3 rounded-2xl p-4 border ${rank === 1 ? 'bg-yellow-500/10 border-yellow-500/40' : 'bg-slate-900/50 border-slate-700'}`}>
                                    <span className={`text-2xl font-black w-7 shrink-0 ${rank === 1 ? 'text-yellow-400' : 'text-slate-500'}`}>{rank}</span>
                                    {rank === 1 && <Crown size={20} className="text-yellow-400 shrink-0" />}
                                    <div className="min-w-0 flex-1">
                                        <p className={`font-bold truncate ${TEAM_INFO[k].text}`}>{teamName(k)}</p>
                                        {!three && <p className="text-xs text-slate-500 truncate">{(teams[k] || []).map(nameOf).join(', ')}</p>}
                                    </div>
                                    <span className="font-mono text-lg text-orange-300 shrink-0">
                                        {(positions[k] || 0) >= goal ? 'Ziel' : `Feld ${positions[k] || 0}`}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                    {isHost ? (
                        <button onClick={finishGame} className="w-full max-w-sm bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2">
                            <Trophy size={18} /> Zurück zur Lobby
                        </button>
                    ) : (
                        <p className="text-slate-500 text-sm animate-pulse">Warten auf den Partyleiter…</p>
                    )}
                </div>
            </div>
        );
    }

    if (!playing || !turn) return null;

    // ---- PLAYING ----
    const typeInfo = TYPE_INFO[turn.type];
    const isSpectator = !myTeam;
    const seesCard = (isActor || isWatcher) && ['READY', 'RUNNING', 'PAUSED'].includes(turn.stage) && card;
    const actorName = nameOf(turn.actor);
    const seconds = Math.ceil(remainingMs / 1000);
    const lastTen = running && !countdown && seconds <= 10;
    const rep = turn.report;
    const repOpen = rep && ['OPEN', 'APPEALED'].includes(rep.status);
    const canConfirmGuess = (isActor || isWatcher) && running && !countdown && !turn.result;
    const bannedMe = (falseReports[me] || 0) >= MAX_FALSE_REPORTS;
    const hostInvolved = isHost && (isActor || rep?.by === me);

    let role;
    if (isSpectator) role = { text: 'Du schaust zu', cls: 'bg-slate-700 text-slate-200' };
    else if (isActor) role = { text: 'Du bist dran', cls: 'bg-orange-500 text-white' };
    else if (isWatcher) role = { text: turn.open ? 'Du rätst nicht mit (Aufpasser)' : 'Du passt auf — nicht mitraten', cls: 'bg-purple-600 text-white' };
    else if (three) role = turn.guesser === me
        ? { text: 'Du rätst', cls: 'bg-green-600 text-white' }
        : { text: 'Du rätst mit — wer zuerst!', cls: 'bg-green-600 text-white' };
    else if (myTeam === turn.team) role = { text: 'Du rätst mit', cls: 'bg-green-600 text-white' };
    else if (turn.open) role = { text: 'Offene Runde — alle raten mit!', cls: 'bg-red-600 text-white' };
    else role = { text: `Warte, ${teamName(turn.team)} ist dran`, cls: 'bg-slate-700 text-slate-200' };

    // Wer im offenen/Drei-Spieler-Wettlauf zuerst geraten hat.
    const winnerChoices = three
        ? (turn.guesser ? null : order.filter((k) => k !== turn.team && teams[k].some(isPresent)))
        : (turn.open ? activeTeams : null);

    const letterOf = three ? (k) => nameOf(teams[k]?.[0]).charAt(0).toUpperCase() : undefined;

    return (
        <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center p-3 sm:p-6 pb-28">
            <div className="w-full max-w-2xl mt-14 space-y-3">
                {/* Rollen-Banner + immer sichtbare Eckdaten */}
                <div className={`rounded-2xl px-4 py-2 text-center font-black ${role.cls}`}>{role.text}</div>
                <div className="flex items-center gap-2 text-sm bg-slate-800 rounded-2xl px-3 py-2 border border-slate-700">
                    <span className={`font-bold ${TEAM_INFO[turn.team].text}`}>{teamName(turn.team)}</span>
                    <span className="text-slate-500">·</span>
                    <span className="truncate">{actorName}</span>
                    <span className={`ml-auto flex items-center gap-1 font-bold ${typeInfo.text}`}><typeInfo.Icon size={15} /> {typeInfo.label}</span>
                    {turn.open && <span className="px-2 py-0.5 rounded-lg bg-red-600 text-xs font-bold">offen</span>}
                    {turn.difficulty && <span className="px-2 py-0.5 rounded-lg bg-slate-700 text-xs font-bold">{turn.difficulty}</span>}
                </div>
                {['RUNNING', 'PAUSED'].includes(turn.stage) && (
                    <div className={`rounded-2xl py-1 text-center font-black text-3xl font-mono tabular-nums border ${lastTen ? 'bg-red-600/30 border-red-500 text-red-200 animate-pulse' : 'bg-slate-800 border-slate-700'}`}>
                        {countdown ? `${countdown}…` : `${seconds}s`}
                        {turn.stage === 'PAUSED' && <span className="block text-xs font-sans font-bold text-amber-300">pausiert</span>}
                    </div>
                )}
                {turn.watchers?.length > 0 && turn.stage !== 'REVEAL' && cfg.watcher !== 'OPPONENTS' && (
                    <p className="text-xs text-center text-slate-400">
                        <Eye size={12} className="inline mr-1" />Aufpasser: {turn.watchers.map(nameOf).join(', ')}
                        {turn.guesser && <> · Rater: {nameOf(turn.guesser)}</>}
                    </p>
                )}

                <ProposalBanner proposal={proposal} me={me} players={players} onVote={vote} nameOf={nameOf} />

                {notEnough && (
                    <div className="rounded-2xl bg-amber-500/15 border border-amber-500/40 p-4 text-center">
                        <p className="font-bold text-amber-300">{three ? 'Warte auf einen dritten Spieler' : 'Nur noch ein Team übrig — warte auf Mitspieler'}</p>
                        {isHost && <button onClick={hostEnd} className="mt-2 text-sm underline text-amber-200">Mit Zwischenstand beenden</button>}
                    </div>
                )}

                {/* Meldung offen: alle sehen sie, Darsteller (bzw. Host/Gruppe) entscheidet */}
                {turn.stage === 'PAUSED' && repOpen && (
                    <div className="rounded-2xl bg-red-500/15 border border-red-500/50 p-4">
                        <p className="font-bold text-red-200 flex items-center gap-2"><ShieldAlert size={18} /> {nameOf(rep.by)} meldet: <em>{rep.reason}</em></p>
                        {rep.status === 'APPEALED' && <p className="text-sm text-red-200/80 mt-1">Einspruch — {cfg.referee === 'VOTE' ? 'die Gruppe stimmt ab.' : 'der Host entscheidet.'}</p>}
                        {((isActor && rep.status === 'OPEN') || (isHost && cfg.referee === 'HOST')) && (
                            <div className="grid grid-cols-2 gap-2 mt-3">
                                <button onClick={() => decideReport(true, isActor && rep.status === 'OPEN' ? 'Darsteller' : 'Host')} className="py-3 rounded-xl bg-red-600 font-bold">Stimmt</button>
                                <button onClick={() => decideReport(false, isActor && rep.status === 'OPEN' ? 'Darsteller' : 'Host')} className="py-3 rounded-xl bg-slate-700 font-bold">Stimmt nicht</button>
                            </div>
                        )}
                    </div>
                )}
                {turn.stage === 'PAUSED' && turn.hold && !repOpen && (
                    <div className="rounded-2xl bg-amber-500/15 border border-amber-500/40 p-3 text-center text-amber-200 font-bold">Vom Host pausiert</div>
                )}
                {running && rep?.status === 'DENIED' && rep.by === me && cfg.referee !== 'OFF' && (
                    <button onClick={appeal} disabled={cfg.referee === 'VOTE' && !!proposal} className="w-full py-2 rounded-xl border border-red-500/50 text-red-200 text-sm disabled:opacity-50">
                        Einspruch gegen „Stimmt nicht" einlegen
                    </button>
                )}

                {/* ---- Darsteller / Aufpasser: Karte ---- */}
                {isActor && turn.stage === 'CHOOSE' && (
                    <div className="bg-slate-800 rounded-3xl p-5 border border-slate-700 text-center">
                        <p className="text-slate-300 mb-1">Wähle die Schwierigkeit — so viele Felder ist der Begriff wert.</p>
                        <p className="text-xs text-slate-500 mb-4">{TYPE_RULES[turn.type]}</p>
                        <div className="grid grid-cols-3 gap-3">
                            {[3, 4, 5].map((d) => (
                                <button key={d} onClick={() => chooseDifficulty(d)} className="py-6 rounded-2xl bg-gradient-to-br from-orange-500 to-amber-500 text-3xl font-black shadow-lg">{d}</button>
                            ))}
                        </div>
                    </div>
                )}
                {!isActor && turn.stage === 'CHOOSE' && (
                    <p className="text-center text-slate-400 py-6 flex items-center justify-center gap-2"><Hourglass size={16} /> {actorName} wählt die Schwierigkeit…</p>
                )}

                {seesCard && (isActor ? (revealedN === turn.n || turn.stage !== 'READY') : true) && (
                    <div className={`bg-slate-800 rounded-3xl border-2 border-orange-500/50 text-center ${turn.type === 'DRAW' ? 'p-3' : 'p-5'}`}>
                        {isWatcher && three && !shieldHintSeen && (
                            <button onClick={() => setShieldHintSeen(true)} className="w-full mb-3 rounded-xl bg-purple-600/30 border border-purple-500/50 px-3 py-2 text-sm text-purple-100">
                                Handy abschirmen — der Rater darf nicht mitlesen. <span className="underline">Verstanden</span>
                            </button>
                        )}
                        <p className="text-xs uppercase tracking-wide text-slate-400 mb-1">Begriff</p>
                        <p className={`font-black break-words ${turn.type === 'DRAW' ? 'text-2xl' : 'text-3xl sm:text-4xl'}`}>{card.word}</p>
                        {turn.type === 'EXPLAIN' && card.forbidden && (
                            <div className="mt-4">
                                <p className="text-xs uppercase tracking-wide text-red-300 mb-2">Tabu{isWatcher && canReport ? ' — antippen zum Melden' : ''}</p>
                                <div className="flex flex-wrap justify-center gap-2">
                                    {card.forbidden.map((w) => (
                                        <button
                                            key={w}
                                            disabled={!(isWatcher && canReport)}
                                            onClick={() => report(`Tabu-Wort „${w}"`)}
                                            className="px-3 py-1.5 rounded-xl bg-red-500/20 border border-red-500/50 text-red-100 font-bold disabled:cursor-default"
                                        >
                                            {w}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {isActor && turn.stage === 'READY' && (
                    <div className="space-y-3">
                        {revealedN !== turn.n && (
                            <button onClick={() => setRevealedN(turn.n)} className="w-full py-6 rounded-3xl bg-slate-800 border-2 border-dashed border-orange-500/60 text-xl font-bold flex items-center justify-center gap-2">
                                <Eye size={22} /> Begriff anzeigen
                            </button>
                        )}
                        <p className="text-xs text-center text-slate-400">{TYPE_RULES[turn.type]}{turn.type === 'DRAW' && ' Neu laden löscht die Zeichnung.'}</p>
                        <button onClick={go} disabled={revealedN !== turn.n} className="w-full py-5 rounded-2xl bg-gradient-to-r from-orange-500 to-amber-500 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 text-2xl font-black flex items-center justify-center gap-2 shadow-lg">
                            <Play size={24} /> Los
                        </button>
                    </div>
                )}
                {!isActor && turn.stage === 'READY' && (
                    <p className="text-center text-slate-400 py-4 flex items-center justify-center gap-2"><Hourglass size={16} /> {actorName} liest den Begriff…</p>
                )}

                {/* Zeichenfläche: Darsteller malt, alle anderen sehen live zu */}
                {turn.type === 'DRAW' && ['RUNNING', 'PAUSED', 'REVEAL'].includes(turn.stage) && (
                    <>
                        <ActivityCanvas
                            key={turn.n}
                            lobbyCode={lobbyCode}
                            drawKey={`${turn.n}-${turn.card}`}
                            isActor={isActor}
                            canDraw={isActor && running && !countdown && !turn.result}
                        />
                    </>
                )}

                {/* Ergebnis melden */}
                {turn.result && turn.stage !== 'REVEAL' && (
                    <p className="text-center text-slate-400 animate-pulse">Wird ausgewertet…</p>
                )}
                {canConfirmGuess && (
                    winnerChoices ? (
                        <div className="bg-slate-800 rounded-2xl p-3 border border-slate-700">
                            <p className="text-sm text-slate-300 mb-2 text-center">Wer hat zuerst richtig geraten?</p>
                            <div className="grid grid-cols-2 gap-2">
                                {winnerChoices.map((k) => (
                                    <button key={k} onClick={() => finish('erraten', k)} className={`py-4 rounded-xl border-2 ${TEAM_INFO[k].ring} bg-slate-900 font-bold ${TEAM_INFO[k].text}`}>
                                        {teamName(k)}
                                    </button>
                                ))}
                                <button onClick={() => finish('aufgegeben')} className="py-4 rounded-xl bg-slate-700 font-bold col-span-2">Niemand</button>
                            </div>
                        </div>
                    ) : (
                        <button
                            onClick={() => finish('erraten', three ? teamOf(turn.guesser) : null)}
                            className="w-full py-6 rounded-2xl bg-gradient-to-r from-green-500 to-emerald-500 text-2xl font-black flex items-center justify-center gap-2 shadow-lg"
                        >
                            <Check size={28} /> Erraten
                        </button>
                    )
                )}

                {isActor && (turn.stage === 'READY' || (running && !turn.result)) && (
                    <div className="grid grid-cols-2 gap-2">
                        <button onClick={skipCard} disabled={skipsLeft === 0} className="py-3 rounded-xl bg-slate-800 border border-slate-600 font-bold flex items-center justify-center gap-2 disabled:opacity-40">
                            <SkipForward size={16} /> Tauschen ({skipsLeft < 0 ? '∞' : skipsLeft})
                        </button>
                        {running && (
                            <button onClick={() => window.confirm('Versuch aufgeben? Ihr rückt nicht vor.') && finish('aufgegeben')} className="py-3 rounded-xl bg-slate-800 border border-slate-600 font-bold flex items-center justify-center gap-2">
                                <Flag size={16} /> Aufgeben
                            </button>
                        )}
                    </div>
                )}
                {isActor && skipsLeft === 0 && ['READY', 'RUNNING'].includes(turn.stage) && (
                    <p className="text-[11px] text-center text-slate-500">Tauschen nicht mehr möglich — euer Budget für diese Partie ist aufgebraucht.</p>
                )}
                {!isActor && turn.stage !== 'REVEAL' && (
                    <p className="text-xs text-center text-slate-500">Tausche übrig für {teamName(turn.team)}: {skipsLeft < 0 ? '∞' : skipsLeft}</p>
                )}

                {/* Regelverstoß melden (alle Gegner) */}
                {isOpponent && running && !countdown && !turn.result && (
                    bannedMe ? (
                        <p className="text-xs text-center text-slate-500">Du hast dein Melderecht für diese Partie verloren.</p>
                    ) : canReport && (
                        reportOpen ? (
                            <div className="bg-slate-800 rounded-2xl p-3 border border-red-500/40">
                                <p className="text-sm text-slate-300 mb-2">Was ist passiert?</p>
                                <div className="flex flex-wrap gap-2">
                                    {REPORT_REASONS[turn.type].map((r) => (
                                        <button key={r} onClick={() => report(r)} className="px-3 py-2 rounded-xl bg-red-500/20 border border-red-500/50 text-sm font-bold">{r}</button>
                                    ))}
                                    <button onClick={() => setReportOpen(false)} className="px-3 py-2 rounded-xl bg-slate-700 text-sm"><X size={14} /></button>
                                </div>
                            </div>
                        ) : (
                            <button onClick={() => setReportOpen(true)} className="w-full py-3 rounded-xl border border-red-500/50 text-red-300 font-bold flex items-center justify-center gap-2">
                                <AlertTriangle size={16} /> Regelverstoß melden
                            </button>
                        )
                    )
                )}

                {/* ---- Auflösung ---- */}
                {turn.stage === 'REVEAL' && (() => {
                    const last = [...(gameState.history || [])].reverse().find((e) => !e.host && e.n === turn.n);
                    const moved = last ? order.filter((k) => (positions[k] || 0) !== (last.before?.[k] || 0)) : [];
                    return (
                        <div className="bg-slate-800 rounded-3xl p-5 border border-slate-700 text-center">
                            <p className="text-xs uppercase tracking-wide text-slate-400">Der Begriff war</p>
                            <p className="text-3xl font-black mb-2 break-words">{last?.word || card?.word || '—'}</p>
                            <p className={`font-bold ${last?.kind === 'erraten' ? 'text-green-400' : 'text-slate-300'}`}>
                                {RESULT_LABEL[last?.kind] || ''}{last?.winner ? ` — ${teamName(last.winner)}` : ''}
                            </p>
                            {moved.length > 0 && (
                                <p className="text-sm text-slate-400 mt-1">
                                    {moved.map((k) => `${teamName(k)} ${(positions[k] || 0) - (last.before?.[k] || 0) > 0 ? '+' : ''}${(positions[k] || 0) - (last.before?.[k] || 0)}`).join(' · ')}
                                </p>
                            )}
                            {isHost ? (
                                <button onClick={nextTurn} className="mt-4 w-full py-3 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 font-bold flex items-center justify-center gap-2">
                                    {order.some((k) => (positions[k] || 0) >= goal) ? 'Zum Endergebnis' : 'Nächster Zug'} <ArrowRight size={18} />
                                </button>
                            ) : (
                                <p className="mt-3 text-sm text-slate-500 animate-pulse">Warten auf den Partyleiter…</p>
                            )}
                        </div>
                    );
                })()}

                <ActivityBoard positions={positions} goal={goal} teamOrder={order} letterOf={letterOf} activeTeam={turn.team} />

                {isSpectator && <p className="text-xs text-center text-slate-500">Du bist erst später dazugekommen{!three && ' — der Host kann dich einem Team zuweisen'}.</p>}
            </div>

            {/* Schwebende Knöpfe: Regeln (alle) und Schiedsrichter (Host) */}
            <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-40">
                {isHost && (
                    <button onClick={() => setRefereeOpen(true)} aria-label="Schiedsrichter" className="w-12 h-12 rounded-full bg-slate-700 border border-slate-500 shadow-xl flex items-center justify-center">
                        <Gavel size={20} />
                    </button>
                )}
                <button onClick={() => setRulesOpen(true)} aria-label="Regeln" className="w-12 h-12 rounded-full bg-orange-600 shadow-xl flex items-center justify-center">
                    <HelpCircle size={22} />
                </button>
            </div>

            {rulesOpen && <RulesDialog onClose={() => setRulesOpen(false)} />}
            {refereeOpen && isHost && (
                <RefereePanel
                    onClose={() => setRefereeOpen(false)}
                    mode={cfg.referee}
                    involved={hostInvolved}
                    turn={turn}
                    order={order}
                    positions={positions}
                    goal={goal}
                    skipsLeft={gameState.skipsLeft || {}}
                    falseReports={falseReports}
                    history={gameState.history || []}
                    appliedN={gameState.appliedN}
                    players={players}
                    three={three}
                    proposal={proposal}
                    teamName={teamName}
                    nameOf={nameOf}
                    teamOf={teamOf}
                    resultLabel={RESULT_LABEL}
                    onCorrection={correction}
                    onPause={hostPause}
                    onResume={hostResume}
                    onAbort={hostAbort}
                    onEnd={hostEnd}
                    onAssign={assignSpectator}
                />
            )}
        </div>
    );
}
