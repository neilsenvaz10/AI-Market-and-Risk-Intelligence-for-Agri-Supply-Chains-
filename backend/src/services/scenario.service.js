import { pool as defaultPool } from '../db.js';
import defaultForecastService from './forecast.service.js';
import { RiskService } from './risk.service.js';
import { findFarmerByUid } from './farmer.service.js';
import { HttpError } from '../utils/httpError.js';

const round2 = (num) => (num === null || num === undefined || Number.isNaN(num) ? null : Math.round(Number(num) * 100) / 100);

export class ScenarioService {
  constructor({
    pool = defaultPool,
    forecastService = defaultForecastService,
    riskService = new RiskService({ pool }),
    findFarmer = findFarmerByUid,
  } = {}) {
    this.pool = pool;
    this.forecastService = forecastService;
    this.riskService = riskService;
    this.findFarmer = findFarmer;
  }

  /**
   * Resolves the latest market price observation for a specific commodity & mandi.
   */
  async getLatestObservation({ commodityId, mandiId, includeSample = true }) {
    const sampleFilter = includeSample ? '' : 'AND is_sample_data = FALSE';
    const sql = `
      SELECT observation_id, reported_date, modal_price, minimum_price, maximum_price,
             normalized_price_unit, source, source_label, is_sample_data
      FROM mandi_prices_canonical
      WHERE commodity_id = $1 AND mandi_id = $2
        ${sampleFilter}
      ORDER BY reported_date DESC, observation_id DESC
      LIMIT 1`;

    try {
      const result = await this.pool.query(sql, [commodityId, mandiId]);
      return result.rows[0] || null;
    } catch (err) {
      if (err.code === '42P01') return null;
      throw err;
    }
  }

  /**
   * Simulates selling a single mandi quantity at Day 0 (today) vs holding for 1..7 days.
   */
  async simulateSingleMandi({
    commodity,
    mandiId,
    quantityQuintals = 10,
    holdDays = 1,
    includeRisk = true,
    includeSample = true,
    documentedStorageCostPerDay = 0,
    authContext = null,
  }) {
    let resolvedCommodityKey = commodity;
    let resolvedMandiKey = mandiId;

    // Use authenticated farmer profile for personalization fallback when unspecified
    if ((!resolvedCommodityKey || !resolvedMandiKey) && authContext?.uid) {
      const farmer = await this.findFarmer(authContext.uid).catch(() => null);
      if (farmer) {
        if (!resolvedCommodityKey && farmer.primary_crop) {
          resolvedCommodityKey = farmer.primary_crop;
        }
        if (!resolvedMandiKey && farmer.district) {
          resolvedMandiKey = farmer.district;
        }
      }
    }

    if (!resolvedCommodityKey) {
      throw new HttpError(400, 'COMMODITY_REQUIRED', 'Please select a commodity for the selling simulation.');
    }
    if (!resolvedMandiKey) {
      throw new HttpError(400, 'MANDI_REQUIRED', 'Please select a mandi for the selling simulation.');
    }

    const [commodityRow, mandiRow] = await Promise.all([
      this.forecastService.resolveCommodity(resolvedCommodityKey),
      this.forecastService.resolveMandi(resolvedMandiKey),
    ]);

    if (!commodityRow) {
      throw new HttpError(404, 'COMMODITY_NOT_FOUND', `No commodity matches "${resolvedCommodityKey}".`);
    }
    if (!mandiRow) {
      throw new HttpError(404, 'MANDI_NOT_FOUND', `No mandi matches "${resolvedMandiKey}".`);
    }

    const warnings = [];
    const q = Number(quantityQuintals) || 10;
    const hold = Math.max(0, Math.min(7, Number(holdDays) || 0));

    // 1. Current Market Observation
    const latestObs = await this.getLatestObservation({
      commodityId: commodityRow.id,
      mandiId: mandiRow.id,
      includeSample,
    });

    const currentModalPrice = latestObs ? round2(latestObs.modal_price) : null;
    const currentGrossRevenue = currentModalPrice !== null ? round2(currentModalPrice * q) : null;
    const isCurrentSample = Boolean(latestObs?.is_sample_data);

    if (!latestObs) {
      warnings.push({
        code: 'NO_CURRENT_PRICE',
        severity: 'WARNING',
        message: 'No recent market price observation reported for this mandi.',
      });
    }

    // 2. Forecast Retrieval for Horizon
    let forecastData = {
      available: false,
      targetDate: null,
      horizonDays: hold,
      predictedModalPrice: null,
      lowerBound: null,
      upperBound: null,
      confidence: null,
      model: null,
      source: null,
      isSampleData: false,
      grossRevenue: null,
      grossRevenueLower: null,
      grossRevenueUpper: null,
    };

    if (hold === 0) {
      // "Sell Today" Scenario
      if (currentModalPrice !== null) {
        forecastData = {
          available: true,
          targetDate: latestObs.reported_date,
          horizonDays: 0,
          predictedModalPrice: currentModalPrice,
          lowerBound: currentModalPrice,
          upperBound: currentModalPrice,
          confidence: 100,
          model: 'CURRENT_SPOT_OBSERVATION',
          source: latestObs.source_label || latestObs.source || 'MARKET_REPORT',
          isSampleData: isCurrentSample,
          grossRevenue: currentGrossRevenue,
          grossRevenueLower: currentGrossRevenue,
          grossRevenueUpper: currentGrossRevenue,
        };
      }
    } else {
      // "Wait N Days" Scenario (1..7)
      const forecastResult = await this.forecastService.getForecast({
        mandiId: mandiRow.id,
        commodityId: commodityRow.id,
        horizon: hold,
        includeSample,
      });

      const matchedRow = forecastResult.rows?.[0];
      if (matchedRow && matchedRow.predicted_price !== null) {
        const predPrice = round2(matchedRow.predicted_price);
        const lower = round2(matchedRow.lower_bound);
        const upper = round2(matchedRow.upper_bound);

        forecastData = {
          available: true,
          targetDate: matchedRow.forecast_date,
          horizonDays: matchedRow.horizon_days,
          predictedModalPrice: predPrice,
          lowerBound: lower,
          upperBound: upper,
          confidence: round2(matchedRow.confidence),
          model: matchedRow.model_version,
          source: matchedRow.data_source,
          isSampleData: Boolean(matchedRow.is_sample_data),
          grossRevenue: predPrice !== null ? round2(predPrice * q) : null,
          grossRevenueLower: lower !== null ? round2(lower * q) : null,
          grossRevenueUpper: upper !== null ? round2(upper * q) : null,
        };
      } else {
        warnings.push({
          code: 'NO_FORECAST',
          severity: 'INFO',
          message: `No trained price forecast available for ${hold}-day horizon at ${mandiRow.name}.`,
        });
      }
    }

    // 3. Gross Revenue Comparison
    let comparison = {
      grossRevenueDifference: null,
      percentageDifference: null,
      calculationBasis: 'GROSS_REVENUE_ONLY',
      note: 'Gross revenue comparison only. Actual net return requires transport, handling, storage, and mandi fees.',
    };

    if (currentGrossRevenue !== null && forecastData.grossRevenue !== null) {
      const diff = round2(forecastData.grossRevenue - currentGrossRevenue);
      const pct = currentModalPrice
        ? round2(((forecastData.predictedModalPrice - currentModalPrice) / currentModalPrice) * 100)
        : null;

      comparison = {
        ...comparison,
        grossRevenueDifference: diff,
        percentageDifference: pct,
      };

      // Assumption-based storage cost if farmer provided documented storage cost
      if (documentedStorageCostPerDay > 0 && hold > 0) {
        const totalStorageCost = round2(documentedStorageCostPerDay * hold * q);
        comparison.documentedStorageCost = totalStorageCost;
        comparison.assumedStorageAdjustedDifference = round2(diff - totalStorageCost);
        comparison.storageAssumptionNote = `Includes documented storage cost of ₹${documentedStorageCostPerDay}/q/day for ${hold} days.`;
      }
    }

    // 4. Phase 6 Risk Intelligence Integration
    let risk = {
      available: false,
      overallLevel: null,
      summaryAdvice: null,
      warnings: [],
      breakdown: null,
      explanation: 'Market risk analysis is currently unavailable. Forecast uncertainty bounds are displayed where supported.',
    };

    if (includeRisk && this.riskService) {
      try {
        const riskResult = await this.riskService.getMandiRisk({
          commodity: commodityRow.code,
          mandi: mandiRow.code,
          includeSample,
        });

        if (riskResult) {
          risk = {
            available: true,
            overallLevel: riskResult.overallLevel || 'UNKNOWN',
            summaryAdvice: riskResult.summaryAdvice || null,
            warnings: riskResult.warnings || [],
            breakdown: riskResult.breakdown || null,
            explanation: null,
          };
        }
      } catch (err) {
        risk.explanation = `Risk evaluation unavailable (${err.message || 'SERVICE_UNAVAILABLE'}).`;
      }
    }

    // 5. Data Provenance & Synthetic Data Flagging
    let dataStatus = 'VERIFIED_OBSERVATION';
    const isSynthetic = isCurrentSample || forecastData.isSampleData;

    if (isSynthetic) {
      dataStatus = 'SYNTHETIC_SAMPLE';
      warnings.unshift({
        code: 'SYNTHETIC_SAMPLE_DATA',
        severity: 'INFO',
        message: 'Demo simulation — based on synthetic historical market data.',
      });
    } else if (!latestObs || (!forecastData.available && hold > 0)) {
      dataStatus = 'INSUFFICIENT_DATA';
    }

    return {
      commodity: {
        id: commodityRow.id,
        code: commodityRow.code,
        name: commodityRow.name,
        hindiName: commodityRow.hindi_name,
        marathiName: commodityRow.marathi_name,
        category: commodityRow.category,
      },
      mandi: {
        id: mandiRow.id,
        code: mandiRow.code,
        name: mandiRow.name,
        hindiName: mandiRow.hindi_name,
        marathiName: mandiRow.marathi_name,
        state: mandiRow.state,
        district: mandiRow.district,
      },
      quantityQuintals: q,
      quantityKg: round2(q * 100),
      holdDays: hold,
      generatedAt: new Date().toISOString(),
      dataStatus,
      current: {
        modalPrice: currentModalPrice,
        priceReportedDate: latestObs?.reported_date || null,
        grossRevenue: currentGrossRevenue,
        source: latestObs?.source_label || latestObs?.source || null,
        isSampleData: isCurrentSample,
      },
      forecast: forecastData,
      comparison,
      risk,
      warnings,
    };
  }

  /**
   * Evaluates a complete multi-mandi allocation plan across horizons (Phase 5 + Phase 4).
   */
  async simulateMultiMandiPlan({
    commodity,
    allocations = [],
    holdDays = 1,
    includeRisk = true,
    includeSample = true,
    authContext = null,
  }) {
    if (!Array.isArray(allocations) || allocations.length === 0) {
      throw new HttpError(400, 'ALLOCATIONS_REQUIRED', 'No mandi allocations provided for multi-mandi simulation.');
    }

    const results = await Promise.all(
      allocations.map((alloc) =>
        this.simulateSingleMandi({
          commodity,
          mandiId: alloc.mandiId,
          quantityQuintals: alloc.quantityQuintals,
          holdDays,
          includeRisk,
          includeSample,
          authContext,
        })
      )
    );

    let totalCurrentGross = 0;
    let totalForecastGross = 0;
    let allCurrentAvailable = true;
    let allForecastAvailable = true;
    let totalQuantityQuintals = 0;
    let isAnySynthetic = false;

    for (const r of results) {
      totalQuantityQuintals += r.quantityQuintals;
      if (r.current.grossRevenue !== null) {
        totalCurrentGross += r.current.grossRevenue;
      } else {
        allCurrentAvailable = false;
      }

      if (r.forecast.grossRevenue !== null) {
        totalForecastGross += r.forecast.grossRevenue;
      } else {
        allForecastAvailable = false;
      }

      if (r.dataStatus === 'SYNTHETIC_SAMPLE') {
        isAnySynthetic = true;
      }
    }

    const totalDiff = allCurrentAvailable && allForecastAvailable
      ? round2(totalForecastGross - totalCurrentGross)
      : null;

    const totalPct = totalCurrentGross > 0 && totalDiff !== null
      ? round2((totalDiff / totalCurrentGross) * 100)
      : null;

    return {
      type: 'MULTI_MANDI_PLAN',
      commodity: results[0]?.commodity,
      holdDays,
      totalQuantityQuintals: round2(totalQuantityQuintals),
      totalQuantityKg: round2(totalQuantityQuintals * 100),
      isPlanComplete: allCurrentAvailable && allForecastAvailable,
      dataStatus: isAnySynthetic ? 'SYNTHETIC_SAMPLE' : (allCurrentAvailable && allForecastAvailable ? 'VERIFIED_OBSERVATION' : 'INSUFFICIENT_DATA'),
      summary: {
        totalCurrentGrossRevenue: allCurrentAvailable ? round2(totalCurrentGross) : null,
        totalForecastGrossRevenue: allForecastAvailable ? round2(totalForecastGross) : null,
        totalGrossRevenueDifference: totalDiff,
        totalPercentageDifference: totalPct,
      },
      mandiSimulations: results,
    };
  }

  /**
   * Main simulation dispatch.
   */
  async simulate(payload, authContext = null) {
    if (Array.isArray(payload.allocations) && payload.allocations.length > 0) {
      return this.simulateMultiMandiPlan({ ...payload, authContext });
    }
    return this.simulateSingleMandi({ ...payload, authContext });
  }
}

export default new ScenarioService();
