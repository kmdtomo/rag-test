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

// Sonnet4による高度なRAG検索計画用のプロンプト
const ADVANCED_RAG_PLANNING_PROMPT = `あなたは高度なRAG検索戦略を立案するエキスパートです。ユーザーの質問を深く分析し、Knowledge Baseから最適な情報を取得するための検索計画を作成してください。

【質問の分析】
ユーザーの質問: {question}

【必須：質問の要素分解と分析】
1. **質問の構成要素**
   - 質問に含まれる個別の要求・トピックを全て識別
   - 各要素に必要な情報の種類を特定（概念、実装、事例、トラブルシューティング等）
   - 要素間の関係性と優先度を評価

2. **検索戦略の設計**
   - 必要な検索クエリ数は質問の複雑さに応じて柔軟に決定（1〜10個）
   - 各クエリは特定の情報ニーズに対応
   - クエリ間の重複を最小化し、カバレッジを最大化

3. **検索タイプの選択**
   - SEMANTIC: 概念的な理解、類似性検索に適している
   - HYBRID: キーワードと意味の両方が重要な場合

【重要な指針】
- 単純な質問 → 1-2個の焦点を絞ったクエリ
- 複雑な質問 → 3-5個の多角的なクエリ
- 多面的な質問 → 5個以上の包括的なクエリ

【出力形式（JSON）】
{
  "analysis": {
    "complexity": "simple/moderate/complex",
    "topics": ["識別されたトピック1", "トピック2"],
    "information_needs": ["必要な情報タイプ1", "情報タイプ2"]
  },
  "queries": [
    {
      "query": "検索クエリ（完全な文または意味のあるフレーズ）",
      "weight": 1.0,
      "searchType": "SEMANTIC",
      "purpose": "このクエリで何を探すか",
      "target_topic": "主要トピック"
    }
  ],
  "strategy": "全体的な検索戦略の説明",
  "expected_coverage": "この計画でカバーできる情報の範囲"
}`;

interface RetrievalConfig {
  numberOfResults?: number;
  searchType?: 'HYBRID' | 'SEMANTIC';
  overrideSearchType?: 'SEMANTIC' | 'HYBRID';
  fileFilter?: string; // S3ファイルキーでフィルタリング
}

interface EnhancedQuery {
  query: string;
  weight: number;
  searchType?: 'HYBRID' | 'SEMANTIC';
  purpose?: string;
  target_topic?: string;
}

// Sonnet4による高度なクエリ分析と検索計画
async function planAdvancedRAGSearch(
  question: string, 
  model: string,
  addLog: (msg: string) => void
): Promise<{
  analysis: {
    complexity: 'simple' | 'moderate' | 'complex';
    topics: string[];
    information_needs: string[];
  };
  queries: Array<{
    query: string;
    weight: number;
    searchType: 'SEMANTIC' | 'HYBRID';
    purpose: string;
    target_topic: string;
  }>;
  strategy: string;
  expected_coverage: string;
}> {
  try {
    addLog('\n🧠 Sonnet4による高度な検索計画立案');
    addLog('─'.repeat(40));
    
    const prompt = ADVANCED_RAG_PLANNING_PROMPT.replace('{question}', question);
    
    // モデルの選択（デフォルトはsonnet4）
    const modelMap = {
      'sonnet35': process.env.BEDROCK_MODEL_ID_SONNET_35 || 'apac.anthropic.claude-3-5-sonnet-20241022-v2:0',
      'sonnet4': process.env.BEDROCK_MODEL_ID_SONNET_4 || 'apac.anthropic.claude-sonnet-4-20250514-v1:0'
    };
    const modelId = modelMap[model as keyof typeof modelMap] || modelMap['sonnet4'];
    
    const command = new InvokeModelCommand({
      modelId: modelId,
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 1500,
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
    
    addLog(`\n🤖 Sonnet4の分析結果:`);
    addLog(text.substring(0, 400) + '...');
    
    // JSONをパース
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const plan = JSON.parse(jsonMatch[0]);
      
      addLog(`\n✅ 検索計画の概要:`);
      addLog(`  ・複雑さ: ${plan.analysis.complexity}`);
      addLog(`  ・識別されたトピック: ${plan.analysis.topics.join(', ')}`);
      addLog(`  ・検索クエリ数: ${plan.queries.length}個`);
      
      addLog('\n🎯 生成された検索クエリ:');
      plan.queries.forEach((q: any, i: number) => {
        addLog(`  ${i + 1}. ${q.query}`);
        addLog(`     [重要度: ${q.weight}, タイプ: ${q.searchType}, 目的: ${q.purpose}]`);
      });
      
      return plan;
    }
    
    throw new Error('Failed to parse RAG planning JSON');
    
  } catch (error) {
    console.error('❌ Advanced RAG planning failed:', error);
    addLog('⚠️ 高度な検索計画に失敗 - シンプルモードにフォールバック');
    
    // フォールバック：Haikuによる簡易分解
    return await fallbackToHaikuDecomposition(question, addLog);
  }
}

// Haikuによるフォールバック分解（コスト削減用）
async function fallbackToHaikuDecomposition(
  question: string,
  addLog: (msg: string) => void
): Promise<any> {
  try {
    addLog('\n💡 Haikuによる簡易クエリ分解を実行');
    
    const simplePrompt = `質問を3つの検索クエリに分解してください。
質問: ${question}

JSON形式で出力:
[
  {"query": "検索クエリ1", "weight": 1.0, "searchType": "SEMANTIC", "purpose": "基本情報", "target_topic": "メイン"},
  {"query": "検索クエリ2", "weight": 0.8, "searchType": "HYBRID", "purpose": "詳細情報", "target_topic": "詳細"},
  {"query": "検索クエリ3", "weight": 0.6, "searchType": "SEMANTIC", "purpose": "関連情報", "target_topic": "関連"}
]`;
    
    const command = new InvokeModelCommand({
      modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 512,
        temperature: 0,
        messages: [{
          role: "user",
          content: simplePrompt
        }]
      })
    });

    const response = await bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const queries = JSON.parse(responseBody.content[0].text);
    
    return {
      analysis: {
        complexity: 'simple',
        topics: ['一般'],
        information_needs: ['基本情報']
      },
      queries: queries,
      strategy: 'Haikuによる簡易分解',
      expected_coverage: '基本的な情報カバレッジ'
    };
  } catch (error) {
    // 最終フォールバック
    addLog('⚠️ 全ての分解方法が失敗 - 元の質問を使用');
    return {
      analysis: {
        complexity: 'simple',
        topics: ['一般'],
        information_needs: ['基本情報']
      },
      queries: [{
        query: question,
        weight: 1.0,
        searchType: 'SEMANTIC',
        purpose: '直接検索',
        target_topic: 'メイン'
      }],
      strategy: 'フォールバック',
      expected_coverage: '基本検索'
    };
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
    overrideSearchType,
    fileFilter
  } = config;

  // コンテキストを保持したクエリ
  const contextualQuery = `${query} (コンテキスト: ${originalQuestion})`;
  
  addLog(`  🔍 検索中: "${query}"`);
  addLog(`     設定: 最大${numberOfResults}件取得、${searchType === 'HYBRID' ? 'ハイブリッド' : 'セマンティック'}検索`);
  if (fileFilter) {
    addLog(`     📁 ファイルフィルタ: ${fileFilter}`);
  }

  // 検索設定を構築
  const retrievalConfiguration: any = {
    vectorSearchConfiguration: {
      numberOfResults,
      overrideSearchType: overrideSearchType || searchType as any
    }
  };

  // ファイルフィルタが指定されている場合
  if (fileFilter) {
    const s3Uri = `s3://${process.env.AWS_S3_BUCKET}/${fileFilter}`;
    addLog(`     🔍 ファイルフィルタ適用: ${s3Uri}`);
    retrievalConfiguration.vectorSearchConfiguration.filter = {
      equals: {
        key: "x-amz-bedrock-kb-source-uri",
        value: s3Uri
      }
    };
  }

  const retrieveCommand = new RetrieveCommand({
    knowledgeBaseId: process.env.BEDROCK_KNOWLEDGE_BASE_ID!,
    retrievalQuery: {
      text: contextualQuery
    },
    retrievalConfiguration
  });

  const response = await agentClient.send(retrieveCommand);
  const results = response.retrievalResults || [];
  
  // デバッグ: 最初の結果のメタデータを確認
  if (results.length > 0 && results[0].metadata) {
    addLog(`     📋 メタデータ例: ${JSON.stringify(results[0].metadata).substring(0, 200)}...`);
  }
  
  // ファイルフィルタ使用時に結果が0件の場合、全体検索してメタデータを確認
  if (fileFilter && results.length === 0) {
    addLog(`     ⚠️ ファイルフィルタで結果が0件 - デバッグのため全体検索を実行`);
    const debugCommand = new RetrieveCommand({
      knowledgeBaseId: process.env.BEDROCK_KNOWLEDGE_BASE_ID!,
      retrievalQuery: {
        text: contextualQuery
      },
      retrievalConfiguration: {
        vectorSearchConfiguration: {
          numberOfResults: 3,
          overrideSearchType: overrideSearchType || searchType as any
        }
      }
    });
    
    const debugResponse = await agentClient.send(debugCommand);
    const debugResults = debugResponse.retrievalResults || [];
    
    if (debugResults.length > 0) {
      addLog(`     🔍 デバッグ: 全体検索では${debugResults.length}件の結果`);
      debugResults.forEach((result, idx) => {
        if (result.metadata) {
          addLog(`     📋 結果${idx + 1}のメタデータ: ${JSON.stringify(result.metadata).substring(0, 150)}...`);
        }
      });
    }
  }
  
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
    const { message, model, enableOptimizations = true, selectedFileKey } = await request.json();

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
    if (selectedFileKey) {
      addLog(`📁 選択ファイル: ${selectedFileKey}`);
      addLog(`🔍 検索モード: ファイル限定`);
    } else {
      addLog(`🔍 検索モード: Knowledge Base全体`);
    }
    addLog(`${'─'.repeat(40)}\n`);
    
    logStep('初期設定完了');

    let allResults: any[] = [];
    let searchQueries: string[] = [];

    if (enableOptimizations) {
      // Step 1: 高度な検索計画の立案
      addLog('\n💡 ステップ1: Sonnet4による高度な検索計画');
      addLog(`${'─'.repeat(40)}`);
      logStep('検索計画立案開始');
      const searchPlan = await planAdvancedRAGSearch(message, model, addLog);
      logStep('検索計画立案完了');
      
      const enhancedQueries = searchPlan.queries;
      searchQueries = enhancedQueries.map(eq => eq.query);
      
      // 複雑さに応じて処理を調整
      if (searchPlan.analysis.complexity === 'simple' && enhancedQueries.length <= 2) {
        addLog('\n💚 シンプルな質問と判断 - 高速処理モード');
      }

      // Step 2: 並列検索（コンテキスト保持）
      addLog('\n🚀 ステップ2: 並列検索の実行');
      addLog(`${'─'.repeat(40)}`);
      logStep('並列検索開始');
      
      const searchPromises = enhancedQueries.map((eq, index) => 
        performOptimizedRetrieval(
          eq.query,
          message,  // 元の質問を渡す
          {
            numberOfResults: Math.max(5, Math.floor(15 / enhancedQueries.length) + 3), // クエリ数に応じて調整
            searchType: eq.searchType || 'HYBRID',
            overrideSearchType: eq.searchType,
            fileFilter: selectedFileKey // ファイルフィルタを追加
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
      
      // クエリ数に応じて結果数を調整（多いクエリ = より多様な結果）
      const maxResults = Math.min(20, 10 + enhancedQueries.length * 2);
      const beforeTrim = allResults.length;
      allResults = allResults.slice(0, maxResults);
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
        searchType: 'SEMANTIC',
        fileFilter: selectedFileKey // ファイルフィルタを追加
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