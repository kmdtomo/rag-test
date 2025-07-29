# RAG検索精度向上ガイド

## 概要
Bedrock Knowledge Baseでの検索スコアを改善するための実践的な手法をレベル別にまとめました。

---

## 🟢 レベル1: 今すぐできる改善（5分で実装）

### 1. Knowledge Baseの設定変更
```javascript
// AWSコンソールで変更可能
{
  "chunkingConfiguration": {
    "chunkingStrategy": "FIXED_SIZE",
    "fixedSizeChunkingConfiguration": {
      "maxTokens": 800,        // 300 → 800に変更
      "overlapPercentage": 20  // 0 → 20%に変更
    }
  }
}
```
**効果**: スコア +0.1〜0.2向上

### 2. 検索結果数を増やす
```javascript
// src/app/api/chat/route.ts
retrievalConfiguration: {
  vectorSearchConfiguration: {
    numberOfResults: 10  // 5 → 10に変更
  }
}
```
**効果**: より多くの候補から選択可能

### 3. ハイブリッド検索を有効化
```javascript
retrievalConfiguration: {
  vectorSearchConfiguration: {
    numberOfResults: 10,
    overrideSearchType: 'HYBRID'  // 追加
  }
}
```
**効果**: キーワード検索も併用してマッチ率向上

---

## 🟡 レベル2: 検討の余地あり（効果とコストを天秤に）

**⚠️ 注意**: Bedrockは既に内部で最適化されているため、これらの実装は慎重に検討してください。

### 1. クエリの前処理
```javascript
// クエリ改善関数
const improveQuery = (query) => {
  // 略語辞書
  const abbreviations = {
    'Be': 'ベリリウム Be',
    'Al': 'アルミニウム Al',
    'FAQ': 'よくある質問 FAQ',
    'PDF': 'PDFファイル'
  };
  
  let improved = query;
  
  // 略語を展開
  Object.entries(abbreviations).forEach(([abbr, full]) => {
    improved = improved.replace(new RegExp(abbr, 'gi'), full);
  });
  
  // 短すぎる質問を拡張
  if (improved.length < 10) {
    improved = `${improved}について詳しく教えてください`;
  }
  
  return improved;
};
```

### 2. 低スコア時の自動リトライ
```javascript
// 検索実行部分
const results = await agentClient.send(retrieveCommand);
const avgScore = results.retrievalResults?.reduce((sum, r) => sum + (r.score || 0), 0) / results.retrievalResults?.length || 0;

if (avgScore < 0.6) {
  // より広い検索を試行
  const retryCommand = new RetrieveCommand({
    knowledgeBaseId: process.env.BEDROCK_KNOWLEDGE_BASE_ID!,
    retrievalQuery: {
      text: query.split(' ').slice(0, 3).join(' ')  // 最初の3単語
    },
    retrievalConfiguration: {
      vectorSearchConfiguration: {
        numberOfResults: 15
      }
    }
  });
  
  const retryResults = await agentClient.send(retryCommand);
  // より良い結果があれば置き換え
}
```

### 3. マルチクエリ検索
```javascript
const multiSearch = async (originalQuery) => {
  const queries = [
    originalQuery,
    `${originalQuery}とは`,
    `${originalQuery}について`,
    `${originalQuery}の方法`
  ];
  
  const allResults = [];
  
  for (const q of queries) {
    const command = new RetrieveCommand({
      knowledgeBaseId: process.env.BEDROCK_KNOWLEDGE_BASE_ID!,
      retrievalQuery: { text: q },
      retrievalConfiguration: {
        vectorSearchConfiguration: { numberOfResults: 3 }
      }
    });
    
    const results = await agentClient.send(command);
    allResults.push(...(results.retrievalResults || []));
  }
  
  // スコアでソートして上位を返す
  return allResults
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 5);
};
```

---

## 🔴 レベル3: 本格的な改善（推奨しない）

**❌ 推奨しない理由**:
- Bedrockが既に同等の機能を内部実装
- 複雑性に見合う効果が期待できない
- AWSのアップデートで陳腐化するリスク

以下は参考情報として掲載：

### 1. 文書の前処理パイプライン
```python
# Lambda関数で実装
import boto3
from PyPDF2 import PdfReader
import pandas as pd

def preprocess_document(s3_bucket, s3_key):
    """S3にアップロードされた文書を前処理"""
    
    if s3_key.endswith('.pdf'):
        # PDFから構造化テキストを抽出
        text = extract_pdf_with_structure(s3_bucket, s3_key)
        
        # 表をテキスト化
        text = convert_tables_to_text(text)
        
        # セクション情報を保持
        text = preserve_section_hierarchy(text)
        
    # 処理済みファイルを別のS3パスに保存
    save_preprocessed(text, s3_bucket, f"processed/{s3_key}.txt")
```

### 2. メタデータエンリッチメント
```javascript
// ファイルアップロード時にメタデータを付与
const enrichedUpload = async (file) => {
  const metadata = {
    fileType: detectFileType(file),
    language: detectLanguage(file),
    category: classifyContent(file),  // AI分類
    uploadDate: new Date().toISOString(),
    keywords: extractKeywords(file)    // キーワード抽出
  };
  
  // S3にメタデータ付きでアップロード
  const command = new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET!,
    Key: fileKey,
    Body: buffer,
    Metadata: metadata
  });
};
```

### 3. セマンティックキャッシング
```javascript
// DynamoDBでクエリと結果をキャッシュ
const semanticCache = {
  async get(query) {
    // 類似クエリを検索
    const similar = await findSimilarQueries(query);
    if (similar && similar.score > 0.9) {
      return similar.results;
    }
    return null;
  },
  
  async set(query, results) {
    // クエリと結果を保存
    await saveToCache(query, results, ttl = 86400);
  }
};
```

### 4. リランキングモデル
```javascript
// 検索結果を再評価
const rerank = async (query, results) => {
  const rerankedResults = await Promise.all(
    results.map(async (result) => {
      // 小さいLLMで関連性を再評価
      const relevanceScore = await evaluateRelevance(query, result.content);
      return {
        ...result,
        rerankScore: relevanceScore
      };
    })
  );
  
  return rerankedResults.sort((a, b) => b.rerankScore - a.rerankScore);
};
```

---

## 📊 期待される改善効果

| 手法 | 実装時間 | スコア改善 | コスト |
|------|---------|-----------|--------|
| チャンクサイズ変更 | 5分 | +0.1-0.2 | 無料 |
| ハイブリッド検索 | 5分 | +0.05-0.1 | 無料 |
| クエリ前処理 | 30分 | +0.1-0.15 | 無料 |
| マルチクエリ | 1時間 | +0.15-0.2 | 検索回数増 |
| 文書前処理 | 1-2日 | +0.2-0.3 | Lambda費用 |
| リランキング | 1週間 | +0.2-0.4 | 追加LLM費用 |

---

## 🎯 現実的な推奨アプローチ

### やるべきこと（効果大・リスク小）
✅ **チャンクサイズを800トークンに変更**
✅ **オーバーラップ20%を設定**  
✅ **ハイブリッド検索を有効化**
✅ **検索結果数を10に増やす**

### やらなくて良いこと
❌ 独自のクエリ前処理（Bedrockがやってくれる）
❌ 複雑なリランキング（既に最適化済み）
❌ 過度な文書前処理（メンテが大変）

### スコアが低い根本原因への対処
1. **文書の質を上げる**
   - PDFよりテキストファイル
   - 表より文章
   - 明確な見出し構造

2. **Knowledge Baseの再作成**
   - 設定変更後は新規作成が確実
   - 既存のものを編集するより効果的

---

## ⚠️ 注意事項

- **コストとのバランス**: 精度向上とAPI呼び出し回数のトレードオフ
- **レイテンシー**: 複数検索は応答時間が増加
- **メンテナンス**: 複雑な実装は保守コストも考慮

---

## 📚 参考リンク

- [AWS Bedrock Knowledge Base ドキュメント](https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base.html)
- [RAG評価ベンチマーク BEIR](https://github.com/beir-cellar/beir)
- [Hybrid Search in Bedrock](https://aws.amazon.com/blogs/machine-learning/hybrid-search-in-amazon-bedrock-knowledge-bases/)