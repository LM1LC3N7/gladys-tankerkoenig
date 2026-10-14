// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized.
// -----------------------------------------------------------------------------

import { FUELS, MAX_RADIUS, STATION_ID_PATTERN } from './constants.js';

// Defaults: they MUST match the `default` values of the manifest.
export const DEFAULTS = {
  fuels: [...FUELS],
  radius: 5,
  stations: '',
  poll_interval: 10,
};

const number = (value, fallback, min, max, step = 1) => {
  const n = value === '' || value === null || value === undefined ? Number.NaN : Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n / step) * step)) : fallback;
};

/**
 * The fuels to track: the multi_select array, or a text ("e5, diesel" or a
 * JSON array) from an older form. Nothing checked means all three: a
 * fuel-price integration with no fuel would do nothing.
 */
export function parseFuels(value) {
  let list = value;
  if (typeof value === 'string') {
    try {
      list = JSON.parse(value);
    } catch {
      list = value.split(',');
    }
  }
  const wanted = new Set(
    (Array.isArray(list) ? list : []).map((f) => String(f).trim().toLowerCase()),
  );
  const fuels = FUELS.filter((f) => wanted.has(f));
  return fuels.length > 0 ? fuels : [...FUELS];
}

/**
 * One entry of the `stations` field: "<uuid>" or "<uuid>:Custom name".
 *   { id, name } for a valid id, { invalid: text } otherwise.
 */
export function parseStationEntry(entry) {
  const text = String(entry ?? '').trim();
  if (!text) {
    return undefined;
  }
  const [head, ...rest] = text.split(':');
  const id = head.trim().toLowerCase();
  if (!STATION_ID_PATTERN.test(id)) {
    return { invalid: text };
  }
  return { id, name: rest.join(':').trim() || undefined };
}

export function normalizeConfig(raw = {}) {
  const entries = String(raw.stations ?? '')
    .split(/[,;\n]/)
    .map(parseStationEntry)
    .filter(Boolean);
  const apiKey = String(raw.api_key ?? '').trim();
  return {
    apiKey,
    fuels: parseFuels(raw.fuels ?? DEFAULTS.fuels),
    radius: number(raw.radius, DEFAULTS.radius, 1, MAX_RADIUS, 0.5),
    // The key is a UUID too: pasted in the wrong field, it is never sent as a station id.
    stations: entries.filter((e) => e.id && e.id !== apiKey.toLowerCase()),
    invalidStations: entries.filter((e) => e.invalid).map((e) => e.invalid),
    pollInterval: number(raw.poll_interval, DEFAULTS.poll_interval, 5, 60),
  };
}
