// 시험용: 여러 계약 서류가 한 PDF에 섞인 스캔 묶음(업체가 두 계약 서류를 한꺼번에 보냄) + 세금계산서 두 장(금액으로 계약 구분)
// 가짜 이름·번호만. 만드는 것: bundle/여러계약묶음_스캔.pdf
import { chromium } from 'playwright-core';
import { PDFDocument } from 'pdf-lib';
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const DIR = join(dirname(fileURLToPath(import.meta.url)), 'bundle');
const V = '(주)가나토건', X = '가나동 체육관 지붕 방수공사', Y = '다라동 주차장 도색공사';
const cell = 'border:1px solid #333;padding:7px;font-size:14px';
const T = (t) => `<h1 style="text-align:center;font-size:32px;letter-spacing:10px;margin:10px 0 30px">${t}</h1>`;
const tbl = (rows) => `<table style="border-collapse:collapse;width:100%">${rows.map(([a, b]) => `<tr><td style="${cell};width:130px">${a}</td><td style="${cell}">${b}</td></tr>`).join('')}</table>`;
const P = (ls) => ls.map((l) => `<p style="font-size:14px;margin:14px 0">${l}</p>`).join('');
const td = 'border:1px solid #c33;padding:4px 6px;font-size:12px';
const inv = (name, supply, tax) => `<h1 style="text-align:center;color:#c33;font-size:26px;letter-spacing:6px">전자세금계산서</h1><p style="text-align:right;font-size:11px">승인번호 20261031-41000045-0000000${supply % 7}</p>
<table style="border-collapse:collapse;width:100%"><tr><td style="${td}" rowspan="2">공급자</td><td style="${td}">등록번호</td><td style="${td}">123-81-45678</td><td style="${td}" rowspan="2">공급받는자</td><td style="${td}">등록번호</td><td style="${td}">135-82-12345</td></tr>
<tr><td style="${td}">상호(법인명)</td><td style="${td}">${V} 성명 가나다</td><td style="${td}">상호(법인명)</td><td style="${td}">가상도시공사</td></tr></table>
<table style="border-collapse:collapse;width:100%;margin-top:8px"><tr><td style="${td}">작성일자</td><td style="${td}">공급가액</td><td style="${td}">세액</td><td style="${td}">비고</td></tr>
<tr><td style="${td}">2026-10-31</td><td style="${td};text-align:right">${supply.toLocaleString('en-US')}</td><td style="${td};text-align:right">${tax.toLocaleString('en-US')}</td><td style="${td}">${name}</td></tr></table>
<table style="border-collapse:collapse;width:100%;margin-top:8px"><tr><td style="${td}">합계금액</td><td style="${td};text-align:right">${(supply + tax).toLocaleString('en-US')}</td></tr></table>`;
const pages = [
  ['X:start', T('착 공 계') + tbl([['공 사 명', X], ['계 약 금 액', '금 48,000,000원'], ['착 공 일', '2026년 6월 1일']]) + P(['위와 같이 착공하였음을 신고합니다.', `수급인 ${V}`])],
  ['X:start', T('현장대리인계') + tbl([['공 사 명', X], ['현장대리인', '가나다 (건축기사)']]) + P([V])],
  ['Y:start', T('착 공 계') + tbl([['공 사 명', Y], ['계 약 금 액', '금 12,000,000원'], ['착 공 일', '2026년 7월 1일']]) + P(['위와 같이 착공하였음을 신고합니다.', `수급인 ${V}`])],
  ['Y:start', T('예정공정표') + tbl([['공 사 명', Y]]) + P(['1. 바탕 정리 7/1 ~ 7/10', '2. 도색 7/11 ~ 8/31'])],
  ['Y:invoice', inv(Y, 10909091, 1090909)],
  ['X:invoice', inv(X, 43636364, 4363636)],
];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 1.6 });
const out = await PDFDocument.create();
for (const [, html] of pages) {
  await p.setContent(`<body style="margin:0;background:#fff"><div style="width:794px;height:1123px;box-sizing:border-box;padding:56px 60px;font-family:'Noto Sans CJK KR';color:#222;filter:blur(.3px)">${html}</div></body>`);
  const img = await out.embedJpg(await p.screenshot({ type: 'jpeg', quality: 60 }));
  out.addPage([595.28, 841.89]).drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
}
await writeFile(join(DIR, '여러계약묶음_스캔.pdf'), await out.save());
await b.close();
console.log('ok', pages.length);
