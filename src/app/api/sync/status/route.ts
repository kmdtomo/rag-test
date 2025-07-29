import { NextRequest, NextResponse } from 'next/server';
import { BedrockAgentClient, GetIngestionJobCommand } from '@aws-sdk/client-bedrock-agent';

const agentClient = new BedrockAgentClient({
  region: process.env.AWS_REGION || 'ap-northeast-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ingestionJobId = searchParams.get('jobId');
    const dataSourceId = searchParams.get('dataSourceId');

    if (!ingestionJobId || !dataSourceId) {
      return NextResponse.json(
        { error: true, message: 'Missing jobId or dataSourceId parameter' },
        { status: 400 }
      );
    }

    console.log('Checking ingestion job status:', {
      knowledgeBaseId: process.env.BEDROCK_KNOWLEDGE_BASE_ID,
      dataSourceId,
      ingestionJobId,
    });

    const command = new GetIngestionJobCommand({
      knowledgeBaseId: process.env.BEDROCK_KNOWLEDGE_BASE_ID!,
      dataSourceId: dataSourceId,
      ingestionJobId: ingestionJobId,
    });

    const response = await agentClient.send(command);
    const job = response.ingestionJob;

    console.log('Ingestion job status:', JSON.stringify(job, null, 2));

    return NextResponse.json({
      success: true,
      job: {
        ingestionJobId: job?.ingestionJobId,
        status: job?.status,
        startedAt: job?.startedAt,
        updatedAt: job?.updatedAt,
        description: job?.description,
        statistics: job?.statistics,
        failureReasons: job?.failureReasons,
      },
    });

  } catch (error: any) {
    console.error('Get ingestion job status error:', error);
    return NextResponse.json(
      { 
        error: true, 
        message: error.message || 'Failed to get ingestion job status', 
        code: error.name || 'GET_STATUS_FAILED',
        details: error.$metadata
      },
      { status: 500 }
    );
  }
}