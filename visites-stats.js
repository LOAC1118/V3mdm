/* ═══════════════════════════════════════════════════════════════════════
   STATISTIQUES DE VISITES — carte du tableau de bord + page détail
   Une visite = un relevé magasin. Tout est calculé sur les relevés enregistrés,
   la base clients et les bons de commande (pour la transformation).
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  var KEY = 'vs_per', _d = null, _cmds = null;
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function norm(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,' ').trim(); }
  function pad(n){ return (n < 10 ? '0' : '') + n; }
  function iso(d){ return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function addDays(s, n){ var d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); }
  function today(){ return iso(new Date()); }
  function per(){ try { return parseInt(localStorage.getItem(KEY), 10) || 30; } catch(e){ return 30; } }
  function setPer(v){ try { localStorage.setItem(KEY, String(v)); } catch(e){} renderAll(); }
  function contacts(){ try { return (typeof cdbContacts !== 'undefined' && cdbContacts) ? cdbContacts : []; } catch(e){ return []; } }
  function storeKey(r){ return (r.enseigne || 'biocoop') + '|' + (r.clientId ? 'c:' + r.clientId : 'n:' + norm(r.magasin)); }
  function ensName(id){ var e = (_d.ens || []).filter(function(x){ return x.id === id; })[0]; return e ? e.nom : id; }
  function pct(n, d){ return d ? Math.round(100 * n / d) : null; }
  function delta(a, b){ if (b == null || a == null) return ''; var x = a - b; if (!x) return '<span class="vs-d">=</span>'; return '<span class="vs-d ' + (x > 0 ? 'up' : 'dn') + '">' + (x > 0 ? '+' : '') + x + '</span>'; }

  function compute() {
    var P = per(), t = today(), from = addDays(t, -P + 1), pFrom = addDays(from, -P), pTo = addDays(from, -1);
    var R = _d.rels, inP = [], inPrev = [];
    R.forEach(function(r){ var d = String(r.date || ''); if (!d) return; if (d >= from && d <= t) inP.push(r); else if (d >= pFrom && d <= pTo) inPrev.push(r); });
    var stores = {}; inP.forEach(function(r){ stores[storeKey(r)] = 1; });
    var pStores = {}; inPrev.forEach(function(r){ pStores[storeKey(r)] = 1; });

    // présence (listes enseigne uniquement : un relevé « catalogue » ne pointe que ce qu'on voit)
    var pres = 0, pointed = 0, byEns = {};
    inP.forEach(function(r){
      var e = _d.relEns(r), st = _d.stats(r);
      var b = byEns[e] || (byEns[e] = { id: e, n: 0, stores: {}, pres: 0, pointed: 0 }); b.n++; b.stores[storeKey(r)] = 1;
      if (e === 'catalogue' || !st.pointed) return;
      pres += st.pres; pointed += st.pointed; b.pres += st.pres; b.pointed += st.pointed;
    });
    var presPrev = 0, pointedPrev = 0;
    inPrev.forEach(function(r){ if (_d.relEns(r) === 'catalogue') return; var st = _d.stats(r); if (!st.pointed) return; presPrev += st.pres; pointedPrev += st.pointed; });

    // couverture du portefeuille sur 90 j
    var lim90 = addDays(t, -90), byId = {}, byName = {};
    R.forEach(function(r){ var d = String(r.date || ''); if (!d) return; if (r.clientId && (!byId[r.clientId] || d > byId[r.clientId])) byId[r.clientId] = d;
      var n = norm(r.magasin); if (n && (!byName[n] || d > byName[n])) byName[n] = d; });
    var C = contacts(), act = C.filter(function(c){ var s = c._stats || {}; return (s.caTotal || 0) > 0 || (s.caYear || 0) > 0; });
    var base = act.length ? act : C, cov = 0;
    base.forEach(function(c){ var l = byId[c.id] || byName[norm(c.nom)] || ''; if (l && l >= lim90) cov++; });

    // absents récurrents : dernier relevé de chaque magasin sur la période
    var latest = {}; inP.forEach(function(r){ if (_d.relEns(r) === 'catalogue') return; var k = storeKey(r); if (!latest[k] || String(r.date) > String(latest[k].date)) latest[k] = r; });
    var abs = {};
    Object.keys(latest).forEach(function(k){ (latest[k].lignes || []).forEach(function(l){ if (l.p !== false || l.libre) return; var a = abs[l.k] || (abs[l.k] = { l: l.l, n: 0, m: [] }); a.n++; a.m.push(latest[k].magasin); }); });
    var absL = Object.keys(abs).map(function(k){ return abs[k]; }).filter(function(a){ return a.n >= 2; }).sort(function(a, b){ return b.n - a.n; }).slice(0, 10);

    // transformation : visites des 90 j (âgées d'au moins 14 j) suivies d'une commande sous 14 j
    var conv = { n: 0, ok: 0, avail: !!(_cmds && _cmds.length) };
    if (conv.avail) {
      var oldest = addDays(t, -90), newest = addDays(t, -14), seen = {};
      R.forEach(function(r){
        var d = String(r.date || ''); if (!d || d < oldest || d > newest) return;
        var c = r.clientId ? C.filter(function(x){ return String(x.id) === String(r.clientId); })[0] : null;
        var k = window.CRMData ? CRMData._slug((c && c.nom) || r.magasin || '') : ''; if (!k) return;
        var sk = k + '|' + d; if (seen[sk]) return; seen[sk] = 1;
        conv.n++;
        var end = addDays(d, 14);
        var hit = _cmds.some(function(o){ if (!o.key || !(o.key === k || (k.length >= 6 && o.key.length >= 6 && (o.key.indexOf(k) !== -1 || k.indexOf(o.key) !== -1)))) return false;
          var dd = window.CRMData ? CRMData._date(o.date) : null; if (!dd) return false; var i = iso(dd); return i >= d && i <= end; });
        if (hit) conv.ok++;
      });
    }
    var ens = Object.keys(byEns).map(function(k){ var b = byEns[k]; return { id: k, n: b.n, stores: Object.keys(b.stores).length, taux: pct(b.pres, b.pointed) }; }).sort(function(a, b){ return b.n - a.n; });
    var last = R.slice().sort(function(a, b){ return String(b.date).localeCompare(String(a.date)); }).slice(0, 8);
    return { P: P, n: inP.length, nPrev: inPrev.length, stores: Object.keys(stores).length, storesPrev: Object.keys(pStores).length,
             taux: pct(pres, pointed), tauxPrev: pct(presPrev, pointedPrev), cov: cov, base: base.length, covPct: pct(cov, base.length),
             conv: conv, abs: absL, ens: ens, last: last, perDay: inP.length ? Math.round(10 * inP.length / Math.max(1, Object.keys(inP.reduce(function(m, r){ m[r.date] = 1; return m; }, {})).length)) / 10 : 0 };
  }

  var CSS = '<style>.vs-g{display:grid;grid-template-columns:1fr 1fr;gap:10px}.vs-t{background:#faf8f4;border:1px solid #e9e5dc;border-radius:12px;padding:10px 12px}'
    + '.vs-v{font-family:Sora,sans-serif;font-weight:700;font-size:1.45rem;color:#14120F;line-height:1.1}.vs-l{font-size:.72rem;color:#6b665e;margin-top:3px}.vs-s{font-size:.7rem;color:#8A8F86;margin-top:2px}'
    + '.vs-d{font-size:.7rem;font-weight:700;margin-left:4px}.vs-d.up{color:#2a7d3f}.vs-d.dn{color:#c0392b}'
    + '.vs-sel{font-size:16px;padding:4px 8px;border-radius:8px;border:1px solid #ddd}.vs-tb{width:100%;border-collapse:collapse;font-size:.82rem}.vs-tb td,.vs-tb th{padding:7px 4px;border-top:1px solid #eee;text-align:left}.vs-tb th{font-size:.7rem;color:#8A8F86;font-weight:600}'
    + '.vs-h{font-family:Sora,sans-serif;font-weight:600;color:#14120F;margin:0 0 .5rem}.vs-box{margin-bottom:1rem}</style>';
  function tiles(m) {
    var cv = m.conv.avail ? (m.conv.n ? pct(m.conv.ok, m.conv.n) + ' %' : '—') : '—';
    return '<div class="vs-g">'
      + '<div class="vs-t"><div class="vs-v">' + m.n + delta(m.n, m.nPrev) + '</div><div class="vs-l">Visites</div><div class="vs-s">' + m.stores + ' magasin' + (m.stores > 1 ? 's' : '') + ' différent' + (m.stores > 1 ? 's' : '') + '</div></div>'
      + '<div class="vs-t"><div class="vs-v">' + (m.covPct == null ? '—' : m.covPct + ' %') + '</div><div class="vs-l">Portefeuille visité (90 j)</div><div class="vs-s">' + m.cov + ' / ' + m.base + ' clients</div></div>'
      + '<div class="vs-t"><div class="vs-v">' + (m.taux == null ? '—' : m.taux + ' %') + (m.taux != null && m.tauxPrev != null ? delta(m.taux, m.tauxPrev) : '') + '</div><div class="vs-l">Présence en rayon</div><div class="vs-s">moyenne des listes enseigne</div></div>'
      + '<div class="vs-t"><div class="vs-v">' + cv + '</div><div class="vs-l">Visites suivies d\'une commande</div><div class="vs-s">' + (m.conv.avail ? (m.conv.ok + ' / ' + m.conv.n + ' · sous 14 j') : 'fichier de commandes non chargé') + '</div></div></div>';
  }
  function perSel() { return '<select class="vs-sel" onchange="VisitesStats.setPer(this.value)">' + [7, 30, 90].map(function(d){ return '<option value="' + d + '"' + (d === per() ? ' selected' : '') + '>' + d + ' jours</option>'; }).join('') + '</select>'; }

  function renderCard() {
    var host = document.getElementById('agenda-visites-dash'); if (!host) return;
    if (!_d || !_d.rels.length) { host.innerHTML = ''; return; }
    var m = compute();
    host.innerHTML = CSS + '<div class="card" style="padding:1rem 1.1rem;margin-bottom:1.25rem;border-radius:16px;">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:.6rem"><div class="vs-h" style="margin:0">📊 Mes visites</div>' + perSel() + '</div>'
      + tiles(m) + '<a onclick="VisitesStats.open()" style="display:block;padding-top:10px;font-size:.78rem;color:var(--brand-d);cursor:pointer">Voir le détail →</a></div>';
  }
  function renderPage() {
    var host = document.getElementById('vs-page'); if (!host) return;
    if (!_d) { host.innerHTML = '<div class="card" style="padding:1rem">Chargement…</div>'; return; }
    var m = compute();
    var ens = m.ens.length ? '<table class="vs-tb"><tr><th>Enseigne</th><th>Visites</th><th>Magasins</th><th>Présence</th></tr>' + m.ens.map(function(e){ return '<tr><td>' + esc(ensName(e.id)) + '</td><td>' + e.n + '</td><td>' + e.stores + '</td><td>' + (e.taux == null ? '—' : e.taux + ' %') + '</td></tr>'; }).join('') + '</table>' : '<div style="color:#8A8F86;font-size:.82rem">Aucune visite sur la période.</div>';
    var abs = m.abs.length ? '<table class="vs-tb"><tr><th>Produit</th><th>Magasins</th></tr>' + m.abs.map(function(a){ return '<tr><td>' + esc(a.l) + '</td><td>' + a.n + '</td></tr>'; }).join('') + '</table>' : '<div style="color:#8A8F86;font-size:.82rem">Aucun produit absent dans 2 magasins ou plus.</div>';
    var last = m.last.map(function(r){ var st = _d.stats(r), fr = String(r.date).split('-').reverse().join('/');
      return '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid #eee"><div style="flex:1;min-width:0"><div style="font-weight:600;font-size:.84rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(r.magasin || '—') + '</div><div style="font-size:.72rem;color:#8A8F86">' + fr + ' · ' + esc(ensName(_d.relEns(r))) + (st.taux != null && _d.relEns(r) !== 'catalogue' ? ' · présence ' + st.taux + ' %' : '') + '</div></div><button class="btn btn-ghost" style="padding:8px 12px;font-size:.78rem" onclick="VisitesStats.openRel(\'' + esc(r.id) + '\')">Ouvrir</button></div>'; }).join('');
    host.innerHTML = CSS + '<div style="max-width:760px;margin:0 auto;padding:1rem">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:1rem"><div class="vs-h" style="font-size:1.15rem;margin:0">📊 Statistiques de visites</div>' + perSel() + '</div>'
      + '<div style="display:flex;gap:6px;margin:-.4rem 0 1rem"><button class="btn btn-ghost" onclick="showSection(\'statsdetail\',null,null)">📈 CA →</button><button class="btn btn-ghost" onclick="showSection(\'dashboard\',null,null)">← Tableau de bord</button></div>'
      + '<div class="card vs-box" style="padding:1rem;border-radius:16px">' + tiles(m) + '<div class="vs-s" style="margin-top:8px">' + m.perDay + ' visite(s) par jour de tournée · comparaison avec les ' + m.P + ' jours précédents</div></div>'
      + '<div class="card vs-box" style="padding:1rem;border-radius:16px"><div class="vs-h">Par enseigne</div>' + ens + '</div>'
      + '<div class="card vs-box" style="padding:1rem;border-radius:16px"><div class="vs-h">Produits absents dans plusieurs magasins</div>' + abs + '</div>'
      + '<div class="card vs-box" style="padding:1rem;border-radius:16px"><div class="vs-h">Dernières visites</div>' + (last || '<div style="color:#8A8F86;font-size:.82rem">Aucune visite.</div>') + '</div></div>';
  }
  function renderAll() { renderCard(); renderPage(); }
  function open() { try { showSection('visitestats', null, null); } catch(e){} }
  function openRel(id) { if (window.Releves && Releves.openRel) Releves.openRel(id); }
  function load() {
    var pg = document.getElementById('vs-page');
    if (!(window.Releves && Releves.all)) { if (pg && !_d) pg.innerHTML = '<div class="card" style="padding:1rem;margin:1rem;border-radius:16px;color:#b0402f">⚠️ <b>releves.js</b> n\'est pas à jour sur GitHub (version 31 attendue). Remplace-le puis recharge la page.</div>'; return; }
    Releves.all().then(function(d){ _d = d; renderAll(); }).catch(function(e){ if (pg && !_d) pg.innerHTML = '<div class="card" style="padding:1rem;margin:1rem;border-radius:16px;color:#b0402f">⚠️ Impossible de lire les relevés (' + esc(e && e.message || e) + '). Vérifie la connexion puis recharge.</div>'; });
    if (window.CRMData && CRMData.commandes) CRMData.commandes().then(function(c){ _cmds = c; renderAll(); }).catch(function(){});
  }
  function boot() {
    load();
    [3000, 8000, 15000, 30000].forEach(function(ms){ setTimeout(load, ms); setTimeout(function(){ try { dashHeroSync(); } catch(e){} }, ms); });
    window.addEventListener('cohor-actions', function(){ setTimeout(load, 100); });
    var orig = window.showSection;
    if (typeof orig === 'function' && !orig.__vs) {
      var w = function(name){ var r = orig.apply(this, arguments); if (name === 'dashboard' || name === 'visitestats') setTimeout(load, 200);
        if (name === 'statsdetail') setTimeout(function(){ try { dashCaRender(); } catch(e){} }, 150);   // les graphiques se redessinent une fois la page visible
        if (name === 'dashboard') setTimeout(function(){ try { dashHeroSync(); } catch(e){} }, 300);
        return r; };
      w.__vs = 1; window.showSection = w;
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function(){ setTimeout(boot, 1500); }); else setTimeout(boot, 1500);
  window.VisitesStats = { render: renderAll, setPer: setPer, open: open, openRel: openRel, load: load };
})();
