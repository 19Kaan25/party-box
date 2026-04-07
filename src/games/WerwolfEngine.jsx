import React, { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { Sun, Moon, RefreshCw, Skull, List, Heart, HeartHandshake } from 'lucide-react';

import GameHeader from '../components/GameHeader';
import { WERWOLF_ROLES } from '../constants/gameData';
import { shuffleArray } from '../utils/helpers';

export default function WerwolfEngine({ lobby, user, isHost, db, updateLobbyStatus, leaveLobby }) {
  const { gameState, players, id: lobbyCode } = lobby;
  
  // Phase: SETUP
  if (gameState.phase === 'SETUP') {
    const [narratorId, setNarratorId] = useState(user.uid);
    const [roleCounts, setRoleCounts] = useState({ WERWOLF: 1, DORFBEWOHNER: 1, SEHERIN: 1, HEXE: 0, AMOR: 0, JAEGER: 0 });

    const totalSelected = Object.values(roleCounts).reduce((a,b)=>a+b,0);
    const requiredRoles = Math.max(1, players.length - 1); // Brauchen mind 1 Rolle für Tests, normal players.length - 1
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
            'gameState.isDay': false, // Beginnt mit der Nacht
            'gameState.playerState': playerState,
            'gameState.recentDeaths': [],
            'gameState.witchState': { healUsed: false, poisonUsed: false }
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
              Abbrechen
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

  // Phase: PLAYING (Narrator View vs Player View)
  if (gameState.phase === 'PLAYING') {
    const isNarrator = user.uid === gameState.narrator;
    const isDay = gameState.isDay;

    // --- Narrator Dashboard ---
    if (isNarrator) {
      const activePlayers = players.filter(p => p.id !== gameState.narrator);
      
      const toggleDayNight = async () => {
        await updateDoc(doc(db, 'lobbies', lobbyCode), {
            'gameState.isDay': !gameState.isDay,
            ...(gameState.isDay ? {} : { 'gameState.dayNumber': gameState.dayNumber + 1 }),
            ...(gameState.isDay ? { 'gameState.recentDeaths': [] } : {})
        });
      };

      const setPlayerStatus = async (targetId, action, reason = null) => {
        const newPlayerState = { ...gameState.playerState };
        if (action === 'KILL') {
            newPlayerState[targetId].alive = false;
            newPlayerState[targetId].deathReason = reason;
            const newRecentDeaths = [...(gameState.recentDeaths||[]), {id: targetId, reason}];
            await updateDoc(doc(db, 'lobbies', lobbyCode), {
                'gameState.playerState': newPlayerState,
                'gameState.recentDeaths': newRecentDeaths
            });
        } else if (action === 'REVIVE') {
            newPlayerState[targetId].alive = true;
            newPlayerState[targetId].deathReason = null;
            await updateDoc(doc(db, 'lobbies', lobbyCode), {
                'gameState.playerState': newPlayerState
            });
        } else if (action === 'LOVE') {
            newPlayerState[targetId].inLove = !newPlayerState[targetId].inLove;
            await updateDoc(doc(db, 'lobbies', lobbyCode), {
                'gameState.playerState': newPlayerState
            });
        }
      };

      return (
        <div className="min-h-screen bg-slate-950 text-white p-4 sm:p-8 flex flex-col relative">
          <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} absolute={true} hideHostButton={true} />
          
          <div className="max-w-6xl mx-auto w-full grid grid-cols-1 lg:grid-cols-4 gap-6">
            
            {/* Sidebar: Phase Tracker & Summary */}
            <div className="lg:col-span-1 flex flex-col gap-6">
              <div className={`p-6 rounded-3xl border shadow-xl flex flex-col items-center text-center ${isDay ? 'bg-orange-950/30 border-orange-500/30' : 'bg-indigo-950/30 border-indigo-500/30'}`}>
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
                  <div className="space-y-2 text-sm">
                    {gameState.dayNumber === 1 && <div className="p-2 bg-slate-800 rounded border-l-2 border-rose-500">1. Amor (Liebespaar wählen)</div>}
                    {gameState.dayNumber === 1 && <div className="p-2 bg-slate-800 rounded border-l-2 border-pink-300">2. Liebespaar (sich erkennen)</div>}
                    <div className="p-2 bg-slate-800 rounded border-l-2 border-purple-500">3. Seherin (erwacht)</div>
                    <div className="p-2 bg-slate-800 rounded border-l-2 border-red-500">4. Werwölfe (Opfer wählen)</div>
                    <div className="p-2 bg-slate-800 rounded border-l-2 border-pink-500">5. Hexe (Heilen / Vergiften)</div>
                  </div>
                </div>
              )}
            </div>

            {/* Main Area: Master-List */}
            <div className="lg:col-span-3 bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl">
              <div className="flex justify-between items-center mb-6 border-b border-slate-700 pb-4">
                <h3 className="text-2xl font-bold flex items-center gap-2"><List className="text-indigo-400" /> Master-Liste</h3>
                {isHost && (
                    <button onClick={() => { if(window.confirm('Spiel wirklich für alle abbrechen?')) updateLobbyStatus('LOBBY_WAITING', null, { gameState: {} }); }} className="text-xs bg-red-900/50 hover:bg-red-900 text-red-300 px-3 py-1.5 rounded transition-colors">
                        Spiel abbrechen
                    </button>
                )}
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {activePlayers.map(p => {
                  const state = gameState.playerState[p.id];
                  if (!state) return null;
                  const roleObj = WERWOLF_ROLES[state.role];
                  
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

                      {/* Action Buttons */}
                      <div className="mt-4 pt-3 border-t border-slate-800 flex flex-wrap gap-2">
                        {state.alive ? (
                          <div className="w-full flex flex-col gap-2">
                            <div className="flex gap-2">
                                <button onClick={() => setPlayerStatus(p.id, 'KILL', 'Wolf')} className="flex-1 text-[10px] sm:text-xs bg-red-950 hover:bg-red-900 text-red-300 py-1.5 rounded transition-colors">💀 Wolf</button>
                                <button onClick={() => setPlayerStatus(p.id, 'KILL', 'Hexe')} className="flex-1 text-[10px] sm:text-xs bg-pink-950 hover:bg-pink-900 text-pink-300 py-1.5 rounded transition-colors">💀 Hexe</button>
                                <button onClick={() => setPlayerStatus(p.id, 'KILL', 'Voting')} className="flex-1 text-[10px] sm:text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 py-1.5 rounded transition-colors">💀 Dorf</button>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => setPlayerStatus(p.id, 'KILL', 'Liebeskummer')} className="flex-1 text-[10px] sm:text-xs bg-rose-950 hover:bg-rose-900 text-rose-300 py-1.5 rounded transition-colors">💀 Kummer</button>
                                <button onClick={() => setPlayerStatus(p.id, 'KILL', 'Jäger')} className="flex-1 text-[10px] sm:text-xs bg-amber-950 hover:bg-amber-900 text-amber-300 py-1.5 rounded transition-colors">💀 Jäger</button>
                                <button onClick={() => setPlayerStatus(p.id, 'LOVE')} className={`flex-1 text-[10px] sm:text-xs py-1.5 rounded transition-colors flex justify-center items-center gap-1 ${state.inLove ? 'bg-rose-500 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                                  <HeartHandshake size={12} /> Amor
                                </button>
                            </div>
                          </div>
                        ) : (
                          <button onClick={() => setPlayerStatus(p.id, 'REVIVE')} className="w-full text-xs bg-green-900/30 hover:bg-green-900 text-green-400 py-2 rounded-lg transition-colors border border-green-500/20">
                            Wiederbeleben (Fehler korrigieren)
                          </button>
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

    // --- Normal Player View ---
    const myState = gameState.playerState[user.uid];
    if (!myState) {
        return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">Lade Rolle...</div>;
    }

    const myRoleObj = WERWOLF_ROLES[myState.role];

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

  return null;
}