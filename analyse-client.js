/* ═══════════════════════════════════════════════════════════════════════
   ANALYSE CLIENT — rapport commercial & économique à partir des fichiers
   Excel exportés du serveur (« Liste des commandes en cours… » + cadencier).
   • Import par client → analyse calculée localement (CA, rythme d'achat,
     tendance des paniers, délais de livraison, avoirs, transporteurs…)
   • « Ajouter au compte client » : l'historique des commandes est CUMULÉ
     dans la fiche (dédoublonné par n° de commande) et une photo de
     l'analyse est conservée → l'évolution se lit au fil des imports.
   • Commentaire IA optionnel (mlAiCall).
   Stockage : champs cmdHist et analyses du document contact (aucune
   nouvelle règle Firestore nécessaire).
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  var _c = null;                 // contact courant
  var _fileRows = [];            // lignes du fichier commandes (tous clients)
  var _codes = [];               // codes clients trouvés dans le fichier
  var _cadencier = null;         // [{code, libelle, uc}]
  var _hist = [];                // historique fusionné (client courant)
  var _res = null;               // analyse affichée
  var _ia = '';                  // commentaire IA
  var _lines = false;            // le fichier contient des lignes produit ?

  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function pad(n){ return (n<10?'0':'')+n; }
  function $(id){ return document.getElementById(id); }
  function note(m,t){ try { toast(m,t||'ok'); } catch(e){ console.log(m); } }
  function eur(n){ return (Math.round(n*100)/100).toLocaleString('fr-FR',{minimumFractionDigits:0,maximumFractionDigits:2}) + ' €'; }
  function eur0(n){ return Math.round(n).toLocaleString('fr-FR') + ' €'; }
  function norm(s){ return String(s==null?'':s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim(); }
  function noZero(s){ return String(s==null?'':s).trim().replace(/^0+/,''); }
  function dFr(iso){ if(!iso) return '—'; var d=new Date(iso+'T00:00:00'); return d.toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric'}); }
  function days(a,b){ return Math.round((new Date(b+'T00:00:00')-new Date(a+'T00:00:00'))/86400000); }
  function todayIso(){ var d=new Date(); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
  function addDays(iso,n){ var d=new Date(iso+'T00:00:00'); d.setDate(d.getDate()+n); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
  function mean(a){ return a.length ? a.reduce(function(s,x){return s+x;},0)/a.length : 0; }
  function median(a){ if(!a.length) return 0; var s=a.slice().sort(function(x,y){return x-y;}), m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; }

  // ── Dates : n° de série Excel, Date, texte jj/mm/aa(aa) ou ISO ──
  function toIso(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date && !isNaN(v)) return v.getFullYear()+'-'+pad(v.getMonth()+1)+'-'+pad(v.getDate());
    if (typeof v === 'number') {
      if (v > 20000 && v < 80000) { var d = new Date(Date.UTC(1899,11,30) + Math.round(v)*86400000); return d.getUTCFullYear()+'-'+pad(d.getUTCMonth()+1)+'-'+pad(d.getUTCDate()); }
      return '';
    }
    var s = String(v).trim(), m;
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return m[1]+'-'+m[2]+'-'+m[3];
    if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/))) {
      var y = +m[3]; if (y < 100) y += 2000;
      return y+'-'+pad(+m[2])+'-'+pad(+m[1]);
    }
    if (/^\d{5}$/.test(s)) return toIso(+s);
    return '';
  }
  function num(v){ if (typeof v === 'number') return v; var s = String(v==null?'':v).replace(/\s/g,'').replace(',','.'); var n = parseFloat(s); return isNaN(n) ? 0 : n; }

  // ── Lecture des fichiers ──
  function readAoa(file) {
    return new Promise(function(res, rej){
      var fr = new FileReader();
      fr.onload = function(){
        try {
          var wb = XLSX.read(new Uint8Array(fr.result), { type: 'array' });
          var ws = wb.Sheets[wb.SheetNames[0]];
          res(XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }));
        } catch(e){ rej(e); }
      };
      fr.onerror = function(){ rej(new Error('Lecture impossible')); };
      fr.readAsArrayBuffer(file);
    });
  }
  function findHeader(aoa, test) {
    for (var i = 0; i < Math.min(aoa.length, 15); i++) {
      var h = (aoa[i] || []).map(norm);
      if (test(h)) return i;
    }
    return -1;
  }
  function parseCommandes(aoa) {
    var hi = findHeader(aoa, function(h){ return h.some(function(x){ return /n.{0,3}de cmd|n cmd|num.*cmd/.test(x); }) && h.some(function(x){ return /^ca ht/.test(x); }); });
    if (hi < 0) return null;
    var H = aoa[hi].map(norm), col = {};
    H.forEach(function(h, i){
      if (/^etat/.test(h)) col.etat = i;
      else if (/code client/.test(h)) col.code = i;
      else if (/nom client/.test(h)) col.nom = i;
      else if (/n.{0,3}de cmd|n cmd|num.*cmd/.test(h)) col.cmd = i;
      else if (/^command/.test(h)) col.cde = i;
      else if (/^livr/.test(h)) col.liv = i;
      else if (/n.{0,3}bl|^n bl/.test(h)) col.bl = i;
      else if (/^ca ht/.test(h)) col.ca = i;
      else if (/transporteur/.test(h)) col.tr = i;
      else if (/operateur/.test(h)) col.op = i;
      else if (/^(code )?(article|produit)|^ref/.test(h)) col.art = i;
      else if (/^(qte|quantite)/.test(h)) col.qte = i;
    });
    if (col.cmd == null || col.ca == null || col.cde == null) return null;
    var rows = [];
    for (var r = hi + 1; r < aoa.length; r++) {
      var a = aoa[r] || [];
      var n = a[col.cmd]; if (n == null || n === '') continue;       // ignore « Total » et lignes vides
      var ci = toIso(a[col.cde]); if (!ci) continue;
      rows.push({
        code: col.code != null ? String(a[col.code] == null ? '' : a[col.code]).trim() : '',
        nom: col.nom != null ? String(a[col.nom] || '') : '',
        n: String(n).trim(), c: ci, l: col.liv != null ? toIso(a[col.liv]) : '',
        bl: col.bl != null ? String(a[col.bl] || '') : '',
        ca: num(a[col.ca]), t: col.tr != null ? String(a[col.tr] || '') : '',
        op: col.op != null ? String(a[col.op] || '') : '',
        art: col.art != null ? String(a[col.art] || '') : ''
      });
    }
    _lines = col.art != null;
    return rows;
  }
  function parseCadencier(aoa) {
    var hi = findHeader(aoa, function(h){ return h.indexOf('code') >= 0 && h.some(function(x){ return /^libelle/.test(x); }); });
    if (hi < 0) return null;
    var H = aoa[hi].map(norm), ic = H.indexOf('code'), il = H.findIndex(function(x){ return /^libelle/.test(x); }), iu = H.indexOf('uc');
    var out = [];
    for (var r = hi + 1; r < aoa.length; r++) { var a = aoa[r] || []; if (a[ic]) out.push({ code: String(a[ic]), libelle: String(a[il] || ''), uc: iu >= 0 ? String(a[iu] || '') : '' }); }
    return out;
  }

  function onFiles(files) {
    if (!files || !files.length) return;
    var st = $('anc-status'); if (st) st.textContent = 'Lecture…';
    var jobs = Array.prototype.map.call(files, function(f){
      return readAoa(f).then(function(aoa){
        var cmd = parseCommandes(aoa);
        if (cmd) { _fileRows = cmd; return 'cmd'; }
        var cad = parseCadencier(aoa);
        if (cad) { _cadencier = cad; return 'cad'; }
        return 'inconnu:' + f.name;
      });
    });
    Promise.all(jobs).then(function(kinds){
      var bad = kinds.filter(function(k){ return /^inconnu/.test(k); });
      if (bad.length) note('Fichier non reconnu : ' + bad.map(function(b){ return b.slice(8); }).join(', '), 'err');
      if (!_fileRows.length && !_cadencier) { if (st) st.textContent = ''; return; }
      pickClient();
    }).catch(function(e){ note('Erreur de lecture : ' + (e.message || e), 'err'); if (st) st.textContent = ''; });
  }

  // client(s) présents dans le fichier : on garde celui de la fiche
  function pickClient() {
    var st = $('anc-status');
    var map = {}; _fileRows.forEach(function(r){ var k = noZero(r.code) || '?'; (map[k] = map[k] || { code: r.code, nom: r.nom, n: 0 }).n++; });
    _codes = Object.keys(map).map(function(k){ return map[k]; });
    var mine = noZero(_c.numClient);
    var sel = _codes.filter(function(x){ return noZero(x.code) === mine; })[0];
    var box = $('anc-pick');
    if (_fileRows.length && !sel) {
      // pas de correspondance par code → proposer le choix
      box.innerHTML = '<div class="anc-warn">Le code client de la fiche (' + esc(_c.numClient || '—') + ') n\'est pas dans le fichier. Choisissez le client du fichier à rattacher à cette fiche :</div>'
        + '<select id="anc-sel" class="anc-in" onchange="AnalyseClient.run(this.value)">' + '<option value="">— choisir —</option>'
        + _codes.map(function(x){ return '<option value="' + esc(noZero(x.code)) + '">' + esc(x.nom || x.code) + ' (' + esc(x.code) + ') — ' + x.n + ' lignes</option>'; }).join('') + '</select>';
      if (st) st.textContent = '';
      return;
    }
    box.innerHTML = '';
    if (_codes.length > 1) {
      box.innerHTML = '<div class="anc-hint">Le fichier contient ' + _codes.length + ' clients : seul « ' + esc(sel ? sel.nom : '') + ' » est analysé.</div>';
    }
    run(sel ? noZero(sel.code) : '');
  }

  function run(code) {
    var st = $('anc-status'); if (st) st.textContent = '';
    var imported = code === '' && !_fileRows.length ? [] : _fileRows.filter(function(r){ return noZero(r.code) === code; });
    // fusion avec l'historique déjà enregistré (dédoublonnage par n° de commande)
    var map = {};
    (_c.cmdHist || []).forEach(function(h){ map[h.n] = h; });
    var added = 0;
    imported.forEach(function(r){
      if (!map[r.n]) added++;
      map[r.n] = { n: r.n, c: r.c, l: r.l, ca: r.ca, t: r.t, bl: r.bl, op: r.op };
    });
    _hist = Object.keys(map).map(function(k){ return map[k]; }).sort(function(a,b){ return a.c < b.c ? -1 : 1; });
    _res = analyze(_hist);
    _res._added = added; _res._imported = imported.length;
    _res.produits = (imported.length && _lines) ? productGap(imported) : null;
    _ia = '';
    renderReport();
  }

  // ── Calculs ──
  function analyze(h) {
    var cmds = h.filter(function(x){ return x.ca > 0; });
    var avo = h.filter(function(x){ return x.ca < 0; });
    var R = { n: cmds.length, nAvoirs: avo.length };
    if (!cmds.length) return R;
    R.caBrut = cmds.reduce(function(s,x){ return s + x.ca; }, 0);
    R.caAvoirs = avo.reduce(function(s,x){ return s + x.ca; }, 0);
    R.caNet = R.caBrut + R.caAvoirs;
    R.panier = R.caBrut / cmds.length;
    R.first = cmds[0].c; R.last = cmds[cmds.length - 1].c;
    R.jSince = days(R.last, todayIso());
    var iv = []; for (var i = 1; i < cmds.length; i++) iv.push(days(cmds[i-1].c, cmds[i].c));
    R.intervals = iv; R.cycle = mean(iv); R.cycleMed = median(iv);
    R.prochaine = iv.length ? addDays(R.last, Math.round(R.cycleMed)) : '';
    R.retard = iv.length ? R.jSince - R.cycleMed : 0;
    var span = days(R.first, R.last);
    R.perMonth = span >= 60 ? R.caNet / (span / 30.4) : null;
    R.perYear = R.perMonth != null ? R.perMonth * 12 : null;
    if (cmds.length >= 4) {
      var half = Math.floor(cmds.length / 2);
      var a = mean(cmds.slice(0, half).map(function(x){ return x.ca; })), b = mean(cmds.slice(-half).map(function(x){ return x.ca; }));
      R.tAvant = a; R.tApres = b; R.tendance = a ? (b - a) / a : 0;
    }
    var peak = cmds.reduce(function(m,x){ return x.ca > m.ca ? x : m; }, cmds[0]);
    R.peak = peak; R.dernier = cmds[cmds.length - 1];
    var dl = cmds.filter(function(x){ return x.l && days(x.c, x.l) >= 0; }).map(function(x){ return days(x.c, x.l); });
    R.delaiMoy = dl.length ? mean(dl) : null; R.delaiMax = dl.length ? Math.max.apply(null, dl) : null;
    R.delaiLongs = dl.filter(function(d){ return d > 10; }).length;
    // avoirs rattachés à la commande précédente (≤ 21 j)
    R.avoirsDet = avo.map(function(a){
      var prev = null; cmds.forEach(function(c){ if (c.c <= a.c && days(c.c, a.c) <= 21) prev = c; });
      return { date: a.c, ca: a.ca, pct: prev ? Math.abs(a.ca) / prev.ca : null, cmd: prev ? prev.n : '' };
    });
    R.cmdsAvecAvoir = cmds.filter(function(c){ return avo.some(function(a){ return a.c >= c.c && days(c.c, a.c) <= 21; }); }).length;
    R.tr = top(h.filter(function(x){ return x.t; }).map(function(x){ return x.t.replace(/\s*\(.*\)|\s*\d+$/g,'').trim() || x.t; }), 3);
    R.ops = top(cmds.filter(function(x){ return x.op; }).map(function(x){ return x.op.replace(/^MDM\s+/,''); }), 2);
    R.alertes = alertes(R);
    return R;
  }
  function top(arr, k) {
    var m = {}; arr.forEach(function(x){ m[x] = (m[x] || 0) + 1; });
    return Object.keys(m).map(function(x){ return { k: x, n: m[x] }; }).sort(function(a,b){ return b.n - a.n; }).slice(0, k);
  }
  function alertes(R) {
    var A = [];
    if (R.n < 3) A.push({ t: 'info', m: 'Historique court (' + R.n + ' commande' + (R.n > 1 ? 's' : '') + ') : indicateurs de rythme et de tendance peu fiables.' });
    if (R.tendance != null && R.tendance <= -0.2) A.push({ t: 'warn', m: 'Paniers en baisse de ' + Math.round(-R.tendance * 100) + ' % (de ' + eur0(R.tAvant) + ' à ' + eur0(R.tApres) + ' en moyenne). Gamme réduite ou achats ailleurs ? À creuser en visite.' });
    if (R.tendance != null && R.tendance >= 0.2) A.push({ t: 'ok', m: 'Paniers en hausse de ' + Math.round(R.tendance * 100) + ' % (de ' + eur0(R.tAvant) + ' à ' + eur0(R.tApres) + ').' });
    if (R.intervals.length && R.jSince > R.cycleMed * 1.25 && R.jSince - R.cycleMed > 7) A.push({ t: 'warn', m: 'En retard sur son cycle : ' + R.jSince + ' j depuis la dernière commande (rythme habituel ≈ ' + Math.round(R.cycleMed) + ' j).' });
    else if (R.prochaine) A.push({ t: 'info', m: 'Prochaine commande attendue vers le ' + dFr(R.prochaine) + ' — relance conseillée une semaine avant (' + dFr(addDays(R.prochaine, -7)) + ').' });
    if (R.dernier && R.n >= 3 && R.dernier.ca < R.panier * 0.6) A.push({ t: 'warn', m: 'Dernière commande (' + eur0(R.dernier.ca) + ') nettement sous son panier moyen (' + eur0(R.panier) + ').' });
    R.avoirsDet.forEach(function(a){ if (a.pct != null && a.pct >= 0.04 && Math.abs(a.ca) >= 20) A.push({ t: 'warn', m: 'Avoir de ' + eur(Math.abs(a.ca)) + ' le ' + dFr(a.date) + ' (' + Math.round(a.pct * 100) + ' % de la commande) : casse, manquant ou erreur de prix ? À vérifier.' }); });
    if (R.cmdsAvecAvoir >= 3 && R.cmdsAvecAvoir / R.n >= 0.5) A.push({ t: 'info', m: R.cmdsAvecAvoir + ' commandes sur ' + R.n + ' sont suivies d\'un petit avoir : écart récurrent (prix, port) à régulariser à la source.' });
    if (R.delaiLongs) A.push({ t: 'info', m: R.delaiLongs + ' livraison(s) à plus de 10 jours (max ' + R.delaiMax + ' j).' });
    return A;
  }
  function productGap(rows) {
    if (!_cadencier) return { note: 'Les lignes produit sont dans le fichier, chargez aussi le cadencier pour voir les références jamais commandées.' };
    var ordered = {}; rows.forEach(function(r){ if (r.art) ordered[r.art.trim()] = 1; });
    var miss = _cadencier.filter(function(p){ return !ordered[p.code]; });
    return { ordered: Object.keys(ordered).length, total: _cadencier.length, miss: miss.slice(0, 25), nMiss: miss.length };
  }

  // ── Rendu du rapport ──
  function bars(h) {
    var c = h.filter(function(x){ return x.ca > 0; }); if (c.length < 2) return '';
    var max = Math.max.apply(null, c.map(function(x){ return x.ca; })), w = 100 / c.length;
    var s = c.map(function(x, i){
      var hh = Math.max(3, Math.round(x.ca / max * 56));
      return '<rect x="' + (i * w + w * .15) + '%" y="' + (64 - hh) + '" width="' + (w * .7) + '%" height="' + hh + '" rx="2" fill="#FF4D1C" opacity="' + (.45 + .55 * (i + 1) / c.length) + '"><title>' + dFr(x.c) + ' : ' + eur0(x.ca) + '</title></rect>';
    }).join('');
    return '<svg viewBox="0 0 300 64" preserveAspectRatio="none" style="width:100%;height:70px">' + s + '</svg>'
      + '<div class="anc-mut" style="display:flex;justify-content:space-between"><span>' + dFr(c[0].c) + '</span><span>paniers par commande</span><span>' + dFr(c[c.length - 1].c) + '</span></div>';
  }
  function kpi(v, l, cls){ return '<div><div class="anc-kn ' + (cls || '') + '">' + v + '</div><div class="anc-kl">' + l + '</div></div>'; }
  function renderReport() {
    var box = $('anc-report'); if (!box) return;
    var R = _res;
    if (!R || !R.n) { box.innerHTML = '<div class="anc-warn">Aucune commande exploitable pour ce client.</div>'; return; }
    var h = '';
    if (R._imported != null && R._imported >= 0 && _fileRows.length) h += '<div class="anc-hint">' + R._imported + ' ligne(s) importée(s), dont ' + R._added + ' nouvelle(s) par rapport à la fiche. Analyse sur ' + (R.n + R.nAvoirs) + ' lignes cumulées (' + dFr(R.first) + ' → ' + dFr(R.last) + ').</div>';
    h += '<div class="anc-card"><div class="anc-lbl">Valeur économique</div><div class="anc-kpi">'
      + kpi(eur0(R.caNet), 'CA net HT') + kpi(R.n, 'commandes') + kpi(eur0(R.panier), 'panier moyen')
      + (R.perMonth != null ? kpi('≈ ' + eur0(R.perMonth), 'par mois') : '') + (R.perYear != null ? kpi('≈ ' + eur0(R.perYear), 'en rythme annuel') : '')
      + (R.nAvoirs ? kpi(eur(R.caAvoirs), R.nAvoirs + ' avoir(s) · ' + (Math.abs(R.caAvoirs) / R.caBrut * 100).toFixed(1).replace('.', ',') + ' %', R.caAvoirs ? 'warn' : '') : '') + '</div></div>';
    h += '<div class="anc-card"><div class="anc-lbl">Rythme d\'achat</div><div class="anc-kpi">'
      + (R.intervals.length ? kpi(Math.round(R.cycle) + ' j', 'cycle moyen (médiane ' + Math.round(R.cycleMed) + ' j)') : '')
      + kpi(dFr(R.last), 'dernière commande · ' + R.jSince + ' j', R.retard > 7 ? 'warn' : '')
      + (R.prochaine ? kpi(dFr(R.prochaine), 'prochaine attendue') : '') + '</div>'
      + (R.intervals.length ? '<div class="anc-mut" style="margin-top:8px">Intervalles : ' + R.intervals.join(' · ') + ' jours</div>' : '') + '</div>';
    h += '<div class="anc-card"><div class="anc-lbl">Tendance des paniers</div>' + bars(_hist)
      + (R.tendance != null ? '<div style="margin-top:6px"><b class="' + (R.tendance <= -0.2 ? 'anc-neg' : R.tendance >= 0.2 ? 'anc-pos' : '') + '">' + (R.tendance >= 0 ? '+' : '') + Math.round(R.tendance * 100) + ' %</b> <span class="anc-mut">(' + eur0(R.tAvant) + ' → ' + eur0(R.tApres) + ', première vs seconde moitié de l\'historique)</span></div>' : '')
      + '<div class="anc-mut">Pic : ' + eur0(R.peak.ca) + ' (' + dFr(R.peak.c) + ') · Dernier : ' + eur0(R.dernier.ca) + '</div></div>';
    var logi = [];
    if (R.delaiMoy != null) logi.push('Délai commande → livraison : <b>' + R.delaiMoy.toFixed(1).replace('.', ',') + ' j</b> en moyenne (max ' + R.delaiMax + ' j)');
    if (R.tr.length) logi.push('Transporteurs : ' + R.tr.map(function(t){ return esc(t.k) + ' (' + t.n + ')'; }).join(', '));
    if (R.ops.length) logi.push('Interlocuteurs ADV : ' + R.ops.map(function(t){ return esc(t.k) + ' (' + t.n + ')'; }).join(', '));
    if (logi.length) h += '<div class="anc-card"><div class="anc-lbl">Livraison & suivi</div>' + logi.map(function(x){ return '<div class="anc-li">' + x + '</div>'; }).join('') + '</div>';
    if (R.avoirsDet.length) h += '<div class="anc-card"><div class="anc-lbl">Avoirs</div>' + R.avoirsDet.map(function(a){
      return '<div class="anc-li">' + dFr(a.date) + ' · <b>' + eur(a.ca) + '</b>' + (a.pct != null ? ' <span class="anc-mut">(' + (a.pct * 100).toFixed(1).replace('.', ',') + ' % de la commande ' + esc(a.cmd) + ')</span>' : '') + '</div>'; }).join('') + '</div>';
    if (R.alertes.length) h += '<div class="anc-card"><div class="anc-lbl">Points d\'attention</div>' + R.alertes.map(function(a){
      return '<div class="anc-al ' + a.t + '">' + (a.t === 'warn' ? '⚠️ ' : a.t === 'ok' ? '✅ ' : 'ℹ️ ') + esc(a.m) + '</div>'; }).join('') + '</div>';
    if (_cadencier) {
      var P = R.produits;
      h += '<div class="anc-card"><div class="anc-lbl">Cadencier (' + _cadencier.length + ' références)</div>'
        + (P && P.miss ? '<div class="anc-li">' + P.ordered + ' références commandées sur ' + P.total + ' ; ' + P.nMiss + ' jamais commandées.</div><div class="anc-mut">' + P.miss.map(function(p){ return esc(p.libelle); }).join(' · ') + (P.nMiss > P.miss.length ? ' …' : '') + '</div>'
          : '<div class="anc-mut">' + esc(P && P.note ? P.note : 'Ce fichier de commandes ne contient pas les lignes produit : impossible de savoir quelles références ce client achète. Exportez les commandes avec le détail article pour obtenir l\'analyse par produit et les références à lui proposer.') + '</div>') + '</div>';
    }
    h += '<div id="anc-ia">' + (_ia ? iaHtml() : '') + '</div>';
    h += '<div class="anc-act"><button class="anc-b" onclick="AnalyseClient.ia()">✨ Commentaire IA</button>'
      + '<button class="anc-b" onclick="AnalyseClient.copy()">📋 Copier</button>'
      + '<button class="anc-b p" onclick="AnalyseClient.save()">💾 Ajouter au compte client</button></div>';
    box.innerHTML = h;
  }
  function iaHtml(){ return '<div class="anc-card"><div class="anc-lbl">✨ Lecture commerciale (IA)</div><div class="anc-ia">' + esc(_ia) + '</div></div>'; }

  // ── IA ──
  function parseJson(txt) {
    var s = String(txt || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try { return JSON.parse(s); } catch(e){}
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch(e){} }
    return null;
  }
  function facts() {
    var R = _res, L = [];
    L.push('Client : ' + (_c.nom || '') + (_c.ville ? ' (' + _c.ville + ')' : ''));
    L.push('Période : ' + R.first + ' → ' + R.last + ', ' + R.n + ' commandes, CA net ' + Math.round(R.caNet) + ' € HT, panier moyen ' + Math.round(R.panier) + ' €');
    if (R.intervals.length) L.push('Cycle moyen ' + Math.round(R.cycle) + ' j, jours depuis dernière commande ' + R.jSince + ', prochaine attendue ' + R.prochaine);
    L.push('Paniers dans l\'ordre : ' + _hist.filter(function(x){ return x.ca > 0; }).map(function(x){ return Math.round(x.ca); }).join(', '));
    if (R.tendance != null) L.push('Tendance paniers : ' + Math.round(R.tendance * 100) + ' %');
    if (R.nAvoirs) L.push('Avoirs : ' + R.nAvoirs + ' pour ' + Math.round(R.caAvoirs) + ' €');
    if (R.delaiMoy != null) L.push('Délai livraison moyen ' + R.delaiMoy.toFixed(1) + ' j');
    return L.join('\n');
  }
  function ia() {
    if (!_res || !_res.n) return;
    if (typeof mlAiCall !== 'function') { note('IA indisponible', 'err'); return; }
    var b = document.querySelector('.anc-act .anc-b'); if (b) { b.disabled = true; b.textContent = '…'; }
    var sys = 'Tu es directeur commercial d\'un fournisseur de produits bio (marque Moulin des Moines) et tu conseilles un commercial terrain B2B. '
      + 'À partir des chiffres fournis (ne rien inventer), écris en français : 1) un diagnostic en 2 phrases, 2) 3 actions concrètes pour la prochaine visite, 3) une hypothèse à vérifier. '
      + 'Style direct, sans jargon. Réponds UNIQUEMENT par un objet JSON {"commentaire":"..."} (texte avec retours à la ligne).';
    mlAiCall(sys, facts()).then(function(txt){
      var j = parseJson(txt);
      _ia = (j && j.commentaire) ? j.commentaire : String(txt || '');
      var el = $('anc-ia'); if (el) el.innerHTML = iaHtml();
    }).catch(function(e){ note(e && e.message === 'no-key' ? 'Aucune clé IA configurée' : 'Erreur IA : ' + (e.message || e), 'err'); })
      .then(function(){ if (b) { b.disabled = false; b.textContent = '✨ Commentaire IA'; } });
  }

  // ── Texte copiable ──
  function asText() {
    var R = _res, t = ['ANALYSE CLIENT — ' + (_c.nom || ''), 'Période ' + dFr(R.first) + ' → ' + dFr(R.last)];
    t.push('CA net HT : ' + eur0(R.caNet) + ' · ' + R.n + ' commandes · panier moyen ' + eur0(R.panier));
    if (R.intervals.length) t.push('Cycle moyen ' + Math.round(R.cycle) + ' j · dernière commande ' + dFr(R.last) + ' · prochaine attendue ' + dFr(R.prochaine));
    if (R.tendance != null) t.push('Tendance des paniers : ' + Math.round(R.tendance * 100) + ' %');
    R.alertes.forEach(function(a){ t.push('- ' + a.m); });
    if (_ia) t.push('', _ia);
    return t.join('\n');
  }
  function copy() {
    if (!_res || !_res.n) return;
    try { navigator.clipboard.writeText(asText()).then(function(){ note('Analyse copiée', 'ok'); }); } catch(e){ note('Copie impossible', 'err'); }
  }

  // ── Enregistrement dans la fiche client ──
  function save() {
    if (!_res || !_res.n || !_c) return;
    var snap = {
      at: todayIso(), n: _res.n, caNet: Math.round(_res.caNet * 100) / 100, panier: Math.round(_res.panier),
      cycle: _res.intervals.length ? Math.round(_res.cycle) : null, last: _res.last, prochaine: _res.prochaine || '',
      tendance: _res.tendance != null ? Math.round(_res.tendance * 100) : null,
      alertes: _res.alertes.filter(function(a){ return a.t === 'warn'; }).map(function(a){ return a.m; }).slice(0, 4),
      ia: _ia || ''
    };
    var list = (_c.analyses || []).filter(function(a){ return a.at !== snap.at; });   // 1 photo par jour
    list.push(snap); list.sort(function(a, b){ return a.at < b.at ? -1 : 1; });
    list = list.slice(-12);
    var patch = { cmdHist: _hist, analyses: list };
    bcol('contacts').doc(_c.id).set(patch, { merge: true }).then(function(){
      _c.cmdHist = _hist; _c.analyses = list;
      try { localStorage.setItem(CDB_CACHE_KEY(), JSON.stringify(cdbContacts)); } catch(e){}
      note('✅ Analyse ajoutée au compte de ' + (_c.nom || 'ce client'), 'ok');
      renderHistory();
    }).catch(function(e){ note('Erreur : ' + (e.code || e.message), 'err'); });
  }

  // ── Historique enregistré ──
  function renderHistory() {
    var box = $('anc-hist'); if (!box) return;
    var A = (_c && _c.analyses) || [];
    if (!A.length) { box.innerHTML = '<div class="anc-mut">Aucune analyse enregistrée pour ce client. Importez un fichier ci-dessous.</div>'; return; }
    var rows = A.slice().reverse().map(function(a, i, arr){
      var prev = arr[i + 1], d = prev ? a.caNet - prev.caNet : null;
      return '<tr onclick="AnalyseClient.showSnap(\'' + a.at + '\')" style="cursor:pointer"><td>' + dFr(a.at) + '</td><td>' + a.n + '</td><td>' + eur0(a.caNet) + (d != null ? ' <span class="' + (d >= 0 ? 'anc-pos' : 'anc-neg') + '">(' + (d >= 0 ? '+' : '') + eur0(d) + ')</span>' : '') + '</td><td>' + eur0(a.panier) + '</td><td>' + (a.tendance != null ? (a.tendance >= 0 ? '+' : '') + a.tendance + ' %' : '—') + '</td></tr>';
    }).join('');
    box.innerHTML = '<table class="anc-t"><thead><tr><th>Analyse du</th><th>Cmd</th><th>CA net</th><th>Panier</th><th>Tendance</th></tr></thead><tbody>' + rows + '</tbody></table>'
      + '<div class="anc-mut">' + ((_c.cmdHist || []).length) + ' lignes de commandes cumulées dans la fiche. Touchez une ligne pour relire l\'analyse.</div>';
  }
  function showSnap(at) {
    var a = ((_c && _c.analyses) || []).filter(function(x){ return x.at === at; })[0]; if (!a) return;
    var box = $('anc-report');
    box.innerHTML = '<div class="anc-card"><div class="anc-lbl">Analyse enregistrée du ' + dFr(a.at) + '</div><div class="anc-kpi">'
      + kpi(eur0(a.caNet), 'CA net HT') + kpi(a.n, 'commandes') + kpi(eur0(a.panier), 'panier moyen')
      + (a.cycle != null ? kpi(a.cycle + ' j', 'cycle moyen') : '') + (a.tendance != null ? kpi((a.tendance >= 0 ? '+' : '') + a.tendance + ' %', 'tendance paniers', a.tendance <= -20 ? 'warn' : '') : '') + '</div>'
      + '<div class="anc-mut" style="margin-top:8px">Dernière commande ' + dFr(a.last) + (a.prochaine ? ' · prochaine attendue ' + dFr(a.prochaine) : '') + '</div></div>'
      + (a.alertes && a.alertes.length ? '<div class="anc-card"><div class="anc-lbl">Points d\'attention</div>' + a.alertes.map(function(m){ return '<div class="anc-al warn">⚠️ ' + esc(m) + '</div>'; }).join('') + '</div>' : '')
      + (a.ia ? '<div class="anc-card"><div class="anc-lbl">✨ Lecture commerciale (IA)</div><div class="anc-ia">' + esc(a.ia) + '</div></div>' : '');
  }

  // ── Fenêtre ──
  function css() {
    if ($('anc-css')) return;
    var s = document.createElement('style'); s.id = 'anc-css';
    s.textContent =
      '#anc-ov{position:fixed;inset:0;z-index:99997;background:rgba(20,18,15,.55);display:flex;align-items:flex-end;justify-content:center}'
      + '@media(min-width:700px){#anc-ov{align-items:center}}'
      + '.anc-box{background:#f7f6f2;color:#1c1a17;width:100%;max-width:680px;max-height:92vh;overflow:auto;border-radius:18px 18px 0 0;font-family:inherit}'
      + '@media(min-width:700px){.anc-box{border-radius:18px}}'
      + '.anc-top{position:sticky;top:0;z-index:2;background:#14120F;color:#fff;padding:14px 16px;display:flex;align-items:flex-start;justify-content:space-between;gap:10px}'
      + '.anc-top b{font-size:1rem}.anc-top small{display:block;opacity:.7;font-size:.78rem;margin-top:2px}'
      + '.anc-x{border:0;background:rgba(255,255,255,.18);color:#fff;width:32px;height:32px;border-radius:50%;font-size:1.1rem;cursor:pointer}'
      + '.anc-body{padding:14px;display:flex;flex-direction:column;gap:11px}'
      + '.anc-card{background:#fff;border:1px solid #e7e4dc;border-radius:14px;padding:13px 14px}'
      + '.anc-lbl{font:700 .68rem inherit;letter-spacing:.06em;text-transform:uppercase;color:#8a857d;margin-bottom:9px}'
      + '.anc-kpi{display:flex;gap:14px;flex-wrap:wrap}.anc-kpi>div{flex:1 1 105px}'
      + '.anc-kn{font:700 1.25rem/1.1 inherit}.anc-kn.warn{color:#c2410c}.anc-kl{font-size:.72rem;color:#8a857d;margin-top:3px}'
      + '.anc-mut{font-size:.76rem;color:#8a857d}.anc-li{font-size:.84rem;padding:3px 0}'
      + '.anc-pos{color:#2a7d3f;font-weight:700}.anc-neg{color:#c2410c;font-weight:700}'
      + '.anc-al{font-size:.84rem;padding:7px 9px;border-radius:8px;margin-bottom:5px;background:#f3f1ec}'
      + '.anc-al.warn{background:#fff3df}.anc-al.ok{background:#eaf5ee}'
      + '.anc-ia{font-size:.86rem;white-space:pre-wrap;line-height:1.5}'
      + '.anc-warn{font-size:.82rem;color:#a35a00;background:#fff3df;padding:8px 10px;border-radius:8px}'
      + '.anc-hint{font-size:.78rem;color:#4a463f;background:#eef3f8;padding:8px 10px;border-radius:8px}'
      + '.anc-in{width:100%;padding:8px;border:1px solid #ddd;border-radius:8px;font:inherit}'
      + '.anc-drop{border:2px dashed #d6d1c5;border-radius:12px;padding:16px;text-align:center;background:#fff;cursor:pointer;font-size:.86rem}'
      + '.anc-drop:hover,.anc-drop.over{border-color:#FF4D1C;background:#fff7f3}'
      + '.anc-act{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}'
      + '.anc-b{border:1px solid #ddd;background:#fff;border-radius:99px;padding:9px 15px;font:600 .82rem inherit;cursor:pointer}'
      + '.anc-b.p{background:#FF4D1C;border-color:#FF4D1C;color:#fff}.anc-b:disabled{opacity:.5}'
      + '.anc-t{width:100%;border-collapse:collapse;font-size:.8rem}.anc-t th{text-align:left;font-size:.68rem;color:#8a857d;padding:4px 6px;text-transform:uppercase}'
      + '.anc-t td{padding:6px;border-top:1px solid #f0eee8}';
    document.head.appendChild(s);
  }
  function open(id) {
    var c = (typeof cdbContacts !== 'undefined' ? cdbContacts : []).filter(function(x){ return x.id === id; })[0];
    if (!c) { note('Client introuvable', 'err'); return; }
    css();
    _c = c; _fileRows = []; _cadencier = null; _hist = c.cmdHist || []; _res = null; _ia = ''; _lines = false;
    var old = $('anc-ov'); if (old) old.remove();
    var ov = document.createElement('div'); ov.id = 'anc-ov';
    ov.onclick = function(e){ if (e.target === ov) close(); };
    ov.innerHTML =
      '<div class="anc-box"><div class="anc-top"><div><b>📈 Analyse client</b><small>' + esc(c.nom || '') + (c.numClient ? ' · ' + esc(c.numClient) : '') + '</small></div><button class="anc-x" onclick="AnalyseClient.close()">✕</button></div>'
      + '<div class="anc-body">'
      +   '<div class="anc-card"><div class="anc-lbl">Analyses enregistrées</div><div id="anc-hist"></div></div>'
      +   '<label class="anc-drop" id="anc-drop">📂 Déposez ou choisissez le fichier « Liste des commandes » de ce client<br><span class="anc-mut">(.xlsx — vous pouvez ajouter le cadencier en même temps)</span>'
      +     '<input type="file" id="anc-file" accept=".xlsx,.xls,.csv" multiple style="display:none"></label>'
      +   '<div id="anc-status" class="anc-mut"></div><div id="anc-pick"></div><div id="anc-report"></div>'
      + '</div></div>';
    document.body.appendChild(ov);
    renderHistory();
    $('anc-file').onchange = function(){ var f = this.files; lazyLoad(LIB_XLSX, function(){ onFiles(f); }, function(){ note('Librairie Excel indisponible', 'err'); }); };
    var dz = $('anc-drop');
    dz.ondragover = function(e){ e.preventDefault(); dz.classList.add('over'); };
    dz.ondragleave = function(){ dz.classList.remove('over'); };
    dz.ondrop = function(e){ e.preventDefault(); dz.classList.remove('over'); var f = e.dataTransfer.files; lazyLoad(LIB_XLSX, function(){ onFiles(f); }); };
  }
  function close() { var o = $('anc-ov'); if (o) o.remove(); }

  window.AnalyseClient = { open: open, close: close, run: run, ia: ia, copy: copy, save: save, showSnap: showSnap };
})();
