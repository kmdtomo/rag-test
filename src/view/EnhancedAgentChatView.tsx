'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Search, Zap, Clock, Image, AlertCircle } from 'lucide-react';

interface SearchSource {
  title: string;
  uri?: string;
  content: string;
  type: 'web_search';
  score: number;
  query?: string;
}

interface EnhancedFeatures {
  queryDecomposition: boolean;
  adaptiveSearchDepth: boolean;
  temporalFiltering: boolean;
  aiSummaries: boolean;
  imageSearch: boolean;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  sources?: SearchSource[];
  processingTime?: number;
  apiCalls?: number;
  enhancedFeatures?: EnhancedFeatures;
  isLoading?: boolean;
  error?: boolean;
}

export default function EnhancedAgentChatView() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId] = useState(() => crypto.randomUUID());
  const [showComparison, setShowComparison] = useState(false);
  const [lastEnterTime, setLastEnterTime] = useState<number>(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async (useEnhanced: boolean = true) => {
    if (!input.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    const loadingMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: useEnhanced ? '強化版Web検索を実行中...' : '標準Web検索を実行中...',
      timestamp: new Date(),
      isLoading: true,
    };

    setMessages(prev => [...prev, loadingMessage]);

    try {
      const startTime = Date.now();
      const endpoint = useEnhanced ? '/api/agent-enhanced' : '/api/agent-direct';
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: input,
          sessionId: sessionId,
        }),
      });

      const data = await response.json();
      const endTime = Date.now();

      if (data.error) {
        throw new Error(data.userMessage || data.message);
      }

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.response,
        timestamp: new Date(),
        sources: data.sources,
        processingTime: data.processingTime || (endTime - startTime),
        apiCalls: data.apiCalls,
        enhancedFeatures: data.enhancedFeatures,
      };

      setMessages(prev => prev.slice(0, -1).concat(assistantMessage));
    } catch (error: any) {
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `エラーが発生しました: ${error.message}`,
        timestamp: new Date(),
        error: true,
      };

      setMessages(prev => prev.slice(0, -1).concat(errorMessage));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      
      const currentTime = Date.now();
      const timeSinceLastEnter = currentTime - lastEnterTime;
      
      // 500ms以内に2回目のEnterが押された場合に送信
      if (timeSinceLastEnter < 500 && timeSinceLastEnter > 0) {
        sendMessage(true);
        setLastEnterTime(0); // リセット
      } else {
        setLastEnterTime(currentTime);
      }
    }
  };

  const formatProcessingTime = (ms?: number) => {
    if (!ms) return '';
    const seconds = (ms / 1000).toFixed(1);
    return `${seconds}秒`;
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* ヘッダー */}
      <div className="bg-white border-b p-4">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Zap className="w-6 h-6 text-yellow-500" />
            強化版Web検索エージェント
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Tavilyの全機能を活用した高度な検索システム
          </p>
          
          {/* 比較モードトグル */}
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => setShowComparison(!showComparison)}
              className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200"
            >
              {showComparison ? '比較モードOFF' : '比較モードON'}
            </button>
          </div>
        </div>
      </div>

      {/* メッセージエリア */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-4xl mx-auto space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-12">
              <Search className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h2 className="text-xl font-medium text-gray-600 mb-2">
                強化版検索の特徴
              </h2>
              <div className="text-sm text-gray-500 space-y-1">
                <p>✨ クエリを3つに自動分解</p>
                <p>🎯 search_depthを最適化（advanced/basic）</p>
                <p>📅 時間軸の自動判定（最新情報フィルタ）</p>
                <p>🤖 TavilyのAI要約を活用</p>
                <p>⚡ 並列処理で高速検索</p>
              </div>
            </div>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${
                message.role === 'user' ? 'justify-end' : 'justify-start'
              }`}
            >
              <div
                className={`max-w-3xl ${
                  message.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : message.error
                    ? 'bg-red-50 border border-red-200'
                    : 'bg-white'
                } rounded-lg p-4 shadow-sm`}
              >
                {message.isLoading ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{message.content}</span>
                  </div>
                ) : (
                  <>
                    <div className="whitespace-pre-wrap">{message.content}</div>
                    
                    {/* メタデータ表示 */}
                    {message.role === 'assistant' && !message.error && (
                      <div className="mt-4 pt-4 border-t border-gray-200">
                        {/* 処理情報 */}
                        <div className="flex gap-4 text-xs text-gray-500">
                          {message.processingTime && (
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {formatProcessingTime(message.processingTime)}
                            </span>
                          )}
                          {message.apiCalls && (
                            <span>API呼び出し: {message.apiCalls}回</span>
                          )}
                        </div>

                        {/* 強化機能の表示 */}
                        {message.enhancedFeatures && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {message.enhancedFeatures.queryDecomposition && (
                              <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded">
                                クエリ分解
                              </span>
                            )}
                            {message.enhancedFeatures.adaptiveSearchDepth && (
                              <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded">
                                適応型検索深度
                              </span>
                            )}
                            {message.enhancedFeatures.temporalFiltering && (
                              <span className="px-2 py-1 bg-purple-100 text-purple-700 text-xs rounded">
                                時間フィルタ
                              </span>
                            )}
                            {message.enhancedFeatures.aiSummaries && (
                              <span className="px-2 py-1 bg-yellow-100 text-yellow-700 text-xs rounded">
                                AI要約
                              </span>
                            )}
                            {message.enhancedFeatures.imageSearch && (
                              <span className="px-2 py-1 bg-pink-100 text-pink-700 text-xs rounded flex items-center gap-1">
                                {/* eslint-disable-next-line jsx-a11y/alt-text */}
                                <Image className="w-3 h-3" />
                                画像
                              </span>
                            )}
                          </div>
                        )}

                        {/* ソース表示 */}
                        {message.sources && message.sources.length > 0 && (
                          <div className="mt-3">
                            <p className="text-xs font-medium text-gray-600 mb-2">
                              情報源 ({message.sources.length}件):
                            </p>
                            <div className="space-y-2 max-h-40 overflow-y-auto">
                              {message.sources.map((source, idx) => (
                                <div
                                  key={idx}
                                  className="text-xs bg-gray-50 p-2 rounded border border-gray-200"
                                >
                                  <div className="flex justify-between items-start">
                                    <a
                                      href={source.uri}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="font-medium text-blue-600 hover:underline flex-1"
                                    >
                                      {source.title}
                                    </a>
                                    <span className="text-gray-400 ml-2">
                                      {(source.score * 100).toFixed(0)}%
                                    </span>
                                  </div>
                                  {source.query && (
                                    <div className="text-gray-500 mt-1">
                                      検索: {source.query}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* 入力エリア */}
      <div className="bg-white border-t p-4">
        <div className="max-w-4xl mx-auto">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="質問を入力してください（Enter2回で送信）"
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              onKeyDown={handleKeyDown}
              disabled={isLoading}
            />
            
            {showComparison ? (
              <>
                <button
                  type="button"
                  onClick={() => sendMessage(false)}
                  disabled={!input.trim() || isLoading}
                  className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  標準版
                </button>
                <button
                  type="submit"
                  disabled={!input.trim() || isLoading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <Zap className="w-4 h-4" />
                  強化版
                </button>
              </>
            ) : (
              <button
                type="submit"
                disabled={!input.trim() || isLoading}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                送信
              </button>
            )}
          </form>
          
          {/* ヒント */}
          <div className="mt-2 text-xs text-gray-500">
            <AlertCircle className="w-3 h-3 inline mr-1" />
            試してみてください: 「2025年のプレミアリーグ移籍情報」「最新のAI技術動向」「今週のビットコイン価格」
          </div>
        </div>
      </div>
    </div>
  );
}