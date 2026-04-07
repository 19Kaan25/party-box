import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import { Users, Play, Trophy, Copy, Check, LogOut, Settings, AlertCircle, ArrowRight, Plus, Trash2, Dices, List, X, ThumbsDown, Files, Search, Pin, PinOff } from 'lucide-react';

// --- Firebase Initialization ---
const getFirebaseConfig = () => {
  if (typeof __firebase_config !== 'undefined') {
    return JSON.parse(__firebase_config);
  }
  // Trage hier deine lokalen Firebase-Daten direkt ein
  return {
    apiKey: "AIzaSyCwRv6ZYW_EioY36FAfiqveGlB4u6TUIe8",
    authDomain: "party-box-45d2b.firebaseapp.com",
    projectId: "party-box-45d2b",
    storageBucket: "party-box-45d2b.firebasestorage.app",
    messagingSenderId: "694553735373",
    appId: "1:694553735373:web:eb4d50f4fc244bd0de7984"
  };
};

const app = initializeApp(getFirebaseConfig());
const auth = getAuth(app);
const db = getFirestore(app);

// --- General Helper Functions ---
const generateLobbyCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split('');
const getRandomLetter = () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)];

const shuffleArray = (array) => {
  let newArr = [...array];
  for (let i = newArr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
  }
  return newArr;
};

const GameHeader = ({ isHost, leaveLobby, updateLobbyStatus, absolute = false, maxWidthClass = "max-w-2xl" }) => {
  const content = (
    <>
      {isHost ? (
        <button onClick={() => updateLobbyStatus('LOBBY_WAITING', null, { gameState: {} })} className="flex items-center gap-1 text-red-400 hover:text-red-300 text-sm bg-red-400/10 px-3 py-1.5 rounded-lg transition-colors border border-red-500/20 backdrop-blur-sm shadow-lg">
          <X size={16} /> Spiel beenden
        </button>
      ) : (
        <button onClick={leaveLobby} className="flex items-center gap-1 text-red-400 hover:text-red-300 text-sm bg-red-400/10 px-3 py-1.5 rounded-lg transition-colors border border-red-500/20 backdrop-blur-sm shadow-lg">
          <LogOut size={16} /> Spiel verlassen
        </button>
      )}
    </>
  );

  if (absolute) return <div className="absolute top-4 right-4 sm:top-8 sm:right-8 z-50">{content}</div>;
  return <div className={`w-full ${maxWidthClass} mx-auto flex justify-end mb-4 z-50`}>{content}</div>;
};

// --- Codenames Constants ---
const CODENAMES_WORDS = [
  "Apfel", "Bank", "Berlin", "Brücke", "Ball", "Berg", "Box", "Brille", "Deckel", "Drache", 
  "Eis", "Erde", "Feder", "Feuer", "Film", "Flügel", "Geist", "Gericht", "Glocke", "Hund", 
  "Jet", "Kater", "Kette", "Kiefer", "Knopf", "Krone", "Leiter", "Licht", "Luft", "Mars", 
  "Maske", "Maus", "Mine", "Mond", "Nagel", "Note", "Nuß", "Pfeffer", "Ring", "Ritter", 
  "Satz", "Schalter", "Schiff", "Schloss", "Schule", "Stern", "Strom", "Tafel", "Taucher", "Zug", 
  "Anker", "Arzt", "Auge", "Auto", "Baum", "Bogen", "Brief", "Burg", "Dame", "Daumen", 
  "Diamant", "Dieb", "Dose", "Fackel", "Flasche", "Fuß", "Garten", "Gift", "Gold", "Gras", 
  "Hahn", "Hai", "Hammer", "Hand", "Herz", "Hitze", "Honig", "Horn", "Käse", "Katze", 
  "Kiwi", "Koch", "König", "Korken", "Kreuz", "Kuchen", "Kugel", "Laser", "Löwe", "Löffel", 
  "Nadel", "Netz", "Ozean", "Palme", "Papier", "Park", "Pilz", "Rad", "Rakete", "Raum", 
  "Abenteuer", "Agent", "Alibi", "Antenne", "Atlas", "Batterie", "Besen", "Blitz", "Boden", "Braten", 
  "Buch", "Clown", "Computer", "Dampf", "Dschungel", "Ei", "Elefant", "Engel", "Faden", "Fallschirm", 
  "Farbe", "Fenster", "Flöte", "Form", "Gabel", "Gefängnis", "Glas", "Gummi", "Gürtel", "Hafen", 
  "Helm", "Insel", "Kaffee", "Kamera", "Kanone", "Karte", "Kleber", "Koffer", "Krawatte", "Leinwand", 
  "Linse", "Mantel", "Messer", "Mikroskop", "Millionär", "Motor", "Musik", "Nase", "Nest", "Pfeife", 
  "Amboss", "Anzug", "Affe", "Axt", "Bär", "Biene", "Birne", "Brot", "Bürste", "Dach", 
  "Dinosaurier", "Dolch", "Echse", "Eimer", "Eule", "Fahne", "Fass", "Fisch", "Fliege", "Frosch", 
  "Gitarre", "Grab", "Gurke", "Handschuh", "Harfe", "Hase", "Heft", "Hexe", "Hose", "Hut", 
  "Igel", "Jaguar", "Kamm", "Kamel", "Keks", "Kissen", "Klavier", "Klee", "Knochen", "Korb", 
  "Krake", "Kran", "Kuh", "Lampe", "Lasso", "Laub", "Lippe", "Lupe", "Magnet", "Marke", 
  "Mauer", "Schrank", "Socke", "Tunnel", "Wald", "Wolke", "Zelt", "Zunge", "Zucker", "Zwerg", 
  "Uhr", "Vampir", "Vogel", "Vulkan", "Waage", "Wagen", "Wand", "Wasser", "Würfel", "Wüste", 
  "Schatten", "Schlamm", "Schlange", "Schirm", "Schnecke", "Schnee", "Schnur", "Schuh", "Schwamm", "Schwein", 
  "See", "Seife", "Seil", "Senf", "Sonne", "Spiel", "Spinne", "Spritze", "Stadt", "Stein", 
  "Stock", "Strand", "Stroh", "Superheld", "Suppe", "Tabak", "Tasche", "Taxi", "Tee", "Telefon"
];

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
      if (currentLobby.hostId === user.uid) {
        setLobbyCode('');
        setCurrentLobby(null);
        await updateDoc(userRef, { currentLobby: null });
      } else {
        const updatedPlayers = currentLobby.players.filter(p => p.id !== user.uid);
        await updateDoc(lobbyRef, { players: updatedPlayers });
        await updateDoc(userRef, { currentLobby: null });
        setLobbyCode('');
        setCurrentLobby(null);
      }
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
            <button onClick={leaveLobby} className="text-red-400 hover:text-red-300 flex items-center gap-2 text-sm font-medium bg-red-400/10 px-4 py-2 rounded-lg transition-colors">
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

                  {/* Future Games */}
                  {['Werwolf', 'Wer bin ich?'].map(game => (
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

  return <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">Lade Ansicht...</div>;
}


// --- Game Engine: Codenames ---
function CodenamesEngine({ lobby, user, isHost, db, updateLobbyStatus, leaveLobby }) {
  const { gameState, players, id: lobbyCode } = lobby;
  
  const [clueWord, setClueWord] = useState('');
  const [clueCount, setClueCount] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [customWordInput, setCustomWordInput] = useState('');
  const [pinnedWords, setPinnedWords] = useState([]);
  const [customWords, setCustomWords] = useState([]);

  const joinTeam = async (teamColor, role) => {
    const lobbyRef = doc(db, 'lobbies', lobbyCode);
    let newTeams = { red: [...(gameState.teams?.red || [])], blue: [...(gameState.teams?.blue || [])] };
    let newSpymasters = { red: gameState.spymasters?.red, blue: gameState.spymasters?.blue };

    newTeams.red = newTeams.red.filter(id => id !== user.uid);
    newTeams.blue = newTeams.blue.filter(id => id !== user.uid);
    if (newSpymasters.red === user.uid) newSpymasters.red = null;
    if (newSpymasters.blue === user.uid) newSpymasters.blue = null;

    newTeams[teamColor].push(user.uid);
    if (role === 'SPYMASTER') {
      newSpymasters[teamColor] = user.uid;
    }

    await updateDoc(lobbyRef, {
      'gameState.teams': newTeams,
      'gameState.spymasters': newSpymasters
    });
  };

  const proceedToBoardSetup = async () => {
    const lobbyRef = doc(db, 'lobbies', lobbyCode);
    await updateDoc(lobbyRef, {
      'gameState.phase': 'BOARD_SETUP',
      'gameState.pinnedWords': [],
      'gameState.customWords': []
    });
  };

  const togglePin = (word) => {
    if (pinnedWords.includes(word)) {
      setPinnedWords(pinnedWords.filter(w => w !== word));
    } else {
      if (pinnedWords.length >= 25) return;
      setPinnedWords([...pinnedWords, word]);
    }
  };

  const addCustomWord = (e) => {
    e.preventDefault();
    const w = customWordInput.trim().toUpperCase();
    if (w && !customWords.includes(w) && !CODENAMES_WORDS.map(x=>x.toUpperCase()).includes(w)) {
      setCustomWords([...customWords, w]);
      if (pinnedWords.length < 25) {
        setPinnedWords([...pinnedWords, w]);
      }
    }
    setCustomWordInput('');
  };

  const generateBoard = async () => {
    const startingTeam = Math.random() < 0.5 ? 'red' : 'blue';
    const otherTeam = startingTeam === 'red' ? 'blue' : 'red';
    
    const colors = [
      ...Array(9).fill(startingTeam),
      ...Array(8).fill(otherTeam),
      ...Array(7).fill('neutral'),
      'black'
    ];
    const shuffledColors = shuffleArray(colors);
    
    let allAvailable = [...CODENAMES_WORDS.map(w=>w.toUpperCase()), ...customWords].filter(w => !pinnedWords.includes(w));
    allAvailable = shuffleArray(allAvailable);
    
    let finalWords = [...pinnedWords];
    const needed = 25 - finalWords.length;
    finalWords = [...finalWords, ...allAvailable.slice(0, needed)];
    finalWords = shuffleArray(finalWords);
    
    const board = finalWords.map((word, i) => ({
      id: i,
      word: word,
      color: shuffledColors[i],
      isRevealed: false
    }));

    const lobbyRef = doc(db, 'lobbies', lobbyCode);
    await updateDoc(lobbyRef, {
      'gameState.phase': 'PLAYING',
      'gameState.board': board,
      'gameState.turn': `${startingTeam.toUpperCase()}_SPYMASTER`,
      'gameState.currentClue': null,
      'gameState.winner': null,
      'gameState.startingTeam': startingTeam,
      'gameState.customWords': customWords
    });
  };

  const submitClue = async () => {
    if (!clueWord.trim()) return;
    
    let parsedCount = parseInt(clueCount, 10);
    if (isNaN(parsedCount) || parsedCount < 1) parsedCount = 1;
    if (parsedCount > 9) parsedCount = 9;

    const currentTeam = gameState.turn.split('_')[0].toLowerCase();
    const lobbyRef = doc(db, 'lobbies', lobbyCode);
    await updateDoc(lobbyRef, {
      'gameState.currentClue': { word: clueWord.trim(), count: parsedCount, guessesLeft: parsedCount + 1 },
      'gameState.turn': `${currentTeam.toUpperCase()}_OPERATIVE`
    });
    setClueWord('');
    setClueCount(1);
  };

  const endTurn = async () => {
    const currentTeam = gameState.turn.split('_')[0].toLowerCase();
    const nextTeam = currentTeam === 'red' ? 'blue' : 'red';
    const lobbyRef = doc(db, 'lobbies', lobbyCode);
    await updateDoc(lobbyRef, {
      'gameState.turn': `${nextTeam.toUpperCase()}_SPYMASTER`,
      'gameState.currentClue': null
    });
  };

  const guessWord = async (cardIndex) => {
    const card = gameState.board[cardIndex];
    if (card.isRevealed) return;

    const currentTeam = gameState.turn.split('_')[0].toLowerCase();
    const nextTeam = currentTeam === 'red' ? 'blue' : 'red';
    
    let newBoard = [...gameState.board];
    newBoard[cardIndex] = { ...card, isRevealed: true };

    let newTurn = gameState.turn;
    let newClue = gameState.currentClue ? { ...gameState.currentClue } : null;
    let winner = null;

    if (card.color === 'black') {
      winner = nextTeam;
    } else if (card.color === currentTeam) {
      if (newClue) {
        newClue.guessesLeft -= 1;
        if (newClue.guessesLeft <= 0) {
          newTurn = `${nextTeam.toUpperCase()}_SPYMASTER`;
          newClue = null;
        }
      }
    } else {
      newTurn = `${nextTeam.toUpperCase()}_SPYMASTER`;
      newClue = null;
    }

    if (!winner) {
      const redLeft = newBoard.filter(c => c.color === 'red' && !c.isRevealed).length;
      const blueLeft = newBoard.filter(c => c.color === 'blue' && !c.isRevealed).length;
      if (redLeft === 0) winner = 'red';
      if (blueLeft === 0) winner = 'blue';
    }

    const lobbyRef = doc(db, 'lobbies', lobbyCode);
    await updateDoc(lobbyRef, {
      'gameState.board': newBoard,
      'gameState.turn': newTurn,
      'gameState.currentClue': newClue,
      ...(winner && { 'gameState.phase': 'REVIEW', 'gameState.winner': winner })
    });
  };

  const myTeam = gameState.teams?.red.includes(user.uid) ? 'red' : (gameState.teams?.blue.includes(user.uid) ? 'blue' : null);
  const myRole = (gameState.spymasters?.red === user.uid || gameState.spymasters?.blue === user.uid) ? 'SPYMASTER' : 'OPERATIVE';
  const isMyTurn = gameState.turn?.startsWith(myTeam?.toUpperCase()) && gameState.turn?.endsWith(myRole);

  if (gameState.phase === 'TEAM_SETUP') {
    const redTeamIds = gameState.teams?.red || [];
    const blueTeamIds = gameState.teams?.blue || [];
    const redSpy = gameState.spymasters?.red;
    const blueSpy = gameState.spymasters?.blue;
    const unassignedPlayers = players.filter(p => !redTeamIds.includes(p.id) && !blueTeamIds.includes(p.id));

    return (
      <div className="min-h-screen bg-slate-900 text-white p-4 sm:p-8 flex flex-col relative">
        <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} absolute={true} />
        <div className="max-w-5xl mx-auto w-full flex-grow flex flex-col">
          <div className="text-center mb-8 mt-6">
            <h2 className="text-4xl font-black tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-red-500 to-blue-500 uppercase">Codenames</h2>
            <p className="text-slate-400 mt-2">Wählt eure Teams und bestimmt die Geheimdienstchefs.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 flex-grow">
            {/* Team Red */}
            <div className="bg-red-950/30 border border-red-500/30 rounded-3xl p-6 flex flex-col">
              <h3 className="text-2xl font-bold text-red-500 mb-6 flex items-center justify-between">
                Team Rot <span className="text-sm bg-red-500/20 px-3 py-1 rounded-full">{redTeamIds.length} Agenten</span>
              </h3>
              <div className="mb-6">
                <h4 className="text-sm uppercase tracking-wider text-red-400/70 mb-3">Geheimdienstchef (max. 1)</h4>
                <div className="min-h-[60px] bg-slate-900/50 rounded-xl border border-slate-800 flex items-center justify-between p-3">
                  {redSpy ? (
                    <span className="font-bold text-red-300 flex items-center gap-2">
                      <Settings size={18} /> {players.find(p => p.id === redSpy)?.name} {redSpy === user.uid && '(Du)'}
                    </span>
                  ) : <span className="text-slate-500 italic text-sm">Vakant</span>}
                  {redSpy !== user.uid && (
                    <button onClick={() => joinTeam('red', 'SPYMASTER')} className="text-xs bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 rounded transition-colors">Chef werden</button>
                  )}
                </div>
              </div>
              <div className="flex-grow">
                <h4 className="text-sm uppercase tracking-wider text-red-400/70 mb-3">Ermittler</h4>
                <div className="space-y-2 mb-4">
                  {redTeamIds.filter(id => id !== redSpy).length === 0 && <p className="text-slate-500 italic text-sm">Keine Ermittler</p>}
                  {redTeamIds.filter(id => id !== redSpy).map(id => (
                    <div key={id} className="bg-slate-900/50 rounded-xl border border-slate-800 p-3 text-slate-300 font-medium">
                      {players.find(p => p.id === id)?.name} {id === user.uid && '(Du)'}
                    </div>
                  ))}
                </div>
                {!redTeamIds.includes(user.uid) || redSpy === user.uid ? (
                  <button onClick={() => joinTeam('red', 'OPERATIVE')} className="w-full border-2 border-dashed border-red-500/30 hover:border-red-500/60 text-red-400/70 hover:text-red-400 py-3 rounded-xl transition-all">+ Als Ermittler beitreten</button>
                ) : null}
              </div>
            </div>

            {/* Team Blue */}
            <div className="bg-blue-950/30 border border-blue-500/30 rounded-3xl p-6 flex flex-col">
              <h3 className="text-2xl font-bold text-blue-500 mb-6 flex items-center justify-between">
                Team Blau <span className="text-sm bg-blue-500/20 px-3 py-1 rounded-full">{blueTeamIds.length} Agenten</span>
              </h3>
              <div className="mb-6">
                <h4 className="text-sm uppercase tracking-wider text-blue-400/70 mb-3">Geheimdienstchef (max. 1)</h4>
                <div className="min-h-[60px] bg-slate-900/50 rounded-xl border border-slate-800 flex items-center justify-between p-3">
                  {blueSpy ? (
                    <span className="font-bold text-blue-300 flex items-center gap-2">
                      <Settings size={18} /> {players.find(p => p.id === blueSpy)?.name} {blueSpy === user.uid && '(Du)'}
                    </span>
                  ) : <span className="text-slate-500 italic text-sm">Vakant</span>}
                  {blueSpy !== user.uid && (
                    <button onClick={() => joinTeam('blue', 'SPYMASTER')} className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded transition-colors">Chef werden</button>
                  )}
                </div>
              </div>
              <div className="flex-grow">
                <h4 className="text-sm uppercase tracking-wider text-blue-400/70 mb-3">Ermittler</h4>
                <div className="space-y-2 mb-4">
                  {blueTeamIds.filter(id => id !== blueSpy).length === 0 && <p className="text-slate-500 italic text-sm">Keine Ermittler</p>}
                  {blueTeamIds.filter(id => id !== blueSpy).map(id => (
                    <div key={id} className="bg-slate-900/50 rounded-xl border border-slate-800 p-3 text-slate-300 font-medium">
                      {players.find(p => p.id === id)?.name} {id === user.uid && '(Du)'}
                    </div>
                  ))}
                </div>
                {!blueTeamIds.includes(user.uid) || blueSpy === user.uid ? (
                  <button onClick={() => joinTeam('blue', 'OPERATIVE')} className="w-full border-2 border-dashed border-blue-500/30 hover:border-blue-500/60 text-blue-400/70 hover:text-blue-400 py-3 rounded-xl transition-all">+ Als Ermittler beitreten</button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mt-8 bg-slate-800 rounded-3xl p-6 border border-slate-700 flex flex-col md:flex-row items-center justify-between gap-6">
            <div>
              <h4 className="text-sm uppercase tracking-wider text-slate-400 mb-2">Zuschauer / Nicht zugewiesen</h4>
              <div className="flex flex-wrap gap-2">
                {unassignedPlayers.length === 0 && <span className="text-slate-500 text-sm">Alle Spieler sind einem Team zugewiesen.</span>}
                {unassignedPlayers.map(p => (
                  <span key={p.id} className="bg-slate-900 px-3 py-1 rounded text-sm text-slate-300 border border-slate-700">
                    {p.name} {p.id === user.uid && '(Du)'}
                  </span>
                ))}
              </div>
            </div>

            {isHost && (
              <div className="flex gap-4 w-full md:w-auto">
                <button onClick={() => updateLobbyStatus('LOBBY_WAITING', null, { gameState: {} })} className="flex-1 md:flex-none bg-slate-700 hover:bg-slate-600 text-white px-6 py-3 rounded-xl font-medium transition-colors">
                  Zurück
                </button>
                <button onClick={proceedToBoardSetup} className="flex-1 md:flex-none bg-gradient-to-r from-red-600 to-blue-600 hover:from-red-500 hover:to-blue-500 text-white px-8 py-3 rounded-xl font-bold shadow-lg transition-all active:scale-95">
                  Spielfeld generieren
                </button>
              </div>
            )}
            {!isHost && <p className="text-slate-500 text-sm italic">Warte auf Host...</p>}
          </div>
        </div>
      </div>
    );
  }

  if (gameState.phase === 'BOARD_SETUP') {
    if (!isHost) {
      return (
        <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-8 relative">
           <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} absolute={true} />
           <div className="flex items-center gap-3 text-slate-400 bg-slate-800 px-6 py-4 rounded-xl border border-slate-700">
              <span className="animate-pulse">Der Host konfiguriert das Spielfeld...</span>
           </div>
        </div>
      );
    }

    const allCombinedWords = [...CODENAMES_WORDS.map(w => w.toUpperCase()), ...customWords];
    const filteredWords = allCombinedWords.filter(w => w.includes(searchTerm.toUpperCase()) && !pinnedWords.includes(w));

    return (
      <div className="min-h-screen bg-slate-900 text-white p-4 sm:p-8 flex flex-col items-center relative">
        <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} absolute={false} maxWidthClass="max-w-5xl" />
        <h2 className="text-3xl font-bold text-slate-200 mb-6">Spielfeld vorbereiten</h2>
        
        <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-8 flex-grow mb-8">
          {/* Left: Word Pool */}
          <div className="bg-slate-800 p-6 rounded-3xl border border-slate-700 flex flex-col h-[60vh]">
            <h3 className="text-xl font-bold mb-4">Wort-Katalog</h3>
            <div className="relative mb-4">
              <Search className="absolute left-3 top-3 text-slate-500" size={18} />
              <input type="text" placeholder="Wörter suchen..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-white focus:outline-none focus:border-red-500"/>
            </div>
            <form onSubmit={addCustomWord} className="flex gap-2 mb-4">
              <input type="text" placeholder="Eigenes Wort..." value={customWordInput} onChange={e => setCustomWordInput(e.target.value)} className="flex-grow bg-slate-900 border border-slate-700 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-red-500 uppercase"/>
              <button type="submit" className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-xl transition-colors"><Plus size={20} /></button>
            </form>
            <div className="flex-grow overflow-y-auto space-y-2 pr-2">
              {filteredWords.slice(0, 50).map(word => (
                <div key={word} className="flex items-center justify-between bg-slate-900/50 p-3 rounded-xl border border-slate-700/50">
                  <span className="font-medium tracking-wider">{word}</span>
                  <button onClick={() => togglePin(word)} className="text-slate-400 hover:text-white transition-colors"><Pin size={18} /></button>
                </div>
              ))}
              {filteredWords.length === 0 && <p className="text-sm text-slate-500 text-center py-2">Keine Wörter gefunden.</p>}
            </div>
          </div>

          {/* Right: Pinned Words */}
          <div className="bg-slate-800 p-6 rounded-3xl border border-slate-700 flex flex-col h-[60vh]">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">Angepinnte Wörter</h3>
              <span className={`px-3 py-1 rounded-full text-sm font-bold ${pinnedWords.length === 25 ? 'bg-green-500/20 text-green-400' : 'bg-blue-500/20 text-blue-400'}`}>
                {pinnedWords.length} / 25
              </span>
            </div>
            <p className="text-sm text-slate-400 mb-4">Diese Wörter erscheinen garantiert im nächsten Spiel.</p>
            <div className="flex-grow overflow-y-auto space-y-2 pr-2">
              {pinnedWords.map(word => (
                <div key={word} className="flex items-center justify-between bg-blue-900/20 p-3 rounded-xl border border-blue-500/30">
                  <span className="font-medium tracking-wider text-blue-100">{word}</span>
                  <button onClick={() => togglePin(word)} className="text-red-400 hover:text-red-300 transition-colors"><PinOff size={18} /></button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-4 w-full max-w-5xl">
          <button onClick={() => updateLobbyStatus('LOBBY_WAITING', null, { gameState: {} })} className="w-1/3 bg-slate-700 hover:bg-slate-600 text-white px-6 py-4 rounded-2xl font-bold transition-all active:scale-95 text-lg">
            Abbrechen
          </button>
          <button onClick={generateBoard} className="w-2/3 bg-gradient-to-r from-red-600 to-blue-600 hover:from-red-500 hover:to-blue-500 text-white px-8 py-4 rounded-2xl font-bold shadow-lg transition-all active:scale-95 text-xl">
            Spielfeld generieren
          </button>
        </div>
      </div>
    );
  }

  if (gameState.phase === 'PLAYING') {
    const currentTeam = gameState.turn.split('_')[0].toLowerCase();
    const currentRole = gameState.turn.split('_')[1];
    const redLeft = gameState.board?.filter(c => c.color === 'red' && !c.isRevealed).length || 0;
    const blueLeft = gameState.board?.filter(c => c.color === 'blue' && !c.isRevealed).length || 0;

    return (
      <div className="min-h-screen bg-slate-900 text-white p-2 sm:p-8 flex flex-col items-center relative">
        <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} absolute={false} maxWidthClass="max-w-5xl" />
        
        <div className="w-full max-w-5xl flex flex-col sm:flex-row justify-between items-center gap-4 mb-6 bg-slate-800 p-4 rounded-2xl border border-slate-700 shadow-lg">
          <div className="w-full sm:w-auto flex items-center justify-center">
            <div className={`w-full sm:w-auto text-center px-4 py-2.5 rounded-xl font-bold text-sm sm:text-base shadow-inner ${currentTeam === 'red' ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'}`}>
              ZUG: TEAM {currentTeam === 'red' ? 'ROT' : 'BLAU'} ({currentRole === 'SPYMASTER' ? 'GEHEIMDIENSTCHEF' : 'ERMITTLER'})
            </div>
          </div>
          <div className="w-full sm:w-auto flex justify-center gap-6 font-mono text-lg sm:text-xl font-bold bg-slate-900/60 px-6 py-2.5 rounded-xl border border-slate-700/50">
            <span className="text-red-500 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]"></span> ROT: {redLeft}
            </span>
            <span className="text-blue-500 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]"></span> BLAU: {blueLeft}
            </span>
          </div>
        </div>

        <div className="w-full max-w-5xl mb-6 bg-slate-800 p-6 rounded-2xl border border-slate-700 flex flex-col sm:flex-row items-center justify-between gap-4">
          {gameState.currentClue ? (
            <div className="flex flex-wrap items-center gap-4 w-full">
              <span className="text-slate-400 font-medium">Hinweis:</span>
              <span className="text-xl sm:text-2xl font-black tracking-widest uppercase bg-slate-900 px-4 py-2 rounded-lg border border-slate-700">{gameState.currentClue.word}</span>
              <span className="text-xl sm:text-2xl font-black bg-slate-900 px-4 py-2 rounded-lg border border-slate-700">{gameState.currentClue.count}</span>
              <span className="ml-auto text-sm text-slate-400">Verbleibende Tipps: <b className="text-white">{gameState.currentClue.guessesLeft}</b></span>
              {isMyTurn && myRole === 'OPERATIVE' && (
                <button onClick={endTurn} className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg sm:ml-4 transition-colors font-medium">Zug beenden</button>
              )}
            </div>
          ) : (
            <div className="w-full flex items-center justify-center text-slate-400">
              {currentRole === 'SPYMASTER' ? 'Der Geheimdienstchef überlegt...' : 'Warte auf Hinweis...'}
            </div>
          )}

          {isMyTurn && myRole === 'SPYMASTER' && !gameState.currentClue && (
             <div className="flex flex-col gap-3 w-full sm:w-80 mt-4 sm:mt-0">
               <input type="text" value={clueWord} onChange={(e) => setClueWord(e.target.value)} placeholder="Dein Hinweiswort" className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-slate-500 w-full"/>
               <div className="flex items-center gap-3">
                 <div className="flex items-center bg-slate-900 border border-slate-700 rounded-lg overflow-hidden shrink-0 h-12">
                   <button onClick={() => setClueCount(Math.max(1, clueCount - 1))} className="w-12 h-full flex items-center justify-center bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors font-bold text-2xl">-</button>
                   <div className="w-10 font-bold text-white text-center text-lg">{clueCount}</div>
                   <button onClick={() => setClueCount(Math.min(9, clueCount + 1))} className="w-12 h-full flex items-center justify-center bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors font-bold text-2xl">+</button>
                 </div>
                 <button onClick={submitClue} className="bg-green-600 hover:bg-green-500 text-white px-4 rounded-lg font-bold transition-colors flex-grow h-12">Senden</button>
               </div>
             </div>
          )}
        </div>

        <div className="w-full max-w-5xl grid grid-cols-5 gap-2 sm:gap-4 flex-grow">
          {(gameState.board || []).map((card, idx) => {
            const isSpymaster = myRole === 'SPYMASTER';
            const isInteractive = isMyTurn && myRole === 'OPERATIVE' && !card.isRevealed && gameState.currentClue;
            let cardBg = 'bg-slate-700 hover:bg-slate-600 border-slate-600';
            let textColor = 'text-white';
            
            if (card.isRevealed) {
              if (card.color === 'red') { cardBg = 'bg-red-500 border-red-600 shadow-inner'; }
              if (card.color === 'blue') { cardBg = 'bg-blue-500 border-blue-600 shadow-inner'; }
              if (card.color === 'neutral') { cardBg = 'bg-amber-100 border-amber-200'; textColor = 'text-slate-800'; }
              if (card.color === 'black') { cardBg = 'bg-slate-950 border-black shadow-inner'; }
            } else if (isSpymaster) {
              if (card.color === 'red') { cardBg = 'bg-red-950/80 border-red-900/50'; textColor = 'text-red-200'; }
              if (card.color === 'blue') { cardBg = 'bg-blue-950/80 border-blue-900/50'; textColor = 'text-blue-200'; }
              if (card.color === 'neutral') { cardBg = 'bg-amber-900/30 border-amber-900/50'; textColor = 'text-amber-100/70'; }
              if (card.color === 'black') { cardBg = 'bg-slate-900 border-slate-700'; textColor = 'text-slate-400'; }
            }

            return (
              <button key={idx} onClick={() => isInteractive && guessWord(idx)} disabled={!isInteractive}
                className={`relative flex items-center justify-center p-2 sm:p-4 rounded-xl border-2 font-bold text-[10px] sm:text-lg uppercase tracking-wider transition-all break-words ${cardBg} ${textColor} ${isInteractive ? 'cursor-pointer hover:scale-[1.02] active:scale-95 shadow-lg shadow-white/5 border-white/30' : 'cursor-default'} ${card.isRevealed ? 'opacity-90' : ''}`}
              >
                {card.isRevealed && card.color === 'black' && <span className="absolute text-3xl sm:text-4xl opacity-50">☠️</span>}
                <span className="z-10 text-center break-words w-full overflow-hidden">{card.word}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (gameState.phase === 'REVIEW') {
    const winnerColor = gameState.winner;
    const isWin = winnerColor === myTeam;

    const returnToLobby = async () => {
      if (lobby.settings.globalLeaderboard && winnerColor) {
        const winningTeamIds = gameState.teams[winnerColor] || [];
        let newPlayers = [...players].map(p => {
          if (winningTeamIds.includes(p.id)) {
            return { ...p, globalScore: p.globalScore + 5 }; // +5 Punkte für Sieg
          }
          return p;
        });
        await updateLobbyStatus('LOBBY_WAITING', null, { players: newPlayers, gameState: {} });
      } else {
        await updateLobbyStatus('LOBBY_WAITING', null, { gameState: {} });
      }
    };

    return (
      <div className="min-h-screen bg-slate-900 text-white p-8 flex flex-col items-center justify-center relative">
        <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} absolute={true} />
        <h2 className="text-4xl sm:text-5xl font-black mb-4 uppercase tracking-widest text-center">
          {winnerColor === 'red' ? <span className="text-red-500">Team Rot</span> : <span className="text-blue-500">Team Blau</span>} gewinnt!
        </h2>
        {myTeam && (
          <p className={`text-2xl mb-8 text-center ${isWin ? 'text-green-400' : 'text-slate-500'}`}>
            {isWin ? 'Glückwunsch, Agent!' : 'Mission gescheitert.'}
          </p>
        )}
        <div className="w-full max-w-3xl grid grid-cols-5 gap-2 mb-10 opacity-70">
          {(gameState.board || []).map((card, idx) => {
            let cardBg = 'bg-slate-700';
            if (card.color === 'red') cardBg = 'bg-red-500 text-white';
            if (card.color === 'blue') cardBg = 'bg-blue-500 text-white';
            if (card.color === 'neutral') cardBg = 'bg-amber-100 text-slate-800';
            if (card.color === 'black') cardBg = 'bg-slate-950 text-white';

            return <div key={idx} className={`flex items-center justify-center p-2 rounded-lg text-[10px] sm:text-xs font-bold uppercase text-center break-words ${cardBg}`}>{card.word}</div>;
          })}
        </div>
        {isHost && (
          <button onClick={returnToLobby} className="bg-slate-700 hover:bg-slate-600 text-white px-8 py-4 rounded-xl font-bold shadow-lg transition-all active:scale-95 text-lg">
            Zurück zur Lobby
          </button>
        )}
      </div>
    );
  }

  return null;
}

// --- Game Engine: Stadt Land Fluss ---
function StadtLandFlussEngine({ lobby, user, isHost, db, updateLobbyStatus, leaveLobby }) {
  const { gameState, players, id: lobbyCode } = lobby;
  const [localAnswers, setLocalAnswers] = useState({});

  // Use strings to allow empty inputs in settings
  const [setupRounds, setSetupRounds] = useState('3');
  const [setupTimer, setSetupTimer] = useState('90');
  
  const [setupCategories, setSetupCategories] = useState(['Stadt', 'Land', 'Fluss']);
  const [newCatInput, setNewCatInput] = useState('');
  const [excludedLetters, setExcludedLetters] = useState([]);
  const [showCatModal, setShowCatModal] = useState(false);
  const [modalSelectedCats, setModalSelectedCats] = useState([]);
  
  const randomCategories = ['Marke', 'Automarke', 'Beruf', 'Tiere', 'Promi', 'Sänger', 'Fußballer', 'Schauspieler', 'Film', 'Serie', 'Film/Serie', 'Vorname', 'Nachname', 'Lebensmittel', 'Getränke', 'Grund für Verspätung'];

  useEffect(() => {
    if (gameState.phase === 'STARTING') setLocalAnswers({});
  }, [gameState.phase]);

  // Synchronized Start Logic
  const [startingCountdown, setStartingCountdown] = useState(3);
  useEffect(() => {
    if (gameState.phase === 'STARTING') {
      const interval = setInterval(() => {
        const remaining = Math.ceil((gameState.startTimestamp - Date.now()) / 1000);
        if (remaining <= 0) {
          clearInterval(interval);
          if (isHost) {
            updateDoc(doc(db, 'lobbies', lobbyCode), {
              'gameState.phase': 'PLAYING',
              'gameState.playingStartTime': Date.now()
            });
          }
        } else {
          setStartingCountdown(remaining);
        }
      }, 100);
      return () => clearInterval(interval);
    }
  }, [gameState.phase, gameState.startTimestamp, isHost, lobbyCode, db]);

  // Synchronized Playing Timer
  const [timeLeft, setTimeLeft] = useState(gameState.timerLimit || 90);
  useEffect(() => {
    if (gameState.phase === 'PLAYING' && gameState.playingStartTime) {
      setTimeLeft(gameState.timerLimit);
      const interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - gameState.playingStartTime) / 1000);
        const remaining = Math.max(0, (gameState.timerLimit || 90) - elapsed);
        setTimeLeft(remaining);
        
        // Host automatically ends round when time runs out
        if (remaining <= 0 && isHost) {
          triggerRoundEnd();
        }
      }, 250);
      return () => clearInterval(interval);
    }
  }, [gameState.phase, gameState.playingStartTime, gameState.timerLimit, isHost]);

  // Submitting Phase: Everyone pushes answers automatically when phase turns to SUBMITTING
  const localAnswersRef = useRef(localAnswers);
  useEffect(() => {
    localAnswersRef.current = localAnswers;
  }, [localAnswers]);

  useEffect(() => {
    if (gameState.phase === 'SUBMITTING') {
      const lobbyRef = doc(db, 'lobbies', lobbyCode);
      // Auto-submit local data
      updateDoc(lobbyRef, {
        [`gameState.answers.${user.uid}`]: localAnswersRef.current
      });
      
      // Host waits 2.5s for everyone to sync, then moves to REVIEW
      if (isHost) {
        const timer = setTimeout(() => {
          endRound();
        }, 2500);
        return () => clearTimeout(timer);
      }
    }
  }, [gameState.phase, isHost, lobbyCode, db, user.uid]);

  const addRandomCategory = () => {
    const available = randomCategories.filter(c => !setupCategories.includes(c));
    if (available.length === 0) return;
    setSetupCategories([...setupCategories, available[Math.floor(Math.random() * available.length)]]);
  };

  const addCategory = (e) => {
    e.preventDefault();
    const cat = newCatInput.trim();
    if (cat && !setupCategories.includes(cat)) {
      setSetupCategories([...setupCategories, cat]);
      setNewCatInput('');
    }
  };

  const removeCategory = (cat) => setSetupCategories(setupCategories.filter(c => c !== cat));

  const toggleModalCat = (cat) => {
    if (modalSelectedCats.includes(cat)) setModalSelectedCats(modalSelectedCats.filter(c => c !== cat));
    else setModalSelectedCats([...modalSelectedCats, cat]);
  };

  const confirmModalCats = () => {
    const newCats = modalSelectedCats.filter(c => !setupCategories.includes(c));
    setSetupCategories([...setupCategories, ...newCats]);
    setShowCatModal(false);
    setModalSelectedCats([]);
  };

  const toggleLetter = (letter) => {
    if (excludedLetters.includes(letter)) setExcludedLetters(excludedLetters.filter(l => l !== letter));
    else setExcludedLetters([...excludedLetters, letter]);
  };

  const getValidLetter = (excluded) => {
    const available = ALPHABET.filter(l => !excluded.includes(l));
    if (available.length === 0) return 'A';
    return available[Math.floor(Math.random() * available.length)];
  };

  const startGame = async () => {
    if (setupCategories.length === 0) return alert('Bitte wähle mindestens eine Kategorie.');
    
    let finalRounds = parseInt(setupRounds, 10);
    if (isNaN(finalRounds) || finalRounds < 1) finalRounds = 3;
    
    let finalTimer = parseInt(setupTimer, 10);
    if (isNaN(finalTimer)) finalTimer = 90;
    finalTimer = Math.max(30, Math.min(240, finalTimer));

    const letter = getValidLetter(excludedLetters);
    const lobbyRef = doc(db, 'lobbies', lobbyCode);
    
    await updateDoc(lobbyRef, {
      'gameState.categories': setupCategories,
      'gameState.maxRounds': finalRounds,
      'gameState.timerLimit': finalTimer,
      'gameState.currentRound': 1,
      'gameState.excludedLetters': excludedLetters,
      'gameState.letter': letter,
      'gameState.phase': 'STARTING',
      'gameState.startTimestamp': Date.now() + 4000,
      'gameState.answers': {},
      'gameState.votes': {}
    });
  };

  const nextRound = async () => {
    const letter = getValidLetter(gameState.excludedLetters || []);
    const lobbyRef = doc(db, 'lobbies', lobbyCode);
    const { roundScores } = calculateDynamicScores();
    const updatedGameScores = { ...(gameState.gameScores || {}) };
    players.forEach(p => {
      updatedGameScores[p.id] = (updatedGameScores[p.id] || 0) + (roundScores[p.id] || 0);
    });

    await updateDoc(lobbyRef, {
      'gameState.gameScores': updatedGameScores,
      'gameState.currentRound': gameState.currentRound + 1,
      'gameState.letter': letter,
      'gameState.phase': 'STARTING',
      'gameState.startTimestamp': Date.now() + 4000,
      'gameState.answers': {},
      'gameState.votes': {}
    });
  };

  // Triggers end of round for everyone instantly
  const triggerRoundEnd = async () => {
    if (gameState.phase !== 'PLAYING') return;
    const lobbyRef = doc(db, 'lobbies', lobbyCode);
    await updateDoc(lobbyRef, {
      'gameState.phase': 'SUBMITTING'
    });
  };

  const endRound = async () => {
    const lobbyRef = doc(db, 'lobbies', lobbyCode);
    const initialVotes = {};
    const categories = gameState.categories || [];
    players.forEach(p => {
      initialVotes[p.id] = {};
      categories.forEach(cat => {
        initialVotes[p.id][cat] = { reject: [], duplicate: [] };
      });
    });

    await updateDoc(lobbyRef, {
      'gameState.phase': 'REVIEW',
      'gameState.votes': initialVotes
    });
  };

  const toggleVote = async (targetPid, cat, type) => {
    const lobbyRef = doc(db, 'lobbies', lobbyCode);
    const currentVotes = gameState.votes?.[targetPid]?.[cat]?.[type] || [];
    let newVotes = currentVotes.includes(user.uid) ? currentVotes.filter(uid => uid !== user.uid) : [...currentVotes, user.uid];
    await updateDoc(lobbyRef, { [`gameState.votes.${targetPid}.${cat}.${type}`]: newVotes });
  };

  const calculateDynamicScores = () => {
    const roundScores = {};
    const detailedScores = {};
    const threshold = Math.floor(players.length / 2) + 1;

    players.forEach(p => { roundScores[p.id] = 0; detailedScores[p.id] = {}; });

    const categories = gameState.categories || [];
    const allAnswers = gameState.answers || {};

    categories.forEach(cat => {
      const validAnswers = {};
      const explicitDuplicates = {};

      Object.entries(allAnswers).forEach(([pid, ansObj]) => {
        const word = ansObj[cat]?.trim().toLowerCase();
        const votes = gameState.votes?.[pid]?.[cat] || { reject: [], duplicate: [] };
        
        const isRejected = votes.reject.length >= threshold;
        const isExplicitDuplicate = votes.duplicate.length >= threshold;

        if (word && word.startsWith((gameState.letter || '').toLowerCase()) && !isRejected) {
          validAnswers[pid] = word;
          if (isExplicitDuplicate) explicitDuplicates[pid] = true;
        }
      });

      const validCount = Object.keys(validAnswers).length;

      Object.entries(validAnswers).forEach(([pid, word]) => {
        const sameWordCount = Object.values(validAnswers).filter(w => w === word).length;
        const isDuplicate = sameWordCount > 1 || explicitDuplicates[pid];
        let pts = isDuplicate ? 5 : (validCount === 1 ? 20 : 10);
        roundScores[pid] += pts;
        detailedScores[pid][cat] = pts;
      });
    });

    return { roundScores, detailedScores };
  };

  if (gameState.phase === 'SETUP') {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-4 sm:p-6 relative">
        <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} absolute={true} />
        
        {showCatModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-slate-800 p-6 rounded-3xl w-full max-w-lg border border-slate-700 shadow-2xl">
              <div className="flex justify-between items-center mb-6">
                <h4 className="text-xl font-bold">Kategorien auswählen</h4>
                <button onClick={() => setShowCatModal(false)} className="text-slate-400 hover:text-white"><X size={24} /></button>
              </div>
              <div className="flex flex-wrap gap-2 mb-8 max-h-[50vh] overflow-y-auto pr-2">
                {randomCategories.map(c => (
                  <button key={c} onClick={() => toggleModalCat(c)} className={`px-4 py-2 rounded-xl border text-sm transition-all ${modalSelectedCats.includes(c) ? 'bg-purple-600 border-purple-500 text-white shadow-lg shadow-purple-900/30' : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'}`}>{c}</button>
                ))}
              </div>
              <div className="flex justify-end gap-3">
                <button onClick={() => setShowCatModal(false)} className="px-5 py-2.5 rounded-xl font-medium text-slate-300 hover:bg-slate-700 transition-colors">Abbrechen</button>
                <button onClick={confirmModalCats} className="bg-purple-600 hover:bg-purple-500 text-white px-6 py-2.5 rounded-xl font-bold transition-all shadow-lg">Hinzufügen</button>
              </div>
            </div>
          </div>
        )}

        <h2 className="text-4xl font-bold mb-2 text-purple-400 mt-8">Stadt Land Fluss</h2>
        
        {isHost ? (
          <div className="w-full max-w-3xl bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl mt-6">
            <h3 className="text-xl font-bold mb-4 flex items-center gap-2"><Settings size={20} className="text-indigo-400" /> Spieleinstellungen</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700">
                <label className="block text-sm font-medium text-slate-400 mb-2">Anzahl der Runden</label>
                <input type="text" inputMode="numeric" value={setupRounds} onChange={(e) => setSetupRounds(e.target.value.replace(/\D/g, ''))} className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500" placeholder="3"/>
              </div>

              <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700">
                <label className="block text-sm font-medium text-slate-400 mb-2">Timer (Sekunden)</label>
                <input type="text" inputMode="numeric" value={setupTimer} onChange={(e) => setSetupTimer(e.target.value.replace(/\D/g, ''))} className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500" placeholder="90"/>
                <p className="text-xs text-slate-500 mt-1">Zwischen 30s und 240s</p>
              </div>

              <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700">
                <label className="block text-sm font-medium text-slate-400 mb-2">Ausgeschlossen ({excludedLetters.length})</label>
                <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                  {ALPHABET.map(l => (
                    <button key={l} onClick={() => toggleLetter(l)} className={`w-7 h-7 flex items-center justify-center rounded text-xs font-bold transition-colors ${excludedLetters.includes(l) ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>{l}</button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mb-6 bg-slate-900/50 p-4 rounded-xl border border-slate-700">
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end mb-4 gap-2">
                <label className="block text-sm font-medium text-slate-400">Kategorien ({setupCategories.length})</label>
                <div className="flex flex-wrap gap-2">
                  <button onClick={addRandomCategory} className="text-xs flex items-center gap-1 bg-purple-600/20 text-purple-400 hover:bg-purple-600/40 px-3 py-1.5 rounded-lg transition-colors"><Dices size={14} /> Zufall</button>
                  <button onClick={() => setShowCatModal(true)} className="text-xs flex items-center gap-1 bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600/40 px-3 py-1.5 rounded-lg transition-colors"><List size={14} /> Aus Liste</button>
                </div>
              </div>
              
              <div className="flex flex-wrap gap-2 mb-4">
                {setupCategories.map(cat => (
                  <div key={cat} className="flex items-center gap-2 bg-slate-800 border border-slate-600 px-3 py-1.5 rounded-lg text-sm">
                    <span>{cat}</span>
                    <button onClick={() => removeCategory(cat)} className="text-red-400 hover:text-red-300"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>

              <form onSubmit={addCategory} className="flex gap-2">
                <input type="text" value={newCatInput} onChange={(e) => setNewCatInput(e.target.value)} placeholder="Neue Kategorie..." className="flex-grow bg-slate-800 border border-slate-600 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500"/>
                <button type="submit" className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-xl flex items-center gap-1 transition-colors"><Plus size={18} /> <span className="hidden sm:inline">Hinzufügen</span></button>
              </form>
            </div>

            <div className="flex gap-4 w-full">
              <button onClick={() => updateLobbyStatus('LOBBY_WAITING', null, { gameState: {} })} className="w-1/3 bg-slate-700 hover:bg-slate-600 text-white px-4 py-4 rounded-2xl font-bold transition-all active:scale-95">Zurück</button>
              <button onClick={startGame} className="w-2/3 bg-purple-600 hover:bg-purple-500 text-white px-4 py-4 rounded-2xl font-bold text-xl shadow-lg transition-all active:scale-95">Spiel starten</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 mt-8">
            <div className="flex items-center gap-3 text-slate-400 bg-slate-800 px-6 py-4 rounded-xl border border-slate-700">
              <span className="animate-pulse">Der Host konfiguriert das Spiel...</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Countdown view right before the round officially starts
  if (gameState.phase === 'STARTING') {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-4">
        <h2 className="text-3xl sm:text-4xl font-bold mb-6 text-slate-400">Runde {gameState.currentRound} startet in...</h2>
        <div className="text-8xl sm:text-9xl font-black text-transparent bg-clip-text bg-gradient-to-br from-purple-400 to-pink-500 animate-pulse drop-shadow-[0_0_20px_rgba(168,85,247,0.5)]">
          {startingCountdown > 0 ? startingCountdown : 'LOS!'}
        </div>
      </div>
    );
  }

  // During the game (answering)
  if (gameState.phase === 'PLAYING') {
    return (
      <div className="min-h-screen bg-slate-900 text-white p-4 sm:p-8 relative">
        <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} absolute={false} maxWidthClass="max-w-2xl" />
        <div className="max-w-2xl mx-auto">
          <div className="flex justify-between items-center mb-6">
            <div className="inline-block bg-slate-800 border border-slate-700 px-4 py-1.5 rounded-full text-slate-400 text-sm font-medium">
              Runde {gameState.currentRound} von {gameState.maxRounds}
            </div>
            
            {/* Countdown Timer Display */}
            <div className={`text-2xl font-black tabular-nums tracking-wider px-4 py-1.5 rounded-lg border ${timeLeft <= 10 ? 'text-red-400 border-red-500/50 bg-red-500/10 animate-pulse' : 'text-slate-200 border-slate-700 bg-slate-800'}`}>
               {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
            </div>
          </div>
          
          <div className="text-center mb-6">
            <p className="text-slate-400 font-medium uppercase tracking-widest text-sm mb-2">Der Buchstabe ist</p>
            <div className="w-28 h-28 sm:w-32 sm:h-32 mx-auto bg-gradient-to-br from-purple-500 to-pink-500 rounded-3xl flex items-center justify-center text-6xl sm:text-7xl font-black shadow-2xl shadow-purple-900/40">
              {gameState.letter}
            </div>
          </div>

          <div className="space-y-4 bg-slate-800 p-6 sm:p-8 rounded-3xl border border-slate-700 shadow-xl">
            {(gameState.categories || []).map((category) => (
              <div key={category}>
                <label className="block text-sm font-medium text-slate-400 mb-1 pl-1">{category}</label>
                <input 
                  type="text" 
                  value={localAnswers[category] || ''} 
                  onChange={(e) => setLocalAnswers({...localAnswers, [category]: e.target.value})} 
                  placeholder={`${gameState.letter}...`} 
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all text-lg"
                />
              </div>
            ))}
            
            <button 
              onClick={triggerRoundEnd} 
              className="w-full mt-6 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-400 hover:to-emerald-500 text-white font-bold py-4 px-4 rounded-xl transition-all active:scale-95 shadow-lg shadow-green-900/20"
            >
              Fertig! (Beendet Runde für alle)
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Grace period to sync all answers to the server
  if (gameState.phase === 'SUBMITTING') {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-4">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-purple-500 mb-6"></div>
        <h2 className="text-3xl font-bold text-slate-200 mb-2">Runde beendet!</h2>
        <p className="text-slate-400 text-center">Eingaben werden synchronisiert...<br/>Bitte warten.</p>
      </div>
    );
  }

  // Review & Voting Phase
  if (gameState.phase === 'REVIEW') {
    const { roundScores, detailedScores } = calculateDynamicScores();
    const threshold = Math.floor(players.length / 2) + 1;
    const isLastRound = gameState.currentRound >= gameState.maxRounds;

    const baseScores = gameState.gameScores || {};
    const displayScores = {};
    players.forEach(p => { displayScores[p.id] = (baseScores[p.id] || 0) + (roundScores[p.id] || 0); });
    
    // Function to calculate exact ranks with ties
    const getRankedPlayers = (scores) => {
      const sorted = [...players].sort((a, b) => (scores[b.id] || 0) - (scores[a.id] || 0));
      let currentRank = 1;
      return sorted.map((p, i) => {
        if (i > 0 && (scores[p.id] || 0) < (scores[sorted[i - 1].id] || 0)) {
          currentRank = i + 1;
        }
        return { ...p, rank: currentRank, roundScore: scores[p.id] || 0 };
      });
    };
    
    const rankedPlayers = getRankedPlayers(displayScores);

    // Host Action: Go to final results instead of directly to lobby
    const showFinalResults = async () => {
      const finalGameScores = { ...(gameState.gameScores || {}) };
      players.forEach(p => { 
        finalGameScores[p.id] = (finalGameScores[p.id] || 0) + (roundScores[p.id] || 0); 
      });

      await updateDoc(doc(db, 'lobbies', lobbyCode), {
        'gameState.phase': 'FINAL_RESULTS',
        'gameState.gameScores': finalGameScores
      });
    };

    return (
      <div className="min-h-screen bg-slate-900 text-white p-4 sm:p-8 relative">
         <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} absolute={false} maxWidthClass="max-w-5xl" />
         <div className="max-w-5xl mx-auto">
            <div className="text-center mb-10">
              <h2 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-orange-500 mb-2">Runden-Ergebnisse</h2>
              <p className="text-slate-400">Runde {gameState.currentRound} von {gameState.maxRounds} — <b>Abstimmungs-Phase</b> ({threshold} Votes für Mehrheit benötigt)</p>
            </div>

            <div className={`grid grid-cols-1 ${!isLastRound ? 'lg:grid-cols-3' : ''} gap-8`}>
              <div className={`${!isLastRound ? 'lg:col-span-2' : 'w-full'} bg-slate-800 rounded-3xl p-6 border border-slate-700 h-fit`}>
                <h3 className="text-xl font-bold mb-6 border-b border-slate-700 pb-2">Eingereichte Antworten & Voting</h3>
                
                <div className="space-y-8">
                  {(gameState.categories || []).map(cat => (
                    <div key={cat} className="bg-slate-900/50 p-5 rounded-2xl border border-slate-700/50 shadow-md">
                      <h4 className="text-xl font-bold text-purple-300 mb-4 pb-2 border-b border-slate-700/50 flex items-center gap-2">
                        <span className="bg-purple-500/20 text-purple-400 px-3 py-1 rounded-lg">{cat}</span>
                      </h4>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                        {players.map(p => {
                          const pId = p.id;
                          const ans = gameState.answers?.[pId] || {};
                          const word = ans[cat]?.trim();
                          const detailPts = detailedScores[pId]?.[cat] || 0;
                          
                          const votes = gameState.votes?.[pId]?.[cat] || { reject: [], duplicate: [] };
                          const isRejected = votes.reject.length >= threshold;
                          const isDuplicate = votes.duplicate.length >= threshold;
                          const myReject = votes.reject.includes(user.uid);
                          const myDupe = votes.duplicate.includes(user.uid);

                          return (
                            <div key={pId} className="bg-slate-800/80 p-3 rounded-xl border border-slate-700/50 flex flex-col gap-2 relative">
                              <div className="flex justify-between items-center mb-1">
                                 <span className="text-xs font-medium text-slate-400">{p.name} {pId === user.uid && '(Du)'}</span>
                                 {word && <span className={`text-[11px] font-bold shrink-0 px-2 py-0.5 rounded ${detailPts > 0 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>{detailPts > 0 ? `+${detailPts}` : '0'}</span>}
                              </div>
                              
                              <div className="flex justify-between items-start gap-2 min-h-[1.5rem]">
                                <span className={`break-words block font-medium text-lg ${isRejected ? 'line-through text-slate-600' : isDuplicate ? 'text-orange-300' : 'text-slate-200'}`} title={word || '-'}>{word || '-'}</span>
                              </div>
                              
                              {word && (
                                <div className="flex gap-2 mt-2 border-t border-slate-700/50 pt-2">
                                  <button onClick={() => toggleVote(pId, cat, 'reject')} className={`flex-1 flex justify-center items-center gap-1.5 px-2 py-1.5 rounded text-xs transition-colors ${myReject ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-slate-700/50 text-slate-400 hover:bg-slate-600 border border-transparent'}`} title={`${threshold} Votes nötig`}>
                                    <ThumbsDown size={14} /> {votes.reject.length > 0 && `${votes.reject.length}/${threshold}`}
                                  </button>
                                  <button onClick={() => toggleVote(pId, cat, 'duplicate')} className={`flex-1 flex justify-center items-center gap-1.5 px-2 py-1.5 rounded text-xs transition-colors ${myDupe ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' : 'bg-slate-700/50 text-slate-400 hover:bg-slate-600 border border-transparent'}`} title={`${threshold} Votes für Dopplung`}>
                                    <Files size={14} /> {votes.duplicate.length > 0 && `${votes.duplicate.length}/${threshold}`}
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Hide Live Ranking on the very last round to keep tension */}
              {!isLastRound && (
                <div className="lg:col-span-1 bg-slate-800 rounded-3xl p-6 border border-slate-700 h-fit">
                  <h3 className="text-xl font-bold mb-4 border-b border-slate-700 pb-2 flex items-center gap-2"><Trophy className="text-yellow-500" /> Live-Ranking</h3>
                  <div className="space-y-2">
                    {rankedPlayers.map((p) => (
                      <div key={p.id} className={`flex justify-between items-center p-3 rounded-lg transition-all ${p.rank === 1 ? 'bg-yellow-500/10 border border-yellow-500/30 text-yellow-300' : 'bg-slate-900/50 text-slate-200'}`}>
                        <div className="flex items-center gap-3"><span className="font-bold opacity-50">#{p.rank}</span><span className="font-medium">{p.name} {p.id === user.uid && '(Du)'}</span></div>
                        <span className="font-mono font-bold text-lg">{p.roundScore} Pkt</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {isHost && (
              <div className="mt-10 flex flex-col sm:flex-row justify-center gap-4">
                <button onClick={() => updateLobbyStatus('LOBBY_WAITING', null, { gameState: {} })} className="bg-slate-700 hover:bg-slate-600 text-white px-6 py-3 rounded-xl font-medium transition-colors">Spiel abbrechen</button>
                {isLastRound ? (
                  <button onClick={showFinalResults} className="bg-green-600 hover:bg-green-500 text-white px-8 py-3 rounded-xl font-bold shadow-lg transition-all active:scale-95 text-lg">Zu den Endergebnissen</button>
                ) : (
                  <button onClick={nextRound} className="bg-purple-600 hover:bg-purple-500 text-white px-6 py-3 rounded-xl font-bold shadow-lg transition-all active:scale-95">Nächste Runde ({gameState.currentRound + 1}/{gameState.maxRounds})</button>
                )}
              </div>
            )}
            {!isHost && <p className="mt-10 text-center text-slate-500">Warte auf Host für die nächste Aktion...</p>}
         </div>
      </div>
    );
  }

  // FINAL RESULTS (Podium) Phase
  if (gameState.phase === 'FINAL_RESULTS') {
    const finalScores = gameState.gameScores || {};
    
    // Compute exact rankings with ties
    const getFinalRankings = (scores) => {
      const sorted = [...players].sort((a, b) => (scores[b.id] || 0) - (scores[a.id] || 0));
      let currentRank = 1;
      return sorted.map((p, i) => {
        if (i > 0 && (scores[p.id] || 0) < (scores[sorted[i - 1].id] || 0)) {
          currentRank = i + 1;
        }
        return { ...p, rank: currentRank, finalScore: scores[p.id] || 0 };
      });
    };
    
    const finalRankedPlayers = getFinalRankings(finalScores);

    const distributePointsAndReturnToLobby = async () => {
      if (lobby.settings.globalLeaderboard) {
        let newPlayers = [...players].map(p => {
          const r = finalRankedPlayers.find(rp => rp.id === p.id);
          let addedPoints = 0;
          if (r) {
            if (r.rank === 1) addedPoints = 5;
            else if (r.rank === 2) addedPoints = 3;
            else if (r.rank === 3) addedPoints = 1;
          }
          return { ...p, globalScore: p.globalScore + addedPoints };
        });
        await updateLobbyStatus('LOBBY_WAITING', null, { players: newPlayers, gameState: {} });
      } else {
        await updateLobbyStatus('LOBBY_WAITING', null, { gameState: {} });
      }
    };

    return (
      <div className="min-h-screen bg-slate-900 text-white p-4 sm:p-8 relative">
         <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} absolute={false} maxWidthClass="max-w-3xl" />
         <div className="max-w-3xl mx-auto flex flex-col items-center">
            <div className="text-center mb-10 mt-6">
              <h2 className="text-5xl sm:text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-orange-500 mb-4 tracking-wider uppercase drop-shadow-md">Endergebnisse</h2>
              <p className="text-slate-400 text-lg">Das Spiel ist vorbei! Hier ist die finale Platzierung.</p>
            </div>

            <div className="w-full bg-slate-800 rounded-3xl p-6 sm:p-10 border border-slate-700 shadow-2xl mb-10 space-y-4">
              {finalRankedPlayers.map((p) => {
                let rowBg = 'bg-slate-900/50 text-slate-400 border-slate-700/50';
                if (p.rank === 1) rowBg = 'bg-yellow-500/20 border-yellow-500/50 text-yellow-300 shadow-[0_0_15px_rgba(234,179,8,0.2)]';
                else if (p.rank === 2) rowBg = 'bg-slate-300/20 border-slate-300/50 text-slate-200';
                else if (p.rank === 3) rowBg = 'bg-orange-600/20 border-orange-600/50 text-orange-300';

                return (
                  <div key={p.id} className={`flex justify-between items-center p-5 rounded-2xl border transition-all ${rowBg}`}>
                    <div className="flex items-center gap-4">
                      <span className="text-3xl font-black opacity-80 w-10">#{p.rank}</span>
                      <span className="text-xl font-bold">{p.name} {p.id === user.uid && '(Du)'}</span>
                    </div>
                    <span className="text-2xl font-mono font-black">{p.finalScore} <span className="text-sm font-medium opacity-70">Pkt</span></span>
                  </div>
                );
              })}
            </div>

            {isHost ? (
              <button onClick={distributePointsAndReturnToLobby} className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white px-10 py-4 rounded-2xl font-bold text-xl shadow-xl transition-all active:scale-95">
                Punkte verteilen & Zurück zur Lobby
              </button>
            ) : (
              <p className="text-slate-500 italic text-lg">Warte auf Host für die Rückkehr zur Lobby...</p>
            )}
         </div>
      </div>
    );
  }

  return null;
}