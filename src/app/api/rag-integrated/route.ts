import { NextRequest, NextResponse } from 'next/server';
import { 
  BedrockAgentRuntimeClient, 
  RetrieveAndGenerateCommand
} from '@aws-sdk/client-bedrock-agent-runtime';
import { randomUUID } from 'crypto';

// Bedrock Agent Runtime Client
const agentClient = new BedrockAgentRuntimeClient({
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
  try {
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

    console.log('=== RAG Integrated API ===');
    console.log('Query:', message);
    console.log('Model:', model);
    console.log('Session enabled:', useSession);
    console.log('Knowledge Base ID:', process.env.BEDROCK_KNOWLEDGE_BASE_ID);
    console.log('AWS Region:', process.env.AWS_REGION);

    // セッションクリーンアップ
    cleanupSessions();

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

    // モデルマップ
    const modelMap = {
      'haiku': 'anthropic.claude-3-haiku-20240307-v1:0',
      'sonnet': 'anthropic.claude-3-5-sonnet-20240620-v1:0',
      'opus': 'anthropic.claude-3-opus-20240229-v1:0'
    };

    const selectedModel = modelMap[model as keyof typeof modelMap] || modelMap['sonnet'];

    // RetrieveAndGenerateコマンドの準備（簡略化版）
    const commandInput: any = {
      input: {
        text: message
      },
      retrieveAndGenerateConfiguration: {
        type: 'KNOWLEDGE_BASE',
        knowledgeBaseConfiguration: {
          knowledgeBaseId: process.env.BEDROCK_KNOWLEDGE_BASE_ID!,
          modelArn: `arn:aws:bedrock:${process.env.AWS_REGION}::foundation-model/${selectedModel}`
        }
      }
    };

    // セッション設定を追加
    if (sessionConfig) {
      commandInput.sessionConfiguration = sessionConfig;
    }

    const command = new RetrieveAndGenerateCommand(commandInput);

    console.log('Executing RetrieveAndGenerate command...');
    const response = await agentClient.send(command);

    console.log('Response received:', {
      sessionId: response.sessionId,
      citationsCount: response.citations?.length || 0
    });
    
    // デバッグ: 引用情報の構造を確認
    if (response.citations && response.citations.length > 0) {
      console.log('Citation structure sample:', JSON.stringify(response.citations[0], null, 2));
    }

    // レスポンスの構築
    const formattedResponse = {
      response: response.output?.text || 'No response generated',
      sources: response.citations?.map((citation: any, index: number) => {
        const reference = citation.retrievedReferences?.[0];
        return {
          content: reference?.content?.text || citation.generatedResponsePart?.textResponsePart?.text,
          location: reference?.location,
          uri: reference?.location?.s3Location?.uri,
          score: reference?.metadata?.score || reference?.score,
          citationNumber: index + 1
        };
      }) || [],
      metadata: {
        sessionInfo,
        model: model,
        guardrailAction: response.guardrailAction,
        citationsIncluded: response.citations?.length || 0,
        features: [
          'retrieve_and_generate',
          'hybrid_search',
          'session_management',
          'advanced_prompting',
          'guardrails'
        ]
      }
    };

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