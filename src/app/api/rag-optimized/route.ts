import { NextRequest, NextResponse } from 'next/server';
import { BedrockAgentRuntimeClient, RetrieveCommand } from '@aws-sdk/client-bedrock-agent-runtime';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

// Knowledge Base用のクライアントを作成
const agentClient = new BedrockAgentRuntimeClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

// Bedrock Runtime用のクライアントを作成
const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

// 検索戦略を考慮した改善されたプロンプトを生成
function createOptimizedPrompt(
  originalQuery: string,
  results: any[],
  searchQueries: string[]
): string {
  const searchResults = results.map((result, index) => {
    const score = result.adjustedScore || result.score || 0;
    return `[${index + 1}] スコア: ${score.toFixed(3)}\n${result.content?.text || ''}\n---`;
  }).join('\n\n');

  return `
あなたは高度なRAGシステムのアシスタントです。

検索戦略:
${searchQueries.map((q, i) => `${i + 1}. ${q}`).join('\n')}

検索結果（関連度順）:
${searchResults}

ユーザーの質問: ${originalQuery}

指示:
1. 上記の検索結果のみを使用して回答
2. 各情報には [${'番号'}] で引用を付ける
3. 異なる観点からの情報を統合
4. Markdown形式で構造化
5. 日本語で回答

回答:`;
}

// インテリジェントなクエリ分解用のプロンプト
const INTELLIGENT_QUERY_DECOMPOSITION_PROMPT = `質問を分析し、Knowledge Base検索に最適な3つの検索クエリを生成してください。

重要なルール：
1. 単語ではなく、完全な文や意味のあるフレーズで
2. 各クエリは異なる観点から（概念/実装/応用など）
3. 元の質問の意図とコンテキストを保持
4. 専門用語はそのまま保持

質問: {question}

出力形式（JSON）:
[
  {"query": "概念的な観点からの検索文", "weight": 1.0},
  {"query": "実装観点からの検索文", "weight": 0.8},
  {"query": "応用・ベストプラクティス観点", "weight": 0.6}
]`;

interface RetrievalConfig {
  numberOfResults?: number;
  searchType?: 'HYBRID' | 'SEMANTIC';
  overrideSearchType?: 'SEMANTIC' | 'HYBRID';
}

interface EnhancedQuery {
  query: string;
  weight: number;
}

// インテリジェントなクエリ分解関数
async function decomposeQueryIntelligently(question: string, addLog: (msg: string) => void): Promise<EnhancedQuery[]> {
  try {
    addLog('\n🤔 質問を分析して、最適な検索クエリを生成中...');
    const prompt = INTELLIGENT_QUERY_DECOMPOSITION_PROMPT.replace('{question}', question);
    
    const command = new InvokeModelCommand({
      modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 512,
        temperature: 0,
        messages: [{
          role: "user",
          content: prompt
        }]
      })
    });

    const response = await bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const queries = JSON.parse(responseBody.content[0].text);
    
    addLog('🎯 生成された検索クエリ:');
    queries.forEach((q: EnhancedQuery, i: number) => {
      addLog(`  ${i + 1}. ${q.query} [重要度: ${q.weight}]`);
    });
    
    return queries;
  } catch (error) {
    console.error('❌ Query decomposition failed:', error);
    addLog('⚠️ クエリ分解に失敗しました。元の質問をそのまま使用します');
    // フォールバック：元の質問をそのまま使用
    return [{ query: question, weight: 1.0 }];
  }
}

// AWSのネイティブスコアでソート（再ランキングなし）
function sortByAWSScore(results: any[]): any[] {
  return results.sort((a, b) => (b.score || 0) - (a.score || 0));
}

// スマートな重複除去
function smartDeduplication(results: any[]): any[] {
  const uniqueResults: any[] = [];
  const seenContent = new Map<string, any>();
  
  for (const result of results) {
    // コンテンツのハッシュを生成（最初の200文字）
    const contentText = result.content?.text || '';
    const contentHash = Buffer.from(contentText.substring(0, 200)).toString('base64');
    
    // 既に見たコンテンツかチェック
    if (seenContent.has(contentHash)) {
      const existing = seenContent.get(contentHash);
      // より高いスコアの方を保持
      if (result.score > existing.score) {
        const index = uniqueResults.indexOf(existing);
        uniqueResults[index] = result;
        seenContent.set(contentHash, result);
      }
      continue;
    }
    
    // 新しいコンテンツとして追加
    uniqueResults.push(result);
    seenContent.set(contentHash, result);
  }
  
  return uniqueResults;
}

// コンテキストを保持した最適化検索
async function performOptimizedRetrieval(
  query: string,
  originalQuestion: string,  // 元の質問を保持
  config: RetrievalConfig = {},
  addLog: (msg: string) => void
): Promise<any[]> {
  const {
    numberOfResults = 10,
    searchType = 'HYBRID',
    overrideSearchType
  } = config;

  // コンテキストを保持したクエリ
  const contextualQuery = `${query} (コンテキスト: ${originalQuestion})`;
  
  addLog(`  🔍 検索中: "${query}"`);
  addLog(`     設定: 最大${numberOfResults}件取得、${searchType === 'HYBRID' ? 'ハイブリッド' : 'セマンティック'}検索`);

  const retrieveCommand = new RetrieveCommand({
    knowledgeBaseId: process.env.BEDROCK_KNOWLEDGE_BASE_ID!,
    retrievalQuery: {
      text: contextualQuery
    },
    retrievalConfiguration: {
      vectorSearchConfiguration: {
        numberOfResults,
        overrideSearchType: overrideSearchType || searchType as any
      }
    }
  });

  const response = await agentClient.send(retrieveCommand);
  const results = response.retrievalResults || [];
  addLog(`     ✅ ${results.length}件の結果を取得`);
  
  return results;
}

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
    logStep('リクエスト受信');
    const { message, model, enableOptimizations = true } = await request.json();

    if (!message) {
      return NextResponse.json(
        { error: true, message: 'No message provided' },
        { status: 400 }
      );
    }

    addLog('\n╔════════════════════════════════════════╗');
    addLog('║ 🔍 RAG最適化API リクエスト開始 🔍 ║');
    addLog('╚════════════════════════════════════════╝');
    addLog(`💬 ユーザーの質問: ${message}`);
    addLog(`🤖 使用モデル: ${model === 'sonnet35' ? 'Claude 3.5 Sonnet' : 'Claude 4 Sonnet'}`);
    addLog(`⚙️  最適化機能: ${enableOptimizations ? '✅ 有効' : '❌ 無効'}`);
    addLog(`📚 ナレッジベースID: ${process.env.BEDROCK_KNOWLEDGE_BASE_ID}`);
    addLog(`🌐 AWSリージョン: ${process.env.AWS_REGION}`);
    addLog(`${'─'.repeat(40)}\n`);
    
    logStep('初期設定完了');

    let allResults: any[] = [];
    let searchQueries: string[] = [];

    if (enableOptimizations) {
      // Step 1: インテリジェントなクエリ分解
      addLog('\n💡 ステップ1: 質問の分析と分解');
      addLog(`${'─'.repeat(40)}`);
      logStep('クエリ分解開始');
      const enhancedQueries = await decomposeQueryIntelligently(message, addLog);
      logStep('クエリ分解完了');
      searchQueries = enhancedQueries.map(eq => eq.query);

      // Step 2: 並列検索（コンテキスト保持）
      addLog('\n🚀 ステップ2: 並列検索の実行');
      addLog(`${'─'.repeat(40)}`);
      logStep('並列検索開始');
      
      const searchPromises = enhancedQueries.map((eq, index) => 
        performOptimizedRetrieval(
          eq.query,
          message,  // 元の質問を渡す
          {
            numberOfResults: Math.max(5, 10 - index * 2), // 徴々に減らす
            searchType: index === 0 ? 'SEMANTIC' : 'HYBRID'
          },
          addLog
        )
      );
      
      addLog('\n⏳ 複数の検索を同時に実行中...');
      const searchResults = await Promise.all(searchPromises);
      
      // 結果の統合（重み付け）
      searchResults.forEach((results, queryIndex) => {
        const weight = enhancedQueries[queryIndex].weight || 1.0;
        addLog(`\n  クエリ${queryIndex + 1}の結果: ${results.length}件 [重要度: ${weight}]`);
        results.forEach((result: any) => {
          allResults.push({
            ...result,
            adjustedScore: (result.score || 0) * weight,
            originalScore: result.score,
            queryIndex: queryIndex + 1
          });
        });
      });
      
      logStep('全検索完了');
      addLog(`\n  ✅ 検索結果の収集完了: 合計${allResults.length}件`);

      // Step 3: スマートな重複除去
      addLog('\n🧪 ステップ3: 重複コンテンツの整理');
      addLog(`${'─'.repeat(40)}`);
      logStep('重複除去開始');
      const beforeDedup = allResults.length;
      
      allResults = smartDeduplication(allResults);
      
      addLog(`\n  📊 重複除去の結果:`);
      addLog(`     整理前: ${beforeDedup}件`);
      addLog(`     整理後: ${allResults.length}件`);
      addLog(`     削除した重複: ${beforeDedup - allResults.length}件（${((beforeDedup - allResults.length) / beforeDedup * 100).toFixed(1)}%）`);
      logStep('重複除去完了');

      // Step 4: AWSスコアでソート（再ランキングなし！）
      addLog('\n🏆 ステップ4: 関連度スコアによる並び替え');
      addLog(`${'─'.repeat(40)}`);
      logStep('スコアソート開始');
      
      // 調整されたスコアでソート
      allResults.sort((a, b) => (b.adjustedScore || 0) - (a.adjustedScore || 0));
      
      // 上位15件を選択
      const beforeTrim = allResults.length;
      allResults = allResults.slice(0, 15);
      addLog(`\n  ✂️ 上位${allResults.length}件に絞り込み（元々${beforeTrim}件）`);
      
      // スコア分布を表示
      addLog('\n  📊 スコア分布:');
      const scoreRanges = {
        high: allResults.filter(r => r.adjustedScore > 0.8).length,
        medium: allResults.filter(r => r.adjustedScore > 0.5 && r.adjustedScore <= 0.8).length,
        low: allResults.filter(r => r.adjustedScore <= 0.5).length
      };
      addLog(`     高関連度 (0.8以上): ${scoreRanges.high}件`);
      addLog(`     中関連度 (0.5-0.8): ${scoreRanges.medium}件`);
      addLog(`     低関連度 (0.5以下): ${scoreRanges.low}件`);
      
      logStep('ソート完了');
    } else {
      // 最適化なしの通常検索
      addLog('\n🔍 標準検索モード（最適化なし）');
      logStep('標準検索開始');
      searchQueries = [message];
      allResults = await performOptimizedRetrieval(message, message, {
        numberOfResults: 10,
        searchType: 'SEMANTIC'
      }, addLog);
      logStep(`標準検索完了: ${allResults.length}件の結果`);
    }

    // ソースチャンクの詳細をログ出力
    addLog('\n📄 最終的な検索結果');
    addLog(`${'─'.repeat(40)}`);
    allResults.forEach((result, index) => {
      addLog(`\n🔖 結果 ${index + 1}:`);
      addLog(`   元のスコア: ${result.originalScore?.toFixed(4) || result.score?.toFixed(4) || 'なし'}`);
      if (result.adjustedScore !== undefined) {
        addLog(`   調整後スコア: ${result.adjustedScore.toFixed(4)} (クエリ#${result.queryIndex || 'なし'})`);
      }
      addLog(`   ファイル: ${result.location?.s3Location?.uri?.split('/').pop() || '不明'}`);
      addLog(`   内容: ${result.content?.text?.substring(0, 100).replace(/\n/g, ' ')}...`);
    });
    logStep('検索結果分析完了');

    // Step 5: 検索結果をフォーマット
    addLog('\n📝 ステップ5: AI回答用に結果を整形');
      addLog(`${'─'.repeat(40)}`);
    const searchResults = allResults.map((result, index) => {
      const score = result.adjustedScore || result.score || 0;
      return `[${index + 1}] (Score: ${score.toFixed(3)}) ${result.content?.text || ''}`;
    }).join('\n\n');
    addLog(`  ✅ ${allResults.length}件の結果をAI回答用に整形完了`);

    // Step 6: 改善されたプロンプトを構築
    const finalPrompt = createOptimizedPrompt(message, allResults, searchQueries);

    // Step 7: Claude に生成を依頼
    const modelMap = {
      'sonnet35': process.env.BEDROCK_MODEL_ID_SONNET_35 || 'apac.anthropic.claude-3-5-sonnet-20241022-v2:0',
      'sonnet4': process.env.BEDROCK_MODEL_ID_SONNET_4 || 'apac.anthropic.claude-sonnet-4-20250514-v1:0'
    };
    const modelId = modelMap[model as keyof typeof modelMap] || modelMap['sonnet35'];
    
    const generateCommand = new InvokeModelCommand({
      modelId: modelId,
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 4096,
        temperature: 0.1,
        top_p: 0.95,
        messages: [{
          role: "user",
          content: finalPrompt
        }]
      })
    });

    addLog('\n🤖 ステップ7: AIによる回答生成');
    addLog(`${'─'.repeat(40)}`);
    logStep('回答生成を開始');
    addLog(`  🎯 使用モデル: ${modelId.includes('sonnet-4') ? 'Claude 4 Sonnet' : 'Claude 3.5 Sonnet'}`);
    const generateResponse = await bedrockClient.send(generateCommand);
    logStep('回答生成完了');
    const responseBody = JSON.parse(new TextDecoder().decode(generateResponse.body));
    addLog(`  ✅ 生成された回答: ${responseBody.content?.[0]?.text?.length || 0}文字`);
    
    logStep('レスポンス準備完了');
    
    const totalTime = Date.now() - startTime;
    addLog('\n╔════════════════════════════════════════╗');
    addLog('║ 🏁 処理完了サマリー 🏁 ║');
    addLog('╚════════════════════════════════════════╝');
    addLog(`⏱️  合計処理時間: ${totalTime}ミリ秒 (${(totalTime / 1000).toFixed(2)}秒)`);
    addLog('\n📋 各ステップの処理時間:');
    Object.entries(stepTimings).forEach(([step, time]) => {
      const stepName = step
        .replace('Request received', 'リクエスト受信')
        .replace('Initial setup completed', '初期設定完了')
        .replace('Starting intelligent query decomposition', 'クエリ分解開始')
        .replace('Query decomposition completed', 'クエリ分解完了')
        .replace('Starting parallel retrieval', '並列検索開始')
        .replace('All retrievals completed', '全検索完了')
        .replace('Starting smart deduplication', '重複除去開始')
        .replace('Deduplication completed', '重複除去完了')
        .replace('Starting AWS score-based sorting', 'スコアソート開始')
        .replace('Sorting completed', 'ソート完了')
        .replace('Search results analysis completed', '検索結果分析完了')
        .replace('Starting response generation', '回答生成開始')
        .replace('Response generation completed', '回答生成完了')
        .replace('Response preparation completed', 'レスポンス準備完了');
      addLog(`  ・ ${stepName}: ${time}ミリ秒`);
    });
    addLog(`\n⚙️  最適化機能: ${enableOptimizations ? '✅ 有効' : '❌ 無効'}`);
    if (enableOptimizations) {
      addLog(`🔍 生成された検索クエリ: ${searchQueries.length}個`);
      searchQueries.forEach((sq, idx) => {
        addLog(`  ${idx + 1}. ${sq}`);
      });
    }
    addLog(`📄 最終的な情報源: ${allResults.length}件`);
    addLog(`📝 回答の長さ: ${responseBody.content?.[0]?.text?.length || 0}文字`);
    addLog(`🤖 使用モデル: ${model === 'sonnet35' ? 'Claude 3.5 Sonnet' : 'Claude 4 Sonnet'}`);
    addLog(`${'─'.repeat(40)}\n`);
    
    return NextResponse.json({
      response: responseBody.content?.[0]?.text || 'No response generated',
      sources: allResults.map(result => ({
        content: result.content?.text,
        location: result.location,
        uri: result.location?.s3Location?.uri,
        score: result.score
      })),
      metadata: {
        searchQueries,
        totalResults: allResults.length,
        optimizationsApplied: enableOptimizations ? [
          'intelligent_query_decomposition',
          'contextual_search',
          'smart_deduplication',
          'aws_native_scoring'  // 再ランキングなし！
        ] : ['semantic_search'],
        processLog: processLog
      }
    });

  } catch (error: any) {
    console.error('RAG Optimized API error:', error);

    const isRateLimit = error.name === 'ThrottlingException' || 
                       error.name === 'ServiceQuotaExceededException' ||
                       error.$metadata?.httpStatusCode === 429;
    
    return NextResponse.json(
      { 
        error: true, 
        message: error.message || 'Optimized chat processing failed', 
        code: error.name || 'OPTIMIZED_CHAT_ERROR',
        isRateLimit: isRateLimit,
        userMessage: isRateLimit ? 
          'リクエストが多すぎます。しばらく時間をおいてから再度お試しください。' : 
          'エラーが発生しました。もう一度お試しください。',
        details: error.$metadata
      },
      { status: isRateLimit ? 429 : 500 }
    );
  }
}