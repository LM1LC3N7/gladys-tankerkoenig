// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys and a fake Tankerkönig.
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { TankerkoenigApp } from '../src/app.js';
import { ACTIONS, SCENE_ACTIONS, SCENE_TRIGGERS, WIDGETS } from '../src/constants.js';
import { buildCheapestDevice, buildStationDevice } from '../src/devices.js';
import { stationOf } from '../src/model.js';
import { HOME, ID, KEY, fixture, installTankerkoenig } from './helpers/fakeFetch.js';
import { createFakeTimers } from './helpers/fakeTimers.js';

const NOW = Date.parse('2026-10-14T10:00:00Z');
const MINUTE = 60_000;
const ids = { externalId: (suffix) => `ext:tankerkoenig:${suffix}` };
const dev = (id) => ids.externalId(`station:${id}`);
const CHEAPEST = ids.externalId('cheapest');
const listed = fixture('list-berlin.json').stations.map(stationOf);

/** A station device as Gladys hands it back once created. */
const created = (id, fuels = ['e5', 'e10', 'diesel']) => {
  const station = listed.find((s) => s.id === id);
  return buildStationDevice(ids, { station, distanceKm: station.distanceKm }, fuels);
};

let api;
afterEach(() => api?.restore());

async function setup({ houses = [HOME], devices = [] } = {}) {
  const clock = { now: NOW };
  api = installTankerkoenig({ now: () => clock.now });
  const gladys = createFakeGladys({ selector: 'tankerkoenig', houses, devices });
  const timers = createFakeTimers();
  const sleeps = [];
  const logs = [];
  const log = (...args) => logs.push(args.join(' '));
  const app = new TankerkoenigApp({
    gladys,
    logger: { info: log, warn: log, error: log, debug: log },
    now: () => clock.now,
    timers,
    // Waiting moves the clock, as it would in real life.
    sleep: async (ms) => {
      sleeps.push(ms);
      clock.now += ms;
    },
    random: () => 0,
  });
  gladys.onScanRequest(() => app.publishDevices());
  gladys.onDeviceCreated((device) => app.deviceCreated(device));
  gladys.onDeviceDeleted((device) => app.deviceDeleted(device));
  gladys.onSceneAction(SCENE_ACTIONS.CHEAPEST, (fields) => app.getCheapestStation(fields));
  gladys.onWidgetGet(WIDGETS.PRICES, (request) => app.getWidget(WIDGETS.PRICES, request));
  gladys.onAction(ACTIONS.TEST, () => app.testConnection());
  gladys.onAction(ACTIONS.SEARCH, (fields) => app.searchStations(fields));
  await gladys.connect();
  return { app, gladys, timers, clock, sleeps, logs };
}

/** Nothing the integration says or logs may carry the key. */
function assertNoKey(gladys, logs) {
  const said = JSON.stringify([
    gladys.fake.connectionStatuses,
    gladys.fake.discoveredDevices,
    gladys.fake.states,
    gladys.fake.sceneEvents,
    logs,
  ]);
  assert.ok(!said.includes(KEY), 'the API key leaked');
}

test('without a key: a status telling where to get one, and no request', async () => {
  const { app, gladys, timers } = await setup({ devices: [created(ID.ARAL)] });
  await app.start({});
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /onboarding\.tankerkoenig\.de/);
  await app.refresh();
  assert.equal(api.calls.length, 0);
  assert.equal(timers.intervals().length, 0);
});

test('discovery: the stations near the house, the typed ids, "Cheapest nearby"', async () => {
  const { app, gladys, logs } = await setup();
  await app.start({
    api_key: KEY,
    radius: 1.5,
    fuels: ['e5', 'diesel'],
    stations: `${ID.TOTAL_CLOSED}:Total du bureau, 00000000-0000-0000-0000-000000000099, oops`,
  });
  const devices = gladys.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((d) => d.name),
    [
      'Total du bureau',
      'Aral Tankstelle, Holzmarktstraße 12/14',
      'Sprint Berlin Kniprodestr.',
      'TotalEnergies Berlin, Storkower Str. 174',
      'Cheapest nearby',
    ],
  );
  const aral = devices[1];
  assert.equal(aral.external_id, dev(ID.ARAL));
  assert.deepEqual(
    aral.features.map((f) => [f.external_id.split(':').at(-1), f.category, f.unit ?? null]),
    [
      ['e5', 'currency', 'euro'],
      ['diesel', 'currency', 'euro'],
      ['open', 'unknown', null],
    ],
  );
  const params = Object.fromEntries(aral.params.map((p) => [p.name, p.value]));
  assert.deepEqual(params, {
    station_id: ID.ARAL,
    brand: 'ARAL',
    address: 'Holzmarktstraße 12/14, 10179 Berlin',
    distance_km: '1.4',
  });
  assert.deepEqual(
    devices.at(-1).features.map((f) => f.external_id.split(':').at(-1)),
    ['e5_price', 'e5_station', 'diesel_price', 'diesel_station'],
  );
  // One radius search, coordinates rounded; the house is read, never stored.
  const list = api.calls.find((c) => /list\.php/.test(c.url));
  assert.deepEqual(
    { lat: list.params.lat, lng: list.params.lng, rad: list.params.rad, type: list.params.type },
    { lat: '52.521', lng: '13.438', rad: '1.5', type: 'all' },
  );
  assert.equal(api.count(/detail\.php/), 2, 'the typed ids only');
  assert.ok(logs.some((l) => /"oops": not a Tankerkönig station id/.test(l)));
  assert.match(gladys.fake.connectionStatus.message.en, /No station yet/);
  assert.equal(api.count(/prices\.php/), 0, 'nothing created, nothing read');
  // A second scan within 5 minutes reuses the searches.
  await gladys.fake.scanRequest();
  assert.equal(api.count(/list\.php|detail\.php/), 3);
  assertNoKey(gladys, logs);
});

test('created stations are read in batches of 10, every 10 minutes off the round times', async () => {
  const twelve = listed.slice(0, 12).map((s) => s.id);
  const { app, gladys, timers } = await setup({ devices: twelve.map((id) => created(id)) });
  for (const id of twelve.slice(10)) {
    api.setPrice(id, { e5: 1.799, e10: 1.739, diesel: 1.659 });
  }
  await app.start({ api_key: KEY });
  const batches = api.calls.filter((c) => /prices\.php/.test(c.url));
  assert.deepEqual(
    batches.map((c) => c.params.ids.split(',').length),
    [10, 2],
  );
  assert.ok(batches[1].at - batches[0].at >= MINUTE, 'background batches a minute apart');
  assert.equal(gladys.fake.lastState(`${dev(ID.ARAL)}:e5`), 1.234);
  assert.equal(gladys.fake.lastState(`${dev(ID.ARAL)}:open`), 1);
  assert.equal(gladys.fake.lastState(`${dev(ID.TOTAL_CLOSED)}:open`), 0);
  assert.equal(gladys.fake.lastState(`${dev(ID.TOTAL_CLOSED)}:e5`), undefined, 'closed: no price');
  assert.equal(gladys.fake.lastState(`${dev(twelve[11])}:diesel`), 1.659);
  assert.match(gladys.fake.connectionStatus.message.en, /Watching 12 stations/);
  assert.equal(gladys.fake.sceneEvents.length, 0, 'nothing on the first reading');
  assert.equal(timers.intervals()[0].ms, 10 * MINUTE + 1000, '10 minutes and a few seconds');
  assert.ok(gladys.fake.widgetRefreshes.length > 0);
});

test('background requests leave a minute apart, user requests do not wait for them', async () => {
  const twelve = listed.slice(0, 12).map((s) => s.id);
  const { app, gladys, timers, clock } = await setup({ devices: twelve.map((id) => created(id)) });
  const at = (pattern) => api.calls.filter((c) => pattern.test(c.url)).map((c) => c.at);
  await app.start({ api_key: KEY });
  // Startup (nobody asked): the two batches, then the Discovery list.
  const [first, second] = at(/prices\.php/);
  assert.equal(second - first, MINUTE);
  assert.equal(at(/list\.php/)[0] - second, MINUTE);
  // The loop, ten minutes later: a minute between its two batches.
  clock.now += 10 * MINUTE;
  await timers.runIntervals();
  const tick = at(/prices\.php/).slice(-2);
  assert.equal(tick[1] - tick[0], MINUTE);
  // The user scans right after: 2 seconds, not a minute (the list cache expired).
  await gladys.fake.scanRequest();
  const scan = at(/list\.php/).at(-1);
  assert.equal(scan - tick[1], 2000);
  await gladys.fake.sceneAction(SCENE_ACTIONS.CHEAPEST, { fuel: 'e5', radius: 7 });
  assert.equal(at(/list\.php/).at(-1) - scan, 2000);
  assert.equal(at(/list\.php/).length, 3);
});

test('a station is never read twice within 5 minutes', async () => {
  const { app, clock } = await setup({ devices: [created(ID.ARAL), created(ID.SPRINT)] });
  await app.start({ api_key: KEY, poll_interval: 5 });
  assert.equal(api.count(/prices\.php/), 1);
  clock.now += 2 * MINUTE;
  await app.refresh();
  await app.start({ api_key: KEY, poll_interval: 5 }); // a reconnection
  assert.equal(api.count(/prices\.php/), 1);
  clock.now += 3 * MINUTE;
  await app.refresh();
  assert.equal(api.count(/prices\.php/), 2);
});

test('price moves become scene events: station, cheapest, opening', async () => {
  const devices = [created(ID.ARAL), created(ID.SPRINT), created(ID.JET)];
  const { app, gladys, timers, clock } = await setup({
    devices: [...devices, buildCheapestDevice(ids, ['e5'])],
  });
  api.setPrice(ID.ARAL, { e5: 1.799 });
  api.setPrice(ID.SPRINT, { e5: 1.759 });
  api.setPrice(ID.JET, { e5: 1.779 });
  await app.start({ api_key: KEY, fuels: ['e5'] });
  assert.equal(gladys.fake.sceneEvents.length, 0);
  assert.equal(gladys.fake.lastState(`${CHEAPEST}:e5_price`), 1.759);
  assert.equal(gladys.fake.lastState(`${CHEAPEST}:e5_station`), 'Sprint Berlin Kniprodestr.');

  clock.now += 10 * MINUTE;
  api.setPrice(ID.ARAL, { e5: 1.699 });
  api.setPrice(ID.JET, 'closed');
  await timers.runIntervals();
  const events = gladys.fake.sceneEvents.map((e) => ({ key: e.key, ...e.data }));
  const of = (station, key) => events.filter((e) => e.station === station && e.key === key);
  assert.deepEqual(
    of(dev(ID.ARAL), SCENE_TRIGGERS.PRICE_BELOW).map((e) => e.threshold),
    ['1.70', '1.75'],
  );
  assert.deepEqual(
    of(dev(ID.ARAL), SCENE_TRIGGERS.PRICE_DROPPED).map((e) => e.min_drop),
    ['2', '3', '5', '10'],
  );
  assert.deepEqual(of(dev(ID.JET), SCENE_TRIGGERS.STATION_STATUS)[0].status, 'closed');
  const changed = events.find((e) => e.key === SCENE_TRIGGERS.CHEAPEST_CHANGED);
  assert.equal(changed.station_name, 'Aral Tankstelle, Holzmarktstraße 12/14');
  assert.equal(changed.previous_station_name, 'Sprint Berlin Kniprodestr.');
  assert.equal(changed.price, 1.699);
  assert.deepEqual(
    of(CHEAPEST, SCENE_TRIGGERS.PRICE_BELOW).map((e) => e.threshold),
    ['1.70', '1.75'],
    'the lowest price went from 1.759 to 1.699',
  );
  assert.equal(gladys.fake.lastState(`${CHEAPEST}:e5_price`), 1.699);
  assert.equal(gladys.fake.lastState(`${dev(ID.JET)}:e5`), 1.779, 'closed: last price kept');
  assert.equal(gladys.fake.lastState(`${dev(ID.JET)}:open`), 0);

  // A station removed changes the field, not the prices: no cheapest event.
  const before = gladys.fake.sceneEvents.length;
  await gladys.fake.deviceDeleted(devices[0]);
  clock.now += 10 * MINUTE;
  await timers.runIntervals();
  assert.equal(gladys.fake.sceneEvents.length, before);
  assert.equal(gladys.fake.lastState(`${CHEAPEST}:e5_station`), 'Sprint Berlin Kniprodestr.');
});

test('stations added in Discovery are read together, a few seconds later', async () => {
  const { app, gladys, timers } = await setup();
  await app.start({ api_key: KEY, radius: 2 });
  const [first, second] = gladys.fake.discoveredDevices;
  await gladys.fake.deviceCreated(first);
  await gladys.fake.deviceCreated(second);
  assert.equal(api.count(/prices\.php/), 0);
  assert.equal(timers.timeouts().length, 1);
  await timers.runTimeouts();
  const batch = api.calls.filter((c) => /prices\.php/.test(c.url));
  assert.equal(batch.length, 1);
  assert.deepEqual(batch[0].params.ids.split(',').sort(), [ID.TOTAL_CLOSED, ID.ARAL].sort());
  assert.equal(gladys.fake.lastState(`${dev(ID.ARAL)}:diesel`), 1.234);
  // "Cheapest nearby" is filled from memory, without a request.
  await gladys.fake.deviceCreated(gladys.fake.discoveredDevices.at(-1));
  assert.equal(
    gladys.fake.lastState(`${CHEAPEST}:e10_station`),
    'Aral Tankstelle, Holzmarktstraße 12/14',
  );
  assert.equal(api.count(/prices\.php/), 1);
});

test('the "cheapest station" scene action searches the open stations, through a cache', async () => {
  const { app, gladys } = await setup();
  const stations = api.state.list.stations;
  stations.find((s) => s.id === ID.SPRINT).diesel = 0.989;
  stations.find((s) => s.id === ID.TOTAL_CLOSED).diesel = 0.899; // closed: ignored
  await app.start({ api_key: KEY, radius: 2 });
  const result = await gladys.fake.sceneAction(SCENE_ACTIONS.CHEAPEST, { fuel: 'diesel' });
  assert.equal(result.success, true);
  assert.deepEqual(result.data.outputs, {
    found: true,
    name: 'Sprint Berlin Kniprodestr.',
    brand: 'Sprint',
    address: 'Kniprodestr. 25, 10407 Berlin',
    price: 0.989,
    distance: 1.5,
    station_id: ID.SPRINT,
  });
  assert.equal(api.count(/list\.php/), 1, 'the discovery search is reused');
  await gladys.fake.sceneAction(SCENE_ACTIONS.CHEAPEST, { fuel: 'e5', radius: 5 });
  await gladys.fake.sceneAction(SCENE_ACTIONS.CHEAPEST, { fuel: 'e10', radius: 5 });
  assert.equal(api.count(/list\.php/), 2, 'one search for both');
  const tiny = await gladys.fake.sceneAction(SCENE_ACTIONS.CHEAPEST, { fuel: 'e5', radius: 1 });
  assert.equal(tiny.data.outputs.found, false, 'only a closed station within 1 km');
  const wrong = await gladys.fake.sceneAction(SCENE_ACTIONS.CHEAPEST, { fuel: 'lpg' });
  assert.equal(wrong.success, false);
});

test('the scene action needs a located house', async () => {
  const { app, gladys } = await setup({ houses: [{ ...HOME, latitude: null, longitude: null }] });
  await app.start({ api_key: KEY });
  const result = await gladys.fake.sceneAction(SCENE_ACTIONS.CHEAPEST, { fuel: 'e5' });
  assert.equal(result.success, false);
  assert.match(result.error, /No house with a position/);
  assert.equal(api.count(/list\.php/), 0);
});

test('the widget shows the watched stations from memory', async () => {
  const { app, gladys } = await setup({ devices: [created(ID.ARAL), created(ID.TOTAL_CLOSED)] });
  api.setPrice(ID.ARAL, { e5: 1.799, e10: 1.739, diesel: 1.659 });
  await app.start({ api_key: KEY });
  const calls = api.calls.length;
  const widget = await gladys.fake.widgetGet(WIDGETS.PRICES, { settings: {}, language: 'fr' });
  const content = widget.data.content;
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components.filter((c) => c.type === 'value').length, 3);
  const status = content.components.find((c) => c.type === 'status');
  assert.deepEqual(
    status.items.map((i) => i.value),
    ['E5 1,799 · E10 1,739 · D 1,659', 'fermée'],
  );
  assert.match(content.components.at(-1).text, /^Tankerkönig \/ MTS-K \(CC BY 4\.0\)/);
  const diesel = await gladys.fake.widgetGet(WIDGETS.PRICES, { settings: { fuel: 'diesel' } });
  assert.equal(diesel.data.content.components.filter((c) => c.type === 'value').length, 1);
  assert.equal(api.calls.length, calls, 'no request');
});

test('a refused key stops every request until the configuration is saved again', async () => {
  const { app, gladys, timers, logs } = await setup({ devices: [created(ID.ARAL)] });
  api.state.key = 'another-key';
  await app.start({ api_key: KEY });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /refused the API key \(Key existiert nicht/,
  );
  assert.equal(timers.intervals().length, 0);
  const sent = api.calls.length;
  assert.equal(sent, 1, 'the first refusal, then silence');
  await app.refresh();
  await app.start({ api_key: KEY }); // a reconnection to Gladys
  const action = await gladys.fake.sceneAction(SCENE_ACTIONS.CHEAPEST, { fuel: 'e5' });
  assert.equal(action.success, false);
  assert.equal(api.calls.length, sent);
  // The user saves the configuration (here the key was re-enabled).
  api.state.key = KEY;
  await app.start({ api_key: KEY }, { resume: true });
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(timers.intervals().length, 1);
  assertNoKey(gladys, logs);
});

test('Tankerkönig down: the status says so and the loop keeps running', async () => {
  const { app, gladys, timers, logs } = await setup({ devices: [created(ID.ARAL)] });
  api.state.down = true;
  await app.start({ api_key: KEY });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.ok(
    gladys.fake.connectionStatuses.some((s) =>
      /unreachable: HTTP 503 on \/json\/prices\.php/.test(s.message?.en),
    ),
  );
  assert.equal(timers.intervals().length, 1);
  api.state.down = false;
  await timers.runIntervals();
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assertNoKey(gladys, logs);
});

test('the buttons: test the key, search stations', async () => {
  const { app, gladys } = await setup({ devices: [created(ID.ARAL)] });
  await app.start({ api_key: KEY, stations: 'not-an-id' });
  const ok = await gladys.fake.action(ACTIONS.TEST);
  assert.match(ok.data.message.en, /accepted the API key\. 1 watched station, 1 located house/);
  assert.match(ok.data.message.fr, /« not-an-id » n'est pas un identifiant/);
  const found = await gladys.fake.action(ACTIONS.SEARCH, { query: 'holzmarkt', radius: 3 });
  assert.equal(
    found.data.message.en,
    `Aral Tankstelle, Holzmarktstraße 12/14 — Holzmarktstraße 12/14, 10179 Berlin · 1.4 km · ${ID.ARAL}`,
  );
  const none = await gladys.fake.action(ACTIONS.SEARCH, { query: 'zzz', radius: 3 });
  assert.match(none.data.message.fr, /Aucune station correspondant à « zzz »/);
  api.state.key = 'another-key';
  const refused = await gladys.fake.action(ACTIONS.TEST);
  assert.match(refused.data.message.en, /refused the API key/);
});
