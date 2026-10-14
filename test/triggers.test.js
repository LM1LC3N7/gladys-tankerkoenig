import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENE_TRIGGERS } from '../src/constants.js';
import { nextReading, pricesOf } from '../src/model.js';
import { cheapestEvents, stationEvents } from '../src/triggers.js';

const DEVICE = 'ext:tankerkoenig:station:278130b1-e062-4a0f-80cc-19e486b4c024';
const FUELS = ['e5', 'e10', 'diesel'];

/** A reading after a prices.php entry, chained on the previous one. */
const read = (previous, entry) => nextReading(previous, pricesOf({ x: entry }).get('x'), 0);
const events = (previous, current, fuels = FUELS) =>
  stationEvents(DEVICE, 'Aral', previous, current, fuels);

test('the first reading fires nothing', () => {
  assert.deepEqual(events(undefined, read(undefined, { status: 'open', e5: 1.5 })), []);
});

test('a price going below thresholds fires once per threshold crossed', () => {
  const r1 = read(undefined, { status: 'open', e5: 1.759 });
  const r2 = read(r1, { status: 'open', e5: 1.699 });
  const below = events(r1, r2).filter((e) => e.key === SCENE_TRIGGERS.PRICE_BELOW);
  assert.deepEqual(
    below.map((e) => e.data.threshold),
    ['1.70', '1.75'],
  );
  assert.deepEqual(below[0].data, {
    station: DEVICE,
    station_name: 'Aral',
    fuel: 'e5',
    price: 1.699,
    previous_price: 1.759,
    threshold: '1.70',
  });
  // Same price again, or going up: nothing.
  assert.deepEqual(events(r2, read(r2, { status: 'open', e5: 1.699 })), []);
  assert.deepEqual(events(r2, read(r2, { status: 'open', e5: 1.809 })), []);
  // Exactly on the threshold is not below it.
  const r3 = read(r2, { status: 'open', e5: 1.81 });
  const r4 = read(r3, { status: 'open', e5: 1.8 });
  assert.ok(!events(r3, r4).some((e) => e.data.threshold === '1.80'));
});

test('a drop fires every drop threshold reached, in cents', () => {
  const r1 = read(undefined, { status: 'open', diesel: 1.659 });
  const r2 = read(r1, { status: 'open', diesel: 1.599 });
  const drops = events(r1, r2).filter((e) => e.key === SCENE_TRIGGERS.PRICE_DROPPED);
  assert.deepEqual(
    drops.map((e) => e.data.min_drop),
    ['2', '3', '5'],
  );
  assert.equal(drops[0].data.drop, 6);
  assert.equal(drops[0].data.fuel, 'diesel');
  const small = read(r2, { status: 'open', diesel: 1.584 });
  assert.ok(!events(r2, small).some((e) => e.key === SCENE_TRIGGERS.PRICE_DROPPED), '1.5 cents');
});

test('closing keeps the price; reopening cheaper fires against the last known price', () => {
  const open = read(undefined, { status: 'open', e10: 1.729 });
  const closed = read(open, { status: 'closed' });
  const status = events(open, closed);
  assert.deepEqual(status, [
    {
      key: SCENE_TRIGGERS.STATION_STATUS,
      data: { station: DEVICE, station_name: 'Aral', status: 'closed' },
    },
  ]);
  const reopened = read(closed, { status: 'open', e10: 1.689 });
  const keys = events(closed, reopened).map(
    (e) => `${e.key}:${e.data.status ?? e.data.threshold ?? e.data.min_drop}`,
  );
  assert.deepEqual(keys, [
    'station_status_changed:open',
    'price_below:1.70',
    'price_dropped:2',
    'price_dropped:3',
  ]);
  // "no prices" says nothing about opening: no status event.
  assert.deepEqual(events(reopened, read(reopened, { status: 'no prices' })), []);
});

test('only the tracked fuels fire', () => {
  const r1 = read(undefined, { status: 'open', e5: 1.8, diesel: 1.7 });
  const r2 = read(r1, { status: 'open', e5: 1.6, diesel: 1.5 });
  assert.ok(events(r1, r2, ['diesel']).every((e) => e.data.fuel === 'diesel'));
});

test('the cheapest station changing, and the lowest price on the "Cheapest nearby" device', () => {
  const holder = (stationId, price) => ({
    stationId,
    device: `dev:${stationId}`,
    label: stationId,
    price,
  });
  const before = { e5: holder('a', 1.759), diesel: holder('a', 1.659) };
  const after = { e5: holder('b', 1.699), diesel: holder('a', 1.659) };
  const list = cheapestEvents('ext:tankerkoenig:cheapest', before, after, ['e5', 'diesel']);
  const changed = list.filter((e) => e.key === SCENE_TRIGGERS.CHEAPEST_CHANGED);
  assert.deepEqual(changed, [
    {
      key: SCENE_TRIGGERS.CHEAPEST_CHANGED,
      data: {
        station: 'dev:b',
        station_name: 'b',
        fuel: 'e5',
        price: 1.699,
        previous_station_name: 'a',
        previous_price: 1.759,
      },
    },
  ]);
  const below = list.filter((e) => e.key === SCENE_TRIGGERS.PRICE_BELOW);
  assert.deepEqual(
    below.map((e) => [e.data.station, e.data.threshold]),
    [
      ['ext:tankerkoenig:cheapest', '1.70'],
      ['ext:tankerkoenig:cheapest', '1.75'],
    ],
  );
  // Without the device: only the change. With nothing before or now: nothing.
  assert.equal(cheapestEvents(undefined, before, after, ['e5']).length, 1);
  assert.deepEqual(cheapestEvents('x', {}, after, ['e5']), []);
  assert.deepEqual(cheapestEvents('x', before, { e5: null }, ['e5']), []);
});
