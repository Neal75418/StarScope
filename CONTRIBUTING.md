# 貢獻指南

感謝你對 StarScope 的興趣！我們歡迎任何形式的貢獻。

## 如何貢獻

### 回報問題

如果你發現了 bug 或有功能建議：

1. 先搜尋 [Issues](https://github.com/your-username/StarScope/issues) 確認是否已有相同問題
2. 如果沒有，請建立一個新的 Issue
3. 盡可能提供詳細資訊：
   - 問題描述
   - 重現步驟
   - 預期行為
   - 實際行為
   - 環境資訊（OS、Python 版本、Node 版本等）

### 提交程式碼

1. **Fork** 這個專案到你的帳號
2. **Clone** 你的 fork：
   ```bash
   git clone https://github.com/YOUR_USERNAME/StarScope.git
   cd StarScope
   ```
3. 建立功能分支：
   ```bash
   git checkout -b feature/your-feature-name
   ```
4. 進行你的修改
5. 確保程式碼品質：
   ```bash
   # Python 格式化
   cd sidecar
   pip install black isort
   black .
   isort .

   # TypeScript 格式化
   cd ..
   npm run lint
   ```
6. 提交你的修改：
   ```bash
   git add .
   git commit -m "feat: add your feature description"
   ```
7. 推送到你的 fork：
   ```bash
   git push origin feature/your-feature-name
   ```
8. 建立 Pull Request

## 開發環境設定

### 前置需求

- Node.js 18+
- Python 3.9+
- Rust（Tauri 需要）

### 安裝步驟

```bash
# 前端依賴
npm install

# Python 依賴
cd sidecar
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
pip install -r requirements-dev.txt  # 開發依賴（如果有的話）
```

### 開發模式

```bash
# 終端機 1：Python sidecar
cd sidecar
python main.py

# 終端機 2：Tauri 開發模式
npm run tauri dev
```

## 程式碼風格

### Python

- 使用 [Black](https://github.com/psf/black) 格式化
- 使用 [isort](https://pycqa.github.io/isort/) 排序 import
- 遵循 PEP 8 規範
- 使用 type hints

### TypeScript/React

- 使用 Prettier 格式化
- 遵循 ESLint 規則
- 使用 functional components 和 hooks
- 避免使用 `any` 類型

### Commit 訊息

我們遵循 [Conventional Commits](https://www.conventionalcommits.org/) 規範：

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

類型：
- `feat`: 新功能
- `fix`: 修復 bug
- `docs`: 文件變更
- `style`: 格式調整（不影響程式碼邏輯）
- `refactor`: 重構（不是新功能也不是修 bug）
- `perf`: 效能優化
- `test`: 測試相關
- `chore`: 建置/工具變更

範例：
```
feat(watchlist): add batch import feature

- Support importing repos from JSON file
- Add progress indicator during import
- Handle duplicate detection

Closes #123
```

## 專案結構

```
StarScope/
├── src/                    # React 前端
│   ├── api/                # API 客戶端
│   ├── components/         # UI 元件
│   ├── pages/              # 頁面
│   └── utils/              # 工具函數
├── src-tauri/              # Tauri (Rust)
└── sidecar/                # Python 資料引擎
    ├── db/                 # 資料庫
    ├── routers/            # API 路由
    └── services/           # 業務邏輯
```

## 測試

### Python 測試

```bash
cd sidecar
pytest
```

### 前端測試

```bash
npm test
```

## 問題與討論

- 有問題？開一個 [Issue](https://github.com/your-username/StarScope/issues)
- 想討論功能？使用 [Discussions](https://github.com/your-username/StarScope/discussions)

## 行為準則

請保持友善和尊重。我們希望這是一個歡迎所有人的社群。

---

再次感謝你的貢獻！
