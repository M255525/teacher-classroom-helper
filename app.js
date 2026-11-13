/* 講師課堂小幫手：抽籤點名、隨機分組、計時器、搶答器、匿名即時投票
   投票與手機搶答借用創業島的轉播站（Cloudflare Worker startup-island-presence 的房間功能，room=VOTE+6 碼），
   只轉播「狀態代碼」：老師 T|…、學生 S|題號|選項、B|輪次|暱稱，不傳名單姓名，轉播站也不儲存。 */
(function(){
'use strict';

/* ---------- 小工具 ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const P = 'tch.';
const lsGet = (k) => { try { return localStorage.getItem(P + k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(P + k, v); } catch (e) {} };
const lsDel = (k) => { try { localStorage.removeItem(P + k); } catch (e) {} };
const lsJson = (k, d) => { try { const v = JSON.parse(lsGet(k)); return v == null ? d : v; } catch (e) { return d; } };
const lsPut = (k, o) => lsSet(k, JSON.stringify(o));
// 每個分頁各自的資料（目前教室代碼、進行中的題目）：sessionStorage
const ssGet = (k) => { try { return sessionStorage.getItem(P + k); } catch (e) { return null; } };
const ssSet = (k, v) => { try { sessionStorage.setItem(P + k, v); } catch (e) {} };
const ssDel = (k) => { try { sessionStorage.removeItem(P + k); } catch (e) {} };
const ssJson = (k, d) => { try { const v = JSON.parse(ssGet(k)); return v == null ? d : v; } catch (e) { return d; } };
const rnd = (n) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const chars = (s) => Array.from(String(s || ''));
const cut = (s, n) => chars(s).slice(0, n).join('');
const randId = () => { let s = ''; while (s.length < 12) s += rnd(36).toString(36); return s; };
const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => { let s = ''; for (let i = 0; i < 6; i++) s += CODE_ABC[rnd(CODE_ABC.length)]; return s; };
const pid4 = () => String(1000 + rnd(9000));
const QS = new URLSearchParams(location.search);
const ONLINE = 'https://m255525.github.io/teacher-classroom-helper/';
const PRESENCE = QS.get('presence') || 'wss://startup-island-presence.content-workflow.workers.dev/ws';
const LOBBY_URL = PRESENCE.replace(/^ws/, 'http').replace(/\/ws(\?.*)?$/, '/lobby');
const LOB = {rooms:[], at:0, err:false, t:0};
function fetchLobby(){
  return fetch(LOBBY_URL, {cache:'no-store'}).then((r) => r.json()).then((d) => { LOB.rooms = Array.isArray(d.rooms) ? d.rooms : []; LOB.at = Date.now(); LOB.err = false; paintLobby(); })
    .catch(() => { LOB.err = true; paintLobby(); });
}
function startLobby(){ fetchLobby(); clearInterval(LOB.t); LOB.t = setInterval(() => { if (!document.hidden) fetchLobby(); }, 20000); }
function lobbyListHtml(){
  if (!LOB.at) return '<p class="small">讀取中⋯</p>';
  if (!LOB.rooms.length) return '<p class="small">' + (LOB.err ? '連不上教室大廳，請檢查網路。' : '目前沒有公開的教室。可以改用老師給的 6 碼代碼加入。') + '</p>';
  return '<div class="opts">' + LOB.rooms.map((x, i) => '<button class="opt" style="--bc:' + COLORS[i % COLORS.length] + '" data-room="' + esc(x.code) + '" data-rpw="' + (x.pw ? 1 : 0) + '" data-rname="' + esc(x.name) + '"><span class="lb">🏫</span><span>' + esc(x.name) + '<br><small style="font-weight:500;opacity:.8">' + (x.pw ? '🔒 要密碼' : '🔓 不用密碼') + '・' + x.n + ' 人在教室</small></span></button>').join('') + '</div>';
}
function paintLobby(){
  const c = $('lobbyChip'); if (c) { c.textContent = '🏫 ' + (LOB.at ? LOB.rooms.length + ' 間教室' : '教室大廳'); c.title = LOB.rooms.map((x) => x.name).join('、') || '目前沒有公開的教室'; }
  const l = $('lobbyList'); if (l) l.innerHTML = lobbyListHtml();
  const n = $('lobbyCnt'); if (n) n.textContent = LOB.at ? '目前 ' + LOB.rooms.length + ' 間教室' : '';
}
function openLobby(){
  openModal('<h2>🏫 教室大廳</h2><p class="small"><span id="lobbyCnt"></span>（老師幫教室命名並勾「公開在大廳」才會出現在這裡）。點教室、輸入密碼就能進入。</p><div id="lobbyList"></div>' +
    '<div class="stack"><button class="btn alt" data-act="lobbyRefresh">🔄 重新整理</button><button class="btn alt" data-act="lobbyCode">⌨ 用 6 碼代碼加入</button><button class="btn" data-act="close">關閉</button></div>', true);
  paintLobby(); fetchLobby();
}
// 選了大廳裡的教室：要密碼就先問，再帶著代碼（＋密碼）進入學生作答頁
function lobbyPick(code, needPw, name){
  if (needPw) {
    openModal('<h2>🔒 ' + esc(name) + '</h2><p>請輸入老師公布的教室密碼。</p><form class="codeIn" id="lobbyPwForm" data-code="' + esc(code) + '"><input class="tx" id="lobbyPwIn" maxlength="8" autocomplete="off" autocapitalize="characters" aria-label="教室密碼" style="text-transform:uppercase"><button class="btn y">進入教室</button></form><div class="stack"><button class="btn alt" data-act="close">取消</button></div>');
    setTimeout(() => { const el = $('lobbyPwIn'); if (el) el.focus(); }, 50);
    return;
  }
  goRoom(code, '');
}
function goRoom(code, pw){
  const extra = QS.get('presence') ? '&presence=' + encodeURIComponent(QS.get('presence')) : '';
  if (pw) lsSet('spw.' + code, pw);
  if (JOIN) { closeModal(); history.replaceState(null, '', '?join=' + code + extra); JS.closed = false; joinStart(code); return; }
  const url = '?join=' + code + (pw ? '&pw=' + encodeURIComponent(pw) : '') + extra;
  if (NET.want) window.open(url, '_blank'); else location.href = url; // 老師這頁還開著教室就另開分頁，免得把教室關掉
}
const COLORS = ['var(--y)', 'var(--p)', 'var(--b)', 'var(--o)', 'var(--g)', 'var(--v)', 'var(--r)'];
const LETTERS = 'ABCDEFGH';
const VOTE_TYPES = {
  s: {n:'單選', labels:null},
  m: {n:'多選', labels:null},
  t: {n:'是非', labels:['是', '否'], marks:['⭕', '❌']},
  r: {n:'1–5 分', labels:['1 分', '2 分', '3 分', '4 分', '5 分'], marks:['1', '2', '3', '4', '5']},
  u: {n:'懂了嗎', labels:['懂了', '有點懂', '不懂'], marks:['😀', '🤔', '😵']},
};
const TABS = [
  {id:'draw', ic:'🎯', n:'抽籤點名'},
  {id:'group', ic:'👥', n:'隨機分組'},
  {id:'timer', ic:'⏱', n:'計時器'},
  {id:'buzz', ic:'🔔', n:'搶答器'},
  {id:'vote', ic:'🗳', n:'即時投票'},
  {id:'quiz', ic:'📝', n:'測驗'},
];

/* ---------- 狀態 ---------- */
const seatList = (n) => Array.from({length:n}, (_, i) => (i + 1) + ' 號');
const S = {
  tab: lsGet('tab') || 'draw',
  pref: Object.assign({theme:'board', fs:'m', sound:true, vol:.7}, lsJson('pref', {})),
  rosters: lsJson('rosters', null) || [{id:'r1', name:'範例班（座號 1–30）', list:seatList(30), absent:[]}],
  cur: lsGet('cur') || 'r1',
  drawn: lsJson('drawn', {}),
  drawOpt: Object.assign({noRepeat:true, count:1}, lsJson('drawOpt', {})),
  grp: Object.assign({mode:'n', n:4, size:4, leader:false, last:null}, lsJson('grp', {})),
  tset: Object.assign({mode:'down', total:300, beep:true}, lsJson('timer', {})),
  buzz: Object.assign({src:'local', count:4, teams:null}, lsJson('buzz', {})),
  vote: Object.assign({type:'s', q:'', opts:'', named:false}, lsJson('vote', {}), {cur:null}),
  polls: lsJson('polls', []),
  bank: Object.assign({name:'', items:[], used:[]}, lsJson('bank', {})),
  qs: lsJson('quizSess', null) || {id:'q' + Date.now().toString(36), name:'', at:''},
  auto: Object.assign({mode:'manual', ask:30, reveal:6, early:true, hide:true}, lsJson('auto', {})),
};
if (!TABS.some((t) => t.id === S.tab)) S.tab = 'draw';
if (!S.buzz.teams) S.buzz.teams = Array.from({length:6}, (_, i) => ({n:'第 ' + (i + 1) + ' 組', s:0}));
const saveRosters = () => { lsPut('rosters', S.rosters); lsSet('cur', S.cur); };
const roster = () => S.rosters.find((r) => r.id === S.cur) || S.rosters[0];
const disp = (n, r) => { r = r || roster(); const id = (r.ids || {})[n], m = r.show || 'name'; return !id || m === 'name' ? n : m === 'id' ? id : id + ' ' + n; };
const present = (r) => { r = r || roster(); const ab = new Set(r.absent || []); return r.list.filter((n) => !ab.has(n)); };

/* ---------- 音效（WebAudio 合成，不載入音檔） ---------- */
let AC = null;
function ac(){ if (!AC) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; AC = new C(); } if (AC.state === 'suspended') AC.resume(); return AC; }
function tone(f, dur, type, vol, when){
  if (!S.pref.sound) return; const a = ac(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + (when || 0);
  o.type = type || 'sine'; o.frequency.value = f;
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime((vol || .2) * S.pref.vol, t + .012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur + .05);
}
const SND = {
  tick: () => tone(1200, .035, 'square', .04),
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, .32, 'triangle', .2, i * .085)),
  beep: () => tone(880, .12, 'square', .08),
  go: () => { tone(988, .18, 'square', .12); tone(1319, .3, 'square', .12, .16); },
  buzz: () => { tone(330, .55, 'sawtooth', .16); tone(415, .55, 'sawtooth', .1); },
  foul: () => tone(140, .4, 'sawtooth', .14),
  alarm: () => { for (let i = 0; i < 3; i++) { tone(1047, .16, 'square', .15, i * .5); tone(1047, .16, 'square', .15, i * .5 + .2); } },
  pop: () => tone(660, .08, 'sine', .12),
};

/* ---------- 共用畫面 ---------- */
function openModal(h, wide){ const b = $('modalBox'); b.className = wide ? 'wide' : ''; b.innerHTML = h; $('modal').classList.add('show'); b.scrollTop = 0; }
function closeModal(){ $('modal').classList.remove('show'); }
let toastT = 0;
function toast(m){ const o = document.querySelector('.toast'); if (o) o.remove(); const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = m; document.body.appendChild(t); clearTimeout(toastT); toastT = setTimeout(() => t.remove(), 3000); }
function copyText(s){ (navigator.clipboard ? navigator.clipboard.writeText(s) : Promise.reject()).then(() => toast('已複製')).catch(() => { const ta = document.createElement('textarea'); ta.value = s; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast('已複製'); } catch (e) { toast('複製失敗，請手動選取'); } ta.remove(); }); }
function downloadBlob(name, blob){ const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800); }
function download(name, text, type){ const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], {type})); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
function applyPref(){ const h = document.documentElement; h.dataset.theme = S.pref.theme === 'white' ? 'white' : 'board'; h.dataset.fs = S.pref.fs; document.querySelector('meta[name=theme-color]').content = S.pref.theme === 'white' ? '#F6F7F3' : '#1D3A2E'; }
const savePref = () => { lsPut('pref', S.pref); applyPref(); };
function numBox(id, v, min, max){ return '<span class="num"><button type="button" data-step="' + id + '" data-d="-1" aria-label="減少">−</button><input id="' + id + '" type="number" inputmode="numeric" min="' + min + '" max="' + max + '" value="' + v + '"><button type="button" data-step="' + id + '" data-d="1" aria-label="增加">＋</button></span>'; }
function dust(n){
  const box = $('dust'); if (!box) return; const r = box.getBoundingClientRect();
  for (let i = 0; i < (n || 40); i++) {
    const d = document.createElement('i'); const a = Math.random() * Math.PI * 2, s = 80 + Math.random() * 260;
    d.style.left = (r.width / 2) + 'px'; d.style.top = (r.height * .42) + 'px';
    d.style.background = COLORS[i % 5]; d.style.setProperty('--dx', Math.cos(a) * s + 'px'); d.style.setProperty('--dy', Math.sin(a) * s * .7 + 'px');
    box.appendChild(d); setTimeout(() => d.remove(), 1500);
  }
}

const WARN_HTML = '<h2>⚠ 使用警語</h2><ul>' +
  '<li><b>名單只存在這台電腦的瀏覽器</b>，不會上傳。換電腦前請到「⚙ 常用設定 → 資料備份」下載備份檔。</li>' +
  '<li>抽籤與分組用瀏覽器的安全亂數，每次結果不同、無法事後重現；要留紀錄請自己截圖或複製。</li>' +
  '<li>「即時投票」與「手機搶答」會透過作者架設的轉播站（Cloudflare）即時轉送<b>房間代碼、選項代號與學生輸入的學號或姓名</b>（只送到老師電腦，學生之間看不到）；轉播站不儲存作答，所有人離開房間就消失。投票結果與點名只存在老師這台電腦。</li>' +
  '<li>學生用手機加入時要輸入學號或姓名，老師電腦知道誰加入、誰投了什麼；大螢幕不顯示個人作答。勾「🏆 記名計分」時成績檔含學號、姓名與每題作答，請依個資規定保管。</li>' +
  '<li>上傳的名單、題庫檔案只在這台電腦的瀏覽器裡讀取，不會上傳。</li>' +
  '<li>這<b>不是有身分驗證的正式投票或考試系統</b>：學生可以輸入別人的學號或姓名，換瀏覽器或無痕視窗也能再投一次。可以設「教室密碼」擋外人，但請勿用於選舉、正式考試或需要防作弊的場合。</li>' +
  '<li>手機搶答的先後以老師電腦收到的時間為準，網路快慢會影響結果；要求公平時請用「現場按鍵」。</li>' +
  '<li>教室沒有網路時，投票可以改用「✋ 舉手計票」手動加票，其他工具都能離線使用。</li>' +
  '<li>瀏覽器規定要先在頁面上點一下，音效才會發出聲音；投影前請先測試音量。</li></ul>';
function showWarn(){ openModal(WARN_HTML + '<div class="stack"><button class="btn" data-act="close">我知道了</button></div>'); }

/* ---------- 外框 ---------- */
const JOIN = QS.has('join');
function renderShell(){
  $('root').innerHTML = '<header class="top"><div class="brand"><img src="icons/icon-192.png" alt=""><span>講師課堂小幫手</span></div>' +
    '<nav class="nav" role="tablist" aria-label="工具">' + TABS.map((t) => '<button role="tab" data-tab="' + t.id + '" aria-selected="' + (S.tab === t.id) + '">' + t.ic + ' ' + t.n + '</button>').join('') + '</nav>' +
    '<div class="tright"><button class="chipLive" id="tChip" data-tab="timer" hidden></button><button class="chipLive net" id="nChip" data-tab="vote" hidden></button>' +
    '<button class="ib" id="lobbyChip" data-act="lobby" title="目前上課中的教室">🏫 教室大廳</button><a class="ib" href="?join" title="學生用：選教室、輸入密碼進入">🎓 學生登入</a>' +
    '<button class="ib" data-act="roster" title="班級名單">📋 名單</button><button class="ib" data-act="fs" title="全螢幕（F 鍵）">⛶ 全螢幕</button>' +
    '<a class="ib" href="manual.html">📖 操作手冊</a><button class="ib" data-act="settings" title="常用設定" aria-label="常用設定">⚙</button></div></header>' +
    '<main id="app"></main>' +
    '<footer class="foot">講師課堂小幫手｜👤 創作者 Mark Tsai（蔡豐全）<a href="mailto:tsaimark@gmail.com">tsaimark@gmail.com</a>・<a href="manual.html">操作手冊</a>・<a href="manual.html#creator">關於創作者</a>・<button data-act="warn">⚠ 使用警語</button>' +
    '<br><img src="https://visitor-badge.laobi.icu/badge?page_id=m255525.teacherclassroomhelper" alt="訪客次數" height="20" loading="lazy" style="vertical-align:middle;margin-top:.4rem"></footer>';
}
function setTab(t){
  if (!TABS.some((x) => x.id === t)) return;
  S.tab = t; lsSet('tab', t);
  document.querySelectorAll('.nav button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === t));
  renderTool();
}
function renderTool(){
  const f = {draw:renderDraw, group:renderGroup, timer:renderTimer, buzz:renderBuzz, vote:renderVote, quiz:renderQuiz}[S.tab];
  f(); updChips();
}

/* ---------- 名單 ---------- */
function rosterCard(){
  const r = roster(), ab = new Set(r.absent || []), pres = present(r);
  return '<div class="card"><h3>📋 班級名單<span class="r">出席 ' + pres.length + ' / ' + r.list.length + ' 人</span></h3>' +
    '<div class="row"><select class="tx" id="rosterSel" style="flex:1 1 9rem;width:auto" aria-label="選擇班級">' + S.rosters.map((x) => '<option value="' + x.id + '"' + (x.id === r.id ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select>' +
    '<button class="btn alt" data-act="roster">✏ 編輯</button></div>' +
    '<p class="small" style="margin:.5rem 0 .3rem">點名字＝今天缺席（不會被抽到、不分組），再點一次恢復。</p>' +
    '<div class="chips">' + r.list.map((n, i) => '<button class="nm' + (ab.has(n) ? ' out' : '') + '" data-abs="' + i + '">' + esc(disp(n, r)) + '</button>').join('') + '</div>' +
    (ab.size ? '<div class="row" style="margin-top:.45rem"><button class="btn alt" data-act="allIn">全部出席</button></div>' : '') + '</div>';
}
const rosterLines = (list, ids) => list.map((n) => (ids && ids[n] ? ids[n] + '\t' : '') + n).join('\n');
function openRoster(id){
  const r = S.rosters.find((x) => x.id === id) || roster(), sh = r.show || 'name';
  openModal('<h2>📋 班級名單</h2><div class="row"><select class="tx" id="rsPick" style="flex:1 1 10rem;width:auto">' + S.rosters.map((x) => '<option value="' + x.id + '"' + (x.id === r.id ? ' selected' : '') + '>' + esc(x.name) + '（' + x.list.length + ' 人）</option>').join('') + '</select>' +
    '<button class="btn alt" data-act="rsNew">＋ 新增班級</button></div>' +
    '<label class="small" style="display:block;margin-top:.7rem">班級名稱<input class="tx" id="rsName" maxlength="30" value="' + esc(r.name) + '"></label>' +
    '<div class="row" style="margin-top:.6rem"><button class="btn y" data-act="rsImport">📂 上傳 CSV／Excel</button><button class="btn alt" data-act="rsCsv">⬇ 下載 CSV</button><button class="btn alt" data-act="rsXlsx">⬇ 下載 Excel</button><input type="file" id="rsFile" accept=".csv,.tsv,.txt,.xlsx,.xlsm" hidden></div>' +
    '<p class="small" style="margin:.3rem 0 0">上傳的檔案要有「學號」「姓名」欄（沒有標題列也會自動判斷），舊版 .xls 請先另存成 .xlsx 或 CSV。下載的檔案也可以當範本，改完再上傳。</p>' +
    '<label class="small" style="display:block;margin-top:.6rem">名單（一行一位：「學號 姓名」或只有姓名；可從 Excel 直接複製兩欄貼上）<textarea class="tx" id="rsList" rows="9">' + esc(rosterLines(r.list, r.ids)) + '</textarea></label>' +
    '<div class="row" style="margin-top:.5rem"><span class="small">沒有名單？用座號：</span>' + numBox('rsSeat', r.list.length || 30, 1, 200) + '<button class="btn alt" data-act="rsSeat">產生 1～N 號</button></div>' +
    '<label class="small" style="display:block;margin-top:.6rem">投影時顯示<select class="tx" id="rsShow">' + [['name', '姓名'], ['both', '學號＋姓名'], ['id', '只顯示學號（不在投影露出姓名）']].map((o) => '<option value="' + o[0] + '"' + (sh === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label>' +
    '<p class="small">名字重複時會自動加上 (2)、(3)。名單只存在這台電腦。</p>' +
    '<div class="stack"><button class="btn" data-act="rsSave" data-id="' + r.id + '">💾 儲存並使用這一班</button>' +
    (S.rosters.length > 1 ? '<button class="btn red" data-act="rsDel" data-id="' + r.id + '">🗑 刪除這一班</button>' : '') +
    '<button class="btn alt" data-act="close">取消</button></div>');
}
async function importRoster(f){
  try {
    const x = await TCHIO.readFile(f), res = x.rows ? TCHIO.rowsToRoster(x.rows) : TCHIO.parseRosterText(x.text);
    if (!res.list.length) { toast('檔案裡找不到名單'); return; }
    $('rsList').value = rosterLines(res.list, res.ids);
    const nm = $('rsName'); if (/^新班級|^範例班/.test(nm.value)) nm.value = cut(f.name.replace(/\.[^.]+$/, ''), 30);
    const k = Object.keys(res.ids).length;
    toast('讀到 ' + res.list.length + ' 人' + (k ? '，學號 ' + k + ' 筆' : '（沒有學號欄）') + '，確認後按「儲存」');
  } catch (e) { toast(e.message || '讀檔失敗'); }
}
// 下載名單：以表單目前內容為準，附上出席、分組、抽籤順序
function rosterExport(kind){
  const id = document.querySelector('[data-act=rsSave]').dataset.id, r = S.rosters.find((x) => x.id === id) || roster();
  const f = TCHIO.parseRosterText($('rsList').value); if (!f.list.length) { toast('名單是空的'); return; }
  const L = S.grp.last && S.grp.last.rid === r.id ? S.grp.last : null, gi = {}, ab = new Set(r.absent || []), dr = drawnOf(r);
  if (L) L.groups.forEach((g, i) => g.forEach((n, j) => { gi[n] = '第 ' + (i + 1) + ' 組' + (L.leader && j === 0 ? '（組長）' : ''); }));
  const head = ['學號', '姓名', '今天出席'].concat(L ? ['組別'] : [], dr.length ? ['抽籤順序'] : []);
  const rows = [head].concat(f.list.map((n) => [f.ids[n] || '', n, ab.has(n) ? '缺席' : '出席'].concat(L ? [gi[n] || ''] : [], dr.length ? [dr.indexOf(n) + 1 || ''] : [])));
  const fn = ($('rsName').value.trim() || r.name) + '名單';
  if (kind === 'csv') download(fn + '.csv', TCHIO.csvText(rows), 'text/csv'); else downloadBlob(fn + '.xlsx', TCHIO.xlsxBlob(rows, '名單', [14, 12, 10, 14, 10]));
}

/* ---------- 🎯 抽籤點名 ---------- */
let rolling = false;
const drawnOf = (r) => (S.drawn[r.id] || []).filter((n) => r.list.indexOf(n) >= 0);
function drawPool(){ const r = roster(), d = new Set(S.drawOpt.noRepeat ? drawnOf(r) : []); return present(r).filter((n) => !d.has(n)); }
function renderDraw(){
  const r = roster(), drawn = drawnOf(r);
  $('app').innerHTML = '<section class="tool"><div class="stage"><div class="stageInfo" id="drawInfo"></div>' +
    '<div class="drawBox"><div class="drawRes" id="drawRes" aria-live="polite"><span class="drawHint">按「抽籤」或空白鍵</span></div></div>' +
    '<div class="stageBar"><button class="btn big y" data-act="draw">🎯 抽籤</button><span class="small">一次</span>' + numBox('drawCount', S.drawOpt.count, 1, 10) + '<span class="small">人</span>' +
    '<label class="ck"><input type="checkbox" id="noRepeat"' + (S.drawOpt.noRepeat ? ' checked' : '') + '> 抽過的不再抽</label>' +
    '<button class="btn alt" data-act="drawReset">↺ 重新開始</button></div><div class="dust" id="dust"></div></div>' +
    '<aside class="side">' + rosterCard() +
    '<div class="card"><h3>✅ 已抽出<span class="r">' + drawn.length + ' 人</span></h3>' +
    (drawn.length ? '<div class="chips">' + drawn.map((n, i) => '<button class="nm hit" data-back="' + i + '" title="放回籤筒">' + (i + 1) + '. ' + esc(disp(n)) + '</button>').join('') + '</div><p class="small" style="margin:.4rem 0 0">點名字可以放回籤筒。</p>' : '<p class="small">還沒抽。</p>') +
    '</div></aside></section>';
  drawInfo();
}
function drawInfo(){ const el = $('drawInfo'); if (!el) return; const r = roster(); el.textContent = r.name + '・籤筒裡還有 ' + drawPool().length + ' 人' + (S.drawOpt.noRepeat ? '' : '（可重複抽）'); }
function doDraw(){
  if (rolling) return;
  const pool = drawPool();
  if (!pool.length) { toast(present().length ? '全部都抽過了，按「重新開始」' : '名單是空的，請先編輯名單'); return; }
  const k = Math.min(clamp(S.drawOpt.count, 1, 10), pool.length);
  const picks = shuffle(pool).slice(0, k);
  const el = $('drawRes'); rolling = true;
  el.className = 'drawRes rolling' + (k > 2 ? ' many' : '');
  const show = (arr) => { el.innerHTML = arr.map((n) => '<span class="nmB">' + esc(disp(n)) + '</span>').join(''); };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let t = 0, delay = 45; const total = reduce ? 0 : 1700;
  (function step(){
    if (t >= total) {
      rolling = false; show(picks);
      const r = roster(); S.drawn[r.id] = drawnOf(r).concat(picks); lsPut('drawn', S.drawn);
      const keep = el.innerHTML; renderDraw(); const e2 = $('drawRes'); e2.className = 'drawRes done' + (k > 2 ? ' many' : ''); e2.innerHTML = keep;
      SND.win(); dust(50);
      return;
    }
    show(shuffle(pool.length > 1 ? pool : present()).slice(0, k)); SND.tick();
    t += delay; delay = Math.min(delay * 1.13, 260); setTimeout(step, delay);
  })();
}

/* ---------- 👥 隨機分組 ---------- */
function renderGroup(){
  const g = S.grp;
  $('app').innerHTML = '<section class="tool"><div class="stage"><div class="stageInfo" id="grpInfo"></div><div class="groups" id="groups"></div>' +
    '<div class="stageBar" style="margin-top:1rem"><span class="seg" role="group" aria-label="分組方式"><button data-gmode="n" aria-pressed="' + (g.mode === 'n') + '">分成幾組</button><button data-gmode="size" aria-pressed="' + (g.mode === 'size') + '">每組幾人</button></span>' +
    (g.mode === 'n' ? numBox('grpN', g.n, 2, 30) + '<span class="small">組</span>' : numBox('grpSize', g.size, 2, 30) + '<span class="small">人一組</span>') +
    '<label class="ck"><input type="checkbox" id="grpLeader"' + (g.leader ? ' checked' : '') + '> 每組抽一位組長</label>' +
    '<button class="btn big y" data-act="group">🎲 分組</button><button class="btn alt" data-act="grpCopy">📋 複製結果</button></div><div class="dust" id="dust"></div></div>' +
    '<aside class="side">' + rosterCard() + '<div class="card"><h3>💡 小提示</h3><p class="small" style="margin:0">人數分不平均時，各組人數最多只差 1 人。結果會保留到下次分組，可以複製貼到 LINE 群組。</p></div></aside></section>';
  showGroups(false);
}
function showGroups(anim){
  const box = $('groups'), info = $('grpInfo'), L = S.grp.last, r = roster();
  if (!L || L.rid !== r.id) { box.innerHTML = '<div class="drawBox" style="grid-column:1/-1"><span class="drawHint">出席 ' + present().length + ' 人，按「分組」或空白鍵</span></div>'; info.textContent = r.name; return; }
  info.textContent = r.name + '・' + L.groups.reduce((a, x) => a + x.length, 0) + ' 人分成 ' + L.groups.length + ' 組';
  box.classList.toggle('dense', L.groups.length > 8 || L.groups.some((x) => x.length > 7));
  box.innerHTML = L.groups.map((m, i) => '<div class="grp" style="--gc:' + COLORS[i % COLORS.length] + (anim ? ';animation-delay:' + (i * .07) + 's' : ';animation:none') + '"><h4>第 ' + (i + 1) + ' 組 <small>' + m.length + ' 人</small></h4><ul>' +
    m.map((n, j) => '<li' + (L.leader && j === 0 ? ' class="lead"' : '') + '>' + esc(disp(n)) + '</li>').join('') + '</ul></div>').join('');
}
function doGroup(){
  const pres = shuffle(present()); if (pres.length < 2) { toast('出席人數不夠分組'); return; }
  const g = S.grp, cnt = g.mode === 'n' ? clamp(g.n, 1, pres.length) : Math.ceil(pres.length / clamp(g.size, 1, pres.length));
  const groups = Array.from({length:cnt}, () => []);
  pres.forEach((p, i) => groups[i % cnt].push(p));
  g.last = {rid:roster().id, groups:shuffle(groups).sort((a, b) => b.length - a.length), leader:g.leader};
  lsPut('grp', g); showGroups(true); SND.win(); dust(30);
}
function groupText(){ const L = S.grp.last; if (!L) return ''; return roster().name + ' 分組結果\n' + L.groups.map((m, i) => '第 ' + (i + 1) + ' 組：' + m.map((n, j) => disp(n) + (L.leader && j === 0 ? '（組長）' : '')).join('、')).join('\n'); }

/* ---------- ⏱ 計時器 ---------- */
const T = {total:S.tset.total * 1000, remain:S.tset.total * 1000, running:false, endAt:0, over:false, lastBeep:-1,
  sw:{elapsed:0, startAt:0, running:false, laps:[]}};
const fmt = (ms, deci) => {
  const neg = ms < 0; ms = Math.abs(ms);
  const s = deci ? Math.floor(ms / 1000) : Math.ceil(ms / 1000 - 1e-6), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return (neg ? '+' : '') + (h ? h + ':' + p(m) : p(m)) + ':' + p(x) + (deci ? '.' + Math.floor(ms % 1000 / 100) : '');
};
function tNow(){ return T.running ? T.endAt - Date.now() : T.remain; }
function renderTimer(){
  const dn = S.tset.mode === 'down';
  $('app').innerHTML = '<section class="tool"><div class="stage"><div class="row c"><span class="seg" role="group" aria-label="模式"><button data-tmode="down" aria-pressed="' + dn + '">⏳ 倒數</button><button data-tmode="sw" aria-pressed="' + !dn + '">⏱ 碼表</button></span></div>' +
    '<div class="timerBox"><div class="digits" id="tDigits" aria-live="off">00:00</div>' + (dn ? '<div class="tbar" id="tBar"><i></i></div><div class="timesUp" id="tUp" hidden>⏰ 時間到！</div>' : '') + '</div>' +
    '<div class="stageBar"><button class="btn big y" data-act="tGo" id="tGo">▶ 開始</button><button class="btn alt" data-act="tReset">↺ 重設</button>' +
    (dn ? '<button class="btn alt" data-act="tAdd" data-s="-60">−1 分</button><button class="btn alt" data-act="tAdd" data-s="60">＋1 分</button>' : '<button class="btn alt" data-act="tLap">🚩 分段</button>') + '</div></div>' +
    '<aside class="side">' + (dn ?
      '<div class="card"><h3>⚡ 快速設定</h3><div class="presets">' + [[30, '30 秒'], [60, '1 分'], [120, '2 分'], [180, '3 分'], [300, '5 分'], [600, '10 分'], [900, '15 分'], [1200, '20 分'], [1800, '30 分']].map((p) => '<button data-preset="' + p[0] + '">' + p[1] + '</button>').join('') + '</div>' +
      '<div class="row" style="margin-top:.7rem"><span class="small">自訂</span><input class="tx" id="tMin" type="number" min="0" max="180" value="' + Math.floor(S.tset.total / 60) + '" style="width:4.5rem" aria-label="分"><span>分</span><input class="tx" id="tSec" type="number" min="0" max="59" value="' + (S.tset.total % 60) + '" style="width:4.5rem" aria-label="秒"><span>秒</span><button class="btn alt" data-act="tCustom">設定</button></div>' +
      '<label class="ck" style="margin-top:.5rem"><input type="checkbox" id="tBeep"' + (S.tset.beep ? ' checked' : '') + '> 最後 5 秒嗶聲</label></div>'
      : '<div class="card"><h3>🚩 分段紀錄<span class="r">' + T.sw.laps.length + ' 筆</span></h3><ol class="laps" id="laps">' + T.sw.laps.map((l, i) => '<li><span>第 ' + (i + 1) + ' 段</span><b>' + fmt(l, true) + '</b></li>').join('') + '</ol>' + (T.sw.laps.length ? '' : '<p class="small">計時中按「分段」記下時間。</p>') + '</div>') +
    '<div class="card"><h3>⌨ 快捷鍵</h3><p class="small" style="margin:0">空白鍵＝開始／暫停，R＝重設，F＝全螢幕。切到其他工具時計時不會停，右上角會顯示剩餘時間。</p></div></aside></section>';
  tPaint();
}
function tSet(sec){ sec = clamp(Math.round(sec), 1, 10 * 3600); S.tset.total = sec; lsPut('timer', S.tset); T.total = T.remain = sec * 1000; T.running = false; T.over = false; T.lastBeep = -1; if (S.tab === 'timer') renderTimer(); updChips(); }
function tToggle(){
  ac();
  if (S.tset.mode === 'sw') { const w = T.sw; if (w.running) { w.elapsed += Date.now() - w.startAt; w.running = false; } else { w.startAt = Date.now(); w.running = true; } tPaint(); return; }
  if (T.over) { tReset(); return; }
  if (T.running) { T.remain = T.endAt - Date.now(); T.running = false; } else { if (T.remain <= 0) T.remain = T.total; T.endAt = Date.now() + T.remain; T.running = true; SND.pop(); }
  tPaint(); updChips();
}
function tReset(){ if (S.tset.mode === 'sw') { T.sw = {elapsed:0, startAt:0, running:false, laps:[]}; renderTimer(); return; } T.running = false; T.over = false; T.remain = T.total; T.lastBeep = -1; tPaint(); updChips(); }
function tAdd(s){ if (T.over) { T.over = false; T.remain = s > 0 ? s * 1000 : T.total; T.running = false; } else if (T.running) { T.endAt = Math.max(Date.now() + 1000, T.endAt + s * 1000); } else { T.remain = Math.max(1000, T.remain + s * 1000); } T.total = Math.max(T.total, tNow()); tPaint(); updChips(); }
function swNow(){ const w = T.sw; return w.elapsed + (w.running ? Date.now() - w.startAt : 0); }
function tTick(){
  if (T.running) {
    const left = T.endAt - Date.now();
    const sec = Math.ceil(left / 1000);
    if (S.tset.beep && sec <= 5 && sec >= 1 && sec !== T.lastBeep) { T.lastBeep = sec; SND.beep(); }
    if (left <= 0) { T.running = false; T.over = true; T.remain = 0; SND.alarm(); if (S.tab !== 'timer') toast('⏰ 計時器：時間到！'); }
  }
  if (S.tab === 'timer') tPaint();
  autoTick();
  updChips();
}
function tPaint(){
  const d = $('tDigits'); if (!d) return; const go = $('tGo');
  if (S.tset.mode === 'sw') { d.textContent = fmt(swNow(), true); d.className = 'digits'; if (go) go.textContent = T.sw.running ? '⏸ 暫停' : (T.sw.elapsed ? '▶ 繼續' : '▶ 開始'); return; }
  const left = T.over ? -(Date.now() - T.endAt) : tNow();
  d.textContent = T.over ? fmt(left) : fmt(Math.max(0, left));
  const warn = !T.over && left <= Math.min(60000, T.total * .25), hot = !T.over && left <= 10000;
  d.className = 'digits' + (T.over ? ' over' : hot && T.running ? ' hot' : warn ? ' warn' : '');
  const bar = $('tBar'); if (bar) { bar.className = 'tbar' + (hot ? ' hot' : warn ? ' warn' : ''); bar.firstChild.style.width = (T.over ? 0 : clamp(left / T.total, 0, 1) * 100) + '%'; }
  const up = $('tUp'); if (up) up.hidden = !T.over;
  if (go) go.textContent = T.over ? '✔ 知道了' : T.running ? '⏸ 暫停' : (T.remain < T.total ? '▶ 繼續' : '▶ 開始');
}
function updChips(){
  const c = $('tChip'); if (c) {
    const on = S.tab !== 'timer' && (T.running || T.over || T.sw.running);
    c.hidden = !on;
    if (on) c.textContent = T.sw.running && S.tset.mode === 'sw' ? '⏱ ' + fmt(swNow(), true) : T.over ? '⏰ 時間到' : '⏳ ' + fmt(Math.max(0, tNow()));
  }
  const n = $('nChip'); if (n) { n.hidden = !NET.want || isVT(); if (NET.want) { n.classList.toggle('off', NET.status !== 'on'); n.textContent = NET.status === 'on' ? '📱 ' + studentCount() + ' 人連線' : '📱 連線中斷'; } }
}

/* ---------- 🔔 搶答器 ---------- */
const B = {phase:'ready', order:[], fouls:new Set(), cd:0, t0:0, rid:'', phone:[]};
function teams(){ return S.buzz.teams.slice(0, clamp(S.buzz.count, 2, 6)); }
function renderBuzz(){
  const local = S.buzz.src === 'local';
  $('app').innerHTML = '<section class="tool"><div class="stage"><div class="buzzTop"><div class="buzzState" id="bzState" aria-live="assertive"></div><div class="buzzSub" id="bzSub"></div><div class="order" id="bzOrder"></div></div>' +
    (local ? '<div class="pads" id="pads"></div>' : '<ol class="phList" id="bzPh"></ol>') +
    '<div class="stageBar" style="margin-top:1rem"><button class="btn big y" data-act="bzStart" id="bzGo">▶ 開始搶答</button><button class="btn alt" data-act="bzReset">↺ 重來</button></div><div class="dust" id="dust"></div></div>' +
    '<aside class="side"><div class="card"><h3>🔔 搶答方式</h3><span class="seg" role="group"><button data-bsrc="local" aria-pressed="' + local + '">🖥 現場按鍵</button><button data-bsrc="phone" aria-pressed="' + !local + '">📱 手機搶答</button></span>' +
    (local ? '<p class="small">各組派一人到台前，或用鍵盤：第 1～6 組按數字鍵 1～6（觸控螢幕直接按色塊）。倒數「3、2、1」期間先按算犯規，這一輪不能搶。</p>'
      : '<p class="small">學生用手機掃 QR code，輸入名字或組別，老師按「開始搶答」後手機才會出現大按鈕。先後以這台電腦收到的時間為準。</p>') + '</div>' +
    (local ? '<div class="card"><h3>👥 隊伍<span class="r">' + numBox('bzCount', S.buzz.count, 2, 6) + '</span></h3><div class="stack" style="margin-top:0">' + teams().map((t, i) => '<input class="tx" data-tname="' + i + '" maxlength="12" value="' + esc(t.n) + '" aria-label="第 ' + (i + 1) + ' 隊名稱" style="box-shadow:inset 0 0 0 2px ' + COLORS[i] + '">').join('') + '</div><div class="row" style="margin-top:.5rem"><button class="btn alt" data-act="bzZero">分數歸零</button></div></div>'
      : netCard()) + '</aside></section>';
  bzPaint(); drawQR($('qrSide'), 170);
}
function bzPaint(){
  const st = $('bzState'); if (!st) return; const local = S.buzz.src === 'local', go = $('bzGo'), sub = $('bzSub');
  if (B.phase === 'count') { st.className = 'buzzState'; st.textContent = B.cd; sub.textContent = '準備⋯'; }
  else if (B.phase === 'open' && !B.order.length && !B.phone.length) { st.className = 'buzzState go'; st.textContent = '搶答！'; sub.textContent = local ? '按下自己隊伍的按鈕或數字鍵' : '請在手機上按大紅鈕'; }
  else if (B.phase === 'open') {
    const w = local ? teams()[B.order[0].i].n : B.phone[0].nick;
    if (st.dataset.w !== w) { st.className = 'buzzState win'; st.dataset.w = w; }
    st.textContent = '🙋 ' + w; st.style.color = local ? COLORS[B.order[0].i] : 'var(--y)';
    sub.textContent = '最快搶到！';
  } else { st.className = 'buzzState'; st.style.color = ''; st.dataset.w = ''; st.textContent = local ? '準備好了嗎？' : (NET.status === 'on' ? '準備好了嗎？' : '先開放手機連線'); sub.textContent = '按「開始搶答」或空白鍵'; }
  if (B.phase !== 'open' || !(B.order.length || B.phone.length)) { st.style.color = ''; st.dataset.w = ''; }
  const ord = $('bzOrder');
  if (local && !$('pads') || !local && !$('bzPh')) return; // 切換模式時畫面還沒重畫
  if (local) {
    ord.innerHTML = B.order.slice(1).map((o, k) => '<span style="box-shadow:inset 0 0 0 2px ' + COLORS[o.i] + '">第 ' + (k + 2) + '：' + esc(teams()[o.i].n) + '（+' + ((o.t - B.order[0].t) / 1000).toFixed(2) + ' 秒）</span>').join('') +
      Array.from(B.fouls).map((i) => '<span style="background:var(--r);color:#2A0705">' + esc(teams()[i].n) + ' 犯規</span>').join('');
    const pads = $('pads');
    pads.innerHTML = teams().map((t, i) => '<div class="pad' + (B.order[0] && B.order[0].i === i ? ' win' : '') + (B.fouls.has(i) ? ' foul' : '') + '" style="--tc:' + COLORS[i] + '"><button class="hit" data-hit="' + i + '">' + esc(t.n) + '<div class="key">鍵盤 ' + (i + 1) + '</div></button>' +
      '<div class="score"><button data-sc="' + i + '" data-d="-1" aria-label="扣分">−</button><b>' + t.s + '</b><button data-sc="' + i + '" data-d="1" aria-label="加分">＋</button></div></div>').join('');
  } else {
    ord.innerHTML = '';
    const ph = $('bzPh'); ph.innerHTML = B.phone.map((o, k) => '<li>' + (k + 1) + '. ' + esc(o.nick) + '<span>' + (k ? '+' + ((o.t - B.phone[0].t) / 1000).toFixed(2) + ' 秒' : (o.t / 1000).toFixed(2) + ' 秒') + '</span></li>').join('');
  }
  if (go) { go.disabled = B.phase === 'count' || (!local && NET.status !== 'on'); go.textContent = B.phase === 'open' ? '▶ 下一題' : '▶ 開始搶答'; }
}
function bzStart(){
  ac();
  if (B.phase === 'count') return;
  const local = S.buzz.src === 'local';
  if (!local && NET.status !== 'on') { toast('請先開放手機連線'); return; }
  B.order = []; B.fouls = new Set(); B.phone = []; B.phase = 'count'; B.cd = 3; B.rid = pid4();
  if (!local) setTeacher('T|b|' + B.rid + '|p');
  bzPaint(); SND.beep();
  const step = () => {
    if (B.phase !== 'count') return;
    B.cd--; if (B.cd > 0) { bzPaint(); SND.beep(); setTimeout(step, 800); return; }
    B.phase = 'open'; B.t0 = performance.now(); SND.go();
    if (!local) setTeacher('T|b|' + B.rid + '|o');
    bzPaint();
  };
  setTimeout(step, 800);
}
function bzReset(){ B.phase = 'ready'; B.order = []; B.fouls = new Set(); B.phone = []; if (S.buzz.src === 'phone' && NET.status === 'on') setTeacher('T|w'); bzPaint(); }
function bzHit(i){
  if (S.buzz.src !== 'local' || i >= teams().length) return;
  if (B.phase === 'count') { if (!B.fouls.has(i)) { B.fouls.add(i); SND.foul(); bzPaint(); } return; }
  if (B.phase !== 'open' || B.fouls.has(i) || B.order.some((o) => o.i === i)) return;
  B.order.push({i, t:performance.now()});
  if (B.order.length === 1) { SND.buzz(); dust(30); }
  bzPaint();
}
function bzPhone(id, nick){
  if (B.phase !== 'open' || S.buzz.src !== 'phone' || B.phone.some((o) => o.id === id)) return;
  B.phone.push({id, nick:nick ? whoLabel(nick) : '同學', t:performance.now() - B.t0});
  if (B.phone.length === 1) { SND.buzz(); dust(30); }
  if (S.tab === 'buzz') bzPaint();
}

/* ---------- 📱 連線（老師端與學生端共用） ---------- */
const NET = {who:new Map(), ws:null, want:false, status:'off', code:'', role:'T', myId:randId(), peers:new Map(), retry:0, ping:0, q:[], qBusy:false, last:null, state:'T|w'};
function studentCount(){ let n = 0; NET.peers.forEach((v) => { if (!/^T\|/.test(v)) n++; }); return n; }
function joinUrl(code){
  const here = location.protocol === 'https:' && location.hostname === 'm255525.github.io';
  return (here ? location.origin + location.pathname : ONLINE) + '?join=' + code + (NET.pw && code === NET.code ? '&pw=' + encodeURIComponent(NET.pw) : '');
}
function netStart(code){
  NET.want = true; NET.code = code; NET.role = JOIN ? 'S' : 'T'; NET.retry = 0;
  if (NET.role === 'T') {
    ssSet('room', code); // 只有這個分頁重新整理會沿用；關閉教室後一律換新代碼，舊 QR code 失效
    NET.tkey = lsGet('tkey.' + code); if (!NET.tkey) { NET.tkey = randId() + randId(); lsSet('tkey.' + code, NET.tkey); }
    NET.pw = lsGet('pw.' + code) || '';
  } else { NET.myId = lsGet('sid.' + code) || randId(); lsSet('sid.' + code, NET.myId); NET.pw = lsGet('spw.' + code) || ''; JS.pwNeed = false; }
  netConnect(); updChips();
}
// 同一個瀏覽器的其他分頁：問「這個代碼有沒有人在用」
const BC = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('tch-room') : null;
if (BC) BC.onmessage = (e) => { const d = e.data || {}; if (d.q && !JOIN && NET.want && NET.role === 'T' && NET.code === d.q) BC.postMessage({busy:d.q}); };
function codeBusy(code){
  return new Promise((ok) => {
    if (!BC || !code) { ok(false); return; }
    const h = (e) => { if (e.data && e.data.busy === code) { BC.removeEventListener('message', h); ok(true); } };
    BC.addEventListener('message', h); BC.postMessage({q:code}); setTimeout(() => { BC.removeEventListener('message', h); ok(false); }, 300);
  });
}
async function netOpen(){
  const last = ssGet('room');
  const code = last && /^[A-Z0-9]{6}$/.test(last) && !(await codeBusy(last)) ? last : newCode();
  netStart(code); renderTool();
}
function netReconnect(){ const ws = NET.ws; NET.ws = null; if (ws) try { ws.close(); } catch (e) {} NET.status = 'off'; NET.retry = 0; netConnect(); }
// closeRoom：老師按「關閉教室」→ 通知轉播站把所有人請出、刪掉這個代碼的金鑰，舊網址與 QR code 從此失效
function netStop(closeRoom){
  const code = NET.code, ws0 = NET.ws;
  if (closeRoom && NET.role === 'T' && ws0 && ws0.readyState === 1) try { ws0.send('{"t":"close"}'); } catch (e) {}
  NET.want = false; clearTimeout(NET.rt); const ws = NET.ws; NET.ws = null; NET.status = 'off'; NET.peers.clear(); NET.who.clear();
  if (ws) setTimeout(() => { try { ws.close(); } catch (e) {} }, closeRoom ? 400 : 0);
  if (closeRoom && code) { ['tkey.', 'pw.', 'vcur.', 'rinfo.'].forEach((k) => lsDel(k + code)); setTimeout(fetchLobby, 1500); }
  ssDel('room'); updChips(); if (isVT() || S.tab === 'buzz') renderTool();
}
function netConnect(){
  if (!NET.want) return;
  let ws;
  const q = 'room=VOTE' + NET.code + '&cls=1' + (NET.role === 'T' ? '&tkey=' + NET.tkey : '') + (NET.pw ? '&pw=' + encodeURIComponent(NET.pw) : '');
  try { ws = new WebSocket(PRESENCE + (PRESENCE.indexOf('?') >= 0 ? '&' : '?') + q); } catch (e) { netRetry(); return; }
  NET.ws = ws; NET.status = 'wait'; netPaint();
  ws.onopen = () => {
    if (NET.ws !== ws) return;
    NET.status = 'on'; NET.retry = 0;
    ws.send(JSON.stringify({t:'hello', id:NET.myId, name:NET.role === 'T' ? NET.state : (JS.name || 'W'), gx:0, gy:0}));
    clearInterval(NET.ping); NET.ping = setInterval(() => { if (NET.ws && NET.ws.readyState === 1) NET.ws.send('{"t":"ping"}'); }, 25000);
    if (NET.role === 'T') { sendRoomInfo(); const p = S.vote.cur; if (p && p.state === 'open') { NET.q = []; queueChats(pollChats(p)); } pump(); }
    netPaint();
  };
  ws.onmessage = (ev) => { if (NET.ws !== ws) return; let m; try { m = JSON.parse(ev.data); } catch (e) { return; } onNet(m); };
  ws.onclose = (ev) => {
    if (NET.ws !== ws) return; NET.status = 'off'; NET.ws = null; clearInterval(NET.ping);
    const code = ev && ev.code;
    if (code === 4003 && NET.role === 'S') { JS.pwNeed = true; NET.retry = 0; renderJoin(); return; } // 密碼不對：等學生輸入
    if (code === 4004 && NET.role === 'S') { JS.closed = true; NET.retry = 0; renderJoin(); return; } // 教室已關閉或還沒開：不再自動重連
    if (code === 4001 && NET.role === 'T') { toast('這個代碼正由另一台電腦／瀏覽器當老師使用，已改用新代碼'); netStop(); netStart(newCode()); renderTool(); return; }
    if (code === 4002) { NET.myId = randId(); if (NET.role === 'S') lsSet('sid.' + NET.code, NET.myId); }
    netPaint(); netRetry();
  };
  ws.onerror = () => {};
}
function netRetry(){ if (!NET.want) return; NET.retry++; clearTimeout(NET.rt); NET.rt = setTimeout(netConnect, Math.min(30000, 1500 * Math.pow(2, NET.retry - 1))); }
function send(o){ if (NET.ws && NET.ws.readyState === 1) { NET.ws.send(JSON.stringify(o)); return true; } return false; }
function setTeacher(name){ NET.state = name; send({t:'look', name}); }
function onNet(m){
  if (m.t === 'snapshot') {
    NET.peers.clear(); (m.peers || []).forEach((p) => NET.peers.set(p.id, String(p.name || '')));
    if (NET.role === 'T') NET.peers.forEach((n, id) => onPeerName(id, n));
    else { NET.peers.forEach((n, id) => { if (/^T\|/.test(n)) JS.tid = id; }); (m.chat || []).forEach(onChat); }
  } else if (m.t === 'room' && NET.role === 'T') {
    const want = roomInfo();
    if (want.name && !m.name) toast('教室名稱含有不適合的字詞，沒有公開到大廳');
    else if (NET.nameAsk) toast(m.pub ? '已公開在教室大廳：' + m.name : '已儲存名稱（沒有公開在大廳）');
    NET.nameAsk = false; fetchLobby();
  } else if (m.t === 'join' && m.peer) { NET.peers.set(m.peer.id, String(m.peer.name || '')); if (NET.role === 'T') onPeerName(m.peer.id, m.peer.name); else if (/^T\|/.test(m.peer.name)) JS.tid = m.peer.id; }
  else if (m.t === 'look') { NET.peers.set(m.id, String(m.name || '')); if (NET.role === 'T') onPeerName(m.id, m.name); else if (/^T\|/.test(m.name)) JS.tid = m.id; }
  else if (m.t === 'leave') NET.peers.delete(m.id);
  else if (m.t === 'chat' && NET.role === 'S') onChat(m);
  else if (m.t === 'chatSlow' && NET.role === 'T') { if (NET.last) NET.q.unshift(NET.last); NET.qBusy = true; setTimeout(() => { NET.qBusy = false; pump(); }, (m.wait || 1000) + 300); }
  netPaint();
}
// 投票題目文字：用聊天訊息送（每則 ≤60 字、間隔 ≥2.5 秒，轉播站的限制）
function pollChats(p){
  const out = ['Q' + p.pid + ':' + cut(p.q, 54)];
  if (p.type === 's' || p.type === 'm') {
    let cur = '', k = 0;
    p.opts.forEach((o) => {
      const piece = cut(String(o).replace(/[｜|]/g, '/'), 22), add = (cur ? ' ｜ ' : '') + piece, head = 'O' + p.pid + '.' + k + ':';
      if (chars(head + cur + add).length > 60) { out.push(head + cur); k++; cur = piece; } else cur += add;
    });
    if (cur) out.push('O' + p.pid + '.' + k + ':' + cur);
  }
  return out.slice(1).concat(out.slice(0, 1)); // 先送選項文字（手機上按鈕要用），題目大螢幕上看得到
}
function queueChats(a){ NET.q.push.apply(NET.q, a); pump(); }
function pump(){
  if (NET.qBusy || !NET.q.length || NET.status !== 'on') return;
  const t = NET.q.shift(); NET.last = t;
  if (!send({t:'chat', text:t})) { NET.q.unshift(t); return; }
  NET.qBusy = true; setTimeout(() => { NET.qBusy = false; pump(); }, 2700);
}
function onPeerName(id, name){
  const a = String(name || '').split('|');
  const who = cleanWho(a[0] === 'S' ? a[3] : a[0] === 'B' ? a.slice(2).join('|') : a[0] === 'W' ? a[1] : '');
  if (who) { NET.who.set(id, who); if (isVT() || S.tab === 'buzz') updJoined(); }
  if (a[0] === 'S') {
    const p = S.vote.cur; if (!p || p.state !== 'open' || a[1] !== p.pid) return;
    let ch = String(a[2] || '').toUpperCase().split('').filter((c, i, arr) => LETTERS.indexOf(c) >= 0 && LETTERS.indexOf(c) < p.n && arr.indexOf(c) === i).sort().join('');
    if (p.type !== 'm') ch = ch.slice(0, 1);
    if (!ch) { delete p.votes[id]; if (p.who) delete p.who[id]; } else { p.votes[id] = ch; if (who) (p.who = p.who || {})[id] = who; }
    saveVoteSoon(); if (isVT()) votePaint();
  } else if (a[0] === 'B' && a[1] === B.rid) bzPhone(id, who);
}
const roomInfo = () => Object.assign({name:'', pub:true}, lsJson('rinfo.' + NET.code, {}));
function sendRoomInfo(){ const ri = roomInfo(); if (NET.role === 'T' && ri.name) send({t:'room', name:ri.name, pub:ri.pub}); }
function netCard(){
  if (!NET.want) return '<div class="card joinCard"><h3>📱 手機連線</h3><p class="small" style="text-align:left">開放後會產生 6 碼代碼和 QR code，學生用手機掃描就能投票、搶答，不用下載 App、不用登入。</p><button class="btn y" data-act="netOn">📱 開放手機連線</button></div>';
  const url = joinUrl(NET.code), local = !/github\.io$/.test(location.hostname);
  return '<div class="card joinCard"><h3><span class="dot ' + (NET.status === 'on' ? 'on' : NET.status === 'off' ? 'bad' : '') + '" id="netDot"></span> 手機連線<span class="r" id="netCnt">' + (NET.status === 'on' ? studentCount() + ' 人' : '連線中⋯') + '</span></h3>' +
    '<div class="small">代碼</div><div class="joinCode">' + NET.code + '</div>' + (NET.pw ? '<div class="small">🔒 密碼 <b style="font-size:1.3rem;color:var(--y);letter-spacing:.1em">' + esc(NET.pw) + '</b>（掃 QR code 會自動帶入）</div>' : '') + '<div class="qr" id="qrSide"></div><div class="joinUrl">' + esc(url) + '</div>' +
    (local ? '<p class="small" style="text-align:left">目前不是線上版網址，QR code 指向線上版：' + esc(ONLINE) + '</p>' : '') +
    '<div class="row c" style="margin-top:.5rem"><button class="btn alt" data-act="qrBig">🔍 放大 QR</button><button class="btn alt" data-act="copyJoin">🔗 複製連結</button><button class="btn alt" data-act="netNew">換代碼</button><button class="btn red" data-act="netOff">🚪 關閉教室</button></div>' +
    '<div class="row c" style="margin-top:.5rem"><input class="tx" id="netPw" maxlength="8" placeholder="教室密碼（選填）" value="' + esc(NET.pw) + '" style="width:9.5rem;text-transform:uppercase" aria-label="教室密碼"><button class="btn alt" data-act="netPw">🔒 ' + (NET.pw ? '改密碼' : '設密碼') + '</button></div>' +
    '<div class="row c" style="margin-top:.5rem"><input class="tx" id="netName" maxlength="20" placeholder="教室名稱（例：' + esc(cut(roster().name, 10)) + '）" value="' + esc(roomInfo().name) + '" style="flex:1 1 9rem;width:auto" aria-label="教室名稱"></div>' +
    '<div class="row c"><label class="ck"><input type="checkbox" id="netPub"' + (roomInfo().pub ? ' checked' : '') + '> 公開在首頁「教室大廳」</label><button class="btn alt" data-act="netName">🏷 儲存名稱</button></div>' +
    '<div class="small" id="netJoined" style="margin-top:.5rem">' + joinedSummary() + '</div>' +
    '<p class="small" style="text-align:left;margin:.3rem 0 0">學生進來要先輸入學號或姓名。只有知道代碼和密碼的人能加入；改密碼後已加入的學生要重新輸入。學生之間看不到彼此的作答。</p></div>';
}
function netPaint(){
  updChips();
  if (NET.role === 'S') { renderJoin(); return; }
  const dot = $('netDot'), cnt = $('netCnt');
  if (dot) dot.className = 'dot ' + (NET.status === 'on' ? 'on' : NET.status === 'off' ? 'bad' : '');
  if (cnt) cnt.textContent = NET.status === 'on' ? studentCount() + ' 人' : '連線中⋯';
  updJoined();
  if (isVT()) votePaint();
  if (S.tab === 'buzz') bzPaint();
}
let qrLib = null;
function loadQR(){
  if (window.QRCode) return Promise.resolve();
  if (!qrLib) qrLib = new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'; s.onload = ok; s.onerror = () => { qrLib = null; no(); }; document.head.appendChild(s); });
  return qrLib;
}
function drawQR(el, size){
  if (!el) return; el.innerHTML = '';
  loadQR().then(() => { el.innerHTML = ''; new window.QRCode(el, {text:joinUrl(NET.code), width:size, height:size, colorDark:'#111', colorLight:'#fff', correctLevel:window.QRCode.CorrectLevel.M}); })
    .catch(() => { el.innerHTML = '<span style="color:#111;font-size:.8rem;padding:.4rem">QR code 載入失敗（可能沒有網路），請改用代碼或連結</span>'; });
}

/* ---------- 🗳 即時投票（老師端） ---------- */
let voteSaveT = 0;
function saveVote(){ const v = Object.assign({}, S.vote, {cur:null}); lsPut('vote', v); ssSet('vcur', JSON.stringify(S.vote.cur)); if (NET.code && NET.role === 'T') lsPut('vcur.' + NET.code, S.vote.cur); }
function saveVoteSoon(){ clearTimeout(voteSaveT); voteSaveT = setTimeout(saveVote, 400); }
function labelsOf(p){ const T2 = VOTE_TYPES[p.type]; return T2.labels ? T2.labels.slice() : p.opts.slice(); }
function marksOf(p){ const T2 = VOTE_TYPES[p.type]; return T2.marks ? T2.marks.slice() : LETTERS.slice(0, p.n).split(''); }
function tally(p){
  const c = Array(p.n).fill(0); let voters = 0;
  Object.keys(p.votes).forEach((id) => { voters++; p.votes[id].split('').forEach((L) => { const i = LETTERS.indexOf(L); if (i >= 0 && i < p.n) c[i]++; }); });
  const man = p.manual || [];
  man.forEach((v, i) => { c[i] += v; });
  const manSum = man.reduce((a, b) => a + b, 0);
  return {c, voters:voters + (p.type === 'm' ? Math.max(0, ...man) : manSum)};
}
const cleanStu = (v) => cut(String(v || '').toUpperCase().replace(/[^A-Z0-9-]/g, ''), 12);
function resolveWho(w){
  const r = roster(), ids = r.ids || {}, up = cleanStu(w);
  for (const n of r.list) if (ids[n] && cleanStu(ids[n]) === up && up) return {key:cleanStu(ids[n]), sid:ids[n], name:n};
  const n = r.list.find((x) => x === w || x.replace(/\(\d+\)$/, '') === w);
  if (n) return {key:ids[n] ? cleanStu(ids[n]) : 'N:' + n, sid:ids[n] || '', name:n};
  return {key:'?:' + w, sid:/\d/.test(w) ? w : '', name:'', raw:w};
}
const whoLabel = (w) => { const x = resolveWho(w); return x.name ? disp(x.name) : w; };
function joinedList(){ const out = []; NET.peers.forEach((nm, id) => { if (/^T\|/.test(nm)) return; const w = NET.who.get(id); out.push({id, who:w || '', x:w ? resolveWho(w) : null}); }); return out; }
function updJoined(){ const el = $('netJoined'); if (el) el.innerHTML = joinedSummary(); }
function joinedSummary(){ if (!NET.want) return ''; const L = joinedList(), inRoster = new Set(L.filter((o) => o.x && o.x.name).map((o) => o.x.name)); return '👥 已加入 ' + L.length + ' 人（名單內 ' + inRoster.size + ' / ' + roster().list.length + '）<button class="ib" data-act="joinedList" style="min-height:1.9rem;margin-left:.3rem">看名單</button>'; }
function openJoined(){
  const L = joinedList(), here = new Set(), r = roster();
  const known = L.filter((o) => o.x && o.x.name).map((o) => { here.add(o.x.name); return o; }), unknown = L.filter((o) => !o.x || !o.x.name), absent = r.list.filter((n) => !here.has(n));
  const chip = (t, cls) => '<span class="nm' + (cls || '') + '" style="display:inline-block;margin:.15rem">' + esc(t) + '</span>';
  openModal('<h2>👥 誰加入了（' + esc(r.name) + '）</h2><p class="small">比對目前選的班級名單（學號或姓名）。這份是即時連線狀態，學生關掉網頁就會離開。</p>' +
    '<h3>✅ 已加入 ' + known.length + ' 人</h3><div>' + (known.map((o) => chip(disp(o.x.name), ' hit')).join('') || '<span class="small">還沒有</span>') + '</div>' +
    (unknown.length ? '<h3 style="margin-top:.7rem">❓ 名單外 ' + unknown.length + ' 人</h3><div>' + unknown.map((o) => chip(o.who || '（還沒輸入）')).join('') + '</div><p class="small">可能打錯字、用了別的稱呼，或不是這班的人。</p>' : '') +
    '<h3 style="margin-top:.7rem">⬜ 還沒加入 ' + absent.length + ' 人</h3><div>' + (absent.map((n) => chip(disp(n), ' out')).join('') || '<span class="small">全到了 🎉</span>') + '</div>' +
    '<div class="stack"><button class="btn alt" data-act="joinedCsv">⬇ 下載點名 CSV</button><button class="btn" data-act="close">關閉</button></div>', true);
}
function joinedCsv(){
  const L = joinedList(), r = roster(), here = {}; L.forEach((o) => { if (o.x && o.x.name) here[o.x.name] = o.who; });
  const t = new Date().toLocaleString('zh-TW', {hour12:false});
  const rows = [['學號', '姓名', '狀態', '學生輸入', '時間']].concat(r.list.map((n) => [(r.ids || {})[n] || '', n, here[n] != null ? '已加入' : '未加入', here[n] || '', t]), L.filter((o) => !o.x || !o.x.name).map((o) => ['', '', '名單外', o.who, t]));
  download(r.name + '點名-' + new Date().toLocaleDateString('sv') + '.csv', TCHIO.csvText(rows), 'text/csv');
}
function teacherVoteName(p){ return 'T|v|' + p.pid + '|' + p.n + '|' + (p.named ? p.type.toUpperCase() : p.type) + '|' + (p.state === 'open' ? 'o' : 'c') + '|' + (p.state === 'open' ? '' : p.ans || ''); }
const isVT = () => S.tab === 'vote' || S.tab === 'quiz';
// 投票與測驗共用同一個進行中的題目，各分頁只顯示自己的
const tabPoll = () => { const p = S.vote.cur; return p && !!p.quiz === (S.tab === 'quiz') ? p : null; };
function renderVote(){
  if (S.tab === 'quiz') return renderQuiz();
  const v = S.vote, p = v.cur, ty = v.type;
  $('app').innerHTML = '<section class="tool"><div class="stage" id="vStage"></div>' +
    '<aside class="side">' + netCard() +
    '<div class="card"><h3>✏ 出題</h3><span class="seg" role="group" aria-label="題型" style="flex-wrap:wrap">' + Object.keys(VOTE_TYPES).map((k) => '<button data-vtype="' + k + '" aria-pressed="' + (ty === k) + '">' + VOTE_TYPES[k].n + '</button>').join('') + '</span>' +
    '<label class="small" style="display:block;margin-top:.6rem">題目<input class="tx" id="vQ" maxlength="120" value="' + esc(v.q) + '" placeholder="' + (ty === 'u' ? '剛剛這段聽懂了嗎？' : ty === 'r' ? '今天的課程你給幾分？' : ty === 't' ? '例：毛利率越高代表越賺錢？' : '例：你最想先學哪個 AI 工具？') + '"></label>' +
    (ty === 's' || ty === 'm' ? '<label class="small" style="display:block;margin-top:.5rem">選項（一行一個，2～8 個）<textarea class="tx" id="vOpts" rows="4" placeholder="ChatGPT&#10;Gemini&#10;Claude">' + esc(v.opts) + '</textarea></label>' : '<p class="small">選項固定：' + VOTE_TYPES[ty].labels.join('／') + '</p>') +
    '<div class="row" style="margin-top:.6rem"><button class="btn y" data-act="vStart">▶ 開始投票</button></div>' +
    '<p class="small" style="margin:.5rem 0 0">題目會同步顯示在學生手機上（太長會截短，完整題目看大螢幕）。</p></div>' +
    '<div class="card"><p class="small" style="margin:0">要計分、用題庫出題、下載每位學生答對答錯的成績，請到 <button class="ib" data-tab="quiz" style="min-height:2rem">📝 測驗</button> 分頁。</p></div>' +
    '<div class="card"><h3>🗂 本機紀錄（' + esc(cut(roster().name, 10)) + '）<span class="r">' + myPolls().length + ' 題</span></h3>' + (myPolls().length ? '<ul class="hist">' + myPolls().slice().reverse().slice(0, 30).map((h) => '<li><b>' + esc(h.q || '（未填題目）') + '</b><span class="small">' + esc(h.at) + '・' + h.voters + ' 人作答・' + h.labels.map((l, i) => l + ' ' + h.c[i]).join('、') + '</span></li>').join('') + '</ul><div class="row" style="margin-top:.5rem"><button class="btn alt" data-act="vCsv">⬇ 匯出 CSV</button><button class="btn alt" data-act="vClearHist">清除紀錄</button></div>' : '<p class="small">每題結束（按「下一題」）會存一筆。</p>') + '</div>' +
    '</aside></section>';
  lastStageKey = ''; votePaint(); drawQR($('qrSide'), 170);
}
let lastStageKey = '';
function votePaint(){
  const st = $('vStage'); if (!st) return; const p = tabPoll();
  if (!p) {
    const k = 'idle' + roomInfo().name + S.tab + NET.want + NET.code + NET.pw + S.bank.items.length + S.qs.id;
    if (lastStageKey !== k || !st.firstChild) {
      lastStageKey = k;
      st.innerHTML = NET.want ? '<div class="qrBig" style="flex:1 1 auto;justify-content:center">' + (roomInfo().name ? '<div class="drawHint">🏫 ' + esc(roomInfo().name) + '</div>' : '') + '<div class="voteQ">' + (S.tab === 'quiz' ? '📝 ' + esc(S.qs.name || S.bank.name || '測驗') + '・掃描加入' : '📱 拿出手機，掃描加入') + '</div><div class="qr" id="qrStage"></div><div class="joinCode" style="font-size:clamp(2.4rem,6vw,4.5rem)">' + NET.code + '</div>' + (NET.pw ? '<div class="drawHint">🔒 密碼 <b style="color:var(--y)">' + esc(NET.pw) + '</b></div>' : '') + '<div class="small">或打開 ' + esc(ONLINE.replace('https://', '')) + ' 輸入代碼</div><div class="drawHint" id="vIdleCnt"></div></div>'
        : S.tab === 'quiz' ? '<div class="drawBox"><span class="drawHint">📝 測驗<br><small style="font-size:.7em">先「開放手機連線」讓學生用學號或姓名加入，再從右邊題庫出題</small></span></div>'
        : '<div class="drawBox"><span class="drawHint">右邊出一題，按「開始投票」<br><small style="font-size:.7em">先「開放手機連線」學生就能用手機作答；沒有網路也可以用「✋ 舉手計票」</small></span></div>';
      drawQR($('qrStage'), 260);
    }
    const ic = $('vIdleCnt'); if (ic) ic.textContent = NET.status === 'on' ? '已加入 ' + studentCount() + ' 人' : '連線中⋯';
    return;
  }
  const {c, voters} = tally(p), max = Math.max(1, ...c), labels = labelsOf(p), marks = marksOf(p), total = c.reduce((a, b) => a + b, 0);
  const k = 'poll' + S.tab + p.pid + p.state + p.show + p.manualOn + p.ans + p.n;
  if (lastStageKey !== k) {
    lastStageKey = k;
    st.innerHTML = '<div class="voteQ">' + esc(p.q || '（請看老師說明）') + '</div><div class="voteMeta"><span class="badge ' + (p.state === 'open' ? 'open' : 'closed') + '">' + (p.state === 'open' ? '投票中' : '已截止') + '</span><span>' + VOTE_TYPES[p.type].n + '</span>' + (p.quiz ? '<span>📝 第 ' + Math.max(1, S.bank.used.length) + ' / ' + S.bank.items.length + ' 題</span>' : '') + '<span id="vCnt"></span><span id="vAuto"></span></div>' +
      (p.show ? '<div class="bars">' + labels.map((l, i) => '<div class="bar' + (p.ans && p.ans.indexOf(LETTERS[i]) >= 0 ? ' ans' : '') + '" style="--bc:' + COLORS[i % COLORS.length] + '"><span class="lb">' + esc(marks[i]) + '</span><span class="tt">' + esc(l) + '</span><span class="ct"><span id="vc' + i + '"></span>' +
        (p.manualOn ? ' <span class="mb"><button data-man="' + i + '" data-d="-1" aria-label="減一票">−</button><button data-man="' + i + '" data-d="1" aria-label="加一票">＋</button></span>' : '') + '</span><div class="tr"><i id="vb' + i + '"></i></div></div>').join('') + '</div><div class="avg" id="vAvg"></div>'
        : '<div class="hiddenRes"><span>結果先保密，已作答</span><b id="vHid">0</b><span>人</span></div>') +
      '<div class="stageBar" style="margin-top:1rem">' + (p.state === 'open' ? '<button class="btn big red" data-act="vClose">⏹ 截止</button>' : '<button class="btn big g" data-act="vReopen">▶ 重新開放</button>') +
      '<button class="btn alt" data-act="vShow">' + (p.show ? '🙈 隱藏結果' : '👁 公布結果') + '</button>' +
      (p.type === 's' || p.type === 'm' || p.type === 't' ? '<button class="btn alt" data-act="vAns">✔ ' + (p.ans ? '改答案' : '設定答案') + '</button>' : '') +
      '<button class="btn alt" data-act="vManual" aria-pressed="' + !!p.manualOn + '">✋ 舉手計票' + (p.manualOn ? '（開）' : '') + '</button>' +
      '<button class="btn y" data-act="vNext">➕ 下一題</button></div>';
  }
  autoPaint();
  let okN = 0, badN = 0; if (p.ans && p.state !== 'open') Object.keys(p.votes).forEach((id) => { if (p.votes[id] === p.ans) okN++; else badN++; });
  const cnt = $('vCnt'); if (cnt) cnt.textContent = '已作答 ' + voters + ' 人' + (NET.want ? '／連線 ' + studentCount() + ' 人' : '') + (p.ans && p.state !== 'open' && Object.keys(p.votes).length ? '・✔ 答對 ' + okN + ' 人・✘ 答錯 ' + badN + ' 人' : '');
  const hid = $('vHid'); if (hid) hid.textContent = voters;
  labels.forEach((_, i) => {
    const a = $('vc' + i), b = $('vb' + i); if (!a) return;
    const pct = voters ? Math.round(c[i] / (p.type === 'm' ? voters : total || 1) * 100) : 0;
    a.textContent = c[i] + ' 票' + (voters ? '・' + pct + '%' : '');
    b.style.width = (c[i] / max * 100) + '%';
  });
  const avg = $('vAvg'); if (avg) avg.textContent = p.type === 'r' && total ? '平均 ' + (c.reduce((s, x, i) => s + x * (i + 1), 0) / total).toFixed(2) + ' 分' : '';
}
function vStart(item){
  const v = S.vote;
  if (!item) autoStop('已切回手動出題');
  if (item && item.q) { v.type = item.type; v.q = item.q; v.opts = item.opts.join('\n'); }
  else { v.q = ($('vQ') ? $('vQ').value : v.q).trim(); if ($('vOpts')) v.opts = $('vOpts').value; }
  let opts = [];
  if (v.type === 's' || v.type === 'm') { opts = v.opts.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 8); if (opts.length < 2) { toast('至少要 2 個選項'); return; } }
  if (v.cur) archivePoll();
  const n = v.type === 's' || v.type === 'm' ? opts.length : VOTE_TYPES[v.type].labels.length;
  v.cur = {pid:pid4(), type:v.type, q:v.q, opts, n, state:'open', show:true, ans:'', votes:{}, manual:Array(n).fill(0), manualOn:!NET.want, named:S.tab === 'quiz', quiz:S.tab === 'quiz', qid:S.tab === 'quiz' ? S.qs.id : '', qname:S.tab === 'quiz' ? (S.qs.name || S.bank.name || '測驗') : '', who:{}, at:new Date().toLocaleString('zh-TW', {hour12:false})};
  if (item && item.ans) v.cur.ans = item.ans;
  saveVote();
  if (NET.want) { NET.q = []; setTeacher(teacherVoteName(v.cur)); queueChats(pollChats(v.cur)); }
  SND.go(); lastStageKey = ''; renderVote();
}
function archivePoll(){
  const p = S.vote.cur; if (!p) return; const {c, voters} = tally(p);
  if (voters || c.some(Boolean)) { S.polls = lsJson('polls', []); S.polls.push(Object.assign(pollRecord(p), {rid:roster().id})); if (S.polls.length > 300) S.polls.shift(); lsPut('polls', S.polls); } // 先讀最新的，別蓋掉其他分頁寫的
}
const myPolls = () => { const id = roster().id; return S.polls.filter((h) => (!h.rid || h.rid === id) && !h.quiz); };
function pollRecord(p){
  const {c, voters} = tally(p), answers = {};
  if (p.named) Object.keys(p.votes).forEach((id) => { const w = p.who && p.who[id]; if (w) answers[w] = p.votes[id]; });
  return {quiz:!!p.quiz, qid:p.qid || '', qname:p.qname || '', q:p.q, type:VOTE_TYPES[p.type].n, t:p.type, labels:labelsOf(p), c, voters, ans:p.ans ? p.ans.split('').map((L) => labelsOf(p)[LETTERS.indexOf(L)]).join('、') : '', ansL:p.ans || '', named:!!p.named, answers, at:p.at};
}
// 成績：記名計分＋有設答案的題目（含目前這題），每位學生一列；姓名用目前班級名單的學號對應
// 成績：某一場測驗（qid）的題目，每位學生一列（✔／✘＋選了什麼、答對／答錯／未作答、得分），下方每題的答對／答錯／未作答名單
function quizPolls(qid){
  S.polls = lsJson('polls', S.polls);
  const qs = S.polls.filter((h) => h.quiz && h.qid === qid && h.ansL);
  const cur = S.vote.cur; if (cur && cur.quiz && cur.qid === qid && cur.ans) qs.push(pollRecord(cur));
  return qs;
}
function scoreRows(qid){
  qid = qid || S.qs.id;
  const qs = quizPolls(qid); if (!qs.length) return null;
  // answers 的 key 是學生輸入的學號或姓名；依目前名單對應成同一個人
  const r = roster(), people = {}, order = []; // order：依名單順序（數字學號當物件 key 會被排到最前面）
  r.list.forEach((n) => { const sid = (r.ids || {})[n] || ''; const k = sid ? cleanStu(sid) : 'N:' + n; if (!people[k]) order.push(k); people[k] = {sid, name:n}; });
  const qa = qs.map((h) => { const m = {}; Object.keys(h.answers || {}).forEach((w) => { const x = resolveWho(w); if (!people[x.key]) { people[x.key] = {sid:x.sid, name:'', raw:w}; order.push(x.key); } m[x.key] = h.answers[w]; }); return m; });
  const show = (h, a) => h.t === 't' ? a.replace('A', 'O').replace('B', 'X') : a;
  const label = (k) => { const pp = people[k]; return pp.name ? (pp.sid ? pp.sid + ' ' : '') + pp.name : pp.raw; };
  const list = order.map((k) => {
    let ok = 0, bad = 0;
    const cells = qs.map((h, qi) => { const a = qa[qi][k]; if (!a) return '未作答'; if (a === h.ansL) { ok++; return '✔ 答對（' + show(h, a) + '）'; } bad++; return '✘ 答錯（' + show(h, a) + '）'; });
    const pp = people[k];
    return {k, ok, row:[pp.sid, pp.name || '（名單外：' + pp.raw + '）'].concat(cells, [ok, bad, qs.length - ok - bad, qs.length, Math.round(ok / qs.length * 100)])};
  }).sort((a, b) => b.ok - a.ok || (a.row[0] + a.row[1] > b.row[0] + b.row[1] ? 1 : -1));
  const rows = [['學號', '姓名'].concat(qs.map((_, i) => '第 ' + (i + 1) + ' 題'), ['答對題數', '答錯題數', '未作答題數', '總題數', '得分（百分制）'])].concat(list.map((o) => o.row));
  rows.push([], ['題號', '題目', '正確答案', '答對人數', '答錯人數', '答對率', '答對名單', '答錯名單', '未作答名單']);
  qs.forEach((h, i) => {
    const m = qa[i], keys = order, okL = keys.filter((k) => m[k] && m[k] === h.ansL), badL = keys.filter((k) => m[k] && m[k] !== h.ansL), noL = keys.filter((k) => !m[k]);
    rows.push(['第 ' + (i + 1) + ' 題', h.q, show(h, h.ansL) + '（' + h.ans + '）', okL.length, badL.length, okL.length + badL.length ? Math.round(okL.length / (okL.length + badL.length) * 100) + '%' : '',
      okL.map(label).join('、'), badL.map((k) => label(k) + '（' + show(h, m[k]) + '）').join('、'), noL.map(label).join('、')]);
  });
  return {rows, nQ:qs.length, nS:list.filter((o) => o.row.slice(2, 2 + qs.length).some((c) => c !== '未作答')).length, list:list.map((o) => ({k:o.k, ok:o.ok, name:people[o.k].name, raw:people[o.k].raw})), total:qs.length};
}
function quizSessions(){
  const id = roster().id, seen = {};
  lsJson('polls', []).forEach((h) => { if (h.quiz && h.qid && (!h.rid || h.rid === id)) { const s = seen[h.qid] || (seen[h.qid] = {qid:h.qid, name:h.qname || '測驗', at:h.at, n:0}); s.n++; } });
  if (!seen[S.qs.id]) seen[S.qs.id] = {qid:S.qs.id, name:S.qs.name || '測驗', at:'', n:0};
  return Object.values(seen).reverse();
}
function scoreCard(){
  const sr = scoreRows(S.qs.id), past = quizSessions().filter((s) => s.qid !== S.qs.id && s.n);
  return '<div class="card"><h3>🏆 本次測驗成績<span class="r">' + (sr ? sr.nQ + ' 題・' + sr.nS + ' 人作答' : '') + '</span></h3>' +
    '<p class="small" style="margin:0 0 .4rem">「' + esc(S.qs.name || '測驗') + '」' + (sr ? '已計分 ' + sr.nQ + ' 題（有設答案的題目；按「下一題」或自動出題換題時記入）。' : '還沒有計分的題目。') + '</p>' +
    (sr ? '<div class="row"><button class="btn alt" data-act="scCsv">⬇ 成績 CSV</button><button class="btn alt" data-act="scXlsx">⬇ 成績 Excel</button><button class="btn alt" data-act="scBoard">🏅 排行榜</button></div>' : '') +
    '<div class="row" style="margin-top:.4rem"><button class="btn alt" data-act="quizNew">🆕 開始新測驗</button></div>' +
    (past.length ? '<p class="small" style="margin:.5rem 0 .2rem">之前的測驗（' + esc(roster().name) + '）：</p><ul class="hist">' + past.slice(0, 10).map((s) => '<li><b>' + esc(s.name) + '</b><span class="small">' + esc(s.at) + '・' + s.n + ' 題</span> <button class="ib" data-scq="' + s.qid + '" data-kind="xlsx" style="min-height:2rem">⬇ Excel</button><button class="ib" data-scq="' + s.qid + '" data-kind="csv" style="min-height:2rem">⬇ CSV</button></li>').join('') + '</ul>' : '') + '</div>';
}
function scoreExport(kind, qid){
  qid = qid || S.qs.id;
  const sr = scoreRows(qid); if (!sr) { toast('還沒有可計分的題目'); return; }
  const s = quizSessions().find((x) => x.qid === qid) || {name:'測驗'};
  const fn = roster().name + '-' + (s.name || '測驗') + '-成績-' + new Date().toLocaleDateString('sv');
  if (kind === 'csv') download(fn + '.csv', TCHIO.csvText(sr.rows), 'text/csv');
  else downloadBlob(fn + '.xlsx', TCHIO.xlsxBlob(sr.rows, '成績', [14, 12].concat(Array(sr.nQ).fill(14), [10, 10, 10, 10, 14])));
}
function openBoard(){
  const sr = scoreRows(S.qs.id); if (!sr) { toast('還沒有成績'); return; }
  const top = sr.list.filter((o) => o.ok > 0).slice(0, 10); let rank = 0, last = -1;
  openModal('<h2>🏅 排行榜・' + esc(S.qs.name || '測驗') + '</h2><p class="small">共 ' + sr.total + ' 題，依答對題數排序（同分同名次）。</p>' +
    (top.length ? '<ol class="phList" style="list-style:none;padding:0">' + top.map((o, i) => { if (o.ok !== last) { rank = i + 1; last = o.ok; } return '<li>' + (rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : rank + '.') + ' ' + esc(o.name ? disp(o.name) : o.raw) + '<span>答對 ' + o.ok + ' / ' + sr.total + '</span></li>'; }).join('') + '</ol>' : '<p>還沒有人答對。</p>') +
    '<div class="stack"><button class="btn" data-act="close">關閉</button></div>', true);
}
function newQuiz(name){ S.qs = {id:'q' + Date.now().toString(36), name:name || S.bank.name || '測驗', at:new Date().toLocaleString('zh-TW', {hour12:false})}; lsPut('quizSess', S.qs); }
function renderQuiz(){
  $('app').innerHTML = '<section class="tool"><div class="stage" id="vStage"></div>' +
    '<aside class="side">' + netCard() + bankCard() + scoreCard() +
    '<div class="card"><h3>💡 測驗怎麼用</h3><p class="small" style="margin:0">1. 開放手機連線（學生輸入學號或姓名）→ 2. 匯入題庫（Word／Excel／CSV／文字，要有答案）→ 3. 手動或自動出題 → 4. 下載成績：每位學生每題答對或答錯、得分，以及每題的答對／答錯名單。</p></div>' +
    '</aside></section>';
  lastStageKey = ''; votePaint(); drawQR($('qrSide'), 170);
}
/* 題庫 */
const ansShow = (q) => q.type === 't' ? (q.ans === 'A' ? 'O' : 'X') : q.ans;
function bankCard(){
  const b = S.bank, it = b.items;
  if (!it.length) return '<div class="card"><h3>📚 題庫</h3><p class="small" style="margin:0 0 .4rem">上傳 Word（.docx）、Excel、CSV 或文字檔，事先出好的題目一題一題出，答案自動帶入。</p><div class="row"><button class="btn alt" data-act="bankOpen">📂 匯入題庫</button><button class="btn alt" data-act="bankTpl">⬇ Excel 範本</button><button class="btn alt" data-act="bankAdd">➕ 手動新增一題</button></div></div>';
  const used = new Set(b.used || []), next = it.findIndex((_, i) => !used.has(i));
  const noAns = it.filter((q) => !q.ans).length;
  return '<div class="card"><h3>📚 題庫<span class="r">' + esc(cut(b.name, 14)) + '・已出 ' + used.size + '/' + it.length + '</span></h3>' +
    '<p class="small" style="margin:0 0 .4rem">✔ 有答案 ' + (it.length - noAns) + ' 題（會計算答對題數）' + (noAns ? '・<b style="color:var(--r)">⚠ 未設答案 ' + noAns + ' 題（不計分，可按 ✏ 補上）</b>' : '') + '</p>' +
    autoPanel(next) +
    '<ol class="hist" style="margin-top:.4rem;padding-left:1.4em;list-style:decimal">' + it.map((q, i) => '<li' + (used.has(i) ? ' style="opacity:.55"' : '') + '><b>' + esc(cut(q.q, 40)) + '</b><span class="small">' + VOTE_TYPES[q.type].n + (q.ans ? '・答案 ' + esc(ansShow(q)) : '・<b style="color:var(--r)">⚠ 未設答案</b>') + (used.has(i) ? '・已出' : '') + '</span> <button class="ib" data-bank="' + i + '" style="min-height:2rem">▶ 出這題</button><button class="ib" data-bedit="' + i + '" style="min-height:2rem" title="修改答案">✏ 答案</button></li>').join('') + '</ol>' +
    '<div class="row" style="margin-top:.4rem"><button class="btn alt" data-act="bankAdd">➕ 手動新增一題（含答案）</button></div>' +
    '<div class="row" style="margin-top:.5rem"><button class="btn alt" data-act="bankOpen">📂 換題庫</button><button class="btn alt" data-act="bankReset">↺ 重新開始</button><button class="btn alt" data-act="bankClear">🗑 清空</button></div></div>';
}
// 把答案寫回題庫（出題時才補的答案，下次出同一題就有了）
function bankSetAns(i, ans, q){
  const it = S.bank.items[i]; if (!it || (q != null && it.q !== q)) return;
  it.ans = ans || ''; if (it.type === 's' && ans.length > 1) it.type = 'm';
  lsPut('bank', S.bank);
}
function bankEdit(i){
  const q = S.bank.items[i]; if (!q) return;
  const marks = q.type === 't' ? ['⭕ 是', '❌ 否'] : q.opts.map((o, k) => LETTERS[k] + '. ' + o);
  openModal('<h2>✏ 設定答案</h2><p><b>' + esc(q.q) + '</b></p><p class="small">' + (q.type === 't' ? '是非題選一個。' : '選一個＝單選題；選兩個以上＝多選題。') + '</p><div class="stack">' +
    marks.map((m, k) => '<button class="btn alt" data-ans-pick="' + LETTERS[k] + '" aria-pressed="' + (q.ans.indexOf(LETTERS[k]) >= 0) + '">' + esc(m) + '</button>').join('') + '</div>' +
    '<div class="stack"><button class="btn" data-act="bankEditOk" data-i="' + i + '">💾 儲存答案</button><button class="btn alt" data-act="close">取消</button></div>');
}
function bankAddModal(){
  openModal('<h2>➕ 手動新增一題</h2>' +
    '<label class="small" style="display:block">題目<input class="tx" id="baQ" maxlength="120"></label>' +
    '<label class="small" style="display:block;margin-top:.5rem">選項（一行一個，2～8 個；<b>空白＝是非題</b>）<textarea class="tx" id="baOpts" rows="4"></textarea></label>' +
    '<label class="small" style="display:block;margin-top:.5rem">答案（選擇題填字母，例如 B 或多選 AC；是非題填 O 或 X；不知道可以先空著）<input class="tx" id="baAns" maxlength="8" style="text-transform:uppercase"></label>' +
    '<div class="stack"><button class="btn" data-act="bankAddOk">➕ 加入題庫</button><button class="btn alt" data-act="close">取消</button></div>');
  setTimeout(() => { const e = $('baQ'); if (e) e.focus(); }, 50);
}
let bankDraft = null;
function bankModal(){
  const d = bankDraft;
  openModal('<h2>📚 匯入題庫</h2><div class="row"><button class="btn y" data-act="bankPick">📂 選擇檔案（.docx／.xlsx／.csv／.txt）</button><button class="btn alt" data-act="bankTpl">⬇ Excel 範本</button><input type="file" id="bankFile" accept=".docx,.xlsx,.xlsm,.csv,.tsv,.txt,.md" hidden></div>' +
    '<details style="margin-top:.5rem"><summary class="small" style="cursor:pointer">Word／文字檔怎麼寫？</summary><pre class="small" style="white-space:pre-wrap;background:var(--bg);padding:.5rem;border-radius:.5rem">1. 下列何者是大型語言模型？\n(A) Excel (B) ChatGPT (C) Word\n答案：B\n\n2. 哪些是 Google 的產品？\nA. Gemini\nB. Claude\nC. NotebookLM\n答案：AC（多個答案＝多選題）\n\n(X)3. 毛利率越高一定越賺錢。（沒有選項、答案 O/X＝是非題）</pre><p class="small">題號、選項可以用 Word 自動編號；答案寫在「答案：」後面，或像考卷寫在題號前面「(B)1.」。沒有答案也能出題，只是不計分。Excel／CSV：欄位「題目、選項A～選項H、答案」。</p></details>' +
    '<label class="small" style="display:block;margin-top:.5rem">或直接貼上題目文字<textarea class="tx" id="bankText" rows="5"></textarea></label><button class="btn alt" data-act="bankParse" style="margin-top:.4rem">解析貼上的文字</button>' +
    (d ? '<div class="card" style="margin-top:.7rem"><h3>讀到 ' + d.items.length + ' 題' + (d.skipped.length ? '<span class="r">略過 ' + d.skipped.length + ' 題</span>' : '') + '</h3>' +
      '<p class="small" style="margin:0 0 .3rem">✔ 有答案 ' + d.items.filter((q) => q.ans).length + ' 題，答案會一起存進題庫，用來計算答對題數' + (d.items.some((q) => !q.ans) ? '；<b style="color:var(--r)">⚠ 沒讀到答案 ' + d.items.filter((q) => !q.ans).length + ' 題</b>（匯入後可以在題庫按「✏ 答案」補上）' : '') + '。</p>' + '<ol class="hist" style="padding-left:1.4em;list-style:decimal">' +
      d.items.map((q) => '<li><b>' + esc(q.q) + '</b><span class="small">' + VOTE_TYPES[q.type].n + '・' + (q.type === 't' ? '是／否' : q.opts.map((o, i) => LETTERS[i] + '. ' + esc(o)).join('　')) + '・' + (q.ans ? '答案 ' + esc(ansShow(q)) : '未設答案') + '</span></li>').join('') + '</ol>' +
      (d.skipped.length ? '<p class="small">略過（沒有選項也沒有是非答案）：' + d.skipped.map((x) => esc(cut(x, 20))).join('、') + '</p>' : '') + '</div>' : '') +
    '<div class="stack">' + (d && d.items.length ? '<button class="btn" data-act="bankUse">✔ 使用這 ' + d.items.length + ' 題</button>' : '') + '<button class="btn alt" data-act="close">取消</button></div>', true);
}
async function bankFromFile(f){
  try { const x = await TCHIO.readFile(f), res = x.rows ? TCHIO.rowsToQuiz(x.rows) : TCHIO.parseQuizText(x.text); bankDraft = Object.assign(res, {name:f.name.replace(/\.[^.]+$/, '')}); if (!res.items.length) toast('檔案裡找不到題目，請參考格式說明'); bankModal(); }
  catch (e) { toast(e.message || '讀檔失敗'); }
}
function bankUse(){ if (!bankDraft || !bankDraft.items.length) return; S.bank = {name:bankDraft.name || '貼上的題目', items:bankDraft.items.slice(0, 200), used:[]}; lsPut('bank', S.bank); if (!quizPolls(S.qs.id).length) newQuiz(S.bank.name); bankDraft = null; closeModal(); renderVote(); toast('題庫已載入，共 ' + S.bank.items.length + ' 題'); }
function autoPanel(next){
  const a = S.auto, auto = a.mode === 'auto';
  let h = '<span class="seg" role="group" aria-label="出題方式" style="margin-bottom:.5rem"><button data-amode="manual" aria-pressed="' + !auto + '">✋ 手動出題</button><button data-amode="auto" aria-pressed="' + auto + '">⏱ 自動出題</button></span>';
  if (!auto) return h + (next >= 0 ? '<button class="btn y" data-act="bankNext" style="width:100%">▶ 出下一題（第 ' + (next + 1) + ' 題）</button>' : '<p class="small">全部出完了，按「↺ 重新開始」可以再出一輪。</p>');
  h += '<div class="row"><span class="small">每題作答</span>' + numBox('autoAsk', a.ask, 5, 600) + '<span class="small">秒</span></div>' +
    '<div class="row" style="margin-top:.3rem"><span class="small">公布答案停留</span>' + numBox('autoReveal', a.reveal, 0, 120) + '<span class="small">秒</span></div>' +
    '<label class="ck"><input type="checkbox" id="autoEarly"' + (a.early ? ' checked' : '') + '> 全班都作答完就提早截止</label>' +
    '<label class="ck"><input type="checkbox" id="autoHide"' + (a.hide ? ' checked' : '') + '> 作答時先隱藏結果</label>';
  if (AUTO.on) h += '<div class="row" style="margin-top:.4rem"><button class="btn ' + (AUTO.paused ? 'g' : 'alt') + '" data-act="autoPause">' + (AUTO.paused ? '▶ 繼續' : '⏸ 暫停') + '</button><button class="btn red" data-act="autoStop">⏹ 停止自動</button></div>';
  else h += next >= 0 ? '<button class="btn y" data-act="autoStart" style="width:100%;margin-top:.4rem">▶ 開始自動出題（從第 ' + (next + 1) + ' 題）</button>' : '<p class="small">全部出完了，按「↺ 重新開始」可以再出一輪。</p>';
  return h + '<p class="small" style="margin:.3rem 0 0">時間到自動截止、公布答案，停留後自動出下一題，一直到題庫出完。中途按「截止」「下一題」或「出這題」會切回手動。</p>';
}
/* 自動出題 */
const AUTO = {on:false, paused:false, phase:'', until:0, left:0};
const nextBankIdx = () => { const used = new Set(S.bank.used); return S.bank.items.findIndex((_, k) => !used.has(k)); };
function autoStart(){
  const i = nextBankIdx(); if (i < 0) { toast('題庫都出完了'); return; }
  AUTO.on = true; AUTO.paused = false; autoAsk(i);
}
function autoAsk(i){
  bankStart(i, true);
  const p = S.vote.cur; if (p && S.auto.hide) { p.show = false; saveVote(); lastStageKey = ''; votePaint(); }
  AUTO.phase = 'ask'; AUTO.until = Date.now() + S.auto.ask * 1000; autoPaint();
}
function autoStop(msg){ if (!AUTO.on) return; AUTO.on = false; AUTO.paused = false; AUTO.phase = ''; if (msg) toast(msg); if (isVT()) renderVote(); }
function autoTick(){
  if (!AUTO.on || AUTO.paused) return;
  const p = S.vote.cur, now = Date.now();
  if (!p) { autoStop(); return; }
  if (AUTO.phase === 'ask') {
    const all = S.auto.early && NET.want && studentCount() > 0 && tally(p).voters >= studentCount();
    if (now >= AUTO.until || all) {
      p.state = 'closed'; p.show = true; saveVote(); setTeacher(teacherVoteName(p)); SND.pop(); lastStageKey = ''; if (isVT()) votePaint();
      AUTO.phase = 'reveal'; AUTO.until = now + S.auto.reveal * 1000;
    }
  } else if (AUTO.phase === 'reveal' && now >= AUTO.until) {
    const i = nextBankIdx();
    if (i < 0) { archivePoll(); S.vote.cur = null; saveVote(); if (NET.want) setTeacher('T|w'); lastStageKey = ''; autoStop('🎉 題庫全部出完了'); return; }
    autoAsk(i);
  }
  autoPaint();
}
function autoPaint(){
  const el = $('vAuto'); if (!el) return;
  if (!AUTO.on) { el.textContent = ''; return; }
  const left = Math.max(0, Math.ceil(((AUTO.paused ? AUTO.left : AUTO.until - Date.now())) / 1000));
  el.textContent = AUTO.paused ? '⏸ 暫停中' : AUTO.phase === 'ask' ? '⏱ 剩 ' + left + ' 秒' : '✔ 公布答案・' + left + ' 秒後下一題';
  el.className = 'badge ' + (AUTO.phase === 'ask' && left <= 5 && !AUTO.paused ? 'closed' : 'idle');
}
function bankStart(i, fromAuto){
  if (!fromAuto) autoStop('已切回手動出題');
  const q = S.bank.items[i]; if (!q) return;
  vStart(q); if (S.vote.cur) { S.vote.cur.bankIdx = i; saveVote(); } if (S.bank.used.indexOf(i) < 0) S.bank.used.push(i); lsPut('bank', S.bank); renderVote();
}
const BANK_TPL = [['題目', '選項A', '選項B', '選項C', '選項D', '答案'], ['下列何者是大型語言模型？', 'Excel', 'ChatGPT', 'Word', '小畫家', 'B'], ['哪些是 Google 的產品？', 'Gemini', 'Claude', 'NotebookLM', '', 'AC'], ['毛利率越高一定越賺錢。', '', '', '', '', 'X']];
function pollCsv(){
  const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
  const rows = [['時間', '題目', '題型', '選項', '票數', '作答人數', '正確答案'].map(q).join(',')];
  myPolls().forEach((h) => h.labels.forEach((l, i) => rows.push([h.at, h.q, h.type, l, h.c[i], h.voters, h.ans].map(q).join(','))));
  return '﻿' + rows.join('\r\n');
}

/* ---------- 學生手機頁 ---------- */
const cleanWho = (v) => cut(String(v || '').replace(/[|<>\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim(), 12);
const JS = {tid:'', name:'', qtext:{}, otext:{}, picks:'', who:cleanWho(lsGet('who') || lsGet('stuno') || ''), named:false};
// 學生狀態代碼最後一段一律帶學號／姓名：W|誰、S|題號|選項|誰、B|輪次|誰
const withWho = (n) => { const a = String(n || 'W').split('|'); const k = a[0] === 'S' ? 3 : a[0] === 'B' ? 2 : 1; a.length = Math.max(a.length, k); a[k] = JS.who; return a.slice(0, k + 1).join('|'); };
function voteSend(pid, L){ const n = 'S|' + pid + '|' + L + '|' + JS.who; if (n.length > 24) { toast('名字太長或選太多項，送不出去'); return false; } myName(n); return true; }
function onChat(m){
  if (!m || !m.text) return;
  const tName = NET.peers.get(m.id);
  if (m.id !== JS.tid && !(tName && /^T\|/.test(tName))) return; // 只收老師送的題目
  let r = /^Q(\d{4}):(.*)$/.exec(m.text); if (r) { JS.qtext[r[1]] = r[2]; return; }
  r = /^O(\d{4})\.(\d+):(.*)$/.exec(m.text); if (r) { (JS.otext[r[1]] = JS.otext[r[1]] || [])[+r[2]] = r[3]; }
}
function teacherState(){ const n = NET.peers.get(JS.tid); return n && /^T\|/.test(n) ? n.split('|') : null; }
function myName(n){ JS.name = n; lsSet('my.' + NET.code, n); send({t:'look', name:n}); }
function renderJoin(){
  const root = $('root'); if (!root) return;
  if (!NET.want) {
    root.innerHTML = '<div class="join"><div class="jHead"><div class="brand"><img src="icons/icon-192.png" alt=""><span>課堂小幫手</span></div></div><div class="jMain"><div class="jQ">🏫 選擇教室</div><div class="small" id="lobbyCnt" style="text-align:center"></div><div id="lobbyList"></div>' +
      '<div class="jQ" style="font-size:1.15rem;margin-top:.6rem">或輸入老師給的 6 碼代碼</div>' +
      '<form class="codeIn" id="codeForm"><input class="tx" id="codeIn" maxlength="6" autocomplete="off" autocapitalize="characters" inputmode="text" aria-label="代碼"><button class="btn y">加入</button></form></div>' + joinFoot() + '</div>';
    paintLobby(); startLobby();
    return;
  }
  if (JS.closed) {
    root.innerHTML = '<div class="join"><div class="jHead"><div class="brand"><img src="icons/icon-192.png" alt=""><span>課堂小幫手</span></div><div class="r"><span class="dot bad"></span>' + NET.code + '</div></div><div class="jMain"><div class="jWait"><span class="big">🚪</span>這間教室已關閉，<br>或老師還沒開放</div>' +
      '<p class="jWait" style="font-size:1rem">舊的網址和 QR code 在老師關閉教室後就不能用了，請掃描老師現在畫面上的 QR code。</p>' +
      '<div class="row c"><button class="btn alt" data-act="joinRetry">🔄 再試一次</button><button class="btn y" data-act="joinNew">⌨ 輸入新代碼</button></div></div>' + joinFoot() + '</div>';
    return;
  }
  if (JS.pwNeed) {
    root.innerHTML = '<div class="join"><div class="jHead"><div class="brand"><img src="icons/icon-192.png" alt=""><span>課堂小幫手</span></div><div class="r"><span class="dot bad"></span>' + NET.code + '</div></div><div class="jMain"><div class="jQ">🔒 這間教室要密碼</div>' +
      '<form class="codeIn" id="pwForm"><input class="tx" id="pwIn" maxlength="8" autocomplete="off" autocapitalize="characters" aria-label="教室密碼"><button class="btn y">進入</button></form>' + (NET.pw ? '<p class="jWait" style="font-size:1rem">密碼不對，請再看一次大螢幕。</p>' : '') + '</div>' + joinFoot() + '</div>';
    return;
  }
  if (!JS.who || JS.whoEdit) {
    root.innerHTML = '<div class="join"><div class="jHead"><div class="brand"><img src="icons/icon-192.png" alt=""><span>課堂小幫手</span></div><div class="r"><span class="dot ' + (NET.status === 'on' ? 'on' : 'bad') + '"></span>' + NET.code + '</div></div><div class="jMain"><div class="jQ">👤 請輸入學號或姓名</div>' +
      '<form class="codeIn" id="whoForm"><input class="tx" id="whoIn" maxlength="12" autocomplete="off" value="' + esc(JS.who) + '" placeholder="例：410012345／王小明" style="letter-spacing:0;font-size:1.3rem;text-transform:none" aria-label="學號或姓名"><button class="btn y">進入</button></form>' +
      '<p class="jWait" style="font-size:1rem">老師用來辨識你、點名；搶答時大螢幕會顯示。</p></div>' + joinFoot() + '</div>';
    setTimeout(() => { const el = $('whoIn'); if (el) el.focus(); }, 50);
    return;
  }
  const ts = teacherState(), on = NET.status === 'on';
  let body = '';
  if (!on) body = '<div class="jWait"><span class="big">📡</span>連線中⋯</div>';
  else if (!ts) body = '<div class="jWait"><span class="big">⏳</span>已加入，等老師開始</div>';
  else if (ts[1] === 'v') body = joinVote(ts);
  else if (ts[1] === 'b') body = joinBuzz(ts);
  else body = '<div class="jWait"><span class="big">🙂</span>已加入，等老師出題</div>';
  root.innerHTML = '<div class="join"><div class="jHead"><div class="brand"><img src="icons/icon-192.png" alt=""><span>課堂小幫手</span></div><div class="r"><button class="ib" data-act="whoEdit" style="min-height:1.9rem;font-size:.8rem">👤 ' + esc(JS.who) + ' ✎</button><span class="dot ' + (on ? 'on' : 'bad') + '"></span>' + NET.code + '</div></div><div class="jMain">' + body + '</div>' + joinFoot() + '</div>';
}
function joinFoot(){ return '<div class="jFoot">' + (JS.named ? '記名計分：老師會看到你的答案並計分。' : '老師知道你有加入，但大螢幕不會顯示誰選了什麼。') + '<br><a href="./">講師課堂小幫手</a>・<a href="manual.html">說明</a>・<button class="ib" style="min-height:0;padding:0;background:none;color:var(--r);text-decoration:underline" data-act="warn">⚠ 使用警語</button></div>'; }
function joinVote(ts){
  const tl = String(ts[4] || ''), named = /[A-Z]/.test(tl), pid = ts[2], n = clamp(+ts[3] || 2, 2, 8), type = VOTE_TYPES[tl.toLowerCase()] ? tl.toLowerCase() : 's', open = ts[5] === 'o', ans = ts[6] || '';
  JS.named = named;
  const mine = JS.name.split('|'), voted = mine[0] === 'S' && mine[1] === pid ? mine[2] : '';
  if (JS.pid !== pid) { JS.pid = pid; JS.picks = voted; }
  const T2 = VOTE_TYPES[type]; let labels = T2.labels ? T2.labels.slice() : null;
  if (!labels) { const parts = (JS.otext[pid] || []); labels = []; let ok = true; for (let i = 0; i < parts.length; i++) { if (parts[i] == null) { ok = false; break; } } if (ok && parts.length) labels = parts.join(' ｜ ').split(' ｜ '); }
  const marks = T2.marks || LETTERS.split('');
  const q = JS.qtext[pid];
  let h = (named ? '<p class="jFoot" style="margin:0">🏆 這題記名計分</p>' : '') + '<div class="jQ">' + (q ? esc(q) : '請看大螢幕的題目') + '</div>';
  if (!open && ans) {
    const ok = voted && voted === ans.split('').sort().join('');
    h += '<div class="result ' + (ok ? 'ok' : 'no') + '">' + (!voted ? '這題你沒有作答' : ok ? '🎉 答對了！' : '再接再厲！') + '</div><p class="jWait" style="font-size:1.1rem">答案：' + ans.split('').map((L) => esc(marks[LETTERS.indexOf(L)] + ' ' + (labels[LETTERS.indexOf(L)] || ''))).join('、') + '</p>';
  } else if (!open) h += '<div class="jWait"><span class="big">⏹</span>投票已截止' + (voted ? '，你選了 ' + voted.split('').map((L) => esc(marks[LETTERS.indexOf(L)])).join('、') : '') + '</div>';
  const multi = type === 'm', picks = multi ? JS.picks : voted;
  h += '<div class="opts' + (n <= 2 || type === 't' ? ' two' : '') + '">' + Array.from({length:n}, (_, i) => '<button class="opt" style="--bc:' + COLORS[i % COLORS.length] + '" data-vote="' + LETTERS[i] + '" aria-pressed="' + (picks.indexOf(LETTERS[i]) >= 0) + '"' + (open ? '' : ' disabled') + '><span class="lb">' + esc(marks[i]) + '</span><span>' + esc(labels[i] || '') + '</span></button>').join('') + '</div>';
  if (open && multi) h += '<button class="btn big y" data-act="vSend"' + (JS.picks ? '' : ' disabled') + '>' + (voted && voted === JS.picks ? '✔ 已送出' : '送出（可複選）') + '</button>';
  if (open && voted) h += '<p class="jWait" style="font-size:1.05rem">✔ 已收到你的答案，截止前可以改。</p>';
  return h;
}
function joinBuzz(ts){
  const rid = ts[2], phase = ts[3];
  const mine = JS.name.split('|'), pressed = mine[0] === 'B' && mine[1] === rid;
  let h = '<div class="jQ">🔔 搶答</div>';
  if (pressed) h += '<div class="jWait"><span class="big">🙋</span>已按下！看大螢幕</div>';
  else if (phase === 'o') h += '<button class="bigBuzz" data-act="buzz">搶！</button>';
  else if (phase === 'p') h += '<button class="bigBuzz" disabled>準備</button><p class="jWait">倒數中，先別按⋯</p>';
  else h += '<div class="jWait"><span class="big">⏳</span>等老師開始搶答</div>';
  return h;
}

/* ---------- ⚙ 常用設定 ---------- */
function sec(id, title, val, body){ return '<details class="set-sec" data-sec="' + id + '"><summary><span class="sst">' + title + '</span><span class="ssv">' + esc(val) + '</span></summary><div class="set-body">' + body + '</div></details>'; }
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
function openSettings(){
  const pf = S.pref, fsN = {m:'標準', l:'大', xl:'特大'};
  openModal('<div class="row"><h2 style="flex:1 1 0;margin:0">⚙ 常用設定</h2><button class="ib" data-act="foldAll">全部展開／收合</button></div><div style="margin-top:.6rem">' +
    sec('look', '🎨 畫面', (pf.theme === 'white' ? '白板' : '黑板') + '・' + fsN[pf.fs] + '字',
      '<p class="small">投影機偏暗時改用白板。</p><div class="row"><span class="seg"><button data-theme-set="board" aria-pressed="' + (pf.theme !== 'white') + '">🟩 黑板</button><button data-theme-set="white" aria-pressed="' + (pf.theme === 'white') + '">⬜ 白板</button></span></div>' +
      '<div class="row" style="margin-top:.5rem"><span class="small">字級</span><span class="seg">' + Object.keys(fsN).map((k) => '<button data-fs-set="' + k + '" aria-pressed="' + (pf.fs === k) + '">' + fsN[k] + '</button>').join('') + '</span></div>') +
    sec('snd', '🔊 音效', pf.sound ? '開・音量 ' + Math.round(pf.vol * 100) + '%' : '關',
      '<label class="ck"><input type="checkbox" id="sndOn"' + (pf.sound ? ' checked' : '') + '> 開啟音效</label><label class="small" style="display:block;margin-top:.3rem">音量<input type="range" id="sndVol" min="0.1" max="1" step="0.1" value="' + pf.vol + '" style="width:100%"></label><button class="btn alt" data-act="sndTest">試聽</button>') +
    sec('roster', '📋 班級名單', S.rosters.length + ' 班・目前 ' + roster().name, '<p class="small">名單只存在這台電腦。</p><button class="btn" data-act="roster">✏ 編輯名單</button>') +
    sec('data', '💾 資料備份', '', '<p class="small">名單、分組結果、投票紀錄與設定都只存在這台電腦的瀏覽器。換電腦前先下載備份檔，再到新電腦還原。</p><div class="stack"><button class="btn" data-act="backup">⬇ 下載備份檔</button><button class="btn alt" data-act="restore">⬆ 從備份檔還原</button><button class="btn red" data-act="wipe">🗑 清除全部資料</button></div><input type="file" id="restoreFile" accept=".json,application/json" hidden>') +
    sec('about', 'ℹ 關於本工具', '', '<p>👤 創作者 Mark Tsai（蔡豐全）<br><a href="mailto:tsaimark@gmail.com">tsaimark@gmail.com</a></p><div class="stack"><a class="btn alt" href="manual.html">📖 操作手冊</a><a class="btn alt" href="manual.html#creator">👤 關於創作者</a><button class="btn alt" data-act="warn">⚠ 使用警語</button>' +
      (standalone ? '' : '<button class="btn alt" data-act="install">📲 加入主畫面</button>') + '</div><p class="small" style="margin-top:.5rem">訪客數 <img src="https://visitor-badge.laobi.icu/badge?page_id=m255525.teacherclassroomhelper" alt="訪客次數" height="20" loading="lazy" style="vertical-align:middle"></p>') +
    '</div><div class="stack"><button class="btn" data-act="close">關閉</button></div>');
  const open = lsJson('fold', []);
  document.querySelectorAll('.set-sec').forEach((d) => { d.open = open.indexOf(d.dataset.sec) >= 0; d.addEventListener('toggle', saveFold); });
  $('restoreFile').addEventListener('change', restoreFile);
}
function saveFold(){ const o = []; document.querySelectorAll('.set-sec').forEach((d) => { if (d.open) o.push(d.dataset.sec); }); lsPut('fold', o); }
const BACKUP_KEYS = ['pref', 'rosters', 'cur', 'drawn', 'drawOpt', 'grp', 'timer', 'buzz', 'vote', 'polls', 'bank', 'auto', 'quizSess'];
function backup(){ const o = {app:'teacher-classroom-helper', v:1, at:new Date().toISOString(), data:{}}; BACKUP_KEYS.forEach((k) => { const v = lsGet(k); if (v != null) o.data[k] = v; }); download('課堂小幫手備份-' + new Date().toLocaleDateString('sv') + '.json', JSON.stringify(o, null, 1), 'application/json'); }
function restoreFile(e){
  const f = e.target.files[0]; if (!f) return;
  f.text().then((t) => {
    const o = JSON.parse(t); if (!o || o.app !== 'teacher-classroom-helper' || !o.data) throw 0;
    const r = JSON.parse(o.data.rosters || 'null'); if (r && !(Array.isArray(r) && r.every((x) => x && typeof x.id === 'string' && Array.isArray(x.list)))) throw 0;
    BACKUP_KEYS.forEach((k) => { if (typeof o.data[k] === 'string') lsSet(k, o.data[k]); });
    location.reload();
  }).catch(() => toast('這不是課堂小幫手的備份檔'));
}
function install(){
  if (window._dp) { window._dp.prompt(); window._dp = null; return; }
  openModal('<h2>📲 加入主畫面</h2><ul><li><b>電腦 Chrome／Edge</b>：網址列右側的「安裝」圖示，或選單 →「安裝應用程式」。</li><li><b>iPhone／iPad</b>：用 Safari 開啟 → 分享 →「加入主畫面」。</li><li><b>Android</b>：Chrome 選單 →「加到主畫面」。</li></ul><p class="small">加入後可以離線開啟（投票與手機搶答仍需要網路）。</p><div class="stack"><button class="btn" data-act="close">知道了</button></div>');
}
function toggleFs(){ if (document.fullscreenElement) document.exitFullscreen(); else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => toast('這個瀏覽器不能全螢幕，請按 F11')); }

/* ---------- 事件 ---------- */
document.addEventListener('click', (e) => {
  const t = e.target.closest('button,[data-tab]'); if (!t) { if (e.target.id === 'modal') closeModal(); return; }
  const d = t.dataset;
  if (d.tab && !JOIN) { setTab(d.tab); return; }
  if (d.step) { const inp = $(d.step); if (!inp) return; inp.value = clamp((+inp.value || 0) + (+d.d), +inp.min, +inp.max); inp.dispatchEvent(new Event('change', {bubbles:true})); return; }
  if (d.abs != null) { const r = roster(), n = r.list[+d.abs], a = r.absent || (r.absent = []); const k = a.indexOf(n); if (k >= 0) a.splice(k, 1); else a.push(n); saveRosters(); renderTool(); return; }
  if (d.back != null) { const r = roster(), list = drawnOf(r); list.splice(+d.back, 1); S.drawn[r.id] = list; lsPut('drawn', S.drawn); renderDraw(); return; }
  if (d.gmode) { S.grp.mode = d.gmode; lsPut('grp', S.grp); renderGroup(); return; }
  if (d.tmode) { S.tset.mode = d.tmode; lsPut('timer', S.tset); renderTimer(); updChips(); return; }
  if (d.preset) { tSet(+d.preset); return; }
  if (d.bsrc) { S.buzz.src = d.bsrc; lsPut('buzz', S.buzz); bzReset(); renderTool(); return; }
  if (d.hit != null) { bzHit(+d.hit); return; }
  if (d.sc != null) { const tm = S.buzz.teams[+d.sc]; tm.s = clamp(tm.s + (+d.d), -99, 999); lsPut('buzz', S.buzz); bzPaint(); return; }
  if (d.vtype) { const v = S.vote; if ($('vQ')) v.q = $('vQ').value; if ($('vOpts')) v.opts = $('vOpts').value; v.type = d.vtype; saveVote(); renderVote(); return; }
  if (d.man != null) { const p = S.vote.cur; if (!p) return; p.manual[+d.man] = Math.max(0, (p.manual[+d.man] || 0) + (+d.d)); saveVoteSoon(); votePaint(); return; }
  if (d.vote) { joinPick(d.vote); return; }
  if (d.bank != null) { bankStart(+d.bank); return; }
  if (d.bedit != null) { bankEdit(+d.bedit); return; }
  if (d.room) { lobbyPick(d.room, d.rpw === '1', d.rname || ''); return; }
  if (d.scq) { scoreExport(d.kind, d.scq); return; }
  if (d.amode) { if (d.amode === 'manual') autoStop(); S.auto.mode = d.amode; lsPut('auto', S.auto); renderVote(); return; }
  if (d.themeSet) { S.pref.theme = d.themeSet; savePref(); openSettings(); return; }
  if (d.fsSet) { S.pref.fs = d.fsSet; savePref(); openSettings(); return; }
  if (d.ansPick) { t.setAttribute('aria-pressed', t.getAttribute('aria-pressed') !== 'true'); return; }
  const act = d.act; if (!act) return;
  const A = {
    close: closeModal, warn: showWarn, settings: openSettings, install, fs: toggleFs,
    roster: () => openRoster(), draw: doDraw, group: doGroup, grpCopy: () => S.grp.last ? copyText(groupText()) : toast('還沒分組'),
    drawReset: () => { S.drawn[roster().id] = []; lsPut('drawn', S.drawn); renderDraw(); toast('籤筒已重置'); },
    allIn: () => { roster().absent = []; saveRosters(); renderTool(); },
    rsNew: () => { const id = 'r' + Date.now().toString(36); S.rosters.push({id, name:'新班級 ' + S.rosters.length, list:seatList(30), absent:[]}); saveRosters(); openRoster(id); },
    rsImport: () => $('rsFile').click(), rsCsv: () => rosterExport('csv'), rsXlsx: () => rosterExport('xlsx'),
    rsSeat: () => { $('rsList').value = seatList(clamp(+$('rsSeat').value || 30, 1, 200)).join('\n'); },
    rsSave: () => { const r = S.rosters.find((x) => x.id === d.id); if (!r) return; const pr = TCHIO.parseRosterText($('rsList').value), list = pr.list; if (!list.length) { toast('名單是空的'); return; } r.name = cut($('rsName').value.trim(), 30) || '未命名班級'; r.list = list; r.ids = pr.ids; r.show = $('rsShow').value; r.absent = (r.absent || []).filter((n) => list.indexOf(n) >= 0); S.cur = r.id; saveRosters(); closeModal(); if (!JOIN) renderTool(); toast('已儲存：' + r.name + '（' + list.length + ' 人）'); },
    rsDel: () => { if (t.dataset.sure !== '1') { t.dataset.sure = '1'; t.textContent = '再按一次確定刪除'; return; } S.rosters = S.rosters.filter((x) => x.id !== d.id); delete S.drawn[d.id]; lsPut('drawn', S.drawn); S.cur = S.rosters[0].id; saveRosters(); closeModal(); renderTool(); },
    tGo: tToggle, tReset, tAdd: () => tAdd(+d.s), tLap: () => { if (!T.sw.running) return; T.sw.laps.push(swNow()); renderTimer(); },
    tCustom: () => { const s = (+$('tMin').value || 0) * 60 + (+$('tSec').value || 0); if (s < 1) { toast('請輸入時間'); return; } tSet(s); },
    bzStart, bzReset, bzZero: () => { S.buzz.teams.forEach((x) => { x.s = 0; }); lsPut('buzz', S.buzz); bzPaint(); },
    netOn: netOpen,
    netPw: () => { const v = $('netPw').value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); NET.pw = v; if (v) lsSet('pw.' + NET.code, v); else lsDel('pw.' + NET.code); netReconnect(); renderTool(); toast(v ? '密碼已設為 ' + v : '已取消密碼'); },
    netOff: () => { if (t.dataset.sure !== '1') { t.dataset.sure = '1'; t.textContent = '確定關閉？舊 QR code 會失效'; return; } autoStop(); netStop(true); toast('教室已關閉，舊的網址與 QR code 已失效'); },
    netNew: () => { if (t.dataset.sure !== '1') { t.dataset.sure = '1'; t.textContent = '確定換？舊代碼會失效、學生要重新掃'; return; } autoStop(); netStop(true); netStart(newCode()); renderTool(); },
    joinRetry: () => { JS.closed = false; renderJoin(); netReconnect(); },
    joinNew: () => { JS.closed = false; netStop(); history.replaceState(null, '', location.pathname + '?join'); renderJoin(); },
    qrBig: () => { openModal('<div class="qrBig"><h2>📱 掃描加入</h2><div class="qr" id="qrModal"></div><div class="joinCode" style="font-size:3.4rem">' + NET.code + '</div><div class="joinUrl">' + esc(joinUrl(NET.code)) + '</div><button class="btn" data-act="close">關閉</button></div>', true); drawQR($('qrModal'), Math.min(420, innerWidth - 90, innerHeight - 280)); },
    joinedList: openJoined, joinedCsv,
    lobby: openLobby, lobbyRefresh: fetchLobby, lobbyCode: () => { if (JOIN) { closeModal(); return; } location.href = '?join'; },
    netName: () => { const name = cut(($('netName').value || '').replace(/[|<>\u0000-\u001f]/g, '').trim(), 20), pub = $('netPub').checked; lsPut('rinfo.' + NET.code, {name, pub}); NET.nameAsk = true; if (name) sendRoomInfo(); else { send({t:'room', name:'', pub:false}); } lastStageKey = ''; votePaint(); },
    copyJoin: () => copyText(joinUrl(NET.code)),
    vStart, vClose: () => { autoStop('已切回手動出題'); const p = S.vote.cur; p.state = 'closed'; saveVote(); setTeacher(teacherVoteName(p)); SND.pop(); votePaint(); },
    vReopen: () => { autoStop('已切回手動出題'); const p = S.vote.cur; p.state = 'open'; saveVote(); setTeacher(teacherVoteName(p)); votePaint(); },
    vShow: () => { const p = S.vote.cur; p.show = !p.show; saveVote(); votePaint(); },
    vManual: () => { const p = S.vote.cur; p.manualOn = !p.manualOn; saveVote(); votePaint(); },
    vNext: () => { autoStop('已切回手動出題'); archivePoll(); S.vote.cur = null; saveVote(); if (NET.want) setTeacher('T|w'); lastStageKey = ''; renderVote(); },
    vAns: () => { const p = S.vote.cur, L = labelsOf(p), M = marksOf(p); openModal('<h2>✔ 設定正確答案</h2><p class="small">' + (p.type === 'm' ? '可以選多個。' : '選一個。') + '截止後學生手機會顯示答對或答錯。</p><div class="stack">' + L.map((l, i) => '<button class="btn alt" data-ans-pick="' + LETTERS[i] + '" aria-pressed="' + (p.ans.indexOf(LETTERS[i]) >= 0) + '">' + esc(M[i] + ' ' + l) + '</button>').join('') + '</div><div class="stack"><button class="btn" data-act="vAnsOk">確定</button><button class="btn alt" data-act="vAnsClear">不設答案</button></div>'); },
    vAnsOk: () => { const p = S.vote.cur; let a = Array.from(document.querySelectorAll('[data-ans-pick][aria-pressed="true"]')).map((b) => b.dataset.ansPick).join(''); if (p.type !== 'm') a = a.slice(-1); p.ans = a; saveVote(); bankSetAns(p.bankIdx, a, p.q); if (p.state !== 'open') setTeacher(teacherVoteName(p)); closeModal(); votePaint(); if (a && p.state === 'open') toast('截止後學生才會看到答案'); },
    vAnsClear: () => { const p = S.vote.cur; p.ans = ''; saveVote(); setTeacher(teacherVoteName(p)); closeModal(); votePaint(); },
    vCsv: () => download('課堂投票紀錄-' + new Date().toLocaleDateString('sv') + '.csv', pollCsv(), 'text/csv'),
    vClearHist: () => { if (t.dataset.sure !== '1') { t.dataset.sure = '1'; t.textContent = '確定清除？'; return; } const id = roster().id; S.polls = lsJson('polls', []).filter((h) => h.rid && h.rid !== id); lsPut('polls', S.polls); renderVote(); },
    vSend: () => { if (JS.picks) voteSend(JS.pid, JS.picks); renderJoin(); },
    scCsv: () => scoreExport('csv'), scXlsx: () => scoreExport('xlsx'), scBoard: openBoard,
    quizNew: () => { if (t.dataset.sure !== '1') { t.dataset.sure = '1'; t.textContent = '確定開始新測驗？（成績另外記，題庫從頭出）'; return; } autoStop(); if (S.vote.cur && S.vote.cur.quiz) { archivePoll(); S.vote.cur = null; saveVote(); if (NET.want) setTeacher('T|w'); } newQuiz(); S.bank.used = []; lsPut('bank', S.bank); renderTool(); toast('已開始新測驗：' + S.qs.name); },
    bankOpen: () => { bankDraft = null; bankModal(); }, bankPick: () => $('bankFile').click(), bankUse,
    bankParse: () => { const r = TCHIO.parseQuizText($('bankText').value); bankDraft = Object.assign(r, {name:'貼上的題目'}); if (!r.items.length) toast('找不到題目，請參考格式說明'); const keep = $('bankText').value; bankModal(); $('bankText').value = keep; },
    bankTpl: () => downloadBlob('題庫範本.xlsx', TCHIO.xlsxBlob(BANK_TPL, '題庫', [36, 14, 14, 14, 14, 8])),
    autoStart, autoStop: () => autoStop('已停止自動出題'),
    autoPause: () => { if (!AUTO.on) return; if (AUTO.paused) { AUTO.until = Date.now() + AUTO.left; AUTO.paused = false; } else { AUTO.left = Math.max(0, AUTO.until - Date.now()); AUTO.paused = true; } autoPaint(); renderVote(); },
    bankNext: () => { const used = new Set(S.bank.used), i = S.bank.items.findIndex((_, k) => !used.has(k)); if (i >= 0) bankStart(i); },
    bankAdd: bankAddModal,
    bankAddOk: () => {
      const q = cut($('baQ').value.trim(), 120), opts = $('baOpts').value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 8), raw = $('baAns').value;
      if (!q) { toast('請輸入題目'); return; }
      if (opts.length === 1) { toast('選擇題至少要 2 個選項（是非題請把選項留空）'); return; }
      const ans = TCHIO.normAns(raw, opts.length);
      if (raw.trim() && !ans) { toast(opts.length ? '答案請填選項字母，例如 B 或 AC' : '是非題答案請填 O 或 X'); return; }
      const item = {q, type:opts.length ? (ans.length > 1 ? 'm' : 's') : 't', opts, ans};
      if (!S.bank.items.length) { S.bank = {name:'自訂題目', items:[], used:[]}; if (!quizPolls(S.qs.id).length) newQuiz('自訂題目'); }
      S.bank.items.push(item); lsPut('bank', S.bank); closeModal(); renderVote(); toast('已加入第 ' + S.bank.items.length + ' 題' + (ans ? '（答案 ' + ansShow(item) + '）' : '（未設答案，不計分）'));
    },
    bankEditOk: () => { const i = +d.i, a = Array.from(document.querySelectorAll('[data-ans-pick][aria-pressed="true"]')).map((b) => b.dataset.ansPick).join(''); const q = S.bank.items[i]; if (!q) return; if (q.type === 't' && a.length > 1) { toast('是非題只能選一個'); return; }
      bankSetAns(i, a); const p = S.vote.cur; if (p && p.bankIdx === i && p.quiz) { p.ans = q.type === 's' ? a.slice(-1) : a; if (q.type === 'm' && p.type === 's') p.type = 'm'; saveVote(); if (p.state !== 'open') setTeacher(teacherVoteName(p)); lastStageKey = ''; votePaint(); }
      closeModal(); renderVote(); toast(a ? '答案已存進題庫' : '已清除答案'); },
    bankReset: () => { S.bank.used = []; lsPut('bank', S.bank); renderVote(); },
    bankClear: () => { if (t.dataset.sure !== '1') { t.dataset.sure = '1'; t.textContent = '確定清空題庫？'; return; } S.bank = {name:'', items:[], used:[]}; lsPut('bank', S.bank); renderVote(); },
    whoEdit: () => { JS.whoEdit = true; renderJoin(); },
    buzz: () => { const ts = teacherState(); if (!ts || ts[1] !== 'b' || ts[3] !== 'o') return; myName('B|' + ts[2] + '|' + JS.who); if (navigator.vibrate) navigator.vibrate(60); renderJoin(); },

    sndTest: () => SND.win(),
    foldAll: () => { const ds = document.querySelectorAll('.set-sec'), anyClosed = Array.from(ds).some((x) => !x.open); ds.forEach((x) => { x.open = anyClosed; }); saveFold(); },
    backup, restore: () => $('restoreFile').click(),
    wipe: () => { if (t.dataset.sure !== '1') { t.dataset.sure = '1'; t.textContent = '再按一次：名單、紀錄、設定全部刪除'; return; } Object.keys(localStorage).filter((k) => k.indexOf(P) === 0).forEach((k) => localStorage.removeItem(k)); location.reload(); },
  };
  if (A[act]) A[act]();
});
function joinPick(L){
  const ts = teacherState(); if (!ts || ts[1] !== 'v' || ts[5] !== 'o') return;
  if (ts[4] === 'm') { JS.picks = JS.picks.indexOf(L) >= 0 ? JS.picks.replace(L, '') : (JS.picks + L).split('').sort().join(''); renderJoin(); return; }
  JS.picks = L; if (!voteSend(ts[2], L)) return; if (navigator.vibrate) navigator.vibrate(30); renderJoin();
}
document.addEventListener('change', (e) => {
  const t = e.target, id = t.id;
  if (id === 'rsFile') { if (t.files[0]) importRoster(t.files[0]); t.value = ''; return; }
  if (id === 'rsPick') { openRoster(t.value); return; }
  if (id === 'bankFile') { if (t.files[0]) bankFromFile(t.files[0]); t.value = ''; return; }
  if (id === 'rosterSel') { S.cur = t.value; saveRosters(); renderTool(); }
  else if (id === 'drawCount') { S.drawOpt.count = clamp(+t.value || 1, 1, 10); t.value = S.drawOpt.count; lsPut('drawOpt', S.drawOpt); }
  else if (id === 'noRepeat') { S.drawOpt.noRepeat = t.checked; lsPut('drawOpt', S.drawOpt); drawInfo(); }
  else if (id === 'grpN') { S.grp.n = clamp(+t.value || 2, 2, 30); t.value = S.grp.n; lsPut('grp', S.grp); }
  else if (id === 'grpSize') { S.grp.size = clamp(+t.value || 2, 2, 30); t.value = S.grp.size; lsPut('grp', S.grp); }
  else if (id === 'grpLeader') { S.grp.leader = t.checked; lsPut('grp', S.grp); }
  else if (id === 'tBeep') { S.tset.beep = t.checked; lsPut('timer', S.tset); }
  else if (id === 'bzCount') { S.buzz.count = clamp(+t.value || 2, 2, 6); lsPut('buzz', S.buzz); bzReset(); renderBuzz(); }
  else if (t.dataset.tname != null) { S.buzz.teams[+t.dataset.tname].n = cut(t.value.trim(), 12) || '第 ' + (+t.dataset.tname + 1) + ' 組'; lsPut('buzz', S.buzz); bzPaint(); }
  else if (id === 'sndOn') { S.pref.sound = t.checked; savePref(); }
  else if (id === 'sndVol') { S.pref.vol = clamp(+t.value, .1, 1); savePref(); SND.pop(); }
  else if (id === 'autoAsk') { S.auto.ask = clamp(+t.value || 30, 5, 600); t.value = S.auto.ask; lsPut('auto', S.auto); }
  else if (id === 'autoReveal') { S.auto.reveal = clamp(+t.value || 0, 0, 120); t.value = S.auto.reveal; lsPut('auto', S.auto); }
  else if (id === 'autoEarly') { S.auto.early = t.checked; lsPut('auto', S.auto); }
  else if (id === 'autoHide') { S.auto.hide = t.checked; lsPut('auto', S.auto); }
  else if (id === 'vQ' || id === 'vOpts') { S.vote.q = $('vQ').value; if ($('vOpts')) S.vote.opts = $('vOpts').value; saveVote(); }
});
document.addEventListener('submit', (e) => {
  e.preventDefault();
  if (e.target.id === 'lobbyPwForm') { const v = $('lobbyPwIn').value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); if (!v) { toast('請輸入密碼'); return; } goRoom(e.target.dataset.code, v); return; }
  if (e.target.id === 'codeForm') { const c = $('codeIn').value.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (!/^[A-Z0-9]{6}$/.test(c)) { toast('代碼是 6 個英文或數字'); return; } history.replaceState(null, '', '?join=' + c + (QS.get('presence') ? '&presence=' + encodeURIComponent(QS.get('presence')) : '')); joinStart(c); }
  if (e.target.id === 'pwForm') { const v = $('pwIn').value.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (!v) { toast('請輸入密碼'); return; } NET.pw = v; lsSet('spw.' + NET.code, v); JS.pwNeed = false; renderJoin(); netReconnect(); return; }
  if (e.target.id === 'whoForm') { const n = cleanWho($('whoIn').value); if (!n) { toast('請輸入學號或姓名'); return; } JS.who = n; JS.whoEdit = false; lsSet('who', n); myName(withWho(JS.name)); renderJoin(); }
});
document.addEventListener('keydown', (e) => {
  if (JOIN || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Escape') { closeModal(); return; }
  if ($('modal').classList.contains('show') || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  const k = e.key;
  if (k === 'f' || k === 'F') { toggleFs(); return; }
  if (k === ' ' || k === 'Enter') {
    if (e.target.tagName === 'BUTTON' && k === 'Enter') return;
    e.preventDefault();
    if (S.tab === 'draw') doDraw(); else if (S.tab === 'group') doGroup(); else if (S.tab === 'timer') tToggle(); else if (S.tab === 'buzz' && B.phase !== 'count') bzStart();
    return;
  }
  if ((k === 'r' || k === 'R') && S.tab === 'timer') { tReset(); return; }
  if (S.tab === 'buzz' && /^[1-6]$/.test(k)) bzHit(+k - 1);
});
document.addEventListener('fullscreenchange', () => document.body.classList.toggle('fullscreen', !!document.fullscreenElement));

/* ---------- 跑馬燈（工作區共用公告，不可關） ---------- */
function initMarquee(){
  const URL_ = 'https://script.google.com/macros/s/AKfycbwKX0DNNbY8y4nf90BFTHtxgfqJcHHcZasRrgycl4QAe52_hkjMWSkYk4xOsqU-JPCROw/exec';
  const bar = $('marqueeBar'), track = $('marqueeTrack'); let lastKey = null;
  function appendText(c, text){ const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g; let li = 0, m; while ((m = re.exec(text))) { if (m.index > li) c.appendChild(document.createTextNode(text.slice(li, m.index))); const a = document.createElement('a'); a.href = m[2]; a.textContent = m[1]; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.style.color = 'inherit'; a.style.textDecoration = 'underline'; c.appendChild(a); li = re.lastIndex; } if (li < text.length) c.appendChild(document.createTextNode(text.slice(li))); }
  function renderM(items){
    if (!items || !items.length) return; const k = JSON.stringify(items); if (k === lastKey) return; lastKey = k; track.innerHTML = '';
    const fr = document.createDocumentFragment(); const pass = () => items.forEach((it, i) => { if (i > 0) fr.appendChild(document.createTextNode('　★　')); appendText(fr, String(it)); });
    pass(); fr.appendChild(document.createTextNode('　★　')); pass(); track.appendChild(fr);
    bar.classList.add('show'); document.body.classList.add('has-marquee'); track.style.animationDuration = Math.max(track.scrollWidth / 2 / 60, 12) + 's';
  }
  function fetchM(){ fetch(URL_, {method:'POST', body:JSON.stringify({serial:''})}).then((r) => r.json()).then((d) => { if (d && Array.isArray(d.marquee) && d.marquee.length) { lsPut('marquee', d.marquee); renderM(d.marquee); } }).catch(() => {}); }
  renderM(lsJson('marquee', [])); fetchM(); setInterval(fetchM, 20 * 60 * 1000);
}

/* ---------- 啟動 ---------- */
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window._dp = e; });
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('service-worker.js').catch(() => {});
function joinStart(code){ JS.name = withWho(lsGet('my.' + code) || 'W'); const pw = String(QS.get('pw') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); if (pw) lsSet('spw.' + code, pw); netStart(code); renderJoin(); }
applyPref(); initMarquee();
if (JOIN) {
  document.title = '課堂小幫手・學生作答';
  const c = String(QS.get('join') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^[A-Z0-9]{6}$/.test(c)) joinStart(c); else renderJoin();
} else {
  renderShell(); renderTool(); startLobby();
  setInterval(tTick, 200);
  const room = ssGet('room');
  S.vote.cur = ssJson('vcur', null) || (room ? lsJson('vcur.' + room, null) : null);
  if (S.vote.cur && S.vote.cur.state === 'open') NET.state = teacherVoteName(S.vote.cur);
  if (room && /^[A-Z0-9]{6}$/.test(room)) codeBusy(room).then((busy) => {
    if (busy) { ssDel('room'); S.vote.cur = null; ssDel('vcur'); toast('這個分頁是複製出來的，原分頁還在用同一個代碼；要開放手機連線請按「開放手機連線」取得新代碼'); renderTool(); return; }
    netStart(room); renderTool();
  });
  if (isVT()) renderTool();
  if (!lsGet('warnSeen')) { lsSet('warnSeen', '1'); showWarn(); }
}
window._tch = {S, T, B, NET, JS, setTab, doDraw, doGroup, tSet, bzStart, bzHit, tally, pollChats, renderTool, LOB, fetchLobby, AUTO, autoStart, newQuiz, openBoard, importRoster, rosterExport, scoreRows, bankUse, bankFromFile, bankStart, scoreExport, openRoster};
})();
