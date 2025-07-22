# Bedrock モデルID エラーの解決方法

## エラー内容
```
ValidationException: Invocation of model ID with on-demand throughput isn't supported. 
Retry your request with the ID or ARN of an inference profile that contains this model.
```

## 解決方法

### 方法1: AWS CLIで利用可能なモデルを確認
```bash
# 利用可能なモデルの一覧を取得
aws bedrock list-foundation-models --region ap-northeast-1

# 推論プロファイルの一覧を取得
aws bedrock list-inference-profiles --region ap-northeast-1
```

### 方法2: Knowledge Base APIを使用（推奨）
Knowledge Baseを既に構築済みの場合は、RetrieveAndGenerate APIを使用：

```typescript
import { BedrockAgentRuntimeClient, RetrieveAndGenerateCommand } from "@aws-sdk/client-bedrock-agent-runtime";

const agentClient = new BedrockAgentRuntimeClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

// Knowledge Baseを使用したRAG
const command = new RetrieveAndGenerateCommand({
  input: {
    text: userMessage
  },
  retrieveAndGenerateConfiguration: {
    type: "KNOWLEDGE_BASE",
    knowledgeBaseConfiguration: {
      knowledgeBaseId: process.env.BEDROCK_KNOWLEDGE_BASE_ID,
      modelArn: `arn:aws:bedrock:${process.env.AWS_REGION}::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0`
    }
  }
});
```

### 方法3: 代替モデルを使用
利用可能な他のモデルを試す：
- `anthropic.claude-instant-v1`
- `anthropic.claude-v2:1`
- `anthropic.claude-v2`

### 方法4: Bedrockコンソールで確認
1. AWS Bedrockコンソールにログイン
2. 「Model access」セクションを確認
3. 有効化されているモデルとそのIDを確認
4. 「Inference profiles」でプロファイルARNを取得

## 推奨される実装手順
1. まずKnowledge Base APIを実装（RAGシステムの本来の目的）
2. または、AWS CLIで利用可能なモデルを確認して適切なモデルIDを使用
3. 推論プロファイルのARNを使用する場合は、完全なARNを指定