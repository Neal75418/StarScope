#!/bin/bash
# 檢查前後端型別是否同步
# 比對 OpenAPI schema 中的關鍵型別欄位與前端手寫型別

set -e

API_URL="${1:-http://localhost:8008}"
TYPES_FILE="src/api/types.ts"
DRIFT=0

SCHEMA=$(curl -sf "$API_URL/api/openapi.json" 2>/dev/null || echo "")

if [ -z "$SCHEMA" ]; then
  echo "⚠️  Sidecar 未啟動，跳過 API drift 檢查"
  exit 0
fi

# 要檢查的關鍵 schema 名稱
SCHEMAS="RepoWithSignals RepoListResponse BackfillStatus BackfillResult StarHistoryResponse StarsChartResponse ContextBadgesResponse ContextSignalsResponse TrendsResponse ComparisonChartResponse WeeklySummaryResponse PortfolioHistoryResponse DiscoveryRepo SearchResponse"

for schema_name in $SCHEMAS; do
  # 從 OpenAPI 取得後端欄位
  BACKEND_FIELDS=$(echo "$SCHEMA" | python3 -c "
import json, sys
spec = json.load(sys.stdin)
schema = spec.get('components', {}).get('schemas', {}).get('$schema_name', {})
props = sorted(schema.get('properties', {}).keys())
for p in props: print(p)
" 2>/dev/null)

  if [ -z "$BACKEND_FIELDS" ]; then
    continue
  fi

  # 提取前端 interface 的 body（從 interface 宣告到下一個 export 或空行+非縮排行）
  INTERFACE_BODY=$(python3 -c "
import re, sys
content = open('$TYPES_FILE').read()
# 匹配 'export interface SchemaName {' 到對應的 '}'
pattern = r'export interface $schema_name\s*\{([^}]*)\}'
match = re.search(pattern, content, re.DOTALL)
if match:
    print(match.group(1))
" 2>/dev/null)

  if [ -z "$INTERFACE_BODY" ]; then
    continue
  fi

  for field in $BACKEND_FIELDS; do
    if ! echo "$INTERFACE_BODY" | grep -q "$field" 2>/dev/null; then
      echo "❌ DRIFT: 後端 $schema_name.$field 在前端未定義"
      DRIFT=1
    fi
  done
done

if [ "$DRIFT" -eq 0 ]; then
  echo "✅ API 型別同步檢查通過"
else
  echo ""
  echo "⚠️  發現前後端型別不同步，請更新 $TYPES_FILE"
  exit 1
fi
