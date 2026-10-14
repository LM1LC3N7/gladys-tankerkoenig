// -----------------------------------------------------------------------------
// The "Fuel prices" dashboard widget. Pure.
//
// One tile per fuel (the cheapest open price), then the watched stations with
// their prices, the cheapest in green, and the attribution the CC BY 4.0
// licence of the data asks for.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { FUEL_NAMES } from './constants.js';
import { T } from './i18n.js';
import { formatPrice, mills } from './model.js';

const pick = (text, language) => (typeof text === 'string' ? text : (text[language] ?? text.en));
const SHORT = { e5: 'E5', e10: 'E10', diesel: 'D' };
const ATTRIBUTION = 'Tankerkönig / MTS-K (CC BY 4.0)';

function clock(iso, language) {
  try {
    return new Intl.DateTimeFormat(language === 'fr' ? 'fr-FR' : 'en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Berlin',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

const shortPrice = (price, language) => formatPrice(price, language).replace(' €', '');

/** Open first, then by the price of the first fuel, then by name. */
function sortRows(rows, fuel) {
  const key = (row) => {
    const price = row.reading?.prices?.[fuel];
    return typeof price === 'number' ? mills(price) : Number.POSITIVE_INFINITY;
  };
  const open = (row) => (row.reading?.open === true ? 0 : 1);
  return [...rows].sort(
    (a, b) => open(a) - open(b) || key(a) - key(b) || a.label.localeCompare(b.label),
  );
}

/**
 * `rows`: [{ stationId, label, reading }] for the watched stations;
 * `cheapest`: fuel -> { stationId, price, label } | null; `fuels`: the
 * fuels to show (one when the widget settings pick it).
 */
export function pricesWidget({ fuels, rows, cheapest, readAt, language = 'en' }) {
  const components = [{ type: 'text', text: T.widget.title, variant: 'heading' }];
  if (rows.length === 0) {
    components.push({ type: 'text', text: T.widget.noStation, variant: 'body' });
    return { ttl_seconds: 300, components };
  }
  if (!readAt) {
    components.push({ type: 'text', text: T.widget.notLoaded, variant: 'body' });
    return { ttl_seconds: 60, components };
  }
  for (const fuel of fuels) {
    const best = cheapest?.[fuel] ?? null;
    components.push({
      type: 'value',
      value: best ? best.price : '—',
      unit: '€/L',
      label: pick(T.widget.cheapest(fuels.length === 1 ? FUEL_NAMES[fuel] : SHORT[fuel]), language),
      icon: 'droplet',
      color: best ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    });
  }
  const holders = new Set(fuels.map((fuel) => cheapest?.[fuel]?.stationId).filter(Boolean));
  const items = sortRows(rows, fuels[0])
    .slice(0, 10)
    .map((row) => {
      const reading = row.reading;
      let value;
      let color = WIDGET_COLORS.INFO;
      if (!reading) {
        value = '…';
        color = WIDGET_COLORS.NEUTRAL;
      } else if (reading.open === false) {
        value = pick(T.widget.closed, language);
        color = WIDGET_COLORS.NEUTRAL;
      } else if (fuels.length === 1) {
        value = formatPrice(reading.prices[fuels[0]], language);
      } else {
        value = fuels
          .filter((fuel) => typeof reading.prices[fuel] === 'number')
          .map((fuel) => `${SHORT[fuel]} ${shortPrice(reading.prices[fuel], language)}`)
          .join(' · ');
      }
      if (reading?.open !== false && holders.has(row.stationId)) {
        color = WIDGET_COLORS.SUCCESS;
      }
      return {
        label: row.label.slice(0, 40),
        value: (value || '—').slice(0, 40),
        icon: 'droplet',
        color,
      };
    });
  components.push({ type: 'status', items });
  components.push({
    type: 'text',
    text: `${ATTRIBUTION} · ${pick(T.widget.attribution, language)} ${clock(readAt, language)}`,
    variant: 'caption',
  });
  return { ttl_seconds: 300, components };
}
