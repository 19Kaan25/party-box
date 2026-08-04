import React from 'react';
import { avatarUrl } from '../../hooks/useAuth';

/** Gemeinsames Avatar-Bild fuer Freunde- und Einladungslisten: Foto, sonst
 *  Initiale auf Gradient-Kachel wie im Profil-Modal. */
export default function Avatar({ person, size = 'w-9 h-9' }) {
    const url = avatarUrl(person.avatar_path);
    const initial = (person.username || person.display_name || 'S').charAt(0).toUpperCase();
    return url ? (
        <img src={url} alt="" className={`${size} rounded-full object-cover border border-slate-600 shrink-0`} />
    ) : (
        <div className={`${size} rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center font-bold text-sm text-white shrink-0`}>
            {initial}
        </div>
    );
}
