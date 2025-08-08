'use client';

import { useState, useRef, useEffect } from 'react';
import RealTimeSearchDisplay from './RealTimeSearchDisplay';
import { SearchResult } from '@/types/agent';

// メッセージ内の引用番号をリンクに変換するコンポーネント
function MessageWithCitations({ 
  content, 
  sources, 
  onCitationClick 
}: { 
  content: string; 
  sources: Source[];
  onCitationClick: (index: number) => void;
}) {
  // [1], [2]などのパターンをリンクに置換
  const parts = content.split(/(\[\d+\])/g);
  
  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(/\[(\d+)\]/);
        if (match) {
          const index = parseInt(match[1]) - 1;
          if (index >= 0 && index < sources.length) {
            return (
              <button
                key={i}
                onClick={() => onCitationClick(index)}
                className="inline-flex items-center justify-center px-1 py-0.5 mx-0.5 text-xs font-medium text-blue-600 bg-blue-100 rounded hover:bg-blue-200 transition-colors"
              >
                [{index + 1}]
              </button>
            );
          }
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

interface Source {
  content?: string;
  location?: any;
  uri?: string;
  score?: number;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  sources?: Source[];
  searchedUrls?: string[];
  searchResult?: SearchResult;
}

interface ChatInterfaceProps {
  onSourceClick?: (sources: Source[], index: number) => void;
  onSourcesUpdate?: (sources: Source[]) => void;
  apiEndpoint?: string;
  placeholder?: string;
  isAgentChat?: boolean; // agentチャットかどうかを判定
}

export default function ChatInterface({ onSourceClick, onSourcesUpdate, apiEndpoint = '/api/chat', placeholder = 'メッセージを入力...', isAgentChat = false }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState<'sonnet' | 'haiku'>('sonnet');
  const [currentSearchQuery, setCurrentSearchQuery] = useState<string>('');
  const [currentSearchResult, setCurrentSearchResult] = useState<SearchResult | undefined>(undefined);
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
    setCurrentSearchQuery(userMessage.content);
    setCurrentSearchResult(undefined);
    
    // Agentチャットの場合、すぐに検索開始をシミュレート
    if (isAgentChat) {
      // 1秒後に検索開始をシミュレート
      setTimeout(() => {
        setCurrentSearchResult({
          type: 'search_results',
          query: userMessage.content,
          search_performed: true,
          urls: [],
          sources: []
        } as SearchResult);
      }, 1000);
    }

    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: userMessage.content,
          model: selectedModel,
          sessionId: localStorage.getItem('sessionId') || undefined,
        }),
      });

      const data = await response.json();

      if (data.error) {
        // エラーレスポンスの処理
        if (data.isRateLimit) {
          // レート制限の場合はアラート表示
          alert(data.userMessage);
        }
        
        const errorMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: data.userMessage || 'エラーが発生しました。もう一度お試しください。',
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, errorMessage]);
      } else {
        // 正常レスポンスの処理
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: data.response,
          timestamp: new Date(),
          sources: data.sources,
          searchedUrls: data.searchedUrls,
          searchResult: data.searchResult,
        };
        setMessages(prev => [...prev, assistantMessage]);
        
        // 検索結果を更新
        if (data.searchResult) {
          // URLを順番に表示するための処理
          const fullResult = data.searchResult;
          if (fullResult.urls && fullResult.urls.length > 0) {
            // まず空の結果を設定
            const emptyResult = {
              ...fullResult,
              urls: [],
              sources: []
            };
            setCurrentSearchResult(emptyResult);
            
            // URLを順番に追加
            fullResult.urls.forEach((url: string, index: number) => {
              setTimeout(() => {
                setCurrentSearchResult(prev => {
                  if (!prev) return prev;
                  const updatedUrls = [...(prev.urls || []), url];
                  const updatedSources = fullResult.sources?.slice(0, index + 1) || [];
                  return {
                    ...prev,
                    urls: updatedUrls,
                    sources: updatedSources
                  };
                });
              }, index * 300); // 0.3秒間隔でURLを追加
            });
          } else {
            setCurrentSearchResult(fullResult);
          }
        }
        
        // セッションIDを保存
        if (data.sessionId) {
          localStorage.setItem('sessionId', data.sessionId);
        }
        
        // ソース情報を親コンポーネントに通知
        if (onSourcesUpdate && data.sources) {
          onSourcesUpdate(data.sources);
        }
      }
    } catch (error) {
      console.error('Chat error:', error);
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
      handleSubmit(e);
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex flex-col h-full bg-white shadow-lg">
      {/* チャットヘッダー */}
      <div className="px-6 py-4 border-b border-gray-100">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-medium text-gray-900">AI アシスタント</h3>
            <p className="text-xs text-gray-500">ドキュメントについて質問できます</p>
          </div>
        </div>
        
        {/* モデル選択 */}
        <div className="flex items-center space-x-2 mt-3">
          <span className="text-xs text-gray-600">モデル:</span>
          <div className="flex bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setSelectedModel('sonnet')}
              className={`px-3 py-1 text-xs rounded-md transition-all ${
                selectedModel === 'sonnet'
                  ? 'bg-white text-blue-600 shadow-sm font-medium'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              Claude 3.5 Sonnet
            </button>
            <button
              onClick={() => setSelectedModel('haiku')}
              className={`px-3 py-1 text-xs rounded-md transition-all ${
                selectedModel === 'haiku'
                  ? 'bg-white text-blue-600 shadow-sm font-medium'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              Claude 3 Haiku
            </button>
          </div>
        </div>
      </div>

      {/* メッセージエリア */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-sm">
              <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center">
                <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <p className="text-gray-600 text-sm leading-relaxed">
                アップロードしたドキュメントについて<br />
                何でも質問してください
              </p>
            </div>
          </div>
        )}

        {messages.map((message) => (
          <div key={message.id} className="group">
            <div className={`flex items-end space-x-3 ${message.role === 'user' ? 'flex-row-reverse space-x-reverse' : ''}`}>
              {/* アバター */}
              <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${
                message.role === 'user' 
                  ? 'bg-blue-500 text-white' 
                  : 'bg-gray-100 text-gray-600'
              }`}>
                {message.role === 'user' ? 'あ' : 'AI'}
              </div>
              
              {/* メッセージバブル */}
              <div className={`max-w-[75%] ${message.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div className={`relative px-4 py-3 rounded-2xl ${
                  message.role === 'user'
                    ? 'bg-blue-500 text-white rounded-br-md'
                    : 'bg-gray-50 text-gray-900 border border-gray-100 rounded-bl-md'
                }`}>
                  <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                    {message.role === 'assistant' && message.sources ? (
                      <MessageWithCitations 
                        content={message.content} 
                        sources={message.sources}
                        onCitationClick={(index) => {
                          if (onSourceClick && message.sources) {
                            onSourceClick(message.sources, index);
                          }
                        }}
                      />
                    ) : (
                      message.content
                    )}
                  </div>
                  
                </div>
                
                {/* Web検索URLの表示 */}
                {message.role === 'assistant' && message.searchedUrls && message.searchedUrls.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <div className="text-xs text-gray-600 mb-2">🔍 Web検索先：</div>
                    <div className="space-y-1">
                      {message.searchedUrls.map((url, index) => {
                        const domain = new URL(url).hostname.replace('www.', '');
                        return (
                          <a
                            key={index}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center text-xs text-blue-600 hover:text-blue-800 hover:underline"
                          >
                            <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                            {domain}
                          </a>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className={`mt-1 px-1 text-xs text-gray-400 ${message.role === 'user' ? 'text-right' : 'text-left'}`}>
                  {formatTime(message.timestamp)}
                </div>
              </div>
            </div>
          </div>
        ))}

        {/* Agentチャットの場合は常にWeb検索ローディングを表示 */}
        {isLoading && isAgentChat && (
          <RealTimeSearchDisplay 
            searchResult={currentSearchResult}
            isSearching={true}
            searchQuery={currentSearchQuery}
          />
        )}
        
        {/* RAGチャットの場合のみ「考え中」を表示 */}
        {isLoading && !isAgentChat && (
          <div className="group">
            <div className="flex items-end space-x-3">
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center text-xs font-medium">
                AI
              </div>
              <div className="bg-gray-50 border border-gray-100 rounded-2xl rounded-bl-md px-4 py-3">
                <div className="flex items-center space-x-1">
                  <div className="flex space-x-1">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-pulse"></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
                  </div>
                  <span className="text-xs text-gray-500 ml-2">考え中</span>
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 入力エリア */}
      <div className="px-6 py-4 border-t border-gray-100">
        <form onSubmit={handleSubmit}>
          <div className="flex items-end space-x-3">
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder={placeholder}
                className="w-full resize-none rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 pr-12 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                rows={1}
                disabled={isLoading}
                style={{ maxHeight: '120px' }}
              />
              <div className="absolute bottom-3 right-3">
                <button
                  type="submit"
                  disabled={!input.trim() || isLoading}
                  className="w-7 h-7 bg-blue-500 text-white rounded-full flex items-center justify-center hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 disabled:hover:bg-blue-500"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}