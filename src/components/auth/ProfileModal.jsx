import React, { useState, useRef } from 'react';
import { X, LogOut, Camera, Loader2 } from 'lucide-react';

export default function ProfileModal({ authLogic, onClose }) {
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