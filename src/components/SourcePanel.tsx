'use client';

interface Source {
  content?: string;
  location?: any;
  uri?: string;
  score?: number;
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
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-sm font-medium">
                  {index + 1}
                </span>
                <h3 className="text-sm font-medium text-gray-900">
                  {source.uri ? source.uri.split('/').pop() || 'ファイル名不明' : 'ソース情報なし'}
                </h3>
              </div>
              {source.score && (
                <span className="text-xs text-gray-500">
                  スコア: {source.score.toFixed(3)}
                </span>
              )}
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