// -----------------------------------------------------------------------------
// Constants of the Tankerkönig integration.
// -----------------------------------------------------------------------------

/** The Tankerkönig open data API (https://creativecommons.tankerkoenig.de). */
export const API_URL = 'https://creativecommons.tankerkoenig.de/json';

/** Identify the integration, so Tankerkönig can tell who sends the requests. */
export const USER_AGENT =
  'gladys-tankerkoenig/0.1 (https://github.com/LM1LC3N7/gladys-tankerkoenig)';
export const HTTP_TIMEOUT = 15_000;

/**
 * Tankerkönig's rules for home automation: read the prices of a station at
 * most once every 5 minutes, through prices.php with up to 10 stations per
 * call, and never at round times.
 */
export const MIN_PRICE_INTERVAL = 5 * 60_000;
export const MAX_IDS_PER_CALL = 10;
/** Seconds added to the refresh interval (1 to 59, drawn at start). */
export const MAX_JITTER_SECONDS = 59;
/**
 * "die Abfragefrequenz auf einen requet/Minute beschränkt" and "Regelmäßige,
 * nicht explizit vom User initiierte Requests sind zu vermeiden": a request
 * nobody asked for right now (the refresh loop, startup, reconnection) leaves
 * at least a minute after the previous request of any kind.
 */
export const BACKGROUND_SPACING = 60_000;
/** A request the user asked for (Discovery, a button, a scene) only waits this long. */
export const REQUEST_SPACING = 2_000;
/** Stations created in Discovery are read together, once the user is done. */
export const CREATED_DEBOUNCE = 10_000;

/** The radius search (list.php) is capped at 25 km by Tankerkönig. */
export const MAX_RADIUS = 25;
/** A radius search is kept this long: discovery, scene actions and buttons share it. */
export const LIST_TTL = 5 * 60_000;
/** A station's address and fuels barely change: keep a detail.php answer a day. */
export const DETAIL_TTL = 24 * 60 * 60_000;
/** At most this many nearby stations are suggested in Discovery. */
export const MAX_SUGGESTIONS = 25;
/** An unchanged price is re-sent this often, so it stays recently dated in Gladys. */
export const STATE_HEARTBEAT = 60 * 60_000;

/** A station id is a UUID. */
export const STATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The fuels Tankerkönig reports (MTS-K), in display order. */
export const FUELS = ['e5', 'e10', 'diesel'];
export const FUEL_NAMES = { e5: 'Super E5', e10: 'Super E10', diesel: 'Diesel' };

/** The prices (€ per litre) a "price below" scene can wait for. */
export const PRICE_THRESHOLDS = [
  1.4, 1.45, 1.5, 1.55, 1.6, 1.65, 1.7, 1.75, 1.8, 1.85, 1.9, 1.95, 2, 2.05, 2.1, 2.15, 2.2,
];
/** The drops (euro cents per litre, between two readings) a scene can wait for. */
export const DROP_THRESHOLDS = [2, 3, 5, 10];

/** Values of the `status` field of the station_status_changed trigger. */
export const STATION_STATUSES = { OPEN: 'open', CLOSED: 'closed' };

/** Manifest keys (forever: stored in user scenes and dashboards). */
export const ACTIONS = { TEST: 'test_connection', SEARCH: 'search_stations' };
export const SCENE_ACTIONS = { CHEAPEST: 'cheapest_station' };
export const SCENE_TRIGGERS = {
  PRICE_BELOW: 'price_below',
  PRICE_DROPPED: 'price_dropped',
  CHEAPEST_CHANGED: 'cheapest_changed',
  STATION_STATUS: 'station_status_changed',
};
export const WIDGETS = { PRICES: 'fuel_prices' };

/** "1.4" -> "1.40": the value of a threshold option in the manifest. */
export const thresholdValue = (price) => price.toFixed(2);
