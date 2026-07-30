import React, { useState, useRef } from 'react';
import { X, LogOut, Camera, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';

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

export default function ProfileModal({ authLogic, onClose }) {
    const { user, userData, updateUserProfile, logOutUser } = authLogic;
    const [isSaving, setIsSaving] = useState(false);
    const [uploadError, setUploadError] = useState('');
    const fileInputRef = useRef(null);

    const handleImageUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file || !user) return;

        setUploadError('');
        setIsSaving(true);
        try {
            const blob = await resizeToWebp(file);
            // Storage-Policy erlaubt Schreiben nur im eigenen Ordner.
            const path = `${user.id}/avatar.webp`;
            const { error } = await supabase.storage
                .from('avatars')
                .upload(path, blob, { upsert: true, contentType: 'image/webp' });
            if (error) throw error;

            await updateUserProfile(null, path);
        } catch (err) {
            setUploadError(err.message || 'Upload fehlgeschlagen.');
        } finally {
            setIsSaving(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const initial = (userData?.name || 'S').charAt(0).toUpperCase();

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
            <div className="bg-slate-800 p-8 rounded-3xl w-full max-w-xs border border-slate-700 shadow-2xl relative animate-in zoom-in-95 duration-200">
                <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors">
                    <X size={24} />
                </button>

                <h2 className="text-2xl font-bold text-white mb-6 text-center">Dein Profil</h2>

                <div className="flex flex-col items-center mb-8">
                    <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                        {/* Fruehr wurde hier /default-avatar.png geladen -- eine Datei,
                            die es in public/ nie gab (404 fuer jeden Nutzer ohne Bild).
                            Jetzt der gleiche Initialen-Fallback wie in der Spielerliste. */}
                        {userData?.photoURL ? (
                            <img
                                src={userData.photoURL}
                                alt="Profilbild"
                                className="w-32 h-32 rounded-full object-cover border-4 border-slate-700 group-hover:border-indigo-500 transition-colors"
                            />
                        ) : (
                            <div className="w-32 h-32 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-4xl font-bold text-white border-4 border-slate-700 group-hover:border-indigo-500 transition-colors">
                                {initial}
                            </div>
                        )}
                        <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <Camera size={28} className="text-white" />
                        </div>
                        {isSaving && (
                            <div className="absolute inset-0 bg-slate-900/50 rounded-full flex items-center justify-center">
                                <Loader2 className="animate-spin text-white" />
                            </div>
                        )}
                    </div>
                    <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />
                    <p className="text-xs text-slate-500 mt-3 font-medium">Klicken, um Bild zu ändern</p>
                    {uploadError && <p className="text-xs text-red-400 mt-2 text-center">{uploadError}</p>}
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
