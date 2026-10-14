# gladys-tankerkoenig

[Gladys Assistant](https://gladysassistant.com) external integration for
**Tankerkönig** (fuel prices in Germany): prices per station and fuel type,
cheapest station nearby, price threshold scene triggers and a dashboard
widget. **Unofficial, not affiliated with Tankerkönig.** Data: Tankerkönig /
MTS-K, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/app.js (TankerkoenigApp)
                 ├─ src/tankerkoenig.js  list.php, prices.php, detail.php (creativecommons.tankerkoenig.de/json)
                 ├─ src/model.js         stations, price readings, the cheapest station (pure)
                 ├─ src/devices.js       station and "Cheapest nearby" devices, states (pure)
                 ├─ src/triggers.js      two readings -> scene events (pure)
                 └─ src/widget.js        the "Fuel prices" widget (pure)
```

- **Discovery** offers the stations within the configured radius of the
  houses of Gladys (`location: true`, list.php, 25 nearest at most), the
  station ids typed in the configuration (detail.php) and the "Cheapest
  nearby" virtual device.
- **Reading**: only the stations the user created are read, through
  prices.php, 10 ids per call, every `poll_interval` minutes (10 by default, 5
  at least) plus a random 1 to 59 seconds, never a station twice within 5
  minutes. States go through `publishChangedStates`.
- **Triggers** come from two consecutive readings of the same station: every
  threshold crossed fires once, the first reading fires nothing; the cheapest
  station is compared only when the set of watched stations did not change.
- **A refused key stops every request** until the configuration is saved
  again, as Tankerkönig asks.

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npx github:GladysAssistant/integration-store .  # store admission checks
```

The fixtures in `test/fixtures/` are real Tankerkönig answers recorded on
2026-10-14 with the public demo key (Berlin, fake demo prices), errors included.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release.

## License

Apache-2.0 for the code. The fuel price data belongs to the MTS-K and is
republished by Tankerkönig under CC BY 4.0.
