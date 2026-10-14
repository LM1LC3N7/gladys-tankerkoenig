import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WIDGET_COLORS, validateWidgetContent } from '@gladysassistant/integration-sdk';
import { pricesWidget } from '../src/widget.js';

const READ_AT = '2026-10-14T12:05:00.000Z';
const reading = (open, prices) => ({
  open,
  prices: { e5: null, e10: null, diesel: null, ...prices },
});
const rows = [
  {
    stationId: 'a',
    label: 'Aral Tankstelle, Holzmarktstraße 12/14',
    reading: reading(true, { e5: 1.799, diesel: 1.659 }),
  },
  {
    stationId: 'b',
    label: 'JET BERLIN STORKOWER STR. 126-130',
    reading: reading(true, { e5: 1.739, diesel: 1.689 }),
  },
  { stationId: 'c', label: 'TotalEnergies Berlin', reading: reading(false, { e5: 1.709 }) },
];
const cheapest = {
  e5: { stationId: 'b', label: rows[1].label, price: 1.739 },
  diesel: { stationId: 'a', label: rows[0].label, price: 1.659 },
};

test('empty states', () => {
  const none = pricesWidget({ fuels: ['e5'], rows: [], readAt: READ_AT });
  assert.match(none.components[1].text.en, /No watched station/);
  const waiting = pricesWidget({ fuels: ['e5'], rows, readAt: undefined });
  assert.match(waiting.components[1].text.fr, /En attente/);
  assert.deepEqual(validateWidgetContent(none), []);
});

test('every tracked fuel: a tile per fuel, the stations, the attribution', () => {
  const content = pricesWidget({
    fuels: ['e5', 'diesel'],
    rows,
    cheapest,
    readAt: READ_AT,
    language: 'en',
  });
  assert.deepEqual(validateWidgetContent(content), []);
  const tiles = content.components.filter((c) => c.type === 'value');
  assert.deepEqual(
    tiles.map((t) => [t.label, t.value, t.unit]),
    [
      ['Cheapest E5', 1.739, '€/L'],
      ['Cheapest D', 1.659, '€/L'],
    ],
  );
  const status = content.components.find((c) => c.type === 'status');
  assert.deepEqual(
    status.items.map((i) => [i.label.slice(0, 12), i.value, i.color]),
    [
      ['JET BERLIN S', 'E5 1.739 · D 1.689', WIDGET_COLORS.SUCCESS],
      ['Aral Tankste', 'E5 1.799 · D 1.659', WIDGET_COLORS.SUCCESS],
      ['TotalEnergie', 'closed', WIDGET_COLORS.NEUTRAL],
    ],
  );
  const caption = content.components.at(-1);
  assert.equal(caption.variant, 'caption');
  assert.equal(caption.text, 'Tankerkönig / MTS-K (CC BY 4.0) · updated 14:05');
});

test('one fuel picked in the settings: sorted by its price, the cheapest in green', () => {
  const content = pricesWidget({
    fuels: ['diesel'],
    rows,
    cheapest,
    readAt: READ_AT,
    language: 'fr',
  });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components[1].label, 'Diesel le moins cher');
  const status = content.components.find((c) => c.type === 'status');
  assert.deepEqual(
    status.items.map((i) => [i.value, i.color]),
    [
      ['1,659 €', WIDGET_COLORS.SUCCESS],
      ['1,689 €', WIDGET_COLORS.INFO],
      ['fermée', WIDGET_COLORS.NEUTRAL],
    ],
  );
  assert.match(content.components.at(-1).text, /mis à jour 14:05$/);
});
