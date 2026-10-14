// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys (connection status, action results, widgets).
// -----------------------------------------------------------------------------

export const T = {
  ok: (stations) => ({
    en: `Watching ${stations} station${stations === 1 ? '' : 's'} through Tankerkönig.`,
    fr: `${stations} station${stations > 1 ? 's' : ''} suivie${stations > 1 ? 's' : ''} via Tankerkönig.`,
  }),
  noKey: {
    en: 'No API key yet: request a free key on onboarding.tankerkoenig.de and paste it in the configuration.',
    fr: "Pas encore de clé d'API : demandez une clé gratuite sur onboarding.tankerkoenig.de et collez-la dans la configuration.",
  },
  badKey: (message) => ({
    en: `Tankerkönig refused the API key (${message}). No more requests until the configuration is saved again with a valid key.`,
    fr: `Tankerkönig refuse la clé d'API (${message}). Plus aucune requête tant que la configuration n'est pas réenregistrée avec une clé valide.`,
  }),
  noStation: {
    en: 'No station yet: open Discovery and add the stations near your house, or type station ids in the configuration.',
    fr: 'Aucune station : ouvrez Découverte et ajoutez les stations proches de votre maison, ou saisissez des identifiants dans la configuration.',
  },
  unreachable: (message) => ({
    en: `Tankerkönig is unreachable: ${message}. Retrying at the next refresh.`,
    fr: `Tankerkönig est injoignable : ${message}. Nouvel essai au prochain rafraîchissement.`,
  }),
  noHouse: {
    en: 'No house with a position in Gladys: set the position of your house (Settings → Houses).',
    fr: 'Aucune maison localisée dans Gladys : renseignez la position de votre maison (Paramètres → Maisons).',
  },
  keyAccepted: (watched, houses) => ({
    en: `Tankerkönig accepted the API key. ${watched} watched station${watched === 1 ? '' : 's'}, ${houses} located house${houses === 1 ? '' : 's'}.`,
    fr: `Tankerkönig accepte la clé d'API. ${watched} station${watched > 1 ? 's' : ''} suivie${watched > 1 ? 's' : ''}, ${houses} maison${houses > 1 ? 's' : ''} localisée${houses > 1 ? 's' : ''}.`,
  }),
  invalidStation: (text) => ({
    en: `"${text}" is not a Tankerkönig station id (a UUID such as 278130b1-e062-4a0f-80cc-19e486b4c024).`,
    fr: `« ${text} » n'est pas un identifiant de station Tankerkönig (un UUID comme 278130b1-e062-4a0f-80cc-19e486b4c024).`,
  }),
  noMatch: (query, radius) => ({
    en: `No station matching "${query}" within ${radius} km of the house.`,
    fr: `Aucune station correspondant à « ${query} » à moins de ${radius} km de la maison.`,
  }),
  widget: {
    title: { en: 'Fuel prices', fr: 'Prix des carburants' },
    noStation: {
      en: 'No watched station: add stations in Discovery',
      fr: 'Aucune station suivie : ajoutez des stations dans Découverte',
    },
    notLoaded: { en: 'Waiting for the first reading…', fr: 'En attente de la première lecture…' },
    cheapest: (fuel) => ({ en: `Cheapest ${fuel}`, fr: `${fuel} le moins cher` }),
    closed: { en: 'closed', fr: 'fermée' },
    attribution: { en: 'updated', fr: 'mis à jour' },
  },
};
