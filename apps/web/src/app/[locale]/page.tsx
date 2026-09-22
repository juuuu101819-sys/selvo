import { getTranslations } from 'next-intl/server';
import { CustomerGrid } from '@/components/marketing/customer-grid';
import { DeveloperSection } from '@/components/marketing/developer-section';
import { FeaturesSection } from '@/components/marketing/features-section';
import { GradientCta } from '@/components/marketing/gradient-cta';
import { Hero } from '@/components/marketing/hero';
import { HowItWorksFlow } from '@/components/marketing/how-it-works-flow';
import { HowItWorks } from '@/components/marketing/how-it-works';
import { LandingRailsWall } from '@/components/marketing/landing-rails-wall';
import { LandingStatsBand } from '@/components/marketing/landing-stats-band';
import { ProductDashboardMockup } from '@/components/marketing/product-dashboard-mockup';
import { SavingsHighlight } from '@/components/marketing/savings-highlight';
import { TrustStrip } from '@/components/marketing/trust-strip';
import { UseCasesSection } from '@/components/marketing/use-cases-section';
import { WhyNeverTouchMoney } from '@/components/marketing/why-never-touch-money';
import { MarketingFooter } from '@/components/marketing/marketing-footer';
import { MarketingShell } from '@/components/marketing/marketing-shell';
import { ModelSection } from '@/components/marketing/model-section';
import { RoutingViz } from '@/components/marketing/routing-viz';
import { SectionShell } from '@/components/marketing/section-shell';
import { SiteHeader } from '@/components/site-header';
import { ErrorState } from '@/components/states';
import { fetchMeta } from '@/lib/api/client';

export default async function HomePage() {
  const meta = await fetchMeta();
  const t = await getTranslations();
  const tHow = await getTranslations('landing.how');
  const tCustomers = await getTranslations('landing.customers');

  return (
    <MarketingShell>
      <SiteHeader
        mode={meta.ok ? meta.data.mode : null}
        engineVersion={meta.ok ? meta.data.engineVersion : null}
      />

      <main className="mx-auto w-full max-w-6xl flex-1 space-y-20 px-4 py-10 sm:px-6 sm:py-14">
        <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-12">
          <Hero />
          {meta.ok ? <RoutingViz meta={meta.data} /> : <ErrorState failure={meta.failure} />}
        </div>

        <TrustStrip />

        <HowItWorksFlow />

        <WhyNeverTouchMoney />

        <SavingsHighlight />

        <ProductDashboardMockup />

        <UseCasesSection />

        <LandingStatsBand />

        <LandingRailsWall />

        <ModelSection />
        <FeaturesSection />

        <SectionShell heading={tHow('heading')}>
          <HowItWorks />
        </SectionShell>

        <SectionShell heading={tCustomers('heading')}>
          <CustomerGrid />
        </SectionShell>

        <DeveloperSection />
        <GradientCta />
      </main>

      <MarketingFooter
        notice={t('footer.landingNotice')}
        extra={
          meta.ok && meta.data.pricing !== null ? (
            <p className="font-mono">
              {t('landing.pricingLine', {
                dataset: meta.data.pricing.datasetVersion,
                rates: meta.data.pricing.referenceRatesVersion,
                count: meta.data.providers.length,
              })}
            </p>
          ) : null
        }
      />
    </MarketingShell>
  );
}
