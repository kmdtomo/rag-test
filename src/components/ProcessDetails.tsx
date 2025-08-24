'use client';

import React, { useState, useMemo } from 'react';

interface ProcessDetailsProps {
  processLog: string[];
  className?: string;
}

interface LogSection {
  title: string;
  icon: string;
  lines: string[];
  isHeader: boolean;
}

export function ProcessDetails({ processLog, className = '' }: ProcessDetailsProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  console.log('ProcessDetails received processLog:', processLog);
  
  // Process logs into sections for better visualization
  const sections = useMemo(() => {
    if (!processLog || processLog.length === 0) {
      return [];
    }
    const result: LogSection[] = [];
    let currentSection: LogSection | null = null;
    
    processLog.forEach((line) => {
      // Check if this is a header line (box drawing)
      if (line.includes('╔═') || line.includes('╚═')) {
        if (currentSection) {
          result.push(currentSection);
        }
        currentSection = {
          title: '',
          icon: '',
          lines: [line],
          isHeader: true
        };
      } else if (line.includes('║') && line.includes('🔍')) {
        if (currentSection) {
          currentSection.lines.push(line);
          // Extract title from header
          const match = line.match(/║\s*(.+?)\s*║/);
          if (match) {
            currentSection.title = match[1];
          }
        }
      } else if (line.includes('ステップ') || line.includes('Step')) {
        if (currentSection && !currentSection.isHeader) {
          result.push(currentSection);
        }
        const icon = line.includes('✅') ? '✅' : 
                     line.includes('🔍') ? '🔍' : 
                     line.includes('🔹') ? '🔹' : '📋';
        currentSection = {
          title: line.replace(/^\n/, ''),
          icon: icon,
          lines: [line],
          isHeader: false
        };
      } else if (currentSection) {
        currentSection.lines.push(line);
      } else {
        // Create a default section
        currentSection = {
          title: 'Process Log',
          icon: '📋',
          lines: [line],
          isHeader: false
        };
      }
    });
    
    if (currentSection) {
      result.push(currentSection);
    }
    
    return result;
  }, [processLog]);

  // Get preview sections
  const previewSections = sections.slice(0, 2);
  const hasMore = sections.length > 2;
  
  // Helper function to format log lines with color coding
  const formatLogLine = (line: string) => {
    // Color code different elements
    if (line.includes('╔═') || line.includes('╚═') || line.includes('║')) {
      return <span className="text-cyan-400 font-bold">{line}</span>;
    }
    if (line.includes('[') && line.includes('ms]')) {
      // Timing information
      const parts = line.match(/^\[(\d+ms)\]\s*(.*)$/);
      if (parts) {
        return (
          <>
            <span className="text-yellow-400">[{parts[1]}]</span>
            <span className="text-gray-300"> {parts[2]}</span>
          </>
        );
      }
    }
    if (line.includes('✅')) {
      return <span className="text-green-400">{line}</span>;
    }
    if (line.includes('❌') || line.includes('⚠️')) {
      return <span className="text-red-400">{line}</span>;
    }
    if (line.includes('🔍') || line.includes('🔹') || line.includes('📄')) {
      return <span className="text-blue-400">{line}</span>;
    }
    if (line.includes('⏱️') || line.includes('📋')) {
      return <span className="text-purple-400">{line}</span>;
    }
    return <span className="text-gray-300">{line}</span>;
  };

  // Early return if no processLog
  if (!processLog || processLog.length === 0) {
    return null;
  }

  return (
    <div className={`mt-4 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden shadow-lg ${className}`}>
      <div className="bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-750 p-3 border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center justify-between w-full text-left hover:opacity-80 transition-opacity"
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">🔍</span>
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
              処理の詳細
            </h4>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              ({sections.length} セクション)
            </span>
          </div>
          <svg
            className={`w-5 h-5 text-gray-500 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>
      
      <div className="bg-gray-900 overflow-x-auto">
        {isExpanded ? (
          <div className="divide-y divide-gray-800">
            {sections.map((section, index) => (
              <div key={index} className="p-4">
                {section.isHeader ? (
                  <pre className="text-xs font-mono whitespace-pre-wrap">
                    {section.lines.map((line, lineIndex) => (
                      <div key={lineIndex}>{formatLogLine(line)}</div>
                    ))}
                  </pre>
                ) : (
                  <div>
                    {section.title && (
                      <h5 className="text-sm font-semibold text-gray-200 mb-2 flex items-center gap-2">
                        <span>{section.icon}</span>
                        <span>{section.title.replace(/^\[\d+ms\]\s*/, '')}</span>
                      </h5>
                    )}
                    <pre className="text-xs font-mono whitespace-pre-wrap pl-6">
                      {section.lines.slice(section.title ? 1 : 0).map((line, lineIndex) => (
                        <div key={lineIndex}>{formatLogLine(line)}</div>
                      ))}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="p-4">
            <pre className="text-xs font-mono whitespace-pre-wrap">
              {previewSections.map((section, sectionIndex) => (
                <div key={sectionIndex} className="mb-2">
                  {section.lines.map((line, lineIndex) => (
                    <div key={lineIndex}>{formatLogLine(line)}</div>
                  ))}
                </div>
              ))}
            </pre>
            {hasMore && (
              <button
                className="text-blue-400 hover:text-blue-300 text-sm mt-3 flex items-center gap-1 transition-colors"
                onClick={() => setIsExpanded(true)}
              >
                <span>... 続きを見る</span>
                <span className="text-xs text-gray-500">({sections.length - previewSections.length} セクション)</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}