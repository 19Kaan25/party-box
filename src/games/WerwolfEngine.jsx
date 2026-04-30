import React, { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { Sun, Moon, RefreshCw, Skull, List, Heart, HeartHandshake, Syringe, FlaskConical, Flag, Trophy, Users, Home, Target, Loader2 } from 'lucide-react';

import GameHeader from '../components/GameHeader';
import { WERWOLF_ROLES } from '../constants/gameData';
import { shuffleArray } from '../utils/helpers';

export default function WerwolfEngine({ lobby, user, isHost, db, updateLobbyStatus, leaveLobby }) {
    const { gameState, players, id: lobbyCode } = lobby;

    // ==========================================
    // WICHTIG: Alle Hooks müssen zwingend ganz oben stehen!
    // ==========================================
    // SETUP Hooks
    const [narratorId, setNarratorId] = useState(user?.uid || '');
    const [roleCounts, setRoleCounts] = useState({ WERWOLF: 1, DORFBEWOHNER: 1, SEHERIN: 1, HEXE: 0, AMOR: 0, JAEGER: 0 });

    // PLAYING Hooks
    const [hunterPrompt, setHunterPrompt] = useState(null);
    const [hunterTarget, setHunterTarget] = useState(null);
    const [isShooting, setIsShooting] = useState(false);

    // ==========================================
    // Phase: SETUP
    // ==========================================
    if (gameState.phase === 'SETUP') {
        const totalSelected = Object.values(roleCounts).reduce((a,b)=>a+b,0);
        const requiredRoles = Math.max(1, players.length - 1);
        const isReady = totalSelected === requiredRoles;

        const updateRoleCount = (roleId, delta) => {
            setRoleCounts(prev => {
                const val = Math.max(0, (prev[roleId] || 0) + delta);
                return { ...prev, [roleId]: val };
            });
        };

        const startGame = async () => {
            if (!isReady) return;

            const activePlayers = players.filter(p => p.id !== narratorId);

            const rolesPool = [];
            Object.entries(roleCounts).forEach(([roleId, count]) => {
                for(let i=0; i<count; i++) rolesPool.push(roleId);
            });

            const shuffledRoles = shuffleArray(rolesPool);
            const playerState = {};

            activePlayers.forEach((p, idx) => {
                playerState[p.id] = {
                    role: shuffledRoles[idx],
                    alive: true,
                    inLove: false,
                    deathReason: null
                };
            });

            await updateDoc(doc(db, 'lobbies', lobbyCode), {
                'gameState.phase': 'PLAYING',
                'gameState.narrator': narratorId,
                'gameState.dayNumber': 1,
                'gameState.isDay': false,
                'gameState.playerState': playerState,
                'gameState.recentDeaths': [],
                'gameState.witchState': { healUsed: false, poisonUsed: false },
                'gameState.winningFaction': null,
                'gameState.hunterShooting': null
            });
        };

        if (!isHost) {
            return (
                <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-8 relative">
                    <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} absolute={true} />
                    <div className="flex items-center gap-3 text-slate-400 bg-slate-800 px-6 py-4 rounded-xl border border-slate-700">
                        <span className="animate-pulse">Der Host konfiguriert die Rollen für das Dorf...</span>
                    </div>
                </div>
            );
        }

        return (
            <div className="min-h-screen bg-slate-900 text-white p-4 sm:p-8 flex flex-col relative">
                <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} absolute={true} />

                <div className="max-w-4xl mx-auto w-full mt-6">
                    <div className="text-center mb-8">
                        <h2 className="text-4xl font-black tracking-widest text-indigo-400 uppercase">Werwolf</h2>
                        <p className="text-slate-400 mt-2">Wähle einen Erzähler und konfiguriere die Rollen.</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl">
                            <h3 className="text-xl font-bold mb-4 border-b border-slate-700 pb-2">1. Erzähler bestimmen</h3>
                            <p className="text-sm text-slate-400 mb-4">Der Erzähler leitet das Spiel durch die App und bekommt keine eigene Rolle.</p>
                            <select
                                value={narratorId}
                                onChange={(e) => setNarratorId(e.target.value)}
                                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            >
                                {players.map(p => (
                                    <option key={p.id} value={p.id}>{p.name} {p.id === user.uid && '(Du)'}</option>
                                ))}
                            </select>
                        </div>

                        <div className="bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl">
                            <div className="flex justify-between items-center mb-4 border-b border-slate-700 pb-2">
                                <h3 className="text-xl font-bold">2. Rollen verteilen</h3>
                                <span className={`px-3 py-1 rounded-full text-sm font-bold ${isReady ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                    {totalSelected} / {requiredRoles}
                 </span>
                            </div>

                            <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-2">
                                {Object.values(WERWOLF_ROLES).map(role => (
                                    <div key={role.id} className={`flex items-center justify-between p-3 rounded-xl border border-slate-700 bg-slate-900/50`}>
                                        <div>
                                            <span className={`font-bold ${role.color}`}>{role.name}</span>
                                        </div>
                                        <div className="flex items-center bg-slate-800 border border-slate-600 rounded-lg overflow-hidden shrink-0 h-10">
                                            <button onClick={() => updateRoleCount(role.id, -1)} className="w-10 h-full flex items-center justify-center hover:bg-slate-700 text-slate-300 transition-colors font-bold text-xl">-</button>
                                            <div className="w-8 font-bold text-white text-center text-sm">{roleCounts[role.id] || 0}</div>
                                            <button onClick={() => updateRoleCount(role.id, 1)} className="w-10 h-full flex items-center justify-center hover:bg-slate-700 text-slate-300 transition-colors font-bold text-xl">+</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="mt-8 flex gap-4">
                        <button onClick={() => updateLobbyStatus('LOBBY_WAITING', null, { gameState: {} })} className="w-1/3 bg-slate-700 hover:bg-slate-600 text-white px-6 py-4 rounded-2xl font-bold transition-all active:scale-95 text-lg">
                            Zurück
                        </button>
                        <button
                            onClick={startGame}
                            disabled={!isReady}
                            className={`w-2/3 px-8 py-4 rounded-2xl font-bold shadow-lg transition-all text-xl ${isReady ? 'bg-indigo-600 hover:bg-indigo-500 text-white active:scale-95' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}
                        >
                            {isReady ? 'Spiel starten' : 'Rollenanzahl anpassen!'}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ==========================================
    // Phase: PLAYING (Narrator, Hunter, oder Normal Player)
    // ==========================================
    if (gameState.phase === 'PLAYING') {
        const isNarrator = user.uid === gameState.narrator;
        const isDay = gameState.isDay;

        // --- 1. SPECIAL VIEW: Jäger schießt (auf dem Handy des toten Jägers) ---
        if (gameState.hunterShooting === user.uid) {
            const livingOthers = players.filter(p => p.id !== user.uid && gameState.playerState[p.id]?.alive && p.id !== gameState.narrator);

            const submitHunterShot = async () => {
                if (!hunterTarget || isShooting) return;
                setIsShooting(true);

                try {
                    // TIEFE KOPIE des State, um React/Firebase Mutationen zu verhindern
                    const newPlayerState = {
                        ...gameState.playerState,
                        [hunterTarget]: {
                            ...gameState.playerState[hunterTarget],
                            alive: false,
                            deathReason: 'Jäger'
                        }
                    };
                    const newRecentDeaths = [...(gameState.recentDeaths || []), { id: hunterTarget, reason: 'Jäger' }];

                    await updateDoc(doc(db, 'lobbies', lobbyCode), {
                        'gameState.playerState': newPlayerState,
                        'gameState.recentDeaths': newRecentDeaths,
                        'gameState.hunterShooting': null
                    });
                    setHunterTarget(null); // Reset lokaler State nach Erfolg
                } catch (err) {
                    console.error("Fehler beim Schuss:", err);
                } finally {
                    setIsShooting(false);
                }
            };

            return (
                <div className="min-h-screen bg-slate-950 text-white p-4 flex flex-col items-center justify-center relative">
                    <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} absolute={true} hideHostButton={true} />
                    <div className="max-w-md w-full bg-slate-900 border border-amber-500/50 p-8 rounded-3xl text-center shadow-[0_0_50px_rgba(245,158,11,0.2)] animate-in slide-in-from-bottom-4">
                        <Target size={64} className="mx-auto text-amber-500 mb-4 animate-pulse" />
                        <h2 className="text-4xl font-black text-amber-500 mb-2 uppercase tracking-widest">Letzter Schuss!</h2>
                        <p className="text-slate-300 mb-8 text-lg">Du wurdest soeben getötet. Bevor du ausscheidest, darfst du einen Spieler mit in den Tod reißen.</p>

                        <div className="space-y-3 mb-8 max-h-64 overflow-y-auto pr-2">
                            {livingOthers.length === 0 ? (
                                <p className="text-slate-500">Niemand mehr am Leben...</p>
                            ) : (
                                livingOthers.map(p => (
                                    <button
                                        key={p.id}
                                        onClick={() => setHunterTarget(p.id)}
                                        className={`w-full p-4 rounded-xl border-2 font-bold transition-all text-lg ${hunterTarget === p.id ? 'bg-amber-600 border-amber-400 text-white shadow-lg' : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-amber-500/50'}`}
                                    >
                                        {p.name}
                                    </button>
                                ))
                            )}
                        </div>

                        <button
                            onClick={submitHunterShot}
                            disabled={!hunterTarget || isShooting}
                            className="w-full bg-red-600 hover:bg-red-500 disabled:bg-slate-800 disabled:border-slate-700 disabled:text-slate-500 text-white font-bold py-4 rounded-xl transition-all shadow-lg text-xl uppercase tracking-wider flex justify-center items-center gap-2"
                        >
                            {isShooting ? <Loader2 className="animate-spin" /> : 'Abschießen'}
                        </button>
                    </div>
                </div>
            );
        }

        // --- 2. NARRATOR VIEW ---
        if (isNarrator) {
            const activePlayers = players.filter(p => p.id !== gameState.narrator);
            const witchState = gameState.witchState || { healUsed: false, poisonUsed: false };

            const toggleDayNight = async () => {
                const states = Object.values(gameState.playerState);
                const livingPlayers = states.filter(s => s.alive);
                const livingWolves = livingPlayers.filter(s => s.role === 'WERWOLF').length;
                const livingNonWolves = livingPlayers.filter(s => s.role !== 'WERWOLF').length;

                const onlyLoversAlive = livingPlayers.length > 0 && livingPlayers.every(s => s.inLove);

                let winningFaction = null;

                if (livingPlayers.length === 0) {
                    winningFaction = 'UNENTSCHIEDEN';
                } else if (onlyLoversAlive) {
                    winningFaction = 'LIEBESPAAR';
                } else if (livingWolves === 0) {
                    winningFaction = 'DORF';
                } else if (livingWolves >= livingNonWolves) {
                    winningFaction = 'WERWOLFE';
                }

                if (winningFaction) {
                    await updateDoc(doc(db, 'lobbies', lobbyCode), {
                        'gameState.phase': 'FINAL_RESULTS',
                        'gameState.winningFaction': winningFaction
                    });
                } else {
                    await updateDoc(doc(db, 'lobbies', lobbyCode), {
                        'gameState.isDay': !gameState.isDay,
                        ...(gameState.isDay ? {} : { 'gameState.dayNumber': gameState.dayNumber + 1 }),
                        ...(gameState.isDay ? { 'gameState.recentDeaths': [] } : {})
                    });
                }
            };

            const setPlayerStatus = async (targetId, action, reason = null) => {
                // Jäger abfangen, bevor er stirbt!
                const isHunter = gameState.playerState[targetId].role === 'JAEGER';
                const isKillAction = action === 'KILL' || action === 'POISON_WITCH';
                const isAlive = gameState.playerState[targetId].alive;

                if (isHunter && isKillAction && isAlive) {
                    setHunterPrompt({ id: targetId, action, reason });
                    return;
                }

                await executePlayerStatus(targetId, action, reason);
            };

            const executePlayerStatus = async (targetId, action, reason = null) => {
                // TIEFE KOPIE - Verhindert React/Firebase Fehler!
                const newPlayerState = {
                    ...gameState.playerState,
                    [targetId]: { ...gameState.playerState[targetId] }
                };
                let newRecentDeaths = [...(gameState.recentDeaths || [])];
                let newWitchState = { ...witchState };

                if (action === 'KILL') {
                    newPlayerState[targetId].alive = false;
                    newPlayerState[targetId].deathReason = reason;
                    newRecentDeaths.push({ id: targetId, reason });
                } else if (action === 'REVIVE') {
                    newPlayerState[targetId].alive = true;
                    newPlayerState[targetId].deathReason = null;
                    newRecentDeaths = newRecentDeaths.filter(d => d.id !== targetId);
                } else if (action === 'HEAL_WITCH') {
                    newPlayerState[targetId].alive = true;
                    newPlayerState[targetId].deathReason = null;
                    newRecentDeaths = newRecentDeaths.filter(d => d.id !== targetId);
                    newWitchState.healUsed = true;
                } else if (action === 'POISON_WITCH') {
                    newPlayerState[targetId].alive = false;
                    newPlayerState[targetId].deathReason = 'Hexe';
                    newRecentDeaths.push({ id: targetId, reason: 'Hexe' });
                    newWitchState.poisonUsed = true;
                } else if (action === 'LOVE') {
                    newPlayerState[targetId].inLove = !newPlayerState[targetId].inLove;
                }

                await updateDoc(doc(db, 'lobbies', lobbyCode), {
                    'gameState.playerState': newPlayerState,
                    'gameState.recentDeaths': newRecentDeaths,
                    'gameState.witchState': newWitchState
                });
            };

            const confirmHunterShoot = async () => {
                const { id, action, reason } = hunterPrompt;

                const newPlayerState = {
                    ...gameState.playerState,
                    [id]: { ...gameState.playerState[id] }
                };
                let newRecentDeaths = [...(gameState.recentDeaths || [])];
                let newWitchState = { ...witchState };

                if (action === 'KILL') {
                    newPlayerState[id].alive = false;
                    newPlayerState[id].deathReason = reason;
                    newRecentDeaths.push({ id, reason });
                } else if (action === 'POISON_WITCH') {
                    newPlayerState[id].alive = false;
                    newPlayerState[id].deathReason = 'Hexe';
                    newRecentDeaths.push({ id, reason: 'Hexe' });
                    newWitchState.poisonUsed = true;
                }

                await updateDoc(doc(db, 'lobbies', lobbyCode), {
                    'gameState.playerState': newPlayerState,
                    'gameState.recentDeaths': newRecentDeaths,
                    'gameState.witchState': newWitchState,
                    'gameState.hunterShooting': id
                });

                setHunterPrompt(null);
            };

            const abortGame = async () => {
                if(window.confirm('Möchtest du das Spiel abbrechen und in die Lobby zurückkehren? Es werden keine Punkte verteilt.')) {
                    await updateDoc(doc(db, 'lobbies', lobbyCode), { status: 'LOBBY_WAITING', 'gameState': {} });
                }
            };

            const rolesAlive = new Set(Object.values(gameState.playerState).filter(s => s.alive).map(s => s.role));
            const rolesPresent = new Set(Object.values(gameState.playerState).map(s => s.role));

            const nightSteps = [];
            let stepCounter = 1;

            if (gameState.dayNumber === 1 && rolesPresent.has('AMOR')) {
                nightSteps.push({ num: stepCounter++, text: 'Amor (Liebespaar wählen)', color: 'border-rose-500' });
                nightSteps.push({ num: stepCounter++, text: 'Liebespaar (sich erkennen)', color: 'border-pink-300' });
            }
            if (rolesAlive.has('SEHERIN')) {
                nightSteps.push({ num: stepCounter++, text: 'Seherin (erwacht)', color: 'border-purple-500' });
            }
            if (rolesAlive.has('WERWOLF')) {
                nightSteps.push({ num: stepCounter++, text: 'Werwölfe (Opfer wählen)', color: 'border-red-500' });
            }
            if (rolesAlive.has('HEXE')) {
                let hexenText = 'Hexe (Heilen / Vergiften)';
                if (witchState.healUsed && witchState.poisonUsed) hexenText = 'Hexe (erwacht, aber Tränke leer)';
                nightSteps.push({ num: stepCounter++, text: hexenText, color: 'border-pink-500' });
            }

            return (
                <div className="min-h-screen bg-slate-950 text-white p-4 sm:p-8 flex flex-col relative">
                    <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} absolute={true} hideHostButton={true} />

                    {/* POP-UP: Jäger getötet */}
                    {hunterPrompt && (
                        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                            <div className="bg-slate-900 border border-amber-500 p-6 rounded-3xl max-w-md w-full shadow-2xl animate-in zoom-in duration-200">
                                <div className="flex items-center gap-3 mb-4">
                                    <Target size={32} className="text-amber-500" />
                                    <h3 className="text-2xl font-black text-amber-500 uppercase tracking-wider">Jäger getötet!</h3>
                                </div>
                                <p className="text-slate-300 mb-6 leading-relaxed">
                                    Der Jäger ist gerade gestorben (durch: {hunterPrompt.reason}). Bevor er stirbt, darf er einen Schuss abgeben.<br/><br/>
                                    <strong className="text-white bg-red-900/50 px-2 py-1 rounded">Ablauf:</strong> Wenn du auf "Schuss abgeben" drückst, weise das Dorf an zu schlafen. Wecke den Jäger und sage ihm, dass er tot ist. Er wählt dann auf seinem Handy sein Opfer aus.
                                </p>
                                <div className="flex gap-3">
                                    <button onClick={() => setHunterPrompt(null)} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-3 rounded-xl font-bold transition-colors">
                                        Verklickt (Zurück)
                                    </button>
                                    <button onClick={confirmHunterShoot} className="flex-1 bg-amber-600 hover:bg-amber-500 text-white py-3 rounded-xl font-bold transition-colors shadow-lg shadow-amber-900/50">
                                        Schuss abgeben
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="max-w-6xl mx-auto w-full grid grid-cols-1 lg:grid-cols-4 gap-6 mt-6">

                        <div className="lg:col-span-1 flex flex-col gap-6">
                            <div className={`p-6 rounded-3xl border shadow-xl flex flex-col items-center text-center relative overflow-hidden ${isDay ? 'bg-orange-950/30 border-orange-500/30' : 'bg-indigo-950/30 border-indigo-500/30'}`}>
                                {gameState.hunterShooting && (
                                    <div className="absolute inset-0 bg-amber-900/90 backdrop-blur flex flex-col items-center justify-center z-10 text-amber-300">
                                        <Target size={32} className="animate-pulse mb-2" />
                                        <span className="font-bold">Jäger wählt sein Opfer...</span>
                                    </div>
                                )}
                                {isDay ? <Sun size={48} className="text-yellow-500 mb-2" /> : <Moon size={48} className="text-indigo-400 mb-2" />}
                                <h2 className="text-2xl font-bold mb-1">{isDay ? 'Tag' : 'Nacht'} {gameState.dayNumber}</h2>
                                <p className="text-sm text-slate-400 mb-6">Du bist der Erzähler.</p>
                                <button
                                    onClick={toggleDayNight}
                                    className={`w-full py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 ${isDay ? 'bg-indigo-900 hover:bg-indigo-800 text-indigo-200' : 'bg-orange-600 hover:bg-orange-500 text-white'}`}
                                >
                                    <RefreshCw size={18} /> {isDay ? 'Nacht einleiten' : 'Tag einleiten'}
                                </button>
                            </div>

                            {isDay && (
                                <div className="bg-slate-900 p-5 rounded-3xl border border-slate-700 shadow-xl">
                                    <h3 className="font-bold text-slate-300 mb-3 flex items-center gap-2"><Skull size={18} className="text-red-400" /> Letzte Nacht starben:</h3>
                                    {(!gameState.recentDeaths || gameState.recentDeaths.length === 0) ? (
                                        <p className="text-sm text-slate-500 italic">Niemand ist gestorben.</p>
                                    ) : (
                                        <ul className="space-y-2">
                                            {gameState.recentDeaths.map((d, i) => {
                                                const pName = activePlayers.find(p=>p.id===d.id)?.name || 'Unbekannt';
                                                return (
                                                    <li key={i} className="text-sm bg-slate-800 p-2 rounded-lg border border-slate-700">
                                                        <span className="font-bold text-red-400">{pName}</span> <br/>
                                                        <span className="text-xs text-slate-500">Grund: {d.reason}</span>
                                                    </li>
                                                )
                                            })}
                                        </ul>
                                    )}
                                </div>
                            )}

                            {!isDay && (
                                <div className="bg-slate-900 p-5 rounded-3xl border border-slate-700 shadow-xl">
                                    <h3 className="font-bold text-slate-300 mb-4">Ablauf der Nacht:</h3>
                                    {nightSteps.length === 0 ? (
                                        <p className="text-slate-500 text-sm">Keine aktiven Nacht-Rollen mehr übrig.</p>
                                    ) : (
                                        <div className="space-y-2 text-sm">
                                            {nightSteps.map(step => (
                                                <div key={step.num} className={`p-2 bg-slate-800 rounded border-l-2 ${step.color}`}>
                                                    {step.num}. {step.text}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="lg:col-span-3 bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl">
                            <div className="flex justify-between items-center mb-6 border-b border-slate-700 pb-4">
                                <h3 className="text-2xl font-bold flex items-center gap-2"><List className="text-indigo-400" /> Master-Liste</h3>
                                <button onClick={abortGame} className="flex items-center gap-2 text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 px-4 py-2 rounded-lg transition-colors font-bold border border-slate-600">
                                    <Home size={16} /> Abbrechen
                                </button>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {activePlayers.map(p => {
                                    const state = gameState.playerState[p.id];
                                    if (!state) return null;
                                    const roleObj = WERWOLF_ROLES[state.role];
                                    const wasKilledTonight = !isDay && !state.alive && gameState.recentDeaths?.some(d => d.id === p.id && d.reason === 'Wolf');

                                    return (
                                        <div key={p.id} className={`p-4 rounded-2xl border transition-all ${state.alive ? 'bg-slate-900/80 border-slate-700' : 'bg-slate-950 border-red-900/30 opacity-75'}`}>
                                            <div className="flex justify-between items-start mb-3">
                                                <div>
                                                    <span className={`font-bold text-lg ${state.alive ? 'text-white' : 'text-slate-500 line-through'}`}>{p.name}</span>
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${roleObj?.bg} ${roleObj?.color}`}>{roleObj?.name}</span>
                                                        {state.inLove && <Heart size={14} className="text-rose-500 fill-rose-500" title="Verliebt" />}
                                                    </div>
                                                </div>
                                                {!state.alive && <Skull className="text-red-900" size={24} />}
                                            </div>

                                            <div className="mt-4 pt-4 border-t border-slate-800 flex flex-wrap gap-2">
                                                {state.alive ? (
                                                    <div className="w-full grid grid-cols-2 gap-2">
                                                        <button onClick={() => setPlayerStatus(p.id, 'KILL', 'Wolf')} className="text-xs sm:text-sm bg-slate-800 hover:bg-red-950 text-red-400 py-2 rounded-lg transition-colors border border-slate-700 hover:border-red-900 flex items-center justify-center gap-1">💀 Wolf</button>
                                                        <button onClick={() => setPlayerStatus(p.id, 'KILL', 'Voting')} className="text-xs sm:text-sm bg-slate-800 hover:bg-slate-700 text-slate-300 py-2 rounded-lg transition-colors border border-slate-700 flex items-center justify-center gap-1">💀 Dorf (Vote)</button>

                                                        {rolesAlive.has('HEXE') && !witchState.poisonUsed && (
                                                            <button onClick={() => setPlayerStatus(p.id, 'POISON_WITCH')} className="text-xs sm:text-sm bg-slate-800 hover:bg-pink-950 text-pink-400 py-2 rounded-lg transition-colors border border-slate-700 hover:border-pink-900 flex items-center justify-center gap-1"><FlaskConical size={14}/> Vergiften</button>
                                                        )}

                                                        <button onClick={() => setPlayerStatus(p.id, 'KILL', 'Jäger')} className="text-xs sm:text-sm bg-slate-800 hover:bg-amber-950 text-amber-400 py-2 rounded-lg transition-colors border border-slate-700 hover:border-amber-900 flex items-center justify-center gap-1">💀 Jäger</button>

                                                        <button onClick={() => setPlayerStatus(p.id, 'LOVE')} className={`text-xs sm:text-sm py-2 rounded-lg transition-colors flex justify-center items-center gap-1 border ${state.inLove ? 'bg-rose-600 text-white border-rose-500' : 'bg-slate-800 text-rose-400 border-slate-700 hover:bg-rose-950 hover:border-rose-900'}`}>
                                                            <HeartHandshake size={14} /> Amor
                                                        </button>

                                                        <button onClick={() => setPlayerStatus(p.id, 'KILL', 'Liebeskummer')} className="text-xs sm:text-sm bg-slate-800 hover:bg-rose-950 text-rose-400 py-2 rounded-lg transition-colors border border-slate-700 hover:border-rose-900 flex items-center justify-center gap-1">💀 Kummer</button>
                                                    </div>
                                                ) : (
                                                    <div className="w-full flex flex-col gap-2">
                                                        {rolesAlive.has('HEXE') && wasKilledTonight && !witchState.healUsed && (
                                                            <button onClick={() => executePlayerStatus(p.id, 'HEAL_WITCH')} className="w-full text-sm bg-green-900/40 hover:bg-green-800 text-green-300 py-2 rounded-lg transition-colors border border-green-500/40 flex items-center justify-center gap-2 font-bold shadow-lg shadow-green-900/20">
                                                                <Syringe size={16} /> Hexe: Heilen
                                                            </button>
                                                        )}
                                                        <button onClick={() => executePlayerStatus(p.id, 'REVIVE')} className="w-full text-xs bg-slate-800 hover:bg-slate-700 text-slate-400 py-2 rounded-lg transition-colors border border-slate-700">
                                                            Wiederbeleben (Fehler korrigieren)
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                    </div>
                </div>
            );
        }

        // --- 3. NORMAL PLAYER VIEW ---
        const myState = gameState.playerState[user.uid];
        if (!myState) {
            return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">Lade Rolle...</div>;
        }

        const myRoleObj = WERWOLF_ROLES[myState.role];
        const myWolves = myState.role === 'WERWOLF'
            ? players.filter(p => p.id !== user.uid && gameState.playerState[p.id]?.role === 'WERWOLF')
            : [];
        const myLovers = myState.inLove
            ? players.filter(p => p.id !== user.uid && gameState.playerState[p.id]?.inLove)
            : [];

        return (
            <div className={`min-h-screen text-white p-4 sm:p-8 flex flex-col items-center transition-colors duration-1000 ${gameState.isDay ? 'bg-orange-950/20' : 'bg-slate-950'}`}>
                <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} absolute={true} hideHostButton={true} />

                <div className="max-w-2xl mx-auto w-full mt-10">

                    <div className="text-center mb-10">
                        {gameState.isDay ? (
                            <Sun size={64} className="mx-auto text-yellow-500 mb-4 animate-[spin_10s_linear_infinite]" />
                        ) : (
                            <Moon size={64} className="mx-auto text-indigo-400 mb-4" />
                        )}
                        <h2 className="text-5xl font-black uppercase tracking-widest">{gameState.isDay ? 'Es ist Tag' : 'Es ist Nacht'}</h2>
                        <p className="text-slate-400 mt-2 text-lg">Höre auf den Erzähler.</p>
                    </div>

                    {!myState.alive ? (
                        <div className="bg-red-950/40 border border-red-900/50 rounded-3xl p-8 text-center shadow-2xl mb-8 relative overflow-hidden">
                            <Skull size={100} className="mx-auto text-red-900/20 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2" />
                            <h3 className="text-3xl font-bold text-red-500 relative z-10 mb-2">Du bist tot.</h3>
                            <p className="text-slate-300 relative z-10">Grund: {myState.deathReason}</p>
                            <p className="text-slate-500 text-sm mt-4 relative z-10">Du darfst nicht mehr sprechen oder abstimmen. Schließe nachts weiterhin die Augen.</p>
                        </div>
                    ) : (
                        <div className={`rounded-3xl p-8 text-center shadow-2xl mb-8 border border-slate-700 bg-slate-800`}>
                            <p className="text-slate-400 uppercase tracking-widest text-sm mb-2 font-bold">Deine geheime Rolle</p>
                            <h3 className={`text-4xl font-black mb-4 ${myRoleObj?.color}`}>{myRoleObj?.name}</h3>
                            <div className="w-16 h-1 bg-slate-700 mx-auto mb-4 rounded"></div>
                            <p className="text-slate-300 text-lg leading-relaxed">{myRoleObj?.description}</p>

                            {myWolves.length > 0 && (
                                <div className="mt-6 p-4 bg-red-900/20 border border-red-900/50 rounded-xl">
                                    <p className="text-red-400 font-bold mb-2">Dein Wolfsrudel:</p>
                                    <div className="flex flex-wrap justify-center gap-2">
                                        {myWolves.map(w => (
                                            <span key={w.id} className="bg-red-950 text-red-300 px-3 py-1 rounded-lg text-sm border border-red-900">{w.name} {gameState.playerState[w.id].alive ? '' : '💀'}</span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {myLovers.length > 0 && (
                                <div className="mt-6 p-4 bg-rose-900/20 border border-rose-900/50 rounded-xl">
                                    <p className="text-rose-400 font-bold mb-2"><Heart size={16} className="inline mr-1" /> Deine wahre Liebe:</p>
                                    <div className="flex flex-wrap justify-center gap-2">
                                        {myLovers.map(l => (
                                            <span key={l.id} className="bg-rose-950 text-rose-300 px-3 py-1 rounded-lg text-sm border border-rose-900">{l.name} {gameState.playerState[l.id].alive ? '' : '💀'}</span>
                                        ))}
                                    </div>
                                </div>
                            )}

                        </div>
                    )}

                    <div className="bg-slate-900/80 rounded-2xl p-6 border border-slate-800">
                        <h4 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4">Das Dorf</h4>
                        <div className="flex flex-wrap gap-2">
                            {players.filter(p => p.id !== gameState.narrator).map(p => {
                                const s = gameState.playerState[p.id];
                                if (!s) return null;
                                return (
                                    <span key={p.id} className={`px-3 py-1.5 rounded-lg text-sm border ${s.alive ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-slate-950 border-red-900/30 text-slate-600 line-through'}`}>
                    {p.name} {p.id === user.uid && '(Du)'}
                  </span>
                                )
                            })}
                        </div>
                    </div>

                </div>
            </div>
        );
    }

    // ==========================================
    // Phase: FINAL RESULTS
    // ==========================================
    if (gameState.phase === 'FINAL_RESULTS') {
        const isNarratorOrHost = user.uid === gameState.narrator || isHost;
        const { winningFaction, playerState } = gameState;

        let factionTitle = "Unentschieden!";
        let factionColor = "text-slate-400";
        let factionSub = "Das Dorf wurde komplett ausgelöscht.";

        if (winningFaction === 'DORF') {
            factionTitle = "Das Dorf gewinnt!";
            factionColor = "text-blue-400";
            factionSub = "Alle Werwölfe wurden zur Strecke gebracht.";
        } else if (winningFaction === 'WERWOLFE') {
            factionTitle = "Die Werwölfe gewinnen!";
            factionColor = "text-red-500";
            factionSub = "Das Dorf wurde überrannt.";
        } else if (winningFaction === 'LIEBESPAAR') {
            factionTitle = "Das Liebespaar gewinnt!";
            factionColor = "text-rose-500";
            factionSub = "Die Liebe hat über alles gesiegt.";
        }

        const distributePointsAndReturnToLobby = async () => {
            const lobbyRef = doc(db, 'lobbies', lobbyCode);

            if (lobby.settings.globalLeaderboard) {
                let newPlayers = [...players].map(p => {
                    // Erzähler bekommt IMMER 2 Punkte
                    if (p.id === gameState.narrator) {
                        return { ...p, globalScore: (p.globalScore || 0) + 2 };
                    }

                    const s = playerState[p.id];
                    if (!s) return p;

                    let addedPoints = 0;
                    if (winningFaction === 'LIEBESPAAR' && s.inLove) {
                        addedPoints = 5;
                    } else if (winningFaction === 'DORF' && s.role !== 'WERWOLF') {
                        addedPoints = 3;
                    } else if (winningFaction === 'WERWOLFE' && s.role === 'WERWOLF') {
                        addedPoints = 5;
                    }
                    return { ...p, globalScore: (p.globalScore || 0) + addedPoints };
                });

                await updateDoc(lobbyRef, { status: 'LOBBY_WAITING', players: newPlayers, 'gameState': {} });
            } else {
                await updateDoc(lobbyRef, { status: 'LOBBY_WAITING', 'gameState': {} });
            }
        };

        return (
            <div className="min-h-screen bg-slate-950 text-white p-4 sm:p-8 relative flex flex-col items-center">
                <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} absolute={true} hideHostButton={true} />

                <div className="max-w-3xl w-full mx-auto mt-16 text-center">
                    <div className="mb-10 animate-in zoom-in duration-500">
                        <Trophy size={64} className={`mx-auto mb-4 ${factionColor}`} />
                        <h2 className={`text-5xl sm:text-6xl font-black uppercase tracking-widest ${factionColor}`}>{factionTitle}</h2>
                        <p className="text-slate-400 mt-3 text-xl">{factionSub}</p>
                    </div>

                    <div className="bg-slate-800 rounded-3xl p-6 sm:p-8 border border-slate-700 shadow-2xl mb-10 text-left">
                        <h3 className="text-2xl font-bold mb-6 flex items-center gap-2 border-b border-slate-700 pb-4">
                            <Users className="text-indigo-400" /> Die wahren Rollen
                        </h3>

                        <div className="space-y-3">
                            {players.map(p => {
                                if (p.id === gameState.narrator) {
                                    return (
                                        <div key={p.id} className="flex justify-between items-center p-4 rounded-xl bg-slate-900 border border-slate-700 opacity-70">
                                            <span className="font-bold">{p.name} {p.id === user.uid && '(Du)'}</span>
                                            <div className="flex items-center gap-3">
                                                <span className="text-sm font-medium text-slate-400">Erzähler</span>
                                                {lobby.settings.globalLeaderboard && (
                                                    <span className="text-slate-300 font-bold text-sm bg-slate-700 px-2 py-1 rounded">+2 Pkt</span>
                                                )}
                                            </div>
                                        </div>
                                    );
                                }

                                const s = playerState[p.id];
                                if (!s) return null;

                                const roleObj = WERWOLF_ROLES[s.role];

                                let isWinner = false;
                                let pointsGained = 0;

                                if (winningFaction === 'LIEBESPAAR') {
                                    isWinner = s.inLove;
                                    pointsGained = 5;
                                } else if (winningFaction === 'DORF') {
                                    isWinner = s.role !== 'WERWOLF';
                                    pointsGained = 3;
                                } else if (winningFaction === 'WERWOLFE') {
                                    isWinner = s.role === 'WERWOLF';
                                    pointsGained = 5;
                                }

                                return (
                                    <div key={p.id} className={`flex flex-col sm:flex-row justify-between sm:items-center p-4 rounded-xl border transition-all ${isWinner && winningFaction !== 'UNENTSCHIEDEN' ? 'bg-green-900/20 border-green-500/30' : 'bg-slate-900 border-slate-700'}`}>
                                        <div className="flex items-center gap-3 mb-2 sm:mb-0">
                                            <span className={`font-bold text-lg ${s.alive ? 'text-white' : 'text-slate-500 line-through'}`}>{p.name} {p.id === user.uid && '(Du)'}</span>
                                            {!s.alive && <Skull size={16} className="text-red-900" title="Verstorben" />}
                                            {s.inLove && <Heart size={16} className="text-rose-500 fill-rose-500" title="Teil des Liebespaares" />}
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <span className={`px-3 py-1 rounded-full text-xs font-bold ${roleObj?.bg} ${roleObj?.color}`}>{roleObj?.name}</span>
                                            {lobby.settings.globalLeaderboard && isWinner && winningFaction !== 'UNENTSCHIEDEN' && (
                                                <span className="text-green-400 font-bold text-sm bg-green-500/10 px-2 py-1 rounded">+{pointsGained} Pkt</span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {isNarratorOrHost ? (
                        <button onClick={distributePointsAndReturnToLobby} className="w-full sm:w-auto bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white px-10 py-4 rounded-2xl font-bold text-xl shadow-xl transition-all active:scale-95 flex items-center justify-center gap-2 mx-auto">
                            <Home size={24} /> Punkte verteilen & Zurück zur Lobby
                        </button>
                    ) : (
                        <p className="text-slate-500 italic text-lg text-center bg-slate-900 p-4 rounded-xl border border-slate-800">
                            Warte auf den Host oder Erzähler für die Rückkehr zur Lobby...
                        </p>
                    )}
                </div>
            </div>
        );
    }

    return null;
}