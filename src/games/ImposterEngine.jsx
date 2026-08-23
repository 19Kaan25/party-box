import React, { useState } from 'react';
import { doc, updateDoc, arrayUnion } from '../lib/firestoreBridge';
import {
    Settings, Shield, Ghost, CheckCircle, VenetianMask,
    Plus, Minus, Smartphone, Crown, Trophy
} from 'lucide-react';

import GameHeader from '../components/GameHeader';
import ImposterSingleDevice from './ImposterSingleDevice';
import { CategoryPicker, CustomWordManager } from './ImposterSetupPanels';
import {
    buildWordPool,
    calculateImposterPoints,
    categoryNameOfWord,
    chooseImposterVoteTarget,
    resolveImposterVote,
} from './imposterWords';
import { shuffleArray } from '../utils/helpers';

export default function ImposterEngine({ lobby, user, isHost, db, updateLobbyStatus, leaveLobby }) {
    const { gameState, players, id: lobbyCode, customImposterWords = [], usedImposterWords = [] } = lobby;
    const [showRole, setShowRole] = useState(false);

    if (gameState.settings?.mode === 'SINGLE' || gameState.phase === 'SINGLE_RUNNING') {
        return (
            <ImposterSingleDevice
                key={!isHost && gameState.phase === 'SETUP' ? JSON.stringify(gameState.sd || {}) : 'active'}
                lobby={lobby}
                user={user}
                isHost={isHost}
                db={db}
                updateLobbyStatus={updateLobbyStatus}
                leaveLobby={leaveLobby}
            />
        );
    }

    const settings = gameState.settings || {};
    const imposters = gameState.imposters || [];
    const votes = gameState.votes || {};
    const participants = gameState.participants || players;
    const playerIds = players.map((player) => player.id);
    const allImposters = participants.length > 0 && imposters.length === participants.length;
    const scoringOn = !!lobby.settings?.globalLeaderboard;

    const nameOf = (id) => participants.find((player) => player.id === id)?.name
        || players.find((player) => player.id === id)?.name
        || 'Unbekannt';

    const updateSetupSettings = async (newSettings) => {
        if (!isHost) return;
        const patch = {};
        Object.entries(newSettings).forEach(([key, value]) => {
            patch[`gameState.settings.${key}`] = value;
        });
        await updateDoc(doc(db, 'lobbies', lobbyCode), patch);
    };

    const toggleCategory = (catId) => {
        const current = settings.selectedCategories || [];
        const next = current.includes(catId)
            ? current.filter((id) => id !== catId)
            : [...current, catId];
        updateSetupSettings({ selectedCategories: next });
    };

    const switchToSingleDevice = async () => {
        if (!isHost) return;
        await updateDoc(doc(db, 'lobbies', lobbyCode), {
            'gameState.settings.mode': 'SINGLE',
            'gameState.sd.step': 'SETUP',
        });
    };

    const startGame = async () => {
        const count = Math.min(Math.max(1, settings.imposterCount || 1), players.length);
        const everyPlayerIsImposter = count === players.length;
        const fullPool = buildWordPool(settings.selectedCategories, customImposterWords);
        const availableWords = fullPool.filter((word) => !usedImposterWords.includes(word));
        const poolToUse = availableWords.length > 0 ? availableWords : fullPool;
        const secretWord = everyPlayerIsImposter
            ? null
            : poolToUse[Math.floor(Math.random() * poolToUse.length)];
        const shuffledPlayers = shuffleArray(players.map((player) => player.id));
        const imposterIds = shuffledPlayers.slice(0, count);
        const starterId = players[Math.floor(Math.random() * players.length)].id;

        await updateLobbyStatus('GAME_IN_PROGRESS', 'IMPOSTER', {
            ...(secretWord && { usedImposterWords: arrayUnion(secretWord) }),
            gameState: {
                ...gameState,
                phase: 'ROLE_REVEAL',
                word: secretWord,
                categoryName: secretWord
                    ? categoryNameOfWord(secretWord, settings.selectedCategories)
                    : null,
                imposters: imposterIds,
                participants: players.map(({ id, name, globalScore }) => ({ id, name, globalScore })),
                starterId,
                votes: {},
                votedOutId: null,
                summary: null,
                startTime: Date.now()
            }
        });
    };

    const finishRound = async (votedOutId, guessedCorrect = false, tieBreak = false) => {
        const points = calculateImposterPoints(playerIds, imposters, votedOutId, guessedCorrect);
        const caught = imposters.includes(votedOutId);
        const summary = {
            votedOutId,
            caught,
            guessedCorrect: caught ? guessedCorrect : null,
            allImposters,
            tieBreak,
            entries: participants
                .filter((participant) => points[participant.id] > 0)
                .map((participant) => ({
                    id: participant.id,
                    name: participant.name,
                    points: points[participant.id],
                })),
        };
        const additionalData = {
            'gameState.phase': 'RESULT',
            'gameState.votedOutId': votedOutId,
            'gameState.summary': summary,
        };

        if (scoringOn) {
            additionalData.players = players.map((player) => ({
                ...player,
                globalScore: (player.globalScore || 0) + (points[player.id] || 0),
            }));
        }

        await updateLobbyStatus('GAME_IN_PROGRESS', 'IMPOSTER', additionalData);
    };

    const submitVote = async (targetId) => {
        if (!playerIds.includes(targetId) || targetId === user.uid) return;
        await updateDoc(doc(db, 'lobbies', lobbyCode), {
            [`gameState.votes.${user.uid}`]: targetId
        });
    };

    const resolveVote = async () => {
        if (!isHost || players.length === 0) return;
        const result = resolveImposterVote(votes, playerIds, playerIds);
        if (result.voteCount === 0 && players.length > 1) return;

        const tied = result.tiedKeys.length > 1;
        const votedOutId = chooseImposterVoteTarget(result, players[0].id);
        const caught = imposters.includes(votedOutId);

        if (caught && !allImposters) {
            await updateLobbyStatus('GAME_IN_PROGRESS', 'IMPOSTER', {
                'gameState.phase': 'GUESS',
                'gameState.votedOutId': votedOutId,
                'gameState.tieBreak': tied,
            });
            return;
        }

        await finishRound(votedOutId, false, tied);
    };

    if (gameState.phase === 'SETUP') {
        const wordPool = buildWordPool(settings.selectedCategories, customImposterWords);
        const maxImposters = Math.max(1, players.length);
        const imposterCount = Math.min(settings.imposterCount || 1, maxImposters);
        const noWordNeeded = players.length > 0 && imposterCount === players.length;
        const startBlockReason = players.length < 3
            ? 'Für „Jeder sein Handy“ braucht ihr mindestens 3 Spieler in der Lobby. Zu zweit könnt ihr auf ein Handy wechseln und Gäste ergänzen.'
            : (!noWordNeeded && wordPool.length === 0
                ? 'Wähle mindestens eine Kategorie mit verfügbaren Wörtern.'
                : null);

        return (
            <div className="min-h-screen bg-slate-900 text-white p-4 sm:p-8">
                <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} />
                <div className="max-w-4xl mx-auto mt-12">
                    <div className="text-center mb-8">
                        <h2 className="text-3xl font-bold text-emerald-400 flex items-center justify-center gap-2">
                            <VenetianMask size={32} /> Imposter Setup
                        </h2>
                        <p className="text-slate-400 mt-2">
                            {isHost ? 'Wähle die Regeln für diese Runde' : 'Der Host konfiguriert das Spiel...'}
                        </p>
                    </div>

                    <div className="bg-slate-800 rounded-3xl p-4 border border-slate-700 shadow-xl mb-6">
                        <div className="grid grid-cols-2 gap-3">
                            <button className="p-3 rounded-xl border-2 border-emerald-500 bg-emerald-500/10 text-white transition-all text-left">
                                <span className="block font-bold text-sm">Jeder sein Handy</span>
                                <span className="text-[10px] opacity-60">Alle in der Lobby spielen mit</span>
                            </button>
                            <button
                                disabled={!isHost}
                                onClick={switchToSingleDevice}
                                className={`p-3 rounded-xl border-2 border-slate-700 bg-slate-900/50 text-slate-500 transition-all text-left ${isHost ? 'hover:border-slate-500' : 'cursor-default'}`}
                            >
                                <span className="font-bold text-sm flex items-center gap-1.5"><Smartphone size={14} /> Ein Handy</span>
                                <span className="text-[10px] opacity-60">Karten reihum aufdecken</span>
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl">
                            <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                                <Shield className="text-blue-400" size={20} /> Kategorien
                            </h3>
                            <CategoryPicker
                                selected={settings.selectedCategories || []}
                                onToggle={toggleCategory}
                                disabled={!isHost}
                                customWordCount={customImposterWords.length}
                            />
                        </div>

                        <div className="space-y-6">
                            <div className="bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl">
                                <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                                    <Settings className="text-orange-400" size={20} /> Spielregeln
                                </h3>
                                <div className="space-y-5">
                                    <div>
                                        <label className="text-sm text-slate-400 flex justify-between">
                                            <span>Anzahl Imposter</span>
                                            <span className="font-bold text-white">{imposterCount}</span>
                                        </label>
                                        <div className="flex items-center gap-3 mt-2">
                                            <button
                                                type="button"
                                                aria-label="Einen Imposter weniger"
                                                disabled={!isHost || imposterCount <= 1}
                                                onClick={() => updateSetupSettings({ imposterCount: imposterCount - 1 })}
                                                className="p-2 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-30"
                                            >
                                                <Minus size={18} />
                                            </button>
                                            <input
                                                type="range" min="1" max={maxImposters} step="1"
                                                disabled={!isHost}
                                                value={imposterCount}
                                                onChange={(event) => updateSetupSettings({ imposterCount: parseInt(event.target.value) })}
                                                className="flex-1 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500 disabled:opacity-50"
                                            />
                                            <button
                                                type="button"
                                                aria-label="Einen Imposter mehr"
                                                disabled={!isHost || imposterCount >= maxImposters}
                                                onClick={() => updateSetupSettings({ imposterCount: imposterCount + 1 })}
                                                className="p-2 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-30"
                                            >
                                                <Plus size={18} />
                                            </button>
                                        </div>
                                        <p className="text-[10px] text-slate-500 mt-1">Bis zu {maxImposters} bei {players.length} Spielern.</p>
                                        {noWordNeeded && (
                                            <p className="text-xs text-amber-300 mt-2">Wenn jeder Imposter ist, gibt es kein Geheimwort.</p>
                                        )}
                                    </div>

                                    <div>
                                        <p className="text-sm text-slate-400 mb-2">Imposter sehen...</p>
                                        <div className="grid grid-cols-2 gap-2">
                                            {[
                                                { id: 'none', label: 'Nichts', hint: 'Nur „Imposter“' },
                                                { id: 'category', label: 'Kategorie', hint: 'Leichter zu bluffen' }
                                            ].map((option) => {
                                                const active = (settings.imposterHint || 'none') === option.id;
                                                return (
                                                    <button
                                                        key={option.id}
                                                        disabled={!isHost || noWordNeeded}
                                                        onClick={() => updateSetupSettings({ imposterHint: option.id })}
                                                        className={`p-3 rounded-xl border-2 transition-all text-left ${active
                                                            ? 'border-emerald-500 bg-emerald-500/10 text-white'
                                                            : 'border-slate-700 bg-slate-900/50 text-slate-500 hover:border-slate-500'} ${!isHost || noWordNeeded ? 'cursor-default opacity-50' : ''}`}
                                                    >
                                                        <span className="block font-bold text-sm">{option.label}</span>
                                                        <span className="text-[10px] opacity-60">{option.hint}</span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl">
                                <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                                    <Plus className="text-purple-400" size={20} /> Eigene Wörter
                                </h3>
                                <CustomWordManager lobbyCode={lobbyCode} words={customImposterWords} isHost={isHost} />
                            </div>
                        </div>
                    </div>

                    {startBlockReason && <p className="text-center text-sm text-amber-400 mt-6">{startBlockReason}</p>}
                    <button
                        onClick={startGame}
                        disabled={!isHost || !!startBlockReason}
                        className="w-full mt-8 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-4 rounded-2xl shadow-lg transition-all transform hover:scale-[1.01] active:scale-95"
                    >
                        Spiel starten
                    </button>
                </div>
            </div>
        );
    }

    if (gameState.phase === 'ROLE_REVEAL') {
        const isImposter = imposters.includes(user.uid);
        return (
            <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
                <div className="max-w-md w-full bg-slate-800 rounded-3xl p-8 border border-slate-700 shadow-2xl text-center">
                    <h2 className="text-2xl font-bold mb-6 text-white">Deine Rolle</h2>
                    <div
                        onClick={() => setShowRole(!showRole)}
                        className={`aspect-square rounded-2xl flex flex-col items-center justify-center cursor-pointer transition-all duration-500 transform ${showRole
                            ? (isImposter ? 'bg-red-500/20 border-red-500' : 'bg-emerald-500/20 border-emerald-500')
                            : 'bg-slate-700 border-slate-600'} border-4 border-dashed`}
                    >
                        {!showRole ? (
                            <>
                                <Ghost size={64} className="text-slate-500 mb-4 animate-bounce" />
                                <p className="font-bold text-slate-400">Klicken zum Aufdecken</p>
                            </>
                        ) : isImposter ? (
                            <div className="animate-in zoom-in-50">
                                <VenetianMask size={80} className="text-red-500 mb-4 mx-auto" />
                                <h3 className="text-4xl font-black text-red-500 uppercase tracking-tighter">IMPOSTER</h3>
                                {allImposters ? (
                                    <p className="text-slate-300 mt-4 px-4 text-sm font-medium">In dieser Runde gibt es kein Geheimwort.</p>
                                ) : (settings.imposterHint || 'none') === 'category' ? (
                                    <>
                                        <p className="text-slate-400 text-sm mt-4">Kategorie:</p>
                                        <div className="text-xl font-black text-white mt-1 bg-slate-900 px-4 py-2 rounded-xl border border-red-500/30">
                                            {gameState.categoryName}
                                        </div>
                                    </>
                                ) : (
                                    <p className="text-slate-300 mt-4 px-4 text-sm font-medium">Täusche die anderen und finde das Geheimwort heraus!</p>
                                )}
                            </div>
                        ) : (
                            <div className="animate-in zoom-in-50">
                                <Shield size={80} className="text-emerald-500 mb-4 mx-auto" />
                                <h3 className="text-2xl font-bold text-emerald-400 mb-2">UNSCHULDIG</h3>
                                <p className="text-slate-400 text-sm">Das Geheimwort lautet:</p>
                                <div className="text-3xl font-black text-white mt-2 bg-slate-900 px-4 py-2 rounded-xl border border-emerald-500/30">
                                    {gameState.word}
                                </div>
                            </div>
                        )}
                    </div>
                    <p className="text-xs text-slate-500 mt-6 italic">Achte darauf, dass niemand dein Display sieht!</p>
                    {isHost && (
                        <button
                            onClick={() => updateLobbyStatus('GAME_IN_PROGRESS', 'IMPOSTER', { 'gameState.phase': 'DISCUSSION' })}
                            className="w-full mt-8 bg-slate-700 hover:bg-slate-600 text-white py-3 rounded-xl font-bold transition-all"
                        >
                            Startspieler anzeigen
                        </button>
                    )}
                </div>
            </div>
        );
    }

    if (gameState.phase === 'DISCUSSION') {
        return (
            <div className="min-h-screen bg-slate-900 text-white p-6 flex items-center justify-center">
                <div className="max-w-lg w-full bg-slate-800 rounded-3xl p-8 border border-slate-700 shadow-2xl text-center">
                    <Crown size={64} className="mx-auto text-yellow-400 mb-4" />
                    <p className="text-slate-400 text-sm">Es beginnt</p>
                    <h2 className="text-4xl font-black mt-2 [overflow-wrap:anywhere]">{nameOf(gameState.starterId)}</h2>
                    <p className="text-slate-400 mt-6">
                        Nennt reihum passende Begriffe und redet so lange, wie ihr möchtet. Öffnet danach gemeinsam die Abstimmung.
                    </p>
                    {!imposters.includes(user.uid) && gameState.word && (
                        <div className="bg-emerald-500/10 rounded-2xl p-4 border border-emerald-500/20 mt-6">
                            <p className="text-xs uppercase font-bold text-emerald-500">Dein Wort</p>
                            <p className="text-2xl font-black mt-1">{gameState.word}</p>
                        </div>
                    )}
                    {isHost && (
                        <button
                            onClick={() => updateLobbyStatus('GAME_IN_PROGRESS', 'IMPOSTER', {
                                'gameState.phase': 'VOTING',
                                'gameState.votes': {},
                            })}
                            className="w-full mt-8 bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-bold py-4 rounded-2xl"
                        >
                            Abstimmung öffnen
                        </button>
                    )}
                </div>
            </div>
        );
    }

    if (gameState.phase === 'VOTING') {
        const validVoteCount = Object.entries(votes).filter(
            ([voter, target]) => playerIds.includes(voter) && playerIds.includes(target)
        ).length;
        const canResolve = validVoteCount > 0 || players.length === 1;

        return (
            <div className="min-h-screen bg-slate-900 text-white p-4 sm:p-8">
                <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} />
                <div className="max-w-3xl mx-auto mt-12">
                    <div className="bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl">
                        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
                            <CheckCircle className="text-blue-400" /> Wen verdächtigst du?
                        </h2>
                        <p className="text-sm text-slate-400 mb-2">Du kannst deine Auswahl bis zur Auswertung jederzeit ändern.</p>
                        <p className="text-xs text-slate-500 mb-6">Stimmen bleiben bis zur Auswertung verborgen.</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {players.map((player) => {
                                const isMe = player.id === user.uid;
                                const selected = votes[user.uid] === player.id;
                                return (
                                    <button
                                        key={player.id}
                                        disabled={isMe}
                                        onClick={() => submitVote(player.id)}
                                        className={`p-4 rounded-2xl border-2 transition-all flex items-center gap-4 ${selected
                                            ? 'border-emerald-500 bg-emerald-500/10'
                                            : (isMe
                                                ? 'border-slate-700 bg-slate-900/30 opacity-60'
                                                : 'border-slate-700 bg-slate-900 hover:border-slate-500')}`}
                                    >
                                        <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center font-bold">
                                            {player.name.charAt(0).toUpperCase()}
                                        </div>
                                        <p className="font-bold text-left flex-1">{player.name} {isMe && '(Du)'}</p>
                                        {selected && <CheckCircle size={20} className="text-emerald-500" />}
                                    </button>
                                );
                            })}
                        </div>
                        {isHost && (
                            <button
                                onClick={resolveVote}
                                disabled={!canResolve}
                                className="w-full mt-8 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed py-4 rounded-2xl text-white font-bold shadow-lg transition-all"
                            >
                                Abstimmung auswerten ({validVoteCount}/{players.length})
                            </button>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    if (gameState.phase === 'GUESS') {
        return (
            <div className="min-h-screen bg-slate-900 text-white p-6 flex items-center justify-center">
                <div className="max-w-md w-full bg-slate-800 rounded-3xl p-8 border border-slate-700 shadow-2xl text-center">
                    <VenetianMask size={64} className="mx-auto text-red-500 mb-5" />
                    <h2 className="text-3xl font-black [overflow-wrap:anywhere]">{nameOf(gameState.votedOutId)}</h2>
                    <p className="text-red-400 font-bold mt-2">wurde als Imposter enttarnt</p>
                    <p className="text-slate-400 mt-6">Die Person darf das Geheimwort jetzt einmal laut erraten.</p>
                    {isHost ? (
                        <div className="grid grid-cols-2 gap-3 mt-8">
                            <button
                                onClick={() => finishRound(gameState.votedOutId, true, !!gameState.tieBreak)}
                                className="bg-emerald-600 hover:bg-emerald-500 rounded-xl py-4 font-bold"
                            >
                                Richtig geraten
                            </button>
                            <button
                                onClick={() => finishRound(gameState.votedOutId, false, !!gameState.tieBreak)}
                                className="bg-slate-700 hover:bg-slate-600 rounded-xl py-4 font-bold"
                            >
                                Falsch geraten
                            </button>
                        </div>
                    ) : (
                        <p className="text-sm text-slate-500 mt-8">Der Host trägt das Ergebnis ein.</p>
                    )}
                </div>
            </div>
        );
    }

    if (gameState.phase === 'RESULT') {
        const summary = gameState.summary || {};
        const heading = summary.allImposters
            ? 'Jeder war Imposter'
            : (summary.caught ? 'IMPOSTER GEFUNDEN' : 'IMPOSTER ENTKOMMEN');
        return (
            <div className="min-h-screen bg-slate-900 text-white p-4 sm:p-8 flex items-center justify-center">
                <div className="max-w-2xl w-full bg-slate-800 rounded-3xl p-8 sm:p-10 border border-slate-700 shadow-2xl text-center">
                    <h2 className={`text-4xl sm:text-5xl font-black mb-3 ${summary.caught ? 'text-emerald-400' : 'text-red-500'}`}>{heading}</h2>
                    <p className="text-slate-400 mb-8">
                        Rausgewählt: <span className="font-bold text-white">{nameOf(summary.votedOutId)}</span>
                        {summary.tieBreak && ' · zufällig nach Gleichstand'}
                    </p>

                    {gameState.word ? (
                        <div className="bg-slate-900 rounded-2xl p-6 border border-slate-700 mb-6">
                            <p className="text-sm text-slate-500 uppercase font-bold mb-1">Das geheime Wort war</p>
                            <p className="text-4xl font-black text-emerald-400 tracking-tight">{gameState.word}</p>
                            <p className="text-sm text-slate-500 mt-2">{gameState.categoryName}</p>
                        </div>
                    ) : (
                        <div className="bg-slate-900 rounded-2xl p-6 border border-slate-700 mb-6">
                            <p className="text-xl font-bold">Es gab kein Geheimwort.</p>
                        </div>
                    )}

                    <div className="bg-slate-900 rounded-2xl p-5 border border-slate-700 text-left mb-6">
                        <p className="text-xs text-slate-500 uppercase font-bold tracking-widest mb-3">Imposter</p>
                        {participants.filter((player) => imposters.includes(player.id)).map((player) => (
                            <div key={player.id} className="flex items-center justify-between gap-3 py-1">
                                <span className="font-bold text-red-400">{player.name}</span>
                                {player.id === summary.votedOutId && (
                                    <span className="text-xs text-slate-400">
                                        rausgewählt{summary.guessedCorrect === true ? ' · Wort erraten' : ''}
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>

                    <div className="bg-slate-900 rounded-2xl p-5 border border-slate-700 text-left mb-8">
                        <p className="text-xs text-slate-500 uppercase font-bold tracking-widest mb-2 flex items-center gap-1.5">
                            <Trophy size={12} className="text-yellow-500" /> Globale Punkte
                        </p>
                        {!scoringOn ? (
                            <p className="text-sm text-slate-500 italic">Globales Scoring ist aus.</p>
                        ) : summary.entries?.length > 0 ? (
                            summary.entries.map((entry) => (
                                <div key={entry.id} className="flex items-center justify-between gap-2 py-1 text-sm">
                                    <span className="text-slate-300">{entry.name}</span>
                                    <span className="font-bold text-yellow-400">+{entry.points}</span>
                                </div>
                            ))
                        ) : (
                            <p className="text-sm text-slate-500 italic">Diese Runde gab es keine Punkte.</p>
                        )}
                    </div>

                    {isHost && (
                        <button
                            onClick={() => updateLobbyStatus('LOBBY_WAITING', null, { gameState: {} })}
                            className="bg-white text-slate-900 font-bold px-8 py-3 rounded-xl hover:bg-slate-200 transition-all"
                        >
                            Zurück zur Lobby
                        </button>
                    )}
                </div>
            </div>
        );
    }

    return null;
}
