'use client';

interface Source {
  content?: string;
  location?: any;
  uri?: string;
  score?: number;
  type?: 'knowledge_base' | 'web_search';
  title?: string;
}

interface SourcePanelProps {
  sources: Source[];
  selectedSourceIndex: number | null;
  onClose: () => void;
}

export function SourcePanel({ sources, selectedSourceIndex, onClose }: SourcePanelProps) {
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

      <div className="space-y-4 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 200px)' }}>
        {sources.map((source, index) => (
          <div
            key={index}
            className={`border rounded-lg p-4 transition-all ${
              selectedSourceIndex === index 
                ? 'border-blue-500 bg-blue-50' 
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center space-x-2">
                <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-sm font-medium ${
                  source.type === 'web_search' 
                    ? 'bg-green-100 text-green-600' 
                    : 'bg-blue-100 text-blue-600'
                }`}>
                  {index + 1}
                </span>
                <div className="flex-1">
                  <h3 className="text-sm font-medium text-gray-900">
                    {source.title || (source.uri ? source.uri.split('/').pop() || 'ファイル名不明' : 'ソース情報なし')}
                  </h3>
                  {source.uri && source.type === 'web_search' && (
                    <a 
                      href={source.uri} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {source.uri}
                    </a>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end space-y-1">
                {source.type && (
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    source.type === 'web_search' 
                      ? 'bg-green-50 text-green-700' 
                      : 'bg-blue-50 text-blue-700'
                  }`}>
                    {source.type === 'web_search' ? 'Web検索' : 'ナレッジベース'}
                  </span>
                )}
                {source.score && (
                  <span className="text-xs text-gray-500">
                    スコア: {source.score.toFixed(3)}
                  </span>
                )}
              </div>
            </div>
            
            {source.content && (
              <div className="mt-3">
                <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                  {source.content}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}