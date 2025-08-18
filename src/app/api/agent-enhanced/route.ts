import { NextRequest, NextResponse } from 'next/server';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

// 型定義
interface SearchSource {
  id: string;
  url: string;
  title: string;
  snippet: string;
  relevance_score: number;
  search_query?: string;
  query_index?: number;
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

// Tavily検索パラメータの型
interface TavilySearchParams {
  query: string;
  search_depth?: 'basic' | 'advanced';
  topic?: 'general' | 'news';
  days?: number;
  max_results?: number;
  include_domains?: string[];
  exclude_domains?: string[];
  include_answer?: boolean;
  include_raw_content?: boolean;
  include_images?: boolean;
}

// 強化されたクエリ型
interface EnhancedQuery {
  query: string;
  searchParams: TavilySearchParams;
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

// 時間軸の自動判定
function detectTemporalContext(query: string): { days?: number; topic?: 'news' | 'general' } {
  const result: { days?: number; topic?: 'news' | 'general' } = {};
  
  // 最新情報のパターン
  const recentPatterns = [
    /latest|recent|current|now|today|this week|this month/i,
    /最新|現在|今|今日|今週|今月|最近|直近/,
    /202[4-9]|203\d/  // 2024年以降の年号
  ];
  
  // ニュースパターン
  const newsPatterns = [
    /news|update|announcement|report|breaking/i,
    /ニュース|速報|発表|報道|動向/,
    /移籍|契約|試合結果|優勝/
  ];
  
  const queryLower = query.toLowerCase();
  
  // 時間軸の判定
  if (recentPatterns.some(pattern => pattern.test(query))) {
    result.days = 30;  // 30日以内
    result.topic = 'news';
  } else if (newsPatterns.some(pattern => pattern.test(query))) {
    result.days = 90;  // 3ヶ月以内
    result.topic = 'news';
  }
  
  return result;
}

// Claude Haikuでクエリを高度に分解
async function decomposeQueryWithEnhancedHaiku(query: string): Promise<EnhancedQuery[]> {
  try {
    console.log('=== Enhanced Query Decomposition with Haiku ===');
    console.log('Original query:', query);
    
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const currentDay = now.getDate();
    const currentDate = `${currentYear}年${currentMonth}月${currentDay}日`;
    
    // 相対的な時間表現を具体的な日付に変換
    const expandedQuery = query
      .replace(/今年/g, `${currentYear}年`)
      .replace(/来年/g, `${currentYear + 1}年`)
      .replace(/去年|昨年/g, `${currentYear - 1}年`)
      .replace(/今月/g, `${currentYear}年${currentMonth}月`)
      .replace(/今日/g, currentDate);
    
    const prompt = `質問を分析し、最適なWeb検索戦略を生成してください。

現在の日付: ${currentDate}
元の質問: ${query}
展開した質問: ${expandedQuery}

【重要な指示】
1. ユーザーが明示的に要求した情報のみを検索する（勝手に追加しない）
2. 「AとB」「AやB」のような複合要求は必ず個別のクエリに分解
3. 必要最小限の検索クエリを生成（通常2-4個、複雑な場合のみ5個）
4. 質問に含まれていない情報（オッズ、ランキング等）は検索しない

【検索パラメータの決定基準】
- search_depth:
  * 数値/統計/ファクト/予想 → "basic"（高速）
  * 分析/詳細/背景/動向 → "advanced"（詳細）
  * 最初の1つは"advanced"、残りは情報タイプに応じて
- max_results:
  * advanced → 8-10件
  * basic → 3-5件
- days（重要：クエリごとに個別判断）:
  * 移籍ニュース、速報 → 30
  * オッズ、予想、ランキング → 指定なし（全期間）
  * 「最新」が明示されている場合のみ → 30
- topic（重要：内容で判断）:
  * 発表、ニュース → "news"
  * 統計、予想、評価 → "general"

【クエリ作成の原則】
- 複合的な要求（例：「オッズと予想」）は必ず分割
- 各クエリは単一のトピックに焦点
- 言語は内容に応じて（国際的→英語、日本固有→日本語）
- 異なる角度からアプローチ（広い→狭い、一般→具体）

【時間表現の理解】
- 「今年」「今月」「今日」は現在の日付（${currentDate}）を基準に解釈
- 「最新」「現在」が含まれる場合のみdays=30を設定
- シーズン表記（例：2025/26）は特定期間を指すのでdays指定なし

【質問に応じた検索例】
「選手の移籍先はどこ？」→ 移籍ニュースと予想のみ検索
「オッズと順位を教えて」→ オッズと順位を別々に検索
「最新情報」→ days=30を設定
質問にない情報は検索しない

以下のJSON配列形式で出力（コメントや説明文は一切含めない）:
[
  {
    "query": "検索クエリテキスト",
    "searchParams": {
      "search_depth": "basic",
      "max_results": 5
    }
  }
]`;

    const command = new InvokeModelCommand({
      modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 800,  // 5クエリ対応のため増量
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
    
    console.log('Haiku raw response:', text);
    
    // JSONをパース（エラーハンドリング強化）
    let enhancedQueries;
    try {
      // コードブロックがある場合は除去
      const jsonText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      enhancedQueries = JSON.parse(jsonText);
    } catch (parseError) {
      console.error('Failed to parse Haiku response:', parseError);
      console.log('Attempting to extract JSON from text...');
      // JSON配列を探す
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          enhancedQueries = JSON.parse(jsonMatch[0]);
        } catch (e) {
          console.error('Failed to extract JSON:', e);
          throw parseError;
        }
      } else {
        throw parseError;
      }
    }
    
    if (Array.isArray(enhancedQueries) && enhancedQueries.length > 0) {
      // 各クエリにinclude_answerを追加
      const processedQueries = enhancedQueries.map((eq: any) => ({
        query: eq.query,
        searchParams: {
          ...eq.searchParams,
          query: eq.query,
          include_answer: true,
          include_raw_content: false,
          include_images: false
        }
      }));
      
      console.log(`Successfully decomposed into ${processedQueries.length} enhanced queries`);
      return processedQueries.slice(0, 5); // 最大5クエリに拡張
    }
    
    // フォールバック
    const temporalContext = detectTemporalContext(query);
    return [{
      query: query,
      searchParams: {
        query: query,
        search_depth: 'advanced',
        max_results: 10,
        include_answer: true,
        ...temporalContext
      }
    }];
    
  } catch (error) {
    console.error('Enhanced query decomposition failed:', error);
    // フォールバック：単一クエリ
    const temporalContext = detectTemporalContext(query);
    return [{
      query: query,
      searchParams: {
        query: query,
        search_depth: 'advanced',
        max_results: 10,
        include_answer: true,
        ...temporalContext
      }
    }];
  }
}

// 強化されたLambda検索
async function searchWithEnhancedLambda(enhancedQuery: EnhancedQuery): Promise<SearchResult> {
  const startTime = Date.now();
  
  try {
    // パラメータをLambda形式に変換
    const parameters = Object.entries(enhancedQuery.searchParams)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => {
        let stringValue: string;
        if (Array.isArray(value)) {
          stringValue = value.join(',');
        } else {
          stringValue = String(value);
        }
        return { name: key, value: stringValue };
      });

    console.log(`Calling Lambda with params:`, parameters);

    const command = new InvokeCommand({
      FunctionName: process.env.TAVILY_LAMBDA_FUNCTION_NAME || 'tavily_search-giolt',
      InvocationType: 'RequestResponse',
      Payload: JSON.stringify({
        messageVersion: '1.0',
        actionGroup: 'WebSearchGroup',
        function: 'tavily_search',
        parameters: parameters
      })
    });

    const response = await lambdaClient.send(command);
    const responsePayload = JSON.parse(new TextDecoder().decode(response.Payload));
    
    // Lambda関数のレスポンスをパース
    if (responsePayload.response?.functionResponse?.responseBody?.TEXT?.body) {
      const searchData = JSON.parse(responsePayload.response.functionResponse.responseBody.TEXT.body);
      return {
        ...searchData,
        processing_time: (Date.now() - startTime) / 1000
      };
    }
    
    // 別の形式のレスポンス
    if (responsePayload.body) {
      const searchData = JSON.parse(responsePayload.body);
      return {
        ...searchData,
        processing_time: (Date.now() - startTime) / 1000
      };
    }
    
    // フォールバック
    return {
      type: 'search_results',
      query: enhancedQuery.query,
      search_performed: true,
      urls: [],
      sources: [],
      total_results: 0,
      processing_time: (Date.now() - startTime) / 1000,
      summary: 'Web検索結果を取得できませんでした。'
    };
    
  } catch (error) {
    console.error('Lambda invocation error:', error);
    return {
      type: 'search_results',
      query: enhancedQuery.query,
      search_performed: true,
      urls: [],
      sources: [],
      total_results: 0,
      processing_time: (Date.now() - startTime) / 1000,
      summary: 'Web検索でエラーが発生しました。'
    };
  }
}

// 並列で強化された検索を実行
async function performEnhancedParallelSearch(enhancedQueries: EnhancedQuery[]): Promise<SearchResult> {
  const startTime = Date.now();
  
  console.log(`=== Enhanced Parallel Search for ${enhancedQueries.length} queries ===`);
  enhancedQueries.forEach((eq, i) => {
    console.log(`Query ${i + 1}: "${eq.query}" with depth=${eq.searchParams.search_depth}, max=${eq.searchParams.max_results}`);
  });
  
  // 並列でLambda関数を呼び出し
  const searchPromises = enhancedQueries.map(async (enhancedQuery, index) => {
    console.log(`Starting search ${index + 1}: ${enhancedQuery.query}`);
    try {
      const result = await searchWithEnhancedLambda(enhancedQuery);
      console.log(`Search ${index + 1} completed: ${result.sources?.length || 0} sources, summary=${!!result.summary}`);
      return { result, queryIndex: index };
    } catch (error) {
      console.error(`Search ${index + 1} failed:`, error);
      return null;
    }
  });
  
  const results = await Promise.all(searchPromises);
  
  // 結果を統合
  const allSources: SearchSource[] = [];
  const allUrls = new Set<string>();
  const summaries: string[] = [];
  const allImages: string[] = [];
  
  results.forEach((item) => {
    if (!item) return;
    
    const { result, queryIndex } = item;
    
    // AI要約を収集（Tavilyのinclude_answerによる）
    if (result.summary && result.summary.trim()) {
      summaries.push(`【検索${queryIndex + 1}】${result.summary}`);
    }
    
    // 画像を収集
    if (result.images && result.images.length > 0) {
      allImages.push(...result.images);
    }
    
    // ソースを統合（重複URLを除去）
    if (result.sources) {
      result.sources.forEach((source: SearchSource) => {
        if (!allUrls.has(source.url)) {
          allUrls.add(source.url);
          
          // 検索戦略による重み付け
          // 1つ目（advanced）: 1.0、2つ目: 0.8、3つ目: 0.6
          const weight = 1.0 - (queryIndex * 0.2);
          
          allSources.push({
            ...source,
            id: `source_${allSources.length + 1}`,
            relevance_score: source.relevance_score * weight,
            search_query: enhancedQueries[queryIndex].query,
            query_index: queryIndex
          });
        }
      });
    }
  });
  
  // スコアでソート（上位15件）
  allSources.sort((a, b) => b.relevance_score - a.relevance_score);
  const topSources = allSources.slice(0, 15);
  
  console.log(`Enhanced parallel search completed:`);
  console.log(`- ${topSources.length} unique sources`);
  console.log(`- ${summaries.length} AI summaries`);
  console.log(`- ${allImages.length} images`);
  
  return {
    type: 'search_results',
    query: enhancedQueries.map(eq => eq.query).join(' | '),
    search_performed: true,
    summary: summaries.join('\n\n'),
    sources: topSources,
    urls: topSources.map(s => s.url),
    total_results: topSources.length,
    processing_time: (Date.now() - startTime) / 1000,
    images: allImages.slice(0, 5)  // 最大5枚
  };
}

// Claude 3.5 Sonnetで回答生成
async function callClaudeWithEnhancedContext(message: string, searchResult: SearchResult): Promise<string> {
  // 検索結果をコンテキストとして整形
  const context = formatEnhancedSearchContext(searchResult);
  
  // プロンプトの構築
  const prompt = `あなたは親切で知識豊富なアシスタントです。以下のWeb検索結果を参考に、ユーザーの質問に答えてください。

${context}

ユーザーの質問: ${message}

回答する際の指示：
1. 検索結果の情報を正確に引用してください
2. 情報源を[1], [2]のような形式で引用してください
3. 複数の情報源から得られた情報を統合して、包括的な回答を提供してください
4. 検索結果にない情報は推測せず、「検索結果には含まれていません」と述べてください
5. 日本語で回答してください
6. 重要な情報は強調してください

重要 - Markdown形式で回答してください：
- ## で主要なセクション、### でサブセクションを作成
- **太字** で重要な用語や発見を強調
- - または * で箇条書き、1. 2. 3. で番号付きリスト
- > で引用や重要な注記
- \`code\` で技術用語、\`\`\`language でコードブロック
- データ比較や構造化情報にはテーブルを使用`;

  // Converse APIを使用
  const command = new InvokeModelCommand({
    modelId: 'apac.anthropic.claude-3-5-sonnet-20241022-v2:0',
    body: JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 2048,
      temperature: 0.7,
      messages: [{
        role: "user",
        content: prompt
      }]
    })
  });

  try {
    const response = await bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    
    if (responseBody.content && responseBody.content.length > 0) {
      return responseBody.content[0].text;
    }
    
    return "申し訳ございません。回答を生成できませんでした。";
    
  } catch (error) {
    console.error('Claude API error:', error);
    throw error;
  }
}

// 強化された検索結果のコンテキスト整形
function formatEnhancedSearchContext(searchResult: SearchResult): string {
  console.log('=== Formatting Enhanced Search Context ===');
  
  if (!searchResult.sources || searchResult.sources.length === 0) {
    console.warn('No sources found in search result');
    return "Web検索結果：なし";
  }
  
  let context = "Web検索結果：\n\n";
  
  // AI要約がある場合は最初に追加（Tavilyの要約）
  if (searchResult.summary && searchResult.summary.trim()) {
    context += `=== AI要約 ===\n${searchResult.summary}\n\n`;
  }
  
  // 検索クエリごとにソースをグループ化
  const queryGroups = new Map<number, SearchSource[]>();
  searchResult.sources.forEach(source => {
    const queryIndex = source.query_index || 0;
    if (!queryGroups.has(queryIndex)) {
      queryGroups.set(queryIndex, []);
    }
    queryGroups.get(queryIndex)!.push(source);
  });
  
  // 各検索戦略の結果を表示
  context += `=== 詳細情報源（${searchResult.sources.length}件）===\n\n`;
  
  searchResult.sources.forEach((source, index) => {
    context += `[${index + 1}] ${source.title}\n`;
    context += `URL: ${source.url}\n`;
    if (source.search_query) {
      context += `検索クエリ: ${source.search_query}\n`;
    }
    context += `内容: ${source.snippet}\n`;
    context += `関連度スコア: ${source.relevance_score.toFixed(2)}\n\n`;
  });
  
  // 画像がある場合
  if (searchResult.images && searchResult.images.length > 0) {
    context += `\n=== 関連画像 ===\n`;
    context += `${searchResult.images.length}件の画像が見つかりました\n`;
  }
  
  return context;
}

export async function POST(request: NextRequest) {
  try {
    const { message, sessionId } = await request.json();

    if (!message) {
      return NextResponse.json(
        { error: true, message: 'No message provided' },
        { status: 400 }
      );
    }

    console.log('Processing enhanced query:', message);
    const startTime = Date.now();

    // ステップ1: Claude Haikuで高度なクエリ分解
    console.log('Step 1: Enhanced query decomposition with Claude Haiku...');
    const enhancedQueries = await decomposeQueryWithEnhancedHaiku(message);
    console.log(`Query decomposed into ${enhancedQueries.length} enhanced queries`);

    // ステップ2: 強化された並列Lambda検索
    console.log('Step 2: Executing enhanced parallel web searches...');
    const searchResult = await performEnhancedParallelSearch(enhancedQueries);
    console.log(`Search completed: ${searchResult.sources?.length || 0} unique sources`);

    // ステップ3: Claude 3.5 Sonnetで回答生成
    console.log('Step 3: Generating response with Claude 3.5 Sonnet...');
    const aiResponse = await callClaudeWithEnhancedContext(message, searchResult);
    
    const totalTime = Date.now() - startTime;
    console.log(`Total enhanced processing time: ${totalTime}ms`);

    // レスポンスの構築
    const response = {
      response: aiResponse,
      sessionId: sessionId || crypto.randomUUID(),
      searchResult: searchResult,
      sources: searchResult.sources?.map(source => ({
        title: source.title,
        uri: source.url,
        content: source.snippet,
        type: 'web_search' as const,
        score: source.relevance_score,
        query: source.search_query
      })),
      processingTime: totalTime,
      apiCalls: 1 + enhancedQueries.length + 1, // Haiku + Lambda(複数) + Sonnet
      enhancedFeatures: {
        queryDecomposition: true,
        adaptiveSearchDepth: true,
        temporalFiltering: enhancedQueries.some(eq => eq.searchParams.days !== undefined),
        aiSummaries: !!searchResult.summary,
        imageSearch: (searchResult.images?.length || 0) > 0
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
      },
      { status: isRateLimit ? 429 : 500 }
    );
  }
}