# teacher-classroom-helper — 講師課堂小幫手

投影上課用的五合一單頁工具：🎯 抽籤點名、👥 隨機分組、⏱ 計時器（倒數＋碼表）、🔔 搶答器（現場按鍵／手機搶答）、🗳 匿名即時投票（學生掃 QR code 用手機作答）。2026-11-13 建立。

- 純靜態：`index.html`（CSS＋外殼）＋`io.js`（檔案讀寫與解析）＋`app.js`（畫面邏輯）＋`manual.html`＋PWA。無框架、無建置。
- 本機預覽 port **8875**（`.claude/launch.json` 的 `teacher-classroom-helper`）。visitor-badge `m255525.teacherclassroomhelper`。
- 部署：`.github/workflows/pages.yml`（push master 自動部署）。**2026-11-13 已上線** <https://m255525.github.io/teacher-classroom-helper/>（repo 由使用者自己 `gh repo create`；第一次 push 時 Pages 還沒開，run 失敗，開 Pages 後 rerun 成功）。網址（寫死在 `app.js` 的 `ONLINE`，QR code 在非 github.io 網址時一律指向它）。

## 手機連線（借用創業島轉播站，Worker 一行都沒改）
- 連 `wss://startup-island-presence.content-workflow.workers.dev/ws?room=VOTE<6碼>`（10 字元，落在 Worker `ROOM` 規則 3～12 碼；創業島隨機房間是 6 碼、創作者小鎮用 CT 前綴，不會撞）。網址加 `?presence=ws://…` 可改連本機轉播站。
- **狀態全部塞在 presence 協定的 `name` 欄位（≤24 字）**，用 `hello`/`look` 傳，snapshot 會帶回所有人目前的 name，所以老師重新整理也能重建票數：
  - 老師：`T|w`（待機）、`T|v|<pid4>|<選項數>|<題型 s/m/t/r/u>|<o開放/c截止>|<答案字母>`、`T|b|<rid4>|<p倒數/o開放>`。
  - 學生：`W`、`S|<pid>|<字母>`（多選如 `AC`）、`B|<rid>|<暱稱≤12>`。
  - pid／rid 用 4 位隨機數字（不用遞增，避免清資料後撞到舊票；不用英文以免碰到 Worker 的不雅字詞過濾把整個 name 換成「旅人」）。
- **題目與選項文字**用 `chat` 送（Worker 限制每則 ≤60 字、間隔 ≥2.5 秒）：`Q<pid>:題目`、`O<pid>.<k>:選項 ｜ 選項…`，分隔符前後要有空格（Worker 的網址過濾 `\S*` 會吃掉後面不含空白的字）。老師端 `NET.q` 佇列每 2.7 秒送一則、收到 `chatSlow` 會重送；重新連線時若題目仍開放會重送。學生只收目前 name 開頭 `T|` 的人送的訊息。
- 學生 id 依房間存 `tch.sid.<碼>`，重新整理不會重複計票（同 id 重連 Worker 會踢掉舊連線）；最後一次的 name 存 `tch.my.<碼>`，重連時 hello 直接帶上。老師 id 每次載入隨機。
- 計票只在老師端（`onPeerName`），學生離線票仍保留；截止後不再收。手機搶答的先後＝老師端收到 look 的順序與 `performance.now()`。
- Worker 白名單 Origin：`m255525.github.io`、localhost／127.0.0.1、`null`。用 192.168.x 區網網址開會被擋。

## 其他
- localStorage 前綴 `tch.`：`pref`、`rosters`、`cur`、`drawn`、`drawOpt`、`grp`、`timer`、`buzz`、`vote`（含進行中的題目與票數）、`polls`（本機紀錄，最多 100）、`room`、`tab`、`fold`、`warnSeen`、`marquee`、`nick`、`stuno`、`bank`。備份 JSON `app:'teacher-classroom-helper'` 帶 pref～polls 與 bank。
- 亂數一律 `crypto.getRandomValues`。音效用 WebAudio 合成（`SND`），不載音檔。QR 用 cdnjs `qrcodejs/1.0.0`，點開時才載入。
- 學生頁 `?join=CODE`（`JOIN` 模式）只顯示作答介面，不跳首訪警語（頁尾有連結）。
- 測試掛鉤 `window._tch`。
- 驗證方式（2026-11-13）：Playwright 老師分頁＋兩個 isolatedContext 學生分頁連正式轉播站（隨機房間）：題目選項同步、改票不重複計、截止＋答案→學生「答對了」、手機搶答順序與秒差、現場按鍵犯規、5 個工具 375px 無橫向溢出、無 console 錯誤。**真手機掃 QR 與投影機實機未測**。

## 標準配備
跑馬燈（不可關）、⚙ 常用設定（收合式，含關於本工具）、首訪警語＋頁尾入口、`manual.html#creator` 完整版（改 `tools/manual_body.html` 後跑 `tools/build_manual.py`）、PWA（`tools/make_icons.py`；改版升 `service-worker.js` 的 `CACHE_NAME`）、訪客計數器。

## 名單匯入匯出、題庫、記名計分（2026-11-13 使用者要求）
- **`io.js`（`window.TCHIO`）**：自寫 zip 讀寫（`DecompressionStream('deflate-raw')` 解壓、寫出用不壓縮 zip＋CRC32）→ 讀 .xlsx（sharedStrings／inlineStr、第一個工作表）、.docx（`word/document.xml` 每段一行）、CSV（UTF-8 失敗改 Big5）；寫 .xlsx（含 styles.xml：標題列粗體、凍結首列，已用 openpyxl 與真的 Excel COM 開啟驗證）與 CSV（BOM、0 開頭學號寫成 `="0123"`）。**刻意不用 SheetJS**（cdnjs 只有 0.18.5，有 CVE-2023-30533）；舊版 .xls／.doc 會提示另存。
- 名單：roster 多 `ids:{姓名:學號}`、`show:'name'|'both'|'id'`（投影顯示，`disp()`）。`rowsToRoster` 欄位優先序 學號＞學員編號／id＞座號（同時有座號與學號時曾抓錯）。名單視窗可上傳、下載 CSV／Excel（附出席、組別、抽籤順序）。
- 題庫 `tch.bank {name, items:[{q,type,opts,ans}], used:[]}`：`parseQuizText`（題號「1.」「一、」「(B)1.」、選項分行或同行 `(A)…(B)…`、「答案：」、O/X 是非題）、`rowsToQuiz`（題目／選項A～H／答案欄）。**Word 自動編號**：段落 numPr 或樣式（styles.xml）裡的 numPr，第一種 numId:ilvl＝題目（補 `#Q `），其他＝選項（`#O `）。
- 記名計分：老師勾 `vote.named` → 狀態代碼題型字母改大寫（`T|v|pid|n|S|o|`）；學生手機先要求學號（`tch.stuno`），name 變 `S|pid|選項|學號`（總長 >24 會擋下提示）。老師端 `p.who{peerId:學號}`，`pollRecord()` 存 `answers{學號:選項}`、`ansL`。`scoreRows()`：記名＋有答案的題目（含目前這題），名單有學號的學生全列（沒作答 0 分），依答對數排序，下方附各題答對率。
- 題目文字現在先送選項 `O…` 再送題目 `Q…`（手機按鈕要用選項文字）。
- 測試：`node tools/test_io.mjs`（解析器）；瀏覽器用 python-docx／openpyxl 產的真檔案＋Big5 CSV 測過。

## 多教室隔離（2026-11-13）
- **每個分頁一個代碼**：目前代碼存 sessionStorage `tch.room`（重新整理保留），localStorage `room` 只當「上次用的代碼」。按「開放手機連線」時用 `BroadcastChannel('tch-room')` 問其他分頁有沒有在用（300ms），有就換新代碼；複製分頁（會連 sessionStorage 一起複製）載入時也會檢查，撞到就不自動連線。
- 進行中的題目改存 sessionStorage `vcur`＋localStorage `vcur.<代碼>`（隔天開同代碼可接續）；`vote` 不再含 cur（`saveVote()`）。本機紀錄 `polls` 每筆多 `rid`（班級），寫入前先重讀避免兩分頁互蓋，紀錄卡、CSV、成績、清除都只看目前班級（`myPolls()`）。
- **轉播站教室模式**（見創業島 CLAUDE.md「教室模式」）：連線都帶 `cls=1`；老師另帶 `tkey`（每個代碼一把，存 localStorage `tkey.<代碼>`），學生只看得到老師、看不到彼此作答。關閉碼：4001 金鑰不符 → 自動換新代碼；4003 密碼錯 → 學生端顯示密碼輸入框；4002 id 被占 → 換 id 重連。
- **教室密碼**（選填，英數 ≤8，存 `pw.<代碼>`）：連線卡「設密碼」，QR／連結帶 `&pw=`，學生用代碼手動加入時才需要輸入（存 `spw.<代碼>`）。改密碼會重新連線，已加入的學生要重新輸入。
- **加入時先輸入學號或姓名**（2026-11-13 使用者要求）：學生頁在密碼之後、作答之前一定要填（`tch.who`，舊的 `stuno` 會接手），右上 👤 可改；之後學生狀態代碼最後一段一律帶它：`W|誰`、`S|題號|選項|誰`、`B|輪次|誰`（`withWho()`；原本的搶答暱稱與記名時才問學號都拿掉）。老師端 `NET.who` 記 peer→誰，`resolveWho()` 依目前班級名單用學號或姓名對應同一人，`whoLabel()` 照「投影時顯示」顯示（搶答名單用它）。連線卡「👥 已加入 N 人（名單內 x/y）」→「看名單」：已加入／名單外／還沒加入＋下載點名 CSV。成績 `scoreRows()` 也用 `resolveWho()` 合併（輸入姓名的學生對到學號那一列）。
- 踩坑：用全域字串取代把 `lsPut('vote', …)` 換成 `saveVote()` 時，連 `saveVote()` 本身裡的那一行也被換掉 → 無限遞迴、投票沒存（console 才看得到），已修正。
