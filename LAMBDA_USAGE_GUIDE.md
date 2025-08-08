# Lambda関数の使用状況

## 📌 現在使用中のLambda関数

### lambda_simple_tavily.py
**状態**: ✅ **使用中**
**用途**: agent-direct APIで使用される現在のメインLambda関数
**動作**:
1. Tavilyでクエリを検索（言語自動判定）
2. 結果を7件取得
3. 整形してNext.jsに返す
**デプロイ先**: `tavily_search-giolt`

## ❌ 未使用のLambda関数（削除対象）

### lambda_rag_with_decomposition.py
**状態**: 未使用
**理由**: クエリ分解をNext.js側に移行したため不要

### lambda_rag_optimized.py
**状態**: 未使用
**理由**: 古いバージョン

### lambda_rag_balanced.py
**状態**: 未使用
**理由**: 古いバージョン

### lambda_tavily_optimized.py
**状態**: 未使用
**理由**: 古いバージョン

### lambda_tavily_simple.py
**状態**: 未使用
**理由**: 古いバージョン

### lambda_simple_search.py
**状態**: 未使用
**理由**: lambda_simple_tavily.pyで置き換え済み

## 📋 現在のアーキテクチャ

```
User 
  ↓
Next.js (agent-direct/route.ts)
  ↓
Claude Haiku (クエリ分解) ← 現在の日時を自動付与
  ↓
並列Lambda呼び出し (lambda_simple_tavily.py × 3)
  ↓
結果統合
  ↓
Claude Sonnet (回答生成)
  ↓
User
```

## 主な改善点
1. **クエリ分解をNext.js側で実行** - IAM権限不要
2. **言語自動選択** - 日本語/英語を自動判定
3. **現在日時の自動付与** - 年の誤認識を防止
4. **並列検索** - 3つのクエリを同時実行