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
        <div className="animate-rise-in mx-auto w-full max-w-md">
          {/* Hero: centred, logo stacked above the wordmark so it can run large. */}
          <div className="flex flex-col items-center text-center">
            <img
              src="/gem-logo.png"
              alt=""
              aria-hidden
              className="h-24 w-auto drop-shadow-sm sm:h-28 lg:h-36"
            />
            <p className="mt-4 text-4xl font-semibold tracking-tight lg:mt-6 lg:text-5xl">
              GEM-ENI
            </p>
            <h1 className="mt-2.5 text-sm font-medium leading-snug text-white/80 lg:mt-3 lg:text-base">
              Green Energy Machineries ERP &amp; Inventory Systems
            </h1>
          </div>

          {/* Supporting copy stays left-aligned; the block itself is centred so
              the ragged right edge still sits square under the hero. */}
          <ul className="mx-auto mt-10 hidden w-fit space-y-3 text-left lg:block">
            {HIGHLIGHTS.map((highlight) => (
              <li key={highlight} className="flex items-start gap-3 text-sm text-white/75">
                <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-white/50" />
                {highlight}
              </li>
            ))}
          </ul>
        </div>

        <p className="absolute inset-x-14 bottom-8 hidden text-center text-xs text-white/45 lg:block">
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
