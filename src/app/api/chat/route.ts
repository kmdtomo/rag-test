import { NextRequest, NextResponse } from 'next/server';
import { BedrockAgentRuntimeClient, RetrieveAndGenerateCommand } from '@aws-sdk/client-bedrock-agent-runtime';

// Knowledge Base用のクライアントを作成
const agentClient = new BedrockAgentRuntimeClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export async function POST(request: NextRequest) {
  try {
    const { message } = await request.json();

    if (!message) {
      return NextResponse.json(
        { error: true, message: 'No message provided' },
        { status: 400 }
      );
    }

    console.log('Knowledge Base ID:', process.env.BEDROCK_KNOWLEDGE_BASE_ID);
    console.log('Model ID:', process.env.BEDROCK_MODEL_ID);

    // Knowledge Base APIを使用（sessionIdは指定しない）
    const command = new RetrieveAndGenerateCommand({
      input: {
        text: message
      },
      retrieveAndGenerateConfiguration: {
        type: "KNOWLEDGE_BASE",
        knowledgeBaseConfiguration: {
          knowledgeBaseId: process.env.BEDROCK_KNOWLEDGE_BASE_ID!,
          modelArn: `arn:aws:bedrock:${process.env.AWS_REGION}::foundation-model/anthropic.claude-instant-v1`,
          retrievalConfiguration: {
            vectorSearchConfiguration: {
              numberOfResults: 10, // 検索結果数を増やす
              overrideSearchType: "HYBRID" // セマンティック検索とキーワード検索の併用
            }
          }
        }
      }
      // sessionIdを指定しない（Bedrockが自動生成）
    });

    console.log('Sending command to Bedrock...');
    const response = await agentClient.send(command);
    console.log('Bedrock response:', JSON.stringify(response, null, 2));
    
    return NextResponse.json({
      response: response.output?.text || 'No response generated',
      sessionId: response.sessionId,
      sources: response.citations?.map(citation => ({
        content: citation.generatedResponsePart?.textResponsePart?.text,
        references: citation.retrievedReferences?.map(ref => ({
          content: ref.content?.text,
          location: ref.location,
          uri: ref.location?.s3Location?.uri
        }))
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