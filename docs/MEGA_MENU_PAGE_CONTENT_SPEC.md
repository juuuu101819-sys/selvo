# MERIDIAN — MEGA-MENU & PAGE CONTENT SPEC

### Source copy (English) for all nav items and new pages. Regulatory-safe. Ready for 8-locale translation.

> **Voice rules (apply to every string):**
> - Decision-layer language only: *compare · route · discover · score · orchestrate · return a decision*. NEVER *settle · move money · hold · execute · pay out · custody* as things Meridian does.
> - Meridian returns decisions; **licensed partners settle**. Say so where an action is implied.
> - Transaction/ad-valorem pricing is never promised in customer-facing copy. Pricing = usage · subscription · API.
> - Amber = brand accent only. Red = warning. Never call anything "guaranteed", "instant", or "licensed" unless it is.
> - Every string needs a key in all 8 locales (en, ko, ja, zh-CN, es, fr, de, pt-BR). Namespaces noted per block.

---

## PART A — MEGA-MENU (namespace: `nav`)

Five top items. Each dropdown: optional left visual card, right grouped columns, bottom CTA bar.
Status tag per item: **LIVE** (route exists today) or **SOON** (page to build).

### A1. Platform — `nav.platform`

Left visual card:

- title `nav.platform.visualTitle`: "The orchestration layer"
- body `nav.platform.visualBody`: "One intent, compared across every rail, returned as a best-execution decision. Meridian never moves money."
- link `nav.platform.visualLink`: "Start in the sandbox"

Column 01 — "Explore" `nav.platform.explore`

| key | label | desc | href | tag |
|---|---|---|---|---|
| compare | Compare routes | Rank every route for one intent | `/` | LIVE |
| multirail | Multi-rail | Bank · FX · stablecoin · liquidity | `/rails` | LIVE |
| graph | Route graph | Multi-hop path discovery | `/graph` | LIVE |

Column 02 — "Rails" `nav.platform.rails`

| key | label | desc | href | tag |
|---|---|---|---|---|
| stablecoins | Stablecoins | Fiat ↔ stablecoin routing | `/stablecoins` | LIVE |
| defi | DeFi liquidity | DEX / AMM venue quoting | `/defi` | LIVE |
| agents | AI agents | Agent payment intents | `/agents` | LIVE |

CTA bar `nav.platform.cta`: "Non-custodial: Meridian returns decisions — partners settle." · button "How it works" → `/how-it-works` (SOON) or anchor on `/`.

### A2. Solutions — `nav.solutions`

Column 01 — "By use case" `nav.solutions.usecase`

| key | label | desc | href | tag |
|---|---|---|---|---|
| crossborder | Cross-border payouts | Route international corridors | `/solutions/cross-border` | SOON |
| treasury | Treasury optimization | Best execution for treasury flows | `/solutions/treasury` | SOON |
| agentpay | AI agent payments | Autonomous financial routing | `/agents` | LIVE |

Column 02 — "By customer" `nav.solutions.customer`

| key | label | desc | href | tag |
|---|---|---|---|---|
| fintechs | Fintechs | Embed the decision layer | `/solutions/fintechs` | SOON |
| platforms | Platforms | Route on behalf of your users | `/solutions/platforms` | SOON |
| enterprises | Enterprises | Global corridor coverage | `/solutions/enterprises` | SOON |

CTA bar `nav.solutions.cta`: "Not sure which fits? Talk to us." · button "Talk to us" → `/company/contact` (SOON).

### A3. Developers — `nav.developers`

Left visual card:

- title: "Developer hub"
- body: "Integrate through one API. Send an intent, get a scored, signed route back."
- link: "API explorer" → `/developers`

Column 01 — "Build" `nav.developers.build`

| key | label | desc | href | tag |
|---|---|---|---|---|
| explorer | API explorer | Live quote & route forms | `/developers` | LIVE |
| openapi | OpenAPI spec | Machine-readable schema | `{API_BASE}/api/v1/openapi.json` (external) | LIVE |
| reference | API reference | Rendered docs | `/developers/reference` | SOON |

Column 02 — "Toolkit" `nav.developers.toolkit`

| key | label | desc | href | tag |
|---|---|---|---|---|
| sdks | SDKs | Client libraries | `/developers/sdks` | SOON |
| changelog | Changelog | Release notes | `/developers/changelog` | SOON |
| status | Status | System status | `/developers/status` | SOON |

CTA bar: "The sandbox needs no funds and no license." · button "Get API keys" → `/login`.

### A4. Resources — `nav.resources` (panel opens right-aligned)

Column 01 — "Learn" `nav.resources.learn`

| key | label | desc | href | tag |
|---|---|---|---|---|
| blog | Blog | Product & industry writing | `/resources/blog` | SOON |
| playbook | Playbook | Financial orchestration guide | `/resources/playbook` | SOON |
| webinars | Webinars | Live & recorded sessions | `/resources/webinars` | SOON |

Column 02 — "Trust" `nav.resources.trust`

| key | label | desc | href | tag |
|---|---|---|---|---|
| noncustodial | Non-custodial model | Why Meridian never holds funds | `/trust/non-custodial` | SOON |
| security | Trust & security | How we protect data | `/trust/security` | SOON |
| legal | Legal | Terms & privacy | `/terms` | LIVE |

CTA bar: "Non-custodial disclosure is our regulatory anchor." · button "Read the model" → `/trust/non-custodial`.

### A5. Company — `nav.company` (panel opens right-aligned)

Column 01 — "Company" `nav.company.company`

| key | label | desc | href | tag |
|---|---|---|---|---|
| about | About | Our mission | `/company/about` | SOON |
| careers | Careers | Open roles | `/company/careers` | SOON |
| partners | Partners | Licensed execution partners | `/company/partners` | SOON |

Column 02 — "More" `nav.company.more`

| key | label | desc | href | tag |
|---|---|---|---|---|
| pricing | Pricing | Usage & subscription | `/pricing` | SOON |
| brand | Brand | Logos & guidelines | `/company/brand` | SOON |

CTA bar: "Pricing is usage & subscription — transaction pricing stays gated." · button "See pricing" → `/pricing`.

### Nav utility strings — `nav`

- `nav.signIn`: "Sign in" → `/login`
- `nav.getKeys`: "Get API keys" → `/login`

---

## PART B — LANDING SECTIONS (namespace: `landing`)

Existing keys `landing.title`, `landing.lede`, `landing.pricingLine` stay; add the rest.

- `landing.eyebrow`: "AI Financial Orchestration Infrastructure"
- `landing.title`: "Rank every route your money could take, before it moves."
- `landing.lede`: "Meridian reads a financial intent, compares routes across banks, FX, stablecoins and liquidity, checks compliance, and returns the best-execution decision. Your licensed partners settle."
- `landing.ctaPrimary`: "Start in the sandbox"
- `landing.ctaSecondary`: "Read the docs"
- `landing.noncustodialNote`: "Non-custodial by design — never holds funds or keys, never moves money on your behalf."
- `landing.trustLine`: "Built for fintechs, platforms and treasuries operating across borders"

### Three-part model — `landing.model`

- heading: "One layer, three jobs"
- sub: "Meridian sits above every rail and does three things — and deliberately none of the fourth: it never executes or holds."
- `model.discover`: "Discover" / "Find every viable route across rails and normalize their quotes into one comparable model." / bullets: Provider discovery · Quote normalization · Route graph search
- `model.decide`: "Decide" / "Score routes on cost, speed, liquidity, reliability and compliance, and return the best one." / bullets: Best execution · Compliance intelligence · Liquidity intelligence
- `model.coordinate`: "Coordinate" / "Return a signed execution intent your systems and licensed partners can verify and act on." / bullets: Signed execution intent · Settlement orchestration · Reconciliation & audit

### Feature grid — `landing.features` (6)

1. Universal route graph — "Fiat, banks, FX, stablecoins, chains and liquidity as one normalized graph."
2. Best execution, explained — "Ranked on total cost, speed, liquidity, reliability and compliance — reasoning shown."
3. Compliance intelligence — "Jurisdiction, provider eligibility and screening pre-checked before a route returns."
4. Signed execution intent — "A verifiable recommendation — not an instruction to move funds."
5. Liquidity intelligence — "Depth and quality scored across venues, feeding multi-hop discovery."
6. Reconciliation & audit — "Every decision traceable end to end, with a full audit trail."

### Stat band — `landing.stats`

- "14+ rail types in one graph"
- "6-way best-execution scoring"
- "1 API: intent → route → decision"
- "0 customer funds held"

### Rail coverage — `landing.rails` (heading "Every rail, on the same axes")

- Traditional finance / IN SANDBOX / "Bank transfer, FX providers, PSPs, correspondent banking."
- Stablecoin / IN SANDBOX / "Fiat ↔ stablecoin, on/off-ramp, stable-to-stable."
- DeFi liquidity / IN SANDBOX / "DEX, AMM and aggregator venues, scored for depth."
- Liquidity providers / IN SANDBOX / "Wholesale liquidity feeding multi-hop discovery."
- Tokenized assets / PARTNER REQUIRED / "Registry & routing only. Issuance stays with partners."
- Treasury products / PLANNED / "MMF & treasury instruments as routable destinations."

### How it works — `landing.how` (heading "How a route resolves")

1. Understand the intent — "Natural language or a structured request becomes a normalized financial intent."
2. Search the graph — "Single- and multi-hop paths are enumerated across rail types — routes no single provider could quote."
3. Check each hop — "Jurisdiction, eligibility and liquidity are validated; ineligible hops are pruned before scoring."
4. Return the decision — "The best-execution route is returned as a signed intent — your partner settles it."

### Customers — `landing.customers` (heading "Who builds on Meridian")

- Fintechs — "Embed the decision layer to give users the best route without integrating every rail yourself."
- Platforms & marketplaces — "Route on behalf of your users across borders, with compliance pre-checked per corridor."
- Enterprises & treasuries — "Optimize cross-border and treasury flows for total cost and settlement time."

### Developer section — `landing.dev`

- heading: "One API, every rail"
- body: "Send an intent, get a scored and signed route back. The sandbox needs no funds and no license."

### Final CTA — `landing.finalCta`

- "Route your first intent today"
- "Spin up a sandbox, send an intent, and see the route graph resolve. No funds move — every execution stays with your licensed partners."

### Footer — `footer`

Existing `footer.terms`, `footer.privacy`, per-surface notices stay.

- `footer.tagline`: "The non-custodial decision layer above global financial rails."
- `footer.disclosure`: "Meridian is non-custodial. It compares routes only — it does not hold customer funds, private keys or wallets, does not act as principal, and does not execute or delegate settlement. Quotes are indicative and non-binding; transact directly with your chosen provider."

---

## PART C — NEW PAGES (TO BUILD) — content per page (namespace: `pages`)

Each page uses the same shell (nav + dimensional bg + footer) and section components. Copy below is the source; every string gets a `pages.*` key across 8 locales.

### C1. `/pricing` — `pages.pricing`

- Hero: "Pricing that tracks usage, not your transactions." / "Meridian charges for the decision layer — API usage, subscriptions and enterprise agreements. Transaction-value pricing is not offered until the applicable legal and partner requirements are met."
- Tiers (illustrative, mark "indicative"):
  - **Sandbox** — Free. "Compare routes, explore the graph, test the API. No funds, no license."
  - **Starter** — Usage-based. "Per-call metering for quotes, routes and compliance checks."
  - **Growth** — Subscription + usage. "Higher quotas, priority routing intelligence."
  - **Enterprise** — Custom. "Volume agreements, dedicated support, custom corridors."
- Note: "Prices shown are indicative and subject to change. Meridian does not take a percentage of transaction value."
- CTA: "Start in the sandbox" / "Talk to sales"

### C2. `/company/about` — `pages.about`

- Hero: "We're building the decision layer for global money movement."
- Body: "Banks, FX, stablecoins, DeFi and tokenized assets each solve one slice of moving money — in their own silo. Meridian connects them as one route graph and returns the best path, without becoming any of them. We stay non-custodial on purpose: the decision is ours, the execution stays with licensed partners."
- Sections: Mission · Principles (Non-custodial · Deterministic · Neutral) · Team (placeholder)

### C3. `/company/careers` — `pages.careers`

- Hero: "Build the layer that makes finance interoperable."
- Body: "We're a small team building financial orchestration infrastructure. If you care about correctness, regulation-aware design and clean abstractions, we'd like to talk."
- Sections: Why Meridian · Open roles (placeholder list) · How we work

### C4. `/company/partners` — `pages.partners`

- Hero: "Execution stays with licensed partners. That's the point."
- Body: "Meridian returns decisions; regulated banks, payment institutions, FX providers and settlement infrastructure execute them under their own licenses. If you operate licensed financial infrastructure, integrating as a Meridian execution partner puts your rails in front of every routed intent."
- Sections: Partner types (Banks · PSPs · FX · Stablecoin infra · Settlement) · How integration works · Become a partner (CTA)

### C5. `/company/brand` — `pages.brand`

- Hero: "Meridian brand & logos."
- Body: logo downloads, color tokens (violet/amber), typography (Fraunces + Inter), usage do/don't. (Mostly assets.)

### C6. `/company/contact` — `pages.contact`

- Hero: "Talk to us." · Simple form (name, company, message) + "For technical help, use the sandbox and docs."

### C7. `/solutions/cross-border` — `pages.solCrossBorder`

- Hero: "Find the best corridor for every cross-border intent."
- Body: "Compare bank FX, stablecoin and liquidity routes for the same corridor on one comparable model — total cost, settlement time and compliance eligibility side by side. Meridian returns the best route; your licensed partner settles it."
- Sections: The problem (fragmented corridors) · How Meridian routes it · What you get (decision + signed intent) · CTA to sandbox

### C8. `/solutions/treasury` — `pages.solTreasury`

- Hero: "Best execution for treasury flows."
- Body: "Route treasury movements across rails for lowest total cost and predictable settlement time, with compliance pre-checked per jurisdiction. Non-custodial — Meridian never holds treasury funds."
- Sections: Use cases · How it scores · CTA

### C9. `/solutions/fintechs` — `pages.solFintechs`

- Hero: "Embed the decision layer. Skip integrating every rail."
- Body: "One API gives your product best-execution routing across banks, FX, stablecoins and liquidity — without you integrating each provider or touching customer funds. Meridian returns the decision; your users' licensed providers settle."
- Sections: What you embed · Non-custodial model · Developer quickstart · CTA

### C10. `/solutions/platforms` — `pages.solPlatforms`

- Hero: "Route on behalf of your users, across borders."
- Body: "Give marketplace sellers, creators or merchants the best route for every payout intent, with compliance pre-checked per corridor. Meridian decides; licensed partners settle."
- Sections: Marketplace use cases · Compliance per corridor · CTA

### C11. `/solutions/enterprises` — `pages.solEnterprises`

- Hero: "Global corridor coverage, one decision layer."
- Body: "Standardize how your organization chooses financial routes worldwide — one comparable model across every rail, with audit and reconciliation built in."
- Sections: Coverage · Audit & control · CTA

### C12. `/trust/non-custodial` — `pages.trustNonCustodial` (IMPORTANT — regulatory anchor page)

- Hero: "Why Meridian never holds your funds."
- Body: "Meridian is a decision layer, not a money mover. It compares routes and returns a signed execution intent — a recommendation. It does not hold customer funds, private keys or wallets; it does not act as principal; and it does not execute or delegate settlement. Regulated, licensed partners perform any actual movement of money under their own authorizations."
- Sections:
  - "What Meridian does" — Discover · Decide · Coordinate (link to model)
  - "What Meridian never does" — hold funds · control keys · execute · settle · issue · custody
  - "The execution boundary" — Meridian returns a signed intent; the customer or a licensed partner initiates; Meridian never transmits on your behalf.
  - "Signature semantics" — the signature attests the recommendation is authentic and unaltered, NOT that a fund movement is authorized.
- CTA: "See how a route resolves" → `/graph` or `/how-it-works`

### C13. `/trust/security` — `pages.trustSecurity`

- Hero: "Security & data protection."
- Body: encryption, audit logging, organization isolation, deterministic backend as source of truth, no fabricated data. (Factual, no compliance claims that aren't real.)

### C14. `/resources/blog`, `/resources/playbook`, `/resources/webinars` — `pages.resources*`

- Index shells + one placeholder entry each. Playbook hero: "The financial orchestration playbook." / "How teams route across fragmented rails without becoming a money mover."

### C15. `/developers/reference`, `/developers/sdks`, `/developers/changelog`, `/developers/status` — `pages.dev*`

- `reference`: rendered API docs shell (can embed/link the existing OpenAPI JSON). Hero: "API reference."
- `sdks`: "Client libraries." (placeholder list)
- `changelog`: "What's new." (entries from real releases only — never fabricate)
- `status`: "System status." (simple operational page)

### C16. `/how-it-works` (optional shared) — `pages.howItWorks`

- Reuse the landing "How a route resolves" 4 steps as a standalone page for the Platform CTA.

---

## PART D — LOCALE RULES

- Every new key above goes in all 8 catalogs (`en, ko, ja, zh-CN, es, fr, de, pt-BR`); `npm run i18n:check` must pass (452 → 452+N parity).
- Do NOT hardcode English in components (the current `routing-api-explorer.tsx` "Assets"/"Quote a route" pattern is the anti-pattern — new menu/page copy must be catalog-driven).
- Keep the non-custodial disclosure and all `footer.*Notice` per-surface notices intact on every new page.
- CJK (ko/ja/zh) headline fallback: display font Fraunces is Latin-only; headings fall back to sans CJK stack.
