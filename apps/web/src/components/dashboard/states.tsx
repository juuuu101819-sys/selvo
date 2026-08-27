import type { ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { signOut } from '@/app/actions';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/states';
import type { ApiFailure } from '@/lib/api/types';

export function DashboardEmpty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-border/60 rounded-xl border border-dashed p-8 text-center">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">{children}</p>
    </div>
  );
}

export function SessionEnded({ failure }: { failure: ApiFailure }) {
  if (failure.code !== 'UNAUTHENTICATED') {
    return <ErrorState failure={failure} />;
  }

  return (
    <Alert>
      <AlertCircle aria-hidden />
      <AlertTitle>Sign in required</AlertTitle>
      <AlertDescription>
        <p>{failure.message}</p>
        <form action={signOut} className="mt-3">
          <Button type="submit" size="sm">
            Return to sign in
          </Button>
        </form>
      </AlertDescription>
    </Alert>
  );
}
