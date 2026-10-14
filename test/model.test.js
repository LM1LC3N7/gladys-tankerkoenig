import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addressOf,
  cheapestInList,
  cheapestOf,
  formatPrice,
  nextReading,
  pricesOf,
  sellsFuel,
  stationLabel,
  stationOf,
} from '../src/model.js';
import { DEFAULTS, normalizeConfig, parseFuels, parseStationEntry } from '../src/config.js';
import { ID, fixture } from './helpers/fakeFetch.js';

const listed = () => fixture('list-berlin.json').stations.map(stationOf);

test('a list.php station is normalized', () => {
  const aral = listed().find((s) => s.id === ID.ARAL);
  assert.equal(aral.name, 'Aral Tankstelle');
  assert.equal(aral.brand, 'ARAL');
  assert.equal(aral.street, 'Holzmarktstraße');
  assert.equal(aral.houseNumber, '12/14');
  assert.equal(aral.postCode, '10179', 'the number becomes a postcode');
  assert.equal(aral.distanceKm, 1.4);
  assert.equal(aral.open, true);
  assert.deepEqual(aral.prices, { e5: 1.009, e10: 1.009, diesel: 1.009 });
  assert.deepEqual(aral.sold, { e5: true, e10: true, diesel: true });
  assert.equal(stationLabel(aral), 'Aral Tankstelle, Holzmarktstraße 12/14');
  assert.equal(addressOf(aral), 'Holzmarktstraße 12/14, 10179 Berlin');
  // detail.php: trailing spaces in the street, no distance.
  const detail = stationOf(fixture('detail.json').station);
  assert.equal(detail.street, 'Margarete-Sommer-Str.');
  assert.equal(detail.distanceKm, null);
  assert.equal(detail.open, false);
  // A Saxon postcode loses its leading zero as a JSON number.
  assert.equal(stationOf({ id: 'X', postCode: 1067 }).postCode, '01067');
});

test('labels avoid repeating the street, addresses skip what is missing', () => {
  const jet = listed().find((s) => s.id === ID.JET);
  assert.equal(stationLabel(jet), 'JET BERLIN STORKOWER STR. 126-130');
  const noNumber = listed().find((s) => s.houseNumber === '' && s.brand === 'ARAL');
  assert.match(stationLabel(noNumber), /^Aral Tankstelle, [^ ]+/);
  assert.ok(!addressOf(noNumber).includes('  '));
  assert.equal(addressOf({ street: '', houseNumber: '', postCode: '', place: 'Berlin' }), 'Berlin');
});

test('a fuel feature only for a fuel the station sells', () => {
  const base = { open: true, sold: { e5: true, e10: false, diesel: null } };
  assert.equal(sellsFuel(base, 'e5'), true);
  assert.equal(sellsFuel(base, 'e10'), false, 'false: not sold');
  assert.equal(sellsFuel(base, 'diesel'), false, 'open without a price: not sold');
  assert.equal(sellsFuel({ ...base, open: false }, 'diesel'), true, 'closed: maybe sold');
});

test('a prices.php answer: open, closed, not sold, nothing reported, unknown', () => {
  const entries = pricesOf({
    'AAA-1': { status: 'open', e5: 1.789, e10: false, diesel: 1.6489 },
    'aaa-2': { status: 'closed' },
    'aaa-3': { status: 'no prices' },
    'aaa-4': { status: 'no stations' },
  });
  const open = entries.get('aaa-1');
  assert.equal(open.open, true);
  assert.deepEqual(open.prices, { e5: 1.789, e10: null, diesel: 1.649 });
  assert.equal(open.sold.e10, false);
  assert.equal(entries.get('aaa-2').open, false);
  assert.equal(entries.get('aaa-3').open, null);
  assert.equal(entries.get('aaa-4').status, 'no stations');
  // The recorded batch: 8 open, 2 closed.
  const batch = pricesOf(fixture('prices.json').prices);
  assert.equal(batch.size, 10);
  assert.equal([...batch.values()].filter((e) => e.open === false).length, 2);
});

test('a reading keeps the last known price of a closed station', () => {
  const first = nextReading(undefined, pricesOf({ a: { status: 'open', e5: 1.789 } }).get('a'), 1);
  assert.equal(first.prices.e5, 1.789);
  const closed = nextReading(first, pricesOf({ a: { status: 'closed' } }).get('a'), 2);
  assert.equal(closed.open, false);
  assert.equal(closed.prices.e5, 1.789, 'kept');
  assert.equal(closed.live.e5, null, 'not a current price');
  const stopped = nextReading(closed, pricesOf({ a: { status: 'open', e5: false } }).get('a'), 3);
  assert.equal(stopped.prices.e5, null, 'no longer sold');
  const unknown = nextReading(first, undefined, 4);
  assert.equal(unknown.status, 'no stations');
  assert.equal(unknown.open, null);
});

test('the cheapest open station: lowest price, then the holder, then the nearest', () => {
  const reading = (status, e5) => ({ status, live: { e5 } });
  const candidates = [
    { stationId: 'a', label: 'A', distanceKm: 3, reading: reading('open', 1.759) },
    { stationId: 'b', label: 'B', distanceKm: 2, reading: reading('open', 1.759) },
    { stationId: 'c', label: 'C', distanceKm: 1, reading: reading('closed', null) },
    { stationId: 'd', label: 'D', distanceKm: 1, reading: reading('open', 1.799) },
  ];
  assert.equal(cheapestOf(candidates, 'e5').stationId, 'b', 'tie: the nearest');
  assert.equal(cheapestOf(candidates, 'e5', 'a').stationId, 'a', 'tie: the holder keeps it');
  assert.equal(cheapestOf(candidates, 'e10'), null);
  candidates[3].reading = reading('open', 1.709);
  assert.deepEqual(cheapestOf(candidates, 'e5', 'a'), {
    stationId: 'd',
    device: undefined,
    label: 'D',
    distanceKm: 1,
    price: 1.709,
  });
});

test('the cheapest of a radius search, and the price text', () => {
  const stations = listed();
  stations.find((s) => s.id === ID.SPRINT).prices.diesel = 0.989;
  stations.find((s) => s.id === ID.TOTAL_CLOSED).prices.diesel = 0.899; // closed: ignored
  assert.equal(cheapestInList(stations, 'diesel').id, ID.SPRINT);
  assert.equal(cheapestInList(stations, 'e5').id, ID.ARAL, 'all equal: the nearest open one');
  assert.equal(cheapestInList([], 'e5'), null);
  assert.equal(formatPrice(1.739, 'en'), '1.739 €');
  assert.equal(formatPrice(1.7, 'fr'), '1,700 €');
  assert.equal(formatPrice(null, 'fr'), '—');
});

test('the configuration is normalized', () => {
  const base = normalizeConfig({});
  assert.deepEqual(base.fuels, DEFAULTS.fuels);
  assert.equal(base.radius, 5);
  assert.equal(base.pollInterval, 10);
  assert.equal(base.apiKey, '');
  const config = normalizeConfig({
    api_key: ' 11111111-2222-4333-8444-555555555555 ',
    fuels: ['diesel', 'e5', 'lpg'],
    radius: 40,
    poll_interval: 1,
    stations: `${ID.ARAL.toUpperCase()}:Aral du bureau, nope; 11111111-2222-4333-8444-555555555555`,
  });
  assert.equal(config.apiKey, '11111111-2222-4333-8444-555555555555');
  assert.deepEqual(config.fuels, ['e5', 'diesel'], 'known fuels, in display order');
  assert.equal(config.radius, 25);
  assert.equal(config.pollInterval, 5, 'never below 5 minutes');
  assert.deepEqual(config.stations, [{ id: ID.ARAL, name: 'Aral du bureau' }], 'not the key');
  assert.deepEqual(config.invalidStations, ['nope']);
  assert.deepEqual(parseFuels('e10, diesel'), ['e10', 'diesel']);
  assert.deepEqual(parseFuels('["e5"]'), ['e5']);
  assert.deepEqual(parseFuels([]), ['e5', 'e10', 'diesel'], 'none checked: all three');
  assert.equal(normalizeConfig({ radius: 2.3 }).radius, 2.5);
  assert.equal(parseStationEntry(' '), undefined);
});
