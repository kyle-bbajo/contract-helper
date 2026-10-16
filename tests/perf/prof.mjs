// 어디서 시간이 가는지(브라우저 JS 프로파일러): 켜기~목록 보임, 다른 계약 누르기. 벤치 자료 폴더를 PERF_HOME으로 받음
// PERF_HOME=/tmp/jh-perf-xxxx node tests/perf/prof.mjs
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const PROG = '/home/claude/jichul-helper/program';
const waitFor = async (fn, ms = 60000) => { const t = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch (_) {} if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 100)); } };
rmSync(join(PROG, 'running.json'), { force: true });
const srv = spawn('/opt/pwsh/pwsh', ['-NoProfile', '-File', join(PROG, 'server.ps1'), '-NoBrowser', '-SkipAi', '-Port', '18892'], { stdio: 'ignore', env: { ...process.env, HOME: process.env.PERF_HOME } });
const run = await waitFor(() => existsSync(join(PROG, 'running.json')) && JSON.parse(readFileSync(join(PROG, 'running.json'), 'utf8')));
const base = `http://127.0.0.1:${run.port}/`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('페이지 오류', e.message));
await page.route('**/api/nara**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ response: { header: { resultCode: '00' }, body: { items: [], totalCount: 0 } } }) }));
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
function report(title, profile) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const dt = profile.timeDeltas; const samples = profile.samples;
  for (let i = 0; i < samples.length; i++) { const n = nodes.get(samples[i]); const f = n.callFrame; const k = `${f.functionName || '(anonymous)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`; self.set(k, (self.get(k) || 0) + (dt[i] || 0)); }
  const total = [...self.values()].reduce((a, b) => a + b, 0) / 1000;
  console.log(`\n== ${title} (JS ${Math.round(total)}ms) ==`);
  [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).forEach(([k, v]) => console.log(`${String(Math.round(v / 1000)).padStart(6)}ms  ${k}`));
}
await cdp.send('Profiler.start');
let t = Date.now();
await page.goto(base);
await waitFor(() => page.evaluate(() => window.JH && JH.app && Object.keys(JH.app.db.contracts).length > 0));
await page.click('.door[data-view="contracts"]'); await page.waitForSelector('.citem');
console.log('켜기→목록', Date.now() - t, 'ms');
report('켜기→목록', (await cdp.send('Profiler.stop')).profile);
await page.waitForTimeout(1500);
await cdp.send('Profiler.start');
t = Date.now();
const second = await page.$$eval('.citem', (e) => e[2].dataset.key);
await page.click(`.citem[data-key="${second}"]`);
await page.waitForFunction((k) => document.querySelector('.citem.on') && document.querySelector('.citem.on').dataset.key === k, second);
console.log('다른 계약 누르기', Date.now() - t, 'ms');
report('다른 계약 누르기', (await cdp.send('Profiler.stop')).profile);
await browser.close();
try { await fetch(base + 'api/quit', { method: 'POST', headers: { 'X-JH-Token': run.token } }); } catch (_) {}
await waitFor(() => !existsSync(join(PROG, 'running.json')), 10000).catch(() => srv.kill());
