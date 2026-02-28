# StarScope 技術債追蹤

**最後更新**: 2026-02-28

---

## 🔴 高優先級（未來 3-6 個月）

### 無

當前無高優先級技術債。

---

## 🟡 中優先級（未來 6-12 個月）

### TD-001: Hook 架構簡化

**類別**: 前端架構
**影響範圍**: `src/hooks/` (43 個 hooks)
**問題描述**:
- 當前有 17 個（39.5%）單用途 wrapper hooks
- 過度抽象導致學習曲線增加
- 部分 hooks 僅在單一元件使用

**建議方案**:
1. **階段 1**: 移除純 wrapper hooks（如 `useReposQuery`）
   - 直接在 Context 中使用 `useQuery`
   - 預估工時: 2 小時
   - 風險: 🟡 中

2. **階段 2**: 合併單用途 hooks
   - 評估 17 個單用途 hooks 是否可合併
   - 預估工時: 4-6 小時
   - 風險: 🔴 高（需大量測試）

**觸發條件**:
- [ ] 新工程師反饋學習困難
- [ ] Hook 數量持續增長
- [ ] 發現實際的效能問題

**預估工時**: 6-10 小時
**風險等級**: 🔴 高（需完整 E2E 測試）
**相關檔案**:
- `src/hooks/useReposQuery.ts`（候選移除）
- 17 個單用途 hooks（需評估）

**備註**: 延後原因為當前架構可運作，且需等待完整的 E2E 測試覆蓋

---

### TD-002: 服務層解耦

**類別**: 後端架構
**影響範圍**: `sidecar/services/` (14 個服務)
**問題描述**:
- `scheduler.py` 直接調用 `github.py`, `analyzer.py`, `recommender.py`
- 服務間存在緊耦合
- 難以獨立測試和替換

**建議方案**:
1. **Orchestrator Pattern**
   ```python
   # sidecar/services/orchestrator.py
   class TaskOrchestrator:
       def __init__(self, github_service, analyzer_service, ...):
           self.github = github_service
           self.analyzer = analyzer_service

       async def fetch_and_analyze(self, repo_id: int):
           # 協調邏輯
   ```

2. **事件驅動架構**
   - 使用 Redis Pub/Sub 或 RabbitMQ
   - 服務間透過事件通訊
   - 更好的水平擴展性

**觸發條件**:
- [ ] 需要水平擴展後端服務
- [ ] 引入新的背景任務框架
- [ ] 服務間依賴造成測試困難

**預估工時**: 8-12 小時
**風險等級**: 🔴 高（架構變更）
**相關檔案**:
- `sidecar/services/scheduler.py`
- `sidecar/services/github.py`
- `sidecar/services/analyzer.py`
- `sidecar/services/recommender.py`

**備註**: 當前耦合度可接受，建議等實際需求出現時再處理

---

## 🟢 低優先級（未來 12+ 個月或選擇性）

### TD-003: 資源管理優化

**類別**: 後端程式碼品質
**影響範圍**: `sidecar/services/settings.py`
**問題描述**:
- `get_setting()` 函數中的 session 管理邏輯不夠優雅
- 雖有 try-finally 保護，但可讀性較差

**建議方案**:
```python
from contextlib import nullcontext

def get_setting(key: str, db: Session | None = None) -> Optional[str]:
    if _is_token_key(key):
        # Keyring 邏輯
        pass

    with db if db else get_db_session() as session:
        setting = session.query(AppSetting).filter(...).first()
        return setting.value if setting else None
```

**觸發條件**:
- [ ] 程式碼審查時重點關注此模組
- [ ] 發現實際的資源洩漏問題
- [ ] 進行全面的程式碼品質提升時

**預估工時**: 2-3 小時
**風險等級**: 🟢 低（局部重構）
**相關檔案**:
- `sidecar/services/settings.py`

**備註**: 非緊急，當前實現已安全

---

### TD-004: 自動化文件生成

**類別**: 開發工具
**影響範圍**: 文件維護流程
**問題描述**:
- README.md 和 CLAUDE.md 中的路由/服務數量需手動維護
- 容易出現不一致

**建議方案**:
```python
# scripts/generate_docs.py
def count_routers():
    return len(list(Path("sidecar/routers").glob("*.py")))

def count_services():
    return len(list(Path("sidecar/services").glob("*.py")))

def update_readme(router_count, service_count):
    # 自動更新 README.md
```

**觸發條件**:
- [ ] 經常需要更新文件中的統計數字
- [ ] 引入 CI/CD 自動化流程時

**預估工時**: 1-2 小時
**風險等級**: 🟢 低（純工具）
**相關檔案**:
- `README.md`
- `CLAUDE.md`
- 新建 `scripts/generate_docs.py`

**備註**: 可與 OpenAPI schema 生成整合

---

## 📋 技術債管理流程

### 新增技術債
1. 在本檔案中記錄
2. 標記優先級（🔴 高 / 🟡 中 / 🟢 低）
3. 定義觸發條件
4. 預估工時和風險

### 定期審查
- **頻率**: 每季度（3 個月）
- **審查內容**:
  - 觸發條件是否滿足
  - 優先級是否需要調整
  - 是否有新的技術債產生

### 執行流程
1. 檢查觸發條件
2. 評估當前資源和時間
3. 建立詳細實施計劃（參考 REFACTORING_SUMMARY.md）
4. 執行並驗證
5. 更新本檔案，標記為「已解決」

### 已解決的技術債

#### ✅ TD-000: Critical + High 問題修復（已完成 2026-02-28）
- **問題**: 20 個 Critical/High 優先級問題
- **解決方案**: Stage 1-3 重構
- **詳見**: [REFACTORING_SUMMARY.md](REFACTORING_SUMMARY.md)

---

## 📊 技術債統計

| 優先級 | 數量 | 預估總工時 |
|--------|------|-----------|
| 🔴 高   | 0    | 0 小時     |
| 🟡 中   | 2    | 14-22 小時 |
| 🟢 低   | 2    | 3-5 小時   |
| **總計** | **4** | **17-27 小時** |

---

## 🎯 2026 年技術債目標

### Q1 (1-3 月)
- [x] 完成 Critical + High 問題修復
- [ ] 監控延後項目影響

### Q2 (4-6 月)
- [ ] 評估 TD-001（Hook 架構）觸發條件
- [ ] 評估 TD-002（服務層解耦）觸發條件

### Q3 (7-9 月)
- [ ] 根據 Q2 評估決定是否執行 TD-001
- [ ] 考慮 TD-004（自動化文件）整合到 CI/CD

### Q4 (10-12 月)
- [ ] 年度技術債審查
- [ ] 規劃 2027 年重構目標

---

**維護責任人**: 開發團隊
**審查週期**: 季度
**下次審查**: 2026-06-01
