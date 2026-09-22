'use client';

import { useEffect, useRef, useState } from 'react';

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(media.matches);
    const onChange = (): void => setReduced(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

/** Animates an integer from 0 to `target` when the element enters the viewport. */
export function useInViewCountUp(target: number, durationMs = 1200): {
  ref: (node: HTMLElement | null) => void;
  value: number;
} {
  const reducedMotion = usePrefersReducedMotion();
  const [value, setValue] = useState(reducedMotion ? target : 0);
  const [started, setStarted] = useState(reducedMotion);
  const elementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (reducedMotion || started) {
      return;
    }

    const node = elementRef.current;
    if (node === null) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setStarted(true);
          observer.disconnect();
        }
      },
      { threshold: 0.35 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [reducedMotion, started]);

  useEffect(() => {
    if (!started || reducedMotion) {
      return;
    }

    const startedAt = performance.now();
    let frame = 0;

    const tick = (now: number): void => {
      const progress = Math.min(1, (now - startedAt) / durationMs);
      const eased = 1 - (1 - progress) ** 3;
      setValue(Math.round(target * eased));
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [started, target, durationMs, reducedMotion]);

  const ref = (node: HTMLElement | null): void => {
    elementRef.current = node;
  };

  return { ref, value };
}
