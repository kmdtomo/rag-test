'use client';

import { useState } from 'react';
import { FileUpload } from '@/components/FileUpload';
import CompactChatInterface from '@/components/CompactChatInterface';
import { FileList } from '@/components/FileList';
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
                    ドキュメントアップロード
                  </h2>
                </div>
                <div className="flex-1 overflow-y-auto px-6 py-4">
                  <FileUpload />
                  <FileList />
                </div>
              </div>
            )}
          </div>

          {/* メインエリア - チャット */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow-sm h-[calc(100vh-120px)]">
              <CompactChatInterface onSourceClick={handleSourceClick} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}