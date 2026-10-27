// 시험용 계약서류 묶음(업체가 한 PDF로 스캔해 보낸 것): 순서 뒤섞임 · 여러 장 서류 · 가짜 이름/번호만
// 만드는 것: bundle/계약서류묶음_스캔.pdf (쪽마다 그림 — 스캔본처럼 글자 층 없음)
import { chromium } from 'playwright-core';
import { PDFDocument } from 'pdf-lib';
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const DIR = join(dirname(fileURLToPath(import.meta.url)), 'bundle');
const V = '(주)가나토건', A = '가나동 체육관 지붕 방수공사', REG = '000-00-00000';
const top = (t) => `<div style="font-size:15px;display:flex;justify-content:space-between;margin-bottom:26px"><span>${t}</span><span></span></div>`;
const T = (t, sz = 40) => `<h1 style="font-size:${sz}px;text-align:center;letter-spacing:8px;margin:18px 0 40px">${t}</h1>`;
const P = (ls) => ls.map((l) => `<p style="font-size:19px;margin:13px 0">${l}</p>`).join('');
// [기대 서류, 쪽 HTML]
const pages = [
  ['bizreg', top('발급번호 : 0000-000-0000') + T('사 업 자 등 록 증') + '<p style="text-align:center;font-size:20px">( 법인사업자 )</p>' + P([`등록번호 : ${REG}`, `법인명(단체명) : ${V}`, '대 표 자 : 가나다', '개업연월일 : 2010년 01월 01일', '사업장 소재지 : 가상시 가상구 가상로 1'])],
  ['pledge', T('계약이행 통합 서약서', 32) + P([`계 약 명 : ${A}`, `계약상대자 : ${V}`, '본인은 위 계약을 이행함에 있어 다음 사항을 성실히 지킬 것을 서약합니다.', '1. 청렴계약 이행', '2. 수의계약 각서 내용 준수'])],
  ['pledge', P(['2. 청렴계약 이행 서약서']) + P(['우리 회사는 부패 없는 투명한 기업경영과 공정한 행정이 사회발전과 국가경쟁력에', '중요한 관건이 됨을 깊이 인식하며, 다음 사항을 지킬 것을 서약합니다.', '가. 금품·향응 제공 금지', '나. 담합 금지'])],
  ['pledge', '<p style="text-align:center;font-size:16px">- 3 -</p>' + P(['3. 수의계약 각서', '수의계약 체결 제한 사유에 해당하지 않음을 확인합니다.', '붙임 : 사업자등록증 사본 1부, 인감증명서 1부'])],
  ['pledge', P(['4. 하도급 관련 서약', '위 사항을 위반한 때에는 어떠한 처분도 감수하겠습니다.', '', '2026. 7. 1.', `${V} 대표이사 가나다 (인)`])],
  ['corpreg', top('등기번호 000000') + T('등기사항전부증명서(말소사항 포함)', 26) + P(['등록번호 000000-0000000', `상 호 ${V}`, '본 점 가상시 가상구 가상로 1'])],
  ['corpreg', top('등기번호 000000') + P(['임원에 관한 사항', '사내이사 가나다', '감사 라마바', '', '1. 목적', '건축공사업'])],
  ['seal', T('법 인 인 감 증 명 서', 34) + P(['등록번호 000000-0000000', `상 호 ${V}`, '본 점 가상시 가상구 가상로 1', '용도 : 계약용'])],
  ['useseal', T('사 용 인 감 계') + P([`상 호 : ${V}`, '위 인감을 계약 업무에 사용하고자 신고합니다.', '사용인감 :  ( 인 )', '법인인감 :  ( 인 )'])],
  ['bank', T('보 통 예 금', 34) + P(['가나은행', `예금주 : ${V}`, '계좌번호 : 000-000000-00000', '입출금이 자유로운 예금'])],
  ['license', T('건 설 업 등 록 증') + P([`상호 : ${V}`, '등록번호 : 가상-00-0000', '업종 : 지붕판금·건축물조립공사업'])],
  ['licbook', T('건설업 등록수첩', 36) + P([`상호 : ${V}`, '등록번호 : 가상-00-0000'])],
  ['licbook', '<p style="text-align:right;font-size:16px">2 / 3</p>' + P(['변경사항', '기술인력 보유 현황', '1. 가나다 건축기사', '2. 라마바 건축산업기사'])],
  ['women', T('여 성 기 업 확 인 서', 34) + P([`기업명 : ${V}`, '확인번호 : 제0000-000호', '유효기간 : 2026. 1. 1. ~ 2027. 12. 31.'])],
  ['women', '<p style="font-size:16px">(뒷면)</p>' + P(['유의사항', '1. 이 확인서는 유효기간 안에만 쓸 수 있습니다.', '2. 내용이 바뀌면 다시 받아야 합니다.'])],
  ['disabled', T('장 애 인 기 업 확 인 서', 32) + P([`기업명 : ${V}`, '확인번호 : 제0000-000호'])],
];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 794, height: 1123 } });
const out = await PDFDocument.create();
for (const [, html] of pages) {
  await p.setContent(`<body style="margin:0;background:#fff"><div style="width:794px;height:1123px;box-sizing:border-box;padding:60px 64px;font-family:'Noto Sans CJK KR';filter:blur(.35px) contrast(.9)">${html}</div></body>`);
  const jpg = await p.screenshot({ type: 'jpeg', quality: 55 });
  const img = await out.embedJpg(jpg);
  out.addPage([595.28, 841.89]).drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
}
await writeFile(join(DIR, '계약서류묶음_스캔.pdf'), await out.save());
await writeFile(join(DIR, '계약서류묶음_스캔.expect.json'), JSON.stringify(pages.map((x) => x[0])));
await b.close();
console.log('ok', pages.length);
