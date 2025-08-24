import { NextRequest, NextResponse } from 'next/server';
import { BedrockRuntimeClient, ConverseCommand, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

// 型定義
interface SearchSource {
  id: string;
  url: string;
  title: string;
  snippet: string;
  relevance_score: number;
  search_query?: string;  // 検索クエリを追加
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
}

// Bedrockクライアント（エージェントではなく直接モデル呼び出し用）
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

// Claude Haikuでクエリを分解
async function decomposeQueryWithHaiku(query: string, addLog: (msg: string) => void): Promise<string[]> {
  try {
    addLog('\n🤔 Claude Haikuでクエリを分析中...');
    addLog(`💬 元の質問: ${query}`);
    
    // 現在の日付を取得
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    
    const prompt = `質問を3つの検索クエリに分解してください。

現在: ${currentYear}年${currentMonth}月
質問: ${query}

ルール:
- 必ず3つの異なる視点からの検索クエリを作成
- 国際的な話題は英語、日本の話題は日本語で検索
- JSON配列形式で文字列のみを返す

出力: ["クエリ1", "クエリ2", "クエリ3"]`;

    const command = new InvokeModelCommand({
      modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 200,
        temperature: 0,
        messages: [{
          role: "user",
          content: prompt
        }]
      })
    });

    const response = await bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const subQueriesText = responseBody.content[0].text.trim();
    
    addLog(`🤖 Haikuの回答: ${subQueriesText}`);
    
    const subQueries = JSON.parse(subQueriesText);
    if (Array.isArray(subQueries) && subQueries.length > 0) {
      addLog(`✅ ${subQueries.length}個のクエリに分解成功: ${JSON.stringify(subQueries)}`);
      return subQueries.slice(0, 3); // 3クエリに固定
    }
    
    return [query]; // フォールバック
    
  } catch (error) {
    console.error('Query decomposition failed:', error);
    addLog('⚠️ クエリ分解に失敗 - フォールバックを使用');
    // フォールバック：単一クエリ
    return [query];
  }
}

// 単一のLambda検索を実行
async function searchWithLambda(query: string, addLog?: (msg: string) => void): Promise<SearchResult> {
  const startTime = Date.now();
  
  try {
    const command = new InvokeCommand({
      FunctionName: process.env.TAVILY_LAMBDA_FUNCTION_NAME || 'tavily_search-giolt',
      InvocationType: 'RequestResponse',
      Payload: JSON.stringify({
        messageVersion: '1.0',
        actionGroup: 'WebSearchGroup',
        function: 'tavily_search',
        parameters: [
          { name: 'query', value: query }
        ]
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
    
    // Lambda関数が正常に動作したが、期待する形式でない場合
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
      query: query,
      search_performed: true,
      urls: [],
      sources: [],
      total_results: 0,
      processing_time: (Date.now() - startTime) / 1000,
      summary: 'Web検索結果を取得できませんでした。'
    };
    
  } catch (error) {
    console.error('Lambda invocation error:', error);
    if (addLog) addLog('❌ Lambda関数の呼び出しでエラーが発生しました');
    return {
      type: 'search_results',
      query: query,
      search_performed: true,
      urls: [],
      sources: [],
      total_results: 0,
      processing_time: (Date.now() - startTime) / 1000,
      summary: 'Web検索でエラーが発生しました。'
    };
  }
}

// Claude 3.5 Sonnetを直接呼び出し（Converse APIを使用）
async function callClaude(message: string, searchResult: SearchResult): Promise<string> {
  // 検索結果をコンテキストとして整形
  const context = formatSearchContext(searchResult);
  
  // プロンプトの構築
  const prompt = `
あなたは親切で知識豊富なアシスタントです。以下のWeb検索結果を参考に、ユーザーの質問に答えてください。

${context}

ユーザーの質問: ${message}

回答する際は：
1. 検索結果の情報を正確に引用してください
2. 情報源を[1], [2]のような形式で引用してください
3. 検索結果にない情報は推測せず、「検索結果には含まれていません」と述べてください
4. 日本語で回答してください

重要 - Markdown形式で回答してください：
- ## で主要なセクション、### でサブセクションを作成
- **太字** で重要な用語や発見を強調
- - または * で箇条書き、1. 2. 3. で番号付きリスト
- > で引用や重要な注記
- \`code\` で技術用語、\`\`\`language でコードブロック
- データ比較や構造化情報にはテーブルを使用
`;

  // Converse APIを使用（システム定義のAPAC推論プロファイルを使用）
  const command = new ConverseCommand({
    modelId: 'apac.anthropic.claude-3-5-sonnet-20241022-v2:0',
    messages: [
      {
        role: "user",
        content: [
          {
            text: prompt
          }
        ]
      }
    ],
    inferenceConfig: {
      maxTokens: 2048,
      temperature: 0.7
    }
  });

  try {
    const response = await bedrockClient.send(command);
    
    // Converseレスポンスから回答を抽出
    if (response.output?.message?.content && response.output.message.content.length > 0) {
      const textContent = response.output.message.content[0];
      if ('text' in textContent && textContent.text) {
        return textContent.text;
      }
    }
    
    return "申し訳ございません。回答を生成できませんでした。";
    
  } catch (error) {
    console.error('Claude API error:', error);
    throw error;
  }
}

// 検索結果をコンテキストとして整形
function formatSearchContext(searchResult: SearchResult): string {
  console.log('📄 検索結果をフォーマット中...');
  console.log('情報源数:', searchResult.sources?.length || 0);
  console.log('URL数:', searchResult.urls?.length || 0);
  
  if (!searchResult.sources || searchResult.sources.length === 0) {
    console.warn('⚠️ 検索結果に情報源が見つかりませんでした');
    return "Web検索結果：なし";
  }
  
  let context = "Web検索結果：\n\n";
  
  // 要約がある場合は追加
  if (searchResult.summary) {
    context += `📝 概要: ${searchResult.summary}\n\n`;
  }
  
  // 各ソースを整形
  searchResult.sources?.forEach((source, index) => {
    context += `[${index + 1}] ${source.title}\n`;
    context += `URL: ${source.url}\n`;
    context += `内容: ${source.snippet}\n`;
    context += `関連度スコア: ${source.relevance_score.toFixed(2)}\n\n`;
  });
  
  return context;
}

// 並列でLambda検索を実行し、結果を統合
async function performParallelSearch(queries: string[], addLog: (msg: string) => void): Promise<SearchResult> {
  const startTime = Date.now();
  
  addLog(`\n🔍 ${queries.length}個のクエリで並列検索を実行...`);
  
  // 並列でLambda関数を呼び出し
  const searchPromises = queries.map(async (query, index) => {
    addLog(`  🔍 検索 ${index + 1} を開始: ${query}`);
    try {
      const result = await searchWithLambda(query, addLog);
      addLog(`  ✅ 検索 ${index + 1} 完了: ${result.urls?.length || 0}件のURLを取得`);
      return result;
    } catch (error) {
      console.error(`Search ${index + 1} failed:`, error);
      addLog(`  ❌ 検索 ${index + 1} が失敗しました`);
      return null;
    }
  });
  
  const results = await Promise.all(searchPromises);
  
  // 結果を統合
  const allSources: SearchSource[] = [];
  const allUrls = new Set<string>();
  const summaries: string[] = [];
  
  results.forEach((result, index) => {
    if (!result) return;
    
    // 要約を収集
    if (result.summary) {
      summaries.push(`🔍 検索: ${queries[index]}\n${result.summary}`);
    }
    
    // ソースを統合（重複URLを除去）
    if (result.sources) {
      result.sources.forEach((source: SearchSource) => {
        if (!allUrls.has(source.url)) {
          allUrls.add(source.url);
          allSources.push({
            ...source,
            id: `source_${allSources.length + 1}`,
            search_query: queries[index]
          });
        }
      });
    }
  });
  
  // スコアでソート（上位15件）
  allSources.sort((a, b) => b.relevance_score - a.relevance_score);
  const topSources = allSources.slice(0, 15);
  
  addLog(`✅ 並列検索完了: ${topSources.length}件のユニークな情報源を収集`);
  
  return {
    type: 'search_results',
    query: queries.join(' | '),
    search_performed: true,
    summary: summaries.join('\n\n'),
    sources: topSources,
    urls: topSources.map(s => s.url),
    total_results: topSources.length,
    processing_time: (Date.now() - startTime) / 1000
  };
}

export async function POST(request: NextRequest) {
  const processLog: string[] = [];
  const addLog = (message: string) => {
    console.log(message);
    processLog.push(message);
  };
  
  try {
    const { message, sessionId } = await request.json();

    if (!message) {
      return NextResponse.json(
        { error: true, message: 'No message provided' },
        { status: 400 }
      );
    }

    addLog(`\n╔════════════════════════════════════════╗\n║ 🎯 エージェント直接API リクエスト開始 🎯 ║\n╚════════════════════════════════════════╝\n💬 ユーザーの質問: ${message}`);
    const startTime = Date.now();

    // ステップ1: Claude Haikuでクエリを分解（1回目のAPI呼び出し）
    addLog('\n🔹 ステップ1: Claude Haikuでクエリを分解中...');
    const subQueries = await decomposeQueryWithHaiku(message, addLog);
    addLog(`✅ ${subQueries.length}個のサブクエリに分解: ${JSON.stringify(subQueries)}`);

    // ステップ2: 並列Lambda検索（2-4回目のAPI呼び出し）
    addLog('\n🔹 ステップ2: Lambdaで並列Web検索を実行中...');
    const searchResult = await performParallelSearch(subQueries, addLog);
    addLog(`✅ 検索完了: ${searchResult.urls?.length || 0}件のユニークURLを取得`);

    // ステップ3: Bedrock Claude APIで回答生成（最後のAPI呼び出し）
    addLog('\n🔹 ステップ3: Claudeで回答を生成中...');
    const aiResponse = await callClaude(message, searchResult);
    
    const totalTime = Date.now() - startTime;
    addLog(`\n╔════════════════════════════════════════╗\n║ 🏁 処理完了サマリー 🏁 ║\n╚════════════════════════════════════════╝\n⏱️  合計処理時間: ${totalTime}ミリ秒 (${(totalTime / 1000).toFixed(2)}秒)\n${'─'.repeat(40)}`);

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
      apiCalls: 2 + subQueries.length, // Haiku + Lambda(複数) + Claude
      metadata: {
        processLog: processLog
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