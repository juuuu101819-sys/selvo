/**
 * One-shot patch: merge Phase 4 graph explorer keys into all 8 locale catalogs.
 * Run: node scripts/apply-graph-i18n.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const messagesDir = join(dirname(fileURLToPath(import.meta.url)), '../messages');
const LOCALES = ['en', 'ko', 'ja', 'zh-CN', 'es', 'fr', 'de', 'pt-BR'];

const GRAPH = {
  en: {
    metaSummary:
      '{nodeCount} nodes · {edgeCount} conversion edges · graph engine {version}. Edges are indicative and never executable.',
    cardTitle: 'Discover conversion paths',
    cardDescription:
      'Walk the asset–venue graph under hop, cost, liquidity, availability and compliance constraints. This is path discovery, not a live quote.',
    presets: {
      one: 'One hop · USD → KRW',
      two: 'Two hops · via USDC',
      three: 'Three hops · USDC → USDT',
      usdcUsdt: 'USDC → USDT',
      tightCost: 'Cost cap 1 bps',
    },
    source: 'Source',
    destination: 'Destination',
    maxHops: 'Max hops',
    maxCost: 'Max cost (bps)',
    minLiquidity: 'Min liquidity',
    placeholderUnbounded: 'unbounded',
    placeholderNone: 'none',
    findPaths: 'Find paths',
    searching: 'Searching…',
    emptyTitle: 'No path search yet',
    emptyBody:
      'Choose a corridor and a hop limit to walk USD → FX → KRW, USD → USDC → KRW, or USD → USDC → USDT → KRW. Unavailable, expensive and illiquid edges are pruned.',
    noValidPath: 'No valid path',
    groupsSummary:
      '{pathCount} walks collapsed into {groupCount} distinct asset sequences. The cheapest walk in each sequence is shown.',
    recommended: 'Recommended',
    venueVariants: '{count} venue variants',
    pathTitle: '{rank}. {hops}-hop · {route}',
    vizTitle: 'Route selection',
    vizRecommended: 'Recommended',
    vizAria: 'Animated path diagram for {route}',
    vizCaption:
      'Indicative asset walk — edges are scored for cost and liquidity; nothing here executes.',
  },
  ko: {
    metaSummary:
      '{nodeCount}개 노드 · {edgeCount}개 전환 엣지 · 그래프 엔진 {version}. 엣지는 참고용이며 실행할 수 없습니다.',
    cardTitle: '전환 경로 탐색',
    cardDescription:
      '홉, 비용, 유동성, 가용성 및 컴플라이언스 제약 하에 자산–거래소 그래프를 탐색합니다. 실시간 견적이 아닌 경로 탐색입니다.',
    presets: {
      one: '1홉 · USD → KRW',
      two: '2홉 · USDC 경유',
      three: '3홉 · USDC → USDT',
      usdcUsdt: 'USDC → USDT',
      tightCost: '비용 상한 1 bps',
    },
    source: '출발',
    destination: '도착',
    maxHops: '최대 홉',
    maxCost: '최대 비용 (bps)',
    minLiquidity: '최소 유동성',
    placeholderUnbounded: '제한 없음',
    placeholderNone: '없음',
    findPaths: '경로 찾기',
    searching: '검색 중…',
    emptyTitle: '아직 경로 검색 없음',
    emptyBody:
      '회랑과 홉 제한을 선택해 USD → FX → KRW, USD → USDC → KRW, USD → USDC → USDT → KRW를 탐색하세요. 사용 불가·고비용·저유동성 엣지는 제거됩니다.',
    noValidPath: '유효한 경로 없음',
    groupsSummary:
      '{pathCount}개 워크가 {groupCount}개의 고유 자산 시퀀스로 축약되었습니다. 각 시퀀스에서 가장 저렴한 워크가 표시됩니다.',
    recommended: '권장',
    venueVariants: '거래소 변형 {count}개',
    pathTitle: '{rank}. {hops}홉 · {route}',
    vizTitle: '경로 선택',
    vizRecommended: '권장',
    vizAria: '{route}에 대한 애니메이션 경로 다이어그램',
    vizCaption:
      '참고용 자산 워크 — 엣지는 비용과 유동성으로 점수화됩니다. 여기서는 실행되지 않습니다.',
  },
  ja: {
    metaSummary:
      '{nodeCount}ノード · {edgeCount}変換エッジ · グラフエンジン {version}。エッジは参考値で実行不可です。',
    cardTitle: '変換経路の探索',
    cardDescription:
      'ホップ、コスト、流動性、可用性、コンプライアンスの制約下で資産–会場グラフを探索します。ライブ見積もりではなく経路探索です。',
    presets: {
      one: '1ホップ · USD → KRW',
      two: '2ホップ · USDC経由',
      three: '3ホップ · USDC → USDT',
      usdcUsdt: 'USDC → USDT',
      tightCost: 'コスト上限 1 bps',
    },
    source: 'ソース',
    destination: '宛先',
    maxHops: '最大ホップ',
    maxCost: '最大コスト (bps)',
    minLiquidity: '最小流動性',
    placeholderUnbounded: '無制限',
    placeholderNone: 'なし',
    findPaths: '経路を検索',
    searching: '検索中…',
    emptyTitle: 'まだ経路検索がありません',
    emptyBody:
      '回廊とホップ上限を選び、USD → FX → KRW、USD → USDC → KRW、USD → USDC → USDT → KRW を探索します。利用不可・高コスト・低流動性のエッジは除外されます。',
    noValidPath: '有効な経路なし',
    groupsSummary:
      '{pathCount}ウォークを {groupCount} 個の異なる資産シーケンスに集約しました。各シーケンスで最安ウォークを表示します。',
    recommended: '推奨',
    venueVariants: '会場バリアント {count}件',
    pathTitle: '{rank}. {hops}ホップ · {route}',
    vizTitle: '経路選択',
    vizRecommended: '推奨',
    vizAria: '{route} のアニメーション経路図',
    vizCaption:
      '参考用の資産ウォーク — エッジはコストと流動性でスコア化。ここでは実行されません。',
  },
  'zh-CN': {
    metaSummary:
      '{nodeCount} 个节点 · {edgeCount} 条转换边 · 图引擎 {version}。边为指示性，不可执行。',
    cardTitle: '发现转换路径',
    cardDescription:
      '在跳数、成本、流动性、可用性与合规约束下遍历资产–场所图。这是路径发现，不是实时报价。',
    presets: {
      one: '一跳 · USD → KRW',
      two: '两跳 · 经 USDC',
      three: '三跳 · USDC → USDT',
      usdcUsdt: 'USDC → USDT',
      tightCost: '成本上限 1 bps',
    },
    source: '来源',
    destination: '目标',
    maxHops: '最大跳数',
    maxCost: '最大成本 (bps)',
    minLiquidity: '最小流动性',
    placeholderUnbounded: '无上限',
    placeholderNone: '无',
    findPaths: '查找路径',
    searching: '搜索中…',
    emptyTitle: '尚未搜索路径',
    emptyBody:
      '选择走廊和跳数上限，遍历 USD → FX → KRW、USD → USDC → KRW 或 USD → USDC → USDT → KRW。不可用、昂贵和低流动性边会被剪枝。',
    noValidPath: '无有效路径',
    groupsSummary:
      '{pathCount} 条遍历已合并为 {groupCount} 个不同资产序列。每个序列显示最便宜的一条。',
    recommended: '推荐',
    venueVariants: '{count} 个场所变体',
    pathTitle: '{rank}. {hops} 跳 · {route}',
    vizTitle: '路径选择',
    vizRecommended: '推荐',
    vizAria: '{route} 的动画路径图',
    vizCaption: '指示性资产遍历 — 边按成本与流动性评分；此处不执行任何操作。',
  },
  es: {
    metaSummary:
      '{nodeCount} nodos · {edgeCount} aristas de conversión · motor de grafo {version}. Las aristas son indicativas y nunca ejecutables.',
    cardTitle: 'Descubrir rutas de conversión',
    cardDescription:
      'Recorra el grafo activo–venue bajo restricciones de saltos, coste, liquidez, disponibilidad y cumplimiento. Es descubrimiento de rutas, no una cotización en vivo.',
    presets: {
      one: 'Un salto · USD → KRW',
      two: 'Dos saltos · vía USDC',
      three: 'Tres saltos · USDC → USDT',
      usdcUsdt: 'USDC → USDT',
      tightCost: 'Tope de coste 1 bps',
    },
    source: 'Origen',
    destination: 'Destino',
    maxHops: 'Saltos máx.',
    maxCost: 'Coste máx. (bps)',
    minLiquidity: 'Liquidez mín.',
    placeholderUnbounded: 'sin límite',
    placeholderNone: 'ninguna',
    findPaths: 'Buscar rutas',
    searching: 'Buscando…',
    emptyTitle: 'Aún no hay búsqueda de rutas',
    emptyBody:
      'Elija un corredor y un límite de saltos para recorrer USD → FX → KRW, USD → USDC → KRW o USD → USDC → USDT → KRW. Se eliminan aristas no disponibles, caras o ilíquidas.',
    noValidPath: 'Sin ruta válida',
    groupsSummary:
      '{pathCount} recorridos reducidos a {groupCount} secuencias de activos distintas. Se muestra el recorrido más barato de cada secuencia.',
    recommended: 'Recomendada',
    venueVariants: '{count} variantes de venue',
    pathTitle: '{rank}. {hops} salto(s) · {route}',
    vizTitle: 'Selección de ruta',
    vizRecommended: 'Recomendada',
    vizAria: 'Diagrama animado de ruta para {route}',
    vizCaption:
      'Recorrido de activos indicativo — las aristas se puntúan por coste y liquidez; aquí no se ejecuta nada.',
  },
  fr: {
    metaSummary:
      '{nodeCount} nœuds · {edgeCount} arêtes de conversion · moteur de graphe {version}. Les arêtes sont indicatives et jamais exécutables.',
    cardTitle: 'Découvrir des chemins de conversion',
    cardDescription:
      'Parcourez le graphe actif–venue sous contraintes de sauts, coût, liquidité, disponibilité et conformité. C’est de la découverte de chemins, pas un devis en direct.',
    presets: {
      one: 'Un saut · USD → KRW',
      two: 'Deux sauts · via USDC',
      three: 'Trois sauts · USDC → USDT',
      usdcUsdt: 'USDC → USDT',
      tightCost: 'Plafond de coût 1 bps',
    },
    source: 'Source',
    destination: 'Destination',
    maxHops: 'Sauts max.',
    maxCost: 'Coût max. (bps)',
    minLiquidity: 'Liquidité min.',
    placeholderUnbounded: 'illimité',
    placeholderNone: 'aucune',
    findPaths: 'Trouver des chemins',
    searching: 'Recherche…',
    emptyTitle: 'Pas encore de recherche de chemins',
    emptyBody:
      'Choisissez un corridor et une limite de sauts pour parcourir USD → FX → KRW, USD → USDC → KRW ou USD → USDC → USDT → KRW. Les arêtes indisponibles, chères ou illiquides sont élaguées.',
    noValidPath: 'Aucun chemin valide',
    groupsSummary:
      '{pathCount} parcours réduits à {groupCount} séquences d’actifs distinctes. Le parcours le moins cher de chaque séquence est affiché.',
    recommended: 'Recommandé',
    venueVariants: '{count} variantes de venue',
    pathTitle: '{rank}. {hops} saut(s) · {route}',
    vizTitle: 'Sélection de chemin',
    vizRecommended: 'Recommandé',
    vizAria: 'Diagramme animé de chemin pour {route}',
    vizCaption:
      'Parcours d’actifs indicatif — les arêtes sont notées pour coût et liquidité ; rien ne s’exécute ici.',
  },
  de: {
    metaSummary:
      '{nodeCount} Knoten · {edgeCount} Konvertierungskanten · Graph-Engine {version}. Kanten sind indikativ und nie ausführbar.',
    cardTitle: 'Konvertierungspfade entdecken',
    cardDescription:
      'Durchlaufen Sie den Asset–Venue-Graphen unter Hop-, Kosten-, Liquiditäts-, Verfügbarkeits- und Compliance-Beschränkungen. Das ist Pfadsuche, kein Live-Angebot.',
    presets: {
      one: 'Ein Hop · USD → KRW',
      two: 'Zwei Hops · via USDC',
      three: 'Drei Hops · USDC → USDT',
      usdcUsdt: 'USDC → USDT',
      tightCost: 'Kostenobergrenze 1 bps',
    },
    source: 'Quelle',
    destination: 'Ziel',
    maxHops: 'Max. Hops',
    maxCost: 'Max. Kosten (bps)',
    minLiquidity: 'Min. Liquidität',
    placeholderUnbounded: 'unbegrenzt',
    placeholderNone: 'keine',
    findPaths: 'Pfade finden',
    searching: 'Suche…',
    emptyTitle: 'Noch keine Pfadsuche',
    emptyBody:
      'Wählen Sie einen Korridor und ein Hop-Limit für USD → FX → KRW, USD → USDC → KRW oder USD → USDC → USDT → KRW. Nicht verfügbare, teure und illiquide Kanten werden entfernt.',
    noValidPath: 'Kein gültiger Pfad',
    groupsSummary:
      '{pathCount} Walks zu {groupCount} verschiedenen Asset-Sequenzen zusammengefasst. Der günstigste Walk jeder Sequenz wird angezeigt.',
    recommended: 'Empfohlen',
    venueVariants: '{count} Venue-Varianten',
    pathTitle: '{rank}. {hops}-Hop · {route}',
    vizTitle: 'Routenauswahl',
    vizRecommended: 'Empfohlen',
    vizAria: 'Animiertes Pfaddiagramm für {route}',
    vizCaption:
      'Indikativer Asset-Walk — Kanten werden nach Kosten und Liquidität bewertet; hier wird nichts ausgeführt.',
  },
  'pt-BR': {
    metaSummary:
      '{nodeCount} nós · {edgeCount} arestas de conversão · motor de grafo {version}. Arestas são indicativas e nunca executáveis.',
    cardTitle: 'Descobrir caminhos de conversão',
    cardDescription:
      'Percorra o grafo ativo–venue sob restrições de saltos, custo, liquidez, disponibilidade e conformidade. É descoberta de caminhos, não cotação ao vivo.',
    presets: {
      one: 'Um salto · USD → KRW',
      two: 'Dois saltos · via USDC',
      three: 'Três saltos · USDC → USDT',
      usdcUsdt: 'USDC → USDT',
      tightCost: 'Teto de custo 1 bps',
    },
    source: 'Origem',
    destination: 'Destino',
    maxHops: 'Saltos máx.',
    maxCost: 'Custo máx. (bps)',
    minLiquidity: 'Liquidez mín.',
    placeholderUnbounded: 'ilimitado',
    placeholderNone: 'nenhuma',
    findPaths: 'Encontrar caminhos',
    searching: 'Buscando…',
    emptyTitle: 'Nenhuma busca de caminho ainda',
    emptyBody:
      'Escolha um corredor e limite de saltos para percorrer USD → FX → KRW, USD → USDC → KRW ou USD → USDC → USDT → KRW. Arestas indisponíveis, caras ou ilíquidas são podadas.',
    noValidPath: 'Nenhum caminho válido',
    groupsSummary:
      '{pathCount} caminhadas reduzidas a {groupCount} sequências de ativos distintas. A caminhada mais barata de cada sequência é exibida.',
    recommended: 'Recomendado',
    venueVariants: '{count} variantes de venue',
    pathTitle: '{rank}. {hops} salto(s) · {route}',
    vizTitle: 'Seleção de rota',
    vizRecommended: 'Recomendado',
    vizAria: 'Diagrama animado de rota para {route}',
    vizCaption:
      'Caminhada de ativos indicativa — arestas são pontuadas por custo e liquidez; nada é executado aqui.',
  },
};

for (const locale of LOCALES) {
  const path = join(messagesDir, `${locale}.json`);
  const catalog = JSON.parse(readFileSync(path, 'utf8'));
  catalog.graph = GRAPH[locale];
  writeFileSync(path, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`patched ${locale}.json (+graph namespace)`);
}

console.log('Done. Run npm run i18n:check to verify key parity.');
