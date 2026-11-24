# e2e 改連本機的假 GitHub — 設計

日期：2026-11-24　狀態：user 已同意

## 為什麼

e2e 的 sidecar 會連真的 GitHub：

- CI 刻意不給 token，用的是未認證的匿名配額（每個 IP 每小時 60 次）。GitHub 的 runner 共用 IP，配額常在我們用之前就被別人用光：
  11-24 的 `9ac3983`、`7c45fa7` 都是那一輪第一個新增儲存庫就 429。另外 11-08 的 `dbbb72d` 是 GitHub 事故，回 503／504。
  紅不紅取決於分到哪個 IP，我們控制不了。
- 本機不加 `E2E_NO_TOKEN=1` 時，e2e 的 sidecar 會讀到 Keychain 的 token，用到 user 的配額，
  「加入追蹤」還會真的在 GitHub 上按 star（CLAUDE.md 有警告）。

成功的樣子：e2e 不打任何真的 GitHub，CI 不再因為 GitHub 的狀況變紅；本機怎麼跑都碰不到 user 的 token。

## 現況（量測）

- 11-24 用全新的 e2e 資料目錄，照 CI 的組合（chromium＋db-mutating、不帶 token）跑一輪。
  做法是暫時打開 httpx 的 INFO log，量完已還原。sidecar 對外只有 3 個請求，全部是 `GET /repos/{owner}/{repo}`：
  `octocat/Hello-World`、`octocat/Spoon-Knife`、`octocat/octocat.github.io`（`e2e/helpers.ts` 的 FIXTURES）。
- 探索頁的搜尋、`/api/health` 等，e2e 已經在瀏覽器端用 `page.route` 假造了。
- GitHub REST 的網址寫死在 `sidecar/services/github.py` 的 `GITHUB_API_BASE`。登入流程（`github_auth.py`）和 Hacker News（`hacker_news.py`）各自寫死網址，e2e 目前都沒有打到。

## 目標／非目標

- 目標：e2e 的 sidecar 只連本機的假 GitHub；假 GitHub 遇到沒預料到的請求時回錯誤並記下來，不會默默去連真的 GitHub。呼叫端把錯誤往外拋時 spec 會紅；被吞掉的（例如抓 release）由 CI 看 log 判紅。
- 目標：e2e 的 sidecar 一律不帶 token，拿掉 `E2E_NO_TOKEN` 旗標。
- 非目標：登入流程、Hacker News 的網址不改。e2e 沒打到它們，等有 spec 需要時再說。
- 非目標：讓 e2e 測 GitHub 出錯時的畫面（以後可以在假 GitHub 加情境，這次不做）。
- 反目標：讓正式版的 token 有機會被送到別處。

## 做法

考慮過的三種：

1. **本機假伺服器＋網址可覆蓋（選這個）**：sidecar 走原本的 httpx 與錯誤處理，只換網址。假伺服器很小。
2. 直接往 e2e 資料庫塞資料：補不到「新增追蹤」流程。那個請求是 sidecar 自己發出去的，不經過瀏覽器，攔不到。
3. 後端加測試專用的假資料分支：把測試用的程式碼放進正式路徑，也繞過 httpx 與錯誤處理。

### 1. 後端：可覆蓋的 GitHub 網址

- 新環境變數 `STARSCOPE_GITHUB_API_BASE`，只影響 `services/github.py` 的 `GITHUB_API_BASE`（模組載入時決定）。
- **只接受本機位址**：scheme 是 `http`，host 只收 `127.0.0.1`；不能帶帳密、query、fragment，path 只能是空的或 `/`。
  不收 `localhost`：它交給系統解析，可能先連 `::1`，而假 GitHub 只綁 127.0.0.1（11-24 審查後收窄）。
  其他值一律在啟動時丟錯，sidecar 起不來。
  理由：預設網址是 token 會送去的地方，改連的網址若不丟 token 也會收到。寧可大聲失敗，也不要默默改用真的 GitHub（測試會誤以為連的是假的），或把 token 送到別處。
- 沒設時照舊是 `https://api.github.com`。
- 送 security review（預設網址是 token 會送去的地方；改連的網址若不丟 token 也會收到）。11-24 審查後加的保護：
  - **打包版一律忽略**。PyInstaller 打包的 sidecar（`sys.frozen`）不讀這個變數，連檢查都不做，不讓奇怪的值把 app 弄到起不來。
    理由：Tauri 啟動 sidecar 時不清環境（`src-tauri/src/lib.rs` 只另外設幾個變數），使用者層級的環境變數都會傳進來，
    包括別的程式用 `launchctl setenv` 設的。只限本機位址擋不住「本機惡意程式開個 port 收 token」，而且不用經過 Keychain 的提示。
  - **網址被覆蓋時不帶 token**。`Authorization` 只送給真的 GitHub。e2e 本來就不帶 token，沒有功能損失。
  - 用解析出的 host／port **重組成標準形式的網址**（`http://{host}:{port}`），不直接用原始字串，避免不同解析器的解讀差異（例如 `127.0.0.1\@evil.com`）。
  - **沒有獨立資料目錄時起不來**（看 `db.database` 實際用的目錄，空字串或明確指到 `~/.starscope` 都算真實資料）。從原始碼跑的開發 sidecar（`start-dev.sh`）
    和 launchd 的 collector 都是這種：連假 GitHub 會讓本機資料和 GitHub 對不上（加入追蹤只改本機、不按 star）。e2e、CI、pytest 都有設；
    e2e 的設定漏了它時寧可起不來，不要默默改連真的 GitHub（第二輪審查 J1）。
  - **覆蓋時不走 proxy**（`trust_env=False`）：httpx 連 127.0.0.1 也會照 `HTTP_PROXY` 走 proxy，e2e 會連不到假 GitHub。
  - 覆蓋生效時、以及打包版有設但被忽略時，`get_github_service` 都印一行警告。
  - 假 GitHub 只綁 `127.0.0.1`。

### 2. 假 GitHub

- `e2e/fake_github/server.py`：只用 Python 標準函式庫（`http.server`）寫，用 sidecar 的 venv 跑，不加依賴。
- `GET /repos/{owner}/{repo}`：
  - 有資料的回 200，內容是 `e2e/fake_github/repos/{owner}__{repo}.json`，取自真實的 GitHub 回應，只錄一次；
    owner／repo 不分大小寫（GitHub 也是），用啟動時建的對照表查，不靠檔案系統（macOS 不分、Linux 分）；
  - 其他儲存庫回 404 `{"message": "Not Found"}`，和 GitHub 一樣。
- 其他端點與任何別的方法（含 HEAD、OPTIONS）：回 501，並在 **stderr** 印 `fake-github: unexpected request …`
  （Playwright 的 webServer 預設只轉 stderr，本機才看得到）。
- 每個請求都印一行，CI 失敗時可以從 log 看出打了什麼。
- 有健康檢查端點，讓 playwright／CI 等它起來。

### 3. 啟動

- `playwright.config.ts` 的 webServer：先啟動假 GitHub。sidecar 的指令一律帶
  `PYTHON_KEYRING_BACKEND=keyring.backends.null.Keyring GITHUB_TOKEN=`，再加上 `STARSCOPE_GITHUB_API_BASE=http://127.0.0.1:<port>`。拿掉 `E2E_NO_TOKEN` 的條件。
- `.github/workflows/test.yml`：先啟動假 GitHub、等它起來，sidecar 的 env 加上網址；跑完 e2e 後（`!cancelled()`，e2e 紅了也跑）檢查假 GitHub 的 log，
  有 `unexpected request`、或假 GitHub 已經沒有回應就判紅；失敗時 dump 假 GitHub 的 log。
  拿掉已經不準的「未認證 60 次／小時夠用」註解。

### 4. 文件

- CLAUDE.md 第 111 行的 `E2E_NO_TOKEN` 警告與第 115–116 行「上游 5xx 就查 githubstatus、重跑」改寫（假 GitHub 回的 501 會長得一樣）。
  改動前先給 user 看，用 claude-md-management。
- `e2e/helpers.ts` 的 FIXTURES 註解（「新增流程需要真的 GitHub repo」）改成假 GitHub 的說法。
- 體檢報告「e2e 改連假的 GitHub」待辦補狀態。

## 怎麼驗

- 後端單元測試：
  - 網址解析：沒設、合法的本機位址、`https`、別的 host、帶帳密、帶 path／query。
  - 設了之後，`GitHubService.get_repo` 真的打到那個網址（MockTransport 看 request URL）。
- 假 GitHub 的測試：放在 sidecar 的 pytest，啟動伺服器打幾個請求。涵蓋已知儲存庫回 200、未知儲存庫回 404、其他端點回 501 並記錄。
- e2e 全套（chromium／webkit／db-mutating）通過，再暫時打開 httpx 的 INFO log 跑一輪，確認 sidecar 對外沒有任何 `api.github.com` 的請求，假 GitHub 的 log 記到那 3 個 GET。
- 突變：拿掉本機位址限制、假 GitHub 對未知端點回 200 等，都要有測試會紅。

## 留給實作者

- port 號：sidecar 是 8009、vite 是 1421。假 GitHub 挑一個不衝突的，兩邊共用同一個常數或同一個值。
- 錄假資料時的欄位要不要裁減：保留完整回應最貼近真實，檔案也不大。
