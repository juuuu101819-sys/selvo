import { MarketingCard } from './marketing-card';

export function ContentSection({
  title,
  body,
  items,
}: {
  title: string;
  body?: string;
  items?: readonly { title: string; body: string }[];
}) {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h2>
      {body ? <p className="text-muted-foreground max-w-3xl text-sm leading-relaxed sm:text-base">{body}</p> : null}
      {items && items.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <MarketingCard key={item.title} className="space-y-2">
              <h3 className="text-base font-semibold">{item.title}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">{item.body}</p>
            </MarketingCard>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function BulletSection({
  title,
  items,
}: {
  title: string;
  items: readonly string[];
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h2>
      <ul className="text-muted-foreground max-w-3xl list-disc space-y-2 pl-5 text-sm leading-relaxed sm:text-base">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
