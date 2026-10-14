// -----------------------------------------------------------------------------
// Tankerkönig JSON -> plain stations, price readings, the cheapest station.
// Pure: `now` is a parameter (milliseconds).
//
// A price is a number of euros per litre with 3 decimals (1.739: the last
// digit is the famous 9/10 of a cent). `false` means the station does not
// sell that fuel; `null` or a missing key means no price right now.
// -----------------------------------------------------------------------------

import { FUELS } from './constants.js';

/** Lowercase, no accents, no punctuation: "Holzmarktstraße" -> "holzmarktstrasse". */
export function fold(text) {
  return String(text ?? '')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const clean = (text) =>
  String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();

/** A price in €/L, `false` (fuel not sold) or null (no price). */
export function priceValue(value) {
  if (value === false) {
    return false;
  }
  const n = typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : null;
}

/** Prices compared in tenths of a cent, so 1.7 and 1.700 never differ by a float. */
export const mills = (price) => Math.round(price * 1000);

/** German postcodes are 5 digits; Tankerkönig sends a number (01067 -> 1067). */
function postCodeOf(value) {
  const text = clean(value);
  return /^\d{4}$/.test(text) ? `0${text}` : text;
}

/** A station of list.php or detail.php, normalized. */
export function stationOf(raw) {
  const prices = {};
  const sold = {};
  for (const fuel of FUELS) {
    const value = priceValue(raw?.[fuel]);
    prices[fuel] = typeof value === 'number' ? value : null;
    sold[fuel] = value === false ? false : typeof value === 'number' ? true : null;
  }
  const distance = Number(raw?.dist);
  return {
    id: String(raw?.id ?? '').toLowerCase(),
    name: clean(raw?.name),
    brand: clean(raw?.brand),
    street: clean(raw?.street),
    houseNumber: clean(raw?.houseNumber),
    postCode: postCodeOf(raw?.postCode),
    place: clean(raw?.place),
    latitude: Number(raw?.lat),
    longitude: Number(raw?.lng),
    distanceKm: raw?.dist !== undefined && Number.isFinite(distance) ? distance : null,
    open: typeof raw?.isOpen === 'boolean' ? raw.isOpen : null,
    prices,
    sold,
  };
}

/**
 * Whether to give a station a price feature for a fuel: not when Tankerkönig
 * says it does not sell it (`false`), nor when an open station has no price
 * for it (a closed one may simply not report while closed).
 */
export function sellsFuel(station, fuel) {
  const sold = station.sold?.[fuel];
  if (sold === false) {
    return false;
  }
  return sold === true || station.open !== true;
}

/** "Aral Tankstelle, Holzmarktstraße 12/14" (the name alone when it holds the street). */
export function stationLabel(station) {
  const base = station.name || station.brand || station.id;
  if (!station.street || fold(base).includes(fold(station.street))) {
    return base;
  }
  return `${base}, ${[station.street, station.houseNumber].filter(Boolean).join(' ')}`;
}

/** "Holzmarktstraße 12/14, 10179 Berlin". */
export function addressOf(station) {
  const line1 = [station.street, station.houseNumber].filter(Boolean).join(' ');
  const line2 = [station.postCode, station.place].filter(Boolean).join(' ');
  return [line1, line2].filter(Boolean).join(', ');
}

/**
 * A prices.php answer -> Map(id -> entry). An entry is
 * { status, open: true | false | null, prices: { fuel: number | null }, sold: { fuel: bool | null } }.
 * Status: "open", "closed", "no prices" (open, nothing reported) or
 * "no stations" (unknown id).
 */
export function pricesOf(answer) {
  const entries = new Map();
  for (const [id, raw] of Object.entries(answer ?? {})) {
    const status = String(raw?.status ?? 'unknown');
    const entry = {
      status,
      open: status === 'open' ? true : status === 'closed' ? false : null,
      prices: {},
      sold: {},
    };
    for (const fuel of FUELS) {
      const value = priceValue(raw?.[fuel]);
      entry.prices[fuel] = typeof value === 'number' ? value : null;
      entry.sold[fuel] = value === false ? false : typeof value === 'number' ? true : null;
    }
    entries.set(id.toLowerCase(), entry);
  }
  return entries;
}

/**
 * The reading of a station after a prices.php answer. `prices` keeps the
 * last known price of each fuel (a closed station reports none: its price
 * did not change), `live` only what this answer said (the cheapest search
 * uses it). `entry` is undefined when Tankerkönig did not list the station.
 */
export function nextReading(previous, entry, now) {
  const prices = {};
  const live = {};
  for (const fuel of FUELS) {
    const fresh = entry?.prices?.[fuel] ?? null;
    live[fuel] = fresh;
    if (fresh !== null) {
      prices[fuel] = fresh;
    } else if (entry?.sold?.[fuel] === false) {
      prices[fuel] = null;
    } else {
      prices[fuel] = previous?.prices?.[fuel] ?? null;
    }
  }
  return {
    at: now,
    readAt: new Date(now).toISOString(),
    status: entry?.status ?? 'no stations',
    open: entry ? (entry.open ?? previous?.open ?? null) : null,
    prices,
    live,
  };
}

/** Lower price first; on a tie the current holder keeps it, then the nearest. */
function better(a, b, holderId) {
  if (mills(a.price) !== mills(b.price)) {
    return mills(a.price) < mills(b.price);
  }
  if (a.stationId === holderId || b.stationId === holderId) {
    return a.stationId === holderId;
  }
  const da = a.distanceKm ?? Number.POSITIVE_INFINITY;
  const db = b.distanceKm ?? Number.POSITIVE_INFINITY;
  if (da !== db) {
    return da < db;
  }
  return a.label.localeCompare(b.label) < 0;
}

/**
 * The cheapest open station for a fuel among the watched ones, or null.
 * `candidates`: [{ stationId, device, label, distanceKm, reading }].
 */
export function cheapestOf(candidates, fuel, holderId) {
  let best = null;
  for (const c of candidates) {
    const price = c.reading?.status === 'open' ? c.reading.live?.[fuel] : null;
    if (typeof price !== 'number') {
      continue;
    }
    const candidate = {
      stationId: c.stationId,
      device: c.device,
      label: c.label,
      distanceKm: c.distanceKm ?? null,
      price,
    };
    if (!best || better(candidate, best, holderId)) {
      best = candidate;
    }
  }
  return best;
}

/** The cheapest open station of a radius search (stationOf objects), or null. */
export function cheapestInList(stations, fuel) {
  return (
    stations
      .filter((s) => s.open === true && typeof s.prices[fuel] === 'number')
      .sort(
        (a, b) =>
          mills(a.prices[fuel]) - mills(b.prices[fuel]) ||
          (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity),
      )[0] ?? null
  );
}

/** "1.739 €" (en) / "1,739 €" (fr). */
export function formatPrice(price, language = 'en') {
  if (typeof price !== 'number') {
    return '—';
  }
  const number = new Intl.NumberFormat(language === 'fr' ? 'fr-FR' : 'en-GB', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(price);
  return `${number} €`;
}
