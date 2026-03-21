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
SCHEMAS="RepoWithSignals RepoListResponse BackfillStatus BackfillResult StarHistoryResponse StarsChartResponse ContextBadgesResponse ContextSignalsResponse EarlySignalResponse TrendsResponse ComparisonChartResponse WeeklySummaryResponse PortfolioHistoryResponse DiscoveryRepo SearchResponse"

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

  # 檢查前端是否有對應的 interface
  if ! grep -q "interface $schema_name\b\|type $schema_name\b" "$TYPES_FILE" 2>/dev/null; then
    # 部分 schema 名稱在前端不同（如 EarlySignalResponse → EarlySignal）
    continue
  fi

  for field in $BACKEND_FIELDS; do
    if ! grep -q "$field" "$TYPES_FILE" 2>/dev/null; then
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
