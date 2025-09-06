'use client';

import { useState } from 'react';
import { FileUpload } from '@/components/FileUpload';
import CompactChatInterface from '@/components/CompactChatInterface';
import { FileListWithSelection } from '@/components/FileListWithSelection';
import { SourcePanel } from '@/components/SourcePanel';
import NavigationHeader from '@/components/NavigationHeader';

interface Source {
  content?: string;
  location?: any;
  uri?: string;
  score?: number;
}

export default function RagChatView() {
  const [showSources, setShowSources] = useState(false);
  const [currentSources, setCurrentSources] = useState<Source[]>([]);
  const [selectedSourceIndex, setSelectedSourceIndex] = useState<number | null>(null);
  const [selectedFile, setSelectedFile] = useState<{key: string; name: string} | null>(null);

  const handleSourceClick = (sources: Source[], index: number) => {
    setCurrentSources(sources);
    setSelectedSourceIndex(index);
    setShowSources(true);
  };
  return (
    <div className="min-h-screen bg-gray-50">
      <NavigationHeader />
      <div className="container mx-auto px-4 py-8">
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-7xl mx-auto">
          {/* 左サイドバー - ファイル管理またはソース表示 */}
          <div className="lg:col-span-1">
            {showSources ? (
              <div className="bg-white rounded-lg shadow-sm h-[calc(100vh-120px)] overflow-hidden">
                <SourcePanel
                  sources={currentSources}
                  selectedSourceIndex={selectedSourceIndex}
                  onClose={() => {
                    setShowSources(false);
                    setSelectedSourceIndex(null);
                  }}
                />
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow-sm h-[calc(100vh-120px)] flex flex-col overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 flex-shrink-0">
                  <h2 className="text-lg font-semibold text-gray-900">
                    ドキュメント管理
                  </h2>
                </div>
                <div className="flex-1 overflow-y-auto px-6 py-4">
                  <FileUpload />
                  <div className="mt-6">
                    {selectedFile ? (
                      <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                        <div className="flex items-center">
                          <svg className="w-4 h-4 text-green-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span className="text-sm text-green-800">
                            選択中: {selectedFile.name}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <div className="flex items-center">
                          <svg className="w-4 h-4 text-blue-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span className="text-sm text-blue-800">
                            ファイルを選択するか、Knowledge Base全体を検索します
                          </span>
                        </div>
                      </div>
                    )}
                    <FileListWithSelection
                      onSelectionChange={setSelectedFile}
                      selectedFile={selectedFile}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* メインエリア - チャット */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow-sm h-[calc(100vh-120px)]">
              <CompactChatInterface
                title="RAGチャット（最適化版）"
                apiEndpoint="/api/rag-optimized"
                showSources={true}
                enableOptimizationToggle={true}
                enableWebSearch={false}
                onSourceClick={handleSourceClick}
                onSourcePanelToggle={() => setShowSources(!showSources)}
                sourceCount={currentSources.length}
                selectedFile={selectedFile}
                placeholder={selectedFile 
                  ? `${selectedFile.name} について質問してください...` 
                  : 'Knowledge Base全体を検索して質問に答えます...'}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}