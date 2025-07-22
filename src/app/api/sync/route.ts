import { NextRequest, NextResponse } from 'next/server';
import { BedrockAgentClient, StartIngestionJobCommand, ListDataSourcesCommand } from '@aws-sdk/client-bedrock-agent';

const agentClient = new BedrockAgentClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export async function POST(request: NextRequest) {
  try {
    const { fileKey } = await request.json();

    console.log('Starting Knowledge Base ingestion job for file:', fileKey);

    // データソースIDを取得
    const listDataSourcesCommand = new ListDataSourcesCommand({
      knowledgeBaseId: process.env.BEDROCK_KNOWLEDGE_BASE_ID!,
    });

    const dataSources = await agentClient.send(listDataSourcesCommand);
    console.log('Available data sources:', dataSources.dataSourceSummaries);

    if (!dataSources.dataSourceSummaries || dataSources.dataSourceSummaries.length === 0) {
      throw new Error('No data sources found for this Knowledge Base');
    }

    // 最初のデータソースを使用（通常S3データソースが1つ）
    const dataSourceId = dataSources.dataSourceSummaries[0].dataSourceId!;
    console.log('Using data source ID:', dataSourceId);

    // Ingestion Jobを開始
    const command = new StartIngestionJobCommand({
      knowledgeBaseId: process.env.BEDROCK_KNOWLEDGE_BASE_ID!,
      dataSourceId: dataSourceId,
      description: `API triggered sync for file: ${fileKey}`,
    });

    console.log('Executing ingestion job...');
    const response = await agentClient.send(command);
    
    console.log('Ingestion job started:', {
      jobId: response.ingestionJob?.ingestionJobId,
      status: response.ingestionJob?.status,
    });

    return NextResponse.json({
      success: true,
      syncId: response.ingestionJob?.ingestionJobId,
      status: response.ingestionJob?.status || 'STARTING',
      dataSourceId: dataSourceId,
      message: 'Knowledge Base ingestion job started successfully',
    });

  } catch (error: any) {
    console.error('Sync API error:', error);
    return NextResponse.json(
      { 
        error: true, 
        message: error.message || 'Failed to start ingestion job', 
        code: error.name || 'SYNC_FAILED',
        details: error.$metadata
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