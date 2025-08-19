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
async function decomposeQueryIntelligently(question: string): Promise<EnhancedQuery[]> {
  try {
    console.log('\n🔍 Decomposing query intelligently...');
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
    
    console.log('Generated enhanced queries:');
    queries.forEach((q: EnhancedQuery, i: number) => {
      console.log(`  ${i + 1}. [Weight: ${q.weight}] ${q.query}`);
    });
    
    return queries;
  } catch (error) {
    console.error('❌ Query decomposition failed:', error);
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
  config: RetrievalConfig = {}
): Promise<any[]> {
  const {
    numberOfResults = 10,
    searchType = 'HYBRID',
    overrideSearchType
  } = config;

  // コンテキストを保持したクエリ
  const contextualQuery = `${query} (コンテキスト: ${originalQuestion})`;
  
  console.log(`  🔍 Searching with: "${query}"`);
  console.log(`     Config: ${numberOfResults} results, ${searchType} search`);

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
  console.log(`     ✓ Retrieved ${results.length} results`);
  
  return results;
}

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
    const { message, model, enableOptimizations = true } = await request.json();

    if (!message) {
      return NextResponse.json(
        { error: true, message: 'No message provided' },
        { status: 400 }
      );
    }

    console.log('\n========================================');
    console.log('=== RAG Optimized API Request ===');
    console.log('========================================');
    console.log('Query:', message);
    console.log('Model:', model);
    console.log('Optimizations enabled:', enableOptimizations);
    console.log('Knowledge Base ID:', process.env.BEDROCK_KNOWLEDGE_BASE_ID);
    console.log('AWS Region:', process.env.AWS_REGION);
    console.log('========================================\n');
    
    logStep('Initial setup completed');

    let allResults: any[] = [];
    let searchQueries: string[] = [];

    if (enableOptimizations) {
      // Step 1: インテリジェントなクエリ分解
      console.log('\n🔎 Step 1: Intelligent Query Decomposition');
      console.log('─'.repeat(50));
      logStep('Starting intelligent query decomposition');
      const enhancedQueries = await decomposeQueryIntelligently(message);
      logStep('Query decomposition completed');
      searchQueries = enhancedQueries.map(eq => eq.query);

      // Step 2: 並列検索（コンテキスト保持）
      console.log('\n🔄 Step 2: Parallel Retrieval with Context');
      console.log('─'.repeat(50));
      logStep('Starting parallel retrieval');
      
      const searchPromises = enhancedQueries.map((eq, index) => 
        performOptimizedRetrieval(
          eq.query,
          message,  // 元の質問を渡す
          {
            numberOfResults: Math.max(5, 10 - index * 2), // 徴々に減らす
            searchType: index === 0 ? 'SEMANTIC' : 'HYBRID'
          }
        )
      );
      
      console.log('\n🚀 Executing parallel searches...');
      const searchResults = await Promise.all(searchPromises);
      
      // 結果の統合（重み付け）
      searchResults.forEach((results, queryIndex) => {
        const weight = enhancedQueries[queryIndex].weight || 1.0;
        console.log(`\n  Query ${queryIndex + 1} results: ${results.length} items (weight: ${weight})`);
        results.forEach((result: any) => {
          allResults.push({
            ...result,
            adjustedScore: (result.score || 0) * weight,
            originalScore: result.score,
            queryIndex: queryIndex + 1
          });
        });
      });
      
      logStep('All retrievals completed');
      console.log(`\n  ✓ Total results collected: ${allResults.length}`);

      // Step 3: スマートな重複除去
      console.log('\n🧪 Step 3: Smart Deduplication');
      console.log('─'.repeat(50));
      logStep('Starting smart deduplication');
      const beforeDedup = allResults.length;
      
      allResults = smartDeduplication(allResults);
      
      console.log(`\n  📊 Deduplication results:`);
      console.log(`     Before: ${beforeDedup} results`);
      console.log(`     After: ${allResults.length} results`);
      console.log(`     Removed: ${beforeDedup - allResults.length} duplicates (${((beforeDedup - allResults.length) / beforeDedup * 100).toFixed(1)}%)`);
      logStep('Deduplication completed');

      // Step 4: AWSスコアでソート（再ランキングなし！）
      console.log('\n🏆 Step 4: Sorting by AWS Scores (No Re-ranking!)');
      console.log('─'.repeat(50));
      logStep('Starting AWS score-based sorting');
      
      // 調整されたスコアでソート
      allResults.sort((a, b) => (b.adjustedScore || 0) - (a.adjustedScore || 0));
      
      // 上位15件を選択
      const beforeTrim = allResults.length;
      allResults = allResults.slice(0, 15);
      console.log(`\n  ✂️ Trimmed to top ${allResults.length} results (from ${beforeTrim})`);
      
      // スコア分布を表示
      console.log('\n  📊 Score distribution:');
      const scoreRanges = {
        high: allResults.filter(r => r.adjustedScore > 0.8).length,
        medium: allResults.filter(r => r.adjustedScore > 0.5 && r.adjustedScore <= 0.8).length,
        low: allResults.filter(r => r.adjustedScore <= 0.5).length
      };
      console.log(`     High (>0.8): ${scoreRanges.high} results`);
      console.log(`     Medium (0.5-0.8): ${scoreRanges.medium} results`);
      console.log(`     Low (<=0.5): ${scoreRanges.low} results`);
      
      logStep('Sorting completed');
    } else {
      // 最適化なしの通常検索
      console.log('\n--- Standard Retrieval (No Optimization) ---');
      logStep('Starting standard retrieval');
      searchQueries = [message];
      allResults = await performOptimizedRetrieval(message, message, {
        numberOfResults: 10,
        searchType: 'SEMANTIC'
      });
      logStep(`Standard retrieval completed: ${allResults.length} results`);
    }

    // ソースチャンクの詳細をログ出力
    console.log('\n📄 Final Search Results');
    console.log('─'.repeat(50));
    allResults.forEach((result, index) => {
      console.log(`\n🔖 Result ${index + 1}:`);
      console.log(`   Original Score: ${result.originalScore?.toFixed(4) || result.score?.toFixed(4) || 'N/A'}`);
      if (result.adjustedScore !== undefined) {
        console.log(`   Adjusted Score: ${result.adjustedScore.toFixed(4)} (Query #${result.queryIndex || 'N/A'})`);
      }
      console.log(`   URI: ${result.location?.s3Location?.uri || 'N/A'}`);
      console.log(`   Content: ${result.content?.text?.substring(0, 100).replace(/\n/g, ' ')}...`);
    });
    logStep('Search results analysis completed');

    // Step 5: 検索結果をフォーマット
    console.log('\n📝 Step 5: Formatting Results for Generation');
    console.log('─'.repeat(50));
    const searchResults = allResults.map((result, index) => {
      const score = result.adjustedScore || result.score || 0;
      return `[${index + 1}] (Score: ${score.toFixed(3)}) ${result.content?.text || ''}`;
    }).join('\n\n');
    console.log(`  ✓ Formatted ${allResults.length} results for generation`);

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

    console.log('\n🤖 Step 7: Response Generation');
    console.log('─'.repeat(50));
    logStep('Starting response generation');
    console.log(`  🎯 Using model: ${modelId}`);
    const generateResponse = await bedrockClient.send(generateCommand);
    logStep('Response generation completed');
    const responseBody = JSON.parse(new TextDecoder().decode(generateResponse.body));
    console.log(`  ✓ Generated response: ${responseBody.content?.[0]?.text?.length || 0} characters`);
    
    logStep('Response preparation completed');
    
    const totalTime = Date.now() - startTime;
    console.log('\n========================================');
    console.log('=== RAG Optimized API Response Summary ===');
    console.log('========================================');
    console.log(`Total response time: ${totalTime}ms (${(totalTime / 1000).toFixed(2)}s)`);
    console.log('\nStep timings:');
    Object.entries(stepTimings).forEach(([step, time]) => {
      console.log(`  - ${step}: ${time}ms`);
    });
    console.log(`\nOptimizations applied: ${enableOptimizations ? 'Yes' : 'No'}`);
    if (enableOptimizations) {
      console.log(`Sub-queries generated: ${searchQueries.length}`);
      searchQueries.forEach((sq, idx) => {
        console.log(`  ${idx + 1}. ${sq}`);
      });
    }
    console.log(`Final sources: ${allResults.length}`);
    console.log(`Response length: ${responseBody.content?.[0]?.text?.length || 0} characters`);
    console.log(`Model used: ${model}`);
    console.log('========================================\n');
    
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
        ] : ['semantic_search']
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