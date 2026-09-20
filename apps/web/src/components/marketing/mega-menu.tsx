'use client';

import { Popover } from '@base-ui/react/popover';
import { ChevronDownIcon, ExternalLinkIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import {
  buildMegaMenuPanels,
  itemDescKey,
  itemLabelKey,
  type MegaMenuLink,
  type MegaMenuPanel,
} from './mega-menu-config';

type NavKey = Parameters<ReturnType<typeof useTranslations<'nav'>>>[0];

function navText(t: ReturnType<typeof useTranslations<'nav'>>, key: string): string {
  return t(key as NavKey);
}

function NavTag({ tag }: { tag: MegaMenuLink['tag'] }) {
  const t = useTranslations('nav');
  return (
    <Badge
      variant={tag === 'LIVE' ? 'recommend' : 'secondary'}
      className="font-mono text-[10px] uppercase tracking-wide"
    >
      {tag === 'LIVE' ? t('tagLive') : t('tagSoon')}
    </Badge>
  );
}

function NavItem({
  panel,
  item,
}: {
  panel: MegaMenuPanel;
  item: MegaMenuLink;
}) {
  const t = useTranslations('nav');
  const label = navText(t, itemLabelKey(panel.id, item.id));
  const desc = navText(t, itemDescKey(panel.id, item.id));

  const content = (
    <>
      <span className="flex items-center gap-2">
        <span className="text-sm font-medium">{label}</span>
        {item.external ? (
          <ExternalLinkIcon aria-hidden className="text-muted-foreground size-3 shrink-0" />
        ) : null}
        <NavTag tag={item.tag} />
      </span>
      <span className="text-muted-foreground mt-0.5 block text-xs leading-snug">{desc}</span>
    </>
  );

  const className =
    'hover:bg-muted/60 focus-visible:ring-ring block rounded-lg px-3 py-2.5 outline-none focus-visible:ring-2';

  if (item.external) {
    return (
      <a href={item.href} target="_blank" rel="noopener noreferrer" className={className}>
        {content}
      </a>
    );
  }

  return (
    <Link href={item.href} className={className}>
      {content}
    </Link>
  );
}

function MegaMenuDropdown({ panel }: { panel: MegaMenuPanel }) {
  const t = useTranslations('nav');
  const [open, setOpen] = useState(false);

  const onKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onKeyDown]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen} modal={false}>
      <Popover.Trigger
        openOnHover
        delay={100}
        closeDelay={280}
        className={cn(
          'text-muted-foreground hover:text-foreground data-popup-open:text-foreground inline-flex items-center gap-0.5 rounded-md px-1 py-1.5 text-xs font-medium whitespace-nowrap transition-colors lg:px-1.5 xl:px-2',
          'focus-visible:ring-ring outline-none focus-visible:ring-2',
        )}
      >
        {navText(t, panel.labelKey)}
        <ChevronDownIcon
          aria-hidden
          className={cn('size-3.5 opacity-70 transition-transform', open && 'rotate-180')}
        />
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align={panel.align ?? 'start'}
          sideOffset={6}
          positionMethod="fixed"
          collisionPadding={16}
          collisionAvoidance={{ side: 'flip', align: 'shift', fallbackAxisSide: 'none' }}
        >
          <Popover.Popup
            className={cn(
              'marketing-surface z-50 w-[min(calc(100vw-2rem),42rem)] rounded-2xl p-0',
              'data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            )}
          >
            <div className="p-5 sm:p-6">
              <div className="flex flex-col gap-6 sm:flex-row">
                {panel.visual ? (
                  <div className="border-border/60 from-primary/12 to-accent/8 shrink-0 rounded-xl border bg-gradient-to-br via-transparent p-4 sm:w-52">
                    <p className="font-display text-sm font-semibold">
                      {navText(t, panel.visual.titleKey)}
                    </p>
                    <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
                      {navText(t, panel.visual.bodyKey)}
                    </p>
                    <Link
                      href={panel.visual.href}
                      className="text-primary mt-3 inline-block text-xs font-medium hover:underline"
                    >
                      {navText(t, panel.visual.linkKey)} →
                    </Link>
                  </div>
                ) : null}

                <div className="grid min-w-0 flex-1 gap-6 sm:grid-cols-2">
                  {panel.columns.map((column) => (
                    <div key={column.headingKey}>
                      <p className="text-muted-foreground mb-2 font-mono text-[11px] uppercase tracking-wider">
                        {navText(t, column.headingKey)}
                      </p>
                      <div className="space-y-0.5">
                        {column.items.map((item) => (
                          <NavItem key={item.id} panel={panel} item={item} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-border/60 mt-5 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {navText(t, panel.cta.textKey)}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  nativeButton={false}
                  render={<Link href={panel.cta.href} />}
                >
                  {navText(t, panel.cta.buttonKey)}
                </Button>
              </div>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function MegaMenu({ openapiHref, className }: { openapiHref: string; className?: string }) {
  const t = useTranslations('nav');
  const panels = buildMegaMenuPanels(openapiHref);

  return (
    <nav aria-label={t('ariaLabel')} className={cn('items-center gap-0', className)}>
      {panels.map((panel) => (
        <MegaMenuDropdown key={panel.id} panel={panel} />
      ))}
    </nav>
  );
}
