/**
 * Intent classifier and entity extraction for the FASALYTICS Copilot.
 * Understands English, Hindi (Devanagari / Hinglish) and Marathi.
 *
 * This layer only decides WHAT data to look up (price, trend, forecast, ...). It never
 * decides what to say: the language model writes the conversation, and anything it cannot
 * classify (small talk, farming questions, vague requests) simply gets no retrieved data.
 *
 * Matching is Unicode aware. JavaScript's \b only knows ASCII word characters, so it never
 * fires next to Devanagari; instead every pattern is bounded by "not a letter or combining
 * mark" lookarounds. Devanagari STEMS may carry inflection (कांद्याचा, गव्हाचा), whole WORDS
 * may not (so आम "mango" does not match आमच्या "our").
 */

export const INTENTS = {
  LATEST_PRICE: 'LATEST_PRICE',
  PRICE_HISTORY: 'PRICE_HISTORY',
  FORECAST: 'FORECAST',
  FORECAST_UNCERTAINTY: 'FORECAST_UNCERTAINTY',
  SELL_TIMING: 'SELL_TIMING',
  RISK_EXPLANATION: 'RISK_EXPLANATION',
  RECOMMENDATION_EXPLANATION: 'RECOMMENDATION_EXPLANATION',
  MARKET_EDUCATION: 'MARKET_EDUCATION',
  GENERAL_GREETING: 'GENERAL_GREETING',
  CLARIFICATION: 'CLARIFICATION',
};

const LETTER = '[\\p{L}\\p{M}]';
const START = `(?<!${LETTER})`;
const END = `(?!${LETTER})`;

/** words: exact tokens (regex source allowed); stems: prefixes that may take a suffix. */
function matcher({ words = [], stems = [] }) {
  const parts = [];
  if (words.length) parts.push(`${START}(?:${words.join('|')})${END}`);
  if (stems.length) parts.push(`${START}(?:${stems.join('|')})${LETTER}*`);
  return new RegExp(parts.join('|'), 'iu');
}

/**
 * Crops a farmer may mention. `canonical` is the English commodity name used to look the
 * crop up in the database; a crop recognised here but missing from the database is
 * reported honestly as "no price data yet" instead of being ignored.
 */
export const CROPS = [
  { canonical: 'Onion', test: matcher({ words: ['onions?', 'kand(?:a|e)', 'pyaa?z', 'प्याज', 'कांदा', 'कांदे'], stems: ['प्याज', 'कांद'] }) },
  { canonical: 'Tomato', test: matcher({ words: ['tomato(?:es)?', 'tamatar'], stems: ['टमाटर', 'टमाटो', 'टोमॅटो', 'टोमॅटो'] }) },
  // Must come before Potato so "sweet potato" is never read as potato.
  { canonical: 'Sweet Potato', test: matcher({ words: ['sweet[ ]+potato(?:es)?', 'shakarkand'], stems: ['रताळ', 'शकरकंद'] }) },
  { canonical: 'Potato', test: matcher({ words: ['potato(?:es)?', 'aa?loo', 'batata'], stems: ['आलू', 'बटाट'] }) },
  { canonical: 'Wheat', test: matcher({ words: ['wheat', 'gehu?n', 'gahu', 'गहू'], stems: ['गेहूं', 'गेहूँ', 'गेहू', 'गव्हा'] }) },
  { canonical: 'Soybean', test: matcher({ words: ['soy(?:a)?beans?'], stems: ['सोयाबी'] }) },
  { canonical: 'Cotton', test: matcher({ words: ['cotton', 'kapas', 'kapus'], stems: ['कपास', 'कापूस', 'कापस'] }) },
  { canonical: 'Rice', test: matcher({ words: ['rice', 'paddy', 'chawal', 'भात'], stems: ['चावल', 'धान', 'तांदूळ', 'भाताच'] }) },
  { canonical: 'Maize', test: matcher({ words: ['maize', 'corn', 'makka', 'मका'], stems: ['मक्का', 'मक्या'] }) },
  { canonical: 'Gram', test: matcher({ words: ['gram', 'chana', 'chickpeas?', 'चना'], stems: ['हरभर'] }) },
  { canonical: 'Tur', test: matcher({ words: ['tur', 'arhar', 'तूर'], stems: ['अरहर', 'तूरी'] }) },
  { canonical: 'Garlic', test: matcher({ words: ['garlic', 'lasun'], stems: ['लहसुन', 'लसूण'] }) },
  { canonical: 'Ginger', test: matcher({ words: ['ginger', 'adrak'], stems: ['अदरक'] }) },
  { canonical: 'Green Chilli', test: matcher({ words: ['chill?i(?:es)?', 'mirchi'], stems: ['मिर्च', 'मिरच'] }) },
  { canonical: 'Sugarcane', test: matcher({ words: ['sugarcane', 'ganna'], stems: ['गन्ना', 'ऊस'] }) },
  { canonical: 'Banana', test: matcher({ words: ['bananas?', 'kela'], stems: ['केला', 'केळ'] }) },
  { canonical: 'Grapes', test: matcher({ words: ['grapes?', 'angur'], stems: ['अंगूर', 'द्राक्ष'] }) },
  { canonical: 'Pomegranate', test: matcher({ words: ['pomegranates?', 'anar'], stems: ['अनार', 'डाळिंब'] }) },
  { canonical: 'Cauliflower', test: matcher({ words: ['cauliflower'], stems: ['फूलगोभी', 'फुलकोबी', 'फ्लॉवर'] }) },
  { canonical: 'Cabbage', test: matcher({ words: ['cabbage'], stems: ['पत्ता\\s*गोभी', 'पत्ताकोबी', 'कोबी'] }) },
  { canonical: 'Brinjal', test: matcher({ words: ['brinjal', 'eggplant', 'baingan'], stems: ['बैंगन', 'वांग'] }) },
  { canonical: 'Okra', test: matcher({ words: ['okra', 'bhindi', 'ladies?\\s*finger'], stems: ['भिंडी', 'भेंडी'] }) },
  { canonical: 'Turmeric', test: matcher({ words: ['turmeric', 'haldi'], stems: ['हल्दी', 'हळद'] }) },
  { canonical: 'Groundnut', test: matcher({ words: ['groundnut', 'peanuts?', 'mungfali'], stems: ['मूंगफली', 'शेंगदाण', 'भुईमूग'] }) },
  { canonical: 'Jowar', test: matcher({ words: ['jowar', 'sorghum'], stems: ['ज्वार'] }) },
  { canonical: 'Bajra', test: matcher({ words: ['bajra', 'pearl\\s*millet'], stems: ['बाजर'] }) },
  { canonical: 'Mustard', test: matcher({ words: ['mustard', 'sarson'], stems: ['सरसों', 'सरसो', 'मोहरी'] }) },
  { canonical: 'Orange', test: matcher({ words: ['oranges?', 'santra'], stems: ['संतर', 'संत्र'] }) },
  { canonical: 'Mango', test: matcher({ words: ['mango(?:es)?', 'aam', 'आम'], stems: ['आंब'] }) },
];

// Static fallback place list (the database place list is preferred when available).
const PLACES = [
  { canonical: 'Nashik', test: matcher({ words: ['nashik', 'nasik'], stems: ['नाशिक', 'नासिक'] }) },
  { canonical: 'Pune', test: matcher({ words: ['pune', 'पुणे'], stems: ['पुण्या'] }) },
  { canonical: 'Lasalgaon', test: matcher({ words: ['lasalgaon'], stems: ['लासलगाव', 'लासलगांव'] }) },
  { canonical: 'Mumbai', test: matcher({ words: ['mumbai'], stems: ['मुंबई'] }) },
  { canonical: 'Nagpur', test: matcher({ words: ['nagpur'], stems: ['नागपूर', 'नागपुर'] }) },
  { canonical: 'Solapur', test: matcher({ words: ['solapur'], stems: ['सोलापूर', 'सोलापुर'] }) },
  { canonical: 'Kolhapur', test: matcher({ words: ['kolhapur'], stems: ['कोल्हापूर', 'कोल्हापुर'] }) },
  { canonical: 'Ahmednagar', test: matcher({ words: ['ahmednagar', 'ahmadnagar'], stems: ['अहमदनगर'] }) },
  { canonical: 'Baramati', test: matcher({ words: ['baramati'], stems: ['बारामती'] }) },
  { canonical: 'Azadpur', test: matcher({ words: ['azadpur'], stems: ['आज़ादपुर', 'आजादपुर'] }) },
  { canonical: 'Delhi', test: matcher({ words: ['delhi'], stems: ['दिल्ली'] }) },
  { canonical: 'Indore', test: matcher({ words: ['indore'], stems: ['इंदौर', 'इंदूर'] }) },
];

/** Canonical English name of the first crop found in the text, or null. */
export function detectCrop(text = '') {
  const clean = String(text || '');
  return CROPS.find((crop) => crop.test.test(clean))?.canonical ?? null;
}

export function detectStaticPlace(text = '') {
  const clean = String(text || '');
  return PLACES.find((place) => place.test.test(clean))?.canonical ?? null;
}

const DAY_AFTER = matcher({ words: ['day after tomorrow'], stems: ['परसों', 'परसो', 'परवा'] });
const TOMORROW = matcher({ words: ['tomorrow', 'कल'], stems: ['उद्या'] });
const N_DAYS = new RegExp(`${START}([1-7])\\s*(?:-\\s*)?(?:days?|दिन|दिवस)${END}`, 'iu');

/** How many days ahead the farmer asks about (1-7). Week-long questions return null: all horizons are shown. */
export function extractHorizon(text = '') {
  const clean = String(text || '');
  if (DAY_AFTER.test(clean)) return 2;
  const explicit = clean.match(N_DAYS);
  if (explicit) return Number(explicit[1]);
  if (TOMORROW.test(clean)) return 1;
  return null;
}

export function extractEntities(text = '', previousContext = {}) {
  const clean = String(text || '').trim();
  let commodity = detectCrop(clean);
  let mandi = detectStaticPlace(clean);
  const horizon = extractHorizon(clean);

  // A follow-up that omits the crop or place inherits it from the conversation so far.
  if (!commodity && previousContext?.commodity) commodity = previousContext.commodity;
  if (!mandi && previousContext?.mandi) mandi = previousContext.mandi;

  return { commodity, mandi, horizon };
}

const GREETING = new RegExp(`^\\s*(?:hi|hello|hey|namaste|namaskar|good\\s+(?:morning|afternoon|evening)|नमस्ते|नमस्कार|हॅलो|हेलो|राम राम|जय किसान)${END}`, 'iu');
const SMALL_TALK = matcher({
  words: ['how are you', 'who are you', 'what can you do', 'what do you do', 'help me', 'thank you', 'thanks', 'bye', 'goodbye', 'tell me about yourself'],
  stems: ['आप कौन', 'तुम कौन', 'आप क्या कर', 'कैसे हैं', 'कसे आहात', 'तुम्ही कोण', 'धन्यवाद', 'आभार', 'शुक्रिया'],
});
const PRICE = matcher({
  words: ['prices?', 'rates?', 'cost', 'worth', 'how much', 'going for', 'selling at', 'bhaa?v', 'mandi bhaa?v', 'दर', 'रेट', 'किती', 'कितना', 'कितने'],
  stems: ['भाव', 'किंमत', 'कीमत', 'बाजारभाव'],
});
const HISTORY = matcher({
  words: ['trends?', 'history', 'past', 'last week', 'last month', 'previous', 'chang(?:e|es|ed|ing)', 'how has', 'moved', 'compare'],
  stems: ['इतिहास', 'पिछले', 'मागील', 'गेल्या', 'बदलाव', 'बदल', 'वाढले', 'कमी झाले', 'ट्रेंड'],
});
const FORECAST = matcher({
  words: ['forecasts?', 'predict(?:s|ed|ion|ions)?', 'future', 'tomorrow', 'next week', 'next few days', 'expected', 'go up', 'go down', 'rise', 'fall', 'drop', 'कल'],
  stems: ['उद्या', 'अनुमान', 'पूर्वानुमान', 'भविष्य', 'अंदाज', 'पुढे', 'बढ़ेगा', 'घटेगा', 'वाढेल', 'कमी होईल', 'अगले'],
});
const UNCERTAINTY = matcher({
  words: ['reliable', 'accuracy', 'accurate', 'interval', 'confidence', 'how sure', 'trust'],
  stems: ['विश्वसनीय', 'भरोसा', 'खात्री', 'कितना सही', 'किती खरा'],
});
const SELL = matcher({
  words: ['should i (?:sell|wait|hold|store)', 'sell (?:now|today|this week)', 'when (?:to|should i) sell', 'good time to sell', 'right time', 'hold (?:on|my)', 'wait (?:or|for)', 'store (?:or|my)'],
  stems: ['बेचूं', 'बेचूँ', 'बेचना', 'बेच दूं', 'कब बेच', 'रुकूं', 'रुकना', 'विकू', 'विकावा', 'कधी विक', 'थांबू', 'थांबावे'],
});
const RISK = matcher({
  words: ['risks?', 'risky', 'loss(?:es)?', 'danger(?:s|ous)?', 'volatile', 'volatility', 'crash(?:es)?'],
  stems: ['जोखिम', 'जोखीम', 'धोका', 'नुकसान', 'घाटा', 'तोटा'],
});
const RECOMMEND = matcher({
  words: ['recommend(?:s|ed|ation|ations)?', 'best mandi', 'which mandi', 'where (?:should|can) i sell', 'better (?:mandi|market)', 'transport(?:ation)?', 'freight', 'net return', 'profit'],
  stems: ['वाहतूक', 'भाड', 'ढुलाई', 'मुनाफा', 'नफा', 'कहाँ बेच', 'कहां बेच', 'कोणत्या बाजारात', 'कुठे विक', 'कौन सी मंडी', 'सबसे अच्छी मंडी'],
});
const EDUCATION = new RegExp(
  `(?:what (?:is|are|does) (?:a |an |the )?(?:msp|apmc|mandi|modal price|prediction interval|arrivals?))|(?:(?:msp|apmc|modal price|एमएसपी|एपीएमसी|मोडल|मॉडल|हमीभाव|आवक).*(?:म्हणजे काय|क्या है|क्या होता|क्या होती|काय असते|meaning))|(?:explain (?:msp|apmc|modal|interval))`,
  'iu',
);
const FOLLOW_UP = new RegExp(`^\\s*(?:(?:what|how) about|and (?:for|in|at)|also|then|आणि|और|तो|मग|तसेच)${END}`, 'iu');

export function classifyIntent(text = '', context = {}) {
  const clean = String(text || '').trim();
  const { commodity, mandi } = extractEntities(clean, context);

  if (EDUCATION.test(clean)) return INTENTS.MARKET_EDUCATION;
  if (RECOMMEND.test(clean)) return INTENTS.RECOMMENDATION_EXPLANATION;
  if (UNCERTAINTY.test(clean) && (FORECAST.test(clean) || /interval|अंदाज|खात्री/i.test(clean))) return INTENTS.FORECAST_UNCERTAINTY;
  if (SELL.test(clean)) return INTENTS.SELL_TIMING;
  if (RISK.test(clean)) return INTENTS.RISK_EXPLANATION;
  if (FORECAST.test(clean)) return INTENTS.FORECAST;
  if (HISTORY.test(clean)) return INTENTS.PRICE_HISTORY;
  if (PRICE.test(clean)) return INTENTS.LATEST_PRICE;

  // A bare crop or place ("onion?", "tomatoes in Pune", "what about Nashik") is a price question.
  // Longer sentences that merely mention a crop ("my onion leaves are turning yellow") are not.
  const shortMessage = clean.split(/\s+/).filter(Boolean).length <= 4;
  if ((shortMessage && (detectCrop(clean) || detectStaticPlace(clean))) || (FOLLOW_UP.test(clean) && (commodity || mandi))) return INTENTS.LATEST_PRICE;

  // Greetings and small talk only when nothing above matched, so "hi, onion price?" stays a price question.
  if (GREETING.test(clean) || SMALL_TALK.test(clean)) return INTENTS.GENERAL_GREETING;

  return INTENTS.CLARIFICATION;
}
