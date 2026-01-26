# 貢獻指南

感謝你對 StarScope 的興趣！

## 快速開始

```bash
# 1. Fork 並 Clone
git clone https://github.com/YOUR_USERNAME/StarScope.git
cd StarScope

# 2. 安裝依賴
npm install
cd sidecar && pip install -r requirements.txt && cd ..

# 3. 開發模式（兩個終端機）
cd sidecar && python main.py    # 終端機 1
npm run tauri dev               # 終端機 2
```

## 提交程式碼

1. 建立功能分支：`git checkout -b feature/your-feature`
2. 確保品質檢查通過：
   ```bash
   npm run lint && npm run format:check && npm run type-check
   cd sidecar && pytest
   ```
3. 提交並推送：`git push origin feature/your-feature`
4. 建立 Pull Request

## Commit 規範

遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

| 類型         | 說明     |
|------------|--------|
| `feat`     | 新功能    |
| `fix`      | 修復 bug |
| `docs`     | 文件變更   |
| `refactor` | 重構     |
| `test`     | 測試相關   |
| `chore`    | 建置/工具  |

```bash
git commit -m "feat(watchlist): add batch import"
```

## 程式碼風格

| 語言         | 工具                |
|------------|-------------------|
| TypeScript | Prettier + ESLint |
| Python     | Ruff (格式化 + Lint) |

## 回報問題

1. 先搜尋 [Issues](https://github.com/Neal75418/StarScope/issues)
2. 提供：問題描述、重現步驟、環境資訊

## 環境需求

- Node.js 18+
- Python 3.12+
- Rust (Tauri)

---

詳細開發資訊請參考 [CLAUDE.md](./CLAUDE.md)
