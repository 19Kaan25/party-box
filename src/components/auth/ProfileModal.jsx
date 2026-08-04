import React, { useState, useRef } from 'react';
import { X, LogOut, Camera, Loader2, Trash2, Check, Pencil } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { USERNAME_RE } from '../../hooks/useAuth';
import FriendsPanel from '../friends/FriendsPanel';
import InvitesPanel from '../friends/InvitesPanel';

const MAX_SIZE = 256;

/** Bild clientseitig auf MAX_SIZE verkleinern. Logik wie bisher, aber als
 *  WebP-Blob statt data-URI -- Ziel ist Supabase Storage, nicht mehr eine
 *  base64-Spalte, die bei jeder Aenderung an alle Clients ging. */
function resizeToWebp(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
        reader.onload = (event) => {
            const img = new Image();
            img.onerror = () => reject(new Error('Bild konnte nicht geladen werden.'));
            img.onload = () => {
                let { width, height } = img;
                if (width > height) {
                    if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; }
                } else {
                    if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; }
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                canvas.toBlob(
                    (blob) => (blob ? resolve(blob) : reject(new Error('Konvertierung fehlgeschlagen.'))),
                    'image/webp',
                    0.8
                );
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    });
}

export default function ProfileModal({ authLogic, friendsLogic, inLobby, initialTab = 'profil', onClose, onAcceptInvite }) {
    const {
        user, userData, updateUserProfile, removeAvatar, setUsername,
        logOutUser, authActionLoading, error, setError,
    } = authLogic;

    const [tab, setTab] = useState(initialTab);
    const [isSaving, setIsSaving] = useState(false);
    const [uploadError, setUploadError] = useState('');
    const [nameDraft, setNameDraft] = useState('');
    const [editingName, setEditingName] = useState(false);
    const fileInputRef = useRef(null);

    const handle = userData?.handle;

    const handleImageUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file || !user) return;

        setUploadError('');
        setIsSaving(true);
        try {
            const blob = await resizeToWebp(file);
            // Storage-Policy erlaubt Schreiben nur im eigenen Ordner.
            const path = `${user.id}/avatar.webp`;
            const { error: err } = await supabase.storage
                .from('avatars')
                .upload(path, blob, { upsert: true, contentType: 'image/webp' });
            if (err) throw err;

            await updateUserProfile(null, path);
        } catch (err) {
            setUploadError(err.message || 'Upload fehlgeschlagen.');
        } finally {
            setIsSaving(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const startEditName = () => {
        setError(null);
        setNameDraft(userData?.username || '');
        setEditingName(true);
    };

    const saveName = async () => {
        const ok = await setUsername(nameDraft.trim());
        if (ok) setEditingName(false);
    };

    // Benutzername zuerst: der steht direkt daneben. Der Profilname ist bis
    // zur ersten Lobby der Trigger-Default "Spieler" -- ein "S" neben
    // "TestAnna#1314" sieht nach einem Fehler aus.
    const initial = (userData?.username || userData?.name || 'S').charAt(0).toUpperCase();
    const nameValid = USERNAME_RE.test(nameDraft.trim());

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
            <div className="bg-slate-800 rounded-3xl w-full max-w-sm border border-slate-700 shadow-2xl relative animate-in zoom-in-95 duration-200 flex flex-col max-h-[85vh]">
                <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors z-10">
                    <X size={24} />
                </button>

                <div className="flex gap-1 p-2 pt-5 px-5 border-b border-slate-700">
                    {[
                        ['profil', 'Profil', 0],
                        ['freunde', 'Freunde', friendsLogic?.incoming?.length || 0],
                        ['einladungen', 'Einladungen', friendsLogic?.invites?.length || 0],
                    ].map(([key, label, badge]) => (
                        <button
                            key={key}
                            onClick={() => { setTab(key); setError(null); }}
                            className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${tab === key ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                        >
                            {label}
                            {badge > 0 && (
                                <span className="ml-2 inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold">
                                    {badge}
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                <div className="p-6 overflow-y-auto">
                    {tab === 'profil' ? (
                        <>
                            <div className="flex flex-col items-center mb-6">
                                <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                                    {/* Frueher wurde hier /default-avatar.png geladen -- eine Datei,
                                        die es in public/ nie gab (404 fuer jeden Nutzer ohne Bild).
                                        Jetzt der gleiche Initialen-Fallback wie in der Spielerliste. */}
                                    {userData?.photoURL ? (
                                        <img
                                            src={userData.photoURL}
                                            alt="Profilbild"
                                            className="w-28 h-28 rounded-full object-cover border-4 border-slate-700 group-hover:border-indigo-500 transition-colors"
                                        />
                                    ) : (
                                        <div className="w-28 h-28 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-4xl font-bold text-white border-4 border-slate-700 group-hover:border-indigo-500 transition-colors">
                                            {initial}
                                        </div>
                                    )}
                                    <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Camera size={26} className="text-white" />
                                    </div>
                                    {isSaving && (
                                        <div className="absolute inset-0 bg-slate-900/50 rounded-full flex items-center justify-center">
                                            <Loader2 className="animate-spin text-white" />
                                        </div>
                                    )}
                                </div>
                                <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />

                                <div className="flex items-center gap-3 mt-3">
                                    <button
                                        onClick={() => fileInputRef.current?.click()}
                                        className="text-xs text-slate-400 hover:text-slate-200 font-medium underline"
                                    >
                                        Bild ändern
                                    </button>
                                    {userData?.avatarPath && (
                                        <button
                                            onClick={() => { if (window.confirm('Profilbild wirklich entfernen?')) removeAvatar(); }}
                                            disabled={authActionLoading}
                                            className="text-xs text-slate-500 hover:text-red-400 font-medium underline flex items-center gap-1"
                                        >
                                            <Trash2 size={12} /> Entfernen
                                        </button>
                                    )}
                                </div>
                                {uploadError && <p className="text-xs text-red-400 mt-2 text-center">{uploadError}</p>}
                            </div>

                            <div className="mb-6">
                                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                                    Benutzername
                                </label>
                                {editingName ? (
                                    <>
                                        <div className="flex gap-2">
                                            <input
                                                value={nameDraft}
                                                onChange={(e) => setNameDraft(e.target.value)}
                                                onKeyDown={(e) => { if (e.key === 'Enter' && nameValid) saveName(); }}
                                                maxLength={20}
                                                autoFocus
                                                className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                                            />
                                            <button
                                                onClick={saveName}
                                                disabled={authActionLoading || !nameValid}
                                                className="bg-green-600 hover:bg-green-500 disabled:bg-slate-700 disabled:text-slate-500 text-white px-3 rounded-lg transition-colors shrink-0"
                                                title="Speichern"
                                            >
                                                {authActionLoading ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                            </button>
                                            <button
                                                onClick={() => { setEditingName(false); setError(null); }}
                                                className="text-slate-400 hover:text-white px-2 shrink-0"
                                                title="Abbrechen"
                                            >
                                                <X size={16} />
                                            </button>
                                        </div>
                                        <p className="text-xs text-slate-500 mt-1.5">
                                            3–20 Zeichen. Der vierstellige Code dahinter wird neu vergeben —
                                            deine Freunde bleiben erhalten.
                                        </p>
                                    </>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <span className="font-mono text-sm text-slate-200 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 flex-1 truncate">
                                            {handle || 'noch nicht festgelegt'}
                                        </span>
                                        <button
                                            onClick={startEditName}
                                            className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors shrink-0"
                                            title={handle ? 'Ändern' : 'Festlegen'}
                                        >
                                            <Pencil size={16} />
                                        </button>
                                    </div>
                                )}
                                {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
                            </div>

                            <button
                                onClick={() => { onClose(); logOutUser(); }}
                                className="w-full bg-red-900/30 hover:bg-red-900/50 text-red-400 font-bold py-3 rounded-xl border border-red-900/50 transition-all flex items-center justify-center gap-2"
                            >
                                <LogOut size={18} /> Abmelden
                            </button>
                        </>
                    ) : tab === 'freunde' ? (
                        <FriendsPanel
                            friendsLogic={friendsLogic}
                            ownHandle={handle}
                            inLobby={inLobby}
                        />
                    ) : (
                        <InvitesPanel
                            friendsLogic={friendsLogic}
                            onAccept={onAcceptInvite}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
