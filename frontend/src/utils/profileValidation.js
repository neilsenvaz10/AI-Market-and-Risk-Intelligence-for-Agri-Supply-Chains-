import { INDIAN_STATES } from '../constants/profile';

export const EMPTY_PROFILE = {
  fullName: '',
  state: '',
  district: '',
  village: '',
  primaryCrop: '',
  cropQuantity: '',
  quantityUnit: 'quintal',
  preferredLanguage: 'en',
};

const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}\s.'-]*$/u;
const PLACE_RE = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}\s.,'()-]*$/u;
const CROP_RE = /^[\p{L}\p{M}][\p{L}\p{M}\s.'()/-]*$/u;

/** Client-side checks mirroring backend/src/validators/farmer.validator.js */
export function validateProfile(v) {
  const errors = {};
  const name = v.fullName.trim();
  if (!name) errors.fullName = 'Full name is required';
  else if (name.length < 2) errors.fullName = 'Full name must be at least 2 characters';
  else if (name.length > 100) errors.fullName = 'Full name is too long';
  else if (!NAME_RE.test(name)) errors.fullName = 'Use letters only';

  if (!INDIAN_STATES.includes(v.state)) errors.state = 'Please select your state';

  const district = v.district.trim();
  if (!district) errors.district = 'District is required';
  else if (district.length < 2 || district.length > 64 || !PLACE_RE.test(district)) errors.district = 'Enter a valid district name';

  const village = v.village.trim();
  if (village && (village.length < 2 || village.length > 100 || !PLACE_RE.test(village))) {
    errors.village = 'Enter a valid village or town name';
  }

  const crop = v.primaryCrop.trim();
  if (!crop) errors.primaryCrop = 'Primary crop is required';
  else if (crop.length < 2 || crop.length > 64 || !CROP_RE.test(crop)) errors.primaryCrop = 'Enter a valid crop name';

  const qty = String(v.cropQuantity).trim();
  if (!qty) errors.cropQuantity = 'Quantity is required';
  else if (!/^\d+(\.\d{1,2})?$/.test(qty)) errors.cropQuantity = 'Enter a number (up to 2 decimals)';
  else if (Number(qty) <= 0) errors.cropQuantity = 'Quantity must be greater than zero';
  else if (Number(qty) >= 10_000_000) errors.cropQuantity = 'Quantity is too large';

  return errors;
}

export function toPayload(v) {
  return {
    fullName: v.fullName.trim(),
    state: v.state,
    district: v.district.trim(),
    village: v.village.trim() || null,
    primaryCrop: v.primaryCrop.trim(),
    cropQuantity: Number(v.cropQuantity),
    quantityUnit: v.quantityUnit,
    preferredLanguage: v.preferredLanguage,
  };
}
