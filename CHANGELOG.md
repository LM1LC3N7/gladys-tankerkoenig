# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.1] - 2026-10-14

### Added

- One device per watched station (suggested in Discovery within a radius of
  the house, or typed as a Tankerkönig id with an optional custom name): the
  Super E5, Super E10 and Diesel prices in € per litre for the fuels tracked
  and sold, and whether the station is open.
- A "Cheapest nearby" device: per fuel, the lowest price among the open
  watched stations and the station holding it.
- Scene triggers "fuel price below a threshold" (1.40 to 2.20 €/L), "fuel
  price dropped" (2 to 10 cents), "cheapest station changed" and "station
  opened or closed".
- Scene action "cheapest station nearby": name, brand, address, price and
  distance of the cheapest open station around the house.
- Dashboard widget "Fuel prices", with the attribution of the data
  (Tankerkönig / MTS-K, CC BY 4.0).
- "Test the API key" and "Search stations" buttons.
- Tankerkönig's terms enforced: prices read in batches of 10, at most every 5
  minutes per station, off the round times; the requests nobody asked for
  (the refresh loop, startup) a minute apart, the ones the user asks for
  (Discovery, buttons, scene action) 2 seconds apart; radius searches and
  station details cached; no more requests after a refused key until the
  configuration is saved again.

[Unreleased]: https://github.com/LM1LC3N7/gladys-tankerkoenig/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-tankerkoenig/releases/tag/v0.1.1
