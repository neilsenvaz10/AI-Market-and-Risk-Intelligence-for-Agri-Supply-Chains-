/**
 * storage/partition.js: year/month boundaries, Dec->Jan rollover, leap years,
 * single-day and multi-year ranges. Pure date arithmetic — no network, no database.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  daysInMonth,
  formatDate,
  monthBounds,
  monthsBetween,
  parseDate,
  partitionPath,
  partitionSegment,
  totalDays,
} from '../src/pipeline/storage/partition.js';

const nextDay = (iso) => {
  const date = parseDate(iso);
  date.setUTCDate(date.getUTCDate() + 1);
  return formatDate(date);
};

test('partitionSegment: zero-padded year/month for dates, ISO strings and timestamps', () => {
  assert.deepEqual(partitionSegment('2021-10-01'), { year: '2021', month: '10' });
  assert.deepEqual(partitionSegment('2021-10-31T23:30:00Z'), { year: '2021', month: '10' });
  assert.deepEqual(partitionSegment(new Date(Date.UTC(2021, 9, 5))), { year: '2021', month: '10' });
  assert.deepEqual(partitionSegment(Date.UTC(2021, 0, 1)), { year: '2021', month: '01' });
  assert.deepEqual(partitionSegment('2026-09-30'), { year: '2026', month: '09' });
  assert.throws(() => partitionSegment('2021-02-31'), RangeError);
  assert.throws(() => partitionSegment('not-a-date'), TypeError);
});

test('monthBounds/daysInMonth: leap years come from the calendar', () => {
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2023, 2), 28);
  assert.equal(daysInMonth(2000, 2), 29);
  assert.equal(daysInMonth(1900, 2), 28);
  assert.equal(daysInMonth(2024, 4), 30);
  assert.deepEqual(monthBounds('2024-02-10'), { year: '2024', month: '02', from: '2024-02-01', to: '2024-02-29' });
  assert.throws(() => daysInMonth(2024, 13), RangeError);
});

test('partitionPath: <baseDir>/<source>/<dataset>/<year>/<month>.<ext>', () => {
  const baseDir = path.join('data', 'mandi');
  assert.equal(
    partitionPath({ baseDir, dataset: 'prices', source: 'ceda', date: '2021-10-05', extension: 'csv.gz' }),
    path.join(baseDir, 'ceda', 'prices', '2021', '10.csv.gz')
  );
  assert.equal(
    partitionPath({ baseDir, dataset: 'prices', date: '2021-01-31', extension: '.csv.gz' }),
    path.join(baseDir, 'prices', '2021', '01.csv.gz')
  );
  assert.throws(() => partitionPath({ baseDir, date: '2021-01-31' }), TypeError);
  assert.throws(() => partitionPath({ baseDir, dataset: 'prices' }), TypeError);
});

test('monthsBetween: Dec -> Jan rollover clips both ends', () => {
  const segments = monthsBetween('2021-12-05', '2022-01-20');
  assert.deepEqual(segments, [
    { year: '2021', month: '12', from: '2021-12-05', to: '2021-12-31' },
    { year: '2022', month: '01', from: '2022-01-01', to: '2022-01-20' },
  ]);
});

test('monthsBetween: a single-day range yields exactly one segment', () => {
  const segments = monthsBetween('2025-03-09', '2025-03-09');
  assert.equal(segments.length, 1);
  assert.deepEqual(segments[0], { year: '2025', month: '03', from: '2025-03-09', to: '2025-03-09' });
  assert.equal(totalDays(segments), 1);
});

test('monthsBetween: whole leap February and a non-leap February', () => {
  assert.deepEqual(monthsBetween('2024-02-01', '2024-02-29'), [
    { year: '2024', month: '02', from: '2024-02-01', to: '2024-02-29' },
  ]);
  assert.deepEqual(monthsBetween('2023-02-01', '2023-02-28'), [
    { year: '2023', month: '02', from: '2023-02-01', to: '2023-02-28' },
  ]);
  assert.equal(totalDays(monthsBetween('2024-02-01', '2024-03-01')), 30);
});

test('monthsBetween: multi-year span is ordered and contiguous with no gaps', () => {
  const segments = monthsBetween('2023-11-15', '2024-02-02');
  assert.deepEqual(segments.map((s) => `${s.year}-${s.month}`), ['2023-11', '2023-12', '2024-01', '2024-02']);
  assert.equal(segments[0].from, '2023-11-15');
  assert.equal(segments.at(-1).to, '2024-02-02');
  for (let i = 1; i < segments.length; i += 1) {
    assert.equal(segments[i].from, nextDay(segments[i - 1].to));
  }
  assert.equal(totalDays(segments), 16 + 31 + 31 + 2);
});

test('monthsBetween: rejects an inverted range and unparseable input', () => {
  assert.throws(() => monthsBetween('2024-05-02', '2024-05-01'), RangeError);
  assert.throws(() => monthsBetween('2024-05-01', 'yesterday'), /Unparseable/);
});
