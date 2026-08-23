import { CODENAMES_WORDS } from '../src/constants/gameData.js';

const normalized = new Map();
const duplicates = [];

CODENAMES_WORDS.forEach((word, index) => {
    if (typeof word !== 'string' || !word.trim()) {
        throw new Error(`Ungültiger Codenames-Eintrag an Position ${index + 1}.`);
    }

    // Groß-/Kleinschreibung, Unicode-Schreibweise und ß/ss sollen keine
    // scheinbar unterschiedlichen Dopplungen erzeugen.
    const key = word.trim().normalize('NFC').toLocaleLowerCase('de-DE').replaceAll('ß', 'ss');
    if (normalized.has(key)) duplicates.push(`${normalized.get(key)} / ${word}`);
    else normalized.set(key, word);
});

if (duplicates.length > 0) {
    throw new Error(`Doppelte Codenames-Wörter: ${duplicates.join(', ')}`);
}

console.log(`${CODENAMES_WORDS.length} eindeutige Codenames-Wörter geprüft.`);
