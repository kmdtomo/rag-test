# 🏗️ Web検索エージェント アーキテクチャ説明書

## 📌 概要

このシステムは、ユーザーの質問に対して高精度なWeb検索を行い、AIが回答を生成する仕組みです。
Bedrock Agentから独立した実装により、**6回→4-5回**にAPI呼び出しを削減しました。

## 🎯 システムの目的

1. **レート制限の回避** - API呼び出し回数を最小化
2. **検索精度の向上** - 複数クエリで情報を網羅的に収集
3. **柔軟性の確保** - 日本語/英語を自動選択
4. **セキュリティ** - APIキーをサーバー側で保護

## 📊 アーキテクチャ図

```
┌─────────────┐
│   ユーザー    │
└──────┬──────┘
       │ 質問（日本語）
       ▼
┌─────────────────────────────────┐
│     Next.js サーバー              │
│  (agent-direct/route.ts)         │
│                                  │
│  1. Claude Haikuでクエリ分解      │
│     「移籍とオッズ」              │
│     → 3つの検索クエリに分解       │
│                                  │
│  2. 並列Lambda呼び出し（3つ同時）  │
│                                  │
│  3. 結果統合・重複除去            │
│                                  │
│  4. Claude Sonnetで回答生成      │
└─────────────────────────────────┘
       │ 
       ├──────────────┬──────────────┬──────────────┐
       ▼              ▼              ▼              │
┌──────────┐  ┌──────────┐  ┌──────────┐         │
│ Lambda 1  │  │ Lambda 2  │  │ Lambda 3  │         │
│ (Tavily)  │  │ (Tavily)  │  │ (Tavily)  │         │
└──────────┘  └──────────┘  └──────────┘         │
       │              │              │              │
       └──────────────┴──────────────┘              │
                      │                             │
                      ▼                             │
              ┌──────────────┐                      │
              │  検索結果統合  │                      │
              └──────────────┘                      │
                      │                             │
                      └─────────────────────────────┘
```

## 🔄 処理フロー詳細

### 1️⃣ クエリ分解（Next.js）
```typescript
// 例：「25/26のプレミアリーグの移籍の動向や、BIG6の前評判やオッズはどうなっていますか？」
↓
Claude Haiku: [
  "Premier League transfer 2025/26",
  "BIG6 betting odds 2025/26",
  "Premier League predictions 2025/26"
]
```
**なぜNext.js側？**
- Lambda側でBedrockを呼ぶとIAM権限が複雑
- デバッグが簡単
- 既存のBedrockクライアントを再利用

### 2️⃣ 並列検索（Lambda × 3）
```python
# lambda_simple_tavily.py
- Tavily APIで各クエリを検索
- 各5件、合計最大15件の結果
- 言語は自動判定（日本語/英語）
```
**なぜLambda側？**
- Tavily APIキーをAWS内で保護
- 並列実行で高速化
- スケーラビリティ確保

### 3️⃣ 結果統合（Next.js）
```typescript
// 重複URL除去
// スコアでソート
// 上位15件を選択
```

### 4️⃣ 回答生成（Next.js）
```typescript
// Claude 3.5 Sonnet（APAC推論プロファイル）
// 検索結果を基に日本語で回答
```

## 🛡️ セキュリティ設計

| コンポーネント | 保護方法 | 理由 |
|-------------|---------|------|
| Bedrock APIキー | 環境変数（Next.js） | サーバーサイドのみアクセス可 |
| Tavily APIキー | 環境変数（Lambda） | AWS内で完結、外部露出なし |
| ユーザーデータ | HTTPS通信 | エンドツーエンド暗号化 |

## 🤔 Bedrock Agentを使わない？いいえ、Bedrockは使っています！

### 重要な誤解を解く
**❌ 誤解**: Agentを使わない = Bedrockを使わない
**✅ 正解**: Agentを使わない = **Bedrock Agentという機能**を使わない

### Bedrockの2つの使い方

```
AWS Bedrock（AIサービス全体）
│
├── 🤖 Bedrock Agent ❌ 使っていない
│   └── AIが自動で考えて行動する仕組み
│       「質問を理解→検索が必要か判断→実行→まとめ」を全自動
│
└── 💬 Bedrock Runtime ✅ 使っている
    └── AIモデルと直接会話する仕組み
        「Claude、この質問に答えて」と直接お願いできる
```

### 🔍 Runtimeとは？

**Runtime = AIモデルを実行する環境**

簡単に言うと：
- **Bedrock Agent** = 自動運転車（全てお任せ）
- **Bedrock Runtime** = 普通の車（自分で運転）

```javascript
// Bedrock Runtime の使い方（現在の実装）
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

// 直接Claudeに質問
const response = await bedrockRuntime.send({
  modelId: 'claude-3-haiku',
  messages: [{
    role: 'user',
    content: 'クエリを分解して'
  }]
});
```

つまり、**Runtime = Claudeと直接おしゃべりできる窓口**です。

## 🔴 従来：Bedrock Agent経由の実装

```
【仕組み】
User → Bedrock Agent → Lambda → Tavily
         ↑
    Agentが全てを制御
    （思考、判断、実行を自動化）

【実際の動作】
User「プレミアリーグの情報を教えて」
    ↓
Bedrock Agent内部で：
1. 「この質問について考える...」
2. 「Web検索が必要と判断」
3. 「Lambda関数を呼び出す」
4. Lambda → Tavily検索
5. 「結果を解釈する...」
6. 「回答を生成する...」

※Agentはクエリ分解はしない（単一クエリのみ）
※全ての判断をAgent内部で自動実行
```

## 🟢 現在：Bedrockを直接使う実装

```
【仕組み】
User → Next.js → Bedrock Runtime（直接）
              ├→ Claude Haiku（クエリ分解）
              └→ Claude Sonnet（回答生成）
       
       Next.js → Lambda（直接）→ Tavily

【実際の動作】
User「プレミアリーグの情報を教えて」
    ↓
Next.jsが制御：
1. Bedrock Haiku呼び出し「クエリを分解して」
   → ["移籍情報", "オッズ", "BIG6"]
2. Lambda直接呼び出し（3つ並列）
   → 各Lambdaが独立してTavily検索
3. Bedrock Sonnet呼び出し「結果をまとめて」
   → 最終回答

※我々がクエリ分解を実装
※我々が処理フローを制御
```

## 📊 具体的な違い

| 項目 | Bedrock Agent | 独自実装（Bedrock直接） |
|-----|--------------|---------------------|
| **Bedrock使用** | ✅ 使う | ✅ 使う |
| **制御方法** | Agent任せ | 自分で制御 |
| **Lambda呼び出し** | Agentが判断 | Next.jsから直接 |
| **クエリ分解** | ❌ なし | ✅ Haikuで実装 |
| **並列処理** | ❌ 不可 | ✅ 可能 |
| **処理の透明性** | ❌ ブラックボックス | ✅ 完全に見える |

## 💡 つまり何が違うの？

**Bedrock Agent使用**：
```
「AIエージェントさん、全部お任せします」
→ 便利だが制御不能
```

**Bedrock直接使用（現在）**：
```
「Haikuさん、クエリ分解して」
「Lambda 1,2,3、並列で検索して」  
「Sonnetさん、結果をまとめて」
→ 手間だが完全制御
```

## 🔮 将来のRAG統合を見据えた設計

### 現在のシステム構成
```
【Web検索】agent-direct → Tavily（外部情報）
【RAG検索】chat → Knowledge Base（内部文書）
```

### 将来の統合ビジョン
```
User「会社の規定とプレミアリーグの情報を組み合わせて教えて」
    ↓
┌─────────────────────────┐
│  統合オーケストレーター   │
├─────────┬───────────────┤
│   RAG   │   Web検索      │
│ (内部)  │   (外部)       │
└─────────┴───────────────┘
    ↓
統合された回答
```

**なぜ独自実装が統合に有利か**：

1. **モジュール性**
   - Web検索とRAGが独立
   - 必要に応じて組み合わせ可能
   - Agentだと全てが一体化して分離困難

2. **コンテキスト制御**
   ```typescript
   // 独自実装なら簡単
   if (needsInternalData) {
     results.push(await searchKnowledgeBase(query));
   }
   if (needsExternalData) {
     results.push(await searchWeb(query));
   }
   ```

3. **優先順位の制御**
   - 社内文書を優先
   - Web情報で補完
   - Agentでは優先順位を制御できない

### 実装例：ハイブリッド検索
```typescript
// 将来的な統合は簡単
async function hybridSearch(query: string) {
  const [ragResults, webResults] = await Promise.all([
    searchRAG(query),        // 社内文書
    searchWeb(query)         // Web検索
  ]);
  
  return mergeResults(ragResults, webResults, {
    ragWeight: 0.7,  // 社内情報を重視
    webWeight: 0.3
  });
}
```

## 💡 設計思想

### 責務の明確な分離

| レイヤー | 責務 | 技術選定の理由 |
|---------|------|--------------|
| **Next.js** | オーケストレーション、AI処理 | Bedrockとの統合が容易、TypeScriptで型安全 |
| **Lambda** | 外部API呼び出し | APIキーの保護、独立したスケーリング |
| **Claude Haiku** | クエリ分解 | 高速・低コスト、日本語理解が優秀 |
| **Claude Sonnet** | 回答生成 | 高品質な日本語生成、文脈理解力 |
| **Tavily** | Web検索 | AI特化の検索API、関連度スコア付き |

### なぜこの設計？

1. **セキュリティファースト**
   - APIキーは絶対にクライアントに露出しない
   - Lambdaで外部APIを隔離

2. **パフォーマンス重視**
   - 並列処理で待ち時間を最小化
   - 不要なAPI呼び出しを排除

3. **保守性**
   - 各コンポーネントが独立
   - ログで問題箇所を特定しやすい

4. **コスト効率**
   - Haikuで軽量処理
   - Sonnetは最終生成のみ

## 📝 まとめ：なぜこの実装を選んだのか

### 🎯 3つの決定的な理由

1. **実用性** - 「完璧な1回」より「確実な10回」
   - Agent: 完璧を目指すが3回に1回失敗
   - 独自実装: 95%の品質で100%動作

2. **透明性** - 問題が起きた時にすぐ対処
   - Agent: 「なぜか遅い」「なぜかエラー」
   - 独自実装: 「Lambdaの3番目が遅い」と特定可能

3. **拡張性** - RAGとの統合が簡単
   - Agent: 全てがブラックボックス
   - 独自実装: 社内文書 + Web情報の優先順位を自由に制御

### 💭 開発者の本音

```
「Bedrock Agentは素晴らしい技術だが、
　まだ『便利な実験』の域を出ない。
　ユーザーが求めるのは『確実に動くシステム』。
　だから独自実装を選んだ。」
```

**この選択は妥協ではなく、現時点での最適解です。**