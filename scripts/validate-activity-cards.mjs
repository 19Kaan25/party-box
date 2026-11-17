// Prüft die drei Activity-Kartendateien. Aufruf: node scripts/validate-activity-cards.mjs
// Exit-Code 1 bei jedem Fehler, damit es sich als Gate eignet.
import { readFileSync } from 'node:fs';

const CATS = ['alltag', 'tiere_natur', 'freizeit_kultur'];
const FILES = [
    { file: 'src/constants/activityTabu.json', perLevel: 24, tabu: true },
    { file: 'src/constants/activityMalen.json', perLevel: 30, tabu: false },
    { file: 'src/constants/activityPantomime.json', perLevel: 30, tabu: false },
];

const errors = [];
const seenAcross = new Map(); // word -> Datei, für Überschneidungen zwischen den Dateien (nur Warnung)
const warnings = [];
const norm = (s) => s.trim().toLowerCase();
// Wortteile ab 4 Zeichen, damit "Zahnarzt" auch "Zahn" im Tabu findet und umgekehrt.
const parts = (s) => norm(s).split(/[\s-]+/).filter((p) => p.length >= 4);
const overlaps = (a, b) => {
    const x = norm(a), y = norm(b);
    if (x.includes(y) || y.includes(x)) return true;
    return parts(a).some((p) => y.includes(p)) || parts(b).some((p) => x.includes(p));
};

for (const { file, perLevel, tabu } of FILES) {
    let data;
    try { data = JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')); } catch (e) {
        errors.push(`${file}: nicht lesbar (${e.message})`);
        continue;
    }
    const seen = new Set();
    for (const cat of CATS) {
        const list = data[cat];
        if (!Array.isArray(list)) { errors.push(`${file}: Kategorie ${cat} fehlt`); continue; }
        for (const level of [3, 4, 5]) {
            const n = list.filter((c) => c.difficulty === level).length;
            if (n !== perLevel) errors.push(`${file} ${cat}: Stufe ${level} hat ${n} statt ${perLevel}`);
        }
        for (const card of list) {
            const where = `${file} ${cat} „${card.word}"`;
            if (typeof card.word !== 'string' || !card.word.trim()) { errors.push(`${where}: kein word`); continue; }
            if (![3, 4, 5].includes(card.difficulty)) errors.push(`${where}: difficulty ${card.difficulty}`);
            if (card.word.trim().split(/\s+/).length > 3) errors.push(`${where}: mehr als drei Wörter`);
            const key = norm(card.word);
            if (seen.has(key)) errors.push(`${where}: Duplikat in der Datei`);
            seen.add(key);
            if (seenAcross.has(key) && seenAcross.get(key) !== file) warnings.push(`„${card.word}" in ${seenAcross.get(key)} und ${file}`);
            seenAcross.set(key, file);

            if (!tabu) {
                if ('forbidden' in card) errors.push(`${where}: forbidden gehört nur in die Tabu-Datei`);
                continue;
            }
            const f = card.forbidden;
            if (!Array.isArray(f) || f.length !== 5) { errors.push(`${where}: nicht genau 5 Tabu-Wörter`); continue; }
            f.forEach((w, i) => {
                if (typeof w !== 'string' || /\s/.test(w.trim())) errors.push(`${where}: Tabu-Wort „${w}" ist kein einzelnes Wort`);
                else if (overlaps(card.word, w)) errors.push(`${where}: Tabu-Wort „${w}" überschneidet sich mit dem Begriff`);
                f.slice(i + 1).forEach((v) => {
                    // Varianten = gleicher Anfang oder gleiches Ende ("Meer"/"Wattenmeer");
                    // reines Enthaltensein wäre zu streng ("Echse" steckt in "wechseln").
                    const a = typeof v === 'string' && norm(w), b = typeof v === 'string' && norm(v);
                    if (a && (a.startsWith(b) || b.startsWith(a) || a.endsWith(b) || b.endsWith(a))) errors.push(`${where}: Tabu-Wörter „${w}" und „${v}" sind Varianten`);
                });
            });
        }
    }
}

warnings.forEach((w) => console.warn(`Hinweis: ${w}`));
if (errors.length) {
    errors.forEach((e) => console.error(`FEHLER: ${e}`));
    console.error(`\n${errors.length} Fehler.`);
    process.exit(1);
}
console.log(`OK — alle drei Dateien gültig (${warnings.length} Überschneidungen zwischen Dateien als Hinweis).`);
