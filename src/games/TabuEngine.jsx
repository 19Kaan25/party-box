import React, { useEffect, useRef, useState } from 'react';
import { doc, updateDoc } from '../lib/firestoreBridge';
import { serverNowMs } from '../lib/supabase';
import { createRestartGameState } from '../constants/gameSetup';
import {
    Check, SkipForward, Play, Pause, HelpCircle, Trophy, Crown, ArrowRight, Hourglass, Megaphone, Square, Flag, X, RotateCcw,
} from 'lucide-react';

import { shuffled, leastUsed, rankOf, globalPointsFor } from './activityLogic';
import { TEAM_INFO, seenWords, rememberWord } from './activityUi';
import { Modal } from './ActivityPanels';
import {
    scoreTurn, applyDelta, nextSide, pickExplainer, totalCycles, isGameOver, buildDeck, turnEntries, currentNr,
} from './tabuLogic';
import { SEEN_KEY, SEEN_LIMIT, poolFor } from './tabuUi';
import TabuSetup from './TabuSetup';

/**
 * Tabu — so viele Karten wie möglich in einer Runde erklären, Gegner buzzern
 * bei verbotenen Wörtern.
 *
 * Phasen: SETUP -> PLAYING -> RESULTS. In PLAYING trägt `gameState.turn` einen
 * Zug mit laufender Nummer `n` und den Stufen READY (Begriff verdeckt) ->
 * RUNNING (ggf. PAUSED durch den Host) -> REVIEW (ggf. erst Klauen, dann Liste).
 *
 * Schreibrechte während eines Zuges (keine Transaktionen!):
 *  - Kartenfortschritt `turn.results.{nr}` schreibt NUR der Erklärer; die
 *    aktuelle Karte ist die erste Nummer ohne Ergebnis.
 *  - Aufpasser schreiben NUR `turn.buzz.{nr}` mit der Kartennummer, die sie
 *    gesehen haben. Der Erklärer-Client schließt genau diese Karte als TABU ab,
 *    ein Buzzer für eine schon abgeschlossene Karte bleibt wirkungslos.
 *  - Zeitablauf dürfen Host und Erklärer auslösen (idempotent); verbucht wird
 *    nur vom Host, genau einmal (`appliedN`), zusammen mit dem nächsten Zug.
 * Bereit -> Läuft -> Auswertung -> nächster Zug tragen `gameState.phase` im
 * Patch und werden dadurch nicht optimistisch angezeigt (isSyncedMoment).
 *
 * Die Kartenreihenfolge der Partie liegt einmal als `deck` (Indizes in den
 * Pool aus poolFor(cfg)) im gameState; `ptr` rückt erst bei der Verbuchung weiter.
 */

const COUNTDOWN_MS = 3000;
const RESULT_INFO = {
    OK: { label: 'Richtig', sign: '✓', cls: 'text-green-400', flash: 'rgba(34,197,94,0.45)' },
    SKIP: { label: 'Übersprungen', sign: '↷', cls: 'text-amber-300', flash: 'rgba(234,179,8,0.4)' },
    TABU: { label: 'Tabu', sign: '✗', cls: 'text-red-400', flash: 'rgba(239,68,68,0.55)' },
};

// ---- Ton ohne Asset (Web Audio). Ein Kontext pro Seite, beim ersten Antippen entsperrt. ----
let audioCtx = null;
function audio() {
    try {
        audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch { audioCtx = null; }
    return audioCtx;
}
function beep(freq, ms, type = 'square') {
    const ctx = audio();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + ms / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + ms / 1000);
}
const vibrate = (ms) => { try { navigator.vibrate?.(ms); } catch { /* nicht überall erlaubt */ } };

function TabuCard({ card, shown }) {
    if (!card) return null;
    const words = card.forbidden?.slice(0, shown) || [];
    return (
        <div className="rounded-3xl overflow-hidden border-2 border-cyan-400/60 shadow-2xl">
            <div className="bg-gradient-to-br from-cyan-500 to-sky-600 px-4 py-4 text-center">
                <p className="text-3xl sm:text-4xl font-black break-words drop-shadow">{card.word}</p>
            </div>
            {words.length > 0 && (
                <div className="bg-red-600/90 px-4 py-2 text-center">
                    {words.map((w) => <p key={w} className="text-lg sm:text-xl font-bold text-white leading-snug">{w}</p>)}
                </div>
            )}
        </div>
    );
}

function TabuRules({ onClose }) {
    return (
        <Modal title="Regeln" onClose={onClose}>
            <div className="space-y-3 text-sm text-slate-300">
                <p>Pro Zug erklärt eine Person, das eigene Team rät <b>laut</b>. Erraten → „Richtig", sonst „Überspringen" — so viele Karten wie möglich, bis die Zeit um ist.</p>
                <p><span className="text-red-400 font-bold">Verboten:</span> der Begriff selbst, Wortteile und abgeleitete Formen, die Tabu-Wörter, Gesten, Geräusche, Reime/„klingt wie", Anfangsbuchstaben, Übersetzungen.</p>
                <p><b>Aufpasser</b> drücken „Tabu!", sobald ein verbotenes Wort fällt — die Karte ist dann weg. Sie raten nicht mit.</p>
                <p><b>Wertung:</b> jede erratene Karte +1, Tabu und Überspringen je nach Einstellung. Bei „Jeder gegen jeden" bekommen Erklärer und Ratender je +1.</p>
                <p><b>Auswertung:</b> Nach jedem Zug können Host und Erklärer einzelne Karten umschalten, falls etwas falsch getippt oder zu Unrecht gebuzzert wurde.</p>
                <p>Das Spielende wird nur nach einem vollen Umlauf geprüft — jedes Team hat dann gleich viele Züge gehabt.</p>
            </div>
        </Modal>
    );
}

export default function TabuEngine({ lobby, user, isHost, db, updateLobbyStatus, onlineIds }) {
    const { gameState, players, id: lobbyCode } = lobby;
    const me = user.uid;

    // ---- Alle Hooks ganz oben, vor jedem phasenabhängigen return ----
    const [now, setNow] = useState(() => serverNowMs());
    const [rulesOpen, setRulesOpen] = useState(false);
    const [pickGuesser, setPickGuesser] = useState(false);
    const appliedRef = useRef(-1);
    const expiredRef = useRef(-1);
    const buzzRef = useRef('');
    const feedbackRef = useRef(null);
    const stageRef = useRef(null);
    const flashRef = useRef(null);

    const turn = gameState.turn || null;
    const playing = gameState.phase === 'PLAYING';
    const cfg = gameState.cfg || {};
    const solo = !!gameState.solo;
    const members = gameState.members || {};
    const order = gameState.order || [];
    const scores = gameState.scores || {};
    const deck = gameState.deck || [];
    const ptr = gameState.ptr || 0;

    const lobbyRef = () => doc(db, 'lobbies', lobbyCode);
    const write = (patch) => updateDoc(lobbyRef(), patch);
    /** Gemeinsamer Moment: mit gameState.phase, damit niemand ihn früher sieht. */
    const writeSynced = (patch) => updateDoc(lobbyRef(), { 'gameState.phase': 'PLAYING', ...patch });

    // Leeres Set = Presence noch nicht da/kaputt: dann niemanden für weg halten.
    const isPresent = (id) => players.some((p) => p.id === id)
        && (!onlineIds || onlineIds.size === 0 || onlineIds.has(id));
    const nameOf = (id) => players.find((p) => p.id === id)?.name || 'Weg';
    const sideActive = (s) => (members[s] || []).some(isPresent);
    const sideOf = (id) => Object.keys(members).find((k) => members[k].includes(id)) || null;
    const sideName = (s) => (solo ? nameOf(s) : `Team ${TEAM_INFO[s]?.label}`);
    const sideText = (s) => (solo ? 'text-cyan-300' : TEAM_INFO[s]?.text);

    const pool = playing ? poolFor(cfg) : [];
    const cardAt = (i) => (deck.length ? pool[deck[(ptr + i) % deck.length]] : null);
    // Alles, was während eines Zuges geschrieben wird, trägt die Zugnummer n —
    // verspätete Schreibvorgänge aus dem Vorzug werden so ignoriert.
    const results = turn?.results || {};
    const nr = currentNr(results, turn?.n);
    const entries = turn ? turnEntries(results, Math.max(turn.shown || 0, turn.hostShown || 0), turn.n) : [];
    const card = turn ? cardAt(nr) : null;

    const running = turn?.stage === 'RUNNING';
    const countdown = running && now < turn.startAt ? Math.ceil((turn.startAt - now) / 1000) : 0;
    const remainingMs = turn && ['RUNNING', 'PAUSED'].includes(turn.stage)
        ? (turn.stage === 'PAUSED' ? turn.remainingMs : Math.max(0, Math.min(turn.endsAt - Math.max(now, turn.startAt), (cfg.seconds || 60) * 1000)))
        : 0;
    const live = running && !countdown && now < turn.endsAt;
    const review = turn?.stage === 'REVIEW';
    const stealSide = turn ? nextSide(order, turn.side, sideActive).side : null;
    const steal = turn && turn.steal?.n === turn.n ? turn.steal.v : null;
    const stealPending = review && cfg.steal && !turn.aborted && entries.length > 0
        && entries[entries.length - 1] === null && !steal && stealSide && stealSide !== turn.side;

    // Uhr für Timer/Countdown (Serverzeit, s. measureClockOffset in useLobby).
    useEffect(() => {
        if (!playing) return undefined;
        const timer = setInterval(() => setNow(serverNowMs()), 250);
        return () => clearInterval(timer);
    }, [playing]);

    // Erklärer hält das Handy oft nur — Bildschirm wach halten.
    const wakeWanted = playing && !!turn && !review;
    useEffect(() => {
        if (!wakeWanted || !navigator.wakeLock) return undefined;
        let lock = null;
        let cancelled = false;
        navigator.wakeLock.request('screen')
            .then((l) => { if (cancelled) l.release().catch(() => {}); else lock = l; })
            .catch(() => {});
        // shortcut: nach einem Tab-Wechsel wird der Lock nicht neu angefordert, erst beim nächsten Zug.
        return () => { cancelled = true; lock?.release().catch(() => {}); };
    }, [wakeWanted]);

    // Begriffe merken, sobald die Auswertung sie allen zeigt (Gedächtnis gegen Wiederholung).
    const reviewWords = review && !stealPending ? entries.map((_, i) => cardAt(i)?.word).filter(Boolean).join('\n') : '';
    useEffect(() => {
        if (reviewWords) reviewWords.split('\n').forEach((w) => rememberWord(w, SEEN_KEY, SEEN_LIMIT));
    }, [reviewWords]);

    // ---- Erklärer: Buzzer für die AKTUELLE Karte als TABU abschließen ----
    const buzzEntry = turn?.buzz?.[nr];
    const buzzBy = turn && buzzEntry?.n === turn.n ? buzzEntry.by : null;
    useEffect(() => {
        if (!turn || turn.explainer !== me || !['RUNNING', 'PAUSED'].includes(turn.stage) || !buzzBy) return;
        const key = `${turn.n}:${nr}`;
        if (buzzRef.current === key) return;
        buzzRef.current = key;
        write({ [`gameState.turn.results.${nr}`]: { r: 'TABU', by: buzzBy, n: turn.n } });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [turn?.n, turn?.stage, turn?.explainer, nr, buzzBy]);

    // ---- Zeitablauf: Host UND Erklärer dürfen auslösen ----
    // Der Erklärer nur frisch: kommt sein Handy nach Minuten aus dem Standby, hat der Host
    // den Zug längst beendet — ein später REVIEW-Patch träfe sonst den nächsten Zug.
    // Kartenzahl in getrennten Feldern (max zählt): der Host sieht die letzten Taps des
    // Erklärers evtl. noch nicht und dürfte dessen Wert nicht überschreiben.
    useEffect(() => {
        if (!playing || !running || now < turn.endsAt) return;
        const asExplainer = turn.explainer === me && now - turn.endsAt < 2000;
        if (!(isHost || asExplainer) || expiredRef.current === turn.n) return;
        expiredRef.current = turn.n;
        writeSynced({ 'gameState.turn.stage': 'REVIEW', [`gameState.turn.${asExplainer ? 'shown' : 'hostShown'}`]: nr + 1 });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [now, playing, running, turn?.n, turn?.endsAt, isHost]);

    // ---- Rückmeldung bei jedem Kartenergebnis: Aufblitzen, Ton, Vibration ----
    useEffect(() => {
        const prev = feedbackRef.current;
        feedbackRef.current = { n: turn?.n, nr };
        // Erster Render (z. B. nach Neuladen) und Korrekturen in der Auswertung blitzen nicht.
        if (!turn || !prev || prev.n !== turn.n || nr <= prev.nr || review) return;
        const info = RESULT_INFO[results[nr - 1]?.r];
        if (!info) return;
        flashRef.current?.animate([{ backgroundColor: info.flash }, { backgroundColor: 'rgba(0,0,0,0)' }], { duration: 450, easing: 'ease-out' });
        if (results[nr - 1].r === 'TABU') { beep(180, 450, 'sawtooth'); vibrate([120, 60, 120]); }
        else if (results[nr - 1].r === 'OK') beep(880, 110, 'sine');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [turn?.n, nr]);

    // Zeitablauf-Ton, sobald die Auswertung beginnt (nicht bei Abbruch).
    useEffect(() => {
        const prev = stageRef.current;
        stageRef.current = turn ? `${turn.n}:${turn.stage}` : null;
        if (prev === `${turn?.n}:RUNNING` && review && !turn.aborted) { beep(440, 250); setTimeout(() => beep(330, 450), 260); vibrate(300); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [turn?.n, turn?.stage, turn?.aborted, review]);

    // ---- Aktionen ----

    /** Nächsten Zug für `side` zusammenstellen (nur Host). */
    const buildTurn = (gs, side) => {
        const count = gs.explainCount?.[side] || 0;
        let watchers = [];
        if (!gs.solo) {
            const opponents = Object.keys(gs.members).filter((k) => k !== side).flatMap((k) => gs.members[k].filter(isPresent));
            if (gs.cfg.watcher === 'ALL') watchers = opponents;
            else if (gs.cfg.watcher === 'ONE') watchers = [leastUsed(opponents, gs.watchCount || {})].filter(Boolean);
        }
        const watchCount = { ...(gs.watchCount || {}) };
        if (gs.cfg.watcher === 'ONE') watchers.forEach((id) => { watchCount[id] = (watchCount[id] || 0) + 1; });
        return {
            turn: {
                n: (gs.turn?.n || 0) + 1, side, explainer: pickExplainer(gs.members[side], count, isPresent), watchers,
                stage: 'READY', results: {}, buzz: {}, shown: 0, hostShown: 0, steal: null, aborted: false, hold: false,
            },
            explainCount: { ...(gs.explainCount || {}), [side]: count + 1 },
            watchCount,
        };
    };

    const startGame = async (setup) => {
        if (!isHost) return;
        const isSolo = setup.mode === 'SOLO';
        const sides = isSolo
            ? Object.fromEntries(players.map((p) => [p.id, [p.id]]))
            : Object.fromEntries(Object.entries(setup.teams).filter(([, m]) => m.length > 0));
        const gameCfg = { ...setup, teams: undefined };
        const gamePool = poolFor(gameCfg);
        if (!gamePool.length) return;
        const keys = shuffled(Object.keys(sides));
        const state = {
            phase: 'PLAYING',
            setup: gameState.setup,           // Rohwerte, überleben "Nochmal"
            restartVersion: gameState.restartVersion,
            optedOut: gameState.optedOut,
            cfg: gameCfg,
            solo: isSolo,
            members: sides,
            order: keys,
            deck: buildDeck(gamePool.map((c) => c.word), seenWords(SEEN_KEY)),
            ptr: 0,
            scores: Object.fromEntries(keys.map((k) => [k, 0])),
            stats: {},
            cycle: 1,
            cycles: totalCycles(gameCfg.rounds, sides),
            appliedN: 0,
            explainCount: {},
            watchCount: {},
            turn: null,
        };
        const first = buildTurn(state, keys[0]);
        await updateDoc(lobbyRef(), { gameState: { ...state, ...first } });
    };

    const go = () => {
        if (turn?.explainer !== me || turn.stage !== 'READY') return;
        audio();
        const startAt = serverNowMs() + COUNTDOWN_MS;
        writeSynced({
            'gameState.turn.stage': 'RUNNING',
            'gameState.turn.startAt': startAt,
            'gameState.turn.endsAt': startAt + (cfg.seconds || 60) * 1000,
        });
    };

    const skipsUsed = entries.filter((e) => e?.r === 'SKIP').length;
    const canSkip = cfg.skips < 0 || skipsUsed < cfg.skips;

    /** Nur der Erklärer schreibt Kartenergebnisse. */
    const mark = (r, by = null) => {
        setPickGuesser(false);
        if (turn?.explainer !== me || !live || serverNowMs() >= turn.endsAt) return;
        if (r === 'SKIP' && !canSkip) return;
        write({ [`gameState.turn.results.${nr}`]: by ? { r, g: by, n: turn.n } : { r, n: turn.n } });
    };

    const mySide = sideOf(me);
    const isExplainer = turn?.explainer === me;
    const isWatcher = !!turn?.watchers?.includes(me);
    const canBuzz = !!turn && !isExplainer && !!mySide
        && (solo || (cfg.watcher === 'ONE' ? isWatcher : mySide !== turn.side));
    const buzzed = !!buzzBy;

    const buzz = () => {
        if (!canBuzz || !live || buzzed) return;
        vibrate(80);
        write({ [`gameState.turn.buzz.${nr}`]: { by: me, n: turn.n } });
    };

    const answerSteal = (ok) => {
        if (!stealPending || !(isHost || isExplainer)) return;
        writeSynced({ 'gameState.turn.steal': { v: ok ? 'OK' : 'MISS', n: turn.n } });
    };

    /** Auswertung: Host und Erklärer schalten ✓ → ↷ → ✗ (letzte Karte auch zurück auf "Zeit um"). */
    const toggleEntry = (i) => {
        if (!review || stealPending || !(isHost || isExplainer) || gameState.appliedN === turn.n) return;
        const cycle = i === entries.length - 1 ? ['OK', 'SKIP', 'TABU', null] : ['OK', 'SKIP', 'TABU'];
        const cur = entries[i]?.r ?? null;
        const next = cycle[(cycle.indexOf(cur) + 1) % cycle.length];
        // g (Ratender) und by (Buzzer) bleiben stehen, gewertet wird g nur bei OK.
        write({ [`gameState.turn.results.${i}`]: { ...(entries[i] || {}), r: next, n: turn.n } });
    };

    /** Host: Zug verbuchen und gleich den nächsten aufstellen — ein Patch, genau einmal. */
    const applyTurn = async () => {
        if (!isHost || !review || stealPending) return;
        if (gameState.appliedN === turn.n || appliedRef.current === turn.n) return;
        appliedRef.current = turn.n;
        const { delta, explained } = scoreTurn({ entries, side: turn.side, solo, cfg, steal, stealSide });
        const newScores = applyDelta(scores, delta);
        const stats = { ...(gameState.stats || {}) };
        if (explained) stats[turn.explainer] = (stats[turn.explainer] || 0) + explained;
        const base = {
            'gameState.scores': newScores,
            'gameState.stats': stats,
            'gameState.ptr': ptr + entries.length,
            'gameState.appliedN': turn.n,
        };
        const { side, wrapped } = nextSide(order, turn.side, sideActive);
        try {
            if (!side || (wrapped && isGameOver({ scores: newScores, cfg, cyclesDone: gameState.cycle, cycles: gameState.cycles }))) {
                await write({ ...base, 'gameState.phase': 'RESULTS' });
                return;
            }
            const next = buildTurn(gameState, side);
            await writeSynced({
                ...base,
                'gameState.cycle': (gameState.cycle || 1) + (wrapped ? 1 : 0),
                'gameState.turn': next.turn,
                'gameState.explainCount': next.explainCount,
                'gameState.watchCount': next.watchCount,
            });
        } catch {
            appliedRef.current = -1; // Schreiben gescheitert: erneut versuchen lassen
        }
    };

    // ---- Host-Werkzeuge ----
    const hostPause = () => {
        if (!isHost || !running) return;
        const n = serverNowMs();
        write({ 'gameState.turn.stage': 'PAUSED', 'gameState.turn.hold': true, 'gameState.turn.remainingMs': Math.max(0, Math.min(turn.endsAt - Math.max(n, turn.startAt), (cfg.seconds || 60) * 1000)) });
    };
    const hostResume = () => {
        if (!isHost || turn?.stage !== 'PAUSED') return;
        // Hat die Pause einen gleichzeitigen Zeitablauf überschrieben, muss er neu auslösen dürfen.
        expiredRef.current = -1;
        const n = serverNowMs();
        write({ 'gameState.turn.stage': 'RUNNING', 'gameState.turn.startAt': n, 'gameState.turn.endsAt': n + turn.remainingMs, 'gameState.turn.hold': false });
    };
    /** Zug abbrechen (z. B. Erklärer weg): Punkte bis hierhin bleiben, Auswertung folgt. */
    const hostAbort = () => {
        if (!isHost || !turn || review || !window.confirm('Zug abbrechen? Bisherige Karten werden normal ausgewertet.')) return;
        // Während des Countdowns hat noch niemand eine Karte gesehen.
        const seen = turn.startAt && serverNowMs() >= turn.startAt;
        writeSynced({ 'gameState.turn.stage': 'REVIEW', 'gameState.turn.hostShown': seen ? nr + 1 : 0, 'gameState.turn.aborted': true });
    };
    const hostEnd = () => {
        if (isHost && window.confirm('Spiel mit dem aktuellen Stand beenden?')) write({ 'gameState.phase': 'RESULTS' });
    };

    // ---- Rangliste ----
    const values = order.map((k) => scores[k] || 0);
    const ranking = [...order].sort((a, b) => (scores[b] || 0) - (scores[a] || 0));

    /** Globale Punkte verbuchen; danach zurück in die Lobby oder "Nochmal" mit denselben Einstellungen/Teams. */
    const finishGame = async (again = false) => {
        const points = lobby.settings?.globalLeaderboard && {
            players: players.map((p) => {
                const s = sideOf(p.id);
                const added = s ? globalPointsFor(rankOf(scores[s] || 0, values)) : 0;
                return { ...p, globalScore: (p.globalScore ?? 0) + added };
            }),
        };
        if (again) {
            await updateLobbyStatus(null, null, { ...points, gameState: createRestartGameState('TABU', gameState) });
            return;
        }
        // ACHTUNG: status 'LOBBY_WAITING' verwirft alle gameState-Keys desselben Patches.
        await updateLobbyStatus('LOBBY_WAITING', null, { ...points, gameState: {} });
    };

    // ---- Phasen ----

    if (gameState.phase === 'SETUP') {
        return (
            <TabuSetup
                players={players}
                setup={gameState.setup}
                isHost={isHost}
                updateSetup={(key, value) => isHost && write({ [`gameState.setup.${key}`]: value })}
                onStart={startGame}
            />
        );
    }

    if (gameState.phase === 'RESULTS') {
        const best = Object.entries(gameState.stats || {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
        return (
            <div className="min-h-screen bg-slate-900 text-white p-4 sm:p-8">
                <div className="max-w-2xl mx-auto flex flex-col items-center">
                    <h2 className="text-4xl sm:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-sky-300 mb-8 tracking-wider uppercase mt-10">
                        Endergebnis
                    </h2>
                    <div className="w-full bg-slate-800 rounded-3xl p-5 sm:p-8 border border-slate-700 shadow-2xl mb-6 space-y-3">
                        {ranking.map((k) => {
                            const rank = rankOf(scores[k] || 0, values);
                            return (
                                <div key={k} className={`flex items-center gap-3 rounded-2xl p-4 border ${rank === 1 ? 'bg-yellow-500/10 border-yellow-500/40' : 'bg-slate-900/50 border-slate-700'}`}>
                                    <span className={`text-2xl font-black w-7 shrink-0 ${rank === 1 ? 'text-yellow-400' : 'text-slate-500'}`}>{rank}</span>
                                    {rank === 1 && <Crown size={20} className="text-yellow-400 shrink-0" />}
                                    <div className="min-w-0 flex-1">
                                        <p className={`font-bold truncate ${sideText(k)}`}>{sideName(k)}</p>
                                        {!solo && <p className="text-xs text-slate-500 truncate">{(members[k] || []).map(nameOf).join(', ')}</p>}
                                    </div>
                                    <span className="font-mono text-xl text-cyan-300 shrink-0">{scores[k] || 0}</span>
                                </div>
                            );
                        })}
                    </div>
                    {best.length > 0 && (
                        <div className="w-full bg-slate-800 rounded-3xl p-5 border border-slate-700 mb-8">
                            <p className="text-sm font-bold text-slate-300 mb-3 flex items-center gap-2"><Megaphone size={16} className="text-cyan-400" /> Beste Erklärer</p>
                            {best.map(([id, n]) => (
                                <p key={id} className="flex justify-between py-1"><span>{nameOf(id)}</span><span className="text-slate-400">{n} erraten</span></p>
                            ))}
                        </div>
                    )}
                    {isHost ? (
                        <div className="w-full max-w-sm space-y-2">
                            <button onClick={() => finishGame(true)} className="w-full bg-gradient-to-r from-cyan-500 to-sky-500 hover:from-cyan-400 hover:to-sky-400 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2">
                                <RotateCcw size={18} /> Nochmal
                            </button>
                            <button onClick={() => finishGame()} className="w-full bg-slate-800 border border-slate-600 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2">
                                <Trophy size={18} /> Zurück zur Lobby
                            </button>
                        </div>
                    ) : (
                        <p className="text-slate-500 text-sm animate-pulse">Warten auf den Partyleiter…</p>
                    )}
                </div>
            </div>
        );
    }

    if (!playing || !turn) return null;

    // ---- PLAYING ----
    const explainerName = nameOf(turn.explainer);
    const seesCard = (isExplainer || isWatcher) && (live || turn.stage === 'PAUSED');
    const seconds = Math.ceil(remainingMs / 1000);
    const turnPoints = scoreTurn({ entries, side: turn.side, solo, cfg }).delta[turn.side] || 0;
    const okCount = entries.filter((e) => e?.r === 'OK').length;
    const explainerMissing = !review && !isPresent(turn.explainer);
    const shownTabu = cfg.tabuShown ?? 5;

    let role;
    if (!mySide) role = { text: 'Du schaust zu', cls: 'bg-slate-700 text-slate-200' };
    else if (isExplainer) role = { text: 'Du erklärst', cls: 'bg-cyan-500 text-white' };
    else if (isWatcher) role = { text: 'Du passt auf — nicht mitraten', cls: 'bg-red-600 text-white' };
    else if (solo) role = { text: 'Rate laut mit!', cls: 'bg-green-600 text-white' };
    else if (mySide === turn.side) role = { text: 'Du rätst — laut!', cls: 'bg-green-600 text-white' };
    else if (canBuzz) role = { text: 'Schau dem Erklärer über die Schulter', cls: 'bg-red-600 text-white' };
    else role = { text: `${sideName(turn.side)} ist dran`, cls: 'bg-slate-700 text-slate-200' };

    return (
        <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center p-3 sm:p-6 pb-24" onPointerDown={audio}>
            <div ref={flashRef} className="fixed inset-0 pointer-events-none z-30" />
            <div className="w-full max-w-xl mt-14 space-y-3">
                {/* Spielstand */}
                <div className="flex flex-wrap gap-1.5 justify-center text-sm">
                    {order.map((k) => (
                        <span key={k} className={`px-2.5 py-1 rounded-xl bg-slate-800 border ${k === turn.side ? 'border-cyan-400' : 'border-slate-700'}`}>
                            <span className={`font-bold ${sideText(k)}`}>{sideName(k)}</span> <span className="font-mono">{scores[k] || 0}</span>
                        </span>
                    ))}
                </div>
                <p className="text-xs text-center text-slate-500">
                    {cfg.endMode === 'ROUNDS' ? `Runde ${gameState.cycle} von ${gameState.cycles}` : `Ziel: ${cfg.target} Punkte · Runde ${gameState.cycle}`}
                </p>

                <div className={`rounded-2xl px-4 py-2 text-center font-black ${role.cls}`}>{role.text}</div>
                <div className="flex items-center gap-2 text-sm bg-slate-800 rounded-2xl px-3 py-2 border border-slate-700">
                    <span className={`font-bold ${sideText(turn.side)}`}>{sideName(turn.side)}</span>
                    <span className="text-slate-500">·</span>
                    <span className="truncate">erklärt: {explainerName}</span>
                    {!review && turn.stage !== 'READY' && <span className="ml-auto font-bold text-cyan-300 shrink-0">{turnPoints >= 0 ? '+' : ''}{turnPoints} · {okCount} ✓</span>}
                </div>

                {['RUNNING', 'PAUSED'].includes(turn.stage) && (
                    <div className={`rounded-2xl py-1 text-center font-black text-4xl font-mono tabular-nums border ${live && seconds <= 10 ? 'bg-red-600/30 border-red-500 text-red-200 animate-pulse' : 'bg-slate-800 border-slate-700'}`}>
                        {countdown ? `${countdown}…` : `${seconds}s`}
                        {turn.stage === 'PAUSED' && <span className="block text-xs font-sans font-bold text-amber-300">vom Host pausiert</span>}
                    </div>
                )}

                {explainerMissing && (
                    <div className="rounded-2xl bg-amber-500/15 border border-amber-500/40 p-3 text-center">
                        <p className="font-bold text-amber-300">{explainerName} ist nicht mehr da.</p>
                        {isHost && <button onClick={hostAbort} className="mt-1 text-sm underline text-amber-200">Zug abbrechen</button>}
                    </div>
                )}

                {/* ---- Bereit ---- */}
                {turn.stage === 'READY' && (isExplainer ? (
                    <div className="space-y-3">
                        <p className="text-center text-slate-300">Bereit? Die erste Karte erscheint erst nach „Los" — dann läuft die Zeit ({cfg.seconds} s).</p>
                        <button onClick={go} className="w-full py-6 rounded-3xl bg-gradient-to-r from-cyan-500 to-sky-500 text-3xl font-black flex items-center justify-center gap-2 shadow-lg">
                            <Play size={28} /> Los
                        </button>
                    </div>
                ) : (
                    <p className="text-center text-slate-400 py-6 flex items-center justify-center gap-2"><Hourglass size={16} /> {explainerName} macht sich bereit…</p>
                ))}

                {/* ---- Läuft ---- */}
                {seesCard && <TabuCard card={card} shown={shownTabu} />}

                {isExplainer && live && (pickGuesser ? (
                    <div className="bg-slate-800 rounded-3xl p-3 border border-slate-700">
                        <p className="text-sm text-slate-300 mb-2 text-center">Wer hat es erraten?</p>
                        <div className="grid grid-cols-2 gap-2">
                            {order.filter((k) => k !== me && sideActive(k)).map((k) => (
                                <button key={k} onClick={() => mark('OK', k)} className="py-5 rounded-2xl bg-green-600 font-black text-lg truncate px-2">{nameOf(k)}</button>
                            ))}
                            <button onClick={() => setPickGuesser(false)} className="py-3 rounded-2xl bg-slate-700 font-bold col-span-2 flex items-center justify-center gap-2"><X size={16} /> Zurück</button>
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-3">
                        <button onClick={() => mark('SKIP')} disabled={!canSkip} className="h-28 rounded-3xl bg-amber-500 disabled:bg-slate-700 disabled:text-slate-500 text-2xl font-black flex flex-col items-center justify-center gap-1 shadow-lg">
                            <SkipForward size={32} /> Überspringen
                            {cfg.skips > 0 && <span className="text-xs font-bold">{Math.max(0, cfg.skips - skipsUsed)} übrig</span>}
                        </button>
                        <button onClick={() => (solo ? setPickGuesser(true) : mark('OK'))} className="h-28 rounded-3xl bg-green-500 text-2xl font-black flex flex-col items-center justify-center gap-1 shadow-lg">
                            <Check size={36} /> Richtig
                        </button>
                    </div>
                ))}

                {canBuzz && live && (
                    <div className="space-y-2">
                        <button onClick={buzz} disabled={buzzed} className="w-full h-36 rounded-3xl bg-red-600 active:bg-red-700 disabled:bg-red-900 disabled:text-red-300 text-5xl font-black shadow-2xl shadow-red-900/50 border-4 border-red-400">
                            {buzzed ? '…' : 'Tabu!'}
                        </button>
                        <p className="text-xs text-center text-slate-400">{solo ? 'Fällt ein verbotenes Wort? Drücken!' : 'Du passt auf — nicht mitraten.'}</p>
                    </div>
                )}

                {!isExplainer && !seesCard && ['RUNNING', 'PAUSED'].includes(turn.stage) && !countdown && (
                    <div className="bg-slate-800 rounded-3xl p-5 border border-slate-700 text-center">
                        <p className="text-slate-400 text-sm">Bisher erraten</p>
                        <p className="text-6xl font-black text-green-400">{okCount}</p>
                    </div>
                )}

                {/* ---- Zeit um: erst Klauen, dann Auswertung ---- */}
                {stealPending && (
                    <div className="bg-slate-800 rounded-3xl p-5 border-2 border-amber-500/60 text-center space-y-3">
                        <p className="font-black text-xl text-amber-300">Zeit um — {sideName(stealSide)} darf klauen!</p>
                        <p className="text-sm text-slate-400">Ein Rateversuch für die offene Karte.</p>
                        {isExplainer && <TabuCard card={cardAt(entries.length - 1)} shown={0} />}
                        {(isHost || isExplainer) ? (
                            <div className="grid grid-cols-2 gap-2">
                                <button onClick={() => answerSteal(false)} className="py-4 rounded-2xl bg-slate-700 font-bold">Daneben</button>
                                <button onClick={() => answerSteal(true)} className="py-4 rounded-2xl bg-green-600 font-bold">Richtig geklaut</button>
                            </div>
                        ) : <p className="text-sm text-slate-500 animate-pulse">{explainerName} entscheidet…</p>}
                    </div>
                )}

                {review && !stealPending && (() => {
                    const delta = scoreTurn({ entries, side: turn.side, solo, cfg, steal, stealSide }).delta;
                    const canEdit = (isHost || isExplainer) && gameState.appliedN !== turn.n;
                    return (
                        <div className="bg-slate-800 rounded-3xl p-4 sm:p-5 border border-slate-700">
                            <p className="font-black text-xl mb-1 text-center">{turn.aborted ? 'Zug abgebrochen' : 'Zeit um!'}</p>
                            {canEdit && entries.length > 0 && <p className="text-xs text-center text-slate-400 mb-3">Eintrag antippen, um ihn zu korrigieren.</p>}
                            <div className="space-y-1.5 mb-4">
                                {entries.map((e, i) => {
                                    const info = RESULT_INFO[e?.r];
                                    return (
                                        <button key={i} onClick={() => toggleEntry(i)} disabled={!canEdit} className="w-full flex items-center gap-3 rounded-xl bg-slate-900/60 border border-slate-700 px-3 py-2 text-left disabled:cursor-default">
                                            <span className={`text-xl font-black w-6 ${info?.cls || 'text-slate-500'}`}>{info?.sign || '⏱'}</span>
                                            <span className="flex-1 font-bold truncate">{cardAt(i)?.word}</span>
                                            <span className={`text-xs ${info?.cls || 'text-slate-500'}`}>
                                                {info ? info.label : steal === 'OK' && i === entries.length - 1 ? `geklaut (${sideName(stealSide)})` : 'Zeit um'}
                                                {e?.r === 'OK' && solo && e.g ? ` · ${nameOf(e.g)}` : ''}
                                                {e?.r === 'TABU' && e.by ? ` · ${nameOf(e.by)}` : ''}
                                            </span>
                                        </button>
                                    );
                                })}
                                {entries.length === 0 && <p className="text-center text-slate-500 text-sm">Keine Karten in diesem Zug.</p>}
                            </div>
                            <p className="text-center text-sm text-slate-300 mb-3">
                                {Object.keys(delta).length ? Object.entries(delta).map(([s, n]) => `${sideName(s)} ${n > 0 ? '+' : ''}${n}`).join(' · ') : 'Keine Punkte'}
                            </p>
                            {isHost ? (
                                <button onClick={applyTurn} className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-sky-500 font-bold flex items-center justify-center gap-2">
                                    Weiter <ArrowRight size={18} />
                                </button>
                            ) : (
                                <p className="text-sm text-center text-slate-500 animate-pulse">Warten auf den Partyleiter…</p>
                            )}
                        </div>
                    );
                })()}

                {/* Host: Notfallknöpfe */}
                {isHost && (
                    <div className="flex flex-wrap justify-center gap-2 pt-2">
                        {running && <button onClick={hostPause} className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-600 text-sm flex items-center gap-1.5"><Pause size={14} /> Pause</button>}
                        {turn.stage === 'PAUSED' && <button onClick={hostResume} className="px-3 py-2 rounded-xl bg-cyan-600 text-sm flex items-center gap-1.5"><Play size={14} /> Weiter</button>}
                        {!review && <button onClick={hostAbort} className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-600 text-sm flex items-center gap-1.5"><Square size={14} /> Zug abbrechen</button>}
                        <button onClick={hostEnd} className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-600 text-sm flex items-center gap-1.5"><Flag size={14} /> Spiel beenden</button>
                    </div>
                )}
                {!mySide && <p className="text-xs text-center text-slate-500">Du bist erst später dazugekommen und schaust zu.</p>}
            </div>

            <button onClick={() => setRulesOpen(true)} aria-label="Regeln" className="fixed bottom-4 right-4 z-40 w-12 h-12 rounded-full bg-cyan-600 shadow-xl flex items-center justify-center">
                <HelpCircle size={22} />
            </button>
            {rulesOpen && <TabuRules onClose={() => setRulesOpen(false)} />}
        </div>
    );
}
