import { NextRequest, NextResponse } from 'next/server';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { s3Client } from '@/lib/aws-config';

export async function POST(request: NextRequest) {
  try {
    const { fileKey } = await request.json();

    if (!fileKey) {
      return NextResponse.json(
        { error: 'File key is required' },
        { status: 400 }
      );
    }

    // S3からファイルを取得
    const command = new GetObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET!,
      Key: fileKey,
    });

    const response = await s3Client.send(command);
    
    if (!response.Body) {
      return NextResponse.json(
        { error: 'File content not found' },
        { status: 404 }
      );
    }

    // ストリームをテキストに変換
    const content = await response.Body.transformToString();

    // ファイルのメタデータも取得
    const metadata = {
      contentType: response.ContentType,
      contentLength: response.ContentLength,
      lastModified: response.LastModified,
    };

    return NextResponse.json({
      content,
      metadata,
      fileKey,
    });

  } catch (error) {
    console.error('Error reading file from S3:', error);
    return NextResponse.json(
      { error: 'Failed to read file from S3' },
      { status: 500 }
    );
  }
}