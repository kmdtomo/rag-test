'use client';

import { useEffect, useRef } from 'react';

interface Source {
  content?: string;
  location?: any;
  uri?: string;
  score?: number;
  type?: 'knowledge_base' | 'web_search' | 'direct_s3';
  title?: string;
  citationNumber?: number;
  pageNumber?: number;
  metadata?: any;
}

interface SourcePanelProps {
  sources: Source[];
  selectedSourceIndex: number | null;
  onClose: () => void;
}

export function SourcePanel({ sources, selectedSourceIndex, onClose }: SourcePanelProps) {
  const sourceRefs = useRef<(HTMLDivElement | null)[]>([]);
  
  // 選択されたソースにスクロール
  useEffect(() => {
    if (selectedSourceIndex !== null && sourceRefs.current[selectedSourceIndex]) {
      sourceRefs.current[selectedSourceIndex]?.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }
  }, [selectedSourceIndex]);
  return (
    <div className="h-full bg-white rounded-lg shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">ソースの詳細</h2>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="space-y-4 overflow-y-auto" style={{ height: 'calc(100vh - 250px)' }}>
        {sources.map((source, index) => (
          <div
            key={index}
            ref={el => { sourceRefs.current[index] = el; }}
            id={`source-${index}`}
            className={`border rounded-lg p-4 transition-all ${
              selectedSourceIndex === index 
                ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200' 
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center space-x-2">
                <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-sm font-medium ${
                  source.type === 'web_search' 
                    ? 'bg-green-100 text-green-600' 
                    : source.type === 'direct_s3'
                    ? 'bg-purple-100 text-purple-600'
                    : 'bg-blue-100 text-blue-600'
                }`}>
                  {source.citationNumber || index + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-medium text-gray-900 truncate">
                    {source.title || (source.uri ? source.uri.split('/').pop() || 'ファイル名不明' : 'ソース情報なし')}
                  </h3>
                  {source.pageNumber && (
                    <p className="text-xs text-gray-500">ページ: {source.pageNumber}</p>
                  )}
                  {source.uri && source.type === 'web_search' && (
                    <a 
                      href={source.uri} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 hover:text-blue-800 hover:underline block truncate"
                      title={source.uri}
                    >
                      {source.uri}
                    </a>
                  )}
                  {source.uri && source.type !== 'web_search' && (
                    <p className="text-xs text-gray-500 truncate" title={source.uri}>
                      {source.uri}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex-shrink-0 ml-2">
                {source.type && (
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    source.type === 'web_search' 
                      ? 'bg-green-50 text-green-700' 
                      : source.type === 'direct_s3'
                      ? 'bg-purple-50 text-purple-700'
                      : 'bg-blue-50 text-blue-700'
                  }`}>
                    {source.type === 'web_search' ? 'Web検索' : source.type === 'direct_s3' ? 'Direct S3' : 'ナレッジベース'}
                  </span>
                )}
              </div>
            </div>
            
            {source.content && (
              <div className="mt-3">
                <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap break-words">
                  {source.content.length > 500 ? (
                    <details className="group">
                      <summary className="cursor-pointer hover:text-gray-900 transition-colors">
                        {source.content.substring(0, 500)}...
                        <span className="text-blue-600 ml-1 group-open:hidden">続きを読む</span>
                        <span className="text-blue-600 ml-1 hidden group-open:inline">折りたたむ</span>
                      </summary>
                      <div className="mt-2">
                        {source.content.substring(500)}
                      </div>
                    </details>
                  ) : (
                    source.content
                  )}
                </div>
              </div>
            )}
            
            {source.score && (
              <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
                <span className="text-xs text-gray-500">関連度スコア</span>
                <div className="flex items-center gap-2">
                  <div className="flex-1 w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-blue-400 to-blue-600 rounded-full transition-all duration-500"
                      style={{ width: `${source.score * 100}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium text-gray-700">
                    {source.score.toFixed(3)}
                  </span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}