import { useState, useEffect } from 'react';
import {
    signInAnonymously,
    onAuthStateChanged,
    EmailAuthProvider,
    linkWithCredential,
    signInWithEmailAndPassword,
    signOut
} from 'firebase/auth';
import { doc, setDoc, getDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../utils/firebase';

export default function useAuth() {
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