/* ═══════════════════════════════════════════════════════════════════════
   RETOUR DE VISITE — rapport à envoyer à la société.
   Pour une période (par défaut aujourd'hui) : regroupe par magasin les notes
   (module Notes), les relevés magasin (module Relevés) et les photos prises
   sur place. Génère un PDF (photos incluses) + un texte de mail.
   Photos : réduites (≈1280 px, JPEG) et stockées dans « visites_photos ».
   Ouverture : RetourVisite.open([clientId])
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  var _from = '', _to = '', _stores = [], _edits = {}, _photos = null, _intro = '', _actions = '', _dest = '', _busy = false;
  var _pdfBlob = null, _pdfName = '', _pdfUrl = '', _addKey = '';

  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function pad(n){ return (n<10?'0':'')+n; }
  function ymd(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
  function $(id){ return document.getElementById(id); }
  function note(m,t){ try { toast(m,t||'ok'); } catch(e){ console.log(m); } }
  function me(){ return (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null; }
  function norm(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim(); }
  function contacts(){ return (typeof cdbContacts !== 'undefined' && cdbContacts) ? cdbContacts : []; }
  function cById(id){ return contacts().filter(function(c){ return c.id === id; })[0] || null; }
  function frDate(s){ var p = String(s||'').split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : s; }
  function keyOf(clientId, nom){ return clientId ? 'c:' + clientId : 'n:' + norm(nom); }
  function lsGet(k){ try { return localStorage.getItem(k) || ''; } catch(e){ return ''; } }
  function lsSet(k,v){ try { localStorage.setItem(k, v); } catch(e){} }

  // ── Photos ──
  function pcol(){ return bcol('visites_photos'); }
  function loadPhotos() {
    if (_photos) return Promise.resolve();
    var u = me(); if (!u) { _photos = []; return Promise.resolve(); }
    return pcol().where('owner', '==', u.uid).get().then(function(snap){
      _photos = snap.docs.map(function(d){ var o = d.data(); o.id = d.id; return o; }).filter(function(o){ return o.kind === 'retour'; });
    }).catch(function(){ _photos = []; });
  }
  function compress(file) {
    return new Promise(function(res, rej){
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function(){
        try {
          var M = 1280, w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, M / Math.max(w, h));
          var cw = Math.round(w * k), ch = Math.round(h * k), cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
          var cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cw, ch); cx.drawImage(img, 0, 0, cw, ch);
          var q = 0.72, d = cv.toDataURL('image/jpeg', q);
          while (d.length > 700000 && q > 0.35) { q -= 0.1; d = cv.toDataURL('image/jpeg', q); }
          URL.revokeObjectURL(url); res({ data: d, w: cw, h: ch });
        } catch(e){ URL.revokeObjectURL(url); rej(e); }
      };
      img.onerror = function(){ URL.revokeObjectURL(url); rej(new Error('image illisible')); };
      img.src = url;
    });
  }
  function addPhotos(key, input) {
    var files = Array.prototype.slice.call(input.files || []); input.value = '';
    var s = byKey(key); if (!s || !files.length) return; syncEdits();
    var u = me(); if (!u) { note('Non connecté', 'err'); return; }
    var today = ymd(new Date()), date = (today >= _from && today <= _to) ? today : _to;
    note('Ajout de ' + files.length + ' photo(s)…');
    files.reduce(function(p, f){
      return p.then(function(){ return compress(f).then(function(img){
        var ref = pcol().doc(), o = { kind: 'retour', owner: u.uid, date: date, key: key, clientId: s.clientId || '', nom: s.nom, caption: '', data: img.data, w: img.w, h: img.h, createdAt: Date.now() };
        return ref.set(o).then(function(){ o.id = ref.id; _photos.push(o); });
      }); }).catch(function(e){ note('Photo non enregistrée : ' + (e.code || e.message), 'err'); });
    }, Promise.resolve()).then(function(){ rebuildPhotos(); render(); });
  }
  function delPhoto(id) {
    if (!confirm('Supprimer cette photo ?')) return; syncEdits();
    pcol().doc(id).delete().catch(function(){});
    _photos = _photos.filter(function(p){ return p.id !== id; }); rebuildPhotos(); render();
  }
  function capPhoto(id, v) {
    var p = _photos.filter(function(x){ return x.id === id; })[0]; if (!p) return; p.caption = v;
    pcol().doc(id).update({ caption: v }).catch(function(){});
  }
  function rebuildPhotos() { _stores.forEach(function(s){ s.photos = _photos.filter(function(p){ return p.key === s.key && p.date >= _from && p.date <= _to; }).sort(function(a,b){ return a.createdAt - b.createdAt; }); }); }

  // ── Construction de la liste des magasins ──
  function byKey(k){ return _stores.filter(function(s){ return s.key === k; })[0]; }
  function ensure(map, clientId, nom, ville) {
    var k = keyOf(clientId, nom);
    if (!map[k]) {
      var c = clientId ? cById(clientId) : null;
      map[k] = { key: k, clientId: clientId || '', nom: c ? c.nom : nom, ville: c ? (c.ville || '') : (ville || ''), inc: true, notes: null, noteSrc: [], rels: [], photos: [] };
    }
    return map[k];
  }
  function load() {
    if (!me()) { note('Non connecté', 'err'); return; }
    $('rv-body').innerHTML = '<div class="rv-mut" style="padding:20px">Chargement…</div>';
    gather().then(render);
  }
  function gather() {
    return Promise.all([
      (window.Notes && Notes.inRange) ? Notes.inRange(_from, _to) : Promise.resolve([]),
      (window.Releves && Releves.inRange) ? Releves.inRange(_from, _to) : Promise.resolve([]),
      loadPhotos()
    ]).then(function(R){
      var map = {}, prev = {}; _stores.forEach(function(s){ prev[s.key] = s; });
      R[0].forEach(function(n){ if (!n.clientId && !n.clientNom) return; var s = ensure(map, n.clientId, n.clientNom); s.noteSrc.push(n); });
      R[1].forEach(function(r){ var s = ensure(map, r.clientId, r.magasin, r.ville); s.rels.push(r); });
      _photos.forEach(function(p){ if (p.date >= _from && p.date <= _to) ensure(map, p.clientId, p.nom); });
      Object.keys(prev).forEach(function(k){ if (prev[k].manual && !map[k]) { map[k] = prev[k]; } });
      _stores = Object.keys(map).map(function(k){
        var s = map[k];
        if (_edits[k] != null) s.notes = _edits[k];
        else s.notes = s.noteSrc.map(function(n){ return (n.titre ? n.titre + ' — ' : '') + n.txt; }).concat(s.rels.map(function(r){ return r.remarque; })).filter(Boolean).join('\n\n');
        if (prev[k]) s.inc = prev[k].inc;
        s.manual = s.manual || (prev[k] && prev[k].manual);
        return s;
      }).sort(function(a, b){ return a.nom.localeCompare(b.nom, 'fr'); });
      rebuildPhotos();
      if (!String(_actions || '').trim()) {   // actions ouvertes des relevés de la période → « points à retenir »
        var A = []; _stores.forEach(function(s){ s.rels.forEach(function(r){ (r.actions || []).forEach(function(a){ if (!a.done) A.push('• ' + (_stores.length > 1 ? s.nom + ' : ' : '') + a.t + (a.due ? ' (pour le ' + frDate(a.due) + ')' : '')); }); }); });
        _actions = A.join('\n');
      }
    });
  }

  // ── Interface ──
  function open(clientId) {
    css(); _from = _to = ymd(new Date()); _stores = []; _edits = {}; _dest = lsGet('rv_dest'); _intro = ''; _actions = '';
    var old = $('rv-ov'); if (old) old.remove();
    var ov = document.createElement('div'); ov.id = 'rv-ov';
    ov.innerHTML = '<div class="rv"><div class="rv-h"><h2>📤 Retour de visite</h2><button class="rv-x" onclick="RetourVisite.close()" aria-label="Fermer">✕</button></div><div id="rv-body" class="rv-body"></div></div>';
    document.body.appendChild(ov);
    if (clientId) {
      var c = cById(clientId); if (c) { _stores = [{ key: keyOf(c.id, c.nom), clientId: c.id, nom: c.nom, ville: c.ville || '', inc: true, notes: '', noteSrc: [], rels: [], photos: [], manual: true }]; }
    }
    load();
  }
  function close(){ var o = $('rv-ov'); if (o) o.remove(); }
  function setDates() {
    var a = $('rv-from').value, b = $('rv-to').value; if (!a || !b) return;
    if (a > b) { b = a; }
    _from = a; _to = b; syncEdits(); load();
  }
  function preset(n) {
    var d = new Date(), t = ymd(d); d.setDate(d.getDate() - n); _from = ymd(d); _to = t; if (n === 1) _to = _from; syncEdits(); load();
  }
  function syncEdits() { _stores.forEach(function(s){ var t = $('rv-n-' + s.key); if (t) _edits[s.key] = t.value; }); var i = $('rv-intro'); if (i) _intro = i.value; var a = $('rv-act'); if (a) _actions = a.value; var d = $('rv-dest'); if (d) { _dest = d.value; lsSet('rv_dest', _dest); } }
  function setInc(k, v){ var s = byKey(k); if (s) { s.inc = !!v; } }
  function addStore() {
    var v = ($('rv-add').value || '').trim(); if (!v) return;
    var c = contacts().filter(function(x){ return ((x.nom||'') + (x.ville ? ' — ' + x.ville : '')) === v || x.nom === v; })[0];
    syncEdits();
    var k = keyOf(c ? c.id : '', c ? c.nom : v);
    if (!byKey(k)) _stores.push({ key: k, clientId: c ? c.id : '', nom: c ? c.nom : v, ville: c ? (c.ville || '') : '', inc: true, notes: '', noteSrc: [], rels: [], photos: [], manual: true });
    $('rv-add').value = ''; rebuildPhotos(); render();
  }
  function interLine(r) { var i = r && r.interloc; if (!i || !i.nom) return ''; return i.nom + (i.fonction ? ' (' + i.fonction + ')' : '') + (i.tel ? ' · ' + i.tel : '') + (i.email ? ' · ' + i.email : ''); }
  function relLine(r) {
    var s = r.stats, t = [r.ensNom || r.ens, frDate(r.date)];
    if (s.taux != null) t.push('référencement ' + s.taux + '% (' + s.pres + '/' + s.pointed + ' pointés)');
    if (s.moy != null) t.push('prix moyen ' + s.moy.toFixed(2).replace('.', ',') + ' €');
    return t.join(' · ');
  }
  function render() {
    var b = $('rv-body'); if (!b) return;
    var h = '';
    h += '<div class="rv-sec"><div class="rv-row"><label>Du <input type="date" id="rv-from" value="' + _from + '" onchange="RetourVisite.dates()"></label><label>au <input type="date" id="rv-to" value="' + _to + '" onchange="RetourVisite.dates()"></label></div>'
      + '<div class="rv-row"><button class="rv-b" onclick="RetourVisite.preset(0)">Aujourd\'hui</button><button class="rv-b" onclick="RetourVisite.preset(1)">Hier</button><button class="rv-b" onclick="RetourVisite.preset(6)">7 jours</button><button class="rv-b" onclick="RetourVisite.preset(30)">30 jours</button></div></div>';
    h += '<div class="rv-sec"><label class="rv-l">Message d\'introduction (facultatif)</label><textarea id="rv-intro" rows="2" placeholder="Bonjour, voici mon retour de visite…">' + esc(_intro) + '</textarea></div>';
    if (!_stores.length) h += '<div class="rv-mut" style="padding:10px 2px">Aucune note, relevé ni photo sur cette période. Ajoutez un magasin ci-dessous, ou changez les dates.</div>';
    _stores.forEach(function(s){
      var k = s.key;
      h += '<div class="rv-card"><div class="rv-ch"><label class="rv-chk"><input type="checkbox" ' + (s.inc ? 'checked' : '') + ' onchange="RetourVisite.inc(\'' + k + '\',this.checked)"> <b>' + esc(s.nom) + '</b>' + (s.ville ? ' <span class="rv-mut">' + esc(s.ville) + '</span>' : '') + '</label></div>';
      if (s.rels.length) { h += '<div class="rv-rel">'; s.rels.forEach(function(r){ h += '<div>🏪 ' + esc(relLine(r)) + (interLine(r) ? '<div class="rv-mut">👤 ' + esc(interLine(r)) + '</div>' : '') + (r.abs.length ? '<div class="rv-mut">Absents : ' + esc(r.abs.slice(0, 12).join(', ')) + (r.abs.length > 12 ? ' … (+' + (r.abs.length - 12) + ')' : '') + '</div>' : '') + '</div>'; }); h += '</div>'; }
      h += '<label class="rv-l">Notes de visite</label><textarea id="rv-n-' + k + '" rows="4" placeholder="Ce qui est à remonter pour ce magasin…">' + esc(_edits[k] != null ? _edits[k] : (s.notes || '')) + '</textarea>';
      h += '<div class="rv-ph">';
      s.photos.forEach(function(p){ h += '<div class="rv-pi"><img src="' + p.data + '" alt=""><input type="text" value="' + esc(p.caption || '') + '" placeholder="Légende" onchange="RetourVisite.cap(\'' + p.id + '\',this.value)"><button class="rv-del" onclick="RetourVisite.delPhoto(\'' + p.id + '\')" aria-label="Supprimer">✕</button></div>'; });
      h += '</div><div class="rv-row"><label class="rv-b p">📷 Prendre une photo<input type="file" accept="image/*" capture="environment" hidden onchange="RetourVisite.photos(\'' + k + '\',this)"></label>'
        + '<label class="rv-b">🖼️ Galerie<input type="file" accept="image/*" multiple hidden onchange="RetourVisite.photos(\'' + k + '\',this)"></label></div></div>';
    });
    h += '<div class="rv-sec"><label class="rv-l">Ajouter un autre magasin</label><div class="rv-row"><input list="rv-dl" id="rv-add" placeholder="Nom du client…" style="flex:1"><button class="rv-b" onclick="RetourVisite.addStore()">+ Ajouter</button></div>'
      + '<datalist id="rv-dl">' + contacts().slice(0, 3000).map(function(c){ return '<option value="' + esc((c.nom || '') + (c.ville ? ' — ' + c.ville : '')) + '">'; }).join('') + '</datalist></div>';
    h += '<div class="rv-sec"><label class="rv-l">Points à retenir / actions à mener</label><textarea id="rv-act" rows="3" placeholder="Ex. relancer Biocoop Échirolles pour les lentilles, demander PLV…">' + esc(_actions) + '</textarea></div>';
    h += '<div class="rv-sec"><label class="rv-l">Destinataire (e-mail de la société)</label><input type="email" id="rv-dest" value="' + esc(_dest) + '" placeholder="adresse@societe.fr" style="width:100%"></div>';
    h += '<div class="rv-foot"><button class="rv-b p" onclick="RetourVisite.pdf()" ' + (_busy ? 'disabled' : '') + '>📄 Générer le PDF</button><button class="rv-b" onclick="RetourVisite.mail()">✉️ Préparer le mail</button></div>';
    b.innerHTML = h;
  }

  // ── Contenu du rapport ──
  function author() { var u = me(); return u ? (u.displayName || u.email || '') : ''; }
  function brand() { try { return (typeof currentBrand !== 'undefined' && currentBrand) ? String(currentBrand) : ''; } catch(e){ return ''; } }
  function collect() {
    syncEdits();
    return _stores.filter(function(s){ return s.inc; }).map(function(s){
      var t = _edits[s.key] != null ? _edits[s.key] : (s.notes || '');
      return { s: s, notes: String(t).trim() };
    });
  }
  function period() { return _from === _to ? frDate(_from) : frDate(_from) + ' au ' + frDate(_to); }
  function mailText() {
    var L = collect(), t = [];
    if (_intro.trim()) t.push(_intro.trim(), '');
    t.push('RETOUR DE VISITE — ' + period(), '');
    L.forEach(function(x){
      t.push('■ ' + x.s.nom + (x.s.ville ? ' (' + x.s.ville + ')' : ''));
      x.s.rels.forEach(function(r){ t.push('  Relevé : ' + relLine(r)); if (interLine(r)) t.push('  Interlocuteur : ' + interLine(r)); if (r.abs.length) t.push('  Absents : ' + r.abs.slice(0, 15).join(', ')); });
      if (x.notes) t.push(x.notes.split('\n').map(function(l){ return '  ' + l; }).join('\n'));
      if (x.s.photos.length) t.push('  📷 ' + x.s.photos.length + ' photo(s) dans le PDF joint');
      t.push('');
    });
    if (_actions.trim()) t.push('POINTS À RETENIR / ACTIONS', _actions.trim(), '');
    t.push('Cordialement,', author());
    return t.join('\n');
  }
  function mail() {
    var L = collect(); if (!L.length) { note('Aucun magasin sélectionné', 'err'); return; }
    var sujet = 'Retour de visite — ' + period(), body = mailText();
    var url = 'mailto:' + (_dest || '') + '?subject=' + encodeURIComponent(sujet) + '&body=' + encodeURIComponent(body);
    if (url.length > 1900) {
      try { navigator.clipboard.writeText(body); note('Texte copié : collez-le dans votre mail (trop long pour être pré-rempli)'); } catch(e){}
      url = 'mailto:' + (_dest || '') + '?subject=' + encodeURIComponent(sujet);
    }
    window.location.href = url;
    setTimeout(function(){ note('Joignez le PDF (bouton « Générer le PDF ») si vous avez des photos'); }, 800);
  }

  // ── PDF ──
  function pdf() {
    var L = collect(); if (!L.length) { note('Aucun magasin sélectionné', 'err'); return; }
    _busy = true; note('Création du PDF…');
    var fail = function(){ _busy = false; note('Chargement du module PDF impossible (connexion ?)', 'err'); };
    var go = function(){ try { build(L); } catch(e) { console.error(e); note('Erreur PDF : ' + e.message, 'err'); } _busy = false; };
    if (window.jspdf) go(); else lazyLoad([LIB_JSPDF], go, fail);
  }
  function build(L) {
    var doc = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    var W = 210, M = 15, CW = W - 2 * M, y = 0, page = 1;
    function foot() { doc.setFontSize(8); doc.setTextColor(140); doc.text('Retour de visite — ' + period() + ' — page ' + page, W / 2, 289, { align: 'center' }); doc.setTextColor(0); }
    function need(h) { if (y + h > 280) { foot(); doc.addPage(); page++; y = 18; } }
    function para(txt, size, style, color, indent) {
      doc.setFont('helvetica', style || 'normal'); doc.setFontSize(size || 10); doc.setTextColor(color || 20);
      doc.splitTextToSize(String(txt), CW - (indent || 0)).forEach(function(l){ need(size * 0.5 + 1); doc.text(l, M + (indent || 0), y); y += size * 0.45 + 1.2; });
      doc.setTextColor(0);
    }
    // En-tête
    doc.setFillColor(40, 70, 50); doc.rect(0, 0, W, 26, 'F');
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.text('Retour de visite', M, 12);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.text(period() + (brand() ? ' · ' + brand() : '') + (author() ? ' · ' + author() : ''), M, 20);
    doc.setTextColor(0); y = 36;
    if (_intro.trim()) { para(_intro.trim(), 10); y += 3; }
    // Synthèse
    var nRel = 0, nPh = 0; L.forEach(function(x){ nRel += x.s.rels.length; nPh += x.s.photos.length; });
    para(L.length + ' magasin(s) · ' + nRel + ' relevé(s) · ' + nPh + ' photo(s)', 10, 'bold', 60); y += 3;
    L.forEach(function(x){
      need(30);
      doc.setDrawColor(200); doc.line(M, y, W - M, y); y += 6;
      para(x.s.nom + (x.s.ville ? ' — ' + x.s.ville : ''), 13, 'bold', 40);
      y += 1;
      x.s.rels.forEach(function(r){
        para('Relevé · ' + relLine(r), 9.5, 'bold', 60);
        if (interLine(r)) para('Interlocuteur : ' + interLine(r), 9.5, 'normal', 60);
        if (r.abs.length) para('Références absentes : ' + r.abs.join(', '), 9, 'normal', 90, 3);
      });
      if (x.notes) { y += 1; para(x.notes, 10); }
      if (x.s.photos.length) {
        y += 3; var cw = (CW - 6) / 2, col = 0, rowH = 0, x0 = M;
        x.s.photos.forEach(function(p){
          var w = cw, h = w * p.h / p.w; if (h > 95) { h = 95; w = h * p.w / p.h; }
          if (col === 0) { need(h + 10); rowH = 0; }
          var xx = M + col * (cw + 6);
          try { doc.addImage(p.data, 'JPEG', xx, y, w, h); } catch(e){}
          if (p.caption) { doc.setFontSize(8); doc.setTextColor(90); doc.text(doc.splitTextToSize(p.caption, cw)[0], xx, y + h + 4); doc.setTextColor(0); }
          rowH = Math.max(rowH, h + 8); col++;
          if (col === 2) { y += rowH; col = 0; rowH = 0; }
        });
        if (col === 1) y += rowH;
      }
      y += 4;
    });
    if (_actions.trim()) { need(25); doc.setDrawColor(200); doc.line(M, y, W - M, y); y += 6; para('Points à retenir / actions', 13, 'bold', 40); y += 1; para(_actions.trim(), 10); }
    foot();
    var name = 'Retour_visite_' + _from + (_to !== _from ? '_au_' + _to : '') + '.pdf';
    out(doc, name);
  }
  function out(doc, name) {
    _pdfBlob = doc.output('blob'); _pdfName = name;
    try { if (_pdfUrl) URL.revokeObjectURL(_pdfUrl); } catch(e){}
    _pdfUrl = URL.createObjectURL(_pdfBlob);
    var old = $('rv-pdfov'); if (old) old.remove();
    var canShare = false; try { var f = new File([_pdfBlob], name, { type: 'application/pdf' }); canShare = !!(navigator.canShare && navigator.canShare({ files: [f] })); } catch(e){}
    var ov = document.createElement('div'); ov.id = 'rv-pdfov';
    ov.innerHTML = '<div class="rv rv-sm"><h2 style="margin:0 0 4px">📄 PDF prêt</h2><div class="rv-mut" style="word-break:break-all;margin-bottom:12px">' + esc(name) + ' · ' + Math.max(1, Math.round(_pdfBlob.size / 1024)) + ' Ko</div>'
      + '<div style="display:flex;flex-direction:column;gap:8px">'
      + (canShare ? '<button class="rv-b p" style="padding:12px" onclick="RetourVisite.pdfShare()">📤 Envoyer à ma société (PDF joint)</button>' : '')
      + '<button class="rv-b' + (canShare ? '' : ' p') + '" style="padding:12px" onclick="RetourVisite.pdfSave()">💾 Enregistrer sur cet appareil</button>'
      + '<button class="rv-b" style="padding:12px" onclick="RetourVisite.mail()">✉️ Ouvrir le mail pré-rempli</button>'
      + '<button class="rv-b" onclick="window.open(\'' + _pdfUrl + '\',\'_blank\')">👁 Ouvrir</button>'
      + '<button class="rv-b" onclick="document.getElementById(\'rv-pdfov\').remove()">Fermer</button></div>'
      + '<div class="rv-mut" style="margin-top:10px;font-size:.72rem">' + (canShare ? '« Envoyer » ouvre la feuille de partage (Mail, WhatsApp, Outlook…) avec le PDF en pièce jointe.' : 'Enregistrez le PDF puis joignez-le au mail.') + '</div></div>';
    document.body.appendChild(ov);
  }
  function pdfSave() {
    if (!_pdfBlob) return;
    try { var a = document.createElement('a'); a.href = _pdfUrl; a.download = _pdfName; a.style.display = 'none'; document.body.appendChild(a); a.click(); setTimeout(function(){ a.remove(); }, 1500); note('PDF enregistré (dossier Téléchargements)'); }
    catch(e) { note('Enregistrement impossible : utilisez « Ouvrir »', 'err'); }
  }
  function pdfShare() {
    if (!_pdfBlob) return;
    try { var f = new File([_pdfBlob], _pdfName, { type: 'application/pdf' });
      navigator.share({ files: [f], title: 'Retour de visite — ' + period(), text: mailText() }).catch(function(e){ if (e && e.name !== 'AbortError') note('Partage impossible : enregistrez le PDF', 'err'); });
    } catch(e) { note('Partage impossible', 'err'); }
  }


  // ── API pour l'écran Relevés (notes + photos + rapport sur place) ──
  function metaKey(m){ return keyOf(m.clientId || '', m.nom); }
  function listPhotos(m) { return loadPhotos().then(function(){ var k = metaKey(m); return _photos.filter(function(p){ return p.key === k && p.date === m.date; }).sort(function(a, b){ return a.createdAt - b.createdAt; }); }); }
  function addTo(m, input) {
    var files = Array.prototype.slice.call(input.files || []); input.value = '';
    var u = me(); if (!u || !files.length) return Promise.resolve();
    var k = metaKey(m);
    return loadPhotos().then(function(){
      return files.reduce(function(p, f){
        return p.then(function(){ return compress(f).then(function(img){
          var ref = pcol().doc(), o = { kind: 'retour', owner: u.uid, date: m.date, key: k, clientId: m.clientId || '', nom: m.nom, caption: '', data: img.data, w: img.w, h: img.h, createdAt: Date.now() };
          return ref.set(o).then(function(){ o.id = ref.id; _photos.push(o); });
        }); }).catch(function(e){ note('Photo non enregistrée : ' + (e.code || e.message), 'err'); });
      }, Promise.resolve());
    });
  }
  function removePhoto(id) { pcol().doc(id).delete().catch(function(){}); _photos = (_photos || []).filter(function(p){ return p.id !== id; }); }
  // Rapport PDF d'une seule visite (relevé + notes + photos), sans passer par l'écran de sélection
  function quick(m) {
    if (!me()) { note('Non connecté', 'err'); return; }
    css(); _from = _to = m.date; _stores = []; _edits = {}; _intro = ''; _actions = ''; _dest = lsGet('rv_dest');
    var k = metaKey(m); note('Préparation du rapport…');
    gather().then(function(){
      _stores.forEach(function(s){ s.inc = (s.key === k); });
      if (!byKey(k)) { note('Rien à inclure pour ce magasin', 'err'); return; }
      pdf();
    });
  }

  // ── Fiche d'informations client : tout ce que les visites ont appris sur un magasin ──
  function ficheClient(m) {
    if (!me()) { note('Non connecté', 'err'); return; }
    css(); note('Préparation de la fiche client…');
    var c = m.clientId ? cById(m.clientId) : null, key = metaKey(m);
    var c2 = c || { id: m.clientId || '', nom: m.nom };
    Promise.all([
      (window.Releves && Releves.forStore) ? Releves.forStore(m) : Promise.resolve([]),
      (window.Notes && Notes.forClient) ? Notes.forClient(c2) : Promise.resolve([]),
      loadPhotos()
    ]).then(function(R){
      var go = function(){ try { buildFiche(c, m, R[0], R[1], _photos.filter(function(p){ return p.key === key; }).sort(function(a, b){ return b.createdAt - a.createdAt; })); } catch(e) { console.error(e); note('Erreur PDF : ' + e.message, 'err'); } };
      if (window.jspdf) go(); else lazyLoad([LIB_JSPDF], go, function(){ note('Chargement du module PDF impossible (connexion ?)', 'err'); });
    });
  }
  function buildFiche(c, m, rels, notes, photos) {
    var doc = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    var W = 210, M = 15, CW = W - 2 * M, y = 0, page = 1, today = new Date();
    function foot() { doc.setFontSize(8); doc.setTextColor(140); doc.text('Fiche client — ' + m.nom + ' — page ' + page, W / 2, 289, { align: 'center' }); doc.setTextColor(0); }
    function need(h) { if (y + h > 280) { foot(); doc.addPage(); page++; y = 18; } }
    function para(txt, size, style, color, indent) {
      doc.setFont('helvetica', style || 'normal'); doc.setFontSize(size || 10); doc.setTextColor(color || 20);
      doc.splitTextToSize(String(txt), CW - (indent || 0)).forEach(function(l){ need(size * 0.5 + 1); doc.text(l, M + (indent || 0), y); y += size * 0.45 + 1.2; });
      doc.setTextColor(0);
    }
    function title(t) { need(16); y += 3; doc.setDrawColor(200); doc.line(M, y, W - M, y); y += 6; para(t, 12, 'bold', 40); y += 1; }
    doc.setFillColor(40, 70, 50); doc.rect(0, 0, W, 28, 'F');
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.text("Fiche d'informations client", M, 12);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.text(m.nom + (m.ville ? ' — ' + m.ville : ''), M, 20);
    doc.setFontSize(9); doc.text('Établie le ' + frDate(ymd(today)) + (author() ? ' par ' + author() : '') + (brand() ? ' · ' + brand() : ''), M, 25.5);
    doc.setTextColor(0); y = 38;
    // Coordonnées
    var co = []; if (c) { if (c.numClient) co.push('N° client : ' + c.numClient); var ad = [c.adresse, [c.cp, c.ville].filter(Boolean).join(' ')].filter(Boolean).join(', '); if (ad) co.push('Adresse : ' + ad); if (c.telephone) co.push('Téléphone : ' + c.telephone); if (c.email) co.push('E-mail : ' + c.email); if (c.groupe) co.push('Enseigne / groupe : ' + c.groupe); }
    if (co.length) { title('Le magasin'); co.forEach(function(l){ para(l, 10); }); }
    // Interlocuteurs
    var seen = {}, inter = [];
    rels.forEach(function(r){ var i = r.interloc; if (i && i.nom) { var k = i.nom.trim().toLowerCase(); if (!seen[k]) { seen[k] = 1; inter.push({ i: i, date: r.date }); } } });
    if (inter.length) { title('Interlocuteurs rencontrés'); inter.forEach(function(x){ para('• ' + interLine({ interloc: x.i }) + '  (vu le ' + frDate(x.date) + ')', 10); }); }
    // Visites
    if (rels.length) {
      title('Historique des relevés (' + rels.length + ')');
      rels.slice(0, 12).forEach(function(r){ var s = r.stats; para(frDate(r.date) + ' · ' + r.ensNom + ' · ' + (s.cat ? s.pres + '/' + s.total + ' produits de la gamme (' + s.taux + ' %)' : s.pres + '/' + s.pointed + ' pointés' + (s.taux != null ? ' (' + s.taux + ' %)' : '')) + (s.moy != null ? ' · prix moyen ' + s.moy.toFixed(2).replace('.', ',') + ' €' : ''), 9.5); });
      var last = rels[0];
      if (last.abs.length) { y += 2; para('Références absentes au dernier relevé (' + frDate(last.date) + ', ' + last.abs.length + ') : ' + last.abs.slice(0, 40).join(', ') + (last.abs.length > 40 ? ' …' : ''), 9, 'normal', 80); }
    }
    // Notes et échanges (remarques des relevés + notes libres), du plus récent au plus ancien
    var N = [];
    rels.forEach(function(r){ if (String(r.remarque || '').trim()) N.push({ d: r.date, t: r.remarque.trim() }); });
    (notes || []).forEach(function(n){ if (n.txt) N.push({ d: n.date, t: (n.titre ? n.titre + ' — ' : '') + n.txt }); });
    N.sort(function(a, b){ return String(b.d).localeCompare(String(a.d)); });
    if (N.length) { title('Notes et échanges'); N.slice(0, 10).forEach(function(n){ para(frDate(n.d), 9, 'bold', 90); para(n.t, 10); y += 2; }); }
    var OA = []; rels.forEach(function(r){ (r.actions || []).forEach(function(a){ if (!a.done) OA.push({ d: r.date, t: a.t + (a.due ? ' (pour le ' + frDate(a.due) + ')' : '') }); }); });
    if (OA.length) { title('Actions en cours'); OA.forEach(function(a){ para('• ' + a.t + '  (' + frDate(a.d) + ')', 10); }); }
    // Photos
    if (photos.length) {
      title('Photos (' + photos.length + (photos.length > 12 ? ', 12 plus récentes' : '') + ')');
      var cw = (CW - 6) / 2, col = 0, rowH = 0;
      photos.slice(0, 12).forEach(function(p){
        var w = cw, h = w * p.h / p.w; if (h > 80) { h = 80; w = h * p.w / p.h; }
        if (col === 0) { need(h + 12); rowH = 0; }
        var xx = M + col * (cw + 6);
        try { doc.addImage(p.data, 'JPEG', xx, y, w, h); } catch(e){}
        doc.setFontSize(8); doc.setTextColor(90); doc.text(doc.splitTextToSize(frDate(p.date) + (p.caption ? ' — ' + p.caption : ''), cw)[0], xx, y + h + 4); doc.setTextColor(0);
        rowH = Math.max(rowH, h + 8); col++;
        if (col === 2) { y += rowH; col = 0; }
      });
      if (col === 1) y += rowH;
    }
    if (!co.length && !inter.length && !rels.length && !N.length && !photos.length) para("Aucune information enregistrée pour ce magasin pour l'instant.", 10);
    foot();
    out(doc, 'Fiche_client_' + norm(m.nom).replace(/ /g, '_').slice(0, 40) + '_' + ymd(today) + '.pdf');
  }

  // ── Style ──
  function css() {
    if ($('rv-css')) return;
    var st = document.createElement('style'); st.id = 'rv-css';
    st.textContent = '#rv-ov,#rv-pdfov{position:fixed;inset:0;z-index:99990;background:rgba(20,18,15,.55);display:flex;align-items:center;justify-content:center;padding:10px}#rv-pdfov{z-index:99995}'
      + '.rv{background:#fff;border-radius:16px;width:100%;max-width:640px;max-height:94vh;display:flex;flex-direction:column;font-family:var(--fd,system-ui,sans-serif);color:#222;overflow:hidden}.rv-sm{padding:18px;max-width:420px;display:block}'
      + '.rv-h{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #eee}.rv-h h2{margin:0;font-size:1.1rem}.rv-x{border:0;background:none;font-size:1.2rem;cursor:pointer;padding:6px 10px}'
      + '.rv-body{overflow:auto;padding:12px 16px 18px}.rv-sec{margin-bottom:12px}.rv-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:6px 0}'
      + '.rv-l{display:block;font-size:.78rem;font-weight:600;color:#555;margin:8px 0 4px}.rv-mut{color:#777;font-size:.78rem}'
      + '.rv input[type=text],.rv input[type=date],.rv input[type=email],.rv input:not([type]),.rv textarea{border:1px solid #ccc;border-radius:8px;padding:8px;font:inherit;font-size:.9rem;box-sizing:border-box}.rv textarea{width:100%;resize:vertical}'
      + '.rv-b{border:1px solid #ccc;background:#fff;border-radius:10px;padding:8px 12px;font:inherit;font-size:.88rem;cursor:pointer;display:inline-block}.rv-b.p{background:#2c4a34;color:#fff;border-color:#2c4a34}.rv-b:disabled{opacity:.5}'
      + '.rv-card{border:1px solid #e3e3e3;border-radius:12px;padding:10px 12px;margin-bottom:12px;background:#fafafa}.rv-chk{display:flex;gap:6px;align-items:center;flex-wrap:wrap}'
      + '.rv-rel{background:#eef5ee;border-radius:8px;padding:6px 10px;margin:8px 0;font-size:.82rem}'
      + '.rv-ph{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}.rv-pi{position:relative;width:calc(50% - 4px)}.rv-pi img{width:100%;border-radius:8px;display:block}.rv-pi input{width:100%;margin-top:3px;font-size:.75rem!important;padding:4px 6px!important}'
      + '.rv-del{position:absolute;top:4px;right:4px;border:0;background:rgba(0,0,0,.6);color:#fff;border-radius:50%;width:26px;height:26px;cursor:pointer}'
      + '.rv-foot{display:flex;gap:8px;flex-wrap:wrap;position:sticky;bottom:-18px;background:#fff;padding:10px 0 4px;border-top:1px solid #eee}.rv-foot .rv-b{flex:1;padding:12px}';
    document.head.appendChild(st);
  }

  window.RetourVisite = { ficheClient: ficheClient, list: listPhotos, addTo: addTo, remove: removePhoto, cap: capPhoto, key: metaKey, quick: quick, open: open, close: close, dates: setDates, preset: preset, inc: setInc, addStore: addStore, photos: addPhotos, delPhoto: delPhoto, pdf: pdf, mail: mail, pdfSave: pdfSave, pdfShare: pdfShare, _mailText: mailText, _collect: collect };
})();
