// -----------------------------------------------------------------------------
// Fake `fetch` for the tests: routes requests to handlers, records every
// call, and fails loudly on an unexpected URL. No test touches the network.
//
// `installTankerkoenig()` plays the API from the recorded fixtures (demo key
// answers of 2026-10-14, around Berlin Alexanderplatz).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { setFetch } from '../../src/http.js';

setFetch(async (url) => {
  throw new Error(`Network call without a fake fetch in a test: ${url}`);
});

export function fixture(name) {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
}

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Install a fake fetch; `routes` is a list of [RegExp, handler({ url, params })]. */
export function installFetch(routes) {
  const calls = [];
  const previous = setFetch(async (url, init = {}) => {
    const call = { url, params: Object.fromEntries(new URL(url).searchParams), init };
    calls.push(call);
    const route = routes.find(([pattern]) => pattern.test(url));
    if (!route) {
      throw new Error(`Unexpected network call in a test: ${url}`);
    }
    return route[1](call);
  });
  return { calls, restore: () => setFetch(previous) };
}

/** The key the fake API accepts (any UUID: the tests never see a real one). */
export const KEY = '11111111-2222-4333-8444-555555555555';
/** The house of the tests: the point of the list.php fixture. */
export const HOME = { id: 1, name: 'Home', selector: 'home', latitude: 52.521, longitude: 13.438 };

/** Station ids of the fixture, nearest first. */
export const ID = {
  TOTAL_CLOSED: '474e5046-deaf-4f9b-9a32-9797b778f047',
  ARAL: '278130b1-e062-4a0f-80cc-19e486b4c024',
  SPRINT: '1c4f126b-1f3c-4b38-9692-05c400ea8e61',
  TOTAL: '38e0e779-b0f1-46ae-a35b-09f8e37024a1',
  JET: '51d4b6a9-a095-1aa0-e100-80009459e03a',
};

/**
 * A fake Tankerkönig. `state.prices` is id -> prices.php entry (from the
 * fixture, editable); list.php honours the radius; an unknown key gets the
 * recorded refusal. Every call is recorded in `calls`.
 */
export function installTankerkoenig() {
  const state = {
    key: KEY,
    prices: fixture('prices.json').prices,
    list: fixture('list-berlin.json'),
    details: { [fixture('detail.json').station.id]: fixture('detail.json') },
    down: false,
  };
  const guard = (params, answer) => {
    if (state.down) {
      return json({ message: 'Service Unavailable' }, 503);
    }
    return params.apikey === state.key ? answer() : json(fixture('error-key.json'));
  };
  const fake = installFetch([
    [
      /\/list\.php\?/,
      ({ params }) =>
        guard(params, () =>
          json({
            ...state.list,
            stations: state.list.stations.filter((s) => s.dist <= Number(params.rad)),
          }),
        ),
    ],
    [
      /\/prices\.php\?/,
      ({ params }) =>
        guard(params, () => {
          const prices = {};
          for (const id of params.ids.split(',')) {
            prices[id] = state.prices[id] ?? { status: 'no stations' };
          }
          return json({ ok: true, license: 'CC BY 4.0', data: 'MTS-K', prices });
        }),
    ],
    [
      /\/detail\.php\?/,
      ({ params }) =>
        guard(params, () => json(state.details[params.id] ?? fixture('error-station.json'))),
    ],
  ]);
  return {
    ...fake,
    state,
    /** Set the prices.php answer of a station: setPrice(id, { e5: 1.799 }) or ('closed'). */
    setPrice(id, value) {
      state.prices[id] =
        value === 'closed'
          ? { status: 'closed' }
          : { ...state.prices[id], ...value, status: 'open' };
    },
    count: (pattern) => fake.calls.filter((c) => pattern.test(c.url)).length,
  };
}
