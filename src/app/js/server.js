/* 내 PC 연결 창구(server.ps1)와 통신 */
(function (root) {
  'use strict';
  const meta = document.querySelector('meta[name="jh-token"]');
  const token = meta && !/^__/.test(meta.content) ? meta.content : '';
  const online = !!token && location.protocol.startsWith('http');

  async function call(method, path, params, body) {
    if (!online) throw new Error('바탕화면의 "계약업무 도우미" 아이콘으로 실행해야 합니다.');
    const q = params ? '?' + new URLSearchParams(params).toString() : '';
    // 작은 저장은 창을 닫는 중에도 끝까지 보냄(keepalive는 64KB까지만 됨)
    const small = body != null && (typeof body === 'string' ? body.length : body.byteLength || 0) < 60000;
    const res = await fetch(path + q, { method, headers: { 'X-JH-Token': token }, body, keepalive: method !== 'GET' && small });
    const type = res.headers.get('content-type') || '';
    if (type.includes('application/json')) {
      const j = await res.json();
      if (!res.ok || j.ok === false) { const e = new Error(j.error || `요청 실패(${res.status})`); e.status = res.status; e.data = j; throw e; }
      return j;
    }
    if (!res.ok) throw new Error(`요청 실패(${res.status})`);
    return res;
  }

  const server = {
    online, token,
    ping: () => call('GET', '/api/ping'),
    async readBytes(path) { const r = await call('GET', '/api/file', { path }); return new Uint8Array(await r.arrayBuffer()); },
    async readJson(path) {
      try { const r = await call('GET', '/api/file', { path }); return r instanceof Response ? JSON.parse(await r.text()) : r; }
      catch (e) { if (e.status === 404) return null; throw e; }
    },
    // compact: 큰 파일(서류대장)은 줄 바꿈 없이(크기 ⅔) — 사람이 읽는 작은 설정 파일은 보기 좋게
    writeJson: (path, obj, compact) => call('PUT', '/api/file', { path }, compact ? JSON.stringify(obj) : JSON.stringify(obj, null, 1)),
    writeBytes: (path, bytes) => call('PUT', '/api/file', { path }, bytes),
    save: (dir, name, bytes) => call('POST', '/api/save', { dir, name }, bytes),
    move: (from, dir, name) => call('POST', '/api/move', { from, dir, name }),
    remove: (path) => call('POST', '/api/delete', { path }),
    list: (dir, recursive) => call('GET', '/api/list', { dir, recursive: recursive ? '1' : '0' }),
    async nara(url) {
      const r = await call('GET', '/api/nara', { u: url });
      if (!(r instanceof Response)) return r;
      return JH.logic.parseApiText(await r.text());
    },
    hwp2pdf: (path) => call('POST', '/api/hwp2pdf', { path }),
    office2pdf: (path) => call('POST', '/api/office2pdf', { path }),
    myIp: () => call('GET', '/api/myip'),
    async law(u) { const r = await call('GET', '/api/law', { u }); return r.text(); },
    async lawFile(u) { const r = await call('GET', '/api/law', { u }); return new Uint8Array(await r.arrayBuffer()); },
    watch: () => call('GET', '/api/watch'),
    watchPick: () => call('POST', '/api/watch', { pick: '1' }),
    watchClear: (i) => call('POST', '/api/watch', { clear: String(i) }),
    async watchFile(name) { const r = await call('GET', '/api/watchfile', { name }); return new Uint8Array(await r.arrayBuffer()); },
    // 설치된 한글로 .hwp → .hwpx(공고문 양식을 그대로 채우려고)
    hwpConvert: (path, fmt) => call('POST', '/api/hwpconvert', { path, fmt }),
    hwpSec: (apply) => call('GET', '/api/hwpsec', apply ? { apply: '1' } : {}),
    // AI(Claude) 중계 — 키는 이 PC 설정에만 있고, 연결 창구가 api.anthropic.com으로만 보냄
    ai: (body) => call('POST', '/api/ai', null, JSON.stringify(body)),
    // PC 안 AI(Ollama) 설치 상태·다시 설치 — AI 호출은 화면이 127.0.0.1:11434로 바로 함(JH.ai)
    aiStatus: () => call('GET', '/api/ai/status'),
    aiSetup: (body) => call('POST', '/api/ai/setup', null, JSON.stringify(body || {})),
    async fetchFile(url) { const r = await call('GET', '/api/fetchfile', { u: url }); return new Uint8Array(await r.arrayBuffer()); },
    openFile: (path) => call('POST', '/api/open', { path, launch: '1' }),
    open: (path) => call('POST', '/api/open', { path }),
    pickFolder: () => call('POST', '/api/pickfolder'),
    quit: () => call('POST', '/api/quit'),
    fileUrl: (path) => `/api/file?${new URLSearchParams({ path, t: token })}`,
  };
  root.JH = root.JH || {};
  root.JH.server = server;
})(window);
