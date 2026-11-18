// Prüft die drei Activity-Kartendateien und die Tabu-Karten (tabuCards.json).
// Aufruf: node scripts/validate-activity-cards.mjs [--only=film_musik,sport_spiele]
// Solange src/constants/tabu-parts/ existiert (Kartenerzeugung läuft), werden statt
// tabuCards.json die Teildateien dort geprüft; --only beschränkt auf diese Kategorien.
// Exit-Code 1 bei jedem Fehler, damit es sich als Gate eignet.
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const CATS = ['alltag', 'tiere_natur', 'freizeit_kultur'];
const TABU_CATS = ['film_musik', 'sport_spiele', 'wissen', 'welt_reisen', 'technik', 'koerper_gefuehle'];
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
const read = (file) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));

function checkCard(card, where, tabu) {
    if (typeof card.word !== 'string' || !card.word.trim()) { errors.push(`${where}: kein word`); return; }
    if (![3, 4, 5].includes(card.difficulty)) errors.push(`${where}: difficulty ${card.difficulty}`);
    if (card.word.trim().split(/\s+/).length > 3) errors.push(`${where}: mehr als drei Wörter`);
    if (!tabu) {
        if ('forbidden' in card) errors.push(`${where}: forbidden gehört nur in die Tabu-Datei`);
        return;
    }
    const f = card.forbidden;
    if (!Array.isArray(f) || f.length !== 5) { errors.push(`${where}: nicht genau 5 Tabu-Wörter`); return; }
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

function checkFile(file, data, cats, perLevel, tabu, seen = new Set()) {
    for (const cat of cats) {
        const list = data[cat];
        if (!Array.isArray(list)) { errors.push(`${file}: Kategorie ${cat} fehlt`); continue; }
        for (const level of [3, 4, 5]) {
            const n = list.filter((c) => c.difficulty === level).length;
            if (n !== perLevel) errors.push(`${file} ${cat}: Stufe ${level} hat ${n} statt ${perLevel}`);
        }
        for (const card of list) {
            const where = `${file} ${cat} „${card.word}"`;
            checkCard(card, where, tabu);
            if (typeof card.word !== 'string') continue;
            const key = norm(card.word);
            if (seen.has(key)) errors.push(`${where}: Duplikat`);
            seen.add(key);
            if (seenAcross.has(key) && seenAcross.get(key) !== file) warnings.push(`„${card.word}" in ${seenAcross.get(key)} und ${file}`);
            seenAcross.set(key, file);
        }
    }
    return seen;
}

let tabuSeen;
for (const { file, perLevel, tabu } of FILES) {
    let data;
    try { data = read(file); } catch (e) {
        errors.push(`${file}: nicht lesbar (${e.message})`);
        continue;
    }
    const seen = checkFile(file, data, CATS, perLevel, tabu);
    if (tabu) tabuSeen = seen;
}

// Tabu-Spiel: neue Kategorien, Duplikate auch gegen activityTabu.json (Tabu liest beide).
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const tabuCats = onlyArg ? onlyArg.slice(7).split(',') : TABU_CATS;
const partsDir = 'src/constants/tabu-parts';
let tabuData = {}, tabuFile = 'src/constants/tabuCards.json';
try {
    if (existsSync(new URL(`../${partsDir}`, import.meta.url))) {
        tabuFile = partsDir;
        for (const name of readdirSync(new URL(`../${partsDir}`, import.meta.url))) {
            if (name.endsWith('.json')) Object.assign(tabuData, read(`${partsDir}/${name}`));
        }
    } else tabuData = read(tabuFile);
    checkFile(tabuFile, tabuData, tabuCats, 20, true, new Set(tabuSeen));
} catch (e) {
    errors.push(`${tabuFile}: nicht lesbar (${e.message})`);
}

warnings.forEach((w) => console.warn(`Hinweis: ${w}`));
if (errors.length) {
    errors.forEach((e) => console.error(`FEHLER: ${e}`));
    console.error(`\n${errors.length} Fehler.`);
    process.exit(1);
}
console.log(`OK — Activity-Dateien und ${tabuFile} (${tabuCats.join(', ')}) gültig (${warnings.length} Überschneidungen zwischen Dateien als Hinweis).`);
