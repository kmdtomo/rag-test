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

// プロンプトテンプレート
const GENERATION_PROMPT_TEMPLATE = `You are a helpful question answering agent. I will provide you with search results from a knowledge base. Your job is to provide a comprehensive and well-structured answer to the user's question based on the search results.

Guidelines:
- Use only information from the provided search results
- Structure your response clearly with numbered points or bullet points when appropriate
- Be specific and include relevant details from the search results
- If multiple search results contain relevant information, synthesize them into a cohesive answer
- Include references to the search results using [1], [2], etc.
- If the search results don't contain enough information to fully answer the question, state what information is missing

Here are the search results:
{search_results}

User Question: {question}

Please provide a detailed and well-structured answer based on the search results above:`;

export async function POST(request: NextRequest) {
  try {
    const { message, model } = await request.json();

    if (!message) {
      return NextResponse.json(
        { error: true, message: 'No message provided' },
        { status: 400 }
      );
    }

    console.log('Knowledge Base ID:', process.env.BEDROCK_KNOWLEDGE_BASE_ID);
    
    // Step 1: Knowledge Baseから検索結果を取得
    const retrieveCommand = new RetrieveCommand({
      knowledgeBaseId: process.env.BEDROCK_KNOWLEDGE_BASE_ID!,
      retrievalQuery: {
        text: message
      },
      retrievalConfiguration: {
        vectorSearchConfiguration: {
          numberOfResults: 5
        }
      }
    });

    console.log('Retrieving from Knowledge Base...');
    const retrieveResponse = await agentClient.send(retrieveCommand);
    
    // ソースチャンクの詳細をコンソールに出力
    console.log('=== ソースチャンク詳細 ===');
    retrieveResponse.retrievalResults?.forEach((result, index) => {
      console.log(`\n--- ソースチャンク ${index + 1} ---`);
      console.log('Content:', result.content?.text);
      console.log('Score:', result.score);
      console.log('Location:', JSON.stringify(result.location, null, 2));
      if (result.location?.s3Location) {
        console.log('S3 URI:', result.location.s3Location.uri);
      }
      console.log('Metadata:', JSON.stringify(result.metadata, null, 2));
    });
    console.log('=== ソースチャンク詳細終了 ===\n');
    
    // Step 2: 検索結果をフォーマット
    const searchResults = retrieveResponse.retrievalResults?.map((result, index) => {
      return `${index + 1}. ${result.content?.text || ''}`;
    }).join('\n\n') || '';

    // Step 3: プロンプトを構築
    const prompt = GENERATION_PROMPT_TEMPLATE
      .replace('{search_results}', searchResults)
      .replace('{question}', message);

    // Step 4: Claude に生成を依頼
    // モデル選択（デフォルトはClaude 3.5 Sonnet）
    const modelMap = {
      'haiku': 'anthropic.claude-3-haiku-20240307-v1:0',
      'sonnet': 'anthropic.claude-3-5-sonnet-20240620-v1:0'
    };
    const modelId = modelMap[model as keyof typeof modelMap] || modelMap['sonnet'];
    //re
    const generateCommand = new InvokeModelCommand({
      modelId: modelId,
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 2048,
        temperature: 0,
        top_p: 1,
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      })
    });

    console.log('Generating response with Claude...');
    const generateResponse = await bedrockClient.send(generateCommand);
    const responseBody = JSON.parse(new TextDecoder().decode(generateResponse.body));
    
    console.log('Generated response:', responseBody);
    
    return NextResponse.json({
      response: responseBody.content?.[0]?.text || 'No response generated',
      sources: retrieveResponse.retrievalResults?.map(result => ({
        content: result.content?.text,
        location: result.location,
        uri: result.location?.s3Location?.uri,
        score: result.score
      })) || [],
    });

  } catch (error: any) {
    console.error('Knowledge Base error details:', {
      name: error.name,
      message: error.message,
      code: error.$metadata?.httpStatusCode,
      requestId: error.$metadata?.requestId
    });

    // レート制限エラーの判定
    const isRateLimit = error.name === 'ThrottlingException' || 
                       error.name === 'ServiceQuotaExceededException' ||
                       error.$metadata?.httpStatusCode === 429;
    
    return NextResponse.json(
      { 
        error: true, 
        message: error.message || 'Chat processing failed', 
        code: error.name || 'CHAT_ERROR',
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