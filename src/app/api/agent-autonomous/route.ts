import { NextRequest, NextResponse } from 'next/server';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

// モデルIDマップ
const modelMap = {
  'sonnet35': process.env.BEDROCK_MODEL_ID_SONNET_35 || 'apac.anthropic.claude-3-5-sonnet-20241022-v2:0',
  'sonnet4': process.env.BEDROCK_MODEL_ID_SONNET_4 || 'apac.anthropic.claude-sonnet-4-20250514-v1:0'
};

// 型定義
interface SearchSource {
  id: string;
  url: string;
  title: string;
  snippet: string;
  relevance_score: number;
  search_query?: string;
  query_index?: number;
  // 新しいフィールド
  credibility_score?: number;
  is_primary_source?: boolean;
  source_type?: 'official' | 'academic' | 'news' | 'blog' | 'social' | 'unknown';
  language?: string;
  citationNumber?: number;
  credibility_reasoning?: string;
  target_topic?: string;
}

interface SearchResult {
  type: 'search_results';
  query: string;
  search_performed: true;
  summary?: string;
  sources?: SearchSource[];
  urls?: string[];
  total_results?: number;
  processing_time?: number;
  images?: string[];
}

// 包括的検索計画の型
interface ComprehensiveSearchPlan {
  question_analysis?: {
    identified_topics: Array<{
      topic: string;
      weight: number;
      required_info: string[];
    }>;
    topic_coverage_check: string;
  };
  stages: SearchStage[];
  overall_strategy: string;
  expected_outcome: string;
  balance_check?: string;
}

interface SearchStage {
  stage_name: string;
  description: string;
  target_topics?: string[];
  queries: SearchQuery[];
  execution_condition: string;
}

interface SearchQuery {
  query: string;
  target_topic?: string;
  language: string;
  search_depth: 'basic' | 'advanced';
  max_results: number;
  topic?: 'general' | 'news';
  days?: number;
  rationale: string;
}

// 検索実行結果
interface StageResult {
  stage: SearchStage;
  results: SearchResult[];
  total_sources: number;
  execution_time: number;
}

// Bedrockクライアント
const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || 'ap-northeast-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

// Lambdaクライアント
const lambdaClient = new LambdaClient({
  region: process.env.AWS_REGION || 'ap-northeast-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

// 遅延関数
async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Sonnet4による包括的検索計画の立案
async function planComprehensiveSearch(
  query: string,
  model: string,
  addLog: (msg: string) => void
): Promise<ComprehensiveSearchPlan> {
  try {
    addLog('\n🧠 Sonnet4による包括的検索計画立案');
    addLog('─'.repeat(40));
    
    const now = new Date();
    const currentDate = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
    
    const prompt = `あなたは高度な情報検索戦略を立案するエキスパートです。ユーザーの質問に対して、段階的で包括的な検索計画を作成してください。

現在の日付: ${currentDate}
ユーザーの質問: ${query}

【必須：質問の構成要素分析】
まず、ユーザーの質問を構成要素に分解し、各要素の充足に必要な情報を特定してください：

1. **質問の分解**
   - 質問に含まれる個別のトピック/要求を全て列挙
   - 「〜について」「〜や」「〜と」「〜の」などで区切られる要素を識別
   - 各トピックの重要度（均等配分 or 文脈に基づく重み付け）

2. **情報要件の特定**
   各トピックについて必要な情報の種類を明確化：
   - 事実情報（データ、統計、事実）
   - 分析情報（予測、評価、比較）
   - 具体例（事例、実装、応用）

3. **検索リソースの配分**
   - 識別した全トピックが適切にカバーされるよう配分
   - 各トピックに最低でも総クエリ数の20%以上を割り当て
   - 第1段階で全トピックの基礎情報を必ず収集

例：「AとBとCについて教えて」という質問の場合
- トピック1: A（33%）→ 最低2クエリ
- トピック2: B（33%）→ 最低2クエリ
- トピック3: C（34%）→ 最低2クエリ

【重要な指示】
段階的検索アプローチを採用し、以下の原則に従ってください：

1. **段階設計の原則**
   - 第1段階: 基礎情報の幅広い収集
   - 第2段階: 不足分野の深堀り（必要時のみ）
   - 第3段階: 特化情報・事例収集（必要時のみ）
   
   **重要**: 第2段階以降では、第1段階で定義したトピック（target_topic）のみを使用してください。
   新しいトピックを作成せず、必ず第1段階のトピックに対応する検索を行ってください。

2. **言語戦略**
   - 技術・学術・国際的トピック → 英語重視
   - 日本固有・ローカルトピック → 日本語中心
   - ニュース・最新動向 → 多言語併用

3. **情報源の優先度**
   - 一次情報: 公式発表、学術論文、政府資料
   - 二次情報: 専門メディア、業界紙
   - 参考情報: ブログ、一般メディア

4. **実行条件**
   - 第1段階は必須実行
   - 第2段階以降は結果に応じて条件付き実行

5. **一次情報の優先**
   - 検索クエリは一次情報（公式発表、主催者サイト、当事者による直接発表）を優先的に取得できるよう工夫してください
   - 「公式」「official」「結果発表」「announcement」などのキーワードを活用

【検索パラメータの基準】
- search_depth:
  * "advanced": 詳細分析、学術調査、専門性が必要
  * "basic": 概要確認、最新ニュース、一般情報
- max_results:
  * advanced: 8-10件
  * basic: 5-7件
- days: 最新性が重要な場合のみ設定（7, 30, 90日）
- topic: "news"（ニュース性）または"general"（一般）

以下のJSON形式で出力してください：
{
  "question_analysis": {
    "identified_topics": [
      {
        "topic": "トピック名",
        "weight": 配分比率（0-1）,
        "required_info": ["必要な情報タイプ1", "必要な情報タイプ2"]
      }
    ],
    "topic_coverage_check": "各段階でどのトピックをカバーするかの説明"
  },
  "stages": [
    {
      "stage_name": "第1段階：基礎情報収集",
      "description": "この段階の目的と収集する情報の種類",
      "target_topics": ["カバーするトピック名"],
      "queries": [
        {
          "query": "検索クエリ文",
          "target_topic": "このクエリが主にカバーするトピック",
          "language": "ja/en/zh等",
          "search_depth": "basic/advanced",
          "max_results": 数値,
          "topic": "general/news",
          "days": 数値（オプション）,
          "rationale": "このクエリの目的と期待する結果"
        }
      ],
      "execution_condition": "必須実行"
    },
    {
      "stage_name": "第2段階：不足分野の深堀り",
      "description": "第1段階で不足したトピックに特化した追加検索",
      "target_topics": ["第1段階で定義したトピックのみ使用"],
      "queries": [
        {
          "query": "より具体的な検索クエリ",
          "target_topic": "必ず第1段階のいずれかのトピックを指定",
          "language": "ja/en",
          "search_depth": "advanced",
          "max_results": 数値,
          "rationale": "第1段階の不足を補う目的"
        }
      ],
      "execution_condition": "条件付き実行"
    }
  ],
  "overall_strategy": "全体戦略の説明",
  "expected_outcome": "この計画で得られる期待結果",
  "balance_check": "全トピックが適切にカバーされているかの確認"
}`;

    const modelId = modelMap[model as keyof typeof modelMap] || modelMap['sonnet4'];
    const command = new InvokeModelCommand({
      modelId: modelId,
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 2000,
        temperature: 0,
        messages: [{
          role: "user",
          content: prompt
        }]
      })
    });

    const response = await bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const text = responseBody.content[0].text.trim();
    
    addLog(`\n🤖 Sonnet4の検索計画:`);
    addLog(text.substring(0, 500) + '...');
    
    // JSONをパース
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const plan = JSON.parse(jsonMatch[0]);
      addLog(`✅ ${plan.stages.length}段階の検索計画を生成`);
      return plan;
    }
    
    throw new Error('Failed to parse comprehensive plan JSON');
    
  } catch (error) {
    console.error('Comprehensive planning failed:', error);
    addLog('⚠️ 包括的計画立案に失敗 - シンプルプランを使用');
    
    // フォールバック計画
    return {
      stages: [{
        stage_name: "基本検索",
        description: "基本的な情報収集",
        queries: [{
          query: query,
          language: 'ja',
          search_depth: 'advanced',
          max_results: 10,
          rationale: 'フォールバック検索'
        }],
        execution_condition: "必須実行"
      }],
      overall_strategy: 'フォールバック戦略',
      expected_outcome: '基本的な情報収集'
    };
  }
}

// Lambda検索の実行
async function executeSearchWithLambda(
  query: SearchQuery,
  addLog: (msg: string) => void
): Promise<SearchResult> {
  const startTime = Date.now();
  
  try {
    const lambdaParams = [
      { name: 'query', value: query.query },
      { name: 'search_depth', value: query.search_depth },
      { name: 'max_results', value: String(query.max_results) },
      { name: 'include_answer', value: 'true' },
      { name: 'include_raw_content', value: 'false' },
      { name: 'include_images', value: 'false' }
    ];

    if (query.topic) lambdaParams.push({ name: 'topic', value: query.topic });
    if (query.days) lambdaParams.push({ name: 'days', value: String(query.days) });

    addLog(`\n🔄 Lambda検索実行: "${query.query}"`);
    addLog(`  ・言語: ${query.language}`);
    addLog(`  ・深度: ${query.search_depth}`);
    
    const command = new InvokeCommand({
      FunctionName: process.env.TAVILY_LAMBDA_FUNCTION_NAME || 'tavily_search-giolt',
      InvocationType: 'RequestResponse',
      Payload: JSON.stringify({
        messageVersion: '1.0',
        actionGroup: 'WebSearchGroup',
        function: 'tavily_search',
        parameters: lambdaParams
      })
    });

    const response = await lambdaClient.send(command);
    const responsePayload = JSON.parse(new TextDecoder().decode(response.Payload));
    
    if (responsePayload.response?.functionResponse?.responseBody?.TEXT?.body) {
      const searchData = JSON.parse(responsePayload.response.functionResponse.responseBody.TEXT.body);
      
      addLog(`  ✅ 検索完了: ${searchData.sources?.length || 0}件`);
      
      // 検索クエリ情報を各ソースに追加
      if (searchData.sources) {
        searchData.sources = searchData.sources.map((source: SearchSource) => ({
          ...source,
          search_query: query.query,
          language: query.language,
          target_topic: query.target_topic
        }));
      }
      
      return {
        ...searchData,
        processing_time: (Date.now() - startTime) / 1000
      };
    }
    
    // エラー時のフォールバック
    return {
      type: 'search_results',
      query: query.query,
      search_performed: true,
      sources: [],
      urls: [],
      total_results: 0,
      processing_time: (Date.now() - startTime) / 1000
    };
    
  } catch (error) {
    console.error('Lambda search error:', error);
    addLog(`  ❌ 検索エラー`);
    return {
      type: 'search_results',
      query: query.query,
      search_performed: true,
      sources: [],
      urls: [],
      total_results: 0,
      processing_time: (Date.now() - startTime) / 1000
    };
  }
}

// 段階的検索の実行
async function executeSearchStage(
  stage: SearchStage,
  addLog: (msg: string) => void
): Promise<StageResult> {
  const stageStartTime = Date.now();
  
  addLog(`\n📊 ${stage.stage_name} 実行開始`);
  addLog(`${stage.description}`);
  addLog(`📡 ${stage.queries.length}個のクエリを並列実行...`);
  
  // 並列検索実行
  const searchPromises = stage.queries.map(query => 
    executeSearchWithLambda(query, addLog)
  );
  const results = await Promise.all(searchPromises);
  
  // 結果の集計
  const totalSources = results.reduce((sum, result) => 
    sum + (result.sources?.length || 0), 0
  );
  
  const executionTime = Date.now() - stageStartTime;
  
  addLog(`✅ ${stage.stage_name} 完了`);
  addLog(`  ・収集情報源: ${totalSources}件`);
  addLog(`  ・実行時間: ${(executionTime / 1000).toFixed(2)}秒`);
  
  return {
    stage,
    results,
    total_sources: totalSources,
    execution_time: executionTime
  };
}

// 継続判断（内容も考慮）
function shouldExecuteNextStage(
  currentStageResults: StageResult[],
  nextStage: SearchStage,
  addLog?: (msg: string) => void
): boolean {
  const totalSources = currentStageResults.reduce((sum, stage) => 
    sum + stage.total_sources, 0
  );
  
  // 基本的なルール
  if (totalSources === 0) return true; // 情報が全くない場合は続行
  if (totalSources >= 35) return false; // 十分すぎる情報がある場合は停止
  
  // AI要約の存在確認
  const hasSummaries = currentStageResults.some(stage => 
    stage.results.some(result => result.summary && result.summary.trim())
  );
  
  // 品質指標の計算
  const qualityScore = calculateQualityScore(currentStageResults);
  
  // トピックカバレッジの確認
  const topicCoverage = calculateTopicCoverage(currentStageResults);
  
  if (addLog) {
    addLog(`\n📊 継続判断:`);
    addLog(`  ・総情報源数: ${totalSources}件`);
    addLog(`  ・AI要約: ${hasSummaries ? 'あり' : 'なし'}`);
    addLog(`  ・品質スコア: ${qualityScore.toFixed(2)}`);
    addLog(`  ・トピックカバレッジ: ${topicCoverage.map(t => `${t.topic}=${t.count}件`).join(', ')}`);
  }
  
  // 第2段階の判断
  if (nextStage.stage_name.includes('第2段階')) {
    // トピックカバレッジが不足している場合は必ず実行
    const underrepresentedTopics = topicCoverage.filter(t => t.count < 5);
    if (underrepresentedTopics.length > 0) {
      if (addLog) {
        addLog(`  ⚠️ 不足トピック: ${underrepresentedTopics.map(t => t.topic).join(', ')}`);
      }
      return true;
    }
    
    // 量と質の両方を考慮
    if (totalSources < 15) return true; // 明らかに不足
    if (totalSources >= 30 && qualityScore > 0.7) return false; // 十分
    return qualityScore < 0.6; // 質が低い場合は継続
  }
  
  // 第3段階の判断
  if (nextStage.stage_name.includes('第3段階')) {
    return totalSources < 35 && qualityScore < 0.8;
  }
  
  return false; // デフォルトは実行しない
}

// 品質スコアの計算
function calculateQualityScore(stageResults: StageResult[]): number {
  let score = 0;
  let factors = 0;
  
  // AI要約の存在
  const summaryCount = stageResults.reduce((count, stage) => 
    count + stage.results.filter(r => r.summary).length, 0
  );
  if (summaryCount > 0) {
    score += 0.3;
    factors++;
  }
  
  // 情報源の多様性（複数の検索クエリから結果を得ているか）
  const queriesWithResults = stageResults.reduce((count, stage) => 
    count + stage.results.filter(r => r.sources && r.sources.length > 0).length, 0
  );
  if (queriesWithResults > 1) {
    score += 0.3;
    factors++;
  }
  
  // 平均結果数
  const avgResultsPerQuery = stageResults.reduce((sum, stage) => {
    const queryCount = stage.stage.queries.length;
    const totalResults = stage.total_sources;
    return sum + (queryCount > 0 ? totalResults / queryCount : 0);
  }, 0) / stageResults.length;
  
  if (avgResultsPerQuery > 5) {
    score += 0.4;
    factors++;
  }
  
  return factors > 0 ? score / factors : 0.5;
}

// トピックカバレッジの計算
function calculateTopicCoverage(
  stageResults: StageResult[]
): Array<{ topic: string; count: number }> {
  // 全ソースを収集
  const allSources: SearchSource[] = [];
  stageResults.forEach(stageResult => {
    stageResult.results.forEach(result => {
      if (result.sources) {
        allSources.push(...result.sources);
      }
    });
  });
  
  // 第1段階のトピックを取得（すべての段階で使用されるべき基準）
  const firstStageTopics = new Set<string>();
  if (stageResults.length > 0 && stageResults[0].stage.queries) {
    stageResults[0].stage.queries.forEach(q => {
      if (q.target_topic) {
        firstStageTopics.add(q.target_topic);
      }
    });
  }
  
  // 各トピックの情報源数をカウント
  const coverage = Array.from(firstStageTopics).map(topic => {
    const count = allSources.filter(source => 
      source.target_topic === topic
    ).length;
    
    return { topic: topic as string, count };
  });
  
  return coverage;
}

// 統合評価と回答生成
async function generateIntegratedResponse(
  query: string,
  allResults: StageResult[],
  model: string,
  addLog: (msg: string) => void,
  searchPlan?: ComprehensiveSearchPlan
): Promise<{
  response: string;
  evaluatedSources: SearchSource[];
}> {
  try {
    // レート制限対策
    await delay(2000);
    
    addLog('\n📝 統合評価・回答生成');
    addLog('─'.repeat(40));
    
    // 全ソースの統合
    const allSources: SearchSource[] = [];
    const allSummaries: string[] = [];
    
    allResults.forEach((stageResult, stageIdx) => {
      stageResult.results.forEach((result, resultIdx) => {
        if (result.summary) allSummaries.push(result.summary);
        if (result.sources) {
          result.sources.forEach((source, sourceIdx) => {
            allSources.push({
              ...source,
              id: `s${stageIdx}_r${resultIdx}_${sourceIdx}`,
              query_index: stageIdx
            });
          });
        }
      });
    });
    
    // 重複除去
    const uniqueSources = new Map<string, SearchSource>();
    allSources.forEach(source => {
      if (!uniqueSources.has(source.url)) {
        uniqueSources.set(source.url, source);
      }
    });
    
    const finalSources = Array.from(uniqueSources.values());
    
    addLog(`📊 統合結果:`);
    addLog(`  ・総情報源: ${finalSources.length}件`);
    addLog(`  ・AI要約: ${allSummaries.length}個`);
    
    // トピックの重要度を表示
    if (searchPlan?.question_analysis?.identified_topics) {
      addLog(`📌 トピック重要度:`);
      searchPlan.question_analysis.identified_topics.forEach(t => {
        addLog(`  ・${t.topic}: ${(t.weight * 100).toFixed(0)}%`);
      });
    }
    
    // コンテキスト構築
    let context = `統合検索結果：\n\n`;
    
    // AI要約を含める
    if (allSummaries.length > 0) {
      context += `🤖 検索要約:\n${allSummaries.join('\n\n')}\n\n`;
    }
    
    // トピック最低保証付きの情報源選択（最大20件）
    const topSources = selectBalancedSources(
      finalSources,
      searchPlan?.stages[0]?.queries || allResults[0]?.stage?.queries || [],
      20,
      searchPlan?.question_analysis?.identified_topics
    );
    
    // デバッグ：最終選択の内訳を表示（第1段階のトピックのみ）
    addLog(`📊 最終選択の内訳:`);
    const topicCounts = new Map<string, number>();
    
    // 第1段階で定義されたトピックのみをカウント対象にする
    const validTopics = new Set<string>();
    if (searchPlan?.question_analysis?.identified_topics) {
      searchPlan.question_analysis.identified_topics.forEach(t => {
        validTopics.add(t.topic);
      });
    }
    
    topSources.forEach(source => {
      const topic = source.target_topic || '不明';
      // 第1段階のトピックのみカウント
      if (validTopics.has(topic) || validTopics.size === 0) {
        topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
      }
    });
    
    // 第1段階のトピックの順序で表示
    if (searchPlan?.question_analysis?.identified_topics) {
      searchPlan.question_analysis.identified_topics.forEach(t => {
        const count = topicCounts.get(t.topic) || 0;
        addLog(`  ・${t.topic}: ${count}件`);
      });
    } else {
      // フォールバック
      topicCounts.forEach((count, topic) => {
        addLog(`  ・${topic}: ${count}件`);
      });
    }
    
    context += `📄 詳細情報源（${topSources.length}件）:\n\n`;
    topSources.forEach((source, index) => {
      context += `[${index + 1}] ${source.title}\n`;
      context += `URL: ${source.url}\n`;
      if (source.search_query) {
        context += `検索クエリ: ${source.search_query}\n`;
      }
      context += `内容: ${source.snippet}\n`;
      context += `関連度: ${source.relevance_score.toFixed(2)}\n\n`;
    });

    const prompt = `あなたは高度な情報分析・統合の専門家です。以下の検索結果を基に、ユーザーの質問に対して包括的で構造化された回答を生成してください。

${context}

ユーザーの質問: ${query}

【重要な指示】
1. **情報源の評価と分類**
   - 各情報源の信頼性を評価（公式サイト、学術論文、専門メディアを優先）
   - 一次情報と二次情報を区別して活用

2. **回答の構造化**
   - 主要なポイントを論理的に整理
   - 情報源を[1], [2]の形式で明示的に引用
   - 矛盾する情報がある場合は両論併記

3. **信頼性の明示**
   - 確実な情報と推測を明確に区別
   - 検索で得られなかった情報は「情報なし」と明記
   - 情報の日付や出典の特徴を考慮

4. **Markdown形式での出力**
   - ## で主要セクション、### でサブセクション
   - **太字**で重要な発見や結論を強調
   - 箇条書きや番号付きリストを効果的に活用
   - 必要に応じてテーブルや引用を使用

【必須：情報源評価セクション】
回答の最後に、以下の形式で各情報源の評価を記載してください：

### 情報源評価

\`\`\`json
[
  {
    "index": 1,
    "url": "情報源のURL",
    "credibility_score": 0.9,
    "is_primary": true,
    "source_type": "official",
    "reasoning": "政府公式サイトの直接発表"
  },
  {
    "index": 2,
    "url": "情報源のURL",
    "credibility_score": 0.7,
    "is_primary": false,
    "source_type": "news",
    "reasoning": "大手メディアによる二次報道"
  }
]
\`\`\`

必ず上記のJSON形式で、使用した全ての情報源について評価を記載してください。`;

    const modelId = modelMap[model as keyof typeof modelMap] || modelMap['sonnet4'];
    const command = new InvokeModelCommand({
      modelId: modelId,
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 4000,
        temperature: 0.7,
        messages: [{
          role: "user",
          content: prompt
        }]
      })
    });

    const response = await bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    
    if (responseBody.content && responseBody.content.length > 0) {
      const responseText = responseBody.content[0].text;
      
      // 情報源の評価を抽出
      let evaluatedSources;
      try {
        // JSONコードブロックを抽出
        const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/);
        if (jsonMatch) {
          const evaluations = JSON.parse(jsonMatch[1]);
          addLog(`📊 Sonnet4による評価結果を取得: ${evaluations.length}件`);
          
          // Sonnet4の評価をマージ
          evaluatedSources = topSources.map((source, index) => {
            const evaluation = evaluations.find((e: any) => e.index === index + 1);
            if (evaluation) {
              return {
                ...source,
                credibility_score: evaluation.credibility_score,
                is_primary_source: evaluation.is_primary,
                source_type: evaluation.source_type as any,
                credibility_reasoning: evaluation.reasoning,
                citationNumber: index + 1
              };
            }
            // フォールバック
            return {
              ...source,
              credibility_score: estimateCredibility(source),
              is_primary_source: isPrimarySource(source),
              source_type: classifySourceType(source),
              citationNumber: index + 1
            };
          });
        } else {
          addLog('⚠️ 評価結果のJSON抽出に失敗 - フォールバックを使用');
          // フォールバック：ルールベース評価
          evaluatedSources = topSources.map((source, index) => ({
            ...source,
            credibility_score: estimateCredibility(source),
            is_primary_source: isPrimarySource(source),
            source_type: classifySourceType(source),
            citationNumber: index + 1
          }));
        }
      } catch (parseError) {
        console.error('Failed to parse evaluation:', parseError);
        addLog('⚠️ 評価結果のパースに失敗 - フォールバックを使用');
        // フォールバック
        evaluatedSources = topSources.map((source, index) => ({
          ...source,
          credibility_score: estimateCredibility(source),
          is_primary_source: isPrimarySource(source),
          source_type: classifySourceType(source),
          citationNumber: index + 1
        }));
      }
      
      addLog('✅ 統合回答生成完了');
      
      return {
        response: responseText,
        evaluatedSources
      };
    }
  } catch (error) {
    console.error('Integrated response generation failed:', error);
    addLog('❌ 統合回答生成エラー');
  }
  
  return {
    response: "申し訳ございません。回答の生成中にエラーが発生しました。",
    evaluatedSources: []
  };
}

// 簡易的な信頼性推定
function estimateCredibility(source: SearchSource): number {
  const url = source.url.toLowerCase();
  
  if (url.includes('.gov') || url.includes('.edu') || url.includes('official')) return 0.9;
  if (url.includes('nature.com') || url.includes('science.') || url.includes('ieee')) return 0.85;
  if (url.includes('bbc.com') || url.includes('reuters') || url.includes('ap.org')) return 0.8;
  if (url.includes('nikkei') || url.includes('bloomberg') || url.includes('wsj')) return 0.75;
  if (url.includes('blog') || url.includes('medium')) return 0.4;
  if (url.includes('wikipedia')) return 0.6;
  
  return 0.5; // デフォルト
}

// 一次情報源判定
function isPrimarySource(source: SearchSource): boolean {
  const url = source.url.toLowerCase();
  const title = source.title.toLowerCase();
  
  return url.includes('.gov') || 
         url.includes('official') || 
         url.includes('press-release') ||
         title.includes('official') ||
         title.includes('press release') ||
         title.includes('announcement');
}

// 情報源タイプ分類
function classifySourceType(source: SearchSource): 'official' | 'academic' | 'news' | 'blog' | 'social' | 'unknown' {
  const url = source.url.toLowerCase();
  
  if (url.includes('.gov') || url.includes('official')) return 'official';
  if (url.includes('.edu') || url.includes('nature.com') || url.includes('ieee')) return 'academic';
  if (url.includes('news') || url.includes('bbc') || url.includes('reuters')) return 'news';
  if (url.includes('blog') || url.includes('medium')) return 'blog';
  if (url.includes('twitter') || url.includes('facebook') || url.includes('linkedin')) return 'social';
  
  return 'unknown';
}

// トピック最低保証付きの情報源選択
function selectBalancedSources(
  sources: SearchSource[],
  queries: SearchQuery[],
  limit: number,
  topicAnalysis?: Array<{ topic: string; weight: number; required_info: string[]; }>
): SearchSource[] {
  const selected: SearchSource[] = [];
  const usedUrls = new Set<string>();
  
  // クエリからトピックを抽出
  const topics = Array.from(new Set(queries
    .map(q => q.target_topic)
    .filter(t => t !== undefined)
  )) as string[];
  
  // 全体の保証枠（70%）
  const totalGuaranteed = Math.floor(limit * 0.7);
  
  // トピックごとの最低保証数を計算
  const topicQuotas = new Map<string, number>();
  
  if (topicAnalysis && topicAnalysis.length > 0) {
    // 重要度（weight）に基づいて配分
    for (const topicInfo of topicAnalysis) {
      const minForTopic = Math.ceil(totalGuaranteed * topicInfo.weight);
      topicQuotas.set(topicInfo.topic, minForTopic);
    }
  } else {
    // フォールバック：均等配分
    const minPerTopic = Math.ceil(totalGuaranteed / Math.max(topics.length, 1));
    for (const topic of topics) {
      topicQuotas.set(topic, minPerTopic);
    }
  }
  
  // 1. 各トピックから高品質な情報源を確保
  for (const topic of topics) {
    const quota = topicQuotas.get(topic) || 2;
    const topicSources = sources
      .filter(s => {
        // target_topicで直接マッチング、または検索クエリに含まれる
        const matchesTopic = s.target_topic === topic || 
          queries.some(q => 
            q.target_topic === topic && 
            s.search_query === q.query
          );
        return matchesTopic && !usedUrls.has(s.url);
      })
      .sort((a, b) => {
        // 信頼性スコアがあれば優先、なければ関連度
        const scoreA = a.credibility_score || a.relevance_score;
        const scoreB = b.credibility_score || b.relevance_score;
        return scoreB - scoreA;
      })
      .slice(0, quota);
    
    topicSources.forEach(source => {
      if (selected.length < limit) {
        selected.push(source);
        usedUrls.add(source.url);
      }
    });
  }
  
  // 2. 残り枠を関連度順で埋める
  const remaining = sources
    .filter(s => !usedUrls.has(s.url))
    .sort((a, b) => b.relevance_score - a.relevance_score);
  
  for (const source of remaining) {
    if (selected.length >= limit) break;
    selected.push(source);
    usedUrls.add(source.url);
  }
  
  return selected;
}

// メインの統合検索関数
async function performIntegratedSearch(
  query: string,
  model: string,
  addLog: (msg: string) => void
): Promise<{
  response: string;
  stageResults: StageResult[];
  sources: SearchSource[];
  totalTime: number;
}> {
  const startTime = Date.now();
  
  addLog(`\n╔════════════════════════════════════════╗`);
  addLog(`║ 🤖 統合型Web検索システム 開始 🤖 ║`);
  addLog(`╚════════════════════════════════════════╝`);
  addLog(`💬 質問: ${query}`);
  addLog(`🤖 モデル: ${model === 'sonnet35' ? 'Claude 3.5 Sonnet' : 'Claude 4 Sonnet'}`);
  
  // ステップ1: 包括的検索計画の立案
  const searchPlan = await planComprehensiveSearch(query, model, addLog);
  
  // ステップ2: 段階的検索の実行
  const stageResults: StageResult[] = [];
  
  for (let i = 0; i < searchPlan.stages.length; i++) {
    const stage = searchPlan.stages[i];
    
    // 実行条件の確認
    if (i > 0 && !shouldExecuteNextStage(stageResults, stage, addLog)) {
      addLog(`\n⏩ ${stage.stage_name} をスキップ - 十分な情報を収集済み`);
      continue;
    }
    
    const stageResult = await executeSearchStage(stage, addLog);
    stageResults.push(stageResult);
    
    // 基本的な停止条件（品質も考慮）
    const totalSources = stageResults.reduce((sum, sr) => sum + sr.total_sources, 0);
    const qualityScore = calculateQualityScore(stageResults);
    
    // より多くの情報を収集し、品質も考慮（AND条件に変更）
    if (totalSources >= 40 && qualityScore > 0.7) {
      addLog(`\n⏹️ 十分な情報源を収集（${totalSources}件、品質スコア: ${qualityScore.toFixed(2)}） - 後続段階をスキップ`);
      break;
    }
    
    // トピックカバレッジのチェック（第1段階後も実施）
    if (i === 0 && searchPlan.stages.length > 1) {
      const coverage = calculateTopicCoverage(stageResults);
      const underrepresented = coverage.filter(t => t.count < 5);
      if (underrepresented.length > 0) {
        addLog(`\n⚠️ 不足トピック検出: ${underrepresented.map(t => `${t.topic}(${t.count}件)`).join(', ')}`);
        addLog(`第2段階の実行を推奨`);
      }
    }
  }
  
  // ステップ3: 統合評価と回答生成
  const { response, evaluatedSources } = await generateIntegratedResponse(
    query, 
    stageResults, 
    model, 
    addLog,
    searchPlan
  );
  
  const totalTime = Date.now() - startTime;
  
  addLog(`\n\n╔════════════════════════════════════════╗`);
  addLog(`║ 🏁 統合検索完了 🏁 ║`);
  addLog(`╚════════════════════════════════════════╝`);
  addLog(`📊 統計情報:`);
  addLog(`  ・実行段階数: ${stageResults.length}段階`);
  addLog(`  ・総検索クエリ数: ${stageResults.reduce((sum, sr) => sum + sr.stage.queries.length, 0)}個`);
  addLog(`  ・収集した情報源: ${evaluatedSources.length}件`);
  addLog(`  ・推定一次情報源: ${evaluatedSources.filter(s => s.is_primary_source).length}件`);
  addLog(`  ・総処理時間: ${(totalTime / 1000).toFixed(2)}秒`);
  
  return {
    response,
    stageResults,
    sources: evaluatedSources,
    totalTime
  };
}

// APIハンドラー
export async function POST(request: NextRequest) {
  const processLog: string[] = [];
  const addLog = (message: string) => {
    console.log(message);
    processLog.push(message);
  };
  
  try {
    const { message, sessionId, model = 'sonnet4' } = await request.json();

    if (!message) {
      return NextResponse.json(
        { error: true, message: 'No message provided' },
        { status: 400 }
      );
    }

    // 統合検索の実行
    const searchResult = await performIntegratedSearch(message, model, addLog);

    // レスポンスの構築
    const response = {
      response: searchResult.response,
      sessionId: sessionId || crypto.randomUUID(),
      sources: searchResult.sources.map(source => ({
        title: source.title,
        uri: source.url,
        content: source.snippet,
        type: 'web_search' as const,
        score: source.credibility_score || source.relevance_score,
        is_primary: source.is_primary_source,
        source_type: source.source_type,
        language: source.language,
        query: source.search_query,
        citationNumber: source.citationNumber
      })),
      processingTime: searchResult.totalTime,
      metadata: {
        stages: searchResult.stageResults.length,
        totalQueries: searchResult.stageResults.reduce((sum, sr) => 
          sum + sr.stage.queries.length, 0
        ),
        primarySources: searchResult.sources.filter(s => s.is_primary_source).length,
        processLog: processLog,
        model: model,
        approach: 'integrated'
      }
    };

    return NextResponse.json(response);

  } catch (error: any) {
    console.error('API error:', error);
    
    const isRateLimit = error.name === 'ThrottlingException' || 
                       error.$metadata?.httpStatusCode === 429;
    
    return NextResponse.json(
      { 
        error: true, 
        message: error.message || 'Processing failed',
        code: error.name || 'API_ERROR',
        isRateLimit,
        userMessage: isRateLimit ? 
          'リクエストが混み合っています。少しお待ちください。' : 
          'エラーが発生しました。もう一度お試しください。',
        metadata: {
          processLog: processLog
        }
      },
      { status: isRateLimit ? 429 : 500 }
    );
  }
}