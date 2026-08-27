'use client';

import { ArrowUpRight, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

/**
 * The forward path from a quote — and deliberately not an execute button.
 *
 * Meridian is non-custodial: it compares routes and never moves funds, so a button implying that a
 * click sends money would be a lie about the product's regulatory position. "Continue with partner"
 * states what the future integration will actually do — hand the customer to the licensed provider —
 * and until that exists, the button says so plainly instead of pretending.
 */
export function ContinueWithPartner({
  providerName,
  variant = 'default',
}: {
  providerName: string;
  variant?: 'default' | 'outline';
}) {
  return (
    <Dialog>
      <DialogTrigger
        render={<Button variant={variant} size={variant === 'default' ? 'default' : 'sm'} />}
      >
        Continue with partner
        <ArrowUpRight className="size-4" aria-hidden />
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transact directly with {providerName}</DialogTitle>
          <DialogDescription className="space-y-3 pt-1 text-left">
            <span className="block">
              Meridian is a comparison platform. It does not hold funds, execute transactions or
              touch the money at any point — you transact with the provider you choose, on their
              terms.
            </span>
            <span className="block">
              A direct hand-off to licensed partners is planned. Until it ships, use this quote as
              your negotiating reference with {providerName}: the mid-market benchmark, the offered
              rate and every fee are itemised in the route details.
            </span>
            <span className="text-muted-foreground flex items-start gap-1.5 text-xs">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Quotes are indicative and non-binding. No funds move through Meridian.
            </span>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
