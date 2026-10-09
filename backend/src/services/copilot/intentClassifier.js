/**
 * Intent Classifier and Entity Resolution for FASALYTICS Copilot.
 * Supports multilingual user input in English, Hindi, and Marathi.
 */

export const INTENTS = {
  LATEST_PRICE: 'LATEST_PRICE',
  PRICE_HISTORY: 'PRICE_HISTORY',
  FORECAST: 'FORECAST',
  FORECAST_UNCERTAINTY: 'FORECAST_UNCERTAINTY',
  RISK_EXPLANATION: 'RISK_EXPLANATION',
  RECOMMENDATION_EXPLANATION: 'RECOMMENDATION_EXPLANATION',
  MARKET_EDUCATION: 'MARKET_EDUCATION',
  GENERAL_GREETING: 'GENERAL_GREETING',
  CLARIFICATION: 'CLARIFICATION',
};

// Common entity aliases in English, Hindi (Devanagari/Hinglish), Marathi
const COMMODITY_ALIASES = [
  { code: 'ONION', canonical: 'Onion', matches: [/onion/i, /कांद[ाे्याच]/i, /कांदा/i, /कांदे/i, /प्याज/i, /kanda/i, /pyaz/i] },
  { code: 'TOMATO', canonical: 'Tomato', matches: [/tomato/i, /टोमॅटो/i, /टोमॅटोचे/i, /टमाटर/i, /tamatar/i] },
];

const MANDI_ALIASES = [
  { canonical: 'Nashik', matches: [/nashik/i, /नाशिक/i, /नासिक/i] },
  { canonical: 'Pune', matches: [/pune/i, /पुणे/i, /पुण्या/i] },
  { canonical: 'Lasalgaon', matches: [/lasalgaon/i, /लासलगाव/i] },
  { canonical: 'Mumbai', matches: [/mumbai/i, /मुंबई/i] },
  { canonical: 'Nagpur', matches: [/nagpur/i, /नागपूर/i] },
  { canonical: 'Solapur', matches: [/solapur/i, /सोलापूर/i] },
  { canonical: 'Kolhapur', matches: [/kolhapur/i, /कोल्हापूर/i] },
  { canonical: 'Ahmednagar', matches: [/ahmednagar/i, /अहमदनगर/i] },
  { canonical: 'Baramati', matches: [/baramati/i, /बारामती/i] },
];

export function extractEntities(text = '', previousContext = {}) {
  const clean = String(text || '').trim();
  let commodity = null;
  let mandi = null;
  let horizon = null;

  for (const item of COMMODITY_ALIASES) {
    if (item.matches.some((re) => re.test(clean))) {
      commodity = item.canonical;
      break;
    }
  }

  for (const item of MANDI_ALIASES) {
    if (item.matches.some((re) => re.test(clean))) {
      mandi = item.canonical;
      break;
    }
  }

  // Horizon extraction (tomorrow, next 7 days, etc.)
  if (/tomorrow|कल|उद्या/i.test(clean)) {
    horizon = 1;
  } else if (/day after tomorrow|परसों|परवा/i.test(clean)) {
    horizon = 2;
  } else if (/\b([1-7])\s*(day|days|दिवस|दिन)\b/i.test(clean)) {
    const match = clean.match(/\b([1-7])\s*(day|days|दिवस|दिन)\b/i);
    horizon = Number(match[1]);
  } else if (/week|आठवडा|सप्ताह/i.test(clean)) {
    horizon = 7;
  }

  // Inherit from context if omitted in follow-up query
  if (!commodity && previousContext?.commodity) {
    commodity = previousContext.commodity;
  }
  if (!mandi && previousContext?.mandi) {
    mandi = previousContext.mandi;
  }

  return { commodity, mandi, horizon };
}

export function classifyIntent(text = '', context = {}) {
  const clean = String(text || '').trim();

  // Greetings - match beginning with word or space/end
  if (/^(hi|hello|hey|namaste|namaskar|नमस्ते|नमस्कार|हॅलो)(\s|$|[!.,])/i.test(clean) && clean.length < 35) {
    return INTENTS.GENERAL_GREETING;
  }

  // Market terminology / educational concepts
  if (/what is (msp|apmc|mandi|modal price|arrival)|(एमएसपी|एपीएमसी|बाजारभाव|मोडल भाव|मोडल प्राइस|आवक|हमीभाव).*(म्हणजे काय|काय असते|क्या है|क्या होता है)|(explain|समझाओ|स्पष्ट करा).*(msp|apmc|modal price|interval)/i.test(clean)) {
    return INTENTS.MARKET_EDUCATION;
  }

  // Recommendation query
  if (/recommend|which mandi|best mandi|where should i sell|कहाँ बेचना|कोणत्या बाजारात|कुठे विकू/i.test(clean)) {
    return INTENTS.RECOMMENDATION_EXPLANATION;
  }

  // Risk inquiry
  if (/risk|loss|danger|धोका|जोखिम|नुकसान|घट/i.test(clean)) {
    return INTENTS.RISK_EXPLANATION;
  }

  // Forecast uncertainty / reliability
  if (/reliable|accuracy|interval|prediction interval|confidence|खात्री|अंदाज किती खरा|विश्वसनीय/i.test(clean)) {
    return INTENTS.FORECAST_UNCERTAINTY;
  }

  // Forecast / Future prediction
  if (/forecast|future|tomorrow|next week|predict|कल का|उद्या|भविष्य|अंदाज|पुढे काय/i.test(clean)) {
    return INTENTS.FORECAST;
  }

  // Price history / trend
  if (/trend|history|past|last week|change|changed|वाढले|कमी झाले|बदलाव|इतिहास|मागील/i.test(clean)) {
    return INTENTS.PRICE_HISTORY;
  }

  // Latest price query
  if (/price|rate|cost|भाव|दर|रेट|किंमत/i.test(clean)) {
    return INTENTS.LATEST_PRICE;
  }

  // If entities exist and no other intent matched, default to latest price or follow-up
  const { commodity, mandi } = extractEntities(clean, context);
  if (commodity && mandi) {
    return INTENTS.LATEST_PRICE;
  }

  if (/what about|and for|how about|आणि|और/i.test(clean) && (commodity || mandi)) {
    return INTENTS.LATEST_PRICE;
  }

  return INTENTS.CLARIFICATION;
}
