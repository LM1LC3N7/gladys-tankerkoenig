# Tankerkönig

**Connecteur non officiel, sans lien avec Tankerkönig.** Il amène les prix des
carburants en Allemagne dans Gladys via l'API ouverte de
[Tankerkönig](https://creativecommons.tankerkoenig.de/) : chaque station
allemande doit déclarer ses prix Super E5, Super E10 et Diesel à la
Markttransparenzstelle für Kraftstoffe (MTS-K), et Tankerkönig les republie
sous licence CC BY 4.0. Données : Tankerkönig / MTS-K, CC BY 4.0
([tankerkoenig.de](https://www.tankerkoenig.de/)).

## Ce que vous obtenez

| Surface                            | Contenu                                                                                                                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Un appareil par **station suivie** | le prix de chaque carburant suivi que la station vend (€ par litre) et son ouverture                                                                                        |
| L'appareil **Cheapest nearby**     | par carburant, le prix le plus bas parmi les stations suivies ouvertes et le nom de la station                                                                              |
| Déclencheurs de scène              | **prix du carburant sous un seuil** (1,40 à 2,20 €/L), **baisse du prix du carburant** (2 à 10 centimes), **station la moins chère changée**, **station ouverte ou fermée** |
| Action de scène                    | **station la moins chère à proximité** : nom, marque, adresse, prix et distance de la station ouverte la moins chère autour de la maison, pour un carburant                 |
| Widget                             | **Prix des carburants** : le prix le plus bas par carburant, les stations suivies avec leurs prix (la moins chère en vert), l'attribution des données                       |

## Installation

1. Demandez une clé d'API personnelle gratuite sur
   [onboarding.tankerkoenig.de](https://onboarding.tankerkoenig.de/) (une clé
   par personne ; Tankerkönig demande de ne jamais en demander une seconde
   sans le contacter d'abord).
2. Collez-la dans **Clé d'API Tankerkönig**, choisissez les **carburants à
   suivre** et le **rayon autour de la maison** (5 km par défaut, 25 km au
   plus), puis enregistrez.
3. Ouvrez **Découverte** : les stations dans le rayon de votre maison (la
   position de la maison dans Gladys, les 25 plus proches au plus) et
   l'appareil **Cheapest nearby** sont proposés. Ajoutez ceux que vous
   utilisez.
4. Une station plus loin : le bouton **Chercher des stations** liste les
   stations autour de la maison dont le nom, la marque, la rue, la ville ou le
   code postal contient un texte, avec leur identifiant. Saisissez les
   identifiants dans **Autres stations**, séparés par des virgules, avec un nom
   personnalisé facultatif après deux-points
   (`278130b1-e062-4a0f-80cc-19e486b4c024:Aral du bureau`), enregistrez, et
   rouvrez Découverte.
5. Placez le widget **Prix des carburants** sur un tableau de bord ; son
   réglage n'affiche qu'un carburant quand vous en choisissez un.

Les prix des stations suivies sont lus toutes les 10 minutes (option
**Intervalle de rafraîchissement**, au moins 5 minutes, comme Tankerkönig le
demande aux systèmes domotiques), 10 stations par requête, quelques secondes
aléatoires à côté des heures rondes. Une station ajoutée dans Découverte est
lue une dizaine de secondes plus tard.

## Prix, unités et stations fermées

- Un prix est en euros par litre avec trois décimales (1,739). Gladys n'a pas
  d'unité « par litre » : les fonctionnalités utilisent l'unité **euro** et
  indiquent « €/L » dans leur nom.
- La fonctionnalité **Open** vaut 1 quand la station est ouverte, 0 quand elle
  est fermée.
- Une station fermée ne déclare aucun prix : ses fonctionnalités gardent le
  dernier prix connu. L'appareil **Cheapest nearby** ne compte que les
  stations ouvertes ; quand elles sont toutes fermées, son nom de station
  affiche « — » et son prix reste.
- Un carburant que la station ne vend pas n'a pas de fonctionnalité.

## Scènes

- **Prix du carburant sous un seuil** : choisissez le carburant et le seuil ;
  la scène s'exécute quand le prix passe dessous, une fois, pas à chaque
  rafraîchissement. Laissez la station vide pour réagir à toutes les stations
  suivies, ou choisissez **Cheapest nearby** pour réagir une seule fois au prix
  le plus bas, quelle que soit la station (les deux à la fois si vous la
  laissez vide avec cet appareil créé). Variables : la station, le carburant,
  le prix et le prix précédent.
- **Baisse du prix du carburant** : le prix a baissé d'au moins 2, 3, 5 ou 10
  centimes entre deux lectures.
- **Station la moins chère changée** : une autre station suivie a désormais le
  prix ouvert le plus bas pour un carburant. Ajouter ou retirer une station ne
  compte pas.
- **Station ouverte ou fermée** : selon sa déclaration à la MTS-K.

L'action **station la moins chère à proximité** lance une recherche autour de
la maison (le rayon de la configuration, ou celui que vous donnez) et renvoie
`{{name}}`, `{{brand}}`, `{{address}}`, `{{price}}`, `{{distance}}` et
`{{found}}` pour un message ou une condition. Les recherches sont gardées
5 minutes : une scène qui s'exécute souvent ne surcharge pas Tankerkönig.

## Dépannage

- **« Tankerkönig refuse la clé d'API »** : la clé est fausse ou désactivée.
  Tankerkönig demande aux clients de cesser d'envoyer des requêtes après une
  telle erreur : l'intégration le fait, jusqu'à ce que vous réenregistriez la
  configuration (avec la clé corrigée, ou une fois que Tankerkönig l'a
  réactivée). Le bouton **Tester la clé d'API** la vérifie en une seule
  requête.
- **Aucune station dans Découverte** : renseignez la position de votre maison
  dans Gladys (Paramètres → Maisons), vérifiez le rayon, et rappelez-vous que
  les données ne couvrent que l'Allemagne.
- **« Tankerkönig est injoignable »** : le service est tenu par des bénévoles ;
  l'intégration réessaie à chaque rafraîchissement.
- Logs : le niveau de log de l'intégration se règle avec la variable
  `LOG_LEVEL`. La clé d'API n'y apparaît jamais.

## Données et licence

Les prix et les informations des stations viennent de la
Markttransparenzstelle für Kraftstoffe via Tankerkönig, sous licence
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.fr) ; le widget
affiche l'attribution « Tankerkönig / MTS-K (CC BY 4.0) ». Tankerkönig
interdit l'usage de son API aux compagnies pétrolières et aux stations-service.

## Confidentialité

La clé d'API n'est envoyée qu'à Tankerkönig. Les recherches autour de la
maison (Découverte, l'action de scène, le bouton Chercher) envoient à
Tankerkönig la position de la maison arrondie à une centaine de mètres ; la
lecture des prix n'envoie que des identifiants de stations.
