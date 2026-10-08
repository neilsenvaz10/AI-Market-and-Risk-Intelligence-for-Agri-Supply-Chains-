/** Labelled input container shared by profile and account forms (Stitch Ask AI input style). */
export function Field({ label, htmlFor, error, optional, children }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-body-sm font-bold text-on-surface flex justify-between mb-1">
        <span>{label}</span>
        {optional && <span className="font-medium text-on-surface-variant">Optional</span>}
      </label>
      <div
        className={`flex items-center gap-2 bg-surface-container-lowest p-2 rounded-xl shadow-sm border-2 transition-all ${
          error ? 'border-error' : 'border-transparent focus-within:border-secondary'
        }`}
      >
        {children}
      </div>
      {error && (
        <p className="text-body-sm text-error mt-1 flex items-center gap-1" role="alert">
          <span className="material-symbols-outlined text-[14px]">error</span>
          {error}
        </p>
      )}
    </div>
  );
}

export const inputClass =
  'flex-grow min-w-0 bg-transparent text-body-md text-on-surface placeholder:text-on-surface-variant outline-none px-2 py-1.5';
