import { pool as defaultPool } from '../../db.js';
import { MandiService } from '../mandi.service.js';
import { ForecastService } from '../forecast.service.js';

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

export class GroundedRetrievalService {
  constructor({
    pool = defaultPool,
    mandiService = new MandiService({ pool }),
    forecastService = new ForecastService({ pool }),
  } = {}) {
    this.pool = pool;
    this.mandiService = mandiService;
    this.forecastService = forecastService;
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
       ORDER BY id LIMIT 1`,
      [clean, `%${clean}%`]
    );
    return res.rows[0] || null;
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

  async getLatestPrice({ commodity, mandi, includeSample = false } = {}) {
    if (!commodity) return { found: false, reason: 'Commodity required' };

    const filters = {
      commodity: commodity.name,
      includeSample,
    };
    if (mandi) {
      filters.mandiId = mandi.id;
    }

    const rows = await this.mandiService.getLatestPrices(filters);
    if (!rows || rows.length === 0) {
      // Check if sample rows exist to provide honest feedback
      if (!includeSample) {
        const sampleRows = await this.mandiService.getLatestPrices({ ...filters, includeSample: true });
        if (sampleRows && sampleRows.length > 0) {
          return {
            found: false,
            sampleOnly: true,
            reason: 'Only synthetic sample data exists for this market pair. Live genuine prices have not been reported yet.',
          };
        }
      }
      return { found: false, reason: 'No reported price records found for this selection.' };
    }

    const row = rows[0];
    return {
      found: true,
      priceDate: row.price_date,
      modalPrice: row.modal_price ? Number(row.modal_price) : null,
      minPrice: row.min_price ? Number(row.min_price) : null,
      maxPrice: row.max_price ? Number(row.max_price) : null,
      priceUnit: row.price_unit || 'INR/quintal',
      arrivalsQuantity: row.arrivals_quantity ? Number(row.arrivals_quantity) : null,
      arrivalUnit: row.arrival_unit || 'quintal',
      variety: row.variety || 'Standard',
      grade: row.grade || 'FAQ',
      source: row.source_label || row.source || 'AGMARKNET',
      isSampleData: Boolean(row.is_sample_data),
      mandiName: row.mandi_name,
      district: row.district,
      state: row.state,
      commodityName: row.commodity_name,
      trendPercent: row.trend_percent ?? null,
      trendDirection: row.trend_direction ?? 'none',
    };
  }

  async getPriceTrend({ commodity, mandi, days = 7, includeSample = false } = {}) {
    if (!commodity || !mandi) {
      return { found: false, reason: 'Both commodity and mandi required for trend analysis.' };
    }

    const history = await this.mandiService.getPriceHistory({
      commodityId: commodity.id,
      mandiId: mandi.id,
      limit: Math.min(days, 30),
      includeSample,
    });

    if (!history || history.length === 0) {
      return { found: false, reason: 'Insufficient price history to calculate a trend.' };
    }

    const validModals = history
      .map((h) => Number(h.modal_price))
      .filter((p) => Number.isFinite(p) && p > 0);

    const latest = history[0];
    const oldest = history[history.length - 1];
    const avg = validModals.length > 0 ? (validModals.reduce((a, b) => a + b, 0) / validModals.length).toFixed(1) : null;
    const min = validModals.length > 0 ? Math.min(...validModals) : null;
    const max = validModals.length > 0 ? Math.max(...validModals) : null;

    let changePercent = null;
    if (oldest?.modal_price && latest?.modal_price) {
      const oldP = Number(oldest.modal_price);
      const newP = Number(latest.modal_price);
      if (oldP > 0) {
        changePercent = Number((((newP - oldP) / oldP) * 100).toFixed(1));
      }
    }

    return {
      found: true,
      observationCount: history.length,
      startDate: oldest.price_date,
      endDate: latest.price_date,
      latestModal: Number(latest.modal_price),
      oldestModal: Number(oldest.modal_price),
      averageModal: avg ? Number(avg) : null,
      minPrice: min,
      maxPrice: max,
      changePercent,
      direction: changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : 'stable',
      records: history.map((h) => ({
        date: h.price_date,
        modalPrice: Number(h.modal_price),
        arrivals: h.arrivals_quantity ? Number(h.arrivals_quantity) : null,
      })),
    };
  }

  async getForecast({ commodity, mandi, horizon = null, includeSample = true } = {}) {
    if (!commodity || !mandi) {
      return { found: false, reason: 'Both commodity and mandi required for forecast lookup.' };
    }

    const result = await this.forecastService.getForecast({
      commodityId: commodity.id,
      mandiId: mandi.id,
      horizon: horizon || undefined,
      includeSample,
      order: 'ASC',
    });

    if (!result.available || !result.forecasts || result.forecasts.length === 0) {
      return {
        found: false,
        reason: result.reason || 'No forecast has been generated yet for this market pair.',
      };
    }

    return {
      found: true,
      mandi: result.mandi,
      commodity: result.commodity,
      forecastCount: result.forecasts.length,
      forecasts: result.forecasts.map((f) => ({
        forecastDate: f.forecast_date,
        horizonDays: f.horizon_days,
        predictedPrice: f.predicted_price,
        lowerBound: f.lower_bound,
        upperBound: f.upper_bound,
        confidence: f.confidence,
        intervalLevel: f.interval_level,
        unit: f.unit,
        modelVersion: f.model_version,
        lastObservedPrice: f.last_observed_price,
        lastObservedDate: f.last_observed_date,
        isSampleData: Boolean(f.is_sample_data),
      })),
    };
  }

  getEducationalConcept(query = '') {
    const text = String(query).toLowerCase();
    if (/modal|मोडल/i.test(text)) return AGRICULTURAL_TERMS.MODAL_PRICE;
    if (/apmc|mandi|मंडी|बाजार/i.test(text)) return AGRICULTURAL_TERMS.APMC_MANDI;
    if (/msp|एमएसपी|हमस/i.test(text)) return AGRICULTURAL_TERMS.MSP;
    if (/interval|uncertainty|इंटरवल|कक्षा|खात्री/i.test(text)) return AGRICULTURAL_TERMS.PREDICTION_INTERVAL;
    if (/arrival|आवक/i.test(text)) return AGRICULTURAL_TERMS.ARRIVALS;
    return null;
  }
}
