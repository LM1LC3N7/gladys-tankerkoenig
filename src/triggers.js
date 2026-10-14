// -----------------------------------------------------------------------------
// Two consecutive readings -> scene events. Pure. Nothing fires on the first
// reading (no transition without a previous value), and every threshold
// crossed in one step fires once.
//
// The core matches the trigger fields by equality only: "below 1.70 €" is a
// threshold option the event carries, never a comparison the core makes.
// -----------------------------------------------------------------------------

import {
  DROP_THRESHOLDS,
  PRICE_THRESHOLDS,
  SCENE_TRIGGERS,
  STATION_STATUSES,
  thresholdValue,
} from './constants.js';
import { mills } from './model.js';

const isPrice = (value) => typeof value === 'number';

/**
 * The price events of one fuel between two prices: the thresholds crossed
 * downwards (price_below) and the drops reached (price_dropped).
 * `base` = { station, station_name }.
 */
export function priceEvents(base, fuel, previous, current) {
  const events = [];
  if (!isPrice(previous) || !isPrice(current) || mills(current) >= mills(previous)) {
    return events;
  }
  const data = { ...base, fuel, price: current, previous_price: previous };
  for (const threshold of PRICE_THRESHOLDS) {
    if (mills(previous) >= mills(threshold) && mills(current) < mills(threshold)) {
      events.push({
        key: SCENE_TRIGGERS.PRICE_BELOW,
        data: { ...data, threshold: thresholdValue(threshold) },
      });
    }
  }
  // In tenths of a cent: 1.789 -> 1.739 is a drop of 50, so 5 cents.
  const drop = mills(previous) - mills(current);
  for (const cents of DROP_THRESHOLDS) {
    if (drop >= cents * 10) {
      events.push({
        key: SCENE_TRIGGERS.PRICE_DROPPED,
        data: { ...data, min_drop: String(cents), drop: drop / 10 },
      });
    }
  }
  return events;
}

/** The events of a watched station between two readings, for the tracked fuels. */
export function stationEvents(device, label, previous, current, fuels) {
  if (!previous || !current) {
    return [];
  }
  const base = { station: device, station_name: label };
  const events = [];
  if (typeof previous.open === 'boolean' && typeof current.open === 'boolean') {
    if (previous.open !== current.open) {
      events.push({
        key: SCENE_TRIGGERS.STATION_STATUS,
        data: {
          ...base,
          status: current.open ? STATION_STATUSES.OPEN : STATION_STATUSES.CLOSED,
        },
      });
    }
  }
  for (const fuel of fuels) {
    events.push(...priceEvents(base, fuel, previous.prices[fuel], current.prices[fuel]));
  }
  return events;
}

/**
 * The events of the cheapest station between two searches. `previous` and
 * `current` are fuel -> { stationId, device, label, price } | null. The
 * "Cheapest nearby" device (when created) also gets the price events of the
 * lowest price, under its own id: a scene picks it to react once, whichever
 * station holds the price.
 */
export function cheapestEvents(cheapestDevice, previous, current, fuels) {
  const events = [];
  for (const fuel of fuels) {
    const before = previous?.[fuel];
    const now = current?.[fuel];
    if (!before || !now) {
      continue;
    }
    if (before.stationId !== now.stationId) {
      events.push({
        key: SCENE_TRIGGERS.CHEAPEST_CHANGED,
        data: {
          station: now.device,
          station_name: now.label,
          fuel,
          price: now.price,
          previous_station_name: before.label,
          previous_price: before.price,
        },
      });
    }
    if (cheapestDevice) {
      events.push(
        ...priceEvents(
          { station: cheapestDevice, station_name: now.label },
          fuel,
          before.price,
          now.price,
        ),
      );
    }
  }
  return events;
}
