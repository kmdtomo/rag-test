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

// 拡張プロンプトテンプレート（クエリ分解の指示を含む）
const OPTIMIZED_GENERATION_PROMPT = `You are an advanced RAG-based question answering assistant. I will provide you with search results from a knowledge base, and you will generate a comprehensive answer.

Key Instructions:
1. QUERY DECOMPOSITION: If the question is complex, mentally break it down into sub-questions
2. SYNTHESIS: Combine information from multiple sources coherently
3. RANKING AWARENESS: Pay more attention to results with higher relevance scores
4. CITATION: Always cite sources using [1], [2], etc.
5. COMPREHENSIVENESS: Provide thorough answers while maintaining clarity
6. LANGUAGE: Respond in Japanese

IMPORTANT - Format your response using Markdown:
- Use ## for main sections, ### for subsections
- Use **bold** for key terms and important findings
- Use - or * for bullet points, 1. 2. 3. for numbered lists
- Use > for quotes or important notes
- Use \`code\` for technical terms and \`\`\`language for code blocks
- Use tables when comparing data or presenting structured information

Search Results (ordered by relevance):
{search_results}

User Question: {question}

Provide a well-structured, comprehensive answer in Japanese using Markdown formatting:`;

// クエリ分解用のプロンプト
const QUERY_DECOMPOSITION_PROMPT = `Given the following user question, decompose it into simpler sub-questions that can be searched independently. 
Return the sub-questions as a JSON array of strings. If the question is already simple, return it as a single-element array.

User Question: {question}

Return ONLY the JSON array, no other text:`;

interface RetrievalConfig {
  numberOfResults?: number;
  searchType?: 'HYBRID' | 'SEMANTIC';
  overrideSearchType?: 'SEMANTIC' | 'HYBRID';
}

// クエリ分解関数
async function decomposeQuery(question: string): Promise<string[]> {
  try {
    const prompt = QUERY_DECOMPOSITION_PROMPT.replace('{question}', question);
    
    const command = new InvokeModelCommand({
      modelId: 'anthropic.claude-3-haiku-20240307-v1:0', // 軽量モデルを使用
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
    const subQueries = JSON.parse(responseBody.content[0].text);
    
    return Array.isArray(subQueries) ? subQueries : [question];
  } catch (error) {
    console.error('Query decomposition failed:', error);
    return [question]; // フォールバック
  }
}

// 検索結果のスコアに基づく再ランキング
function rerankResults(results: any[]): any[] {
  // スコアと内容の長さを考慮した再ランキング
  return results.sort((a, b) => {
    const scoreWeight = 0.7;
    const lengthWeight = 0.3;
    
    const scoreA = a.score || 0;
    const scoreB = b.score || 0;
    const lengthA = a.content?.text?.length || 0;
    const lengthB = b.content?.text?.length || 0;
    
    // 正規化
    const maxLength = Math.max(lengthA, lengthB);
    const normalizedLengthA = maxLength > 0 ? lengthA / maxLength : 0;
    const normalizedLengthB = maxLength > 0 ? lengthB / maxLength : 0;
    
    const finalScoreA = scoreWeight * scoreA + lengthWeight * normalizedLengthA;
    const finalScoreB = scoreWeight * scoreB + lengthWeight * normalizedLengthB;
    
    return finalScoreB - finalScoreA;
  });
}

// 最適化された検索実行
async function performOptimizedRetrieval(
  query: string, 
  config: RetrievalConfig = {}
): Promise<any[]> {
  const {
    numberOfResults = 10, // デフォルトを増やす
    searchType = 'HYBRID',
    overrideSearchType
  } = config;

  const retrieveCommand = new RetrieveCommand({
    knowledgeBaseId: process.env.BEDROCK_KNOWLEDGE_BASE_ID!,
    retrievalQuery: {
      text: query
    },
    retrievalConfiguration: {
      vectorSearchConfiguration: {
        numberOfResults,
        overrideSearchType: overrideSearchType || searchType as any
      }
    }
  });

  const response = await agentClient.send(retrieveCommand);
  return response.retrievalResults || [];
}

export async function POST(request: NextRequest) {
  try {
    const { message, model, enableOptimizations = true } = await request.json();

    if (!message) {
      return NextResponse.json(
        { error: true, message: 'No message provided' },
        { status: 400 }
      );
    }

    console.log('=== RAG Optimized API ===');
    console.log('Query:', message);
    console.log('Optimizations enabled:', enableOptimizations);

    let allResults: any[] = [];
    let searchQueries: string[] = [];

    if (enableOptimizations) {
      // Step 1: クエリ分解
      console.log('Decomposing query...');
      const subQueries = await decomposeQuery(message);
      console.log('Sub-queries:', subQueries);
      searchQueries = subQueries;

      // Step 2: 各サブクエリで検索（ハイブリッド検索）
      for (const subQuery of subQueries) {
        console.log(`Searching for: "${subQuery}"`);
        const results = await performOptimizedRetrieval(subQuery, {
          numberOfResults: 5,
          searchType: 'HYBRID'
        });
        allResults.push(...results);
      }

      // Step 3: 重複除去
      const uniqueResults = new Map();
      allResults.forEach(result => {
        const key = result.content?.text || '';
        if (!uniqueResults.has(key) || (uniqueResults.get(key).score < result.score)) {
          uniqueResults.set(key, result);
        }
      });
      allResults = Array.from(uniqueResults.values());

      // Step 4: 再ランキング
      console.log('Reranking results...');
      allResults = rerankResults(allResults);
      
      // 上位N件に絞る
      allResults = allResults.slice(0, 10);
    } else {
      // 最適化なしの通常検索
      searchQueries = [message];
      allResults = await performOptimizedRetrieval(message, {
        numberOfResults: 5,
        searchType: 'SEMANTIC'
      });
    }

    // ソースチャンクの詳細をログ出力
    console.log('=== Final Search Results ===');
    allResults.forEach((result, index) => {
      console.log(`\n--- Result ${index + 1} ---`);
      console.log('Score:', result.score);
      console.log('Content preview:', result.content?.text?.substring(0, 100) + '...');
    });

    // Step 5: 検索結果をフォーマット
    const searchResults = allResults.map((result, index) => {
      return `[${index + 1}] (Score: ${result.score?.toFixed(3) || 'N/A'}) ${result.content?.text || ''}`;
    }).join('\n\n');

    // Step 6: プロンプトを構築
    const finalPrompt = OPTIMIZED_GENERATION_PROMPT
      .replace('{search_results}', searchResults)
      .replace('{question}', message);

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
        max_tokens: 4096, // 増やす
        temperature: 0.1, // わずかに創造性を追加
        top_p: 0.95,
        messages: [{
          role: "user",
          content: finalPrompt
        }]
      })
    });

    console.log('Generating optimized response...');
    const generateResponse = await bedrockClient.send(generateCommand);
    const responseBody = JSON.parse(new TextDecoder().decode(generateResponse.body));
    
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
          'query_decomposition',
          'hybrid_search',
          'deduplication',
          'reranking'
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