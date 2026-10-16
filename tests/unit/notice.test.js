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
  assert.match(all, /6\. 상생결제\n  해당 없음/);
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
