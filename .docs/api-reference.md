# API Reference

## エンドポイント一覧

### POST /api/upload
ファイルをS3にアップロードし、Knowledge Baseに登録準備

**Request:**
- Method: `POST`
- Content-Type: `multipart/form-data`
- Body:
  ```
  file: File (PDF/TXT/DOCX)
  ```

**Response:**
```json
{
  "success": true,
  "fileKey": "uploads/1234567890-document.pdf",
  "fileName": "document.pdf",
  "fileSize": 1024000
}
```

### POST /api/chat
Knowledge Baseを使用したRAGチャット

**Request:**
```json
{
  "message": "質問内容",
  "sessionId": "optional-session-id"
}
```

**Response:**
```json
{
  "response": "AIからの回答",
  "sources": [
    {
      "fileName": "document.pdf",
      "page": 5,
      "relevanceScore": 0.95
    }
  ]
}
```

### POST /api/sync
S3のファイルをKnowledge Baseに同期

**Request:**
```json
{
  "fileKey": "uploads/1234567890-document.pdf"
}
```

**Response:**
```json
{
  "success": true,
  "syncId": "sync-12345",
  "status": "processing"
}
```

### GET /api/sync/:syncId
同期ステータスの確認

**Response:**
```json
{
  "syncId": "sync-12345",
  "status": "completed",
  "processedAt": "2024-01-01T12:00:00Z"
}
```

### GET /api/files
アップロード済みファイル一覧

**Response:**
```json
{
  "files": [
    {
      "key": "uploads/1234567890-document.pdf",
      "name": "document.pdf",
      "size": 1024000,
      "uploadedAt": "2024-01-01T10:00:00Z",
      "syncStatus": "completed"
    }
  ]
}
```

### DELETE /api/files/:fileKey
ファイルの削除

**Response:**
```json
{
  "success": true,
  "message": "File deleted successfully"
}
```

## エラーレスポンス

すべてのエンドポイントは以下の形式でエラーを返します：

```json
{
  "error": true,
  "message": "エラーの詳細",
  "code": "ERROR_CODE"
}
```

### エラーコード一覧
- `FILE_TOO_LARGE`: ファイルサイズが制限を超過
- `INVALID_FILE_TYPE`: サポートされていないファイル形式
- `UPLOAD_FAILED`: S3アップロードエラー
- `SYNC_FAILED`: Knowledge Base同期エラー
- `CHAT_ERROR`: チャット処理エラー
- `AUTH_ERROR`: 認証エラー