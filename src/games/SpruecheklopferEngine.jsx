import React, { useState, useEffect, useMemo, useRef } from 'react';
import { doc, updateDoc } from '../lib/firestoreBridge';
import { Settings, Send, Trophy, Check, PenLine, Crown, ArrowRight, Hourglass } from 'lucide-react';

import GameHeader from '../components/GameHeader';
import { shuffleArray } from '../utils/helpers';
import CATEGORIES from '../constants/bluffStatements.json';

/**
 * Sprücheklopfer — Lückensatz ausfüllen, anonym über den besten Spruch
 * abstimmen.
 *
 * Ablauf pro Runde: WRITING (alle tippen heimlich) -> VOTING (alle Antworten
 * gemischt und ohne Namen) -> REVEAL (Auflösung + Punkte). Danach entweder
 * die nächste Runde oder RESULTS.
 *
 * Wie bei den anderen Engines liegt die Spiellogik komplett im Client und
 * die Host-Autorität ist nur ein `if (!isHost) return;` — keine
 * Sicherheitsgrenze (s. CLAUDE.md). Auch die abgegebenen Antworten stehen
 * im Klartext in `gameState`, sind also vor der Abstimmung technisch
 * einsehbar. Das ist dieselbe bewusste Abwägung wie beim Imposter-Wort:
 * im Freundeskreis akzeptiert, Aufgabe der Phasen 1–5.
 */

/** Punkte pro erhaltener Stimme. */
const POINTS_PER_VOTE = 10;

/** Unter drei Leuten ist die Abstimmung sinnlos — jeder hätte genau eine
 *  fremde Antwort zur Auswahl und müsste sie zwangsläufig wählen. */
const MIN_PLAYERS = 3;

const CATEGORY_KEYS = Object.keys(CATEGORIES);

export default function SpruecheklopferEngine({ lobby, user, isHost, db, updateLobbyStatus, leaveLobby }) {
    const { gameState, players, id: lobbyCode } = lobby;

    // ---- Alle Hooks ganz oben, vor jedem phasenabhängigen return ----
    // Der Entwurf trägt seine Runde mit sich: so leert sich das Eingabefeld
    // beim Rundenwechsel von selbst, ohne setState in einem Effect (das ist
    // der Lint-Verstoss, der in den alten Engines noch drinsteckt).
    const [draft, setDraft] = useState({ round: -1, text: '' });
    // Verhindert doppelte RPCs: Phasenwechsel werden bewusst NICHT
    // optimistisch angezeigt, `gameState.phase` bleibt hier also noch einen
    // Moment auf dem alten Wert, während der Effect erneut läuft.
    const advancedRef = useRef('');

    const round = gameState.round ?? 0;
    const statements = useMemo(() => gameState.statements || [], [gameState.statements]);
    const statement = statements[round] || '';
    const answers = useMemo(() => gameState.answers || {}, [gameState.answers]);
    const votes = useMemo(() => gameState.votes || {}, [gameState.votes]);
    const scores = gameState.scores || {};
    const setupRounds = String(gameState.setup?.rounds ?? 5);
    const setupCats = gameState.setup?.categories || [CATEGORY_KEYS[0]];

    const lobbyRef = () => doc(db, 'lobbies', lobbyCode);

    const updateSetup = async (key, value) => {
        if (!isHost) return;
        await updateDoc(lobbyRef(), { [`gameState.setup.${key}`]: value });
    };

    // Nur Antworten von Leuten zählen, die noch in der Lobby sind — wer
    // mitten in der Runde geht, darf die Abstimmung nicht blockieren.
    const activeAnswers = useMemo(
        () => Object.entries(answers).filter(([id]) => players.some((p) => p.id === id)),
        [answers, players]
    );

    const everyoneWrote = players.length > 0 && activeAnswers.length >= players.length;
    const everyoneVoted = activeAnswers.length > 0
        && activeAnswers.every(([id]) => votes[id] !== undefined);

    // Host zieht automatisch weiter, sobald alle fertig sind. Ein Ref-Riegel
    // pro Phase+Runde, damit der Effect nicht mehrfach dieselbe RPC schickt.
    useEffect(() => {
        if (!isHost) return;
        const marker = `${gameState.phase}-${round}`;
        if (advancedRef.current === marker) return;

        if (gameState.phase === 'WRITING' && everyoneWrote) {
            advancedRef.current = marker;
            updateDoc(doc(db, 'lobbies', lobbyCode), { 'gameState.phase': 'VOTING' });
        }
    }, [isHost, gameState.phase, round, everyoneWrote, db, lobbyCode]);

    // ---- Aktionen ----

    const startGame = async () => {
        const wanted = Math.min(Math.max(parseInt(setupRounds, 10) || 5, 1), 15);
        const pool = setupCats.flatMap((key) => CATEGORIES[key]?.statements || []);
        const drawn = shuffleArray(pool).slice(0, Math.min(wanted, pool.length));

        // Alle Sätze der Partie werden EINMAL gezogen und liegen im
        // gameState: sonst müsste jede Runde erst der Host würfeln und alle
        // anderen auf seinen Roundtrip warten.
        await updateDoc(lobbyRef(), {
            gameState: {
                phase: 'WRITING',
                round: 0,
                statements: drawn,
                answers: {},
                votes: {},
                scores: {},
            },
        });
    };

    const submitAnswer = async () => {
        const text = draft.round === round ? draft.text.trim() : '';
        if (!text) return;
        await updateDoc(lobbyRef(), { [`gameState.answers.${user.uid}`]: text.slice(0, 120) });
    };

    const castVote = async (targetId) => {
        // Für den eigenen Spruch zu stimmen wäre der offensichtliche Exploit.
        if (targetId === user.uid) return;
        await updateDoc(lobbyRef(), { [`gameState.votes.${user.uid}`]: targetId });
    };

    /** Stimmen auszählen und in den Gesamtstand übernehmen. */
    const toReveal = async () => {
        const nextScores = { ...scores };
        Object.entries(votes).forEach(([voterId, targetId]) => {
            if (!players.some((p) => p.id === voterId)) return;
            nextScores[targetId] = (nextScores[targetId] || 0) + POINTS_PER_VOTE;
        });
        await updateDoc(lobbyRef(), {
            'gameState.phase': 'REVEAL',
            'gameState.scores': nextScores,
        });
    };

    const nextRound = async () => {
        if (round + 1 >= statements.length) {
            await updateDoc(lobbyRef(), { 'gameState.phase': 'RESULTS' });
            return;
        }
        await updateDoc(lobbyRef(), {
            'gameState.phase': 'WRITING',
            'gameState.round': round + 1,
            'gameState.answers': {},
            'gameState.votes': {},
        });
    };

    const ranked = [...players]
        .map((p) => ({ ...p, points: scores[p.id] || 0 }))
        .sort((a, b) => b.points - a.points);

    /** Platz bei Gleichstand: wer gleich viele Punkte hat, teilt sich den
     *  Platz. Sonst bekämen zwei Spieler mit demselben Ergebnis 5 und 3
     *  globale Punkte, je nachdem wie sort() sie zufällig anordnet. */
    const rankOf = (points) => ranked.filter((p) => p.points > points).length + 1;

    const finishGame = async () => {
        // ACHTUNG: status 'LOBBY_WAITING' beendet die games-Zeile und verwirft
        // alle gameState-Keys desselben Patches — deshalb hier nur players.
        if (lobby.settings?.globalLeaderboard) {
            const newPlayers = players.map((p) => {
                const rank = rankOf(scores[p.id] || 0);
                let added = 0;
                if (rank === 1) added = 5;
                else if (rank === 2) added = 3;
                else if (rank === 3) added = 1;
                return { ...p, globalScore: (p.globalScore ?? 0) + added };
            });
            await updateLobbyStatus('LOBBY_WAITING', null, { players: newPlayers, gameState: {} });
        } else {
            await updateLobbyStatus('LOBBY_WAITING', null, { gameState: {} });
        }
    };

    // ---- Phasen ----

    if (gameState.phase === 'SETUP') {
        const poolSize = setupCats.reduce((n, k) => n + (CATEGORIES[k]?.statements.length || 0), 0);
        const toggleCat = (key) => updateSetup('categories', (
            setupCats.includes(key) ? setupCats.filter((item) => item !== key) : [...setupCats, key]
        ));

        return (
            <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center p-4 sm:p-6 relative">
                <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} absolute={true} />

                <h2 className="text-4xl font-bold mb-2 text-pink-400 mt-12 text-center">Sprücheklopfer</h2>
                <p className="text-slate-400 mb-8 text-center max-w-md">
                    Füllt die Lücke im Satz — anschließend wird anonym über den besten Spruch abgestimmt.
                </p>

                {!isHost && <p className="text-slate-500 text-sm mb-4">Live-Ansicht – der Host nimmt die Einstellungen vor.</p>}
                <fieldset disabled={!isHost} className={`w-full max-w-2xl ${!isHost ? 'opacity-60' : ''}`}>
                    <div className="w-full bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl">
                        <h3 className="text-xl font-bold mb-5 flex items-center gap-2">
                            <Settings size={20} className="text-indigo-400" /> Spieleinstellungen
                        </h3>

                        <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700 mb-5">
                            <label className="block text-sm font-medium text-slate-400 mb-2">Anzahl der Runden</label>
                            <input
                                type="text"
                                inputMode="numeric"
                                value={setupRounds}
                                onChange={(e) => updateSetup('rounds', e.target.value.replace(/\D/g, ''))}
                                className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-pink-500"
                                placeholder="5"
                            />
                            <p className="text-xs text-slate-500 mt-1">1 bis 15 Runden</p>
                        </div>

                        <label className="block text-sm font-medium text-slate-400 mb-2">
                            Kategorien ({setupCats.length} gewählt, {poolSize} Sätze)
                        </label>
                        <div className="flex flex-wrap gap-2 mb-6">
                            {CATEGORY_KEYS.map((key) => (
                                <button
                                    key={key}
                                    onClick={() => toggleCat(key)}
                                    className={`px-4 py-2 rounded-xl border text-sm transition-all ${setupCats.includes(key)
                                        ? 'bg-pink-600 border-pink-500 text-white shadow-lg shadow-pink-900/30'
                                        : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'}`}
                                >
                                    {CATEGORIES[key].name}
                                </button>
                            ))}
                        </div>

                        {players.length < MIN_PLAYERS && (
                            <p className="text-sm text-amber-400 mb-4">
                                Ihr braucht mindestens {MIN_PLAYERS} Spieler — sonst gibt es bei der
                                Abstimmung nichts zu wählen.
                            </p>
                        )}

                        <button
                            onClick={startGame}
                            disabled={setupCats.length === 0 || players.length < MIN_PLAYERS}
                            className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-400 hover:to-pink-400 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 text-white font-bold py-3 rounded-xl transition-all shadow-lg flex items-center justify-center gap-2"
                        >
                            <ArrowRight size={18} /> Spiel starten
                        </button>
                    </div>
                </fieldset>
            </div>
        );
    }

    if (gameState.phase === 'WRITING') {
        const mine = answers[user.uid];
        const draftText = draft.round === round ? draft.text : '';

        return (
            <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center p-4 sm:p-6 relative">
                <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} absolute={true} />

                <div className="w-full max-w-2xl mt-16">
                    <p className="text-center text-sm text-slate-500 mb-6 font-mono">
                        Runde {round + 1} von {statements.length}
                    </p>

                    <div className="bg-slate-800 rounded-3xl p-6 sm:p-8 border border-slate-700 shadow-xl mb-6">
                        <div className="flex items-center gap-2 text-pink-400 text-xs font-bold uppercase tracking-wide mb-4">
                            <PenLine size={14} /> Füll die Lücke
                        </div>
                        <p className="text-xl sm:text-2xl font-bold leading-relaxed">{statement}</p>
                    </div>

                    {mine ? (
                        <div className="bg-slate-800 rounded-2xl p-5 border border-green-500/30 text-center">
                            <p className="text-green-400 font-bold flex items-center justify-center gap-2 mb-2">
                                <Check size={18} /> Abgeschickt
                            </p>
                            <p className="text-slate-300 italic">„{mine}“</p>
                            <p className="text-xs text-slate-500 mt-3">
                                Warten auf die anderen ({activeAnswers.length}/{players.length})
                            </p>
                        </div>
                    ) : (
                        <div className="bg-slate-800 rounded-2xl p-5 border border-slate-700">
                            <input
                                value={draftText}
                                onChange={(e) => setDraft({ round, text: e.target.value })}
                                onKeyDown={(e) => { if (e.key === 'Enter') submitAnswer(); }}
                                maxLength={120}
                                autoFocus
                                placeholder="Dein Spruch für die Lücke…"
                                className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-pink-500 mb-3"
                            />
                            <button
                                onClick={submitAnswer}
                                disabled={!draftText.trim()}
                                className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-400 hover:to-pink-400 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2"
                            >
                                <Send size={16} /> Abschicken
                            </button>
                        </div>
                    )}

                    {isHost && !everyoneWrote && (
                        <button
                            onClick={() => updateDoc(lobbyRef(), { 'gameState.phase': 'VOTING' })}
                            disabled={activeAnswers.length < 2}
                            className="w-full mt-4 text-sm text-slate-400 hover:text-white disabled:text-slate-600 py-2 transition-colors"
                        >
                            Ohne die Fehlenden weiter zur Abstimmung
                        </button>
                    )}
                </div>
            </div>
        );
    }

    if (gameState.phase === 'VOTING') {
        return (
            <VotingScreen
                statement={statement}
                round={round}
                statementCount={statements.length}
                activeAnswers={activeAnswers}
                votes={votes}
                user={user}
                isHost={isHost}
                everyoneVoted={everyoneVoted}
                onVote={castVote}
                onReveal={toReveal}
                leaveLobby={leaveLobby}
                updateLobbyStatus={updateLobbyStatus}
            />
        );
    }

    if (gameState.phase === 'REVEAL') {
        // Gleiche Filterung wie in toReveal(): Stimmen von inzwischen
        // gegangenen Spielern zaehlen nicht. Sonst zeigte die Auflösung eine
        // Stimme an, für die es keinen Punkt gab.
        const tally = {};
        Object.entries(votes).forEach(([voterId, targetId]) => {
            if (!players.some((p) => p.id === voterId)) return;
            tally[targetId] = (tally[targetId] || 0) + 1;
        });
        const board = activeAnswers
            .map(([id, text]) => ({
                id,
                text,
                votes: tally[id] || 0,
                name: players.find((p) => p.id === id)?.name || 'Unbekannt',
            }))
            .sort((a, b) => b.votes - a.votes);
        const best = board[0]?.votes || 0;

        return (
            <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center p-4 sm:p-6 relative">
                <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} absolute={true} />

                <div className="w-full max-w-2xl mt-16">
                    <p className="text-center text-slate-400 mb-6">{statement}</p>

                    <div className="space-y-3 mb-8">
                        {board.map((entry) => (
                            <div
                                key={entry.id}
                                className={`rounded-2xl p-4 border flex items-center gap-4 ${entry.votes === best && best > 0
                                    ? 'bg-pink-500/10 border-pink-500/40'
                                    : 'bg-slate-800 border-slate-700'}`}
                            >
                                <div className="min-w-0 flex-1">
                                    <p className="font-bold text-slate-100">„{entry.text}“</p>
                                    <p className="text-xs text-slate-500 mt-0.5">von {entry.name}</p>
                                </div>
                                <div className="text-right shrink-0">
                                    <p className="text-2xl font-black text-pink-400">{entry.votes}</p>
                                    <p className="text-[10px] text-slate-500 uppercase">
                                        {entry.votes === 1 ? 'Stimme' : 'Stimmen'}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700 mb-6">
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3">Zwischenstand</h4>
                        <div className="space-y-1.5">
                            {ranked.map((p) => (
                                <div key={p.id} className="flex justify-between text-sm">
                                    <span className="text-slate-300">{rankOf(p.points)}. {p.name}</span>
                                    <span className="font-mono text-slate-400">{p.points}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {isHost ? (
                        <button
                            onClick={nextRound}
                            className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-400 hover:to-pink-400 text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2"
                        >
                            {round + 1 >= statements.length ? 'Zum Endergebnis' : 'Nächste Runde'}
                            <ArrowRight size={18} />
                        </button>
                    ) : (
                        <p className="text-center text-slate-500 text-sm animate-pulse">
                            Warten auf den Partyleiter…
                        </p>
                    )}
                </div>
            </div>
        );
    }

    if (gameState.phase === 'RESULTS') {
        return (
            <div className="min-h-screen bg-slate-900 text-white p-4 sm:p-8 relative">
                <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} absolute={false} maxWidthClass="max-w-2xl" hideHostButton={true} />

                <div className="max-w-2xl mx-auto flex flex-col items-center">
                    <h2 className="text-4xl sm:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-orange-500 mb-2 tracking-wider uppercase mt-6">
                        Endergebnis
                    </h2>
                    <p className="text-slate-400 mb-10">Wer hat die besten Sprüche geklopft?</p>

                    <div className="w-full bg-slate-800 rounded-3xl p-6 sm:p-8 border border-slate-700 shadow-2xl mb-8 space-y-3">
                        {ranked.map((p) => (
                            <div
                                key={p.id}
                                className={`flex items-center gap-4 rounded-2xl p-4 border ${rankOf(p.points) === 1
                                    ? 'bg-yellow-500/10 border-yellow-500/40'
                                    : 'bg-slate-900/50 border-slate-700'}`}
                            >
                                <span className={`text-2xl font-black w-8 shrink-0 ${rankOf(p.points) === 1 ? 'text-yellow-400' : 'text-slate-500'}`}>
                                    {rankOf(p.points)}
                                </span>
                                {rankOf(p.points) === 1 && <Crown size={20} className="text-yellow-400 shrink-0" />}
                                <span className="font-bold text-slate-100 min-w-0 flex-1 truncate">{p.name}</span>
                                <span className="font-mono text-lg text-pink-400 shrink-0">{p.points}</span>
                            </div>
                        ))}
                    </div>

                    {isHost ? (
                        <button
                            onClick={finishGame}
                            className="w-full max-w-sm bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-400 hover:to-pink-400 text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2"
                        >
                            <Trophy size={18} /> Zurück zur Lobby
                        </button>
                    ) : (
                        <p className="text-slate-500 text-sm animate-pulse">Warten auf den Partyleiter…</p>
                    )}
                </div>
            </div>
        );
    }

    return null;
}

/**
 * Eigene Komponente, weil die Abstimmung als einzige Phase einen Hook
 * braucht (die gemischte Reihenfolge) — in der Engine selbst dürfte der
 * nicht unterhalb der phasenabhängigen returns stehen.
 */
function VotingScreen({
    statement, round, statementCount, activeAnswers, votes, user,
    isHost, everyoneVoted, onVote, onReveal, leaveLobby, updateLobbyStatus,
}) {
    // Einmal pro Runde mischen, damit die Reihenfolge nicht verrät, wer
    // zuerst getippt hat — und damit sie beim Eintrudeln der Stimmen nicht
    // unter dem Finger springt.
    const shuffled = useMemo(
        () => shuffleArray(activeAnswers),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [round, activeAnswers.length]
    );

    const myVote = votes[user.uid];
    const votedCount = activeAnswers.filter(([id]) => votes[id] !== undefined).length;

    return (
        <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center p-4 sm:p-6 relative">
            <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} absolute={true} />

            <div className="w-full max-w-2xl mt-16">
                <p className="text-center text-sm text-slate-500 mb-2 font-mono">
                    Runde {round + 1} von {statementCount}
                </p>
                <p className="text-center text-slate-300 mb-8">{statement}</p>

                <div className="space-y-3 mb-6">
                    {shuffled.map(([id, text]) => {
                        const isMine = id === user.uid;
                        const chosen = myVote === id;
                        return (
                            <button
                                key={id}
                                onClick={() => onVote(id)}
                                disabled={isMine || !!myVote}
                                className={`w-full text-left rounded-2xl p-4 border transition-all ${chosen
                                    ? 'bg-pink-500/20 border-pink-500 text-white'
                                    : isMine
                                        ? 'bg-slate-900/40 border-slate-700/50 text-slate-500 cursor-not-allowed'
                                        : myVote
                                            ? 'bg-slate-800 border-slate-700 text-slate-400'
                                            : 'bg-slate-800 border-slate-700 text-slate-100 hover:border-pink-500/50 hover:bg-slate-700'}`}
                            >
                                <span className="font-bold">„{text}“</span>
                                {isMine && <span className="block text-xs mt-1">dein eigener Spruch</span>}
                            </button>
                        );
                    })}
                </div>

                {/* Nenner sind die Mitspieler dieser Runde, nicht die ganze
                    Lobby: wer nichts geschrieben hat, stimmt meist auch nicht
                    ab — sonst bliebe der Zähler ewig unter dem Ziel stehen. */}
                <p className="text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                    <Hourglass size={12} /> {votedCount} von {activeAnswers.length} haben abgestimmt
                </p>

                {isHost && (
                    /* Mit nur noch einer aktiven Person ist keine fremde
                       Antwort waehbar. Aufloesen muss trotzdem moeglich sein. */
                    <button
                        onClick={onReveal}
                        disabled={activeAnswers.length >= 2 && !everyoneVoted && votedCount === 0}
                        className="w-full mt-6 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-400 hover:to-pink-400 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2"
                    >
                        {everyoneVoted ? 'Auflösen' : 'Ohne die Fehlenden auflösen'}
                        <ArrowRight size={18} />
                    </button>
                )}
            </div>
        </div>
    );
}
