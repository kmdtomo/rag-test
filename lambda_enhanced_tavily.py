"""
Enhanced Lambda function for Tavily search with full parameter support
Optimized for flexible search with all Tavily features
"""
import os
import json
import logging
import time
import hashlib
from typing import Dict, Any, Optional, List

# ログ設定
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# グローバルキャッシュ（Lambda コンテナ再利用時に有効）
SEARCH_CACHE = {}
CACHE_TTL = 300  # 5分間キャッシュ

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    強化版Tavily検索Lambda関数
    複数パラメータに対応し、Tavilyの全機能を活用
    """
    try:
        start_time = time.time()
        
        # 環境変数の取得
        tavily_api_key = os.environ.get('TAVILY_API_KEY')
        if not tavily_api_key:
            logger.error("TAVILY_API_KEY not found")
            return create_error_response(event, "Configuration error")
        
        # 全パラメータを抽出
        params = extract_all_parameters(event)
        
        # クエリの存在確認
        query = params.get('query')
        if not query:
            return create_error_response(event, "Query parameter required")
        
        logger.info(f"Processing query: {query} with params: {json.dumps(params, ensure_ascii=False)}")
        
        # Tavily検索を実行（全パラメータ使用）
        search_results = perform_enhanced_tavily_search(tavily_api_key, params)
        
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


def extract_all_parameters(event: Dict[str, Any]) -> Dict[str, Any]:
    """
    イベントから全パラメータを抽出（複数パラメータ対応）
    """
    params = {}
    
    # 標準的なパラメータ形式を処理
    if 'parameters' in event:
        for param in event.get('parameters', []):
            if isinstance(param, dict):
                name = param.get('name')
                value = param.get('value')
                if name and value is not None:
                    params[name] = value
    
    # フォールバック：他の形式もサポート
    if not params:
        # 直接パラメータを含む場合
        for key in ['query', 'search_depth', 'topic', 'days', 'max_results', 
                   'include_domains', 'exclude_domains', 'include_answer', 
                   'include_raw_content', 'include_images']:
            if key in event:
                params[key] = event[key]
    
    # クエリの特別処理（従来の互換性維持）
    if 'query' not in params:
        query = extract_query_parameter(event)
        if query:
            params['query'] = query
    
    return params


def extract_query_parameter(event: Dict[str, Any]) -> Optional[str]:
    """
    従来の互換性のためのクエリ抽出（フォールバック用）
    """
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


def perform_enhanced_tavily_search(api_key: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """
    強化版Tavily API検索（全パラメータ活用 + キャッシュ）
    """
    try:
        # キャッシュキーの生成
        cache_key = hashlib.md5(json.dumps(params, sort_keys=True).encode()).hexdigest()
        
        # キャッシュチェック
        if cache_key in SEARCH_CACHE:
            cached_result, cached_time = SEARCH_CACHE[cache_key]
            if time.time() - cached_time < CACHE_TTL:
                logger.info(f"Cache hit for query: {params.get('query')}")
                cached_result['from_cache'] = True
                return cached_result
        
        from tavily import TavilyClient
        client = TavilyClient(api_key=api_key)
        
        query_lower = params.get('query', '').lower()
        
        # クエリタイプに基づく自動最適化
        # オッズ、価格、数値情報は軽量検索で十分
        if any(keyword in query_lower for keyword in ['odds', 'price', 'rate', 'オッズ', '価格', '倍率']):
            search_depth = 'basic'
            max_results = 3
        else:
            search_depth = params.get('search_depth', 'advanced')
            max_results = int(params.get('max_results', 5))
        
        # 検索パラメータの構築
        search_params = {
            "query": params.get('query'),
            "search_depth": search_depth,
            "max_results": max_results
        }
        
        # オプションパラメータの追加
        if 'topic' in params:
            search_params['topic'] = params['topic']
        
        if 'days' in params:
            days_value = params.get('days')
            if days_value and str(days_value) != '0':
                search_params['days'] = int(days_value)
        
        # ブール値パラメータの処理
        search_params['include_answer'] = str(params.get('include_answer', 'true')).lower() == 'true'
        search_params['include_raw_content'] = str(params.get('include_raw_content', 'false')).lower() == 'true'
        search_params['include_images'] = str(params.get('include_images', 'false')).lower() == 'true'
        
        # ドメインフィルタの処理
        if 'include_domains' in params and params['include_domains']:
            domains = params['include_domains']
            if isinstance(domains, str):
                domains = [d.strip() for d in domains.split(',') if d.strip()]
            search_params['include_domains'] = domains
        
        if 'exclude_domains' in params and params['exclude_domains']:
            domains = params['exclude_domains']
            if isinstance(domains, str):
                domains = [d.strip() for d in domains.split(',') if d.strip()]
            search_params['exclude_domains'] = domains
        
        logger.info(f"Calling Tavily API with params: {json.dumps(search_params, ensure_ascii=False)}")
        
        # 検索実行
        raw_results = client.search(**search_params)
        
        logger.info(f"Tavily returned {len(raw_results.get('results', []))} results")
        
        # 結果の整形（AI要約を含む）
        result = format_enhanced_search_results(raw_results, params.get('query'))
        
        # キャッシュに保存
        SEARCH_CACHE[cache_key] = (result, time.time())
        
        return result
        
    except ImportError:
        logger.error("Tavily module not found")
        return create_fallback_response(params.get('query'))
    except Exception as e:
        logger.error(f"Search error: {str(e)}")
        return create_fallback_response(params.get('query'))


def format_enhanced_search_results(raw_results: Dict[str, Any], query: str) -> Dict[str, Any]:
    """
    強化版：Tavily検索結果を整形（AI要約を含む）
    """
    sources = []
    urls = []
    
    for idx, result in enumerate(raw_results.get('results', [])):
        url = result.get('url', '')
        title = result.get('title', '')
        content = result.get('content', '')
        
        # コンテンツを適切な長さに調整
        if len(content) > 400:
            content = content[:397] + "..."
        
        source_item = {
            "id": f"source_{idx + 1}",
            "url": url,
            "title": title,
            "snippet": content,
            "relevance_score": result.get('score', 0.5),
            # 追加情報
            "published_date": result.get('published_date'),
            "author": result.get('author')
        }
        
        # None値を除去
        source_item = {k: v for k, v in source_item.items() if v is not None}
        
        sources.append(source_item)
        if url:
            urls.append(url)
    
    # AI要約（Tavilyのinclude_answerによる）
    summary = raw_results.get('answer', '')
    
    # 画像情報（もし含まれていれば）
    images = raw_results.get('images', [])
    
    response = {
        "summary": summary,
        "sources": sources,
        "urls": urls,
        "total_results": len(sources)
    }
    
    # 画像がある場合は追加
    if images:
        response["images"] = images[:5]  # 最大5枚
    
    return response


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
    params = extract_all_parameters(event)
    error_body = {
        "type": "search_results",
        "query": params.get('query', ''),
        "search_performed": False,
        "error": error_message,
        "summary": f"エラーが発生しました: {error_message}",
        "sources": [],
        "urls": [],
        "total_results": 0
    }
    
    return create_response(event, error_body)