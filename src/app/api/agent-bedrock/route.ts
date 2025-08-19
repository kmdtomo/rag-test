import { NextRequest, NextResponse } from 'next/server';
import { 
  BedrockAgentRuntimeClient, 
  InvokeAgentCommand,
  FlowCompletionEvent,
  TracePart
} from '@aws-sdk/client-bedrock-agent-runtime';

// 型定義
interface SearchSource {
  id: string;
  url: string;
  title: string;
  snippet: string;
  relevance_score: number;
  search_query?: string;
}

interface SearchResult {
  type: 'search_results';
  query: string;
  search_performed: boolean;
  summary?: string;
  sources?: SearchSource[];
  urls?: string[];
  total_results?: number;
  processing_time?: number;
  images?: string[];
}

// モデルIDマップ（インファレンスプロファイルを使用）
const modelMap = {
  'sonnet35': `arn:aws:bedrock:${process.env.AWS_REGION || 'ap-northeast-1'}:794796779989:inference-profile/${process.env.BEDROCK_MODEL_ID_SONNET_35 || 'apac.anthropic.claude-3-5-sonnet-20241022-v2:0'}`,
  'sonnet4': `arn:aws:bedrock:${process.env.AWS_REGION || 'ap-northeast-1'}:794796779989:inference-profile/${process.env.BEDROCK_MODEL_ID_SONNET_4 || 'apac.anthropic.claude-sonnet-4-20250514-v1:0'}`
};

// Bedrock Agent Runtimeクライアント
const agentClient = new BedrockAgentRuntimeClient({
  region: process.env.AWS_REGION || 'ap-northeast-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

// エージェントIDとエイリアスID
const AGENT_ID = process.env.BEDROCK_AGENT_ID || '009NRJ1JQ4';
const AGENT_ALIAS_ID = process.env.BEDROCK_AGENT_ALIAS_ID || 'TSTALIASID';

// トレース情報からWeb検索結果を抽出
function extractSearchResultsFromTrace(traces: TracePart[]): SearchResult | null {
  let searchResult: SearchResult | null = null;
  console.log('Extracting search results from traces...');

  for (const trace of traces) {
    // オーケストレーショントレース内のアクションを確認
    if (trace.trace?.orchestrationTrace?.observation?.actionGroupInvocationOutput) {
      const output = trace.trace.orchestrationTrace.observation.actionGroupInvocationOutput;
      
      if (output.text) {
        try {
          // Lambda関数からの応答をパース
          const parsedOutput = JSON.parse(output.text);
          
          // ネストされたレスポンス構造を確認
          if (parsedOutput.response?.functionResponse?.responseBody?.TEXT?.body) {
            const bodyText = parsedOutput.response.functionResponse.responseBody.TEXT.body;
            const searchData = JSON.parse(bodyText);
            
            // 検索結果の形式を確認
            if (searchData.type === 'search_results' && searchData.search_performed) {
              searchResult = searchData;
              console.log(`Found ${searchData.sources?.length || 0} sources from web search`);
            }
          }
        } catch (e) {
          console.error('Failed to parse trace output:', e);
        }
      }
    }

    // 知識ベースの結果も確認（もしある場合）
    if (trace.trace?.orchestrationTrace?.observation?.knowledgeBaseLookupOutput) {
      const kbResults = trace.trace.orchestrationTrace.observation.knowledgeBaseLookupOutput.retrievedReferences;
      
      if (kbResults && kbResults.length > 0 && !searchResult) {
        // 知識ベースの結果をSearchResult形式に変換
        const sources: SearchSource[] = kbResults.map((ref, idx) => ({
          id: `kb_source_${idx + 1}`,
          url: String(ref.location?.s3Location?.uri || ''),
          title: String(ref.metadata?.['x-amz-bedrock-kb-source-uri'] || 'Knowledge Base Document'),
          snippet: String(ref.content?.text || ''),
          relevance_score: Number(ref.metadata?.['score'] || 0.5)
        }));

        searchResult = {
          type: 'search_results',
          query: '',
          search_performed: true,
          sources,
          urls: sources.map(s => s.url).filter(Boolean),
          total_results: sources.length
        };
      }
    }
  }

  return searchResult;
}

// ストリーミングレスポンスを処理
async function processAgentStream(
  response: AsyncIterable<any>,
  onChunk?: (chunk: string) => void
): Promise<{ fullResponse: string; traces: TracePart[]; sessionId?: string }> {
  let fullResponse = '';
  const traces: TracePart[] = [];
  let sessionId: string | undefined;

  for await (const event of response) {
    // チャンクデータの処理
    if ('chunk' in event && event.chunk && typeof event.chunk === 'object' && event.chunk !== null && 'bytes' in event.chunk) {
      const chunkText = new TextDecoder().decode((event.chunk as any).bytes);
      fullResponse += chunkText;
      if (onChunk) {
        onChunk(chunkText);
      }
    }

    // トレース情報の収集
    if ('trace' in event && (event as any).trace?.trace) {
      traces.push((event as any).trace);
    }

    // セッションIDの取得
    if ('metadata' in event && (event as any).metadata?.sessionId) {
      sessionId = (event as any).metadata.sessionId;
    }
  }

  return { fullResponse, traces, sessionId };
}

export async function POST(request: NextRequest) {
  try {
    const { message, sessionId: providedSessionId, model = 'sonnet4' } = await request.json();

    if (!message) {
      return NextResponse.json(
        { error: true, message: 'No message provided' },
        { status: 400 }
      );
    }

    console.log('Processing Bedrock Agent query:', message);
    const startTime = Date.now();

    // セッションIDの生成または使用
    const sessionId = providedSessionId || crypto.randomUUID();

    // モデル選択のログ（エージェント自体のモデルはAWSコンソールで設定）
    console.log(`Model preference: ${model}, but using agent's configured model`);
    console.log(`Agent ID: ${AGENT_ID}, Alias: ${AGENT_ALIAS_ID}`);

    // Bedrock Agentの呼び出し
    const command = new InvokeAgentCommand({
      agentId: AGENT_ID,
      agentAliasId: AGENT_ALIAS_ID,
      sessionId: sessionId,
      inputText: message,
      enableTrace: true, // トレース情報を有効化
      // モデル設定はエージェント自体の設定に依存
    });

    const response = await agentClient.send(command);

    if (!response.completion) {
      throw new Error('No completion stream in response');
    }

    // ストリーミングレスポンスの処理
    const { fullResponse, traces, sessionId: returnedSessionId } = await processAgentStream(
      response.completion
    );

    // トレースから検索結果を抽出
    const searchResult = extractSearchResultsFromTrace(traces);
    
    // デバッグ: トレース情報を詳細にログ出力
    console.log('\n=== Bedrock Agent Trace Analysis ===');
    console.log('Total traces:', traces.length);
    traces.forEach((trace, i) => {
      if (trace.trace?.orchestrationTrace?.modelInvocationInput) {
        console.log(`Trace ${i}: Model invocation detected`);
      }
      if (trace.trace?.orchestrationTrace?.observation?.actionGroupInvocationOutput) {
        console.log(`Trace ${i}: Action group output detected`);
      }
    });

    const totalTime = Date.now() - startTime;
    console.log(`Bedrock Agent processing time: ${totalTime}ms`);

    // レスポンス内の引用番号を抽出
    const citationRegex = /\[(\d+)\]/g;
    const citedNumbers = new Set<number>();
    let match;
    while ((match = citationRegex.exec(fullResponse)) !== null) {
      citedNumbers.add(parseInt(match[1]));
    }
    
    console.log('Found citations in response:', Array.from(citedNumbers));

    // ソース情報の整形（引用番号付き）
    const sources = searchResult?.sources?.map((source, index) => {
      const citationNumber = index + 1;
      const isCited = citedNumbers.has(citationNumber);
      
      return {
        title: source.title,
        uri: source.url,
        content: source.snippet,
        type: 'web_search' as const,
        score: source.relevance_score,
        query: source.search_query,
        citationNumber: citationNumber,
        pageNumber: source.url ? new URL(source.url).pathname.split('/').pop() : undefined
      };
    }).filter((source, index) => {
      // 引用されたソースのみを保持（または全て表示）
      const citationNumber = index + 1;
      return citedNumbers.has(citationNumber) || citedNumbers.size === 0;
    }) || [];

    // レスポンスの構築
    const apiResponse = {
      response: fullResponse,
      sessionId: returnedSessionId || sessionId,
      searchResult: searchResult,
      sources: sources,
      processingTime: totalTime,
      apiCalls: 1, // Bedrock Agent呼び出し
      enhancedFeatures: {
        bedrockAgent: true,
        autoOrchestration: true,
        traceEnabled: true,
        webSearch: searchResult?.search_performed || false,
        knowledgeBase: sources.some(s => s.uri.includes('s3://'))
      }
    };

    return NextResponse.json(apiResponse);

  } catch (error: any) {
    console.error('Bedrock Agent error:', error);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      statusCode: error.$metadata?.httpStatusCode,
      requestId: error.$metadata?.requestId
    });
    
    const isRateLimit = error.name === 'ThrottlingException' || 
                       error.name === 'ServiceQuotaExceededException' ||
                       error.$metadata?.httpStatusCode === 429;
    
    return NextResponse.json(
      { 
        error: true, 
        message: error.message || 'Processing failed',
        code: error.name || 'AGENT_ERROR',
        isRateLimit,
        userMessage: isRateLimit ? 
          'リクエストが混み合っています。少しお待ちください。' : 
          'エージェントでエラーが発生しました。もう一度お試しください。',
      },
      { status: isRateLimit ? 429 : 500 }
    );
  }
}