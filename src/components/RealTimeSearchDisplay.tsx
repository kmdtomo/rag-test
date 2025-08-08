'use client';

import React, { useEffect, useState } from 'react';
import { SearchResult } from '@/types/agent';

interface RealTimeSearchDisplayProps {
  searchResult?: SearchResult;
  isSearching: boolean;
  searchQuery?: string;
}

export const RealTimeSearchDisplay: React.FC<RealTimeSearchDisplayProps> = ({ 
  searchResult, 
  isSearching,
  searchQuery
}) => {
  const [animatedUrls, setAnimatedUrls] = useState<string[]>([]);
  const [currentUrlIndex, setCurrentUrlIndex] = useState(0);

  // URLを順番にアニメーション表示
  useEffect(() => {
    if (searchResult?.urls && searchResult.urls.length > 0) {
      const interval = setInterval(() => {
        setCurrentUrlIndex((prev) => {
          if (prev < searchResult.urls!.length - 1) {
            return prev + 1;
          }
          clearInterval(interval);
          return prev;
        });
      }, 300); // 0.3秒ごとに次のURLを表示

      return () => clearInterval(interval);
    }
  }, [searchResult?.urls]);

  // アニメーション用のURLリストを更新
  useEffect(() => {
    if (searchResult?.urls && currentUrlIndex >= 0) {
      setAnimatedUrls(searchResult.urls.slice(0, currentUrlIndex + 1));
    }
  }, [currentUrlIndex, searchResult?.urls]);

  // 検索実行中の表示（Agentチャット用）
  if (isSearching) {
    // 検索結果がある場合も検索中表示を継続
    const hasUrls = searchResult?.urls && searchResult.urls.length > 0;
    
    return (
      <div className="mb-4 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
        <div className="flex items-center gap-3 mb-3">
          <div className="relative">
            <div className="w-5 h-5 border-3 border-blue-500 rounded-full animate-spin border-t-transparent" />
            <div className="absolute inset-0 w-5 h-5 border-3 border-blue-300 rounded-full animate-ping opacity-20" />
          </div>
          <div>
            <span className="text-sm font-medium text-gray-800">🔍 Web検索を実行中</span>
            {searchQuery && (
              <p className="text-xs text-gray-600 mt-0.5">「{searchQuery.substring(0, 50)}」を検索しています...</p>
            )}
          </div>
        </div>
        
        {/* URLが取得されたらリアルタイム表示 */}
        {hasUrls ? (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-gray-600 mb-2">検索中のURL:</p>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {searchResult.urls!.map((url, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 animate-slideIn"
                  style={{
                    animationDelay: `${index * 0.1}s`,
                    opacity: 0,
                    animation: `slideIn 0.3s ease-out ${index * 0.1}s forwards`
                  }}
                >
                  <span className="text-xs text-gray-400 w-4">{index + 1}.</span>
                  <div className="flex items-center gap-1 flex-1">
                    <svg className="w-3 h-3 text-blue-500 flex-shrink-0 animate-pulse" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 hover:text-blue-800 truncate"
                      title={url}
                    >
                      {new URL(url).hostname}
                    </a>
                    {searchResult.sources && searchResult.sources[index] && (
                      <span className="text-xs text-gray-500 ml-2 truncate max-w-[200px]">
                        - {searchResult.sources[index].title}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* 検索中のアニメーション */
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
              <div className="h-2 bg-gray-200 rounded animate-pulse flex-1 max-w-xs" />
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse delay-75" />
              <div className="h-2 bg-gray-200 rounded animate-pulse flex-1 max-w-sm delay-75" />
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse delay-150" />
              <div className="h-2 bg-gray-200 rounded animate-pulse flex-1 max-w-md delay-150" />
            </div>
          </div>
        )}
      </div>
    );
  }

  // 検索完了後の結果表示
  if (!isSearching && searchResult && searchResult.search_performed && animatedUrls.length > 0) {
    return (
      <div className="mb-4 p-4 bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg border border-green-200">
        <div className="flex items-center gap-2 mb-3">
          <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-sm font-medium text-gray-800">
            Web検索完了
          </span>
          {searchResult.processing_time && (
            <span className="text-xs text-gray-500">
              ({searchResult.processing_time.toFixed(1)}秒)
            </span>
          )}
        </div>

        {/* URLリストのアニメーション表示 */}
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-gray-600 mb-2">検索したURL:</p>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {animatedUrls.map((url, index) => (
              <div
                key={index}
                className="flex items-center gap-2 animate-slideIn"
                style={{
                  animationDelay: `${index * 0.1}s`,
                  opacity: 0,
                  animation: `slideIn 0.3s ease-out ${index * 0.1}s forwards`
                }}
              >
                <span className="text-xs text-gray-400 w-4">{index + 1}.</span>
                <div className="flex items-center gap-1 flex-1">
                  <svg className="w-3 h-3 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:text-blue-800 truncate"
                    title={url}
                  >
                    {new URL(url).hostname}
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ソース詳細 */}
        {searchResult.sources && searchResult.sources.length > 0 && (
          <div className="mt-3 pt-3 border-t border-green-200">
            <details className="group">
              <summary className="cursor-pointer text-xs font-medium text-gray-600 hover:text-gray-800 transition-colors">
                詳細情報を表示 ({searchResult.sources.length}件)
              </summary>
              <div className="mt-2 space-y-2">
                {searchResult.sources.map((source, index) => (
                  <div key={source.id} className="p-2 bg-white rounded border border-gray-200">
                    <div className="flex items-start gap-2">
                      <span className="text-xs text-gray-400 mt-0.5">{index + 1}.</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-800 truncate">{source.title}</p>
                        <p className="text-xs text-gray-600 line-clamp-2 mt-1">{source.snippet}</p>
                        {source.relevance_score && (
                          <div className="flex items-center gap-1 mt-1">
                            <span className="text-xs text-gray-500">関連度:</span>
                            <div className="flex-1 max-w-[100px] h-1.5 bg-gray-200 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-gradient-to-r from-green-400 to-green-600 rounded-full transition-all duration-500"
                                style={{ width: `${source.relevance_score * 100}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-500">{(source.relevance_score * 100).toFixed(0)}%</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}
      </div>
    );
  }

  return null;
};

export default RealTimeSearchDisplay;