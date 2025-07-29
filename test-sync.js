// S3とBedrock Knowledge Base同期テストスクリプト
// 使用方法: node test-sync.js

const testSync = async () => {
  console.log('=== S3 to Bedrock Knowledge Base Sync Test ===\n');

  // 1. ファイルアップロードのテスト
  console.log('1. Testing file upload to S3...');
  const formData = new FormData();
  
  // テスト用のファイルを作成
  const testContent = `This is a test document for Bedrock Knowledge Base sync.
Created at: ${new Date().toISOString()}
Random ID: ${Math.random().toString(36).substring(7)}`;
  
  const blob = new Blob([testContent], { type: 'text/plain' });
  const testFile = new File([blob], `test-sync-${Date.now()}.txt`, { type: 'text/plain' });
  
  formData.append('file', testFile);

  try {
    const uploadResponse = await fetch('http://localhost:3000/api/upload', {
      method: 'POST',
      body: formData,
    });

    const uploadData = await uploadResponse.json();
    console.log('Upload response:', uploadData);

    if (!uploadData.success) {
      console.error('Upload failed:', uploadData);
      return;
    }

    console.log(`✓ File uploaded successfully: ${uploadData.fileKey}\n`);

    // 2. 同期状態の確認（アップロード時に自動同期されているはず）
    console.log('2. Checking sync trigger (should be automatic)...');
    console.log('Waiting for sync to process...\n');

    // 少し待機
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 3. 手動同期のテスト
    console.log('3. Testing manual sync trigger...');
    const syncResponse = await fetch('http://localhost:3000/api/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fileKey: uploadData.fileKey }),
    });

    const syncData = await syncResponse.json();
    console.log('Sync response:', syncData);

    if (syncData.success && syncData.syncId) {
      console.log(`✓ Sync triggered successfully: ${syncData.syncId}\n`);

      // 4. 同期ステータスの監視
      console.log('4. Monitoring sync status...');
      let attempts = 0;
      const maxAttempts = 30; // 最大5分間監視

      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 10000)); // 10秒待機

        const statusResponse = await fetch(
          `http://localhost:3000/api/sync/status?jobId=${syncData.syncId}&dataSourceId=${syncData.dataSourceId}`,
          { method: 'GET' }
        );

        const statusData = await statusResponse.json();
        console.log(`Attempt ${attempts + 1}/${maxAttempts} - Status:`, statusData.job?.status || 'Unknown');

        if (statusData.job?.statistics) {
          console.log('Statistics:', statusData.job.statistics);
        }

        if (statusData.job?.status === 'COMPLETE') {
          console.log('\n✓ Sync completed successfully!');
          break;
        } else if (statusData.job?.status === 'FAILED') {
          console.error('\n✗ Sync failed!');
          if (statusData.job?.failureReasons) {
            console.error('Failure reasons:', statusData.job.failureReasons);
          }
          break;
        }

        attempts++;
      }

      if (attempts >= maxAttempts) {
        console.log('\n⚠ Sync monitoring timeout - job may still be running');
      }
    } else {
      console.error('✗ Sync trigger failed:', syncData);
    }

  } catch (error) {
    console.error('Test error:', error);
  }

  console.log('\n=== Test Complete ===');
};

// 実行
testSync().catch(console.error);