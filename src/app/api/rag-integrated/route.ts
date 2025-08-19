import { NextRequest, NextResponse } from 'next/server';
import { 
  BedrockAgentRuntimeClient, 
  RetrieveAndGenerateCommand,
  RetrieveCommand
} from '@aws-sdk/client-bedrock-agent-runtime';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { randomUUID } from 'crypto';

// Bedrock Agent Runtime Client
const agentClient = new BedrockAgentRuntimeClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

// Bedrock Runtime Client for direct model invocation
const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

// セッション管理用のメモリストア（本番環境ではRedisやDynamoDBを使用）
const sessionStore = new Map<string, {
  sessionId: string;
  createdAt: Date;
  lastUsed: Date;
  messageCount: number;
}>();

// セッションクリーンアップ（30分経過したセッションを削除）
function cleanupSessions() {
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
  for (const [userId, session] of sessionStore.entries()) {
    if (session.lastUsed < thirtyMinutesAgo) {
      sessionStore.delete(userId);
    }
  }
}

// 高度なプロンプトテンプレート
const ADVANCED_PROMPT_TEMPLATE = `Human: You are an advanced AI assistant with access to a comprehensive knowledge base. 

Your primary objectives:
1. Provide accurate, detailed, and well-structured answers
2. Maintain context across conversations when using sessions
3. Cite sources appropriately using inline references
4. Synthesize information from multiple sources coherently
5. Respond in Japanese unless otherwise specified

Additional instructions:
- For technical topics: Include code examples when relevant
- For explanatory topics: Use clear structures with headings and bullet points
- For comparative topics: Create tables or structured comparisons
- Always indicate confidence level for uncertain information

Remember to:
- Be concise yet comprehensive
- Prioritize accuracy over speculation
- Acknowledge when information might be incomplete

$search_results$

User Question: $query$`;

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const stepTimings: { [key: string]: number } = {};
  
  const logStep = (step: string) => {
    const currentTime = Date.now();
    const elapsed = currentTime - startTime;
    stepTimings[step] = elapsed;
    console.log(`[${elapsed}ms] ${step}`);
  };
  
  try {
    logStep('Request received');
    const { 
      message, 
      model = 'sonnet', 
      userId = 'anonymous',
      useSession = false,  // セッション機能を一時的に無効化
      sessionId: providedSessionId 
    } = await request.json();

    if (!message) {
      return NextResponse.json(
        { error: true, message: 'No message provided' },
        { status: 400 }
      );
    }

    console.log('\n========================================');
    console.log('=== RAG Integrated API Request ===');
    console.log('========================================');
    console.log('Query:', message);
    console.log('Model:', model);
    console.log('Session enabled:', useSession);
    console.log('Knowledge Base ID:', process.env.BEDROCK_KNOWLEDGE_BASE_ID);
    console.log('AWS Region:', process.env.AWS_REGION);
    console.log('========================================\n');
    
    logStep('Initial setup completed');

    // セッションクリーンアップ
    logStep('Session cleanup started');
    cleanupSessions();
    logStep('Session cleanup completed');

    let sessionConfig: any = undefined;
    let sessionInfo = null;

    if (useSession) {
      // セッション管理
      let session = sessionStore.get(userId);
      
      if (providedSessionId && session?.sessionId === providedSessionId) {
        // 既存セッションを使用
        session!.lastUsed = new Date();
        session!.messageCount++;
      } else {
        // 新規セッション作成
        session = {
          sessionId: providedSessionId || randomUUID(),
          createdAt: new Date(),
          lastUsed: new Date(),
          messageCount: 1
        };
        sessionStore.set(userId, session);
      }

      sessionConfig = {
        sessionId: session!.sessionId
      };
      
      sessionInfo = {
        sessionId: session!.sessionId,
        messageCount: session!.messageCount,
        isNewSession: session!.messageCount === 1
      };

      console.log('Session info:', sessionInfo);
    }

    // モデルマップ（インファレンスプロファイルARNを直接使用）
    const modelMap = {
      'sonnet35': 'arn:aws:bedrock:ap-northeast-1:794796779989:inference-profile/apac.anthropic.claude-3-5-sonnet-20241022-v2:0',
      'sonnet4': 'arn:aws:bedrock:ap-northeast-1:794796779989:inference-profile/apac.anthropic.claude-sonnet-4-20250514-v1:0'
    };

    const selectedModelArn = modelMap[model as keyof typeof modelMap] || modelMap['sonnet35'];
    
    console.log('Selected model ARN:', selectedModelArn);
    logStep('Model selection completed');

    // RetrieveAndGenerateコマンドの準備（引用強化版）
    const commandInput: any = {
      input: {
        text: message
      },
      retrieveAndGenerateConfiguration: {
        type: 'KNOWLEDGE_BASE',
        knowledgeBaseConfiguration: {
          knowledgeBaseId: process.env.BEDROCK_KNOWLEDGE_BASE_ID!,
          modelArn: selectedModelArn,
          retrievalConfiguration: {
            vectorSearchConfiguration: {
              numberOfResults: 10,  // フロント側と合わせる
              overrideSearchType: 'HYBRID'  // ハイブリッド検索を使用
            }
          },
          generationConfiguration: {
            promptTemplate: {
              textPromptTemplate: `以下の検索結果を使用して、ユーザーの質問に日本語で回答してください。

【重要な指示】:
1. 必ず検索結果から得た情報には [1], [2], [3] などの引用番号を付けてください
2. Markdown形式で構造化された回答を作成してください
3. ## で主要なセクション、### でサブセクションを構成してください
4. 重要な用語は**太字**で強調してください
5. 日本語で回答してください

$search_results$

質問: $query$

上記の検索結果を必ず引用して、引用番号を含むMarkdown形式で回答してください:`
            },
            inferenceConfig: {
              temperature: 0.3,
              topP: 0.95,
              maxTokens: 4096
            }
          }
        }
      }
    };

    // セッション設定を追加
    if (sessionConfig) {
      commandInput.sessionConfiguration = sessionConfig;
    }

    logStep('Building RetrieveAndGenerate command');
    const command = new RetrieveAndGenerateCommand(commandInput);
    logStep('Command built successfully');

    console.log('\n--- Executing RetrieveAndGenerate command ---');
    logStep('Starting RetrieveAndGenerate');
    const response = await agentClient.send(command);
    logStep('RetrieveAndGenerate completed');
    
    console.log('RetrieveAndGenerate response summary:', {
      hasOutput: !!response.output?.text,
      outputLength: response.output?.text?.length || 0,
      citationsCount: response.citations?.length || 0,
      hasGuardrailAction: !!response.guardrailAction,
      guardrailAction: response.guardrailAction,
      sessionId: response.sessionId,
      outputText: response.output?.text?.substring(0, 100) + '...'
    });
    
    // ガードレール情報の詳細出力
    if (response.guardrailAction) {
      console.log('Guardrail action detected:', JSON.stringify(response.guardrailAction, null, 2));
    }

    console.log('Response received:', {
      sessionId: response.sessionId,
      citationsCount: response.citations?.length || 0
    });
    
    // デバッグ: 引用情報の構造を確認
    if (response.citations && response.citations.length > 0) {
      console.log('Total citations:', response.citations.length);
      console.log('Citation structure sample:', JSON.stringify(response.citations[0], null, 2));
    }

    // 全ての参照を収集（複数のretrievedReferencesがある場合に対応）
    logStep('Starting source collection');
    const allSources: any[] = [];
    const sourceMap = new Map<string, any>();
    let citationCounter = 1;
    
    // citations が空の場合の詳細なデバッグ
    console.log('Citations debug info:');
    console.log('- Citations array length:', response.citations?.length || 0);
    console.log('- Full citations structure:', JSON.stringify(response.citations, null, 2));
    
    if (response.citations && response.citations.length > 0) {
      response.citations.forEach((citation: any, citationIndex: number) => {
        console.log(`Processing citation ${citationIndex}:`, {
          hasRetrievedReferences: !!citation.retrievedReferences,
          retrievedReferencesLength: citation.retrievedReferences?.length || 0,
          generatedResponsePart: !!citation.generatedResponsePart
        });
        
        // 各citationから全てのretrievedReferencesを取得
        if (citation.retrievedReferences && citation.retrievedReferences.length > 0) {
          citation.retrievedReferences.forEach((ref: any, refIndex: number) => {
            console.log(`Processing retrieved reference ${refIndex}:`, {
              hasContent: !!ref.content?.text,
              hasLocation: !!ref.location,
              hasMetadata: !!ref.metadata,
              uri: ref.location?.s3Location?.uri
            });
            
            const key = `${ref.location?.s3Location?.uri}-${ref.metadata?.['x-amz-bedrock-kb-chunk-id']}`;
            
            // 重複チェック
            if (!sourceMap.has(key)) {
              const source = {
                content: ref.content?.text,
                location: ref.location,
                uri: ref.location?.s3Location?.uri,
                score: ref.metadata?.score || ref.score,
                metadata: ref.metadata,
                citationNumber: citationCounter++,
                pageNumber: ref.metadata?.['x-amz-bedrock-kb-document-page-number'],
                type: 'knowledge_base'
              };
              sourceMap.set(key, source);
              allSources.push(source);
            }
          });
        } else {
          // retrievedReferencesが空の場合の処理
          console.log(`Citation ${citationIndex} has no retrieved references. Citation details:`, {
            generatedResponsePartText: citation.generatedResponsePart?.textResponsePart?.text,
            span: citation.generatedResponsePart?.textResponsePart?.span
          });
        }
      });
    } else {
      console.log('No citations found in response');
    }

    console.log('Total unique sources found:', allSources.length);
    logStep(`Source collection completed: ${allSources.length} sources`);
    
    // フォールバック: RetrieveAndGenerateで参照が取得できない場合は直接Retrieveを実行
    if (allSources.length === 0) {
      console.log('\n--- No sources found, executing fallback Retrieve ---');
      logStep('Starting fallback Retrieve');
      
      try {
        const retrieveCommand = new RetrieveCommand({
          knowledgeBaseId: process.env.BEDROCK_KNOWLEDGE_BASE_ID!,
          retrievalQuery: {
            text: message
          },
          retrievalConfiguration: {
            vectorSearchConfiguration: {
              numberOfResults: 10,
              overrideSearchType: 'HYBRID'
            }
          }
        });
        
        const retrieveResponse = await agentClient.send(retrieveCommand);
        logStep('Fallback Retrieve completed');
        console.log('Direct retrieve found:', retrieveResponse.retrievalResults?.length || 0, 'results');
        
        // 直接取得した結果を処理
        retrieveResponse.retrievalResults?.forEach((result: any, index: number) => {
          const source = {
            content: result.content?.text,
            location: result.location,
            uri: result.location?.s3Location?.uri,
            score: result.score,
            metadata: result.metadata,
            citationNumber: index + 1,
            pageNumber: result.metadata?.['x-amz-bedrock-kb-document-page-number'],
            type: 'knowledge_base'
          };
          allSources.push(source);
        });
        
        console.log('Fallback retrieve added:', allSources.length, 'sources');
      } catch (retrieveError) {
        console.error('Fallback retrieve failed:', retrieveError);
      }
    }
    
    // デバッグ: ソースの引用番号を確認
    allSources.forEach(source => {
      console.log(`[${source.citationNumber}] - ${source.uri?.split('/').pop() || 'unknown'} (page ${source.pageNumber || 'N/A'})`);
    });

    // レスポンスの構築
    logStep('Building final response');
    let finalResponse = response.output?.text || 'No response generated';
    
    // もしRetrieveAndGenerateが失敗している場合、フォールバックが動作していればソースを使用
    const isRetrieveAndGenerateFailed = finalResponse.includes("Sorry, I am unable to assist") || 
                                       finalResponse === 'No response generated';
    
    if (isRetrieveAndGenerateFailed && allSources.length > 0) {
      console.log('RetrieveAndGenerate failed, but sources available via fallback. Using alternative response.');
      finalResponse = `検索結果を基に回答します。詳細は参照ソースをご確認ください。

**主な検索結果:**
${allSources.slice(0, 5).map((source, index) => 
  `${index + 1}. ${source.uri?.split('/').pop() || 'ソース'} - ${source.content?.substring(0, 200) || '内容なし'}...`
).join('\n\n')}

※ 詳細な分析については、右側のソース詳細パネルで各ソースの内容をご確認ください。`;
    }

    const formattedResponse = {
      response: finalResponse,
      sources: allSources,
      metadata: {
        sessionInfo,
        model: model,
        guardrailAction: response.guardrailAction,
        citationsIncluded: response.citations?.length || 0,
        fallbackUsed: isRetrieveAndGenerateFailed && allSources.length > 0,
        features: [
          'retrieve_and_generate',
          'hybrid_search',
          'session_management',
          'advanced_prompting',
          'guardrails',
          'fallback_retrieve'
        ]
      }
    };

    logStep('Response preparation completed');
    
    const totalTime = Date.now() - startTime;
    console.log('\n========================================');
    console.log('=== RAG Integrated API Response Summary ===');
    console.log('========================================');
    console.log(`Total response time: ${totalTime}ms (${(totalTime / 1000).toFixed(2)}s)`);
    console.log('\nStep timings:');
    Object.entries(stepTimings).forEach(([step, time]) => {
      console.log(`  - ${step}: ${time}ms`);
    });
    console.log(`\nSources found: ${allSources.length}`);
    console.log(`Response length: ${finalResponse.length} characters`);
    console.log(`Model used: ${model}`);
    console.log(`Fallback used: ${isRetrieveAndGenerateFailed && allSources.length > 0}`);
    console.log('========================================\n');
    
    return NextResponse.json(formattedResponse);

  } catch (error: any) {
    console.error('RAG Integrated API error:', {
      name: error.name,
      message: error.message,
      code: error.$metadata?.httpStatusCode,
      requestId: error.$metadata?.requestId,
      fullError: error
    });

    const isRateLimit = error.name === 'ThrottlingException' || 
                       error.name === 'ServiceQuotaExceededException' ||
                       error.$metadata?.httpStatusCode === 429;

    // セッション関連のエラーチェック
    const isSessionError = error.message?.includes('session') || 
                          error.name === 'ResourceNotFoundException';
    
    return NextResponse.json(
      { 
        error: true, 
        message: error.message || 'Integrated processing failed', 
        code: error.name || 'INTEGRATED_ERROR',
        isRateLimit: isRateLimit,
        isSessionError: isSessionError,
        userMessage: isRateLimit ? 
          'リクエストが多すぎます。しばらく時間をおいてから再度お試しください。' : 
          isSessionError ?
          'セッションエラーが発生しました。新しいセッションで再試行してください。' :
          'エラーが発生しました。もう一度お試しください。',
        details: error.$metadata
      },
      { status: isRateLimit ? 429 : 500 }
    );
  }
}