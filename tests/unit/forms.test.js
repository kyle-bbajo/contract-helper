// 감사·검사 서식 단위 시험 — 엑셀(openpyxl), 한글(python-hwpx가 있으면 검증, 없으면 XML만)
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { writeFileSync, mkdtempSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const L = require('../../src/app/js/logic.js');
globalThis.JH = { logic: L };
const X = require('../../src/app/js/xlsx.js'); JH.xlsx = X;
const F = require('../../src/app/js/forms.js');

const C = [
  { key: 'a', type: '공사', name: '특화사업처 사무실 환경개선 공사', vendor: '성은건설(주)', amount: 12000000, contractDate: '20260808', startDate: '20260808', endDate: '20260904',
    method: '수의계약', law: '지방계약법 (제25조제1항5호나목)', lawDtl: '추정가격 2천만원 이하', rep: '김성은',
    memo: { dept: '시설관리팀', aBudget: '72000000', aDesign: '12700000', aEst: '12,700,000원', aAddr: '경기도 용인시 처인구 금령로 1' } },
  { key: 'b', type: '공사', name: '보정 신호등 이설공사', vendor: '한성테크(주)', amount: 20593000, contractDate: '20260815', startDate: '20260815', endDate: '20270131', method: '수의견적입찰',
    g2b: { budget: 41751280, bssamt: 23320000, plnprc: 23320000, origAmount: 21454000, origEnd: '20261220', addr: '경기도 수원시', rep: '이한성',
      amtChanges: [{ date: '20261218', amount: 20593000, diff: -861000 }], endChanges: [{ date: '20261219', from: '20261220', to: '20270131' }] },
    memo: { aChgWhy: '준공정산', aExtWhy: '동절기 공사중지' } },
  { key: 'c', type: '물품', name: '복합기 구매', vendor: '(주)오피스넷', amount: 9000000, contractDate: '20260414', method: '수의계약' },
  { key: 'd', type: '용역', name: '청소용역', vendor: '(주)그린', amount: 48600000, contractDate: '20250101', method: '수의계약' },
  { key: 'e', type: '용역', name: '시설 점검 용역', vendor: '(주)점검', amount: 30000000, contractDate: '20260301', method: '제한경쟁' },
];

test('나라장터 도우미: 수의계약 사유·변경이력·업체 칸·문서에서 값 찾기', () => {
  assert.equal(L.contractReason('지방계약법 (제25조제1항5호나목)', '추정가격 2천만원 이하 물품 또는 용역'), '지방계약법 시행령 제25조 제1항 제5호 나목 (추정가격 2천만원 이하 물품 또는 용역)');
  const sm = L.summarizeChanges([
    { dcsnCntrctNo: 'X-01', totCntrctAmt: '48000000', ttalCcmpltDate: '2026-10-10', cntrctDate: '2026-09-20' },
    { dcsnCntrctNo: 'X-00', totCntrctAmt: '48000000', ttalCcmpltDate: '2026-09-30', cntrctCnclsDate: '2026-05-28' },
    { dcsnCntrctNo: 'X-02', totCntrctAmt: '47139000', ttalCcmpltDate: '2026-10-10', cntrctDate: '2026-10-08' },
  ]);
  assert.equal(sm.origAmount, 48000000); assert.equal(sm.origEnd, '20260930');
  assert.deepEqual(sm.endChanges, [{ date: '20260920', from: '20260930', to: '20261010' }]);
  assert.deepEqual(sm.amtChanges, [{ date: '20261008', amount: 47139000, diff: -861000 }]);
  assert.deepEqual(L.parseCorpRows('[1^주계약업체^단독^(주)다해^홍길동^대한민국^100^(주)다해^^123-45-67890]'), [{ role: '주계약업체', name: '(주)다해', rep: '홍길동', bizno: '1234567890' }]);
  assert.deepEqual(L.pickScsbid([{ bidNtceNo: 'R26BK1', bidwinnrNm: 'A' }, { bidNtceNo: 'R26BK2', bidwinnrNm: 'B', bidwinnrAdrs: '경기도', sucsfbidAmt: '100' }], 'R26BK2-000').addr, '경기도');
  assert.equal(L.pickBid([{ bidNtceNo: 'OTHER', bdgtAmt: '5' }], 'R26BK2'), null, '다른 공고는 쓰지 않음');
  assert.match(L.g2bUrl('scsbid', '용역', 'R26BK2-000', 'k'), /ScsbidInfoService\/getScsbidListSttusServc\?.*inqryDiv=4.*bidNtceNo=R26BK2/);
  assert.match(L.g2bUrl('corp', '공사', '123-45-67890', 'k'), /UsrInfoService02\/getPrcrmntCorpBasicInfo02\?.*inqryDiv=3.*bizno=1234567890/);
  assert.deepEqual(L.scanAuditFields(['견 적 서', '예정가격 : 12,700,000원', '대표자 홍길동', '주소: 경기도 용인시 처인구 중부대로 1199 전화 031-000']),
    { est: 12700000, addr: '경기도 용인시 처인구 중부대로 1199', rep: '홍길동' });
});

test('한 줄 값: 직접 넣은 값 > 나라장터 > 기본값, 낙찰률·증감', () => {
  const a = F.rowOf(C[0], { finish: '20260904' });
  assert.equal(a.est, 12700000); assert.equal(a.award, 12000000); assert.equal(a.src.est, '직접'); assert.equal(a.actual, '20260904');
  assert.equal(a.reason, '지방계약법 시행령 제25조 제1항 제5호 나목 (추정가격 2천만원 이하)'); assert.equal(a.team, '시설관리팀');
  const b = F.rowOf(C[1]);
  assert.equal(b.award, 21454000, '낙찰금액은 당초 계약금액'); assert.equal(b.est, 23320000); assert.equal(b.extOrig, '20261220');
  assert.equal(F.signed(b.chg[0].diff), '감)861'); assert.equal(Math.round(b.rate * 1000) / 1000, 91.998);
  const rows = C.map((c) => F.rowOf(c));
  assert.deepEqual(F.auditCandidates(rows, 10000000).map((r) => r.key), ['a', 'b', 'd'], '수의계약이고 1천만원 이상만');
  assert.deepEqual(rows.filter((r) => F.inPeriod(r, '2026-01-01', '2026-12-31')).map((r) => r.key), ['a', 'b', 'c', 'e']);
});

test('종합검사 엑셀: 양식과 같은 머리 3줄·병합·글꼴·숫자 서식', () => {
  const rows = C.map((c) => F.rowOf(c));
  const sheet = F.inspectSheet(rows, { dept: '경영기획본부', confirmer: { pos: '재무관리처장', name: '홍길동' }, writer: { pos: '회계팀장' } });
  const dir = mkdtempSync(join(tmpdir(), 'form-')); const f = join(dir, 'i.xlsx'); writeFileSync(f, X.build({ title: 't', sheets: [sheet] }));
  const out = JSON.parse(execFileSync('python3', ['-c', `
import json, sys, openpyxl
ws = openpyxl.load_workbook(sys.argv[1]).active
v = lambda c: ws[c].value
print(json.dumps({'a1': v('A1'), 'd2': v('D2'), 'a4': v('A4'), 'a5': v('A5'), 'f6': v('F6'), 'j7': v('J7'), 'a9': v('A9'), 'b9': v('B9'), 'f9': v('F9'), 'fmt': [ws['B9'].number_format, ws['F9'].number_format],
  'font': [ws['A9'].font.name, ws['A9'].font.sz, ws['A1'].font.sz, ws['D2'].font.sz], 'merged': sorted(str(m) for m in ws.merged_cells.ranges if m.min_row <= 8), 'titles': ws.print_title_rows,
  'o10': v('O10'), 'labels': [c.value for c in ws['A'] if c.value and ')' in str(c.value) and str(c.value)[0].isdigit()]}, ensure_ascii=False))`, f]).toString());
  assert.equal(out.a1, '7. (공사․용역․물품구매) 계약집행 현황(총괄)');
  assert.equal(out.d2, '확인자  :  직 재무관리처장    성 명    홍 길 동  (인)');
  assert.equal(out.a4, '1) 경영기획본부-공사'); assert.equal(out.a5, '(단위 : 천원)'); assert.equal(out.f6, '낙찰율(%)'); assert.equal(out.j7, '당초\n준공\n기일');
  assert.equal(out.a9, '특화사업처 사무실 환경개선 공사'); assert.equal(out.b9, 72000); assert.equal(out.f9, 94.488);
  assert.deepEqual(out.fmt, ['_-* #,##0_-;\\-* #,##0_-;_-* "-"_-;_-@_-', '0.000_ ']);
  assert.deepEqual(out.font, ['휴먼명조', 13, 20, 18]);
  for (const m of ['A5:R5', 'A6:A8', 'J6:L6', 'M6:P6', 'J7:J8', 'P7:P8', 'Q6:Q8', 'R6:R8', 'D2:R2', 'D3:R3']) assert.ok(out.merged.includes(m), m);
  assert.equal(out.titles, '$6:$8'); assert.equal(out.o10, '감)861');
  assert.deepEqual(out.labels.slice(1), ['1) 경영기획본부-공사', '2) 경영기획본부-용역', '3) 경영기획본부-물품구매']);
});

test('행정사무감사 한글: 받은 양식(공사·물품·용역 표)에 줄을 채움, A4 가로·여백 유지', () => {
  const rows = F.auditCandidates(C.map((c) => F.rowOf(c)), 10000000);
  const bytes = F.auditHwpx(rows);
  const dir = mkdtempSync(join(tmpdir(), 'form-')); const f = join(dir, 'a.hwpx'); writeFileSync(f, bytes);
  const out = JSON.parse(execFileSync('python3', ['-c', `
import json, sys, zipfile, re, xml.dom.minidom
z = zipfile.ZipFile(sys.argv[1])
names = [i.filename for i in z.infolist()]
s = z.read('Contents/section0.xml').decode('utf-8'); h = z.read('Contents/header.xml').decode('utf-8')
xml.dom.minidom.parseString(s); xml.dom.minidom.parseString(h)
ok = None
try:
    from hwpx.document import HwpxDocument
    d = HwpxDocument.open(sys.argv[1]); ok = len(d.validate().issues) == 0
except ImportError: pass
print(json.dumps({'first': names[0], 'stored': z.infolist()[0].compress_type, 'page': re.search(r'<hp:pagePr[^>]*>.*?</hp:pagePr>', s).group(0),
  'rowCnt': re.findall(r'rowCnt="(\\d+)"', s), 'texts': re.findall(r'<hp:t>([^<]*)</hp:t>', s), 'valid': ok}, ensure_ascii=False))`, f]).toString());
  assert.equal(out.first, 'mimetype'); assert.equal(out.stored, 0);
  assert.match(out.page, /landscape="NARROWLY"/);
  assert.match(out.page, /header="4252" footer="4252" gutter="0" left="4252" right="4252" top="5668" bottom="4252"/);
  assert.deepEqual(out.rowCnt, ['4', '3', '3'], '공사 2건, 물품 없음(해당 없음 1줄), 용역 1건');
  assert.ok(out.texts[0].startsWith('【공사】'), '받은 양식 그대로(제목 줄 없음)');
  assert.ok(out.texts.includes('특화사업처 사무실 환경개선 공사')); assert.ok(out.texts.includes('94.49')); assert.ok(out.texts.includes("'26.08.08."));
  assert.ok(out.texts.includes('해당 없음')); assert.ok(out.texts.some((t) => t.startsWith('【물품】')));
  assert.ok(out.texts.includes('지방계약법 시행령 제25조 제1항 제5호 나목 (추정가격 2천만원 이하)'));
  if (out.valid !== null) assert.equal(out.valid, true);
});

test('행정사무감사 한글: 계약이 많으면 쪽마다 표를 잘라 새 표로(머리 2줄 다시, 【구분】(계속), 쪽 넘김)', () => {
  const base = F.auditCandidates(C.map((c) => F.rowOf(c)), 10000000);
  const one = base.find((r) => r.type === '공사');
  const many = Array.from({ length: 30 }, (_, i) => ({ ...one, key: 'k' + i, name: `${one.name} ${i + 1}` }));
  const rows = many.concat(base.filter((r) => r.type === '용역'));
  const f = join(mkdtempSync(join(tmpdir(), 'form-')), 'p.hwpx'); writeFileSync(f, F.auditHwpx(rows));
  const out = JSON.parse(execFileSync('python3', ['-c', `
import json, sys, zipfile, re, xml.dom.minidom
s = zipfile.ZipFile(sys.argv[1]).read('Contents/section0.xml').decode('utf-8'); xml.dom.minidom.parseString(s)
tbls = re.findall(r'<hp:tbl [^>]*>', s)
print(json.dumps({'rowCnt': [int(re.search(r'rowCnt="(\\d+)"', t).group(1)) for t in tbls], 'split': [re.search(r'pageBreak="([A-Z]+)"', t).group(1) for t in tbls],
  'breaks': len(re.findall(r'<hp:p [^>]*pageBreak="1"', s)), 'labels': [t for t in re.findall(r'<hp:t>([^<]*)</hp:t>', s) if t.startswith('【')],
  'names': [t for t in re.findall(r'<hp:t>([^<]*)</hp:t>', s) if t.startswith(${JSON.stringify(one.name)})]}, ensure_ascii=False))`, f]).toString());
  const gongsa = out.rowCnt.slice(0, out.rowCnt.length - 2);
  assert.ok(gongsa.length >= 3, `공사 30건은 여러 쪽(표 ${gongsa.length}개)`);
  assert.equal(gongsa.reduce((a, n) => a + n - 2, 0), 30, '나눠도 30건 모두, 겹치거나 빠짐 없이');
  assert.ok(gongsa.every((n) => n - 2 <= 12), '한 쪽에 너무 많이 넣지 않음');
  assert.ok(out.split.every((s) => s === 'NONE'), '쪽마다 자른 표는 쪽을 넘지 않음');
  assert.ok(out.breaks >= gongsa.length - 1, '공사 표마다 앞에서 쪽 넘김');
  assert.ok(out.labels[0].startsWith('【공사】') && !out.labels[0].includes('(계속)'));
  assert.ok(out.labels.slice(1, gongsa.length).every((t) => t.startsWith('【공사】(계속)')));
  assert.ok(out.labels.some((t) => t.startsWith('【용역】')));
  assert.equal(new Set(out.names).size, 30);
});

test('나라장터 결과코드: 자료 없음은 빈 목록, 새 게이트웨이 영어 오류는 우리말로', () => {
  assert.deepEqual(L.parseApiBody({ response: { header: { resultCode: '03', resultMsg: 'NODATA_ERROR' } } }), { items: [], total: 0 });
  assert.throws(() => L.parseApiBody({ response: { header: { resultCode: '30', resultMsg: 'SERVICE KEY IS NOT REGISTERED ERROR.' } } }), /인증키가 등록되지 않았습니다/);
  assert.throws(() => L.parseApiBody({ response: { header: { resultCode: '20', resultMsg: 'SERVICE ACCESS DENIED ERROR.' } } }), /권한이 없습니다/);
  assert.equal(L.parseApiBody({ response: { header: { resultCode: '00' }, body: { items: { item: { a: 1 } }, totalCount: 1 } } }).items.length, 1);
});

test('나라장터가 기준: 값은 직접 > 나라장터 > 서류, 서류 값은 나라장터와 맞춰 보기', () => {
  const c = { key: 'k', type: '공사', name: '시청사 옥상 방수공사', vendor: '(주)다해토건', amount: 47139000, startDate: '20260601', endDate: '20261010', rep: '홍길동',
    g2b: { origAmount: 48000000, origEnd: '20260930', amtChanges: [{ date: '20261008', amount: 47139000, diff: -861000 }], endChanges: [{ date: '20260920', from: '20260930', to: '20261010' }], addr: '경기도 용인시 처인구 중부대로 1199' },
    docVals: { addr: '경기도 수원시 아무로 1', est: 50000000 } };
  const r = F.rowOf(c);
  assert.equal(r.addr, '경기도 용인시 처인구 중부대로 1199', '주소는 나라장터 먼저'); assert.equal(r.src.addr, '나라장터');
  assert.equal(r.est, 50000000, '나라장터에 없으면 서류'); assert.equal(r.src.est, '서류');
  const facts = L.docFacts(['공 사 계 약 서', '계약금액 : 금 48,000,000원', '공사기간 : 2026. 6. 1. ~ 2026. 9. 30.', '대표자 : 홍길동', '주소: 경기도 용인시 처인구 중부대로 1199']);
  assert.deepEqual({ amount: facts.amount, start: facts.start, end: facts.end, rep: facts.rep }, { amount: 48000000, start: '20260601', end: '20260930', rep: '홍길동' });
  const fin = L.docFacts(['준 공 계', '준공일자 : 2026. 10. 15.']);
  const ck = L.verifyFacts(c, [{ itemId: 'c-contract', name: '계약서.pdf', facts }, { itemId: 'c-finish', name: '준공계.pdf', facts: fin }]);
  const by = Object.fromEntries(ck.map((k) => [k.key, k]));
  assert.equal(by.amount.ok, true); assert.match(by.amount.note, /당초/);
  assert.equal(by.end.ok, true); assert.match(by.end.note, /당초/);
  assert.equal(by.start.ok, true);
  assert.equal(by.finish.ok, false, '준공기한 지나 준공'); assert.match(by.finish.note, /지체상금/);
  const ck2 = L.verifyFacts({ ...c, amount: 30000000, g2b: {} }, [{ itemId: 'c-contract', name: 'a', facts }]);
  assert.equal(ck2.find((k) => k.key === 'amount').ok, false, '나라장터와 다른 금액');
});

test('인증키: 인코딩 키는 두 번 바꾸지 않음, 403 글자 응답은 활용신청 안내', () => {
  assert.match(L.g2bUrl('chg', '공사', 'R26TE1', 'ab+c/d=='), /serviceKey=ab%2Bc%2Fd%3D%3D&/);
  assert.match(L.g2bUrl('chg', '공사', 'R26TE1', 'ab%2Bc%2Fd%3D%3D'), /serviceKey=ab%2Bc%2Fd%3D%3D&/);
  assert.throws(() => L.parseApiText('Forbidden'), /활용신청/);
});

test('실제 준공일: 준공계가 없으면 지난 나라장터 완수(준공)일자', () => {
  const c = { key: 'x', type: '용역', name: '건축사 감리 용역', amount: 10000000, endDate: '20261005' };
  assert.equal(F.rowOf(c, { today: '2026-10-16' }).actual, '20261005');
  assert.equal(F.rowOf(c, { today: '2026-10-16' }).src.actual, '나라장터 완수일자');
  assert.equal(F.rowOf(c, { today: '2026-10-01' }).actual, '', '아직 안 지났으면 비움');
  assert.equal(F.rowOf(c, { today: '2026-10-16', finish: '20261008' }).actual, '20261008', '준공계가 있으면 그 날짜');
});

test('업체목록 칸: 칸이 빠지거나 순서가 달라도 업체명 바로 뒤를 대표자로, 가려진 이름도', () => {
  assert.deepEqual(L.parseCorpRows('[1^주계약업체^주식회사 에이스건축사무소^김*수^대한민국^100^^이담당^1234567890]')[0], { role: '주계약업체', name: '주식회사 에이스건축사무소', rep: '김*수', bizno: '1234567890' });
  // 나라장터 화면 순서: 구분^공동도급방식^사업자번호^업체명^공종^지분율^전체지분율^업체담당자(가림)^대표자명
  assert.deepEqual(L.parseCorpRows('[1^대표^단독계약^1238191759^주식회사 호성이엔씨^^100^100^송**^송유이]')[0], { role: '대표', name: '주식회사 호성이엔씨', rep: '송유이', bizno: '1238191759' });
  assert.deepEqual(L.parseCorpList('[1^대표^단독계약^1238191759^주식회사 호성이엔씨^^100^100^송**^송유이]'), ['주식회사 호성이엔씨'], '공동도급방식(단독계약)을 업체명으로 잡지 않음');
  assert.deepEqual(L.parseCorpRows('[1^단독^주식회사 에이스건축사무소^김철수^대한민국^100^^^123-45-67890]')[0].rep, '김철수');
  assert.equal(L.parseCorpRows('[1^주계약업체^단독^한빛환경 주식회사^^대한민국^100^^박담당^1112233333]')[0].rep, '', '대표자 칸이 비면 담당자를 대표자로 잡지 않음');
  assert.deepEqual(L.parseCorpList('[1^구성원^공동이행^(주)둘째^이대표^대한민국^30^^^2223344444],[2^주계약업체^공동이행^(주)첫째^김대표^대한민국^70^^^1112233333]'), ['(주)첫째', '(주)둘째']);
});

test('변경이력 차수마다 고르기: 자동 기본값, 둘 다, 해당 없음, 한 줄만 온 경우', () => {
  const N = 'R26TE01234567';
  const sm = L.summarizeChanges([
    { dcsnCntrctNo: N + '00', totCntrctAmt: '48000000', ttalCcmpltDate: '2026-09-30', cntrctCnclsDate: '2026-05-28' },
    { dcsnCntrctNo: N + '01', totCntrctAmt: '48000000', ttalCcmpltDate: '2026-10-10', cntrctDate: '2026-09-20' },
    { dcsnCntrctNo: N + '02', totCntrctAmt: '47139000', ttalCcmpltDate: '2026-10-10', cntrctDate: '2026-10-08' },
  ]);
  assert.deepEqual(sm.chgRows.map((r) => [r.ord, r.first, r.auto]), [[0, true, 'orig'], [1, false, 'ext'], [2, false, 'design']]);
  const c = { key: 'k', name: '시험 공사', amount: 47139000, g2b: sm };
  let r = F.rowOf(c);
  assert.equal(r.extDate, '20260920'); assert.equal(r.extOrig, '20260930');
  assert.deepEqual(r.chg, [{ date: '20261008', amount: 47139000, diff: -861000 }]);
  // 1차를 둘 다로 고르면 설계변경에도 들어감(금액 증감 0)
  r = F.rowOf({ ...c, memo: { chgKind: { [N + '01']: 'both' } } });
  assert.equal(r.chg.length, 2); assert.equal(r.chg[0].date, '20260920'); assert.equal(r.extDate, '20260920');
  // 해당 없음으로 고르면 서식에서 빠짐
  r = F.rowOf({ ...c, memo: { chgKind: { [N + '01']: 'none', [N + '02']: 'none' } } });
  assert.deepEqual(r.chg, []); assert.equal(r.extDate, ''); assert.equal(r.extOrig, '');
  // 직접 넣은 감사 칸이 가장 우선
  r = F.rowOf({ ...c, memo: { chgKind: { [N + '02']: 'none' }, aChgDate: '20261001', aChgAmt: '47000000' } });
  assert.equal(r.chg.length, 1); assert.equal(r.chg[0].date, '20261001'); assert.equal(r.chg[0].amount, 47000000);
  // 원계약 없이 변경 차수 한 줄만: 표에는 보이고, 고르기 전에는 서식에 안 들어감, 고르면 들어감
  const one = L.summarizeChanges([{ dcsnCntrctNo: N + '-01', totCntrctAmt: '50000000', ttalCcmpltDate: '2026-12-31', cntrctDate: '2026-11-02' }]);
  assert.equal(one.chgRows.length, 1); assert.equal(one.chgRows[0].first, false); assert.equal(one.chgRows[0].auto, '');
  assert.equal(one.origAmount, 0);
  const c1 = { key: 'k1', name: '시험 용역', amount: 50000000, g2b: one };
  assert.deepEqual(F.rowOf(c1).chg, []);
  r = F.rowOf({ ...c1, memo: { chgKind: { [N + '-01']: 'both' } } });
  assert.equal(r.chg.length, 1); assert.equal(r.chg[0].amount, 50000000); assert.equal(r.extDate, '20261102'); assert.equal(r.extOrig, '');
});

test('변경이력이 비어도 -00·-01 차수 계약으로 차수 표·서식 값', () => {
  const N = 'R25TA00935659';
  const c = { key: 'k', name: '같은 이름 용역', type: '용역', amount: 52000000, g2b: { st: { chg: 'none' } },
    ords: { 0: L.ordSnap({ no: N + '00', ord: 0, amount: 48000000, endDate: '2026-09-30', contractDate: '2026-05-28' }),
      1: L.ordSnap({ no: N + '01', ord: 1, amount: 52000000, endDate: '2026-11-30', chgDt: '2026-09-15 10:00:00', contractDate: '2026-05-28' }) } };
  const ch = L.changesOf(c);
  assert.equal(ch.src, '나라장터 계약 차수');
  assert.deepEqual(ch.rows.map((r) => [r.ord, r.auto]), [[0, 'orig'], [1, 'both']]);
  let r = F.rowOf(c);
  assert.equal(r.award, 48000000, '당초 계약금액은 -00');
  assert.deepEqual(r.chg, [{ date: '20260915', amount: 52000000, diff: 4000000 }]);
  assert.equal(r.extDate, '20260915'); assert.equal(r.extOrig, '20260930');
  r = F.rowOf({ ...c, memo: { chgKind: { [N + '01']: 'ext' } } });
  assert.deepEqual(r.chg, []); assert.equal(r.extDate, '20260915');
});
