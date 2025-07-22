import { NextRequest, NextResponse } from 'next/server';
import { s3Client } from '@/lib/aws-config';
import { ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';

export async function GET(request: NextRequest) {
  try {
    const command = new ListObjectsV2Command({
      Bucket: process.env.AWS_S3_BUCKET!,
      // Prefixを削除して、バケット内の全ファイルを取得
    });

    const response = await s3Client.send(command);
    const files = response.Contents?.map(item => ({
      key: item.Key,
      name: item.Key?.split('/').pop() || item.Key || '',
      size: item.Size || 0,
      uploadedAt: item.LastModified?.toISOString() || '',
      syncStatus: 'completed', // 実際の実装では、DBから同期ステータスを取得
    })) || [];

    return NextResponse.json({ files });
  } catch (error) {
    console.error('List files error:', error);
    return NextResponse.json(
      { error: true, message: 'Failed to list files' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const fileKey = searchParams.get('key');

    if (!fileKey) {
      return NextResponse.json(
        { error: true, message: 'No file key provided' },
        { status: 400 }
      );
    }

    const command = new DeleteObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET!,
      Key: fileKey,
    });

    await s3Client.send(command);

    return NextResponse.json({
      success: true,
      message: 'File deleted successfully',
    });
  } catch (error) {
    console.error('Delete file error:', error);
    return NextResponse.json(
      { error: true, message: 'Failed to delete file' },
      { status: 500 }
    );
  }
}