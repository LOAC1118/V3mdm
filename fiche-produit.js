/* ═══════════════════════════════════════════════════════════════════════
   FICHE PRODUIT — informations détaillées issues du site moulindesmoines.com
   (description, ingrédients, allergènes, valeurs nutritionnelles, labels,
   origine, conservation, photo, prix public) rapprochées des produits du CRM
   par code-barres (EAN).
   Données : produits-web.js (window.PRODUITS_WEB, chargé à la demande).
   Utilisation : FicheProduit.open(eanOuCode) · FicheProduit.search()
   Dans « Recherche produit », un bouton ℹ️ est ajouté à côté de chaque code-barres.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  var _loading = null;

  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function $(id){ return document.getElementById(id); }
  function norm(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,' ').trim(); }
  function note(m,t){ try { toast(m,t||'ok'); } catch(e){ console.log(m); } }
  function eur(n){ return (n==null||isNaN(n)) ? '—' : Number(n).toFixed(2).replace('.',',') + ' €'; }
  function prods(){ try { return (typeof PRODUCTS !== 'undefined' && PRODUCTS) ? PRODUCTS : []; } catch(e){ return []; } }
  function eans(p){ return String(p && p.ean || '').split(';').map(function(x){ return x.trim(); }).filter(Boolean); }

  function loadData() {
    if (window.PRODUITS_WEB) return Promise.resolve(window.PRODUITS_WEB);
    if (_loading) return _loading;
    _loading = new Promise(function(res){
      var s = document.createElement('script'); s.src = 'produits-web.js?v=' + (window.FICHE_WEB_VER || 1);
      s.onload = function(){ res(window.PRODUITS_WEB || {}); };
      s.onerror = function(){ _loading = null; window.PRODUITS_WEB = {}; note('Fiches du site indisponibles (fichier produits-web.js absent)', 'err'); res({}); };
      document.head.appendChild(s);
    });
    return _loading;
  }
  // Produit CRM + fiche site pour un code-barres ou un code article
  function lookup(q) {
    q = String(q || '').trim(); var P = prods(), W = window.PRODUITS_WEB || {};
    var p = P.filter(function(x){ return x.code === q || eans(x).indexOf(q) !== -1; })[0] || null;
    var w = null, list = p ? eans(p) : [q];
    for (var i = 0; i < list.length && !w; i++) if (W[list[i]]) w = W[list[i]];
    if (!w && p) { Object.keys(W).some(function(k){ if (W[k].r && W[k].r === p.code) { w = W[k]; return true; } return false; }); }
    return { p: p, w: w };
  }

  // ── Mise en forme ──
  function allergenize(t) {   // les allergènes sont en MAJUSCULES dans les listes d'ingrédients
    return esc(t).replace(/(^|[\s,(;:])([A-ZÀ-ÖØ-Þ]{3,}(?:[ '’-][A-ZÀ-ÖØ-Þ]{2,})*)(?=[\s,.)*;:]|$)/g, function(m, a, b){ return a + '<b>' + b + '</b>'; });
  }
  function nutri(rows) {
    if (!rows || !rows.length) return '';
    var h = '<table class="fp-nu">';
    rows.forEach(function(r, i){
      if (i === 0) { h += '<tr><th>' + esc(r[0] || '') + '</th><th>' + esc(r[1] || '') + '</th></tr>'; return; }
      h += '<tr' + (/^\s*-/.test(r[0]) ? ' class="sub"' : '') + '><td>' + esc(r[0]) + '</td><td>' + esc(r[1] || '') + '</td></tr>';
    });
    return h + '</table>';
  }
  function sec(title, body) { return body ? '<div class="fp-s"><div class="fp-t">' + title + '</div>' + body + '</div>' : ''; }

  function textFiche(p, w) {
    var t = [(w && w.n) || (p && p.libelle) || '', ''];
    if (p) t.push('Réf. ' + p.code + (eans(p)[0] ? ' · EAN ' + eans(p)[0] : '') + (p.pcb ? ' · colisage ' + p.pcb : ''));
    if (w) {
      if (w.d) t.push('', w.d);
      if (w.t && w.t['Ingrédient(s)']) t.push('', 'Ingrédients : ' + w.t['Ingrédient(s)']);
      if (w.t && w.t['Informations complémentaires']) t.push('', w.t['Informations complémentaires']);
      if (w.t && w.t['Origine(s) possible(s)']) t.push('Origine : ' + w.t['Origine(s) possible(s)']);
      if (w.l && w.l.length) t.push('Labels : ' + w.l.join(', '));
      if (w.nu) { t.push('', 'Valeurs nutritionnelles (' + (w.nu[0] && w.nu[0][1] || '100 g') + ') :'); w.nu.slice(1).forEach(function(r){ t.push('  ' + r[0] + ' : ' + (r[1] || '')); }); }
      if (w.u) t.push('', 'https://moulindesmoines.com' + w.u);
    }
    return t.join('\n');
  }

  // ── Fiche ──
  function open(q) {
    css();
    var old = $('fp-ov'); if (old) old.remove();
    var ov = document.createElement('div'); ov.id = 'fp-ov';
    ov.onclick = function(e){ if (e.target === ov) close(); };
    ov.innerHTML = '<div class="fp"><div class="fp-h"><b>Fiche produit</b><button class="fp-x" onclick="FicheProduit.close()" aria-label="Fermer">✕</button></div><div class="fp-b" id="fp-b"><div class="fp-m">Chargement…</div></div></div>';
    document.body.appendChild(ov);
    loadData().then(function(){ render(q); });
  }
  var _cur = null;
  function render(q) {
    var b = $('fp-b'); if (!b) return;
    var r = lookup(q), p = r.p, w = r.w; _cur = r;
    if (!p && !w) { b.innerHTML = '<div class="fp-m">Aucun produit trouvé pour « ' + esc(q) + ' ».</div>'; return; }
    var h = '<div class="fp-top">' + (w && w.i ? '<img class="fp-img" src="' + esc(w.i) + '" alt="" loading="lazy">' : '')
      + '<div><div class="fp-name">' + esc((w && w.n) || p.libelle) + '</div>'
      + (w && w.k ? '<div class="fp-m">' + esc(w.k) + '</div>' : '')
      + '<div class="fp-chips">' + ((w && w.l) || []).map(function(l){ return '<span class="fp-chip">' + esc(l) + '</span>'; }).join('') + (p && p.certif ? '<span class="fp-chip">' + esc(p.certif) + '</span>' : '') + '</div></div></div>';
    if (p) {
      h += sec('Dans le CRM', '<div class="fp-kv">'
        + '<span>Réf.</span><b>' + esc(p.code) + '</b><span>EAN</span><b>' + esc(eans(p).join(' · ') || '—') + '</b>'
        + '<span>Colisage</span><b>' + (p.pcb ? esc(p.pcb) + ' unités' : '—') + '</b><span>Prix HT</span><b>' + eur(p.pu_ht) + '</b>'
        + (p.poids ? '<span>Poids</span><b>' + esc(p.poids) + ' kg</b>' : '') + (p.tva != null ? '<span>TVA</span><b>' + esc(p.tva) + ' %</b>' : '')
        + (p.stock != null ? '<span>Stock</span><b>' + esc(p.stock) + '</b>' : '') + (p.origine ? '<span>Origine</span><b>' + esc(p.origine) + '</b>' : '') + '</div>');
    }
    if (w) {
      var T = w.t || {};
      h += sec('Description', w.d ? '<p class="fp-p">' + esc(w.d) + '</p>' : (w.c ? '<p class="fp-p">' + esc(w.c) + '</p>' : ''));
      h += sec('Ingrédients', T['Ingrédient(s)'] ? '<p class="fp-p">' + allergenize(T['Ingrédient(s)']) + '</p>' : '');
      h += sec('Allergènes, conservation, informations', T['Informations complémentaires'] ? '<p class="fp-p">' + esc(T['Informations complémentaires']) + '</p>' : '');
      h += sec('Origine', T['Origine(s) possible(s)'] ? '<p class="fp-p">' + esc(T['Origine(s) possible(s)']) + '</p>' : '');
      Object.keys(T).forEach(function(k){ if (['Ingrédient(s)', 'Informations complémentaires', 'Origine(s) possible(s)', 'Description'].indexOf(k) === -1) h += sec(esc(k), T[k] ? '<p class="fp-p">' + esc(T[k]) + '</p>' : ''); });
      h += sec('Valeurs nutritionnelles', nutri(w.nu));
      h += '<div class="fp-m" style="margin-top:8px">Prix public sur le site : ' + eur(w.p) + ' TTC · <a href="https://moulindesmoines.com' + esc(w.u) + '" target="_blank" rel="noopener">voir la fiche sur le site</a>' + (window.PRODUITS_WEB_DATE ? ' · données du ' + esc(window.PRODUITS_WEB_DATE) : '') + '</div>';
    } else {
      h += '<div class="fp-m" style="margin:10px 0">Ce produit n\'a pas de fiche sur le site moulindesmoines.com (ou n\'y est pas référencé sous ce code-barres).</div>';
    }
    h += '<div class="fp-act"><button class="fp-b1" onclick="FicheProduit.copy()">📋 Copier la fiche</button>' + (navigator.share ? '<button class="fp-b1" onclick="FicheProduit.share()">📤 Partager</button>' : '') + '</div>';
    b.innerHTML = h;
  }
  function copy() { if (!_cur) return; var t = textFiche(_cur.p, _cur.w); try { navigator.clipboard.writeText(t).then(function(){ note('Fiche copiée'); }); } catch(e){ note('Copie impossible', 'err'); } }
  function share() { if (!_cur) return; try { navigator.share({ title: (_cur.w && _cur.w.n) || (_cur.p && _cur.p.libelle) || 'Fiche produit', text: textFiche(_cur.p, _cur.w) }).catch(function(){}); } catch(e){} }
  function close() { var o = $('fp-ov'); if (o) o.remove(); }

  // ── Recherche dans les fiches du site (nom, ingrédients, allergènes, labels…) ──
  var _idx = null;
  function buildIdx() {
    var W = window.PRODUITS_WEB || {}; _idx = Object.keys(W).map(function(e){ var w = W[e], T = w.t || {};
      return { e: e, w: w, s: norm([w.n, w.k, w.r, e, w.d, T['Ingrédient(s)'], T['Informations complémentaires'], T['Origine(s) possible(s)'], (w.l || []).join(' ')].join(' ')), nm: norm(w.n) }; });
  }
  function search() {
    css(); var old = $('fp-ov'); if (old) old.remove();
    var ov = document.createElement('div'); ov.id = 'fp-ov'; ov.onclick = function(e){ if (e.target === ov) close(); };
    ov.innerHTML = '<div class="fp"><div class="fp-h"><b>🌐 Fiches produit du site</b><button class="fp-x" onclick="FicheProduit.close()" aria-label="Fermer">✕</button></div>'
      + '<div class="fp-b"><input id="fp-q" class="fp-in" placeholder="Produit, ingrédient, allergène, label (ex. sésame, sans gluten, T65)…" oninput="FicheProduit.find(this.value)"><div id="fp-res"><div class="fp-m">Chargement…</div></div></div></div>';
    document.body.appendChild(ov);
    loadData().then(function(){ buildIdx(); var r = $('fp-res'); if (r) r.innerHTML = '<div class="fp-m">' + _idx.length + ' fiches. Tapez pour chercher.</div>'; var q = $('fp-q'); if (q) q.focus(); });
  }
  function find(v) {
    var r = $('fp-res'); if (!r || !_idx) return; var q = norm(v); if (!q) { r.innerHTML = '<div class="fp-m">' + _idx.length + ' fiches. Tapez pour chercher.</div>'; return; }
    var toks = q.split(' '), L = _idx.filter(function(x){ return toks.every(function(t){ return x.s.indexOf(t) !== -1; }); });
    L.sort(function(a, b){ return (b.nm.indexOf(q) !== -1) - (a.nm.indexOf(q) !== -1) || a.nm.localeCompare(b.nm); });
    r.innerHTML = (L.length ? '<div class="fp-m">' + L.length + ' résultat(s)' + (L.length > 60 ? ' (60 premiers)' : '') + '</div>' : '<div class="fp-m">Aucun résultat.</div>')
      + L.slice(0, 60).map(function(x){ return '<div class="fp-row" onclick="FicheProduit.open(\'' + x.e + '\')"><b>' + esc(x.w.n) + '</b><span class="fp-m">' + esc(x.e) + (x.w.p ? ' · ' + eur(x.w.p) + ' TTC' : '') + '</span></div>'; }).join('');
  }

  // ── Bouton ℹ️ dans « Recherche produit » à côté de chaque code-barres ──
  var _obs = null, _t = null;
  function decorate() {
    var root = $('rch-root'); if (!root) return;
    var P = prods(), known = {}; P.forEach(function(p){ eans(p).forEach(function(e){ known[e] = 1; }); });
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), nodes = [], n;
    while ((n = tw.nextNode())) { if (/\b\d{13}\b/.test(n.nodeValue)) nodes.push(n); }
    nodes.forEach(function(n){
      var par = n.parentNode; if (!par || par.getAttribute && par.getAttribute('data-fp')) return;
      if (par.nextSibling && par.nextSibling.className === 'fp-i') return;
      var m = n.nodeValue.match(/\b(\d{13})\b/); if (!m || !known[m[1]]) return;
      par.setAttribute('data-fp', '1');
      var b = document.createElement('button'); b.className = 'fp-i'; b.type = 'button'; b.title = 'Fiche produit (site moulindesmoines.com)'; b.textContent = 'ℹ️';
      b.onclick = function(e){ e.stopPropagation(); open(m[1]); };
      par.parentNode.insertBefore(b, par.nextSibling);
    });
  }
  function watch() {
    var root = $('rch-root'); if (!root || _obs) return;
    css(); _obs = new MutationObserver(function(){ clearTimeout(_t); _t = setTimeout(decorate, 150); });
    _obs.observe(root, { childList: true, subtree: true }); decorate();
  }
  function boot() { watch(); if (!_obs) setTimeout(boot, 1500); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  function css() {
    if ($('fp-css')) return;
    var st = document.createElement('style'); st.id = 'fp-css';
    st.textContent = '#fp-ov{position:fixed;inset:0;z-index:99980;background:rgba(20,18,15,.55);display:flex;align-items:center;justify-content:center;padding:10px}'
      + '.fp{background:#fff;border-radius:16px;width:100%;max-width:680px;max-height:92vh;display:flex;flex-direction:column;font-family:var(--fd,system-ui,sans-serif);color:#222;overflow:hidden}'
      + '.fp-h{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #eee}.fp-x{border:0;background:none;font-size:1.2rem;cursor:pointer;padding:6px 10px}'
      + '.fp-b{overflow:auto;padding:12px 16px 18px}.fp-m{color:#777;font-size:.8rem}.fp-top{display:flex;gap:12px;align-items:flex-start}.fp-img{width:110px;height:110px;object-fit:contain;border-radius:10px;background:#f6f4ef;flex-shrink:0}'
      + '.fp-name{font-weight:700;font-size:1.1rem;line-height:1.25}.fp-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.fp-chip{background:#eef5ee;color:#2c4a34;border-radius:99px;padding:2px 10px;font-size:.72rem;font-weight:600}'
      + '.fp-s{margin-top:14px}.fp-t{font-weight:700;font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;color:#555;margin-bottom:4px}.fp-p{margin:0;font-size:.9rem;line-height:1.45}'
      + '.fp-kv{display:grid;grid-template-columns:auto 1fr auto 1fr;gap:4px 10px;font-size:.85rem}.fp-kv span{color:#777}'
      + '.fp-nu{border-collapse:collapse;width:100%;font-size:.85rem}.fp-nu th,.fp-nu td{padding:4px 6px;border-bottom:1px solid #eee;text-align:left}.fp-nu th:last-child,.fp-nu td:last-child{text-align:right}.fp-nu .sub td:first-child{padding-left:18px;color:#666}'
      + '.fp-act{display:flex;gap:8px;margin-top:16px;flex-wrap:wrap}.fp-b1{border:1px solid #ccc;background:#fff;border-radius:10px;padding:9px 14px;font:inherit;cursor:pointer}'
      + '.fp-in{width:100%;box-sizing:border-box;border:1px solid #ccc;border-radius:10px;padding:10px;font:inherit;margin-bottom:10px}'
      + '.fp-row{padding:8px 4px;border-top:1px solid #eee;cursor:pointer;display:flex;flex-direction:column;gap:2px}.fp-row:hover{background:#f7f5f0}'
      + '.fp-i{border:0;background:none;cursor:pointer;font-size:.95rem;padding:0 4px;vertical-align:middle}';
    document.head.appendChild(st);
  }

  window.FicheProduit = { open: open, close: close, search: search, find: find, copy: copy, share: share, lookup: lookup, boot: boot };
})();
