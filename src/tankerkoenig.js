// -----------------------------------------------------------------------------
// The Tankerkönig client (https://creativecommons.tankerkoenig.de): the radius
// search, the prices of up to 10 stations and the detail of one station, as
// raw JSON. Turning them into plain objects is src/model.js's job.
//
// Tankerkönig answers HTTP 200 with { ok: false, message } on an error (a
// refused key, an unknown station): that becomes a TankerkoenigError, whose
// `auth` flag tells the app to stop sending requests, as the API asks.
// -----------------------------------------------------------------------------

import {
  API_URL,
  BACKGROUND_SPACING,
  MAX_IDS_PER_CALL,
  MAX_RADIUS,
  REQUEST_SPACING,
} from './constants.js';
import { getJson } from './http.js';

/** The messages Tankerkönig uses for a missing, malformed or disabled key. */
const AUTH_MESSAGE = /api-?key|key existiert|deaktiviert|gesperrt/i;

export class TankerkoenigError extends Error {
  constructor(message, { auth = false } = {}) {
    super(message);
    this.name = 'TankerkoenigError';
    this.auth = auth;
  }
}

export const isAuthError = (err) => err instanceof TankerkoenigError && err.auth;

/** The app stopped (new configuration, disconnection) while a request waited its turn. */
export class CancelledError extends Error {
  constructor() {
    super('request cancelled');
    this.name = 'CancelledError';
  }
}

export const isCancelled = (err) => err instanceof CancelledError;

/**
 * Every call takes `options`:
 *   background  true for a request nobody asked for right now (the refresh
 *               loop, startup): it leaves BACKGROUND_SPACING after the
 *               previous request of any kind; a user request only waits
 *               REQUEST_SPACING, and never queues behind a waiting background one;
 *   active      () => boolean, checked while waiting: false cancels the request;
 *   reserved    the caller already took the slot (see `slot`).
 */
export class TankerkoenigClient {
  constructor({
    apiKey = '',
    baseUrl = API_URL,
    spacing = REQUEST_SPACING,
    backgroundSpacing = BACKGROUND_SPACING,
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.spacing = spacing;
    this.backgroundSpacing = backgroundSpacing;
    this.now = now;
    this.sleep = sleep;
    /** When the last request left (0: none yet). */
    this.lastAt = 0;
  }

  /**
   * Waits for the turn of a request, then takes it: resolves the send time,
   * or undefined when cancelled. The check and the take happen in the same
   * tick after each sleep, so concurrent callers never leave together.
   */
  async slot({ background = false, active = () => true } = {}) {
    const gap = background ? this.backgroundSpacing : this.spacing;
    for (;;) {
      if (!active()) {
        return undefined;
      }
      const wait = this.lastAt ? this.lastAt + gap - this.now() : 0;
      if (wait <= 0) {
        break;
      }
      await this.sleep(wait);
    }
    this.lastAt = this.now();
    return this.lastAt;
  }

  async call(path, params, options = {}) {
    if (!this.apiKey) {
      throw new TankerkoenigError('no API key', { auth: true });
    }
    if (!options.reserved && (await this.slot(options)) === undefined) {
      throw new CancelledError();
    }
    const search = new URLSearchParams({ ...params, apikey: this.apiKey });
    let answer;
    try {
      answer = await getJson(`${this.baseUrl}/${path}?${search}`);
    } catch (err) {
      // Belt and braces: whatever the error, the key never leaves this file.
      err.message = String(err.message).replaceAll(this.apiKey, '***');
      throw err;
    }
    if (!answer || answer.ok !== true) {
      const message = String(answer?.message ?? 'unexpected answer').slice(0, 200);
      throw new TankerkoenigError(message, { auth: AUTH_MESSAGE.test(message) });
    }
    return answer;
  }

  /**
   * The stations around a point, sorted by distance, with their three prices.
   * The coordinates are rounded to 3 decimals (about 100 m): enough for a
   * radius search, and the exact house position stays home.
   */
  async list({ latitude, longitude, radius }, options) {
    const answer = await this.call(
      'list.php',
      {
        lat: latitude.toFixed(3),
        lng: longitude.toFixed(3),
        rad: String(Math.min(MAX_RADIUS, Math.max(1, radius))),
        sort: 'dist',
        type: 'all',
      },
      options,
    );
    return answer.stations ?? [];
  }

  /** The status and prices of up to 10 stations: { <id>: { status, e5, e10, diesel } }. */
  async prices(ids, options) {
    if (ids.length === 0 || ids.length > MAX_IDS_PER_CALL) {
      throw new RangeError(`prices.php takes 1 to ${MAX_IDS_PER_CALL} ids, not ${ids.length}`);
    }
    const answer = await this.call('prices.php', { ids: ids.join(',') }, options);
    return answer.prices ?? {};
  }

  /** One station: address, position, prices, opening times. */
  async detail(id, options) {
    const answer = await this.call('detail.php', { id }, options);
    return answer.station;
  }
}
