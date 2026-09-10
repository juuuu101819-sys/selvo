import type { ReactNode } from 'react';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';

export function SiteFooter({
  notice,
  extra,
}: {
  notice: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <footer className="border-border/60 border-t">
      <div className="text-muted-foreground mx-auto w-full max-w-6xl space-y-3 px-4 py-6 text-xs sm:px-6">
        <p className="flex items-start gap-1.5">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{notice}</span>
        </p>
        {extra}
        <nav aria-label="Legal" className="flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/terms" className="hover:text-foreground underline-offset-4 hover:underline">
            Terms of use
          </Link>
          <Link href="/privacy" className="hover:text-foreground underline-offset-4 hover:underline">
            Privacy
          </Link>
        </nav>
      </div>
    </footer>
  );
}
