import { ImageResponse } from 'next/og';

export const alt = 'Meridian — Global financial routing. Non-custodial. We never move money.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        background: '#0C0821',
        color: '#F3F0FF',
        padding: 80,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 12,
            background: '#7C5CFF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 36,
            fontWeight: 700,
            color: '#ffffff',
          }}
        >
          M
        </div>
        <div style={{ display: 'flex', marginLeft: 24, fontSize: 40, fontWeight: 600 }}>
          Meridian
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          marginTop: 40,
          fontSize: 44,
          fontWeight: 600,
          lineHeight: 1.2,
          maxWidth: 980,
        }}
      >
        Rank payment routes for businesses and AI agents
      </div>
      <div
        style={{
          display: 'flex',
          marginTop: 28,
          fontSize: 24,
          color: '#948CC4',
          maxWidth: 980,
        }}
      >
        Non-custodial comparison. We never take custody. We never move money.
      </div>
    </div>,
    { ...size },
  );
}
