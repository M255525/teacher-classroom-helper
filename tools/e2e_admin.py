# 端對端：管理密碼（B）＋上課中不能刪（A）。老師分頁＋同瀏覽器第二個分頁＋一支學生手機，連正式轉播站隨機 VOTE 房間
# 用法：python tools/e2e_admin.py <截圖資料夾>（需先開 http://127.0.0.1:8875；可設 TCH_BASE 測線上版）
import sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', line_buffering=True)
from playwright.sync_api import sync_playwright
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
BASE = os.environ.get('TCH_BASE', 'http://127.0.0.1:8875/')
PIN = '2468'
errs, fails = [], []
def check(c, msg):
    print(('ok   ' if c else 'FAIL ') + msg)
    if not c: fails.append(msg)
def stub(pg, tag):
    pg.route('**/script.google.com/**', lambda r: r.fulfill(status=200, body='{"marquee":["測試公告"]}', headers={'content-type': 'application/json'}))
    pg.route('**/visitor-badge.laobi.icu/**', lambda r: r.fulfill(status=200, body='', headers={'content-type': 'image/svg+xml'}))
    pg.on('pageerror', lambda e: errs.append(tag + ': ' + str(e)))
    pg.on('console', lambda m: m.type == 'error' and 'lobby' not in m.text and errs.append(tag + ': ' + m.text))
def modal(pg): return pg.inner_text('#modalBox') if pg.is_visible('#modal.show') else ''
def settings(pg, secname):
    pg.click('[data-act=settings]'); pg.wait_for_timeout(150)
    pg.evaluate("s => { const d = document.querySelector('[data-sec=' + s + ']'); if (d) d.open = true; }", secname)
def pin(pg, v):
    pg.wait_for_selector('#admPin', timeout=5000); pg.fill('#admPin', v); pg.click('[data-act=admOk]'); pg.wait_for_timeout(400)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1366, 'height': 900}, accept_downloads=True)
    t = ctx.new_page(); stub(t, 'T')
    t.goto(BASE); t.wait_for_timeout(800)
    if t.is_visible('#modal.show'): t.click('#modal [data-act=close]')
    # 第二個班級
    t.evaluate("() => { const S = _tch.S; S.rosters.push({id:'rB', name:'B班', list:['甲','乙','丙'], ids:{}}); localStorage.setItem('tch.rosters', JSON.stringify(S.rosters)); }")

    # ---- B：設定管理密碼 ----
    settings(t, 'adm')
    check('未設定' in modal(t), '一開始沒有管理密碼')
    t.fill('#admNew', PIN); t.fill('#admNew2', '2469'); t.click('[data-act=admSet]'); t.wait_for_timeout(300)
    check(t.evaluate("!localStorage.getItem('tch.adm')"), '兩次不同不會存')
    t.fill('#admNew2', PIN); t.click('[data-act=admSet]'); t.wait_for_timeout(500)
    adm = t.evaluate("localStorage.getItem('tch.adm')") or ''
    check('"hash"' in adm and PIN not in adm, '只存雜湊、不存明碼')
    check(t.is_visible('#admChip'), '設定後是解鎖狀態，頂列顯示「已解鎖」')
    t.screenshot(path=os.path.join(OUT, '01_settings.png'))
    t.click('#modal [data-act=close]')
    t.click('#admChip'); t.wait_for_timeout(200)
    check(not t.is_visible('#admChip'), '按「上鎖」鎖回去')

    # ---- 名單保護 ----
    t.click('.tright [data-act=roster]'); t.wait_for_timeout(200)
    check(t.is_visible('#admPin') and not t.is_visible('#rsList'), '名單保護：看名單要密碼')
    t.screenshot(path=os.path.join(OUT, '02_pin.png'))
    pin(t, '1111')
    check(t.is_visible('#admPin') and not t.is_visible('#rsList'), '密碼錯誤看不到名單')
    pin(t, PIN)
    check(t.is_visible('#rsList'), '密碼正確才打開名單')
    t.click('#modal [data-act=close]')
    t.click('.tright [data-act=roster]'); t.wait_for_timeout(200)
    check(t.is_visible('#rsList'), '10 分鐘內不用重複輸入')
    t.click('#modal [data-act=close]')
    t.click('#admChip'); t.wait_for_timeout(150)

    # ---- 開教室＋學生加入 ----
    t.click('[data-tab=vote]'); t.wait_for_timeout(200)
    t.click('[data-act=netOn]')
    t.wait_for_function('_tch.NET.status === "on"', timeout=15000)
    code = t.evaluate('_tch.NET.code'); print('room', code)
    sc = b.new_context(viewport={'width': 375, 'height': 740}, is_mobile=True, has_touch=True)
    s = sc.new_page(); stub(s, 'S')
    s.goto(BASE + '?join=' + code); s.wait_for_selector('#whoIn', timeout=15000)
    s.fill('#whoIn', 'S001'); s.press('#whoIn', 'Enter')
    t.wait_for_function('_tch.myLive().why.length > 0', timeout=20000)
    check('學生連線' in ' '.join(t.evaluate('_tch.myLive().why')), '偵測到上課中（學生連線）')
    # 看名單（誰加入了）也受名單保護
    t.click('[data-act=joinedList]'); t.wait_for_timeout(200)
    check(t.is_visible('#admPin'), '看誰加入了要密碼')
    t.click('#modal [data-act=close]')

    # ---- A：上課中擋下 ----
    settings(t, 'data')
    t.click('[data-act=wipe]'); t.wait_for_timeout(600)
    check('上課中不能清除全部資料' in modal(t), '上課中不能清除全部資料')
    t.screenshot(path=os.path.join(OUT, '03_blocked.png'))
    t.click('#modal [data-act=close]')
    check('學生連線' in ' '.join(t.evaluate("_tch.blockedWhy('hist', _tch.S.cur)")), '上課中不能清除這班紀錄')
    t.evaluate('_tch.AUTO.on = true; _tch.AUTO.paused = true')
    check(len(t.evaluate("_tch.blockedWhy('bank')")) > 0, '自動出題中不能清空題庫')
    t.evaluate('_tch.AUTO.on = false; _tch.AUTO.paused = false')
    cur = t.evaluate('_tch.S.cur')
    t.evaluate('id => _tch.openRoster(id)', cur); t.click('[data-act=rsDel]'); t.wait_for_timeout(600)
    check('目前正在使用的班級' in modal(t), '不能刪正在使用的班級')
    t.click('#modal [data-act=close]')

    # ---- 第二個分頁看得到第一個分頁在上課 ----
    t2 = ctx.new_page(); stub(t2, 'T2')
    t2.goto(BASE); t2.wait_for_timeout(1000)
    w2 = ' '.join(t2.evaluate("_tch.blockedWhy('wipe')"))
    check('另一個分頁的教室還開著' in w2, '其他分頁的教室開著也擋下清除 (%s)' % w2[:40])
    w3 = ' '.join(t2.evaluate("id => _tch.blockedWhy('roster', id)", cur))
    check('另一個分頁正在使用這一班' in w3, '其他分頁正在用的班級不能刪')
    t2.close()

    # ---- 刪除別班要密碼 ----
    t.evaluate("_tch.openRoster('rB')"); t.click('[data-act=rsDel]'); t.wait_for_timeout(600)
    check(t.is_visible('#admPin'), '刪除班級每次都要密碼')
    pin(t, '0000')
    check(any(r['id'] == 'rB' for r in t.evaluate('_tch.S.rosters')), '密碼錯不能刪班級')
    pin(t, PIN)
    check(not any(r['id'] == 'rB' for r in t.evaluate('_tch.S.rosters')), '密碼正確才刪除班級')

    # ---- 關閉教室要密碼 ----
    t.click('[data-tab=vote]'); t.wait_for_timeout(200)
    t.click('[data-act=netOff]'); t.wait_for_timeout(300)
    check(t.is_visible('#admPin'), '關閉教室要密碼')
    pin(t, PIN)
    s.wait_for_function('_tch.JS.closed', timeout=15000)
    check(True, '輸入密碼後關閉教室，學生斷線')
    sc.close()

    # ---- 下課後：清除全部資料要密碼，管理密碼保留 ----
    settings(t, 'data')
    t.click('[data-act=wipe]'); t.wait_for_timeout(600)
    check(t.is_visible('#admPin'), '下課後清除全部資料要密碼')
    t.fill('#admPin', PIN)
    with t.expect_navigation(): t.click('[data-act=admOk]')
    t.wait_for_timeout(800)
    check(t.evaluate("!localStorage.getItem('tch.polls') && !!localStorage.getItem('tch.adm')"), '清除全部資料後管理密碼保留')

    # ---- 關掉名單保護：看名單不用密碼 ----
    if t.is_visible('#modal.show'): t.click('#modal [data-act=close]')
    settings(t, 'adm'); t.fill('#admOld', PIN); t.uncheck('#admListCk'); t.click('[data-act=admSave]'); t.wait_for_timeout(500)
    t.click('#modal [data-act=close]'); t.click('#admChip'); t.wait_for_timeout(150)
    t.click('.tright [data-act=roster]'); t.wait_for_timeout(200)
    check(t.is_visible('#rsList'), '名單保護關掉後看名單不用密碼')
    t.click('#modal [data-act=close]')

    # ---- 忘記密碼：清除全部並重設 ----
    settings(t, 'adm'); t.click('[data-act=admForgot]'); t.fill('#forgotTx', '清除')
    t.click('[data-act=admForgotYes]'); t.wait_for_timeout(300)
    check(t.evaluate("!!localStorage.getItem('tch.adm')"), '沒輸入「清除全部」不會清')
    t.fill('#forgotTx', '清除全部')
    with t.expect_navigation(): t.click('[data-act=admForgotYes]')
    t.wait_for_timeout(800)
    check(t.evaluate("!localStorage.getItem('tch.adm')"), '忘記密碼重設後，管理密碼也清掉')
    b.close()

errs = [e for e in errs if 'favicon' not in e]
print('console errors:', errs)
print('FAILS:', fails if fails else 'none')
sys.exit(1 if fails or errs else 0)
