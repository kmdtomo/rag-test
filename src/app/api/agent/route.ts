import { NextRequest, NextResponse } from 'next/server';
import { BedrockAgentRuntimeClient, InvokeAgentCommand } from '@aws-sdk/client-bedrock-agent-runtime';

// Bedrockエージェント用のクライアントを作成
const agentClient = new BedrockAgentRuntimeClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export async function POST(request: NextRequest) {
  try {
    const { message, sessionId } = await request.json();

    if (!message) {
      return NextResponse.json(
        { error: true, message: 'No message provided' },
        { status: 400 }
      );
    }

    // エージェントIDとエイリアスIDを環境変数から取得（デフォルト値を設定）
    const agentId = process.env.BEDROCK_AGENT_ID || '009NRJ1JQ4';
    const agentAliasId = process.env.BEDROCK_AGENT_ALIAS_ID || 'TSTALIASID';

    console.log('Invoking Bedrock Agent:', {
      agentId,
      agentAliasId,
      sessionId: sessionId || 'new-session',
      message
    });

    // エージェントを呼び出す
    const command = new InvokeAgentCommand({
      agentId,
      agentAliasId,
      sessionId: sessionId || crypto.randomUUID(),
      inputText: message,
      enableTrace: true, // トレース情報を有効化
    });

    const response = await agentClient.send(command);
    
    // レスポンスのストリームを処理
    const chunks: any[] = [];
    const traces: any[] = [];
    let fullResponse = '';
    
    if (response.completion) {
      for await (const event of response.completion) {
        // チャンクからテキストを抽出
        if (event.chunk?.bytes) {
          const text = new TextDecoder().decode(event.chunk.bytes);
          fullResponse += text;
          chunks.push(event.chunk);
        }
        
        // トレース情報を抽出
        if (event.trace) {
          traces.push(event.trace);
          if (process.env.NODE_ENV === 'development') {
            console.log('Trace event:', JSON.stringify(event.trace, null, 2));
          }
        }
        
        // その他のイベントタイプをログ
        if (process.env.NODE_ENV === 'development' && !event.chunk && !event.trace) {
          console.log('Unknown event type:', JSON.stringify(event, null, 2));
        }
      }
    }

    console.log('Agent response:', {
      fullResponse,
      sessionId: response.sessionId,
      traceCount: traces.length
    });

    // ソース情報をトレースから抽出
    const sources: any[] = [];
    const searchedUrls: string[] = [];
    
    if (traces.length > 0) {
      // 実際のトレースから情報を抽出
      traces.forEach(trace => {
        // デバッグ: トレース構造を確認
        if (process.env.NODE_ENV === 'development') {
          console.log('Trace structure:', JSON.stringify(trace, null, 2));
        }
        
        // modelInvocationInputからWeb検索結果を抽出
        if (trace.orchestrationTrace?.modelInvocationInput?.text) {
          try {
            const invocationData = JSON.parse(trace.orchestrationTrace.modelInvocationInput.text);
            
            // messages配列からtool_resultを探す
            if (invocationData.messages && Array.isArray(invocationData.messages)) {
              invocationData.messages.forEach((msg: any) => {
                if (msg.content) {
                  // contentが文字列の場合はパース
                  const contentArray = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;
                  
                  if (Array.isArray(contentArray)) {
                    contentArray.forEach((item: any) => {
                      // tavily_searchの結果を探す
                      if (item.type === 'tool_result' && item.content) {
                        item.content.forEach((contentItem: any) => {
                          if (contentItem.text) {
                            try {
                              // エスケープされたJSONをパース
                              const searchResults = JSON.parse(contentItem.text.replace(/\\"/g, '"'));
                              
                              if (Array.isArray(searchResults)) {
                                searchResults.forEach((result: any) => {
                                  if (result.url) {
                                    searchedUrls.push(result.url);
                                    sources.push({
                                      title: result.title || 'Web検索結果',
                                      content: result.content || '',
                                      uri: result.url,
                                      type: 'web_search',
                                      score: 1.0
                                    });
                                  }
                                });
                              }
                            } catch (e) {
                              console.error('Failed to parse search results:', e);
                            }
                          }
                        });
                      }
                    });
                  }
                }
              });
            }
          } catch (e) {
            console.error('Failed to parse trace:', e);
          }
        }
        
        if (trace.orchestrationTrace?.observation) {
          const observation = trace.orchestrationTrace.observation;
          
          // ナレッジベースからのソース
          if (observation.knowledgeBaseLookupOutput?.retrievedReferences) {
            observation.knowledgeBaseLookupOutput.retrievedReferences.forEach((ref: any) => {
              sources.push({
                content: ref.content?.text,
                location: ref.location,
                uri: ref.location?.s3Location?.uri,
                score: ref.retrievalScore,
                type: 'knowledge_base'
              });
            });
          }
        }
      });
    }
    
    // 抽出したURLをコンソールに表示
    if (searchedUrls.length > 0) {
      console.log('\n=== Web検索で参照されたURL ===');
      searchedUrls.forEach((url, index) => {
        console.log(`${index + 1}. ${url}`);
      });
      console.log('========================\n');
    }

    return NextResponse.json({
      response: fullResponse,
      sessionId: response.sessionId,
      sources,
      searchedUrls: searchedUrls.length > 0 ? searchedUrls : undefined,
      // トレース情報は開発環境でのみ、かつ最小限の情報のみ返す
      traces: process.env.NODE_ENV === 'development' ? traces.map(trace => ({
        // 必要最小限の情報のみ抽出
        type: trace.orchestrationTrace ? 'orchestration' : trace.failureTrace ? 'failure' : 'unknown',
        timestamp: trace.eventTime,
        // エラー情報
        error: trace.failureTrace ? {
          code: trace.failureTrace.failureCode,
          reason: trace.failureTrace.failureReason
        } : undefined,
        // Web検索の実行記録
        hasWebSearch: trace.orchestrationTrace?.modelInvocationInput?.text?.includes('tavily_search') || false
      })) : undefined,
    });

  } catch (error: any) {
    console.error('Agent error details:', {
      name: error.name,
      message: error.message,
      code: error.$metadata?.httpStatusCode,
      requestId: error.$metadata?.requestId
    });

    const isRateLimit = error.name === 'ThrottlingException' || 
                       error.name === 'ServiceQuotaExceededException' ||
                       error.$metadata?.httpStatusCode === 429;
    
    return NextResponse.json(
      { 
        error: true, 
        message: error.message || 'Agent processing failed', 
        code: error.name || 'AGENT_ERROR',
        isRateLimit,
        userMessage: isRateLimit ? 
          'リクエストが多すぎます。しばらく時間をおいてから再度お試しください。' : 
          'エラーが発生しました。もう一度お試しください。',
        details: error.$metadata
      },
      { status: isRateLimit ? 429 : 500 }
    );
  }
}