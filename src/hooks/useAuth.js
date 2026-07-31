import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';

const AVATAR_BUCKET = 'avatars';

/**
 * Supabase-Auth-Fehler -> deutsche Meldung.
 *
 * Es wird primaer auf err.code gematcht (stabile Kennungen), nicht auf den
 * Meldungstext. Die frueher benutzte Textsuche /password/i machte aus JEDER
 * Meldung mit "password" ein "min. 6 Zeichen" -- also auch aus
 * Zeichenklassen-Anforderungen oder Rate-Limits, was in die Irre fuehrt.
 * Unbekanntes wird im Klartext durchgereicht statt umgedeutet.
 */
function mapAuthError(err, kontext) {
    const code = err?.code || '';
    const msg = err?.message || '';

    switch (code) {
        case 'email_exists':
        case 'user_already_exists':
            return 'Diese E-Mail-Adresse wird bereits verwendet.';
        case 'weak_password':
            // Die konkrete Anforderung steckt in der Originalmeldung und ist
            // wertvoller als eine pauschale Zahl.
            return `Passwort zu schwach: ${msg}`;
        case 'email_address_invalid':
        case 'validation_failed':
            return 'Bitte gib eine gültige E-Mail-Adresse ein.';
        case 'over_email_send_rate_limit':
            return 'Zu viele E-Mails in kurzer Zeit. Bitte warte eine Stunde und versuche es erneut.';
        case 'over_request_rate_limit':
            return 'Zu viele Versuche. Bitte warte einen Moment.';
        case 'same_password':
            return 'Das ist bereits dein aktuelles Passwort.';
        case 'invalid_credentials':
            return 'E-Mail oder Passwort falsch.';
        case 'user_not_found':
            // Der lokal gespeicherte JWT zeigt auf einen Nutzer, den es
            // serverseitig nicht mehr gibt (z. B. nach einem Aufraeumen der
            // Datenbank). Die App holt sich automatisch eine neue anonyme
            // Sitzung -- ein Neuladen ist nicht noetig.
            return 'Deine Sitzung war abgelaufen. Es wurde eine neue angelegt — bitte versuche es noch einmal.';
        default:
            return `Fehler bei der ${kontext}: ${msg}`;
    }
}

/** Erkennt die verwaiste Sitzung an beiden Symptomen: der Auth-Fehler
 *  user_not_found und die Fremdschluessel-Verletzung 23503, die entsteht,
 *  wenn RPCs auf die fehlende profiles-Zeile stossen. */
export function isStaleSession(err) {
    return err?.code === 'user_not_found'
        || err?.code === '23503'
        || /sub claim in JWT does not exist/i.test(err?.message || '');
}

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
    // Verhindert, dass sich Neuanmeldung und SIGNED_OUT-Handler gegenseitig
    // ausloesen und dabei zwei anonyme Nutzer anlegen.
    const reauthing = useRef(false);

    /** Verwaiste Sitzung verwerfen und frisch anonym anmelden. */
    const ensureAnonymous = useCallback(async () => {
        if (reauthing.current) return;
        reauthing.current = true;
        try {
            // scope 'local': der Server kann die Sitzung nicht mehr beenden,
            // weil der Nutzer dort gar nicht mehr existiert.
            await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
            const { error: err } = await supabase.auth.signInAnonymously();
            if (err) console.error('Neue anonyme Sitzung fehlgeschlagen:', err);
        } finally {
            reauthing.current = false;
        }
    }, []);

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
                // getSession() liest nur den lokalen Speicher und prueft nicht,
                // ob es den Nutzer serverseitig noch gibt. Erst getUser() fragt
                // den Server. Ohne diese Pruefung landet eine verwaiste Sitzung
                // in einer Sackgasse: die UI sieht angemeldet aus, aber jede
                // Aktion scheitert mit user_not_found bzw. 23503.
                const { error: userErr } = await supabase.auth.getUser();
                if (!active) return;
                if (userErr) {
                    console.warn('Gespeicherte Sitzung ist ungueltig, neue anonyme Anmeldung:', userErr.message);
                    await ensureAnonymous();
                    return;   // onAuthStateChange liefert die neue Session nach
                }
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
                // ohne Identitaet dasteht. Waehrend ensureAnonymous() laeuft
                // nicht, sonst entstuenden zwei anonyme Nutzer.
                if (!reauthing.current) supabase.auth.signInAnonymously().catch(() => {});
                return;
            }
            applySession(session);
        });

        return () => {
            active = false;
            sub.subscription.unsubscribe();
        };
    }, [loadProfile, ensureAnonymous]);

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
            setError(mapAuthError(err, 'Registrierung'));
            // Verwaiste Sitzung: sofort eine frische anonyme holen, damit der
            // naechste Versuch durchgeht statt erneut zu scheitern.
            if (isStaleSession(err)) await ensureAnonymous();
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
        } catch (err) {
            setError(mapAuthError(err, 'Anmeldung'));
            if (isStaleSession(err)) await ensureAnonymous();
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
            setError(mapAuthError(err, 'Reset-Anforderung'));
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
            setError(mapAuthError(err, 'Passwort-Änderung'));
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
