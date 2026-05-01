import React, { useState, useEffect, useRef } from 'react';
import {
  signInAnonymously,
  onAuthStateChanged,
  EmailAuthProvider,
  linkWithCredential,
  signInWithEmailAndPassword,
  signOut
} from 'firebase/auth';
import { doc, setDoc, getDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import { Users, Play, Trophy, Copy, Check, LogOut, Settings, AlertCircle, ArrowRight, Shield, Loader2, UserCircle, UserPlus, LogIn, Camera, X, Crown, UserMinus } from 'lucide-react';

import { auth, db } from './utils/firebase';
import { generateLobbyCode } from './utils/helpers';

import GameHeader from './components/GameHeader';
import CodenamesEngine from './games/CodenamesEngine';
import StadtLandFlussEngine from './games/StadtLandFlussEngine';
import WerwolfEngine from './games/WerwolfEngine';
import WerBinIchEngine from './games/WerBinIchEngine';

// ==========================================
// VERSIONSNUMMER - ÄNDERE DIESE ZAHL BEI JEDEM UPDATE!
// ==========================================
const APP_VERSION = "v1.0.5";

// ==========================================
// 1. CUSTOM HOOK: useAuth (Backend/Auth Logik)
// ==========================================
function useAuth() {
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authActionLoading, setAuthActionLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);

      if (currentUser) {
        const userRef = doc(db, 'users', currentUser.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
          setUserData(userSnap.data());
        } else {
          const newProfile = {
            name: 'Player',
            username: '',
            role: 'user',
            currentLobby: null,
            photoURL: '/default-avatar.png'
          };
          await setDoc(userRef, newProfile);
          setUserData(newProfile);
        }
      } else {
        setUserData(null);
        signInAnonymously(auth).catch(err => console.error("Anonymous Auth Failed:", err));
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const formatUsernameToEmail = (username) => {
    return `${username.toLowerCase().trim().replace(/\s+/g, '')}@partybox.local`;
  };

  const registerWithUsername = async (username, password) => {
    setAuthActionLoading(true);
    setError(null);
    try {
      if (user && user.isAnonymous) {
        const fakeEmail = formatUsernameToEmail(username);
        const credential = EmailAuthProvider.credential(fakeEmail, password);
        await linkWithCredential(user, credential);

        const updates = { username: username.trim() };
        if (!userData?.name || userData.name === 'Player') {
          updates.name = username.trim();
        }

        await updateDoc(doc(db, 'users', user.uid), updates);
        setUserData(prev => ({ ...prev, ...updates }));
      }
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') {
        setError('Dieser Benutzername ist schon vergeben.');
      } else if (err.code === 'auth/weak-password') {
        setError('Passwort ist zu schwach (min. 6 Zeichen).');
      } else {
        setError('Fehler bei der Registrierung: ' + err.message);
      }
    } finally {
      setAuthActionLoading(false);
    }
  };

  const loginWithUsername = async (username, password) => {
    setAuthActionLoading(true);
    setError(null);
    try {
      const fakeEmail = formatUsernameToEmail(username);
      await signInWithEmailAndPassword(auth, fakeEmail, password);
    } catch (err) {
      setError('Benutzername oder Passwort falsch.');
    } finally {
      setAuthActionLoading(false);
    }
  };

  const updateUserProfile = async (newNickname, newPhotoURL) => {
    if (!user) return;
    try {
      const updates = {};
      if (newNickname) updates.name = newNickname.trim();
      if (newPhotoURL) updates.photoURL = newPhotoURL;

      await updateDoc(doc(db, 'users', user.uid), updates);

      const updatedUserData = { ...userData, ...updates };
      setUserData(updatedUserData);

      if (updatedUserData.currentLobby) {
        const lobbyRef = doc(db, 'lobbies', updatedUserData.currentLobby);
        const lobbySnap = await getDoc(lobbyRef);
        if (lobbySnap.exists()) {
          const lobbyData = lobbySnap.data();
          const updatedPlayers = lobbyData.players.map(p => {
            if (p.id === user.uid) {
              return { ...p, ...updates };
            }
            return p;
          });
          await updateDoc(lobbyRef, { players: updatedPlayers });
        }
      }
    } catch (err) {
      console.error("Fehler beim Profil-Update:", err);
    }
  };

  const logOutUser = async () => {
    setAuthActionLoading(true);
    await signOut(auth);
    setAuthActionLoading(false);
  };

  return { user, userData, loading, authActionLoading, error, registerWithUsername, loginWithUsername, logOutUser, updateUserProfile, setError };
}

// ==========================================
// 2. COMPONENT: Profile Modal (UI)
// ==========================================
function ProfileModal({ authLogic, onClose }) {
  const { userData, updateUserProfile, logOutUser } = authLogic;
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef(null);

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        const MAX_SIZE = 256;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; }
        } else {
          if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.8);
        setIsSaving(true);
        await updateUserProfile(null, compressedBase64);
        setIsSaving(false);
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
        <div className="bg-slate-800 p-8 rounded-3xl w-full max-w-xs border border-slate-700 shadow-2xl relative animate-in zoom-in-95 duration-200">
          <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors">
            <X size={24} />
          </button>

          <h2 className="text-2xl font-bold text-white mb-6 text-center">Dein Profil</h2>

          <div className="flex flex-col items-center mb-8">
            <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
              <img
                  src={userData?.photoURL || '/default-avatar.png'}
                  alt="Profile"
                  className="w-32 h-32 rounded-full object-cover border-4 border-slate-700 group-hover:border-indigo-500 transition-colors"
              />
              <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera size={28} className="text-white" />
              </div>
              {isSaving && <div className="absolute inset-0 bg-slate-900/50 rounded-full flex items-center justify-center"><Loader2 className="animate-spin text-white" /></div>}
            </div>
            <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />
            <p className="text-xs text-slate-500 mt-3 font-medium">Klicken, um Bild zu ändern</p>
          </div>

          <div className="flex flex-col gap-3">
            <button
                onClick={() => { onClose(); logOutUser(); }}
                className="w-full bg-red-900/30 hover:bg-red-900/50 text-red-400 font-bold py-3 rounded-xl border border-red-900/50 transition-all flex items-center justify-center gap-2"
            >
              <LogOut size={18} /> Abmelden
            </button>
          </div>
        </div>
      </div>
  );
}

// ==========================================
// 3. COMPONENT: AuthMenu (UI Top Right)
// ==========================================
function AuthMenu({ authLogic, onOpenProfile }) {
  const { user, userData, authActionLoading, error, registerWithUsername, loginWithUsername, setError } = authLogic;

  const [view, setView] = useState(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => { setError(null); setUsername(''); setPassword(''); }, [view, setError]);

  if (!user) return null;

  return (
      <div className="absolute top-4 right-4 z-50 flex flex-col items-end gap-2">
        <div className="flex items-center gap-2 bg-slate-800/80 backdrop-blur-md px-2 py-1.5 rounded-2xl border border-slate-700 shadow-xl">
          {userData?.role && userData.role !== 'user' && (
              <span className="flex items-center gap-1 text-xs font-bold text-amber-400 bg-amber-400/10 px-2 py-1 rounded-lg ml-2">
            <Shield size={14} /> {userData.role.toUpperCase()}
          </span>
          )}

          {user.isAnonymous ? (
              <>
                <button
                    onClick={() => setView(view === 'login' ? null : 'login')}
                    className={`flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-lg transition-all ${view === 'login' ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-700 hover:text-white'}`}
                >
                  <LogIn size={16} /> <span className="hidden sm:inline">Anmelden</span>
                </button>
                <div className="w-px h-5 bg-slate-600 mx-1"></div>
                <button
                    onClick={() => setView(view === 'register' ? null : 'register')}
                    className={`flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-lg transition-all ${view === 'register' ? 'bg-green-600 text-white' : 'text-slate-300 hover:bg-slate-700 hover:text-white'}`}
                >
                  <UserPlus size={16} /> <span className="hidden sm:inline">Registrieren</span>
                </button>
              </>
          ) : (
              <button
                  onClick={onOpenProfile}
                  className="flex items-center gap-3 hover:bg-slate-700/50 pr-4 pl-1 py-1 rounded-xl transition-colors"
              >
                <img
                    src={userData?.photoURL || '/default-avatar.png'}
                    alt="Avatar"
                    className="w-8 h-8 rounded-full object-cover border border-slate-600"
                />
                <span className="text-sm font-bold text-white">
              {userData?.name || 'Lade...'}
            </span>
              </button>
          )}
        </div>

        {view && user.isAnonymous && (
            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 shadow-2xl flex flex-col gap-3 w-64 animate-in slide-in-from-top-2">
              <h3 className="text-sm font-bold text-slate-300 mb-1 border-b border-slate-700 pb-2">
                {view === 'login' ? 'Willkommen zurück!' : 'Account erstellen'}
              </h3>
              <input
                  type="text"
                  placeholder="Benutzername"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
              <input
                  type="password"
                  placeholder="Passwort (min. 6 Zeichen)"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              />

              <button
                  onClick={() => view === 'login' ? loginWithUsername(username, password) : registerWithUsername(username, password)}
                  disabled={authActionLoading || !username || password.length < 6}
                  className={`w-full font-bold py-2 rounded-lg text-sm transition-colors flex justify-center mt-2 ${view === 'login' ? 'bg-indigo-600 hover:bg-indigo-500 text-white disabled:bg-slate-700' : 'bg-green-600 hover:bg-green-500 text-white disabled:bg-slate-700'}`}
              >
                {authActionLoading ? <Loader2 size={16} className="animate-spin" /> : (view === 'login' ? 'Jetzt anmelden' : 'Konto erstellen')}
              </button>

              {error && <p className="text-xs text-red-400 mt-1 text-center">{error}</p>}
            </div>
        )}
      </div>
  );
}

// ==========================================
// 4. MAIN COMPONENT: App Router
// ==========================================
export default function App() {
  const authLogic = useAuth();
  const { user, userData, loading: authLoading } = authLogic;

  const [lobbyCode, setLobbyCode] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [currentLobby, setCurrentLobby] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);

  const isHost = currentLobby?.hostId === user?.uid;

  // AUTO-SYNC: Host sichert im Hintergrund die Punkte aller Spieler ab!
  useEffect(() => {
    if (isHost && currentLobby?.players && lobbyCode) {
      const currentHistory = currentLobby.scoreHistory || {};
      let changed = false;
      const newHistory = { ...currentHistory };

      currentLobby.players.forEach(p => {
        if (p.globalScore > (newHistory[p.id] || 0)) {
          newHistory[p.id] = p.globalScore;
          changed = true;
        }
      });

      if (changed) {
        updateDoc(doc(db, 'lobbies', lobbyCode), { scoreHistory: newHistory }).catch(()=>{});
      }
    }
  }, [currentLobby?.players, isHost, lobbyCode]);

  useEffect(() => {
    if (userData?.name) {
      setPlayerName(userData.name);
    }
  }, [userData?.name]);

  // Wenn man die Seite neu lädt, prüft die App, ob man noch Teil der aktuellen Lobby ist
  useEffect(() => {
    if (user && userData?.currentLobby) {
      const lobbyRef = doc(db, 'lobbies', userData.currentLobby);
      getDoc(lobbyRef).then(lobbySnap => {
        if (lobbySnap.exists() && lobbySnap.data().players.some(p => p.id === user.uid)) {
          setPlayerName(userData.name || '');
          setLobbyCode(userData.currentLobby);
        } else {
          // Falls wir rausgeworfen wurden, setzen wir die Lobby zurück
          updateDoc(doc(db, 'users', user.uid), { currentLobby: null }).catch(()=>{});
        }
      });
    }
  }, [user, userData?.currentLobby]);

  // Real-Time Listener für die Lobby
  useEffect(() => {
    if (!user || !lobbyCode) return;
    const lobbyRef = doc(db, 'lobbies', lobbyCode);
    const unsubscribe = onSnapshot(lobbyRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        // Check, ob wir vom Host rausgeworfen wurden
        if (!data.players.some(p => p.id === user.uid)) {
          setCurrentLobby(null);
          setLobbyCode('');
          setErrorMsg('Du wurdest aus der Lobby entfernt.');
          updateDoc(doc(db, 'users', user.uid), { currentLobby: null }).catch(() => {});
        } else {
          setCurrentLobby(data);
        }
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

  const handleCreateLobby = async (e) => {
    e.preventDefault();
    if (!user || !playerName.trim()) return setErrorMsg('Bitte gib einen Nickname ein.');

    if (playerName.trim() !== userData?.name) {
      authLogic.updateUserProfile(playerName.trim(), null);
    }

    const newCode = generateLobbyCode();
    const lobbyRef = doc(db, 'lobbies', newCode);

    const initialLobbyData = {
      id: newCode,
      hostId: user.uid,
      status: 'LOBBY_WAITING',
      currentGame: null,
      settings: { globalLeaderboard: true },
      scoreHistory: { [user.uid]: 0 }, // Punkte-Backup
      players: [{
        id: user.uid,
        name: playerName.trim(),
        isHost: true,
        globalScore: 0,
        photoURL: userData?.photoURL || '/default-avatar.png'
      }],
      gameState: {}
    };

    try {
      await setDoc(lobbyRef, initialLobbyData);
      await setDoc(doc(db, 'users', user.uid), { currentLobby: newCode, name: playerName.trim() }, { merge: true });
      setLobbyCode(newCode);
      setErrorMsg('');
    } catch (err) {
      console.error("Fehler beim Erstellen:", err);
      setErrorMsg('Fehler beim Erstellen der Lobby.');
    }
  };

  const handleJoinLobby = async (e, joinCode) => {
    e.preventDefault();
    if (!user || !playerName.trim() || !joinCode.trim()) return setErrorMsg('Bitte fülle alle Felder aus.');

    if (playerName.trim() !== userData?.name) {
      authLogic.updateUserProfile(playerName.trim(), null);
    }

    const code = joinCode.toUpperCase().trim();
    const lobbyRef = doc(db, 'lobbies', code);

    try {
      const snap = await getDoc(lobbyRef);
      if (!snap.exists()) return setErrorMsg('Lobby nicht gefunden.');

      const data = snap.data();
      const existingPlayerIndex = data.players.findIndex(p => p.id === user.uid);

      // RE-JOIN LOGIK: Wenn der Spieler schon drin ist (z.B. Tab geschlossen)
      if (existingPlayerIndex !== -1) {
        const updatedPlayers = [...data.players];
        updatedPlayers[existingPlayerIndex].name = playerName.trim();
        updatedPlayers[existingPlayerIndex].photoURL = userData?.photoURL || '/default-avatar.png';
        await updateDoc(lobbyRef, { players: updatedPlayers });
      } else {
        // GANZ NEUER SPIELER:
        if (data.players.find(p => p.name.toLowerCase() === playerName.trim().toLowerCase())) {
          return setErrorMsg('Dieser Name ist bereits in der Lobby vergeben.');
        }
        if (data.status !== 'LOBBY_WAITING') return setErrorMsg('Spiel läuft bereits.');

        // Hole Punkte aus dem Backup, falls er vorher schon mal in dieser Lobby war!
        const pastScore = data.scoreHistory?.[user.uid] || 0;

        const updatedPlayers = [...data.players, {
          id: user.uid,
          name: playerName.trim(),
          isHost: false,
          globalScore: pastScore, // Alter Score wird wiederhergestellt
          photoURL: userData?.photoURL || '/default-avatar.png'
        }];

        await updateDoc(lobbyRef, { players: updatedPlayers });
      }

      await setDoc(doc(db, 'users', user.uid), { currentLobby: code, name: playerName.trim() }, { merge: true });
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
          const updatedPlayers = remainingPlayers.map(p => p.id === newHostId ? { ...p, isHost: true } : p);
          await updateDoc(lobbyRef, { hostId: newHostId, players: updatedPlayers });
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

  // HOST FUNKTION: Spieler Rauswerfen
  const kickPlayer = async (targetId) => {
    if (!isHost) return;
    if (window.confirm('Möchtest du diesen Spieler wirklich rauswerfen?')) {
      const remainingPlayers = currentLobby.players.filter(p => p.id !== targetId);
      await updateDoc(doc(db, 'lobbies', lobbyCode), { players: remainingPlayers });
    }
  };

  // HOST FUNKTION: Partyleiter übergeben
  const promotePlayer = async (targetId) => {
    if (!isHost) return;
    if (window.confirm('Möchtest du diesen Spieler zum neuen Partyleiter ernennen?')) {
      const updatedPlayers = currentLobby.players.map(p => ({
        ...p,
        isHost: p.id === targetId
      }));
      await updateDoc(doc(db, 'lobbies', lobbyCode), {
        hostId: targetId,
        players: updatedPlayers
      });
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
    await updateDoc(lobbyRef, { status, ...(game && { currentGame: game }), ...additionalData });
  };

  if (authLoading) return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400 animate-pulse">Lade Sitzung...</div>;
  if (!user) return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">Lade Authentifizierung...</div>;

  const renderContent = () => {
    // View 1: Welcome (Hauptmenü)
    if (!currentLobby) {
      return (
          <div className="min-h-screen bg-slate-900 text-slate-100 font-sans p-6 flex flex-col items-center justify-center relative">
            <AuthMenu authLogic={authLogic} onOpenProfile={() => setShowProfileModal(true)} />

            <div className="max-w-md w-full bg-slate-800 rounded-3xl p-8 shadow-2xl border border-slate-700 mt-20 sm:mt-16">
              <div className="text-center mb-8">
                <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-500 mb-2">Party Box</h1>
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
                      type="text" value={playerName} onChange={(e) => setPlayerName(e.target.value)} placeholder="z.B. PlayerOne"
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

                  <form onSubmit={(e) => { const code = e.target.elements.code.value; handleJoinLobby(e, code); }} className="flex gap-2">
                    <input name="code" type="text" placeholder="Lobby Code (z.B. AB12)" maxLength={4} className="w-2/3 uppercase bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-pink-500 transition-all" />
                    <button type="submit" className="w-1/3 bg-slate-700 hover:bg-slate-600 text-white font-bold py-3 px-4 rounded-xl flex items-center justify-center transition-all active:scale-95">Beitreten</button>
                  </form>
                </div>
              </div>
            </div>
          </div>
      );
    }

    // View 2: Lobby Waiting
    if (currentLobby.status === 'LOBBY_WAITING') {
      return (
          <div className="min-h-screen bg-slate-900 text-slate-100 p-4 sm:p-8 relative">
            <AuthMenu authLogic={authLogic} onOpenProfile={() => setShowProfileModal(true)} />

            <div className="max-w-4xl mx-auto mt-20 sm:mt-16">
              <div className="flex justify-between items-center mb-8 bg-slate-800 p-4 rounded-2xl border border-slate-700">
                <div>
                  <p className="text-slate-400 text-sm font-medium">Lobby Code</p>
                  <div className="flex items-center gap-3">
                    <h2 className="text-3xl font-mono font-bold tracking-widest text-purple-400">{currentLobby.id}</h2>
                    <button onClick={copyToClipboard} className="p-2 hover:bg-slate-700 rounded-lg transition-colors text-slate-300" title="Code kopieren">
                      {copied ? <Check size={20} className="text-green-400" /> : <Copy size={20} />}
                    </button>
                  </div>
                </div>
                <button onClick={() => { if(window.confirm('Willst du die Lobby wirklich verlassen?')) leaveLobby(); }} className="text-red-400 hover:text-red-300 flex items-center gap-2 text-sm font-medium bg-red-400/10 px-4 py-2 rounded-lg transition-colors">
                  <LogOut size={16} /> Verlassen
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-1 bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-xl font-bold flex items-center gap-2"><Users className="text-indigo-400" /> Spieler ({currentLobby.players.length})</h3>
                  </div>
                  <div className="space-y-3">
                    {currentLobby.players.map((p) => {
                      const safeName = p.name || 'Player';
                      return (
                          <div key={p.id} className={`p-3 sm:p-4 rounded-xl flex items-center justify-between gap-2 sm:gap-4 ${p.id === user.uid ? 'bg-indigo-600/20 border border-indigo-500/30' : 'bg-slate-900/50'}`}>

                            {/* LINKE SEITE: Avatar & Name (Darf schrumpfen, schneidet lange Namen ab) */}
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              {p.photoURL && p.photoURL !== '/default-avatar.png' ? (
                                  <img src={p.photoURL} alt={safeName} className="w-9 h-9 rounded-full object-cover border border-slate-600 shrink-0 shadow-sm" />
                              ) : (
                                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center font-bold text-sm shrink-0 shadow-sm text-white">
                                    {safeName.charAt(0).toUpperCase()}
                                  </div>
                              )}
                              <div className="truncate flex items-baseline gap-1.5">
                                <span className="font-bold text-slate-200 truncate">{safeName}</span>
                                {p.id === user.uid && <span className="text-xs font-medium text-slate-400 whitespace-nowrap">(Du)</span>}
                              </div>
                            </div>

                            {/* RECHTE SEITE: Punkte, Host & Controls (Darf NIEMALS schrumpfen oder umbrechen) */}
                            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                              {currentLobby.settings.globalLeaderboard && (
                                  <span className="text-xs sm:text-sm font-bold text-yellow-400 bg-yellow-500/10 px-2.5 py-1 rounded-lg whitespace-nowrap border border-yellow-500/20">
                              {p.globalScore} Pkt
                            </span>
                              )}
                              {p.isHost && <Trophy size={18} className="text-yellow-500 shrink-0 drop-shadow-md" title="Host" />}

                              {/* Host Controls: Kicken & Leiter abgeben */}
                              {isHost && p.id !== user.uid && (
                                  <div className="flex items-center gap-0.5 ml-1 sm:ml-2 border-l border-slate-700 pl-1.5 sm:pl-2 shrink-0">
                                    <button onClick={() => promotePlayer(p.id)} className="p-1.5 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-yellow-400 transition-colors" title="Zum Partyleiter ernennen">
                                      <Crown size={18} />
                                    </button>
                                    <button onClick={() => kickPlayer(p.id)} className="p-1.5 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-red-400 transition-colors" title="Spieler rauswerfen">
                                      <UserMinus size={18} />
                                    </button>
                                  </div>
                              )}
                            </div>

                          </div>
                      )
                    })}
                  </div>
                </div>

                <div className="lg:col-span-2 space-y-6">
                  <div className="bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                      <h3 className="text-xl font-bold flex items-center gap-2"><Play className="text-pink-400" /> Spielekatalog</h3>
                      {isHost ? (
                          <button
                              onClick={() => updateLobbyStatus(currentLobby.status, null, { settings: { ...currentLobby.settings, globalLeaderboard: !currentLobby.settings.globalLeaderboard } })}
                              className={`flex w-full sm:w-auto items-center justify-center gap-2 text-sm px-3 py-2 rounded-lg border transition-colors ${currentLobby.settings.globalLeaderboard ? 'text-green-400 border-green-500/30 bg-green-500/10 hover:bg-green-500/20' : 'text-slate-400 border-slate-700 bg-slate-900 hover:bg-slate-800'}`}
                          >
                            <Settings size={14} /> <span>Globales Scoring {currentLobby.settings.globalLeaderboard ? 'an' : 'aus'}</span>
                          </button>
                      ) : (
                          <div className={`flex w-full sm:w-auto items-center justify-center gap-2 text-sm px-3 py-2 rounded-lg border ${currentLobby.settings.globalLeaderboard ? 'text-green-400 border-green-500/30 bg-green-500/10' : 'text-slate-400 border-slate-700 bg-slate-900'}`}>
                            <Trophy size={14} /> <span>Globales Scoring {currentLobby.settings.globalLeaderboard ? 'an' : 'aus'}</span>
                          </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className={`p-5 rounded-2xl border-2 transition-all ${isHost ? 'cursor-pointer hover:border-purple-500 border-slate-700 bg-slate-900/50 hover:bg-slate-900' : 'border-slate-700 bg-slate-900/30 opacity-70'}`}
                           onClick={() => isHost && updateLobbyStatus('GAME_IN_PROGRESS', 'STADT_LAND_FLUSS', { gameState: { phase: 'SETUP', letter: '', answers: {}, readyPlayers: [], gameScores: {} } })}>
                        <h4 className="font-bold text-lg text-purple-300 mb-1">Stadt Land Fluss</h4>
                        <p className="text-sm text-slate-400 mb-4">Der Klassiker. Teste dein Wissen unter Zeitdruck!</p>
                        {isHost ? <span className="text-xs font-bold text-purple-400 uppercase flex items-center gap-1">Starten <ArrowRight size={14} /></span> : <span className="text-xs text-slate-500">Warten auf Host...</span>}
                      </div>

                      <div className={`p-5 rounded-2xl border-2 transition-all ${isHost ? 'cursor-pointer hover:border-red-500 border-slate-700 bg-slate-900/50 hover:bg-slate-900' : 'border-slate-700 bg-slate-900/30 opacity-70'}`}
                           onClick={() => isHost && updateLobbyStatus('GAME_IN_PROGRESS', 'CODENAMES', { gameState: { phase: 'TEAM_SETUP', teams: { red: [], blue: [] }, spymasters: { red: null, blue: null } } })}>
                        <h4 className="font-bold text-lg text-red-400 mb-1">Codenames</h4>
                        <p className="text-sm text-slate-400 mb-4">Top-Secret! Finde alle deine Agenten.</p>
                        {isHost ? <span className="text-xs font-bold text-red-400 uppercase flex items-center gap-1">Starten <ArrowRight size={14} /></span> : <span className="text-xs text-slate-500">Warten auf Host...</span>}
                      </div>

                      <div className={`p-5 rounded-2xl border-2 transition-all ${isHost ? 'cursor-pointer hover:border-indigo-500 border-slate-700 bg-slate-900/50 hover:bg-slate-900' : 'border-slate-700 bg-slate-900/30 opacity-70'}`}
                           onClick={() => isHost && updateLobbyStatus('GAME_IN_PROGRESS', 'WERWOLF', { gameState: { phase: 'SETUP' } })}>
                        <h4 className="font-bold text-lg text-indigo-400 mb-1">Werwolf</h4>
                        <p className="text-sm text-slate-400 mb-4">Das Dorf schläft ein... Finde die Verräter!</p>
                        {isHost ? <span className="text-xs font-bold text-indigo-400 uppercase flex items-center gap-1">Starten <ArrowRight size={14} /></span> : <span className="text-xs text-slate-500">Warten auf Host...</span>}
                      </div>

                      <div className={`p-5 rounded-2xl border-2 transition-all ${isHost ? 'cursor-pointer hover:border-yellow-500 border-slate-700 bg-slate-900/50 hover:bg-slate-900' : 'border-slate-700 bg-slate-900/30 opacity-70'}`}
                           onClick={() => isHost && updateLobbyStatus('GAME_IN_PROGRESS', 'WER_BIN_ICH', { gameState: { phase: 'SETUP' } })}>
                        <h4 className="font-bold text-lg text-yellow-400 mb-1">Wer bin ich?</h4>
                        <p className="text-sm text-slate-400 mb-4">Der Party-Klassiker. Finde heraus, wer du bist!</p>
                        {isHost ? <span className="text-xs font-bold text-yellow-400 uppercase flex items-center gap-1">Starten <ArrowRight size={14} /></span> : <span className="text-xs text-slate-500">Warten auf Host...</span>}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
      );
    }

    // View 3: Dynamic Games
    if (currentLobby.currentGame === 'STADT_LAND_FLUSS') {
      return <StadtLandFlussEngine lobby={currentLobby} user={user} isHost={isHost} db={db} updateLobbyStatus={updateLobbyStatus} leaveLobby={leaveLobby} />;
    }

    if (currentLobby.currentGame === 'CODENAMES') {
      return <CodenamesEngine lobby={currentLobby} user={user} isHost={isHost} db={db} updateLobbyStatus={updateLobbyStatus} leaveLobby={leaveLobby} />;
    }

    if (currentLobby.currentGame === 'WERWOLF') {
      return <WerwolfEngine lobby={currentLobby} user={user} isHost={isHost} db={db} updateLobbyStatus={updateLobbyStatus} leaveLobby={leaveLobby} />;
    }

    if (currentLobby.currentGame === 'WER_BIN_ICH') {
      return <WerBinIchEngine lobby={currentLobby} user={user} isHost={isHost} db={db} updateLobbyStatus={updateLobbyStatus} leaveLobby={leaveLobby} />;
    }

    return <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">Lade Spiel...</div>;
  };

  return (
      <>
        {showProfileModal && <ProfileModal authLogic={authLogic} onClose={() => setShowProfileModal(false)} />}

        {/* Das eigentliche Spiel/Layout */}
        {renderContent()}

        {/* Globale Versionsanzeige unten rechts */}
        <div className="fixed bottom-2 right-2 text-[10px] text-slate-600/50 font-mono z-[60] pointer-events-none">
          {APP_VERSION}
        </div>
      </>
  );
}