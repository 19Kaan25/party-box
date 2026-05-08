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

export const IMPOSTER_CATEGORIES = {
  orte: {
    id: 'orte',
    name: 'Orte & Gebäude',
    color: 'text-blue-400',
    bg: 'bg-blue-500/20',
    words: [
      "Krankenhaus", "Supermarkt", "Leuchtturm", "Flughafen", "Bahnhof", "Polizeiwache",
      "Feuerwehrwache", "Schule", "Universität", "Bibliothek", "Museum", "Kino", "Theater",
      "Schwimmbad", "Fitnessstudio", "Restaurant", "Bäckerei", "Metzgerei", "Bank",
      "Postamt", "Apotheke", "Tankstelle", "Kirche", "Moschee", "Friedhof", "Zoo",
      "Freizeitpark", "Zirkus", "Strand", "Wald", "Berghütte", "Campingplatz", "Bauernhof",
      "Gefängnis", "Gerichtsgebäude", "Rathaus", "Burg", "Schloss", "Bürogebäude", "Fabrik",
      "U-Boot", "Raumstation", "Hotel", "Casino", "Stadion", "Konzerthalle", "Labor"
    ]
  },
  berufe: {
    id: 'berufe',
    name: 'Berufe',
    color: 'text-orange-400',
    bg: 'bg-orange-500/20',
    words: [
      "Arzt", "Zahnarzt", "Tierarzt", "Krankenpfleger", "Polizist", "Feuerwehrmann",
      "Richter", "Anwalt", "Lehrer", "Professor", "Architekt", "Ingenieur", "Mechaniker",
      "Klempner", "Elektriker", "Tischler", "Koch", "Bäcker", "Kellner", "Pilot",
      "Flugbegleiter", "Busfahrer", "Lokführer", "Kapitän", "Astronaut", "Soldat",
      "Bauer", "Gärtner", "Friseur", "Kosmetiker", "Journalist", "Fotograf", "Schauspieler",
      "Musiker", "Sänger", "Maler", "Autor", "Programmierer", "Bänker", "Verkäufer",
      "Detektiv", "Spion", "Zauberer", "Clown", "Präsident"
    ]
  },
  essen: {
    id: 'essen',
    name: 'Essen & Trinken',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/20',
    words: [
      "Pizza", "Burger", "Döner", "Sushi", "Spaghetti", "Lasagne", "Pommes", "Currywurst",
      "Steak", "Schnitzel", "Bratwurst", "Salat", "Suppe", "Brot", "Brötchen", "Croissant",
      "Pfannkuchen", "Waffel", "Schwarzwälder Kirschtorte", "Apfelkuchen", "Eiscreme",
      "Schokolade", "Gummibärchen", "Chips", "Popcorn", "Apfel", "Banane", "Erdbeere",
      "Wassermelone", "Trauben", "Kartoffel", "Tomate", "Gurke", "Kaffee", "Tee", "Milch",
      "Wasser", "Cola", "Limonade", "Bier", "Wein", "Cocktail", "Käse", "Ei", "Joghurt"
    ]
  },
  tiere: {
    id: 'tiere',
    name: 'Tiere',
    color: 'text-amber-400',
    bg: 'bg-amber-500/20',
    words: [
      "Hund", "Katze", "Maus", "Pferd", "Kuh", "Schwein", "Schaf", "Ziege", "Huhn",
      "Ente", "Gans", "Kaninchen", "Hamster", "Meerschweinchen", "Papagei", "Taube",
      "Adler", "Eule", "Schwan", "Frosch", "Schlange", "Krokodil", "Schildkröte",
      "Hai", "Delfin", "Wal", "Oktopus", "Qualle", "Löwe", "Tiger", "Elefant",
      "Giraffe", "Zebra", "Nashorn", "Nilpferd", "Affe", "Gorilla", "Känguru",
      "Koala", "Pinguin", "Eisbär", "Braunbär", "Wolf", "Fuchs", "Hirsch", "Eichhörnchen"
    ]
  },
  alltag: {
    id: 'alltag',
    name: 'Alltagsgegenstände',
    color: 'text-slate-400',
    bg: 'bg-slate-500/20',
    words: [
      "Smartphone", "Laptop", "Fernseher", "Kopfhörer", "Kaffeemaschine", "Toaster",
      "Mikrowelle", "Kühlschrank", "Waschmaschine", "Staubsauger", "Bügeleisen",
      "Föhn", "Zahnbürste", "Seife", "Handtuch", "Toilettenpapier", "Schlüssel",
      "Portemonnaie", "Uhr", "Brille", "Regenschirm", "Rucksack", "Koffer",
      "Tasse", "Teller", "Gabel", "Messer", "Löffel", "Pfanne", "Topf", "Stift",
      "Block", "Buch", "Schere", "Klebeband", "Lampe", "Spiegel", "Kamm", "Besen"
    ]
  },
  freizeit: {
    id: 'freizeit',
    name: 'Freizeit & Hobbys',
    color: 'text-pink-400',
    bg: 'bg-pink-500/20',
    words: [
      "Fußball", "Basketball", "Tennis", "Volleyball", "Schwimmen", "Joggen",
      "Fahrradfahren", "Wandern", "Klettern", "Skifahren", "Snowboarden", "Surfen",
      "Tauchen", "Angeln", "Reiten", "Yoga", "Tanzen", "Singen", "Gitarre spielen",
      "Klavier spielen", "Malen", "Zeichnen", "Fotografieren", "Lesen", "Schreiben",
      "Kochen", "Backen", "Gärtnern", "Stricken", "Nähen", "Schach", "Kartenspiele",
      "Videospiele", "Zaubern", "Campen", "Bungee-Jumping", "Fallschirmspringen"
    ]
  },
  fahrzeuge: {
    id: 'fahrzeuge',
    name: 'Transport & Fahrzeuge',
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/20',
    words: [
      "Auto", "Fahrrad", "Motorrad", "Roller", "Bus", "Straßenbahn", "U-Bahn",
      "Zug", "Flugzeug", "Hubschrauber", "Heißluftballon", "Schiff", "Boot",
      "Segelboot", "U-Boot", "Fähre", "Kreuzfahrtschiff", "Traktor", "Bagger",
      "Kran", "Gabelstapler", "LKW", "Feuerwehrauto", "Krankenwagen", "Polizeiauto",
      "Taxi", "Rakete", "Spaceshuttle", "Skateboard", "Inlineskates", "Schlitten", "Kutsche"
    ]
  },
  popkultur: {
    id: 'popkultur',
    name: 'Filme & Popkultur',
    color: 'text-purple-400',
    bg: 'bg-purple-500/20',
    words: [
      "Harry Potter", "Star Wars", "Der Herr der Ringe", "Marvel", "Batman", "Spider-Man",
      "Superman", "James Bond", "Indiana Jones", "Jurassic Park", "Matrix", "Titanic",
      "Avatar", "Der König der Löwen", "Spongebob", "Die Simpsons", "Game of Thrones",
      "Stranger Things", "Mickey Mouse", "Super Mario", "Pokémon", "Pikachu", "Barbie",
      "Lego", "Minecraft", "Disney", "Netflix", "YouTube", "TikTok", "Instagram",
      "Oscar", "Grammy", "Super Bowl", "Olympische Spiele", "Halloween", "Weihnachten"
    ]
  }
};
