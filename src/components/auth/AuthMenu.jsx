import React, { useState } from 'react';
import { LogIn, UserPlus, Loader2, KeyRound } from 'lucide-react';

export default function AuthMenu({ authLogic, onOpenProfile }) {
    const {
        user, userData, authActionLoading, error, recoveryMode,
        registerWithEmail, loginWithEmail, requestPasswordReset, setNewPassword, setError,
    } = authLogic;

    const [view, setView] = useState(null);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [notice, setNotice] = useState('');

    // Direkt im Handler zuruecksetzen statt per Effect auf [view] -- spart
    // einen Render-Durchlauf und den setState-im-Effect-Verstoss.
    const switchView = (next) => {
        setView((prev) => (prev === next ? null : next));
        setError(null);
        setEmail('');
        setPassword('');
        setNotice('');
    };

    if (!user) return null;

    const submit = async () => {
        setNotice('');
        if (view === 'login') return loginWithEmail(email, password);
        if (view === 'register') return registerWithEmail(email, password);
        if (view === 'reset') {
            const ok = await requestPasswordReset(email);
            if (ok) setNotice('E-Mail ist unterwegs. Schau in dein Postfach.');
        }
    };

    const initial = (userData?.name || 'S').charAt(0).toUpperCase();

    return (
        <div className="absolute top-4 right-4 z-50 flex flex-col items-end gap-2">
            <div className="flex items-center gap-2 bg-slate-800/80 backdrop-blur-md px-2 py-1.5 rounded-2xl border border-slate-700 shadow-xl">
                {user.isAnonymous ? (
                    <>
                        <button
                            onClick={() => switchView('login')}
                            className={`flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-lg transition-all ${view === 'login' ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-700 hover:text-white'}`}
                        >
                            <LogIn size={16} /> <span className="hidden sm:inline">Anmelden</span>
                        </button>
                        <div className="w-px h-5 bg-slate-600 mx-1"></div>
                        <button
                            onClick={() => switchView('register')}
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
                        {userData?.photoURL ? (
                            <img src={userData.photoURL} alt="Avatar" className="w-8 h-8 rounded-full object-cover border border-slate-600" />
                        ) : (
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center font-bold text-sm text-white">
                                {initial}
                            </div>
                        )}
                        <span className="text-sm font-bold text-white">{userData?.name || 'Lade...'}</span>
                    </button>
                )}
            </div>

            {/* Passwort-Reset: der Nutzer kam ueber den Link aus der E-Mail */}
            {recoveryMode && (
                <div className="bg-slate-800 p-4 rounded-xl border border-amber-500/50 shadow-2xl flex flex-col gap-3 w-64">
                    <h3 className="text-sm font-bold text-amber-400 mb-1 border-b border-slate-700 pb-2 flex items-center gap-2">
                        <KeyRound size={14} /> Neues Passwort setzen
                    </h3>
                    <input
                        type="password" placeholder="Neues Passwort (min. 6)" value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500"
                    />
                    <button
                        onClick={() => setNewPassword(password)}
                        disabled={authActionLoading || password.length < 6}
                        className="w-full bg-amber-600 hover:bg-amber-500 text-white font-bold py-2 rounded-lg text-sm transition-colors flex justify-center disabled:bg-slate-700"
                    >
                        {authActionLoading ? <Loader2 size={16} className="animate-spin" /> : 'Speichern'}
                    </button>
                    {error && <p className="text-xs text-red-400 text-center">{error}</p>}
                </div>
            )}

            {view && user.isAnonymous && !recoveryMode && (
                <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 shadow-2xl flex flex-col gap-3 w-64 animate-in slide-in-from-top-2">
                    <h3 className="text-sm font-bold text-slate-300 mb-1 border-b border-slate-700 pb-2">
                        {view === 'login' ? 'Willkommen zurück!' : view === 'register' ? 'Account erstellen' : 'Passwort zurücksetzen'}
                    </h3>
                    <input
                        type="email" placeholder="E-Mail" value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                    />
                    {view !== 'reset' && (
                        <input
                            type="password" placeholder="Passwort (min. 6 Zeichen)" value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                        />
                    )}

                    <button
                        onClick={submit}
                        disabled={authActionLoading || !email || (view !== 'reset' && password.length < 6)}
                        className={`w-full font-bold py-2 rounded-lg text-sm transition-colors flex justify-center mt-1 disabled:bg-slate-700 ${view === 'login' ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : view === 'register' ? 'bg-green-600 hover:bg-green-500 text-white' : 'bg-amber-600 hover:bg-amber-500 text-white'}`}
                    >
                        {authActionLoading ? <Loader2 size={16} className="animate-spin" />
                            : view === 'login' ? 'Jetzt anmelden'
                            : view === 'register' ? 'Konto erstellen' : 'Reset-Mail senden'}
                    </button>

                    {view === 'login' && (
                        <button onClick={() => switchView('reset')} className="text-xs text-slate-400 hover:text-slate-200 underline">
                            Passwort vergessen?
                        </button>
                    )}
                    {view === 'reset' && (
                        <button onClick={() => switchView('login')} className="text-xs text-slate-400 hover:text-slate-200 underline">
                            Zurück zur Anmeldung
                        </button>
                    )}

                    {notice && <p className="text-xs text-green-400 mt-1 text-center">{notice}</p>}
                    {error && <p className="text-xs text-red-400 mt-1 text-center">{error}</p>}
                </div>
            )}
        </div>
    );
}
