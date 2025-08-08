import AgentChatView from '@/view/AgentChatView';

export default function AgentPage() {
  // SSRで環境変数を取得
  const agentId = process.env.BEDROCK_AGENT_ID || '009NRJ1JQ4';

  return <AgentChatView agentId={agentId} />;
}