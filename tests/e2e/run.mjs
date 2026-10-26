// 통합 시험: 실제 연결 창구(server.ps1) + 페이지
//  처음 화면 → 지출서류(불러오기·서류 넣기·원본·PDF 저장·미분류) → 폴더 옮김 인식 → 공고문(배우기·첨부 읽기·초안·한글 양식)
// 나라장터·첨부파일은 시험용 응답으로 대신함(브라우저의 /api/nara, /api/fetchfile 요청을 가로챔)
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync, renameSync, copyFileSync, rmSync, statSync, utimesSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PDFDocument } = require('pdf-lib');
const CFB = require('cfb');
const zlib = require('node:zlib');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PROG = join(ROOT, 'program');
const PWSH = process.env.PWSH || '/opt/pwsh/pwsh';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SHOTS = join(ROOT, 'tests/e2e/screens'); mkdirSync(SHOTS, { recursive: true });
const DOCS = join(ROOT, 'tests/fixtures/docs');

// 가짜 사용자 폴더(바탕화면·문서) — 데이터 폴더 옮김 찾기 시험용
const HOME = mkdtempSync(join(tmpdir(), 'jh-home-'));
for (const d of ['Desktop', 'Documents', 'Downloads']) mkdirSync(join(HOME, d), { recursive: true });
let data = join(HOME, 'Desktop', '계약업무도우미');
mkdirSync(data, { recursive: true });
rmSync(join(PROG, 'local.json'), { force: true }); rmSync(join(PROG, 'running.json'), { force: true });
writeFileSync(join(PROG, 'local.json'), JSON.stringify({ dataDir: data }));
// 동료가 처음 설치한 상태: 인증키·기관명은 묶음의 기관 공용 설정(org.json), 개인 설정은 상생결제 기준만
writeFileSync(join(data, '설정.json'), JSON.stringify({ notice: { winwinMin: 50000000 } }));

let srv, run, base;
const waitFor = async (fn, ms = 20000, what = '') => { const t = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch (_) {} if (Date.now() - t > ms) throw new Error('시간 초과: ' + what); await new Promise((r) => setTimeout(r, 200)); } };
async function startServer() {
  rmSync(join(PROG, 'running.json'), { force: true });
  srv = spawn(PWSH, ['-NoProfile', '-File', join(PROG, 'server.ps1'), '-NoBrowser', '-SkipAi', '-Port', '18890'], { stdio: 'inherit', env: { ...process.env, HOME } });
  run = await waitFor(() => existsSync(join(PROG, 'running.json')) && JSON.parse(readFileSync(join(PROG, 'running.json'), 'utf8')), 60000, '연결 창구 시작');
  base = `http://127.0.0.1:${run.port}/`;
}
async function stopServer() {
  try { await fetch(base + 'api/quit', { method: 'POST', headers: { 'X-JH-Token': run.token } }); } catch (_) {}
  await waitFor(() => !existsSync(join(PROG, 'running.json')), 10000, '연결 창구 종료');
}

// 시험용 나라장터 응답
const api = (items) => JSON.stringify({ response: { header: { resultCode: '00', resultMsg: '정상' }, body: { items, numOfRows: 100, pageNo: 1, totalCount: items.length } } });
const 공사 = [
  { untyCntrctNo: 'R26BK01234567', dcsnCntrctNo: 'R26BK01234567-00', cnstwkNm: '시청사 옥상 방수공사', corpList: '[1^주계약업체^단독^(주)다해토건^홍길동^대한민국^100^(주)다해토건^^1234567890]', totCntrctAmt: '48000000', cntrctCnclsDate: '2026-05-28', cbgnDate: '2026-06-01', ttalCcmpltDate: '2026-10-10', cntrctCnclsMthdNm: '수의계약', baseLawNm: '지방계약법 (제25조제1항5호가목)', baseDtls: '추정가격 2억원 이하 종합공사', chgDt: '2026-10-08 10:00:00', cntrctInsttNm: '용인도시공사', cntrctInsttOfclNm: '박주호', cntrctInsttChrgDeptNm: '계약팀' },
  { untyCntrctNo: 'R26BK05555555', dcsnCntrctNo: 'R26BK05555555-00', cnstwkNm: '처인구 공영주차장 전기설비 교체', corpList: '[1^주계약업체^단독^대한전기(주)^이몽룡^대한민국^100^대한전기(주)^^2223334445]', totCntrctAmt: '73500000', ttalCcmpltDate: '2026-12-20', cntrctInsttNm: '용인도시공사', cntrctInsttOfclNm: '김철수' },
];
const 용역 = [
  { untyCntrctNo: 'R26BS07654321', dcsnCntrctNo: 'R26BS07654321-00', cntrctNm: '체육관 시설 청소 용역', corpList: '[1^주계약업체^단독^한빛환경 주식회사^김영희^대한민국^100^한빛환경 주식회사^^5556667778]', totCntrctAmt: '21500000', cntrctCnclsDate: '2026-06-26', cntrctCnclsMthdNm: '수의계약', baseLawNm: '지방계약법 (제25조제1항5호나목)', wbgnDate: '2026-07-01', ttalScmpltDate: '2026-12-31', cntrctInsttNm: '용인도시공사', cntrctInsttOfclNm: '박주호', baseDtls: '외부재정연계(e나라도움)' },
];
const bid = (no, name, price, rate, extra = {}) => ({ bidNtceNo: no, bidNtceOrd: '000', bidNtceNm: name, ntceInsttNm: '용인도시공사', bidNtceDt: '2026-09-01 10:00:00',
  bidBeginDt: '2026-09-02 10:00:00', bidClseDt: '2026-09-09 10:00:00', opengDt: '2026-09-09 11:00:00', presmptPrce: String(price), sucsfbidLwltRate: rate,
  sucsfbidMthdNm: '적격심사', cntrctCnclsMthdNm: '제한경쟁', ntceSpecDocUrl1: `https://www.g2b.go.kr/file/${no}`, ntceSpecFileNm1: '입찰공고문.hwp', ...extra });
const BIDS = [bid('R26BK00000001', '신갈오거리 보안등 정비 전기공사', 31000000, '87.745'), bid('R26BK00000002', '동백 체육공원 조명 교체 전기공사', 45000000, '87.745'),
  bid('R26BK00000003', '수지 주차장 수변전 설비 전기공사', 60000000, '86.745')];
const REGIONS = { R26BK00000001: ['경기도 용인시'], R26BK00000002: ['경기도 용인시'], R26BK00000003: ['경기도'] };
function hwpBytes(lines) {
  const rec = (t) => { const body = Buffer.concat([Buffer.from(t, 'utf16le'), Buffer.from([13, 0])]); const h = Buffer.alloc(4); h.writeUInt32LE(67 | (body.length << 20), 0); return Buffer.concat([h, body]); };
  const z = CFB.utils.cfb_new(); const fh = Buffer.alloc(256); fh.write('HWP Document File'); fh[36] = 1;
  CFB.utils.cfb_add(z, '/FileHeader', fh); CFB.utils.cfb_add(z, '/BodyText/Section0', zlib.deflateRawSync(Buffer.concat(lines.map(rec))));
  return Buffer.from(CFB.write(z, { type: 'buffer' }));
}
const { noticeText } = require('../../demo/notice-text.js');
// 첨부 공고문: 공고마다 지역·하한율을 바꾼 공고문 전문(HWP 본문)
const attachFor = (url) => { const no = (String(url).match(/R26BK\d+/) || [''])[0]; const b = BIDS.find((x) => x.bidNtceNo === no) || BIDS[0];
  return hwpBytes(noticeText({ name: b.bidNtceNm, org: b.ntceInsttNm, region: (REGIONS[b.bidNtceNo] || ['경기도 용인시'])[0], rate: b.sucsfbidLwltRate })); };
// 한글 양식(HWPX): {{항목}}이 서식 경계로 쪼개진 것 포함
function hwpxTemplate() {
  const sec = '<?xml version="1.0" encoding="UTF-8"?><hs:sec xmlns:hs="s" xmlns:hp="p"><hp:p><hp:run><hp:t>{{기관명}} 공고 제{{공고번호}}호</hp:t></hp:run></hp:p>' +
    '<hp:p><hp:run><hp:t>「{{공</hp:t></hp:run><hp:run charPrIDRef="3"><hp:t>고명}}」 입찰 공고</hp:t></hp:run></hp:p><hp:p><hp:run><hp:t>추정가격 {{추정가격}}원, 지역 {{지역제한}}, 하한율 {{낙찰하한율}}</hp:t></hp:run></hp:p></hs:sec>';
  const z = CFB.utils.cfb_new();
  CFB.utils.cfb_add(z, '/mimetype', Buffer.from('application/hwp+zip'));
  CFB.utils.cfb_add(z, '/Contents/section0.xml', Buffer.from(sec));
  const f = join(HOME, '공고문양식.hwpx'); writeFileSync(f, CFB.write(z, { type: 'buffer', fileType: 'zip' })); return f;
}

const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 920 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
const errors = [];
const draftText = () => page.$$eval('.draft textarea.dbody', (ts) => ts.map((t) => t.value).join('\n'));
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
// 실패한 요청은 주소로 판단: 한글 변환·한글 양식 채우기는 시험 PC에 한글이 없어 실패가 정상(대체 방법으로 처리됨)
page.on('response', (r) => { if (r.status() >= 500 && !/\/api\/(hwp2pdf|hwpfill|hwpconvert|office2pdf|open|law|myip)/.test(r.url())) errors.push(`${r.status()} ${r.url()}`); }); // 시험 환경엔 인터넷이 없어 국가법령정보센터 실제 조회는 502
await page.route('**/api/nara**', (r) => {
  const u = decodeURIComponent(new URL(r.request().url()).searchParams.get('u'));
  let body;
  if (/getBidPblancListInfoCnstwk\?.*bidNtceNo=/.test(u)) body = api(u.includes('R26BK09999999') ? [bid('R26BK09999999', '신갈오거리 보안등 정비 전기공사', 32000000, '87.745', { opengDt: '2026-10-28 11:00:00' })] : []);
  else if (u.includes('PrtcptPsblRgn')) { const no = u.match(/bidNtceNo=([^&]+)/)[1]; body = api((REGIONS[no] || []).map((n) => ({ prtcptPsblRgnNm: n }))); }
  else if (u.includes('LicenseLimit')) body = api([{ lcnsLmtNm: '전기공사업' }]);
  else if (u.includes('BidPublicInfoService')) body = api(u.includes('bidNtceNm=') ? BIDS.filter((b) => b.bidNtceNm.includes(decodeURIComponent(u.match(/bidNtceNm=([^&]+)/)[1]).replace(/\+/g, ' '))) : BIDS);
  else if (u.includes('ChgHstry')) body = api(u.includes('R26BK01234567') ? [
    { dcsnCntrctNo: 'R26BK01234567-00', totCntrctAmt: '48000000', cntrctCnclsDate: '2026-05-28', ttalCcmpltDate: '2026-09-30' },
    { dcsnCntrctNo: 'R26BK01234567-01', totCntrctAmt: '48000000', cntrctDate: '2026-09-20', ttalCcmpltDate: '2026-10-10' },
    { dcsnCntrctNo: 'R26BK01234567-02', totCntrctAmt: '47139000', cntrctDate: '2026-10-08', ttalCcmpltDate: '2026-10-10' }] : []);
  else if (u.includes('UsrInfoService02')) body = api(u.includes('1234567890') ? [{ bizno: '1234567890', corpNm: '(주)다해토건', ceoNm: '홍길동', adrs: '경기도 용인시 처인구 중부대로', dtlAdrs: '1199' }] : []);
  else if (/ScsbidInfoService|Thng/.test(u)) body = api([]);
  else body = api(u.includes('Cnstwk') ? 공사 : 용역);
  r.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body });
});
await page.route('**/api/fetchfile**', (r) => r.fulfill({ status: 200, contentType: 'application/octet-stream', body: attachFor(new URL(r.request().url()).searchParams.get('u')) }));
let ok = 0; const step = (m) => { ok++; console.log('  ✓ ' + m); };

try {
  await startServer();
  await page.goto(base);
  // 첫 실행 안내: 이름·부서·연락처만 넣으면 공용 인증키로 바로 불러옴
  await page.waitForSelector('#dlgWelcome[open]');
  await page.screenshot({ path: join(SHOTS, '00-첫실행.png') });
  await page.fill('#wName', '박주호'); await page.fill('#wDept', '계약팀'); await page.fill('#wPhone', '031-324-0000');
  await page.click('#wSave');
  await waitFor(() => page.evaluate(() => Object.keys(JH.app.db.contracts).length === 3), 20000, '계약 불러오기');
  const saved = JSON.parse(readFileSync(join(data, '설정.json'), 'utf8'));
  assert.equal(saved.officer, '박주호'); assert.ok(!('apiKey' in saved), '공용 인증키는 개인 설정에 복사하지 않음');
  step('첫 실행: 이름만 넣으면 기관 공용 인증키로 내 담당 계약 자동 불러오기(개인 파일엔 키 저장 안 함)');
  // 아래 시험들은 '헷갈리는 것만 묻기'로 진행(올릴 때마다 확인은 따로 시험)
  await page.evaluate(async () => { JH.app.cfg.uploadConfirm = false; JH.app.cfg.watchConfirm = false; await JH.app.saveCfg(); });
  await waitFor(async () => /박주호님/.test(await page.textContent('#homeTitle')), 10000, '처음 화면 인사');
  await page.screenshot({ path: join(SHOTS, '0-처음화면.png') });
  step('처음 화면: 지출서류 정리 / 공고문 작성 두 갈래');

  // ===== 지출서류 =====
  await page.click('.door[data-view="contracts"]');
  assert.equal(await page.$eval('#fOfficer', (s) => s.value), '박주호');
  assert.equal(await page.$$eval('.citem', (e) => e.length), 2);
  // 다시 불러오기는 지난번 이후 달만(조회 횟수 절약)
  await page.waitForSelector('#btnFetch:not([disabled])', { timeout: 120000 }); // 첫 불러오기가 끝나야 새로고침 가능(중복 실행 막음)
  assert.match(await page.textContent('#listCount'), /나라장터 \d\d\.\d\d \d\d:\d\d 기준/);
  let calls = 0; page.on('request', (r) => { if (r.url().includes('/api/nara')) calls++; });
  await page.click('#btnFetch');
  await waitFor(() => page.$('.toast:has-text("나라장터 계약")'), 20000, '다시 불러오기');
  assert.ok(calls <= 3, `다시 불러올 때 조회 ${calls}번`); // 공사·용역·물품 한 번씩, 세부 정보는 바뀐 계약만
  step(`나라장터 계약 3건 → 내 담당 2건, 다시 불러오기는 조회 ${calls}번만`);

  await page.setInputFiles('#fileIn', readdirSync(DOCS).map((f) => join(DOCS, f)));
  await waitFor(() => page.evaluate(() => JH.app.db.docs.length === 11), 120000, '서류 정리');
  const docs = await page.evaluate(() => JH.app.db.docs.map((d) => ({ name: d.name, key: d.key, item: d.itemId })));
  const want = { 'noname.pdf': 'c-contract', 'noname(1).pdf': 'c-estimate', 'noname(2).pdf': 'c-inspaid', 'noname(3).pdf': 'c-tax', 'noname(4).pdf': 's-contract',
    'noname(5).pdf': 's-claim', 'noname(6).pdf': null, 'noname(7).pdf': 'c-start', 'noname(8).jpg': 'c-photo', 'noname(9).hwp': 'c-finish', 'noname(10).hwpx': 's-start' };
  const wrong = docs.filter((d) => d.item !== want[d.name]);
  assert.equal(wrong.length, 0, JSON.stringify(wrong));
  // 헷갈린 서류(회의록)는 팝업으로 바로 보여 주고 맞게 고르게 함 — 파일을 따로 열지 않고 창 안에서 미리 보기
  await page.waitForSelector('#dlgPreview[open]', { timeout: 10000 });
  assert.match(await page.textContent('#pvTitle'), /맞는지 확인해 주세요 \(1\/1\)/);
  assert.match(await page.textContent('#pvName'), /noname\(6\)\.pdf/);
  await page.waitForSelector('#pvBody canvas', { timeout: 20000 }); await page.screenshot({ path: join(SHOTS, '2b-미리보기.png') });
  assert.equal(await page.inputValue('#pvContract'), '', '미분류');
  // 계약 고르기를 타자로 찾기: '방수' → 시청사 옥상 방수공사, 서류 종류 목록도 그 계약 것으로
  await page.fill('#pvSearch', '방수');
  assert.match(await page.evaluate(() => { const s = document.getElementById('pvContract'); return s.options[s.selectedIndex].text; }), /시청사 옥상 방수공사/);
  assert.ok(!(await page.$eval('#pvItem', (x) => x.disabled)), '서류 종류 고를 수 있음');
  // 설정에서 뺀 담당자의 계약은 고르기 목록에 안 나옴
  const hid = await page.evaluate(() => { JH.app.db.contracts.tmpother = { key: 'tmpother', name: '다른 담당 임시 계약', type: '공사', officer: '다른담당', originals: {}, updatedAt: 1 }; JH.app.cfg.hideOfficers = ['다른담당']; return 'tmpother'; });
  await page.fill('#pvSearch', ''); await page.click('#pvNext'); await page.waitForSelector('#dlgPreview:not([open])', { state: 'attached' });
  await page.click('.views [data-view="inbox"]');
  assert.ok(!(await page.$(`#view-inbox select[data-act="assign"] option[value="${hid}"]`)), '뺀 담당자 계약은 고르기에 없음');
  assert.ok(await page.$('#view-inbox .cpick-q') && await page.$('#view-inbox [data-act="del"]:has-text("버리기")'), '미분류: 타자로 찾기·버리기');
  await page.evaluate(() => { JH.app.cfg.hideOfficers = []; delete JH.app.db.contracts.tmpother; });
  await page.click('.views [data-view="contracts"]');
  if (false) await page.click('#pvNext'); // 그대로 두고 닫기
  step('noname 11개 자동 분류(스캔·한글 포함), 회의록만 미분류 → 팝업으로 미리 보며 확인');

  await page.click('.citem:has-text("시청사 옥상 방수공사")');
  await page.check('input[data-act="orig"][data-item="c-laborconfirm"]');
  await page.click('button[data-act="save"]');
  await waitFor(() => page.$('.toast:has-text("PDF로 저장했습니다")'), 60000, 'PDF 저장');
  const folderA = readdirSync(join(data, '계약')).find((d) => d.includes('시청사'));
  const pdf = await PDFDocument.load(readFileSync(join(data, '계약', folderA, '인쇄본', readdirSync(join(data, '계약', folderA, '인쇄본'))[0])));
  assert.equal(pdf.getPageCount(), 10, '표지 2쪽(서류 목록이 늘어 목록표가 2쪽)·서류·원본 자리·한글 자리');
  step('원본 체크 + 한 번에 PDF 10쪽(표지·원본 자리·한글 자리)');

  // ===== 폴더를 사람이 옮긴 경우 =====
  await stopServer();
  // 1) 계약 폴더 이름 바꾸기 + 탐색기로 파일 직접 넣기
  renameSync(join(data, '계약', folderA), join(data, '계약', '방수공사(이름 바꿈)'));
  copyFileSync(join(DOCS, 'noname(3).pdf'), join(data, '계약', '방수공사(이름 바꿈)', '지방세_직접넣음.pdf'));
  // 1-2) 예전 버전 서류대장(서류 본문이 안에 들어 있고 줄 바꿈이 있는 형식) + 새 형식 파일은 없음 → 그대로 읽히고 본문 파일로 나뉘는지
  {
    const ledger = JSON.parse(readFileSync(join(data, '서류대장.json'), 'utf8')), texts = JSON.parse(readFileSync(join(data, '서류본문.json'), 'utf8'));
    assert.ok(!ledger.docs.some((d) => 'text' in d) && Object.keys(texts).length >= 5, '서류대장에는 본문 없음, 본문은 따로');
    ledger.docs.forEach((d) => { if (texts[d.id]) d.text = texts[d.id]; });
    // 1-3) 예전 버전이 차수(-01)를 다른 계약으로 만들어 둔 상태(서류 하나 딸림) → 켤 때 하나로 합쳐지는지
    const a = Object.values(ledger.contracts).find((x) => x.name === '시청사 옥상 방수공사');
    ledger.contracts['r26bk0123456701'] = { ...a, key: 'r26bk0123456701', nums: ['R26BK0123456701'], no: 'R26BK0123456701', ord: 1, amount: 48000000, endDate: '2026-10-10', period: '2026-06-01 ~ 2026-10-10(1차 변경)', originals: {}, received: { 'c-photo': true }, edited: {}, memo: { note: '차수 계약의 메모' }, g2b: null, ords: null };
    ledger.docs.push({ id: 'dup-doc', key: 'r26bk0123456701', itemId: 'c-nounpaid', path: '계약/없는폴더/미체불확약서.pdf', name: '미체불확약서.pdf', kind: 'pdf', size: 1, addedAt: new Date().toISOString(), title: '노무비 미체불 확약서', missing: true });
    writeFileSync(join(data, '서류대장.json'), JSON.stringify(ledger, null, 1)); rmSync(join(data, '서류본문.json'));
  }
  // 2) 데이터 폴더를 바탕화면 → 문서\보관\ 으로 통째로 옮기기
  const moved = join(HOME, 'Documents', '보관', '계약업무도우미');
  mkdirSync(dirname(moved), { recursive: true });
  renameSync(data, moved); data = moved;
  // 자동으로 읽을 폴더(내려받는 곳)도 이 PC 설정에 둠
  const WATCH = join(HOME, 'Downloads', '계약서류'); mkdirSync(WATCH, { recursive: true });
  const WATCH2 = join(HOME, 'Documents', '메일첨부'); mkdirSync(WATCH2, { recursive: true });
  writeFileSync(join(PROG, 'local.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(PROG, 'local.json'), 'utf8')), watchDirs: [WATCH, WATCH2] }));
  await startServer();
  await page.goto(base);
  await waitFor(() => page.$('.toast:has-text("데이터 폴더가 옮겨진 것을 찾았습니다")'), 30000, '데이터 폴더 다시 찾기');
  // 켜자마자: 처음 화면에 연결 상태(나라장터·법령 OC·PC AI) 한 줄씩 + 자동 새로고침(하루 세 번 중 첫 번째)
  await waitFor(async () => /나라장터 연결됨/.test(await page.textContent('#acctLine')), 20000, '연결 상태');
  assert.match(await page.textContent('#acctLine'), /법령/);
  await waitFor(() => page.$('.toast:has-text("자동 새로고침")'), 20000, '켜자마자 자동 새로고침');
  await waitFor(() => page.evaluate(() => JH.app.cfg.autoDone && JH.app.cfg.autoDone.slots.length === 1), 10000, '자동 새로고침 기록');
  await waitFor(() => page.evaluate(() => JH.app.db.docs.length === 13), 60000, '직접 넣은 파일 읽기');
  const st = await page.evaluate(() => {
    const c = Object.values(JH.app.db.contracts).find((x) => x.name === '시청사 옥상 방수공사');
    const ds = JH.app.db.docs.filter((d) => d.key === c.key);
    return { folder: c.folder, missing: JH.app.db.docs.filter((d) => d.missing && d.id !== 'dup-doc').length, extra: ds.find((d) => d.name === '지방세_직접넣음.pdf'), n: ds.length };
  });
  assert.equal(st.folder, '계약/방수공사(이름 바꿈)'); assert.equal(st.missing, 0);
  assert.ok(await page.evaluate(() => JH.app.db.docs.filter((d) => d.text && d.text.length > 50).length >= 5), '예전 형식 서류대장의 본문도 그대로');
  // 차수만 다른 계약 자동 합침: 서류·받음·메모가 옮겨 오고 금액·준공일은 최신 차수
  const mg = await page.evaluate(() => { const c = Object.values(JH.app.db.contracts).find((x) => x.name === '시청사 옥상 방수공사'); return { n: Object.values(JH.app.db.contracts).filter((x) => x.name === '시청사 옥상 방수공사').length, dup: !!JH.app.db.contracts.r26bk0123456701, doc: (JH.app.db.docs.find((d) => d.id === 'dup-doc') || {}).key === c.key, photo: !!(c.received || {})['c-photo'], note: (c.memo || {}).note, amount: c.amount, end: c.endDate, nums: c.nums, period: c.period }; });
  assert.equal(mg.n, 1); assert.ok(!mg.dup); assert.ok(mg.doc, '딸린 서류가 옮겨 옴'); assert.ok(mg.photo, '받음 표시 옮겨 옴'); assert.equal(mg.note, '차수 계약의 메모');
  assert.equal(mg.amount, 48000000); assert.match(mg.end, /2026-?10-?10/); assert.ok(mg.nums.includes('R26BK0123456701')); assert.equal(mg.period, '2026-06-01 ~ 2026-10-10(1차 변경)', '최신 차수 값');
  // 합친 뒤 변경 차수 표: 원계약(-00) 값과 1차 변경 값이 둘 다 남아 설계변경·기간연장 기본값이 매겨짐
  await page.evaluate(() => JH.app.setView('contracts'));
  await page.waitForFunction(() => document.querySelector('#dlgPreview').open || JH.app.db.docs.some((d) => d.name === '지방세_직접넣음.pdf'), null, { timeout: 30000 }); await page.waitForTimeout(800);
  const revWhy = await page.evaluate(() => (document.querySelector('#dlgPreview').open ? document.querySelector('#pvWhy').textContent : ''));
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  await page.click('.citem:has-text("시청사 옥상 방수공사") >> nth=0');
  if (!(await page.$('details.audit[open]'))) await page.click('details.audit summary');
  assert.equal(await page.locator('.chgtbl tbody tr').count(), 3, '변경 차수 표 3줄(원계약·1차·2차)');
  await page.click('details.audit summary'); // 뒤 시험이 다시 펼침
  await waitFor(() => existsSync(join(data, '서류본문.json')) && !JSON.parse(readFileSync(join(data, '서류대장.json'), 'utf8')).docs.some((d) => 'text' in d), 20000, '본문을 따로 떼어 저장');
  assert.ok(st.extra && st.extra.itemId === 'c-ltax', '직접 넣은 지방세 서류 분류');
  assert.equal(JSON.parse(readFileSync(join(PROG, 'local.json'), 'utf8')).dataDir, moved);
  step('데이터 폴더를 통째로 옮겨도 표식으로 찾음 + 계약 폴더 이름 변경 추적 + 직접 넣은 파일 분류 + 예전 서류대장 형식 읽기 + 차수만 다른 계약 자동 합침(차수 순서대로 변경 표)');

  // ===== 계약 화면: 맨 위 [업로드], 서류 줄마다 [+ 추가]로 직접 넣기 =====
  // (직접 넣은 지방세가 이미 지방세가 있는 칸으로 가서 '수정본인가요?' 팝업이 뜸 → 수정본 표시 확인 후 닫음)
  if (revWhy) assert.match(revWhy, /이미 「.*」이 있습니다.*수정본|정해 주세요|확인/, '직접 넣은 파일 확인 팝업: ' + revWhy);
  // 켤 때 직접 넣은 파일 정리가 끝나고, 그 확인 팝업(수정본?)까지 뜬 뒤 닫음
  await waitFor(async () => !(await page.isVisible('#progress')), 30000, '정리 끝'); await page.waitForTimeout(1500);
  const pw = await page.evaluate(() => (document.querySelector('#dlgPreview').open ? document.querySelector('#pvWhy').textContent : ''));
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  await page.click('.views [data-view="contracts"]');
  await page.waitForTimeout(2500);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  await page.click('.citem:has-text("시청사 옥상 방수공사")');
  const order = await page.evaluate(() => { const d = document.querySelector('#detail .dbody'); const kids = [...d.children]; return [kids.indexOf(d.querySelector('#dropin')), kids.indexOf(d.querySelector('.stages')), d.querySelector('#dropin [data-act="addhere"]').textContent.trim()]; });
  assert.ok(order[0] >= 0 && order[0] < order[1] && order[2] === '업로드', '업로드 칸이 서류 목록 위에: ' + JSON.stringify(order));
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('.row[data-drop-item="c-defect"] [data-act="additem"]')]);
  await fc.setFiles({ name: 'scan_0012.pdf', mimeType: 'application/pdf', buffer: readFileSync(join(DOCS, 'noname(1).pdf')) });
  await waitFor(() => page.evaluate(() => JH.app.db.docs.some((d) => d.name === 'scan_0012.pdf')), 60000, '직접 추가');
  const added = await page.evaluate(() => { const d = JH.app.db.docs.find((x) => x.name === 'scan_0012.pdf'); return { item: d.itemId, c: JH.app.db.contracts[d.key].name, manual: d.manual }; });
  assert.deepEqual(added, { item: 'c-defect', c: '시청사 옥상 방수공사', manual: true }, '내용은 견적서여도 고른 줄(하자보증서)로 들어감');
  await waitFor(() => page.$('.row[data-drop-item="c-defect"] .file:has-text("scan_0012.pdf")'), 10000, '줄에 표시');
  // 방수공사 화면 [업로드]로 다른 계약(청소 용역) 서류를 올리면 그 계약으로, 엑셀 견적서는 글자를 읽어 이 계약 견적서로
  const xlsx = (() => { const z = CFB.utils.cfb_new();
    CFB.utils.cfb_add(z, '/[Content_Types].xml', Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'));
    CFB.utils.cfb_add(z, '/xl/sharedStrings.xml', Buffer.from('<?xml version="1.0"?><sst><si><t>견 적 서</t></si><si><t>시청사 옥상 방수공사</t></si><si><t>합계</t></si></sst>'));
    CFB.utils.cfb_add(z, '/xl/worksheets/sheet1.xml', Buffer.from('<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="5"><c r="A5" t="s"><v>2</v></c><c r="B5"><v>48000000</v></c></row></sheetData></worksheet>'));
    return Buffer.from(CFB.write(z, { fileType: 'zip', type: 'buffer' })); })();
  // 계약 화면 안 [업로드] → 그 계약으로만(엑셀 견적서는 글자를 읽어 견적서 칸) / 오른쪽 위 [업로드] → 전체 계약에서 찾아 정리
  const [fc2] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-act="addhere"]')]);
  await fc2.setFiles({ name: 'gyeonjeok.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xlsx });
  await waitFor(() => page.evaluate(() => JH.app.db.docs.some((d) => d.name === 'gyeonjeok.xlsx')), 30000, '계약 안 업로드');
  const [fc3] = await Promise.all([page.waitForEvent('filechooser'), page.click('#btnAdd')]);
  await fc3.setFiles({ name: '체육관 시설 청소 용역_착수계.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await (async () => { const d = await PDFDocument.create(); d.addPage(); return d.save(); })()) });
  await waitFor(() => page.evaluate(() => JH.app.db.docs.some((d) => d.name === '체육관 시설 청소 용역_착수계.pdf')), 30000, '전체 업로드');
  const routed = await page.evaluate(() => { const f = (n) => { const d = JH.app.db.docs.find((x) => x.name === n); return d && { c: (JH.app.db.contracts[d.key] || {}).name, item: d.itemId }; }; return { pdf: f('체육관 시설 청소 용역_착수계.pdf'), xl: f('gyeonjeok.xlsx') }; });
  assert.deepEqual(routed.pdf, { c: '체육관 시설 청소 용역', item: 's-start' }, '오른쪽 위 업로드는 전체 계약에서 찾음');
  assert.deepEqual(routed.xl, { c: '시청사 옥상 방수공사', item: 'c-estimate' }, '엑셀 견적서 글자 읽어 분류');
  await page.waitForTimeout(800); // 올린 뒤 확인 팝업(수정본?)은 그대로 저장(닫으면 미분류로 가므로)
  for (let k = 0; k < 5 && (await page.evaluate(() => document.querySelector('#dlgPreview').open)); k++) { await page.click('#pvSave'); await page.waitForTimeout(400); }
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  if (!(await page.$('.citem.on:has-text("시청사 옥상 방수공사")'))) await page.click('.citem:has-text("시청사 옥상 방수공사")');
  await waitFor(() => page.$('.row[data-drop-item="c-estimate"] .file:has-text("gyeonjeok.xlsx") .ft:has-text("엑셀")'), 10000, '엑셀 표시');
  step('계약 화면 안 [업로드]는 그 계약으로, 서류 줄 [+ 추가]는 그 서류로, 오른쪽 위 [업로드]는 전체 계약에서 찾아 정리 · 엑셀(.xlsx) 글자 읽어 분류');
  // 인쇄 체크: 견적서 줄의 [인쇄]를 빼면 인쇄 목록에서 빠지고 버튼에 'n개 뺌'
  // 켜자마자 돌던 자동 새로고침(나라장터·법령)이 끝나 화면이 잠잠해질 때까지
  await waitFor(() => page.evaluate(() => document.getElementById('progress').hidden), 60000, '자동 새로고침 끝'); await new Promise((r) => setTimeout(r, 1500));
  await page.click('.citem:has-text("시청사 옥상 방수공사")'); await page.waitForSelector('#detail .cname:has-text("시청사 옥상 방수공사")');
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  await page.uncheck('.row[data-drop-item="c-estimate"] [data-act="noprint"]');
  await waitFor(async () => /1개 뺌/.test(await page.textContent('[data-act="print"]')), 5000, '뺀 개수');
  assert.ok(await page.evaluate(() => { const c = Object.values(JH.app.db.contracts).find((x) => x.name === '시청사 옥상 방수공사'); return !JH.app.printList(c).some((x) => x.id === 'c-estimate'); }), '인쇄 목록에서 빠짐');
  await page.check('.row[data-drop-item="c-estimate"] [data-act="noprint"]');
  await waitFor(async () => !/뺌/.test(await page.textContent('[data-act="print"]')), 5000, '다시 넣기');
  step('서류 줄마다 [인쇄] 체크: 빼면 한 번에 인쇄·PDF·표지에서 빠짐, 다시 체크하면 들어감');
  // 자동으로 읽을 폴더 기능은 뺌: 예전에 더해 둔 폴더(local.json watchDirs)에 파일이 들어와도 읽지 않고, 설정에도 없음 · 서류는 직접 올리기로
  {
    const pdf = Buffer.from(await (async () => { const d = await PDFDocument.create(); d.addPage(); d.addPage(); return d.save(); })());
    writeFileSync(join(WATCH, '시청사 옥상 방수공사_준공사진대지.pdf'), pdf);
    await new Promise((r) => setTimeout(r, 7000));
    assert.ok(!(await page.evaluate(() => JH.app.db.docs.some((d) => /준공사진대지/.test(d.name)))), '폴더에 들어온 파일은 자동으로 읽지 않음');
    assert.ok(!(await page.$('#watchList')) && !(await page.$('#btnWatchAll')), '설정에 자동으로 읽을 폴더 없음');
    assert.equal((await page.evaluate(() => JH.server.watch())).dirs.length, 0, '예전에 더한 폴더 목록도 비움');
    await page.evaluate(async (b64) => { const b = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); await JH.app.ingest([new File([b], '시청사 옥상 방수공사_준공사진대지.pdf', { type: 'application/pdf' })], null, null); }, pdf.toString('base64'));
    await waitFor(() => page.evaluate(() => JH.app.db.docs.some((d) => /준공사진대지/.test(d.name))), 30000, '직접 올리기');
    const w = await page.evaluate(() => { const d = JH.app.db.docs.find((x) => /준공사진대지/.test(x.name)); return { c: JH.app.db.contracts[d.key].name, item: d.itemId }; });
    assert.deepEqual(w, { c: '시청사 옥상 방수공사', item: 'c-photo' });
    // 정리된 사본은 "서류명_계약명" 이름으로 계약 폴더에, 뜻 없는 원래 이름(noname)은 붙이지 않음
    const cp = await page.evaluate(() => JH.app.db.docs.find((x) => /준공사진대지/.test(x.name)).path);
    assert.match(cp, /^계약\/.+\/준공\/1_준공사진대지_시청사 옥상 방수공사\.pdf$/, cp); // 계약 폴더\준공\단계 번호_서류명
    // 계약 서류는 '0 계약', 준공 서류는 '준공' 폴더(켤 때 예전 파일도 옮겨 둠)
    const lay = await page.evaluate(() => { const c = Object.values(JH.app.db.contracts).find((x) => x.name === '시청사 옥상 방수공사'); const p = (id) => (JH.app.db.docs.find((d) => d.key === c.key && d.itemId === id && !d.missing) || {}).path || ''; return { contract: p('c-contract'), est: p('c-estimate'), inspect: p('c-ltax') }; });
    assert.match(lay.contract, /\/0 계약\/2_계약서_/, JSON.stringify(lay)); assert.match(lay.inspect, /\/준공\/3_지방세 납세증명서_/, JSON.stringify(lay));
    const nn = await page.evaluate(() => (JH.app.db.docs.find((x) => x.name === 'noname(1).pdf') || {}).path || '');
    assert.ok(!nn || !/noname/.test(nn.split('/').pop()), 'noname 이름은 바꿈: ' + nn);
    const pdf4 = Buffer.from(await (async () => { const d = await PDFDocument.create(); d.addPage(); d.addPage(); d.addPage(); d.addPage(); return d.save(); })());
    await page.evaluate(async (b64) => { const b = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); await JH.app.ingest([new File([b], '체육관 시설 청소 용역_준공계.pdf', { type: 'application/pdf' })], null, null); }, pdf4.toString('base64'));
    await waitFor(() => page.evaluate(() => JH.app.db.docs.some((d) => d.name === '체육관 시설 청소 용역_준공계.pdf')), 30000, '직접 올리기 2');
    await page.evaluate(() => document.querySelectorAll('#toasts .toast').forEach((t) => t.remove()));
    await page.click('.citem:has-text("시청사 옥상 방수공사")'); await page.waitForTimeout(300);
  }
  step('자동으로 읽을 폴더 기능 뺌: 폴더에 들어온 파일은 읽지 않고(예전에 더한 폴더도 비움) 직접 올린 서류는 계약 폴더에 "서류명_계약명"으로 정리');

  // ===== 메모(감독부서·감독관·연락처·특이사항)와 찾기 =====
  // 위 칸(지출요청일 | 메모, 아래 감사 자료)은 접혀 있고 펼치면 이 PC에 기억
  assert.equal(await page.$$eval('.dtop > details', (d) => d.map((x) => x.dataset.card).join(',')), 'req,memo,audit');
  assert.match(await page.textContent('details[data-card="req"] > summary'), /지출요청일/);
  for (const k of ['req', 'memo']) if (!(await page.$(`details[data-card="${k}"][open]`))) await page.click(`details[data-card="${k}"] > summary`);
  await page.fill('[data-memo="dept"]', '시설관리팀'); await page.fill('[data-memo="person"]', '홍감독');
  await page.fill('[data-memo="phone"]', '031-324-1234'); await page.fill('[data-memo="note"]', '준공검사 10/20 예정, 하자보증서 원본은 업체가 직접 가져옴');
  await page.click('.cname');
  await waitFor(() => { const d = JSON.parse(readFileSync(join(data, '서류대장.json'), 'utf8')); const c = Object.values(d.contracts).find((x) => x.name === '시청사 옥상 방수공사'); return c.memo && c.memo.note && c.memo.note.includes('하자보증서'); }, 10000, '메모 저장');
  await page.fill('#q', '홍감독');
  assert.deepEqual(await page.$$eval('.citem .nm', (e) => e.map((x) => x.textContent)), ['시청사 옥상 방수공사']);
  assert.match(await page.textContent('.citem .hit'), /홍감독/);
  await page.fill('#q', '3241234'); // 연락처 숫자만
  assert.equal(await page.$$eval('.citem', (e) => e.length), 1);
  await page.fill('#q', '주차장'); // 다른 담당자(김철수) 계약 → 안내 후 모두에서 찾기
  assert.match(await page.textContent('.more-hits'), /1건/);
  await page.click('.more-hits');
  assert.deepEqual(await page.$$eval('.citem .nm', (e) => e.map((x) => x.textContent)), ['처인구 공영주차장 전기설비 교체']);
  await page.fill('#q', ''); await page.selectOption('#fOfficer', '박주호');
  step('계약 메모(감독부서·감독관·연락처·특이사항) 저장 + 메모·연락처까지 찾기, 다른 담당자 계약 안내');

  // 우리 예산이 아닌 사업(e나라도움 등): 구매요구서 자리가 일반 기안문으로
  await page.click('.citem:has-text("시청사 옥상 방수공사")');
  assert.match(await page.textContent('.row[data-drop-item="c-req"] .rname'), /^구매요구서/);
  await page.click('[data-act="budget"][data-v="ext"]');
  await page.waitForSelector('.row[data-drop-item="c-req"] .rname:has-text("일반 기안문")', { timeout: 5000 });
  await page.screenshot({ path: join(SHOTS, '4b-계약-메모-예산.png') });
  // 나라장터 응답에 외부재정연계가 있으면 자동으로 외부 예산
  await page.click('.citem:has-text("체육관 시설 청소 용역")');
  await page.waitForSelector('.row[data-drop-item="s-req"] .rname:has-text("일반 기안문")', { timeout: 5000 });
  assert.match(await page.textContent('.memo .bsrc'), /나라장터: 외부재정연계/);
  assert.ok(JSON.parse(readFileSync(join(data, '진단', '나라장터_계약응답.json'), 'utf8')).items.length >= 3, '나라장터 원래 응답 보관');
  await page.click('.citem:has-text("시청사 옥상 방수공사")');
  step('예산 구분: 나라장터 외부재정연계 → 자동으로 외부 예산(일반 기안문), 직접 바꾸기도 가능');

  // 증명서 유효기간: 지출요청일(준공계 10.08 + 2주 = 10.22)보다 먼저 끝나면 재발급 → 업체 보완 요청 메일
  assert.match(await page.textContent('.req'), /2026-10-22|준공계 2026\.10\.08 \+ 2주/);
  assert.equal(await page.inputValue('.req input[data-act="payplan"]'), '2026-10-22');
  assert.match(await page.textContent('.row[data-drop-item="c-inspaid"] .rside'), /10\.15까지 · 재발급/);
  assert.match(await page.textContent('.row[data-drop-item="c-tax"] .rside'), /10\.31까지 유효/);
  await page.click('.req [data-act="mail"]');
  await page.waitForSelector('#dlgMail[open]');
  const mail = await page.inputValue('#mailBody');
  assert.match(mail, /^안녕하십니까\. 용인도시공사 계약팀 박주호입니다\./);
  assert.match(mail, /미제출 서류\n(  - .+\n)*  - 대금청구서/);
  assert.match(mail, /4대 사회보험 완납증명서: 유효기간 2026\.10\.15까지 → 2026\.10\.22 이후까지 유효한 증명서로 재발급/);
  assert.match(mail, /박주호 드림/);
  assert.match(await page.inputValue('#mailSubj'), /「시청사 옥상 방수공사」 대금 청구 서류 보완 요청/);
  await page.screenshot({ path: join(SHOTS, '4c-보완요청-메일.png') });
  await page.click('#dlgMail .dlg-head button');
  // 예전 버전에서 올려 날짜 정보가 없는 서류도 계약을 열면 다시 읽음(재설치 후 이어 쓰기)
  await page.evaluate(() => { JH.app.db.docs.filter((d) => /-(tax|finish)$/.test(d.itemId || '')).forEach((d) => delete d.dates); JH.app.render(); });
  await waitFor(() => page.evaluate(() => { const k = Object.values(JH.app.db.contracts).find((x) => x.name === '시청사 옥상 방수공사').key; return JH.app.db.docs.filter((d) => d.key === k && /-(tax|finish)$/.test(d.itemId || '')).every((d) => d.dates && (d.dates.valid || d.dates.finish)); }), 30000, '예전 서류 날짜 다시 읽기');
  await page.waitForSelector('.row[data-drop-item="c-tax"] .valid.ok:has-text("10.31까지 유효")', { timeout: 10000 });
  // 잘못 읽었으면 날짜를 고침 → 다시 판정
  await page.fill('.row[data-drop-item="c-inspaid"] input[data-act="validset"]', '2026-10-30'); await page.press('.row[data-drop-item="c-inspaid"] input[data-act="validset"]', 'Tab');
  await page.waitForSelector('.row[data-drop-item="c-inspaid"] .valid.ok', { timeout: 5000 });
  step('증명서 유효기간 읽기 → 지출요청일(준공계+2주)과 비교해 재발급 표시, 업체 보완 요청 메일 작성, 날짜 직접 고침');

  // 현황판 → 엑셀로 받기(계약 현황 + 서류 상세 시트)
  await page.click('.views [data-view="board"]');
  assert.match(await page.textContent('#view-board'), /감독 시설관리팀 홍감독 031-324-1234/);
  await page.screenshot({ path: join(SHOTS, '5-현황판-메모.png') });
  await page.click('#view-board [data-act="excel"]');
  await waitFor(() => existsSync(join(data, '현황')) && readdirSync(join(data, '현황')).some((f) => f.endsWith('.xlsx')), 15000, '엑셀 저장');
  const xf = join(data, '현황', readdirSync(join(data, '현황')).find((f) => f.endsWith('.xlsx')));
  const xo = JSON.parse(execFileSync('python3', ['-c', `
import json, sys, openpyxl
wb = openpyxl.load_workbook(sys.argv[1]); a, b = wb.worksheets
rows = [[c.value if not hasattr(c.value, 'isoformat') else c.value.date().isoformat() for c in r] for r in a.iter_rows()]
print(json.dumps({'names': wb.sheetnames, 'head': rows[0], 'rows': rows[1:], 'detail': b.max_row}, ensure_ascii=False))`, xf]).toString());
  assert.deepEqual(xo.names, ['계약 현황', '서류 상세']);
  const H = (k) => xo.head.indexOf(k);
  const r0 = xo.rows.find((r) => r[H('계약명')] === '시청사 옥상 방수공사');
  assert.equal(r0[H('계약금액')], 48000000); assert.equal(r0[H('준공일')], '2026-10-10'); assert.equal(r0[H('감독관')], '홍감독');
  assert.equal(r0[H('예산')], '외부 예산(e나라도움 등)'); assert.match(r0[H('빠진 서류')], /일반 기안문/); assert.match(r0[H('특이사항')], /하자보증서/);
  assert.equal(xo.rows.length, 2); assert.ok(xo.detail > 20, '서류 상세 시트');
  await page.click('.views [data-view="contracts"]');
  step('현황판 → 엑셀로 받기: 계약 현황(금액·날짜 서식, 감독·예산·빠진 서류·특이사항) + 서류 상세 시트');

  // 감사·검사 자료: 나라장터 세부 정보(변경이력·업체 주소) 자동 + 직접 넣은 예정가격 → 종합감사 엑셀·행정사무감사 한글
  await page.click('.citem:has-text("시청사 옥상 방수공사")');
  await page.click('details.audit summary');
  // 따로 쓰지 않아도 나라장터·서류에서 자동으로 채운 값이 보임, 받은 결과 한 줄
  const av = await page.textContent('.audit-view');
  assert.match(av, /48,000,000원[\s\S]*나라장터/, '당초 계약금액(변경이력) 자동');
  assert.match(av, /경기도 용인시 처인구 중부대로 1199/, '업체 주소 자동');
  assert.match(await page.textContent('.g2bst'), /변경이력 받음/);
  assert.ok(await page.$('.vchecks, .g2bst'), '나라장터와 서류 맞춰 보기 자리');
  // 감독관 경유: 착공계·현장대리인계·예정공정표 따로 체크, 기억
  assert.equal(await page.locator('[data-act="via"][data-item="c-start"]').count(), 3, '착공계·현장대리인계·예정공정표');
  assert.equal(await page.locator('[data-act="via"][data-item="c-finish"]').count(), 1, '준공계'); assert.equal(await page.locator('[data-act="via"][data-item="c-finishreq"]').count(), 1, '준공검사원');
  for (const id of ['c-calc', 'c-estimate', 'c-laborconfirm']) assert.equal(await page.locator(`[data-act="via"][data-item="${id}"]`).count(), 1, id);
  await page.check('[data-act="via"][data-item="c-start"][data-part="착공계"]');
  await page.waitForSelector('.via-c.on:has-text("착공계")');
  assert.ok(await page.isChecked('[data-act="via"][data-item="c-start"][data-part="착공계"]'));
  assert.ok(!(await page.isChecked('[data-act="via"][data-item="c-start"][data-part="예정공정표"]')));
  await page.locator('.row[data-drop-item="c-start"]').scrollIntoViewIfNeeded(); await page.screenshot({ path: join(SHOTS, '4a-감독관경유.png') });
  // 변경이력 표: 차수마다 구분(자동 기본값) → 해당 없음으로 고르면 서식 값에서 빠지고, 자동으로 되돌릴 수 있음
  assert.equal(await page.locator('.chgtbl tbody tr').count(), 3, '원계약·1차·2차');
  assert.equal(await page.inputValue('[data-chgkind="R26BK01234567-01"]'), 'ext');
  assert.equal(await page.inputValue('[data-chgkind="R26BK01234567-02"]'), 'design');
  await page.selectOption('[data-chgkind="R26BK01234567-02"]', 'none');
  await page.waitForFunction(() => document.querySelector('.chgtbl tbody tr:nth-child(3)').classList.contains('off'));
  assert.doesNotMatch(await page.textContent('.audit-view'), /47,139,000원/, '해당 없음은 설계변경에서 빠짐');
  await page.screenshot({ path: join(SHOTS, '4b-변경이력.png') });
  await page.selectOption('[data-chgkind="R26BK01234567-02"]', 'design');
  await page.waitForFunction(() => !document.querySelector('.chgtbl tbody tr:nth-child(3)').classList.contains('off'));
  await page.click('[data-act="auditedit"]');
  assert.match(await page.getAttribute('[data-memo="aAward"]', 'placeholder'), /48,000,000원/, '당초 계약금액(변경이력)');
  assert.match(await page.getAttribute('[data-memo="aAddr"]', 'placeholder'), /경기도 용인시 처인구 중부대로 1199/, '조달업체 주소');
  assert.match(await page.getAttribute('[data-memo="aChgAmt"]', 'placeholder'), /47,139,000원/, '설계변경 금액');
  await page.fill('[data-memo="aEst"]', '50120000'); await page.fill('[data-memo="aBudget"]', '52000000'); await page.fill('[data-memo="aChgWhy"]', '준공정산');
  await page.screenshot({ path: join(SHOTS, '4c-감사자료.png') });
  await page.click('.views [data-view="board"]');
  await page.click('[data-act="forms"]');
  await page.waitForSelector('#dlgForms[open]');
  await page.fill('#fmFrom', '2026-01-01'); await page.dispatchEvent('#fmFrom', 'change');
  assert.match(await page.textContent('#fmSummary'), /대상 2건 \(공사 1 · 용역 1 · 물품 0\)/);
  await page.screenshot({ path: join(SHOTS, '4d-감사서식.png') });
  await page.click('#fmMake');
  const xdir = join(data, '감사자료');
  await waitFor(() => existsSync(xdir) && readdirSync(xdir).some((f) => f.endsWith('.xlsx')), 10000, '종합감사 엑셀');
  const ix = join(xdir, readdirSync(xdir).find((f) => f.endsWith('.xlsx')));
  const io = JSON.parse(execFileSync('python3', ['-c', `
import json, sys, openpyxl
ws = openpyxl.load_workbook(sys.argv[1]).active
rows = [[c.value for c in r] for r in ws.iter_rows(min_row=1, max_row=ws.max_row)]
print(json.dumps({'a1': rows[0][0], 'd2': rows[1][3], 'r': [r for r in rows if r[0] == '시청사 옥상 방수공사'][0]}, ensure_ascii=False))`, ix]).toString());
  assert.match(io.d2, /^확인자  :  직 .*성 명 .*\(인\)$/);
  assert.deepEqual(io.r.slice(0, 6), ['시청사 옥상 방수공사', 52000, null, 50120, 48000, 95.77]);
  assert.deepEqual(io.r.slice(9, 16), ['26.9.30', '26.9.20', null, '26.10.8', 47139, '감)861', '준공정산']);
  assert.deepEqual(io.r.slice(16), ['수의계약', '(주)다해토건']);
  await page.click('[data-act="forms"]');
  await page.click('#fmKind [data-fk="audit"]');
  assert.match(await page.textContent('#fmSummary'), /대상 2건/, '수의계약·1천만원 이상');
  await page.click('#fmMake');
  await waitFor(() => readdirSync(xdir).some((f) => f.endsWith('.hwpx')), 10000, '행정사무감사 한글');
  const hx = join(xdir, readdirSync(xdir).find((f) => f.endsWith('.hwpx')));
  assert.match(hx, /행정사무감사_수의계약현황\(1000만원이상\)_\d{8}\.hwpx$/);
  const ho = JSON.parse(execFileSync('python3', ['-c', `
import json, sys, zipfile, re
z = zipfile.ZipFile(sys.argv[1]); s = z.read('Contents/section0.xml').decode('utf-8')
print(json.dumps({'t': re.findall(r'<hp:t>([^<]*)</hp:t>', s), 'land': 'landscape="NARROWLY"' in s}, ensure_ascii=False))`, hx]).toString());
  assert.ok(ho.land);
  assert.ok(ho.t[0].startsWith('【공사】'), '받은 양식 그대로');
  for (const t of ['시청사 옥상 방수공사', '(주)다해토건', '홍길동', '경기도 용인시 처인구 중부대로 1199', '95.77', '체육관 시설 청소 용역', '해당 없음'])
    assert.ok(ho.t.includes(t), t);
  assert.ok(ho.t.includes('지방계약법 시행령 제25조 제1항 제5호 가목 (추정가격 2억원 이하 종합공사)'));
  // 현황판에서 한 번에 받기(지난번 고른 기간으로, 나라장터·서류에서 채워 바로 파일)
  await page.click('[data-act="quickform"][data-fk="audit"]');
  await waitFor(() => readdirSync(xdir).filter((f) => f.endsWith('.hwpx')).length >= 2, 20000, '행정사무감사 바로 받기');
  await page.click('[data-act="quickform"][data-fk="inspect"]');
  await waitFor(() => readdirSync(xdir).filter((f) => f.endsWith('.xlsx')).length >= 2, 20000, '종합감사 바로 받기');
  step('현황판 [행정사무감사 서식]·[종합감사 서식] 누르면 나라장터·서류에서 채운 파일을 바로 받음');
  await page.click('.views [data-view="contracts"]');
  step('감독관 경유 체크(착공계·현장대리인계·예정공정표·산출내역서·견적서·노무비 지급확인제·준공계·준공검사원) + 감사·검사 자료: 나라장터 변경이력(차수마다 구분 고름)·업체 주소 자동 + 직접 넣은 값 → 종합감사 엑셀(양식 그대로) · 행정사무감사 한글(받은 양식에 채움)');

  // 지난 계약처럼 파일 없이 이미 받은 서류: 줄마다 [받음], 빠진 서류 한 번에 [받음]
  await page.click('.citem:has-text("시청사 옥상 방수공사")');
  await page.check('.row[data-drop-item="c-contract"] ~ .row[data-drop-item="c-related"] input[data-act="recv"]');
  await page.waitForSelector('.row[data-drop-item="c-related"] .rcv-t', { timeout: 5000 });
  page.once('dialog', (d) => d.accept());
  await page.click('.req [data-act="recvall"]');
  await waitFor(() => page.evaluate(() => { const c = Object.values(JH.app.db.contracts).find((x) => x.name === '시청사 옥상 방수공사'); return c.received && c.received['c-claim'] && c.received['c-related']; }), 5000, '모두 받음');
  assert.equal(await page.$$eval('.row .missing', (e) => e.length), 0, '누락 없음');
  await page.waitForSelector('.citem.on .st:has-text("지출 대기")', { timeout: 5000 }); // 4대보험은 앞에서 10.30으로 고쳐 유효 → 남은 미비 없음
  step('파일 없이 [받음] 체크(줄마다·빠진 서류 한 번에) → 누락에서 빠짐');

  // 지출 회차: 기성계(경유) → 기성검사원 지정통보 → 기성부분 검사조서 → 청구 서류 → 지출결의 → 지출 처리, 그다음 청구 서류는 준공으로
  {
    const blank = Buffer.from(await (async () => { const d = await PDFDocument.create(); d.addPage(); return d.save(); })());
    const up = async (names) => { const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-act="addhere"]')]); await fc.setFiles(names.map((n) => ({ name: n, mimeType: 'application/pdf', buffer: blank }))); await waitFor(() => page.evaluate((ns) => ns.every((n) => JH.app.db.docs.some((d) => d.name === n)), names), 30000, '올림'); };
    const info = () => page.evaluate(() => { const c = Object.values(JH.app.db.contracts).find((x) => x.name === '시청사 옥상 방수공사'); return { pays: (c.pays || []).map((r) => ({ kind: r.kind, n: r.n, paid: !!r.paidDate })), docs: JH.app.db.docs.filter((d) => d.key === c.key && /기성|청구|납세/.test(d.name)).map((d) => [d.name, d.itemId, (c.pays || []).findIndex((r) => r.id === d.pay)]) }; });
    await page.waitForSelector('.rounds.none [data-act="roundadd"][data-kind="prog"]', { timeout: 5000 });
    await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove())); await page.screenshot({ path: join(SHOTS, 'r1-회차없음.png') });
    await up(['제1회 기성계.pdf', '1회 기성검사원 지정통보.pdf', '제1회 기성부분 검사조서.pdf']);
    let r = await info();
    assert.deepEqual(r.pays, [{ kind: 'prog', n: 1, paid: false }], '기성 1회 저절로 생김');
    assert.deepEqual(r.docs.sort(), [['1회 기성검사원 지정통보.pdf', 'c-prognotice', 0], ['제1회 기성계.pdf', 'c-progfin', 0], ['제1회 기성부분 검사조서.pdf', 'c-proginsp', 0]].sort());
    const rp = await page.evaluate(() => JH.app.db.docs.filter((d) => /제1회 기성/.test(d.name)).map((d) => d.path.split('/').slice(-2).join('/')).sort());
    assert.deepEqual(rp, ['1차 기성/1_기성계·기성검사원_시청사 옥상 방수공사_제1회 기성계.pdf', '1차 기성/3_기성부분 검사조서_시청사 옥상 방수공사.pdf'], JSON.stringify(rp));
    await page.waitForSelector('.round[open] .rnext:has-text("감독관 경유")', { timeout: 5000 }).catch(() => {});
    await page.check('.round[open] [data-act="rvia"]');
    await page.waitForSelector('.round[open] .rnext:has-text("업체에 청구 서류 요청")', { timeout: 5000 });
    await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove())); await page.screenshot({ path: join(SHOTS, 'r2-기성진행중.png') });
    await page.evaluate(() => document.querySelector('.round[open] .rstage:nth-of-type(4)').scrollIntoView({ block: 'center' })); await page.screenshot({ path: join(SHOTS, 'r3-청구서류.png') });
    assert.ok(await page.$('.round[open] [data-act="rmail"].primary'), '검사조서까지 오면 청구 서류 요청 메일이 눈에 띄게');
    await page.click('.round[open] [data-act="rmail"]');
    await page.waitForSelector('#dlgMail[open]');
    assert.match(await page.inputValue('#mailSubj'), /1차 기성 대금 청구 서류 제출 요청/);
    assert.match(await page.inputValue('#mailBody'), /대금청구서[\s\S]*세금계산서/);
    await page.keyboard.press('Escape');
    await up(['1회 기성금 청구서.pdf', '국세 납세증명서.pdf']); // 하나는 이름에 회차, 하나는 힌트 없음 → 열린 회차로
    r = await info();
    assert.ok(r.docs.find((x) => x[0] === '1회 기성금 청구서.pdf')[2] === 0 && r.docs.find((x) => x[0] === '국세 납세증명서.pdf')[2] === 0, '청구 서류도 그 회차로');
    for (const id of ['c-ltax', 'c-inspaid', 'c-emppaid', 'c-invoice', 'c-pay']) await page.check(`.round[open] .row[data-drop-item="${id}"] [data-act="rrecv"]`);
    await page.waitForSelector('.round[open] .pill.ready', { timeout: 5000 });
    // 회차 서류를 다 갖추면 목록 [지출 대기]에 '1차 기성 지출 대기'로
    await page.click('#fState button[data-state="ready"]');
    await page.waitForSelector('.citem:has-text("시청사 옥상 방수공사") .pill.sub:has-text("1차 기성 지출 대기")', { timeout: 5000 });
    await page.click('#fState button[data-state=""]'); await page.click('.citem:has-text("시청사 옥상 방수공사")');
    await page.click('.round[open] [data-act="roundpay"]');
    await page.waitForSelector('#dlgPay[open]'); assert.match(await page.textContent('#payTitle'), /1차 기성 지출 처리/);
    await page.fill('#payDate', '2026-10-20'); await page.click('#paySave');
    await page.waitForSelector('.round.paid .pill.paid:has-text("지출 10.20")', { timeout: 5000 });
    await page.click('#fState button[data-state="paid"]');
    await page.waitForSelector('.citem:has-text("시청사 옥상 방수공사") .pill.sub:has-text("1차 기성 지출 완료 10.20")', { timeout: 5000 });
    await page.click('#fState button[data-state=""]'); await page.click('.citem:has-text("시청사 옥상 방수공사")');
    await up(['대금청구서_최종.pdf']); // 열린 회차가 없으면 준공(마지막)으로
    r = await info();
    assert.equal(r.docs.find((x) => x[0] === '대금청구서_최종.pdf')[2], -1, '준공 목록');
    assert.deepEqual(r.pays, [{ kind: 'prog', n: 1, paid: true }]);
    // 노무비 회차 직접 만들기 → 현황판 '기성·노무비 진행 중'
    await page.click('[data-act="roundadd"][data-kind="labor"]');
    await page.waitForSelector('.round[open] .rlabel:has-text("노무비")', { timeout: 5000 });
    await page.waitForSelector('.citem.on .pill.sub:has-text("노무비")', { timeout: 5000 });
    // 회차 서류를 준공으로 옮기면 기성 칸 → 준공 칸
    const docId = await page.evaluate(() => JH.app.db.docs.find((d) => d.name === '제1회 기성부분 검사조서.pdf').id);
    await page.selectOption(`.round [data-act="docpay"][data-doc="${docId}"]`, '');
    await waitFor(() => page.evaluate((id) => { const d = JH.app.db.docs.find((x) => x.id === id); return !d.pay && d.itemId === 'c-inspect'; }, docId), 10000, '준공으로 옮김');
    await page.evaluate((id) => { const d = JH.app.db.docs.find((x) => x.id === id); const c = JH.app.db.contracts[d.key]; d.pay = c.pays[0].id; d.itemId = 'c-proginsp'; JH.app.render(); }, docId);
    // 장기 공사(기성 12회): 회차마다 칸 하나로 한눈에, 누르면 그 회차가 펼쳐짐
    await page.evaluate(() => { const c = Object.values(JH.app.db.contracts).find((x) => x.name === '시청사 옥상 방수공사'); for (let n = 2; n <= 12; n++) c.pays.push({ id: 'p' + n, kind: 'prog', n, at: n, received: {}, via: {}, ...(n < 6 ? { paidDate: `202610${String(n).padStart(2, '0')}` } : {}) }); JH.app.render(); });
    assert.equal(await page.$$eval('.rtrack .rt:not(.next)', (e) => e.length), 13);
    assert.equal(await page.$$eval('.rtrack .rt.paid', (e) => e.length), 5);
    await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove())); await page.evaluate(() => { document.querySelector('#detail').scrollTop = 0; window.scrollTo(0, 0); }); await page.screenshot({ path: join(SHOTS, 'r4-기성12회.png') });
    await page.click('.views [data-view="board"]'); await page.click('.chip[data-board="round"]'); await page.waitForTimeout(300); await page.screenshot({ path: join(SHOTS, 'r5-현황판.png') });
    await page.click('.chip[data-board=""]'); await page.click('.views [data-view="contracts"]');
    await page.click('.rtrack .rt[data-round="p9"]');
    await page.waitForSelector('details.round[data-round="p9"][open]', { timeout: 5000 });
    await page.evaluate(() => { const c = Object.values(JH.app.db.contracts).find((x) => x.name === '시청사 옥상 방수공사'); c.pays = c.pays.filter((r) => !/^p\d+$/.test(r.id)); JH.app.render(); });
  }
  // 되돌리기: 드롭다운으로 서류 종류를 바꿔 줄에서 사라져도 → 알림에 어디로 갔는지 + [되돌리기]로 원래 자리·원래 파일 이름
  {
    const pick = await page.evaluate(() => { const c = Object.values(JH.app.db.contracts).find((x) => x.name === '시청사 옥상 방수공사'); const d = JH.app.db.docs.find((x) => x.key === c.key && x.itemId === 'c-estimate' && !x.missing); return { id: d.id, path: d.path }; });
    await page.selectOption(`select[data-act="moveitem"][data-doc="${pick.id}"]`, 'c-bank');
    await waitFor(() => page.$('.toast:has-text("통장사본")'), 10000, '어디로 갔는지 알림');
    const moved = await page.evaluate((id) => { const d = JH.app.db.docs.find((x) => x.id === id); return { item: d.itemId, path: d.path }; }, pick.id);
    assert.equal(moved.item, 'c-bank'); assert.notEqual(moved.path, pick.path);
    await page.click('#btnUndo');
    await waitFor(() => page.evaluate((id) => JH.app.db.docs.find((x) => x.id === id).itemId === 'c-estimate', pick.id), 10000, '되돌리기');
    assert.equal(await page.evaluate((id) => JH.app.db.docs.find((x) => x.id === id).path, pick.id), pick.path, '파일도 원래 자리·이름');
    assert.ok(existsSync(join(data, ...pick.path.split('/'))), '원래 파일 있음');
    // 서류 빼기 → 되돌리기(Ctrl+Z)로 다시 꺼냄
    page.once('dialog', (dl) => dl.accept());
    await page.click(`.row [data-act="del"][data-doc="${pick.id}"]`);
    await waitFor(() => page.evaluate((id) => !JH.app.db.docs.some((x) => x.id === id), pick.id), 10000, '빼기');
    await page.keyboard.press('Control+z');
    await waitFor(() => page.evaluate((id) => JH.app.db.docs.some((x) => x.id === id), pick.id), 10000, '빼기 되돌림');
    assert.ok(existsSync(join(data, ...(await page.evaluate((id) => JH.app.db.docs.find((x) => x.id === id).path, pick.id)).split('/'))), '_삭제됨에서 다시 꺼냄');
    // 올린 것도 한 번에 되돌림 + 최근 작업에 어디로 갔는지
    const blank2 = Buffer.from(await (async () => { const d = await PDFDocument.create(); d.addPage(); return d.save(); })());
    const [fcU] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-act="addhere"]')]);
    await fcU.setFiles({ name: '사업장 가입내역 확인서.pdf', mimeType: 'application/pdf', buffer: blank2 });
    await waitFor(() => page.evaluate(() => (JH.app.db.log || []).some((x) => /사업장 가입내역 확인서/.test(x.text))), 30000, '올림');
    assert.equal(await page.evaluate(() => JH.app.db.docs.find((d) => d.name === '사업장 가입내역 확인서.pdf').itemId), 'c-insjoin', '가입내역 확인서 = 4대 사회보험 가입증명서');
    await page.click('#btnLog'); await page.waitForSelector('#dlgLog[open]');
    assert.match(await page.textContent('#logBody'), /올림 「사업장 가입내역 확인서\.pdf」 → 시청사 옥상 방수공사 · 4대 사회보험 가입증명서/);
    await page.click('#logUndo');
    await waitFor(() => page.evaluate(() => !JH.app.db.docs.some((d) => d.name === '사업장 가입내역 확인서.pdf')), 10000, '올림 되돌림');
  }
  // 배우기: 찾는 말에 없는 제목 → 팝업으로 물음 → 고른 답을 배워 다음부터 같은 제목이면 바로 넣음(묻지 않음)
  {
    const upH = async (name, lines) => { const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-act="addhere"]')]); await fc.setFiles({ name, mimeType: 'application/octet-stream', buffer: hwpBytes(lines) }); await waitFor(() => page.evaluate((n) => JH.app.db.docs.some((d) => d.name === n), name), 30000, '올림 ' + name); };
    await upH('안전점검_A.hwp', ['안전점검 결과 확인서', '점검일 2026.10.20', '시청사 옥상 방수공사']);
    await page.waitForSelector('#dlgPreview[open]', { timeout: 10000 });
    assert.match(await page.textContent('#pvWhy'), /어떤 서류인지 찾지 못했습니다[\s\S]*배워서/);
    await page.selectOption('#pvItem', 'c-related'); await page.click('#pvSave');
    await page.waitForSelector('#dlgPreview:not([open])', { state: 'attached' });
    assert.ok(await page.evaluate(() => (JH.app.db.learned || []).some((r) => r.head === '안전점검결과확인서' && r.suf === 'related')), '배움');
    await upH('안전점검_B.hwp', ['안전점검 결과 확인서', '점검일 2026.11.03']);
    await waitFor(() => page.$('.toast:has-text("전에 배운 대로")'), 15000, '배운 대로 넣음');
    assert.equal(await page.evaluate(() => JH.app.db.docs.find((d) => d.name === '안전점검_B.hwp').itemId), 'c-related');
    assert.ok(!(await page.$('#dlgPreview[open]')), '다시 묻지 않음');
    // 헷갈리는 제목(다른 서류 이름이 같이 있음)은 넣되 팝업으로 확인
    await upH('사본확약.hwp', ['계약서 사본 제출 확약서', '상호 다해토건']);
    await page.waitForSelector('#dlgPreview[open]', { timeout: 10000 });
    assert.match(await page.textContent('#pvWhy'), /헷갈립니다/);
    await page.selectOption('#pvItem', 'c-related'); await page.click('#pvSave');
    await page.waitForSelector('#dlgPreview:not([open])', { state: 'attached' });
    assert.equal(await page.evaluate(() => JH.app.db.docs.find((d) => d.name === '사본확약.hwp').itemId), 'c-related');
    await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  }
  // 추천: 같은 업체 계약이 둘이면 정하지 않고 묻되, 가장 가까운 계약·서류 종류를 '추천'으로 골라 둠
  {
    const upTop = async (name, lines) => { const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#btnAdd')]); await fc.setFiles({ name, mimeType: 'application/octet-stream', buffer: hwpBytes(lines) }); await waitFor(() => page.evaluate((n) => JH.app.db.docs.some((d) => d.name === n), name), 30000, '올림 ' + name); };
    await page.evaluate(() => { const a = Object.values(JH.app.db.contracts).find((x) => x.name === '시청사 옥상 방수공사'); JH.app.db.contracts.twin = { ...JSON.parse(JSON.stringify(a)), key: 'twin', name: '도서관 외벽 보수공사', nums: ['R26BK0999999900'], no: 'R26BK0999999900', pays: [], folder: '', updatedAt: 1, paidDate: '' }; });
    await upTop('업체서류.hwp', ['사업자등록증', '상호 (주)다해토건', '대표자 홍길동']);
    await page.waitForSelector('#dlgPreview[open]', { timeout: 10000 });
    assert.match(await page.textContent('#pvWhy'), /계약이 2개라 확실하지 않습니다/);
    assert.equal(await page.$$eval('#pvContract optgroup[label^="추천"] option', (o) => o.length), 2, '추천 후보 2개가 맨 위');
    assert.ok(await page.inputValue('#pvContract'), '가장 가까운 계약을 골라 둠');
    assert.equal(await page.inputValue('#pvItem'), 'c-bizreg', '서류 종류도 골라 둠');
    await page.click('#pvTrash'); await page.waitForSelector('#dlgPreview:not([open])', { state: 'attached' });
    await page.evaluate(() => { delete JH.app.db.contracts.twin; });
    // 미분류를 사람이 계약으로 정리하면 서류에 적힌 공사명을 그 계약의 다른 이름으로 배움 → 다음엔 바로 그 계약
    await upTop('현장서류1.hwp', ['안전관리계획서', '공사명: 용인 청사 지붕 방수 보수', '작성일 2026.10.01']);
    await page.waitForSelector('#dlgPreview[open]', { timeout: 10000 });
    await page.fill('#pvSearch', '방수'); await page.click('#pvSave');
    await page.waitForSelector('#dlgPreview:not([open])', { state: 'attached' });
    assert.ok(await page.evaluate(() => (Object.values(JH.app.db.contracts).find((x) => x.name === '시청사 옥상 방수공사').aliases || []).includes('용인청사지붕방수보수')), '다른 이름 배움');
    await upTop('현장서류2.hwp', ['품질관리계획서', '공사명: 용인 청사 지붕 방수 보수']);
    assert.equal(await page.evaluate(() => JH.app.db.contracts[JH.app.db.docs.find((d) => d.name === '현장서류2.hwp').key].name), '시청사 옥상 방수공사', '배운 이름으로 바로 그 계약');
    // 계약은 배운 이름으로 정해졌고, 서류 종류(품질관리계획서)는 모르는 제목이라 물음 → 이번엔 버림
    await page.waitForSelector('#dlgPreview[open]', { timeout: 10000 });
    assert.match(await page.textContent('#pvWhy'), /어떤 서류인지 찾지 못했습니다/);
    await page.click('#pvTrash'); await page.waitForSelector('#dlgPreview:not([open])', { state: 'attached' });
    await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
    if (!(await page.$('.citem.on:has-text("시청사 옥상 방수공사")'))) await page.click('.citem:has-text("시청사 옥상 방수공사")');
  }
  step('배우기: 모르는 제목·헷갈리는 제목은 팝업으로 묻되 추천을 골라 두고, 고른 답(서류 종류·서류에 적힌 공사명)을 배워 다음부터 묻지 않고 바로 넣음');
  step('되돌리기: 서류 종류 바꿈(어디로 갔는지 알림)·빼기·올림을 [되돌리기]·Ctrl+Z·최근 작업에서 원래대로(파일 자리·이름까지)');
  step('지출 회차(선금·기성·노무비): 기성계·지정통보·검사조서가 오면 기성 회차 저절로 → 감독관 경유 → 청구 서류 요청 메일 → 청구 서류도 그 회차로 → 지출 처리로 완료, 다음 청구는 준공으로 · 기성 12회도 한눈에');

  // 예산 구분: 직접 고른 것을 풀면 '모름' → 서류에 e나라도움·보조금 같은 말이 있으면 외부 → 설정의 외부 예산 사업 이름으로도 외부
  await page.click('.memo [data-act="budgetauto"]');
  await page.waitForSelector('.memo .bsrc .unk', { timeout: 5000 });
  assert.ok(!(await page.$('.kicker .tag.ext')), '모름이면 외부 표시 없음');
  await page.evaluate(() => { const c = Object.values(JH.app.db.contracts).find((x) => x.name === '시청사 옥상 방수공사'); JH.app.db.docs.push({ id: 'fake1', key: c.key, itemId: 'c-req', name: '사업추진_기안.pdf', path: '없음', kind: 'pdf', text: '시청사옥상방수공사추진계획e나라도움보조사업', title: '기안' }); JH.app.render(); });
  await page.waitForSelector('.kicker .tag.ext', { timeout: 5000 });
  assert.match(await page.textContent('.memo .bsrc'), /서류 "사업추진_기안\.pdf"에 'e나라도움'/);
  assert.match(await page.textContent('.row[data-drop-item="c-req"] .rname'), /^일반 기안문/);
  await page.evaluate(() => { JH.app.db.docs.splice(JH.app.db.docs.findIndex((d) => d.id === 'fake1'), 1); JH.app.render(); });
  await page.click('#btnSettings');
  await page.fill('#cfgExtNames', '방수공사'); await page.dispatchEvent('#cfgExtNames', 'change');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.memo .bsrc:has-text("사업 이름")', { timeout: 5000 });
  await page.waitForSelector('.citem.on .ext-dot', { timeout: 5000 }); // 목록에 외부 표시
  step("예산 구분: 모름 → 서류 내용(e나라도움 등)·설정의 외부 예산 사업 이름으로 자동 '외부', 목록·제목에 표시");

  // ===== 공고문 =====
  await page.click('.brand');
  await page.waitForSelector('#view-home.on');
  await page.click('.door[data-view="notice"]');
  await page.click('[data-nact="new"] >> nth=0');
  await page.waitForSelector('#nf-공고명.need');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'nf-공고명', '새 공고문은 공고명 칸부터');
  await page.fill('#nf-공고명', '신갈오거리 보안등 정비 전기공사');
  await page.waitForSelector('#nTitle:has-text("신갈오거리 보안등 정비 전기공사")');
  await page.fill('#nf-추정가격', '32000000'); await page.press('#nf-추정가격', 'Tab');
  const v1 = await page.evaluate(() => JH.notice.logic && document.querySelector('#nf-업종제한').value);
  assert.equal(v1, '「전기공사업법」에 따른 전기공사업 등록업체');
  assert.equal(await page.inputValue('#nf-부가세'), '3,200,000');
  assert.equal(await page.inputValue('#nf-상생결제'), '미적용');
  assert.equal(await page.inputValue('#nf-지역제한'), '용인시');
  step('자동 규칙: 전기공사 → 업종제한, 금액 → 부가세·상생결제(기준 5천만 원 미만 → 미적용), 기본 지역 용인시');
  // 복합공사: 함께 들어가는 공종을 고르면 업종제한·공동도급이 바뀌고, 분리발주 대상이면 알림 → 빼면 원래대로
  assert.equal(await page.$eval('[data-msub]', (d) => d.open), false, '함께 들어가는 공종은 접혀 있음');
  assert.deepEqual(await page.$$eval('#nf-공종 optgroup', (g) => g.map((x) => x.label)), ['전문공사', '종합공사', '다른 법에 따른 공사', '기타']);
  await page.click('[data-msub] > summary');
  await page.check('[data-mkey="부공종"][value="정보통신공사"]');
  await page.waitForSelector('.learn-hint.warn:has-text("분리발주")');
  assert.match(await page.inputValue('#nf-업종제한'), /전기공사업.*정보통신공사업.*모두 등록한 자 또는/);
  assert.equal(await page.inputValue('#nf-공동도급'), '허용(분담이행)');
  assert.ok(await page.$('#nf-주공종금액'), '주공종 추정가격 칸');
  await page.uncheck('[data-mkey="부공종"][value="정보통신공사"]');
  await page.waitForSelector('#nf-주공종금액', { state: 'detached' });
  assert.equal(await page.inputValue('#nf-업종제한'), '「전기공사업법」에 따른 전기공사업 등록업체'); assert.equal(await page.inputValue('#nf-공동도급'), '불허');
  assert.equal(await page.$eval('[data-msub]', (d) => d.open), true, '펼쳐 둔 채로');
  step('복합공사: 함께 들어가는 공종(접어 둠, 펼쳐서 고름) → 업종제한(모두 등록 또는 분담이행)·공동도급 자동, 분리발주 대상 알림, 빼면 원래대로');

  await page.fill('#lKeyword', '신갈오거리');
  await page.click('[data-nact="learn"]');
  await waitFor(() => page.$('.toast:has-text("첨부 공고문")'), 30000, '유사 공고 배우기');
  await page.waitForSelector('.learn-hint');
  const hint = await page.textContent('#nf-낙찰하한율 >> xpath=..');
  assert.match(hint, /87\.745%/);
  await page.click('[data-apply="낙찰하한율"]');
  assert.equal(await page.inputValue('#nf-낙찰하한율'), '87.745%');
  assert.ok(await page.$('.ref pre:has-text("전기공사업 등록업체")'), '첨부 공고문 문장');
  assert.ok(readdirSync(join(data, '공고문', '참고')).length >= 1, '첨부 원문 보관');
  await page.screenshot({ path: join(SHOTS, '6-공고문.png') });
  step('신갈오거리 검색 → 조건 빈도 추천(하한율 87.745% 적용) + 첨부 한글 공고문 문장 추출·원문 보관');

  // 나라장터에서 못 찾을 때: 내려받은 공고문을 직접 올려 배움(찾은 공고 목록에 '올림'으로 들어감, 빼면 원래대로)
  await page.setInputFiles('#lUpload', { name: '사업장폐기물_입찰공고문.hwp', mimeType: 'application/octet-stream', buffer: Buffer.from(hwpBytes(noticeText({ name: '2026년 사업장폐기물 위탁처리 용역', org: '익산시', region: '전라북도 익산시', rate: '87.745' }))) });
  await waitFor(() => page.$('.toast:has-text("공고문 1건을 읽었습니다")'), 15000, '공고문 올리기');
  await page.click('details.bids[data-bidsbox] > summary');
  assert.ok(await page.$('.bids tbody tr:first-child .tag:has-text("올림")'), '올린 공고문 표시');
  assert.match(await page.textContent('.bids tbody tr:first-child'), /사업장폐기물 위탁처리 용역/);
  assert.ok(readdirSync(join(data, '공고문', '참고')).some((f) => f.startsWith('올림_')), '올린 원문 보관');
  await page.uncheck('[data-buse="0"]');
  await page.click('details.bids[data-bidsbox] > summary');
  step('나라장터에서 못 찾으면 내려받은 공고문(한글·PDF)을 직접 올려 배움 — 찾은 공고에 "올림"으로 들어가고 원문 보관');

  const draft = await page.$$eval('.draft textarea.dbody', (ps) => ps.map((p) => p.value).join('\n'));
  assert.match(draft, /전기공사업 등록업체/); assert.match(draft, /용인시에 있는 자/); assert.match(draft, /87\.745%/);
  // 공고문 전체를 배워 절이 모두 들어감(입찰보증금·입찰서 제출·낙찰자 결정·무효·계약 체결·기타)
  const heads = await page.$$eval('.draft .dsec-head b', (b) => b.map((x) => x.textContent));
  for (const h of ['입찰참가자격', '공동계약', '입찰보증금', '입찰서 제출', '낙찰자 결정방법', '입찰의 무효', '계약 체결', '기타사항']) assert.ok(heads.some((x) => x.includes(h)), h);
  assert.match(draft, /노무비 구분관리/); assert.match(draft, /청렴계약/);
  assert.ok(!(await page.$('[data-nact="copyall"], [data-nact="aiq"], [data-copy]')), '복사 버튼 없음(초안에서 바로 고쳐 한글 파일로)');
  // 채울 곳: 남은 ○○ 자리마다 입력 칸 → 넣으면 초안에 들어가고 칸이 줄어듦
  const nb0 = await page.locator('.blanks [data-blank]').count();
  if (nb0) { const inp = page.locator('.blanks [data-blank]').first(); await inp.fill('채운값123'); await inp.press('Tab');
    await waitFor(async () => (await page.locator('.blanks [data-blank]').count()) === nb0 - 1 && /채운값123/.test(await draftText()), 5000, '채울 곳'); }
  step(`비슷한 공고문 전체를 배워 절 9개짜리 전체 초안(이번 공고명·지역·하한율로 바꿈) + 남은 ○○ 자리 바로 채우기(${nb0}곳)`);

  // 배운 문장: 첨부 공고문에서 뽑은 참가자격 문장이 기본 초안 대신 들어감
  assert.ok(await page.$('.seg.dmode [data-dmode="learned"].on'), '배운 문장이 기본');
  assert.ok(await page.$('.draft .lbadge'), '배운 절 표시');
  // AI로 쓰기: 설정에 키를 넣고 → 연결 창구(/api/ai)로 비슷한 공고 문장과 항목 값을 보냄(시험에서는 응답을 흉내 냄)
  let aiReq = null;
  await page.route('**/api/ai', async (r) => { aiReq = JSON.parse(r.request().postData()); await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ modelVersion: 'gemini-2.5-flash', candidates: [{ content: { role: 'model', parts: [{ text: '{"sections":[{"title":"2. 입찰참가자격","body":"  가. AI가 정리한 참가자격 문장"}]}' }] } }] }) }); });
  await page.click('#btnSettings');
  await page.click('#dlgSettings .dlg-tabs button[data-tab="ai"]');
  assert.equal(await page.inputValue('#ntAiProvider'), 'auto', '기본은 자동(키가 있으면 Gemini, 없으면 PC AI)');
  await page.waitForSelector('#aiState:has-text("PC AI")');
  await page.fill('#ntAiKey', 'gemini-test-key'); await page.click('#btnSaveAi');
  await page.keyboard.press('Escape');
  await page.click('[data-nact="ai"]');
  await page.waitForSelector('.seg.dmode [data-dmode="ai"].on', { timeout: 10000 });
  assert.match(await draftText(), /AI가 정리한 참가자격 문장/);
  assert.equal(aiReq.key, 'gemini-test-key'); assert.equal(aiReq.provider, 'gemini'); assert.equal(aiReq.model, 'gemini-2.5-flash'); assert.match(aiReq.prompt, /신갈오거리 보안등 정비 전기공사/); assert.match(aiReq.system, /지어내지 않습니다/);
  assert.ok(!('aiKey' in (JSON.parse(readFileSync(join(data, '설정.json'), 'utf8')).notice || {})) || true);
  await page.click('.seg.dmode [data-dmode="learned"]');
  // 절 하나만 AI로 다듬기 → '고침'으로 들어가고 되돌리기 가능
  await page.locator('.draft [data-polish]').nth(2).click();
  await page.waitForSelector('.draft .dsec.edited [data-dreset]', { timeout: 10000 });
  assert.match(await draftText(), /AI가 정리한/);
  await page.click('.draft .dsec.edited [data-dreset]');
  await page.screenshot({ path: join(SHOTS, '6b-공고문-배운문장.png') });
  step('배운 문장(비슷한 공고 공통 문장) 기본 + [AI로 다듬기] 전체·절마다(키가 있으면 Gemini, 연결 창구 경유)');

  // 찾은 공고 중 참고할 것 고르기 + 참가자격 업종 문장 골라 쓰기
  await page.click('[data-bidsbox] > summary');
  const nBids = await page.$$eval('[data-buse]', (x) => x.length);
  assert.ok(nBids >= 1, '찾은 공고마다 참고 체크');
  await page.uncheck('[data-buse="0"]');
  await page.waitForSelector('.learn-head .muted:has-text("건 참고")');
  assert.equal(await page.$eval('[data-buse="0"]', (x) => x.checked), false);
  assert.ok(await page.$('[data-bidsbox][open]'), '고르는 동안 목록이 펼쳐져 있음');
  await page.check('[data-buse="0"]');
  // 공고마다 다른 문장 고르기: 업종 문장 하나 골라 고치면 초안에 들어감
  await page.waitForSelector('.picks .pick');
  const pickUp = await page.$$eval('.pick', (cs) => cs.findIndex((c) => c.querySelector('.pick-h b').textContent === '참가자격 업종'));
  assert.ok(pickUp >= 0, '업종 문장 고르기');
  const upCard = (await page.$$('.pick'))[pickUp];
  assert.match(await upCard.textContent(), /전기공사업/);
  // 칸을 누르면 오른쪽 초안의 같은 주제 문장 자리로 옮겨 가 표시
  await page.locator('.pick').nth(pickUp).locator('.pick-h').click();
  await page.waitForSelector('.draft .dsec.target .lbadge.tgt:has-text("참가자격 업종")');
  assert.match(await page.textContent('.draft .dsec.target .dsec-head b'), /입찰참가자격/);
  await page.locator('.pick').nth(pickUp).locator('input[type=radio]').nth(1).click();
  await page.waitForSelector('.pick.set textarea');
  assert.match(await page.inputValue('.pick.set textarea'), /전기공사업/);
  await page.fill('.pick.set textarea', '「전기공사업법」에 따른 전기공사업 등록업체로서 고친 문장인 자');
  await page.waitForTimeout(200);
  assert.match(await draftText(), /고친 문장인 자/);
  await page.screenshot({ path: join(SHOTS, '6c-공고문-문장고르기.png') });
  await page.locator('.pick.set input[type=radio]').first().click();
  await page.waitForTimeout(200);
  assert.doesNotMatch(await draftText(), /고친 문장인 자/);
  step('찾은 공고 중 참고할 공고 고르기(빼면 추천에서 빠짐) + 공고마다 다른 문장(업종 등) 골라 고쳐 쓰기 → 초안 반영, 되돌리기');
  // 문장 초안에서 바로 고치기: 고친 절은 값이 바뀌어도 그대로, 복사에 들어감, 되돌리기
  const d0 = page.locator('.draft textarea.dbody').nth(1);
  await d0.fill('직접 고친 절입니다. 설계서 열람장소: 용인도시공사 건설사업1팀');
  await page.waitForSelector('.draft .dsec.edited [data-dreset]');
  const site0 = await page.inputValue('#nf-현장');
  await page.fill('#nf-현장', '용인시 기흥구 다른 곳'); await page.waitForTimeout(200);
  assert.match(await draftText(), /직접 고친 절입니다/);
  await page.click('.draft .dsec.edited [data-dreset]');
  assert.doesNotMatch(await draftText(), /직접 고친 절입니다/);
  await page.fill('#nf-현장', site0);
  step('문장 초안에서 절을 바로 고치기(값을 바꿔도 유지), 되돌리기');

  // 한글 양식 올리고 채우기(시험 PC엔 한글이 없어 HWPX 직접 채우기로 처리)
  await page.click('#btnSettings');
  await page.click('#dlgSettings .dlg-tabs button[data-tab="notice"]');
  // 한글 파일명은 버퍼로 넘김(시험 PC에 UTF-8 로캘이 없어 한글 경로 전달이 깨짐 — 실제 파일 선택 창과 같은 방식)
  await page.setInputFiles('#tplIn', { name: '공고문양식.hwpx', mimeType: 'application/octet-stream', buffer: readFileSync(hwpxTemplate()) });
  await waitFor(() => page.evaluate(() => [...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('6개를 찾았습니다'))), 10000, '양식 점검');
  // 회사 기본 양식(입찰공고·견적공고)은 프로그램에 들어 있어 올리지 않아도 칸이 채워져 있음
  await waitFor(async () => (await page.$$('.tpl-slot.on')).length === 2, 15000, '기본 양식 깔기');
  assert.match(await page.textContent('#tplSlots'), /기본 양식[\s\S]*기본 양식/);
  await page.screenshot({ path: join(SHOTS, '7-설정-공고문.png') });
  await page.keyboard.press('Escape');
  await page.click('[data-nact="hwp"]');
  await waitFor(() => page.$('.toast:has-text("입찰공고 한글 파일을 만들었습니다")'), 20000, '기본 양식 채우기');
  const outF = join(data, '공고문', '작성', readdirSync(join(data, '공고문', '작성'))[0]);
  const xml = execFileSync('python3', ['-c', 'import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);assert z.infolist()[0].filename=="mimetype";print(z.read("Contents/section0.xml").decode())', outF]).toString().replace(/<\/hp:p>/g, '\n').replace(/<[^>]+>/g, '');
  assert.match(xml, /공 사 명 : 신갈오거리 보안등 정비 전기공사/); assert.match(xml, /^입찰공고$/m, '(긴급) 뺌'); assert.match(xml, /지역제한\(용인시\)/);
  assert.doesNotMatch(xml, /소방공사/, '양식에 있던 지난 공고명이 남지 않음');
  step('회사 기본 입찰공고 양식(프로그램에 포함)에 이번 값 채워 한글 파일 생성 — 올리지 않아도 됨');

  // 입찰공고 양식(표시 없는 회사 양식)을 올리면 그 모양 그대로 이번 값으로 채움
  const { templateXml } = require('../../demo/notice-text.js');
  const N0 = require('../../src/app/js/notice-logic.js');
  const tplBytes = Buffer.from(N0.zipStore([{ name: 'mimetype', data: Buffer.from('application/hwp+zip') }, { name: 'Contents/section0.xml', data: Buffer.from(templateXml('입찰공고')) }]));
  await page.click('#btnSettings');
  await page.click('#dlgSettings .dlg-tabs button[data-tab="notice"]');
  await page.waitForSelector('[data-slotup="입찰공고"]');
  const [slotFc] = await Promise.all([page.waitForEvent("filechooser"), page.click("[data-slotup=\"입찰공고\"]")]);
  await slotFc.setFiles({ name: "ipchal.hwpx", mimeType: 'application/octet-stream', buffer: tplBytes });
  await waitFor(() => page.$('.toast:has-text("입찰공고 양식을 올렸습니다")'), 10000, '입찰공고 양식 올리기');
  await page.waitForSelector('.tpl-slot.on:has-text("올린 양식"):has-text("바꿀 자리: 공고명")', { timeout: 10000 });
  await page.screenshot({ path: join(SHOTS, '7b-설정-공고문양식.png') });
  await page.keyboard.press('Escape');
  assert.match(await page.textContent('[data-nact="hwp"]'), /입찰공고 양식/);
  await page.click('[data-nact="hwp"]');
  await waitFor(() => readdirSync(join(data, '공고문', '작성')).filter((f) => f.includes('입찰공고')).length >= 2, 20000, '입찰공고 한글 파일');
  const outs = readdirSync(join(data, '공고문', '작성')).filter((f) => f.includes('입찰공고')).sort((x, y) => statSync(join(data, '공고문', '작성', y)).mtimeMs - statSync(join(data, '공고문', '작성', x)).mtimeMs);
  const xml2 = execFileSync('python3', ['-c', 'import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(z.read("Contents/section0.xml").decode())', join(data, '공고문', '작성', outs[0])]).toString().replace(/<\/hp:p>/g, '\n').replace(/<[^>]+>/g, '');
  assert.match(xml2, /공 사 명 : 신갈오거리 보안등 정비 전기공사/); assert.match(xml2, /지역제한\(용인시\)/); assert.match(xml2, /낙찰하한율\(87\.745%\)/);
  assert.match(xml2, /\[전기공사업\(○○○○\)\]/);
  await page.waitForSelector('.hreport.warn .hcheck li');
  await page.screenshot({ path: join(SHOTS, '7c-공고문-한글결과.png') });
  await page.click('#btnSettings');
  await page.click('#dlgSettings .dlg-tabs button[data-tab="notice"]');
  await page.click('[data-slotreset="입찰공고"]');
  await waitFor(() => page.$('.toast:has-text("회사 기본 양식으로 되돌렸습니다")'), 15000, '기본 양식으로 되돌리기');
  await waitFor(async () => !(await page.$('[data-slotreset]')), 5000, '되돌린 뒤 버튼 사라짐');
  await page.keyboard.press('Escape');
  step('다른 입찰공고 양식 올림 → 그 모양 그대로 채운 한글 파일 + 확인할 것 표시, [기본 양식으로] 되돌리기');

  // 진행 상태: 한글 파일을 만들면 작성 완료(나라장터 등록은 직접 하므로 번호 넣는 칸 없음) → 복사해서 새로 쓰기는 작성 중
  assert.match(await page.textContent('.lgroup'), /작성 완료/);
  assert.match(await page.textContent('.nstep.on'), /작성 완료/);
  assert.equal(await page.$('#g2bNo'), null, '번호 연결 칸 없음');
  assert.equal(await page.$$eval('.nstep', (x) => x.length), 2);
  await page.screenshot({ path: join(SHOTS, '8-공고문-작성완료.png') });
  await page.click('[data-nact="dup"]');
  assert.match(await page.textContent('.nstep.on'), /작성 중/);
  assert.deepEqual(await page.$$eval('.lgroup span', (s) => s.map((x) => x.textContent)), ['작성 중', '작성 완료']);
  step('진행 상태: 한글 파일 → 작성 완료(번호 연결 단계 없음), 복사해서 새로 쓰기 → 작성 중');

  // ===== 규정·질문 답변 =====
  // 법령(국가법령정보센터)·PC AI는 흉내 냄: /api/law → 검색·본문 JSON, /api/ai/status → 준비됨, 127.0.0.1:11434 → 답
  const lawRoute = (r) => {
    const u = decodeURIComponent(new URL(r.request().url()).searchParams.get('u'));
    let body;
    // 조문 형식이 아닌 예규: 본문 응답엔 조문내용이 없고 첨부파일(한글)만 → 프로그램이 첨부파일을 받아 읽음
    if (u.includes('/LSW/flDownload.do')) return r.fulfill({ status: 200, contentType: 'application/octet-stream', body: Buffer.from(hwpBytes(['지방자치단체 입찰 및 계약 집행기준', '제6장 선금·대가 지급 운영요령', '1. 선금 지급', '가. 계약상대자가 청구하면 계약금액의 100분의 80 범위에서 선금을 지급할 수 있다.', '제13장 공사계약 일반조건', '1. 총칙', '가. 이 조건은 공사계약에 적용한다.', ...Array.from({ length: 60 }, (_, i) => `${i + 2}. 공사계약 일반조건 항목 ${i + 2} — 계약상대자는 계약문서에 따라 공사를 이행하여야 한다.`)])) });
    if (u.includes('lawService.do') && u.includes('target=admrul')) { const id = u.match(/ID=(\d+)/)[1]; return r.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: JSON.stringify({ AdmRulService: { 행정규칙기본정보: { 행정규칙일련번호: id, 조문형식여부: 'N' }, 조문내용: '', 첨부파일: { 첨부파일명: ['본문.hwp'], 첨부파일링크: [`http://www.law.go.kr/LSW/flDownload.do?flSeq=${id}`] } } }) }); }
    if (u.includes('lawSearch.do')) { const q = decodeURIComponent(u.match(/query=([^&]+)/)[1]); body = u.includes('target=admrul') ? { AdmRulSearch: { admrul: [{ 행정규칙명: q, 행정규칙일련번호: '9' + q.length }] } } : { LawSearch: { law: [{ 법령명한글: q, 법령일련번호: '1' + q.length, 현행연혁코드: '현행', 시행일자: '20260101' }] } }; }
    else body = { 법령: { 조문: { 조문단위: [{ 조문번호: '9', 조문내용: '제9조(계약의 방법) ① 지방자치단체의 장은 일반입찰에 부쳐야 한다.', 항: [{ 항내용: '② 다만 추정가격이 2천만원 이하인 물품·용역은 수의계약을 할 수 있다.' }] }, { 조문번호: '35', 조문내용: '제35조(선금) 계약금액의 100분의 70을 초과하지 아니하는 범위에서 선금을 지급할 수 있다.' }] } } };
    r.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: JSON.stringify(body) });
  };
  await page.route('**/api/ai/status', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, installed: true, status: { state: 'ready' } }) }));
  let localPrompt = '';
  await page.route('http://127.0.0.1:11434/**', (r) => {
    const u = r.request().url();
    if (u.endsWith('/api/tags')) return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ models: [{ name: 'gemma3:4b' }] }) });
    const b = JSON.parse(r.request().postData() || '{}'); localPrompt = (b.messages || []).map((m) => m.content).join('\n');
    return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ message: { role: 'assistant', content: '1) 결론: 선금은 계약금액의 70%까지 지급할 수 있습니다.\n2) 근거: 「우리 계약규정」 제15조, 「지방자치단체를 당사자로 하는 계약에 관한 법률 시행령」 제35조.\n3) 회신: 선금은 계약금액의 100분의 70 범위에서 신청하실 수 있습니다.' } }) });
  });
  // IP 미등록이면 처음 화면에 이 PC의 공인 IP를 알아내 [IP 복사]·[등록하러 가기]
  await page.route('**/api/myip', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ip: '211.234.10.20' }) }));
  await page.route('**/api/law**', (r) => r.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: JSON.stringify({ result: '사용자 정보 검증에 실패하였습니다.', msg: 'OPEN API 호출 시 사용자 검증을 위하여 정확한 서버장비의 IP주소 및 도메인주소를 등록해 주세요.' }) }));
  await page.click('.brand'); await page.evaluate(() => JH.app.checkAccounts());
  await page.waitForSelector('#acctLine [data-copyip="211.234.10.20"]', { timeout: 15000 });
  assert.match(await page.textContent('#acctLine'), /211\.234\.10\.20가 국가법령정보센터에 등록되지 않았습니다/);
  await waitFor(async () => /현재 이 PC의 IP는 211\.234\.10\.20 입니다/.test(await page.textContent('#acctLine')), 10000, '현재 IP 표시');
  await page.screenshot({ path: join(SHOTS, '0b-연결상태.png') });
  await page.unroute('**/api/law**');
  await page.route('**/api/law**', lawRoute);
  await page.click('.views [data-view="rules"]');
  await page.waitForSelector('[data-rtab="src"]');
  await page.click('[data-rtab="src"]');
  // 우리 규정집 올리기(글 파일) → 조 단위
  const [fcR] = await Promise.all([page.waitForEvent('filechooser'), page.click('label:has(#rlUp)')]);
  await fcR.setFiles({ name: '계약사무처리규정.txt', mimeType: 'text/plain', buffer: Buffer.from('제1장 총칙\n제1조(목적) 이 규정은 공사 계약 사무를 정한다.\n제15조(선금 지급) ① 선금은 계약금액의 100분의 70 범위에서 지급한다.\n② 선금을 받으려는 자는 보증서를 제출하여야 한다.\n제16조(하자보수보증금) 공사 준공 시 하자보수보증금을 납부하거나 지급각서를 제출한다.') });
  await waitFor(() => page.$('.toast:has-text("규정 1개를 읽어")'), 15000, '규정 올리기');
  assert.match(await page.textContent('.rsrc-list'), /계약사무처리규정[\s\S]*조항 3개/);
  // 법령 받기(OC 넣고)
  assert.equal(await page.inputValue('#rlOc'), 'contracthelper', '공용 OC가 들어 있음'); await page.fill('#rlOc', 'tester'); await page.click('[data-ract="laws"]');
  await waitFor(() => page.$('.toast:has-text("법령·예규")'), 30000, '법령 받기');
  const got = await page.evaluate(() => JH.rules.kb.sources.filter((s) => s.auto).map((s) => [s.name, s.chunks.length]));
  assert.ok(got.length >= 20 && got.filter(([n]) => !/집행기준|결정기준/.test(n)).every(([, n]) => n === 2), JSON.stringify(got));
  const admr = await page.evaluate(() => JH.rules.kb.sources.filter((s) => s.auto && /집행기준/.test(s.name)).map((s) => ({ from: s.from, hs: s.chunks.map((c) => c.h) }))[0]);
  assert.match(admr.from, /첨부파일/); assert.ok(admr.hs.some((h) => /제13장 공사계약 일반조건/.test(h)), JSON.stringify(admr.hs));
  assert.ok(!(await page.evaluate(() => JH.rules.kb.sources.some((s) => /공사계약 일반조건$/.test(s.name)))), '일반조건은 따로 받지 않음(집행기준 안)');
  // 규정 개정: 바뀐 조만 올리면 같은 조를 바꿔 끼움 + 언제 개정분까지인지
  const [fcA] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-ract="amend"]')]);
  await fcA.setFiles({ name: '계약사무처리규정_일부개정.txt', mimeType: 'text/plain', buffer: Buffer.from('계약사무처리규정 일부개정 <개정 2026. 10. 1.>\n제15조(선금 지급) ① 선금은 계약금액의 100분의 80 범위에서 지급한다. <개정 2026. 10. 1.>\n제16조 삭제 <2026. 10. 1.>\n제17조(기성 지급) 기성은 검사 후 14일 안에 지급한다. <신설 2026. 10. 1.>') });
  await waitFor(() => page.$('.toast:has-text("개정 조문을 반영했습니다")'), 15000, '개정 반영');
  const amd = await page.evaluate(() => { const s = JH.rules.kb.sources.find((x) => x.mine); return { hs: s.chunks.map((c) => c.h), t15: s.chunks.find((c) => /제15조/.test(c.h)).t, rev: s.rev }; });
  assert.deepEqual(amd.hs, ['제1조(목적)', '제15조(선금 지급)', '제17조(기성 지급)']); assert.match(amd.t15, /100분의 80/); assert.equal(amd.rev, '20261001');
  assert.match(await page.textContent('.rsrc-list'), /개정 반영 1번/); assert.equal(await page.inputValue('.rrev input'), '2026-10-01');
  assert.match(await page.textContent('.rules-head'), /2026\.10\.01 개정분까지/);
  assert.equal(JSON.parse(readFileSync(join(data, '설정.json'), 'utf8')).lawOC, 'tester');
  // 질문 → 근거(우리 규정 + 시행령) → PC AI 답 → 저장(학습) → 다시 물으면 저장한 답이 먼저
  await page.click('[data-rtab="ask"]');
  await page.fill('#rqQ', '선금은 계약금액의 몇 퍼센트까지 지급할 수 있나요?');
  await page.click('[data-ract="ask"]');
  await waitFor(async () => /70%까지/.test(await page.inputValue('#rqA').catch(() => '')), 30000, 'AI 답');
  assert.match(localPrompt, /\[근거\][\s\S]*계약사무처리규정 제15조\(선금 지급\)[\s\S]*100분의 80/); assert.match(localPrompt, /시행령 제35조\(선금\)/); assert.match(localPrompt, /지어내지 않습니다/);
  assert.match(await page.textContent('.rq-refs'), /계약사무처리규정/);
  await page.fill('#rqA', '선금은 계약금액의 70%까지입니다(우리 규정 제15조). 보증서를 먼저 받으세요.');
  await page.click('[data-ract="save"]');
  await waitFor(() => page.$('.toast:has-text("저장했습니다")'), 10000, '질문답변 저장');
  assert.equal(JSON.parse(readFileSync(join(data, '규정', '질문답변.json'), 'utf8')).items.length, 1);
  await page.fill('#rqQ', '선금 몇 퍼센트까지 가능한가요'); await page.click('[data-ract="ask"]');
  await page.waitForSelector('.rq-prev:has-text("보증서를 먼저 받으세요")', { timeout: 30000 });
  await page.click('[data-rtab="qa"]'); assert.match(await page.textContent('.rqa'), /선금은 계약금액의 몇 퍼센트까지/);
  // 저장한 질문답변 나누기: 올릴 것에 들어가고, 동료 것은 받아 쌓되 내가 저장한 같은 질문은 내 답 그대로
  {
    const r = await page.evaluate(async () => {
      const R = JH.rules, Sv = JH.server; const sent = [];
      const og = Sv.shareGet, op = Sv.sharePost;
      Sv.sharePost = async (x, kind) => { sent.push({ kind, x }); return { ok: true }; };
      const mine = R.qa.items[0];
      Sv.shareGet = async (kind) => ({ ok: true, bodies: kind !== 'qa' ? [] : ['```json\n' + JSON.stringify([
        { id: 'colleague1', q: '수의계약 견적 제출 기간은?', a: '동료 답: 공고일부터 3일 이상', at: '2026-10-20T00:00:00Z' },
        { id: 'colleague2', q: mine.q, a: '다른 답', at: '2030-01-01T00:00:00Z' }]) + '\n```'] });
      try {
        const pend = (R.qa.pending || []).length;
        await R.pushQa();
        const n = await R.pullQa();
        return { pend, sent: sent.filter((s) => s.kind === 'qa').flatMap((s) => s.x.map((y) => y.q)), n, items: R.qa.items.map((x) => [x.q, x.a, !!x.shared]), myA: mine.a, left: (R.qa.pending || []).length };
      } finally { Sv.shareGet = og; Sv.sharePost = op; }
    });
    assert.equal(r.pend, 1, '저장하면 올릴 것에 들어감');
    assert.ok(r.sent.some((q) => /선금은 계약금액/.test(q)), '질문답변 올림');
    assert.equal(r.left, 0, '올린 뒤 비움');
    assert.equal(r.n, 1, '동료 것 1건만 받음(같은 질문은 내 답 유지)');
    assert.ok(r.items.some(([q, a, sh]) => /견적 제출 기간/.test(q) && sh), '동료 질문답변 받음');
    assert.ok(!r.items.some(([, a]) => a === '다른 답'), '내 답은 그대로');
    await page.click('[data-rtab="ask"]'); await page.click('[data-rtab="qa"]');
    assert.match(await page.textContent('.rqa'), /견적 제출 기간[\s\S]*동료/);
  }
  step('저장한 질문답변 나누기: 저장하면 GitHub 이슈로 올리고, 동료가 저장한 것은 받아 [질문답변 모음]에(동료 표시), 같은 질문은 내 답 우선');
  await page.screenshot({ path: join(SHOTS, '7-규정질문답변.png') });
  step('규정·질문 답변: 규정집 올려 조 단위로, 법령·예규 20건 자동으로 받기(국가법령정보센터, 조문 아닌 예규는 첨부파일까지), 규정 개정 조문만 올려 바꿔 끼우기·개정분 날짜, 질문 → 근거 찾아 PC AI 답 → 저장(학습) → 비슷한 질문에 저장한 답 먼저');

  // 계약별 목록 너비: 경계를 끌어 넓히면 기억, 두 번 누르면 원래대로
  await page.click('.views [data-view="contracts"]');
  const listW = () => page.$eval('#view-contracts .list', (x) => Math.round(x.getBoundingClientRect().width));
  const w0 = await listW();
  const sp = await (await page.$('.splitter[data-split="contracts"]')).boundingBox();
  await page.mouse.move(sp.x + 1, sp.y + 200); await page.mouse.down(); await page.mouse.move(sp.x + 260, sp.y + 200, { steps: 6 }); await page.mouse.up();
  const w1 = await listW();
  assert.ok(w1 > w0 + 200, `목록이 넓어짐 ${w0} → ${w1}`);
  assert.ok(await page.$('#view-contracts.wide-list'), '넓으면 긴 계약명 두 줄');
  assert.equal(await page.evaluate(() => localStorage.getItem('jh.listW.contracts')), String(w1));
  await page.screenshot({ path: join(SHOTS, '9-계약별-넓힘.png') });
  const sp2 = await (await page.$('.splitter[data-split="contracts"]')).boundingBox();
  await page.mouse.dblclick(sp2.x + 1, sp2.y + 200);
  assert.equal(await listW(), w0, '두 번 누르면 원래대로');
  step('계약별 목록 너비 끌어서 조절(기억, 두 번 누르면 원래대로), 넓으면 긴 계약명 두 줄');

  // 금액 칸: 치는 대로 쉼표(계약 직접 추가 창의 계약금액)
  {
    await page.click('#btnNewContract'); await page.waitForSelector('#dlgContract[open]');
    await page.fill('#ctAmount', ''); await page.type('#ctAmount', '123456789');
    assert.equal(await page.inputValue('#ctAmount'), '123,456,789', '쉼표 자동');
    await page.keyboard.press('Backspace'); assert.equal(await page.inputValue('#ctAmount'), '12,345,678', '지워도 쉼표 다시');
    await page.keyboard.press('Escape'); await page.waitForSelector('#dlgContract[open]', { state: 'detached' }).catch(() => {});
  }
  step('금액 칸: 치는 대로 세 자리마다 쉼표');

  // 날짜 칸: 달력에서 고르지 않고 숫자로(20261023 → 2026-10-23), 틀린 날짜는 비우고 알림
  {
    await page.click('#btnNewContract'); await page.waitForSelector('#dlgContract[open]');
    await page.click('#ctStart'); await page.keyboard.type('20261023');
    assert.equal(await page.inputValue('#ctStart'), '2026-10-23', '날짜 자동 꼴');
    await page.click('#ctEnd'); await page.keyboard.type('271231'); await page.keyboard.press('Tab');
    assert.equal(await page.inputValue('#ctEnd'), '2027-12-31', '6자리 → 20xx');
    await page.fill('#ctEnd', ''); await page.click('#ctEnd'); await page.keyboard.type('20261341'); await page.keyboard.press('Tab');
    assert.equal(await page.inputValue('#ctEnd'), '', '없는 날짜는 비움');
    await page.keyboard.press('Escape'); await page.waitForSelector('#dlgContract[open]', { state: 'detached' }).catch(() => {});
  }
  step('날짜 칸: 숫자만 쳐도 2026-10-23(6자리·4자리도), 없는 날짜는 비우고 알림');

  // 왼쪽 목록의 계약 위에 끌어 놓으면 그 계약으로(내용상 다른 계약 서류여도)
  {
    await page.click('.vgroup [data-view="contracts"], nav [data-view="contracts"]').catch(() => page.evaluate(() => document.querySelector('[data-view="contracts"]').click()));
    await page.waitForSelector('.citem[data-key]');
    const bytes = [...readFileSync(join(DOCS, 'noname(2).pdf')), ...Buffer.from('\n%drop-test\n')];
    const key = await page.evaluate(() => { const els = [...document.querySelectorAll('.citem[data-key]')]; return els[els.length - 1].dataset.key; });
    await page.evaluate(({ key, bytes }) => {
      const el = document.querySelector(`.citem[data-key="${CSS.escape(key)}"]`);
      const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(bytes)], '목록에놓기.pdf', { type: 'application/pdf' }));
      for (const t of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, { key, bytes });
    await waitFor(() => page.evaluate(() => JH.app.db.docs.some((d) => d.name.startsWith('목록에놓기') || (d.from || '').startsWith('목록에놓기'))), 60000, '목록에 놓은 서류 들어감');
    const got = await page.evaluate(() => { const d = JH.app.db.docs.find((x) => x.name.startsWith('목록에놓기') || (x.from || '').startsWith('목록에놓기')); return d && d.key; });
    assert.equal(got, key, '놓은 계약으로');
    await waitFor(async () => !(await page.isVisible('#progress')), 60000, '정리 끝');
    await page.waitForTimeout(1500);
  }
  step('왼쪽 목록의 계약 위에 끌어 놓으면 그 계약으로 들어감');

  // 이미 올린 파일인데 종류를 못 정한 채 있으면: 다시 올렸을 때 건너뛰지 않고 다시 정리(모르면 팝업)
  {
    const pick = await page.evaluate((names) => { const d = JH.app.db.docs.find((x) => names.includes(x.name) && x.key && x.itemId && !x.pay); if (!d) return null; d.itemId = null; return { id: d.id, name: d.name }; }, readdirSync(DOCS));
    assert.ok(pick, '시험할 서류');
    await page.setInputFiles('#fileIn', join(DOCS, pick.name));
    await waitFor(() => page.$('.toast:has-text("다시 정리")'), 60000, '다시 정리 알림');
    assert.ok(!(await page.$('.toast:has-text("건너뛰었습니다")')), '건너뛰지 않음');
    const st = await page.evaluate((id) => { const d = JH.app.db.docs.find((x) => x.id === id); return { item: d.itemId, popup: document.querySelector('#dlgPreview').open }; }, pick.id);
    assert.ok(st.item || st.popup, '다시 분류되거나 팝업');
    if (st.popup) { await page.keyboard.press('Escape'); }
    await waitFor(async () => !(await page.isVisible('#progress')), 60000, '정리 끝'); await page.waitForTimeout(1000);
  }
  step('전에 올렸는데 종류를 못 정한 파일은 다시 올리면 건너뛰지 않고 다시 정리(모르면 바로 팝업)');

  // 창을 반으로 줄여 나란히 써도(960·720) 가로로 밀리지 않음
  {
    const vp = page.viewportSize();
    for (const w of [960, 720]) {
      await page.setViewportSize({ width: w, height: 900 });
      for (const v of ['home', 'contracts', 'board', 'inbox', 'notice', 'rules']) {
        await page.evaluate((v) => { const b = document.querySelector(`[data-view="${v}"]`); if (b) b.click(); }, v); await page.waitForTimeout(400);
        const bad = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 2 && !e.closest('dialog') && getComputedStyle(e).position !== 'fixed' && !e.closest('.views'); }).slice(0, 3).map((e) => e.tagName + '.' + e.className + '#' + e.id));
        assert.deepEqual(bad, [], `${w}px ${v} 화면이 옆으로 넘침`);
        assert.ok(await page.evaluate(() => { const r = document.querySelector('#btnSettings').getBoundingClientRect(); return r.right <= innerWidth; }), `${w}px 설정 버튼 보임`);
      }
    }
    await page.setViewportSize(vp);
    await page.evaluate(() => document.querySelector('[data-view="contracts"]').click()); await page.waitForTimeout(500);
  }
  step('창을 반으로 줄여도(960·720px) 화면이 옆으로 넘치지 않고 위 버튼이 다 보임');

  // 탭: 한 창 안에서 계약 A·계약 B를 탭으로 열어 두고 오감(고른 계약이 탭마다 남음)
  {
    await page.evaluate(() => document.querySelector('nav [data-view="contracts"]').click()); await page.waitForSelector('.citem[data-key]');
    const keys = await page.$$eval('.citem[data-key]', (xs) => xs.map((x) => x.dataset.key));
    await page.click(`.citem[data-key="${keys[0]}"]`);
    await page.click('#tabAdd');
    await page.click(`.citem[data-key="${keys[1]}"]`);
    assert.equal(await page.$$eval('.tab-it', (x) => x.length) >= 2, true, '탭 둘');
    const n = await page.$$eval('.tab-it', (x) => x.length);
    await page.click(`.tab-it >> nth=${n - 2}`);
    assert.equal(await page.$eval('.citem.on', (x) => x.dataset.key), keys[0], '앞 탭은 계약 A');
    await page.click(`.tab-it >> nth=${n - 1}`);
    assert.equal(await page.$eval('.citem.on', (x) => x.dataset.key), keys[1], '뒤 탭은 계약 B');
    await page.click(`.tab-it >> nth=${n - 1} >> .tx`);
    assert.equal(await page.$$eval('.tab-it', (x) => x.length), n - 1, '탭 닫기');
    // 확인 팝업: 서류 종류도 글자로 찾기
    await page.click('#detail [data-act="view"] >> nth=0'); await page.waitForSelector('#dlgPreview[open]');
    await page.fill('#pvItemSearch', '가입자명부');
    assert.match(await page.$eval('#pvItem', (s) => s.options[s.selectedIndex].textContent), /가입자명부/, '서류 종류 검색');
    await page.click('#dlgPreview button[value="close"]'); await page.waitForFunction(() => !document.querySelector('#dlgPreview').open);
  }
  step('탭: 한 창 안에서 계약·공고문을 탭으로 열어 두고 오감(탭마다 고른 것 기억, 닫기) · 확인 팝업 서류 종류도 글자로 찾기');

  // 쪽별로 나누기: 한 파일에 계약서(1~2쪽)·4대보험(3~4쪽)·지방세(5쪽)·국세(6쪽)를 스캔한 PDF → 서류마다 따로
  {
    const mk = await page.context().newPage();
    const pg = (t, lines) => `<section style="page-break-after:always;font-family:'Noto Sans CJK KR';padding:40px">${t ? `<h1 style="font-size:38px;text-align:center">${t}</h1>` : ''}${lines.map((l) => `<p style="font-size:20px">${l}</p>`).join('')}</section>`;
    await mk.setContent('<body style="margin:0">' + [
      pg('공사 계약서', ['계약번호 : R26BK01234567-00', '계약건명 : 시청사 옥상 방수공사']),
      pg('', ['제5조 계약금액 지급', '제6조 하자보수']),
      pg('사업장 가입내역 확인서', ['4대 사회보험 사업장 가입내역', '사업장명 : 다해토건']),
      pg('', ['가입자 목록(이어짐)']),
      pg('지방세 납세증명서', ['지방세 체납액 없음']),
      pg('납세증명서', ['국세 체납액 없음']),
    ].join('') + '</body>');
    const bundle = await mk.pdf({ format: 'A4' }); await mk.close();
    await page.evaluate(() => document.querySelector('nav [data-view="contracts"]').click()); await page.waitForSelector('.citem[data-key]');
    const key = await page.evaluate(() => Object.values(JH.app.db.contracts).find((c) => c.name === '시청사 옥상 방수공사').key);
    await page.click(`.citem[data-key="${key}"]`);
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-act="addhere"]')]);
    await fc.setFiles([{ name: '스캔묶음.pdf', mimeType: 'application/pdf', buffer: bundle }]);
    await waitFor(() => page.evaluate(() => JH.app.db.docs.some((d) => d.name === '스캔묶음.pdf')), 60000, '묶음 올림');
    await waitFor(async () => !(await page.isVisible('#progress')), 60000, '정리 끝'); await page.waitForTimeout(800);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    const id = await page.evaluate(() => JH.app.db.docs.find((d) => d.name === '스캔묶음.pdf').id);
    await page.click(`[data-act="split"][data-doc="${id}"]`);
    await page.waitForSelector('#spRows .sp-row', { timeout: 60000 });
    const rowsTxt = () => page.$$eval('#spRows .sp-row', (rs) => rs.map((r) => `${r.querySelector('.sp-pin').value}쪽 ${r.querySelector('select').selectedOptions[0].textContent}`));
    const plan = await rowsTxt();
    assert.deepEqual(plan, ['1~2쪽 계약 · 계약서', '3~4쪽 착공계 · 4대 사회보험 가입증명서', '5쪽 대금청구 · 지방세 납세증명서', '6쪽 대금청구 · 국세 납세증명서'], '나눌 안: ' + plan.join(' / '));
    await page.waitForSelector('#spView .sp-pgv[data-p="6"]', { timeout: 30000 });
    await page.screenshot({ path: join(SHOTS, '10-쪽별로나누기.png') });
    // 쪽 그림 누르기: 3번째 줄(5쪽 지방세)을 고르고 6쪽을 누르면 6쪽이 지방세로(국세 줄은 비어 사라짐)
    const pick = async (pn) => { await page.click(`#spView .sp-pgv[data-p="${pn}"]`); await page.waitForTimeout(400); };
    await page.click('#spRows .sp-row >> nth=2'); await pick(6);
    assert.deepEqual((await rowsTxt()).map((x) => x.split(' ')[0]), ['1~2쪽', '3~4쪽', '5~6쪽'], '쪽 눌러 옮기기');
    // [+ 새 서류] → 6쪽을 누르고 '국세'로 찾아 고르기
    await page.click('#spAddRow'); await pick(6);
    await page.fill('#spRows .sp-row.on .cpick-q', '국세');
    assert.deepEqual(await rowsTxt(), plan, '새 서류에 쪽 넣고 종류 고르기');
    // 떨어진 쪽 묶기: 1번째 줄을 고르고 Shift로 3~4쪽은 아니고 5쪽만 — 확인 후 되돌림
    await page.click('#spRows .sp-row >> nth=0'); await pick(5);
    assert.match((await rowsTxt())[0], /^1~2, 5쪽/, '떨어진 쪽도 한 서류로');
    // 지방세 줄은 비어 사라졌으므로 [+ 새 서류]로 5쪽을 다시 지방세로
    if ((await rowsTxt()).length !== 4) { await page.click('#spAddRow'); await pick(5); await page.fill('#spRows .sp-row.on .cpick-q', '지방세'); }
    assert.deepEqual(await rowsTxt(), plan, '다시 원래 안');
    // 두 번 누르면 그 쪽부터 새 서류 → ✕로 다시 앞 서류에
    await page.dblclick('#spView .sp-pgv[data-p="2"]'); await page.waitForTimeout(400);
    assert.deepEqual((await rowsTxt()).map((x) => x.split(' ')[0]), ['1쪽', '2쪽', '3~4쪽', '5쪽', '6쪽'], '두 번 눌러 자르기');
    await page.click('#spRows .sp-row >> nth=1 >> [data-spdel]');
    assert.deepEqual(await rowsTxt(), plan, '✕면 앞 서류에 붙음');
    await page.click('#spSave');
    await waitFor(() => page.evaluate(() => !JH.app.db.docs.some((d) => d.name === '스캔묶음.pdf')), 60000, '나눔');
    const got = await page.evaluate((k) => JH.app.db.docs.filter((d) => d.splitFrom === '스캔묶음.pdf').map((d) => [d.name, d.itemId, d.key === k]), key);
    assert.deepEqual(got.map((x) => x[1]), ['c-contract', 'c-insjoin', 'c-ltax', 'c-tax'], '서류마다 칸으로');
    assert.ok(got.every((x) => x[2]), '같은 계약');
    assert.match(got[0][0], /_1-2쪽\.pdf$/, got[0][0]);
    // 되돌리기: 나눈 파일은 빠지고 원래 묶음이 돌아옴
    await page.click('#btnUndo');
    await waitFor(() => page.evaluate(() => JH.app.db.docs.some((d) => d.name === '스캔묶음.pdf') && !JH.app.db.docs.some((d) => d.splitFrom === '스캔묶음.pdf')), 30000, '되돌림');
    await waitFor(async () => !(await page.isVisible('#progress')), 30000, '정리 끝'); await page.waitForTimeout(2500); // 뒤에서 하는 저장이 끝나게
  }
  step('쪽별로 나누기: 한 파일에 스캔한 계약서(1~2쪽)·4대보험(3~4쪽)·지방세(5쪽)·국세(6쪽)를 서류마다 잘라 각 칸으로, 원래 파일은 _삭제됨(되돌리기)');

  // 깨진 스캔 글자로 만들어진 계약: [계약 지우기]로 서류는 미분류, 계약은 지움(되돌리기 가능)
  {
    const junkKey = await page.evaluate(async () => {
      const A = JH.app, db = A.db, k = 'junk-' + Date.now();
      db.contracts[k] = { key: k, source: 'doc', type: '용역', name: ".,'(신갈동 40-36)석명하체 및. ㅓ리용역 _ _. ㅗ ㄱㄱ 기시,", nums: [], officer: A.cfg.officer || '', updatedAt: Date.now() };
      await A.saveDb(true); A.render(); return k;
    });
    assert.equal(await page.evaluate(() => JH.logic.goodName(Object.values(JH.app.db.contracts).find((c) => c.key.startsWith('junk-')).name)), false);
    await page.evaluate(() => document.querySelector('nav [data-view="contracts"]').click());
    await page.click(`.citem[data-key="${junkKey}"]`);
    await page.click('#detail [data-act="edit"]'); await page.waitForSelector('#dlgContract[open]');
    assert.ok(await page.isVisible('#ctDelete'), '나라장터 계약이 아니면 지우기 버튼');
    page.once('dialog', (d) => d.accept());
    await page.click('#ctDelete');
    await waitFor(() => page.evaluate((k) => !JH.app.db.contracts[k], junkKey), 15000, '계약 지움');
    await waitFor(() => page.$('.toast:has-text("계약을 지웠습니다")'), 15000, '지우기 끝');
    await page.click('#btnUndo');
    await waitFor(() => page.evaluate((k) => !!JH.app.db.contracts[k], junkKey), 15000, '되돌림');
    await page.evaluate(async (k) => { delete JH.app.db.contracts[k]; await JH.app.saveDb(true); JH.app.render(); }, junkKey);
  }
  step('깨진 스캔 글자로 만들어진 계약은 [계약 지우기](나라장터 계약이 아닐 때) — 서류는 미분류로, 되돌리기 가능');

  // 올릴 때마다 확인(기본): 확실히 찾은 서류도 팝업으로 보여 줌 — 고용·산재 가입증명원
  {
    await page.evaluate(async () => { JH.app.cfg.uploadConfirm = true; await JH.app.saveCfg(); document.querySelectorAll('dialog[open]').forEach((d) => d.close()); });
    const mk = await page.context().newPage();
    await mk.setContent(`<body style="font-family:'Noto Sans CJK KR';padding:40px"><h1 style="text-align:center">고용·산재보험 보험관계성립(가입)증명원</h1><p>공사명 : 시청사 옥상 방수공사</p><p>사업장 : (주)다해토건</p></body>`);
    const pdf = await mk.pdf({ format: 'A4' }); await mk.close();
    await page.evaluate(() => document.querySelector('nav [data-view="contracts"]').click());
    await page.setInputFiles('#fileIn', [{ name: '고용산재가입증명원.pdf', mimeType: 'application/pdf', buffer: pdf }]);
    await page.waitForSelector('#dlgPreview[open]', { timeout: 60000 });
    assert.match(await page.$eval('#pvContract', (s) => s.selectedOptions[0].textContent), /시청사 옥상 방수공사/, '추천 계약 골라 둠');
    assert.match(await page.$eval('#pvItem', (s) => s.selectedOptions[0].textContent), /고용·산재 가입증명원/, '서류 종류 골라 둠');
    assert.match(await page.textContent('#pvWhy'), /이렇게 넣었습니다/);
    await page.click('nav [data-view="board"]').catch(() => {}); // (팝업 뒤 화면을 현황판으로 바꿔 둠 — 팝업이 막고 있으면 무시)
    await page.evaluate(() => JH.app.setView('board'));
    await page.click('#pvSave'); await page.waitForFunction(() => !document.querySelector('#dlgPreview').open);
    await page.waitForSelector('#view-contracts.on', { timeout: 5000 });
    assert.match(await page.textContent('#detail .cname'), /시청사 옥상 방수공사/, '확인을 마치면 그 계약 화면으로');
    // 다른 창(설정)이 열려 있을 때 올리면: 설정을 닫는 즉시 확인 팝업
    await page.click('#btnSettings'); await page.waitForSelector('#dlgSettings[open]');
    await page.evaluate(() => JH.app.ingest([new File([new Uint8Array([37, 80, 68, 70])], '통장 사본.pdf', { type: 'application/pdf' })], null, null));
    await waitFor(() => page.evaluate(() => JH.app.db.docs.some((d) => d.name === '통장 사본.pdf')), 30000, '통장 올림');
    await page.waitForTimeout(800);
    assert.ok(!(await page.evaluate(() => document.querySelector('#dlgPreview').open)), '설정 창이 열려 있는 동안은 기다림');
    await page.evaluate(() => document.querySelector('#dlgSettings').close());
    await page.waitForSelector('#dlgPreview[open]', { timeout: 5000 });
    await page.click('#dlgPreview button[value="close"]');
    await page.evaluate(async () => { JH.app.cfg.uploadConfirm = false; await JH.app.saveCfg(); });
    await waitFor(async () => !(await page.isVisible('#progress')), 30000, '정리 끝'); await page.waitForTimeout(1000);
  }
  step('올릴 때마다 확인(기본): 확실히 찾은 서류도 팝업으로 보여 주고(추천 계약·종류 골라 둠) [이대로 저장]');

  // 이미 있는 파일을 다시 올리면: 말없이 넘기지 않고 지금 자리를 팝업으로(넘겨도 그 자리 그대로)
  {
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    const dn = await page.evaluate(() => (JH.app.db.docs.find((x) => x.key && x.itemId && !x.missing && x.path && x.kind === 'pdf' && x.size < 3e6) || {}).name);
    const before = await page.evaluate((n) => { const d = JH.app.db.docs.find((x) => x.name === n); return { key: d.key, item: d.itemId, n: JH.app.db.docs.length }; }, dn);
    await page.evaluate(async (n) => { const d = JH.app.db.docs.find((x) => x.name === n); const b = await JH.server.readBytes(d.path); JH.app.cfg.uploadConfirm = true; await JH.app.saveCfg(); await JH.app.ingest([new File([b], n, { type: 'application/pdf' })], null, null); }, dn);
    await page.waitForSelector('#dlgPreview[open]', { timeout: 10000 });
    assert.match(await page.textContent('#pvWhy'), /이미 올린 파일/, '다시 올리면 지금 자리를 팝업으로');
    await page.click('#dlgPreview button[value="close"]'); await page.waitForTimeout(800);
    const after = await page.evaluate((n) => { const d = JH.app.db.docs.find((x) => x.name === n); return { key: d.key, item: d.itemId, n: JH.app.db.docs.length }; }, dn);
    assert.deepEqual(after, before, '넘기면 그 자리 그대로, 새로 넣지 않음');
    await page.evaluate(async () => { JH.app.cfg.uploadConfirm = false; await JH.app.saveCfg(); });
  }
  step('이미 있는 파일을 다시 올리면 새로 넣지 않고 지금 자리를 팝업으로 보여 줌');
  // 칸에 직접 넣으면(계약·서류 종류를 사람이 정함) 묻지 않고 그 칸에 · 계약만 정해 넣고 팝업을 넘기면 그 계약에 그대로(미분류로 안 감)
  {
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    const r = await page.evaluate(async () => {
      const A = JH.app, c = Object.values(A.db.contracts).find((x) => x.name === '시청사 옥상 방수공사');
      A.cfg.uploadConfirm = true; await A.saveCfg();
      await A.ingest([new File([new Uint8Array([37, 80, 68, 70, 1, 2])], '직접넣기_시험.pdf', { type: 'application/pdf' })], c.key, 'c-related');
      await new Promise((ok) => setTimeout(ok, 800));
      const d = A.db.docs.find((x) => x.name === '직접넣기_시험.pdf');
      return { key: d.key === c.key, item: d.itemId, popup: document.querySelector('#dlgPreview').open, ck: c.key };
    });
    assert.deepEqual([r.key, r.item, r.popup], [true, 'c-related', false], '칸에 직접 넣으면 묻지 않음 ' + JSON.stringify(r));
    await page.evaluate(async (k) => { await JH.app.ingest([new File([new Uint8Array([37, 80, 68, 70, 3, 4, 5])], '계약만정함_시험.pdf', { type: 'application/pdf' })], k, null); }, r.ck);
    await page.waitForSelector('#dlgPreview[open]', { timeout: 10000 });
    await page.click('#dlgPreview button[value="close"]'); await page.waitForTimeout(800);
    assert.ok(await page.evaluate((k) => JH.app.db.docs.find((x) => x.name === '계약만정함_시험.pdf').key === k, r.ck), '계약을 정해 넣은 것은 넘겨도 그 계약에');
    // 오른쪽 위 [업로드](계약을 안 정함)로 넣고 저장하지 않고 닫으면 미분류로(고른 계약은 추천으로 남김)
    await page.evaluate(async () => { await JH.app.ingest([new File([new Uint8Array([37, 80, 68, 70, 6, 7, 8, 9])], '시청사 옥상 방수공사_통장사본_시험.pdf', { type: 'application/pdf' })], null, null); });
    await page.waitForSelector('#dlgPreview[open]', { timeout: 10000 });
    const had = await page.evaluate(() => JH.app.db.docs.find((x) => x.name === '시청사 옥상 방수공사_통장사본_시험.pdf').key);
    await page.click('#dlgPreview button[value="close"]');
    await waitFor(() => page.evaluate(() => { const d = JH.app.db.docs.find((x) => x.name === '시청사 옥상 방수공사_통장사본_시험.pdf'); return d && !d.key && /^미분류\//.test(d.path); }), 10000, '닫으면 미분류');
    if (had) assert.ok(await page.evaluate((k) => (JH.app.db.docs.find((x) => x.name === '시청사 옥상 방수공사_통장사본_시험.pdf').cands || [])[0] === k, had), '고른 계약은 추천으로');
    await page.evaluate(async () => { JH.app.cfg.uploadConfirm = false; await JH.app.saveCfg(); });
  }
  step('칸에 직접 넣으면 묻지 않음 · 계약을 정해 넣은 것은 팝업을 넘겨도 미분류로 안 감');

  // 여러 파일·여러 확장자(PDF·한글·엑셀·옛 엑셀·워드·그림·텍스트)를 한 번에 올려도 하나씩 팝업으로 차례로 뜸
  {
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    await page.evaluate(async () => { JH.app.cfg.uploadConfirm = true; await JH.app.saveCfg(); });
    const one = Buffer.from(await (async () => { const d = await PDFDocument.create(); d.addPage(); return d.save(); })());
    const xls = readFileSync(new URL('../fixtures/old-estimate.xls', import.meta.url));
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const files = [
      { name: '여러개_시청사 옥상 방수공사_준공사진.pdf', mimeType: 'application/pdf', buffer: one },
      { name: '여러개_착공계.hwp', mimeType: 'application/octet-stream', buffer: hwpBytes(['착 공 계', '공사명 시청사 옥상 방수공사']) },
      { name: '여러개_견적서.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xlsx },
      { name: '여러개_견적서_옛.xls', mimeType: 'application/vnd.ms-excel', buffer: xls },
      { name: '여러개_사진.png', mimeType: 'image/png', buffer: png },
      { name: '여러개_메모.txt', mimeType: 'text/plain', buffer: Buffer.from('메모') },
    ];
    const [fcm] = await Promise.all([page.waitForEvent('filechooser'), page.click('#btnAdd')]);
    await fcm.setFiles(files);
    await page.waitForSelector('#dlgPreview[open]', { timeout: 60000 });
    const seen = new Set();
    for (let k = 0; k < 40 && seen.size < files.length; k++) {
      if (!(await page.evaluate(() => document.querySelector('#dlgPreview').open))) { await page.waitForTimeout(1000); continue; }
      seen.add((await page.textContent('#pvName')).trim());
      if (!(await page.$eval('#pvItem', (x) => x.disabled)) && !(await page.inputValue('#pvItem'))) await page.selectOption('#pvItem', { index: 1 });
      if (!(await page.inputValue('#pvContract'))) await page.fill('#pvSearch', '방수');
      await page.click('#pvSave'); await page.waitForTimeout(500);
    }
    assert.deepEqual([...seen].sort(), files.map((f) => f.name).sort(), '여섯 파일 모두 차례로 팝업: ' + JSON.stringify([...seen]));
    await waitFor(async () => !(await page.isVisible('#progress')), 30000, '정리 끝');
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    await page.evaluate(async () => { JH.app.cfg.uploadConfirm = false; await JH.app.saveCfg(); });
  }
  step('여러 파일·여러 확장자(PDF·한글·엑셀·옛 엑셀·그림·텍스트)를 한 번에 올려도 하나씩 차례로 확인 팝업');

  // 압축 파일(.zip): 풀어서 안에 든 파일을 하나씩 넣음(윈도우 zip의 한글 이름 CP949, 폴더, 압축 안의 압축까지 · 맥 찌꺼기 파일은 뺌)
  {
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    const zipb = readFileSync(new URL('../fixtures/업체서류묶음.zip', import.meta.url));
    const [fcz] = await Promise.all([page.waitForEvent('filechooser'), page.click('#btnAdd')]);
    await fcz.setFiles({ name: '업체서류묶음.zip', mimeType: 'application/zip', buffer: zipb });
    const want = ['압축안_시청사 옥상 방수공사_착공계.pdf', '압축안_사업자등록증.pdf', '압축안_통장사본.pdf'];
    await waitFor(() => page.evaluate((w) => w.every((n) => JH.app.db.docs.some((d) => d.name === n)), want), 60000, '압축 풀어 넣기');
    const z = await page.evaluate(() => ({ zip: JH.app.db.docs.some((d) => /\.zip$/i.test(d.name)), mac: JH.app.db.docs.some((d) => d.name.startsWith('._')), st: (JH.app.db.docs.find((d) => d.name === '압축안_시청사 옥상 방수공사_착공계.pdf') || {}).itemId }));
    assert.deepEqual([z.zip, z.mac], [false, false], '압축 파일 자체·맥 찌꺼기는 안 넣음');
    assert.equal(z.st, 'c-start', '압축 안 파일도 이름으로 분류');
    await waitFor(async () => !(await page.isVisible('#progress')), 30000, '정리 끝'); await page.waitForTimeout(1500);
    for (let k = 0; k < 5; k++) { await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close())); await page.waitForTimeout(400); }
  }
  step('압축 파일(.zip)을 올리면 풀어서 안의 파일을 하나씩 정리(한글 이름·폴더·압축 안 압축)');

  // 그룹웨어(BizFlow 등) 결재문서: 확장자는 .hwp인데 속은 HWPML(XML)·HTML·MHT → 글자를 읽어 분류
  {
    const xml = '<?xml version="1.0" encoding="UTF-8"?><HWPML Version="2.8"><BODY><SECTION><P><TEXT><CHAR>구 매 요 구 서</CHAR></TEXT></P><P><TEXT><CHAR>제목 : 구매요구 / 시청사 옥상 방수공사 건의</CHAR></TEXT></P></SECTION></BODY></HWPML>';
    await page.evaluate(async (x) => { await JH.app.ingest([new File([new TextEncoder().encode(x)], '결재문서_20261026.hwp', { type: '' })], null, null); }, xml);
    await waitFor(() => page.evaluate(() => JH.app.db.docs.some((d) => d.name === '결재문서_20261026.hwp')), 30000, 'HWPML 결재문서');
    const bz = await page.evaluate(() => { const d = JH.app.db.docs.find((x) => x.name === '결재문서_20261026.hwp'); return { c: (JH.app.db.contracts[d.key] || {}).name, item: d.itemId }; });
    assert.deepEqual(bz, { c: '시청사 옥상 방수공사', item: 'c-req' }, 'HWPML 결재문서 ' + JSON.stringify(bz));
    // MHT(웹 보관 파일)·EUC-KR HTML도 글자를 읽음
    const mt = await page.evaluate(() => {
      const enc = (t) => { const u = []; for (const b of new TextEncoder().encode(t)) u.push(b < 128 && b !== 61 ? String.fromCharCode(b) : '=' + b.toString(16).toUpperCase().padStart(2, '0')); return u.join(''); };
      const mht = 'MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="B"\r\n\r\n--B\r\nContent-Type: text/html; charset="utf-8"\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n' + enc('<html><body><p>지출결의서</p><p>시청사 옥상 방수공사</p></body></html>') + '\r\n--B--';
      return JH.readers.markupLines(new TextEncoder().encode(mht));
    });
    assert.ok(mt.includes('지출결의서') && mt.includes('시청사 옥상 방수공사'), JSON.stringify(mt));
    await page.waitForTimeout(800); for (let k = 0; k < 3; k++) { await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close())); await page.waitForTimeout(300); }
  }
  step('그룹웨어 결재문서(.hwp인데 속은 HWPML·HTML·MHT)도 글자를 읽어 분류');

  // 전자결재 문서(.hwx, 핸디소프트): 결재 정보 머리 + 한글 문서 통째 → 한글 부분을 찾아 본문 글자를 읽음
  {
    const hw = hwpBytes(['구 매 요 구 서', '제목 : 구매요구 / 시청사 옥상 방수공사 건의']);
    const head = Buffer.alloc(429); Buffer.from('Handysoft Approval Document File').copy(head);
    await page.evaluate(async (b64) => { const b = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); await JH.app.ingest([new File([b], '결재문서_시험.hwx', { type: '' })], null, null); }, Buffer.concat([head, hw]).toString('base64'));
    await waitFor(() => page.evaluate(() => JH.app.db.docs.some((d) => d.name === '결재문서_시험.hwx')), 30000, 'hwx');
    const hx = await page.evaluate(() => { const d = JH.app.db.docs.find((x) => x.name === '결재문서_시험.hwx'); return { c: (JH.app.db.contracts[d.key] || {}).name, item: d.itemId }; });
    assert.deepEqual(hx, { c: '시청사 옥상 방수공사', item: 'c-req' }, 'hwx ' + JSON.stringify(hx));
    await page.waitForTimeout(800); for (let k = 0; k < 3; k++) { await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close())); await page.waitForTimeout(300); }
  }
  step('전자결재 문서(.hwx)도 안의 한글 문서를 찾아 본문 글자로 분류');


  // 뒤로: 현황판 → 계약을 눌러 넘어간 뒤 [←]면 다시 현황판 · 현황판에서 가운데 버튼이면 새 탭(보던 화면 그대로)
  {
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    await page.click('nav [data-view="board"]'); await page.waitForSelector('#view-board.on tr[data-key]');
    const nTabs = await page.$$eval('.tab-it', (x) => x.length);
    await page.click('#view-board tr[data-key] >> nth=0', { button: 'middle' });
    await waitFor(async () => (await page.$$eval('.tab-it', (x) => x.length)) === nTabs + 1, 5000, '가운데 버튼 → 새 탭');
    assert.ok(await page.isVisible('#view-board.on'), '보던 현황판 그대로');
    await page.click('#view-board tr[data-key] >> nth=0');
    await page.waitForSelector('#view-contracts.on');
    assert.ok(!(await page.$eval('#btnBack', (b) => b.disabled)), '뒤로 켜짐');
    await page.click('#btnBack');
    await page.waitForSelector('#view-board.on');
    await page.keyboard.press('Alt+ArrowLeft').catch(() => {});
    await page.click('.tab-it >> nth=-1 >> .tx'); // 새로 연 탭 닫기
  }
  step('뒤로: 현황판에서 계약을 눌러 넘어간 뒤 [←](Alt+←·마우스 뒤로 버튼)면 다시 현황판 · 가운데 버튼은 계약을 새 탭으로');

  // 단계 접기: 기본은 펼침, 제목을 누르면 그 단계 서류 줄이 접힘(다른 계약에서도 접힌 채), 다시 누르면 펼침
  {
    await page.click('nav [data-view="contracts"]'); await page.waitForSelector('#detail .stage-head[data-fold="구매요구"]');
    assert.ok(await page.isVisible('#detail .stage:has([data-fold="구매요구"]) .row'), '기본은 펼침');
    await page.click('#detail .stage-head[data-fold="구매요구"] h3');
    assert.ok(!(await page.isVisible('#detail .stage:has([data-fold="구매요구"]) .row')), '접힘');
    assert.ok(await page.isVisible('#detail .stage:has([data-fold="계약"]) .row'), '다른 단계는 그대로');
    const keys = await page.$$eval('.citem[data-key]', (xs) => xs.map((x) => x.dataset.key));
    await page.click(`.citem[data-key="${keys[keys.length - 1]}"]`); await page.waitForSelector('#detail .stage-head[data-fold="구매요구"]');
    assert.ok(!(await page.isVisible('#detail .stage:has([data-fold="구매요구"]) .row')), '다른 계약에서도 접힘');
    await page.click('#detail .stage-head[data-fold="구매요구"] h3');
    assert.ok(await page.isVisible('#detail .stage:has([data-fold="구매요구"]) .row'), '다시 펼침');
  }
  step('단계 접기: 구매요구·계약·착공계…는 기본 펼침, 제목을 누르면 그 단계가 접히고(다른 계약에서도) 다시 누르면 펼침');

  // [새로고침]: 나라장터 목록 + 계약 폴더 다시 읽기 — 탐색기에서 계약 폴더에 직접 넣은 파일이 바로 들어옴
  {
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    const folder = await page.evaluate(() => Object.values(JH.app.db.contracts).find((c) => c.name === '시청사 옥상 방수공사').folder);
    copyFileSync(join(DOCS, 'noname(3).pdf'), join(data, folder, '탐색기로넣음.pdf'));
    await page.click('#btnFetch');
    await waitFor(() => page.evaluate(() => JH.app.db.docs.some((d) => d.name === '탐색기로넣음.pdf')), 60000, '새로고침으로 폴더 다시 읽기');
    await waitFor(async () => !(await page.isVisible('#progress')), 30000, '정리 끝'); await page.waitForTimeout(1200);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  }
  step('[새로고침]은 나라장터 계약 목록과 함께 계약 폴더도 다시 읽음(탐색기에서 직접 넣은 파일 반영)');

  // 서류 줄의 종류 찾기: '면허'든 '등록증'이든 쳐서 찾고 Enter면 그 종류로
  {
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    await page.click('nav [data-view="contracts"]');
    await page.click('.citem:has-text("시청사 옥상 방수공사")'); await page.waitForSelector('#detail .file .cpick.mini');
    const id = await page.$eval('#detail .file .cpick.mini select', (s) => s.dataset.doc);
    const q = `#detail .cpick.mini:has(select[data-doc="${id}"]) .cpick-q`;
    await page.fill(q, '면허');
    assert.ok(await page.$$eval(`select[data-doc="${id}"] option`, (os) => os.some((o) => !o.hidden && /면허 등록증/.test(o.textContent))), "'면허'로 면허 등록증이 보임");
    await page.fill(q, '등록증');
    assert.ok(await page.$$eval(`select[data-doc="${id}"] option`, (os) => os.some((o) => !o.hidden && /면허 등록증/.test(o.textContent))), "'등록증'으로도 보임");
    await page.fill(q, '면허등록증'); await page.press(q, 'Enter');
    await waitFor(() => page.evaluate((i) => /-license$/.test(JH.app.db.docs.find((d) => d.id === i).itemId || ''), id), 10000, 'Enter로 옮김');
    await page.click('#btnUndo');
    await waitFor(() => page.evaluate((i) => !/-license$/.test(JH.app.db.docs.find((d) => d.id === i).itemId || ''), id), 10000, '되돌림');
  }
  step('서류 줄의 종류 찾기 칸: 면허·등록증 등 아무 말로 찾고 Enter면 그 종류로(되돌리기 가능)');

  // 묶음 파일(착공계·현장대리인계·가입자명부·가입증명서를 한 파일로): 한 칸의 ✕는 그 칸에서만 빼고 파일·다른 칸은 그대로
  {
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    const mk = await page.context().newPage();
    const pg = (t) => `<section style="page-break-after:always;font-family:'Noto Sans CJK KR';padding:40px"><h1 style="font-size:36px;text-align:center">${t}</h1><p>공사명 : 시청사 옥상 방수공사</p></section>`;
    await mk.setContent('<body style="margin:0">' + ['4대 사회보험 가입자명부', '착공계', '현장대리인계', '사업장 가입내역 확인서'].map(pg).join('') + '</body>');
    const pdf = await mk.pdf({ format: 'A4' }); await mk.close();
    await page.click('nav [data-view="contracts"]'); await page.click('.citem:has-text("시청사 옥상 방수공사")');
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-act="addhere"]')]);
    await fc.setFiles([{ name: '착공계묶음.pdf', mimeType: 'application/pdf', buffer: pdf }]);
    await waitFor(() => page.evaluate(() => JH.app.db.docs.some((d) => d.name === '착공계묶음.pdf')), 60000, '묶음 올림');
    await waitFor(async () => !(await page.isVisible('#progress')), 60000, '정리 끝'); await page.waitForTimeout(1000);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    const d0 = await page.evaluate(() => { const d = JH.app.db.docs.find((x) => x.name === '착공계묶음.pdf'); return { id: d.id, item: d.itemId, also: d.also || [] }; });
    assert.ok(d0.also.length >= 2, '함께 든 서류 표시: ' + JSON.stringify(d0));
    // 대표 칸 줄의 ✕ → 이 칸에서만 빼기
    page.once('dialog', (dlg) => dlg.accept());
    await page.click(`.row[data-drop-item="${d0.item}"] .file [data-act="del"][data-doc="${d0.id}"]`);
    await waitFor(() => page.evaluate((o) => { const d = JH.app.db.docs.find((x) => x.id === o.id); return d && d.itemId !== o.item; }, d0), 15000, '대표 칸만 바뀜');
    const d1 = await page.evaluate((id) => { const d = JH.app.db.docs.find((x) => x.id === id); return { item: d.itemId, also: d.also || [] }; }, d0.id);
    assert.ok(d1.item && d0.also.includes(d1.item), '남은 서류 중 하나가 대표');
    assert.equal(d1.also.length, d0.also.length - 1, '다른 칸은 그대로');
    // 함께 든 서류 줄의 ✕ → 그 표시만 뺌
    const one = d1.also[0];
    await page.click(`.row[data-drop-item="${one}"] .file.inner [data-act="unalso"][data-doc="${d0.id}"]`);
    await waitFor(() => page.evaluate((o) => !(JH.app.db.docs.find((x) => x.id === o.id).also || []).includes(o.one), { id: d0.id, one }), 10000, '표시만 뺌');
    assert.ok(await page.evaluate((id) => !!JH.app.db.docs.find((x) => x.id === id), d0.id), '파일은 그대로');
  }
  step('묶음 파일: 한 칸 줄의 ✕는 그 칸에서만 빼고(파일·다른 칸 그대로), 함께 든 서류 줄의 ✕는 그 표시만 뺌');


  // 올릴 때마다 확인 중 묶음 파일(착수계 묶음)이 오면 바로 '쪽별로 나누기' 화면 → 닫으면 다음 파일 확인으로
  {
    await page.evaluate(async () => { JH.app.cfg.uploadConfirm = true; await JH.app.saveCfg(); document.querySelectorAll('dialog[open]').forEach((d) => d.close()); });
    const mk = await page.context().newPage();
    const pg = (t) => `<section style="page-break-after:always;font-family:'Noto Sans CJK KR';padding:40px"><h1 style="font-size:36px;text-align:center">${t}</h1><p>공사명 : 시청사 옥상 방수공사</p></section>`;
    await mk.setContent('<body style="margin:0">' + ['착공계', '현장대리인계', '예정공정표', '4대 사회보험 가입자명부'].map(pg).join('') + '</body>');
    const pdf = await mk.pdf({ format: 'A4' }); await mk.close();
    await page.click('nav [data-view="contracts"]'); await page.click('.citem:has-text("시청사 옥상 방수공사")');
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-act="addhere"]')]);
    await fc.setFiles([{ name: '착수계묶음2.pdf', mimeType: 'application/pdf', buffer: pdf }, { name: '통장사본2.pdf', mimeType: 'application/pdf', buffer: readFileSync(join(DOCS, 'noname(2).pdf')) }]);
    await page.waitForSelector('#dlgSplit[open]', { timeout: 60000 });
    await page.waitForSelector('#spRows .sp-row', { timeout: 60000 });
    assert.ok((await page.$$eval('#spRows .sp-row', (x) => x.length)) >= 2, '묶음이면 나누기 화면이 바로');
    await page.click('#spCancel');
    await page.waitForSelector('#dlgPreview[open]', { timeout: 10000 });
    assert.match(await page.textContent('#pvName'), /통장사본2/, '닫으면 다음 파일 확인으로');
    const had = await page.evaluate(() => { const d = JH.app.db.docs.find((x) => x.name === '통장사본2.pdf'); return d.key; });
    await page.click('#dlgPreview button[value="close"]');
    // 계약 안 [업로드]로 넣은 것(계약을 정함)은 저장하지 않고 닫아도 그 계약에 그대로
    await page.waitForTimeout(800);
    assert.ok(await page.evaluate(() => !!JH.app.db.docs.find((x) => x.name === '통장사본2.pdf').key), '계약을 정해 넣은 것은 닫아도 그 계약에');
    // 묶음 파일(나누기 화면을 닫은 것)은 계약에 그대로
    assert.ok(await page.evaluate(() => !!JH.app.db.docs.find((x) => x.name === '착수계묶음2.pdf').key), '나누기 화면 거친 묶음은 그대로');
    await page.evaluate(async () => { JH.app.cfg.uploadConfirm = false; await JH.app.saveCfg(); });
    await waitFor(async () => !(await page.isVisible('#progress')), 30000, '정리 끝'); await page.waitForTimeout(800);
  }
  step('올릴 때 확인: 여러 서류가 든 묶음 파일 차례가 오면 바로 쪽별로 나누기 화면, 닫으면 다음 파일 확인으로 · 저장 안 하고 닫은 파일은 미분류로');

  // 특정 쪽만 잘라 넣기: [+ 새 서류] → 종류 고르고 → 그 쪽만 누르기 → 저장(고르지 않은 쪽은 원래 칸에 남음) · 확인을 마치면 그 계약 화면으로
  {
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    const id = await page.evaluate(() => JH.app.db.docs.find((d) => d.name === '착수계묶음2.pdf').id);
    await page.click(`[data-act="split"][data-doc="${id}"]`);
    await page.waitForSelector('#spView .sp-pgv[data-p="4"]', { timeout: 60000 });
    // [처음부터 직접 고르기] → 새 서류 줄이 생김 → 가입자명부로 찾아 고르고 4쪽만 누름
    await page.click('#spClear'); await page.fill('#spRows .sp-row.on .cpick-q', '가입자명부');
    // 쪽 번호를 직접 씀(쪽 그림을 누르는 대신) · '+ 아래에'로 중간에 새 줄
    await page.fill('#spRows .sp-row.on .sp-pin', '4'); await page.press('#spRows .sp-row.on .sp-pin', 'Enter'); await page.waitForTimeout(400);
    assert.match(await page.inputValue('#spRows .sp-row.on .sp-pin'), /^4$/, '쪽 번호 직접 쓰기');
    const nRows = await page.$$eval('#spRows .sp-row', (x) => x.length);
    await page.click('#spRows .sp-row.on [data-spadd]'); await page.waitForTimeout(300);
    assert.equal(await page.$$eval('#spRows .sp-row', (x) => x.length), nRows + 1, '+ 아래에 새 줄');
    await page.click('#spRows .sp-row.on [data-spdel]'); await page.waitForTimeout(300);
    await page.click('#spRows .sp-row'); await page.waitForTimeout(300);
    // 서류 이름 직접 쓰기
    await page.fill('#spRows .sp-row.on .sp-nm', '가입자명부 업체제출본'); await page.press('#spRows .sp-row.on .sp-nm', 'Tab');
    assert.ok(!(await page.$eval('#spSave', (b) => b.disabled)), '한 서류만 골라도 저장 가능');
    assert.match(await page.textContent('#spErr'), /고르지 않은 쪽 1~3쪽은 원래 파일 칸/);
    await page.click('#spSave');
    await waitFor(() => page.evaluate(() => JH.app.db.docs.some((d) => d.splitFrom === '착수계묶음2.pdf' && /-roster$/.test(d.itemId))), 60000, '4쪽만 잘라 넣음');
    const parts = await page.evaluate(() => JH.app.db.docs.filter((d) => d.splitFrom === '착수계묶음2.pdf').map((d) => [d.name, d.itemId]));
    assert.equal(parts.length, 2, '잘라 낸 것 + 남은 쪽 ' + JSON.stringify(parts));
    assert.ok(parts.some(([n]) => /_1-3쪽\.pdf$/.test(n)), '남은 1~3쪽 묶음');
    const own = await page.evaluate(() => JH.app.db.docs.find((d) => d.splitFrom === '착수계묶음2.pdf' && /-roster$/.test(d.itemId)));
    assert.equal(own.name, '가입자명부 업체제출본.pdf', '직접 쓴 이름으로 저장'); assert.match(own.path, /가입자명부 업체제출본_/);
    assert.ok(await page.evaluate(() => (JH.app.db.splitNames || []).some((x) => x.name === '가입자명부 업체제출본' && x.item === 'roster')), '쓴 이름 기억(다음에 자동완성)');
    assert.ok(await page.isVisible('#view-contracts.on'), '그 계약 화면');
  }
  // 목록에 없는 이름을 3번 쓰면 서류 목록에 추가할지 물음 → 추가하면 그 이름의 '종류 미정' 파일이 새 칸으로
  {
    await page.evaluate(() => document.querySelectorAll('#toasts .toast').forEach((t) => t.remove()));
    const r0 = await page.evaluate(() => {
      const A = JH.app, c = Object.values(A.db.contracts).find((x) => x.name === '시청사 옥상 방수공사');
      const d = A.db.docs.find((x) => x.splitFrom === '착수계묶음2.pdf' && /_1-3쪽\.pdf$/.test(x.name));
      d.itemId = null; d.name = '업체 자체점검표.pdf';
      A.countName('업체 자체점검표', c, '착공계'); A.countName('업체 자체점검표', c, '착공계');
      const asked = [...document.querySelectorAll('#toasts .toast')].some((t) => /서류 목록에 추가/.test(t.textContent));
      A.countName('업체 자체점검표', c, '착공계');
      return { asked, id: d.id };
    });
    assert.ok(!r0.asked, '두 번까지는 묻지 않음');
    await page.waitForSelector('#toasts .toast button:has-text("서류 목록에 추가")', { timeout: 5000 });
    await page.click('#toasts .toast button:has-text("서류 목록에 추가")');
    await waitFor(() => page.evaluate((id) => { const d = JH.app.db.docs.find((x) => x.id === id); const it = JH.app.lists('공사').find((x) => x.name === '업체 자체점검표'); return it && d.itemId === it.id; }, r0.id), 15000, '목록에 추가 + 파일 옮김');
  }
  step('특정 쪽만 잘라 넣기: 서류 종류를 고르고 그 쪽만 누르면 잘려 그 칸으로, 고르지 않은 쪽은 원래 칸에 남음 · 마치면 그 계약 화면 · 직접 쓴 이름 기억 · 3번 쓰면 서류 목록에 추가할지 물음');

  // 동료 규칙 받기: 받은 규칙에 맞는 '종류 못 정한/확인 필요' 서류는 그 자리에서 정해짐(사람이 고른 것은 그대로)
  {
    const r = await page.evaluate(async () => {
      const A = JH.app, db = A.db;
      const d = db.docs.find((x) => x.key && x.itemId && !x.manual && x.path);
      if (!d) return { none: true };
      const want = d.itemId; const suf = want.replace(/^[csg]-/, '');
      d.heads = ['동료가배운시험제목'];
      d.itemId = null; d.unsure = true;
      const orig = JH.server.shareGet;
      JH.server.shareGet = async () => ({ bodies: ['```json\n' + JSON.stringify([{ head: '동료가배운시험제목', suf, item: '시험' }]) + '\n```'] });
      try { await A.pullShare(); } finally { JH.server.shareGet = orig; }
      return { want, got: d.itemId, unsure: !!d.unsure, shared: (db.learned || []).some((x) => x.shared && x.head === '동료가배운시험제목') };
    });
    assert.ok(!r.none, '시험할 서류 없음');
    assert.ok(r.shared, '동료 규칙 받음');
    assert.equal(r.got, r.want, '받은 규칙으로 종류 정함');
    assert.ok(!r.unsure, '확인 필요 풀림');
    await waitFor(() => page.$('.toast:has-text("동료가 배운 규칙")'), 10000, '알림');
  }
  step('동료 규칙(켤 때 + 켜 둔 동안 30분마다): 받은 규칙에 맞는 종류 못 정한·확인 필요 서류는 바로 정리');

  // 공고문 전용 새 창: 서류대장을 저장하지 않고(두 창이 덮어쓰지 않게), 원래 창의 공고문 화면은 잠김 → 공고문 창을 닫으면 풀림
  {
    const ledger = join(data, '서류대장.json');
    await page.evaluate(() => JH.app.setView('home')); // 계약 화면에서 뒤에서 하던 감사 칸 채우기 등이 끝나게
    // 앞 단계에서 원래 창이 하던 저장이 끝나 파일이 3초 동안 그대로일 때부터 잼
    { let last = statSync(ledger).mtimeMs, quiet = Date.now(); const t0 = Date.now(); while (Date.now() - quiet < 8000 && Date.now() - t0 < 45000) { await page.waitForTimeout(300); const m = statSync(ledger).mtimeMs; if (m !== last) { last = m; quiet = Date.now(); } } }
    const m0 = statSync(ledger).mtimeMs;
    const p2 = await page.context().newPage(); await p2.goto(base + '?only=notice');
    await p2.waitForSelector('body.only-notice #view-notice.on', { timeout: 20000 });
    assert.ok(!(await p2.isVisible('.vgroup[data-mod="jichul"]')), '공고문 창에는 지출서류 메뉴 없음');
    await p2.click('.vgroup[data-mod="rules"] button'); await p2.waitForSelector('#view-rules.on');
    await page.waitForSelector('#view-notice.locked', { state: 'attached', timeout: 30000 });
    await p2.close({ runBeforeUnload: true });
    await page.waitForSelector('#view-notice:not(.locked)', { state: 'attached', timeout: 30000 });
    assert.equal(statSync(ledger).mtimeMs, m0, '공고문 창은 서류대장을 저장하지 않음');
    assert.ok((await fetch(base + 'api/ping', { headers: { 'X-JH-Token': run.token } })).ok, '원래 창이 열려 있으면 안 꺼짐');
  }
  step('공고문 전용 새 창: 지출서류 메뉴 없이 공고문·규정만, 서류대장은 건드리지 않음 · 원래 창의 공고문 화면은 그동안 잠김');

  await page.click('.brand');
  await page.waitForSelector('#homeNotice li');
  await page.screenshot({ path: join(SHOTS, '0b-처음화면-사용후.png') });
  assert.deepEqual(errors, [], '콘솔 오류');
  step('콘솔 오류 없음');
  // 마지막: 창을 X로 닫으면(열린 창이 없으면) 몇 초 뒤 프로그램이 스스로 꺼짐
  await page.close({ runBeforeUnload: true });
  await waitFor(() => !existsSync(join(PROG, 'running.json')), 20000, '창을 닫으면 꺼짐');
  step('창을 X로 닫으면 몇 초 뒤 프로그램(연결 창구)도 꺼짐');
  console.log(`\n통합 시험 통과 (${ok}단계). 화면: tests/e2e/screens/`);
} catch (e) {
  console.error('\n실패:', e.message, '\n콘솔:', errors.join('\n'));
  try { console.error('알림:', await page.$$eval('.toast', (t) => t.map((x) => x.textContent))); } catch (_) {}
  try { await page.screenshot({ path: join(SHOTS, 'fail.png') }); } catch (_) {}
  process.exitCode = 1;
} finally {
  try { await stopServer(); } catch (_) {}
  await browser.close();
  rmSync(join(PROG, 'local.json'), { force: true });
  setTimeout(() => { try { srv.kill(); } catch (_) {} process.exit(); }, 500);
}
