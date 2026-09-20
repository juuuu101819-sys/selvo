/**
 * Fixed marketing backdrop: gradient base, radial glows, grid, drifting orbs, grain, vignette.
 * Sits at z-0; page content wraps at z-10+.
 */
export function DimensionalBg() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      style={{
        background:
          'linear-gradient(180deg, color-mix(in oklch, var(--background) 92%, var(--primary) 8%) 0%, var(--background) 45%, color-mix(in oklch, var(--background) 88%, var(--secondary) 12%) 100%)',
      }}
    >
      {/* Radial glows */}
      <div
        className="absolute -top-[20%] left-[10%] h-[55vh] w-[55vw] rounded-full opacity-40 blur-3xl"
        style={{
          background: 'radial-gradient(circle, color-mix(in oklch, var(--primary) 55%, transparent), transparent 70%)',
        }}
      />
      <div
        className="absolute top-[30%] -right-[10%] h-[45vh] w-[45vw] rounded-full opacity-25 blur-3xl"
        style={{
          background: 'radial-gradient(circle, color-mix(in oklch, var(--accent) 45%, transparent), transparent 70%)',
        }}
      />
      <div
        className="absolute bottom-[5%] left-[25%] h-[40vh] w-[40vw] rounded-full opacity-30 blur-3xl"
        style={{
          background:
            'radial-gradient(circle, color-mix(in oklch, var(--secondary) 70%, var(--primary) 30%), transparent 70%)',
        }}
      />
      <div
        className="absolute top-[55%] left-[55%] h-[30vh] w-[30vw] rounded-full opacity-20 blur-3xl"
        style={{
          background: 'radial-gradient(circle, color-mix(in oklch, var(--recommend) 35%, transparent), transparent 70%)',
        }}
      />

      {/* Faint grid */}
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'linear-gradient(color-mix(in oklch, var(--primary) 40%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in oklch, var(--primary) 40%, transparent) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          maskImage: 'radial-gradient(ellipse 80% 70% at 50% 30%, black 20%, transparent 75%)',
        }}
      />

      {/* Drifting orbs */}
      <div
        className="marketing-orb absolute top-[18%] left-[8%] size-32 rounded-full opacity-20 blur-2xl"
        style={{ background: 'var(--primary)' }}
      />
      <div
        className="marketing-orb marketing-orb-delay-1 absolute top-[42%] right-[12%] size-24 rounded-full opacity-15 blur-2xl"
        style={{ background: 'var(--accent)' }}
      />
      <div
        className="marketing-orb marketing-orb-delay-2 absolute bottom-[28%] left-[38%] size-20 rounded-full opacity-15 blur-2xl"
        style={{ background: 'var(--recommend)' }}
      />
      <div
        className="marketing-orb marketing-orb-delay-3 absolute top-[62%] right-[30%] size-28 rounded-full opacity-10 blur-2xl"
        style={{ background: 'var(--primary)' }}
      />
      <div
        className="marketing-orb marketing-orb-delay-4 absolute bottom-[12%] right-[8%] size-16 rounded-full opacity-20 blur-xl"
        style={{ background: 'var(--accent)' }}
      />

      {/* SVG noise grain */}
      <svg className="absolute inset-0 h-full w-full opacity-[0.035] mix-blend-overlay" xmlns="http://www.w3.org/2000/svg">
        <filter id="marketing-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="4" stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter="url(#marketing-grain)" />
      </svg>

      {/* Top vignette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 120% 80% at 50% -20%, transparent 40%, color-mix(in oklch, var(--background) 65%, transparent) 100%)',
        }}
      />
    </div>
  );
}
