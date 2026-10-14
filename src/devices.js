// -----------------------------------------------------------------------------
// The Gladys devices and their states. Pure.
//
// External ids (forever):
//   station:<uuid>   a watched station (the Tankerkönig id, lowercase)
//   cheapest         the "Cheapest nearby" virtual device
//
// A price is a `currency` / `decimal` feature in `euro`: Gladys has no
// "per litre" unit, the feature name carries it ("Super E5 (€/L)").
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { FUEL_NAMES, FUELS } from './constants.js';
import { addressOf, sellsFuel, stationLabel } from './model.js';

export const DEVICE_TYPES = { STATION: 'station', CHEAPEST: 'cheapest' };

export const FEATURE = {
  /** Station: the price of a fuel, keyed by the fuel itself (e5, e10, diesel). */
  price: (fuel) => fuel,
  OPEN: 'open',
  /** Cheapest nearby: the lowest price of a fuel and the station holding it. */
  cheapestPrice: (fuel) => `${fuel}_price`,
  cheapestStation: (fuel) => `${fuel}_station`,
};

export const ids = {
  station: (gladys, stationId) => gladys.externalId(`station:${stationId}`),
  cheapest: (gladys) => gladys.externalId('cheapest'),
  feature: (deviceId, key) => `${deviceId}:${key}`,
};

/** { kind: 'station', stationId } | { kind: 'cheapest' } | undefined. */
export function parseExternalId(externalId) {
  const text = String(externalId ?? '');
  const station = /:station:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(
    text,
  );
  if (station) {
    return { kind: DEVICE_TYPES.STATION, stationId: station[1].toLowerCase() };
  }
  if (/:cheapest$/.test(text)) {
    return { kind: DEVICE_TYPES.CHEAPEST };
  }
  return undefined;
}

const feature = (deviceId, key, name, category, type, extra = {}) => ({
  name,
  external_id: ids.feature(deviceId, key),
  category,
  type,
  min: 0,
  max: 1,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...extra,
});

const text = (id, key, name) =>
  feature(id, key, name, C.TEXT, T.TEXT.TEXT, { max: 0, keep_history: false });
const price = (id, key, name) =>
  feature(id, key, name, C.CURRENCY, T.CURRENCY.DECIMAL, { unit: U.EURO, min: 0, max: 5 });

/**
 * A station device. `watch` is { station, name?, distanceKm? } (station from
 * src/model.js `stationOf`). One price feature per tracked fuel the station
 * sells, and the open/closed sensor. What the poll path needs is stored as
 * params, so it reads the device Gladys hands back, never the configuration.
 */
export function buildStationDevice(gladys, watch, fuels) {
  const { station } = watch;
  const id = ids.station(gladys, station.id);
  const features = fuels
    .filter((fuel) => sellsFuel(station, fuel))
    .map((fuel) => price(id, FEATURE.price(fuel), `${FUEL_NAMES[fuel]} (€/L)`));
  features.push(feature(id, FEATURE.OPEN, 'Open', C.UNKNOWN, T.SENSOR.BINARY));
  return {
    name: watch.name ?? stationLabel(station),
    external_id: id,
    features,
    // An empty param is left out rather than stored as an empty string.
    params: [
      { name: 'station_id', value: station.id },
      { name: 'brand', value: station.brand },
      { name: 'address', value: addressOf(station) },
      {
        name: 'distance_km',
        value: Number.isFinite(watch.distanceKm) ? watch.distanceKm.toFixed(1) : '',
      },
    ].filter((p) => p.value),
  };
}

export function buildCheapestDevice(gladys, fuels) {
  const id = ids.cheapest(gladys);
  const features = [];
  for (const fuel of fuels) {
    features.push(price(id, FEATURE.cheapestPrice(fuel), `Cheapest ${FUEL_NAMES[fuel]} (€/L)`));
    features.push(text(id, FEATURE.cheapestStation(fuel), `Cheapest ${FUEL_NAMES[fuel]} station`));
  }
  return { name: 'Cheapest nearby', external_id: id, features };
}

const paramsOf = (device) =>
  Object.fromEntries((device.params ?? []).map((p) => [p.name, p.value]));

/** The feature keys a created device has ("e5", "open"…), to publish only those. */
export function featureKeys(device) {
  const prefix = `${device.external_id}:`;
  return new Set(
    (device.features ?? [])
      .map((f) => String(f.external_id ?? ''))
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length)),
  );
}

/** What a created station device tells about its station. */
export function watchOfDevice(device) {
  const params = paramsOf(device);
  const distance = Number(params.distance_km);
  return {
    stationId: String(
      params.station_id ?? parseExternalId(device.external_id)?.stationId ?? '',
    ).toLowerCase(),
    label: device.name ?? params.station_id,
    brand: params.brand ?? '',
    address: params.address ?? '',
    distanceKm: params.distance_km !== undefined && Number.isFinite(distance) ? distance : null,
  };
}

const state = (deviceId, key, value) =>
  value === null || value === undefined
    ? []
    : [
        typeof value === 'string'
          ? { device_feature_external_id: ids.feature(deviceId, key), text: value }
          : { device_feature_external_id: ids.feature(deviceId, key), state: value },
      ];

const keep = (keys, key) => !keys || keys.size === 0 || keys.has(key);

/** The states of a station reading (src/model.js `nextReading`). */
export function stationStates(deviceId, reading, keys) {
  const states = [];
  for (const fuel of FUELS) {
    if (keep(keys, FEATURE.price(fuel))) {
      states.push(...state(deviceId, FEATURE.price(fuel), reading.prices[fuel]));
    }
  }
  if (typeof reading.open === 'boolean' && keep(keys, FEATURE.OPEN)) {
    states.push(...state(deviceId, FEATURE.OPEN, reading.open ? 1 : 0));
  }
  return states;
}

/**
 * The states of the "Cheapest nearby" device. `cheapest` is fuel ->
 * { price, label } | null; with no open station the name says so and the
 * price keeps its last value.
 */
export function cheapestStates(deviceId, cheapest, fuels, keys) {
  const states = [];
  for (const fuel of fuels) {
    const best = cheapest?.[fuel] ?? null;
    if (best && keep(keys, FEATURE.cheapestPrice(fuel))) {
      states.push(...state(deviceId, FEATURE.cheapestPrice(fuel), best.price));
    }
    if (keep(keys, FEATURE.cheapestStation(fuel))) {
      states.push(...state(deviceId, FEATURE.cheapestStation(fuel), best ? best.label : '—'));
    }
  }
  return states;
}
