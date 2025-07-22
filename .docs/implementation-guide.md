# AWS Bedrock RAG実装ガイド

## 概要
Next.jsアプリケーションでAWS Bedrockを使用したRAG（Retrieval-Augmented Generation）システムの実装ガイドです。

## 環境変数設定

`.env.local`ファイルに以下を設定:

```bash
AWS_ACCESS_KEY_ID=取得したアクセスキーID
AWS_SECRET_ACCESS_KEY=取得したシークレットキー
AWS_REGION=ap-northeast-1
BEDROCK_KNOWLEDGE_BASE_ID=id
BEDROCK_MODEL_ID=anthropic.claude-3-5-sonnet-20241022-v2:0
AWS_S3_BUCKET=gen-seki-test-bucket
```

## 必要なパッケージ

```bash
pnpm add @aws-sdk/client-bedrock-runtime @aws-sdk/client-s3 @aws-sdk/s3-request-presigner multer
pnpm add -D @types/multer
```

## プロジェクト構造

```
src/
├── lib/
│   └── aws-config.ts        # AWS設定
├── app/
│   ├── api/
│   │   ├── upload/route.ts  # ファイルアップロード
│   │   ├── chat/route.ts    # RAGチャット
│   │   └── sync/route.ts    # Knowledge Base同期
│   └── page.tsx             # メインページ（SSR）
├── view/
│   └── RagChatView.tsx      # メインビューコンポーネント
└── components/
    ├── FileUpload.tsx       # ファイルアップロード
    ├── ChatInterface.tsx    # チャットUI
    └── FileList.tsx         # アップロード済みファイル一覧
```

## 実装手順

### 1. AWS設定ファイル作成

`src/lib/aws-config.ts`:
```typescript
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { S3Client } from '@aws-sdk/client-s3';

export const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});
```

### 2. APIルート実装

#### ファイルアップロード (`src/app/api/upload/route.ts`)
- multerを使用してPDFファイルを受け取る
- S3にファイルをアップロード
- ファイル情報をレスポンスで返す

#### チャット機能 (`src/app/api/chat/route.ts`)
- Bedrock Knowledge BaseのRetrieveAndGenerate APIを使用
- ユーザーの質問に対してRAGベースの回答を生成

#### Knowledge Base同期 (`src/app/api/sync/route.ts`)
- S3にアップロードされたファイルをKnowledge Baseに同期
- ベクトル化処理をトリガー

### 3. UIコンポーネント実装

#### FileUpload.tsx
- ドラッグ&ドロップ対応
- PDF/TXT/DOCX形式のサポート
- アップロード進捗表示

#### ChatInterface.tsx
- リアルタイムチャット
- ストリーミング対応
- 履歴表示

#### FileList.tsx
- アップロード済みファイル一覧
- ファイル削除機能
- 同期ステータス表示

### 4. ビューコンポーネント作成

`src/view/RagChatView.tsx`でUIコンポーネントを集約：
```typescript
'use client';

import { FileUpload } from '@/components/FileUpload';
import { ChatInterface } from '@/components/ChatInterface';
import { FileList } from '@/components/FileList';

export default function RagChatView() {
  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-6">RAG Chat System</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1">
          <FileUpload />
          <FileList />
        </div>
        <div className="md:col-span-2">
          <ChatInterface />
        </div>
      </div>
    </div>
  );
}
```

### 5. メインページ実装（SSR）

`src/app/page.tsx`：
```typescript
import RagChatView from '@/view/RagChatView';

export default function Home() {
  return <RagChatView />;
}
```

## UI実装ガイドライン

### チャットボットUI設計

1. **レイアウト**
   - 左サイドバー: ファイル管理（アップロード・一覧表示）
   - メインエリア: チャット画面（メッセージ履歴・入力欄）
   - モバイルレスポンシブ: タブ切り替え方式

2. **チャットインターフェース**
   - メッセージバブル: ユーザー（右・青系）/ AI（左・グレー系）
   - タイムスタンプ: 各メッセージに相対時間表示
   - マークダウン対応: コードブロック、リスト、リンクの適切な表示
   - 自動スクロール: 新規メッセージで最下部へ

3. **入力エリア**
   - テキストエリア: 自動リサイズ（最大5行）
   - 送信ボタン: Enterキーでも送信可能（Shift+Enterで改行）
   - 入力中インジケーター: AIが応答生成中は入力無効化

### ローディングUI最適化

1. **スケルトンスクリーン**
   - 初期読み込み: チャット履歴のスケルトン表示
   - ファイルリスト: リストアイテムのプレースホルダー

2. **プログレスインジケーター**
   - ファイルアップロード: プログレスバー（パーセンテージ表示）
   - AI応答待機: ドット3つのアニメーション（...）
   - ストリーミング応答: リアルタイムテキスト表示

3. **マイクロインタラクション**
   - ボタンホバー: スムーズなカラートランジション
   - メッセージ送信: フェードイン効果
   - エラー表示: シェイクアニメーション

4. **パフォーマンス最適化**
   - 仮想スクロール: 大量メッセージ履歴の効率的表示
   - 遅延ローディング: ファイルリストのページネーション
   - デバウンス: 入力中の過度なAPI呼び出し防止

## 実装のポイント

1. **セキュリティ**
   - 環境変数は`.env`に保存
   - ファイルアップロードサイズ制限
   - CORS設定

2. **パフォーマンス**
   - ストリーミングレスポンス
   - キャッシュ活用
   - 非同期処理

3. **エラーハンドリング**
   - API呼び出しのリトライ
   - ユーザーフレンドリーなエラーメッセージ
   - ログ記録

## 次のステップ

1. 基本機能の実装
2. UIの改善
3. エラーハンドリングの強化
4. テストの追加
5. デプロイ準備