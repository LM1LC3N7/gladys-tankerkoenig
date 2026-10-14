// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ACTIONS,
  DROP_THRESHOLDS,
  FUELS,
  PRICE_THRESHOLDS,
  SCENE_ACTIONS,
  SCENE_TRIGGERS,
  STATION_STATUSES,
  WIDGETS,
  thresholdValue,
} from '../src/constants.js';
import { DEFAULTS } from '../src/config.js';
import { FEATURE, ids, parseExternalId } from '../src/devices.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const index = read('index.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) {
      yield* texts(item, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

const options = (field) => field.options.map((o) => o.value);

test('the store basics', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.equal(manifest.location, true, 'the stations near the house need it');
  assert.match(manifest.gladys_version, />=5\.1\.0/);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-tankerkoenig:${manifest.version}`);
  assert.equal(manifest.version, JSON.parse(read('package.json')).version);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.ok(read(`docs/${lang}.md`).length >= 300, `docs/${lang}.md is too short for the store`);
    assert.match(read(`docs/${lang}.md`), /CC BY 4\.0/, 'the data licence asks for attribution');
  }
  assert.match(manifest.description.en, /Unofficial/);
  assert.match(manifest.description.fr, /non officiel/);
  assert.match(manifest.config_schema[0].description.en, /not affiliated with Tankerkönig/);
});

test('every text is bilingual', () => {
  for (const [path, text] of texts(manifest)) {
    assert.ok(text.en?.trim() && text.fr?.trim(), `${path} needs en and fr`);
  }
});

test('the configuration matches the code', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  assert.equal(fields.api_key.type, 'secret', 'the key is a secret');
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (key === 'stations') {
      assert.equal(fields.stations.default, undefined);
    } else {
      assert.deepEqual(fields[key].default, value, key);
    }
  }
  assert.deepEqual(options(fields.fuels), FUELS);
  assert.equal(fields.poll_interval.min, 5, 'Tankerkönig: 5 minutes at least');
  assert.equal(fields.radius.max, 25, 'Tankerkönig: 25 km at most');
});

test('the keys of the manifest are the keys of the code', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  assert.deepEqual(
    manifest.scene_actions.map((a) => a.key).sort(),
    Object.values(SCENE_ACTIONS).sort(),
  );
  assert.deepEqual(
    manifest.scene_triggers.map((t) => t.key).sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );
  assert.deepEqual(manifest.widgets.map((w) => w.key).sort(), Object.values(WIDGETS).sort());
  for (const name of Object.keys(SCENE_ACTIONS)) {
    assert.ok(index.includes(`onSceneAction(SCENE_ACTIONS.${name}`), name);
  }
  const triggers = Object.fromEntries(manifest.scene_triggers.map((t) => [t.key, t]));
  const field = (trigger, key) => triggers[trigger].fields.find((f) => f.key === key);
  assert.deepEqual(
    options(field(SCENE_TRIGGERS.PRICE_BELOW, 'threshold')),
    PRICE_THRESHOLDS.map(thresholdValue),
  );
  assert.deepEqual(
    options(field(SCENE_TRIGGERS.PRICE_DROPPED, 'min_drop')),
    DROP_THRESHOLDS.map(String),
  );
  assert.deepEqual(
    options(field(SCENE_TRIGGERS.STATION_STATUS, 'status')),
    Object.values(STATION_STATUSES),
  );
  for (const trigger of Object.values(triggers)) {
    const fuel = trigger.fields.find((f) => f.key === 'fuel');
    if (fuel) {
      assert.deepEqual(options(fuel), FUELS, trigger.key);
    }
  }
  const action = manifest.scene_actions[0];
  assert.deepEqual(options(action.fields.find((f) => f.key === 'fuel')), FUELS);
  assert.deepEqual(options(manifest.widgets[0].settings[0]), FUELS);
});

test('the feature keys and external ids are forever', () => {
  const gladys = { externalId: (suffix) => `ext:tankerkoenig:${suffix}` };
  const station = ids.station(gladys, '278130b1-e062-4a0f-80cc-19e486b4c024');
  assert.equal(station, 'ext:tankerkoenig:station:278130b1-e062-4a0f-80cc-19e486b4c024');
  assert.deepEqual(parseExternalId(station), {
    kind: 'station',
    stationId: '278130b1-e062-4a0f-80cc-19e486b4c024',
  });
  assert.deepEqual(parseExternalId(ids.cheapest(gladys)), { kind: 'cheapest' });
  assert.deepEqual([...FUELS.map(FEATURE.price), FEATURE.OPEN], ['e5', 'e10', 'diesel', 'open']);
  assert.deepEqual(FUELS.map(FEATURE.cheapestPrice), ['e5_price', 'e10_price', 'diesel_price']);
  assert.deepEqual(FUELS.map(FEATURE.cheapestStation), [
    'e5_station',
    'e10_station',
    'diesel_station',
  ]);
});
