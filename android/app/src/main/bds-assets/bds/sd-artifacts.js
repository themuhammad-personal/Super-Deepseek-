/* Super DeepSeek — artifacts (claude.ai pattern).
 *
 * ```sds-genui blocks (header or JSON envelope), legacy ```sds-html / ```sds-svg
 * and complete raw ```html documents become a compact artifact card in the
 * message: icon tile, title, type · version. Tapping it opens the artifact
 * viewer (sd-genui-viewer.js) with Preview | Code, versions, copy, download,
 * share, full screen and edit with AI. Same id ⇒ new version of one artifact.
 *
 * Kinds that belong in the answer itself (ui widgets, tool results, MCP apps,
 * and anything marked "presentation: inline") render inline instead.
 * If anything fails the original code block stays visible.
 */
(function (root) {
  'use strict';
  if (root.__sdArtifacts && root.__sdArtifacts.version === 3) return;
  if (!root.__sdGenUIProtocol) return;
  var P = root.__sdGenUIProtocol, doc = root.document;
  function H() { return root.__sdGenUIHost || null; }
  function V() { return root.__sdGenUIViewer || null; }
  function bn() { try { return (doc.documentElement.lang || root.navigator.language || '').toLowerCase().indexOf('bn') === 0; } catch (_) { return false; } }
  function t(en, b) { return bn() ? b : en; }
  function el(tag, cls, text) { var n = doc.createElement(tag); if (cls) n.className = cls; if (text !== undefined && text !== null) n.textContent = text; return n; }

  var TYPED = ['sds-genui', 'sds-artifact', 'sds-svg', 'sds-html'], RAW = ['html', 'htm'];
  var STABLE_MS = 1600;
  var CARD_KINDS = ['html-app', 'react', 'svg', 'mermaid', 'document', 'code'];

  /* ---------------- normalization ---------------- */
  function headerValue(text, key) {
    var m = new RegExp('^\\s*' + key + '\\s*:\\s*(.+)$', 'm').exec(text) || new RegExp('"' + key + '"\\s*:\\s*"([^"]{1,160})"').exec(text);
    return m ? m[1].trim().slice(0, 120) : '';
  }
  function inlineRequested(source) {
    if (/^\s*\{/.test(source)) {
      try { return JSON.parse(source).presentation === 'inline'; } catch (_) { return false; }
    }
    // Match the protocol header boundary, not arbitrary body text. The first
    // presentation header wins, just as it does in sd-genui-protocol.js.
    var lines = String(source || '').replace(/^\uFEFF/, '').split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^\s*---\s*$/.test(line) || !line.trim() || /^\s*</.test(line)) break;
      var m = /^\s*([A-Za-z][A-Za-z_-]{0,31})\s*:\s?(.*)$/.exec(line);
      if (!m) break;
      if (m[1].toLowerCase() === 'presentation') {
        return m[2].trim().replace(/^[\"'`]|[\"'`]$/g, '').toLowerCase() === 'inline';
      }
    }
    return false;
  }
  /** -> {ok, block, raw, waiting, skip, error} */
  function normalize(lang, source, final) {
    var text = String(source || '').replace(/\s+$/, '');
    if (lang === 'sds-genui' || lang === 'sds-artifact') {
      if (!/^\s*\{/.test(source) && !final) {
        var k = headerValue(source, 'kind');
        var early = (k === 'svg' && /<\/svg\s*>$/i.test(text)) || ((k === 'html-app' || k === 'html') && /<\/html\s*>$/i.test(text));
        if (!early) return { ok: false, error: 'Waiting for the block to finish', waiting: true };
      }
      if (/^\s*\{/.test(source) && !final) { try { JSON.parse(source); } catch (_) { return { ok: false, error: 'Waiting for the block to finish', waiting: true }; } }
      var r0 = P.parseBlock ? P.parseBlock(source) : P.validate(source);
      if (r0.ok) r0.inline = inlineRequested(source);
      return r0;
    }
    var kind = lang === 'sds-svg' ? 'svg' : 'html-app';
    var raw = RAW.indexOf(lang) >= 0;
    if (kind === 'svg') {
      if (!/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(text)) return { ok: false, error: 'Not an SVG document' };
      if (!/<\/svg\s*>$/i.test(text)) return final ? { ok: false, error: 'Incomplete SVG' } : { ok: false, error: 'Waiting for complete SVG', waiting: true };
      text = text.replace(/^\s*<\?xml[^>]*>\s*/i, '').replace(/^(?:\s*<!--[\s\S]*?-->)*\s*/, '');
    } else if (raw) {
      // Fallback renderer only for complete documents/apps, never snippets.
      var looksDoc = /<!doctype html|<html[\s>]/i.test(text) || (/<(body|main|canvas|section|div)[\s>]/i.test(text) && /<(style|script)[\s>]/i.test(text));
      if (!looksDoc) return { ok: false, error: 'HTML snippet', skip: true };
      if (/<html[\s>]/i.test(text) && !/<\/html\s*>$/i.test(text)) return final ? { ok: false, error: 'Incomplete HTML', skip: true } : { ok: false, error: 'Waiting for complete HTML document', waiting: true };
      if (!final && !/<\/(html|body)\s*>$/i.test(text)) return { ok: false, error: 'Waiting for complete HTML', waiting: true };
    } else if (!/<\/html\s*>$/i.test(text) && !final) return { ok: false, error: 'Waiting for complete HTML document', waiting: true };
    var title = kind === 'svg' ? ((/<title>([^<]{1,120})<\/title>/i.exec(text) || [])[1] || 'Illustration') :
      ((/<title>([^<]{1,120})<\/title>/i.exec(text) || [])[1] || (/<h1[^>]*>([^<]{1,120})<\/h1>/i.exec(text) || [])[1] || 'Web app');
    var id = (raw ? 'html-' : 'legacy-') + ((H() && H().hash(title.trim().toLowerCase())) || 'a').toString().replace(/[^a-z0-9]/gi, '').slice(0, 12).toLowerCase();
    var payload = kind === 'svg' ? { svg: text } : { html: '', css: '', js: '', source: text };
    var r = P.validate(JSON.stringify({ version: 1, id: 'a' + id, kind: kind, title: title.trim(), payload: payload }));
    if (r.ok) r.raw = raw;
    return r;
  }

  /* ---------------- card (claude.ai) ---------------- */
  function hideSource(container, on) {
    if (on) container.setAttribute('data-sd-hidden', 'artifact');
    else if (container.getAttribute('data-sd-hidden') === 'artifact') container.removeAttribute('data-sd-hidden');
  }
  function buildCard(state) {
    var Vw = V();
    var card = el('div', 'sd-art');
    card.setAttribute('data-sd-owned', 'artifact');
    card.setAttribute('role', 'button'); card.tabIndex = 0;
    var tile = el('div', 'sd-art-tile');
    var text = el('div', 'sd-art-text');
    var title = el('div', 'sd-art-title');
    var sub = el('div', 'sd-art-sub');
    text.append(title, sub);
    var dl = Vw ? Vw.iconButton('download', t('Download', 'ডাউনলোড'), function () { download(state); }, 'sd-art-dl') : el('span');
    card.append(tile, text, dl);
    function activate(e) { if (e.target.closest && e.target.closest('.sd-art-dl')) return; openState(state); }
    card.addEventListener('click', activate);
    card.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(e); } });
    state.card = card; state.cardTitle = title; state.cardSub = sub; state.cardTile = tile; state.cardDl = dl;
    return card;
  }
  function paintCard(state) {
    var Vw = V(); if (!state.card || !Vw) return;
    var kind = state.kind || 'html-app', info = Vw.describe(kind, state.payload);
    state.card.setAttribute('data-kind', kind);
    state.cardTitle.textContent = state.title || t('Untitled artifact', 'শিরোনামহীন আর্টিফ্যাক্ট');
    state.cardTile.textContent = '';
    if (state.streaming) {
      state.card.classList.add('sd-art-busy');
      state.cardTile.appendChild(el('span', 'sd-spin'));
      state.cardSub.textContent = t('Generating…', 'তৈরি হচ্ছে…');
      state.cardDl.hidden = true;
    } else {
      state.card.classList.remove('sd-art-busy');
      state.cardTile.appendChild(Vw.icon(info.icon, 20));
      var rec = state.key ? Vw.store.get(state.key) : null;
      var n = rec ? rec.versions.length : 1;
      state.cardSub.textContent = (kind === 'code' ? info.label + ' · ' + info.short : info.label + ' · ' + info.short) + (n > 1 ? ' · ' + t('Version ', 'ভার্সন ') + (state.versionIndex + 1) : '');
      state.cardDl.hidden = false;
    }
  }
  function openState(state) {
    var Vw = V(); if (!Vw) return;
    if (state.streaming) {
      Vw.open({ key: state.key, live: { kind: state.kind || 'html-app', title: state.title || t('Artifact', 'আর্টিফ্যাক্ট'), payload: {} } }, { streamingText: state.body || '' });
      return;
    }
    if (!state.key) return;
    Vw.open({ key: state.key }, { version: state.versionIndex });
  }
  function download(state) {
    var Vw = V(); if (!Vw || !state.key) return;
    var rec = Vw.store.get(state.key); if (!rec) return;
    var v = rec.versions[state.versionIndex] || rec.versions[rec.versions.length - 1], info = Vw.describe(v.kind, v.payload);
    Vw.download(v, info.ext, info.mime);
  }

  /* ---------------- inline kinds ---------------- */
  function renderInline(block, state, art) {
    var host = el('div', 'sd-inline');
    host.setAttribute('data-sd-owned', 'inline');
    host.setAttribute('data-kind', art.kind);
    if (art.kind === 'ui') {
      var G = root.__sdGenUI; if (!G) throw Error('Widget renderer unavailable');
      var parsed = G.parseSpec(art.payload.spec); if (!parsed.ok) throw Error(parsed.error);
      var surface = G.renderSpec(parsed.spec); host.appendChild(surface);
      block.container.parentNode.insertBefore(host, block.container.nextSibling);
      if (surface.__sdGenUIScope) G.updateSurface(surface.__sdGenUIScope);
    } else if (art.kind === 'tool-result') {
      var Vs = root.__sdGenUIVisuals, plan = null;
      var head = el('div', 'sd-inline-head');
      head.append(el('span', 'sd-inline-dot'), el('span', 'sd-inline-name', art.payload.name || art.title || t('Tool result', 'টুল ফলাফল')));
      host.appendChild(head);
      var body = el('div', 'sd-inline-body'); host.appendChild(body);
      if (Vs && art.payload.view !== 'json') { try { plan = Vs.render(body, art.payload.result, { name: art.payload.name, view: art.payload.view, title: art.title }); } catch (_) { plan = null; } }
      if (!plan) { var pre = el('pre', 'sd-inline-json'); pre.textContent = JSON.stringify(art.payload.result, null, 2); body.appendChild(pre); }
      block.container.parentNode.insertBefore(host, block.container.nextSibling);
    } else if (art.kind === 'mcp-app') {
      var M = root.__sdGenUIMcp;
      if (!M) throw Error('MCP app host unavailable');
      block.container.parentNode.insertBefore(host, block.container.nextSibling);
      M.mountDeclared(host, { serverUrl: art.payload.serverUrl, resourceUri: art.payload.resourceUri, title: art.title, view: art.payload.view });
    } else {
      // presentation: inline → same live renderer as ```sds-visual
      var I = root.__sdGenUIInline; if (!I) throw Error('Inline renderer unavailable');
      var Vw = V(), src = Vw ? Vw.sourceOf(art) : '';
      var view = I.createView({ kind: art.kind === 'svg' ? 'svg' : art.kind === 'mermaid' ? 'mermaid' : 'visual', title: art.title });
      host.appendChild(view.el);
      block.container.parentNode.insertBefore(host, block.container.nextSibling);
      view.finish(src);
      state.view = view;
    }
    state.inlineEl = host;
    hideSource(block.container, true);
    claimDone(block.container);
  }

  function showError(state, block, message) {
    if (state.errorEl) state.errorEl.remove();
    if (state.card) { state.card.remove(); state.card = null; }
    var n = errorCard({
      title: t('Couldn’t display this artifact', 'এই আর্টিফ্যাক্টটি দেখানো যায়নি'),
      detail: message, container: block.container,
      fix: 'The artifact block above could not be rendered (' + message + '). Please send it again as one complete ```sds-genui block with id, kind and title headers, then --- and the full body.'
    });
    block.container.parentNode.insertBefore(n, block.container);
    state.errorEl = n;
    // The source stays out of the answer; "Show code" reveals it on demand.
    hideSource(block.container, true);
    claimDone(block.container);
  }
  /** Polished, quiet failure surface shared by every renderer (exported). */
  function errorCard(o) {
    var Vw = V();
    var n = el('div', 'sd-art-error'); n.setAttribute('data-sd-owned', 'error'); n.setAttribute('role', 'status');
    var ic = el('span', 'sd-err-icon'); if (Vw) ic.appendChild(Vw.icon('alert', 16)); n.appendChild(ic);
    var tx = el('div', 'sd-err-text');
    tx.appendChild(el('div', 'sd-err-title', o.title));
    if (o.detail) tx.appendChild(el('div', 'sd-err-detail', String(o.detail).slice(0, 200)));
    n.appendChild(tx);
    var acts = el('div', 'sd-err-actions');
    if (o.container) {
      var shown = false, codeBtn = el('button', 'sd-chip', t('Show code', 'কোড দেখুন')); codeBtn.type = 'button';
      codeBtn.addEventListener('click', function () {
        shown = !shown;
        if (shown) o.container.removeAttribute('data-sd-hidden'); else o.container.setAttribute('data-sd-hidden', 'artifact');
        codeBtn.textContent = shown ? t('Hide code', 'কোড লুকান') : t('Show code', 'কোড দেখুন');
      });
      acts.appendChild(codeBtn);
    }
    if (o.fix) {
      var fixBtn = el('button', 'sd-chip sd-chip-primary', t('Ask to fix', 'ঠিক করতে বলুন')); fixBtn.type = 'button';
      fixBtn.addEventListener('click', function (e) { var Ho = H(); if (!Ho) return; var r = Ho.sendPrompt(o.fix, { label: 'Fix', submit: true, event: e }); if (!r.ok && Vw) Vw.toast(r.error); });
      acts.appendChild(fixBtn);
    }
    n.appendChild(acts);
    return n;
  }

  /* ---------------- scanning ---------------- */
  var states = new WeakMap(), pending = null;
  function stateOf(container) {
    var s = states.get(container);
    if (!s) { s = { text: null, changedAt: 0, done: false, card: null, key: null, versionIndex: 0 }; states.set(container, s); }
    return s;
  }
  function claimDone(c) { var Ho = H(); if (Ho && Ho.claimDone) Ho.claimDone(c); }
  function unclaim(c) { var Ho = H(); if (Ho && Ho.unclaim) Ho.unclaim(c); }
  function ensureCard(block, s) {
    if (!s.card) buildCard(s);
    if (!s.card.isConnected && block.container.parentNode) block.container.parentNode.insertBefore(s.card, block.container.nextSibling);
    hideSource(block.container, true);
    claimDone(block.container);
  }
  function settle(block, s, art, raw) {
    var Vw = V();
    if (s.errorEl) { s.errorEl.remove(); s.errorEl = null; }
    if (CARD_KINDS.indexOf(art.kind) < 0 || (s.inlineWanted && ['svg', 'html-app', 'mermaid'].indexOf(art.kind) >= 0)) {
      if (s.card) { s.card.remove(); s.card = null; }
      renderInline(block, s, art);
      record('render', art.title, art.kind + ' · inline');
      return;
    }
    var res = Vw.store.upsert(art.id, { kind: art.kind, title: art.title, payload: art.payload, revision: art.revision });
    s.key = res.record.key; s.versionIndex = res.index;
    s.kind = art.kind; s.title = art.title; s.payload = art.payload; s.streaming = false;
    ensureCard(block, s);
    paintCard(s);
    var cur = Vw.current && Vw.current();
    if (cur && cur.key === s.key && cur.streamingText != null) cur.stream(null, true);
    record('render', art.title, art.kind + (raw ? ' (auto-detected)' : '') + ' · v' + (res.index + 1));
  }
  function record(type, title, detail) { var Ho = H(); try { if (Ho && Ho.ledger) Ho.ledger.record({ type: type, title: title, detail: detail, state: 'rendered', endedAt: Date.now() }); } catch (_) {} }
  function streamingPreview(block, s, text, lang) {
    // A typed block is being written: show the card with "Generating…" (Claude) and
    // feed the open viewer, if any, the live source.
    var Vw = V(); if (!Vw) return;
    var bodyText = text;
    if (lang === 'sds-genui' || lang === 'sds-artifact') {
      if (/^\s*\{/.test(text)) { s.kind = headerValue(text, 'kind') || 'html-app'; s.title = headerValue(text, 'title'); }
      else {
        var cut = text.search(/\n---\s*\n/);
        var header = cut >= 0 ? text.slice(0, cut) : text;
        s.kind = (P.kindAliases && P.kindAliases[headerValue(header, 'kind')]) || headerValue(header, 'kind') || 'html-app';
        s.title = headerValue(header, 'title');
        if (/^\s*presentation\s*:\s*inline\s*$/m.test(header)) s.inlineWanted = true;
        bodyText = cut >= 0 ? text.slice(cut).replace(/^\n---\s*\n/, '') : '';
        var id = headerValue(header, 'id') || (s.title ? s.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') : '');
        if (id) s.key = Vw.store.chatKey() + ':' + (/^[a-z]/.test(id) ? id : 'a-' + id).slice(0, 64);
      }
    } else {
      if (RAW.indexOf(lang) >= 0 && !/<!doctype html|<html[\s>]/i.test(text)) return;
      s.kind = lang === 'sds-svg' ? 'svg' : 'html-app'; s.title = (/<title>([^<]{1,120})<\/title>/i.exec(text) || [])[1] || ''; }
    if (CARD_KINDS.indexOf(s.kind) < 0 || s.inlineWanted) return; // inline kinds appear when complete
    s.streaming = true; s.body = bodyText;
    ensureCard(block, s); paintCard(s);
    var cur = Vw.current && Vw.current();
    if (cur && s.key && cur.key === s.key && cur.streamingText != null) cur.stream(bodyText, false);
  }
  function scanOnce() {
    var Ho = H(), Vw = V(); if (!Ho || !Vw || !doc.body) return;
    var config = Ho.config(); if (!config.enabled) return;
    var now = Date.now(), waiting = false;
    Ho.codeBlocks(doc).forEach(function (block) {
      var lang = String(block.lang || '').toLowerCase();
      var typed = TYPED.indexOf(lang) >= 0;
      if (!typed && !(config.fallbackRenderer !== false && RAW.indexOf(lang) >= 0)) return;
      var s = stateOf(block.container), text = block.text;
      if (s.card && !s.card.isConnected && s.done && block.container.parentNode) { block.container.parentNode.insertBefore(s.card, block.container.nextSibling); hideSource(block.container, true); }
      if (s.inlineEl && !s.inlineEl.isConnected && block.container.parentNode) { block.container.parentNode.insertBefore(s.inlineEl, block.container.nextSibling); hideSource(block.container, true); }
      if (s.text !== text) { s.text = text; s.changedAt = now; s.done = false; }
      if (s.done) return;
      var final = Ho.followed(block) || now - s.changedAt >= STABLE_MS;
      Ho.guard('artifacts', function () {
        var r = normalize(lang, text, final);
        if (r.skip) { s.done = true; if (s.card) { s.card.remove(); s.card = null; } hideSource(block.container, false); unclaim(block.container); return; }
        if (r.ok) {
          s.done = true;
          if (r.inline) s.inlineWanted = true;
          if (s.inlineEl) { try { if (s.view) s.view.destroy(); } catch (_) {} s.inlineEl.remove(); s.inlineEl = null; }
          settle(block, s, r.block, r.raw);
          return;
        }
        if (r.waiting && !final) { waiting = true; if (typed || text.length > 200) streamingPreview(block, s, text, lang); return; }
        s.done = true;
        if (typed) showError(s, block, r.error);
        else { if (s.card) { s.card.remove(); s.card = null; } hideSource(block.container, false); unclaim(block.container); }
      });
    });
    if (waiting) schedule(STABLE_MS + 60);
  }
  function scan() { var Ho = H(); if (Ho) Ho.guard('artifacts-scan', scanOnce); }
  var pendingAt = 0;
  function schedule(ms) {
    ms = ms || 180;
    if (pending !== null) { if (Date.now() + ms >= pendingAt) return; clearTimeout(pending); }
    pendingAt = Date.now() + ms;
    pending = setTimeout(function () { pending = null; scan(); }, ms);
  }
  (function hook() { var Ho = H(); if (Ho && Ho.onClaim) Ho.onClaim(function () { schedule(16); }); })();
  function teardown() {
    doc.querySelectorAll('.sd-art,.sd-art-error,.sd-inline').forEach(function (n) { n.remove(); });
    doc.querySelectorAll('[data-sd-hidden="artifact"]').forEach(function (n) { n.removeAttribute('data-sd-hidden'); });
    states = new WeakMap();
    if (V()) V().close();
  }

  root.__sdArtifacts = { version: 3, scan: scan, normalize: normalize, teardown: teardown, errorCard: errorCard };
  if (doc && doc.body) {
    scan();
    new root.MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var tg = records[i].target; if (tg && tg.nodeType === 3) tg = tg.parentNode;
        if (tg && tg.closest && tg.closest('[data-sd-owned],#sd-viewer')) continue;
        schedule(); return;
      }
    }).observe(doc.body, { childList: true, subtree: true, characterData: true });
  }
  if (root.addEventListener) root.addEventListener('sd-genui:config', function (e) { if (e.detail && e.detail.enabled === false) teardown(); else schedule(); });
})(window);
