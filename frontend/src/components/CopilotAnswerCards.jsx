import { t } from '../i18n/strings';
import { formatReportDate, formatRupees } from '../utils/dates';

const rupees = (value) => `₹${formatRupees(value)}`;

/** An old report must never pass for today's price: its age is always shown. */
function OldReportBadge({ days, language }) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg bg-surface-container-high px-2 py-1 font-semibold text-on-surface">
      <span className="material-symbols-outlined text-[16px]" aria-hidden="true">history</span>
      {t(language, 'copilot.oldReport', { days })}
    </div>
  );
}

function PriceCard({ data, language }) {
  return (
    <div className="mt-3 p-3 rounded-xl bg-surface-container-low border border-outline-variant/30 text-xs flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 font-bold text-on-surface">
        <span>{data.commodityName} @ {data.mandiName}</span>
        <span className="text-secondary font-black text-sm whitespace-nowrap">
          {rupees(data.modalPrice)}/{t(language, 'ai.quintal')}
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-2 text-on-surface-variant">
        <span>{t(language, 'copilot.priceRange')}: {rupees(data.minPrice)} - {rupees(data.maxPrice)}</span>
        <span>{t(language, 'copilot.observationDate')}: {formatReportDate(data.priceDate, language)}</span>
      </div>
      {data.isStale && <OldReportBadge days={data.ageDays} language={language} />}
      {data.alternatives?.length > 0 && (
        <div className="pt-1.5 border-t border-outline-variant/20">
          <span className="font-bold text-on-surface-variant">{t(language, 'copilot.otherMarkets')}</span>
          <ul className="mt-1 flex flex-col gap-0.5">
            {data.alternatives.map((other, index) => (
              <li key={`${other.mandiName}-${index}`} className="flex flex-wrap justify-between gap-x-2 text-on-surface">
                <span>{other.mandiName}</span>
                <span className="whitespace-nowrap">{rupees(other.modalPrice)} · {formatReportDate(other.priceDate, language)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function TrendCard({ data, language, showAge }) {
  const change = Number(data.changePercent);
  const icon = data.direction === 'up' ? 'trending_up' : data.direction === 'down' ? 'trending_down' : 'trending_flat';
  return (
    <div className="mt-3 p-3 rounded-xl bg-surface-container-low border border-outline-variant/30 text-xs flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 font-bold text-on-surface">
        <span className="flex items-center gap-1">
          <span className="material-symbols-outlined text-[16px] text-secondary" aria-hidden="true">{icon}</span>
          {t(language, 'copilot.trend.title')}
        </span>
        <span className="text-secondary font-black text-sm whitespace-nowrap">
          {rupees(data.oldestModal)} → {rupees(data.latestModal)}
          {Number.isFinite(change) && ` (${change > 0 ? '+' : ''}${change}%)`}
        </span>
      </div>
      <div className="text-on-surface-variant">
        {formatReportDate(data.startDate, language)} – {formatReportDate(data.endDate, language)}
      </div>
      {showAge && data.isStale && <OldReportBadge days={data.ageDays} language={language} />}
    </div>
  );
}

function ForecastCard({ data, language }) {
  const forecast = data.forecasts[0];
  return (
    <div className="mt-3 p-3 rounded-xl bg-secondary-container/40 border border-secondary/30 text-xs flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 font-bold text-on-surface">
        <span className="flex items-center gap-1">
          <span className="material-symbols-outlined text-[16px] text-secondary" aria-hidden="true">trending_up</span>
          {t(language, 'copilot.badge.forecast')}
        </span>
        <span className="text-secondary font-black text-sm whitespace-nowrap">
          {rupees(forecast.predictedPrice)}/{t(language, 'ai.quintal')}
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-2 text-on-surface-variant">
        <span>{t(language, 'copilot.predictionInterval')}: {rupees(forecast.lowerBound)} - {rupees(forecast.upperBound)}</span>
        {forecast.intervalLevelPercent != null && (
          <span className="font-bold text-secondary">{t(language, 'copilot.intervalLevel', { level: forecast.intervalLevelPercent })}</span>
        )}
      </div>
      <div className="text-[10px] text-on-surface-variant/80 border-t border-outline-variant/20 pt-1">
        {t(language, 'copilot.forecastDate')}: {formatReportDate(forecast.forecastDate, language)}
      </div>
    </div>
  );
}

/**
 * The verified numbers behind a Copilot answer: price, trend and forecast cards, with the data
 * source named once. Everything shown here comes straight from the backend's verified records.
 */
export default function CopilotAnswerCards({ message, language }) {
  const { marketData, trendData, forecastData, sources = [] } = message;
  const hasForecast = Boolean(forecastData?.forecasts?.[0]);
  if (!marketData && !trendData && !hasForecast) return null;

  const sourceNames = [...new Set([marketData?.source, ...sources.map((s) => s?.source)].filter(Boolean))];
  return (
    <>
      {marketData && <PriceCard data={marketData} language={language} />}
      {trendData && <TrendCard data={trendData} language={language} showAge={!marketData} />}
      {hasForecast && <ForecastCard data={forecastData} language={language} />}
      {sourceNames.length > 0 && (
        <div className="mt-2 text-[10px] text-on-surface-variant font-medium">
          {t(language, 'copilot.sources')}: {sourceNames.join(' · ')}
        </div>
      )}
    </>
  );
}
