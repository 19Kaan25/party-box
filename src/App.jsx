import React, { useState, useEffect } from 'react';
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc, getDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import { Users, Play, Trophy, Copy, Check, LogOut, Settings, AlertCircle, ArrowRight } from 'lucide-react';

import { auth, db } from './utils/firebase';
import { generateLobbyCode } from './utils/helpers';

import GameHeader from './components/GameHeader';
import CodenamesEngine from './games/CodenamesEngine';
import StadtLandFlussEngine from './games/StadtLandFlussEngine';
import WerwolfEngine from './games/WerwolfEngine';


// --- Main App Component ---
export default function App() {
  const [user, setUser] = useState(null);
  const [lobbyCode, setLobbyCode] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [currentLobby, setCurrentLobby] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);

  // Initialize Auth & Check Active Session
  useEffect(() => {
    const initAuth = async () => {
      try {
        await signInAnonymously(auth);
      } catch (err) {
        console.error("Auth Error:", err);
        setIsInitializing(false);
      }
    };
    initAuth();
    
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        try {
          const userRef = doc(db, 'users', currentUser.uid);
          const userSnap = await getDoc(userRef);
          
          if (userSnap.exists()) {
            const userData = userSnap.data();
            if (userData.currentLobby) {
              const lobbyRef = doc(db, 'lobbies', userData.currentLobby);
              const lobbySnap = await getDoc(lobbyRef);
              
              if (lobbySnap.exists()) {
                const lobbyData = lobbySnap.data();
                const isInLobby = lobbyData.players.some(p => p.id === currentUser.uid);
                if (isInLobby) {
                  setPlayerName(userData.name || '');
                  setLobbyCode(userData.currentLobby);
                } else {
                  await updateDoc(userRef, { currentLobby: null });
                }
              } else {
                await updateDoc(userRef, { currentLobby: null });
              }
            }
          }
        } catch (err) {
          console.error("Session restore error:", err);
        }
      }
      setIsInitializing(false);
    });
    
    return () => unsubscribe();
  }, []);

  // Subscribe to Lobby Changes
  useEffect(() => {
    if (!user || !lobbyCode) return;

    const lobbyRef = doc(db, 'lobbies', lobbyCode);
    const unsubscribe = onSnapshot(lobbyRef, (docSnap) => {
      if (docSnap.exists()) {
        setCurrentLobby(docSnap.data());
      } else {
        setCurrentLobby(null);
        setLobbyCode('');
        setErrorMsg('Lobby wurde geschlossen oder existiert nicht.');
        updateDoc(doc(db, 'users', user.uid), { currentLobby: null }).catch(() => {});
      }
    }, (error) => {
      console.error("Snapshot error:", error);
      setErrorMsg('Verbindungsfehler zur Lobby.');
    });

    return () => unsubscribe();
  }, [user, lobbyCode]);

  // --- Actions ---
  const handleCreateLobby = async (e) => {
    e.preventDefault();
    if (!user || !playerName.trim()) return setErrorMsg('Bitte gib einen Namen ein.');
    
    const newCode = generateLobbyCode();
    const lobbyRef = doc(db, 'lobbies', newCode);
    
    const initialLobbyData = {
      id: newCode,
      hostId: user.uid,
      status: 'LOBBY_WAITING',
      currentGame: null,
      settings: { globalLeaderboard: true },
      players: [{ id: user.uid, name: playerName.trim(), isHost: true, globalScore: 0 }],
      gameState: {}
    };

    try {
      await setDoc(lobbyRef, initialLobbyData);
      await setDoc(doc(db, 'users', user.uid), {
        currentLobby: newCode,
        name: playerName.trim()
      }, { merge: true });
      
      setLobbyCode(newCode);
      setErrorMsg('');
    } catch (err) {
      console.error("Fehler beim Erstellen:", err);
      setErrorMsg('Fehler beim Erstellen der Lobby. Checke die Firebase Rules!');
    }
  };

  const handleJoinLobby = async (e, joinCode) => {
    e.preventDefault();
    if (!user || !playerName.trim() || !joinCode.trim()) return setErrorMsg('Bitte fülle alle Felder aus.');
    
    const code = joinCode.toUpperCase().trim();
    const lobbyRef = doc(db, 'lobbies', code);
    
    try {
      const snap = await getDoc(lobbyRef);
      if (!snap.exists()) {
        return setErrorMsg('Lobby nicht gefunden.');
      }
      
      const data = snap.data();
      if (data.players.find(p => p.name.toLowerCase() === playerName.trim().toLowerCase())) {
        return setErrorMsg('Dieser Name ist bereits in der Lobby vergeben.');
      }
      
      if (data.status !== 'LOBBY_WAITING') {
        return setErrorMsg('Spiel läuft bereits. Beitritt nicht möglich.');
      }

      const updatedPlayers = [...data.players, { id: user.uid, name: playerName.trim(), isHost: false, globalScore: 0 }];
      await updateDoc(lobbyRef, { players: updatedPlayers });
      
      await setDoc(doc(db, 'users', user.uid), {
        currentLobby: code,
        name: playerName.trim()
      }, { merge: true });
      
      setLobbyCode(code);
      setErrorMsg('');
    } catch (err) {
      console.error("Fehler beim Beitreten:", err);
      setErrorMsg('Fehler beim Beitreten.');
    }
  };

  const leaveLobby = async () => {
    if (!currentLobby || !user) {
      setLobbyCode('');
      setCurrentLobby(null);
      return;
    }

    const lobbyRef = doc(db, 'lobbies', lobbyCode);
    const userRef = doc(db, 'users', user.uid);
    
    try {
      const remainingPlayers = currentLobby.players.filter(p => p.id !== user.uid);

      if (currentLobby.hostId === user.uid) {
        if (remainingPlayers.length > 0) {
          const randomIndex = Math.floor(Math.random() * remainingPlayers.length);
          const newHostId = remainingPlayers[randomIndex].id;
          
          const updatedPlayers = remainingPlayers.map(p => 
            p.id === newHostId ? { ...p, isHost: true } : p
          );

          await updateDoc(lobbyRef, {
            hostId: newHostId,
            players: updatedPlayers
          });
        }
      } else {
        await updateDoc(lobbyRef, { players: remainingPlayers });
      }
      
      await updateDoc(userRef, { currentLobby: null });
      setLobbyCode('');
      setCurrentLobby(null);
    } catch (err) {
      console.error("Fehler beim Verlassen:", err);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard?.writeText(lobbyCode).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const updateLobbyStatus = async (status, game = null, additionalData = {}) => {
    if (currentLobby?.hostId !== user?.uid) return;
    const lobbyRef = doc(db, 'lobbies', lobbyCode);
    await updateDoc(lobbyRef, { 
      status, 
      ...(game && { currentGame: game }),
      ...additionalData
    });
  };

  // --- Renderers ---
  if (isInitializing) {
    return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400 animate-pulse">Lade Sitzung...</div>;
  }

  if (!user) {
    return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">Lade Authentifizierung...</div>;
  }

  // View: Welcome
  if (!currentLobby) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 font-sans p-6 flex flex-col items-center justify-center">
        <div className="max-w-md w-full bg-slate-800 rounded-3xl p-8 shadow-2xl border border-slate-700">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-500 mb-2">
              Party Box
            </h1>
            <p className="text-slate-400">Multiplayer Minigames für Freunde</p>
          </div>

          {errorMsg && (
            <div className="mb-4 p-3 bg-red-900/50 border border-red-500/50 rounded-lg flex items-center gap-2 text-red-200 text-sm">
              <AlertCircle size={16} /> {errorMsg}
            </div>
          )}

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Dein Nickname</label>
              <input 
                type="text" 
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="z.B. PlayerOne"
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
              />
            </div>

            <div className="pt-4 border-t border-slate-700 space-y-4">
              <button 
                onClick={handleCreateLobby}
                className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-all transform hover:scale-[1.02] active:scale-95 shadow-lg shadow-purple-900/20"
              >
                <Play size={20} /> Neue Lobby erstellen
              </button>

              <div className="relative flex items-center py-2">
                <div className="flex-grow border-t border-slate-700"></div>
                <span className="flex-shrink-0 mx-4 text-slate-500 text-sm">ODER</span>
                <div className="flex-grow border-t border-slate-700"></div>
              </div>

              <form onSubmit={(e) => {
                const code = e.target.elements.code.value;
                handleJoinLobby(e, code);
              }} className="flex gap-2">
                <input 
                  name="code"
                  type="text" 
                  placeholder="Lobby Code (z.B. AB12)"
                  maxLength={4}
                  className="w-2/3 uppercase bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-pink-500 transition-all"
                />
                <button 
                  type="submit"
                  className="w-1/3 bg-slate-700 hover:bg-slate-600 text-white font-bold py-3 px-4 rounded-xl flex items-center justify-center transition-all active:scale-95"
                >
                  Beitreten
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isHost = currentLobby.hostId === user.uid;
  const me = currentLobby.players.find(p => p.id === user.uid);

  // View: Lobby Waiting
  if (currentLobby.status === 'LOBBY_WAITING') {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 p-4 sm:p-8">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="flex justify-between items-center mb-8 bg-slate-800 p-4 rounded-2xl border border-slate-700">
            <div>
              <p className="text-slate-400 text-sm font-medium">Lobby Code</p>
              <div className="flex items-center gap-3">
                <h2 className="text-3xl font-mono font-bold tracking-widest text-purple-400">{currentLobby.id}</h2>
                <button 
                  onClick={copyToClipboard}
                  className="p-2 hover:bg-slate-700 rounded-lg transition-colors text-slate-300"
                  title="Code kopieren"
                >
                  {copied ? <Check size={20} className="text-green-400" /> : <Copy size={20} />}
                </button>
              </div>
            </div>
            <button onClick={() => { if(window.confirm('Willst du die Lobby wirklich verlassen?')) leaveLobby(); }} className="text-red-400 hover:text-red-300 flex items-center gap-2 text-sm font-medium bg-red-400/10 px-4 py-2 rounded-lg transition-colors">
              <LogOut size={16} /> Verlassen
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Players List */}
            <div className="lg:col-span-1 bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold flex items-center gap-2"><Users className="text-indigo-400" /> Spieler ({currentLobby.players.length})</h3>
              </div>
              <div className="space-y-3">
                {currentLobby.players.map((p, idx) => (
                  <div key={p.id} className={`p-4 rounded-xl flex items-center justify-between ${p.id === user.uid ? 'bg-indigo-600/20 border border-indigo-500/30' : 'bg-slate-900/50'}`}>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center font-bold text-sm">
                        {p.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="font-medium text-slate-200">{p.name} {p.id === user.uid && '(Du)'}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {currentLobby.settings.globalLeaderboard && (
                        <span className="text-sm font-bold text-yellow-400 bg-yellow-500/10 px-2 py-1 rounded" title="Globale Punkte">{p.globalScore} Pkt</span>
                      )}
                      {p.isHost && <Trophy size={16} className="text-yellow-500" title="Host" />}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Game Selection */}
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                  <h3 className="text-xl font-bold flex items-center gap-2"><Play className="text-pink-400" /> Spielekatalog</h3>
                  {isHost ? (
                    <button 
                      onClick={() => updateLobbyStatus(currentLobby.status, null, { settings: { ...currentLobby.settings, globalLeaderboard: !currentLobby.settings.globalLeaderboard } })}
                      className={`flex w-full sm:w-auto items-center justify-center gap-2 text-sm px-3 py-2 rounded-lg border transition-colors ${currentLobby.settings.globalLeaderboard ? 'text-green-400 border-green-500/30 bg-green-500/10 hover:bg-green-500/20' : 'text-slate-400 border-slate-700 bg-slate-900 hover:bg-slate-800'}`}
                    >
                      <Settings size={14} />
                      <span>Globales Scoring {currentLobby.settings.globalLeaderboard ? 'an' : 'aus'}</span>
                    </button>
                  ) : (
                    <div className={`flex w-full sm:w-auto items-center justify-center gap-2 text-sm px-3 py-2 rounded-lg border ${currentLobby.settings.globalLeaderboard ? 'text-green-400 border-green-500/30 bg-green-500/10' : 'text-slate-400 border-slate-700 bg-slate-900'}`}>
                      <Trophy size={14} />
                      <span>Globales Scoring {currentLobby.settings.globalLeaderboard ? 'an' : 'aus'}</span>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Game 1: MVP */}
                  <div className={`p-5 rounded-2xl border-2 transition-all ${isHost ? 'cursor-pointer hover:border-purple-500 border-slate-700 bg-slate-900/50 hover:bg-slate-900' : 'border-slate-700 bg-slate-900/30 opacity-70'}`}
                       onClick={() => isHost && updateLobbyStatus('GAME_IN_PROGRESS', 'STADT_LAND_FLUSS', {
                         gameState: { phase: 'SETUP', letter: '', answers: {}, readyPlayers: [], gameScores: {} }
                       })}>
                    <h4 className="font-bold text-lg text-purple-300 mb-1">Stadt Land Fluss</h4>
                    <p className="text-sm text-slate-400 mb-4">Der Klassiker. Teste dein Wissen unter Zeitdruck!</p>
                    {isHost ? (
                      <span className="text-xs font-bold text-purple-400 uppercase flex items-center gap-1">Starten <ArrowRight size={14} /></span>
                    ) : (
                      <span className="text-xs text-slate-500">Warten auf Host...</span>
                    )}
                  </div>

                  {/* Game 2: Codenames */}
                  <div className={`p-5 rounded-2xl border-2 transition-all ${isHost ? 'cursor-pointer hover:border-red-500 border-slate-700 bg-slate-900/50 hover:bg-slate-900' : 'border-slate-700 bg-slate-900/30 opacity-70'}`}
                       onClick={() => isHost && updateLobbyStatus('GAME_IN_PROGRESS', 'CODENAMES', {
                         gameState: { phase: 'TEAM_SETUP', teams: { red: [], blue: [] }, spymasters: { red: null, blue: null } }
                       })}>
                    <h4 className="font-bold text-lg text-red-400 mb-1">Codenames</h4>
                    <p className="text-sm text-slate-400 mb-4">Top-Secret! Finde alle deine Agenten.</p>
                    {isHost ? (
                      <span className="text-xs font-bold text-red-400 uppercase flex items-center gap-1">Starten <ArrowRight size={14} /></span>
                    ) : (
                      <span className="text-xs text-slate-500">Warten auf Host...</span>
                    )}
                  </div>

                  {/* Game 3: Werwolf */}
                  <div className={`p-5 rounded-2xl border-2 transition-all ${isHost ? 'cursor-pointer hover:border-indigo-500 border-slate-700 bg-slate-900/50 hover:bg-slate-900' : 'border-slate-700 bg-slate-900/30 opacity-70'}`}
                       onClick={() => isHost && updateLobbyStatus('GAME_IN_PROGRESS', 'WERWOLF', {
                         gameState: { phase: 'SETUP' }
                       })}>
                    <h4 className="font-bold text-lg text-indigo-400 mb-1">Werwolf</h4>
                    <p className="text-sm text-slate-400 mb-4">Das Dorf schläft ein... Finde die Verräter!</p>
                    {isHost ? (
                      <span className="text-xs font-bold text-indigo-400 uppercase flex items-center gap-1">Starten <ArrowRight size={14} /></span>
                    ) : (
                      <span className="text-xs text-slate-500">Warten auf Host...</span>
                    )}
                  </div>

                  {/* Future Games */}
                  {['Wer bin ich?'].map(game => (
                    <div key={game} className="p-5 rounded-2xl border-2 border-slate-800 bg-slate-900/20 opacity-50 relative overflow-hidden">
                      <div className="absolute top-2 right-2 bg-slate-800 text-xs px-2 py-1 rounded text-slate-400 font-medium">Coming Soon</div>
                      <h4 className="font-bold text-lg text-slate-500 mb-1">{game}</h4>
                      <p className="text-sm text-slate-600">In Entwicklung</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // View: Dynamic Game
  if (currentLobby.status === 'GAME_IN_PROGRESS' && currentLobby.currentGame === 'STADT_LAND_FLUSS') {
    return <StadtLandFlussEngine 
             lobby={currentLobby} 
             user={user} 
             isHost={isHost} 
             db={db} 
             updateLobbyStatus={updateLobbyStatus} 
             leaveLobby={leaveLobby}
           />;
  }

  if (currentLobby.status === 'GAME_IN_PROGRESS' && currentLobby.currentGame === 'CODENAMES') {
    return <CodenamesEngine 
             lobby={currentLobby} 
             user={user} 
             isHost={isHost} 
             db={db} 
             updateLobbyStatus={updateLobbyStatus} 
             leaveLobby={leaveLobby}
           />;
  }

  if (currentLobby.status === 'GAME_IN_PROGRESS' && currentLobby.currentGame === 'WERWOLF') {
    return <WerwolfEngine 
             lobby={currentLobby} 
             user={user} 
             isHost={isHost} 
             db={db} 
             updateLobbyStatus={updateLobbyStatus} 
             leaveLobby={leaveLobby}
           />;
  }

  return <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">Lade Ansicht...</div>;
}