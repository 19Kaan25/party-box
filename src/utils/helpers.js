// generateLobbyCode() ist mit Phase 0b entfallen: Codes vergibt jetzt
// public.gen_lobby_code() in der Datenbank, sechsstellig aus [A-Z2-9].
// Die alte Fassung erzeugte vier Zeichen inklusive 0/1 und passte nicht
// mehr zur Pruefung `code ~ '^[A-Z2-9]{6}$'`. Sie wurde nirgends mehr
// aufgerufen und ist deshalb entfernt statt angepasst.

export const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split('');

export const getRandomLetter = () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)];

/**
 * "vor 3 Std." fuer die Freundesliste. Bewusst per Hand statt mit einer
 * Zusatzbibliothek: es sind vier Faelle, und Intl.RelativeTimeFormat
 * braeuchte trotzdem die Auswahl der passenden Einheit.
 */
export const relativeTimeDe = (iso) => {
  if (!iso) return 'unbekannt';
  const diffMs = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diffMs)) return 'unbekannt';

  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Min.`;

  const std = Math.floor(min / 60);
  if (std < 24) return `vor ${std} Std.`;

  const tage = Math.floor(std / 24);
  if (tage < 30) return tage === 1 ? 'vor 1 Tag' : `vor ${tage} Tagen`;
  return 'vor längerer Zeit';
};

export const shuffleArray = (array) => {
  let newArr = [...array];
  for (let i = newArr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
  }
  return newArr;
};