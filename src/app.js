// -----------------------------------------------------------------------------
// The integration itself: discovery (the stations near the houses and the
// typed ids), the refresh loop over the stations the user created, the
// "Cheapest nearby" device, the scene triggers, the scene action, the widget
// and the configuration buttons. index.js only wires the SDK handlers to it.
//
// Tankerkönig's rules are enforced here: a station's prices are read at most
// once every 5 minutes, in prices.php batches of 10, off the round times
// (jitter); list.php only serves discovery, the scene action and the buttons,
// through a 5-minute cache; a refused key stops every request until the
// configuration is saved again.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import {
  CREATED_DEBOUNCE,
  DETAIL_TTL,
  FUELS,
  LIST_TTL,
  MAX_IDS_PER_CALL,
  MAX_JITTER_SECONDS,
  MAX_RADIUS,
  MAX_SUGGESTIONS,
  MIN_PRICE_INTERVAL,
  STATE_HEARTBEAT,
  TICK_SLACK,
  WIDGETS,
} from './constants.js';
import {
  DEVICE_TYPES,
  buildCheapestDevice,
  buildStationDevice,
  cheapestStates,
  featureKeys,
  parseExternalId,
  stationStates,
  watchOfDevice,
} from './devices.js';
import { T } from './i18n.js';
import {
  addressOf,
  cheapestInList,
  cheapestOf,
  fold,
  nextReading,
  pricesOf,
  stationLabel,
  stationOf,
} from './model.js';
import { TankerkoenigClient, TankerkoenigError, isAuthError } from './tankerkoenig.js';
import { cheapestEvents, stationEvents } from './triggers.js';
import { pricesWidget } from './widget.js';

const defaultTimers = { setTimeout, clearTimeout, setInterval, clearInterval };

const chunks = (list, size) =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) =>
    list.slice(i * size, (i + 1) * size),
  );

export class TankerkoenigApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'tankerkoenig' }),
    now = Date.now,
    timers = defaultTimers,
    sleep,
    random = Math.random,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.random = random;
    this.sleep = sleep ?? ((ms) => new Promise((resolve) => this.timers.setTimeout(resolve, ms)));
    this.config = normalizeConfig();
    this.client = new TankerkoenigClient({ now: this.now, sleep: (ms) => this.sleep(ms) });
    // Kept across restarts (a reconnection, a config change): the 5-minute
    // gate and the transitions survive them.
    /** station id -> last reading (src/model.js `nextReading`) */
    this.readings = new Map();
    /** fuel -> the last known cheapest { stationId, device, label, price } */
    this.cheapest = {};
    /** fuel -> the cheapest of the last refresh (null: no open station) */
    this.current = {};
    this.candidates = '';
    this.lastReadAt = undefined;
    /** "lat,lng,radius" -> { at, stations } */
    this.lists = new Map();
    /** station id -> { at, station } */
    this.details = new Map();
    this.halted = false;
    this.refreshTimer = undefined;
    this.readTimer = undefined;
    this.lastStatus = undefined;
    this.refreshing = undefined;
    this.generation = 0;
  }

  // --- Lifecycle -------------------------------------------------------------

  /**
   * (Re)start with a configuration. `resume` is set when the user saved the
   * configuration: it lifts a stop caused by a refused key, which a mere
   * reconnection to Gladys must not do.
   */
  async start(raw = {}, { resume = false } = {}) {
    this.stop();
    const generation = ++this.generation;
    const previousKey = this.config.apiKey;
    this.config = normalizeConfig(raw);
    this.client.apiKey = this.config.apiKey;
    if (resume || this.config.apiKey !== previousKey) {
      this.halted = false;
    }
    if (!this.config.apiKey) {
      await this.setStatus(false, T.noKey);
      return;
    }
    if (this.halted) {
      return;
    }
    for (const invalid of this.config.invalidStations) {
      this.logger.warn(`Ignoring "${invalid}": not a Tankerkönig station id`);
    }
    try {
      await this.publishDevices();
    } catch (err) {
      await this.fail(err);
    }
    if (generation !== this.generation || this.halted) {
      return;
    }
    try {
      await this.refresh();
    } catch (err) {
      await this.fail(err);
    }
    if (generation !== this.generation || this.halted) {
      return;
    }
    // Tankerkönig asks home automation not to call at round times: a few
    // random seconds on top of the interval move every tick off the minute.
    const jitter = (1 + Math.floor(this.random() * MAX_JITTER_SECONDS)) * 1000;
    this.refreshTimer = this.timers.setInterval(
      () => this.refresh().catch((err) => this.fail(err)),
      this.config.pollInterval * 60_000 + jitter,
    );
  }

  stop() {
    this.generation += 1;
    this.timers.clearInterval(this.refreshTimer);
    this.refreshTimer = undefined;
    this.timers.clearTimeout(this.readTimer);
    this.readTimer = undefined;
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  /** A refused key stops everything (Tankerkönig: "send no more requests"). */
  async fail(err) {
    if (isAuthError(err)) {
      if (!this.halted) {
        this.logger.error(`Tankerkönig refused the API key (${err.message}): requests stopped`);
      }
      this.halted = true;
      this.stop();
      await this.setStatus(false, T.badKey(err.message));
      return;
    }
    this.logger.warn(`Tankerkönig call failed: ${err.message}`);
    await this.setStatus(false, T.unreachable(err.message));
  }

  /** Every API call goes through here: a refused key stops everything, whoever asked. */
  async api(request) {
    try {
      return await request();
    } catch (err) {
      if (isAuthError(err)) {
        await this.fail(err);
      }
      throw err;
    }
  }

  ensureUsable() {
    if (!this.config.apiKey) {
      throw new Error(T.noKey.en);
    }
    if (this.halted) {
      throw new Error('Tankerkönig refused the API key: fix it in the configuration.');
    }
  }

  // --- Houses, radius search, details ---------------------------------------------

  async locatedHouses() {
    let houses = [];
    try {
      houses = await this.gladys.getHouses();
    } catch (err) {
      this.logger.warn(`Houses unavailable (location not granted?): ${err.message}`);
    }
    return houses
      .filter((h) => h.latitude !== null && h.longitude !== null)
      .map((h) => ({ ...h, latitude: Number(h.latitude), longitude: Number(h.longitude) }))
      .filter((h) => Number.isFinite(h.latitude) && Number.isFinite(h.longitude));
  }

  /** The stations within `radius` km of a point (list.php, cached LIST_TTL). */
  async nearby(point, radius) {
    const key = `${point.latitude.toFixed(3)},${point.longitude.toFixed(3)},${radius}`;
    const cached = this.lists.get(key);
    if (cached && this.now() - cached.at < LIST_TTL) {
      return cached.stations;
    }
    const stations = (await this.api(() => this.client.list({ ...point, radius })))
      .map(stationOf)
      .filter((s) => s.id);
    this.lists.set(key, { at: this.now(), stations });
    return stations;
  }

  /**
   * One station by id (detail.php) for the typed ids: kept DETAIL_TTL, and an
   * unknown id LIST_TTL, so scanning again does not ask again.
   */
  async stationDetail(id) {
    const cached = this.details.get(id);
    if (cached?.station && this.now() - cached.at < DETAIL_TTL) {
      return cached.station;
    }
    if (cached?.error && this.now() - cached.at < LIST_TTL) {
      throw cached.error;
    }
    try {
      const station = stationOf(await this.api(() => this.client.detail(id)));
      this.details.set(id, { at: this.now(), station });
      return station;
    } catch (err) {
      if (err instanceof TankerkoenigError && !err.auth) {
        this.details.set(id, { at: this.now(), error: err });
      }
      throw err;
    }
  }

  // --- Discovery -----------------------------------------------------------------

  /** The devices to offer: the typed stations, those near the houses, "Cheapest nearby". */
  async discoveredDevices() {
    const watches = new Map();
    for (const entry of this.config.stations) {
      try {
        const station = await this.stationDetail(entry.id);
        watches.set(station.id, { station, name: entry.name });
      } catch (err) {
        if (isAuthError(err)) {
          throw err;
        }
        this.logger.warn(`Station ${entry.id} unavailable: ${err.message}`);
      }
    }
    for (const house of await this.locatedHouses()) {
      const stations = await this.nearby(house, this.config.radius);
      for (const station of stations.slice(0, MAX_SUGGESTIONS)) {
        if (!watches.has(station.id)) {
          watches.set(station.id, { station, distanceKm: station.distanceKm });
        }
      }
    }
    const devices = [...watches.values()].map((w) =>
      buildStationDevice(this.gladys, w, this.config.fuels),
    );
    if (devices.length > 0 || this.watchedDevices().stations.length > 0) {
      devices.push(buildCheapestDevice(this.gladys, this.config.fuels));
    }
    return devices;
  }

  async publishDevices() {
    if (!this.config.apiKey || this.halted) {
      return;
    }
    await this.gladys.publishDiscoveredDevices(await this.discoveredDevices());
  }

  /** The devices the user created. */
  watchedDevices() {
    const stations = [];
    let cheapest;
    for (const device of this.gladys.devices ?? []) {
      const parsed = parseExternalId(device.external_id);
      if (parsed?.kind === DEVICE_TYPES.STATION) {
        stations.push(device);
      } else if (parsed?.kind === DEVICE_TYPES.CHEAPEST) {
        cheapest = device;
      }
    }
    return { stations, cheapest };
  }

  // --- Reading -------------------------------------------------------------------

  refresh() {
    if (this.halted || !this.config.apiKey) {
      return Promise.resolve();
    }
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = undefined;
      });
    }
    return this.refreshing;
  }

  /** Whether a station may be read now: never read, or read 5 minutes ago. */
  due(stationId, now) {
    const reading = this.readings.get(stationId);
    return !reading || now - reading.at >= MIN_PRICE_INTERVAL - TICK_SLACK;
  }

  async doRefresh() {
    const generation = this.generation;
    const now = this.now();
    const { stations, cheapest } = this.watchedDevices();
    const due = stations.filter((d) => this.due(watchOfDevice(d).stationId, now));
    let failure;
    let read = 0;
    for (const batch of chunks(due, MAX_IDS_PER_CALL)) {
      if (generation !== this.generation || this.halted) {
        return;
      }
      try {
        const ids = batch.map((d) => watchOfDevice(d).stationId);
        const entries = pricesOf(await this.api(() => this.client.prices(ids)));
        for (const device of batch) {
          await this.applyStation(device, entries.get(watchOfDevice(device).stationId), now);
          read += 1;
        }
      } catch (err) {
        if (isAuthError(err)) {
          throw err;
        }
        failure = err;
        this.logger.warn(`Reading ${batch.length} station(s) failed: ${err.message}`);
      }
    }
    if (generation !== this.generation) {
      return;
    }
    if (read > 0) {
      this.lastReadAt = new Date(now).toISOString();
      await this.updateCheapest(stations, cheapest);
      this.gladys.requestWidgetRefresh(WIDGETS.PRICES);
    }
    if (failure) {
      await this.setStatus(this.readings.size > 0, T.unreachable(failure.message));
    } else if (stations.length === 0) {
      await this.setStatus(true, T.noStation);
    } else {
      await this.setStatus(true, T.ok(stations.length));
    }
  }

  async publishEvents(events) {
    for (const event of events) {
      await this.gladys
        .publishSceneEvent(event.key, event.data)
        .catch((err) => this.logger.warn(`Scene event ${event.key} failed: ${err.message}`));
    }
  }

  async applyStation(device, entry, now) {
    const watch = watchOfDevice(device);
    if (!entry || entry.status === 'no stations') {
      this.logger.warn(`Tankerkönig does not know the station ${watch.stationId} (${device.name})`);
    }
    const previous = this.readings.get(watch.stationId);
    const reading = nextReading(previous, entry, now);
    this.readings.set(watch.stationId, reading);
    await this.gladys.publishChangedStates(
      stationStates(device.external_id, reading, featureKeys(device)),
      { heartbeat: STATE_HEARTBEAT },
    );
    await this.publishEvents(
      stationEvents(device.external_id, watch.label, previous, reading, this.config.fuels),
    );
  }

  /**
   * The cheapest open station per fuel. A station added or removed changes
   * the field, not the prices: that refresh fires no cheapest event. With
   * every station closed the last cheapest is kept as the reference, so the
   * morning compares with the evening.
   */
  async updateCheapest(stations, cheapestDevice) {
    const candidates = stations.map((d) => {
      const w = watchOfDevice(d);
      return { ...w, device: d.external_id, reading: this.readings.get(w.stationId) };
    });
    const field = candidates
      .filter((c) => c.reading)
      .map((c) => c.stationId)
      .sort()
      .join(',');
    // Every fuel (the widget may show an untracked one); events for the tracked ones.
    const current = {};
    for (const fuel of FUELS) {
      current[fuel] = cheapestOf(candidates, fuel, this.cheapest[fuel]?.stationId);
    }
    if (field === this.candidates) {
      await this.publishEvents(
        cheapestEvents(cheapestDevice?.external_id, this.cheapest, current, this.config.fuels),
      );
    }
    this.candidates = field;
    this.current = current;
    for (const fuel of FUELS) {
      if (current[fuel]) {
        this.cheapest[fuel] = current[fuel];
      }
    }
    if (cheapestDevice) {
      await this.publishCheapest(cheapestDevice);
    }
  }

  async publishCheapest(device) {
    await this.gladys.publishChangedStates(
      cheapestStates(device.external_id, this.current, this.config.fuels, featureKeys(device)),
      { heartbeat: STATE_HEARTBEAT },
    );
  }

  /**
   * A device was created (or updated: the SDK forgot its states). A known
   * station is re-published from memory; new stations are read together a
   * few seconds later, so adding ten stations costs one prices.php call.
   */
  async deviceCreated(device) {
    const parsed = parseExternalId(device.external_id);
    if (parsed?.kind === DEVICE_TYPES.STATION) {
      const reading = this.readings.get(parsed.stationId);
      if (reading) {
        await this.gladys.publishChangedStates(
          stationStates(device.external_id, reading, featureKeys(device)),
        );
      } else if (!this.readTimer && !this.halted && this.config.apiKey) {
        this.readTimer = this.timers.setTimeout(() => {
          this.readTimer = undefined;
          return this.refresh().catch((err) => this.fail(err));
        }, CREATED_DEBOUNCE);
      }
    } else if (parsed?.kind === DEVICE_TYPES.CHEAPEST) {
      await this.publishCheapest(device);
    }
  }

  deviceDeleted(device) {
    const parsed = parseExternalId(device.external_id);
    if (parsed?.kind === DEVICE_TYPES.STATION) {
      this.readings.delete(parsed.stationId);
    }
  }

  // --- Scene action ------------------------------------------------------------------

  async getCheapestStation(fields = {}) {
    this.ensureUsable();
    const fuel = String(fields.fuel ?? '').toLowerCase();
    if (!FUELS.includes(fuel)) {
      throw new Error(`Unknown fuel "${fields.fuel}" (e5, e10 or diesel)`);
    }
    const asked = Number(fields.radius);
    const radius =
      fields.radius !== undefined && fields.radius !== null && fields.radius !== '' && asked > 0
        ? Math.min(MAX_RADIUS, Math.max(1, asked))
        : this.config.radius;
    const [house] = await this.locatedHouses();
    if (!house) {
      throw new Error(T.noHouse.en);
    }
    const best = cheapestInList(await this.nearby(house, radius), fuel);
    if (!best) {
      return {
        found: false,
        name: null,
        brand: null,
        address: null,
        price: null,
        distance: null,
        station_id: null,
      };
    }
    return {
      found: true,
      name: stationLabel(best),
      brand: best.brand || null,
      address: addressOf(best),
      price: best.prices[fuel],
      distance: best.distanceKm,
      station_id: best.id,
    };
  }

  // --- Widget ------------------------------------------------------------------------

  async getWidget(key, { settings, language } = {}) {
    const lang = language === 'fr' ? 'fr' : 'en';
    const fuels = FUELS.includes(settings?.fuel) ? [settings.fuel] : this.config.fuels;
    const rows = this.watchedDevices().stations.map((device) => {
      const watch = watchOfDevice(device);
      return {
        stationId: watch.stationId,
        label: watch.label,
        reading: this.readings.get(watch.stationId),
      };
    });
    return pricesWidget({
      fuels,
      rows,
      cheapest: this.current,
      readAt: this.lastReadAt,
      language: lang,
    });
  }

  // --- Configuration screen buttons --------------------------------------------------

  /** One prices.php call checks the key (the watched stations, or a dummy id). */
  async testConnection() {
    if (!this.config.apiKey) {
      return T.noKey;
    }
    const lines = { en: [], fr: [] };
    const add = (text) => {
      lines.en.push(text.en);
      lines.fr.push(text.fr);
    };
    try {
      const { stations } = this.watchedDevices();
      const sample = stations
        .slice(0, MAX_IDS_PER_CALL)
        .map((d) => watchOfDevice(d).stationId)
        .filter(Boolean);
      await this.api(() =>
        this.client.prices(sample.length > 0 ? sample : ['00000000-0000-0000-0000-000000000000']),
      );
      const houses = await this.locatedHouses();
      add(T.keyAccepted(stations.length, houses.length));
      if (houses.length === 0) {
        add(T.noHouse);
      }
    } catch (err) {
      return isAuthError(err) ? T.badKey(err.message) : T.unreachable(err.message);
    }
    for (const invalid of this.config.invalidStations) {
      add(T.invalidStation(invalid));
    }
    return { en: lines.en.join('\n'), fr: lines.fr.join('\n') };
  }

  /** The stations near the house whose name, brand, street or town match. */
  async searchStations(fields = {}) {
    this.ensureUsable();
    const query = fold(fields.query ?? '');
    const asked = Number(fields.radius);
    const radius = asked > 0 ? Math.min(MAX_RADIUS, Math.max(1, asked)) : 10;
    const [house] = await this.locatedHouses();
    if (!house) {
      return T.noHouse;
    }
    const matches = (await this.nearby(house, radius))
      .filter((s) =>
        fold([s.name, s.brand, s.street, s.place, s.postCode].join(' ')).includes(query),
      )
      .slice(0, 10)
      .map(
        (s) =>
          `${stationLabel(s)} — ${addressOf(s)} · ${s.distanceKm ?? '?'} km · ${s.id.toLowerCase()}`,
      );
    if (matches.length === 0) {
      return T.noMatch(fields.query ?? '', radius);
    }
    return { en: matches.join('\n'), fr: matches.join('\n') };
  }
}
