// 성능 재기: 계약 300건·서류 2,400개를 넣고 켜기·목록·계약 화면·체크 한 번·저장 크기를 잼
// node tools/build.mjs && node tests/perf/bench.mjs   (pwsh: /opt/pwsh/pwsh, 크로미움은 playwright-core 기본)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PROG = join(ROOT, 'program');
const L = require(join(ROOT, 'src/app/js/logic.js'));
const PWSH = process.env.PWSH || '/opt/pwsh/pwsh';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const N_C = +(process.env.N_C || 300), N_D = +(process.env.N_D || 2400);

const HOME = mkdtempSync(join(tmpdir(), 'jh-perf-'));
for (const d of ['Desktop', 'Documents']) mkdirSync(join(HOME, d), { recursive: true });
const data = join(HOME, 'Desktop', '계약업무도우미'); mkdirSync(data, { recursive: true });
rmSync(join(PROG, 'local.json'), { force: true }); rmSync(join(PROG, 'running.json'), { force: true });
writeFileSync(join(PROG, 'local.json'), JSON.stringify({ dataDir: data }));
writeFileSync(join(data, '설정.json'), JSON.stringify({ officer: '박주호', insttNm: '용인도시공사', notice: { winwinMin: 50000000 }, fetchVer: 4, lastFetch: '2026-10-16 09:00' }));

// 시험 자료 만들기
const lists = L.defaultChecklists();
const rnd = (() => { let s = 42; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; })();
const pick = (a) => a[Math.floor(rnd() * a.length)];
const pad = (n, w) => String(n).padStart(w, '0');
const contracts = {}, docs = [];
const TYPES = ['공사', '용역', '물품'], KINDS = ['pdf', 'pdf', 'pdf', 'hwp', 'image'];
const lorem = '본 계약은 용인도시공사와 업체 간에 체결된 것으로 계약금액 사업자등록번호 대표자 주소 경기도 용인시 처인구 공사기간 준공예정일 기성 검사 납세증명서 유효기간 2026년 12월 31일까지 '.repeat(60);
for (let i = 0; i < N_C; i++) {
  const type = TYPES[i % 3], no = `R26TA${pad(i + 1, 8)}`, key = no.toLowerCase();
  const m = 1 + (i % 12), d = 1 + (i % 27);
  contracts[key] = { key, source: 'api', type, name: `${pick(['시청사', '처인구', '수지구', '기흥구', '동백', '죽전'])} ${pick(['옥상 방수', '전기설비 교체', '청소', '경비', '조명 개선', '보도블록 정비', '소방시설 점검'])} ${type} ${i + 1}`,
    vendor: `${pick(['(주)다해토건', '한빛환경 주식회사', '대한전기(주)', '동양건설', '미래산업'])}`, nums: [no + '00'], no: no + '00', ord: 0, amount: 10000000 + i * 137000,
    contractDate: `2026-${pad(m, 2)}-${pad(d, 2)}`, startDate: `2026-${pad(m, 2)}-${pad(d, 2)}`, endDate: `2026-${pad(Math.min(12, m + 2), 2)}-${pad(d, 2)}`,
    officer: i % 4 ? '박주호' : '김담당', dept: '계약팀', org: '용인도시공사', url: 'https://www.g2b.go.kr/', method: i % 2 ? '수의계약' : '제한경쟁', rep: '홍길동', bizno: `12${pad(i, 8)}`, untyNo: no,
    originals: {}, received: {}, edited: {}, paidDate: i % 5 === 0 ? '20260901' : '', payMemo: '', archived: false, updatedAt: 1760000000000 + i,
    memo: i % 3 ? { dept: '시설관리팀', person: '홍감독', phone: '031-324-1234', note: '준공검사 예정' } : {},
    g2b: { v: 3, st: { chg: 'ok' }, origAmount: 10000000 + i * 137000, chgRows: [{ no: no + '00', ord: 0, date: '20260301', amount: 10000000 + i * 137000, end: '20260930', first: true, auto: 'orig' }] },
  };
}
const keys = Object.keys(contracts);
for (let j = 0; j < N_D; j++) {
  const key = keys[j % keys.length], c = contracts[key], list = lists[c.type];
  const item = list[j % list.length], kind = pick(KINDS);
  docs.push({ id: 'd' + j, key, itemId: item.id, path: `${c.folder || '계약/' + c.name}/${item.name}_${j}.${kind === 'image' ? 'jpg' : kind}`, name: `${item.name}_${j}.${kind === 'image' ? 'jpg' : kind}`, kind, size: 120000 + j,
    mime: 'application/pdf', addedAt: '2026-10-01T00:00:00Z', ocr: kind === 'image', meta: { name: c.name, vendor: c.vendor }, text: L.norm(lorem).slice(0, 6000), title: item.name, dates: L.isCertItem(item.id) ? { valid: '20261231' } : null, facts: {} });
}
const texts = {}; for (const d of docs) { texts[d.id] = d.text; delete d.text; }
if (process.env.LEGACY) { for (const d of docs) d.text = texts[d.id]; writeFileSync(join(data, '서류대장.json'), JSON.stringify({ version: 1, contracts, docs, checklists: lists, checklistsVer: 3 }, null, 1)); }
else { writeFileSync(join(data, '서류대장.json'), JSON.stringify({ version: 1, contracts, docs, checklists: lists, checklistsVer: 3 })); writeFileSync(join(data, '서류본문.json'), JSON.stringify(texts)); }
console.log(`자료: 계약 ${N_C}건 · 서류 ${N_D}개 · 서류대장 ${(readFileSync(join(data, '서류대장.json')).length / 1048576).toFixed(1)}MB${process.env.LEGACY ? '(예전 형식)' : ` + 본문 ${(readFileSync(join(data, '서류본문.json')).length / 1048576).toFixed(1)}MB`}`);

const waitFor = async (fn, ms = 60000, what = '') => { const t = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch (_) {} if (Date.now() - t > ms) throw new Error('시간 초과: ' + what); await new Promise((r) => setTimeout(r, 100)); } };
rmSync(join(PROG, 'running.json'), { force: true });
const srv = spawn(PWSH, ['-NoProfile', '-File', join(PROG, 'server.ps1'), '-NoBrowser', '-SkipAi', '-Port', '18891'], { stdio: 'ignore', env: { ...process.env, HOME } });
const run = await waitFor(() => existsSync(join(PROG, 'running.json')) && JSON.parse(readFileSync(join(PROG, 'running.json'), 'utf8')), 60000, '연결 창구');
const base = `http://127.0.0.1:${run.port}/`;
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.route('**/api/nara**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ response: { header: { resultCode: '00' }, body: { items: [], totalCount: 0 } } }) }));
const out = {};
const ms = (t) => Math.round(t);
// 뒤에서 도는 저장·읽기가 끝나 조용해질 때까지(요청이 0.8초 없을 때) 기다렸다가 잼, 세 번 재서 중간값
let lastReq = Date.now(); page.on('request', () => { lastReq = Date.now(); }); page.on('response', () => { lastReq = Date.now(); });
const settle = async () => { for (;;) { if (Date.now() - lastReq > 800) return; await new Promise((r) => setTimeout(r, 100)); } };
const med = async (f, n = 3) => { const ts = []; for (let i = 0; i < n; i++) { await settle(); ts.push(await f()); } ts.sort((a, b) => a - b); return ms(ts[1]); };
try {
  let t = Date.now();
  if (process.env.TRACE) { page.on('request', (r) => { if (r.url().includes('/api/')) console.log('→', Date.now() - t, r.method(), decodeURIComponent(r.url().slice(base.length)).slice(0, 80)); }); page.on('response', (r) => { if (r.url().includes('/api/')) console.log('←', Date.now() - t, r.status(), decodeURIComponent(r.url().slice(base.length)).slice(0, 60)); }); }
  await page.goto(base);
  await waitFor(() => page.evaluate(() => window.JH && JH.app && Object.keys(JH.app.db.contracts).length > 0), 60000, '서류대장 읽기');
  out['켜기→서류대장 읽음'] = ms(Date.now() - t);
  await page.click('.door[data-view="contracts"]');
  await page.waitForSelector('.citem');
  out['켜기→목록 보임'] = ms(Date.now() - t);
  // 순수 그리기 시간(같은 화면 다시 그리기)
  const timeRender = async (n = 5) => page.evaluate((n) => { const ts = []; for (let i = 0; i < n; i++) { const t = performance.now(); JH.app.render(); ts.push(performance.now() - t); } ts.sort((a, b) => a - b); return ts[Math.floor(n / 2)]; }, n);
  out['목록+계약 화면 다시 그리기(중간값)'] = ms(await timeRender());
  // 목록에서 다른 계약 누르기(처음 여는 계약은 서류 날짜·감사 칸을 읽느라 한 번 더 저장함 → 두 번째부터 잼)
  const keys = await page.$$eval('.citem', (e) => e.slice(1, 8).map((x) => x.dataset.key));
  for (const k of keys.slice(0, 3)) { await page.click(`.citem[data-key="${k}"]`); await page.waitForFunction((k) => document.querySelector('.citem.on') && document.querySelector('.citem.on').dataset.key === k, k); }
  let i = 0;
  out['다른 계약 누르기'] = await med(async () => { const k = keys[i++ % 3]; const t0 = Date.now(); await page.click(`.citem[data-key="${k}"]`); await page.waitForFunction((k) => document.querySelector('.citem.on') && document.querySelector('.citem.on').dataset.key === k, k); return Date.now() - t0; });
  // 받음 체크 한 번 → 다시 그림 + 저장
  let saved = null; page.on('request', (r) => { if (r.url().includes('/api/file') && r.method() === 'PUT' && r.url().includes('%EC%84%9C%EB%A5%98%EB%8C%80%EC%9E%A5.json')) saved = r.postDataBuffer() ? r.postDataBuffer().length : (r.postData() || '').length; });
  out['받음 체크 → 화면 바뀜'] = await med(async () => { const t1 = Date.now(); const n = await page.$$eval('.mark.rcv', (e) => e.length); await page.click('[data-act="recv"] >> nth=0'); await page.waitForFunction((n) => document.querySelectorAll('.mark.rcv').length !== n, n); return Date.now() - t1; });
  await waitFor(() => saved != null, 10000, '저장 요청');
  out['저장 한 번 보내는 크기(KB)'] = Math.round(saved / 1024);
  // 검색(한 글자 입력마다 다시 그림)
  out['검색어 입력 → 목록'] = await med(async () => { const t2 = Date.now(); await page.fill('#q', '방수'); await page.waitForFunction(() => document.querySelectorAll('.citem').length < 200); const d = Date.now() - t2; await page.fill('#q', ''); await page.waitForFunction(() => document.querySelectorAll('.citem').length > 200); return d; });
  // 현황판
  out['현황판 열기'] = await med(async () => { await page.click('.views [data-view="contracts"]'); await page.waitForSelector('.citem'); await settle(); const t3 = Date.now(); await page.click('.views [data-view="board"]'); await page.waitForSelector('#view-board .chip'); return Date.now() - t3; });
  const mem = await page.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null));
  if (mem != null) out['브라우저 메모리(MB)'] = mem;
} finally {
  console.table(out);
  await browser.close();
  try { await fetch(base + 'api/quit', { method: 'POST', headers: { 'X-JH-Token': run.token } }); } catch (_) {}
  await waitFor(() => !existsSync(join(PROG, 'running.json')), 10000, '종료').catch(() => srv.kill());
}
