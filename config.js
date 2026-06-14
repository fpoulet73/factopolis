/* ============================================================
   FACTOPOLIS — Fichier de configuration
   Modifie les valeurs ci-dessous puis recharge la page (F5).

   Identifiants de ressources à utiliser dans les recettes :
     iron  = fer          coal  = charbon       wood = bois
     wheat = blé          cotton = coton        clothes = vêtement
     flour = farine        water = eau
     bread = pain         steel = acier         goods = marchandises
     fish = poisson       fish_fillet = filet   fish_oil = huile de poisson
   ============================================================ */
const CONFIG = {

  /* ---------- PRODUCTION ----------
     temps    : durée d'un cycle de production, en secondes (plus petit = plus rapide)
     entree   : ressources consommées à chaque cycle
     sortie   : ressources produites à chaque cycle
     quantite : (mine uniquement) unités extraites par cycle — fer OU charbon selon le gisement
     cout     : prix de construction en $
     entretien: coût d'entretien de base en $ par cycle (intervalleEntretien)
     formesFusion: formes autorisées pour ce type, ex. [[2,1],[3,1],[4,1],[2,2]] */
  production: {
    mine:     { temps: 2.2, quantite: 1,                                         cout: 450,  entretien: 2   },
    bucheron: { temps: 2.8, sortie: { wood: 1 },                                 cout: 350,  entretien: 1.5 },
    ferme:    { temps: 3.0, sortie: { wheat: 1 },                                cout: 300,  entretien: 1.2 },
    coton:    { temps: 3.0, sortie: { cotton: 1 },                               cout: 320,  entretien: 1.2 },
    tissage:  { temps: 3.8, entree: { cotton: 3 }, sortie: { clothes: 1 },        cout: 900,  entretien: 2.4 },
    pompe:    { temps: 2.5, sortie: { water: 1 },                                cout: 500,  entretien: 1.5 },
    pecheur:  { temps: 3.0, sortie: { fish: 1 },                                 cout: 420,  entretien: 1.4 },
    moulin:   { temps: 3.2, entree: { wheat: 2 }, sortie: { flour: 1 },          cout: 650,  entretien: 2   },
    boulangerie:{ temps: 3.5, entree: { coal: 0.5,flour: 2, water: 1 }, sortie: { bread: 1 }, cout: 950, entretien: 2.5 },
    poissonnerie:{ temps: 3.4, entree: { fish: 2 }, sortie: { fish_fillet: 1, fish_oil: 1 }, cout: 850, entretien: 2.2 },
    fonderie: { temps: 3.5, entree: { iron: 1, coal: 1 }, sortie: { steel: 1 },  cout: 900,  entretien: 3   },
    usine:    { temps: 4.0, entree: { steel: 1, wood: 1 }, sortie: { goods: 1 }, cout: 1400, entretien: 4   },
  },

  /* ---------- BÂTIMENTS CIVILS ---------- */
  batiments: {
    route:          { cout: 10  },
    usineAbandonee: { cout: 150 },
    maison:         { cout: 100 },
    entrepot:       { cout: 400 },
    citerne:        { cout: 450 },
  },

  /* ---------- MAISONS ---------- */
  maison: {
    intervalleConsommation: 60,
    revenuParUnite: 15,
    habitantsMax: 5,
    stockMax: 10,
    // Ressources indispensables pour que les habitants restent.
    // Ressources disponibles : goods, clothes, bread, fish_fillet, etc.
    ressourcesIndispensables: ['goods'],
    // Ressources requises en plus pour fusionner/monter en niveau.
    ressourcesFusion: ['goods'],
    // Ressources optionnelles consommées si disponibles, bonus revenu +20 %.
    ressourcesBonus: ['fish_fillet'],
  },

  /* ---------- IMMEUBLES (niveau 2×2) ---------- */
  immeuble: {
    intervalleConsommation: 30,
    revenuParUnite: 15,
    habitantsMax: 30,
    stockMax: 25,
    ressourcesIndispensables: ['goods','bread'],
    ressourcesFusion: ['goods','clothes','bread'],
    ressourcesBonus: ['fish_fillet'],
  },

  /* ---------- DUPLEX ----------
     Fusion : rectangle de logements PLEINS couvrant les formes indiquées. */
  duplex: {
    formes: [[2,1],[1,2]],
    intervalleConsommation: 18,
    revenuParUnite: 17,
    habitantsMax: 12,
    stockMax: 14,
    ressourcesIndispensables: ['goods'],
    ressourcesFusion: ['goods','bread'],
    ressourcesBonus: ['fish_fillet'],
  },

  /* ---------- MAISONS EN RANGÉE ---------- */
  rangee: {
    formes: [[3,1],[1,3]],
    intervalleConsommation: 16,
    revenuParUnite: 18,
    habitantsMax: 20,
    stockMax: 18,
    ressourcesIndispensables: ['goods'],
    ressourcesFusion: ['goods','bread'],
    ressourcesBonus: ['fish_fillet'],
  },

  /* ---------- RÉSIDENCE ---------- */
  residence: {
    formes: [[4,1],[1,4]],
    intervalleConsommation: 14,
    revenuParUnite: 20,
    habitantsMax: 28,
    stockMax: 22,
    ressourcesIndispensables: ['goods','bread'],
    ressourcesFusion: ['goods','clothes','bread'],
    ressourcesBonus: ['fish_fillet'],
  },

  /* ---------- GRAND IMMEUBLE ---------- */
  grandImmeuble: {
    formes: [[3,2],[2,3]],
    intervalleConsommation: 10,
    revenuParUnite: 18,
    habitantsMax: 60,
    stockMax: 40,
    ressourcesIndispensables: ['goods','bread'],
    ressourcesFusion: ['goods','clothes','bread'],
    ressourcesBonus: ['fish_fillet'],
  },

  /* ---------- TOUR (niveau 3×3) ---------- */
  tour: {
    formes: [[3,3]],
    intervalleConsommation: 8,
    revenuParUnite: 19,
    habitantsMax: 95,
    stockMax: 60,
    ressourcesIndispensables: ['goods','bread','clothes'],
    ressourcesFusion: ['goods','clothes','bread'],
    ressourcesBonus: ['fish_fillet'],
  },

  /* ---------- GRATTE-CIEL ---------- */
  gratteCiel: {
    formes: [[4,4]],
    intervalleConsommation: 7,
    revenuParUnite: 20,
    habitantsMax: 150,
    stockMax: 80,
    ressourcesIndispensables: ['goods','bread','clothes'],
    ressourcesFusion: ['goods','clothes','bread'],
    ressourcesBonus: ['fish_fillet'],
  },

  /* ---------- FUSION INDUSTRIELLE ----------
     Les bâtiments de production IDENTIQUES (même type, même minerai pour les
     mines) couvrant un rectangle (2×1, 3×1, 4×1, 2×2, 3×2, 4×4…) fusionnent.
     Production du bâtiment fusionné = nombre de cases × facteur.
     formesFusion : formes par défaut pour toutes les usines. Les orientations
       inversées sont ajoutées automatiquement : [2,1] autorise aussi [1,2].
     formesParType : surcharge par type. Clés possibles :
       mine, bucheron, ferme, coton, tissage, pompe, pecheur, moulin, boulangerie,
       poissonnerie, fonderie, usine.
       On peut aussi écrire les formes sous forme de texte : "2x1".
     facteurs : { nombreDeCases: facteur } — le palier inférieur s'applique. */
  industrie: {
    formesFusion: [[2,1],[3,1],[4,1],[2,2],[3,2],[4,4]],
    formesParType: {
      ferme: [[2,1],[3,1],[4,1],[2,2]],
      coton: [[2,1],[2,2]],
      tissage: [[2,1],[2,2]],
      moulin: [1,1],
      pecheur: [[1,1]],
      usine: [[2,1],[2,2],[3,2],[4,4]],
    },
    facteurs: { 2:1.15, 3:1.3, 4:1.5, 6:1.75, 16:2.5 },
    intervalleEntretien: 10,    // secondes entre deux prélèvements d'entretien
    entretienEnPause: 0.5,      // fraction de l'entretien payée par un site mis en pause
    rayonBase:    6,            // rayon minimal (bâtiment 1×1)
    rayonFacteur: 4,            // ajout par racine carrée de l'aire
  },

  /* ---------- PÉNURIE ----------
     Un logement sans marchandises pendant `delai` secondes se dégrade :
     - bâtiment fusionné → il se sépare en maisons individuelles, et les
       habitants en trop quittent la ville à pied ;
     - maison simple → un habitant part, à chaque cycle de pénurie.
     La fusion exige d'être plein ET approvisionné en marchandises. */
  penurie: {
    delai: 60,
  },

  /* ---------- HABITANTS ---------- */
  habitants: {
    vitesseMarche: 1.3,         // tuiles par seconde — les nouveaux arrivants rejoignent
                                // leur logement à pied depuis le bord de la carte
    croissanceBonus: {
      seuilStock: 0.1,          // fraction du stock max requise pour déclencher la croissance bonus
      intervalle:  30,          // secondes entre chaque habitant supplémentaire
    },
  },

  /* ---------- ÉCONOMIE ---------- */
  economie: {
    taxeParHabitant: 2,         // $ versés par habitant…
    intervalleTaxes: 20,        // …toutes les X secondes
  },

  /* ---------- CAMIONS ---------- */
  camions: {
    capacite: 6,                // unités transportées par voyage
    vitesse: 3.4,               // tuiles parcourues par seconde
  },

  /* ---------- ENTREPÔT ---------- */
  entrepot: {
    stockParCase: 20,           // capacité par ressource et par case de l'entrepôt
    rayonBase:    5,            // rayon minimal (entrepôt 1×1)
    rayonFacteur: 3,            // ajout par racine carrée de l'aire (formule : base + √aire × facteur)
    // formes de fusion (largeur × hauteur, les deux orientations sont gérées automatiquement)
    formesFusion: [[2,1],[3,1],[2,2],[3,2],[3,3],[4,4]],
  },

  /* ---------- CITERNE D'EAU ---------- */
  citerne: {
    stockParCase: 40,
    rayonBase: 5,
    rayonFacteur: 3,
    rayonBoulangerie: 8,
  },

  /* ---------- LOGISTIQUE ---------- */
  logistique: {
    garage: { cout: 1200 },
    vehicules: {
      minerai:      { nom:'Camion minerai',      icone:'🚛', ressources:['iron','coal'], cout:800,  capacite:15, vitesse:4.0 },
      bois:         { nom:'Camion bois',          icone:'🚜', ressources:['wood'],        cout:600,  capacite:15, vitesse:4.0 },
      ble:          { nom:'Camion blé',           icone:'🚜', ressources:['wheat'],       cout:550,  capacite:15, vitesse:4.0 },
      coton:        { nom:'Chariot coton',        icone:'🛒', ressources:['cotton','clothes'], cout:550, capacite:15, vitesse:4.0 },
      farine:       { nom:'Camion farine',        icone:'🚚', ressources:['flour'],       cout:650,  capacite:15, vitesse:3.8 },
      citerne:      { nom:'Camion citerne',       icone:'🚛', ressources:['water'],       cout:750,  capacite:20, vitesse:3.5 },
      pain:         { nom:'Camion pain',          icone:'🚚', ressources:['bread'],       cout:700,  capacite:15, vitesse:3.8 },
      poisson:      { nom:'Chariot poisson',      icone:'🛒', ressources:['fish','fish_fillet','fish_oil'], cout:650, capacite:14, vitesse:3.8 },
      acier:        { nom:'Camion acier',         icone:'🚚', ressources:['steel'],       cout:1000, capacite:12, vitesse:3.5 },
      marchandises: { nom:'Camion marchandises',  icone:'🚐', ressources:['goods'],       cout:700,  capacite:12, vitesse:3.5 },
    },
  },
};
