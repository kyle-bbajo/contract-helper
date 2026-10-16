// 공고문 로직 단위 시험
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { writeFileSync, mkdtempSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const N = require('../../src/app/js/notice-logic.js');
const CFB = require('cfb');

const cfg = { insttNm: '용인도시공사', officer: '박주호', notice: { dept: '계약팀', phone: '031-000-0000', region: '용인시', winwinMin: 50000000 } };

test('새 공고문 기본값은 설정에서', () => {
  const v = N.blank(cfg);
  assert.equal(v.기관명, '용인도시공사'); assert.equal(v.담당부서, '계약팀'); assert.equal(v.지역제한, '용인시'); assert.equal(v.담당자, '박주호');
});

test('자동 규칙: 공종 → 업종제한, 금액 → 부가세·추정금액·상생결제', () => {
  let v = N.applyRules({ ...N.blank(cfg), 구분: '공사', 공종: '전기공사', 추정가격: '30,000,000' }, {}, cfg);
  assert.equal(v.업종제한, '「전기공사업법」에 따른 전기공사업 등록업체');
  assert.equal(v.부가세, '3,000,000'); assert.equal(v.추정금액, '33,000,000'); assert.equal(v.상생결제, '미적용');
  v = N.applyRules({ ...v, 추정가격: '80,000,000' }, {}, cfg);
  assert.equal(v.상생결제, '적용');
  // 직접 고친 항목은 자동으로 덮지 않음
  v = N.applyRules({ ...v, 업종제한: '전기공사업(직접 씀)', 공종: '정보통신공사' }, { 업종제한: true }, cfg);
  assert.equal(v.업종제한, '전기공사업(직접 씀)');
  // 기준 금액이 없으면 상생결제는 사람이 고름
  const v2 = N.applyRules({ ...N.blank({}), 추정가격: '80000000' }, {}, {});
  assert.equal(v2.상생결제, '');
});

test('유사 공고에서 조건별 빈도', () => {
  const raw = (o) => N.normalizeBid({ bidNtceNo: o.no, bidNtceOrd: '000', bidNtceNm: '전기', presmptPrce: '50000000', bidNtceDt: '2026-09-01 10:00:00',
    bidBeginDt: '2026-09-02 10:00:00', bidClseDt: '2026-09-09 10:00:00', opengDt: '2026-09-09 11:00:00', sucsfbidLwltRate: o.rate, sucsfbidMthdNm: '적격심사(지자체)', ...o });
  const bids = [
    { ...raw({ no: 'A', rate: '87.745' }), regions: ['경기도 용인시'], licenses: ['전기공사업'] },
    { ...raw({ no: 'B', rate: '87.745' }), regions: ['경기도 용인시'], licenses: ['전기공사업'] },
    { ...raw({ no: 'C', rate: '86.745' }), regions: ['경기도'], licenses: ['전기공사업'] },
    { ...raw({ no: 'D', rate: '' }), regions: [], licenses: [] },
  ];
  const s = N.learn(bids);
  assert.deepEqual(s.지역제한.top[0], { value: '용인시', count: 2 });
  assert.equal(s.지역제한.top.find((t) => t.value === '경기도').count, 1);
  assert.equal(s.지역제한.top.find((t) => t.value === '제한 없음(전국)').count, 1);
  assert.deepEqual(s.낙찰하한율.top[0], { value: '87.745%', count: 2 });
  assert.equal(s.업종제한.top[0].value, '전기공사업');
  assert.equal(s.입찰기간일수, 7); assert.equal(s.개찰시간차, 1);
  assert.equal(N.mapMethod('적격심사(지자체)'), '적격심사');
  assert.equal(N.mapContract('제한경쟁(총액)'), '제한경쟁');
});

test('검색 주소: 업종명·금액 범위·기관', () => {
  const u = N.bidSearchUrl('공사', { indstrytyNm: '전기공사업', ntceInsttNm: '용인도시공사', priceMin: 15e6, priceMax: 15e7 }, '20261001', '20261016', 1, 100, 'KEY');
  assert.match(u, /getBidPblancListInfoCnstwkPPSSrch\?serviceKey=KEY&/);
  assert.match(u, /inqryBgnDt=202610010000&inqryEndDt=202610162359/);
  assert.match(u, /presmptPrceBgn=15000000&presmptPrceEnd=150000000/);
  assert.match(N.bidDetailUrl('getBidPblancListInfoPrtcptPsblRgn', 'R26BK001', '000', 'KEY'), /inqryDiv=2&bidNtceNo=R26BK001&bidNtceOrd=000/);
});

test('문장 초안', () => {
  const v = N.applyRules({ ...N.blank(cfg), 공고명: '시청사 옥상 방수공사', 공종: '도장·방수공사', 추정가격: '30000000', 낙찰하한율: '87.745%', 입찰마감: '2026-10-28T10:00' }, {}, cfg);
  const d = N.draft(v);
  const all = d.map((x) => x.title + '\n' + x.body).join('\n');
  assert.match(d[0].body, /「시청사 옥상 방수공사」 입찰 공고/);
  assert.match(all, /도장·습식·방수·석공사업 등록업체/);
  assert.match(all, /본점 소재지.*용인시에 있는 자/);
  assert.match(all, /낙찰하한율\(87\.745%\)/);
  assert.match(all, /2026\. 10\. 28\. 10:00/);
  assert.doesNotMatch(all, /상생결제/, '미적용이면 상생결제 문장 없음');
  assert.match(N.draft({ ...v, 상생결제: '적용' }).map((x) => x.body).join('\n'), /상생결제시스템을 통해 지급/);
  assert.match(all, /6\. 입찰의 무효[\s\S]*7\. 계약 체결[\s\S]*8\. 기타/);
  assert.match(all, /추정가격: 금 30,000,000원/);
});

test('한글(HWPX) 양식: 서식 경계로 쪼개진 {{항목}}도 바꾸고 구조 유지', () => {
  const section = '<?xml version="1.0" encoding="UTF-8"?><hs:sec xmlns:hs="s" xmlns:hp="p">' +
    '<hp:p><hp:run charPrIDRef="1"><hp:t>공고명: {{공</hp:t></hp:run><hp:run charPrIDRef="2"><hp:t>고명}}</hp:t></hp:run><hp:linesegarray><hp:lineseg textpos="0"/></hp:linesegarray></hp:p>' +
    '<hp:p><hp:run><hp:t>추정가격 {{추정가격}}원 / 지역: {{지역제한}} / {{없는항목}}</hp:t></hp:run></hp:p></hs:sec>';
  const r = N.fillHwpxXml(section, { 공고명: '시청사 <방수> & 보수', 추정가격: '30,000,000', 지역제한: '용인시' });
  assert.equal(r.count, 3);
  assert.match(r.xml, /<hp:t>공고명: 시청사 &lt;방수&gt; &amp; 보수<\/hp:t><\/hp:run><\/hp:p>|<hp:t>공고명: 시청사 &lt;방수&gt; &amp; 보수<\/hp:t><\/hp:run>/);
  assert.ok(!r.xml.includes('linesegarray'));
  assert.ok(r.xml.includes('{{없는항목}}'), '모르는 항목은 그대로 둠');
  assert.deepEqual(N.placeholdersIn(section).sort(), ['공고명', '없는항목', '지역제한', '추정가격'].sort());

  // zip 왕복: mimetype이 첫 항목·무압축이어야 한글이 HWPX로 인식
  const z = CFB.utils.cfb_new();
  CFB.utils.cfb_add(z, '/mimetype', Buffer.from('application/hwp+zip'));
  CFB.utils.cfb_add(z, '/Contents/section0.xml', Buffer.from(section));
  const bytes = CFB.write(z, { type: 'buffer', fileType: 'zip' });
  const filled = N.fillHwpx(CFB, new Uint8Array(bytes), { 공고명: 'X', 지역제한: '경기도' });
  assert.equal(filled.count, 2);
  const out = Buffer.from(filled.bytes);
  const dir = mkdtempSync(join(tmpdir(), 'hwpx-')); const f = join(dir, 'o.hwpx'); writeFileSync(f, out);
  const info = JSON.parse(execFileSync('python3', ['-c', `
import zipfile,json,sys,xml.dom.minidom as m
z=zipfile.ZipFile(sys.argv[1]);n=z.infolist()
x=z.read('Contents/section0.xml').decode();m.parseString(x)
assert z.testzip() is None
print(json.dumps({'first':n[0].filename,'stored':n[0].compress_type==0,'names':[i.filename for i in n],'x':x}))`, f]).toString());
  assert.match(info.x, /공고명: X<\/hp:t>/); assert.match(info.x, /지역: 경기도/);
  assert.equal(info.first, 'mimetype'); assert.ok(info.stored); assert.ok(info.names.includes('Contents/section0.xml'));
});

test('공고문 진행 상태와 나라장터 입찰공고번호 읽기', () => {
  assert.equal(N.statusOf({}), 'draft');
  assert.equal(N.statusOf({ lastFile: '공고문/작성/a.hwpx' }), 'done'); // 상태가 없던 예전 공고문
  assert.equal(N.statusOf({ status: 'posted' }), 'done', '예전 나라장터 등록은 작성 완료로');
  assert.deepEqual(N.parseBidNo(' r26bk01234567-000 '), { no: 'R26BK01234567', ord: '000' });
  assert.deepEqual(N.parseBidNo('R26BK01234567 1'), null);
  assert.deepEqual(N.parseBidNo('R26BK01234567 01'), { no: 'R26BK01234567', ord: '001' });
  assert.deepEqual(N.parseBidNo('R26BK01234567'), { no: 'R26BK01234567', ord: '' });
  assert.equal(N.parseBidNo('공고번호'), null);
  assert.match(N.bidByNoUrl('용역', 'R26BK01234567', 'k'), /getBidPblancListInfoServc\?serviceKey=k&inqryDiv=2&bidNtceNo=R26BK01234567/);
});

test('비슷한 공고의 실제 문장에서 배워 이번 업종·지역으로 채움, AI 질문·답', () => {
  const bids = [['용인시', ''], ['수원시', ''], ['용인시', ' 추가']].map(([r, x], i) => ({ name: 'b' + i, org: 'o', clauses: [
    { title: '입찰참가자격', text: ['가. 「전기공사업법」에 따른 전기공사업 등록업체', `나. 입찰공고일 전일부터 입찰일까지 법인등기부상 본점 소재지가 경기도 ${r}에 있는 자`, `다. 중소기업 확인서 소지자${x}`, '라. 이 공고에만 있는 특이한 조건' + i].join('\n') },
    { title: '낙찰자 결정', text: '예정가격 이하 낙찰하한율 87.745% 이상 입찰자 중 최저가 순으로 적격심사' }] }));
  const v = { 구분: '공사', 공고명: '테스트', 지역제한: '용인시', 업종제한: '「정보통신공사업법」에 따른 정보통신공사업 등록업체', 낙찰하한율: '86.745%', 낙찰자결정방법: '적격심사' };
  const ls = N.learnedSections({ bids }, v);
  assert.equal(ls.n, 3);
  assert.deepEqual(ls.입찰참가자격.map((x) => x.text), [
    '「정보통신공사업법」에 따른 정보통신공사업 등록업체',
    '입찰공고일 전일부터 입찰일까지 법인등기부상 본점 소재지가 용인시에 있는 자',
    '중소기업 확인서 소지자']); // 2건 이상이 쓴 문장만, 한 공고에만 있는 조건은 뺌
  assert.match(ls.낙찰자결정[0].text, /낙찰하한율 86\.745% 이상/);
  // 지역제한이 없는 공고면 지역 문장은 뺌
  assert.ok(!N.learnedSections({ bids }, { ...v, 지역제한: '제한 없음(전국)' }).입찰참가자격.some((x) => /소재지/.test(x.text)));
  const d = N.draft(v, { bids });
  const q = d.find((s) => /입찰참가자격/.test(s.title));
  assert.equal(q.learned, 3); assert.match(q.body, /가\. 「정보통신공사업법」/);
  assert.match(N.templateValues(v, d)['입찰참가자격'], /^가\. 「정보통신공사업법」/);
  const p = N.aiPrompt(v, { bids }, d);
  assert.match(p, /## 이번 공고 항목[\s\S]*지역제한|지역/); assert.match(p, /\[1\] b0 \(o\)/); assert.match(p, /"sections"/);
  assert.deepEqual(N.parseAi('좋습니다.\n{"sections":[{"title":"2. 입찰참가자격","body":"가. ..."}]}'), [{ title: '2. 입찰참가자격', body: '가. ...' }]);
  assert.throws(() => N.parseAi('죄송합니다'), /결과를 찾지 못했습니다/);
});

test('공고문 전체 배우기: 절 나누기 → 가장 전형적인 공고를 뼈대로 이번 값으로 바꾼 전체 초안', () => {
  const { noticeText } = require('../../demo/notice-text.js');
  const mk = (o) => ({ name: o.name, org: o.org, doc: N.parseNotice(noticeText(o)) });
  const bids = [mk({ name: '동백 체육공원 조명 교체 전기공사', org: '용인도시공사' }), mk({ name: '수지 주차장 수변전 설비 전기공사', org: '용인시 수지구', region: '경기도', rate: '86.745' }), mk({ name: '포곡 하수처리장 동력설비 전기공사', org: '용인도시공사' })];
  assert.deepEqual(bids[0].doc.sections.map((s) => s.key), ['입찰에 부치는 사항', '입찰참가자격', '공동계약', '입찰보증금', '입찰서 제출·개찰', '낙찰자 결정방법', '입찰 무효', '계약 체결', '기타']);
  // PDF처럼 끊긴 줄은 이어 붙임, 하위 번호(1. 안의 가.)는 큰 제목으로 보지 않음
  assert.deepEqual(N.mergeWrapped(['가. 입찰보증금은 입찰금액의 100분의 5 이상으로', '하며 지급각서로 갈음합니다.', '나. 다음 줄']), ['가. 입찰보증금은 입찰금액의 100분의 5 이상으로 하며 지급각서로 갈음합니다.', '나. 다음 줄']);
  const v = { 구분: '공사', 공고명: '시청사 조명 교체 전기공사', 기관명: '용인도시공사', 업종제한: '「전기공사업법」에 따른 전기공사업 등록업체', 지역제한: '용인시', 낙찰하한율: '87.745%', 연락처: '031-111-2222', 담당부서: '계약팀' };
  const d = N.draft(v, { bids });
  const text = d.map((s) => s.title + '\n' + s.body).join('\n');
  assert.ok(d.length >= 11, `절 ${d.length}개`);
  assert.match(text, /본점 소재지가 용인시에 있는 자/); assert.match(text, /낙찰하한율 87\.745% 이상/);
  assert.match(text, /입찰의 무효/); assert.match(text, /노무비 구분관리/); assert.match(text, /☎ 031-111-2222/);
  assert.doesNotMatch(text, /동백 체육공원|수지 주차장|포곡 하수처리장/, '다른 공고명이 남지 않음');
  assert.doesNotMatch(text, /2026\. 9\. 9\./, '다른 공고 일정은 빼고 이번 일정으로');
  assert.match(d.find((s) => /입찰서 제출/.test(s.title)).body, /^ {2}가\. 입찰서 제출/);
  assert.equal(d.find((s) => /입찰참가자격/.test(s.title)).learned, 3);
  // 공고문 전체가 없는 예전 기록은 문장 배우기로
  assert.equal(N.learnDocument([{ clauses: [{ title: '입찰참가자격', text: '가. 자격' }] }], v), null);
  // 기본 초안도 무효·계약 체결·기타 절까지
  assert.ok(N.draft(v).some((s) => /입찰의 무효/.test(s.title)));
  assert.match(N.templateValues(v, d)['공고문전문'], /입찰참가자격[\s\S]*계약 체결/);
});

test('복합공사(토목 + 조경): 업종제한·분담이행 공동도급 자동, 초안 공종·공동계약, 분리발주 공사 알림', () => {
  const { noticeText } = require('../../demo/notice-text.js');
  let v = N.applyRules({ ...N.blank({ insttNm: '용인도시공사', notice: { region: '용인시' } }), 공고명: '○○동 주거환경개선사업', 공종: '토목공사(종합)', 부공종: '조경공사', 추정가격: '850000000', 주공종금액: '600000000' }, {}, {});
  assert.equal(v.업종제한, '「건설산업기본법」에 따른 토목공사업과 조경공사업을 모두 등록한 자 또는 토목공사업 등록업체와 조경공사업 등록업체가 분담이행방식으로 공동수급체를 구성한 자');
  assert.equal(v.공동도급, '허용(분담이행)');
  const d = N.draft(v, { bids: [{ name: 'A 공사', org: '용인도시공사', doc: N.parseNotice(noticeText({ name: 'A 공사' })) }] });
  const t = d.map((x) => x.title + '\n' + x.body).join('\n');
  assert.match(t, /공종: 주공종 토목공사\(토목공사업\), 부공종 조경공사\(조경공사업\)/);
  assert.match(t, /주공종 추정가격: 금 600,000,000원\(부가가치세 별도\), 부공종 금 250,000,000원/);
  assert.match(t, /토목공사업과 조경공사업 등록업체로서/);
  assert.match(t, /분담이행방식으로 공동수급체를 구성하여 참가할 수 있으며/);
  assert.match(d.find((x) => /공동계약/.test(x.title)).body, /분담이행방식의 공동계약을 허용합니다/, '참고 공고의 "허용하지 않습니다"를 이번 값으로 바꿈');
  assert.doesNotMatch(t, /공동계약을 허용하지 않습니다/);
  // 부공종을 빼면 원래대로
  v = N.applyRules({ ...v, 부공종: '' }, {}, {});
  assert.equal(v.업종제한, '「건설산업기본법」에 따른 토목공사업 등록업체'); assert.equal(v.공동도급, '불허');
  // 법이 다른 공종, 분리발주 대상
  const e = { 구분: '공사', 공종: '건축공사(종합)', 부공종: '전기공사, 조경공사' };
  assert.equal(N.licensePhrase(N.worksOf(e)), '「건설산업기본법」에 따른 건축공사업과 조경공사업 및 「전기공사업법」에 따른 전기공사업');
  assert.deepEqual(N.separateIn(e), ['전기공사']);
});

test('한글 양식 그대로 채우기: 이름표·표(오른쪽/아래)·괄호 금액·A값·연락처·업종코드·지역·공고일, 글자 모양 유지', () => {
  const { templateXml } = require('../../demo/notice-text.js');
  const xml = templateXml('입찰공고');
  let v = N.applyRules({ ...N.blank({ insttNm: '가상도시공사', notice: { region: '용인시', dept: '재무관리처 계약팀', phone: '031-000-3333' } }),
    공고명: '○○동 주거환경개선사업', 공고번호: '2026 - 310', 공종: '토목공사(종합)', 부공종: '조경공사', 현장: '용인시 처인구 ○○동 일원', 기간: '착공일로부터 180일', 개요: '도로 정비',
    추정가격: '200,000,000', 기초금액: '220,000,000', 낙찰하한율: '89.745%', 입찰시작: '2026-11-02T09:00', 입찰마감: '2026-11-06T12:00', 개찰일시: '2026-11-06T13:00',
    국민건강보험료: '2,000,000', 국민연금보험료: '2,500,000', 사업부서: '도시재생팀', 사업부서연락처: '070-1234-5678', 공고일: '2026-10-30', 연락처: '031-000-3333' }, {}, {});
  const r = N.fillNoticeXml(xml, v);
  const t = r.xml.replace(/<\/hp:p>/g, '\n').replace(/<[^>]+>/g, '');
  assert.match(t, /공고 제2026 - 310호/);
  assert.match(t, /가\. 공 사 명 : ○○동 주거환경개선사업\n/); assert.match(t, /공사현장 : 용인시 처인구 ○○동 일원/); assert.match(t, /공사기간 : 착공일로부터 180일/); assert.match(t, /공사개요 : 도로 정비/);
  assert.match(t, /추정금액 : 금220,000,000원\(추정가격 금200,000,000원 \+ 부가가치세 금20,000,000원\)/);
  assert.match(t, /입찰서 제출기간 : 2026\. 11\. 2\. 09:00 ~ 2026\. 11\. 6\. 12:00까지/); assert.match(t, /개찰일시 : 2026\. 11\. 6\. 13:00 이후/);
  assert.match(t, /지역제한\(용인시\)/); assert.match(t, /본점 소재지가 용인시 관내/); assert.match(t, /낙찰하한율\(89\.745%\)/);
  assert.match(t, /\[토목공사업\(○○○○\)\], \[조경공사업\(0000\)\]/, '같은 업종 코드는 그대로, 새 업종은 ○○○○');
  assert.match(t, /설계서 열람장소 : 가상도시공사 도시재생팀 \(☏ 070-1234-5678\)/);
  assert.match(t, /계약에 관한 사항 : 재무관리처 계약팀\(☏031-000-3333\)/); assert.match(t, /공사에 관한 사항 : 가상도시공사 도시재생팀\(☏ 070-1234-5678\)/);
  assert.match(t, /감사실 031-000-9999/, '감사실 전화는 그대로');
  assert.match(t, /국민건강보험료\(금2,000,000원\), 국민연금보험료\(금2,500,000원\)/);
  assert.match(t, /2,000,000원\n2,500,000원\n○○○원/, 'A값 표: 이름 칸 아래 값, 이번 값이 없으면 ○○○');
  assert.match(t, /A값: 4,500,000원/); assert.match(t, /순공사원가[^\n]*: 금○○○원/);
  assert.match(t, /2026년 10월 30일/);
  assert.match(t, /이 입찰은 분담이행방식의 공동계약을 허용합니다/);
  // 평가대상업종 표: 공종이 둘이면 확인할 것으로
  assert.ok(r.notes.some((x) => /평가대상업종/.test(x))); assert.ok(r.notes.some((x) => /토목공사업 업종코드/.test(x)));
  assert.ok(r.notes.some((x) => /노인장기요양보험료/.test(x)) && r.notes.some((x) => /순공사원가/.test(x)));
  // 이름표 글자 조각(charPrIDRef=20)은 그대로, 값은 값 조각(21)에
  assert.match(r.xml, /<hp:run charPrIDRef="20"><hp:t>가\. 공 사 명 : <\/hp:t><\/hp:run><hp:run charPrIDRef="21"><hp:t>○○동 주거환경개선사업<\/hp:t>/);
  assert.doesNotMatch(r.xml, /linesegarray/);
  // 견적공고 종류는 계약방법으로
  assert.equal(N.noticeKind({ 계약방법: '수의계약(2인 이상 견적)' }), '견적공고'); assert.equal(N.noticeKind({ 계약방법: '제한경쟁' }), '입찰공고');
});

test('프로그램에 든 회사 기본 양식(입찰공고·견적공고): 이번 값으로 채우고 지난 공고 값·(긴급)이 남지 않음', () => {
  const { readFileSync } = require('node:fs');
  const text = (bytes) => {
    const z = CFB.read(bytes, { type: 'array' });
    return Buffer.from(z.FileIndex[z.FullPaths.findIndex((p) => /section0/.test(p))].content).toString().replace(/<\/hp:p>/g, '\n').replace(/<[^>]+>/g, '');
  };
  const base = N.blank({ insttNm: '용인도시공사', notice: { region: '용인시', dept: '재무관리처 계약팀', phone: '031-330-3972' } });
  const v = N.applyRules({ ...base, 공고명: '○○동 주거환경개선사업', 공고번호: '2026 - 310', 공종: '토목공사(종합)', 현장: '경기도 용인시 처인구 ○○동 일원', 기간: '착공일로부터 180일',
    추정가격: '184,000,000', 기초금액: '202,400,000', 입찰시작: '2026-11-02T09:00', 입찰마감: '2026-11-06T12:00', 개찰일시: '2026-11-06T13:00', 공고일: '2026-10-30' }, {}, {});
  for (const [file, kind] of [['notice-bid', '입찰공고'], ['notice-est', '견적공고']]) {
    const vv = N.applyRules({ ...v, 계약방법: kind === '견적공고' ? '수의계약(2인 이상 견적)' : '제한경쟁' }, {}, {});
    assert.equal(N.noticeKind(vv), kind);
    const r = N.fillNoticeHwpx(CFB, new Uint8Array(readFileSync(join(__dirname, '../../src/app/tpl', file + '.hwpx'))), vv, N.draft(vv));
    const t = text(r.bytes);
    assert.match(t, /공 사 명 : ○○동 주거환경개선사업/, kind);
    assert.match(t, /제2026 - 310호/, kind);
    assert.match(t, /2026\. 11\. 6\. 13:00/, kind);
    assert.doesNotMatch(t, /소방공사|소3-37호/, kind + ': 지난 공고명 없음');
    assert.doesNotMatch(t, /\(긴급\)/, kind);
  }
  const urgent = N.fillNoticeHwpx(CFB, new Uint8Array(readFileSync(join(__dirname, '../../src/app/tpl/notice-bid.hwpx'))), { ...v, 계약방법: '제한경쟁', 긴급공고: '예' }, []);
  assert.match(text(urgent.bytes), /입찰공고\(긴급\)/);
});

test('참가자격 업종 문장: 다른 공고·지난 공고문 문장 모으기(이번 업종 먼저), 골라 쓰면 한글 양식 업종 문장을 바꿈', () => {
  const { readFileSync } = require('node:fs');
  const text = (bytes) => { const z = CFB.read(bytes, { type: 'array' }); return Buffer.from(z.FileIndex[z.FullPaths.findIndex((p) => /section0/.test(p))].content).toString().replace(/<\/hp:p>/g, '\n').replace(/<[^>]+>/g, ''); };
  const doc = (lines) => N.parseNotice(['1. 입찰에 부치는 사항', '가. 공사명 : X', '2. 입찰참가자격', ...lines, '3. 입찰보증금', '가. 입찰금액의 5% 이상']);
  const bids = [
    { name: '가 공원 조경공사', price: 80000000, doc: doc(['가. 「건설산업기본법」에 따른 조경공사업을 등록한 업체', '나. 공고일 전일부터 용인시에 본점 소재지를 둔 업체']) },
    { name: '나 도로 개설공사', price: 300000000, doc: doc(['가. 건설산업기본법령에 따른 종합공사업 중 [토목공사업(0001)] 면허를 등록한 업체이어야 합니다.', '나. 하도급 업체는 전문공사업 등록 필수']) },
    { name: '다 도로 정비공사', doc: doc(['가. 건설산업기본법령에 따른 종합공사업 중 [토목공사업(0001)] 면허를 등록한 업체이어야 합니다.']) },
  ];
  const mine = [{ id: 'm1', updatedAt: Date.now(), v: { 공고명: '지난 소공원 공사', 업종문장: '[조경공사업] 및 [조경식재공사업]을 모두 등록한 업체' } }];
  const ex = N.licenseExamples({ bids }, mine, { 구분: '공사', 공종: '토목공사(종합)' }, 'self');
  assert.equal(ex[0].text, '건설산업기본법령에 따른 종합공사업 중 [토목공사업(0001)] 면허를 등록한 업체이어야 합니다.');
  assert.deepEqual(ex[0].srcs.map((x) => x.name), ['나 도로 개설공사', '다 도로 정비공사'], '같은 문장은 한 번, 쓴 공고를 모두');
  assert.ok(ex[0].match);
  assert.ok(ex.some((e) => e.srcs[0].kind === 'mine'), '지난 공고문 문장도');
  assert.ok(!ex.some((e) => /하도급/.test(e.text)), '하도급 문장은 빼기');
  // 골라 쓰기 → 견적공고(업종 문장이 따로)·입찰공고(지역과 한 문장) 모두 반영
  const base = N.blank({ insttNm: '용인도시공사', notice: { region: '용인시' } });
  const pick = '「건설산업기본법」에 따른 [토목공사업(0001)]과 [조경공사업(0006)]을 모두 등록한 업체이어야 합니다.';
  for (const [f, m] of [['notice-est', '수의계약(2인 이상 견적)'], ['notice-bid', '제한경쟁']]) {
    const v = N.applyRules({ ...base, 공고명: 'X', 공종: '토목공사(종합)', 계약방법: m, 업종문장: pick }, {}, {});
    const t = text(N.fillNoticeHwpx(CFB, new Uint8Array(readFileSync(join(__dirname, '../../src/app/tpl', f + '.hwpx'))), v, []).bytes);
    if (f === 'notice-est') assert.match(t, /1\) 「건설산업기본법」에 따른 \[토목공사업\(0001\)\]과 \[조경공사업\(0006\)\]을 모두 등록한 업체이어야 합니다\./);
    else assert.match(t, /갖추고, 「건설산업기본법」에 따른 \[토목공사업\(0001\)\]과 \[조경공사업\(0006\)\]을 모두 등록하고, 입찰공고일 전일부터 용인시 내에 주된 영업소/);
    assert.doesNotMatch(t, /소방시설공사업법에 의한/);
  }
  assert.equal(N.licClause('「전기공사업법」에 따른 전기공사업을 등록한 업체'), '「전기공사업법」에 따른 전기공사업을 등록하고');
});

test('공고마다 다른 문장 고르기: 주제별 문장 모으기, 고르면 초안·한글 양식 같은 자리에 들어감', () => {
  const { readFileSync } = require('node:fs');
  const text = (bytes) => { const z = CFB.read(bytes, { type: 'array' }); return Buffer.from(z.FileIndex[z.FullPaths.findIndex((p) => /section0/.test(p))].content).toString().replace(/<\/hp:p>/g, '\n').replace(/<[^>]+>/g, ''); };
  const doc = (q, j) => N.parseNotice(['1. 입찰에 부치는 사항', '가. 용역명 : X', '2. 입찰참가자격', ...q, '3. 공동계약', j, '4. 기타', '가. 기타 사항은 관계 법령에 따릅니다.']);
  const bids = [
    { name: '가시 폐기물 처리 용역', org: '가시', doc: doc(['가. 「폐기물관리법」에 따른 폐기물 수집·운반업 허가를 받은 업체', '나. 공고일 전일부터 경기도에 본점 소재지를 둔 업체'], '가. 공동도급은 허용하지 않습니다.') },
    { name: '나시 생활폐기물 용역', org: '나시', doc: doc(['가. 「폐기물관리법」에 따른 폐기물 수집·운반업(생활폐기물) 허가를 받은 업체'], '가. 공동이행방식에 의한 공동도급을 허용합니다.') },
  ];
  const v = N.applyRules({ ...N.blank({}), 구분: '용역', 공종: '생활폐기물 수집·운반', 지역제한: '용인시' }, {}, {});
  const ts = N.topicVariants({ bids }, [], v, 'x');
  const up = ts.find((t) => t.key === '업종'), jt = ts.find((t) => t.key === '공동도급'), rg = ts.find((t) => t.key === '지역');
  assert.equal(up.variants.length, 2, '업종 문장 2가지(다른 기관 공고)');
  assert.match(up.variants[0].text, /폐기물 수집·운반업/);
  assert.equal(jt.variants.length, 2);
  assert.match(rg.variants[0].shown, /용인시/, '지역 문장은 이번 지역으로 바꿔 보여 줌');
  assert.ok(N.WORK_TYPES.용역.some((w) => w.name === '생활폐기물 수집·운반'));
  // 고른 문장 → 초안
  const v2 = { ...v, 업종문장: up.variants[1].text, 고른문장: { 공동도급: jt.variants[1].shown } };
  const body = N.draft(v2).map((x) => x.body).join('\n');
  assert.match(body, /생활폐기물\) 허가를 받은 업체/);
  assert.match(body, /공동이행방식에 의한 공동도급을 허용합니다/);
  // 고른 문장 → 한글 양식(견적공고의 "본 계약은 공동수급 및 하도급을 불허합니다." 자리)
  const vh = N.applyRules({ ...N.blank({}), 구분: '공사', 공종: '토목공사(종합)', 계약방법: '수의계약(2인 이상 견적)', 고른문장: { 공동도급: '본 계약은 공동수급을 허용(분담이행)하고 하도급은 불허합니다.' } }, {}, {});
  const t = text(N.fillNoticeHwpx(CFB, new Uint8Array(readFileSync(join(__dirname, '../../src/app/tpl/notice-est.hwpx'))), vh, []).bytes);
  assert.match(t, /라\. 본 계약은 공동수급을 허용\(분담이행\)하고 하도급은 불허합니다\./);
  assert.doesNotMatch(t, /공동수급 및 하도급을 불허/);
});

test('다른 기관 공고 문장은 우리 것으로: 기관명·관내 지역·홈페이지', () => {
  const v = { 기관명: '용인도시공사', 지역제한: '용인시', 공고명: '이번 공고' };
  const b = { org: '전북특별자치도 익산시', name: '익산시 생활폐기물 수집운반 용역' };
  assert.equal(N.localize('익산시장은 입찰참가자격을 확인합니다.', b, v), '용인도시공사는 입찰참가자격을 확인합니다.');
  assert.equal(N.localize('공고일 전일부터 익산시 관내에 본점 소재지를 둔 업체', b, v), '공고일 전일부터 용인시 관내에 본점 소재지를 둔 업체');
  assert.equal(N.localize('익산시 홈페이지(www.iksan.go.kr) 참조, 나라장터(www.g2b.go.kr)', b, v), '용인도시공사 홈페이지(○○) 참조, 나라장터(www.g2b.go.kr)');
  assert.equal(N.localize('용인도시공사 홈페이지(www.yuc.co.kr)', { org: '용인도시공사' }, v), '용인도시공사 홈페이지(www.yuc.co.kr)', '우리 공고는 그대로');
  // 전체 초안(다른 기관 공고가 뼈대)에서도
  const doc = N.parseNotice(['1. 입찰에 부치는 사항', '가. 용역명 : 익산시 생활폐기물 수집운반 용역', '2. 입찰참가자격', '가. 공고일 전일부터 익산시 관내에 본점 소재지를 둔 업체', '3. 계약 체결', '가. 낙찰자는 익산시청 회계과에서 계약을 체결합니다.', '4. 기타', '가. 기타 사항은 익산시 계약 규정에 따릅니다.']);
  const body = N.draft({ ...N.blank({}), ...v, 구분: '용역' }, { bids: [{ ...b, doc }] }).map((x) => x.body).join('\n');
  assert.doesNotMatch(body, /익산/);
  assert.match(body, /용인도시공사 회계과에서 계약을 체결/);
});

test('배운 초안의 설계서 열람장소·문의 줄은 이번 공고 부서·연락처로', () => {
  const v = { 기관명: '용인도시공사', 담당부서: '재무관리처 계약팀', 연락처: '031-330-3972', 사업부서: '건설사업1팀', 사업부서연락처: '070-8833-1935' };
  assert.equal(N.ourContacts('설계서 열람장소 : 익산시 도로과(☎ 063-859-0000)', v), '설계서 열람장소 : 용인도시공사 건설사업1팀 (☎ 070-8833-1935)');
  assert.equal(N.ourContacts('- 계약에 관한 사항 : 회계과(063-859-1111)', v), '- 계약에 관한 사항 : 재무관리처 계약팀 (☎ 031-330-3972)');
  assert.equal(N.ourContacts('- 공사에 관한 사항 : 도로과', { ...v, 사업부서: '' }), '- 공사에 관한 사항 : ○○(사업부서)');
  assert.equal(N.ourContacts('입찰은 전자입찰로 합니다.', v), '입찰은 전자입찰로 합니다.');
  assert.ok(N.WORK_TYPES.용역.length >= 30 && new Set(N.WORK_TYPES.용역.map((w) => w.g)).size >= 4, '용역 공종 묶음별');
  assert.equal(N.licenseSentence([N.workType('용역', '생활폐기물 수집·운반')]), '「폐기물관리법」에 따른 폐기물수집·운반업(생활폐기물) 허가업체');
});
