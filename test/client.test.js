// -----------------------------------------------------------------------------
// The pacing of the client: background requests a minute after any request,
// user requests 2 seconds after, never stuck behind a waiting background one.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TankerkoenigClient } from '../src/tankerkoenig.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('a user request never queues behind a background one waiting for its minute', async () => {
  let now = 1000;
  const sleepers = [];
  const client = new TankerkoenigClient({
    apiKey: 'k',
    now: () => now,
    sleep: (ms) => new Promise((resolve) => sleepers.push({ ms, resolve })),
  });
  client.lastAt = 1000; // a request just left
  const background = client.slot({ background: true });
  const user = client.slot();
  await flush();
  assert.deepEqual(
    sleepers.map((s) => s.ms),
    [60_000, 2000],
  );
  now = 3000;
  sleepers[1].resolve();
  assert.equal(await user, 3000, 'the user request leaves after 2 seconds');
  now = 61_000;
  sleepers[0].resolve();
  await flush();
  assert.equal(sleepers[2].ms, 2000, 'the background one now waits a minute after the user one');
  now = 63_000;
  sleepers[2].resolve();
  assert.equal(await background, 63_000);
  // Cancelled while waiting: nothing leaves, the slot stays free.
  let active = true;
  const cancelled = client.slot({ background: true, active: () => active });
  await flush();
  active = false;
  sleepers[3].resolve();
  assert.equal(await cancelled, undefined);
  assert.equal(client.lastAt, 63_000);
});
