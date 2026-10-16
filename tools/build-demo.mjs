// 시연판 만들기: dist/demo/ — 실제 화면 + 브라우저 안 흉내 연결 창구 + 예시 데이터 (인증키 없음)
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import zlib from 'node:zlib';
const require = createRequire(import.meta.url);
const CFB = require('cfb');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'dist/계약업무도우미/program/app');
if (!existsSync(SRC)) throw new Error('먼저 npm run build');
const OUT = join(ROOT, 'dist/demo');
rmSync(OUT, { recursive: true, force: true });
cpSync(SRC, OUT, { recursive: true });

// 실제 인증키가 든 기관 설정은 빼고 시연용으로
writeFileSync(join(OUT, 'org.json'), JSON.stringify({ insttNm: '용인도시공사', insttDivCd: '1', apiKey: '시연용', months: 6, notice: { region: '용인시' } }, null, 2));

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
  .replace('<script src="js/server.js"></script>', '<script src="js/demo-server.js"></script>');
writeFileSync(join(OUT, 'index.html'), html);
rmSync(join(OUT, 'js/server.js'));
cpSync(join(ROOT, 'demo/demo-server.js'), join(OUT, 'js/demo-server.js'));

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
.demo-text { white-space: pre-wrap; background: var(--sheet); padding: 20px; border-radius: 8px; width: 100%; max-width: 760px; font: 14px/1.8 "Pretendard", "Malgun Gothic", sans-serif; margin: 0; }
`);

// 예시 서류(시험용과 같은 noname 서류) + 첨부 공고문(한글) + 공고문 한글 양식(HWPX)
const SAMP = join(OUT, 'samples'); mkdirSync(SAMP, { recursive: true });
for (const f of readdirSync(join(ROOT, 'tests/fixtures/docs'))) cpSync(join(ROOT, 'tests/fixtures/docs', f), join(SAMP, f));
const rec = (t) => { const b = Buffer.concat([Buffer.from(t, 'utf16le'), Buffer.from([13, 0])]); const h = Buffer.alloc(4); h.writeUInt32LE(67 | (b.length << 20), 0); return Buffer.concat([h, b]); };
{
  const z = CFB.utils.cfb_new(); const fh = Buffer.alloc(256); fh.write('HWP Document File'); fh[36] = 1;
  CFB.utils.cfb_add(z, '/FileHeader', fh);
  CFB.utils.cfb_add(z, '/BodyText/Section0', zlib.deflateRawSync(Buffer.concat([
    '용인도시공사 공고 제2026-087호', '「신갈오거리 보안등 정비 전기공사」 입찰 공고', '1. 입찰에 부치는 사항', '가. 공사명: 신갈오거리 보안등 정비 전기공사',
    '2. 입찰참가자격', '가. 「전기공사업법」에 따른 전기공사업 등록업체', '나. 입찰공고일 전일부터 입찰일(낙찰자는 계약체결일)까지 법인등기부상 본점 소재지가 경기도 용인시에 있는 자',
    '다. 공동도급은 허용하지 않습니다', '3. 낙찰자 결정방법', '예정가격 이하 낙찰하한율 87.745% 이상 입찰자 중 최저가 순으로 적격심사', '4. 입찰보증금: 입찰금액의 100분의 5 이상',
  ].map(rec))));
  writeFileSync(join(SAMP, 'attach-notice.hwp'), CFB.write(z, { type: 'buffer' }));
}
{
  const sec = '<?xml version="1.0" encoding="UTF-8"?><hs:sec xmlns:hs="s" xmlns:hp="p">' + [
    '{{기관명}} 공고 제{{공고번호}}호', '「{{공고명}}」 입찰 공고', '1. 입찰에 부치는 사항', '가. 공사명: {{공고명}}', '나. 공사장소: {{현장}}', '다. 공사기간: {{기간}}',
    '라. 추정가격: 금 {{추정가격}}원(부가가치세 별도)', '2. 입찰참가자격', '가. {{업종제한}}', '나. {{지역제한문장}}', '다. 공동도급: {{공동도급}}',
    '3. 낙찰자 결정방법: {{낙찰자결정방법}} (낙찰하한율 {{낙찰하한율}})', '4. 입찰보증금: {{입찰보증금}}', '5. 상생결제: {{상생결제}}', '문의: {{담당부서}} {{담당자}} ({{연락처}})',
  ].map((t) => `<hp:p><hp:run><hp:t>${t}</hp:t></hp:run></hp:p>`).join('') + '</hs:sec>';
  const z = CFB.utils.cfb_new();
  CFB.utils.cfb_add(z, '/mimetype', Buffer.from('application/hwp+zip'));
  CFB.utils.cfb_add(z, '/Contents/section0.xml', Buffer.from(sec));
  writeFileSync(join(SAMP, '공고문양식.hwpx'), CFB.write(z, { type: 'buffer', fileType: 'zip' }));
}

// 게시할 파일 목록(쪽 자체 제외)
const list = [];
const walk = (d) => { for (const e of readdirSync(d)) { const f = join(d, e); statSync(f).isDirectory() ? walk(f) : list.push(relative(OUT, f).split('\\').join('/')); } };
walk(OUT);
const files = list.filter((p) => p !== 'index.html');
writeFileSync(join(ROOT, 'dist/demo-files.json'), JSON.stringify(Object.fromEntries(files.map((p) => [p, p]))));
let total = 0; list.forEach((p) => (total += statSync(join(OUT, p)).size));
console.log(`시연판: ${list.length}개 파일, ${(total / 1048576).toFixed(1)}MB`);
