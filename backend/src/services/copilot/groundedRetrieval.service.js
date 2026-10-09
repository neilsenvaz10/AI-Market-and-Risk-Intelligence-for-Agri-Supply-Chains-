import { pool as defaultPool } from '../../db.js';
import { MandiService } from '../mandi.service.js';
import { ForecastService } from '../forecast.service.js';
import { detectStaticPlace } from './intentClassifier.js';
import { STALE_AFTER_DAYS, daysBetween, displayMarketName, isGenuine, todayInIndia } from './freshness.js';

export { STALE_AFTER_DAYS, daysBetween, displayMarketName, isGenuine, todayInIndia };

export const AGRICULTURAL_TERMS = {
  MODAL_PRICE: {
    term: 'Modal Price',
    definition: 'The most frequently transacted price per quintal in a mandi on a given market day. It represents the true market average better than minimum or maximum extremes.',
    definitionHi: 'मोडल भाव वह मूल्य है जिस पर मंडी में किसी दिन सबसे अधिक मात्रा में फसल की बिक्री होती है। यह सामान्य औसत से अधिक सटीक बाजार भाव दर्शाता है।',
    definitionMr: 'मोडल भाव (Modal Price) म्हणजे ज्या दरावर बाजारात त्या दिवशी सर्वाधिक शेतीमालाची खरेदी-विक्री झाली. हा किमान किंवा कमाल दरापेक्षा बाजाराची खरी स्थिती दाखवतो.',
  },
  APMC_MANDI: {
    term: 'APMC Mandi',
    definition: 'Agricultural Produce Market Committee (APMC) is a statutory market regulated by state governments where farmers sell produce through licensed commission agents and open auctions.',
    definitionHi: 'एपीएमसी मंडी (कृषि उपज मंडी समिति) राज्य सरकार द्वारा विनियमित बाजार है जहां किसान लाइसेंस प्राप्त आढ़तियों और खुली नीलामी के जरिए अपनी फसल बेचते हैं।',
    definitionMr: 'एपीएमसी (कृषी उत्पन्न बाजार समिती) हे राज्य शासनाने नियंत्रित केलेले अधिकृत बाजार आवार आहे, जिथे शेतकरी जाहीर लिलावाद्वारे आपला माल विकतात.',
  },
  MSP: {
    term: 'Minimum Support Price (MSP)',
    definition: 'Minimum Support Price announced by the Government of India before the sowing season to protect farmers from sharp price drops during bumper production.',
    definitionHi: 'न्यूनतम समर्थन मूल्य (MSP) भारत सरकार द्वारा घोषित वह न्यूनतम मूल्य है जिससे कम मूल्य पर सरकारी एजेंसियां किसानों से फसल नहीं खरीद सकतीं।',
    definitionMr: 'किमान आधारभूत किंमत (MSP) म्हणजे केंद्र शासनाने हमी दिलेला किमान दर, जेणेकरून बंपर उत्पादनामुळे भाव कोसळल्यास शेतकऱ्यांचे नुकसान होऊ नये.',
  },
  PREDICTION_INTERVAL: {
    term: 'Prediction Interval',
    definition: 'A probabilistic price range (e.g., 80% interval between ₹1,500 and ₹1,650) reflecting market uncertainty rather than claiming a single guaranteed future number.',
    definitionHi: 'प्रेडिक्शन इंटरवल (संभावित मूल्य सीमा) भविष्य के मूल्यों की एक अनुमानित सीमा (निचली और ऊपरी सीमा) है जो बाजार के जोखिम और अनिश्चितता को दर्शाती है।',
    definitionMr: 'प्रेडिक्शन इंटरव्हल (अंदाजित किंमत कक्षा) म्हणजे भविष्यातील भावाची अंदाजित किमान व कमाल मर्यादा (उदा. ८०% खात्रीची मर्यादा), जी बाजारातील चढउताराची जोखीम स्पष्ट करते.',
  },
  ARRIVALS: {
    term: 'Market Arrivals',
    definition: 'Total physical quantity of agricultural produce brought into the market yard on a reporting day, usually measured in quintals or metric tonnes.',
    definitionHi: 'मंडी आवक (Arrivals) से तात्पर्य उस कुल मात्रा से है जो किसान किसी विशेष दिन मंडी में बेचने के लिए लाते हैं (क्विंटल में)।',
    definitionMr: 'बाजार आवक (Market Arrivals) म्हणजे त्या दिवशी बाजारात विक्रीसाठी प्रत्यक्ष आलेला एकूण शेतीमाल (क्विंटलमध्ये). आवक वाढल्यास भाव कमी होण्याची शक्यता असते.',
  },
};

const REFERENCE_TTL_MS = 10 * 60 * 1000;
const LETTER = '[\\p{L}\\p{M}]';
const DEVANAGARI = /[ऀ-ॿ]/;

const norm = (text) => String(text ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isoDay = (value) => String(value).slice(0, 10);
const num = (value) => (value === null || value === undefined || value === '' ? null : Number(value));

/** Short names a farmer may use for a market: "Pune APMC (Gultekdi)" -> "pune apmc", "pune", "gultekdi". */
function placeAliases(mandi) {
  const aliases = new Set();
  const add = (value) => {
    const text = norm(String(value ?? '').replace(/\(.*?\)/g, ' '));
    if (text.length >= 3) aliases.add(text);
    const stripped = text.replace(/\s+(apmc|mandi|market yard|market|bazaar|bazar|yard)$/i, '').trim();
    if (stripped.length >= 3) aliases.add(stripped);
  };
  add(mandi.name);
  add(mandi.market_center);
  add(mandi.hindi_name);
  add(mandi.marathi_name);
  const inParens = String(mandi.name || '').match(/\(([^)]+)\)/);
  if (inParens) add(inParens[1]);
  return aliases;
}

export class GroundedRetrievalService {
  constructor({
    pool = defaultPool,
    mandiService = new MandiService({ pool }),
    forecastService = new ForecastService({ pool }),
    now = () => new Date(),
  } = {}) {
    this.pool = pool;
    this.mandiService = mandiService;
    this.forecastService = forecastService;
    this.now = now;
    this.cache = new Map();
  }

  today() {
    return todayInIndia(this.now());
  }

  /** Days since a reporting date, and whether that makes it stale. */
  age(dateValue) {
    const ageDays = Math.max(0, daysBetween(isoDay(dateValue), this.today()));
    return { ageDays, isStale: ageDays > STALE_AFTER_DAYS };
  }

  async #cached(key, loader) {
    const hit = this.cache.get(key);
    if (hit && hit.until > Date.now()) return hit.value;
    const value = await loader();
    this.cache.set(key, { value, until: Date.now() + REFERENCE_TTL_MS });
    return value;
  }

  async resolveCommodity(reference) {
    if (!reference) return null;
    const clean = String(reference).trim();
    const res = await this.pool.query(
      `SELECT id, code, name, hindi_name, marathi_name, category, standard_unit
       FROM commodities
       WHERE is_active = TRUE
         AND (
           id::text = $1
           OR UPPER(code) = UPPER($1)
           OR UPPER(name) = UPPER($1)
           OR LOWER(name) LIKE LOWER($2)
           OR (hindi_name IS NOT NULL AND (hindi_name = $1 OR hindi_name LIKE $2))
           OR (marathi_name IS NOT NULL AND (marathi_name = $1 OR marathi_name LIKE $2))
         )
       ORDER BY (UPPER(code) = UPPER($1) OR UPPER(name) = UPPER($1)) DESC, id
       LIMIT 1`,
      [clean, `%${clean}%`]
    );
    return res.rows[0] || null;
  }

  /** Names of the commodities that have a price table, so the assistant can say honestly what it covers. */
  async supportedCommodityNames() {
    return this.#cached('commodities', async () => {
      const res = await this.pool.query('SELECT name FROM commodities WHERE is_active = TRUE ORDER BY name');
      return res.rows.map((r) => r.name);
    });
  }

  async resolveMandi(reference) {
    if (!reference) return null;
    const clean = String(reference).trim();
    const res = await this.pool.query(
      `SELECT id, code, name, hindi_name, marathi_name, state, district, market_center
       FROM mandis
       WHERE is_active = TRUE
         AND (
           id::text = $1
           OR UPPER(code) = UPPER($1)
           OR UPPER(name) = UPPER($1)
           OR LOWER(name) LIKE LOWER($2)
           OR LOWER(district) = LOWER($1)
           OR LOWER(district) LIKE LOWER($2)
           OR (hindi_name IS NOT NULL AND (hindi_name = $1 OR hindi_name LIKE $2))
           OR (marathi_name IS NOT NULL AND (marathi_name = $1 OR marathi_name LIKE $2))
         )
       ORDER BY id LIMIT 1`,
      [clean, `%${clean}%`]
    );
    return res.rows[0] || null;
  }

  async #places() {
    return this.#cached('places', async () => {
      const res = await this.pool.query(
        `SELECT id, code, name, hindi_name, marathi_name, state, district, market_center
         FROM mandis WHERE is_active = TRUE ORDER BY id`
      );
      return res.rows;
    });
  }

  /**
   * Finds the market or district a farmer is talking about, using the real market list
   * (English, Hindi and Marathi names). A name shared by several markets, or a district, is
   * returned as a DISTRICT scope: the assistant must never pick one market out of several.
   * @returns {Promise<null | {kind:'mandi', mandi:object} | {kind:'district', district:string, state:string, mandis:object[]}>}
   */
  async detectPlace(text) {
    const places = await this.#places();
    if (!places.length) return null;
    const attempt = (haystack) => {
      const hay = norm(haystack);
      const matches = [];
      const test = (alias) => {
        const pattern = DEVANAGARI.test(alias)
          ? `(?<!${LETTER})${escapeRegExp(alias)}${LETTER}*`
          : `(?<!${LETTER})${escapeRegExp(alias)}(?!${LETTER})`;
        return new RegExp(pattern, 'u').test(hay);
      };
      for (const mandi of places) {
        for (const alias of placeAliases(mandi)) {
          if (test(alias)) matches.push({ kind: 'mandi', alias, mandi });
        }
        const district = norm(mandi.district);
        if (district.length >= 3 && test(district)) matches.push({ kind: 'district', alias: district, mandi });
      }
      return matches;
    };

    let matches = attempt(text);
    if (!matches.length) {
      const fallback = detectStaticPlace(text);
      if (fallback) matches = attempt(fallback);
    }
    if (!matches.length) return null;

    const longest = Math.max(...matches.map((m) => m.alias.length));
    const best = matches.filter((m) => m.alias.length === longest);
    const mandiIds = new Set(best.filter((m) => m.kind === 'mandi').map((m) => m.mandi.id));
    // Exactly one market carries this name: that market. (A name shared by several markets,
    // or only a district, falls through to a district scope below.)
    if (mandiIds.size === 1) return { kind: 'mandi', mandi: best.find((m) => m.kind === 'mandi').mandi };
    const first = best[0].mandi;
    return {
      kind: 'district',
      district: first.district,
      state: first.state,
      mandis: places.filter((p) => norm(p.district) === norm(first.district)),
    };
  }

  async #mandisInDistrict(district, limit = 5) {
    const places = await this.#places();
    return places.filter((p) => norm(p.district) === norm(district)).slice(0, limit);
  }

  #marketRow(row, { numbered = false } = {}) {
    const { ageDays, isStale } = this.age(row.price_date);
    return {
      found: true,
      priceDate: isoDay(row.price_date),
      ageDays,
      isStale,
      modalPrice: num(row.modal_price),
      minPrice: num(row.min_price),
      maxPrice: num(row.max_price),
      priceUnit: row.price_unit || 'INR/quintal',
      arrivalsQuantity: num(row.arrivals_quantity),
      arrivalUnit: row.arrival_unit || null,
      variety: row.variety || null,
      grade: row.grade || null,
      source: row.source_label || row.source || 'AGMARKNET',
      sourceCode: row.source || null,
      isSampleData: false,
      // Markets that would otherwise read the same keep their market number so they can be told apart.
      mandiName: numbered ? String(row.mandi_name ?? '').replace(/\s+/g, ' ').trim() : displayMarketName(row.mandi_name),
      district: row.district,
      state: row.state,
      commodityName: row.commodity_name,
      trendPercent: row.trend_percent ?? null,
      trendDirection: row.trend_direction ?? 'none',
    };
  }

  /**
   * Latest reported price. With a market: that market. With a district: every reporting market
   * in the district. With neither: the most recently reporting markets for the crop.
   * Prices are always labelled with their reporting date and age.
   */
  async getLatestPrice({ commodity, mandi = null, district = null, includeSample = false } = {}) {
    if (!commodity) return { found: false, reason: 'Commodity required' };

    const filters = { commodity: commodity.code || commodity.name, includeSample, limit: 200, offset: 0 };
    if (mandi) filters.mandiId = mandi.id;
    else if (district) filters.district = district;

    const { rows = [] } = (await this.mandiService.getLatestPrices(filters)) || {};
    const genuine = rows.filter(isGenuine);

    if (genuine.length === 0) {
      if (!includeSample) {
        const probe = (await this.mandiService.getLatestPrices({ ...filters, includeSample: true, limit: 1 })) || {};
        if ((probe.rows || []).length > 0) {
          return {
            found: false,
            sampleOnly: true,
            reason: 'Only synthetic sample data exists for this market pair. Live genuine prices have not been reported yet.',
          };
        }
      }
      return { found: false, reason: 'No reported price records found for this selection.' };
    }

    // One representative row per market: its newest reporting day (rows without a variety first).
    const latestByMandi = new Map();
    for (const row of genuine) {
      const current = latestByMandi.get(row.mandi_id);
      if (!current || isoDay(row.price_date) > isoDay(current.price_date)) latestByMandi.set(row.mandi_id, row);
    }
    const entries = [...latestByMandi.values()]
      .sort((a, b) => isoDay(b.price_date).localeCompare(isoDay(a.price_date)) || String(a.mandi_name).localeCompare(String(b.mandi_name)));

    const [primary, ...others] = entries;
    const shown = [primary, ...others.slice(0, 4)];
    const label = (row) => displayMarketName(row.mandi_name).toLowerCase();
    const numbered = (row) => shown.filter((other) => label(other) === label(row)).length > 1;
    return {
      ...this.#marketRow(primary, { numbered: numbered(primary) }),
      scope: mandi ? 'mandi' : district ? 'district' : 'all',
      marketCount: entries.length,
      alternatives: shown.slice(1).map((row) => this.#marketRow(row, { numbered: numbered(row) })),
    };
  }

  async getPriceTrend({ commodity, mandi = null, district = null, days = 7, includeSample = false } = {}) {
    if (!commodity || (!mandi && !district)) {
      return { found: false, reason: 'A market or district is required for trend analysis.' };
    }
    const filters = { commodity: commodity.code || commodity.name, includeSample, limit: 200, offset: 0, order: 'DESC' };
    if (mandi) filters.mandiId = mandi.id;
    else filters.district = district;

    const { rows = [] } = (await this.mandiService.getPriceHistory(filters)) || {};

    // One value per reporting day (average of what was reported that day), newest first.
    const byDay = new Map();
    for (const row of rows.filter(isGenuine)) {
      const modal = num(row.modal_price);
      if (!Number.isFinite(modal) || modal <= 0) continue;
      const entry = byDay.get(isoDay(row.price_date)) || { sum: 0, n: 0 };
      entry.sum += modal;
      entry.n += 1;
      byDay.set(isoDay(row.price_date), entry);
    }
    const dates = [...byDay.keys()].sort().reverse().slice(0, Math.min(Math.max(days, 2), 30));
    if (dates.length < 2) return { found: false, reason: 'Insufficient price history to calculate a trend.' };

    const series = dates.map((date) => ({ date, modalPrice: Math.round(byDay.get(date).sum / byDay.get(date).n) }));
    const modals = series.map((s) => s.modalPrice);
    const latest = series[0];
    const oldest = series[series.length - 1];
    const changePercent = oldest.modalPrice > 0 ? Number((((latest.modalPrice - oldest.modalPrice) / oldest.modalPrice) * 100).toFixed(1)) : null;
    return {
      found: true,
      scope: mandi ? 'mandi' : 'district',
      observationCount: series.length,
      startDate: oldest.date,
      endDate: latest.date,
      ...this.age(latest.date),
      latestModal: latest.modalPrice,
      oldestModal: oldest.modalPrice,
      averageModal: Number((modals.reduce((a, b) => a + b, 0) / modals.length).toFixed(1)),
      minPrice: Math.min(...modals),
      maxPrice: Math.max(...modals),
      changePercent,
      direction: changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : 'stable',
      records: series.map((s) => ({ date: s.date, modalPrice: s.modalPrice })),
    };
  }

  /** Persisted model forecasts for a market (or the first market in a district that has one). Synthetic forecasts are never returned as predictions. */
  async getForecast({ commodity, mandi = null, district = null, horizon = null } = {}) {
    if (!commodity) return { found: false, reason: 'A commodity is required for a forecast lookup.' };
    const candidates = mandi ? [mandi] : district ? await this.#mandisInDistrict(district) : [];
    if (candidates.length === 0) {
      return { found: false, reason: 'Forecasts are generated per market, so a specific market is needed.' };
    }

    const ask = (m, includeSample) => this.forecastService.getForecast({
      commodityId: commodity.id,
      mandiId: m.id,
      horizon: horizon || undefined,
      includeSample,
      order: 'ASC',
    });

    for (const candidate of candidates) {
      const result = await ask(candidate, false);
      if (result?.available && result.forecasts?.length) {
        return {
          found: true,
          mandi: result.mandi || candidate,
          commodity: result.commodity,
          forecastCount: result.forecasts.length,
          forecasts: result.forecasts.map((f) => ({
            forecastDate: isoDay(f.forecast_date),
            horizonDays: Number(f.horizon_days),
            predictedPrice: num(f.predicted_price),
            lowerBound: num(f.lower_bound),
            upperBound: num(f.upper_bound),
            intervalLevelPercent: f.interval_level == null ? null : Math.round(Number(f.interval_level) * (Number(f.interval_level) <= 1 ? 100 : 1)),
            confidence: num(f.confidence), // heuristic model label, never presented as a probability
            unit: f.unit || 'INR/quintal',
            modelVersion: f.model_version,
            lastObservedPrice: num(f.last_observed_price),
            lastObservedDate: f.last_observed_date ? isoDay(f.last_observed_date) : null,
            isSampleData: false,
          })),
        };
      }
    }

    const probe = await ask(candidates[0], true);
    if (probe?.available && probe.forecasts?.length) {
      return { found: false, sampleOnly: true, reason: 'Only synthetic test forecasts exist for this market; they are not real predictions and are not shown.' };
    }
    return { found: false, reason: 'No forecast has been generated yet for this market and crop.' };
  }

  getEducationalConcept(query = '') {
    const text = String(query).toLowerCase();
    if (/modal|मोडल|मॉडल/i.test(text)) return AGRICULTURAL_TERMS.MODAL_PRICE;
    if (/apmc|mandi|मंडी|बाजार/i.test(text)) return AGRICULTURAL_TERMS.APMC_MANDI;
    if (/msp|एमएसपी|हमस/i.test(text)) return AGRICULTURAL_TERMS.MSP;
    if (/interval|uncertainty|इंटरवल|कक्षा|खात्री/i.test(text)) return AGRICULTURAL_TERMS.PREDICTION_INTERVAL;
    if (/arrival|आवक/i.test(text)) return AGRICULTURAL_TERMS.ARRIVALS;
    return null;
  }
}
