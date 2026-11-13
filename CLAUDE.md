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
- **題庫自動出題**（2026-11-13 使用者要求「可以選擇手動或自動來顯示題目」）：題庫卡 `autoPanel()` 切 `S.auto.mode`（manual／auto，存 `tch.auto`：`ask` 作答秒數 5～600、`reveal` 公布停留 0～120、`early` 全班答完提早截止、`hide` 作答時隱藏結果）。執行狀態 `AUTO {on, paused, phase:'ask'|'reveal', until, left}`，`autoTick()` 掛在 200ms 的 `tTick`（切到其他工具也繼續跑）：ask 到時或 `tally().voters >= studentCount()` → 截止＋公布＋`setTeacher`；reveal 到時 → `nextBankIdx()` 出下一題，沒了就 archive＋停止。倒數顯示在黑板 `#vAuto`。老師手動按截止／下一題／重新開放／出這題 → `autoStop('已切回手動出題')`。驗證：3 題、6 秒＋3 秒，學生答完第 1 題提早截止並看到「答對了」、2、3 題時間到截止、出完自動停止；暫停 3 秒倒數不動、繼續後接著倒數。
- 測試注意：本機 port 8875 曾開過舊版，Service Worker 會先給快取的舊 app.js，測新功能前先 unregister＋清 caches。
- **關閉教室後舊連結失效**（2026-11-13 使用者要求）：「中斷」改成「🚪 關閉教室」→ `netStop(true)` 先送 `{t:'close'}`（轉播站把所有人 4004 並刪金鑰），再刪本機 `tkey.／pw.／vcur.<代碼>`；「換代碼」也會關掉舊教室。代碼只在同一分頁重新整理時沿用（sessionStorage），不再沿用「上次用的代碼」。轉播站：教室模式下沒有老師紀錄的房間學生一律 4004 → 學生頁顯示「🚪 這間教室已關閉，或老師還沒開放」＋再試一次／輸入新代碼，不自動重連。
- **📝 測驗分頁**（2026-11-13 使用者要求「新增分頁測驗，呈現類似即時投票，下載時要有學生答對或答錯的成績清單」）：`TABS` 加 `quiz`，`renderQuiz()`（連線卡＋題庫卡＋成績卡），舞台與投票共用 `votePaint()`（`tabPoll()`：進行中的題目帶 `quiz` 旗標，各分頁只顯示自己的；`isVT()` 取代原本所有 `S.tab==='vote'` 判斷）。題庫、自動出題、成績從投票分頁搬到測驗分頁；投票分頁不再有「記名計分」勾選（投票一律不計分，測驗一律記名）。
- 測驗場次 `S.qs {id, name, at}`（localStorage `quizSess`）：題目紀錄帶 `quiz/qid/qname`；`scoreRows(qid)` 只算該場有答案的題目（含進行中那題）。成績表欄位：學號、姓名、第 N 題（`✔ 答對（B）`／`✘ 答錯（C）`／未作答）、答對／答錯／未作答題數、總題數、得分；下方每題：正確答案、答對／答錯人數、答對率、答對名單、答錯名單（附選項）、未作答名單。**人員順序用 `order` 陣列**（全數字學號當物件 key 會被 JS 排到最前面，踩過）。`🏅 排行榜` `openBoard()`、`🆕 開始新測驗` `newQuiz()`、之前場次 `quizSessions()` 可再下載。手動出投票（`vStart()` 不帶題目）會先 `autoStop()`。
- **教室大廳＋教室名稱**（2026-11-13 使用者要求「主頁顯示教室登入，輸入密碼登入、教室可命名；主頁顯示目前幾個教室與名稱」）：連線卡「教室名稱」＋「公開在首頁教室大廳」（`rinfo.<代碼>`），連線時 `sendRoomInfo()` 送 `{t:'room'}`；名稱顯示在大黑板待機畫面。頂列「🏫 N 間教室」（`LOBBY_URL`＝轉播站 `/lobby`，20 秒更新一次，滑過顯示名稱）→ `openLobby()` 清單；「🎓 學生登入」→ `?join` 學生入口頁＝教室清單＋代碼輸入。點教室 `lobbyPick()`：要密碼就跳密碼框 → `goRoom(代碼, 密碼)`（學生頁直接 `joinStart`；老師頁若還開著教室就另開分頁）。關閉教室會刪 `rinfo` 並重讀大廳。
- **題庫答案**（2026-11-13 使用者要求「輸入或上傳題庫時有答案也一併紀錄，以便統計答對題數」）：匯入預覽與題庫卡顯示有／沒有答案題數；每題「✏ 答案」`bankEdit()`；「➕ 手動新增一題」`bankAddModal()`（選項空白＝是非題，答案用 `TCHIO.normAns`，兩個以上字母自動成多選）。題庫出題時 `cur.bankIdx` 記住來源，`vAnsOk` 設答案時 `bankSetAns()` 寫回題庫（會比對題目文字防錯位）。截止且有答案時 `#vCnt` 顯示答對／答錯人數。
- **括號答案**（2026-11-13 使用者回報「答案格式是 ( )，請不要把答案顯示在題目中」）：`io.js` `takeAns()` 把題目開頭／結尾的 `(B)`、`（ b ）`、`（Ｏ）` 拿掉當答案（題號前、題號後、題目最後都可），題號前空白括號 `（　）` 直接拿掉，題目中間的填空括號保留；`parseQuizText` 的題目行、無題號題目行、`finishQ`（含 Excel／CSV 題目欄，沒有答案欄才用括號答案）都會套用。**踩坑**：正規表示式寫在 JS 字串裡 `'\s'` 會變成 `s`，要用 regex 字面值。`node tools/test_io.mjs` 有 8 個括號案例。已匯入的舊題庫要重新匯入才會清掉題目裡的答案。
- **答案公布方式＋隨機題數**（2026-11-13）：`S.quizOpt {reveal:'now'|'end'|'none', order:'seq'|'rand', n:0=全部}`（`tch.quizOpt`），題庫卡 `quizOptPanel()`。
  - 出題範圍 `S.bank.order`（`makeOrder()`：依序或洗牌後取前 n 題；`bankOrder()` 懶建立、`reorderBank()` 改設定／重新開始時重建並清 `used`），`nextBankIdx()`／`roundPos()` 都以 order 為準；不在這輪的題目淡化標「這輪不出」。
  - `showAns(p)`：測驗題只有 now 會把答案放進老師狀態代碼、黑板標答案與答對人數。狀態代碼多第 8 欄 `e`（答完公布）／`x`（不公布）：`T|v|pid|n|S|c||e`。
  - `revealAll()`：答完公布時把本場有答案的題目用聊天送 `K<rid>.<i>/<n>:<pid><答案>,…`（每則 ≤60 字），老師狀態 `T|r|<rid>|<則數>|<題數>`；手機 `JS.rk[rid]` 收答案、用自己存的作答 `JS.mine`（`tch.mine.<代碼>`，`voteSend` 時記）在本機算對錯 → `joinResult()`。**rid 每次公布不同**，否則手機會把前一輪的答案混進來（踩過）。自動出題這輪出完且模式是 end 會自動 `revealAll()`。
  - 測驗題沒人作答也會記錄（`archivePoll` 對 `p.quiz` 一律寫入），成績與公布結果才有「未作答」。
