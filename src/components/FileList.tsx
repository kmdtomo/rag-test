'use client';

import { useState, useEffect } from 'react';

interface FileItem {
  key: string;
  name: string;
  size: number;
  uploadedAt: string;
  syncStatus: string;
}

export function FileList() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchFiles = async () => {
    try {
      const response = await fetch('/api/files');
      const data = await response.json();
      setFiles(data.files || []);
    } catch (error) {
      console.error('Error fetching files:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles();

    const handleFileUploaded = () => {
      fetchFiles();
    };

    window.addEventListener('fileUploaded', handleFileUploaded);
    return () => {
      window.removeEventListener('fileUploaded', handleFileUploaded);
    };
  }, []);

  const handleDelete = async (fileKey: string) => {
    if (!confirm('このファイルを削除しますか？')) return;

    try {
      const response = await fetch(`/api/files?key=${encodeURIComponent(fileKey)}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        fetchFiles();
      }
    } catch (error) {
      console.error('Error deleting file:', error);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('ja-JP') + ' ' + date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  };

  if (loading) {
    return (
      <div className="mt-4 space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-gray-100 rounded-lg p-3 animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
            <div className="h-3 bg-gray-200 rounded w-1/2"></div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-2">アップロード済みファイル</h3>
      
      {files.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-4">
          ファイルがありません
        </p>
      ) : (
        <div className="space-y-2">
          {files.map((file) => (
            <div
              key={file.key}
              className="bg-gray-50 rounded-lg p-3 hover:bg-gray-100 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {file.name}
                  </p>
                  <p className="text-xs text-gray-500">
                    {formatFileSize(file.size)} • {formatDate(file.uploadedAt)}
                  </p>
                  <div className="flex items-center mt-1">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        file.syncStatus === 'completed'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-yellow-100 text-yellow-800'
                      }`}
                    >
                      {file.syncStatus === 'completed' ? '同期済み' : '処理中'}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(file.key)}
                  className="ml-2 text-red-600 hover:text-red-800"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}