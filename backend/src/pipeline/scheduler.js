/**
 * Mandi sync scheduler.
 *
 * Starts only when ALL of these hold:
 *   - MANDI_SYNC_INTERVAL_MINUTES parsed as a valid interval (>= 15 min; 0/invalid = off);
 *   - the configured provider is DATA_GOV_IN (current prices). CEDA is a bounded
 *     historical job run from the CLI; MOCK sample data is never scheduled.
 * There is no run at start-up: the first run happens one full interval later.
 * A run never overlaps the previous one (in-process guard + database advisory lock
 * inside the pipeline), and each run is aborted after the configured job timeout.
 */
import { redactText } from './http.js';

export const SCHEDULABLE_PROVIDERS = new Set(['DATA_GOV_IN']);

export function describeSchedulerConfig(mandiConfig) {
  if (!mandiConfig?.sync?.enabled) return { enabled: false, reason: mandiConfig?.sync?.reason || 'not configured' };
  if (!mandiConfig.provider) return { enabled: false, reason: 'MANDI_DATA_PROVIDER is not set' };
  if (!SCHEDULABLE_PROVIDERS.has(mandiConfig.provider)) {
    return { enabled: false, reason: `provider ${mandiConfig.provider} cannot be scheduled (only DATA_GOV_IN)` };
  }
  return { enabled: true, reason: null, minutes: mandiConfig.sync.minutes, provider: mandiConfig.provider };
}

export function createMandiSyncScheduler({
  mandiConfig,
  pipeline,
  log = console,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  const plan = describeSchedulerConfig(mandiConfig);
  let handle = null;
  let running = false;
  const state = { runs: 0, skippedOverlaps: 0, lastResult: null, lastError: null };

  async function tick() {
    if (running) {
      state.skippedOverlaps += 1;
      log.warn?.('[Scheduler] Previous mandi sync still running; this tick is skipped.');
      return null;
    }
    running = true;
    const controller = new AbortController();
    const timeoutMs = (mandiConfig.syncJobTimeoutMinutes || 30) * 60 * 1000;
    const timer = setTimeout(() => controller.abort(new Error('job timeout')), timeoutMs);
    try {
      const result = await pipeline.runPipeline({ provider: plan.provider, signal: controller.signal, triggeredBy: 'scheduler' });
      state.runs += 1;
      state.lastResult = result;
      state.lastError = ['SUCCESS', 'NO_DATA', 'SKIPPED'].includes(result.status) ? null : result.error_details;
      const line = `[Scheduler] Mandi sync ${result.status} (${result.source}): fetched=${result.records_fetched}, ` +
        `inserted=${result.records_inserted}, updated=${result.records_updated}, rejected=${result.records_rejected}, failed=${result.records_failed}`;
      if (state.lastError) log.error?.(`${line} — ${result.error_code}: ${result.error_details}`);
      else log.log?.(line);
      return result;
    } catch (err) {
      state.lastError = redactText(err.message);
      log.error?.(`[Scheduler] Mandi sync crashed: ${state.lastError}`);
      return null;
    } finally {
      clearTimeout(timer);
      running = false;
    }
  }

  return {
    plan,
    state,
    tick,
    start() {
      if (!plan.enabled) {
        log.log?.(`[Scheduler] Mandi sync scheduling disabled (${plan.reason}).`);
        return false;
      }
      if (handle) return true;
      handle = setIntervalFn(tick, plan.minutes * 60 * 1000);
      handle?.unref?.();
      log.log?.(`[Scheduler] Mandi sync every ${plan.minutes} minute(s) using ${plan.provider}; first run after one interval.`);
      return true;
    },
    stop() {
      if (handle) clearIntervalFn(handle);
      handle = null;
    },
  };
}

export default createMandiSyncScheduler;
