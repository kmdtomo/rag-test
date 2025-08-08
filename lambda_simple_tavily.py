"""
Simple Lambda function for Tavily search
Focused on reliability and speed - No query decomposition needed
"""
import os
import json
import logging
import time
from typing import Dict, Any, Optional

# ログ設定
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    シンプルなTavily検索Lambda関数
    """
    try:
        start_time = time.time()
        
        # 環境変数の取得
        tavily_api_key = os.environ.get('TAVILY_API_KEY')
        if not tavily_api_key:
            logger.error("TAVILY_API_KEY not found")
            return create_error_response(event, "Configuration error")
        
        # クエリパラメータの取得
        query = extract_query_parameter(event)
        if not query:
            return create_error_response(event, "Query parameter required")
        
        logger.info(f"Processing query: {query}")
        
        # Tavily検索を実行
        search_results = perform_tavily_search(tavily_api_key, query)
        
        # 処理時間を記録
        processing_time = time.time() - start_time
        logger.info(f"Search completed in {processing_time:.2f} seconds")
        
        # 最適化されたレスポンスを返す
        return create_response(event, {
            "type": "search_results",
            "query": query,
            "search_performed": True,
            "processing_time": processing_time,
            **search_results
        })
        
    except Exception as e:
        logger.error(f"Unexpected error: {str(e)}", exc_info=True)
        return create_error_response(event, str(e))


def perform_tavily_search(api_key: str, query: str) -> Dict[str, Any]:
    """
    Tavily APIを使用して検索を実行
    """
    try:
        from tavily import TavilyClient
        client = TavilyClient(api_key=api_key)
        
        # 検索パラメータ（動的に調整）
        # 並列検索が増えた場合は各検索の結果数を調整
        search_params = {
            "query": query,
            "search_depth": "advanced",  # 詳細な検索
            "max_results": 5,           # 並列数増加を考慮して調整
            "include_answer": True,      # AI要約を含める
            "include_raw_content": False,
            "include_images": False
            # search_lang は指定しない（クエリの言語に応じて自動判定）
        }
        
        logger.info(f"Calling Tavily API for: {query}")
        
        # 検索実行
        raw_results = client.search(**search_params)
        
        logger.info(f"Tavily returned {len(raw_results.get('results', []))} results")
        
        # 結果の整形
        return format_search_results(raw_results, query)
        
    except ImportError:
        logger.error("Tavily module not found")
        return create_fallback_response(query)
    except Exception as e:
        logger.error(f"Search error: {str(e)}")
        return create_fallback_response(query)


def format_search_results(raw_results: Dict[str, Any], query: str) -> Dict[str, Any]:
    """
    Tavily検索結果を整形
    """
    sources = []
    urls = []
    
    for idx, result in enumerate(raw_results.get('results', [])):
        url = result.get('url', '')
        title = result.get('title', '')
        content = result.get('content', '')
        
        # コンテンツを適切な長さに調整
        if len(content) > 300:
            content = content[:297] + "..."
        
        source_item = {
            "id": f"source_{idx + 1}",
            "url": url,
            "title": title,
            "snippet": content,
            "relevance_score": result.get('score', 0.5)
        }
        
        sources.append(source_item)
        if url:
            urls.append(url)
    
    return {
        "summary": raw_results.get('answer', ''),
        "sources": sources,
        "urls": urls,
        "total_results": len(sources)
    }


def create_fallback_response(query: str) -> Dict[str, Any]:
    """
    エラー時のフォールバックレスポンス
    """
    return {
        "summary": "検索結果を取得できませんでした。",
        "sources": [],
        "urls": [],
        "total_results": 0
    }


def extract_query_parameter(event: Dict[str, Any]) -> Optional[str]:
    """
    イベントからクエリパラメータを抽出
    """
    # パラメータのパスを試行
    paths = [
        ['parameters', 0, 'value'],
        ['inputText'],
        ['query'],
        ['message']
    ]
    
    for path in paths:
        try:
            value = event
            for key in path:
                if isinstance(key, int):
                    value = value[key]
                else:
                    value = value.get(key)
                if value is None:
                    break
            if value:
                return str(value)
        except (KeyError, IndexError, TypeError):
            continue
    
    return None


def create_response(event: Dict[str, Any], body: Dict[str, Any]) -> Dict[str, Any]:
    """
    API Gateway用のレスポンスを作成
    """
    response = {
        "messageVersion": "1.0",
        "response": {
            "actionGroup": event.get("actionGroup", "WebSearchGroup"),
            "function": event.get("function", "tavily_search"),
            "functionResponse": {
                "responseBody": {
                    "TEXT": {
                        "body": json.dumps(body, ensure_ascii=False)
                    }
                }
            }
        }
    }
    
    return response


def create_error_response(event: Dict[str, Any], error_message: str) -> Dict[str, Any]:
    """
    エラーレスポンスを作成
    """
    error_body = {
        "type": "search_results",
        "query": extract_query_parameter(event) or "",
        "search_performed": False,
        "error": error_message,
        "summary": f"エラーが発生しました: {error_message}",
        "sources": [],
        "urls": [],
        "total_results": 0
    }
    
    return create_response(event, error_body)