# 貢獻指南

> 感謝你對 StarScope 的興趣！以下是參與貢獻的流程。

---

## 環境需求

| 工具      | 版本     |
|---------|--------|
| Node.js | 18+    |
| Python  | 3.12+  |
| Rust    | latest |

---

## 快速開始

```bash
# 1. Fork 並 Clone
git clone https://github.com/YOUR_USERNAME/StarScope.git
cd StarScope

# 2. 安裝依賴
npm install
cd sidecar && pip install -r requirements.txt && cd ..

# 3. 開發模式
cd sidecar && python main.py    # 終端機 1 — sidecar
npm run tauri dev               # 終端機 2 — Tauri
```

---

## 開發流程

```mermaid
graph LR
    A["建立分支"] --> B["開發與測試"]
    B --> C["品質檢查"]
    C --> D["提交 PR"]

    classDef step fill:#1e293b,stroke:#475569,color:#f1f5f9,font-weight:bold
    class A,B,C,D step
```

### 1. 建立分支

```bash
git checkout -b feature/your-feature
```

### 2. 品質檢查

```bash
npm run lint && npm run format:check && npm run type-check    # 前端
cd sidecar && pytest                                          # 後端
```

### 3. 提交並建立 PR

```bash
git push origin feature/your-feature
# 在 GitHub 開啟 Pull Request
```

---

## Commit 規範

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

## 程式碼風格

| 語言         | 工具                | 指令                 |
|------------|-------------------|--------------------|
| TypeScript | Prettier + ESLint | `npm run lint:fix` |
| Python     | Ruff（格式化 + Lint）  | `ruff check --fix` |

---

## 回報問題

1. 先搜尋 [Issues](https://github.com/Neal75418/StarScope/issues) 避免重複
2. 提供：問題描述、重現步驟、環境資訊

---

詳細開發資訊請參考 [CLAUDE.md](./CLAUDE.md)。
