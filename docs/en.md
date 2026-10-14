# Tankerkönig

**Unofficial connector, not affiliated with Tankerkönig.** It brings the fuel
prices of Germany into Gladys through the
[Tankerkönig](https://creativecommons.tankerkoenig.de/) open data API: every
German station must report its Super E5, Super E10 and Diesel prices to the
Markttransparenzstelle für Kraftstoffe (MTS-K), and Tankerkönig republishes
them under the CC BY 4.0 licence. Data: Tankerkönig / MTS-K, CC BY 4.0
([tankerkoenig.de](https://www.tankerkoenig.de/)).

## What you get

| Surface                            | Content                                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One device per **watched station** | the price of each tracked fuel the station sells (€ per litre) and whether it is open                                                                   |
| The **Cheapest nearby** device     | per fuel, the lowest price among the open watched stations and the name of the station                                                                  |
| Scene triggers                     | **fuel price below a threshold** (1.40 to 2.20 €/L), **fuel price dropped** (2 to 10 cents), **cheapest station changed**, **station opened or closed** |
| Scene action                       | **cheapest station nearby**: name, brand, address, price and distance of the cheapest open station around the house, for a fuel                         |
| Dashboard widget                   | **Fuel prices**: the cheapest price per fuel, the watched stations with their prices (the cheapest in green), the attribution of the data               |

## Setup

1. Request a free personal API key on
   [onboarding.tankerkoenig.de](https://onboarding.tankerkoenig.de/) (one key
   per person; Tankerkönig asks you never to request a second one without
   contacting them first).
2. Paste it in **Tankerkönig API key**, pick the **fuels to track** and the
   **radius around the house** (5 km by default, 25 km at most), then save.
3. Open **Discovery**: the stations within the radius of your house (the
   house position in Gladys, 25 nearest at most) and the **Cheapest nearby**
   device are offered. Add the ones you use.
4. A station further away: the **Search stations** button lists the stations
   around the house whose name, brand, street, town or postcode contains a
   text, with their id. Type the ids in **Other stations**, separated by
   commas, with an optional custom name after a colon
   (`278130b1-e062-4a0f-80cc-19e486b4c024:Aral near work`), save, and open
   Discovery again.
5. Put the **Fuel prices** widget on a dashboard; its setting shows a single
   fuel when you pick one.

### How often Tankerkönig is called

Tankerkönig limits its free API to one request per minute ("die
Abfragefrequenz auf einen requet/Minute beschränkt", sic) and asks to avoid
the regular requests the user did not ask for ("Regelmäßige, nicht explizit
vom User initiierte Requests sind zu vermeiden"). So:

- the prices of the watched stations are read every 10 minutes (option
  **Refresh interval**, 5 minutes at least), 10 stations per request, a few
  random seconds off the round times, and never a station twice within 5
  minutes;
- what nobody asked for right now (that loop, the reading at startup or after
  a reconnection, the Discovery list prepared at startup) leaves at least one
  minute after the previous request: with 25 stations, the three requests of a
  refresh take two minutes;
- what you ask for (opening Discovery, the **Test** and **Search** buttons, a
  scene running the action) only waits 2 seconds, and reuses the answers
  already known: a radius search 5 minutes, a station's details a day;
- a station added in Discovery is read with the next free slot, within about
  a minute.

## Prices, units and closed stations

- A price is in euros per litre with three decimals (1.739). Gladys has no
  "per litre" unit: the features use the **euro** unit and say "€/L" in their
  name.
- The **Open** feature is 1 when the station is open, 0 when it is closed.
- A closed station reports no price: its features keep the last known price.
  The **Cheapest nearby** device only counts the open stations; when they are
  all closed, its station name shows "—" and its price stays.
- A fuel the station does not sell gets no feature.

## Scenes

- **Fuel price below a threshold**: pick the fuel, the threshold and the
  station; the scene runs when the price goes below it, once, not at every
  refresh. The station is either one watched station or **Cheapest nearby**,
  which stands for any watched station: the scene then runs once, when the
  lowest price among them goes below, whichever station holds it. Variables:
  the station, the fuel, the price and the previous price.
- **Fuel price dropped**: the price fell by at least 2, 3, 5 or 10 cents
  between two readings, at the chosen station or, with **Cheapest nearby**,
  for the lowest price among the watched stations.
- **Cheapest station changed**: another watched station now has the lowest
  open price for a fuel. Adding or removing a station does not count.
- **Station opened or closed**: as reported to the MTS-K.

The action **cheapest station nearby** runs a radius search around the house
(the configured radius, or the one you give) and returns `{{name}}`,
`{{brand}}`, `{{address}}`, `{{price}}`, `{{distance}}` and `{{found}}` for a
message or a condition. Searches are kept 5 minutes, so a scene that runs often
does not hammer Tankerkönig.

## Troubleshooting

- **"Tankerkönig refused the API key"**: the key is wrong or disabled.
  Tankerkönig asks clients to stop sending requests after such an error: the
  integration does, until you save the configuration again (with the corrected
  key, or once Tankerkönig re-enabled it). The **Test the API key** button
  checks it with a single request.
- **No station in Discovery**: set the position of your house in Gladys
  (Settings → Houses), check the radius, and remember that the data only
  covers Germany.
- **"Tankerkönig is unreachable"**: the service is run by volunteers; the
  integration keeps trying at every refresh.
- Logs: the integration's log level is set with the `LOG_LEVEL` variable. The
  API key never appears in them.

## Data and licence

The prices and station data come from the Markttransparenzstelle für
Kraftstoffe through Tankerkönig, under the
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) licence; the widget
shows the attribution "Tankerkönig / MTS-K (CC BY 4.0)". Tankerkönig does not
allow oil companies and fuel stations to use its API.

## Privacy

The API key is only sent to Tankerkönig. The radius searches (Discovery, the
scene action, the Search button) send Tankerkönig the house position rounded
to about 100 m; the price readings only send station ids.
