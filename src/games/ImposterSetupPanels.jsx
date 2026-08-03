/* =====================================================================
 *  Gemeinsame Setup-Bausteine fuer beide Imposter-Modi.
 *
 *  Kategorien und eigene Woerter sind in beiden Modi identisch -- die
 *  eigenen Woerter liegen ohnehin auf Lobby-Ebene (lobbies.legacy_state)
 *  und werden geteilt. Deshalb steht das JSX hier einmal statt zweimal.
 * ===================================================================== */

import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { doc, updateDoc, arrayUnion, db } from '../lib/firestoreBridge';
import { IMPOSTER_CATEGORIES } from '../constants/gameData';

/**
 * Kategorie-Raster inklusive der Sonderkachel 'custom'.
 * onToggle bekommt die Kategorie-ID, das Umschalten selbst macht der Aufrufer.
 */
export function CategoryPicker({ selected = [], onToggle, disabled = false, customWordCount = 0 }) {
    return (
        <div className="grid grid-cols-2 gap-3">
            {Object.values(IMPOSTER_CATEGORIES).map(cat => {
                const isSelected = selected.includes(cat.id);
                return (
                    <button
                        key={cat.id}
                        disabled={disabled}
                        onClick={() => onToggle(cat.id)}
                        className={`p-3 rounded-xl border-2 transition-all text-left ${
                            isSelected
                                ? 'border-emerald-500 bg-emerald-500/10 text-white'
                                : 'border-slate-700 bg-slate-900/50 text-slate-500 hover:border-slate-500'
                        } ${disabled ? 'cursor-default' : ''}`}
                    >
                        <span className="block font-bold text-sm">{cat.name}</span>
                        <span className="text-[10px] opacity-60">{cat.words.length} Wörter</span>
                    </button>
                );
            })}
            <button
                disabled={disabled}
                onClick={() => onToggle('custom')}
                className={`p-3 rounded-xl border-2 transition-all text-left ${
                    selected.includes('custom')
                        ? 'border-purple-500 bg-purple-500/10 text-white'
                        : 'border-slate-700 bg-slate-900/50 text-slate-500 hover:border-slate-500'
                } ${disabled ? 'cursor-default' : ''}`}
            >
                <span className="block font-bold text-sm">Eigene Wörter</span>
                <span className="text-[10px] opacity-60">{customWordCount} hinterlegt</span>
            </button>
        </div>
    );
}

/**
 * Eigene Woerter anlegen und loeschen. Schreibt direkt ueber die Bridge auf
 * lobbies.legacy_state -- unabhaengig davon, ob gerade eine Partie laeuft.
 */
export function CustomWordManager({ lobbyCode, words = [], isHost }) {
    const [customInput, setCustomInput] = useState('');

    const addCustomWord = async () => {
        const value = customInput.trim();
        if (!value) return;
        if (words.includes(value)) {
            setCustomInput('');
            return;
        }
        await updateDoc(doc(db, 'lobbies', lobbyCode), {
            customImposterWords: arrayUnion(value)
        });
        setCustomInput('');
    };

    const removeCustomWord = async (word) => {
        if (!isHost) return;
        const newList = words.filter(w => w !== word);
        await updateDoc(doc(db, 'lobbies', lobbyCode), { customImposterWords: newList });
    };

    return (
        <>
            {isHost && (
                <div className="flex gap-2 mb-4">
                    <input
                        type="text"
                        value={customInput}
                        maxLength={40}
                        onChange={(e) => setCustomInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') addCustomWord(); }}
                        placeholder="Wort hinzufügen..."
                        className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                    />
                    <button onClick={addCustomWord} className="bg-purple-600 p-2 rounded-lg hover:bg-purple-500 transition-colors">
                        <Plus size={20} />
                    </button>
                </div>
            )}
            <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto pr-2">
                {words.map((word, idx) => (
                    <span key={idx} className="bg-slate-900 border border-slate-700 px-2 py-1 rounded text-xs flex items-center gap-2">
                        {word}
                        {isHost && <Trash2 size={12} className="text-red-400 cursor-pointer hover:text-red-300" onClick={() => removeCustomWord(word)} />}
                    </span>
                ))}
                {words.length === 0 && <p className="text-xs text-slate-500 italic">Noch keine eigenen Wörter hinterlegt.</p>}
            </div>
        </>
    );
}
