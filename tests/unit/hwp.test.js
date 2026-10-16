// 한글 본문 읽기·공고문 문장 뽑기 단위 시험
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const CFB = require('cfb');
const H = require('../../src/app/js/hwp.js');
const N = require('../../src/app/js/notice-logic.js');

// 문단 글자 레코드(태그 67) 만들기: 표 같은 개체 제어문자(8칸)도 섞음
function paraRecord(text, withCtrl) {
  const parts = [];
  if (withCtrl) { const c = Buffer.alloc(16); c.writeUInt16LE(11, 0); parts.push(c); } // 개체(8칸)
  parts.push(Buffer.from(text, 'utf16le'));
  const end = Buffer.alloc(2); end.writeUInt16LE(13, 0); parts.push(end); // 문단 끝
  const body = Buffer.concat(parts);
  const h = Buffer.alloc(4); h.writeUInt32LE(67 | (0 << 10) | (body.length << 20), 0);
  return Buffer.concat([h, body]);
}
function makeHwp(paras, { compressed = true, locked = false } = {}) {
  const z = CFB.utils.cfb_new();
  const fh = Buffer.alloc(256); fh.write('HWP Document File'); fh[36] = (compressed ? 1 : 0) | (locked ? 2 : 0);
  CFB.utils.cfb_add(z, '/FileHeader', fh);
  CFB.utils.cfb_add(z, '/PrvText', Buffer.from('미리보기만<표>', 'utf16le'));
  const other = Buffer.alloc(8); other.writeUInt32LE(66 | (4 << 20), 0); // 다른 레코드(문단 머리)
  const raw = Buffer.concat([other, ...paras.map((p, i) => paraRecord(p, i === 1))]);
  CFB.utils.cfb_add(z, '/BodyText/Section0', compressed ? zlib.deflateRawSync(raw) : raw);
  return new Uint8Array(CFB.write(z, { type: 'buffer' }));
}

test('HWP 본문 전체 읽기(압축·제어문자 처리)', async () => {
  const lines = await H.fullLines(CFB, makeHwp(['용인도시공사 공고 제2026-101호', '2. 입찰참가자격', '가. 「전기공사업법」에 따른 전기공사업 등록업체']));
  assert.deepEqual(lines, ['용인도시공사 공고 제2026-101호', '2. 입찰참가자격', '가. 「전기공사업법」에 따른 전기공사업 등록업체']);
  assert.deepEqual(await H.fullLines(CFB, makeHwp(['압축 안 함'], { compressed: false })), ['압축 안 함']);
  assert.deepEqual(await H.fullLines(CFB, makeHwp(['비밀'], { locked: true })), ['미리보기만 표'], '암호 문서는 미리보기');
});

test('공고문에서 쓸 문장 뽑기', () => {
  const lines = ['「신갈오거리 보도 정비공사」 입찰 공고', '1. 입찰에 부치는 사항', '가. 공사명: 신갈오거리 보도 정비공사',
    '2. 입찰참가자격', '가. 「건설산업기본법」에 따른 지반조성·포장공사업 등록업체', '나. 입찰공고일 전일부터 입찰일까지 법인등기부상 본점 소재지가 경기도 용인시에 있는 자',
    '다. 공동도급은 허용하지 않습니다', '3. 낙찰자 결정방법', '예정가격 이하 낙찰하한율 87.745% 이상 최저가 순 적격심사', '4. 입찰보증금: 입찰금액의 100분의 5 이상'];
  const c = N.extractClauses(lines);
  const q = c.find((x) => x.title === '입찰참가자격');
  assert.ok(q && /지반조성·포장공사업/.test(q.text) && /용인시/.test(q.text) && !/낙찰하한율/.test(q.text));
  assert.ok(c.some((x) => x.title === '낙찰자 결정' && /87\.745/.test(x.text)));
  assert.ok(c.some((x) => x.title === '입찰보증금'));
});

test('첨부 목록: 공고문 한글·PDF를 앞으로', () => {
  const f = N.attachmentsOf({ ntceSpecDocUrl1: 'u1', ntceSpecFileNm1: '설계내역서.xlsx', ntceSpecDocUrl2: 'u2', ntceSpecFileNm2: '입찰공고문.hwp', ntceSpecDocUrl3: 'u3', ntceSpecFileNm3: '도면.pdf' });
  assert.equal(f[0].name, '입찰공고문.hwp');
});
