/**
 * Base abstract class for Mandi Data Providers
 */
export class BaseMandiProvider {
  constructor(name) {
    if (!name) throw new Error('Provider name is required');
    this.name = name;
  }

  getName() {
    return this.name;
  }

  /**
   * Fetches raw mandi price and arrival records
   * @param {Object} options - { state, commodity, date, limit }
   * @returns {Promise<Array<Object>>}
   */
  async fetchRecords(options = {}) {
    throw new Error(`fetchRecords() must be implemented by ${this.name}`);
  }
}

export default BaseMandiProvider;
