// Bedrockエージェント関連の型定義

export interface SearchSource {
  id: string;
  url: string;
  title: string;
  snippet: string;
  relevance_score: number;
}

export interface SearchResult {
  type: 'search_results' | 'no_search_needed';
  query: string;
  search_performed: boolean;
  summary?: string;
  sources?: SearchSource[];
  urls?: string[];
  total_results?: number;
  processing_time?: number;
  fallback?: boolean;
}

export interface AgentResponse {
  response: string;
  sessionId: string;
  searchResult?: SearchResult;
  sources?: Source[];
  error?: boolean;
  isRateLimit?: boolean;
  userMessage?: string;
}

export interface Source {
  title: string;
  uri?: string;
  content: string;
  type: 'web_search' | 'knowledge_base';
  score: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  sources?: Source[];
  searchResult?: SearchResult;
  isLoading?: boolean;
  error?: boolean;
}

export interface ChatSession {
  sessionId: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
}