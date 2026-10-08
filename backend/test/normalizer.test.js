import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDate,
  normalizeCommodity,
  normalizeMandi,
  normalizeMandiRecord,
} from '../src/pipeline/normalizer.js';

test('Normalizer: normalizes commodity aliases', () => {
  assert.equal(normalizeCommodity('Kanda').code, 'ONION');
  assert.equal(normalizeCommodity('कांदा').code, 'ONION');
  assert.equal(normalizeCommodity('Pyaaz').code, 'ONION');
  assert.equal(normalizeCommodity('Tomato').code, 'TOMATO');
  assert.equal(normalizeCommodity('टोमॅटो').code, 'TOMATO');
  assert.equal(normalizeCommodity('Batata').code, 'POTATO');
  assert.equal(normalizeCommodity('Soybean').code, 'SOYBEAN');
  assert.equal(normalizeCommodity('Gehun').code, 'WHEAT');
  assert.equal(normalizeCommodity('Kapas').code, 'COTTON');
});

test('Normalizer: normalizes mandi names and locations', () => {
  const pune = normalizeMandi('Gultekdi');
  assert.equal(pune.code, 'MH_PUNE_APMC');
  assert.equal(pune.district, 'Pune');

  const nashik = normalizeMandi('Nasik Market Yard');
  assert.equal(nashik.code, 'MH_NSK_MAIN');
  assert.equal(nashik.district, 'Nashik');

  const ahmednagar = normalizeMandi('Ahmednagar');
  assert.equal(ahmednagar.code, 'MH_AHM_APMC');

  const lasalgaon = normalizeMandi('Lasalgaon');
  assert.equal(lasalgaon.code, 'MH_NSK_LASALGAON');
});

test('Normalizer: normalizes various date formats to YYYY-MM-DD', () => {
  assert.equal(normalizeDate('07/10/2026'), '2026-10-07');
  assert.equal(normalizeDate('7-10-2026'), '2026-10-07');
  assert.equal(normalizeDate('2026-10-07T12:00:00Z'), '2026-10-07');
});

test('Normalizer: converts non-quintal units to standard quintal', () => {
  // 1 kg prices should be scaled up by 100 to reach quintal
  const kgRecord = {
    commodity_name: 'Tomato',
    mandi_name: 'Pune APMC (Gultekdi)',
    price_date: '2026-10-07',
    min_price: 20, // 20 Rs/kg = 2000 Rs/qtl
    max_price: 26, // 26 Rs/kg = 2600 Rs/qtl
    modal_price: 24, // 24 Rs/kg = 2400 Rs/qtl
    arrivals_quantity: 50000, // 50,000 kg = 500 qtl
    unit: 'kg',
  };

  const norm = normalizeMandiRecord(kgRecord);
  assert.equal(norm.unit, 'quintal');
  assert.equal(norm.min_price, 2000);
  assert.equal(norm.max_price, 2600);
  assert.equal(norm.modal_price, 2400);
  assert.equal(norm.arrivals_quantity, 500);
});

test('Normalizer: converts tonne units to quintal', () => {
  // 1 Ton = 10 quintals, price per ton is divided by 10
  const tonRecord = {
    commodity_name: 'Onion',
    mandi_name: 'Nashik Market Yard',
    price_date: '2026-10-07',
    min_price: 22000,
    max_price: 26000,
    modal_price: 24000,
    arrivals_quantity: 40, // 40 tons = 400 quintals
    unit: 'tonne',
  };

  const norm = normalizeMandiRecord(tonRecord);
  assert.equal(norm.unit, 'quintal');
  assert.equal(norm.min_price, 2200);
  assert.equal(norm.max_price, 2600);
  assert.equal(norm.modal_price, 2400);
  assert.equal(norm.arrivals_quantity, 400);
});
