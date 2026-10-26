// 시연판 만들기: dist/demo/ — 실제 화면 + 브라우저 안 흉내 연결 창구 + 예시 데이터 (인증키 없음)
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'program/app');
if (!existsSync(SRC)) throw new Error('먼저 npm run build');
const OUT = join(ROOT, 'dist/demo');
rmSync(OUT, { recursive: true, force: true });
cpSync(SRC, OUT, { recursive: true });
rmSync(join(OUT, 'hwpsec'), { recursive: true, force: true }); // 한글 보안모듈(Windows DLL)은 시연판에 안 넣음

// 실제 인증키가 든 기관 설정은 빼고 시연용으로
writeFileSync(join(OUT, 'org.json'), JSON.stringify({ insttNm: '용인도시공사', insttDivCd: '1', apiKey: '시연용', lawOC: '시연용', months: 6, notice: { region: '용인시' } }, null, 2));

// 한국어 문자표만 남김
const cm = join(OUT, 'vendor/pdfjs/cmaps');
for (const f of readdirSync(cm)) if (!/^(KSC|UniKS|Adobe-Korea)/.test(f)) rmSync(join(cm, f));

// 페이지: 문서 골격은 게시할 때 붙으므로 뺌, 연결 창구를 시연판으로 교체
let html = readFileSync(join(OUT, 'index.html'), 'utf8');
html = html.replace(/<!doctype html>\s*/i, '').replace(/<html[^>]*>\s*/i, '').replace(/<\/html>\s*/i, '')
  .replace(/<head>\s*/i, '').replace(/<\/head>\s*/i, '').replace(/<body>\s*/i, '').replace(/<\/body>\s*/i, '')
  .replace(/<meta charset="utf-8">\s*/i, '').replace(/<meta name="viewport"[^>]*>\s*/i, '').replace(/<meta name="jh-token"[^>]*>\s*/i, '')
  .replace('<title>계약업무 도우미</title>', '<title>계약업무 도우미 시연판</title>')
  .replace('<link rel="stylesheet" href="css/app.css">', '<link rel="stylesheet" href="css/app.css">\n<link rel="stylesheet" href="css/demo.css">')
  .replace('<script src="js/server.js"></script>', '<script src="js/notice-text.js"></script>\n<script src="js/demo-server.js"></script>');
writeFileSync(join(OUT, 'index.html'), html);
rmSync(join(OUT, 'js/server.js'));
cpSync(join(ROOT, 'demo/demo-server.js'), join(OUT, 'js/demo-server.js'));
cpSync(join(ROOT, 'demo/notice-text.js'), join(OUT, 'js/notice-text.js'));
// 회사 공고문 양식: 게시판은 한글 파일을 그대로 못 올리므로 .hwpx를 글자(base64)로 바꿔 둠(.hwp 원본은 시연판에서 안 씀)
for (const f of readdirSync(join(OUT, 'tpl'))) {
  if (f.endsWith('.hwpx')) writeFileSync(join(OUT, 'tpl', f + '.b64.txt'), readFileSync(join(OUT, 'tpl', f)).toString('base64'));
  rmSync(join(OUT, 'tpl', f));
}

// 글꼴은 파일 대신 CSS 안에 넣음(게시 페이지 규칙)
const font = readFileSync(join(OUT, 'vendor/fonts/PretendardVariable.woff2')).toString('base64');
let css = readFileSync(join(OUT, 'css/app.css'), 'utf8')
  .replace('url("../vendor/fonts/PretendardVariable.woff2")', `url("data:font/woff2;base64,${font}")`)
  .replace('#app { height: 100vh;', '#app { height: 100%;');
writeFileSync(join(OUT, 'css/app.css'), css);
rmSync(join(OUT, 'vendor/fonts'), { recursive: true });
writeFileSync(join(OUT, 'css/demo.css'), `
.demo-ov { position: fixed; inset: 0; z-index: 80; background: rgba(20,30,50,.55); display: grid; place-items: center;
  padding: max(16px, env(safe-area-inset-top, 0px)) max(16px, env(safe-area-inset-right, 0px)) max(16px, env(safe-area-inset-bottom, 0px)) max(16px, env(safe-area-inset-left, 0px)); }
.demo-ov-card { background: var(--sheet); border-radius: 14px; width: min(980px, 100%); max-height: 100%; display: grid; grid-template-rows: auto 1fr; overflow: hidden; box-shadow: 0 20px 60px rgba(20,30,50,.35); }
.demo-ov-head { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; padding: 12px 16px; border-bottom: 1px solid var(--rule); }
.demo-ov-head b { font-size: 15px; }
.demo-ov-head .btn { margin-left: auto; }
.demo-ov-body { overflow: auto; padding: 16px; background: var(--paper); display: grid; gap: 16px; justify-items: center; min-height: 0; }
.demo-fig { margin: 0; display: grid; gap: 6px; justify-items: center; }
.demo-fig figcaption { color: var(--muted); font-size: 12.5px; }
.demo-page { max-width: 100%; height: auto; background: #fff; box-shadow: 0 2px 10px rgba(30,38,51,.15); }
.demo-sheet { width: 100%; display: grid; gap: 6px; }
.demo-sheet h4 { margin: 0; font-size: 14px; }
.demo-tbl { overflow: auto; max-width: 100%; background: var(--sheet); border-radius: 8px; }
.demo-tbl table { font-size: 12.5px; white-space: nowrap; }
.demo-tbl td { white-space: nowrap; vertical-align: top; }
.demo-tbl td.w { white-space: pre-line; min-width: 240px; max-width: 360px; }
.demo-text { white-space: pre-wrap; background: var(--sheet); padding: 20px; border-radius: 8px; width: 100%; max-width: 760px; font: 14px/1.8 "Pretendard", "Malgun Gothic", sans-serif; margin: 0; }
`);

// 예시 서류: 시험용 noname 서류 중 PDF·스캔·사진만(한글 예시는 이번 시연판에서 뺌)
const SAMP = join(OUT, 'samples'); mkdirSync(SAMP, { recursive: true });
for (const f of readdirSync(join(ROOT, 'tests/fixtures/docs'))) if (!/\.hwpx?$/i.test(f)) cpSync(join(ROOT, 'tests/fixtures/docs', f), join(SAMP, f));
// 묶음 PDF(착수계 묶음 6쪽) — 쪽별로 나누기 시연
for (const f of readdirSync(join(ROOT, 'tests/fixtures/bundle'))) cpSync(join(ROOT, 'tests/fixtures/bundle', f), join(SAMP, f));
{
  const p = join(OUT, 'js/demo-server.js'); let d = readFileSync(p, 'utf8');
  const rep = (a, b) => { if (!d.includes(a)) throw new Error('demo-server 바꿀 곳 없음: ' + a.slice(0, 50)); d = d.replace(a, b); };
  rep(", 'noname(9).hwp', 'noname(10).hwpx']", ']');
  rep("    const tpl = new Uint8Array(await (await fetch('samples/공고문양식.hwpx')).arrayBuffer());\n    files.set('공고문/양식/공고문양식.hwpx', tpl);\n", '');
  rep('샘플 서류 11개', '샘플 서류 9개(PDF·스캔·사진)와 착수계 묶음 PDF(6쪽)');
  rep("cMapUrl: 'vendor/pdfjs/cmaps/', cMapPacked: true,", 'CMapReaderFactory: root.JH_DemoCMapFactory, cMapPacked: true,');
  writeFileSync(p, d);
}

// 게시 페이지는 바이너리 파일(.bcmap·.gz)을 못 올림 → base64 글자로 바꾸고 읽는 쪽을 맞춤
{
  const cmd = join(OUT, 'vendor/pdfjs/cmaps'); const m = {};
  for (const f of readdirSync(cmd)) m[f.replace(/\.bcmap$/, '')] = readFileSync(join(cmd, f)).toString('base64');
  writeFileSync(join(OUT, 'vendor/pdfjs/cmaps.json'), JSON.stringify(m)); rmSync(cmd, { recursive: true });
  const lang = join(OUT, 'vendor/tesseract/lang/kor.traineddata.gz');
  writeFileSync(join(OUT, 'vendor/tesseract/lang/kor.b64.txt'), readFileSync(lang).toString('base64')); rmSync(lang);
  const p = join(OUT, 'js/readers.js'); let r = readFileSync(p, 'utf8');
  const rep = (a, b) => { if (!r.includes(a)) throw new Error('readers 바꿀 곳 없음: ' + a.slice(0, 50)); r = r.replace(a, b); };
  rep("  const PDFJS_OPTS = { cMapUrl: 'vendor/pdfjs/cmaps/', cMapPacked: true,", `  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  let cmapsP = null;
  class DemoCMapFactory { async fetch({ name }) {
    cmapsP = cmapsP || fetch('vendor/pdfjs/cmaps.json').then((x) => x.json());
    const m = await cmapsP; if (!m[name]) throw new Error('문자표 없음: ' + name);
    return { cMapData: b64(m[name]), compressionType: 1 }; } }
  root.JH_DemoCMapFactory = DemoCMapFactory;
  const PDFJS_OPTS = { CMapReaderFactory: DemoCMapFactory, cMapPacked: true,`);
  // 글자 인식 엔진은 브라우저 저장소(keyval-store)를 먼저 보므로 한국어 데이터를 거기에 넣어 둠
  rep("    ocrWorker = await withTimeout(T.createWorker('kor', 1, {", `    const kor = b64(await (await fetch('vendor/tesseract/lang/kor.b64.txt')).text());
    await new Promise((ok, no) => { const rq = indexedDB.open('keyval-store'); rq.onupgradeneeded = () => rq.result.createObjectStore('keyval');
      rq.onerror = () => no(rq.error); rq.onsuccess = () => { const tx = rq.result.transaction('keyval', 'readwrite'); tx.objectStore('keyval').put(kor, './kor.traineddata');
        tx.oncomplete = () => { rq.result.close(); ok(); }; tx.onerror = () => no(tx.error); }; });
    ocrWorker = await withTimeout(T.createWorker('kor', 1, {`);
  writeFileSync(p, r);
  // 게시 규칙: 글자 파일에 U+FFFD 문자를 그대로 두지 않음
  for (const f of ['vendor/pdf-lib.min.js']) { const q = join(OUT, f); writeFileSync(q, readFileSync(q, 'utf8').replaceAll('\uFFFD', '\\uFFFD')); }
}

// 게시할 파일 목록(쪽 자체 제외)
const list = [];
const walk = (d) => { for (const e of readdirSync(d)) { const f = join(d, e); statSync(f).isDirectory() ? walk(f) : list.push(relative(OUT, f).split('\\').join('/')); } };
walk(OUT);
const files = list.filter((p) => p !== 'index.html');
writeFileSync(join(ROOT, 'dist/demo-files.json'), JSON.stringify(Object.fromEntries(files.map((p) => [p, p]))));
let total = 0; list.forEach((p) => (total += statSync(join(OUT, p)).size));
console.log(`시연판: ${list.length}개 파일, ${(total / 1048576).toFixed(1)}MB`);
