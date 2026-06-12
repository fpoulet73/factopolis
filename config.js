/* ============================================================
   FACTOPOLIS — Fichier de configuration
   Modifie les valeurs ci-dessous puis recharge la page (F5).

   Identifiants de ressources à utiliser dans les recettes :
     iron  = fer          coal  = charbon       wood = bois
     steel = acier        goods = marchandises
   ============================================================ */
const CONFIG = {

  /* ---------- PRODUCTION ----------
     temps    : durée d'un cycle de production, en secondes (plus petit = plus rapide)
     entree   : ressources consommées à chaque cycle
     sortie   : ressources produites à chaque cycle
     quantite : (mine uniquement) unités extraites par cycle — fer OU charbon selon le gisement */
  production: {
    mine:     { temps: 2.2, quantite: 1 },
    bucheron: { temps: 2.8, sortie: { wood: 1 } },
    fonderie: { temps: 3.5, entree: { iron: 1, coal: 1 }, sortie: { steel: 1 } },
    usine:    { temps: 4.0, entree: { steel: 1, wood: 1 }, sortie: { goods: 1 } },
  },

  /* ---------- MAISONS ---------- */
  maison: {
    intervalleConsommation: 8,  // secondes entre chaque marchandise consommée
    revenuParUnite: 25,         // $ gagnés par marchandise consommée
    habitantsMax: 5,            // capacité (4 maisons pleines en carré 2×2 → immeuble)
    stockMax: 10,               // marchandises stockables sur place
  },

  /* ---------- IMMEUBLES (niveau 2×2) ---------- */
  immeuble: {
    intervalleConsommation: 4,  // consomme plus vite qu'une maison
    revenuParUnite: 25,
    habitantsMax: 30,
    stockMax: 25,
  },

  /* ---------- AUTRES NIVEAUX RÉSIDENTIELS ----------
     Fusion : dès qu'un rectangle est entièrement couvert de logements PLEINS
     plus petits, ils fusionnent en bâtiment du niveau correspondant.
     formes : [largeur, hauteur] — les deux orientations sont listées.
     Progression : maison → 2×1 → 3×1 → 4×1, et 2×2 → 3×2 → 4×4. */
  residentiel: {
    duplex:        { formes:[[2,1],[1,2]], intervalleConsommation:7, revenuParUnite:27, habitantsMax:12,  stockMax:14 },
    rangee:        { formes:[[3,1],[1,3]], intervalleConsommation:6, revenuParUnite:28, habitantsMax:20,  stockMax:18 },
    residence:     { formes:[[4,1],[1,4]], intervalleConsommation:5, revenuParUnite:30, habitantsMax:28,  stockMax:22 },
    grandImmeuble: { formes:[[3,2],[2,3]], intervalleConsommation:3, revenuParUnite:28, habitantsMax:60,  stockMax:40 },
    gratteCiel:    { formes:[[4,4]],       intervalleConsommation:2, revenuParUnite:30, habitantsMax:150, stockMax:80 },
  },

  /* ---------- FUSION INDUSTRIELLE ----------
     Les bâtiments de production IDENTIQUES (même type, même minerai pour les
     mines) couvrant un rectangle (2×1, 3×1, 4×1, 2×2, 3×2, 4×4…) fusionnent.
     Production du bâtiment fusionné = nombre de cases × facteur.
     facteurs : { nombreDeCases: facteur } — le palier inférieur s'applique. */
  industrie: {
    facteurs: { 2:1.15, 3:1.3, 4:1.5, 6:1.75, 16:2.5 },

    /* Entretien : chaque bâtiment industriel coûte de l'argent périodiquement.
       Coût = base × cases × facteur (la même courbe que la production) —
       plus le site est grand, plus la taxe pèse. */
    entretien: { mine: 2, bucheron: 1.5, fonderie: 3, usine: 4 }, // $ de base par cycle
    intervalleEntretien: 10,                                      // secondes entre deux prélèvements
    entretienEnPause: 0.5,    // fraction de l'entretien payée par un site mis en pause
  },

  /* ---------- PÉNURIE ----------
     Un logement sans marchandises pendant `delai` secondes se dégrade :
     - bâtiment fusionné → il se sépare en maisons individuelles, et les
       habitants en trop quittent la ville à pied ;
     - maison simple → un habitant part, à chaque cycle de pénurie.
     La fusion exige d'être plein ET approvisionné en marchandises. */
  penurie: {
    delai: 30,
  },

  /* ---------- HABITANTS ---------- */
  habitants: {
    vitesseMarche: 1.3,         // tuiles par seconde — les nouveaux arrivants rejoignent
                                // leur logement à pied depuis le bord de la carte
  },

  /* ---------- ÉCONOMIE ---------- */
  economie: {
    taxeParHabitant: 2,         // $ versés par habitant…
    intervalleTaxes: 10,        // …toutes les X secondes
  },

  /* ---------- CAMIONS ---------- */
  camions: {
    capacite: 6,                // unités transportées par voyage
    vitesse: 3.4,               // tuiles parcourues par seconde
  },
};
