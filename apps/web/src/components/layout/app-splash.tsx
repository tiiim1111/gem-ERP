/**
 * Full-screen branded loading state for the moments before the app shell can
 * render — first paint and the session check. It reuses the sign-in panel's
 * blue so signing in flows into the app instead of flashing a blank page.
 */
export function AppSplash({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      className="auth-brand fixed inset-0 z-50 flex flex-col items-center justify-center gap-7 text-white"
      role="status"
      aria-live="polite"
    >
      <div className="animate-rise-in flex flex-col items-center gap-3">
        <img src="/gem-logo.png" alt="" aria-hidden className="h-16 w-auto" />
        <div className="text-center leading-tight">
          <p className="text-xl font-semibold tracking-tight">GEM-ENI</p>
          <p className="mt-0.5 text-[11px] uppercase tracking-[0.18em] text-white/55">
            ERP &amp; Inventory
          </p>
        </div>
      </div>

      {/* Indeterminate: the wait has no measurable progress to report. */}
      <div className="h-0.5 w-40 overflow-hidden rounded-full bg-white/15">
        <div className="h-full w-1/3 animate-progress-sweep rounded-full bg-white/75 motion-reduce:w-full motion-reduce:animate-none" />
      </div>

      <span className="sr-only">{label}</span>
    </div>
  );
}
