// node tools/test_io.mjs：測名單與題庫的純文字解析
import fs from 'fs';
new Function(fs.readFileSync(new URL('../io.js', import.meta.url), 'utf8'))();
const IO = globalThis.TCHIO; let fail = 0;
const eq = (name, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) { fail++; console.log('FAIL', name, '\n  got ', JSON.stringify(a), '\n  want', JSON.stringify(b)); } };
// 名單
eq('roster tab', IO.parseRosterText('學號\t姓名\n410001\t王小明\n410002\t李小華'), {list:['王小明','李小華'], ids:{'王小明':'410001','李小華':'410002'}});
eq('roster space', IO.parseRosterText('A1100231 陳一\n0123 林二'), {list:['陳一','林二'], ids:{'陳一':'A1100231','林二':'0123'}});
eq('roster names', IO.parseRosterText('王小明、李小華\n王小明'), {list:['王小明','李小華','王小明(2)'], ids:{}});
eq('roster seat', IO.parseRosterText('1 號\n2 號').list, ['1 號','2 號']);
eq('rows header', IO.rowsToRoster([['座號','姓名','備註'],['1','王','x'],['="02"','李','']]).ids, {'王':'1','李':'02'});
eq('rows guess', IO.rowsToRoster([['王小明','410001'],['李小華','410002']]).ids, {'王小明':'410001','李小華':'410002'});
eq('rows name order', IO.rowsToRoster([['姓名','學號'],['王','s01']]).list, ['王']);
// 題庫
const t1 = IO.parseQuizText(`1. 下列何者是大型語言模型？
(A) Excel (B) ChatGPT (C) Word (D) 小畫家
答案：B

2、哪些是 Google 的產品？
A. Gemini
B. Claude
C. NotebookLM
答案：AC

(X)3. 毛利率越高一定越賺錢。

4. 開放題沒有選項`);
eq('quiz items', t1.items, [
 {q:'下列何者是大型語言模型？', type:'s', opts:['Excel','ChatGPT','Word','小畫家'], ans:'B'},
 {q:'哪些是 Google 的產品？', type:'m', opts:['Gemini','Claude','NotebookLM'], ans:'AC'},
 {q:'毛利率越高一定越賺錢。', type:'t', opts:[], ans:'B'}]);
eq('quiz skipped', t1.skipped, ['開放題沒有選項']);
const t2 = IO.parseQuizText('#Q 台灣最高的山？\n#O 玉山\n#O 雪山\n答案：Ａ\n#Q 第二題\n#O 甲\n#O 乙');
eq('docx numbering', t2.items.map(x=>[x.q,x.opts,x.ans]), [['台灣最高的山？',['玉山','雪山'],'A'],['第二題',['甲','乙'],'']]);
const t3 = IO.parseQuizText('(C)1.颱風好發季節？(A)春 (B)冬 (C)夏秋\n(A)2. 是非：地球是圓的 答案：O');
eq('answer prefix', t3.items[0], {q:'颱風好發季節？', type:'s', opts:['春','冬','夏秋'], ans:'C'});
eq('no number question', IO.parseQuizText('天空是什麼顏色\nA. 藍\nB. 綠\n\n海是鹹的嗎\n答案：對').items.map(x=>[x.q,x.type,x.ans]), [['天空是什麼顏色','s',''],['海是鹹的嗎','t','A']]);
eq('option text with period', IO.parseQuizText('1. 單位？\nA. 3.5 公斤\nB. 1.2 公斤').items[0].opts, ['3.5 公斤','1.2 公斤']);
eq('rows quiz header', IO.rowsToQuiz([['題號','題目','選項A','選項B','選項C','答案'],['1','Q1','x','y','z','c']]).items, [{q:'Q1',type:'s',opts:['x','y','z'],ans:'C'}]);
eq('rows quiz noheader', IO.rowsToQuiz([['Q1','x','y','B'],['Q2','是非','','O']]).items.map(x=>[x.q,x.type,x.ans]), [['Q1','s','B'],['Q2','t','A']]);
// CSV
eq('csv', IO.parseCsv('a,"b,c","d""e"\r\n1,2,3'), [['a','b,c','d"e'],['1','2','3']]);
eq('csvText', IO.csvText([['學號','姓名'],['0123','王,小']]), '﻿學號,姓名\r\n="0123","王,小"');
console.log(fail ? fail + ' FAILED' : 'all passed');
