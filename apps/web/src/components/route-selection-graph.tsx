'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { GraphPathDto } from '@/lib/api/types';
import { cn } from '@/lib/utils';

const NODE_R = 26;
const PADDING_X = 56;
const VIEW_H = 120;

function layoutPoints(assetCount: number, width: number): readonly { x: number; y: number }[] {
  if (assetCount <= 0) {
    return [];
  }
  const y = VIEW_H / 2;
  if (assetCount === 1) {
    return [{ x: width / 2, y }];
  }
  const span = width - PADDING_X * 2;
  const step = span / (assetCount - 1);
  return Array.from({ length: assetCount }, (_, index) => ({
    x: PADDING_X + index * step,
    y,
  }));
}

export function RouteSelectionGraph({
  path,
  className,
}: {
  path: GraphPathDto;
  className?: string;
}) {
  const t = useTranslations('graph');
  const clipId = useId();
  const [width, setWidth] = useState(640);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = (): void => setReducedMotion(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const assets = path.assets;
  const points = useMemo(() => layoutPoints(assets.length, width), [assets.length, width]);

  const edgePath = useMemo(() => {
    if (points.length < 2) {
      return '';
    }
    return points
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
      .join(' ');
  }, [points]);

  return (
    <div
      className={cn(
        'marketing-surface overflow-hidden rounded-xl',
        className,
      )}
    >
      <div className="border-border/40 flex items-center justify-between gap-2 border-b px-4 py-2">
        <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
          {t('vizTitle')}
        </p>
        {path.recommended ? (
          <span className="bg-recommend text-recommend-foreground rounded-full px-2 py-0.5 text-[10px] font-medium uppercase">
            {t('vizRecommended')}
          </span>
        ) : null}
      </div>
      <svg
        ref={(node) => {
          if (node) {
            const next = Math.round(node.getBoundingClientRect().width);
            if (next > 0 && next !== width) {
              setWidth(next);
            }
          }
        }}
        viewBox={`0 0 ${width} ${VIEW_H}`}
        className="block h-[120px] w-full"
        role="img"
        aria-label={t('vizAria', { route: assets.join(' → ') })}
      >
        <defs>
          <linearGradient id={`${clipId}-edge`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--recommend)" stopOpacity="0.85" />
          </linearGradient>
        </defs>

        {edgePath ? (
          <>
            <path
              d={edgePath}
              fill="none"
              stroke={`url(#${clipId}-edge)`}
              strokeWidth={2.5}
              strokeLinecap="round"
            />
            {!reducedMotion ? (
              <circle r={5} fill="var(--recommend)" className="drop-shadow-sm">
                <animateMotion dur="2.4s" repeatCount="indefinite" path={edgePath} />
              </circle>
            ) : null}
          </>
        ) : null}

        {points.map((point, index) => {
          const label = assets[index] ?? '';
          const isEndpoint = index === 0 || index === assets.length - 1;
          return (
            <g key={`${label}-${index}`}>
              <circle
                cx={point.x}
                cy={point.y}
                r={NODE_R}
                fill={path.recommended ? 'var(--recommend)' : 'var(--primary)'}
                fillOpacity={isEndpoint ? 1 : 0.88}
              />
              <circle
                cx={point.x}
                cy={point.y}
                r={NODE_R}
                fill="none"
                stroke="var(--background)"
                strokeOpacity={0.25}
                strokeWidth={1}
              />
              <text
                x={point.x}
                y={point.y}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-primary-foreground font-mono text-[11px] font-semibold"
              >
                {label.length > 8 ? `${label.slice(0, 7)}…` : label}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="text-muted-foreground px-4 py-2 text-[11px] leading-relaxed">{t('vizCaption')}</p>
    </div>
  );
}
