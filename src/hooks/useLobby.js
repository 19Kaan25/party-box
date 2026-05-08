import { useState, useEffect } from 'react';
import { doc, setDoc, getDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../utils/firebase';
import { generateLobbyCode } from '../utils/helpers';

export default function useLobby(user, userData, updateUserProfile) {
    const [lobbyCode, setLobbyCode] = useState('');
    const [playerName, setPlayerName] = useState('');
    const [currentLobby, setCurrentLobby] = useState(null);
    const [errorMsg, setErrorMsg] = useState('');

    const isHost = currentLobby?.hostId === user?.uid;

    useEffect(() => {
        if (userData?.name) {
            setPlayerName(userData.name);
        }
    }, [userData?.name]);

    useEffect(() => {
        if (user && userData?.currentLobby) {
            const lobbyRef = doc(db, 'lobbies', userData.currentLobby);
            getDoc(lobbyRef).then(lobbySnap => {
                if (lobbySnap.exists() && lobbySnap.data().players.some(p => p.id === user.uid)) {
                    setPlayerName(userData.name || '');
                    setLobbyCode(userData.currentLobby);
                } else {
                    updateDoc(doc(db, 'users', user.uid), { currentLobby: null }).catch(() => {});
                }
            });
        }
    }, [user, userData?.currentLobby]);

    useEffect(() => {
        if (!user || !lobbyCode) return;
        const lobbyRef = doc(db, 'lobbies', lobbyCode);

        const unsubscribe = onSnapshot(lobbyRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
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
                setErrorMsg('Lobby existiert nicht mehr.');
                updateDoc(doc(db, 'users', user.uid), { currentLobby: null }).catch(() => {});
            }
        }, (error) => {
            console.error("Snapshot error:", error);
            setErrorMsg('Verbindungsfehler zur Lobby.');
        });

        return () => unsubscribe();
    }, [user, lobbyCode]);

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
                updateDoc(doc(db, 'lobbies', lobbyCode), { scoreHistory: newHistory }).catch(() => {});
            }
        }
    }, [currentLobby?.players, isHost, lobbyCode]);

    const handleCreateLobby = async (e) => {
        e.preventDefault();
        if (!user || !playerName.trim()) return setErrorMsg('Bitte gib einen Nickname ein.');

        if (playerName.trim() !== userData?.name) {
            updateUserProfile(playerName.trim(), null);
        }

        const newCode = generateLobbyCode();
        const lobbyRef = doc(db, 'lobbies', newCode);

        const initialLobbyData = {
            id: newCode,
            hostId: user.uid,
            status: 'LOBBY_WAITING',
            currentGame: null,
            settings: { globalLeaderboard: true },
            scoreHistory: { [user.uid]: 0 },
            usedImposterWords: [],
            customImposterWords: [],
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
        const code = joinCode.toUpperCase().trim();

        if (!user || !playerName.trim() || !code) return setErrorMsg('Bitte fülle alle Felder aus.');
        if (playerName.trim() !== userData?.name) {
            updateUserProfile(playerName.trim(), null);
        }

        const lobbyRef = doc(db, 'lobbies', code);

        try {
            const snap = await getDoc(lobbyRef);
            if (!snap.exists()) return setErrorMsg('Lobby nicht gefunden.');

            const data = snap.data();
            const existingPlayerIndex = data.players.findIndex(p => p.id === user.uid);

            if (existingPlayerIndex !== -1) {
                const updatedPlayers = [...data.players];
                updatedPlayers[existingPlayerIndex].name = playerName.trim();
                updatedPlayers[existingPlayerIndex].photoURL = userData?.photoURL || '/default-avatar.png';
                await updateDoc(lobbyRef, { players: updatedPlayers });
            } else {
                if (data.players.find(p => p.name.toLowerCase() === playerName.trim().toLowerCase())) {
                    return setErrorMsg('Dieser Name ist bereits in der Lobby vergeben.');
                }
                if (data.status !== 'LOBBY_WAITING') return setErrorMsg('Spiel läuft bereits.');

                const pastScore = data.scoreHistory?.[user.uid] || 0;

                const updatedPlayers = [...data.players, {
                    id: user.uid,
                    name: playerName.trim(),
                    isHost: false,
                    globalScore: pastScore,
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
        if (!currentLobby || !user) return;

        const lobbyRef = doc(db, 'lobbies', lobbyCode);
        const userRef = doc(db, 'users', user.uid);

        try {
            const remainingPlayers = currentLobby.players.filter(p => p.id !== user.uid);

            if (currentLobby.hostId === user.uid) {
                if (remainingPlayers.length > 0) {
                    const nextHost = remainingPlayers[Math.floor(Math.random() * remainingPlayers.length)];
                    const updatedPlayers = remainingPlayers.map(p => p.id === nextHost.id ? { ...p, isHost: true } : p);
                    await updateDoc(lobbyRef, { hostId: nextHost.id, players: updatedPlayers });
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

    const updateLobbyStatus = async (status, game = null, additionalData = {}) => {
        if (!isHost) return;
        const lobbyRef = doc(db, 'lobbies', lobbyCode);
        await updateDoc(lobbyRef, { status, ...(game && { currentGame: game }), ...additionalData });
    };

    const kickPlayer = async (targetId) => {
        if (!isHost) return;
        if (window.confirm('Möchtest du diesen Spieler wirklich rauswerfen?')) {
            const remainingPlayers = currentLobby.players.filter(p => p.id !== targetId);
            await updateDoc(doc(db, 'lobbies', lobbyCode), { players: remainingPlayers });
        }
    };

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

    return {
        lobbyCode,
        playerName,
        setPlayerName,
        currentLobby,
        errorMsg,
        isHost,
        handleCreateLobby,
        handleJoinLobby,
        leaveLobby,
        updateLobbyStatus,
        kickPlayer,
        promotePlayer
    };
}