/**
 * One-shot patch: merge Phase 1 landing + footer keys into all 8 locale catalogs.
 * Run: node scripts/apply-landing-i18n.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const messagesDir = join(dirname(fileURLToPath(import.meta.url)), '../messages');
const LOCALES = ['en', 'ko', 'ja', 'zh-CN', 'es', 'fr', 'de', 'pt-BR'];

const PATCHES = {
  en: {
    landing: {
      eyebrow: 'AI Financial Orchestration Infrastructure',
      title: 'Rank every route your money could take, before it moves.',
      lede: 'Meridian reads a financial intent, compares routes across banks, FX, stablecoins and liquidity, checks compliance, and returns the best-execution decision. Your licensed partners settle.',
      pricingLine: 'pricing {dataset} · rates {rates} · {count} providers',
      ctaPrimary: 'Start in the sandbox',
      ctaSecondary: 'Read the docs',
      noncustodialNote:
        'Non-custodial by design — never holds funds or keys, never moves money on your behalf.',
      trustLine: 'Built for fintechs, platforms and treasuries operating across borders',
      model: {
        heading: 'One layer, three jobs',
        sub: 'Meridian sits above every rail and does three things — and deliberately none of the fourth: it never executes or holds.',
        discover: {
          title: 'Discover',
          body: 'Find every viable route across rails and normalize their quotes into one comparable model.',
          bullet1: 'Provider discovery',
          bullet2: 'Quote normalization',
          bullet3: 'Route graph search',
        },
        decide: {
          title: 'Decide',
          body: 'Score routes on cost, speed, liquidity, reliability and compliance, and return the best one.',
          bullet1: 'Best execution',
          bullet2: 'Compliance intelligence',
          bullet3: 'Liquidity intelligence',
        },
        coordinate: {
          title: 'Coordinate',
          body: 'Return a signed execution intent your systems and licensed partners can verify and act on.',
          bullet1: 'Signed execution intent',
          bullet2: 'Settlement orchestration',
          bullet3: 'Reconciliation & audit',
        },
      },
      features: {
        heading: 'Platform capabilities',
        item1: {
          title: 'Universal route graph',
          body: 'Fiat, banks, FX, stablecoins, chains and liquidity as one normalized graph.',
        },
        item2: {
          title: 'Best execution, explained',
          body: 'Ranked on total cost, speed, liquidity, reliability and compliance — reasoning shown.',
        },
        item3: {
          title: 'Compliance intelligence',
          body: 'Jurisdiction, provider eligibility and screening pre-checked before a route returns.',
        },
        item4: {
          title: 'Signed execution intent',
          body: 'A verifiable recommendation — not an instruction to move funds.',
        },
        item5: {
          title: 'Liquidity intelligence',
          body: 'Depth and quality scored across venues, feeding multi-hop discovery.',
        },
        item6: {
          title: 'Reconciliation & audit',
          body: 'Every decision traceable end to end, with a full audit trail.',
        },
      },
      stats: {
        stat1: '14+ rail types in one graph',
        stat2: '6-way best-execution scoring',
        stat3: '1 API: intent → route → decision',
        stat4: '0 customer funds held',
      },
      rails: {
        heading: 'Every rail, on the same axes',
        tagSandbox: 'IN SANDBOX',
        tagPartnerRequired: 'PARTNER REQUIRED',
        tagPlanned: 'PLANNED',
        tradfi: {
          title: 'Traditional finance',
          body: 'Bank transfer, FX providers, PSPs, correspondent banking.',
        },
        stablecoin: {
          title: 'Stablecoin',
          body: 'Fiat ↔ stablecoin, on/off-ramp, stable-to-stable.',
        },
        defi: {
          title: 'DeFi liquidity',
          body: 'DEX, AMM and aggregator venues, scored for depth.',
        },
        liquidity: {
          title: 'Liquidity providers',
          body: 'Wholesale liquidity feeding multi-hop discovery.',
        },
        tokenized: {
          title: 'Tokenized assets',
          body: 'Registry & routing only. Issuance stays with partners.',
        },
        treasury: {
          title: 'Treasury products',
          body: 'MMF & treasury instruments as routable destinations.',
        },
      },
      how: {
        heading: 'How a route resolves',
        step1: {
          title: 'Understand the intent',
          body: 'Natural language or a structured request becomes a normalized financial intent.',
        },
        step2: {
          title: 'Search the graph',
          body: 'Single- and multi-hop paths are enumerated across rail types — routes no single provider could quote.',
        },
        step3: {
          title: 'Check each hop',
          body: 'Jurisdiction, eligibility and liquidity are validated; ineligible hops are pruned before scoring.',
        },
        step4: {
          title: 'Return the decision',
          body: 'The best-execution route is returned as a signed intent — your partner settles it.',
        },
      },
      customers: {
        heading: 'Who builds on Meridian',
        fintechs: {
          title: 'Fintechs',
          body: 'Embed the decision layer to give users the best route without integrating every rail yourself.',
        },
        platforms: {
          title: 'Platforms & marketplaces',
          body: 'Route on behalf of your users across borders, with compliance pre-checked per corridor.',
        },
        enterprises: {
          title: 'Enterprises & treasuries',
          body: 'Optimize cross-border and treasury flows for total cost and settlement time.',
        },
      },
      dev: {
        heading: 'One API, every rail',
        body: 'Send an intent, get a scored and signed route back. The sandbox needs no funds and no license.',
        cta: 'Open API explorer',
        codeSample:
          'POST /api/v1/quote\n{\n  "sourceAsset": "USD",\n  "destinationAsset": "KRW",\n  "amount": "100000.00"\n}\n→ scored routes + signed intent',
      },
      finalCta: {
        title: 'Route your first intent today',
        body: 'Spin up a sandbox, send an intent, and see the route graph resolve. No funds move — every execution stays with your licensed partners.',
        button: 'Start in the sandbox',
      },
    },
    footer: {
      tagline: 'The non-custodial decision layer above global financial rails.',
      disclosure:
        'Meridian is non-custodial. It compares routes only — it does not hold customer funds, private keys or wallets, does not act as principal, and does not execute or delegate settlement. Quotes are indicative and non-binding; transact directly with your chosen provider.',
    },
  },
  ko: {
    landing: {
      eyebrow: 'AI 금융 오케스트레이션 인프라',
      title: '자금이 움직이기 전, 가능한 모든 경로를 순위화하세요.',
      lede: 'Meridian은 금융 인텐트를 해석하고, 은행·FX·스테이블코인·유동성 경로를 비교하며, 컴플라이언스를 확인한 뒤 최적 실행 결정을 반환합니다. 정산은 라이선스 파트너가 수행합니다.',
      ctaPrimary: 'Sandbox에서 시작',
      ctaSecondary: '문서 읽기',
      noncustodialNote: '비수탁 설계 — 자금·키를 보유하지 않으며, 고객 대신 자금을 이동시키지 않습니다.',
      trustLine: '국경을 넘나드는 핀테크, 플랫폼, 트레저리를 위해 설계됨',
      model: {
        heading: '한 레이어, 세 가지 역할',
        sub: 'Meridian은 모든 레일 위에 있으며 세 가지를 수행합니다 — 네 번째(실행·보유)는 의도적으로 하지 않습니다.',
        discover: {
          title: 'Discover',
          body: '모든 레일에서 실행 가능한 경로를 찾고 견적을 하나의 비교 가능한 모델로 정규화합니다.',
          bullet1: '공급자 탐색',
          bullet2: '견적 정규화',
          bullet3: '경로 그래프 검색',
        },
        decide: {
          title: 'Decide',
          body: '비용, 속도, 유동성, 신뢰성, 컴플라이언스로 경로를 점수화하고 최적 경로를 반환합니다.',
          bullet1: '최적 실행',
          bullet2: '컴플라이언스 인텔리전스',
          bullet3: '유동성 인텔리전스',
        },
        coordinate: {
          title: 'Coordinate',
          body: '시스템과 라이선스 파트너가 검증하고 활용할 수 있는 서명된 실행 인텐트를 반환합니다.',
          bullet1: '서명된 실행 인텐트',
          bullet2: '정산 오케스트레이션',
          bullet3: '대사 및 감사',
        },
      },
      features: {
        heading: '플랫폼 역량',
        item1: { title: '범용 경로 그래프', body: '법정화폐, 은행, FX, 스테이블코인, 체인, 유동성을 하나의 정규화된 그래프로.' },
        item2: { title: '설명 가능한 최적 실행', body: '총 비용, 속도, 유동성, 신뢰성, 컴플라이언스 기준 순위 — 근거 표시.' },
        item3: { title: '컴플라이언스 인텔리전스', body: '경로 반환 전 관할, 공급자 적격성, 스크리닝 사전 확인.' },
        item4: { title: '서명된 실행 인텐트', body: '검증 가능한 권고 — 자금 이동 지시가 아닙니다.' },
        item5: { title: '유동성 인텔리전스', body: '거래소별 깊이·품질 점수, 다중 홉 탐색에 활용.' },
        item6: { title: '대사 및 감사', body: '모든 결정을 종단 간 추적, 전체 감사 기록.' },
      },
      stats: {
        stat1: '하나의 그래프에 14+ 레일 유형',
        stat2: '6축 최적 실행 점수',
        stat3: '1 API: 인텐트 → 경로 → 결정',
        stat4: '보유 고객 자금 0',
      },
      rails: {
        heading: '모든 레일, 동일한 축',
        tagSandbox: 'SANDBOX',
        tagPartnerRequired: '파트너 필요',
        tagPlanned: '예정',
        tradfi: { title: '전통 금융', body: '은행 이체, FX 공급자, PSP, 코리스폰던트 뱅킹.' },
        stablecoin: { title: '스테이블코인', body: '법정화폐 ↔ 스테이블코인, 온/오프램프, 스테이블 간.' },
        defi: { title: 'DeFi 유동성', body: 'DEX, AMM, 애그리게이터 거래소 — 깊이 점수.' },
        liquidity: { title: '유동성 공급자', body: '다중 홉 탐색을 위한 도매 유동성.' },
        tokenized: { title: '토큰화 자산', body: '레지스트리·라우팅만. 발행은 파트너.' },
        treasury: { title: '트레저리 상품', body: 'MMF 및 트레저리 상품을 라우팅 대상으로.' },
      },
      how: {
        heading: '경로가 해결되는 방식',
        step1: { title: '인텐트 이해', body: '자연어 또는 구조화된 요청이 정규화된 금융 인텐트가 됩니다.' },
        step2: { title: '그래프 검색', body: '단일·다중 홉 경로를 레일 유형별로 열거 — 단일 공급자가 견적할 수 없는 경로.' },
        step3: { title: '각 홉 검증', body: '관할, 적격성, 유동성 검증; 부적격 홉은 점수화 전 제거.' },
        step4: { title: '결정 반환', body: '최적 실행 경로가 서명된 인텐트로 반환 — 파트너가 정산합니다.' },
      },
      customers: {
        heading: 'Meridian 위에 구축하는 주체',
        fintechs: { title: '핀테크', body: '모든 레일을 직접 통합하지 않고 사용자에게 최적 경로를 제공하는 결정 레이어 임베드.' },
        platforms: { title: '플랫폼·마켓플레이스', body: '관할별 컴플라이언스 사전 확인과 함께 사용자 대신 국경 간 라우팅.' },
        enterprises: { title: '기업·트레저리', body: '총 비용과 정산 시간 기준으로 국경 간·트레저리 흐름 최적화.' },
      },
      dev: {
        heading: '하나의 API, 모든 레일',
        body: '인텐트를 보내면 점수화·서명된 경로를 받습니다. Sandbox에는 자금·라이선스가 필요 없습니다.',
        cta: 'API 탐색기 열기',
        codeSample: 'POST /api/v1/quote\n{\n  "sourceAsset": "USD",\n  "destinationAsset": "KRW",\n  "amount": "100000.00"\n}\n→ 점수화된 경로 + 서명된 인텐트',
      },
      finalCta: {
        title: '오늘 첫 인텐트를 라우팅하세요',
        body: 'Sandbox를 시작하고 인텐트를 보내 경로 그래프가 해결되는 것을 확인하세요. 자금은 이동하지 않습니다 — 실행은 라이선스 파트너가 담당합니다.',
        button: 'Sandbox에서 시작',
      },
    },
    footer: {
      tagline: '글로벌 금융 레일 위의 비수탁 결정 레이어.',
      disclosure:
        'Meridian은 비수탁입니다. 경로만 비교합니다 — 고객 자금·개인키·지갑을 보유하지 않고, 본인(principal)으로 행위하지 않으며, 정산을 실행하거나 위임하지 않습니다. 견적은 참고용이며 구속력이 없습니다. 선택한 공급자와 직접 거래하세요.',
    },
  },
};

// For brevity in script - ja, zh-CN, es, fr, de, pt-BR will be generated from en with locale-specific translations inline below
const MORE = {
  ja: {
    landing: {
      eyebrow: 'AI金融オーケストレーション基盤',
      title: '資金が動く前に、取り得るすべての経路をランク付け。',
      lede: 'Meridianは金融インテントを解釈し、銀行・FX・ステーブルコイン・流動性の経路を比較し、コンプライアンスを確認したうえで最適実行の判断を返します。決済はライセンスパートナーが行います。',
      ctaPrimary: 'Sandboxで開始',
      ctaSecondary: 'ドキュメントを読む',
      noncustodialNote: '非カストディアル設計 — 資金・鍵を保持せず、代わりに資金を動かしません。',
      trustLine: '国境を越えるフィンテック、プラットフォーム、トレジャリー向け',
      model: {
        heading: '1レイヤー、3つの役割',
        sub: 'Meridianはすべてのレールの上にあり、3つのことを行います — 4つ目（実行・保有）は意図的に行いません。',
        discover: { title: 'Discover', body: 'すべてのレールで実行可能な経路を見つけ、見積もりを1つの比較可能なモデルに正規化します。', bullet1: 'プロバイダー探索', bullet2: '見積正規化', bullet3: '経路グラフ検索' },
        decide: { title: 'Decide', body: 'コスト、速度、流動性、信頼性、コンプライアンスで経路をスコアし、最良の1つを返します。', bullet1: '最適実行', bullet2: 'コンプライアンス・インテリジェンス', bullet3: '流動性インテリジェンス' },
        coordinate: { title: 'Coordinate', body: 'システムとライセンスパートナーが検証・活用できる署名付き実行インテントを返します。', bullet1: '署名付き実行インテント', bullet2: '決済オーケストレーション', bullet3: '照合と監査' },
      },
      features: {
        heading: 'プラットフォーム機能',
        item1: { title: '汎用経路グラフ', body: '法定通貨、銀行、FX、ステーブルコイン、チェーン、流動性を1つの正規化グラフに。' },
        item2: { title: '説明可能な最適実行', body: '総コスト、速度、流動性、信頼性、コンプライアンスでランク — 根拠を表示。' },
        item3: { title: 'コンプライアンス・インテリジェンス', body: '経路返却前に管轄、プロバイダー適格性、スクリーニングを事前確認。' },
        item4: { title: '署名付き実行インテント', body: '検証可能な推奨 — 資金移動の指示ではありません。' },
        item5: { title: '流動性インテリジェンス', body: '会場ごとの深度・品質スコア、マルチホップ探索に活用。' },
        item6: { title: '照合と監査', body: 'すべての判断をエンドツーエンドで追跡、完全な監査証跡。' },
      },
      stats: { stat1: '1グラフに14+レール種別', stat2: '6軸最適実行スコア', stat3: '1 API: インテント → 経路 → 判断', stat4: '保持する顧客資金 0' },
      rails: {
        heading: 'すべてのレール、同じ軸',
        tagSandbox: 'SANDBOX', tagPartnerRequired: 'パートナー必須', tagPlanned: '予定',
        tradfi: { title: '伝統的金融', body: '銀行振込、FXプロバイダー、PSP、コルレス銀行。' },
        stablecoin: { title: 'ステーブルコイン', body: '法定通貨 ↔ ステーブル、オン/オフランプ、ステーブル間。' },
        defi: { title: 'DeFi流動性', body: 'DEX、AMM、アグリゲーター会場 — 深度スコア。' },
        liquidity: { title: '流動性プロバイダー', body: 'マルチホップ探索のための卸売流動性。' },
        tokenized: { title: 'トークン化資産', body: 'レジストリ・ルーティングのみ。発行はパートナー。' },
        treasury: { title: 'トレジャリー商品', body: 'MMF・トレジャリー商品をルーティング先に。' },
      },
      how: {
        heading: '経路が解決される流れ',
        step1: { title: 'インテントを理解', body: '自然言語または構造化リクエストが正規化された金融インテントになります。' },
        step2: { title: 'グラフを検索', body: '単一・マルチホップ経路をレール種別ごとに列挙 — 単一プロバイダーでは見積もれない経路。' },
        step3: { title: '各ホップを確認', body: '管轄、適格性、流動性を検証。不適格ホップはスコア前に除外。' },
        step4: { title: '判断を返す', body: '最適実行経路が署名付きインテントとして返る — パートナーが決済。' },
      },
      customers: {
        heading: 'Meridian上に構築する主体',
        fintechs: { title: 'フィンテック', body: 'すべてのレールを自前統合せず、ユーザーに最良経路を提供する決定レイヤーを組み込み。' },
        platforms: { title: 'プラットフォーム・マーケットプレイス', body: '回廊ごとにコンプライアンス事前確認し、ユーザーに代わって国境越えルーティング。' },
        enterprises: { title: '企業・トレジャリー', body: '総コストと決済時間で国境越え・トレジャリーフローを最適化。' },
      },
      dev: { heading: '1 API、すべてのレール', body: 'インテントを送るとスコア付き署名経路が返ります。Sandboxに資金・ライセンスは不要。', cta: 'APIエクスプローラーを開く', codeSample: 'POST /api/v1/quote\n{\n  "sourceAsset": "USD",\n  "destinationAsset": "KRW",\n  "amount": "100000.00"\n}\n→ スコア付き経路 + 署名インテント' },
      finalCta: { title: '今日最初のインテントをルーティング', body: 'Sandboxを起動しインテントを送り、経路グラフの解決を確認。資金は動きません — 実行はライセンスパートナー。', button: 'Sandboxで開始' },
    },
    footer: { tagline: 'グローバル金融レール上の非カストディアル決定レイヤー。', disclosure: 'Meridianは非カストディアルです。経路の比較のみ — 顧客資金・秘密鍵・ウォレットを保持せず、本人(principal)として行為せず、決済を実行・委任しません。見積もりは参考値で拘束力なし。選択したプロバイダーと直接取引してください。' },
  },
};

Object.assign(PATCHES, MORE);

// zh-CN, es, fr, de, pt-BR - add compact but real translations
Object.assign(PATCHES, {
  'zh-CN': {
    landing: {
      eyebrow: 'AI 金融编排基础设施',
      title: '在资金移动之前，为每一条可能的路径排名。',
      lede: 'Meridian 解读金融意图，比较银行、FX、稳定币与流动性路径，检查合规，并返回最佳执行决策。结算由持牌合作伙伴完成。',
      ctaPrimary: '在 Sandbox 中开始', ctaSecondary: '阅读文档',
      noncustodialNote: '非托管设计 — 不持有资金或密钥，也不代您移动资金。',
      trustLine: '为跨境运营的金融科技、平台与财资团队而建',
      model: {
        heading: '一层，三项职责', sub: 'Meridian 位于所有轨道之上，做三件事 —  deliberately 不做第四项：从不执行或持有。',
        discover: { title: 'Discover', body: '在所有轨道中发现可行路径，并将报价规范为单一可比模型。', bullet1: '提供商发现', bullet2: '报价规范化', bullet3: '路径图搜索' },
        decide: { title: 'Decide', body: '按成本、速度、流动性、可靠性与合规为路径评分，返回最优路径。', bullet1: '最佳执行', bullet2: '合规情报', bullet3: '流动性情报' },
        coordinate: { title: 'Coordinate', body: '返回您的系统与持牌合作伙伴可验证并使用的签名执行意图。', bullet1: '签名执行意图', bullet2: '结算编排', bullet3: '对账与审计' },
      },
      features: {
        heading: '平台能力',
        item1: { title: '通用路径图', body: '法币、银行、FX、稳定币、链与流动性统一为一张规范化图。' },
        item2: { title: '可解释的最佳执行', body: '按总成本、速度、流动性、可靠性与合规排名 — 展示理由。' },
        item3: { title: '合规情报', body: '返回路径前预检管辖区、提供商资格与筛查。' },
        item4: { title: '签名执行意图', body: '可验证的建议 — 不是移动资金的指令。' },
        item5: { title: '流动性情报', body: '各场所深度与质量评分，支持多跳发现。' },
        item6: { title: '对账与审计', body: '每个决策端到端可追溯，完整审计轨迹。' },
      },
      stats: { stat1: '一张图涵盖 14+ 轨道类型', stat2: '六维最佳执行评分', stat3: '1 个 API：意图 → 路径 → 决策', stat4: '持有客户资金：0' },
      rails: {
        heading: '所有轨道，同一套维度', tagSandbox: 'SANDBOX', tagPartnerRequired: '需合作伙伴', tagPlanned: '规划中',
        tradfi: { title: '传统金融', body: '银行转账、FX 提供商、PSP、代理行。' },
        stablecoin: { title: '稳定币', body: '法币 ↔ 稳定币、出入金、稳定币互换。' },
        defi: { title: 'DeFi 流动性', body: 'DEX、AMM 与聚合场所，按深度评分。' },
        liquidity: { title: '流动性提供商', body: '支撑多跳发现的批发流动性。' },
        tokenized: { title: '代币化资产', body: '仅注册与路由；发行由合作伙伴完成。' },
        treasury: { title: '财资产品', body: 'MMF 与财资工具作为可路由目的地。' },
      },
      how: {
        heading: '路径如何解析',
        step1: { title: '理解意图', body: '自然语言或结构化请求变为规范化金融意图。' },
        step2: { title: '搜索路径图', body: '按轨道类型枚举单跳与多跳路径 — 单一提供商无法报价的路径。' },
        step3: { title: '检查每一跳', body: '验证管辖区、资格与流动性；评分前剔除不合格跳。' },
        step4: { title: '返回决策', body: '最佳执行路径以签名意图返回 — 由合作伙伴结算。' },
      },
      customers: {
        heading: '谁在 Meridian 上构建',
        fintechs: { title: '金融科技', body: '嵌入决策层，无需自行集成每条轨道即可为用户提供最优路径。' },
        platforms: { title: '平台与市场', body: '代表用户跨境路由，每条走廊预检合规。' },
        enterprises: { title: '企业与财资', body: '按总成本与结算时间优化跨境与财资流。' },
      },
      dev: { heading: '一个 API，所有轨道', body: '发送意图，获得评分与签名的路径。Sandbox 无需资金与牌照。', cta: '打开 API 探索器', codeSample: 'POST /api/v1/quote\n{\n  "sourceAsset": "USD",\n  "destinationAsset": "KRW",\n  "amount": "100000.00"\n}\n→ 评分路径 + 签名意图' },
      finalCta: { title: '今天路由您的第一个意图', body: '启动 Sandbox，发送意图，观看路径图解析。资金不移动 — 执行由持牌合作伙伴完成。', button: '在 Sandbox 中开始' },
    },
    footer: { tagline: '全球金融轨道之上的非托管决策层。', disclosure: 'Meridian 非托管。仅比较路径 — 不持有客户资金、私钥或钱包，不以本人身份行事，不执行或委托结算。报价仅供参考、无约束力；请直接与您选择的提供商交易。' },
  },
  es: {
    landing: {
      eyebrow: 'Infraestructura de orquestación financiera con IA',
      title: 'Clasifique cada ruta que su dinero podría tomar, antes de que se mueva.',
      lede: 'Meridian interpreta una intención financiera, compara rutas bancarias, FX, stablecoins y liquidez, verifica cumplimiento y devuelve la decisión de mejor ejecución. Sus socios con licencia liquidan.',
      ctaPrimary: 'Empezar en el sandbox', ctaSecondary: 'Leer la documentación',
      noncustodialNote: 'No custodial por diseño — nunca retiene fondos ni claves, ni mueve dinero en su nombre.',
      trustLine: 'Para fintechs, plataformas y tesorerías que operan entre fronteras',
      model: {
        heading: 'Una capa, tres funciones', sub: 'Meridian está sobre cada rail y hace tres cosas — deliberadamente no la cuarta: nunca ejecuta ni retiene.',
        discover: { title: 'Discover', body: 'Encuentre cada ruta viable entre rails y normalice sus cotizaciones en un modelo comparable.', bullet1: 'Descubrimiento de proveedores', bullet2: 'Normalización de cotizaciones', bullet3: 'Búsqueda en el grafo de rutas' },
        decide: { title: 'Decide', body: 'Puntúe rutas por coste, velocidad, liquidez, fiabilidad y cumplimiento, y devuelva la mejor.', bullet1: 'Mejor ejecución', bullet2: 'Inteligencia de cumplimiento', bullet3: 'Inteligencia de liquidez' },
        coordinate: { title: 'Coordinate', body: 'Devuelva una intención de ejecución firmada que sus sistemas y socios con licencia puedan verificar.', bullet1: 'Intención de ejecución firmada', bullet2: 'Orquestación de liquidación', bullet3: 'Conciliación y auditoría' },
      },
      features: {
        heading: 'Capacidades de la plataforma',
        item1: { title: 'Grafo de rutas universal', body: 'Fiat, bancos, FX, stablecoins, cadenas y liquidez en un grafo normalizado.' },
        item2: { title: 'Mejor ejecución explicada', body: 'Clasificado por coste total, velocidad, liquidez, fiabilidad y cumplimiento — con razonamiento.' },
        item3: { title: 'Inteligencia de cumplimiento', body: 'Jurisdicción, elegibilidad y screening verificados antes de devolver una ruta.' },
        item4: { title: 'Intención de ejecución firmada', body: 'Una recomendación verificable — no una instrucción de mover fondos.' },
        item5: { title: 'Inteligencia de liquidez', body: 'Profundidad y calidad puntuadas en venues, alimentando descubrimiento multi-salto.' },
        item6: { title: 'Conciliación y auditoría', body: 'Cada decisión trazable de extremo a extremo, con auditoría completa.' },
      },
      stats: { stat1: '14+ tipos de rail en un grafo', stat2: 'Puntuación de mejor ejecución en 6 ejes', stat3: '1 API: intención → ruta → decisión', stat4: '0 fondos de clientes retenidos' },
      rails: {
        heading: 'Cada rail, en los mismos ejes', tagSandbox: 'EN SANDBOX', tagPartnerRequired: 'SOCIO REQUERIDO', tagPlanned: 'PLANIFICADO',
        tradfi: { title: 'Finanzas tradicionales', body: 'Transferencia bancaria, FX, PSPs, banca corresponsal.' },
        stablecoin: { title: 'Stablecoin', body: 'Fiat ↔ stablecoin, on/off-ramp, stable a stable.' },
        defi: { title: 'Liquidez DeFi', body: 'DEX, AMM y agregadores, puntuados por profundidad.' },
        liquidity: { title: 'Proveedores de liquidez', body: 'Liquidez mayorista para descubrimiento multi-salto.' },
        tokenized: { title: 'Activos tokenizados', body: 'Solo registro y routing. Emisión con socios.' },
        treasury: { title: 'Productos de tesorería', body: 'MMF e instrumentos de tesorería como destinos enrutables.' },
      },
      how: {
        heading: 'Cómo se resuelve una ruta',
        step1: { title: 'Entender la intención', body: 'Lenguaje natural o solicitud estructurada se convierte en intención financiera normalizada.' },
        step2: { title: 'Buscar en el grafo', body: 'Rutas mono- y multi-salto entre tipos de rail — rutas que un solo proveedor no cotizaría.' },
        step3: { title: 'Comprobar cada salto', body: 'Jurisdicción, elegibilidad y liquidez validadas; saltos inelegibles eliminados antes de puntuar.' },
        step4: { title: 'Devolver la decisión', body: 'La ruta de mejor ejecución vuelve como intención firmada — su socio liquida.' },
      },
      customers: {
        heading: 'Quién construye sobre Meridian',
        fintechs: { title: 'Fintechs', body: 'Incruste la capa de decisión para ofrecer la mejor ruta sin integrar cada rail.' },
        platforms: { title: 'Plataformas y marketplaces', body: 'Enrute en nombre de sus usuarios entre fronteras, con cumplimiento prechequeado por corredor.' },
        enterprises: { title: 'Empresas y tesorerías', body: 'Optimice flujos transfronterizos y de tesorería por coste total y tiempo de liquidación.' },
      },
      dev: { heading: 'Una API, cada rail', body: 'Envíe una intención, reciba una ruta puntuada y firmada. El sandbox no requiere fondos ni licencia.', cta: 'Abrir explorador API', codeSample: 'POST /api/v1/quote\n{\n  "sourceAsset": "USD",\n  "destinationAsset": "KRW",\n  "amount": "100000.00"\n}\n→ rutas puntuadas + intención firmada' },
      finalCta: { title: 'Enrute su primera intención hoy', body: 'Active un sandbox, envíe una intención y vea resolver el grafo. No se mueven fondos — la ejecución queda con socios con licencia.', button: 'Empezar en el sandbox' },
    },
    footer: { tagline: 'La capa de decisión no custodial sobre los rails financieros globales.', disclosure: 'Meridian es no custodial. Solo compara rutas — no retiene fondos, claves ni wallets de clientes, no actúa como principal ni ejecuta o delega liquidación. Las cotizaciones son indicativas y no vinculantes; opere directamente con su proveedor elegido.' },
  },
  fr: {
    landing: {
      eyebrow: 'Infrastructure d\'orchestration financière IA',
      title: 'Classez chaque route que votre argent pourrait emprunter, avant qu\'il ne bouge.',
      lede: 'Meridian lit une intention financière, compare les routes banque, FX, stablecoins et liquidité, vérifie la conformité et renvoie la décision de meilleure exécution. Vos partenaires agréés règlent.',
      ctaPrimary: 'Démarrer dans le sandbox', ctaSecondary: 'Lire la documentation',
      noncustodialNote: 'Non custodial par conception — ne détient jamais fonds ni clés, ne déplace pas d\'argent pour vous.',
      trustLine: 'Pour fintechs, plateformes et trésoreries opérant à l\'international',
      model: {
        heading: 'Une couche, trois rôles', sub: 'Meridian se place au-dessus de chaque rail et fait trois choses — jamais la quatrième : exécuter ou détenir.',
        discover: { title: 'Discover', body: 'Trouvez chaque route viable entre rails et normalisez les devis en un modèle comparable.', bullet1: 'Découverte de fournisseurs', bullet2: 'Normalisation des devis', bullet3: 'Recherche dans le graphe de routes' },
        decide: { title: 'Decide', body: 'Scorez les routes sur coût, vitesse, liquidité, fiabilité et conformité, renvoyez la meilleure.', bullet1: 'Meilleure exécution', bullet2: 'Intelligence conformité', bullet3: 'Intelligence liquidité' },
        coordinate: { title: 'Coordinate', body: 'Renvoyez une intention d\'exécution signée que vos systèmes et partenaires agréés peuvent vérifier.', bullet1: 'Intention d\'exécution signée', bullet2: 'Orchestration de règlement', bullet3: 'Rapprochement et audit' },
      },
      features: {
        heading: 'Capacités plateforme',
        item1: { title: 'Graphe de routes universel', body: 'Fiat, banques, FX, stablecoins, chaînes et liquidité en un graphe normalisé.' },
        item2: { title: 'Meilleure exécution expliquée', body: 'Classé sur coût total, vitesse, liquidité, fiabilité et conformité — raisonnement affiché.' },
        item3: { title: 'Intelligence conformité', body: 'Juridiction, éligibilité fournisseur et screening vérifiés avant retour de route.' },
        item4: { title: 'Intention d\'exécution signée', body: 'Une recommandation vérifiable — pas une instruction de déplacer des fonds.' },
        item5: { title: 'Intelligence liquidité', body: 'Profondeur et qualité scorées sur les venues, alimentant la découverte multi-sauts.' },
        item6: { title: 'Rapprochement et audit', body: 'Chaque décision traçable de bout en bout, piste d\'audit complète.' },
      },
      stats: { stat1: '14+ types de rails dans un graphe', stat2: 'Score meilleure exécution en 6 axes', stat3: '1 API : intention → route → décision', stat4: '0 fonds clients détenus' },
      rails: {
        heading: 'Chaque rail, mêmes axes', tagSandbox: 'EN SANDBOX', tagPartnerRequired: 'PARTENAIRE REQUIS', tagPlanned: 'PRÉVU',
        tradfi: { title: 'Finance traditionnelle', body: 'Virement bancaire, FX, PSP, banque correspondante.' },
        stablecoin: { title: 'Stablecoin', body: 'Fiat ↔ stablecoin, on/off-ramp, stable à stable.' },
        defi: { title: 'Liquidité DeFi', body: 'DEX, AMM et agrégateurs, scorés pour la profondeur.' },
        liquidity: { title: 'Fournisseurs de liquidité', body: 'Liquidité de gros pour découverte multi-sauts.' },
        tokenized: { title: 'Actifs tokenisés', body: 'Registre et routing uniquement. Émission chez les partenaires.' },
        treasury: { title: 'Produits trésorerie', body: 'MMF et instruments trésorerie comme destinations routables.' },
      },
      how: {
        heading: 'Comment une route se résout',
        step1: { title: 'Comprendre l\'intention', body: 'Langage naturel ou requête structurée devient intention financière normalisée.' },
        step2: { title: 'Parcourir le graphe', body: 'Chemins mono- et multi-sauts énumérés — routes qu\'un seul fournisseur ne coterait pas.' },
        step3: { title: 'Vérifier chaque saut', body: 'Juridiction, éligibilité et liquidité validées ; sauts inéligibles éliminés avant score.' },
        step4: { title: 'Renvoyer la décision', body: 'La route de meilleure exécution revient comme intention signée — votre partenaire règle.' },
      },
      customers: {
        heading: 'Qui construit sur Meridian',
        fintechs: { title: 'Fintechs', body: 'Intégrez la couche de décision sans connecter chaque rail vous-même.' },
        platforms: { title: 'Plateformes et marketplaces', body: 'Routez pour vos utilisateurs à l\'international, conformité pré-vérifiée par corridor.' },
        enterprises: { title: 'Entreprises et trésoreries', body: 'Optimisez flux transfrontaliers et trésorerie sur coût total et délai de règlement.' },
      },
      dev: { heading: 'Une API, chaque rail', body: 'Envoyez une intention, recevez une route scorée et signée. Le sandbox ne demande ni fonds ni licence.', cta: 'Ouvrir l\'explorateur API', codeSample: 'POST /api/v1/quote\n{\n  "sourceAsset": "USD",\n  "destinationAsset": "KRW",\n  "amount": "100000.00"\n}\n→ routes scorées + intention signée' },
      finalCta: { title: 'Routez votre première intention aujourd\'hui', body: 'Lancez un sandbox, envoyez une intention, voyez le graphe se résoudre. Aucun fonds ne bouge — l\'exécution reste chez vos partenaires agréés.', button: 'Démarrer dans le sandbox' },
    },
    footer: { tagline: 'La couche de décision non custodiale au-dessus des rails financiers mondiaux.', disclosure: 'Meridian est non custodial. Il compare les routes uniquement — il ne détient pas fonds, clés ou wallets clients, n\'agit pas comme principal et n\'exécute ni ne délègue le règlement. Devis indicatifs et non contraignants ; transigez directement avec le fournisseur choisi.' },
  },
  de: {
    landing: {
      eyebrow: 'KI-Finanzorchestrierungs-Infrastruktur',
      title: 'Bewerten Sie jede Route, die Ihr Geld nehmen könnte, bevor es sich bewegt.',
      lede: 'Meridian liest eine Finanzintention, vergleicht Routen über Banken, FX, Stablecoins und Liquidität, prüft Compliance und liefert die Best-Execution-Entscheidung. Ihre lizenzierten Partner führen die Abwicklung durch.',
      ctaPrimary: 'Im Sandbox starten', ctaSecondary: 'Dokumentation lesen',
      noncustodialNote: 'Non-custodial by Design — hält keine Mittel oder Schlüssel, bewegt kein Geld in Ihrem Namen.',
      trustLine: 'Für Fintechs, Plattformen und Treasury-Teams mit grenzüberschreitendem Geschäft',
      model: {
        heading: 'Eine Schicht, drei Aufgaben', sub: 'Meridian sitzt über jedem Rail und erledigt drei Dinge — bewusst nicht das vierte: nie ausführen oder halten.',
        discover: { title: 'Discover', body: 'Finden Sie jede viable Route über Rails und normalisieren Sie Angebote in ein vergleichbares Modell.', bullet1: 'Provider-Discovery', bullet2: 'Angebotsnormalisierung', bullet3: 'Routengraph-Suche' },
        decide: { title: 'Decide', body: 'Bewerten Sie Routen nach Kosten, Geschwindigkeit, Liquidität, Zuverlässigkeit und Compliance.', bullet1: 'Best Execution', bullet2: 'Compliance-Intelligence', bullet3: 'Liquiditäts-Intelligence' },
        coordinate: { title: 'Coordinate', body: 'Liefern Sie eine signierte Ausführungsintention, die Systeme und lizenzierte Partner prüfen können.', bullet1: 'Signierte Ausführungsintention', bullet2: 'Settlement-Orchestrierung', bullet3: 'Abstimmung & Audit' },
      },
      features: {
        heading: 'Plattform-Fähigkeiten',
        item1: { title: 'Universeller Routengraph', body: 'Fiat, Banken, FX, Stablecoins, Chains und Liquidität in einem normalisierten Graph.' },
        item2: { title: 'Best Execution erklärt', body: 'Gerankt nach Gesamtkosten, Geschwindigkeit, Liquidität, Zuverlässigkeit, Compliance — mit Begründung.' },
        item3: { title: 'Compliance-Intelligence', body: 'Jurisdiktion, Provider-Eignung und Screening vor Routenrückgabe geprüft.' },
        item4: { title: 'Signierte Ausführungsintention', body: 'Eine verifizierbare Empfehlung — keine Anweisung zur Geldbewegung.' },
        item5: { title: 'Liquiditäts-Intelligence', body: 'Tiefe und Qualität über Venues bewertet, für Multi-Hop-Discovery.' },
        item6: { title: 'Abstimmung & Audit', body: 'Jede Entscheidung end-to-end nachverfolgbar, vollständiger Audit-Trail.' },
      },
      stats: { stat1: '14+ Rail-Typen in einem Graph', stat2: '6-Achsen Best-Execution-Scoring', stat3: '1 API: Intention → Route → Entscheidung', stat4: '0 gehaltene Kundengelder' },
      rails: {
        heading: 'Jeder Rail, dieselben Achsen', tagSandbox: 'IM SANDBOX', tagPartnerRequired: 'PARTNER ERFORDERLICH', tagPlanned: 'GEPLANT',
        tradfi: { title: 'Traditionelle Finanzwelt', body: 'Banküberweisung, FX-Provider, PSPs, Korrespondenzbanken.' },
        stablecoin: { title: 'Stablecoin', body: 'Fiat ↔ Stablecoin, On/Off-Ramp, Stable-zu-Stable.' },
        defi: { title: 'DeFi-Liquidität', body: 'DEX, AMM und Aggregatoren, nach Tiefe bewertet.' },
        liquidity: { title: 'Liquiditätsprovider', body: 'Großhandelsliquidität für Multi-Hop-Discovery.' },
        tokenized: { title: 'Tokenisierte Assets', body: 'Nur Registry & Routing. Emission bei Partnern.' },
        treasury: { title: 'Treasury-Produkte', body: 'MMF & Treasury-Instrumente als routbare Ziele.' },
      },
      how: {
        heading: 'Wie eine Route aufgelöst wird',
        step1: { title: 'Intention verstehen', body: 'Natürliche Sprache oder strukturierte Anfrage wird normalisierte Finanzintention.' },
        step2: { title: 'Graph durchsuchen', body: 'Single- und Multi-Hop-Pfade über Rail-Typen — Routen, die kein einzelner Provider quotieren könnte.' },
        step3: { title: 'Jeden Hop prüfen', body: 'Jurisdiktion, Eignung und Liquidität validiert; ungeeignete Hops vor Scoring entfernt.' },
        step4: { title: 'Entscheidung zurückgeben', body: 'Best-Execution-Route als signierte Intention — Ihr Partner wickelt ab.' },
      },
      customers: {
        heading: 'Wer auf Meridian baut',
        fintechs: { title: 'Fintechs', body: 'Decision Layer einbetten, ohne jeden Rail selbst zu integrieren.' },
        platforms: { title: 'Plattformen & Marktplätze', body: 'Routing für Nutzer grenzüberschreitend, Compliance pro Korridor vorab geprüft.' },
        enterprises: { title: 'Unternehmen & Treasury', body: 'Grenzüberschreitende und Treasury-Flows nach Gesamtkosten und Settlement-Zeit optimieren.' },
      },
      dev: { heading: 'Eine API, jeder Rail', body: 'Intention senden, bewertete und signierte Route erhalten. Sandbox braucht keine Mittel und keine Lizenz.', cta: 'API-Explorer öffnen', codeSample: 'POST /api/v1/quote\n{\n  "sourceAsset": "USD",\n  "destinationAsset": "KRW",\n  "amount": "100000.00"\n}\n→ bewertete Routen + signierte Intention' },
      finalCta: { title: 'Route heute Ihre erste Intention', body: 'Sandbox starten, Intention senden, Routengraph auflösen sehen. Keine Geldbewegung — Ausführung bei lizenzierten Partnern.', button: 'Im Sandbox starten' },
    },
    footer: { tagline: 'Die non-custodiale Entscheidungsschicht über globalen Finanzrails.', disclosure: 'Meridian ist non-custodial. Es vergleicht nur Routen — hält keine Kundengelder, privaten Schlüssel oder Wallets, handelt nicht als Principal und führt keine Abwicklung aus oder delegiert sie. Angebote sind indikativ und unverbindlich; handeln Sie direkt mit Ihrem gewählten Provider.' },
  },
  'pt-BR': {
    landing: {
      eyebrow: 'Infraestrutura de orquestração financeira com IA',
      title: 'Classifique cada rota que seu dinheiro poderia tomar, antes de se mover.',
      lede: 'Meridian lê uma intenção financeira, compara rotas bancárias, FX, stablecoins e liquidez, verifica conformidade e devolve a decisão de melhor execução. Seus parceiros licenciados liquidam.',
      ctaPrimary: 'Começar no sandbox', ctaSecondary: 'Ler a documentação',
      noncustodialNote: 'Não custodial por design — nunca retém fundos ou chaves, nem move dinheiro em seu nome.',
      trustLine: 'Para fintechs, plataformas e tesourarias que operam entre fronteiras',
      model: {
        heading: 'Uma camada, três funções', sub: 'Meridian fica acima de cada rail e faz três coisas — deliberadamente não a quarta: nunca executa nem retém.',
        discover: { title: 'Discover', body: 'Encontre cada rota viável entre rails e normalize cotações em um modelo comparável.', bullet1: 'Descoberta de provedores', bullet2: 'Normalização de cotações', bullet3: 'Busca no grafo de rotas' },
        decide: { title: 'Decide', body: 'Pontue rotas por custo, velocidade, liquidez, confiabilidade e conformidade, e devolva a melhor.', bullet1: 'Melhor execução', bullet2: 'Inteligência de conformidade', bullet3: 'Inteligência de liquidez' },
        coordinate: { title: 'Coordinate', body: 'Devolva uma intenção de execução assinada que seus sistemas e parceiros licenciados possam verificar.', bullet1: 'Intenção de execução assinada', bullet2: 'Orquestração de liquidação', bullet3: 'Reconciliação e auditoria' },
      },
      features: {
        heading: 'Capacidades da plataforma',
        item1: { title: 'Grafo de rotas universal', body: 'Fiat, bancos, FX, stablecoins, chains e liquidez em um grafo normalizado.' },
        item2: { title: 'Melhor execução explicada', body: 'Classificado por custo total, velocidade, liquidez, confiabilidade e conformidade — com raciocínio.' },
        item3: { title: 'Inteligência de conformidade', body: 'Jurisdição, elegibilidade e screening verificados antes de devolver uma rota.' },
        item4: { title: 'Intenção de execução assinada', body: 'Uma recomendação verificável — não uma instrução para mover fundos.' },
        item5: { title: 'Inteligência de liquidez', body: 'Profundidade e qualidade pontuadas em venues, alimentando descoberta multi-salto.' },
        item6: { title: 'Reconciliação e auditoria', body: 'Cada decisão rastreável ponta a ponta, trilha de auditoria completa.' },
      },
      stats: { stat1: '14+ tipos de rail em um grafo', stat2: 'Pontuação de melhor execução em 6 eixos', stat3: '1 API: intenção → rota → decisão', stat4: '0 fundos de clientes retidos' },
      rails: {
        heading: 'Cada rail, nos mesmos eixos', tagSandbox: 'NO SANDBOX', tagPartnerRequired: 'PARCEIRO NECESSÁRIO', tagPlanned: 'PLANEJADO',
        tradfi: { title: 'Finanças tradicionais', body: 'Transferência bancária, FX, PSPs, banco correspondente.' },
        stablecoin: { title: 'Stablecoin', body: 'Fiat ↔ stablecoin, on/off-ramp, stable a stable.' },
        defi: { title: 'Liquidez DeFi', body: 'DEX, AMM e agregadores, pontuados por profundidade.' },
        liquidity: { title: 'Provedores de liquidez', body: 'Liquidez atacadista para descoberta multi-salto.' },
        tokenized: { title: 'Ativos tokenizados', body: 'Apenas registro e roteamento. Emissão com parceiros.' },
        treasury: { title: 'Produtos de tesouraria', body: 'MMF e instrumentos de tesouraria como destinos roteáveis.' },
      },
      how: {
        heading: 'Como uma rota se resolve',
        step1: { title: 'Entender a intenção', body: 'Linguagem natural ou solicitação estruturada vira intenção financeira normalizada.' },
        step2: { title: 'Buscar no grafo', body: 'Caminhos mono- e multi-salto enumerados — rotas que um único provedor não cotaria.' },
        step3: { title: 'Verificar cada salto', body: 'Jurisdição, elegibilidade e liquidez validadas; saltos inelegíveis removidos antes da pontuação.' },
        step4: { title: 'Devolver a decisão', body: 'A rota de melhor execução volta como intenção assinada — seu parceiro liquida.' },
      },
      customers: {
        heading: 'Quem constrói no Meridian',
        fintechs: { title: 'Fintechs', body: 'Embuta a camada de decisão sem integrar cada rail você mesmo.' },
        platforms: { title: 'Plataformas e marketplaces', body: 'Roteie em nome dos usuários entre fronteiras, conformidade pré-verificada por corredor.' },
        enterprises: { title: 'Empresas e tesourarias', body: 'Otimize fluxos transfronteiriços e de tesouraria por custo total e tempo de liquidação.' },
      },
      dev: { heading: 'Uma API, cada rail', body: 'Envie uma intenção, receba uma rota pontuada e assinada. O sandbox não exige fundos nem licença.', cta: 'Abrir explorador API', codeSample: 'POST /api/v1/quote\n{\n  "sourceAsset": "USD",\n  "destinationAsset": "KRW",\n  "amount": "100000.00"\n}\n→ rotas pontuadas + intenção assinada' },
      finalCta: { title: 'Roteie sua primeira intenção hoje', body: 'Inicie um sandbox, envie uma intenção e veja o grafo resolver. Nenhum fundo se move — a execução fica com parceiros licenciados.', button: 'Começar no sandbox' },
    },
    footer: { tagline: 'A camada de decisão não custodial acima dos rails financeiros globais.', disclosure: 'Meridian é não custodial. Compara rotas apenas — não retém fundos, chaves ou wallets de clientes, não age como principal e não executa ou delega liquidação. Cotações são indicativas e não vinculantes; negocie diretamente com o provedor escolhido.' },
  },
});

function deepMerge(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      target[key] = target[key] ?? {};
      deepMerge(target[key], value);
    } else {
      target[key] = value;
    }
  }
}

for (const locale of LOCALES) {
  const path = join(messagesDir, `${locale}.json`);
  const catalog = JSON.parse(readFileSync(path, 'utf8'));
  const patch = PATCHES[locale];
  if (!patch) {
    console.error(`Missing patch for ${locale}`);
    process.exit(1);
  }
  deepMerge(catalog.landing, patch.landing);
  deepMerge(catalog.footer, patch.footer);
  writeFileSync(path, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`patched ${locale}.json`);
}

console.log('done');
