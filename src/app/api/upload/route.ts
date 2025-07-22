import { NextRequest, NextResponse } from 'next/server';
import { s3Client } from '@/lib/aws-config';
import { PutObjectCommand } from '@aws-sdk/client-s3';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { error: true, message: 'No file provided' },
        { status: 400 }
      );
    }

    const allowedTypes = ['application/pdf', 'text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: true, message: 'Invalid file type', code: 'INVALID_FILE_TYPE' },
        { status: 400 }
      );
    }

    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: true, message: 'File too large', code: 'FILE_TOO_LARGE' },
        { status: 400 }
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const timestamp = Date.now();
    const fileKey = `${timestamp}-${file.name}`;

    const command = new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET!,
      Key: fileKey,
      Body: buffer,
      ContentType: file.type,
    });

    await s3Client.send(command);

    // ファイルアップロード後、Knowledge Baseに同期をトリガー
    try {
      const syncResponse = await fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fileKey }),
      });
      
      const syncData = await syncResponse.json();
      console.log('Sync triggered:', syncData);
    } catch (syncError) {
      console.error('Sync trigger failed:', syncError);
      // 同期エラーでもファイルアップロードは成功とする
    }

    return NextResponse.json({
      success: true,
      fileKey,
      fileName: file.name,
      fileSize: file.size,
    });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { error: true, message: 'Upload failed', code: 'UPLOAD_FAILED' },
      { status: 500 }
    );
  }
}