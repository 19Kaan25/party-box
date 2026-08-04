import React, { useState } from 'react';
import { X } from 'lucide-react';
import { avatarUrl } from '../../hooks/useAuth';

/**
 * Gemeinsames Avatar-Bild: Foto, sonst Initiale auf Gradient-Kachel wie im
 * Profil-Modal. Klick oeffnet eine grosse Vorschau -- ueberall, wo Avatar
 * verwendet wird (Freundesliste, Einladungen, Lobby-Spielerliste), automatisch
 * mit dabei.
 *
 * Zwei Wege an ein Bild zu kommen: entweder `person` (Freunde-RPCs liefern nur
 * den rohen Storage-Pfad `avatar_path`, die URL wird hier berechnet) oder ein
 * bereits fertiger `url`-Wert (die Lobby-Spielerliste hat die URL schon ueber
 * useLobby.js aufgeloest, inklusive Cache-Buster -- `avatarUrl()` ein zweites
 * Mal ohne `updated_at` aufzurufen wuerde diesen Cache-Buster verlieren).
 * `url` gewinnt, wenn beides da ist.
 */
export default function Avatar({ person, url: urlProp, label, size = 'w-9 h-9' }) {
    const url = urlProp !== undefined ? urlProp : avatarUrl(person?.avatar_path);
    const initial = (label || person?.username || person?.display_name || 'S').charAt(0).toUpperCase();
    const [preview, setPreview] = useState(false);

    return (
        <>
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setPreview(true); }}
                className={`${size} rounded-full shrink-0 overflow-hidden p-0 border-0 block focus:outline-none focus:ring-2 focus:ring-indigo-400`}
                title="Profilbild ansehen"
            >
                {url ? (
                    <img src={url} alt="" className="w-full h-full object-cover border border-slate-600" />
                ) : (
                    <div className="w-full h-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center font-bold text-sm text-white">
                        {initial}
                    </div>
                )}
            </button>

            {preview && (
                <div
                    className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[110] p-6"
                    onClick={() => setPreview(false)}
                >
                    <button
                        onClick={() => setPreview(false)}
                        className="absolute top-4 right-4 text-slate-300 hover:text-white transition-colors"
                        title="Schließen"
                    >
                        <X size={28} />
                    </button>
                    {url ? (
                        <img
                            src={url}
                            alt=""
                            className="max-w-full max-h-full rounded-2xl object-contain shadow-2xl"
                            onClick={(e) => e.stopPropagation()}
                        />
                    ) : (
                        <div
                            className="w-56 h-56 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-8xl font-bold text-white shadow-2xl"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {initial}
                        </div>
                    )}
                </div>
            )}
        </>
    );
}
