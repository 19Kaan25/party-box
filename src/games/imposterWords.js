/* Wortpool-Helfer, von beiden Imposter-Modi genutzt.
 * Eigene Datei, weil react-refresh in einer Komponenten-Datei keine
 * zusaetzlichen Exporte erlaubt. */

import { IMPOSTER_CATEGORIES } from '../constants/gameData';

/** Wortpool aus den gewaehlten Kategorien. 'custom' zieht die Lobby-Woerter dazu. */
export function buildWordPool(selectedCategories = [], customWords = []) {
    let pool = [];
    selectedCategories.forEach(catId => {
        if (catId === 'custom') {
            pool = [...pool, ...customWords];
        } else if (IMPOSTER_CATEGORIES[catId]) {
            pool = [...pool, ...IMPOSTER_CATEGORIES[catId].words];
        }
    });
    return pool;
}

/** Anzeigename der Kategorie, aus der ein Wort stammt (fuer den Imposter-Hinweis). */
export function categoryNameOfWord(word, selectedCategories = []) {
    const cat = Object.values(IMPOSTER_CATEGORIES)
        .find(c => selectedCategories.includes(c.id) && c.words.includes(word));
    return cat ? cat.name : 'Eigene Wörter';
}
