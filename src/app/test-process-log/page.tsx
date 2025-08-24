'use client';

import { useState } from 'react';
import ChatInterface from '@/components/ChatInterface';

export default function TestProcessLog() {
  return (
    <div className="h-screen flex flex-col">
      <div className="p-4 bg-gray-100">
        <h1 className="text-xl font-bold">Process Log Test - RAG Chat</h1>
        <p className="text-sm text-gray-600">RAG最適化版を選択してメッセージを送信してください</p>
      </div>
      <div className="flex-1">
        <ChatInterface 
          apiEndpoint="/api/rag-optimized"
          placeholder="RAGシステムに質問..."
          isAgentChat={false}
        />
      </div>
    </div>
  );
}