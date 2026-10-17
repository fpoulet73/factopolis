/* ============================================================
   FACTOPOLIS — Fichier de configuration
   Modifie les valeurs ci-dessous puis recharge la page (F5).

   Identifiants de ressources à utiliser dans les recettes :
     iron  = fer          coal  = charbon       wood = bois
     wheat = blé          cotton = coton        clothes = vêtement
     flour = farine        water = eau
     bread = pain         steel = acier         goods = marchandises
     fish = poisson       fish_fillet = filet   fish_oil = huile de poisson
   Gisements et ressources de base ajoutés :
     copper_ore = minerai de cuivre   gold_ore = minerai d'or (précieux)
     limestone  = calcaire            sand = sable          clay = argile
     oil        = pétrole brut
   Produits intermédiaires et matériaux de chantier :
     copper = cuivre      copper_wire = fil de cuivre   gold = or
     steel_beam = poutrelle en acier  steel_plate = plaque en acier
     cement = ciment      concrete = béton     glass = verre   window = vitre
     rope = corde         paint = peinture jaune        nails = clous
     chemicals = produits chimiques   fuel = carburant  plastic = plastique
     glue = colle         circuit = carte électronique
   Biens de luxe : furniture = meubles, appliances = électroménager,
     jewelry = bijoux, quantum_chip = processeur quantique
   Ressources spatiales (fusées) : helium3 = hélium-3, xenite = xénite
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
    pecheur:  { temps: 3.0, sortie: { fish: 1 },                                 cout: 420,  entretien: 1.4, rayonPeche: 5 },
    moulin:   { temps: 3.2, entree: { wheat: 2 }, sortie: { flour: 1 },          cout: 650,  entretien: 2   },
    boulangerie:{ temps: 3.5, entree: { coal: 0.5,flour: 2, water: 1 }, sortie: { bread: 1 }, cout: 950, entretien: 2.5 },
    poissonnerie:{ temps: 3.4, entree: { fish: 2 }, sortie: { fish_fillet: 1, fish_oil: 1 }, cout: 850, entretien: 2.2 },
    fonderie: { temps: 3.5, entree: { iron: 1, coal: 1 }, sortie: { steel: 1 },  cout: 900,  entretien: 3   },
    usine:    { temps: 4.0, entree: { steel: 1, wood: 1 }, sortie: { goods: 1 }, cout: 1400, entretien: 4   },

    // --- extraction avancée ---
    // La mine extrait aussi le cuivre, l'or, le calcaire (carrière), le sable et l'argile
    // selon la tuile où elle est posée. Le puits de pétrole se pose sur une nappe.
    puitsPetrole:   { temps: 3.0, sortie: { oil: 1 },                                              cout: 1800, entretien: 3   },
    // --- métallurgie ---
    fonderieCuivre: { temps: 3.6, entree: { copper_ore: 2, coal: 1 }, sortie: { copper: 1 },       cout: 1100, entretien: 3   },
    trefilerie:     { temps: 3.0, entree: { copper: 1 },              sortie: { copper_wire: 2 },  cout: 1000, entretien: 2.5 },
    affinerieOr:    { temps: 5.0, entree: { gold_ore: 3, chemicals: 1 }, sortie: { gold: 1 },      cout: 2400, entretien: 4   },
    laminoir:       { temps: 4.0, entree: { steel: 2 },               sortie: { steel_beam: 1 },   cout: 1300, entretien: 3.5 },
    tolerie:        { temps: 3.2, entree: { steel: 1 },               sortie: { steel_plate: 1 },  cout: 1200, entretien: 3   },
    clouterie:      { temps: 3.0, entree: { steel: 1 },               sortie: { nails: 4 },        cout: 900,  entretien: 2.2 },
    // --- matériaux de construction ---
    cimenterie:     { temps: 4.5, entree: { limestone: 2, clay: 1, coal: 1 }, sortie: { cement: 2 }, cout: 1500, entretien: 3.5 },
    centraleBeton:  { temps: 3.5, entree: { cement: 1, sand: 2, water: 1 },   sortie: { concrete: 2 }, cout: 1200, entretien: 3 },
    verrerie:       { temps: 4.0, entree: { sand: 2, limestone: 1, coal: 1 }, sortie: { glass: 2 },   cout: 1300, entretien: 3   },
    vitrerie:       { temps: 3.0, entree: { glass: 2 },               sortie: { window: 1 },       cout: 900,  entretien: 2.2 },
    corderie:       { temps: 3.4, entree: { cotton: 3 },              sortie: { rope: 2 },         cout: 800,  entretien: 2   },
    // --- chimie (pétrole) ---
    raffinerie:     { temps: 4.5, entree: { oil: 3 },                 sortie: { fuel: 1, chemicals: 2 }, cout: 2600, entretien: 5 },
    usineChimique:  { temps: 4.0, entree: { chemicals: 2, water: 1 }, sortie: { plastic: 1, glue: 1 }, cout: 2000, entretien: 4 },
    peinture:       { temps: 3.6, entree: { chemicals: 1, clay: 1 },  sortie: { paint: 2 },        cout: 1400, entretien: 3   },
    // --- électronique et biens de luxe ---
    electronique:   { temps: 5.0, entree: { copper_wire: 2, plastic: 1, gold: 1 }, sortie: { circuit: 2 }, cout: 3000, entretien: 5 },
    ebenisterie:    { temps: 4.5, entree: { wood: 2, nails: 2, glue: 1 },          sortie: { furniture: 1 }, cout: 1600, entretien: 3.2 },
    electromenager: { temps: 5.0, entree: { circuit: 1, steel_plate: 1, plastic: 1, copper_wire: 1 }, sortie: { appliances: 1 }, cout: 2800, entretien: 4.5 },
    joaillerie:     { temps: 5.0, entree: { gold: 1, glass: 1 },                   sortie: { jewelry: 2 },  cout: 2500, entretien: 4 },
    laboQuantique:  { temps: 8.0, entree: { circuit: 2, xenite: 1, helium3: 1 },   sortie: { quantum_chip: 1 }, cout: 8000, entretien: 10 },
  },

  /* ---------- MATÉRIAUX DE CHANTIER ----------
     Les grands bâtiments (port, aéroport, centre spatial, usines chimiques et
     avancées) exigent, EN PLUS de leur prix, des matériaux stockés dans un
     ENTREPÔT du joueur dont le rayon d'action couvre la case de construction (les
     entrepôts se cochent comme d'habitude : il faut y accepter ces ressources).
     Les matériaux sont prélevés à la pose (entrepôts les plus proches d'abord).
     Les usines avancées (clés de `production` côté moteur : refinery, electronics_plant…)
     peuvent aussi en exiger lors de la spécialisation d'une usine abandonnée.
     Les gares, quais et dépôts de train n'en demandent pas (on peut en ajouter ici :
     clés train_station, train_platform, train_depot).
     actif : false pour désactiver complètement l'exigence (mode bac à sable). */
  materiauxChantier: {
    actif: true,
    batiments: {
      // port
      boat_depot:     { concrete: 6, steel_beam: 3, rope: 6, paint: 2 },
      // aéroport
      plane_depot:    { steel_beam: 6, steel_plate: 4, concrete: 4, paint: 1 },  // hangar
      air_terminal:   { steel_beam: 3, concrete: 4, window: 4, copper_wire: 2, circuit: 1 },
      air_tower:      { steel_beam: 2, concrete: 3, window: 3, copper_wire: 2, circuit: 2 },
      air_runway:     { concrete: 4, paint: 1 },
      air_taxi:       { concrete: 2, paint: 1 },
      air_parking:    { concrete: 1, paint: 1 },
      // usines avancées (spécialisation d'une usine abandonnée)
      refinery:          { steel_beam: 3, steel_plate: 4, concrete: 4 },
      chem_plant:        { steel_plate: 4, concrete: 3, glass: 2 },
      gold_refinery:     { steel_beam: 2, concrete: 3 },
      electronics_plant: { steel_beam: 2, concrete: 4, window: 3, copper_wire: 4 },
      appliance_factory: { steel_beam: 2, concrete: 3, window: 2 },
      quantum_lab:       { steel_beam: 4, concrete: 8, window: 6, circuit: 6 },
      // espace
      space_center:   { steel_beam: 30, steel_plate: 20, concrete: 40, window: 10, copper_wire: 16, circuit: 12, paint: 6 },
    },
  },

  /* ---------- CENTRE SPATIAL ----------
     Bâtiment 3×3 posé depuis le menu Bâtiments. Il reçoit des pièces de fusée par
     camion, assemble la fusée sur son pas de tir puis la lance : au retour de mission
     la capsule rapporte des ressources introuvables sur Terre.
       fusee           : pièces consommées par lancement
       tempsAssemblage : secondes de jeu (à plein effectif d'ouvriers)
       dureeMission    : secondes de jeu entre le décollage et le retour de la capsule
       cargaison       : ressources rapportées à chaque mission */
  centreSpatial: {
    cout: 60000,
    entretien: 25,
    ouvriers: 12,
    taille: 3,
    fusee: { steel_plate: 8, circuit: 4, fuel: 12, copper_wire: 4 },
    tempsAssemblage: 60,
    dureeMission: 90,
    cargaison: { helium3: 6, xenite: 4 },
  },

  /* ---------- BÂTIMENTS CIVILS ---------- */
  batiments: {
    route:          { cout: 10  },
    usineAbandonee: { cout: 150 },
    maison:         { cout: 100 },
    entrepot:       { cout: 400 },
    citerne:        { cout: 450 },
  },

  /* ---------- GÉNÉRATION DU MONDE ----------
     Les pourcentages ci-dessous pilotent la création des nouvelles cartes
     et l'apparition du terrain lors des expansions.
     Ils ne sont plus modifiables depuis l'UI de création de carte. */
  monde: {
    taille: 128,
    joueursMax: 4,
    eauPct: 10,
    relief: {
      niveaux: 8,
      hauteurPalierPx: 14,
      variation: 0.18,
      plateaux: 0.22,
      neigeNiveau: 6,
      neigeFondu: 0.35,
    },
    ressources: {
      tree:   4,
      wheat:  0.09,
      cotton: 0.05,
      iron:   0.1,
      coal:   0.1,
      copper:    0.1,   // minerai de cuivre (fils électriques)
      limestone: 0.1,   // calcaire (ciment, verre)
      oil:       0.05,  // nappes de pétrole (chimie, carburant)
      gold:      0.025, // minerai d'or : précieux et rare (électronique, bijoux)
    },
  },

  /* ---------- MAISONS ---------- */
  maison: {
    intervalleConsommation: 60,
    revenuParUnite: 15,
    habitantsMax: 5,
    stockMax: 10,
    // Ressources indispensables pour que les habitants restent.
    // Ressources disponibles : goods, clothes, bread, fish_fillet, etc.
    ressourcesIndispensables: ['fish_fillet'],
    // Ressources requises pour l'upgrade : compteur à atteindre, non consommé en continu.
    ressourcesUpgrade: { goods: 50 },
    // Ressources optionnelles consommées si disponibles : leur prix de vente
    // s'ajoute au revenu du cycle (l'huile de poisson éclaire les foyers).
    ressourcesBonus: ['fish_oil'],
  },

  /* ---------- IMMEUBLES (niveau 2×2) ---------- */
  immeuble: {
    intervalleConsommation: 30,
    revenuParUnite: 15,
    habitantsMax: 30,
    stockMax: 25,
    ressourcesIndispensables: ['fish_fillet','bread'],
    // les étages supérieurs se vitrent : il faut des vitres pour fusionner plus haut
    ressourcesUpgrade: { goods: 150, window: 20 },
    ressourcesBonus: ['fish_oil'],
  },

  /* ---------- DUPLEX ----------
     Fusion : rectangle de logements PLEINS couvrant les formes indiquées. */
  duplex: {
    formes: [[2,1],[1,2]],
    intervalleConsommation: 18,
    revenuParUnite: 17,
    habitantsMax: 12,
    stockMax: 14,
    ressourcesIndispensables: ['fish_fillet'],
    ressourcesUpgrade: { goods: 150 },
    ressourcesBonus: ['fish_oil'],
  },

  /* ---------- MAISONS EN RANGÉE ---------- */
  rangee: {
    formes: [[3,1],[1,3]],
    intervalleConsommation: 16,
    revenuParUnite: 18,
    habitantsMax: 20,
    stockMax: 18,
    ressourcesIndispensables: ['fish_fillet'],
    ressourcesUpgrade: { goods: 250 },
    ressourcesBonus: ['fish_oil'],
  },

  /* ---------- RÉSIDENCE ---------- */
  residence: {
    formes: [[4,1],[1,4]],
    intervalleConsommation: 14,
    revenuParUnite: 20,
    habitantsMax: 28,
    stockMax: 22,
    ressourcesIndispensables: ['fish_fillet','bread'],
    ressourcesUpgrade: { goods: 350 },
    ressourcesBonus: ['fish_oil'],
  },

  /* ---------- GRAND IMMEUBLE ---------- */
  grandImmeuble: {
    formes: [[3,2],[2,3]],
    intervalleConsommation: 10,
    revenuParUnite: 18,
    habitantsMax: 60,
    stockMax: 40,
    ressourcesIndispensables: ['fish_fillet','bread'],
    ressourcesUpgrade: { goods: 400, concrete: 40, window: 30 },
    ressourcesBonus: ['fish_oil'],
  },

  /* ---------- TOUR (niveau 3×3) ---------- */
  tour: {
    formes: [[3,3]],
    intervalleConsommation: 8,
    revenuParUnite: 19,
    habitantsMax: 95,
    stockMax: 60,
    ressourcesIndispensables: ['fish_fillet','bread','clothes'],
    // un gratte-ciel exige une structure acier + béton et des façades vitrées
    ressourcesUpgrade: { goods: 500, concrete: 80, window: 60, steel_beam: 30 },
    ressourcesBonus: ['fish_oil'],
  },

  /* ---------- GRATTE-CIEL ---------- */
  gratteCiel: {
    formes: [[4,4]],
    intervalleConsommation: 7,
    revenuParUnite: 20,
    habitantsMax: 180,
    stockMax: 80,
    ressourcesIndispensables: ['fish_fillet','bread','clothes'],
    ressourcesUpgrade: {},
    ressourcesBonus: ['fish_oil'],
  },

  /* ---------- MAISONS DE LUXE ----------
     Débloquées quand le joueur atteint `seuilHabitants` habitants (déblocage
     définitif). Une maison de luxe coûte `multiplicateurCout` × le prix d'une
     maison basique (batiments.maison.cout).
     Agrandissement : il se déclenche comme pour une maison basique (logement
     plein + ressources d'upgrade livrées), mais la maison s'étend sur les cases
     LIBRES voisines (herbe plate au même niveau, sans route, rail ni bâtiment)
     au lieu de fusionner avec ses voisines. Pas d'immeuble : la maison s'étale
     (jardin, piscine, tennis…) et gagne au plus un étage. Le nombre d'habitants
       double à chaque agrandissement et leur classe progresse (cf. classesHabitants) :
       maison  1 case  →  5 ouvriers
       villa   2 cases → 10 employés
       manoir  4 cases → 20 cadres
       domaine 9 cases → 40 patrons (taille maximale)
     Chaque niveau accepte les mêmes clés que les logements basiques, plus
     `classe` (clé de classesHabitants).
     Les classes aisées veulent du confort : meubles (bois + clous + colle) pour les
     employés, électroménager pour les cadres, bijoux en or et processeurs quantiques
     (domotique) pour les patrons. */
  maisonLuxe: {
    seuilHabitants: 100,
    multiplicateurCout: 5,
    maison: {
      classe: 'ouvrier',
      intervalleConsommation: 60,
      habitantsMax: 5,
      stockMax: 10,
      ressourcesIndispensables: ['fish_fillet'],
      ressourcesUpgrade: { goods: 60, clothes: 30 },
      ressourcesBonus: ['fish_oil'],
    },
    villa: {
      classe: 'employe',
      formes: [[2,1],[1,2]],
      intervalleConsommation: 40,
      habitantsMax: 10,
      stockMax: 14,
      ressourcesIndispensables: ['fish_fillet','bread'],
      ressourcesUpgrade: { goods: 150, clothes: 75, furniture: 30 },
      ressourcesBonus: ['fish_oil','furniture'],
    },
    manoir: {
      classe: 'cadre',
      formes: [[2,2]],
      intervalleConsommation: 30,
      habitantsMax: 20,
      stockMax: 20,
      ressourcesIndispensables: ['fish_fillet','bread','clothes','furniture'],
      ressourcesUpgrade: { goods: 300, clothes: 150, appliances: 40, jewelry: 20 },
      ressourcesBonus: ['fish_oil','appliances'],
    },
    domaine: {
      classe: 'patron',
      formes: [[3,3]],
      intervalleConsommation: 20,
      habitantsMax: 40,
      stockMax: 30,
      ressourcesIndispensables: ['fish_fillet','bread','clothes','furniture','appliances'],
      ressourcesUpgrade: {},
      ressourcesBonus: ['fish_oil','jewelry','quantum_chip'],
    },
  },

  /* ---------- CLASSES D'HABITANTS ----------
     Les logements basiques (maisons et toutes leurs fusions) abritent des
     ouvriers. Les maisons de luxe font monter la classe de leurs habitants à
     chaque agrandissement (cf. maisonLuxe).
       taxe   : multiplicateur de la taxe par habitant (economie.taxeParHabitant)
       revenu : multiplicateur du revenu des ressources consommées par le logement */
  classesHabitants: {
    ouvrier: { nom: 'Ouvrier', pluriel: 'Ouvriers', icone: '👷', taxe: 1, revenu: 1 },
    employe: { nom: 'Employé', pluriel: 'Employés', icone: '👔', taxe: 2, revenu: 2 },
    cadre:   { nom: 'Cadre',   pluriel: 'Cadres',   icone: '💼', taxe: 4, revenu: 4 },
    patron:  { nom: 'Patron',  pluriel: 'Patrons',  icone: '🎩', taxe: 8, revenu: 8 },
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
    formesFusion: [[2,1],[3,1],[4,1],[2,2],[3,2],[3,3],[4,4]],
    formesParType: {
      ferme: [[2,1],[3,1],[4,1],[2,2]],
      coton: [[2,1],[2,2]],
      tissage: [[2,1],[2,2]],
      moulin: [[1,1]],
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
    // Distance (cases) jusqu'à laquelle les habitants d'un logement vont travailler :
    // base + plus grand côté du logement × parTaille (maison 6, immeuble 2×2 8, gratte-ciel 12).
    // Au-delà, il faut un arrêt de bus pour amener des navetteurs.
    rayonTravail: { base: 4, parTaille: 2 },
    croissanceBonus: {
      seuilStock: 0.1,          // fraction du stock max requise pour déclencher la croissance bonus
      intervalle:  30,          // secondes entre chaque habitant supplémentaire
    },
  },

  /* ---------- ÉCONOMIE ---------- */
  economie: {
    taxeParHabitant: 2,         // $ versés par habitant…
    intervalleTaxes: 20,        // …toutes les X secondes
    // Prix de vente aux habitants, par ressource consommée et par habitant.
    // Le revenu d'un logement par cycle = somme des prix des ressources qu'il
    // consomme, multipliée par son nombre d'habitants.
    prixVente: {
      marchandises: 3,          // goods  (outils de construction)
      pain:         4,          // bread
      vetement:     9,          // clothes
      filetPoisson: 3,          // fish_fillet (bonus)
      // ressources rarement consommées par les logements (configs personnalisées)
      poisson:      2,          // fish
      huilePoisson: 2,          // fish_oil (bonus des logements)
      farine:       2,          // flour
      eau:          1,          // water
      ble:          2,          // wheat
      coton:        3,          // cotton
      fer:          3,          // iron
      charbon:      2,          // coal
      bois:         2,          // wood
      acier:        6,          // steel
      terre:        0,          // dirt
      // biens de luxe (classes aisées : × multiplicateur de revenu de la classe)
      meubles:      5,          // furniture
      electromenager: 8,        // appliances
      bijoux:       12,         // jewelry
      processeurQuantique: 20,  // quantum_chip
    },
  },

  /* ---------- CAMIONS ---------- */
  camions: {
    capacite: 6,                // unités transportées par voyage
    vitesse: 3.4,               // tuiles parcourues par seconde
  },

  /* ---------- ENTREPÔT ---------- */
  entrepot: {
    stockParCase: 40,           // capacité par ressource et par case de l'entrepôt (le marché garde 20 : marche.stockParCase)
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

  /* ---------- SIGNAUX FERROVIAIRES ----------
     Clé = direction de MARCHE du train protégé (coordonnées MONDE).
       '1,0' = train vers l'est, '-1,0' = ouest, '0,1' = sud, '0,-1' = nord,
       '1,1' = SE, '1,-1' = NE, '-1,1' = SO, '-1,-1' = NO.
     along : px écran vers le train qui arrive (le long du rail, depuis le centre de la tuile).
     right  : px écran à la DROITE du mécanicien (vue du conducteur).
     Le feu reste physiquement du même côté du rail à toutes les rotations caméra. */
  rails: {
    signaux: {
      deplacement: {
        '1,0':   { along: 7, right: 7 }, //diagonale 1  N -> S
        '-1,0':  { along: -7, right: 20 }, //diagonale 1  S -> N
        '0,1':   { along: 7, right: 20 }, // diagonale 1
        '0,-1':  { along: -7, right: 7 }, // diagonale 1
        '1,1':   { along: 7, right: 20 }, // vertical N -> S
        '-1,-1': { along: -7, right: 20 },// vertical S -> N
        '1,-1':  { along: 0, right: 7 },  //horitontales G -> D
        '-1,1':  { along: 0, right: 20 }, //horizontales D -> G
      },
    },
  },

  /* ---------- LOGISTIQUE ---------- */
  logistique: {
    tauxHausseMensuelle: 0.03,   // hausse mensuelle du coût d'entretien pour tous les véhicules (+3 % par défaut)
    garage: { cout: 1200, tempsArret: 2 },  // tempsArret : heures de jeu d'arrêt pour chargement/déchargement
    train:  {
      cout: 20000,                 // prix d'achat d'une locomotive
      coutWagon: 2000,             // prix d'achat d'un wagon (tous types)
      tempsArret: 2.5,             // heures de jeu d'arrêt standard du train
      tempsArretGareSecondes: 5,   // secondes réelles d'arrêt lorsqu'une gare est utilisée comme étape
      coutEntretienJournalier: 30, // $ prélevés chaque jour de jeu par train
      peageRailParTuile: 1,        // $ payés au propriétaire des rails par tuile empruntée qui ne lui appartient pas (péréqué au moment de l'entretien)
      /* Améliorations moteur : chaque niveau multiplie la vitesse ET le coût
         d'entretien journalier par le facteur. cout = prix d'achat unique. */
      ameliorationsMoteur: [
        { facteur: 1.5, cout: 8000  },
        { facteur: 2,   cout: 14000 },
        { facteur: 2.5, cout: 22000 },
        { facteur: 3,   cout: 34000 },
      ],
    },
    /* ---------- GARES ----------
       rayon            : cases autour de la gare où les habitants sans emploi deviennent voyageurs
       tempsRemplissage : (indicatif) remplissage des voyageurs, en gtime-secondes
       tarif            : $ par voyageur et par case parcourue (distance de Manhattan entre gares)
       tarifFret        : $ par unité livrée = prix commercial × distance × tarifFret */
    gare: {
      rayon: 12,
      tempsRemplissage: 8,
      tarif: 0.8,
      tarifFret: 0.08,
    },
    /* ---------- VÉHICULES ROUTIERS ----------
       coutEntretienJournalier : $ prélevés chaque jour de jeu (hausse mensuelle ci-dessus).
       Surcharges optionnelles : nom, icone, ressources, cout, capacite, vitesse.
       Types achetables : minerai, plateau, cereale, marchandises, frigo, citerne, bus. */
    vehicules: {
      minerai:      { coutEntretienJournalier: 7,  cout: 800,  capacite: 15, vitesse: 4.0 },
      plateau:      { coutEntretienJournalier: 7,  cout: 900,  capacite: 14, vitesse: 3.8 },
      cereale:      { coutEntretienJournalier: 6,  cout: 600,  capacite: 15, vitesse: 4.0 },
      marchandises: { coutEntretienJournalier: 5,  cout: 700,  capacite: 12, vitesse: 3.8 },
      frigo:        { coutEntretienJournalier: 5,  cout: 750,  capacite: 14, vitesse: 3.8 },
      citerne:      { coutEntretienJournalier: 5,  cout: 750,  capacite: 20, vitesse: 3.5 },
      bus:          { coutEntretienJournalier: 10, cout: 1500, capacite: 40, vitesse: 3.0 },
    },

    /* ---------- PORTS ET BATEAUX ----------
       Le port se construit au bord de l'eau ; les bateaux naviguent de port en port.
       Fret (cargo) : chargé/déchargé dans un ENTREPÔT collé au port (ressources
       cochées « fret » dans l'entrepôt). Voyageurs (ferry) : habitants sans emploi
       dans le rayon du port.
       tarif     : $ par voyageur et par case (distance à vol d'oiseau entre ports)
       tarifFret : $ par unité livrée = prix commercial × distance × tarifFret */
    bateau: {
      cout: 1400,
      rayon: 10,
      tarif: 0.5,
      tarifFret: 0.05,
      cargo: { cout: 6000, capacite: 60, vitesse: 1.2, coutEntretienJournalier: 20 },
      ferry: { cout: 4500, capacite: 60, vitesse: 1.6, coutEntretienJournalier: 16 },
    },

    /* ---------- AÉROPORTS ET AVIONS ----------
       Les avions volent en ligne droite d'aéroport en aéroport et transportent des
       voyageurs (habitants sans emploi dans le rayon de l'aéroport).
       Un aéroport = gares + pistes + déco posées sur des cases adjacentes (fusion
       automatique). Il est fonctionnel avec au moins une gare, une tour de contrôle et
       `pisteMin` cases de piste alignées. Le dépôt d'aéroport ne sert qu'à acheter les avions et créer les
       lignes entre gares d'aéroport. */
    avion: {
      cout: 3500,            // dépôt d'aéroport : sert uniquement à acheter les avions et créer les lignes
      gare:  { cout: 400 },  // gare d'aéroport (terminal) : point d'embarquement des voyageurs
      piste: { cout: 80 },   // case de piste : il faut au moins `pisteMin` cases alignées
      parking: { cout: 30 }, // place de parking d'avion (max = capacité des hangars de l'aéroport)
      tour:  { cout: 300 },  // tour de contrôle (radar rotatif)
      taxi:  { cout: 40 },   // voie de circulation (taxiway), plus étroite que la piste, ligne jaune centrale
      deco:  { cout: 25 },   // décor (parking, pelouse, balisage…)
      pisteMin: 4,
      rayon: 16,
      tarif: 1.1,
      avion: { cout: 18000, capacite: 40, vitesse: 7, coutEntretienJournalier: 45 },
      // avion cargo : achetable seulement si l'aéroport contient un entrepôt (collé à l'une de ses pièces)
      cargo: { cout: 24000, capacite: 80, vitesse: 7, coutEntretienJournalier: 60 },
      tarifFret: 0.12,       // $ par unité livrée = prix commercial × distance × tarifFret
    },

    /* ---------- ARRÊT DE BUS ----------
       cout          : prix de construction en $
       rayon         : rayon (Chebyshev) en cases pour compter les habitants desservis
       tarif         : $ par passager par tuile de trajet
       diviseurIntra : diviseur appliqué au tarif pour un trajet intra-ville (même townId)
                       ex. 3 → revenu = tarif / 3  (intra-ville moins rentable qu'inter-ville)
       Pour un trajet inter-joueurs le revenu plein est partagé 50/50 entre les deux propriétaires.
    */
    arretBus: {
      cout:             250,
      rayon:            8,
      tarif:            1,    // $ par passager par tuile
      diviseurIntra:    3,    // revenu intra-ville = tarif / diviseurIntra
      // Remplissage aux heures de pointe : taux = pop / tempsRemplissage (linéaire)
      // Total rush/jour = 6h (7-9h + 12-13h + 16-18h + 22-23h)
      // → tempsRemplissage = 6 : remplit en exactement 1 journée de jeu de rush
      tempsArret:       2,  // heures de jeu d'arrêt à quai lors de l'embarquement des passagers
      tempsRemplissage: 6,  // gtime-secondes de rush nécessaires pour remplir complètement
      partProprietaire:  0.8,  // part du revenu revenant au propriétaire du bus lors d'un trajet inter-joueurs (0.8 = 80 %)
    },

  },

  lac: {
    poissonRayon:             4,    // distance max depuis la rive (Manhattan) pour placer des poissons
    poissonPct:               0.03, // fraction de tuiles de rive éligibles qui reçoivent des poissons
    sablePct:                 0.12, // fraction des tuiles de rive en herbe remplacées par du sable
    argilePct:                0.08, // fraction des tuiles de rive en herbe remplacées par de l'argile
  },

  /* ---------- SONS ----------
     volume  : niveau de lecture par effet (0 = muet, 1 = max). Multiplié par le
               volume global réglable dans les paramètres (⚙️).
     fichier : chemin du mp3 (servi depuis assets/).
     zoomMin : zoom minimal pour entendre les sons « de carte » (départ de train…).
               En-dessous (vue trop dézoomée) le son ne joue pas. Plage 0.35 → 2.4. */
  sons: {
    zoomMin: 1.0,
    trainDepart: { fichier: 'assets/sounds/train_depart.mp3', volume: 0.6 },
  },
};
