'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SectionShell } from './section-shell';

/**
 * Demo request form — front-end acknowledgement only, no backend collection.
 */
export function DemoRequestForm() {
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setSubmitted(true);
  }

  return (
    <SectionShell eyebrow="Demo" heading="Book a demo">
      <div className="grid gap-8 lg:grid-cols-2 lg:gap-10">
        <div className="space-y-4">
          <p className="text-muted-foreground text-sm leading-relaxed sm:text-base">
            See how Meridian compares routes across bank FX, PSPs, stablecoin and liquidity — without
            holding funds or keys. Sandbox-first walkthrough; no production settlement.
          </p>
          <ul className="text-muted-foreground space-y-2 text-sm">
            <li>· Non-custodial decision layer demo</li>
            <li>· Sandbox quotes and 501 execution gate explained</li>
            <li>· Partner settlement boundary — Meridian never moves money</li>
          </ul>
        </div>

        <div className="marketing-surface rounded-2xl p-5 sm:p-6">
          {submitted ? (
            <div className="space-y-2 py-6 text-center" role="status">
              <p className="text-base font-semibold">Thanks — this is a front-end demo only.</p>
              <p className="text-muted-foreground text-sm">
                No data was sent or stored. Contact us at{' '}
                <span className="text-foreground font-mono">hello@meridian.dev</span> when ready.
              </p>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-1.5">
                <Label htmlFor="demo-email">Work email</Label>
                <Input id="demo-email" name="email" type="email" required placeholder="you@company.com" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="demo-company">Company</Label>
                <Input id="demo-company" name="company" required placeholder="Acme Treasury Ltd" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="demo-volume">Monthly volume (optional)</Label>
                <Input id="demo-volume" name="volume" placeholder="e.g. USD 2M cross-border" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="demo-message">Message</Label>
                <textarea
                  id="demo-message"
                  name="message"
                  rows={3}
                  placeholder="Corridors, rails, or use case"
                  className="border-input bg-transparent focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-lg border px-2.5 py-2 text-sm outline-none focus-visible:ring-3"
                />
              </div>
              <Button type="submit" className="w-full sm:w-auto">
                Request demo
              </Button>
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                Demo form only — submission shows a confirmation message locally. No backend collection.
              </p>
            </form>
          )}
        </div>
      </div>
    </SectionShell>
  );
}
