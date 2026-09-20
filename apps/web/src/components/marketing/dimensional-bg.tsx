/**
 * Fixed marketing backdrop: gradient base, four radial glows, perspective grid, drifting orbs,
 * film grain, top vignette. Sits at z-0; page content wraps above it.
 *
 * The layer values are the literal approved design tokens rather than theme `var()` references —
 * the backdrop is a single fixed composition tuned against these exact rgba stops, and resolving
 * them through the oklch palette shifts the glow falloff.
 */

const GRAIN_URL =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

const ORBS = [
  { size: 14, top: '18%', left: '12%', delay: '0s' },
  { size: 9, top: '34%', left: '72%', delay: '-3.5s' },
  { size: 6, top: '58%', left: '28%', delay: '-7s' },
  { size: 11, top: '71%', left: '61%', delay: '-10.5s' },
  { size: 5, top: '86%', left: '41%', delay: '-14s' },
] as const;

export function DimensionalBg() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      style={{
        background: 'linear-gradient(180deg, #0E0A24 0%, #0A0620 40%, #080418 100%)',
      }}
    >
      {/* Radial glows */}
      <div
        className="absolute"
        style={{
          width: 900,
          height: 640,
          top: -260,
          right: -160,
          background: 'radial-gradient(circle, rgba(124,92,255,.55), transparent 68%)',
          filter: 'blur(60px)',
          opacity: 0.55,
        }}
      />
      <div
        className="absolute"
        style={{
          width: 620,
          height: 620,
          top: '32%',
          left: -220,
          background: 'radial-gradient(circle, rgba(245,197,24,.14), transparent 66%)',
          filter: 'blur(80px)',
        }}
      />
      <div
        className="absolute"
        style={{
          width: 760,
          height: 560,
          bottom: -220,
          left: '34%',
          background: 'radial-gradient(circle, rgba(91,61,245,.4), transparent 66%)',
          filter: 'blur(90px)',
        }}
      />
      <div
        className="absolute"
        style={{
          width: 520,
          height: 520,
          top: '64%',
          right: -160,
          background: 'radial-gradient(circle, rgba(52,214,168,.10), transparent 66%)',
          filter: 'blur(80px)',
        }}
      />

      {/* Perspective grid */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(rgba(124,92,255,.045) 1px, transparent 1px), linear-gradient(90deg, rgba(124,92,255,.045) 1px, transparent 1px)',
          backgroundSize: '54px 54px',
          opacity: 0.5,
          maskImage: 'radial-gradient(120% 90% at 50% 0%, #000 0%, transparent 72%)',
          WebkitMaskImage: 'radial-gradient(120% 90% at 50% 0%, #000 0%, transparent 72%)',
        }}
      />

      {/* Drifting orbs */}
      {ORBS.map((orb) => (
        <div
          key={`${orb.top}-${orb.left}`}
          className="marketing-orb absolute"
          style={{
            width: orb.size,
            height: orb.size,
            top: orb.top,
            left: orb.left,
            animationDelay: orb.delay,
          }}
        />
      ))}

      {/* Film grain */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: GRAIN_URL,
          opacity: 0.035,
          mixBlendMode: 'overlay',
        }}
      />

      {/* Top vignette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(140% 100% at 50% 0%, transparent 55%, rgba(8,5,26,.6) 100%)',
        }}
      />
    </div>
  );
}
