// Must match backend/src/validators/farmer.validator.js INDIAN_STATES
export const INDIAN_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar',
  'Chandigarh', 'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa',
  'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka',
  'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
];

// Suggestions only — farmers may type any crop name.
export const COMMON_CROPS = [
  'Onion', 'Tomato', 'Potato', 'Soybean', 'Cotton', 'Wheat', 'Paddy', 'Maize', 'Jowar',
  'Bajra', 'Tur (Arhar)', 'Gram (Chana)', 'Moong', 'Urad', 'Groundnut', 'Mustard',
  'Sugarcane', 'Grapes', 'Pomegranate', 'Banana', 'Orange', 'Chilli', 'Turmeric', 'Garlic',
];

export const QUANTITY_UNITS = [
  { value: 'quintal', label: 'Quintal' },
  { value: 'kg', label: 'kg' },
];

export const formatQuantity = (quantity, unit, language = 'en') => {
  const num = Number(quantity).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  if (language === 'mr' || language === 'hi') {
    return `${num} ${unit === 'kg' ? 'किलो' : 'क्विंटल'}`;
  }
  return `${num} ${unit === 'kg' ? 'kg' : 'quintal'}`;
};

const CROP_TRANSLATIONS = {
  mr: {
    'onion': 'कांदा',
    'tomato': 'टोमॅटो',
    'potato': 'बटाटा',
    'soybean': 'सोयाबीन',
    'cotton': 'कापूस',
    'wheat': 'गहू',
    'paddy': 'भात (धान)',
    'maize': 'मका',
    'jowar': 'ज्वारी',
    'bajra': 'बाजरी',
    'tur (arhar)': 'तूर',
    'tur': 'तूर',
    'arhar': 'तूर',
    'gram (chana)': 'हरभरा (चना)',
    'gram': 'हरभरा',
    'chana': 'हरभरा (चना)',
    'moong': 'मूग',
    'urad': 'उडीद',
    'groundnut': 'भुईमूग',
    'mustard': 'मोहरी',
    'sugarcane': 'ऊस',
    'grapes': 'द्राक्षे',
    'pomegranate': 'डाळिंब',
    'banana': 'केळी',
    'orange': 'संत्री',
    'chilli': 'मिरची',
    'turmeric': 'हळद',
    'garlic': 'लसूण',
  },
  hi: {
    'onion': 'प्याज',
    'tomato': 'टमाटर',
    'potato': 'आलू',
    'soybean': 'सोयाबीन',
    'cotton': 'कपास',
    'wheat': 'गेहूं',
    'paddy': 'धान',
    'maize': 'मक्का',
    'jowar': 'ज्वार',
    'bajra': 'बाजरा',
    'tur (arhar)': 'अरहर (तूर)',
    'tur': 'तूर',
    'arhar': 'अरहर',
    'gram (chana)': 'चना',
    'gram': 'चना',
    'chana': 'चना',
    'moong': 'मूंग',
    'urad': 'उड़द',
    'groundnut': 'मूंगफली',
    'mustard': 'सरसों',
    'sugarcane': 'गन्ना',
    'grapes': 'अंगूर',
    'pomegranate': 'अनार',
    'banana': 'केला',
    'orange': 'संतरा',
    'chilli': 'मिर्च',
    'turmeric': 'हल्दी',
    'garlic': 'लहसुन',
  },
};

export const translateCrop = (crop, language = 'en') => {
  if (!crop) return '';
  const key = String(crop).trim().toLowerCase();
  if (CROP_TRANSLATIONS[language]?.[key]) {
    return CROP_TRANSLATIONS[language][key];
  }
  return crop;
};

const LOCATION_MAP = {
  mr: {
    'goa': 'गोवा',
    'panjim': 'पणजी',
    'panaji': 'पणजी',
    'maharashtra': 'महाराष्ट्र',
    'pune': 'पुणे',
    'nashik': 'नाशिक',
    'ahmednagar': 'अहमदनगर',
    'baramati': 'बारामती',
    'solapur': 'सोलापूर',
    'kolhapur': 'कोल्हापूर',
    'satara': 'सातारा',
    'sangli': 'सांगली',
    'aurangabad': 'छत्रपती संभाजीनगर (औरंगाबाद)',
    'chhatrapati sambhajinagar': 'छत्रपती संभाजीनगर',
    'nagpur': 'नागपूर',
    'amravati': 'अमरावती',
    'akola': 'अकोला',
    'latur': 'लातूर',
    'jalgaon': 'जळगाव',
    'dhule': 'धुळे',
    'nanded': 'नांदेड',
    'gujarat': 'गुजरात',
    'karnataka': 'कर्नाटक',
    'madhya pradesh': 'मध्य प्रदेश',
  },
  hi: {
    'goa': 'गोवा',
    'panjim': 'पणजी',
    'panaji': 'पणजी',
    'maharashtra': 'महाराष्ट्र',
    'pune': 'पुणे',
    'nashik': 'नासिक',
    'ahmednagar': 'अहमदनगर',
    'baramati': 'बारामती',
    'solapur': 'सोलापुर',
    'kolhapur': 'कोल्हापुर',
    'satara': 'सतारा',
    'sangli': 'सांगली',
    'aurangabad': 'औरंगाबाद',
    'nagpur': 'नागपुर',
    'amravati': 'अमरावती',
    'latur': 'लातूर',
    'jalgaon': 'जलगांव',
    'gujarat': 'गुजरात',
    'karnataka': 'कर्नाटक',
    'madhya pradesh': 'मध्य प्रदेश',
  },
};

export const translateLocation = (locationStr, language = 'en') => {
  if (!locationStr || language === 'en') return locationStr;
  const map = LOCATION_MAP[language];
  if (!map) return locationStr;

  return locationStr
    .split(',')
    .map((part) => {
      const clean = part.trim();
      const lower = clean.toLowerCase();
      return map[lower] || clean;
    })
    .join(', ');
};

export const formatPhone = (e164) =>
  e164 && /^\+91\d{10}$/.test(e164) ? `+91 ${e164.slice(3, 8)} ${e164.slice(8)}` : e164 || '';

