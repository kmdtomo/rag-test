'use client';

import React from 'react';
import { SearchResult } from '@/types/agent';

interface SearchProgressProps {
  searchResult?: SearchResult;
  isSearching: boolean;
}

export const SearchProgress: React.FC<SearchProgressProps> = ({ 
  searchResult, 
  isSearching 
}) => {
  // Web検索実行中の表示
  if (isSearching && !searchResult) {
    return (
      <div className="flex flex-col gap-2 p-4 bg-gray-50 rounded-lg animate-pulse">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-gray-600">Web検索を実行中...</span>
        </div>
      </div>
    );
  }

  // 検索結果がある場合のURL表示
  if (searchResult && searchResult.search_performed) {
    return (
      <div className="flex flex-col gap-3 p-4 bg-blue-50 rounded-lg">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <span className="text-sm font-medium text-blue-900">
            Web検索を実行しました
          </span>
          {searchResult.processing_time && (
            <span className="text-xs text-blue-600">
              ({searchResult.processing_time.toFixed(1)}秒)
            </span>
          )}
        </div>

        {/* URLリストの表示 */}
        {searchResult.urls && searchResult.urls.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-gray-600 font-medium">参照したURL:</p>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {searchResult.urls.map((url, index) => (
                <div key={index} className="flex items-start gap-2">
                  <span className="text-xs text-gray-400 mt-0.5">{index + 1}.</span>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:text-blue-800 truncate flex-1"
                    title={url}
                  >
                    {new URL(url).hostname}
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 検索結果のサマリー */}
        {searchResult.summary && (
          <div className="pt-2 border-t border-blue-200">
            <p className="text-xs text-gray-600 font-medium mb-1">検索結果の要約:</p>
            <p className="text-sm text-gray-800 line-clamp-3">
              {searchResult.summary}
            </p>
          </div>
        )}
      </div>
    );
  }

  // Web検索が不要だった場合
  if (searchResult && !searchResult.search_performed) {
    return (
      <div className="flex items-center gap-2 p-3 bg-green-50 rounded-lg">
        <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="text-sm text-green-800">
          Knowledge Baseの情報で回答しました
        </span>
      </div>
    );
  }

  return null;
};

export default SearchProgress;