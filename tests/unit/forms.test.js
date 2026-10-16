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
