import { NextRequest, NextResponse } from 'next/server';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { s3Client } from '@/lib/aws-config';

// Bedrock Runtime Client
const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

// ファイルサイズ制限（32MB - Bedrock API制限）
const MAX_FILE_SIZE = 32 * 1024 * 1024; // 32MB
const MAX_TEXT_CHARS = 150000; // テキストファイルの文字数制限

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const processLog: string[] = [];
  
  const logStep = (step: string, details?: any) => {
    const elapsed = Date.now() - startTime;
    const logEntry = `[${elapsed}ms] ${step}`;
    console.log(logEntry);
    processLog.push(logEntry);
    
    // 詳細情報も記録
    if (details) {
      console.log('Details:', details);
      processLog.push(`  └─ ${JSON.stringify(details)}`);
    }
  };
  
  try {
    logStep('Request received');
    const { message, fileKey, fileName } = await request.json();

    if (!message || !fileKey) {
      return NextResponse.json(
        { error: 'Message and file key are required' },
        { status: 400 }
      );
    }

    processLog.push('\n╔════════════════════════════════════════╗');
    processLog.push('║ 📄 Direct S3 Chat API リクエスト開始 📄 ║');
    processLog.push('╚════════════════════════════════════════╝');
    processLog.push(`💬 ユーザーの質問: ${message}`);
    processLog.push(`📁 対象ファイル: ${fileName || fileKey}`);
    processLog.push(`🤖 使用モデル: Claude 4 Sonnet`);
    processLog.push(`🌐 S3バケット: ${process.env.AWS_S3_BUCKET}`);
    processLog.push(`${'─'.repeat(40)}\n`);

    // S3からファイルを読み込み
    logStep('🔄 S3ファイル読み込み開始', { fileKey, bucket: process.env.AWS_S3_BUCKET });
    const command = new GetObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET!,
      Key: fileKey,
    });

    const s3Response = await s3Client.send(command);
    
    if (!s3Response.Body) {
      throw new Error('File content not found');
    }

    // S3のBodyをバイト配列に変換
    logStep('📊 バイト配列への変換開始');
    const bodyBytes = await s3Response.Body.transformToByteArray();
    const fileSize = bodyBytes.length;
    
    // ファイルサイズチェック
    if (fileSize > MAX_FILE_SIZE) {
      throw new Error(`ファイルサイズが大きすぎます (${(fileSize / 1024 / 1024).toFixed(2)}MB)。最大32MBまでです。`);
    }
    
    logStep(`✅ S3ファイル読み込み完了`, {
      fileSize: `${(fileSize / 1024).toFixed(2)}KB`,
      fileSizeMB: `${(fileSize / 1024 / 1024).toFixed(2)}MB`,
      contentType: s3Response.ContentType,
      lastModified: s3Response.LastModified
    });
    
    // ファイルタイプの判定
    const isPDF = fileKey.toLowerCase().endsWith('.pdf') || 
                  s3Response.ContentType === 'application/pdf';
    const isImage = /\.(png|jpg|jpeg|gif|webp)$/i.test(fileKey.toLowerCase()) ||
                    /^image\/(png|jpeg|gif|webp)$/.test(s3Response.ContentType || '');
    
    let messageContent: any[];
    let isTruncated = false;
    
    if (isPDF || isImage) {
      // PDFまたは画像ファイルの場合、base64エンコードして送信
      const mediaType = isPDF ? 'application/pdf' : (s3Response.ContentType || 'image/jpeg');
      
      logStep(`🎯 ${isPDF ? 'PDF' : '画像'}ファイルを検出`, {
        fileType: isPDF ? 'PDF' : 'Image',
        mediaType: mediaType,
        originalSize: `${(fileSize / 1024).toFixed(2)}KB`
      });
      
      logStep('🔐 Base64エンコード開始');
      const base64Data = Buffer.from(bodyBytes).toString('base64');
      const base64Size = base64Data.length;
      
      logStep('✅ Base64エンコード完了', {
        encodedSize: `${(base64Size / 1024).toFixed(2)}KB`,
        encodedSizeMB: `${(base64Size / 1024 / 1024).toFixed(2)}MB`,
        sizeIncrease: `${((base64Size / fileSize - 1) * 100).toFixed(1)}%増加`
      });
      
      messageContent = [
        {
          type: 'document',
          source: {
            type: 'base64',
            media_type: mediaType,
            data: base64Data
          }
        },
        {
          type: 'text',
          text: message
        }
      ];
    } else {
      // テキストファイルの場合
      logStep('📝 テキストファイルを検出');
      let fileContent = await s3Response.Body.transformToString();
      const originalLength = fileContent.length;
      
      logStep(`✅ テキストファイル読み込み完了`, {
        characters: originalLength,
        estimatedTokens: Math.round(originalLength / 4),
        encoding: 'UTF-8'
      });
      
      // テキストファイルのサイズチェックと切り詰め
      if (fileContent.length > MAX_TEXT_CHARS) {
        fileContent = fileContent.substring(0, MAX_TEXT_CHARS);
        isTruncated = true;
        logStep(`⚠️ ファイルサイズ制限により切り詰め`, {
          original: `${originalLength}文字`,
          truncated: `${MAX_TEXT_CHARS}文字`,
          removed: `${originalLength - MAX_TEXT_CHARS}文字削除`
        });
      }
      
      messageContent = [
        {
          type: 'text',
          text: `以下のドキュメントの内容に基づいて質問に答えてください。\n\nファイル名: ${fileName || fileKey}\n${isTruncated ? '⚠️ 注意: ファイルサイズが大きいため、ドキュメントの一部のみが読み込まれています。\n' : ''}\n---\n${fileContent}\n---\n\n${message}`
        }
      ];
    }

    // システムプロンプトを構築
    const systemPrompt = `あなたは高度なAIアシスタントです。ユーザーがアップロードしたドキュメントの内容を理解し、それに基づいて質問に答えます。

重要な指示:
1. 提供されたドキュメントの内容に基づいて回答してください
2. ドキュメントに記載されていない情報については、その旨を明確に伝えてください
3. 回答には必ず引用を含めてください。引用は [1] のように表記してください
4. 日本語で回答してください
5. コード例が含まれる場合は、適切にフォーマットしてください
6. PDFや画像の場合、視覚的な要素（図、表、グラフなど）も考慮して回答してください`;

    // Claude APIに送信するメッセージを構築
    const messages = [
      {
        role: 'user',
        content: messageContent
      }
    ];

    // メッセージサイズを計算
    const messageSize = JSON.stringify(messages).length;
    const estimatedTokens = Math.round(messageSize / 4);
    
    // Claude 4 Sonnetに送信
    logStep('🚀 Claude APIリクエスト開始', {
      model: 'Claude 4 Sonnet',
      messageSize: `${(messageSize / 1024).toFixed(2)}KB`,
      estimatedTokens: estimatedTokens,
      maxTokens: 4096
    });
    
    const invokeCommand = new InvokeModelCommand({
      modelId: process.env.BEDROCK_MODEL_ID_SONNET_4!,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 4096,
        temperature: 0.7,
        system: systemPrompt,
        messages: messages
      }),
    });

    const modelResponse = await bedrockClient.send(invokeCommand);
    const responseBody = JSON.parse(new TextDecoder().decode(modelResponse.body));
    
    logStep('✅ Claude APIレスポンス受信', {
      outputTokens: responseBody.usage?.output_tokens || 'N/A',
      inputTokens: responseBody.usage?.input_tokens || 'N/A',
      totalTokens: responseBody.usage?.total_tokens || 'N/A',
      stopReason: responseBody.stop_reason || 'N/A'
    });

    // ソース情報を構築
    const source = {
      content: isPDF || isImage 
        ? `${isPDF ? 'PDF' : '画像'}ファイル: ${fileName || fileKey}` 
        : (await s3Response.Body.transformToString()).substring(0, 500) + '...',
      uri: `s3://${process.env.AWS_S3_BUCKET}/${fileKey}`,
      type: 'direct_s3',
      title: fileName || fileKey,
      citationNumber: 1,
      metadata: {
        fileSize: fileSize,
        fileType: isPDF ? 'pdf' : (isImage ? 'image' : 'text'),
        isTruncated: isTruncated,
        bucket: process.env.AWS_S3_BUCKET,
        key: fileKey,
      }
    };

    logStep('📋 レスポンス準備完了');

    const totalTime = Date.now() - startTime;
    
    // 処理サマリーを追加
    processLog.push(`\n${'═'.repeat(50)}`);
    processLog.push('📊 処理サマリー');
    processLog.push(`${'─'.repeat(50)}`);
    processLog.push(`⏱️  合計処理時間: ${totalTime}ms (${(totalTime / 1000).toFixed(2)}秒)`);
    processLog.push(`📁 ファイルタイプ: ${isPDF ? 'PDF' : (isImage ? '画像' : 'テキスト')}`);
    processLog.push(`💾 オリジナルサイズ: ${(fileSize / 1024).toFixed(2)}KB`);
    if (isPDF || isImage) {
      processLog.push(`🔐 Base64サイズ: ${(JSON.stringify(messages).length / 1024).toFixed(2)}KB`);
    }
    processLog.push(`🤖 使用トークン数: ${responseBody.usage?.total_tokens || 'N/A'}`);
    processLog.push(`✅ 処理ステータス: 成功`);
    processLog.push(`${'═'.repeat(50)}`);

    return NextResponse.json({
      content: responseBody.content[0].text,
      sources: [source],
      processLog: processLog,
      metadata: {
        modelId: process.env.BEDROCK_MODEL_ID_SONNET_4,
        fileKey: fileKey,
        fileName: fileName,
        processingTime: totalTime,
        isTruncated: isTruncated
      }
    });

  } catch (error) {
    console.error('Error in direct S3 chat:', error);
    processLog.push(`\n❌ エラー発生: ${error instanceof Error ? error.message : 'Unknown error'}`);
    
    return NextResponse.json(
      { 
        error: 'Failed to process chat request',
        details: error instanceof Error ? error.message : 'Unknown error',
        processLog: processLog
      },
      { status: 500 }
    );
  }
}