# AWS Bedrock Knowledge Base セットアップガイド

## 前提条件

以下が設定済みであることを確認：
- AWS Bedrockが有効化されている
- Knowledge Base ID: `id`
- S3バケット: `gen-seki-test-bucket`
- モデル: `anthropic.claude-3-5-sonnet-20241022-v2:0`

## IAM権限設定

アプリケーションで使用するIAMユーザー/ロールに以下の権限を付与：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": "arn:aws:bedrock:ap-northeast-1:*:foundation-model/anthropic.claude-3-5-sonnet-20241022-v2:0"
    },
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:RetrieveAndGenerate",
        "bedrock:Retrieve"
      ],
      "Resource": "arn:aws:bedrock:ap-northeast-1:*:knowledge-base/9K1DDD57QP"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::gen-seki-test-bucket",
        "arn:aws:s3:::gen-seki-test-bucket/*"
      ]
    }
  ]
}
```

## S3バケット設定

### CORS設定
S3バケットに以下のCORS設定を追加：

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
    "AllowedOrigins": ["http://localhost:3000"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

### バケットポリシー（オプション）
プリサインドURLを使用する場合：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowPresignedUrls",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::YOUR_ACCOUNT_ID:user/YOUR_IAM_USER"
      },
      "Action": [
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": "arn:aws:s3:::gen-seki-test-bucket/uploads/*"
    }
  ]
}
```

## Knowledge Base設定

### データソース設定
1. S3データソースとして`gen-seki-test-bucket`を設定
2. プレフィックス: `uploads/`
3. ファイル形式: PDF, TXT, DOCX

### 同期設定
- 自動同期: 無効（APIから手動で同期）
- チャンク設定:
  - チャンクサイズ: 512トークン
  - オーバーラップ: 20%

### ベクトルデータベース
- Amazon OpenSearch Serverless または
- Amazon RDS (pgvector)

## 環境変数チェックリスト

```bash
# .env.local
AWS_ACCESS_KEY_ID=✓
AWS_SECRET_ACCESS_KEY=✓
AWS_REGION=ap-northeast-1 ✓
BEDROCK_KNOWLEDGE_BASE_ID=id ✓
BEDROCK_MODEL_ID=anthropic.claude-3-5-sonnet-20241022-v2:0 ✓
AWS_S3_BUCKET=gen-seki-test-bucket ✓
```

## トラブルシューティング

### よくあるエラー

1. **AccessDeniedException**
   - IAM権限を確認
   - リージョンが正しいか確認

2. **ResourceNotFoundException**
   - Knowledge Base IDが正しいか確認
   - モデルIDが正しいか確認

3. **S3アップロードエラー**
   - バケット名が正しいか確認
   - CORS設定を確認

### ログ確認
CloudWatchでログを確認：
- Bedrock呼び出しログ
- S3アクセスログ
- Knowledge Base同期ログ