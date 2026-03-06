# 🤝 貢獻指南

> 感謝你對 StarScope 的興趣！以下是參與貢獻的流程。

---

## 📋 環境需求

| 工具      | 版本            | 用途         |
|---------|---------------|------------|
| Node.js | 20+ (LTS)     | 前端建置       |
| Python  | 3.12+         | 後端 sidecar |
| Rust    | latest stable | Tauri 桌面框架 |
| npm     | 10+           | 套件管理       |

---

## 🏗️ 架構速覽

StarScope 採用三層式架構：

| 層級           | 目錄           | 技術                                                  |
|--------------|--------------|-----------------------------------------------------|
| **Frontend** | `src/`       | React 19 + TypeScript，資料層由 React Query + Context 管理 |
| **Desktop**  | `src-tauri/` | Rust Tauri v2，System Tray、Sidecar 管理、OS 通知          |
| **Backend**  | `sidecar/`   | Python FastAPI，17 個路由模組、15 個服務、SQLite               |

> 詳細架構文件請參考 [CLAUDE.md](./CLAUDE.md)。

---

## 🚀 快速開始

```bash
# 1. Fork 並 Clone
git clone https://github.com/YOUR_USERNAME/StarScope.git
cd StarScope

# 2. 安裝依賴
npm install
cd sidecar && pip install -r requirements.txt && cd ..

# 3. 環境設定（選用）
cp sidecar/.env.example sidecar/.env

# 4. 開發模式
cd sidecar && python main.py    # 終端機 1 — sidecar
npm run tauri dev               # 終端機 2 — Tauri
```

---

## 🔄 開發流程

```mermaid
graph LR
    A["🌿 建立分支"] --> B["💻 開發"]
    B --> C["🧪 測試"]
    C --> D["✅ 品質檢查"]
    D --> E["📤 提交 PR"]

    classDef step fill:#1e293b,stroke:#475569,color:#f1f5f9,font-weight:bold
    class A,B,C,D,E step
```

### 1. 建立分支

```bash
git checkout -b feature/your-feature
```

### 2. 開發與測試

修改程式碼後，執行相關測試確認功能正常。

### 3. 品質檢查

```bash
npm run lint && npm run format:check && npm run type-check    # 前端
cd sidecar && pytest                                          # 後端
```

### 4. 提交並建立 PR

```bash
git push origin feature/your-feature
# 在 GitHub 開啟 Pull Request
```

---

## 🧪 執行測試

### 前端

```bash
npm run test              # Vitest 單元測試
npm run test:coverage     # 覆蓋率報告
npm run lint              # ESLint 檢查
npm run type-check        # TypeScript 型別檢查
npm run format:check      # Prettier 格式檢查
```

### 後端

```bash
cd sidecar
pytest tests/ -v          # 執行所有測試
pytest tests/ --cov=.     # 覆蓋率報告
```

### E2E

```bash
npm run test:e2e          # Playwright 全瀏覽器測試
npm run test:e2e:chromium # 僅 Chromium
npm run test:e2e:ui       # 互動式 UI 模式
```

---

## 📝 Commit 規範

遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

| 類型         | 說明     | 範例                                          |
|------------|--------|---------------------------------------------|
| `feat`     | 新功能    | `feat(watchlist): add batch import`         |
| `fix`      | 修復 bug | `fix(scheduler): handle timezone edge case` |
| `docs`     | 文件變更   | `docs: update API endpoint table`           |
| `refactor` | 重構     | `refactor: extract logger utility`          |
| `test`     | 測試相關   | `test: add coverage for useAsyncFetch`      |
| `perf`     | 效能改進   | `perf: memoize expensive calculations`      |
| `chore`    | 建置/工具  | `chore: bump dependencies`                  |

---

## 🎨 程式碼風格

| 語言         | 工具                | 指令                 |
|------------|-------------------|--------------------|
| TypeScript | Prettier + ESLint | `npm run lint:fix` |
| Python     | Ruff（格式化 + Lint）  | `ruff check --fix` |

---

## 🐛 回報問題

1. 先搜尋 [Issues](https://github.com/Neal75418/StarScope/issues) 避免重複
2. 提供：問題描述、重現步驟、環境資訊

> 標記為 `good first issue` 的任務適合新手入門。

---

詳細開發資訊請參考 [CLAUDE.md](./CLAUDE.md)。
