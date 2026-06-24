
// Custom premium animated logo representing decentralized AI governance + secure vaults
export const CogniVaultLogo = () => (
  <svg width="22" height="22" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="glowing-logo">
    <defs>
      <linearGradient id="shieldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="var(--c-primary)" />
        <stop offset="100%" stopColor="var(--c-secondary)" />
      </linearGradient>
      <linearGradient id="coreGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="var(--c-success)" />
        <stop offset="100%" stopColor="#00f2fe" />
      </linearGradient>
    </defs>

    {/* Outer Concentric Shield Hexagons (3 layers) */}
    <path d="M50 5 L12 25 V75 L50 95 L88 75 V25 Z" stroke="url(#shieldGrad)" strokeWidth="2.5" strokeLinejoin="round" />
    <path d="M50 10 L16 28 V72 L50 90 L84 72 V28 Z" stroke="url(#shieldGrad)" strokeWidth="1.2" strokeLinejoin="round" opacity="0.7" />
    <path d="M50 15 L20 31 V69 L50 85 L80 69 V31 Z" stroke="url(#shieldGrad)" strokeWidth="0.8" strokeLinejoin="round" opacity="0.4" />

    {/* Center Processor Core (Concentric circles and details) */}
    <circle cx="50" cy="50" r="14" stroke="url(#shieldGrad)" strokeWidth="1.5" opacity="0.8" />
    <circle cx="50" cy="50" r="11" stroke="url(#shieldGrad)" stroke-width="1" strokeDasharray="3 2" />
    <circle cx="50" cy="50" r="8" fill="url(#coreGrad)" className="logo-core" />
    <circle cx="50" cy="50" r="3" fill="#0d121f" />
    <circle cx="50" cy="50" r="1.5" fill="#10b981" />

    {/* Intricate Branching Circuit Lines & Nodes (Symmetric Layout) */}
    {/* Top Branch */}
    <path d="M50 36 V20" stroke="url(#shieldGrad)" strokeWidth="1.2" />
    <circle cx="50" cy="20" r="1.5" fill="url(#shieldGrad)" />
    <path d="M47 37 L41 30 V22" stroke="url(#shieldGrad)" strokeWidth="1" />
    <circle cx="41" cy="22" r="1.2" fill="url(#shieldGrad)" />
    <path d="M53 37 L59 30 V22" stroke="url(#shieldGrad)" strokeWidth="1" />
    <circle cx="59" cy="22" r="1.2" fill="url(#shieldGrad)" />

    {/* Bottom Branch */}
    <path d="M50 64 V80" stroke="url(#shieldGrad)" strokeWidth="1.2" />
    <circle cx="50" cy="80" r="1.5" fill="url(#shieldGrad)" />
    <path d="M47 63 L41 70 V78" stroke="url(#shieldGrad)" strokeWidth="1" />
    <circle cx="41" cy="78" r="1.2" fill="url(#shieldGrad)" />
    <path d="M53 63 L59 70 V78" stroke="url(#shieldGrad)" strokeWidth="1" />
    <circle cx="59" cy="78" r="1.2" fill="url(#shieldGrad)" />

    {/* Left Branch */}
    <path d="M36 50 H20" stroke="url(#shieldGrad)" strokeWidth="1.2" />
    <circle cx="20" cy="50" r="1.5" fill="url(#shieldGrad)" />
    <path d="M37 47 L30 41 H22" stroke="url(#shieldGrad)" strokeWidth="1" />
    <circle cx="22" cy="41" r="1.2" fill="url(#shieldGrad)" />
    <path d="M37 53 L30 59 H22" stroke="url(#shieldGrad)" strokeWidth="1" />
    <circle cx="22" cy="59" r="1.2" fill="url(#shieldGrad)" />

    {/* Right Branch */}
    <path d="M64 50 H80" stroke="url(#shieldGrad)" strokeWidth="1.2" />
    <circle cx="80" cy="50" r="1.5" fill="url(#shieldGrad)" />
    <path d="M63 47 L70 41 H78" stroke="url(#shieldGrad)" strokeWidth="1" />
    <circle cx="78" cy="41" r="1.2" fill="url(#shieldGrad)" />
    <path d="M63 53 L70 59 H78" stroke="url(#shieldGrad)" strokeWidth="1" />
    <circle cx="78" cy="59" r="1.2" fill="url(#shieldGrad)" />

    {/* Diagonal Branches */}
    {/* Top-Left */}
    <path d="M40 40 L28 28" stroke="url(#shieldGrad)" strokeWidth="1.2" />
    <circle cx="28" cy="28" r="1.5" fill="url(#shieldGrad)" />
    <path d="M42 38 L32 26 H26" stroke="url(#shieldGrad)" strokeWidth="1" />
    <circle cx="26" cy="26" r="1.2" fill="url(#shieldGrad)" />
    <path d="M38 42 L26 32 V26" stroke="url(#shieldGrad)" strokeWidth="1" />
    <circle cx="26" cy="26" r="1.2" fill="url(#shieldGrad)" />

    {/* Top-Right */}
    <path d="M60 40 L72 28" stroke="url(#shieldGrad)" strokeWidth="1.2" />
    <circle cx="72" cy="28" r="1.5" fill="url(#shieldGrad)" />
    <path d="M58 38 L68 26 H74" stroke="url(#shieldGrad)" strokeWidth="1" />
    <circle cx="74" cy="26" r="1.2" fill="url(#shieldGrad)" />
    <path d="M62 42 L74 32 V26" stroke="url(#shieldGrad)" strokeWidth="1" />
    <circle cx="74" cy="26" r="1.2" fill="url(#shieldGrad)" />

    {/* Bottom-Left */}
    <path d="M40 60 L28 72" stroke="url(#shieldGrad)" stroke-width="1.2" />
    <circle cx="28" cy="72" r="1.5" fill="url(#shieldGrad)" />
    <path d="M42 62 L32 74 H26" stroke="url(#shieldGrad)" strokeWidth="1" />
    <circle cx="26" cy="74" r="1.2" fill="url(#shieldGrad)" />
    <path d="M38 58 L26 68 V74" stroke="url(#shieldGrad)" strokeWidth="1" />
    <circle cx="26" cy="74" r="1.2" fill="url(#shieldGrad)" />

    {/* Bottom-Right */}
    <path d="M60 60 L72 72" stroke="url(#shieldGrad)" stroke-width="1.2" />
    <circle cx="72" cy="72" r="1.5" fill="url(#shieldGrad)" />
    <path d="M58 62 L68 74 H74" stroke="url(#shieldGrad)" strokeWidth="1" />
    <circle cx="74" cy="74" r="1.2" fill="url(#shieldGrad)" />
    <path d="M62 58 L74 68 V74" stroke="url(#shieldGrad)" strokeWidth="1" />
    <circle cx="74" cy="74" r="1.2" fill="url(#shieldGrad)" />
  </svg>
);
