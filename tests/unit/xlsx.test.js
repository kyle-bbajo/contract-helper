// 엑셀 만들기 단위 시험 — 실제 엑셀 읽기 라이브러리(openpyxl)로 열어 값·서식 확인
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { writeFileSync, mkdtempSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const X = require('../../src/app/js/xlsx.js');

test('계약 현황 엑셀: 머리글·금액·날짜·여러 줄 글·두 번째 시트', () => {
  const bytes = X.build({ title: '계약 현황', sheets: [
    { name: '계약 현황', cols: [{ h: '계약명', w: 30 }, { h: '계약금액', type: 'money' }, { h: '준공일', type: 'date' }, { h: '특이사항', type: 'wrap' }, { h: '서류', type: 'int' }],
      rows: [['시청사 옥상 방수공사 <특>&', 48000000, '20261010', '준공검사 10/20\n하자보증서 원본', 9], ['빈 값', '', '', '', '']] },
    { name: '서류 상세', cols: [{ h: '계약명' }, { h: '서류' }], rows: [['시청사', '계약서']] },
  ] });
  const dir = mkdtempSync(join(tmpdir(), 'xlsx-')); const f = join(dir, 't.xlsx'); writeFileSync(f, bytes);
  const out = JSON.parse(execFileSync('python3', ['-c', `
import json, sys, openpyxl
wb = openpyxl.load_workbook(sys.argv[1])
a, b = wb.worksheets
r = lambda ws, row: [c.value if not hasattr(c.value, 'isoformat') else c.value.date().isoformat() for c in ws[row]]
print(json.dumps({'names': wb.sheetnames, 'h': r(a, 1), 'r2': r(a, 2), 'r3': r(a, 3), 'fmt': [a['B2'].number_format, a['C2'].number_format], 'bold': a['A1'].font.b,
  'freeze': a.freeze_panes, 'filter': a.auto_filter.ref, 'b2': r(b, 2), 'wrap': a['D2'].alignment.wrap_text}, ensure_ascii=False))`, f]).toString());
  assert.deepEqual(out.names, ['계약 현황', '서류 상세']);
  assert.deepEqual(out.h, ['계약명', '계약금액', '준공일', '특이사항', '서류']);
  assert.deepEqual(out.r2, ['시청사 옥상 방수공사 <특>&', 48000000, '2026-10-10', '준공검사 10/20\n하자보증서 원본', 9]);
  assert.deepEqual(out.r3, ['빈 값', null, null, null, null]);
  assert.deepEqual(out.fmt, ['#,##0', 'yyyy-mm-dd']);
  assert.equal(out.bold, true); assert.equal(out.freeze, 'A2'); assert.equal(out.filter, 'A1:E3'); assert.equal(out.wrap, true);
  assert.deepEqual(out.b2, ['시청사', '계약서']);
});
