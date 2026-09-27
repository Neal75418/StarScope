---
paths:
  - "sidecar/**"
  - "scripts/update-constraints.sh"
  - "scripts/launchd/**"
---

# Python sidecar 的約定與陷阱

只在讀到 `sidecar/`、constraints 腳本、launchd plist 時載入。指令、venv、資料庫位置、時區規則、API 信封在根目錄
`CLAUDE.md`；啟停、看門、smoke test 在 `sidecar-lifecycle.md`。

## 依賴與測試環境

⚠️ **Python 依賴的版本鎖在 `sidecar/constraints.txt`**（開發機 venv 的 pip freeze），CI 與 release 都用
`-c constraints.txt` 安裝；`requirements.txt` 只宣告範圍。不要手改 constraints。升級流程：venv 裡
`pip install -U <套件>` → 跑測試 → `scripts/update-constraints.sh` → commit 兩個檔（venv 要裝 pyinstaller，
沒裝腳本會擋）。`tests/test_constraints.py` 守住每個 requirement 都有鎖、且鎖的版本在範圍內。
鎖不到開發機沒裝的平台限定套件（greenlet、Windows 的 tzdata 等），清單見 constraints.txt 開頭。

⚠️ conftest 有兩個 session autouse fixture，**別拿掉**（`client` 會跑 lifespan 的 star 同步，沒有它們本機測試會用真 token 打 GitHub）：
- `isolate_github_credentials`：keyring 換成 null；`GITHUB_TOKEN` 設成**空字串佔位而不是刪掉**——`main.py` import 時的
  `load_dotenv()` 會補回不存在的 key。它從 `main.py` 所在目錄往上找第一個 `.env`（coverage／debugger 底下改從 cwd 找），
  沒有 `sidecar/.env` 時就會找到 repo 根目錄那份放著真 token 的
- `block_real_network`：httpx 的真 transport 一律拋錯（MockTransport、TestClient 不受影響）。它只擋流量：錯誤一樣被 lifespan
  吞掉、全套照樣綠，只在 captured log 留一行「測試不能連外網」——漏 mock 不會因此浮上來

conftest 沒拿到 `STARSCOPE_DATA_DIR` 時會自己指到暫存目錄（`tests/test_suite_isolation.py` 守住）：預設的 `~/.starscope`
是真實資料，而 APScheduler 的 jobstore 用的是真的 `DATABASE_URL`，跑 lifespan 的測試會把排程寫進去。

## schema 變更：不走 alembic

`sidecar/alembic/` 存在，但**不在啟動路徑上**——那個目錄只有一份 2026-01 的初始 schema，沒有任何程式碼引用它。實際機制是
`init_db()` 的兩步：`create_all()` 建新表，`ensure_columns()` 直接拿 `Base.metadata` 跟使用者的資料庫比對、少什麼補什麼——
**加欄位不需要登記在任何地方**（以前是手工清單：漏登記時開發者的空資料庫一切正常，只有既有使用者會炸「no such column」，
本機重現不出來，所以改成從 model 推導）。

**它只做兩件事：加「可為空（或有 server_default）的欄位」、把非唯一索引對齊 model**（`CREATE INDEX IF NOT EXISTS`，新欄位與
既有欄位都算）。原則：能安全補的加法一律補，補了會炸資料的一律拒絕。偵測得到的差異——新欄位 NOT NULL 又沒有 server_default、
新欄位帶外鍵／`unique=True`／唯一索引／表級約束——會拋 `SchemaNeedsMigration` 讓啟動當場失敗；其他差異**偵測不到**，會靜默
留著，不要指望啟動失敗來提醒你。

⚠️ **下列任一成立就該正式引入 alembic，不要憑感覺**：

- 改欄位型別、改名、刪欄位
- 在**既有欄位**上加唯一約束或唯一索引（非唯一索引 `ensure_columns()` 會補；唯一的偵測不到：有 upsert 的表會在
  `ON CONFLICT` 炸，沒有的會靜默收下重複資料）
- 需要回填或轉換既有資料
- 需要辨識並拒絕不相容的資料庫

引入時 alembic 會自帶版本表，所以**現在不要先發明一個手工維護的 schema 版本號**。`AppSettingKey.LAST_OPENED_APP_VERSION`
記的是「上次開啟這個 DB 的 app 版本」，用途是診斷（外部使用者沒有遙測），不是遷移依據。

**schema 變更必須維持加法**：安裝版與開發模式可能跑不同版本的程式碼，卻共用 `~/.starscope` 同一個資料庫。
`ensure_columns()` 只新增欄位、索引，舊版程式會忽略它不認識的欄位與資料表，所以加法變更兩邊都能用；
改名、刪欄位、改型別會讓其中一邊壞掉。同一個資料庫也存著 APScheduler 的排程：job 的 id 與函式只能新增，
不能改名或刪除——另一個版本還原不了的 job 會被刪掉。只靠新版寫入才成立的資料條件（例如只有 Python 端
`default=`、沒有 `server_default` 的欄位），舊版寫入的資料列不會滿足。

## endpoint 沒有 await 就寫 `def`

Session 是同步的：`async def` 裡的查詢跑在 event loop 上，連線池用完時 checkout 會卡住整個 loop，
佔著連線的請求又等 loop 來收尾 get_db，形成死鎖。症狀是前端整排停在 Loading，連 preflight 都不回，要等 30 秒 pool timeout 才鬆開。
測試的 `StaticPool` 看不到這個問題；`tests/test_endpoint_concurrency.py` 守住。
有 await 的 endpoint（如 `feed/generate`）、啟動同步、排程 job 仍在 loop 上做 DB，靠 engine 用 `NullPool`
（`create_app_engine`）不排隊撐住。⚠️ 別改回有上限的連線池：連線佔用數跟著進行中的請求數走，加大池子也擋不住。

## 本機防護與 middleware 順序

- `SessionAuthMiddleware`：只在 Tauri 注入 secret 時生效（正式版）；手動啟動的 sidecar（start-dev.sh、e2e）整個放行
- `LocalRequestGuardMiddleware`：不分模式，Host 必須是 loopback、帶 Origin 就必須在 `ALLOWED_ORIGINS`
- ⚠️ `add_middleware` 後加的在外層：`CORSMiddleware` 必須**最後** add。沒接住的例外由 `UnhandledErrorMiddleware`
  轉成 500 才會經過 CORS。順序錯了，內層的 403／500 不帶 CORS header，前端只顯示「Network error」
  （`tests/test_cors_on_error_responses.py` 守住）
- ⚠️ 第二層擋不住跨站 GET（`<img src>` 不帶 Origin）⇒ **GET 端點不能改資料、不能寫 GitHub**
- ⚠️ 改 Tauri 平台或 scheme 時同步 `get_allowed_origins()`：漏一個＝那個平台每個請求 403（Windows 是 `http://tauri.localhost`）

## 服務間依賴

查法：`grep -rn "from services\." sidecar/services/`。⚠️ **頂層 grep 抓不全**——`scheduler.py` 與 `github.py` 有函式內
延遲 import 用來迴避循環依賴，不掃函式體會漏掉。`scheduler.py` 是排程樞紐，匯入 **9 個** service（alerts、anomaly_detector、
backup、context_fetcher、feed_generator、github、release_fetcher、settings、snapshot）：改 alerts 或 anomaly_detector 都會碰到它。

## 無頭收集器（不開 App 也收資料）

`sidecar/run_jobs.py` 由 launchd 每小時跑一次（plist 在 `scripts/launchd/`，裝在 `~/Library/LaunchAgents/`）。**做什麼、
為什麼安全、離線怎麼辦，都寫在它的 docstring 裡**——不在這裡複述。

- 生死看心跳：`~/.starscope/jobs.log` 每輪一行。停止更新＝launchd 斷了（最常見原因：repo 搬家後 plist 裡的絕對路徑失效）
- 與開著的 App 併發安全的關鍵是「skip 查 DB 的 fetched_at」，不是行程內的鎖
- ⚠️ dev 模式下改 `sidecar/` 的檔案會觸發 uvicorn 熱重載＝重跑啟動序列（star 同步＋抓取）。重載風暴可能把 star 同步殺在半路
  留下鎖——鎖有 10 分鐘 TTL 會自癒，看到「already_running」先看時間再懷疑卡死
- ⚠️ **INFO 級的日誌在 collector 完全看不到**：它從不呼叫 `setup_logging`，root logger 沒有 handler，只有
  `logging.lastResort`（WARNING 級）在收。所以「jobs.log 沒有某條 INFO」**不能**當成「那件事沒發生」的證據；
  WARNING 以上缺席才是有效證據
