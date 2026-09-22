import { getTranslations } from 'next-intl/server';
import { ClosingCta } from '@/components/marketing/closing-cta';
import { CorridorMap } from '@/components/marketing/corridor-map';
import { DemoRequestForm } from '@/components/marketing/demo-request-form';
import { DevelopersSectionExpanded } from '@/components/marketing/developers-section-expanded';
import { GettingStartedDocs } from '@/components/marketing/getting-started-docs';
import { Hero } from '@/components/marketing/hero';
import { HowItWorksFlow } from '@/components/marketing/how-it-works-flow';
import { LandingFaq } from '@/components/marketing/landing-faq';
import { LandingPricing } from '@/components/marketing/landing-pricing';
import { LandingRailsWall } from '@/components/marketing/landing-rails-wall';
import { LandingStatsBand } from '@/components/marketing/landing-stats-band';
import { MarketingFooter } from '@/components/marketing/marketing-footer';
import { MarketingShell } from '@/components/marketing/marketing-shell';
import { ProductDashboardMockup } from '@/components/marketing/product-dashboard-mockup';
import { SavingsHighlight } from '@/components/marketing/savings-highlight';
import { SecuritySection } from '@/components/marketing/security-section';
import { SpreadVsFeeDiagram } from '@/components/marketing/spread-vs-fee-diagram';
import { StatusBand } from '@/components/marketing/status-band';
import { TrustStrip } from '@/components/marketing/trust-strip';
import { UseCasesSection } from '@/components/marketing/use-cases-section';
import { WhyNeverTouchMoney } from '@/components/marketing/why-never-touch-money';
import { WhyNowSection } from '@/components/marketing/why-now-section';
import { RoutingViz } from '@/components/marketing/routing-viz';
import { SiteHeader } from '@/components/site-header';
import { ErrorState } from '@/components/states';
import { fetchMeta } from '@/lib/api/client';

export default async function HomePage() {
  const meta = await fetchMeta();
  const t = await getTranslations();

  return (
    <MarketingShell>
      <SiteHeader
        mode={meta.ok ? meta.data.mode : null}
        engineVersion={meta.ok ? meta.data.engineVersion : null}
      />

      <main className="mx-auto w-full max-w-6xl flex-1 space-y-20 px-4 py-10 sm:px-6 sm:py-14">
        {meta.ok ? (
          <RoutingViz meta={meta.data} hero={<Hero />} />
        ) : (
          <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-12">
            <Hero />
            <ErrorState failure={meta.failure} />
          </div>
        )}

        <TrustStrip />

        <HowItWorksFlow />

        <WhyNeverTouchMoney />

        <SavingsHighlight />

        <ProductDashboardMockup />

        <UseCasesSection />

        <LandingStatsBand />

        <LandingRailsWall />

        <WhyNowSection />

        <SpreadVsFeeDiagram />

        <DevelopersSectionExpanded />

        <GettingStartedDocs />

        <CorridorMap />

        <LandingPricing />

        <SecuritySection />

        <LandingFaq />

        <DemoRequestForm />

        <StatusBand />

        <ClosingCta />
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
