/* ═══════════════════════════════════════════════════════════════════════
   GÉNÉRATEUR « produits-web.js » — à exécuter UNE FOIS sur le site
   https://moulindesmoines.com (console du navigateur, F12 → Console → coller → Entrée).
   Parcourt les catégories, lit chaque fiche produit (description, ingrédients,
   allergènes, valeurs nutritionnelles, labels, origine, photo, prix public)
   puis télécharge le fichier « produits-web.js » à placer à côté de index.html.
   Le CRM (fiche-produit.js) le charge à la demande. À refaire quand le site évolue.
   Durée : 5 à 10 minutes (une page de progression s'affiche en haut à gauche).
   ═══════════════════════════════════════════════════════════════════════ */
(async function (opts) {
  opts = opts || {};
  if (location.hostname.replace(/^www\./, '') !== 'moulindesmoines.com') { alert('Exécutez ce script sur la page https://moulindesmoines.com'); return; }
  var bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;top:8px;left:8px;z-index:999999;background:#1f2430;color:#fff;font:13px system-ui;padding:8px 12px;border-radius:8px';
  document.body.appendChild(bar); var say = function (t) { bar.textContent = t; };
  var cats = ['/36-meunerie-farine-son-et-amidon', '/17-epicerie-sucree', '/22-epicerie-salee', '/54-boissons', '/45-bien-etre', '/108-farines-bio'];
  var rx = /https?:\/\/moulindesmoines\.com\/[^"'\s]+?\/\d+-[^"'\s\/]+?-\d{8,14}\.html/g, by = {};
  for (var c = 0; c < cats.length; c++) {
    for (var p = 1; p <= 20; p++) {
      say('Catalogue ' + (c + 1) + '/' + cats.length + ' · page ' + p);
      var t = await (await fetch(cats[c] + '?resultsPerPage=100&page=' + p, { credentials: 'include' })).text(), m = t.match(rx) || [];
      if (!m.length) break;
      m.forEach(function (u) { var e = (u.match(/-(\d{8,14})\.html/) || [])[1]; if (e && !by[e]) by[e] = u; });
    }
  }
  var eans = Object.keys(by); if (opts.limit) eans = eans.slice(0, opts.limit);
  var txt = function (e) { return e ? e.textContent.replace(/\s+/g, ' ').trim() : ''; };
  function parse(d, url) {
    var o = { u: url.replace('https://moulindesmoines.com', ''), e: (url.match(/-(\d{8,14})\.html/) || [])[1] };
    o.n = txt(d.querySelector('h1'));
    o.c = d.querySelector('meta[name=description]') ? d.querySelector('meta[name=description]').content : '';
    var pr = d.querySelector('meta[property="product:price:amount"]'); o.p = pr ? (+pr.content || null) : null;
    var im = d.querySelector('meta[property="og:image"]'); o.i = im ? im.content.replace('https://moulindesmoines.com', '') : '';
    o.r = ''; o.k = '';
    [].slice.call(d.querySelectorAll('script[type="application/ld+json"]')).forEach(function (s) { try { var j = JSON.parse(s.textContent); if (j['@type'] === 'Product') { o.r = j.sku || ''; o.k = j.category || ''; } } catch (e) {} });
    o.t = {};
    [].slice.call(d.querySelectorAll('.product-tabs__custom_body_tab')).forEach(function (tb) {
      var title = txt(tb.querySelector('.product-tabs__title')), cc = tb.querySelector('.product-description') || tb;
      if (cc.querySelector('table')) o.nu = [].slice.call(cc.querySelectorAll('tr')).map(function (r) { return [].slice.call(r.querySelectorAll('th,td')).map(txt).filter(Boolean); }).filter(function (r) { return r.length; });
      else o.t[title] = txt(cc);
    });
    var par = [].slice.call(d.querySelectorAll('.paragraph')).map(txt).sort(function (a, b) { return b.length - a.length; })[0];
    o.d = par || '';
    if (o.d && o.c && o.d.indexOf(o.c.slice(0, 40)) === 0) delete o.c;
    o.l = [].slice.call(d.querySelectorAll('.product-certifications img')).map(function (i) { return i.alt || ''; }).filter(function (v, i, a) { return v && a.indexOf(v) === i; });
    return o;
  }
  var out = {}, err = 0, idx = 0;
  async function worker() {
    while (idx < eans.length) {
      var e = eans[idx++]; say('Fiches produit ' + idx + '/' + eans.length);
      try { var h = await (await fetch(by[e], { credentials: 'include' })).text(); out[e] = parse(new DOMParser().parseFromString(h, 'text/html'), by[e]); } catch (x) { err++; }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  var d = new Date(), ds = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  var js = '/* Fiches produit du site moulindesmoines.com — générées le ' + ds + ' */\nwindow.PRODUITS_WEB_DATE=' + JSON.stringify(ds) + ';\nwindow.PRODUITS_WEB=' + JSON.stringify(out) + ';\n';
  say(Object.keys(out).length + ' fiches' + (err ? ' (' + err + ' erreurs)' : '') + ' · ' + Math.round(js.length / 1024) + ' Ko');
  window.__produitsWebJs = js;
  if (opts.download !== false) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([js], { type: 'application/javascript' })); a.download = 'produits-web.js'; document.body.appendChild(a); a.click(); a.remove();
    say('✓ produits-web.js téléchargé (' + Object.keys(out).length + ' fiches, ' + Math.round(js.length / 1024) + ' Ko) — à placer à côté de index.html');
  }
  return js.length;
})();
