'use client';

import { useState, useRef, useEffect } from 'react';
import RealTimeSearchDisplay from './RealTimeSearchDisplay';
import { SearchResult } from '@/types/agent';
import MarkdownRenderer from './MarkdownRenderer';
import { ProcessDetails } from './ProcessDetails';

interface Source {
  content?: string;
  location?: any;
  uri?: string;
  score?: number;
  type?: 'knowledge_base' | 'web_search' | 'direct_s3';
  title?: string;
  query?: string;
  citationNumber?: number;
  pageNumber?: number;
  metadata?: any;
  // 新しいフィールド（自律型検索用）
  is_primary?: boolean;
  source_type?: 'official' | 'academic' | 'news' | 'blog' | 'social' | 'unknown';
  language?: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  sources?: Source[];
  searchedUrls?: string[];
  searchResult?: SearchResult;
  processLog?: string[];
}

interface ChatInterfaceProps {
  onSourceClick?: (sources: Source[], index: number) => void;
  onSourcesUpdate?: (sources: Source[]) => void;
  apiEndpoint?: string;
  placeholder?: string;
  isAgentChat?: boolean;
  selectedFile?: any; // Direct S3用の選択ファイル
}

export default function CompactChatInterface({ 
  onSourceClick, 
  onSourcesUpdate, 
  apiEndpoint = '/api/chat', 
  placeholder = 'メッセージを入力...', 
  isAgentChat = false,
  selectedFile
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState<'sonnet35' | 'sonnet4'>('sonnet4');
  const [selectedApi, setSelectedApi] = useState<'rag-optimized' | 'rag-integrated'>('rag-integrated');
  const [selectedAgentApi, setSelectedAgentApi] = useState<'agent-bedrock' | 'agent-enhanced' | 'agent-autonomous'>('agent-autonomous');
  const [currentSearchQuery, setCurrentSearchQuery] = useState<string>('');
  const [currentSearchResult, setCurrentSearchResult] = useState<SearchResult | undefined>(undefined);
  const [lastEnterTime, setLastEnterTime] = useState<number>(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
    }
  }, [input]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setCurrentSearchQuery(input.trim());
    setCurrentSearchResult(undefined);

    try {
      const endpoint = apiEndpoint !== '/api/chat' 
        ? apiEndpoint 
        : (!isAgentChat 
          ? `/api/${selectedApi}` 
          : `/api/${selectedAgentApi}`);
      
      // デバッグログ
      console.log('Selected Agent API:', selectedAgentApi);
      console.log('Final endpoint:', endpoint);
      
      // Build request body based on API type
      const requestBody: any = {
        message: userMessage.content,
        model: selectedModel
      };
      
      // Add Direct S3 specific parameters
      if (apiEndpoint === '/api/direct-s3-chat' && selectedFile) {
        requestBody.fileKey = selectedFile.key;
        requestBody.fileName = selectedFile.name;
      }
      
      // Add API-specific parameters
      if (!isAgentChat && selectedApi === 'rag-optimized') {
        requestBody.enableOptimizations = true;
      }
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.message || 'エラーが発生しました');
      }

      const searchedUrls = data.searchResult?.urls || [];
      const sources = data.sources || [];

      console.log('Response data:', data);
      console.log('Process log from metadata:', data.metadata?.processLog);
      
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.content || data.response || data.output?.text || 'エラー: 応答がありません',
        timestamp: new Date(),
        sources: sources.length > 0 ? sources : undefined,
        searchedUrls: searchedUrls.length > 0 ? searchedUrls : undefined,
        searchResult: data.searchResult,
        processLog: data.processLog || data.metadata?.processLog
      };

      setMessages(prev => [...prev, assistantMessage]);

      if (onSourcesUpdate && sources.length > 0) {
        onSourcesUpdate(sources);
      }
    } catch (error) {
      console.error('Error:', error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'ネットワークエラーが発生しました。もう一度お試しください。',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      
      const currentTime = Date.now();
      const timeSinceLastEnter = currentTime - lastEnterTime;
      
      // 500ms以内に2回目のEnterが押された場合に送信
      if (timeSinceLastEnter < 500 && timeSinceLastEnter > 0) {
        handleSubmit(e);
        setLastEnterTime(0); // リセット
      } else {
        setLastEnterTime(currentTime);
      }
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex flex-col h-full max-h-full bg-white shadow-lg overflow-hidden">
      {/* コンパクトヘッダー */}
      <div className="px-4 py-2 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
              <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
              </svg>
            </div>
            <h3 className="text-xs font-medium text-gray-900">
              {apiEndpoint === '/api/direct-s3-chat' ? 'Direct S3' : (isAgentChat ? 'Web検索AI' : 'RAG AI')}
            </h3>
          </div>
          
          {/* 横並びのコントロール */}
          <div className="flex items-center space-x-3">
            {/* API選択 - Direct S3では非表示 */}
            {apiEndpoint !== '/api/direct-s3-chat' && (
              <div className="flex items-center space-x-1">
                <span className="text-xs text-gray-600">API:</span>
                <div className="flex bg-gray-100 rounded p-0.5">
                {!isAgentChat ? (
                  <>
                    <button
                      onClick={() => setSelectedApi('rag-optimized')}
                      className={`px-2 py-0.5 text-xs rounded transition-all ${
                        selectedApi === 'rag-optimized'
                          ? 'bg-white text-blue-600 shadow-sm font-medium'
                          : 'text-gray-600 hover:text-gray-800'
                      }`}
                    >
                      最適化
                    </button>
                    <button
                      onClick={() => setSelectedApi('rag-integrated')}
                      className={`px-2 py-0.5 text-xs rounded transition-all ${
                        selectedApi === 'rag-integrated'
                          ? 'bg-white text-blue-600 shadow-sm font-medium'
                          : 'text-gray-600 hover:text-gray-800'
                      }`}
                    >
                      統合
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setSelectedAgentApi('agent-bedrock')}
                      className={`px-2 py-0.5 text-xs rounded transition-all ${
                        selectedAgentApi === 'agent-bedrock'
                          ? 'bg-white text-blue-600 shadow-sm font-medium'
                          : 'text-gray-600 hover:text-gray-800'
                      }`}
                    >
                      統合
                    </button>
                    <button
                      onClick={() => setSelectedAgentApi('agent-enhanced')}
                      className={`px-2 py-0.5 text-xs rounded transition-all ${
                        selectedAgentApi === 'agent-enhanced'
                          ? 'bg-white text-blue-600 shadow-sm font-medium'
                          : 'text-gray-600 hover:text-gray-800'
                      }`}
                    >
                      最適化
                    </button>
                    <button
                      onClick={() => setSelectedAgentApi('agent-autonomous')}
                      className={`px-2 py-0.5 text-xs rounded transition-all ${
                        selectedAgentApi === 'agent-autonomous'
                          ? 'bg-white text-blue-600 shadow-sm font-medium'
                          : 'text-gray-600 hover:text-gray-800'
                      }`}
                    >
                      最適化2
                    </button>
                  </>
                )}
                </div>
              </div>
            )}
            
            {/* モデル選択 - RAGとエージェント両方で表示、Direct S3では非表示 */}
            {apiEndpoint !== '/api/direct-s3-chat' && (
              <div className="flex items-center space-x-1">
                <span className="text-xs text-gray-600">モデル:</span>
                <div className="flex bg-gray-100 rounded p-0.5">
                  <button
                    onClick={() => setSelectedModel('sonnet35')}
                    className={`px-2 py-0.5 text-xs rounded transition-all ${
                      selectedModel === 'sonnet35'
                        ? 'bg-white text-blue-600 shadow-sm font-medium'
                        : 'text-gray-600 hover:text-gray-800'
                    }`}
                  >
                    3.5 Sonnet
                  </button>
                  <button
                    onClick={() => setSelectedModel('sonnet4')}
                    className={`px-2 py-0.5 text-xs rounded transition-all ${
                      selectedModel === 'sonnet4'
                        ? 'bg-white text-blue-600 shadow-sm font-medium'
                        : 'text-gray-600 hover:text-gray-800'
                    }`}
                  >
                    4 Sonnet
                  </button>
                </div>
              </div>
            )}
            
            {/* Direct S3モード表示 */}
            {apiEndpoint === '/api/direct-s3-chat' && (
              <div className="flex items-center space-x-1">
                <span className="text-xs text-gray-600">モード:</span>
                <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded font-medium">
                  Direct S3 (Claude 4)
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* メッセージエリア（固定高さ） */}
      <div className="flex-1 overflow-y-auto px-4 py-3" style={{ maxHeight: 'calc(100vh - 140px)' }}>
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-gray-500 text-sm">
                {isAgentChat ? 'Web検索で質問に答えます' : 'ドキュメントについて質問してください'}
              </p>
            </div>
          </div>
        )}

        {messages.map((message) => (
          <div key={message.id} className="mb-4">
            <div className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] ${message.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div className={`px-3 py-2 rounded-lg ${
                  message.role === 'user'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-50 border border-gray-200'
                }`}>
                  {message.role === 'assistant' ? (
                    <div className="prose prose-sm max-w-none markdown-content text-sm">
                      <MarkdownRenderer 
                        content={message.content}
                        sources={message.sources}
                        onCitationClick={(index) => {
                          console.log('Citation clicked:', { index, sourcesLength: message.sources?.length, sources: message.sources });
                          if (onSourceClick && message.sources) {
                            onSourceClick(message.sources, index);
                          }
                        }}
                      />
                    </div>
                  ) : (
                    <div className="text-sm">{message.content}</div>
                  )}
                </div>
                
                {/* 処理の詳細表示 */}
                {message.role === 'assistant' && message.processLog && message.processLog.length > 0 && (
                  <ProcessDetails processLog={message.processLog} className="mt-2" />
                )}
                
                <div className={`text-xs text-gray-400 mt-1 ${
                  message.role === 'user' ? 'text-right' : 'text-left'
                }`}>
                  {formatTime(message.timestamp)}
                </div>
              </div>
            </div>
          </div>
        ))}

        {isLoading && isAgentChat && (
          <RealTimeSearchDisplay 
            searchResult={currentSearchResult}
            isSearching={true}
            searchQuery={currentSearchQuery}
          />
        )}
        
        {isLoading && !isAgentChat && (
          <div className="flex justify-start mb-4">
            <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <div className="flex items-center space-x-1">
                <div className="flex space-x-1">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-pulse"></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 入力エリア */}
      <div className="px-4 py-3 border-t border-gray-100 flex-shrink-0">
        <form onSubmit={handleSubmit}>
          <div className="flex items-end space-x-2">
            <div className="flex-1">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyPress}
                placeholder={placeholder}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                rows={1}
                disabled={isLoading}
              />
            </div>
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="px-4 py-2 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              送信
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}