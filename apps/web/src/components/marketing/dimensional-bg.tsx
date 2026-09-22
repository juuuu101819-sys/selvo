/**
 * Fixed marketing backdrop: gradient base, four radial glows, perspective grid, drifting orbs,
 * film grain, top vignette. Sits at z-0; page content wraps above it.
 *
 * Palette anchors: deep violet #0b0716, electric indigo #6d4aff, signal yellow #ffce45 (subtle).
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
        background: 'linear-gradient(180deg, #10091f 0%, #0b0716 45%, #07040f 100%)',
      }}
    >
      {/* Radial glows — indigo crown, subtle yellow floor */}
      <div
        className="absolute"
        style={{
          width: 900,
          height: 640,
          top: -260,
          right: -160,
          background: 'radial-gradient(circle, rgba(109,74,255,.5), transparent 68%)',
          filter: 'blur(60px)',
          opacity: 0.55,
        }}
      />
      <div
        className="absolute"
        style={{
          width: 760,
          height: 520,
          bottom: -200,
          left: '28%',
          background: 'radial-gradient(circle, rgba(255,206,69,.09), transparent 66%)',
          filter: 'blur(90px)',
        }}
      />
      <div
        className="absolute"
        style={{
          width: 720,
          height: 560,
          top: '8%',
          left: -200,
          background: 'radial-gradient(circle, rgba(109,74,255,.22), transparent 66%)',
          filter: 'blur(80px)',
        }}
      />
      <div
        className="absolute"
        style={{
          width: 520,
          height: 520,
          top: '64%',
          right: -160,
          background: 'radial-gradient(circle, rgba(52,214,168,.08), transparent 66%)',
          filter: 'blur(80px)',
        }}
      />

      {/* Perspective grid */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(rgba(109,74,255,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(109,74,255,.04) 1px, transparent 1px)',
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
            'radial-gradient(140% 100% at 50% 0%, transparent 55%, rgba(11,7,22,.65) 100%)',
        }}
      />
    </div>
  );
}
