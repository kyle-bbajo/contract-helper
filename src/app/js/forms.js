/* 감사·검사 제출 서식
 *  - 종합검사: 「(공사·용역·물품구매) 계약집행 현황」 엑셀
 *  - 행정사무감사(상임위 제출): 「수의계약 현황(1,000만원 이상)」 한글(HWPX), A4 가로
 * 값은 메모(직접 입력) > 나라장터에서 더 불러온 값(c.g2b) > 계약 기본값 순으로 씀. 브라우저·Node 공용 */
(function (root) {
  'use strict';
  const L = (root.JH && root.JH.logic) || (typeof require === 'function' ? require('./logic.js') : null);
  const num = (v) => { const n = Number(String(v == null ? '' : v).replace(/[^\d.-]/g, '')); return isFinite(n) && String(v == null ? '' : v).trim() !== '' ? n : 0; };
  const d8 = (s) => { const m = String(s || '').match(/(\d{4})[-.\/\s]*(\d{1,2})[-.\/\s]*(\d{1,2})/); return m ? m[1] + m[2].padStart(2, '0') + m[3].padStart(2, '0') : ''; };
  const isDate = (s) => /^\s*\d{4}[-.\/\s]*\d{1,2}[-.\/\s]*\d{1,2}\s*\.?\s*$/.test(String(s || ''));
  // 25.8.8 (종합검사 엑셀), '26.01.21. (행정사무감사 한글) — 날짜가 아닌 글(예: 공사중)은 그대로
  const dShort = (s) => { if (!isDate(s)) return String(s || ''); const v = d8(s); return `${v.slice(2, 4)}.${+v.slice(4, 6)}.${+v.slice(6, 8)}`; };
  const dQuote = (s) => { if (!isDate(s)) return String(s || ''); const v = d8(s); return `'${v.slice(2, 4)}.${v.slice(4, 6)}.${v.slice(6, 8)}.`; };
  const k = (won) => (won ? Math.round(won / 1000) : 0);              // 천원
  const kfmt = (won) => (won ? k(won).toLocaleString('ko-KR') : '');
  const signed = (diffWon) => (diffWon ? `${diffWon > 0 ? '증' : '감'})${Math.abs(k(diffWon)).toLocaleString('ko-KR')}` : '');

  // 감사 자료 칸(계약 메모에 저장) — 금액은 원 단위 숫자 글자
  const FIELDS = [
    { k: 'aBudget', label: '예산액', money: true, ph: '원' },
    { k: 'aDesign', label: '설계금액', money: true, ph: '원' },
    { k: 'aEst', label: '예정가격', money: true, ph: '원' },
    { k: 'aAward', label: '낙찰금액(당초 계약)', money: true, ph: '원' },
    { k: 'aRep', label: '대표자', ph: '' },
    { k: 'aAddr', label: '업체 주소', ph: '', wide: true },
    { k: 'aActual', label: '실제 준공일', ph: '예: 2026-10-20 또는 공사중' },
    { k: 'aExtOrig', label: '당초 준공기일', ph: '기간 연장 시', group: '공사기간 연장' },
    { k: 'aExtDate', label: '연장일', ph: '연장 계약일', group: '공사기간 연장' },
    { k: 'aExtWhy', label: '연장 사유', ph: '', group: '공사기간 연장', wide: true },
    { k: 'aChgDate', label: '설계변경 일자', ph: '', group: '설계변경' },
    { k: 'aChgAmt', label: '변경 계약금액', money: true, ph: '원', group: '설계변경' },
    { k: 'aChgWhy', label: '변경 사유', ph: '예: 준공정산', group: '설계변경', wide: true },
    { k: 'aMethod', label: '계약방법', ph: '예: 수의계약' },
    { k: 'aReason', label: '수의계약 사유', ph: '', wide: true },
    { k: 'aTeam', label: '사업팀(비고)', ph: '감독부서와 같으면 비워 두기' },
  ];

  // 한 계약 → 서식 한 줄에 필요한 값. x.finish: 준공계·준공조서에서 읽은 실제 준공일(앱이 넘김)
  function rowOf(c, x = {}) {
    const m = c.memo || {}, g = c.g2b || {}, dv = c.docVals || {};
    // 값 고르는 순서: 직접 넣은 값 > 나라장터(기준) > 서류에서 읽은 값
    const pick = (memoKey, auto, src, docV) => (String(m[memoKey] || '').trim() ? { v: m[memoKey], src: '직접' } : auto ? { v: auto, src } : docV ? { v: docV, src: '서류' } : { v: '', src: '' });
    const budget = pick('aBudget', g.budget, '나라장터 입찰공고', dv.budget), design = pick('aDesign', g.bssamt, '나라장터 기초금액', dv.design);
    const est = pick('aEst', g.plnprc, '나라장터 예정가격', dv.est);
    const award = pick('aAward', g.origAmount || c.amount, g.origAmount ? '나라장터 당초 계약' : '계약금액');
    const rep = pick('aRep', c.rep || g.rep, '나라장터', dv.rep), addr = pick('aAddr', g.addr, '나라장터', dv.addr);
    // 실제 준공일: 준공계·준공조서 날짜, 없으면 나라장터 준공(용역은 완수)일자가 지났을 때 그 날짜
    const due8 = String(c.endDate || '').replace(/\D/g, '').slice(0, 8);
    const today8 = (x.today || new Date().toISOString().slice(0, 10)).replace(/\D/g, '');
    const actual = x.finish ? pick('aActual', x.finish, '준공계·준공조서') : pick('aActual', due8 && due8 <= today8 ? due8 : '', /용역/.test(c.type || '') ? '나라장터 완수일자' : '나라장터 준공일자');
    const method = pick('aMethod', c.method, '나라장터');
    const reason = pick('aReason', L.contractReason(c.law, c.lawDtl), '나라장터 근거법률');
    const team = pick('aTeam', m.dept, '감독부서');
    // 차수마다 고른 구분(memo.chgKind[차수번호]) > 자동(금액 바뀜 설계변경, 준공일 바뀜 기간연장). 해당 없음은 뺌
    const plan = g.chgRows ? L.chgPlan(g.chgRows, m.chgKind) : null;
    const ends = plan ? plan.ext.map((r) => ({ date: r.date, from: r.prevEnd || '', to: r.end })) : (g.endChanges || []);
    const SRC = '나라장터 변경이력';
    // 기간 연장: 직접 넣은 값, 없으면 연장으로 고른 차수
    const extOrig = pick('aExtOrig', ends.length ? (g.origEnd || ends[0].from) : '', SRC);
    const extDate = pick('aExtDate', ends.map((e) => e.date).join('\n'), SRC);
    // 설계변경: 직접 넣은 값이 있으면 한 번, 없으면 설계변경으로 고른 차수마다
    let chg = plan ? plan.design.map((r) => ({ date: r.date, amount: r.amount, diff: r.diff || 0 })) : (g.amtChanges || []).map((a) => ({ date: a.date, amount: a.amount, diff: a.diff }));
    if (String(m.aChgDate || m.aChgAmt || '').trim()) {
      const amt = num(m.aChgAmt) || (chg.length ? chg[chg.length - 1].amount : 0);
      chg = [{ date: m.aChgDate || (chg.length ? chg[chg.length - 1].date : ''), amount: amt, diff: amt ? amt - num(award.v) : 0 }];
    }
    const estN = num(est.v), awardN = num(award.v);
    return {
      key: c.key, type: c.type || '공사', name: c.name || '', vendor: c.vendor || '',
      contractDate: c.contractDate || c.startDate || '', start: c.startDate || '', due: c.endDate || '',
      budget: num(budget.v), design: num(design.v), est: estN, award: awardN, amount: c.amount || awardN,
      rate: estN && awardN ? awardN / estN * 100 : null,
      actual: actual.v, extOrig: extOrig.v, extDate: extDate.v, extWhy: m.aExtWhy || '',
      chg, chgWhy: m.aChgWhy || '',
      method: method.v, rep: rep.v, addr: addr.v, reason: reason.v, team: team.v,
      src: { budget: budget.src, design: design.src, est: est.src, award: award.src, rep: rep.src, addr: addr.src, actual: actual.src, method: method.src, reason: reason.src, extOrig: extOrig.src, extDate: extDate.src },
    };
  }
  const inPeriod = (r, from, to) => { const d = d8(r.contractDate); if (!d) return !from && !to; return (!from || d >= d8(from)) && (!to || d <= d8(to)); };
  const byDate = (a, b) => (d8(a.contractDate) || '99999999').localeCompare(d8(b.contractDate) || '99999999') || a.name.localeCompare(b.name, 'ko');
  const isSole = (r) => /수의/.test(r.method || '');
  // 행정사무감사 대상: 수의계약이고 계약금액이 기준 이상(계약방법을 모르면 화면에서 고르게 함)
  const auditCandidates = (rows, min) => rows.filter((r) => r.amount >= (min || 0) && (isSole(r) || !r.method));
  const missingOf = (r, form) => {
    const need = form === 'audit' ? [['est', '예정가격'], ['addr', '주소'], ['rep', '대표자']] : [['budget', '예산액'], ['design', '설계금액'], ['est', '예정가격']];
    return need.filter(([f]) => !r[f]).map(([, l]) => l);
  };
  const manLabel = (won) => { const man = Math.round(won / 10000); return man >= 10000 && man % 10000 === 0 ? `${man / 10000}억원` : `${man.toLocaleString('ko-KR')}만원`; };
  const signLine = (role, s) => {
    const sp = (t) => t.split('').join(' ');
    return `${sp(role)} : ${[s && s.pos, s && s.name].filter(Boolean).join('  ') || '            '}  (인)`;
  };

  // ---------- 종합검사: 계약집행 현황(엑셀) — 받은 양식(7. 계약집행 현황(총괄))의 열 너비·글꼴·머리 3줄 그대로 ----------
  const INSPECT_COLS = [103.25, 17.38, 15.88, 14.62, 13, 12, 11.25, 13, 19.88, 11.25, 13, 81.25, 11.25, 18.62, 13.88, 40.12, 18.62, 48.25];
  const TYPE_LABEL = { 공사: '공사', 용역: '용역', 물품: '물품구매' };
  // 줄 높이: 글이 칸 너비를 넘으면 줄 수만큼(엑셀은 열 때 자동으로 맞추지 않음)
  const linesFor = (text, width) => String(text || '').split('\n').reduce((n, ln) => n + Math.max(1, Math.ceil([...ln].reduce((w, ch) => w + (/[ㄱ-힝]/.test(ch) ? 2 : 1), 0) * 1.25 / Math.max(width, 4))), 0);
  function inspectSheet(rows, o = {}) {
    const types = o.types || ['공사', '용역', '물품'];
    const R = [], merges = [];
    const N = INSPECT_COLS.length, last = 'R';
    const blank = (s) => Array.from({ length: N }, () => (s ? { v: '', s } : null));
    const row = (h, cells) => { R.push({ h, cells }); return R.length; };
    const spaced = (t) => String(t || '').split('').join(' ');
    const signer = (role, s) => `${role}  :  직 ${(s && s.pos) || '            '}    성 명    ${(s && s.name) ? spaced(s.name) : '          '}  (인)`;
    { const c = blank(); c[0] = { v: o.title || '7. (공사․용역․물품구매) 계약집행 현황(총괄)', s: 'title' }; row(26.25, c); }
    for (const [role, who] of [['확인자', o.confirmer], ['작성자', o.writer]]) { const c = blank(); c[3] = { v: signer(role, who), s: 'sign' }; const n = row(26.25, c); merges.push(`D${n}:${last}${n}`); }
    const secLabel = (i, type) => `${i}) ${o.dept ? o.dept + '-' : ''}${TYPE_LABEL[type] || type}`;
    const dataRow = (r) => {
      const chg = r.chg || [];
      const cells = [
        { v: r.name, s: 'td' }, { v: k(r.budget) || '', s: 'num' }, { v: k(r.design) || '', s: 'num' }, { v: k(r.est) || '', s: 'num' }, { v: k(r.award) || '', s: 'num' },
        { v: r.rate == null ? '' : Math.round(r.rate * 1000) / 1000, s: 'rate' },
        { v: dShort(r.start), s: 'tdc' }, { v: dShort(r.due), s: 'tdc' }, { v: dShort(r.actual), s: 'tdc' },
        { v: dShort(r.extOrig), s: 'tdc' }, { v: String(r.extDate || '').split('\n').map(dShort).join('\n'), s: 'tdc' }, { v: r.extWhy, s: 'tdc' },
        { v: chg.map((x) => dShort(x.date)).join('\n'), s: 'tdc' },
        chg.length === 1 ? { v: k(chg[0].amount) || '', s: 'num' } : { v: chg.map((x) => kfmt(x.amount)).join('\n'), s: 'tdr' },
        { v: chg.map((x) => signed(x.diff)).join('\n'), s: 'tdl' }, { v: r.chgWhy, s: 'tdl' },
        { v: r.method, s: 'tdc' }, { v: r.vendor, s: 'tdc' },
      ];
      const lines = Math.max(...cells.map((c, i) => linesFor(typeof c.v === 'number' ? '' : c.v, INSPECT_COLS[i])));
      row(Math.max(19.5, lines * 17.5), cells);
    };
    types.forEach((type, i) => {
      const list = rows.filter((r) => r.type === type).sort(byDate);
      { const c = blank(); c[0] = { v: secLabel(i + 1, type), s: 'sec' }; row(19.5, c); }
      if (i === 0) {
        // (단위 : 천원) + 머리 3줄
        { const c = blank(); c[0] = { v: '(단위 : 천원)', s: 'unit' }; const n = row(19.5, c); merges.push(`A${n}:${last}${n}`); }
        const h1 = R.length + 1;
        const top = blank('th'), mid = blank('th'), bot = blank('th');
        ['사업명', '예산액', '설계금액', '예정가격', '낙찰금액', '낙찰율(%)', '착공일자', '준공기한', '실제 \n준공일'].forEach((t, j) => { top[j] = { v: t, s: 'th' }; const col = String.fromCharCode(65 + j); merges.push(`${col}${h1}:${col}${h1 + 2}`); });
        top[9] = { v: '공사기간연장', s: 'th' }; merges.push(`J${h1}:L${h1}`);
        top[12] = { v: '설계변경', s: 'th' }; merges.push(`M${h1}:P${h1}`);
        top[16] = { v: '계약방법', s: 'th' }; merges.push(`Q${h1}:Q${h1 + 2}`);
        top[17] = { v: '도급자', s: 'th' }; merges.push(`R${h1}:R${h1 + 2}`);
        ['당초\n준공\n기일', '연장일', '사유', '일자', '계약금액', '증감액', '사유'].forEach((t, j) => { mid[9 + j] = { v: t, s: 'th' }; const col = String.fromCharCode(74 + j); merges.push(`${col}${h1 + 1}:${col}${h1 + 2}`); });
        row(29.25, top); row(31.5, mid); row(31.5, bot);
        o._head = [h1, h1 + 2];
      }
      if (!list.length) { const c = blank('td'); c[0] = { v: '해당 없음', s: 'td' }; row(19.5, c); }
      list.forEach(dataRow);
      if (i < types.length - 1) row(19.5, blank());
    });
    return { name: o.sheetName || 'Sheet1', form: true, font: o.font || '휴먼명조', cols: INSPECT_COLS, rows: R, merges, printTitles: o._head, freezeRow: o._head && o._head[1], zoom: 80 };
  }

  // ---------- 한글 양식 채우기(assets/forms/행정사무감사_수의계약현황_양식.hwpx) ----------
  // 양식의 표 3개(공사·물품·용역)에서 머리 2줄은 그대로 두고, 셋째 줄(빈 줄)을 본떠 계약마다 한 줄씩 만듦
  const xesc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const ROW_H = 2268; // 데이터 줄 최소 높이(8mm) — 글이 길면 한글이 알아서 늘림
  const TPL_ORDER = ['공사', '물품', '용역'];
  function cellsOf(row) { return [...row.matchAll(/<hp:tc\b[\s\S]*?<\/hp:tc>/g)].map((m) => m[0]); }
  function fillCell(tc, text) {
    const m = tc.match(/<hp:p\b[^>]*paraPrIDRef="(\d+)"[^>]*>[\s\S]*?<hp:run charPrIDRef="(\d+)"/);
    const ppr = m ? m[1] : '0', cpr = m ? m[2] : '0';
    const paras = String(text == null ? '' : text).split('\n').map((ln) => `<hp:p id="2147483648" paraPrIDRef="${ppr}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="${cpr}">${ln === '' ? '' : `<hp:t>${xesc(ln)}</hp:t>`}</hp:run></hp:p>`).join('');
    return tc.replace(/(<hp:subList\b[^>]*>)[\s\S]*?(<\/hp:subList>)/, `$1${paras}$2`);
  }
  function fillTable(tbl, records) {
    const first = tbl.indexOf('<hp:tr>');
    const head = tbl.slice(0, first);
    const rows = [...tbl.matchAll(/<hp:tr>[\s\S]*?<\/hp:tr>/g)].map((m) => m[0]);
    const hdr = rows.slice(0, 2), tpl = rows[2] || rows[rows.length - 1];
    const hOf = (r) => Math.max(...[...r.matchAll(/<hp:cellSz width="\d+" height="(\d+)"\/>/g)].map((m) => +m[1]).concat(0));
    const recs = records.length ? records : [null];
    const body = recs.map((rec, i) => {
      const r = 2 + i;
      const cells = cellsOf(tpl).map((tc) => {
        const col = +((tc.match(/colAddr="(\d+)"/) || [])[1] || 0);
        const text = rec ? rec[col] : col === 0 ? '해당 없음' : '';
        return fillCell(tc, text).replace(/rowAddr="\d+"/, `rowAddr="${r}"`).replace(/(<hp:cellSz width="\d+" height=")\d+("\/>)/, `$1${ROW_H}$2`);
      });
      return `<hp:tr>${cells.join('')}</hp:tr>`;
    });
    const height = hdr.reduce((a, r) => a + hOf(r), 0) + ROW_H * recs.length;
    const h2 = head.replace(/rowCnt="\d+"/, `rowCnt="${2 + recs.length}"`).replace(/pageBreak="[A-Z]+"/, 'pageBreak="CELL"').replace(/repeatHeader="\d"/, 'repeatHeader="1"')
      .replace(/(<hp:sz width="\d+" widthRelTo="[A-Z]+" height=")\d+/, `$1${height}`);
    return h2 + hdr.join('') + body.join('') + '</hp:tbl>';
  }
  // 머리에 '오른쪽 정렬' 문단 모양 하나를 더함(확인자·작성자 줄)
  function addRightPara(header, baseId) {
    const m = header.match(new RegExp(`<hh:paraPr id="${baseId}"[\\s\\S]*?</hh:paraPr>`));
    const cnt = header.match(/<hh:paraProperties itemCnt="(\d+)">/);
    if (!m || !cnt) return { header, id: baseId };
    const id = +cnt[1];
    const clone = m[0].replace(`id="${baseId}"`, `id="${id}"`).replace(/horizontal="[A-Z]+"/, 'horizontal="RIGHT"');
    return { header: header.replace(/<hh:paraProperties itemCnt="\d+">/, `<hh:paraProperties itemCnt="${id + 1}">`).replace('</hh:paraProperties>', clone + '</hh:paraProperties>'), id };
  }
  function auditRecords(list) {
    return list.map((r) => [
      r.name, dQuote(r.contractDate), r.start || r.due ? `${dQuote(r.start)}\n~\n${dQuote(r.due)}` : '',
      kfmt(r.est), kfmt(r.amount), r.est && r.amount ? (r.amount / r.est * 100).toFixed(2) : '',
      r.vendor, r.rep, r.addr, r.reason, r.team,
    ]);
  }
  function auditHwpx(rows, o = {}) {
    const T = (root.JH && root.JH.formTpl) || require('./forms-tpl.js');
    const X = (root.JH && root.JH.xlsx) || require('./xlsx.js');
    const min = o.min || 10000000;
    const title = o.title || `수의계약 현황(${manLabel(min)} 이상)`;
    const types = (o.types || TPL_ORDER).slice().sort((a, b) => TPL_ORDER.indexOf(a) - TPL_ORDER.indexOf(b));
    const sec = T.section;
    const tbls = [...sec.matchAll(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/g)].map((m) => m[0]);
    const open = sec.slice(0, sec.indexOf('<hp:p '));
    // 첫 문단의 구역 설정(용지·여백)·쪽 번호 부분
    const p0 = sec.slice(sec.indexOf('<hp:p '), sec.indexOf('</hp:p>') + 7);
    const pHead = p0.match(/^<hp:p\b[^>]*>/)[0];
    const labelAt = p0.indexOf('<hp:run charPrIDRef="9">');
    const ctrlRuns = p0.slice(pHead.length, labelAt > 0 ? labelAt : p0.indexOf('</hp:p>'));
    const label = (type) => `<hp:run charPrIDRef="9"><hp:t>【${type}】${' '.repeat(95)}</hp:t></hp:run><hp:run charPrIDRef="18"><hp:t> (단위 : 천원)</hp:t></hp:run>`;
    const P = (ppr, cpr, inner) => `<hp:p id="0" paraPrIDRef="${ppr}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${inner || `<hp:run charPrIDRef="${cpr}"/>`}</hp:p>`;
    let { header, id: rightId } = addRightPara(T.header, '17');
    const parts = [];
    const withTitle = o.withTitle === true; // 받은 양식에는 제목·확인자 줄이 없음(취합하는 쪽에서 붙임)
    if (withTitle) {
      parts.push(pHead.replace(/paraPrIDRef="\d+"/, 'paraPrIDRef="34"') + ctrlRuns + `<hp:run charPrIDRef="26"><hp:t>${xesc(title)}</hp:t></hp:run></hp:p>`);
      parts.push(P('34', '26'));
      parts.push(P(String(rightId), '18', `<hp:run charPrIDRef="18"><hp:t>${xesc(signLine('확인자', o.confirmer))}</hp:t></hp:run>`));
      parts.push(P(String(rightId), '18', `<hp:run charPrIDRef="18"><hp:t>${xesc(signLine('작성자', o.writer))}</hp:t></hp:run>`));
      parts.push(P('17', '9'));
    }
    types.forEach((type, i) => {
      const tbl = tbls[TPL_ORDER.indexOf(type)] || tbls[0];
      const list = rows.filter((r) => r.type === type).sort(byDate);
      if (i === 0 && !withTitle) parts.push(pHead + ctrlRuns + label(type) + '</hp:p>');
      else parts.push(P('17', '9', label(type)));
      parts.push(`<hp:p id="2147483648" paraPrIDRef="26" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="26">${fillTable(tbl, auditRecords(list))}<hp:t/></hp:run></hp:p>`);
      parts.push(P('26', '26'));
    });
    const section = open + parts.join('') + '</hs:sec>';
    const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>';
    const NS = (sec.match(/<hs:sec ([^>]*)>/) || [])[1] || '';
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const enc = (t) => new TextEncoder().encode(t);
    const files = [
      ['mimetype', 'application/hwp+zip'],
      ['version.xml', `${DECL}<hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" tagetApplication="WORDPROCESSOR" major="5" minor="1" micro="0" buildNumber="1" os="1" xmlVersion="1.4" application="Hancom Office Hangul" appVersion="10, 0, 0, 14727 WIN32LEWindows_8"/>`],
      ['Contents/header.xml', header],
      ['Contents/section0.xml', section],
      ['Preview/PrvText.txt', `${title}\n` + rows.map((r) => `${r.name} ${r.vendor} ${kfmt(r.amount)}`).join('\n').slice(0, 1000)],
      ['settings.xml', `${DECL}<ha:HWPApplicationSetting xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"><ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/></ha:HWPApplicationSetting>`],
      ['META-INF/container.rdf', `${DECL}<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about=""><ns0:hasPart xmlns:ns0="http://www.hancom.co.kr/hwpml/2016/meta/pkg#" rdf:resource="Contents/header.xml"/></rdf:Description><rdf:Description rdf:about="Contents/header.xml"><rdf:type rdf:resource="http://www.hancom.co.kr/hwpml/2016/meta/pkg#HeaderFile"/></rdf:Description><rdf:Description rdf:about=""><ns0:hasPart xmlns:ns0="http://www.hancom.co.kr/hwpml/2016/meta/pkg#" rdf:resource="Contents/section0.xml"/></rdf:Description><rdf:Description rdf:about="Contents/section0.xml"><rdf:type rdf:resource="http://www.hancom.co.kr/hwpml/2016/meta/pkg#SectionFile"/></rdf:Description><rdf:Description rdf:about=""><rdf:type rdf:resource="http://www.hancom.co.kr/hwpml/2016/meta/pkg#Document"/></rdf:Description></rdf:RDF>`],
      ['Contents/content.hpf', `${DECL}<opf:package ${NS} version="" unique-identifier="" id=""><opf:metadata><opf:title>${xesc(title)}</opf:title><opf:language>ko</opf:language><opf:meta name="creator" content="text">계약업무 도우미</opf:meta><opf:meta name="subject" content="text"/><opf:meta name="description" content="text"/><opf:meta name="lastsaveby" content="text">계약업무 도우미</opf:meta><opf:meta name="CreatedDate" content="text">${now}</opf:meta><opf:meta name="ModifiedDate" content="text">${now}</opf:meta><opf:meta name="date" content="text"/><opf:meta name="keyword" content="text"/></opf:metadata><opf:manifest><opf:item id="header" href="Contents/header.xml" media-type="application/xml"/><opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/><opf:item id="settings" href="settings.xml" media-type="application/xml"/></opf:manifest><opf:spine><opf:itemref idref="header" linear="yes"/><opf:itemref idref="section0" linear="yes"/></opf:spine></opf:package>`],
      ['META-INF/container.xml', `${DECL}<ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf"><ocf:rootfiles><ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/><ocf:rootfile full-path="Preview/PrvText.txt" media-type="text/plain"/><ocf:rootfile full-path="META-INF/container.rdf" media-type="application/rdf+xml"/></ocf:rootfiles></ocf:container>`],
      ['META-INF/manifest.xml', `${DECL}<odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>`],
    ];
    return X.zip(files.map(([n, t]) => [n, enc(t)]));
  }
  // 화면 미리보기(시연판)용 간단한 표
  function auditPreview(rows, o = {}) {
    const title = o.title || `수의계약 현황(${manLabel(o.min || 10000000)} 이상)`;
    return [{ name: title, cols: ['구분', '사업명', '계약일자', '계약기간', '예정가격', '계약금액', '계약률(%)', '업체명', '대표자', '주소', '수의계약 사유', '비고'].map((h) => ({ h })),
      rows: [...rows].sort((a, b) => (a.type > b.type ? 1 : a.type < b.type ? -1 : byDate(a, b))).map((r) => [r.type, r.name, dQuote(r.contractDate), `${dQuote(r.start)}~${dQuote(r.due)}`, kfmt(r.est), kfmt(r.amount), r.est && r.amount ? (r.amount / r.est * 100).toFixed(2) : '', r.vendor, r.rep, r.addr, r.reason, r.team]) }];
  }

  const api = { FIELDS, rowOf, inPeriod, auditCandidates, missingOf, inspectSheet, auditHwpx, auditRecords, auditPreview, manLabel, dShort, dQuote, kfmt, signed, isSole };
  root.JH = root.JH || {};
  root.JH.forms = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
