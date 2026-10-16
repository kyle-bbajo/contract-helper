// 시연판(dist/demo) 연기 시험: 켜기 → 샘플 서류 넣기(PDF 읽기·글자 인식 라이브러리 뒤늦게 불러옴) → PDF 미리보기 → 공고문 한글 만들기(양식 본문 뒤늦게 불러옴)
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
const ROOT = '/home/claude/jichul-helper/dist/demo';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.png': 'image/png', '.wasm': 'application/wasm' };
const srv = createServer((req, res) => { let p = join(ROOT, decodeURIComponent(req.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html'; if (!existsSync(p) || statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p)); });
await new Promise((r) => srv.listen(18895, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
try {
  await page.goto('http://127.0.0.1:18895/');
  await page.waitForSelector('.door[data-view="contracts"]', { timeout: 30000 });
  await page.click('.door[data-view="contracts"]');
  await page.waitForSelector('.citem', { timeout: 30000 });
  // 시연판이 예시 계약·샘플 서류 9개를 스스로 넣을 때까지(스캔본 글자 인식 포함)
  const t0 = Date.now();
  await page.waitForFunction(() => JH.app.db.docs.length >= 9 && document.querySelector('#banner') && /시연판/.test(document.querySelector('#banner').textContent), null, { timeout: 240000 });
  console.log('계약', await page.evaluate(() => Object.keys(JH.app.db.contracts).length), '건, 서류', await page.evaluate(() => JH.app.db.docs.length), '개 ·', Math.round((Date.now() - t0) / 1000), '초 · pdfjs', await page.evaluate(() => !!window.pdfjsLib), '· tesseract', await page.evaluate(() => !!window.Tesseract));
  await page.evaluate(() => JH.app.setView('contracts'));
  await page.waitForSelector('[data-act="save"]');
  // PDF 만들기(pdf-lib 뒤늦게)
  await page.evaluate(() => document.querySelector('[data-act="save"]').click());
  await page.waitForSelector('#demoOv canvas', { timeout: 120000 });
  console.log('PDF 미리보기 뒤 pdf-lib', await page.evaluate(() => !!window.PDFLib));
  // 행정사무감사 서식(양식 본문 뒤늦게)
  await page.evaluate(() => { const b = document.querySelector('#demoOvClose'); if (b) b.click(); JH.app.setView('board'); });
  await page.waitForSelector('[data-act="quickform"][data-fk="audit"]');
  await page.evaluate(() => document.querySelector('[data-act="quickform"][data-fk="audit"]').click());
  await page.waitForFunction(() => window.JH && JH.formTpl, null, { timeout: 60000 });
  console.log('서식 뒤 formTpl', await page.evaluate(() => !!JH.formTpl));
} finally {
  console.log('오류:', errs.length ? errs : '없음');
  await browser.close(); srv.close();
}
