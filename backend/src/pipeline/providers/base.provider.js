/**
 * Base class for mandi data providers.
 * fetchRecords() returns raw provider records in the shape normalizeMandiRecord() accepts.
 */
export class SourceNotConfiguredError extends Error {
  constructor(source, message) {
    super(message);
    this.name = 'SourceNotConfiguredError';
    this.code = 'SOURCE_NOT_CONFIGURED';
    this.source = source;
  }
}

export class BaseMandiProvider {
  constructor(name) {
    if (!name) throw new Error('Provider name is required');
    this.name = name;
  }

  getName() {
    return this.name;
  }

  /** Source code written to mandi_prices.source. */
  getSourceCode() {
    return this.name;
  }

  isSampleSource() {
    return false;
  }

  // eslint-disable-next-line no-unused-vars
  async fetchRecords(options = {}) {
    throw new Error(`fetchRecords() must be implemented by ${this.name}`);
  }
}

export default BaseMandiProvider;
