/**
 * Mandi Data Validator
 * Enforces data quality, structural integrity, and agricultural market bounds.
 */

export function validateMandiRecord(record) {
  const errors = [];

  if (!record || typeof record !== 'object') {
    return { valid: false, errors: ['Record must be a valid non-null object'] };
  }

  // 1. Mandatory Identity Fields
  if (!record.mandi_name || typeof record.mandi_name !== 'string' || !record.mandi_name.trim()) {
    errors.push('Missing or invalid mandi_name');
  }

  if (!record.commodity_name || typeof record.commodity_name !== 'string' || !record.commodity_name.trim()) {
    errors.push('Missing or invalid commodity_name');
  }

  // 2. Date Validation
  if (!record.price_date) {
    errors.push('Missing price_date');
  } else {
    const parsedDate = new Date(record.price_date);
    if (isNaN(parsedDate.getTime())) {
      errors.push(`Invalid price_date format: "${record.price_date}"`);
    } else {
      // Allow up to 1 day in future for timezone drift
      const maxAllowed = new Date();
      maxAllowed.setDate(maxAllowed.getDate() + 1);
      if (parsedDate > maxAllowed) {
        errors.push(`price_date cannot be in the future: "${record.price_date}"`);
      }
    }
  }

  // 3. Price Validation & Cross-field Consistency
  const minPrice = Number(record.min_price);
  const maxPrice = Number(record.max_price);
  const modalPrice = Number(record.modal_price);

  if (isNaN(minPrice) || minPrice <= 0) {
    errors.push(`min_price must be a positive number, got: ${record.min_price}`);
  }

  if (isNaN(maxPrice) || maxPrice <= 0) {
    errors.push(`max_price must be a positive number, got: ${record.max_price}`);
  }

  if (isNaN(modalPrice) || modalPrice <= 0) {
    errors.push(`modal_price must be a positive number, got: ${record.modal_price}`);
  }

  if (!isNaN(minPrice) && !isNaN(maxPrice) && minPrice > maxPrice) {
    errors.push(`min_price (${minPrice}) cannot exceed max_price (${maxPrice})`);
  }

  if (!isNaN(minPrice) && !isNaN(maxPrice) && !isNaN(modalPrice)) {
    if (modalPrice < minPrice || modalPrice > maxPrice) {
      errors.push(`modal_price (${modalPrice}) must fall between min_price (${minPrice}) and max_price (${maxPrice})`);
    }
  }

  // 4. Quantity / Arrivals Validation
  if (record.arrivals_quantity !== undefined && record.arrivals_quantity !== null) {
    const arrivals = Number(record.arrivals_quantity);
    if (isNaN(arrivals) || arrivals < 0) {
      errors.push(`arrivals_quantity must be a non-negative number, got: ${record.arrivals_quantity}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export default { validateMandiRecord };
