import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const AVATAR_BUCKET = 'avatars';

/** Storage-Pfad -> oeffentliche URL. Ohne Pfad null, damit die Komponenten
 *  ihren Initialen-Fallback zeigen (statt des nie existierenden
 *  /default-avatar.png, das bisher einen 404 pro Nutzer erzeugt hat). */
export function avatarUrl(path, updatedAt) {
    if (!path) return null;
    const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
    if (!data?.publicUrl) return null;
    // Der Pfad bleibt beim Neu-Upload gleich -> Cache-Buster noetig.
    const v = updatedAt ? new Date(updatedAt).getTime() : '';
    return v ? `${data.publicUrl}?v=${v}` : data.publicUrl;
}

export default function useAuth() {
    const [user, setUser] = useState(null);
    const [userData, setUserData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [authActionLoading, setAuthActionLoading] = useState(false);
    const [error, setError] = useState(null);
    // Wird true, wenn der Nutzer ueber einen Passwort-Reset-Link kommt.
    const [recoveryMode, setRecoveryMode] = useState(false);

    const loadProfile = useCallback(async (uid) => {
        const { data, error: err } = await supabase
            .from('profiles')
            .select('id, display_name, username, avatar_path, updated_at')
            .eq('id', uid)
            .maybeSingle();

        if (err) {
            console.error('Profil konnte nicht geladen werden:', err);
            return null;
        }
        if (!data) return null;

        // Alte Feldnamen beibehalten, damit AuthMenu/ProfileModal/Engines
        // unveraendert bleiben.
        const mapped = {
            id: data.id,
            name: data.display_name,
            username: data.username,
            avatarPath: data.avatar_path,
            photoURL: avatarUrl(data.avatar_path, data.updated_at),
        };
        setUserData(mapped);
        return mapped;
    }, []);

    useEffect(() => {
        let active = true;

        const applySession = async (session) => {
            if (!active) return;
            const currentUser = session?.user ?? null;

            // Kompatibilitaets-Alias: Komponenten und Engines lesen an 54
            // Stellen user.uid und user.isAnonymous (Firebase-Konvention).
            // Supabase liefert id / is_anonymous -- ohne diese Zuordnung
            // waere user.uid ueberall undefined und damit jeder
            // Spieler-Vergleich still falsch.
            setUser(currentUser
                ? { ...currentUser, uid: currentUser.id, isAnonymous: !!currentUser.is_anonymous }
                : null);

            if (currentUser) {
                // Das Profil legt der handle_new_user-Trigger an. Fuer anonyme
                // Nutzer faellt er auf 'Spieler' zurueck -- sinnvoller Default,
                // der Nickname vom Welcome-Screen ueberschreibt ihn spaeter.
                await loadProfile(currentUser.id);
            } else {
                setUserData(null);
            }
            setLoading(false);
        };

        supabase.auth.getSession().then(async ({ data }) => {
            if (!active) return;
            if (data.session) {
                await applySession(data.session);
            } else {
                const { error: err } = await supabase.auth.signInAnonymously();
                if (err) {
                    console.error('Anonyme Anmeldung fehlgeschlagen:', err);
                    setLoading(false);
                }
                // onAuthStateChange liefert die neue Session nach.
            }
        });

        const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true);
            if (event === 'SIGNED_OUT') {
                // Nach dem Abmelden sofort wieder anonym, damit die App nie
                // ohne Identitaet dasteht.
                supabase.auth.signInAnonymously().catch(() => {});
                return;
            }
            applySession(session);
        });

        return () => {
            active = false;
            sub.subscription.unsubscribe();
        };
    }, [loadProfile]);

    // -----------------------------------------------------------------
    // Anonym -> echter Account. updateUser() haengt die E-Mail-Identitaet
    // an DIESELBE auth.uid() -- Mitgliedschaften und Punkte bleiben also
    // erhalten. Der Fake-E-Mail-Hack (<name>@partybox.local) entfaellt
    // ersatzlos, damit gibt es echtes Passwort-Reset.
    // -----------------------------------------------------------------
    const registerWithEmail = async (email, password) => {
        setAuthActionLoading(true);
        setError(null);
        try {
            const { error: err } = await supabase.auth.updateUser({ email, password });
            if (err) throw err;
            await loadProfile(user.id);
        } catch (err) {
            if (/already|registered|exists/i.test(err.message || '')) {
                setError('Diese E-Mail-Adresse wird bereits verwendet.');
            } else if (/password/i.test(err.message || '')) {
                setError('Passwort ist zu schwach (min. 6 Zeichen).');
            } else {
                setError('Fehler bei der Registrierung: ' + err.message);
            }
        } finally {
            setAuthActionLoading(false);
        }
    };

    const loginWithEmail = async (email, password) => {
        setAuthActionLoading(true);
        setError(null);
        try {
            const { error: err } = await supabase.auth.signInWithPassword({ email, password });
            if (err) throw err;
        } catch {
            setError('E-Mail oder Passwort falsch.');
        } finally {
            setAuthActionLoading(false);
        }
    };

    const requestPasswordReset = async (email) => {
        setAuthActionLoading(true);
        setError(null);
        try {
            const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: window.location.origin,
            });
            if (err) throw err;
            return true;
        } catch (err) {
            setError('Reset-Mail konnte nicht gesendet werden: ' + err.message);
            return false;
        } finally {
            setAuthActionLoading(false);
        }
    };

    const setNewPassword = async (password) => {
        setAuthActionLoading(true);
        setError(null);
        try {
            const { error: err } = await supabase.auth.updateUser({ password });
            if (err) throw err;
            setRecoveryMode(false);
            return true;
        } catch (err) {
            setError('Passwort konnte nicht gesetzt werden: ' + err.message);
            return false;
        } finally {
            setAuthActionLoading(false);
        }
    };

    /** newNickname und/oder newAvatarPath. Signatur wie bisher. */
    const updateUserProfile = async (newNickname, newAvatarPath) => {
        if (!user) return;
        const updates = {};
        if (newNickname) updates.display_name = newNickname.trim().slice(0, 24);
        if (newAvatarPath) updates.avatar_path = newAvatarPath;
        if (Object.keys(updates).length === 0) return;

        const { error: err } = await supabase
            .from('profiles')
            .update(updates)
            .eq('id', user.id);

        if (err) {
            console.error('Profil-Update fehlgeschlagen:', err);
            return;
        }
        await loadProfile(user.id);
    };

    const logOutUser = async () => {
        setAuthActionLoading(true);
        await supabase.auth.signOut();
        setAuthActionLoading(false);
    };

    return {
        user,
        userData,
        loading,
        authActionLoading,
        error,
        recoveryMode,
        registerWithEmail,
        loginWithEmail,
        requestPasswordReset,
        setNewPassword,
        logOutUser,
        updateUserProfile,
        setError,
    };
}
