export const CODENAMES_WORDS = [
  "Apfel", "Bank", "Berlin", "Brücke", "Ball", "Berg", "Box", "Brille", "Deckel", "Drache", 
  "Eis", "Erde", "Feder", "Feuer", "Film", "Flügel", "Geist", "Gericht", "Glocke", "Hund", 
  "Jet", "Kater", "Kette", "Kiefer", "Knopf", "Krone", "Leiter", "Licht", "Luft", "Mars", 
  "Maske", "Maus", "Mine", "Mond", "Nagel", "Note", "Nuß", "Pfeffer", "Ring", "Ritter", 
  "Satz", "Schalter", "Schiff", "Schloss", "Schule", "Stern", "Strom", "Tafel", "Taucher", "Zug", 
  "Anker", "Arzt", "Auge", "Auto", "Baum", "Bogen", "Brief", "Burg", "Dame", "Daumen", 
  "Diamant", "Dieb", "Dose", "Fackel", "Flasche", "Fuß", "Garten", "Gift", "Gold", "Gras", 
  "Hahn", "Hai", "Hammer", "Hand", "Herz", "Hitze", "Honig", "Horn", "Käse", "Katze", 
  "Kiwi", "Koch", "König", "Korken", "Kreuz", "Kuchen", "Kugel", "Laser", "Löwe", "Löffel", 
  "Nadel", "Netz", "Ozean", "Palme", "Papier", "Park", "Pilz", "Rad", "Rakete", "Raum", 
  "Abenteuer", "Agent", "Alibi", "Antenne", "Atlas", "Batterie", "Besen", "Blitz", "Boden", "Braten", 
  "Buch", "Clown", "Computer", "Dampf", "Dschungel", "Ei", "Elefant", "Engel", "Faden", "Fallschirm", 
  "Farbe", "Fenster", "Flöte", "Form", "Gabel", "Gefängnis", "Glas", "Gummi", "Gürtel", "Hafen", 
  "Helm", "Insel", "Kaffee", "Kamera", "Kanone", "Karte", "Kleber", "Koffer", "Krawatte", "Leinwand", 
  "Linse", "Mantel", "Messer", "Mikroskop", "Millionär", "Motor", "Musik", "Nase", "Nest", "Pfeife", 
  "Amboss", "Anzug", "Affe", "Axt", "Bär", "Biene", "Birne", "Brot", "Bürste", "Dach", 
  "Dinosaurier", "Dolch", "Echse", "Eimer", "Eule", "Fahne", "Fass", "Fisch", "Fliege", "Frosch", 
  "Gitarre", "Grab", "Gurke", "Handschuh", "Harfe", "Hase", "Heft", "Hexe", "Hose", "Hut", 
  "Igel", "Jaguar", "Kamm", "Kamel", "Keks", "Kissen", "Klavier", "Klee", "Knochen", "Korb", 
  "Krake", "Kran", "Kuh", "Lampe", "Lasso", "Laub", "Lippe", "Lupe", "Magnet", "Marke", 
  "Mauer", "Schrank", "Socke", "Tunnel", "Wald", "Wolke", "Zelt", "Zunge", "Zucker", "Zwerg", 
  "Uhr", "Vampir", "Vogel", "Vulkan", "Waage", "Wagen", "Wand", "Wasser", "Würfel", "Wüste", 
  "Schatten", "Schlamm", "Schlange", "Schirm", "Schnecke", "Schnee", "Schnur", "Schuh", "Schwamm", "Schwein", 
  "See", "Seife", "Seil", "Senf", "Sonne", "Spiel", "Spinne", "Spritze", "Stadt", "Stein", 
  "Stock", "Strand", "Stroh", "Superheld", "Suppe", "Tabak", "Tasche", "Taxi", "Tee", "Telefon"
];

export const WERWOLF_ROLES = {
  WERWOLF: { id: 'WERWOLF', name: 'Werwolf', description: 'Du bist ein Werwolf! Wache nachts auf und einige dich mit den anderen Werwölfen auf ein Opfer aus dem Dorf. Verhalte dich tagsüber wie ein unschuldiger Dorfbewohner.', color: 'text-red-500', bg: 'bg-red-500/20' },
  DORFBEWOHNER: { id: 'DORFBEWOHNER', name: 'Dorfbewohner', description: 'Du bist ein einfacher Dorfbewohner. Du hast nachts keine besonderen Fähigkeiten. Versuche tagsüber durch geschicktes Fragen herauszufinden, wer die Werwölfe sind.', color: 'text-green-400', bg: 'bg-green-500/20' },
  SEHERIN: { id: 'SEHERIN', name: 'Seherin', description: 'Du bist die Seherin! Du wachst jede Nacht als Erste auf und darfst die wahre Identität eines Mitspielers überprüfen. Nutze dein Wissen tagsüber weise, ohne dich sofort zu verraten.', color: 'text-purple-400', bg: 'bg-purple-500/20' },
  HEXE: { id: 'HEXE', name: 'Hexe', description: 'Du bist die Hexe! Du hast zwei Tränke: Einen Heiltrank (um das Opfer der Werwölfe zu retten) und einen Gifttrank (um nachts einen Spieler zu töten). Jeder Trank kann nur einmal im gesamten Spiel benutzt werden.', color: 'text-pink-400', bg: 'bg-pink-500/20' },
  AMOR: { id: 'AMOR', name: 'Amor', description: 'Du bist Amor! In der allerersten Nacht bestimmst du zwei Spieler, die sich unsterblich ineinander verlieben. Stirbt einer der beiden, stirbt der andere aus Liebeskummer sofort mit.', color: 'text-rose-400', bg: 'bg-rose-500/20' },
  JAEGER: { id: 'JAEGER', name: 'Jäger', description: 'Du bist der Jäger! Wenn du stirbst (egal ob durch Werwölfe, das Dorf oder die Hexe), feuerst du in deinem letzten Atemzug einen Schuss ab und reißt einen Spieler deiner Wahl mit in den Tod.', color: 'text-amber-500', bg: 'bg-amber-500/20' }
};