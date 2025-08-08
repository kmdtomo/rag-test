# RAG最適化APIアーキテクチャ

## システム全体の流れ

```mermaid
sequenceDiagram
    participant User as ユーザー（ブラウザ）
    participant Web as Next.js Webアプリ
    participant API as /api/rag-optimized
    participant Claude1 as Bedrock Claude (Haiku)
    participant KB as Bedrock Knowledge Base
    participant Claude2 as Bedrock Claude (Sonnet)
    
    User->>Web: 質問を入力
    Web->>API: POST /api/rag-optimized
    Note right of API: {message, model, enableOptimizations}
    
    rect rgba(255, 200, 200, 0.1)
        Note over API,Claude1: 1. クエリ分解フェーズ
        API->>Claude1: 複雑な質問を分解
        Claude1-->>API: サブクエリの配列
    end
    
    rect rgba(200, 255, 200, 0.1)
        Note over API,KB: 2. 検索フェーズ
        loop 各サブクエリ
            API->>KB: RetrieveCommand (ハイブリッド検索)
            KB-->>API: 検索結果
        end
    end
    
    rect rgba(200, 200, 255, 0.1)
        Note over API: 3. 最適化フェーズ
        API->>API: 重複除去
        API->>API: 再ランキング（スコア＋長さ）
    end
    
    rect rgba(255, 255, 200, 0.1)
        Note over API,Claude2: 4. 生成フェーズ
        API->>Claude2: 最適化された検索結果 + プロンプト
        Claude2-->>API: 回答生成
    end
    
    API-->>Web: レスポンス
    Note right of Web: {response, sources, metadata}
    Web-->>User: 回答表示
```

## データフローの詳細

### 1. リクエスト構造
```typescript
// ブラウザ → API
{
  message: "ユーザーの質問",
  model: "sonnet" | "haiku",
  enableOptimizations: true  // 最適化機能のON/OFF
}
```

### 2. クエリ分解（Optimization Phase 1）
```typescript
// 例：「東京の天気と観光地を教えて」
// ↓ Claude Haikuで分解
[
  "東京の天気",
  "東京の観光地"
]
```

### 3. Knowledge Base検索（Optimization Phase 2）
```typescript
// 各サブクエリで検索
retrievalConfiguration: {
  vectorSearchConfiguration: {
    numberOfResults: 5,
    overrideSearchType: 'HYBRID'  // セマンティック + キーワード
  }
}
```

### 4. 検索結果の最適化（Optimization Phase 3）
- **重複除去**: 同じコンテンツを統合
- **再ランキング**: スコア（70%）+ コンテンツ長（30%）で再評価

### 5. レスポンス構造
```typescript
// API → ブラウザ
{
  response: "生成された回答",
  sources: [
    {
      content: "ソースの内容",
      score: 0.95,
      uri: "s3://...",
      location: {...}
    }
  ],
  metadata: {
    searchQueries: ["東京の天気", "東京の観光地"],
    totalResults: 10,
    optimizationsApplied: [
      "query_decomposition",
      "hybrid_search", 
      "deduplication",
      "reranking"
    ]
  }
}
```

## AWS サービスの役割

### 1. **Bedrock Knowledge Base**
- ベクトルデータベース（Amazon OpenSearch）
- S3からのドキュメント取得
- ハイブリッド検索（セマンティック + キーワード）

### 2. **Bedrock Claude Models**
- **Claude Haiku**: 軽量・高速（クエリ分解用）
- **Claude Sonnet 3.5**: 高性能（回答生成用）

### 3. **処理の流れ**
```
ユーザー入力
    ↓
クエリ分解（Claude Haiku）
    ↓
並列検索（Knowledge Base × N回）
    ↓
結果の最適化（アプリ側）
    ↓
回答生成（Claude Sonnet）
    ↓
ユーザーへ返却
```

## 最適化のポイント

1. **クエリ分解**: 複雑な質問を単純な複数の質問に分解
2. **ハイブリッド検索**: より関連性の高い結果を取得
3. **並列処理**: 複数のサブクエリを同時検索
4. **重複除去**: 同じ情報の重複を排除
5. **再ランキング**: スコアとコンテンツの質で再評価

## 通常のAPIとの違い

| 機能 | /api/chat | /api/rag-optimized |
|-----|-----------|-------------------|
| クエリ分解 | ❌ | ✅ |
| 検索タイプ | ベクトルのみ | ハイブリッド |
| 検索回数 | 1回 | N回（サブクエリ数） |
| 結果数 | 5件 | 10件以上→10件に絞る |
| 再ランキング | ❌ | ✅ |
| 生成モデル制御 | 基本設定 | 詳細設定 |