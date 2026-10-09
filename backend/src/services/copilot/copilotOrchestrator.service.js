/**
 * Copilot orchestration pipeline.
 *
 *   message -> entities (message > UI context > conversation history > farmer profile)
 *           -> intent -> verified data retrieval -> conversational answer from the model
 *           -> numeric-fidelity check -> (retry once) -> deterministic fallback
 *
 * The model talks; the data decides what is true. Every lookup is isolated so one failing
 * query degrades the answer ("I could not look that up") instead of failing the conversation.
 */
import { defaultGroqService } from '../groq.service.js';
import { GroundedRetrievalService } from './groundedRetrieval.service.js';
import { classifyIntent, detectCrop, detectStaticPlace, extractHorizon, INTENTS } from './intentClassifier.js';
import { phase5Adapter, phase6Adapter, phase8Adapter } from './adapters.js';
import { validateGroundedAnswer } from './answerValidator.js';
import { deterministicAnswer } from './deterministicAnswers.js';
import { buildMessages, buildSystemPrompt, buildVerifiedPayload } from './copilotPrompts.js';
import { todayInIndia } from './freshness.js';

// Intents that need market data about a crop; only these may fall back to the farmer's profile defaults.
const DATA_INTENTS = new Set([
  INTENTS.LATEST_PRICE, INTENTS.PRICE_HISTORY, INTENTS.FORECAST, INTENTS.FORECAST_UNCERTAINTY,
  INTENTS.SELL_TIMING, INTENTS.RISK_EXPLANATION,
]);
const TREND_INTENTS = new Set([INTENTS.PRICE_HISTORY, INTENTS.SELL_TIMING, INTENTS.RISK_EXPLANATION]);
const FORECAST_INTENTS = new Set([INTENTS.FORECAST, INTENTS.FORECAST_UNCERTAINTY, INTENTS.SELL_TIMING]);

export class CopilotOrchestrator {
  constructor({
    groqService = defaultGroqService,
    retrievalService = new GroundedRetrievalService(),
    phase5 = phase5Adapter,
    phase6 = phase6Adapter,
    phase8 = phase8Adapter,
    now = () => new Date(),
    log = console,
  } = {}) {
    this.groqService = groqService;
    this.retrieval = retrievalService;
    this.phase5 = phase5;
    this.phase6 = phase6;
    this.phase8 = phase8;
    this.now = now;
    this.log = log;
  }

  /** Finds a market or district in free text (database aware when the retrieval layer supports it). */
  async #placeFromText(text) {
    if (!text) return null;
    if (typeof this.retrieval.detectPlace === 'function') return this.retrieval.detectPlace(text);
    const name = detectStaticPlace(text);
    const mandi = name ? await this.retrieval.resolveMandi(name) : null;
    return mandi ? { kind: 'mandi', mandi } : null;
  }

  /** A failing lookup must not take the conversation down with it. */
  async #safely(label, task, limitations) {
    try {
      return await task();
    } catch (err) {
      this.log.error?.(`[Copilot] ${label} lookup failed: ${err.message}`);
      limitations.push(`${label} data is temporarily unavailable.`);
      return { found: false, reason: `${label} data is temporarily unavailable.`, error: true };
    }
  }

  async processMessage({
    message,
    language = 'en',
    context = {},
    conversationHistory = [],
    userId = null,
  } = {}) {
    const lang = ['en', 'hi', 'mr'].includes(language) ? language : 'en';
    const cleanMessage = String(message || '').trim();
    const history = Array.isArray(conversationHistory) ? conversationHistory : [];
    const limitations = [];
    const assumptions = [];

    // Farmer profile (Phase 8). Only crop, district and state are ever used, and only as defaults.
    const profile = userId ? await this.phase8.getFarmerContext(userId) : null;

    // ---- entities: explicit message > UI context > earlier turns > profile (below, data intents only)
    let crop = detectCrop(cleanMessage);
    let placeRef = await this.#placeFromText(cleanMessage);
    if (!crop && context?.commodity) crop = detectCrop(context.commodity) || String(context.commodity);
    if (!placeRef && context?.mandi) placeRef = await this.#placeFromText(String(context.mandi));
    const earlierUserTurns = history.filter((m) => m?.role === 'user').map((m) => String(m.content || '')).reverse().slice(0, 4);
    for (const turn of earlierUserTurns) {
      if (!crop) crop = detectCrop(turn);
      if (!placeRef) placeRef = await this.#placeFromText(turn);
      if (crop && placeRef) break;
    }

    // A market the farmer named that is not in our list: say so instead of silently answering for other markets.
    const namedPlace = detectStaticPlace(cleanMessage);
    const unknownPlace = !placeRef && namedPlace ? namedPlace : null;
    const placeName = placeRef ? (placeRef.kind === 'mandi' ? placeRef.mandi.name : placeRef.district) : null;
    const intent = classifyIntent(cleanMessage, { commodity: crop, mandi: placeName });

    if (DATA_INTENTS.has(intent) && profile) {
      if (!crop && profile.primaryCrop) {
        crop = detectCrop(profile.primaryCrop) || profile.primaryCrop;
        assumptions.push('commodity_from_profile');
      }
      if (!placeRef && profile.district) {
        placeRef = (await this.#placeFromText(profile.district))
          || { kind: 'district', district: profile.district, state: profile.state, mandis: [] };
        assumptions.push('place_from_profile');
      }
    }

    const horizon = extractHorizon(cleanMessage) ?? context?.horizon ?? null;
    const commodityRow = crop ? await this.retrieval.resolveCommodity(crop) : null;
    const unsupportedCrop = crop && !commodityRow ? crop : null;
    const supportedCommodities = typeof this.retrieval.supportedCommodityNames === 'function'
      ? await this.#safely('Commodity', () => this.retrieval.supportedCommodityNames(), limitations).then((r) => (Array.isArray(r) ? r : []))
      : [];

    const scope = placeRef?.kind === 'mandi' ? { mandi: placeRef.mandi } : placeRef ? { district: placeRef.district } : {};

    // ---- verified data retrieval (independent lookups run together)
    const wants = {
      price: DATA_INTENTS.has(intent) || intent === INTENTS.RECOMMENDATION_EXPLANATION,
      trend: TREND_INTENTS.has(intent),
      forecast: FORECAST_INTENTS.has(intent),
    };
    const canQuery = Boolean(commodityRow);
    const [marketData, trendData, forecastData] = await Promise.all([
      wants.price && canQuery ? this.#safely('Price', () => this.retrieval.getLatestPrice({ commodity: commodityRow, ...scope, includeSample: false }), limitations) : null,
      wants.trend && canQuery ? this.#safely('Trend', () => this.retrieval.getPriceTrend({ commodity: commodityRow, ...scope, days: 7, includeSample: false }), limitations) : null,
      wants.forecast && canQuery ? this.#safely('Forecast', () => this.retrieval.getForecast({ commodity: commodityRow, ...scope, horizon, includeSample: false }), limitations) : null,
    ]);

    const sources = [];
    if (marketData?.found) {
      sources.push({
        type: 'mandi_price', source: marketData.source, date: marketData.priceDate, mandi: marketData.mandiName,
        commodity: marketData.commodityName, isSample: false, ageDays: marketData.ageDays,
      });
      if (marketData.isStale) limitations.push(`The latest reported price is ${marketData.ageDays} days old (${marketData.priceDate}); it is not today's price.`);
    } else if (marketData?.sampleOnly) {
      limitations.push('Only synthetic sample data was found for this market; no verified observation is available.');
    } else if (marketData && !marketData.error) {
      limitations.push('No recent market price observation found for this selection.');
    }
    if (trendData?.found) {
      sources.push({ type: 'price_history', source: 'AGMARKNET / CEDA', startDate: trendData.startDate, endDate: trendData.endDate, count: trendData.observationCount });
    }
    if (forecastData?.found) {
      sources.push({
        type: 'price_forecast', source: 'FASALYTICS Phase 4 Forecasting Engine',
        forecastCount: forecastData.forecastCount, models: forecastData.forecasts.map((f) => f.modelVersion),
      });
      limitations.push('Forecast prices are model projections, not observed transactions. Always account for market volatility.');
    } else if (forecastData && !forecastData.error) {
      limitations.push(forecastData.reason || 'Forecast unavailable for this pair.');
    }

    const conceptData = intent === INTENTS.MARKET_EDUCATION ? this.retrieval.getEducationalConcept(cleanMessage) : null;
    const recommendationData = intent === INTENTS.RECOMMENDATION_EXPLANATION
      ? await this.phase5.getRecommendation({ commodity: commodityRow?.name, mandi: placeName })
      : null;
    if (recommendationData) limitations.push(recommendationData.reason);
    const riskData = intent === INTENTS.RISK_EXPLANATION
      ? await this.phase6.getRiskIndicators({ commodity: commodityRow?.name, mandi: placeName })
      : null;
    if (riskData) limitations.push(riskData.reason);

    const retrieved = {
      marketData: marketData && marketData.found ? { ...marketData, scope: marketData.scope } : marketData,
      trendData, forecastData, conceptData, recommendationData, riskData,
      place: placeRef, unsupportedCrop, unknownPlace, supportedCommodities,
    };

    // ---- answer: conversational model first, deterministic data answer as the safety net
    let answer = '';
    let groqPowered = false;
    let aiModel = null;
    let aiError = null;
    const profileDefaults = assumptions.length ? { primaryCrop: crop, district: profile?.district } : null;

    if (this.groqService.isConfigured()) {
      try {
        const generated = await this.#generateGrounded({
          message: cleanMessage, language: lang, intent, history, retrieved, commodityRow, limitations, assumptions, profileDefaults,
        });
        answer = generated.answer;
        aiModel = generated.model;
        groqPowered = true;
      } catch (err) {
        aiError = err.code || 'GROQ_ERROR';
        this.log.warn?.(`[Copilot] AI answer unavailable (${aiError}); using verified-data answer.`);
        limitations.push(`AI assistant unavailable (${aiError}); this answer was generated directly from verified records.`);
      }
    } else {
      aiError = 'GROQ_NOT_CONFIGURED';
      limitations.push('Groq LLM is not configured; answer generated directly from verified database records.');
    }

    if (!answer) {
      answer = deterministicAnswer({ language: lang, intent, commodity: commodityRow, retrieved, assumptions, profile: profileDefaults });
    }

    return {
      available: true,
      answer,
      language: lang,
      intent,
      entity: {
        commodity: commodityRow ? commodityRow.name : crop,
        mandi: placeName,
        horizon,
      },
      assumptions,
      sources,
      marketData: marketData && marketData.found ? marketData : null,
      trendData: trendData && trendData.found ? trendData : null,
      forecastData: forecastData && forecastData.found ? forecastData : null,
      limitations,
      groqPowered,
      aiModel,
      aiError,
    };
  }

  async #generateGrounded({ message, language, intent, history, retrieved, commodityRow, limitations, assumptions, profileDefaults }) {
    const payload = buildVerifiedPayload({
      language, intent, today: todayInIndia(this.now()), commodity: commodityRow, retrieved, notes: limitations,
    });
    const systemPrompt = buildSystemPrompt({ language, assumptions, profile: profileDefaults });
    const allowedExtra = [message, ...history.map((m) => String(m?.content || ''))];

    let correction = null;
    let lastOffending = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await this.groqService.generateChatCompletion({
        messages: buildMessages({ systemPrompt, payload, message, history, correction }),
        temperature: 0.35,
        maxTokens: 300,
      });
      const answer = String(result?.content || '').trim();
      if (!answer) {
        const err = new Error('The model returned an empty answer.');
        err.code = 'GROQ_EMPTY_ANSWER';
        throw err;
      }
      const check = validateGroundedAnswer(answer, payload, { extraTexts: allowedExtra });
      if (check.valid) return { answer, model: result.model || this.groqService.getModel?.() || null };
      lastOffending = check.offending;
      correction = check.offending;
    }
    const err = new Error(`The model stated numbers that are not in the verified data (${lastOffending.join(', ')}).`);
    err.code = 'ANSWER_NOT_GROUNDED';
    throw err;
  }
}

export const defaultCopilotOrchestrator = new CopilotOrchestrator();
