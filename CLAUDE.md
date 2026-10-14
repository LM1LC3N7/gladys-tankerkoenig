# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15). It
reads the **Tankerkönig** open data API (German fuel prices reported to the
MTS-K, CC BY 4.0, free personal API key) and turns the stations near the
house into devices with their Super E5 / Super E10 / Diesel prices, a
"Cheapest nearby" device, scene triggers, a scene action and a dashboard
widget. Unofficial: not affiliated with Tankerkönig.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` and `audit` before every commit.

## Architecture

```
index.js              SDK wiring only (handlers registered before connect())
src/app.js            TankerkoenigApp: discovery, refresh loop, cheapest,
                      scene action, widget, buttons, the key stop
src/tankerkoenig.js   the API client: list / prices / detail, pacing, errors
src/model.js          API JSON -> stations, readings, cheapest (pure)
src/devices.js        devices, feature keys, external ids, states (pure)
src/triggers.js       transitions -> scene events (pure)
src/widget.js         the "fuel_prices" widget (pure)
src/config.js         config_schema normalized
src/constants.js      endpoint, pacing, thresholds, manifest keys
src/i18n.js           runtime texts (en/fr)
src/http.js           the only network access (fetch, timeout, User-Agent)
test/fixtures/        real API answers (demo key, 2026-10-14), errors too
test/helpers/         a fake Tankerkönig (fetch), fake timers
```

## Rules

- **Unofficial.** Every user-facing surface says "unofficial connector, not
  affiliated with Tankerkönig". Never use the Tankerkönig logo.
- **Attribution**: the data is CC BY 4.0. The widget caption, the docs and the
  README name "Tankerkönig / MTS-K (CC BY 4.0)"; keep it.
- **Keys are forever**: the manifest keys (`src/constants.js`), the feature
  keys (`FEATURE` in `src/devices.js`: `e5`, `e10`, `diesel`, `open`,
  `<fuel>_price`, `<fuel>_station`) and the external id shapes
  (`station:<uuid>`, `cheapest`) are stored in user scenes and dashboards.
  Never rename them.
- **Be polite with Tankerkönig** (its terms of use for home automation):
  - prices through `prices.php` only, 10 ids per call (`MAX_IDS_PER_CALL`),
    never a station twice within 5 minutes (`MIN_PRICE_INTERVAL`, checked per
    station, across restarts and reconnections);
  - refresh every 10 minutes by default, 5 at least, plus 1 to 59 random
    seconds so the calls never land on round times;
  - `list.php` (radius ≤ 25 km) only for discovery, the scene action and the
    Search button, through a 5-minute cache (`LIST_TTL`); `detail.php` only
    for the typed ids, kept a day;
  - the requests of a burst are spaced (`REQUEST_SPACING`) and serialized;
  - after a refused key, send nothing more (Tankerkönig: "keine weiteren
    Requests") until the user saves the configuration (`resume`), never on a
    mere reconnection.
- **The key is a secret**: it travels in the query string only, `http.js`
  errors carry the URL path only, the client scrubs it from any message, and
  `test/app.test.js` checks it appears in no status, state, event or log.
- **Errors come as HTTP 200** `{ ok: false, message }` (German messages):
  `TankerkoenigError`, `auth` when the message is about the key.
- **One event per transition** (`src/triggers.js`): the first reading fires
  nothing; a closed station keeps its last price (no event), reopening
  compares with it; the cheapest is compared only when the set of watched
  stations did not change.
- **Prices are € per litre** with 3 decimals, compared in tenths of a cent
  (`mills`). Gladys has no per-litre unit: `currency` / `decimal` / `euro`,
  "€/L" in the feature name.
- **Read-only rootfs**: write nothing on disk.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag.
- **Changelog**: every user-visible change adds a line under
  `## [Unreleased]` in `CHANGELOG.md`.
- **Manifest texts** are `{ en, fr }` objects; the catalog description holds
  10 to 100 characters per language; `test/manifest.test.js` ties the
  manifest to the code.
- **User-facing text** is bilingual, `docs/en.md` and `docs/fr.md` kept in
  sync. Comments explain why, in English.
- **Tests never touch the network** (`installTankerkoenig` replaces `fetch`).

## CI and pushes

- Group the commits and push **at most once a day**, unless the maintainer
  explicitly asks otherwise: the GitHub Actions quota is limited.
- If every CI job fails in under 2 seconds, the quota is exhausted: it is
  not a bug in the code.
- The Docker image cannot be built in the Claude Code cloud container (no
  network for `apk` inside `docker build`): the CI builds it.

## Refreshing the fixtures

The public demo key returns fake prices with real-shaped answers:

```bash
UA='gladys-tankerkoenig/dev (https://github.com/LM1LC3N7/gladys-tankerkoenig)'
B=https://creativecommons.tankerkoenig.de/json
K=00000000-0000-0000-0000-000000000002
curl -sA "$UA" "$B/list.php?lat=52.521&lng=13.438&rad=5&sort=dist&type=all&apikey=$K" | python3 -m json.tool --indent 1 --no-ensure-ascii > test/fixtures/list-berlin.json
curl -sA "$UA" "$B/detail.php?id=474e5046-deaf-4f9b-9a32-9797b778f047&apikey=$K" | python3 -m json.tool --indent 1 --no-ensure-ascii > test/fixtures/detail.json
```

`prices.json` is `prices.php` on the 10 nearest ids of the list.
