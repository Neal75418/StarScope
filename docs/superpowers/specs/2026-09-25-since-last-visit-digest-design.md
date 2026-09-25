# 「自上次以來」摘要設計

Dashboard 現在要自己拼湊「發生了什麼」：十幾個 widget 各給一個角度，最上方的
AttentionBar 只列未處理的警報與 breaking／security release。資料其實都在——collector
每小時抓一次，早期訊號、release、HN 都寫進了資料庫——缺的是「打開 app 第一眼就知道
自上次以來發生了什麼」。

這份設計在 Dashboard 最上方放一個摘要面板，取代 AttentionBar，只講追蹤清單裡的 repo。

## 決定

| 項目 | 決定 |
|---|---|
| 送達方式 | 使用者自己打開 app；不做推播 |
| 內容範圍 | 只看追蹤清單（GitHub star）的重大變化；不含探索、不含影子池 |
| 時間範圍 | 自上次看過之後；看過的不再出現 |
| 呈現 | 兩層：重點＋預設收合的「其他更新」 |
| 位置 | Dashboard 最上方，取代 AttentionBar；有重點時啟動直接落在 Dashboard |
| 計算 | 後端讀取時即時計算；不新增資料表、不改 collector |

## 實測頻率

依據 2026-09-25 對真實資料庫（唯讀拷貝，98 個追蹤中的 repo，star 中位數約 5.9 萬）
統計的過去 30 天：

| 事件 | 頻率 |
|---|---|
| release | 每天中位數 4、最多 8；30 天只有 3 天是 0 |
| 　帶 breaking／security／deprecation 標記 | 30 天 6／4／11 次 |
| HN 提及 | 30 天 22 次；分數 ≥ 50 的 7 次 |
| early signal | 開始收集以來共 27 個，其中 20 個是低嚴重度 `sudden_spike` |

所以「重點」平均每天不到一條，一般 release 才是量的來源——這是分兩層的理由。

## 分層規則

**重點**（不設上限）：

- release 帶 `breaking` 或 `security` 標記
- early signal 嚴重度 `high` 或 `medium`（任何類型）
- HN 討論分數 ≥ 50
- 觸發的警報

**其他更新**（預設收合，只回最新 50 條＋總數）：

- 其餘 release（只帶 `deprecation` 的也在這裡，顯示標籤）
- 低嚴重度 early signal
- 分數 < 50 的 HN 討論

同一件事只出現一次：已經有 `viral_hn` 訊號的 HN 討論，以訊號那條呈現
（同一 repo，比對 `early_signals.context_title` 與 `context_signals.title[:255]`——
前者寫入時截到 255 字）。

star 暴漲不另寫規則，沿用 early signals（`sudden_spike`／`breakout`／`rising_star`）。
偵測只有一套，數字才不會兩處不一致。代價：目前的 `sudden_spike` 大多是低嚴重度，
會落在「其他更新」。

加入追蹤之前的歷史不列入：新追蹤的 repo 會補抓回舊 HN 討論與最新 release（可能是幾年前的），
事件時間早於 `repos.added_at` 超過 3 天的 release／HN 略過（緩衝留給「剛好在 star 之前發生、
也是 star 原因」的事）。游標照樣越過這些列。

已取消 star 的 repo（`repos.unstarred_at` 非空，即封存）不列入；全域的 archive filter
已經會濾掉它們，`build_digest` 不必自己再寫一次條件。

## 「看過」的判定

### 游標用資料列 id，不用時間

release 與 HN 寫入都是 upsert，每次重抓都會刷新 `fetched_at`；發佈時間
（`published_at`）則可能早於 StarScope 得知的時間（離線三天後才抓到一個四天前的
release）。兩種時間都不能當「新」的判準。資料列 `id` 只有真的新增時才會變大，
upsert 撞既有資料時不變，所以游標是三張表各自看過的最大 id：

```json
{"context_signal_id": 1317, "early_signal_id": 27, "triggered_alert_id": 0, "seen_at": "2026-09-25T13:00:00Z"}
```

存在 app settings（`AppSettingKey.DIGEST_CURSOR`，值為 JSON）。`seen_at` 只用來顯示
「上次看過：3 天前」，不參與篩選。

### 什麼時候推進

1. Dashboard 載入時 `GET /api/digest`，拿到 id 大於游標的項目，以及這批的最大 id。
2. 面板顯示成功後 `POST /api/digest/seen`，帶**這批回應裡的**最大 id。
   不用送出當下的最大 id：GET 與 POST 之間 collector 可能寫入新資料，那會被跳過。
3. 後端對每張表取 max(現值, 新值)——游標只前進、不倒退，重送無害。

面板真的渲染時才送（Dashboard 在載入骨架、錯誤畫面、引導卡時不渲染面板，但 hook 必須無條件
呼叫），而且每一批只送一次——換頁回來重新掛載時，若把快取裡舊的 cursor 再送一次，會蓋掉刪除後
被壓低的游標。重整合併時取最新回應的 cursor，不取 max，理由相同。

同一次開 app 期間這批一直留著：換頁、切視窗都不重抓不清空。手動重整時重新 GET，
把新項目附加到這批，再推進游標。下次開 app 才只剩之後的新東西。

### 沒有游標時

第一次使用顯示最近 3 天的事件（依 `published_at`／`detected_at`／`triggered_at`），
不把歷史資料全倒出來。

### 游標與資料的一致性

- **重設所有資料**（`POST /api/settings/reset-data`）會清空三張表、id 從頭算，但保留
  app settings。這個 endpoint 必須同時刪除 `DIGEST_CURSOR`，否則摘要會空到 id 追上
  舊游標為止。
- 游標與資料在同一個資料庫檔：還原備份時兩者一起回到同一個時間點，不會錯位。
- **rowid 重用**：三張表沒有 `AUTOINCREMENT`，「目前最大的那幾列」被刪掉後新列會重用 id，
  游標若停在被刪掉的 id，新列會被當成看過。會刪這三張表的路徑：刪警報規則（cascade
  `triggered_alerts`）、永久刪 repo（cascade 三張表）、context 訊號清理（保留期、每 repo 上限、
  不相關 HN）、重設所有資料。前三條刪完都呼叫 `lower_cursor_to_existing`，把游標壓到現有最大 id
  （`seen_at` 不變）；重設則直接清掉游標。殘留：刪除與壓游標之間剛好有 collector 寫入的極小窗口。
  根本解是重建成 `AUTOINCREMENT`，那需要正式引入 alembic（見 CLAUDE.md），2026-09-25 決定不做。

## 一併修正：已處理的 early signal 會被重建

去重（當時的 `anomaly_detector._build_active_signals_set` 與單次查詢版，現為 `_build_active_severity_map`／`_active_severity`）只看「未過期且
未處理」的訊號。使用者在 SignalSpotlight 按掉一個訊號後，只要條件仍成立，下一次抓取
就重建一筆——拿到新 id，在摘要裡以新項目身分再出現一次。

改成「未過期」即視為已存在，不論是否處理過。副作用（也是正確語意）：按掉的訊號在
過期前不會回到 SignalSpotlight。

例外是升級（同告警系統的語意：同一件事、同一個等級只算一次，嚴重度升高是新狀況）：
去重記住每個 (repo, 類型) 未過期訊號的最高嚴重度，只擋同級或較低的；更嚴重的會建新的一筆，
寫入時讓被取代的（較低的）那筆過期，SignalSpotlight 只剩一筆，新的一筆出現在摘要裡。
一次升好幾級（例如 HN 分數 150 → 260 → 620）會留下好幾筆，摘要每個 (repo, 類型) 只列最新那筆。

## API

`services/digest.py` 的核心是純函式 `build_digest(db, cursor) -> Digest`，分層規則
只在這裡。每個項目：

| 欄位 | 內容 |
|---|---|
| `key` | `來源:id`，例如 `release:1290`，前端的穩定 key |
| `tier` | `highlight` 或 `other` |
| `kind` | `release`、`signal`、`hn`、`alert` |
| `repo` | `{id, full_name, url}` |
| `occurred_at` | 事件本身的時間（發佈／偵測／觸發），帶 `+00:00` 的 ISO 字串——DB 存 naive UTC，不帶時區的字串會被前端 `new Date()` 當成本地時間 |
| `url` | release 或 HN 的網址；訊號與警報沒有 |
| 類型專屬欄位 | release：`tag`、`tags`；HN：`title`、`score`；signal：`signal_type`、`severity`、數值；alert：規則名稱與觸發值 |

後端不組顯示文字，前端依語系渲染（與 early signal 的做法一致）。

`routers/digest.py`（兩支都是 `def`）：

- `GET /api/digest` → `{items, other_total, cursor, last_seen_at, releases_checked}`
  - `cursor` 是這批的最大 id
  - `releases_checked`：release 是否曾經抓取過。沿用 weekly summary 的
    `releases_ever_fetched` 判定——AttentionBar 原本從週報拿這個旗標，取代之後改由 digest 提供
- `POST /api/digest/seen`，body `{cursor}` → 逐欄 max 後寫回

排序：重點依 `occurred_at` 由新到舊；其他更新同。

## 畫面

`DigestPanel` 取代 `AttentionBar`，放在 Dashboard 最上方：

```
自上次以來有 2 件事 · 上次看過 3 天前          追蹤 98 個 · 5 分鐘前更新 ↻

🔴 tauri-apps/tauri   v3.0.0 — breaking · security          2 天前
🔥 astral-sh/uv       HN 討論 312 分：「uv is …」             昨天

▸ 其他更新（14）
```

沿用 AttentionBar 的承諾——這是整頁唯一「你可以不看」的地方，宣稱沒事之前要先確定檢查
跑得起來：

| 狀態 | 顯示 |
|---|---|
| 載入中 | 骨架；不能先說沒事 |
| release 從未抓取過 | 「還在檢查」 |
| 沒有新東西 | 「自上次（3 天前）以來沒有值得注意的變化」；沒設警報規則時附註 |
| API 失敗 | 「摘要載入失敗」＋重試；絕不顯示成沒事 |

每列：類型圖示、repo、一句話結論、相對時間。點擊用 `safeOpenUrl` 開外部頁面：
release 與 HN 開自己的網址，訊號與警報開該 repo 的 GitHub 頁面（app 沒有 repo 詳細頁）。其他更新展開後依時間排序，被截斷時最後一列是
「還有 N 條」。追蹤數、更新時間、重整按鈕與「抓取中」回饋照搬 AttentionBar。

### 啟動頁

「有新東西」定義為**有重點**——一般 release 幾乎天天有，算進去等於每次都跳 Dashboard。
App 啟動時先等 digest 回應再決定第一頁：有重點落在 Dashboard，沒有就回上次的頁面。
發行版的 sidecar 冷啟動要好幾秒，所以先等它答得出 health（每 500ms 探一次，最多 30 秒），
連上之後才給 digest 1 秒；逾時或失敗照舊回上次的頁面。等待期間顯示載入畫面——那段時間
每一頁本來也拿不到資料。先等再決定是為了不閃：不先畫上次的頁、再跳走。

這個查詢與面板共用同一個 query key，面板不會再打一次。

## 不做的事

- 推播（collector 不送通知，`useNotificationPolling` 不動）
- 探索／影子池／加速度排序（for-you-feed 設計的 Phase B 維持擱置）
- 「標為未讀」：打開一眼就關也算看過；面板寫出「上次看過」的時間，讓這件事看得見
- 另一套從快照算暴漲的規則

## 測試

後端（`build_digest` 與 router）：

- 分層邊界：HN 49／50 分；只有 deprecation 的 release；low 與 medium 的訊號
- `viral_hn` 與同一則 HN 只出現一次
- 取消 star（封存）的 repo 不列入
- 三張表各自依 id 篩選；沒有游標時的 3 天窗口
- 其他更新上限 50＋`other_total`；重點不截斷
- **回歸**：用 `release_fetcher` 真的 upsert 重抓一筆既有 release（`fetched_at` 被刷新），不會重新出現
- `seen` 只進不退、重送無害；GET 後、POST 前插入的新列，下一次仍看得到
- 重設所有資料會一併清掉游標
- early signal：已處理且未過期的不重建；過期後才重建

前端：

- `DigestPanel` 各狀態：載入、檢查中、空、失敗、有資料、截斷；失敗時不顯示「沒事」
- 同 session 保留、重整只附加；`seen` 在顯示成功後送一次，失敗不送
- 啟動頁：有重點→Dashboard；無重點／逾時／失敗→上次的頁面
- 中英文案
- AttentionBar 與其測試移除，掃一遍其他引用

實作完成後以真實資料的唯讀拷貝跑一次 `build_digest`，確認「重點平均每天不到一條」
在真實資料上成立。2026-09-25 實測（98 個 repo）：30 天重點 17 條（每天 0.57）、其他更新 143 條（每天 4.8）。

e2e 的資料庫是空的，Dashboard 此時只渲染引導卡、不渲染任何 widget，摘要面板不會出現。
所以 e2e 只驗證引導卡照舊出現（摘要請求不能把它弄壞）；面板本身由單元測試覆蓋，
另在隔離的 sidecar 上用瀏覽器實際操作一次。
