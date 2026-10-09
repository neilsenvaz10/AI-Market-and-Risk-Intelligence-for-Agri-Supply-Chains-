/**
 * Deterministic answers built only from retrieved data. Used when the language model is
 * unavailable, or when its reply invented numbers and was rejected. These are plain,
 * honest statements, not a script: they say exactly what the data says, how old it is and
 * what is not available.
 */
import { INTENTS } from './intentClassifier.js';

const MONTHS = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  hi: ['जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर'],
  mr: ['जानेवारी', 'फेब्रुवारी', 'मार्च', 'एप्रिल', 'मे', 'जून', 'जुलै', 'ऑगस्ट', 'सप्टेंबर', 'ऑक्टोबर', 'नोव्हेंबर', 'डिसेंबर'],
};

/** "2026-10-08" -> "8 October 2026" (or the Hindi / Marathi month name). */
export function formatDate(iso, language = 'en') {
  const match = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(iso ?? '');
  const months = MONTHS[language] || MONTHS.en;
  return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}`;
}

const rupees = (n) => (n === null || n === undefined ? null : String(Number(n)));

const T = {
  en: {
    greeting: "Hello! I'm the Fasalytics assistant. I can tell you the latest reported mandi prices and, where available, price trends and forecasts. Which crop and market would you like to know about?",
    askCrop: 'Which crop and market would you like to know about? For example: onion price in Nashik.',
    crops: (list) => (list.length ? ` I currently have price data for ${list.join(', ')}.` : ''),
    unsupportedCrop: (crop) => `I don't have price data for ${crop} yet.`,
    noPrice: (crop, where) => `I don't have a reported price for ${crop}${where ? ` in ${where}` : ''} right now.`,
    sampleOnly: 'Only synthetic test data exists for this selection, so I have no real report to show.',
    at: (mandi, district) => (district && !String(mandi).includes(district) ? `${mandi} (${district})` : mandi),
    price: ({ crop, where, modal, range, date, variety }) => `The latest reported modal price for ${crop}${variety ? ` (${variety})` : ''} at ${where} is ${modal} rupees per quintal${range}, as of ${date}.`,
    range: (min, max) => `, with a range of ${min} to ${max} rupees`,
    old: (days) => ` That report is ${days} days old, so it may not match today's price.`,
    districtList: (crop, district, items) => `Latest reported ${crop} prices in ${district}: ${items.join('; ')}.`,
    item: ({ mandi, modal, date }) => `${mandi} ${modal} rupees per quintal on ${date}`,
    others: (items) => ` Other markets: ${items.join('; ')}.`,
    source: (name) => ` Source: ${name}.`,
    trend: ({ crop, where, count, oldest, latest, pct, end }) => `Over the last ${count} reporting days at ${where}, ${crop} moved from ${oldest} to ${latest} rupees per quintal (${pct} percent), as of ${end}.`,
    noTrend: (crop, where) => `I don't have enough price history to describe a trend for ${crop}${where ? ` in ${where}` : ''}.`,
    forecast: ({ crop, where, price, date, low, high, level }) => `The model forecast for ${crop} at ${where} is ${price} rupees per quintal for ${date}, with a likely range of ${low} to ${high} rupees${level ? ` (${level} percent prediction interval)` : ''}. This is an estimate, not a guaranteed price.`,
    noForecast: (crop, where) => `I don't have a forecast for ${crop}${where ? ` at ${where}` : ''}.`,
    sell: ' I cannot tell you for certain whether to sell now or wait, because prices can move either way. The decision is yours.',
    recommendation: "I can't recommend a particular mandi yet. That feature isn't available, and I don't make up transport costs or profits.",
    risk: "A risk assessment isn't available yet, so I can't give a risk level. I won't make one up.",
    assumed: (crop, district) => `I used your profile (${[crop, district].filter(Boolean).join(', ')}). `,
    noContext: 'I can chat about mandi prices and trends. Tell me a crop and a market, and I will look up what has been reported.',
    noMarket: (name) => `I don't have a market called ${name} in my list. `,
  },
  hi: {
    greeting: 'नमस्ते! मैं फसालिटिक्स सहायक हूँ। मैं मंडी में दर्ज ताज़ा भाव बता सकता हूँ, और जहाँ जानकारी हो वहाँ भाव का रुझान और पूर्वानुमान भी। आप किस फसल और किस मंडी के बारे में जानना चाहते हैं?',
    askCrop: 'आप किस फसल और किस मंडी के बारे में जानना चाहते हैं? उदाहरण: नासिक में प्याज का भाव।',
    crops: (list) => (list.length ? ` अभी मेरे पास ${list.join(', ')} के भाव का डेटा है।` : ''),
    unsupportedCrop: (crop) => `मेरे पास अभी ${crop} के भाव का डेटा नहीं है।`,
    noPrice: (crop, where) => `अभी मेरे पास ${where ? `${where} में ` : ''}${crop} का कोई दर्ज भाव नहीं है।`,
    sampleOnly: 'इस चयन के लिए केवल परीक्षण (कृत्रिम) डेटा है, इसलिए दिखाने के लिए कोई असली रिपोर्ट नहीं है।',
    at: (mandi, district) => (district && !String(mandi).includes(district) ? `${mandi} (${district})` : mandi),
    price: ({ crop, where, modal, range, date, variety }) => `${where} में ${crop}${variety ? ` (${variety})` : ''} का ताज़ा दर्ज मोडल भाव ${modal} रुपये प्रति क्विंटल है${range}, दिनांक ${date}।`,
    range: (min, max) => `, भाव ${min} से ${max} रुपये के बीच रहा`,
    old: (days) => ` यह रिपोर्ट ${days} दिन पुरानी है, इसलिए यह आज का भाव नहीं हो सकता।`,
    districtList: (crop, district, items) => `${district} में ${crop} के ताज़ा दर्ज भाव: ${items.join('; ')}।`,
    item: ({ mandi, modal, date }) => `${mandi} ${modal} रुपये प्रति क्विंटल, दिनांक ${date}`,
    others: (items) => ` अन्य मंडियाँ: ${items.join('; ')}।`,
    source: (name) => ` स्रोत: ${name}।`,
    trend: ({ crop, where, count, oldest, latest, pct, end }) => `${where} में पिछले ${count} दर्ज दिनों में ${crop} का भाव ${oldest} से ${latest} रुपये प्रति क्विंटल हुआ (${pct} प्रतिशत), दिनांक ${end} तक।`,
    noTrend: (crop, where) => `${where ? `${where} में ` : ''}${crop} का रुझान बताने लायक भाव का इतिहास मेरे पास नहीं है।`,
    forecast: ({ crop, where, price, date, low, high, level }) => `${where} में ${crop} का मॉडल पूर्वानुमान ${date} के लिए ${price} रुपये प्रति क्विंटल है, संभावित सीमा ${low} से ${high} रुपये${level ? ` (${level} प्रतिशत अनुमान सीमा)` : ''}। यह केवल अनुमान है, पक्का भाव नहीं।`,
    noForecast: (crop, where) => `${where ? `${where} में ` : ''}${crop} का पूर्वानुमान मेरे पास नहीं है।`,
    sell: ' मैं पक्का नहीं कह सकता कि अभी बेचना है या रुकना है, क्योंकि भाव दोनों तरफ जा सकते हैं। फैसला आपका है।',
    recommendation: 'मैं अभी किसी खास मंडी की सिफ़ारिश नहीं कर सकता। यह सुविधा उपलब्ध नहीं है, और मैं परिवहन खर्च या मुनाफ़ा अपने मन से नहीं बनाता।',
    risk: 'जोखिम का आकलन अभी उपलब्ध नहीं है, इसलिए मैं जोखिम स्तर नहीं बता सकता। मैं अंदाज़े से नहीं बताऊँगा।',
    assumed: (crop, district) => `मैंने आपकी प्रोफ़ाइल (${[crop, district].filter(Boolean).join(', ')}) का उपयोग किया है। `,
    noContext: 'मैं मंडी भाव और रुझान पर बात कर सकता हूँ। कोई फसल और मंडी बताइए, मैं देखूँगा कि क्या दर्ज हुआ है।',
    noMarket: (name) => `मेरी सूची में ${name} नाम की कोई मंडी नहीं है। `,
  },
  mr: {
    greeting: 'नमस्कार! मी फसालिटिक्स सहाय्यक आहे. मी बाजारात नोंदवलेले ताजे भाव सांगू शकतो, तसेच उपलब्ध असल्यास भावाचा कल आणि अंदाज. तुम्हाला कोणत्या पिकाबद्दल आणि कोणत्या बाजाराबद्दल जाणून घ्यायचे आहे?',
    askCrop: 'तुम्हाला कोणत्या पिकाबद्दल आणि कोणत्या बाजाराबद्दल जाणून घ्यायचे आहे? उदाहरण: नाशिकमधील कांद्याचा भाव.',
    crops: (list) => (list.length ? ` सध्या माझ्याकडे ${list.join(', ')} च्या भावाची माहिती आहे.` : ''),
    unsupportedCrop: (crop) => `माझ्याकडे अजून ${crop} च्या भावाची माहिती नाही.`,
    noPrice: (crop, where) => `सध्या माझ्याकडे ${where ? `${where} येथील ` : ''}${crop} चा नोंदवलेला भाव नाही.`,
    sampleOnly: 'या निवडीसाठी फक्त चाचणी (कृत्रिम) माहिती आहे, म्हणून दाखवण्यासाठी खरा अहवाल नाही.',
    at: (mandi, district) => (district && !String(mandi).includes(district) ? `${mandi} (${district})` : mandi),
    price: ({ crop, where, modal, range, date, variety }) => `${where} येथे ${crop}${variety ? ` (${variety})` : ''} चा ताजा नोंदवलेला मोडल भाव ${modal} रुपये प्रति क्विंटल आहे${range}, दिनांक ${date}.`,
    range: (min, max) => `, भाव ${min} ते ${max} रुपयांदरम्यान होता`,
    old: (days) => ` हा अहवाल ${days} दिवस जुना आहे, त्यामुळे तो आजचा भाव नसू शकतो.`,
    districtList: (crop, district, items) => `${district} मधील ${crop} चे ताजे नोंदवलेले भाव: ${items.join('; ')}.`,
    item: ({ mandi, modal, date }) => `${mandi} ${modal} रुपये प्रति क्विंटल, दिनांक ${date}`,
    others: (items) => ` इतर बाजार: ${items.join('; ')}.`,
    source: (name) => ` स्रोत: ${name}.`,
    trend: ({ crop, where, count, oldest, latest, pct, end }) => `${where} येथे मागील ${count} नोंदवलेल्या दिवसांत ${crop} चा भाव ${oldest} वरून ${latest} रुपये प्रति क्विंटल झाला (${pct} टक्के), दिनांक ${end} पर्यंत.`,
    noTrend: (crop, where) => `${where ? `${where} येथील ` : ''}${crop} चा कल सांगण्याइतका भावाचा इतिहास माझ्याकडे नाही.`,
    forecast: ({ crop, where, price, date, low, high, level }) => `${where} येथे ${crop} चा मॉडेल अंदाज ${date} साठी ${price} रुपये प्रति क्विंटल आहे, संभाव्य श्रेणी ${low} ते ${high} रुपये${level ? ` (${level} टक्के अंदाज श्रेणी)` : ''}. हा फक्त अंदाज आहे, निश्चित भाव नाही.`,
    noForecast: (crop, where) => `${where ? `${where} येथील ` : ''}${crop} चा अंदाज माझ्याकडे नाही.`,
    sell: ' आत्ता विकावे की थांबावे हे मी खात्रीने सांगू शकत नाही, कारण भाव कोणत्याही दिशेने जाऊ शकतात. निर्णय तुमचा आहे.',
    recommendation: 'मी सध्या एखाद्या विशिष्ट बाजाराची शिफारस करू शकत नाही. ही सुविधा उपलब्ध नाही, आणि मी वाहतूक खर्च किंवा नफा स्वतःहून तयार करत नाही.',
    risk: 'जोखमीचे मूल्यमापन सध्या उपलब्ध नाही, त्यामुळे मी जोखीम पातळी सांगू शकत नाही. मी अंदाजाने सांगणार नाही.',
    assumed: (crop, district) => `मी तुमची प्रोफाइल (${[crop, district].filter(Boolean).join(', ')}) वापरली आहे. `,
    noContext: 'मी बाजारभाव आणि कलाबद्दल बोलू शकतो. एखादे पीक आणि बाजार सांगा, मी काय नोंदवले आहे ते पाहतो.',
    noMarket: (name) => `माझ्या यादीत ${name} नावाचा बाजार नाही. `,
  },
};

const localCrop = (commodity, language, fallback) => {
  if (language === 'hi' && commodity?.hindi_name) return commodity.hindi_name;
  if (language === 'mr' && commodity?.marathi_name) return commodity.marathi_name;
  return commodity?.name || fallback || '';
};

function priceSentences(t, language, crop, marketData, place) {
  const where = t.at(marketData.mandiName, marketData.district);
  const range = marketData.minPrice != null && marketData.maxPrice != null ? t.range(rupees(marketData.minPrice), rupees(marketData.maxPrice)) : '';
  let out = t.price({
    crop, where, modal: rupees(marketData.modalPrice), range, date: formatDate(marketData.priceDate, language), variety: marketData.variety,
  });
  if (marketData.isStale) out += t.old(marketData.ageDays);
  if (marketData.scope === 'district' && marketData.alternatives?.length) {
    const items = [marketData, ...marketData.alternatives].map((m) => t.item({ mandi: m.mandiName, modal: rupees(m.modalPrice), date: formatDate(m.priceDate, language) }));
    out = t.districtList(crop, place?.district || marketData.district, items);
    if (marketData.isStale) out += t.old(marketData.ageDays);
  } else if (marketData.scope === 'all' && marketData.alternatives?.length) {
    out += t.others(marketData.alternatives.map((m) => t.item({ mandi: m.mandiName, modal: rupees(m.modalPrice), date: formatDate(m.priceDate, language) })));
  }
  return `${out}${t.source(marketData.source)}`;
}

/**
 * @param {object} p
 * @param {string} p.language en | hi | mr
 * @param {string} p.intent one of INTENTS
 * @param {object} p.commodity resolved commodity row (or null)
 * @param {object} p.retrieved { marketData, trendData, forecastData, conceptData, recommendationData, riskData, place, unsupportedCrop, supportedCommodities }
 * @param {string[]} p.assumptions e.g. ['commodity_from_profile']
 */
export function deterministicAnswer({ language = 'en', intent, commodity = null, retrieved = {}, assumptions = [], profile = null }) {
  const t = T[language] || T.en;
  const { marketData, trendData, forecastData, conceptData, recommendationData, riskData, place, unsupportedCrop, supportedCommodities = [] } = retrieved;
  const crop = localCrop(commodity, language, unsupportedCrop);
  const where = place?.kind === 'mandi' ? place.mandi.name : place?.district || null;
  const unknown = retrieved.unknownPlace ? t.noMarket(retrieved.unknownPlace) : '';
  const lead = unknown + (assumptions.length && profile ? t.assumed(assumptions.includes('commodity_from_profile') ? profile.primaryCrop : null, assumptions.includes('place_from_profile') ? profile.district : null) : '');

  if (intent === INTENTS.GENERAL_GREETING) return t.greeting;
  if (intent === INTENTS.MARKET_EDUCATION && conceptData) {
    const definition = language === 'hi' ? conceptData.definitionHi : language === 'mr' ? conceptData.definitionMr : conceptData.definition;
    return `${conceptData.term}: ${definition}`;
  }
  if (intent === INTENTS.RECOMMENDATION_EXPLANATION) return t.recommendation;
  if (intent === INTENTS.RISK_EXPLANATION && !marketData?.found) return t.risk;

  if (unsupportedCrop && !commodity) return `${t.unsupportedCrop(unsupportedCrop)}${t.crops(supportedCommodities)}`;
  if (!commodity) return `${t.askCrop}${t.crops(supportedCommodities)}`;

  const parts = [];
  const wantsPrice = [INTENTS.LATEST_PRICE, INTENTS.SELL_TIMING, INTENTS.PRICE_HISTORY, INTENTS.FORECAST, INTENTS.FORECAST_UNCERTAINTY, INTENTS.RISK_EXPLANATION, INTENTS.CLARIFICATION].includes(intent);

  if (marketData?.found && wantsPrice && ![INTENTS.PRICE_HISTORY].includes(intent)) parts.push(priceSentences(t, language, crop, marketData, place));
  else if (marketData && !marketData.found && [INTENTS.LATEST_PRICE, INTENTS.SELL_TIMING].includes(intent)) {
    parts.push(marketData.sampleOnly ? `${t.noPrice(crop, where)} ${t.sampleOnly}` : t.noPrice(crop, where));
  }

  if ([INTENTS.PRICE_HISTORY, INTENTS.SELL_TIMING, INTENTS.RISK_EXPLANATION].includes(intent)) {
    if (trendData?.found) {
      const pct = `${trendData.changePercent > 0 ? '+' : ''}${trendData.changePercent}`;
      parts.push(t.trend({
        crop, where: where || marketData?.mandiName || '', count: trendData.observationCount, oldest: rupees(trendData.oldestModal), latest: rupees(trendData.latestModal), pct, end: formatDate(trendData.endDate, language),
      }));
      if (trendData.isStale && !marketData?.found) parts.push(t.old(trendData.ageDays));
    } else if (intent === INTENTS.PRICE_HISTORY) {
      parts.push(t.noTrend(crop, where));
    }
  }

  if ([INTENTS.FORECAST, INTENTS.FORECAST_UNCERTAINTY, INTENTS.SELL_TIMING].includes(intent)) {
    if (forecastData?.found) {
      const f = forecastData.forecasts[0];
      parts.push(t.forecast({
        crop, where: forecastData.mandi?.name || where || '', price: rupees(f.predictedPrice), date: formatDate(f.forecastDate, language), low: rupees(f.lowerBound), high: rupees(f.upperBound), level: f.intervalLevelPercent,
      }));
    } else if (intent !== INTENTS.SELL_TIMING) {
      parts.push(t.noForecast(crop, where));
    }
  }

  if (intent === INTENTS.SELL_TIMING) parts.push(t.sell.trim());
  if (intent === INTENTS.RISK_EXPLANATION) parts.push(t.risk);
  if (parts.length === 0) return `${t.noContext}${t.crops(supportedCommodities)}`;
  return `${lead}${parts.join(' ')}`.trim();
}
