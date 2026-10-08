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

export const formatQuantity = (quantity, unit) =>
  `${Number(quantity).toLocaleString('en-IN', { maximumFractionDigits: 2 })} ${unit === 'kg' ? 'kg' : 'quintal'}`;

export const formatPhone = (e164) =>
  e164 && /^\+91\d{10}$/.test(e164) ? `+91 ${e164.slice(3, 8)} ${e164.slice(8)}` : e164 || '';
