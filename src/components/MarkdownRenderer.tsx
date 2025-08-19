'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import React from 'react';

interface MarkdownRendererProps {
  content: string;
  sources?: any[];
  onCitationClick?: (index: number) => void;
}

export default function MarkdownRenderer({ 
  content, 
  sources = [], 
  onCitationClick 
}: MarkdownRendererProps) {
  
  // 引用番号を処理する関数
  const processTextWithCitations = (text: any): any => {
    if (typeof text === 'string') {
      // [1], [2]などのパターンを検索して置換
      const parts = text.split(/(\[\d+\])/g);
      return parts.map((part, i) => {
        const match = part.match(/\[(\d+)\]/);
        if (match && sources.length > 0) {
          const citationNum = parseInt(match[1]);
          // citationNumber で対応するソースを探す
          const sourceIndex = sources.findIndex(s => s.citationNumber === citationNum);
          if (sourceIndex >= 0) {
            return (
              <button
                key={`citation-${i}`}
                onClick={() => {
                  console.log('MarkdownRenderer citation click:', { citationNum, sourceIndex, sources: sources.length });
                  if (onCitationClick) {
                    onCitationClick(sourceIndex);
                  }
                }}
                className="inline-flex items-center justify-center px-1 py-0.5 mx-0.5 text-xs font-medium text-blue-600 bg-blue-100 rounded hover:bg-blue-200 transition-colors"
              >
                [{citationNum}]
              </button>
            );
          }
          // フォールバック: citationNumber がない場合は従来の方法
          const index = citationNum - 1;
          if (index >= 0 && index < sources.length) {
            return (
              <button
                key={`citation-${i}`}
                onClick={() => {
                  console.log('MarkdownRenderer fallback citation click:', { citationNum, index, sources: sources.length });
                  if (onCitationClick) {
                    onCitationClick(index);
                  }
                }}
                className="inline-flex items-center justify-center px-1 py-0.5 mx-0.5 text-xs font-medium text-blue-600 bg-blue-100 rounded hover:bg-blue-200 transition-colors"
              >
                [{citationNum}]
              </button>
            );
          }
        }
        return part;
      });
    }
    if (Array.isArray(text)) {
      return text.map((item, idx) => (
        <React.Fragment key={idx}>{processTextWithCitations(item)}</React.Fragment>
      ));
    }
    if (React.isValidElement(text)) {
      return text;
    }
    return text;
  };

  // 全てのコンポーネントで引用番号を処理
  const componentsWithCitations = {
    h1: ({children}: any) => (
      <h1 className="text-xl font-bold mt-4 mb-2 text-gray-900">
        {processTextWithCitations(children)}
      </h1>
    ),
    h2: ({children}: any) => (
      <h2 className="text-lg font-semibold mt-3 mb-2 text-gray-800">
        {processTextWithCitations(children)}
      </h2>
    ),
    h3: ({children}: any) => (
      <h3 className="text-base font-semibold mt-2 mb-1 text-gray-700">
        {processTextWithCitations(children)}
      </h3>
    ),
    h4: ({children}: any) => (
      <h4 className="text-sm font-semibold mt-2 mb-1 text-gray-700">
        {processTextWithCitations(children)}
      </h4>
    ),
    p: ({children}: any) => (
      <p className="my-2 leading-relaxed">
        {processTextWithCitations(children)}
      </p>
    ),
    ul: ({children}: any) => (
      <ul className="list-disc list-inside my-2 space-y-1 ml-2">
        {children}
      </ul>
    ),
    ol: ({children}: any) => (
      <ol className="list-decimal list-inside my-2 space-y-1 ml-2">
        {children}
      </ol>
    ),
    li: ({children}: any) => (
      <li className="ml-2">
        {processTextWithCitations(children)}
      </li>
    ),
    code: ({inline, className, children}: any) => {
      const language = className?.replace('language-', '') || '';
      return inline ? (
        <code className="bg-gray-100 px-1 py-0.5 rounded text-sm font-mono text-red-600">
          {children}
        </code>
      ) : (
        <code className="block bg-gray-900 text-gray-100 p-3 rounded-lg overflow-x-auto font-mono text-sm my-2">
          {children}
        </code>
      );
    },
    pre: ({children}: any) => (
      <pre className="my-2 overflow-x-auto">{children}</pre>
    ),
    blockquote: ({children}: any) => (
      <blockquote className="border-l-4 border-blue-400 pl-4 my-3 bg-blue-50 py-2 rounded-r">
        {processTextWithCitations(children)}
      </blockquote>
    ),
    strong: ({children}: any) => (
      <strong className="font-semibold">
        {processTextWithCitations(children)}
      </strong>
    ),
    em: ({children}: any) => (
      <em className="italic">
        {processTextWithCitations(children)}
      </em>
    ),
    a: ({href, children}: any) => (
      <a 
        href={href} 
        target="_blank" 
        rel="noopener noreferrer" 
        className="text-blue-600 hover:text-blue-800 underline"
      >
        {children}
      </a>
    ),
    table: ({children}: any) => (
      <div className="overflow-x-auto my-3">
        <table className="min-w-full border-collapse border border-gray-300">
          {children}
        </table>
      </div>
    ),
    thead: ({children}: any) => (
      <thead className="bg-gray-50">{children}</thead>
    ),
    tbody: ({children}: any) => <tbody>{children}</tbody>,
    tr: ({children}: any) => (
      <tr className="border-b border-gray-300">{children}</tr>
    ),
    th: ({children}: any) => (
      <th className="border border-gray-300 px-3 py-2 text-left font-semibold">
        {processTextWithCitations(children)}
      </th>
    ),
    td: ({children}: any) => (
      <td className="border border-gray-300 px-3 py-2">
        {processTextWithCitations(children)}
      </td>
    ),
    hr: () => <hr className="my-4 border-gray-300" />
  };

  return (
    <ReactMarkdown 
      remarkPlugins={[remarkGfm]}
      components={componentsWithCitations}
    >
      {content}
    </ReactMarkdown>
  );
}