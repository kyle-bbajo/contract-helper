// 시험용 서류 만들기 — 파일명은 일부러 noname(n)으로 (실제 다운로드처럼)
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const CFB = require('cfb');
const { PDFDocument } = require('pdf-lib');

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'docs');
export const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });

const A = { no: 'R26BK01234567-00', name: '시청사 옥상 방수공사', vendor: '(주)다해토건' };
const B = { no: 'R26BS07654321-00', name: '체육관 시설 청소 용역', vendor: '한빛환경 주식회사' };
const pdfs = [
  ['공사 계약서', [`계약번호 : ${A.no}`, `계약건명 : ${A.name}`, '계약금액 : 금 48,000,000원', `계약상대자 상호 : ${A.vendor} 대표자 : 홍길동`, '발주기관 : 용인도시공사']],
  ['견적서', [`공사명 : ${A.name}`, '견적금액 : 금 48,000,000원', `상호 : ${A.vendor}`, '산출내역서 첨부']],
  ['사업장 4대 사회보험 완납증명서', [`사업장명 : 다해토건`, '건강보험 국민연금 고용 산재 체납 없음']],
  ['납세증명서', ['상호(법인명) : 주식회사 다해토건', '사업자등록번호 : 123-45-67890', '국세 체납액 없음']],
  ['용역 계약서', [`계약번호 : ${B.no}`, `계약건명 : ${B.name}`, '계약금액 : 금 21,500,000원', `계약상대자 상호 : ${B.vendor} 대표자 : 김영희`]],
  ['대금청구서', [`용역명 : ${B.name}`, '청구금액 : 금 21,500,000원', '청구인 상호 : 한빛환경(주)']],
  ['회의록', ['안건 : 차년도 예산 편성', '참석 : 계약팀']],
];
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
const html = (t, lines, bg = '#fff') => `<body style="font-family:'Noto Sans CJK KR';padding:60px;background:${bg}"><h1 style="font-size:40px;text-align:center">${t}</h1>${lines.map((l) => `<p style="font-size:22px">${l}</p>`).join('')}</body>`;
let n = 0;
const nextName = (ext) => (n++ === 0 ? `noname.${ext}` : `noname(${n - 1}).${ext}`);
for (const [t, lines] of pdfs) { await page.setContent(html(t, lines)); await page.pdf({ path: join(DIR, nextName('pdf')), format: 'A4' }); }
// 스캔본: 글자 없는 그림 PDF(착공계 A), 사진 JPG(국세? → 준공사진대지 A)
await page.setContent(html('착 공 계', [`공사명 : ${A.name}`, '착공일자 : 2026년 6월 1일', `상호 : ${A.vendor} 대표 홍길동`, '현장대리인계 및 예정공정표 첨부'], '#fbfaf6'));
const png = await page.screenshot();
const doc = await PDFDocument.create(); const img = await doc.embedPng(png); const p = doc.addPage([595, 794]); p.drawImage(img, { x: 0, y: 0, width: 595, height: 794 });
writeFileSync(join(DIR, nextName('pdf')), await doc.save());
await page.setContent(html('준공사진대지', [`공사명 : ${A.name}`, '공사 전 · 중 · 후 사진', `시공사 : ${A.vendor}`], '#f6f7f2'));
writeFileSync(join(DIR, nextName('jpg')), await page.screenshot({ type: 'jpeg', quality: 80 }));
await browser.close();
// 한글: HWP(준공계 A), HWPX(착수계 B)
const u16 = (s) => Buffer.from(s, 'utf16le');
const h = CFB.utils.cfb_new();
CFB.utils.cfb_add(h, '/FileHeader', Buffer.from('HWP Document File'));
CFB.utils.cfb_add(h, '/PrvText', u16(`준공계\r\n<공사명><${A.name}>\r\n<준공일자><2026. 10. 8.>\r\n<상호><${A.vendor}>\r\n`));
writeFileSync(join(DIR, nextName('hwp')), CFB.write(h, { type: 'buffer' }));
const z = CFB.utils.cfb_new();
CFB.utils.cfb_add(z, '/mimetype', Buffer.from('application/hwp+zip'));
CFB.utils.cfb_add(z, '/Preview/PrvText.txt', Buffer.from(`착수계\r\n<용역명><${B.name}>\r\n<상호><${B.vendor}>\r\n`, 'utf8'));
writeFileSync(join(DIR, nextName('hwpx')), CFB.write(z, { type: 'buffer', fileType: 'zip' }));
console.log(`시험 서류 ${n}개를 만들었습니다: ${DIR}`);
