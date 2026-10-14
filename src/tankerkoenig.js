// -----------------------------------------------------------------------------
// The Tankerkönig client (https://creativecommons.tankerkoenig.de): the radius
// search, the prices of up to 10 stations and the detail of one station, as
// raw JSON. Turning them into plain objects is src/model.js's job.
//
// Tankerkönig answers HTTP 200 with { ok: false, message } on an error (a
// refused key, an unknown station): that becomes a TankerkoenigError, whose
// `auth` flag tells the app to stop sending requests, as the API asks.
// -----------------------------------------------------------------------------

import { API_URL, MAX_IDS_PER_CALL, MAX_RADIUS, REQUEST_SPACING } from './constants.js';
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

export class TankerkoenigClient {
  constructor({
    apiKey = '',
    baseUrl = API_URL,
    spacing = REQUEST_SPACING,
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.spacing = spacing;
    this.now = now;
    this.sleep = sleep;
    this.lastAt = 0;
    this.queue = Promise.resolve();
  }

  /** Requests leave one at a time, `spacing` apart, whoever sends them. */
  pace() {
    const turn = this.queue.then(async () => {
      const wait = this.lastAt + this.spacing - this.now();
      if (this.lastAt && wait > 0) {
        await this.sleep(wait);
      }
      this.lastAt = this.now();
    });
    this.queue = turn.catch(() => {});
    return turn;
  }

  async call(path, params) {
    if (!this.apiKey) {
      throw new TankerkoenigError('no API key', { auth: true });
    }
    await this.pace();
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
  async list({ latitude, longitude, radius }) {
    const answer = await this.call('list.php', {
      lat: latitude.toFixed(3),
      lng: longitude.toFixed(3),
      rad: String(Math.min(MAX_RADIUS, Math.max(1, radius))),
      sort: 'dist',
      type: 'all',
    });
    return answer.stations ?? [];
  }

  /** The status and prices of up to 10 stations: { <id>: { status, e5, e10, diesel } }. */
  async prices(ids) {
    if (ids.length === 0 || ids.length > MAX_IDS_PER_CALL) {
      throw new RangeError(`prices.php takes 1 to ${MAX_IDS_PER_CALL} ids, not ${ids.length}`);
    }
    const answer = await this.call('prices.php', { ids: ids.join(',') });
    return answer.prices ?? {};
  }

  /** One station: address, position, prices, opening times. */
  async detail(id) {
    const answer = await this.call('detail.php', { id });
    return answer.station;
  }
}
