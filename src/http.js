// -----------------------------------------------------------------------------
// The only place that talks to the network: `fetch` with a timeout and an
// identifying User-Agent. The tests replace it with `setFetch()`.
//
// Error messages carry the path of the URL only, never its query: the API key
// travels in the query string and must never reach a log or a status.
// -----------------------------------------------------------------------------

import { HTTP_TIMEOUT, USER_AGENT } from './constants.js';

let fetchImpl = (...args) => globalThis.fetch(...args);

/** Replace the fetch implementation (tests only). Returns the previous one. */
export function setFetch(impl) {
  const previous = fetchImpl;
  fetchImpl = impl;
  return previous;
}

export class HttpError extends Error {
  constructor(status, url, body) {
    super(`HTTP ${status} on ${new URL(url).pathname}${body ? `: ${body}` : ''}`);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

/** GET a JSON document; throws an HttpError on a non-2xx status or a non-JSON body. */
export async function getJson(url, { timeout = HTTP_TIMEOUT } = {}) {
  const response = await fetchImpl(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    redirect: 'follow',
    signal: AbortSignal.timeout(Math.max(1, timeout)),
  });
  const text = await response.text();
  if (!response.ok) {
    let message = text.slice(0, 200);
    try {
      message = JSON.parse(text).message ?? message;
    } catch {
      // not JSON
    }
    throw new HttpError(response.status, url, message);
  }
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    // An HTML maintenance page served with a 200.
    throw new HttpError(response.status, url, 'the answer is not JSON');
  }
}
