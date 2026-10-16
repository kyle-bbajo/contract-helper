// 행정사무감사 한글 양식(assets/forms/*.hwpx)에서 머리(header.xml)·본문(section0.xml)을 꺼내 src/app/js/forms-tpl.js로 만듦
// 양식이 바뀌면: 새 hwpx를 같은 이름으로 넣고 `node tools/make-form-tpl.mjs`
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const CFB = require('cfb');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(ROOT, 'assets/forms/행정사무감사_수의계약현황_양식.hwpx');
const z = CFB.read(readFileSync(src), { type: 'buffer' });
const get = (name) => { const i = z.FullPaths.findIndex((p) => p.endsWith('/' + name)); if (i < 0) throw new Error(name + ' 없음'); return Buffer.from(z.FileIndex[i].content).toString('utf8'); };
const header = get('Contents/header.xml'), section = get('Contents/section0.xml');
const out = `/* 행정사무감사 「수의계약 현황」 한글 양식 — tools/make-form-tpl.mjs가 assets/forms/행정사무감사_수의계약현황_양식.hwpx에서 만듦(직접 고치지 말 것) */
(function (root) {
  'use strict';
  const T = { header: ${JSON.stringify(header)}, section: ${JSON.stringify(section)} };
  root.JH = root.JH || {};
  root.JH.formTpl = T;
  if (typeof module !== 'undefined' && module.exports) module.exports = T;
})(typeof window !== 'undefined' ? window : globalThis);
`;
writeFileSync(join(ROOT, 'src/app/js/forms-tpl.js'), out, 'utf8');
console.log('forms-tpl.js', out.length);
