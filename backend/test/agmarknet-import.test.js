import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import {
  parseDateHeader,
  parseNumericOrNull,
  parseCsvLine,
  parseAgmarknetCsv
} from '../src/pipeline/historical/agmarknet-import.js';
import { MandiService } from '../src/services/mandi.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testCsv = path.resolve(__dirname, '../data/mandi/agmarknet/Market_Wise_Price_Arrival_09-10-2026_01-26-14_AM.csv');

test('parseDateHeader: parses AGMARKNET header date strings correctly', () => {
  assert.equal(parseDateHeader('Price on 06 Oct, 2026'), '2026-10-06');
  assert.equal(parseDateHeader('Arrival on 05 Oct, 2026'), '2026-10-05');
  assert.equal(parseDateHeader('Price on 04 Oct, 2026'), '2026-10-04');
  assert.equal(parseDateHeader('Price on 1 Jan, 2025'), '2025-01-01');
  assert.equal(parseDateHeader('Invalid Header'), null);
});

test('parseNumericOrNull: strictly turns missing markers into null (never zero)', () => {
  assert.equal(parseNumericOrNull('-'), null);
  assert.equal(parseNumericOrNull(''), null);
  assert.equal(parseNumericOrNull('   '), null);
  assert.equal(parseNumericOrNull('NA'), null);
  assert.equal(parseNumericOrNull('null'), null);
  assert.equal(parseNumericOrNull('0'), 0);
  assert.equal(parseNumericOrNull('3604.51'), 3604.51);
  assert.equal(parseNumericOrNull(2585), 2585);
  assert.equal(parseNumericOrNull(null), null);
});

test('parseCsvLine: handles quoted commas properly', () => {
  const line = 'Oil Seeds,"Sesamum(Sesame,Gingelly,Til)",10346.00,14895.59';
  const parsed = parseCsvLine(line);
  assert.deepEqual(parsed, [
    'Oil Seeds',
    'Sesamum(Sesame,Gingelly,Til)',
    '10346.00',
    '14895.59'
  ]);
});

test('parseAgmarknetCsv: parses the 16 commodities and 3 dates from official report', (t) => {
  if (!fs.existsSync(testCsv)) {
    t.skip('official agmarknet CSV not committed to git repository');
    return;
  }
  const records = parseAgmarknetCsv(testCsv);
  assert.equal(records.length, 48, 'must contain exactly 48 unpivoted observations');

  const commodities = new Set(records.map(r => r.commodity_name));
  assert.equal(commodities.size, 16, 'must contain 16 unique commodities');
  assert.ok(commodities.has('Wheat'));
  assert.ok(commodities.has('Soyabean'));

  const dates = new Set(records.map(r => r.report_date));
  assert.deepEqual([...dates].sort(), ['2026-10-04', '2026-10-05', '2026-10-06']);

  const nullPrices = records.filter(r => r.modal_price === null);
  assert.equal(nullPrices.length, 7, 'must have exactly 7 null prices where hyphen occurred');

  const nullArrivals = records.filter(r => r.arrivals_quantity === null);
  assert.equal(nullArrivals.length, 7, 'must have exactly 7 null arrivals where hyphen occurred');

  // Check Wheat values
  const wheat06 = records.find(r => r.commodity_name === 'Wheat' && r.report_date === '2026-10-06');
  assert.ok(wheat06);
  assert.equal(wheat06.modal_price, 3604.51);
  assert.equal(wheat06.arrivals_quantity, 1429.5);
  assert.equal(wheat06.msp, 2585);
  assert.equal(wheat06.price_unit, 'INR/quintal');
  assert.equal(wheat06.arrival_unit, 'tonne');
  assert.equal(wheat06.source, 'AGMARKNET');
  assert.equal(wheat06.geographic_level, 'NATIONAL_AGGREGATE');
});

test('MandiService.getCommodityDailyReports: returns paginated rows and calculates trend', async () => {
  const mockPool = {
    async query(sql, values) {
      return {
        rows: [
          {
            id: 1,
            source: 'AGMARKNET',
            source_label: 'AGMARKNET (DMI)',
            commodity_code: 'WHEAT',
            commodity_name: 'Wheat',
            commodity_group: 'Cereals',
            report_date: '2026-10-06',
            modal_price: '3604.51',
            price_unit: 'INR/quintal',
            arrivals_quantity: '1429.500',
            arrival_unit: 'tonne',
            msp: '2585.00',
            msp_season: '2026-27',
            geographic_level: 'NATIONAL_AGGREGATE',
            prev_modal_price: '3519.26',
            prev_report_date: '2026-10-05',
            total_count: '1',
            updated_at: new Date()
          }
        ]
      };
    }
  };

  const service = new MandiService({ pool: mockPool });
  const result = await service.getCommodityDailyReports({ commodity: 'Wheat' });
  assert.equal(result.total, 1);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].commodity_name, 'Wheat');
  assert.equal(result.rows[0].modal_price, 3604.51);
  assert.equal(result.rows[0].trend_direction, 'up');
  assert.equal(result.rows[0].trend_percent, 2.4);
  assert.equal(result.meta.latest_reporting_date, '2026-10-06');
});
