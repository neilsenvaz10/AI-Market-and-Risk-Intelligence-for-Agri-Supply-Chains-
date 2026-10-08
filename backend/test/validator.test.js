import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMandiRecord } from '../src/pipeline/validator.js';

test('Validator: accepts valid mandi record', () => {
  const record = {
    mandi_name: 'Pune APMC (Gultekdi)',
    commodity_name: 'Onion',
    price_date: '2026-10-07',
    min_price: 2200,
    max_price: 2800,
    modal_price: 2500,
    arrivals_quantity: 450,
  };

  const result = validateMandiRecord(record);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test('Validator: rejects null or non-object record', () => {
  const result = validateMandiRecord(null);
  assert.equal(result.valid, false);
});

test('Validator: rejects missing mandi or commodity names', () => {
  const record = {
    mandi_name: '  ',
    commodity_name: '',
    price_date: '2026-10-07',
    min_price: 2000,
    max_price: 2500,
    modal_price: 2200,
  };

  const result = validateMandiRecord(record);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('mandi_name')));
  assert.ok(result.errors.some((e) => e.includes('commodity_name')));
});

test('Validator: rejects min_price greater than max_price', () => {
  const record = {
    mandi_name: 'Nashik APMC',
    commodity_name: 'Tomato',
    price_date: '2026-10-07',
    min_price: 3000,
    max_price: 2000,
    modal_price: 2500,
  };

  const result = validateMandiRecord(record);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('cannot exceed max_price')));
});

test('Validator: rejects modal_price outside min/max bounds', () => {
  const record = {
    mandi_name: 'Ahmednagar Mandi',
    commodity_name: 'Wheat',
    price_date: '2026-10-07',
    min_price: 2000,
    max_price: 2500,
    modal_price: 2800, // exceeds max_price
  };

  const result = validateMandiRecord(record);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('must fall between')));
});

test('Validator: rejects negative prices and negative arrivals', () => {
  const record = {
    mandi_name: 'Lasalgaon APMC',
    commodity_name: 'Onion',
    price_date: '2026-10-07',
    min_price: -100,
    max_price: 2500,
    modal_price: 2000,
    arrivals_quantity: -50,
  };

  const result = validateMandiRecord(record);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('min_price must be a positive number')));
  assert.ok(result.errors.some((e) => e.includes('arrivals_quantity must be a non-negative number')));
});

test('Validator: rejects distant future price date', () => {
  const record = {
    mandi_name: 'Pune APMC',
    commodity_name: 'Soybean',
    price_date: '2099-01-01',
    min_price: 4000,
    max_price: 4800,
    modal_price: 4500,
  };

  const result = validateMandiRecord(record);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('cannot be in the future')));
});
