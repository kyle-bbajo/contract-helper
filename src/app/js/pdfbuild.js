/* 인쇄용 PDF 만들기: 표지(목록표) + 서류 순서대로 합치기 + 원본·한글 자리 안내 페이지 */
(function (root) {
  'use strict';
  const A4 = [595.28, 841.89];
  const FONT = '"Pretendard","Malgun Gothic","맑은 고딕",sans-serif';
  const INK = '#23395b', SEAL = '#c23b2e', OK = '#2e7d5b', AMBER = '#9a6418';

  function canvasA4(draw) {
    const c = document.createElement('canvas'); c.width = 1240; c.height = 1754;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#111';
    draw(g, c.width, c.height);
    return new Promise((res) => c.toBlob((b) => b.arrayBuffer().then((a) => res(new Uint8Array(a))), 'image/png'));
  }
  async function addPng(doc, png, index) {
    const img = await doc.embedPng(png);
    const p = index === undefined ? doc.addPage(A4) : doc.insertPage(index, A4);
    p.drawImage(img, { x: 0, y: 0, width: A4[0], height: A4[1] });
  }
  function fit(g, text, w) {
    text = String(text || '');
    if (g.measureText(text).width <= w) return text;
    let t = text; while (t.length > 1 && g.measureText(t + '…').width > w) t = t.slice(0, -1);
    return t + '…';
  }
  async function toPng(bytes, type) {
    const bmp = await createImageBitmap(new Blob([bytes], { type: type || 'image/*' }));
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    const b = await new Promise((r) => c.toBlob(r, 'image/png'));
    return new Uint8Array(await b.arrayBuffer());
  }
  async function addImage(doc, bytes, name) {
    const ext = JH.logic.extOf(name);
    let img = null;
    try { if (ext === 'jpg' || ext === 'jpeg') img = await doc.embedJpg(bytes); else if (ext === 'png') img = await doc.embedPng(bytes); } catch (_) { img = null; }
    if (!img) img = await doc.embedPng(await toPng(bytes));
    const land = img.width > img.height; const W = land ? A4[1] : A4[0], H = land ? A4[0] : A4[1], m = 20;
    const s = Math.min((W - 2 * m) / img.width, (H - 2 * m) / img.height), w = img.width * s, h = img.height * s;
    doc.addPage([W, H]).drawImage(img, { x: (W - w) / 2, y: (H - h) / 2, width: w, height: h });
  }
  function holder(top, big, line, msg) {
    return canvasA4((g, W, H) => {
      g.strokeStyle = '#9aa3b2'; g.lineWidth = 4; g.setLineDash([24, 16]); g.strokeRect(90, 90, W - 180, H - 180); g.setLineDash([]);
      g.textAlign = 'center';
      g.fillStyle = '#667085'; g.font = `36px ${FONT}`; g.fillText(fit(g, top, W - 280), W / 2, H / 2 - 200);
      g.fillStyle = INK; g.font = `bold 66px ${FONT}`; g.fillText(big, W / 2, H / 2 - 90);
      if (line) { g.fillStyle = '#1e2633'; g.font = `34px ${FONT}`; g.fillText(fit(g, line, W - 280), W / 2, H / 2 + 10); }
      g.fillStyle = '#4a5b76'; g.font = `30px ${FONT}`; g.fillText(msg, W / 2, H / 2 + 110);
    });
  }

  // 표지: 서류가 많으면 여러 장
  const COVER = { top0: 520, bottom: 1754 - 150, rh: 40 };
  const PER_FIRST = Math.floor((COVER.bottom - COVER.top0) / COVER.rh), PER_NEXT = Math.floor((COVER.bottom - 200) / COVER.rh);
  const coverPageCount = (rows) => (rows <= PER_FIRST ? 1 : 1 + Math.ceil((rows - PER_FIRST) / PER_NEXT));
  async function coverPages(toc, c, missing) {
    const L = 100, R = 1140, top0 = COVER.top0;
    const rh = COVER.rh, perFirst = PER_FIRST, perNext = PER_NEXT;
    const pages = []; let i = 0, pageNo = 0;
    while (i < toc.length || pageNo === 0) {
      const first = pageNo === 0; const per = first ? perFirst : perNext;
      const slice = toc.slice(i, i + per); i += per; pageNo++;
      const isLast = i >= toc.length;
      pages.push(await canvasA4((g) => {
        let y;
        if (first) {
          g.fillStyle = INK; g.font = `bold 54px ${FONT}`; g.fillText('지출 증빙서류 목록', L, 170);
          g.font = `29px ${FONT}`;
          const d = new Date();
          const facts = [['계약명', c.name || '-'], ['업체', c.vendor || '-'], ['계약번호', c.no || '-'],
            ['계약금액', c.amount ? JH.logic.won(c.amount) : '-'], ['작성일', `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`]];
          facts.forEach(([k, v], n) => { g.fillStyle = '#667085'; g.fillText(k, L, 245 + n * 46); g.fillStyle = '#1e2633'; g.fillText(fit(g, v, R - L - 170), L + 170, 245 + n * 46); });
          y = top0;
        } else {
          g.fillStyle = INK; g.font = `bold 34px ${FONT}`; g.fillText(`지출 증빙서류 목록 (계속) — ${fit(g, c.name, 700)}`, L, 150); y = 220;
        }
        const cx = { stage: L, item: L + 190, file: L + 560, page: R };
        g.fillStyle = '#eef1f5'; g.fillRect(L - 12, y - 36, R - L + 24, 54);
        g.fillStyle = '#4a5b76'; g.font = `bold 24px ${FONT}`;
        g.fillText('단계', cx.stage, y); g.fillText('서류', cx.item, y); g.fillText('파일 / 상태', cx.file, y);
        g.textAlign = 'right'; g.fillText('쪽', cx.page, y); g.textAlign = 'left';
        let prevItem = null, prevStage = null;
        for (const r of slice) {
          y += rh;
          const firstItem = r.iid !== prevItem; prevItem = r.iid;
          const firstStage = firstItem && r.stage !== prevStage; if (firstItem) prevStage = r.stage;
          if (firstItem) { g.strokeStyle = firstStage ? '#c9ced6' : '#eceef2'; g.lineWidth = 2; g.beginPath(); g.moveTo(firstStage ? L - 12 : cx.item - 10, y - rh + 12); g.lineTo(R + 12, y - rh + 12); g.stroke(); }
          g.font = `22px ${FONT}`;
          if (firstStage) { g.fillStyle = INK; g.font = `bold 22px ${FONT}`; g.fillText(fit(g, r.stage, cx.item - cx.stage - 14), cx.stage, y); g.font = `22px ${FONT}`; }
          if (firstItem) { g.fillStyle = '#1e2633'; g.font = `600 22px ${FONT}`; g.fillText(fit(g, r.item, cx.file - cx.item - 18), cx.item, y); g.font = `22px ${FONT}`; }
          if (r.status === 'missing') { g.fillStyle = SEAL; g.font = `bold 22px ${FONT}`; g.fillText('누락', cx.file, y); }
          else if (r.status === 'none') { g.fillStyle = '#9aa3b2'; g.fillText('해당 없음', cx.file, y); }
          else {
            const note = r.note ? ` (${r.note})` : '';
            g.fillStyle = r.orig ? AMBER : '#1e2633';
            const t = fit(g, r.file, cx.page - cx.file - 110 - (note ? g.measureText(note).width : 0));
            g.fillText(t, cx.file, y);
            if (note) { g.fillStyle = AMBER; g.fillText(note, cx.file + g.measureText(t).width, y); }
            g.fillStyle = '#1e2633'; g.textAlign = 'right';
            g.fillText(r.start ? (r.pages > 1 ? `${r.start}–${r.start + r.pages - 1}` : String(r.start)) : '-', cx.page, y); g.textAlign = 'left';
          }
        }
        if (isLast) {
          g.font = `bold 25px ${FONT}`;
          if (missing.length) { g.fillStyle = SEAL; g.fillText(fit(g, '필수 서류 누락: ' + missing.join(', '), R - L), L, 1754 - 100); }
          else { g.fillStyle = OK; g.fillText('필수 서류 모두 확인됨', L, 1754 - 100); }
        }
      }));
    }
    return pages;
  }

  /**
   * @param c        계약
   * @param list     서류 목록(체크리스트)
   * @param docs     이 계약의 서류 기록
   * @param getFile  async (doc) => { bytes, name, kind } (한글은 변환된 PDF가 있으면 그것)
   */
  async function build(c, list, docs, getFile, opts) {
    const { PDFDocument } = root.PDFLib;
    const out = await PDFDocument.create();
    const useCover = opts.cover !== false, useHolder = opts.holder !== false;
    const originals = c.originals || {}, received = c.received || {};
    const toc = [], errors = [], missing = [];
    let page = 0;
    // 표지 쪽수는 목록 길이로 미리 계산
    const tocRows = list.reduce((n, it) => n + Math.max(1, docs.filter((d) => d.itemId === it.id).length), 0);
    const coverCount = useCover ? coverPageCount(tocRows) : 0;
    for (const it of list) {
      const ds = docs.filter((d) => d.itemId === it.id);
      const top = `${it.group} · ${it.name}`;
      const rb = { iid: it.id, item: it.name, stage: it.group };
      if (!ds.length) {
        if (originals[it.id]) {
          let added = 0;
          if (useHolder) { await addPng(out, await holder(top, '원본 서류 자리', '', '이 위치에 업체가 제출한 원본 서류를 끼워 넣으세요.')); added = 1; }
          toc.push({ ...rb, file: '원본 첨부', orig: true, status: 'ok', start: added ? coverCount + page + 1 : null, pages: added }); page += added;
        } else if (received[it.id]) toc.push({ ...rb, file: '받음 표시(파일 없음)', status: 'ok', start: null, pages: 0 });
        else { toc.push({ ...rb, status: it.required ? 'missing' : 'none' }); if (it.required) missing.push(it.name); }
        continue;
      }
      for (const d of ds) {
        let added = 0, note = '';
        try {
          const f = await getFile(d);
          if (f.kind === 'pdf') {
            const src = await PDFDocument.load(f.bytes, { ignoreEncryption: true });
            const ps = await out.copyPages(src, src.getPageIndices()); ps.forEach((p) => out.addPage(p)); added = ps.length;
          } else if (f.kind === 'image') { await addImage(out, f.bytes, f.name); added = 1; }
          else {
            note = f.kind === 'hwp' ? '한글 – 별도 인쇄' : '별도 인쇄';
            if (useHolder) { await addPng(out, await holder(top, f.kind === 'hwp' ? '한글 파일 자리' : '별도 인쇄 파일 자리', d.name, '이 위치에 해당 파일을 따로 인쇄해서 끼워 넣으세요.')); added = 1; }
          }
        } catch (e) {
          console.error(e); errors.push(d.name); note = '읽기 실패 – 별도 인쇄';
          if (useHolder) { await addPng(out, await holder(top, '읽을 수 없는 파일', d.name, '이 위치에 해당 파일을 따로 인쇄해서 끼워 넣으세요.')); added = 1; }
        }
        toc.push({ ...rb, file: d.name, note, status: 'ok', start: added ? coverCount + page + 1 : null, pages: added });
        page += added;
      }
    }
    if (useCover) {
      const pages = await coverPages(toc, c, missing);
      for (let k = pages.length - 1; k >= 0; k--) await addPng(out, pages[k], 0);
    }
    if (out.getPageCount() === 0) throw new Error('인쇄할 페이지가 없습니다.');
    out.setTitle(`${c.name || '계약'} 지출서류`);
    return { bytes: await out.save(), errors, missing, pages: out.getPageCount() };
  }

  root.JH = root.JH || {};
  root.JH.pdfbuild = { build };
})(window);
