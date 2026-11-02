// 시험용 사회보험료 내역서(가짜 이름·번호): 통합 납부내역서(글자 PDF) · 건강보험 부과내역(스캔 PDF) — 연금 엑셀은 make-ins.py
import { chromium } from 'playwright-core';
import { PDFDocument } from 'pdf-lib';
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const DIR = join(dirname(fileURLToPath(import.meta.url)), 'ins');
const td = 'border:1px solid #444;padding:6px 8px;font-size:13px', r = 'text-align:right';
const tbl = (head, rows) => `<table style="border-collapse:collapse;width:100%"><tr>${head.map((h) => `<th style="${td};background:#eee">${h}</th>`).join('')}</tr>${rows.map((x) => `<tr>${x.map((v, i) => `<td style="${td};${i ? r : ''}">${v}</td>`).join('')}</tr>`).join('')}</table>`;
const page = (h) => `<body style="margin:0"><div style="width:794px;height:1123px;box-sizing:border-box;padding:56px 60px;font-family:'Noto Sans CJK KR';color:#222">${h}</div></body>`;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 794, height: 1123 } });
// 1) 통합(연금·건강·장기요양) 월별 + 합계 — 글자 PDF
await p.setContent(page(`<h1 style="text-align:center;font-size:26px">사업장 보험료 납부내역서</h1><p>사업장명 : (주)다해토건 (시청사 옥상 방수공사 현장)</p>` +
  tbl(['납부연월', '국민연금', '건강보험', '장기요양', '계'], [['2026-06', '450,000', '354,500', '45,900', '850,400'], ['2026-07', '450,000', '354,500', '45,900', '850,400'], ['2026-08', '300,000', '236,330', '30,600', '566,930'], ['합계', '1,200,000', '945,330', '122,400', '2,267,730']])));
await writeFile(join(DIR, '보험료_납부내역서.pdf'), await p.pdf({ format: 'A4' }));
// 2) 건강보험 부과내역(근로자별, 합계 줄 없음) — 스캔 PDF
await p.setContent(page(`<h1 style="text-align:center;font-size:26px">건강보험료 부과내역</h1><p>사업장 : (주)다해토건 현장 · 2026년 9월분</p>` +
  tbl(['성명', '주민등록번호', '보수월액', '건강보험료', '장기요양보험료', '계'], [['가나다', '800101-1******', '3,000,000', '106,350', '13,770', '120,120'], ['라마바', '850505-1******', '2,500,000', '88,620', '11,470', '100,090'], ['사아자', '900909-1******', '2,800,000', '99,260', '12,850', '112,110']])));
const p2 = await b.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 2 });
await p2.setContent(await p.content());
const out = await PDFDocument.create(); const img = await out.embedJpg(await p2.screenshot({ type: 'jpeg', quality: 60 }));
out.addPage([595.28, 841.89]).drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
await writeFile(join(DIR, '건강보험_부과내역_스캔.pdf'), await out.save());
await b.close(); console.log('ok');
