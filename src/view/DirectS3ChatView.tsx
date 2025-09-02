'use client';

import { useState } from 'react';
import { FileUpload } from '@/components/FileUpload';
import CompactChatInterface from '@/components/CompactChatInterface';
import { FileListWithSelection } from '@/components/FileListWithSelection';
import { SourcePanel } from '@/components/SourcePanel';
import NavigationHeader from '@/components/NavigationHeader';

interface FileItem {
  key: string;
  name: string;
  size: number;
  uploadedAt: string;
  syncStatus: string;
}

interface Source {
  content?: string;
  location?: any;
  uri?: string;
  score?: number;
  type?: 'knowledge_base' | 'web_search' | 'direct_s3';
  title?: string;
  citationNumber?: number;
  metadata?: any;
}

export default function DirectS3ChatView() {
  const [showSources, setShowSources] = useState(false);
  const [currentSources, setCurrentSources] = useState<Source[]>([]);
  const [selectedSourceIndex, setSelectedSourceIndex] = useState<number | null>(null);
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);

  const handleSourceClick = (sources: Source[], index: number) => {
    setCurrentSources(sources);
    setSelectedSourceIndex(index);
    setShowSources(true);
  };

  const handleFileSelect = (file: FileItem | null) => {
    setSelectedFile(file);
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
                  <p className="text-sm text-gray-600 mt-1">
                    Direct S3モード: ファイルを選択して直接対話
                  </p>
                </div>
                <div className="flex-1 overflow-y-auto px-6 py-4">
                  <FileUpload />
                  <FileListWithSelection 
                    onFileSelect={handleFileSelect}
                    selectedFile={selectedFile}
                  />
                  
                  {selectedFile && (
                    <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                      <p className="text-sm font-medium text-green-800 mb-2">
                        Direct S3モード準備完了
                      </p>
                      <p className="text-xs text-green-700">
                        選択されたファイル「{selectedFile.name}」の内容を直接読み込んで対話します。
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* メインエリア - チャット */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow-sm h-[calc(100vh-120px)]">
              {selectedFile ? (
                <CompactChatInterface 
                  onSourceClick={handleSourceClick}
                  apiEndpoint="/api/direct-s3-chat"
                  placeholder={`${selectedFile.name}について質問してください...`}
                  selectedFile={selectedFile}
                />
              ) : (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center">
                    <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    <h3 className="mt-2 text-sm font-medium text-gray-900">ファイルが選択されていません</h3>
                    <p className="mt-1 text-sm text-gray-500">
                      左のリストからファイルを選択してチャットを開始してください
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}