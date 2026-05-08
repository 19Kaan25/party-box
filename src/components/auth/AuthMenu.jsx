import React, { useState, useEffect } from 'react';
import { Shield, LogIn, UserPlus, Loader2 } from 'lucide-react';

export default function AuthMenu({ authLogic, onOpenProfile }) {
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