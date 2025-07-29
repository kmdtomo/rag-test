import { NextRequest, NextResponse } from 'next/server';
import { BedrockAgentClient, StartIngestionJobCommand, ListDataSourcesCommand } from '@aws-sdk/client-bedrock-agent';

const agentClient = new BedrockAgentClient({
  region: process.env.AWS_REGION || 'ap-northeast-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export async function POST(request: NextRequest) {
  try {
    const { fileKey } = await request.json();

    console.log('=== SYNC DEBUG START ===');
    console.log('Starting Knowledge Base ingestion job for file:', fileKey);
    console.log('Environment variables:', {
      BEDROCK_KNOWLEDGE_BASE_ID: process.env.BEDROCK_KNOWLEDGE_BASE_ID,
      AWS_REGION: process.env.AWS_REGION,
      AWS_S3_BUCKET: process.env.AWS_S3_BUCKET,
      hasAccessKey: !!process.env.AWS_ACCESS_KEY_ID,
      hasSecretKey: !!process.env.AWS_SECRET_ACCESS_KEY,
    });

    // データソースIDを取得
    const listDataSourcesCommand = new ListDataSourcesCommand({
      knowledgeBaseId: process.env.BEDROCK_KNOWLEDGE_BASE_ID!,
    });

    console.log('Listing data sources for Knowledge Base:', process.env.BEDROCK_KNOWLEDGE_BASE_ID);
    const dataSources = await agentClient.send(listDataSourcesCommand);
    console.log('Available data sources:', JSON.stringify(dataSources.dataSourceSummaries, null, 2));

    if (!dataSources.dataSourceSummaries || dataSources.dataSourceSummaries.length === 0) {
      throw new Error('No data sources found for this Knowledge Base');
    }

    // 最初のデータソースを使用（通常S3データソースが1つ）
    const dataSourceId = dataSources.dataSourceSummaries[0].dataSourceId!;
    console.log('Using data source ID:', dataSourceId);
    console.log('Data source details:', JSON.stringify(dataSources.dataSourceSummaries[0], null, 2));

    // Ingestion Jobを開始
    const command = new StartIngestionJobCommand({
      knowledgeBaseId: process.env.BEDROCK_KNOWLEDGE_BASE_ID!,
      dataSourceId: dataSourceId,
      description: `API triggered sync for file: ${fileKey}`,
      clientToken: `sync-${Date.now()}-${Math.random().toString(36).substring(2)}-${Math.random().toString(36).substring(2)}`, // 一意のトークンを追加（33文字以上）
    });

    console.log('Executing ingestion job with command:', {
      knowledgeBaseId: process.env.BEDROCK_KNOWLEDGE_BASE_ID,
      dataSourceId: dataSourceId,
      description: `API triggered sync for file: ${fileKey}`,
    });
    
    const response = await agentClient.send(command);
    
    console.log('Ingestion job response:', JSON.stringify(response, null, 2));
    console.log('=== SYNC DEBUG END ===');

    return NextResponse.json({
      success: true,
      syncId: response.ingestionJob?.ingestionJobId,
      status: response.ingestionJob?.status || 'STARTING',
      dataSourceId: dataSourceId,
      message: 'Knowledge Base ingestion job started successfully',
    });

  } catch (error: any) {
    console.error('=== SYNC ERROR DEBUG ===');
    console.error('Sync API error:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Error metadata:', JSON.stringify(error.$metadata, null, 2));
    console.error('Full error:', JSON.stringify(error, null, 2));
    console.error('=== SYNC ERROR DEBUG END ===');
    
    return NextResponse.json(
      { 
        error: true, 
        message: error.message || 'Failed to start ingestion job', 
        code: error.name || 'SYNC_FAILED',
        details: error.$metadata,
        stack: error.stack
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const syncId = searchParams.get('syncId');

    if (!syncId) {
      return NextResponse.json(
        { error: true, message: 'No sync ID provided' },
        { status: 400 }
      );
    }

    // 実際の実装では、DBまたはAWSから同期ステータスを取得

    return NextResponse.json({
      syncId,
      status: 'completed',
      processedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Sync status error:', error);
    return NextResponse.json(
      { error: true, message: 'Failed to get sync status' },
      { status: 500 }
    );
  }
}