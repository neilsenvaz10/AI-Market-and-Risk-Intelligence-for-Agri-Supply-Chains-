import fs from 'node:fs';
import path from 'node:path';

const MONTH_MAP = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
};

export const COMMODITY_CODE_MAP = {
  'wheat': 'WHEAT',
  'soyabean': 'SOYBEAN',
  'soybean': 'SOYBEAN',
  'bajra(pearl millet/cumbu)': 'BAJRA',
  'jowar(sorghum)': 'JOWAR',
  'maize': 'MAIZE',
  'paddy(common)': 'PADDY',
  'ragi(finger millet)': 'RAGI',
  'groundnut': 'GROUNDNUT',
  'mustard': 'MUSTARD',
  'sesamum(sesame,gingelly,til)': 'SESAMUM',
  'sunflower/sunflower seed': 'SUNFLOWER',
  'bengal gram(gram)(whole)': 'BENGAL_GRAM',
  'black gram(urd beans)(whole)': 'BLACK_GRAM',
  'green gram(moong)(whole)': 'GREEN_GRAM',
  'lentil(masur)(whole)': 'LENTIL',
  'red gram/arhar/tur(whole)': 'RED_GRAM'
};

export function parseDateHeader(headerText) {
  // e.g. "Price on 06 Oct, 2026" or "Arrival on 04 Oct, 2026"
  const match = headerText.match(/(\d{1,2})\s+([A-Za-z]{3}),?\s+(\d{4})/);
  if (!match) return null;
  const day = match[1].padStart(2, '0');
  const month = MONTH_MAP[match[2].toLowerCase()];
  const year = match[3];
  if (!month) return null;
  return `${year}-${month}-${day}`;
}

export function parseCsvLine(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { cells.push(cell.trim()); cell = ''; }
    else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

export function parseNumericOrNull(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed || trimmed === '-' || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'na') {
    return null;
  }
  const num = Number(trimmed);
  if (!Number.isFinite(num)) return null;
  return num;
}

export function parseAgmarknetCsv(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 4) {
    throw new Error('AGMARKNET CSV must contain at least a title, sub-headers, headers, and one data row.');
  }

  // Row 0: Title
  const title = lines[0];
  if (!title.toLowerCase().includes('price & arrival report') && !title.toLowerCase().includes('price')) {
    throw new Error('File does not match expected AGMARKNET Price & Arrival report format.');
  }

  // Row 2: Headers
  const headers = parseCsvLine(lines[2]);
  if (!headers.includes('Commodity Group') || !headers.includes('Commodity')) {
    throw new Error('Missing required column headers "Commodity Group" and "Commodity".');
  }

  // Find date columns
  const dateConfigs = [];
  for (let colIdx = 0; colIdx < headers.length; colIdx += 1) {
    const h = headers[colIdx];
    if (h.startsWith('Price on ')) {
      const date = parseDateHeader(h);
      if (date) {
        // Find corresponding arrival column for same date
        const arrColIdx = headers.findIndex((ah) => ah.startsWith('Arrival on ') && parseDateHeader(ah) === date);
        dateConfigs.push({ date, priceCol: colIdx, arrivalCol: arrColIdx >= 0 ? arrColIdx : null });
      }
    }
  }

  if (dateConfigs.length === 0) {
    throw new Error('Could not identify any daily price columns in the AGMARKNET CSV header.');
  }

  const mspCol = headers.findIndex((h) => h.toUpperCase().includes('MSP'));

  const records = [];
  for (let rowIdx = 3; rowIdx < lines.length; rowIdx += 1) {
    const row = parseCsvLine(lines[rowIdx]);
    const group = row[0];
    const commodity = row[1];
    if (!commodity) continue;

    const msp = mspCol >= 0 ? parseNumericOrNull(row[mspCol]) : null;
    const lowerComm = commodity.toLowerCase();
    const commodityCode = COMMODITY_CODE_MAP[lowerComm] || commodity.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 64);

    for (const d of dateConfigs) {
      const modalPrice = parseNumericOrNull(row[d.priceCol]);
      const arrivals = d.arrivalCol !== null ? parseNumericOrNull(row[d.arrivalCol]) : null;

      records.push({
        source: 'AGMARKNET',
        commodity_code: commodityCode,
        commodity_name: commodity,
        commodity_group: group,
        report_date: d.date,
        modal_price: modalPrice,
        price_unit: 'INR/quintal',
        arrivals_quantity: arrivals,
        arrival_unit: 'tonne',
        msp,
        msp_season: '2026-27',
        geographic_level: 'NATIONAL_AGGREGATE',
        raw_payload: {
          group,
          commodity,
          date: d.date,
          price_raw: row[d.priceCol],
          arrival_raw: d.arrivalCol !== null ? row[d.arrivalCol] : null,
          msp_raw: mspCol >= 0 ? row[mspCol] : null
        },
        source_file: path.basename(filePath)
      });
    }
  }

  return records;
}

export async function importAgmarknetRecords(pool, records) {
  if (!records || records.length === 0) return { inserted: 0, updated: 0, unchanged: 0 };
  const client = await pool.connect();
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  try {
    await client.query('BEGIN');
    for (const r of records) {
      // Check existing row
      const existing = await client.query(
        `SELECT modal_price, arrivals_quantity, msp FROM commodity_daily_reports
         WHERE source = $1 AND commodity_name = $2 AND report_date = $3`,
        [r.source, r.commodity_name, r.report_date]
      );

      if (existing.rowCount === 0) {
        await client.query(
          `INSERT INTO commodity_daily_reports (
             source, commodity_code, commodity_name, commodity_group, report_date,
             modal_price, price_unit, arrivals_quantity, arrival_unit, msp, msp_season,
             geographic_level, raw_payload, source_file
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            r.source, r.commodity_code, r.commodity_name, r.commodity_group, r.report_date,
            r.modal_price, r.price_unit, r.arrivals_quantity, r.arrival_unit, r.msp, r.msp_season,
            r.geographic_level, JSON.stringify(r.raw_payload), r.source_file
          ]
        );
        inserted += 1;
      } else {
        const row = existing.rows[0];
        const numEq = (a, b) => (a === null || a === undefined ? null : Number(a)) === (b === null || b === undefined ? null : Number(b));
        const same = numEq(row.modal_price, r.modal_price) &&
                     numEq(row.arrivals_quantity, r.arrivals_quantity) &&
                     numEq(row.msp, r.msp);
        if (same) {
          unchanged += 1;
        } else {
          await client.query(
            `UPDATE commodity_daily_reports SET
               modal_price = $4,
               arrivals_quantity = $5,
               msp = $6,
               raw_payload = $7,
               source_file = $8,
               updated_at = CURRENT_TIMESTAMP
             WHERE source = $1 AND commodity_name = $2 AND report_date = $3`,
            [r.source, r.commodity_name, r.report_date, r.modal_price, r.arrivals_quantity, r.msp, JSON.stringify(r.raw_payload), r.source_file]
          );
          updated += 1;
        }
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  return { inserted, updated, unchanged, total: records.length };
}
