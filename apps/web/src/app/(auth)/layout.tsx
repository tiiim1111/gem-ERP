const HIGHLIGHTS = [
  'Stock ledger with full transaction history',
  'Serialized assets with QR scanning',
  'Procurement, maintenance, and reports',
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Brand panel — full height beside the form on desktop, a banner above it on phones. */}
      <div className="auth-brand relative flex shrink-0 flex-col justify-center px-6 py-10 text-white lg:w-[45%] lg:px-14 lg:py-0">
        <div className="animate-rise-in mx-auto w-full max-w-md lg:mx-0">
          <div className="flex items-center gap-3">
            <img
              src="/gem-logo.png"
              alt=""
              aria-hidden
              className="h-12 w-auto drop-shadow-sm lg:h-16"
            />
            <div className="leading-tight">
              <p className="text-2xl font-semibold tracking-tight lg:text-3xl">GEM-ENI</p>
              <p className="text-sm text-white/70">GemCor</p>
            </div>
          </div>

          <h1 className="mt-6 text-lg font-medium leading-snug text-white/95 lg:mt-10 lg:text-2xl">
            ERP &amp; Inventory Management
          </h1>

          <ul className="mt-6 hidden space-y-3 lg:block">
            {HIGHLIGHTS.map((highlight) => (
              <li key={highlight} className="flex items-start gap-3 text-sm text-white/75">
                <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-white/50" />
                {highlight}
              </li>
            ))}
          </ul>
        </div>

        <p className="absolute inset-x-14 bottom-8 hidden text-xs text-white/45 lg:block">
          Authorized users only. Activity is recorded in the audit log.
        </p>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 items-center justify-center bg-background px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
