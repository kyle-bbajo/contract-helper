// 시연판용 묶음 PDF: 착수계 묶음 6쪽(한 파일에 여러 서류를 스캔한 경우)
import { chromium } from 'playwright-core';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const DIR = join(dirname(fileURLToPath(import.meta.url)), 'bundle');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage();
const pg = (t, lines) => `<section style="page-break-after:always;font-family:'Noto Sans CJK KR';padding:56px 60px"><h1 style="font-size:38px;text-align:center;letter-spacing:6px;margin:10px 0 40px">${t}</h1>${lines.map((l) => `<p style="font-size:19px;margin:14px 0">${l}</p>`).join('')}</section>`;
const A = '시청사 옥상 방수공사', V = '(주)다해토건';
await p.setContent('<body style="margin:0">' + [
  pg('착 공 계', [`공사명 : ${A}`, '착공일 : 2026. 6. 1.', `수급인 : ${V} 대표이사 홍길동`, '위와 같이 착공하였음을 신고합니다.']),
  pg('현장대리인계', [`공사명 : ${A}`, '현장대리인 : 김현장 (건축기사)', `${V}`]),
  pg('예정공정표', [`공사명 : ${A}`, '1. 기존 방수층 철거  6/1 ~ 6/10', '2. 바탕 정리  6/11 ~ 6/20', '3. 우레탄 방수  6/21 ~ 9/30']),
  pg('4대 사회보험 가입자명부', [`사업장명 : 다해토건`, '1. 김현장  국민연금·건강보험·고용보험·산재보험', '2. 이작업  국민연금·건강보험·고용보험·산재보험']),
  pg('사업장 가입내역 확인서', ['국민건강보험공단', '사업장명 : 다해토건', '4대 사회보험 사업장 가입내역을 확인합니다.']),
  pg('고용·산재보험 가입증명원', [`공사명 : ${A}`, '공사기간 : 2026. 6. 1. ~ 2026. 9. 30.', '계약금액 : 48,000,000원', '근로복지공단']),
].join('') + '</body>');
await p.pdf({ path: join(DIR, '착수계묶음_시청사방수.pdf'), format: 'A4' });
await b.close();
console.log('ok');
