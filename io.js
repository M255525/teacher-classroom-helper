/* 檔案讀寫：CSV／Excel（.xlsx）／Word（.docx）／純文字，以及名單與題庫的解析。
   不用 SheetJS 等外部函式庫：.xlsx/.docx 是 zip，用瀏覽器內建 DecompressionStream 解壓，寫出用不壓縮的 zip。
   純文字解析函式（parseRosterText、rowsToRoster、parseQuizText、rowsToQuiz）不碰 DOM，node 也能測。 */
(function (root) {
'use strict';

/* ---------- zip ---------- */
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b){ let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zipStore(files, type){
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  files.forEach((f) => {
    const nm = enc.encode(f.name), d = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(d);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(12, 0x21, true);
    h.setUint32(14, crc, true); h.setUint32(18, d.length, true); h.setUint32(22, d.length, true); h.setUint16(26, nm.length, true);
    parts.push(new Uint8Array(h.buffer), nm, d);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(14, 0x21, true);
    c.setUint32(16, crc, true); c.setUint32(20, d.length, true); c.setUint32(24, d.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), nm);
    off += 30 + nm.length + d.length;
  });
  const cs = central.reduce((a, b) => a + b.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cs, true); e.setUint32(16, off, true);
  return new Blob(parts.concat(central, [new Uint8Array(e.buffer)]), {type: type || 'application/zip'});
}
function unzip(buf){
  const u = new Uint8Array(buf), dv = new DataView(buf); let e = -1;
  for (let i = u.length - 22; i >= Math.max(0, u.length - 65558); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('不是有效的壓縮檔');
  const n = dv.getUint16(e + 10, true), out = {}, dec = new TextDecoder(); let p = dv.getUint32(e + 16, true);
  for (let k = 0; k < n && dv.getUint32(p, true) === 0x02014b50; k++) {
    const m = dv.getUint16(p + 10, true), cs = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = dec.decode(u.subarray(p + 46, p + 46 + nl)), st = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    out[name] = {m, data:u.subarray(st, st + cs)};
    p += 46 + nl + el + cl;
  }
  return out;
}
async function inflate(e){
  if (e.m === 0) return e.data;
  if (typeof DecompressionStream === 'undefined') throw new Error('這個瀏覽器不支援解壓縮，請改用 CSV');
  const s = new Blob([e.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function zipText(z, name){ const e = z[name]; return e ? new TextDecoder().decode(await inflate(e)) : null; }
const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
const tags = (el, n) => Array.from(el.getElementsByTagNameNS('*', n));

/* ---------- 讀檔 ---------- */
function decodeText(buf){
  let t; try { t = new TextDecoder('utf-8', {fatal:true}).decode(buf); } catch (e) { t = new TextDecoder('big5').decode(buf); } // 台灣 Excel 存的 CSV 常是 Big5
  return t.replace(/^﻿/, '');
}
function parseCsv(t){
  const rows = []; let row = [], f = '', q = false;
  const sep = (t.split('\n')[0].match(/\t/g) || []).length > (t.split('\n')[0].match(/,/g) || []).length ? '\t' : ',';
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"' && f === '') q = true;
    else if (c === sep) { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}
async function readXlsx(buf){
  const z = unzip(buf);
  let path = 'xl/worksheets/sheet1.xml';
  const wb = await zipText(z, 'xl/workbook.xml'), rels = await zipText(z, 'xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const sh = tags(xml(wb), 'sheet')[0];
    const rid = sh && (sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || sh.getAttribute('r:id'));
    const rel = tags(xml(rels), 'Relationship').find((r) => r.getAttribute('Id') === rid);
    if (rel) { const t = rel.getAttribute('Target'); path = t.charAt(0) === '/' ? t.slice(1) : 'xl/' + t.replace(/^\.\//, ''); }
  }
  const ssx = await zipText(z, 'xl/sharedStrings.xml');
  const ss = ssx ? tags(xml(ssx), 'si').map((si) => tags(si, 't').filter((t) => t.parentNode === si || t.parentNode.localName === 'r').map((t) => t.textContent).join('')) : [];
  const sx = await zipText(z, path); if (!sx) throw new Error('讀不到工作表');
  const rows = [];
  tags(xml(sx), 'row').forEach((row) => {
    const r = [];
    tags(row, 'c').forEach((c, idx) => {
      const ref = c.getAttribute('r'); let ci = idx;
      if (ref) { ci = 0; for (const ch of ref.replace(/\d+/g, '')) ci = ci * 26 + ch.charCodeAt(0) - 64; ci--; }
      const t = c.getAttribute('t'), v = tags(c, 'v')[0];
      r[ci] = t === 's' ? (ss[+(v && v.textContent)] || '') : t === 'inlineStr' ? tags(c, 't').map((x) => x.textContent).join('') : (v ? v.textContent : '');
    });
    rows.push(Array.from(r, (x) => x == null ? '' : x));
  });
  return rows;
}
// Word：每段一行；Word 自動編號的段落沒有「1.」文字，依層級補上標記（第 0 層＝題目、第 1 層以上＝選項）
async function readDocx(buf){
  const z = unzip(buf), x = await zipText(z, 'word/document.xml'); if (!x) throw new Error('讀不到 Word 內容');
  const lines = [], styleNum = {}, sx = await zipText(z, 'word/styles.xml'), W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const val = (el) => el ? (el.getAttributeNS(W, 'val') || el.getAttribute('w:val') || '') : '';
  if (sx) tags(xml(sx), 'style').forEach((st) => { const np = tags(st, 'numPr')[0]; if (np) styleNum[st.getAttributeNS(W, 'styleId') || st.getAttribute('w:styleId')] = {id:val(tags(np, 'numId')[0]), lv:val(tags(np, 'ilvl')[0]) || '0'}; });
  let firstKey = null; // 第一種編號（numId＋層級）＝題目，其他編號＝選項
  tags(xml(x), 'p').forEach((p) => {
    let t = '';
    const walk = (n) => { for (const c of Array.from(n.childNodes)) { if (c.nodeType !== 1) continue; const ln = c.localName; if (ln === 't') t += c.textContent; else if (ln === 'tab') t += ' '; else if (ln === 'br' || ln === 'cr') t += '\n'; else if (ln !== 'pPr' && ln !== 'rPr' && ln !== 'instrText' && ln !== 'del') walk(c); } };
    walk(p);
    const ppr = tags(p, 'pPr')[0], num = ppr && tags(ppr, 'numPr')[0], ps = ppr && tags(ppr, 'pStyle')[0];
    let key = null;
    if (num && val(tags(num, 'numId')[0]) !== '0') key = val(tags(num, 'numId')[0]) + ':' + (val(tags(num, 'ilvl')[0]) || '0');
    else if (ps && styleNum[val(ps)]) { const sn = styleNum[val(ps)]; key = sn.id + ':' + sn.lv; }
    if (key && t.trim() && !/^\s*([(（]?\s*[A-Ha-hＡ-Ｈ]\s*[)）.．、]|[(（]?\d+\s*[.．、)）])/.test(t)) {
      if (!firstKey) firstKey = key;
      t = (key === firstKey ? '#Q ' : '#O ') + t;
    }
    t.split('\n').forEach((s) => lines.push(s));
  });
  return lines.join('\n');
}
// 依副檔名讀成 {rows}（表格）或 {text}（文字）
async function readFile(file){
  const name = file.name.toLowerCase(), buf = await file.arrayBuffer(), head = new Uint8Array(buf.slice(0, 4));
  if (head[0] === 0xD0 && head[1] === 0xCF) throw new Error('這是舊版 Office 檔（.xls／.doc），請在 Office 裡「另存新檔」成 .xlsx／.docx 或 CSV');
  if (/\.xlsx$|\.xlsm$/.test(name)) return {rows:await readXlsx(buf)};
  if (/\.docx$/.test(name)) return {text:await readDocx(buf)};
  if (/\.(csv|tsv)$/.test(name)) return {rows:parseCsv(decodeText(buf))};
  if (/\.(txt|md|text)$/.test(name) || file.type.indexOf('text') === 0) return {text:decodeText(buf)};
  throw new Error('不支援這種檔案，請用 .docx、.xlsx、.csv 或 .txt');
}

/* ---------- 寫檔 ---------- */
const xe = (s) => String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'}[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
function colName(i){ let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - 1 - m) / 26; } return s; }
function xlsxBlob(rows, sheet, widths){
  const sh = String(sheet || 'Sheet1').replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 31) || 'Sheet1';
  const data = rows.map((r, ri) => '<row r="' + (ri + 1) + '">' + r.map((v, ci) => v === '' || v == null ? '' :
    typeof v === 'number' ? '<c r="' + colName(ci) + (ri + 1) + '"' + (ri === 0 ? ' s="1"' : '') + '><v>' + v + '</v></c>' :
    '<c r="' + colName(ci) + (ri + 1) + '" t="inlineStr"' + (ri === 0 ? ' s="1"' : '') + '><is><t xml:space="preserve">' + xe(v) + '</t></is></c>').join('') + '</row>').join('');
  const cols = (widths || []).map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('');
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  return zipStore([
    {name:'[Content_Types].xml', data:X + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'},
    {name:'_rels/.rels', data:X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'},
    {name:'xl/workbook.xml', data:X + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' + xe(sh) + '" sheetId="1" r:id="rId1"/></sheets></workbook>'},
    {name:'xl/_rels/workbook.xml.rels', data:X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'},
    {name:'xl/styles.xml', data:X + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="12"/><name val="Microsoft JhengHei"/></font><font><b/><sz val="12"/><name val="Microsoft JhengHei"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'},
    {name:'xl/worksheets/sheet1.xml', data:X + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' + (cols ? '<cols>' + cols + '</cols>' : '') + '<sheetData>' + data + '</sheetData></worksheet>'},
  ], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
// CSV：UTF-8＋BOM（Excel 才不會亂碼）；0 開頭的學號用 ="0123" 保住前導 0
function csvText(rows){
  const q = (v) => { v = v == null ? '' : String(v); if (/^0\d+$/.test(v)) return '="' + v + '"'; return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  return '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n');
}

/* ---------- 名單解析 ---------- */
const isId = (v) => /^[A-Za-z]{0,3}\d[\dA-Za-z-]*$/.test(String(v || '').trim());
const cut = (s, n) => Array.from(String(s || '')).slice(0, n).join('');
function rosterBuilder(){
  const seen = {}, list = [], ids = {};
  return {list, ids, add(name, id){
    name = cut(String(name || '').replace(/\s+/g, ' ').trim(), 20); id = cut(String(id || '').replace(/^="(.*)"$/, '$1').trim(), 20);
    if (!name) name = id; if (!name) return;
    let k = name, i = 2; while (seen[k]) k = name + '(' + (i++) + ')'; seen[k] = 1; list.push(k); if (id) ids[k] = id;
  }};
}
// 文字框：一行一位，可以「學號 姓名」「學號,姓名」「學號<Tab>姓名」或只有姓名；一行多個姓名用逗號頓號分隔也可以
function parseRosterText(t){
  const b = rosterBuilder();
  String(t || '').split(/\r?\n/).forEach((line) => {
    line = line.trim(); if (!line) return;
    const parts = line.split(/[,，\t;；、]+/).map((s) => s.trim()).filter(Boolean);
    if (parts.some((p) => /^(姓名|名字|學生姓名|name)$/i.test(p))) return; // 標題列
    if (parts.length >= 2 && isId(parts[0]) && !isId(parts[1])) { b.add(parts.slice(1).join(' '), parts[0]); return; }
    if (parts.length === 1) { const m = /^([A-Za-z]{0,3}\d[\dA-Za-z-]*)\s+(\S.*)$/.exec(parts[0]); if (m && !isId(m[2]) && !/^號/.test(m[2])) { b.add(m[2], m[1]); return; } }
    parts.forEach((p) => b.add(p, ''));
  });
  return {list:b.list, ids:b.ids};
}
// 表格（CSV／Excel）：找「學號」「姓名」欄；沒有標題列就依內容猜
function rowsToRoster(rows){
  rows = rows.map((r) => r.map((c) => String(c == null ? '' : c).replace(/^="(.*)"$/, '$1').trim())).filter((r) => r.some(Boolean));
  const b = rosterBuilder(); if (!rows.length) return {list:[], ids:{}, header:false};
  const H = rows[0].map((c) => c.replace(/\s/g, '').toLowerCase());
  let ni = H.findIndex((h) => /姓名|名字|^name$|studentname|學員$|^學生$/.test(h));
  let ii = -1; for (const re of [/學號|studentid|學生證/, /學員編號|^id$/, /座號|^編號$/]) { ii = H.findIndex((h) => re.test(h)); if (ii >= 0) break; }
  const header = ni >= 0 || ii >= 0, body = header ? rows.slice(1) : rows;
  if (!header) {
    const cols = Math.max.apply(null, rows.map((r) => r.length)), filled = (c) => body.filter((r) => r[c]).length;
    let best = 0;
    for (let c = 0; c < cols; c++) { const f = filled(c); if (!f) continue; const s = body.filter((r) => isId(r[c])).length / f; if (s > .6 && s > best) { best = s; ii = c; } }
    for (let c = 0; c < cols; c++) { if (c === ii) continue; const f = filled(c); if (f && body.filter((r) => r[c] && !isId(r[c])).length / f > .6) { ni = c; break; } }
  }
  body.forEach((r) => b.add(ni >= 0 ? r[ni] : '', ii >= 0 ? r[ii] : ''));
  return {list:b.list, ids:b.ids, header};
}

/* ---------- 題庫解析 ---------- */
const FW = (s) => String(s).replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
// 答案文字 → 選項字母；是非題 O/X、對/錯 → A/B
function normAns(raw, nOpts){
  let s = FW(String(raw || '')).trim().toUpperCase();
  if (!s) return '';
  if (!nOpts) { if (/^(O|○|〇|◯|是|對|正確|T|TRUE|V|✓|✔)$/.test(s)) return 'A'; if (/^(X|╳|✕|✗|×|否|錯|錯誤|F|FALSE)$/.test(s)) return 'B'; return ''; }
  const L = Array.from(new Set((s.match(/[A-H]/g) || []).filter((c) => c.charCodeAt(0) - 65 < nOpts))).sort().join('');
  return L;
}
const OPT_RE = /[(（]\s*([A-Ha-hＡ-Ｈ])\s*[)）]|(?:^|\s)([A-HＡ-Ｈ])\s*[.．、:：]\s*/g;
// 一行裡有 (A)甲 (B)乙 這種連續選項就拆開；回傳 {head, opts}
function splitInline(text){
  const ms = []; let m; OPT_RE.lastIndex = 0;
  while ((m = OPT_RE.exec(text))) ms.push({i:m.index, end:OPT_RE.lastIndex, L:FW(m[1] || m[2]).toUpperCase()});
  const seq = []; for (const x of ms) { if (x.L.charCodeAt(0) - 65 === seq.length) seq.push(x); }
  if (seq.length < 2) return {head:text, opts:[]};
  return {head:text.slice(0, seq[0].i).trim(), opts:seq.map((x, k) => text.slice(x.end, k + 1 < seq.length ? seq[k + 1].i : text.length).trim())};
}
// 括號答案：「(B)題目」「題目（B）」「( b )」「（Ｏ）」→ 從題目拿掉、當成答案；題號前的空白括號「（　）」直接拿掉；題目中間的填空括號保留
const LEAD_ANS = /^\s*[(（]\s*([A-Ha-hＡ-Ｈａ-ｈOXoxＯＸｏｘ○〇◯╳✕✗×]{1,8})\s*[)）]\s*/, TRAIL_ANS = /\s*[(（]\s*([A-Ha-hＡ-Ｈａ-ｈOXoxＯＸｏｘ○〇◯╳✕✗×]{1,8})\s*[)）]\s*$/, LEAD_EMPTY = /^\s*[(（][\s_＿]*[)）]\s*/;
function takeAns(t){
  let ans = '', m; t = String(t || '');
  if ((m = LEAD_ANS.exec(t))) { ans = m[1]; t = t.slice(m[0].length); } else t = t.replace(LEAD_EMPTY, '');
  if ((m = TRAIL_ANS.exec(t))) { if (!ans) ans = m[1]; t = t.slice(0, m.index); }
  return {text:t.trim(), ans};
}
function finishQ(cur, out, skipped){
  if (!cur) return;
  const ex = takeAns(cur.q); cur.q = ex.text; if (!String(cur.ans || '').trim()) cur.ans = ex.ans;
  const q = cur.q.replace(/\s+/g, ' ').trim(), opts = cur.opts.map((o) => o.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 8);
  if (!q) return;
  if (opts.length >= 2) { const ans = normAns(cur.ans, opts.length); out.push({q, type:ans.length > 1 ? 'm' : 's', opts, ans}); }
  else { const ans = normAns(cur.ans, 0); if (ans) out.push({q, type:'t', opts:[], ans}); else skipped.push(q); }
}
const Q_RE = /^(?:[(（]\s*([A-Ha-hＡ-ＨOXoxＯＸ○〇╳✕]{1,8})?[\s_＿]*[)）]\s*)?(?:第\s*)?(?:Q\s*)?(\d{1,3}|[一二三四五六七八九十]{1,3})\s*(?:題)?\s*[.．、)）:：]\s*(.*)$/i;
const ANS_RE = /^(?:答案|正解|解答|正確答案|ans(?:wer)?)\s*[:：]?\s*(.+)$/i;
const OPTLINE_RE = /^[(（]?\s*([A-Ha-hＡ-Ｈ])\s*[)）.．、:：]\s*(.*)$/;
function parseQuizText(text){
  const out = [], skipped = []; let cur = null, brk = false;
  String(text || '').split(/\r?\n/).forEach((raw) => {
    let line = raw.replace(/　/g, ' ').trim();
    if (!line) { brk = true; return; }
    let m;
    if ((m = ANS_RE.exec(line)) && cur) { cur.ans = m[1]; brk = false; return; }
    const forcedQ = /^#Q /.test(line), forcedO = /^#O /.test(line);
    if (forcedQ || forcedO) line = line.slice(3).trim();
    if (forcedO && cur) { const s = splitInline(line); if (s.opts.length) cur.opts.push(...(s.head ? [s.head] : []), ...s.opts); else cur.opts.push(line); brk = false; return; }
    if (forcedQ || (m = Q_RE.exec(line))) {
      finishQ(cur, out, skipped);
      const ex = takeAns(forcedQ ? line : m[3]), s = splitInline(ex.text), ex2 = takeAns(s.head || ex.text);
      cur = {q:ex2.text, opts:s.opts.slice(), ans:(forcedQ ? '' : (m[1] || '')) || ex.ans || ex2.ans};
      brk = false; return;
    }
    if (cur && (m = OPTLINE_RE.exec(line)) && FW(m[1]).toUpperCase().charCodeAt(0) - 65 === cur.opts.length) {
      const s = splitInline(line); if (s.opts.length >= 2) cur.opts.push(...s.opts); else cur.opts.push(m[2]);
      brk = false; return;
    }
    if (!cur || (brk && (cur.opts.length || cur.ans))) { finishQ(cur, out, skipped); const ex = takeAns(line), s = splitInline(ex.text), ex2 = takeAns(s.head || ex.text); cur = {q:ex2.text, opts:s.opts.slice(), ans:ex.ans || ex2.ans}; brk = false; return; }
    if (cur.opts.length) cur.opts[cur.opts.length - 1] += ' ' + line; else { const s = splitInline(line); if (s.opts.length) { cur.q += ' ' + s.head; cur.opts.push(...s.opts); } else cur.q += ' ' + line; }
    brk = false;
  });
  finishQ(cur, out, skipped);
  return {items:out, skipped};
}
// 表格題庫：題目｜選項A…H（或選項1…）｜答案；沒有標題列時＝第一欄題目、最後一欄像答案就當答案
function rowsToQuiz(rows){
  rows = rows.map((r) => r.map((c) => String(c == null ? '' : c).trim())).filter((r) => r.some(Boolean));
  const out = [], skipped = []; if (!rows.length) return {items:out, skipped};
  const H = rows[0].map((c) => FW(c).replace(/\s/g, '').toUpperCase());
  let qi = H.findIndex((h) => /題目|問題|題幹|QUESTION/.test(h)), ai = H.findIndex((h) => /答案|正解|解答|ANSWER|^ANS$/.test(h));
  let oi = H.map((h, i) => /^(選項)?[A-H]$|^選項\d$|^OPTION\d?[A-H]?$/.test(h) ? i : -1).filter((i) => i >= 0);
  let body = rows.slice(1);
  if (qi < 0) {
    body = rows; qi = 0;
    const last = Math.max.apply(null, rows.map((r) => r.length)) - 1;
    ai = last > 0 && rows.filter((r) => /^[A-HＡ-Ｈ]{1,8}$|^[OX○╳是否對錯]$/i.test(FW(r[last] || ''))).length / rows.length > .6 ? last : -1;
    oi = []; for (let i = 1; i <= last; i++) if (i !== ai) oi.push(i);
  } else if (!oi.length) { for (let i = 0; i < H.length; i++) if (i !== qi && i !== ai && !/題型|類型|分數|配分|編號|題號|解析|說明/.test(H[i])) oi.push(i); }
  body.forEach((r) => finishQ({q:r[qi] || '', opts:oi.map((i) => r[i] || '').filter(Boolean), ans:ai >= 0 ? r[ai] || '' : ''}, out, skipped));
  return {items:out, skipped};
}

root.TCHIO = {zipStore, unzip, crc32, readFile, readXlsx, readDocx, parseCsv, decodeText, xlsxBlob, csvText,
  parseRosterText, rowsToRoster, parseQuizText, rowsToQuiz, normAns, splitInline, takeAns, isId};
})(typeof window !== 'undefined' ? window : globalThis);
