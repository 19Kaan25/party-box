/* =====================================================================
 *  Werwolf auf EINEM Handy.
 *
 *  Erst wandert das Handy fuer die Rollenvergabe durch die Runde, danach
 *  behaelt es der Erzaehler und wird durch Naechte und Tage gefuehrt. Alle
 *  anderen Lobby-Mitglieder sehen nur "Spiel laeuft...".
 *
 *  Zustandshaltung wie bei Imposter: lokaler State ZUERST (kein Roundtrip
 *  pro Tastendruck), danach Spiegelung nach gameState.sd. Beim Mounten wird
 *  der lokale State daraus vorbelegt -- laedt der Host mitten im Spiel neu,
 *  geht es genau dort weiter.
 *
 *  gameState.sd = { step, roster, narratorKey, roleCounts, rules,
 *                   revealIndex, revealStage, game }
 *  gameState.phase = 'SETUP' | 'SINGLE_RUNNING'
 *
 *  FALLE: Ein Patch mit status 'LOBBY_WAITING' beendet die games-Zeile und
 *  wirft gameState weg -- "Neues Spiel" fasst die Lobby deshalb nie an,
 *  damit Mitspielerliste und Rollenverteilung erhalten bleiben.
 * ===================================================================== */

import React, { useState } from 'react';
import {
    Moon, Sun, Skull, Heart, Syringe, FlaskConical, Target,
    Eye, EyeOff, Crown, Trophy, Smartphone, Check, Wrench, Users, ArrowRight, Ghost
} from 'lucide-react';

import { doc, updateDoc } from '../lib/firestoreBridge';
import GameHeader from '../components/GameHeader';
import RosterPanel from '../components/RosterPanel';
import { WERWOLF_ROLES } from '../constants/gameData';
import { shuffleArray } from '../utils/helpers';
import { seedRoster } from '../utils/roster';

const DEFAULT_RULES = { witchSelfHeal: true, amorFirstNightOnly: true };
const EMPTY_COUNTS = {
    WERWOLF: 0, DORFBEWOHNER: 0, SEHERIN: 0, HEXE: 0, AMOR: 0, JAEGER: 0, KLEINES_MAEDCHEN: 0
};

/* ---------------------------------------------------------------------
 * Reine Spiellogik -- ohne React, damit sie sich am Stueck lesen laesst.
 * ------------------------------------------------------------------- */

/** Rollenvorschlag fuer n Mitspieler (ohne Erzaehler). Fuellt auf n auf. */
function suggestCounts(n) {
    if (n <= 0) return { ...EMPTY_COUNTS };
    const counts = { ...EMPTY_COUNTS };
    counts.WERWOLF = Math.max(1, Math.floor(n / 4));
    if (n >= 3) counts.SEHERIN = 1;
    if (n >= 5) counts.HEXE = 1;
    if (n >= 6) counts.AMOR = 1;
    if (n >= 7) counts.JAEGER = 1;
    if (n >= 8) counts.KLEINES_MAEDCHEN = 1;

    const used = Object.values(counts).reduce((a, b) => a + b, 0);
    if (used > n) {
        // Zu wenig Leute fuer die Sonderrollen: von hinten wieder abbauen.
        const order = ['KLEINES_MAEDCHEN', 'JAEGER', 'AMOR', 'HEXE', 'SEHERIN'];
        let over = used - n;
        for (const id of order) {
            while (over > 0 && counts[id] > 0) { counts[id] -= 1; over -= 1; }
        }
    }
    counts.DORFBEWOHNER = Math.max(0, n - Object.values(counts).reduce((a, b) => a + b, 0));
    return counts;
}

/** Toetet Spieler und zieht das Liebespaar automatisch mit. */
function killPlayers(playerState, kills) {
    const next = { ...playerState };
    const dead = [];
    const queue = [...kills];

    while (queue.length > 0) {
        const { key, reason } = queue.shift();
        if (!next[key] || !next[key].alive) continue;

        next[key] = { ...next[key], alive: false, deathReason: reason };
        dead.push({ key, reason });

        // Liebespaar: stirbt einer, stirbt der andere aus Liebeskummer mit.
        if (next[key].inLove) {
            Object.keys(next).forEach((other) => {
                if (other !== key && next[other].inLove && next[other].alive) {
                    queue.push({ key: other, reason: 'Liebeskummer' });
                }
            });
        }
    }
    return { playerState: next, dead };
}

function checkWinner(playerState) {
    const alive = Object.values(playerState).filter((s) => s.alive);
    if (alive.length === 0) return 'UNENTSCHIEDEN';
    if (alive.every((s) => s.inLove)) return 'LIEBESPAAR';
    const wolves = alive.filter((s) => s.role === 'WERWOLF').length;
    if (wolves === 0) return 'DORF';
    if (wolves >= alive.length - wolves) return 'WERWOLFE';
    return null;
}

const aliveRoles = (playerState) =>
    new Set(Object.values(playerState).filter((s) => s.alive).map((s) => s.role));

/** Schrittfolge der aktuellen Nacht. Tote Rollen fallen automatisch raus. */
function buildNightSteps(game, rules) {
    const alive = aliveRoles(game.playerState);
    const steps = [];
    if (alive.has('AMOR') && (game.dayNumber === 1 || !rules.amorFirstNightOnly)) {
        steps.push('AMOR', 'LOVERS_MEET');
    }
    if (alive.has('SEHERIN')) steps.push('SEHERIN');
    if (alive.has('WERWOLF')) steps.push('WERWOLF');
    if (alive.has('HEXE')) steps.push('HEXE');
    return steps;
}

const DAY_STEPS = ['DAY_DEATHS', 'DAY_VOTE'];

/** Wer bei diesem Schritt wach ist -- fuer die Hervorhebung im Raster. */
const ACTOR_ROLE = {
    AMOR: 'AMOR', SEHERIN: 'SEHERIN', WERWOLF: 'WERWOLF', HEXE: 'HEXE'
};

export default function WerwolfSingleDevice({ lobby, user, isHost, db, updateLobbyStatus, leaveLobby }) {
    const { gameState, players, id: lobbyCode } = lobby;
    const settings = gameState.settings || {};
    const saved = gameState.sd || {};

    // Alle Hooks ganz oben -- die Phasen sind bedingte Returns (Engine-Konvention).
    const [step, setStep] = useState(saved.step || 'SETUP');
    const [roster, setRoster] = useState(() => seedRoster(saved.roster, players));
    const [narratorKey, setNarratorKey] = useState(saved.narratorKey ?? null);
    const [roleCounts, setRoleCounts] = useState(saved.roleCounts || { ...EMPTY_COUNTS });
    const [rules, setRules] = useState(saved.rules || DEFAULT_RULES);
    const [revealIndex, setRevealIndex] = useState(saved.revealIndex || 0);
    const [revealStage, setRevealStage] = useState(saved.revealStage || 'HANDOFF');
    const [game, setGame] = useState(saved.game || null);
    const [selection, setSelection] = useState([]);   // Auswahl im aktuellen Schritt, rein lokal
    const [privacy, setPrivacy] = useState(false);
    const [correcting, setCorrecting] = useState(false);

    // ---------------------------------------------------------
    // NICHT-HOST: das Spiel laeuft woanders
    // ---------------------------------------------------------
    if (!isHost) {
        const list = saved.roster || [];
        const running = gameState.phase === 'SINGLE_RUNNING';
        const statusText = {
            REVEAL: 'Die Rollen werden verteilt',
            PLAY: saved.game?.isDay ? `Tag ${saved.game?.dayNumber}` : `Nacht ${saved.game?.dayNumber}`,
            RESULT: 'Das Spiel ist vorbei'
        }[saved.step];

        return (
            <div className="min-h-screen bg-slate-900 text-white p-4 sm:p-8">
                <GameHeader isHost={false} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} />

                <div className="max-w-md mx-auto mt-12 bg-slate-800 rounded-3xl p-8 border border-slate-700 shadow-xl text-center">
                    <Moon size={56} className="mx-auto text-indigo-400 mb-4" />
                    <h2 className="text-2xl font-bold">{running ? 'Spiel läuft...' : 'Der Host richtet ein...'}</h2>
                    <p className="text-slate-400 text-sm mt-3">
                        Werwolf läuft diese Runde auf einem einzigen Handy. Schau auf das Gerät des Hosts.
                    </p>
                    {running && statusText && (
                        <p className="text-indigo-300 text-sm font-bold mt-4">{statusText}</p>
                    )}
                    <div className="flex justify-center gap-1.5 mt-6">
                        {[0, 1, 2].map((i) => (
                            <span key={i} className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse"
                                style={{ animationDelay: `${i * 150}ms` }} />
                        ))}
                    </div>

                    {list.length > 0 && (
                        <div className="mt-8 bg-slate-900 rounded-2xl p-4 border border-slate-700 text-left">
                            <p className="text-xs uppercase font-bold tracking-widest text-slate-500 mb-3">Mitspieler</p>
                            <ol className="space-y-1.5">
                                {list.map((r, i) => (
                                    <li key={r.key} className="text-sm text-slate-300 flex gap-2">
                                        <span className="text-slate-600 w-4 text-right shrink-0">{i + 1}.</span>
                                        <span className="[overflow-wrap:anywhere]">{r.name}</span>
                                        {r.key === saved.narratorKey && <span className="text-yellow-500 text-xs">Erzähler</span>}
                                    </li>
                                ))}
                            </ol>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ---------------------------------------------------------
    // ABGELEITETE WERTE & PERSISTENZ
    // ---------------------------------------------------------
    const actors = roster.filter((r) => r.key !== narratorKey);
    const requiredRoles = actors.length;
    const totalRoles = Object.values(roleCounts).reduce((a, b) => a + b, 0);
    const scoringOn = !!lobby.settings?.globalLeaderboard;

    const nameOf = (key) => roster.find((r) => r.key === key)?.name || 'Unbekannt';
    const isLobbyMember = (userId) => !!userId && players.some((p) => p.id === userId);

    const persist = async (fields, extra = {}) => {
        const patch = { ...extra };
        Object.entries(fields).forEach(([key, value]) => { patch[`gameState.sd.${key}`] = value; });
        await updateDoc(doc(db, 'lobbies', lobbyCode), patch);
    };

    const applyRoster = (next, save = true) => {
        setRoster(next);
        // Erzaehler mitziehen, falls er gerade entfernt wurde.
        if (narratorKey && !next.some((r) => r.key === narratorKey)) setNarratorKey(null);
        if (save) persist({ roster: next, narratorKey: next.some((r) => r.key === narratorKey) ? narratorKey : null });
    };

    const switchToMultiDevice = async () => {
        await updateDoc(doc(db, 'lobbies', lobbyCode), {
            'gameState.settings': { ...settings, mode: 'MULTI' },
            'gameState.phase': 'SETUP'
        });
    };

    /** Setzt den Spielzustand lokal und spiegelt ihn. Prueft dabei den Sieg. */
    const commitGame = (nextGame, extraFields = {}) => {
        let finalGame = nextGame;
        let nextStep = 'PLAY';

        // Solange der Jaeger noch schiesst, steht das Ergebnis nicht fest.
        if (!finalGame.pendingHunter) {
            const winner = checkWinner(finalGame.playerState);
            if (winner) {
                finalGame = { ...finalGame, winner };
                nextStep = 'RESULT';
            }
        }

        setGame(finalGame);
        setSelection([]);
        if (nextStep !== step) {
            setStep(nextStep);
            if (nextStep === 'RESULT') setCorrecting(false);
        }
        persist({ game: finalGame, step: nextStep, ...extraFields });
    };

    // ---------------------------------------------------------
    // SPIELSTART
    // ---------------------------------------------------------
    const buildPlayerState = () => {
        const pool = [];
        Object.entries(roleCounts).forEach(([roleId, count]) => {
            for (let i = 0; i < count; i++) pool.push(roleId);
        });
        const shuffled = shuffleArray(pool);
        const playerState = {};
        actors.forEach((r, idx) => {
            playerState[r.key] = { role: shuffled[idx], alive: true, inLove: false, deathReason: null };
        });
        return playerState;
    };

    const startRound = async () => {
        if (totalRoles !== requiredRoles || requiredRoles < 3 || !narratorKey) return;
        if (!roleCounts.WERWOLF) return;

        const fresh = {
            playerState: buildPlayerState(),
            dayNumber: 1,
            isDay: false,
            stepIndex: 0,
            witchState: { healUsed: false, poisonUsed: false },
            wolfVictim: null,
            poisonVictim: null,
            healed: false,
            seerTarget: null,
            recentDeaths: [],
            pendingHunter: null,
            firstVictimKey: null,
            winner: null
        };

        setGame(fresh);
        setRevealIndex(0);
        setRevealStage('HANDOFF');
        setSelection([]);
        setStep('REVEAL');

        await persist(
            {
                step: 'REVEAL', roster, narratorKey, roleCounts, rules,
                revealIndex: 0, revealStage: 'HANDOFF', game: fresh
            },
            { 'gameState.phase': 'SINGLE_RUNNING' }
        );
    };

    const backToSetup = async () => {
        setStep('SETUP');
        await persist({ step: 'SETUP', roster, narratorKey, roleCounts, rules },
            { 'gameState.phase': 'SETUP' });
    };

    // ---------------------------------------------------------
    // RENDERING: SETUP
    // ---------------------------------------------------------
    if (step === 'SETUP') {
        const blockReason = roster.length < 4
            ? 'Mit Erzähler braucht ihr mindestens 4 Personen (1 Erzähler + 3 Mitspieler).'
            : (!narratorKey
                ? 'Bestimme einen Erzähler.'
                : (totalRoles !== requiredRoles
                    ? `Verteile genau ${requiredRoles} Rollen (aktuell ${totalRoles}).`
                    : (!roleCounts.WERWOLF ? 'Ohne Werwolf gibt es nichts zu jagen.' : null)));

        const setCounts = (next) => { setRoleCounts(next); persist({ roleCounts: next }); };
        const bump = (roleId, delta) => setCounts({
            ...roleCounts, [roleId]: Math.max(0, (roleCounts[roleId] || 0) + delta)
        });
        const setRule = (key, value) => {
            const next = { ...rules, [key]: value };
            setRules(next);
            persist({ rules: next });
        };

        return (
            <div className="min-h-screen bg-slate-900 text-white p-4 sm:p-8">
                <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} />

                <div className="max-w-4xl mx-auto mt-8">
                    <div className="text-center mb-8">
                        <h2 className="text-4xl font-black tracking-widest text-indigo-400 uppercase">Werwolf</h2>
                        <p className="text-slate-400 mt-2">Ein Handy für alle – der Erzähler führt durch die Nacht</p>
                    </div>

                    {/* Modus-Umschalter */}
                    <div className="bg-slate-800 rounded-3xl p-4 border border-slate-700 shadow-xl mb-6">
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                onClick={switchToMultiDevice}
                                className="p-3 rounded-xl border-2 border-slate-700 bg-slate-900/50 text-slate-500 hover:border-slate-500 transition-all text-left"
                            >
                                <span className="block font-bold text-sm">Jeder sein Handy</span>
                                <span className="text-[10px] opacity-60">Alle in der Lobby spielen mit</span>
                            </button>
                            <button className="p-3 rounded-xl border-2 border-indigo-500 bg-indigo-500/10 text-white transition-all text-left">
                                <span className="font-bold text-sm flex items-center gap-1.5"><Smartphone size={14} /> Ein Handy</span>
                                <span className="text-[10px] opacity-60">Rollen reihum aufdecken</span>
                            </button>
                        </div>
                    </div>

                    <div className="mb-6">
                        <RosterPanel
                            roster={roster}
                            players={players}
                            myUserId={user.uid}
                            onChange={applyRoster}
                            hint="In dieser Reihenfolge wird das Handy für die Rollen weitergegeben. Zum Sortieren am Griff ziehen."
                            badgeOf={(item) => (item.key === narratorKey ? 'Erzähler' : null)}
                        />
                    </div>

                    {/* Erzaehler */}
                    <div className="bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl mb-6">
                        <h3 className="text-xl font-bold mb-1 flex items-center gap-2">
                            <Crown className="text-yellow-500" size={20} /> Erzähler
                        </h3>
                        <p className="text-xs text-slate-500 mb-4">
                            Der Erzähler bekommt keine Rolle, behält das Handy und leitet das Spiel.
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {roster.map((r) => (
                                <button
                                    key={r.key}
                                    onClick={() => { setNarratorKey(r.key); persist({ narratorKey: r.key }); }}
                                    className={`px-3 py-2 rounded-xl border-2 text-sm font-bold transition-all [overflow-wrap:anywhere] ${
                                        narratorKey === r.key
                                            ? 'border-yellow-500 bg-yellow-500/10 text-white'
                                            : 'border-slate-700 bg-slate-900/50 text-slate-400 hover:border-slate-500'
                                    }`}
                                >
                                    {r.name}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Rollen */}
                        <div className="bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl">
                            <div className="flex justify-between items-center mb-4 border-b border-slate-700 pb-3">
                                <h3 className="text-xl font-bold">Rollen</h3>
                                <span className={`px-3 py-1 rounded-full text-sm font-bold ${
                                    totalRoles === requiredRoles ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                                }`}>
                                    {totalRoles} / {requiredRoles}
                                </span>
                            </div>

                            <button
                                onClick={() => setCounts(suggestCounts(requiredRoles))}
                                className="w-full mb-4 bg-slate-900 hover:bg-slate-700 border border-slate-700 text-slate-300 text-sm py-2 rounded-xl transition-colors"
                            >
                                Vorschlag für {requiredRoles} Mitspieler
                            </button>

                            <div className="space-y-2">
                                {Object.values(WERWOLF_ROLES).map((role) => (
                                    <div key={role.id} className="flex items-center justify-between gap-2 p-2 rounded-xl border border-slate-700 bg-slate-900/50">
                                        <span className={`font-bold text-sm ${role.color} [overflow-wrap:anywhere]`}>{role.name}</span>
                                        <div className="flex items-center bg-slate-800 border border-slate-600 rounded-lg overflow-hidden shrink-0 h-9">
                                            <button onClick={() => bump(role.id, -1)} className="w-9 h-full hover:bg-slate-700 text-slate-300 font-bold text-lg">−</button>
                                            <div className="w-8 font-bold text-white text-center text-sm">{roleCounts[role.id] || 0}</div>
                                            <button onClick={() => bump(role.id, 1)} className="w-9 h-full hover:bg-slate-700 text-slate-300 font-bold text-lg">+</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Sonderregeln */}
                        <div className="bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl h-fit">
                            <h3 className="text-xl font-bold mb-4 border-b border-slate-700 pb-3">Sonderregeln</h3>
                            <div className="space-y-4">
                                {[
                                    { key: 'witchSelfHeal', label: 'Hexe darf sich selbst heilen', hint: 'Sonst ist der Heiltrank für sie selbst gesperrt.' },
                                    { key: 'amorFirstNightOnly', label: 'Amor nur in der ersten Nacht', hint: 'Aus: Amor darf jede Nacht neu verkuppeln.' }
                                ].map((opt) => (
                                    <button
                                        key={opt.key}
                                        onClick={() => setRule(opt.key, !rules[opt.key])}
                                        className={`w-full text-left p-3 rounded-xl border-2 transition-all ${
                                            rules[opt.key]
                                                ? 'border-indigo-500 bg-indigo-500/10 text-white'
                                                : 'border-slate-700 bg-slate-900/50 text-slate-400 hover:border-slate-500'
                                        }`}
                                    >
                                        <span className="flex items-center justify-between font-bold text-sm">
                                            {opt.label}
                                            {rules[opt.key] && <Check size={16} className="text-indigo-400 shrink-0" />}
                                        </span>
                                        <span className="text-[10px] opacity-60">{opt.hint}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {blockReason && <p className="text-center text-sm text-amber-400 mt-6">{blockReason}</p>}

                    <button
                        onClick={startRound}
                        disabled={!!blockReason}
                        className="w-full mt-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-4 rounded-2xl shadow-lg transition-all active:scale-95"
                    >
                        Rollen verteilen
                    </button>
                </div>
            </div>
        );
    }

    if (!game) {
        return (
            <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-6">
                <div className="max-w-md w-full bg-slate-800 rounded-3xl p-8 border border-slate-700 text-center">
                    <Ghost size={48} className="mx-auto text-slate-500 mb-4" />
                    <p className="text-slate-300 mb-6">Die Runde ist nicht mehr verfügbar.</p>
                    <button onClick={backToSetup} className="bg-white text-slate-900 font-bold px-6 py-3 rounded-xl hover:bg-slate-200 transition-all">
                        Zurück zum Setup
                    </button>
                </div>
            </div>
        );
    }

    // ---------------------------------------------------------
    // RENDERING: ROLLEN AUFDECKEN
    // ---------------------------------------------------------
    if (step === 'REVEAL') {
        const current = actors[revealIndex];
        const isLast = revealIndex === actors.length - 1;

        if (!current) {
            return (
                <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-6">
                    <button
                        onClick={() => { setStep('PLAY'); persist({ step: 'PLAY' }); }}
                        className="bg-white text-slate-900 font-bold px-6 py-3 rounded-xl"
                    >
                        Weiter
                    </button>
                </div>
            );
        }

        const roleObj = WERWOLF_ROLES[game.playerState[current.key]?.role];

        if (revealStage === 'HANDOFF') {
            return (
                <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
                    <div className="max-w-md w-full bg-slate-900 rounded-3xl p-8 border border-slate-700 shadow-2xl text-center">
                        <p className="text-xs uppercase font-bold tracking-widest text-slate-500 mb-6">
                            Spieler {revealIndex + 1} von {actors.length}
                        </p>
                        <Smartphone size={56} className="mx-auto text-indigo-400 mb-4 animate-bounce" />
                        <p className="text-slate-400">Gib das Handy weiter an</p>
                        <h2 className="text-4xl font-black text-white mt-2 mb-8 [overflow-wrap:anywhere]">{current.name}</h2>
                        <button
                            onClick={() => { setRevealStage('HIDDEN'); persist({ revealStage: 'HIDDEN' }); }}
                            className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold py-4 rounded-2xl shadow-lg transition-all active:scale-95"
                        >
                            Ich bin {current.name}
                        </button>
                        <p className="text-xs text-slate-500 mt-6 italic">Achte darauf, dass niemand mitschaut!</p>
                    </div>
                </div>
            );
        }

        const shown = revealStage === 'SHOWN';
        return (
            <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
                <div className="max-w-md w-full bg-slate-900 rounded-3xl p-8 border border-slate-700 shadow-2xl text-center">
                    <h2 className="text-2xl font-bold mb-6 text-white [overflow-wrap:anywhere]">{current.name}</h2>

                    <div
                        onClick={() => { if (!shown) { setRevealStage('SHOWN'); persist({ revealStage: 'SHOWN' }); } }}
                        className={`min-h-[19rem] rounded-2xl flex flex-col items-center justify-center p-5 transition-all duration-500 border-4 border-dashed ${
                            shown ? `${roleObj?.bg} border-slate-600` : 'bg-slate-800 border-slate-600 cursor-pointer'
                        }`}
                    >
                        {!shown ? (
                            <>
                                <Ghost size={64} className="text-slate-500 mb-4 animate-bounce" />
                                <p className="font-bold text-slate-400">Tippen zum Aufdecken</p>
                            </>
                        ) : (
                            <div className="animate-in zoom-in-50">
                                <h3 className={`text-3xl font-black mb-3 ${roleObj?.color}`}>{roleObj?.name}</h3>
                                <div className="w-12 h-1 bg-slate-700 mx-auto mb-3 rounded" />
                                <p className="text-slate-300 text-sm leading-relaxed">{roleObj?.description}</p>
                            </div>
                        )}
                    </div>

                    <button
                        onClick={() => {
                            const nextIndex = isLast ? revealIndex : revealIndex + 1;
                            const nextStep = isLast ? 'PLAY' : 'REVEAL';
                            if (isLast) setStep('PLAY'); else setRevealIndex(nextIndex);
                            setRevealStage('HANDOFF');
                            persist({ step: nextStep, revealIndex: nextIndex, revealStage: 'HANDOFF' });
                        }}
                        disabled={!shown}
                        className="w-full mt-8 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-white py-4 rounded-2xl font-bold transition-all active:scale-95"
                    >
                        {isLast ? `Verstanden – Handy an ${nameOf(narratorKey)}` : 'Verstanden – weitergeben'}
                    </button>
                </div>
            </div>
        );
    }

    // ---------------------------------------------------------
    // RENDERING: ERZÄHLER-DASHBOARD
    // ---------------------------------------------------------
    if (step === 'PLAY') {
        const steps = game.isDay ? DAY_STEPS : buildNightSteps(game, rules);
        // DAWN faengt die Nacht ohne aktive Rollen ab -- rechnerisch waere das
        // Spiel dann schon vorbei, aber der Schirm darf nicht leer bleiben.
        const currentStep = steps[game.stepIndex] ?? (game.isDay ? 'DAY_VOTE' : 'DAWN');
        const witch = game.witchState;
        const livingKeys = actors.filter((r) => game.playerState[r.key]?.alive).map((r) => r.key);
        const witchKey = actors.find((r) => game.playerState[r.key]?.role === 'HEXE')?.key;

        const toggleSelect = (key, max) => {
            setSelection((prev) => {
                if (prev.includes(key)) return prev.filter((k) => k !== key);
                if (prev.length >= max) return max === 1 ? [key] : prev;
                return [...prev, key];
            });
        };

        const goToStep = (index) => {
            const next = { ...game, stepIndex: index };
            setGame(next);
            setSelection([]);
            persist({ game: next });
        };

        const resolveKills = (base, kills, after = {}, keepDeaths = false) => {
            const { playerState, dead } = killPlayers(base.playerState, kills);
            // Stirbt ein Jaeger, blockiert sein Schuss alles Weitere -- auch
            // die Siegpruefung, denn er kann das Ergebnis noch drehen.
            const hunter = dead.find((d) => playerState[d.key].role === 'JAEGER');
            commitGame({
                ...base,
                ...after,
                playerState,
                recentDeaths: keepDeaths ? [...base.recentDeaths, ...dead] : dead,
                firstVictimKey: base.firstVictimKey || (dead[0]?.key ?? null),
                pendingHunter: hunter ? hunter.key : null
            });
        };

        const NIGHT_END = {
            isDay: true, stepIndex: 0,
            wolfVictim: null, poisonVictim: null, healed: false, seerTarget: null
        };

        /** base erlaubt es, eine gerade getroffene Wahl direkt mitzugeben. */
        const resolveNight = (base = game) => {
            const kills = [];
            if (base.wolfVictim && !base.healed) kills.push({ key: base.wolfVictim, reason: 'Wolf' });
            if (base.poisonVictim) kills.push({ key: base.poisonVictim, reason: 'Hexe' });
            resolveKills(base, kills, NIGHT_END);
        };

        const resolveVote = (targetKey) => {
            resolveKills(game, targetKey ? [{ key: targetKey, reason: 'Voting' }] : [], {
                isDay: false, dayNumber: game.dayNumber + 1, stepIndex: 0
            });
        };

        const resolveHunterShot = (targetKey) => {
            resolveKills({ ...game, pendingHunter: null },
                targetKey ? [{ key: targetKey, reason: 'Jäger' }] : [], {}, true);
        };

        const advance = () => {
            if (game.isDay) {
                if (currentStep === 'DAY_VOTE') resolveVote(selection[0] || null);
                else goToStep(game.stepIndex + 1);
            } else if (currentStep === 'DAWN' || game.stepIndex + 1 >= steps.length) {
                resolveNight();
            } else {
                goToStep(game.stepIndex + 1);
            }
        };

        // --- Anweisungstext und Aktion je Schritt ---
        const stepInfo = {
            AMOR: {
                title: 'Amor',
                text: 'Amor, erwache und bestimme das Liebespaar. Tippe die beiden Spieler an.',
                needs: 2
            },
            LOVERS_MEET: {
                title: 'Liebespaar',
                text: 'Das Liebespaar darf sich kurz erkennen. Danach schlafen alle wieder ein.',
                needs: 0
            },
            SEHERIN: {
                title: 'Seherin',
                text: 'Seherin, erwache. Auf wen zeigt sie? Tippe den Spieler an – du siehst dann seine Rolle.',
                needs: 1
            },
            WERWOLF: {
                title: 'Werwölfe',
                text: aliveRoles(game.playerState).has('KLEINES_MAEDCHEN')
                    ? 'Werwölfe, erwacht und wählt euer Opfer. Denk daran: das kleine Mädchen darf jetzt heimlich blinzeln.'
                    : 'Werwölfe, erwacht und wählt euer Opfer.',
                needs: 1
            },
            HEXE: { title: 'Hexe', text: 'Hexe, erwache. Willst du heilen oder vergiften?', needs: 0 },
            DAWN: { title: 'Die Nacht endet', text: 'Es ist niemand mehr wach. Weiter zum Morgen.', needs: 0 },
            DAY_DEATHS: { title: 'Der Morgen graut', text: 'Verkünde dem Dorf, wer die Nacht nicht überlebt hat.', needs: 0 },
            DAY_VOTE: { title: 'Abstimmung', text: 'Das Dorf berät und stimmt ab. Wer wird gehängt?', needs: 1 }
        }[currentStep];

        const actorRole = ACTOR_ROLE[currentStep];
        const actorKeys = actorRole
            ? actors.filter((r) => game.playerState[r.key]?.role === actorRole && game.playerState[r.key]?.alive).map((r) => r.key)
            : [];

        const seerTargetRole = game.seerTarget ? WERWOLF_ROLES[game.playerState[game.seerTarget]?.role] : null;

        return (
            <div className="min-h-screen bg-slate-950 text-white p-3 sm:p-6">
                <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} hideHostButton={true} />

                {/* Jaeger-Overlay: blockiert alles andere */}
                {game.pendingHunter && (
                    <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                        <div className="bg-slate-900 border border-amber-500 p-6 rounded-3xl max-w-md w-full shadow-2xl">
                            <div className="flex items-center gap-3 mb-3">
                                <Target size={28} className="text-amber-500" />
                                <h3 className="text-xl font-black text-amber-500 uppercase tracking-wider">Der Jäger stirbt</h3>
                            </div>
                            <p className="text-slate-300 mb-5 text-sm leading-relaxed">
                                <span className="font-bold text-white">{nameOf(game.pendingHunter)}</span> war der Jäger und reißt
                                jemanden mit in den Tod. Wen trifft der letzte Schuss?
                            </p>
                            <div className="space-y-2 max-h-64 overflow-y-auto pr-1 mb-5">
                                {livingKeys.filter((k) => k !== game.pendingHunter).map((k) => (
                                    <button
                                        key={k}
                                        onClick={() => resolveHunterShot(k)}
                                        className="w-full p-3 rounded-xl border-2 border-slate-700 bg-slate-800 hover:border-amber-500 font-bold text-left transition-all [overflow-wrap:anywhere]"
                                    >
                                        {nameOf(k)}
                                    </button>
                                ))}
                            </div>
                            <button
                                onClick={() => resolveHunterShot(null)}
                                className="w-full bg-slate-800 hover:bg-slate-700 text-slate-400 py-3 rounded-xl font-bold transition-colors"
                            >
                                Niemanden treffen
                            </button>
                        </div>
                    </div>
                )}

                {/* Korrektur-Overlay */}
                {correcting && (
                    <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-40 flex items-center justify-center p-4">
                        <div className="bg-slate-900 border border-slate-700 p-6 rounded-3xl max-w-md w-full shadow-2xl max-h-[85vh] overflow-y-auto">
                            <h3 className="text-xl font-bold mb-1">Korrigieren</h3>
                            <p className="text-xs text-slate-500 mb-4">
                                Für Verklicker: Zustand direkt setzen. Der Jäger löst hier bewusst nichts aus.
                            </p>
                            <div className="space-y-2">
                                {actors.map((r) => {
                                    const s = game.playerState[r.key];
                                    return (
                                        <div key={r.key} className="bg-slate-800 rounded-xl p-3 border border-slate-700">
                                            <p className="font-bold text-sm mb-2 [overflow-wrap:anywhere]">
                                                {r.name} <span className={`text-xs ${WERWOLF_ROLES[s.role]?.color}`}>({WERWOLF_ROLES[s.role]?.name})</span>
                                            </p>
                                            <div className="grid grid-cols-2 gap-2">
                                                <button
                                                    onClick={() => {
                                                        const next = { ...game.playerState, [r.key]: { ...s, alive: !s.alive, deathReason: s.alive ? 'Korrektur' : null } };
                                                        commitGame({ ...game, playerState: next });
                                                    }}
                                                    className="text-xs bg-slate-900 border border-slate-700 hover:border-red-500 py-2 rounded-lg transition-colors"
                                                >
                                                    {s.alive ? 'Töten' : 'Wiederbeleben'}
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        const next = { ...game.playerState, [r.key]: { ...s, inLove: !s.inLove } };
                                                        commitGame({ ...game, playerState: next });
                                                    }}
                                                    className={`text-xs py-2 rounded-lg border transition-colors ${
                                                        s.inLove ? 'bg-rose-600 border-rose-500 text-white' : 'bg-slate-900 border-slate-700 hover:border-rose-500'
                                                    }`}
                                                >
                                                    Verliebt
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            <button onClick={() => setCorrecting(false)} className="w-full mt-5 bg-white text-slate-900 font-bold py-3 rounded-xl">
                                Fertig
                            </button>
                        </div>
                    </div>
                )}

                <div className="max-w-3xl mx-auto">
                    {/* Aktions-Panel */}
                    <div className={`rounded-3xl p-5 sm:p-6 border shadow-xl mb-4 ${
                        game.isDay ? 'bg-orange-950/30 border-orange-500/30' : 'bg-indigo-950/30 border-indigo-500/30'
                    }`}>
                        <div className="flex items-start justify-between gap-3 mb-3">
                            <div className="flex items-center gap-2 min-w-0">
                                {game.isDay ? <Sun size={22} className="text-yellow-500 shrink-0" /> : <Moon size={22} className="text-indigo-400 shrink-0" />}
                                <span className="font-bold text-sm uppercase tracking-widest text-slate-400">
                                    {game.isDay ? 'Tag' : 'Nacht'} {game.dayNumber}
                                </span>
                            </div>
                            <div className="flex gap-1 shrink-0">
                                <button
                                    onClick={() => setPrivacy(!privacy)}
                                    title={privacy ? 'Rollen zeigen' : 'Rollen verbergen'}
                                    className="p-2 rounded-lg bg-slate-900/70 border border-slate-700 text-slate-400 hover:text-white transition-colors"
                                >
                                    {privacy ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                                <button
                                    onClick={() => setCorrecting(true)}
                                    title="Korrigieren"
                                    className="p-2 rounded-lg bg-slate-900/70 border border-slate-700 text-slate-400 hover:text-white transition-colors"
                                >
                                    <Wrench size={16} />
                                </button>
                            </div>
                        </div>

                        <h2 className="text-2xl font-bold mb-1">{stepInfo?.title}</h2>
                        <p className="text-slate-300 text-sm leading-relaxed">{stepInfo?.text}</p>

                        {!privacy && actorKeys.length > 0 && (
                            <p className="text-xs text-slate-500 mt-2">
                                Wach: {actorKeys.map(nameOf).join(', ')}
                            </p>
                        )}

                        {/* Ergebnis der Abstimmung -- sonst ginge es beim
                            Uebergang in die Nacht unter. */}
                        {!game.isDay && game.stepIndex === 0 && game.recentDeaths.length > 0 && (
                            <p className="text-xs text-slate-400 mt-3 bg-slate-900/70 rounded-lg px-3 py-2 border border-slate-700">
                                Am Tag gestorben: {game.recentDeaths.map((d) => `${nameOf(d.key)} (${d.reason})`).join(', ')}
                            </p>
                        )}

                        {/* Schrittspezifische Zusatzanzeigen */}
                        {currentStep === 'SEHERIN' && seerTargetRole && (
                            <div className="mt-4 bg-slate-900 rounded-2xl p-4 border border-purple-500/40 text-center">
                                <p className="text-xs text-slate-500 uppercase font-bold tracking-widest">{nameOf(game.seerTarget)} ist</p>
                                <p className={`text-2xl font-black ${seerTargetRole.color}`}>{seerTargetRole.name}</p>
                                <p className="text-xs text-slate-500 mt-1">Bestätige es der Seherin per Handzeichen.</p>
                            </div>
                        )}

                        {currentStep === 'HEXE' && (
                            <div className="mt-4 bg-slate-900 rounded-2xl p-4 border border-slate-700 space-y-3">
                                <p className="text-sm">
                                    Opfer der Werwölfe:{' '}
                                    <span className="font-bold text-red-400">
                                        {game.wolfVictim ? nameOf(game.wolfVictim) : 'niemand'}
                                    </span>
                                    {game.healed && <span className="text-green-400 font-bold"> — geheilt</span>}
                                </p>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        disabled={
                                            witch.healUsed || !game.wolfVictim || game.healed
                                            || (game.wolfVictim === witchKey && !rules.witchSelfHeal)
                                        }
                                        onClick={() => {
                                            const next = { ...game, healed: true, witchState: { ...witch, healUsed: true } };
                                            setGame(next); persist({ game: next });
                                        }}
                                        className="flex items-center justify-center gap-2 text-sm bg-green-900/40 hover:bg-green-800 disabled:opacity-30 disabled:hover:bg-green-900/40 text-green-300 py-3 rounded-xl border border-green-500/40 font-bold transition-colors"
                                    >
                                        <Syringe size={16} /> Heilen
                                    </button>
                                    <button
                                        disabled={witch.poisonUsed || selection.length === 0}
                                        onClick={() => {
                                            const next = {
                                                ...game, poisonVictim: selection[0],
                                                witchState: { ...witch, poisonUsed: true }
                                            };
                                            setGame(next); setSelection([]); persist({ game: next });
                                        }}
                                        className="flex items-center justify-center gap-2 text-sm bg-pink-900/40 hover:bg-pink-800 disabled:opacity-30 disabled:hover:bg-pink-900/40 text-pink-300 py-3 rounded-xl border border-pink-500/40 font-bold transition-colors"
                                    >
                                        <FlaskConical size={16} /> Vergiften
                                    </button>
                                </div>
                                <p className="text-[10px] text-slate-500">
                                    {witch.healUsed ? 'Heiltrank verbraucht. ' : ''}
                                    {witch.poisonUsed ? 'Gifttrank verbraucht. ' : ''}
                                    {!witch.poisonUsed && 'Zum Vergiften erst unten einen Spieler antippen.'}
                                    {game.poisonVictim && ` Vergiftet: ${nameOf(game.poisonVictim)}.`}
                                </p>
                            </div>
                        )}

                        {currentStep === 'DAY_DEATHS' && (
                            <div className="mt-4 bg-slate-900 rounded-2xl p-4 border border-slate-700">
                                <p className="text-xs text-slate-500 uppercase font-bold tracking-widest mb-2">Gestorben</p>
                                {game.recentDeaths.length === 0 ? (
                                    <p className="text-sm text-slate-400 italic">Diese Nacht ist niemand gestorben.</p>
                                ) : (
                                    <ul className="space-y-1">
                                        {game.recentDeaths.map((d, i) => (
                                            <li key={i} className="text-sm">
                                                <span className="font-bold text-red-400 [overflow-wrap:anywhere]">{nameOf(d.key)}</span>
                                                <span className="text-slate-500 text-xs"> — {d.reason}</span>
                                                {!privacy && (
                                                    <span className={`text-xs ml-1 ${WERWOLF_ROLES[game.playerState[d.key]?.role]?.color}`}>
                                                        ({WERWOLF_ROLES[game.playerState[d.key]?.role]?.name})
                                                    </span>
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        )}

                        <button
                            onClick={() => {
                                if (currentStep === 'AMOR' && selection.length === 2) {
                                    const next = { ...game.playerState };
                                    Object.keys(next).forEach((k) => { next[k] = { ...next[k], inLove: selection.includes(k) }; });
                                    const g = { ...game, playerState: next, stepIndex: game.stepIndex + 1 };
                                    setGame(g); setSelection([]); persist({ game: g });
                                    return;
                                }
                                if (currentStep === 'SEHERIN' && !game.seerTarget && selection.length === 1) {
                                    const g = { ...game, seerTarget: selection[0] };
                                    setGame(g); setSelection([]); persist({ game: g });
                                    return;
                                }
                                if (currentStep === 'WERWOLF' && selection.length === 1) {
                                    const g = { ...game, wolfVictim: selection[0], stepIndex: game.stepIndex + 1 };
                                    // Waren die Woelfe der letzte Schritt, loest die Wahl
                                    // die Nacht direkt auf -- sonst ginge das Opfer verloren.
                                    if (game.stepIndex + 1 >= steps.length) resolveNight(g);
                                    else { setGame(g); setSelection([]); persist({ game: g }); }
                                    return;
                                }
                                advance();
                            }}
                            disabled={
                                (currentStep === 'AMOR' && selection.length !== 2)
                                || (currentStep === 'SEHERIN' && !game.seerTarget && selection.length !== 1)
                                || (currentStep === 'WERWOLF' && selection.length !== 1)
                                || (currentStep === 'DAY_VOTE' && selection.length !== 1)
                            }
                            className={`w-full mt-5 py-4 rounded-2xl font-bold shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed ${
                                game.isDay
                                    ? 'bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500'
                                    : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500'
                            } text-white`}
                        >
                            {currentStep === 'SEHERIN' && !game.seerTarget ? 'Rolle aufdecken'
                                : currentStep === 'DAY_VOTE' ? 'Hinrichtung bestätigen'
                                : currentStep === 'WERWOLF' ? 'Opfer bestätigen'
                                : 'Weiter'} <ArrowRight size={18} />
                        </button>

                        {currentStep === 'DAY_VOTE' && (
                            <button
                                onClick={() => resolveVote(null)}
                                className="w-full mt-2 text-slate-400 hover:text-white text-sm py-2 transition-colors"
                            >
                                Das Dorf konnte sich nicht einigen
                            </button>
                        )}
                        {currentStep === 'WERWOLF' && (
                            <button
                                onClick={() => {
                                    const g = { ...game, wolfVictim: null, stepIndex: game.stepIndex + 1 };
                                    if (game.stepIndex + 1 >= steps.length) resolveNight(g);
                                    else { setGame(g); setSelection([]); persist({ game: g }); }
                                }}
                                className="w-full mt-2 text-slate-400 hover:text-white text-sm py-2 transition-colors"
                            >
                                Kein Opfer diese Nacht
                            </button>
                        )}
                    </div>

                    {/* Spieler-Matrix */}
                    <div className="bg-slate-900 rounded-3xl p-4 sm:p-5 border border-slate-700 shadow-xl">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-bold flex items-center gap-2 text-slate-300">
                                <Users size={18} className="text-indigo-400" /> Dorf ({livingKeys.length} leben)
                            </h3>
                            {(stepInfo?.needs > 0 || currentStep === 'HEXE') && (
                                <span className="text-xs text-slate-500">
                                    {currentStep === 'HEXE'
                                        ? (witch.poisonUsed ? 'Gift verbraucht' : 'Ziel zum Vergiften wählen')
                                        : `${selection.length}/${stepInfo.needs} gewählt`}
                                </span>
                            )}
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {actors.map((r) => {
                                const s = game.playerState[r.key];
                                if (!s) return null;
                                const roleObj = WERWOLF_ROLES[s.role];
                                const selected = selection.includes(r.key);
                                const isActor = actorKeys.includes(r.key);
                                const selectable = s.alive && (stepInfo?.needs > 0 || (currentStep === 'HEXE' && !witch.poisonUsed));

                                return (
                                    <button
                                        key={r.key}
                                        disabled={!selectable}
                                        onClick={() => toggleSelect(r.key, currentStep === 'AMOR' ? 2 : 1)}
                                        className={`p-3 rounded-2xl border-2 text-left transition-all ${
                                            !s.alive
                                                ? 'border-slate-800 bg-slate-950 opacity-50'
                                                : selected
                                                    ? 'border-emerald-500 bg-emerald-500/10'
                                                    : isActor
                                                        ? 'border-indigo-500/60 bg-slate-800'
                                                        : 'border-slate-700 bg-slate-800/60'
                                        } ${selectable ? '' : 'cursor-default'}`}
                                    >
                                        <div className="flex items-center gap-1.5 mb-1">
                                            <span className={`font-bold text-sm truncate ${s.alive ? 'text-white' : 'text-slate-500 line-through'}`}>
                                                {r.name}
                                            </span>
                                            {!s.alive && <Skull size={13} className="text-red-900 shrink-0" />}
                                            {s.inLove && <Heart size={13} className="text-rose-500 fill-rose-500 shrink-0" />}
                                        </div>
                                        {privacy ? (
                                            <span className="text-[10px] text-slate-600 uppercase tracking-wider">verborgen</span>
                                        ) : (
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${roleObj?.bg} ${roleObj?.color}`}>
                                                {roleObj?.name}
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>

                        {!game.isDay && (
                            <div className="mt-4 pt-3 border-t border-slate-800 flex flex-wrap gap-2 text-[10px] text-slate-500">
                                {buildNightSteps(game, rules).map((s, i) => (
                                    <span key={s} className={`px-2 py-1 rounded ${
                                        i === game.stepIndex ? 'bg-indigo-500/20 text-indigo-300 font-bold' : 'bg-slate-800'
                                    }`}>
                                        {i + 1}. {({ AMOR: 'Amor', LOVERS_MEET: 'Paar', SEHERIN: 'Seherin', WERWOLF: 'Wölfe', HEXE: 'Hexe' })[s]}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // ---------------------------------------------------------
    // RENDERING: SIEGEREHRUNG
    // ---------------------------------------------------------
    if (step === 'RESULT') {
        const { winner, playerState } = game;

        const isWinner = (key) => {
            const s = playerState[key];
            if (!s) return false;
            if (winner === 'LIEBESPAAR') return s.inLove;
            if (winner === 'DORF') return s.role !== 'WERWOLF';
            if (winner === 'WERWOLFE') return s.role === 'WERWOLF';
            return false;
        };
        const pointsFor = (key) => (winner === 'LIEBESPAAR' ? 8 : 5) * (isWinner(key) ? 1 : 0);

        const banner = {
            DORF: { title: 'Das Dorf gewinnt!', sub: 'Alle Werwölfe wurden zur Strecke gebracht.', color: 'text-blue-400' },
            WERWOLFE: { title: 'Die Werwölfe triumphieren!', sub: 'Das Dorf wurde überrannt.', color: 'text-red-500' },
            LIEBESPAAR: { title: 'Die Liebe siegt!', sub: 'Am Ende blieben nur die beiden übrig.', color: 'text-rose-500' },
            UNENTSCHIEDEN: { title: 'Niemand gewinnt', sub: 'Das Dorf wurde komplett ausgelöscht.', color: 'text-slate-400' }
        }[winner] || { title: 'Spiel vorbei', sub: '', color: 'text-slate-400' };

        // Statistik: welche Todesursache hat am meisten Leute geholt.
        const causeCount = {};
        actors.forEach((r) => {
            const reason = playerState[r.key]?.deathReason;
            if (reason) causeCount[reason] = (causeCount[reason] || 0) + 1;
        });
        const deadliest = Object.entries(causeCount).sort((a, b) => b[1] - a[1])[0];

        const finishAndAward = async (nextStep) => {
            const delta = new Map();
            if (scoringOn) {
                actors.forEach((r) => {
                    if (isLobbyMember(r.userId) && isWinner(r.key)) {
                        delta.set(r.userId, (delta.get(r.userId) ?? 0) + (winner === 'LIEBESPAAR' ? 8 : 5));
                    }
                });
                const narrator = roster.find((r) => r.key === narratorKey);
                if (narrator && isLobbyMember(narrator.userId)) {
                    delta.set(narrator.userId, (delta.get(narrator.userId) ?? 0) + 2);
                }
            }

            const extra = {};
            if (delta.size > 0) {
                extra.players = players.map((p) => ({
                    ...p, globalScore: (p.globalScore ?? 0) + (delta.get(p.id) ?? 0)
                }));
            }

            if (nextStep === 'LOBBY') {
                // Punkte und Rueckkehr in einem Patch: der Server verwirft
                // gameState-Keys, sobald status LOBBY_WAITING dabei ist.
                await updateLobbyStatus('LOBBY_WAITING', null, { ...extra, gameState: {} });
                return;
            }

            setStep(nextStep);
            if (nextStep === 'SETUP') {
                await persist({ step: 'SETUP' }, { ...extra, 'gameState.phase': 'SETUP' });
            } else {
                await persist({ step: nextStep }, extra);
            }
        };

        const playAgain = async () => {
            const fresh = {
                playerState: buildPlayerState(),
                dayNumber: 1, isDay: false, stepIndex: 0,
                witchState: { healUsed: false, poisonUsed: false },
                wolfVictim: null, poisonVictim: null, healed: false, seerTarget: null,
                recentDeaths: [], pendingHunter: null, firstVictimKey: null, winner: null
            };
            // Punkte zuerst, danach die neue Runde.
            await finishAndAward('REVEAL');
            setGame(fresh);
            setRevealIndex(0);
            setRevealStage('HANDOFF');
            await persist({ step: 'REVEAL', game: fresh, revealIndex: 0, revealStage: 'HANDOFF' });
        };

        return (
            <div className="min-h-screen bg-slate-950 text-white p-4 sm:p-8">
                <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} hideHostButton={true} />

                <div className="max-w-2xl mx-auto mt-4">
                    <div className="text-center mb-8">
                        <Trophy size={56} className={`mx-auto mb-3 ${banner.color}`} />
                        <h2 className={`text-4xl sm:text-5xl font-black uppercase tracking-widest ${banner.color}`}>{banner.title}</h2>
                        <p className="text-slate-400 mt-2">{banner.sub}</p>
                    </div>

                    <div className="bg-slate-900 rounded-3xl p-5 border border-slate-700 shadow-xl mb-4">
                        <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500 mb-3">Die wahren Rollen</h3>
                        <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2 p-3 rounded-xl bg-slate-800/60 border border-slate-700">
                                <span className="font-bold [overflow-wrap:anywhere]">{nameOf(narratorKey)}</span>
                                <span className="flex items-center gap-2 shrink-0">
                                    <span className="text-xs text-slate-400 flex items-center gap-1"><Crown size={12} className="text-yellow-500" /> Erzähler</span>
                                    {scoringOn && <span className="text-xs font-bold text-yellow-400 bg-yellow-500/10 px-2 py-1 rounded">+2</span>}
                                </span>
                            </div>
                            {actors.map((r) => {
                                const s = playerState[r.key];
                                const roleObj = WERWOLF_ROLES[s?.role];
                                const won = isWinner(r.key);
                                return (
                                    <div key={r.key} className={`flex items-center justify-between gap-2 p-3 rounded-xl border ${
                                        won ? 'bg-green-900/20 border-green-500/30' : 'bg-slate-800/60 border-slate-700'
                                    }`}>
                                        <span className="flex items-center gap-1.5 min-w-0">
                                            <span className={`font-bold [overflow-wrap:anywhere] ${s?.alive ? 'text-white' : 'text-slate-500 line-through'}`}>
                                                {r.name}
                                            </span>
                                            {!s?.alive && <Skull size={13} className="text-red-900 shrink-0" />}
                                            {s?.inLove && <Heart size={13} className="text-rose-500 fill-rose-500 shrink-0" />}
                                        </span>
                                        <span className="flex items-center gap-2 shrink-0">
                                            <span className={`text-xs px-2 py-1 rounded font-bold ${roleObj?.bg} ${roleObj?.color}`}>{roleObj?.name}</span>
                                            {scoringOn && won && (
                                                <span className="text-xs font-bold text-green-400 bg-green-500/10 px-2 py-1 rounded">
                                                    +{pointsFor(r.key)}
                                                </span>
                                            )}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                        {!scoringOn && <p className="text-xs text-slate-500 italic mt-3">Globales Scoring ist aus.</p>}
                    </div>

                    <div className="bg-slate-900 rounded-3xl p-5 border border-slate-700 shadow-xl mb-6">
                        <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500 mb-3">Statistik</h3>
                        <ul className="text-sm text-slate-300 space-y-1.5">
                            <li className="flex justify-between gap-2"><span className="text-slate-500">Nächte</span><span className="font-bold">{game.dayNumber}</span></li>
                            <li className="flex justify-between gap-2">
                                <span className="text-slate-500">Erstes Opfer</span>
                                <span className="font-bold [overflow-wrap:anywhere]">{game.firstVictimKey ? nameOf(game.firstVictimKey) : '—'}</span>
                            </li>
                            <li className="flex justify-between gap-2">
                                <span className="text-slate-500">Tödlichste Ursache</span>
                                <span className="font-bold">{deadliest ? `${deadliest[0]} (${deadliest[1]})` : '—'}</span>
                            </li>
                            <li className="flex justify-between gap-2">
                                <span className="text-slate-500">Überlebende</span>
                                <span className="font-bold">{actors.filter((r) => playerState[r.key]?.alive).length}</span>
                            </li>
                        </ul>
                    </div>

                    <button
                        onClick={playAgain}
                        className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold py-4 rounded-2xl shadow-lg transition-all active:scale-95"
                    >
                        Neues Spiel, gleiche Spieler
                    </button>
                    <button
                        onClick={() => finishAndAward('SETUP')}
                        className="w-full mt-3 bg-slate-800 hover:bg-slate-700 text-white font-bold py-3 rounded-2xl transition-all active:scale-95"
                    >
                        Spieler & Rollen ändern
                    </button>
                    <button
                        onClick={() => finishAndAward('LOBBY')}
                        className="w-full mt-3 text-slate-400 hover:text-white text-sm py-2 transition-colors"
                    >
                        Punkte verteilen & zurück zur Lobby
                    </button>
                </div>
            </div>
        );
    }

    return null;
}
