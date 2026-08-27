import { Dec } from '@meridian/core';

export function addSeconds(iso: string, seconds: number): string {
  return new Date(Date.parse(iso) + seconds * 1000).toISOString();
}

export function invertRate(rate: string): string {
  return new Dec(1).div(new Dec(rate)).toSignificantDigits(18).toFixed();
}
