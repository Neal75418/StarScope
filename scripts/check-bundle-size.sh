#!/bin/bash
# Bundle size budget 檢查
# 確保 JS bundle gzipped 總大小不超過門檻

set -e

BUDGET_KB=400  # gzipped JS 總大小上限（KB）

# 建置
echo "📦 建置前端..."
npm run build --silent

# 驗證產出檔案存在
if [ ! -d dist/assets ] || [ -z "$(find dist/assets -name '*.js' 2>/dev/null)" ]; then
  echo "❌ dist/assets 中找不到 JS 檔案，建置可能失敗"
  exit 1
fi

# 計算 JS gzipped 總大小
TOTAL=$(find dist/assets -name '*.js' -exec gzip -c {} \; | wc -c | awk '{printf "%.1f", $1/1024}')

echo "📊 JS bundle (gzipped): ${TOTAL} KB / ${BUDGET_KB} KB budget"

# 比較
OVER=$(echo "$TOTAL $BUDGET_KB" | awk '{if ($1 > $2) print 1; else print 0}')

if [ "$OVER" -eq 1 ]; then
  echo "❌ Bundle 超出預算！(${TOTAL} KB > ${BUDGET_KB} KB)"
  echo ""
  echo "最大的 chunks："
  find dist/assets -name '*.js' -exec sh -c 'echo "$(gzip -c "$1" | wc -c | awk "{printf \"%.1f\", \$1/1024}") KB  $1"' _ {} \; | sort -rn | head -5
  exit 1
else
  echo "✅ Bundle 在預算內"
fi
