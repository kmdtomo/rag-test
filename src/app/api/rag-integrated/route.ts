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
  const processLog: string[] = [];
  
  const logStep = (step: string) => {
    const currentTime = Date.now();
    const elapsed = currentTime - startTime;
    stepTimings[step] = elapsed;
    const logEntry = `[${elapsed}ms] ${step}`;
    console.log(logEntry);
    processLog.push(logEntry);
  };
  
  const addLog = (message: string) => {
    console.log(message);
    processLog.push(message);
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

    addLog('\n╔════════════════════════════════════════╗');
    addLog('║ 🤝 RAG統合API リクエスト開始 🤝 ║');
    addLog('╚════════════════════════════════════════╝');
    addLog(`💬 ユーザーの質問: ${message}`);
    addLog(`🤖 使用モデル: ${model}`);
    addLog(`🔄 セッション機能: ${useSession ? '有効' : '無効'}`);
    addLog(`📚 ナレッジベースID: ${process.env.BEDROCK_KNOWLEDGE_BASE_ID}`);
    addLog(`🌐 AWSリージョン: ${process.env.AWS_REGION}`);
    addLog(`${'─'.repeat(40)}\n`);
    
    logStep('初期設定完了');

    // セッションクリーンアップ
    logStep('セッションクリーンアップ開始');
    cleanupSessions();
    logStep('セッションクリーンアップ完了');

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

      addLog(`🔐 セッション情報: ${JSON.stringify(sessionInfo)}`);
    }

    // モデルマップ（インファレンスプロファイルARNを直接使用）
    const modelMap = {
      'sonnet35': 'arn:aws:bedrock:ap-northeast-1:794796779989:inference-profile/apac.anthropic.claude-3-5-sonnet-20241022-v2:0',
      'sonnet4': 'arn:aws:bedrock:ap-northeast-1:794796779989:inference-profile/apac.anthropic.claude-sonnet-4-20250514-v1:0'
    };

    const selectedModelArn = modelMap[model as keyof typeof modelMap] || modelMap['sonnet35'];
    
    addLog(`🎯 選択されたモデルARN: ${selectedModelArn}`);
    logStep('モデル選択完了');

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

    logStep('RetrieveAndGenerateコマンドを構築中');
    const command = new RetrieveAndGenerateCommand(commandInput);
    logStep('コマンド構築完了');

    addLog('\n🔍 RetrieveAndGenerateコマンドを実行中...');
    logStep('RetrieveAndGenerate開始');
    const response = await agentClient.send(command);
    logStep('RetrieveAndGenerate完了');
    
    addLog(`📄 RetrieveAndGenerateレスポンス概要:`);
    addLog(`  ・ 出力あり: ${!!response.output?.text ? '✅' : '❌'}`);
    addLog(`  ・ 出力長さ: ${response.output?.text?.length || 0}文字`);
    addLog(`  ・ 引用数: ${response.citations?.length || 0}件`);
    addLog(`  ・ ガードレールアクション: ${!!response.guardrailAction ? 'あり' : 'なし'}`);
    addLog(`  ・ セッションID: ${response.sessionId}`);
    
    // ガードレール情報の詳細出力
    if (response.guardrailAction) {
      addLog(`⚠️ ガードレールアクションが検出されました: ${JSON.stringify(response.guardrailAction)}`);
    }

    addLog(`✅ レスポンス受信 - セッションID: ${response.sessionId}, 引用数: ${response.citations?.length || 0}`);
    
    // デバッグ: 引用情報の構造を確認
    if (response.citations && response.citations.length > 0) {
      addLog(`📄 引用総数: ${response.citations.length}件`);
    }

    // 全ての参照を収集（複数のretrievedReferencesがある場合に対応）
    logStep('情報源の収集を開始');
    const allSources: any[] = [];
    const sourceMap = new Map<string, any>();
    let citationCounter = 1;
    
    // citations が空の場合の詳細なデバッグ
    addLog(`🔍 引用デバッグ情報:`);
    addLog(`  ・ 引用配列の長さ: ${response.citations?.length || 0}`);
    
    if (response.citations && response.citations.length > 0) {
      response.citations.forEach((citation: any, citationIndex: number) => {
        addLog(`📋 引用 ${citationIndex} を処理中:`);
        addLog(`  ・ 参照あり: ${!!citation.retrievedReferences ? '✅' : '❌'}`);
        addLog(`  ・ 参照数: ${citation.retrievedReferences?.length || 0}件`);
        
        // 各citationから全てのretrievedReferencesを取得
        if (citation.retrievedReferences && citation.retrievedReferences.length > 0) {
          citation.retrievedReferences.forEach((ref: any, refIndex: number) => {
            addLog(`  ・ 参照 ${refIndex}: ${ref.location?.s3Location?.uri || 'URIなし'}`);
            
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
          addLog(`  ⚠️ 引用 ${citationIndex} には参照がありません`);
        }
      });
    } else {
      addLog('⚠️ レスポンスに引用が見つかりませんでした');
    }

    addLog(`📄 ユニークな情報源総数: ${allSources.length}件`);
    logStep(`情報源収集完了: ${allSources.length}件`);
    
    // フォールバック: RetrieveAndGenerateで参照が取得できない場合は直接Retrieveを実行
    if (allSources.length === 0) {
      addLog('\n⚠️ 情報源が見つからないため、フォールバックRetrieveを実行...');
      logStep('フォールバックRetrieveを開始');
      
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
        logStep('フォールバックRetrieve完了');
        console.log('直接取得した結果:', retrieveResponse.retrievalResults?.length || 0, '件');
        
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
        
        console.log('フォールバックで追加:', allSources.length, '件の情報源');
      } catch (retrieveError) {
        console.error('フォールバックRetrieveが失敗:', retrieveError);
      }
    }
    
    // デバッグ: ソースの引用番号を確認
    allSources.forEach(source => {
      console.log(`[${source.citationNumber}] - ${source.uri?.split('/').pop() || '不明'} (ページ ${source.pageNumber || 'なし'})`);
    });

    // レスポンスの構築
    logStep('最終レスポンスを構築中');
    let finalResponse = response.output?.text || 'No response generated';
    
    // もしRetrieveAndGenerateが失敗している場合、フォールバックが動作していればソースを使用
    const isRetrieveAndGenerateFailed = finalResponse.includes("Sorry, I am unable to assist") || 
                                       finalResponse === 'No response generated';
    
    if (isRetrieveAndGenerateFailed && allSources.length > 0) {
      addLog('⚠️ RetrieveAndGenerateが失敗しましたが、フォールバックで情報源を取得。代替レスポンスを使用します');
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
        ],
        processLog: processLog
      }
    };

    logStep('レスポンス準備完了');
    
    const totalTime = Date.now() - startTime;
    addLog('\n╔════════════════════════════════════════╗');
    addLog('║ 🏁 処理完了サマリー 🏁 ║');
    addLog('╚════════════════════════════════════════╝');
    addLog(`⏱️  合計処理時間: ${totalTime}ミリ秒 (${(totalTime / 1000).toFixed(2)}秒)`);
    addLog('\n📄 各ステップの処理時間:');
    Object.entries(stepTimings).forEach(([step, time]) => {
      const stepName = step
        .replace('Request received', 'リクエスト受信')
        .replace('Initial setup completed', '初期設定完了')
        .replace('Session cleanup started', 'セッションクリーンアップ開始')
        .replace('Session cleanup completed', 'セッションクリーンアップ完了')
        .replace('Model selection completed', 'モデル選択完了')
        .replace('Building RetrieveAndGenerate command', 'RetrieveAndGenerateコマンドを構築中')
        .replace('Command built successfully', 'コマンド構築完了')
        .replace('Starting RetrieveAndGenerate', 'RetrieveAndGenerate開始')
        .replace('RetrieveAndGenerate completed', 'RetrieveAndGenerate完了')
        .replace('Starting source collection', '情報源の収集を開始')
        .replace('Source collection completed', '情報源収集完了')
        .replace('Starting fallback Retrieve', 'フォールバックRetrieveを開始')
        .replace('Fallback Retrieve completed', 'フォールバックRetrieve完了')
        .replace('Building final response', '最終レスポンスを構築中')
        .replace('Response preparation completed', 'レスポンス準備完了');
      addLog(`  ・ ${stepName}: ${time}ミリ秒`);
    });
    addLog(`\n📄 情報源数: ${allSources.length}件`);
    addLog(`📝 回答の長さ: ${finalResponse.length}文字`);
    addLog(`🤖 使用モデル: ${model}`);
    addLog(`🔄 フォールバック使用: ${isRetrieveAndGenerateFailed && allSources.length > 0 ? 'あり' : 'なし'}`);
    addLog(`${'─'.repeat(40)}\n`);
    
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