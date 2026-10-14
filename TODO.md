# TODO

## Before announcing

- [ ] Test on a real Gladys 5.1+ with a real personal API key and a house in
      Germany: discovery around the house, a typed id, the widget, a "price
      below" scene over a day, the "cheapest station" action.
- [ ] Watch a day of logs: the number of prices.php calls matches the
      interval, no call on round minutes, no list.php outside the scans.
- [ ] Announce the integration to Tankerkönig (their terms ask public apps
      and services to send them a link), then add the
      `gladys-assistant-integration` topic to publish in the store.
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).

## To confirm (built against the demo key)

- [ ] The demo key answers with fake prices (1.009 / 1.234 everywhere): check
      real prices keep 3 decimals and real answers the same field names.
- [ ] How `list.php` reports a fuel a station does not sell (`false`, `null`
      or a missing key): `sellsFuel` drops the feature on `false`, and on
      `null` for an open station only.
- [ ] `prices.php` for an unknown id: the demo omits it, the docs say
      `"no stations"`; both are handled as unknown.
- [ ] The `postCode` of a station with a leading zero (Saxony, 0xxxx) arrives
      as a number: it is padded back to 5 digits.
- [ ] The wording of the refused-key messages (`AUTH_MESSAGE` in
      `src/tankerkoenig.js`): "Key existiert nicht oder ist deaktiviert" and
      "apikey nicht angegeben, falsch, oder im falschen Format" were recorded;
      a blocked key may say something else.
- [ ] The `currency` / `euro` features render well as a price per litre in
      the device widget, and the `unknown` / `binary` "Open" feature as
      on/off.
- [ ] The widget tiles (`value` with `€/L`) on a phone.

## Ideas

- The opening times of a station (detail.php `openingTimes`) as a text
  feature.
- A `house` field (source `houses`, Gladys 5.2) on the scene action for the
  instances with several houses (today: the first located house).
- A "price rose" trigger, and a daily min/max per station.
