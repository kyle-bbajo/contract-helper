// 바로 쓰는 묶음 만들기 — 저장소 맨 위에 설치.bat·실행.bat·제거.bat·사용안내.txt, program/(실행 파일 전부)
// GitHub에서 Code → Download ZIP으로 받아 압축만 풀면 설치.bat이 바로 동작하도록, 이 결과물도 저장소에 함께 올림
// 덤으로 dist/계약업무도우미_v버전.zip(같은 내용)도 만듦
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NM = join(ROOT, 'node_modules');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const OUT = ROOT;
const PROG = join(ROOT, 'program');
const APP = join(PROG, 'app');
const V = join(APP, 'vendor');

const crlf = (s) => s.replace(/\r?\n/g, '\r\n');
const writeText = (p, s, { bom = false, eol = 'crlf' } = {}) => {
  mkdirSync(dirname(p), { recursive: true });
  const body = eol === 'crlf' ? crlf(s) : s;
  writeFileSync(p, (bom ? '﻿' : '') + body.replace(/^﻿/, ''), 'utf8');
};
const cp = (from, to) => { mkdirSync(dirname(to), { recursive: true }); cpSync(from, to, { recursive: true }); };

rmSync(join(ROOT, 'dist'), { recursive: true, force: true });
// program/은 매번 새로 만듦(이 PC에서 실행할 때 생기는 local.json·running.json은 남김)
const keep = {};
for (const f of ['local.json', 'running.json']) if (existsSync(join(PROG, f))) keep[f] = readFileSync(join(PROG, f));
rmSync(PROG, { recursive: true, force: true });

// 1) 페이지
cp(join(ROOT, 'src/app'), APP);
cp(join(ROOT, 'assets/icon.svg'), join(APP, 'icon.svg'));

// 2) 라이브러리(인터넷 없이 동작하도록 모두 포함)
cp(join(NM, 'pdf-lib/dist/pdf-lib.min.js'), join(V, 'pdf-lib.min.js'));
cp(join(NM, 'pdfjs-dist/build/pdf.min.js'), join(V, 'pdfjs/pdf.min.js'));
cp(join(NM, 'pdfjs-dist/build/pdf.worker.min.js'), join(V, 'pdfjs/pdf.worker.min.js'));
cp(join(NM, 'pdfjs-dist/cmaps'), join(V, 'pdfjs/cmaps'));
cp(join(NM, 'cfb/dist/cfb.min.js'), join(V, 'cfb.min.js'));
cp(join(NM, 'tesseract.js/dist/tesseract.min.js'), join(V, 'tesseract/tesseract.min.js'));
cp(join(NM, 'tesseract.js/dist/worker.min.js'), join(V, 'tesseract/worker.min.js'));
for (const f of ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js']) cp(join(NM, 'tesseract.js-core', f), join(V, 'tesseract/core', f));
cp(join(NM, '@tesseract.js-data/kor/4.0.0_best_int/kor.traineddata.gz'), join(V, 'tesseract/lang/kor.traineddata.gz'));
cp(join(NM, 'pretendard/dist/web/variable/woff2/PretendardVariable.woff2'), join(V, 'fonts/PretendardVariable.woff2'));
// 라이선스 고지
const lic = [
  ['pdf-lib (MIT)', 'pdf-lib/LICENSE.md'], ['pdf.js (Apache-2.0)', 'pdfjs-dist/LICENSE'], ['cfb (Apache-2.0)', 'cfb/LICENSE'],
  ['tesseract.js (Apache-2.0)', 'tesseract.js/LICENSE.md'], ['tesseract.js-core (Apache-2.0)', 'tesseract.js-core/LICENSE'], ['Pretendard (OFL-1.1)', 'pretendard/LICENSE'],
].map(([name, p]) => { const f = join(NM, p); return `==== ${name} ====\n` + (existsSync(f) ? readFileSync(f, 'utf8') : '(라이선스 파일 없음)'); }).join('\n\n');
writeText(join(V, 'THIRD_PARTY_LICENSES.txt'), lic);

// 2-1) 기관 공용 설정(인증키·기관명) — config/org.json이 있으면 묶음에 넣음. 인증키는 코드가 아니라 이 파일 하나에만 둠
const ORG = join(ROOT, 'config', 'org.json');
if (existsSync(ORG)) {
  const org = JSON.parse(readFileSync(ORG, 'utf8'));
  writeFileSync(join(APP, 'org.json'), JSON.stringify(org, null, 2), 'utf8');
  console.log(`기관 공용 설정 포함: ${org.insttNm}${org.apiKey ? ' (인증키 포함)' : ''}`);
} else console.log('config/org.json 없음 → 각자 설정에서 인증키를 넣어야 함');

// 3) 연결 창구·설치 스크립트 (Windows PowerShell 5.1은 UTF-8 BOM이어야 한글이 깨지지 않음)
for (const f of ['server.ps1', 'install.ps1', 'uninstall.ps1', 'ai-setup.ps1']) {
  writeText(join(PROG, f), readFileSync(join(ROOT, 'src/server', f), 'utf8'), { bom: true });
}
cp(join(ROOT, 'assets/icon.ico'), join(PROG, 'icon.ico'));
writeText(join(PROG, 'version.txt'), pkg.version + '\n');

// 4) bat — 내용은 영문만(코드페이지 문제 방지), 실제 작업은 PowerShell이 함
writeText(join(OUT, '설치.bat'), `@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0program\\install.ps1"
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)
timeout /t 5 >nul
`);
// 실행.bat: 설치돼 있으면 설치본을, 아니면 압축 푼 폴더에서 바로 실행(설치 없이 써 볼 때)
writeText(join(OUT, '실행.bat'), `@echo off
setlocal
set "APP=%LOCALAPPDATA%\\JichulHelper\\server.ps1"
if not exist "%APP%" set "APP=%~dp0program\\server.ps1"
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%APP%"
`);
writeText(join(OUT, '제거.bat'), `@echo off
setlocal
if exist "%LOCALAPPDATA%\\JichulHelper\\uninstall.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\\JichulHelper\\uninstall.ps1"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0program\\uninstall.ps1"
)
pause
`);
writeText(join(OUT, '사용안내.txt'), readFileSync(join(ROOT, 'docs/사용안내.txt'), 'utf8'), { bom: true });

for (const [f, b] of Object.entries(keep)) writeFileSync(join(PROG, f), b);

// 5) zip(같은 내용을 한 파일로 — 메일·USB로 줄 때)
const zipName = `계약업무도우미_v${pkg.version}.zip`;
mkdirSync(join(ROOT, 'dist'), { recursive: true });
execFileSync('python3', ['-c', `
import os, zipfile, sys
root, out = sys.argv[1], sys.argv[2]
top = ['설치.bat', '실행.bat', '제거.bat', '사용안내.txt']
skip = {'local.json', 'running.json'}
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for f in top: z.write(os.path.join(root, f), '계약업무도우미/' + f)
    for d, _, fs in os.walk(os.path.join(root, 'program')):
        for f in sorted(fs):
            if f in skip and os.path.basename(d) == 'program': continue
            p = os.path.join(d, f); z.write(p, '계약업무도우미/' + os.path.relpath(p, root))
`, ROOT, join(ROOT, 'dist', zipName)]);

const size = (p) => { let n = 0; const walk = (q) => { for (const e of readdirSync(q)) { const f = join(q, e); const s = statSync(f); s.isDirectory() ? walk(f) : (n += s.size); } }; walk(p); return n; };
console.log(`만듦: 설치.bat·실행.bat·제거.bat·사용안내.txt, program/ (${(size(PROG) / 1048576).toFixed(1)}MB), dist/${zipName} (${(statSync(join(ROOT, 'dist', zipName)).size / 1048576).toFixed(1)}MB)`);
