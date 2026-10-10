/* ═══════════════════════════════════════════════════════════════════════
   NOTES — prise de notes libre (avec ou sans client), dictée, enregistrement
   de conversation + transcription/résumé IA (via le module Visite).
   Le client peut être rattaché APRÈS coup, puis la note ajoutée à sa fiche.
   Stockage : collection privée bcol('carnet') — document { kind:'note', owner… }
   (mêmes règles que le Carnet : strictement privé, aucune règle à ajouter).
   Champs : titre, cr (texte), transcription, resume, clientNom, clientId,
   secteur, date, createdAt, updatedAt.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  var _notes = [];
  var _unsub = null;
  var _filter = 'all';          // all | sans | avec
  var _q = '';
  var _cur = null;              // id de la note ouverte

  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function pad(n){ return (n<10?'0':'')+n; }
  function ymd(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
  function $(id){ return document.getElementById(id); }
  function note(m,t){ try { toast(m,t||'ok'); } catch(e){ console.log(m); } }
  function me(){ return (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null; }
  function col(){ return bcol('carnet'); }
  function contacts(){ return (typeof cdbContacts !== 'undefined' && cdbContacts) ? cdbContacts : []; }
  function stamp(n){ return n.updatedAt || n.crUpdatedAt || n.createdAt || 0; }
  function whenFr(ms){
    if (!ms) return '';
    var d = new Date(ms);
    return d.toLocaleDateString('fr-FR', { day:'2-digit', month:'short' }) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  // ── Chargement temps réel (mes notes uniquement) ──
  function load() {
    var u = me(); if (!u) return;
    try { if (_unsub) { _unsub(); _unsub = null; } } catch(e){}
    _unsub = col().where('owner', '==', u.uid).where('kind', '==', 'note').onSnapshot(function(snap){
      _notes = snap.docs.map(function(d){ var o = d.data(); o.id = d.id; return o; })
        .sort(function(a, b){ return stamp(b) - stamp(a); });
      renderList();
    }, function(e){ console.warn('[Notes]', e && e.code); var h = $('notes-host'); if (h && !_notes.length) h.innerHTML = '<div class="nt-empty">Notes indisponibles : ' + esc((e && e.code) || 'erreur') + '</div>'; });
  }
  function mount() { css(); renderShell(); load(); }

  // ── Liste ──
  function renderShell() {
    var host = $('notes-host'); if (!host) return;
    host.innerHTML =
        '<div class="nt-head"><div><div class="nt-title">Notes</div><div class="nt-sub">Prenez des notes à tout moment — avec ou sans client, à l\'écrit ou à l\'oral</div></div>'
      + '<button class="nt-new" onclick="Notes.nouvelle()">+ Nouvelle note</button></div>'
      + '<div class="nt-bar"><input id="nt-q" class="nt-q" placeholder="Rechercher…" oninput="Notes.search(this.value)">'
      +   '<div class="nt-chips" id="nt-chips"></div></div>'
      + '<div id="nt-list"></div>';
    renderList();
  }
  function renderList() {
    var list = $('nt-list'); if (!list) return;
    var chips = $('nt-chips');
    var nSans = _notes.filter(function(n){ return !n.clientNom; }).length;
    if (chips) chips.innerHTML = [['all','Toutes (' + _notes.length + ')'], ['sans','Sans client (' + nSans + ')'], ['avec','Avec client']].map(function(c){
      return '<button class="nt-chip' + (_filter === c[0] ? ' on' : '') + '" onclick="Notes.filter(\'' + c[0] + '\')">' + c[1] + '</button>'; }).join('');
    var q = _q.toLowerCase();
    var rows = _notes.filter(function(n){
      if (_filter === 'sans' && n.clientNom) return false;
      if (_filter === 'avec' && !n.clientNom) return false;
      if (!q) return true;
      return [n.titre, n.cr, n.resume, n.transcription, n.clientNom].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    if (!rows.length) { list.innerHTML = '<div class="nt-empty">' + (_notes.length ? 'Aucune note ne correspond.' : 'Aucune note pour le moment. Appuyez sur « + Nouvelle note ».') + '</div>'; return; }
    list.innerHTML = rows.map(function(n){
      var titre = n.titre || (n.cr || '').split('\n')[0].slice(0, 60) || (n.resume ? 'Note enregistrée' : 'Note sans titre');
      var extrait = (n.resume || n.cr || '').replace(/\s+/g, ' ').slice(0, 150);
      return '<div class="nt-card" onclick="Notes.open(\'' + n.id + '\')">'
        + '<div class="nt-row"><div class="nt-ct">' + esc(titre) + (n.transcription ? ' <span title="Conversation enregistrée">🎙</span>' : '') + '</div><div class="nt-when">' + whenFr(stamp(n)) + '</div></div>'
        + (extrait ? '<div class="nt-ex">' + esc(extrait) + '</div>' : '')
        + '<div class="nt-row">'
        + (n.clientNom ? '<span class="nt-cli">👤 ' + esc(n.clientNom) + '</span>' : '<span class="nt-nocli">Sans client</span>')
        + (n.addedToClient ? '<span class="nt-done">✓ dans la fiche</span>' : '') + '</div></div>';
    }).join('');
  }
  function search(v){ _q = v || ''; renderList(); }
  function setFilter(f){ _filter = f; renderList(); }

  // ── Création / ouverture ──
  function nouvelle() {
    var u = me(); if (!u) { note('Non connecté', 'err'); return; }
    var ref = col().doc();
    var now = Date.now();
    var data = { kind: 'note', owner: u.uid, ownerEmail: (u.email || '').toLowerCase(), date: ymd(new Date()),
      titre: '', cr: '', clientNom: '', clientId: '', secteur: '', createdAt: now, updatedAt: now };
    ref.set(data).then(function(){
      data.id = ref.id;
      if (!_notes.some(function(n){ return n.id === data.id; })) _notes.unshift(data);
      open(ref.id);
    }).catch(function(e){ note('Erreur : ' + (e.code || e.message), 'err'); });
  }
  function byId(id){ return _notes.filter(function(n){ return n.id === id; })[0]; }

  function open(id, focusClient) {
    var n = byId(id); if (!n) return;
    css(); _cur = id;
    var old = $('nt-ov'); if (old) old.remove();
    var opts = contacts().slice().sort(function(a, b){ return (a.nom || '').localeCompare(b.nom || ''); })
      .map(function(c){ return '<option value="' + esc(c.nom || '') + '">'; }).join('');
    var ov = document.createElement('div'); ov.id = 'nt-ov';
    ov.innerHTML =
        '<div class="nt-box"><div class="nt-top"><b>📝 Note</b><button class="nt-x" onclick="Notes.close()">✕</button></div>'
      + '<div class="nt-body">'
      +   '<input id="nt-titre" class="nt-in" placeholder="Titre (facultatif)" value="' + esc(n.titre || '') + '" onchange="Notes.saveMeta()">'
      +   '<div><label class="nt-lb">Client <span class="nt-opt">(facultatif — vous pouvez le rattacher plus tard)</span></label>'
      +     '<div class="nt-row"><input id="nt-client" class="nt-in" list="nt-clients" placeholder="Rechercher un client…" value="' + esc(n.clientNom || '') + '" onchange="Notes.saveMeta()">'
      +     '<datalist id="nt-clients">' + opts + '</datalist></div><div id="nt-clinfo" class="nt-hint"></div></div>'
      +   '<div id="notes-vis-box"></div>'
      +   '<div class="nt-actions">'
      +     '<button class="nt-b danger" onclick="Notes.del()">🗑 Supprimer</button>'
      +     '<button class="nt-b" id="nt-addcli" onclick="Notes.addToClient()">📌 Ajouter au compte client</button>'
      +     '<button class="nt-b p" onclick="Notes.close()">Terminer</button>'
      +   '</div>'
      + '</div></div>';
    document.body.appendChild(ov);
    refreshClientInfo(n);
    try { Visite.bind(n, { box: 'notes-vis-box', col: 'carnet' }); } catch(e){ console.warn('[Notes] Visite', e); }
    if (focusClient) setTimeout(function(){ var c = $('nt-client'); if (c) c.focus(); }, 80);
  }
  function refreshClientInfo(n) {
    var el = $('nt-clinfo'), btn = $('nt-addcli'); if (!el) return;
    if (!n.clientNom) { el.textContent = 'Aucun client rattaché pour le moment.'; if (btn) btn.disabled = true; return; }
    if (n.clientId) { el.textContent = '✓ Client de votre base rattaché.'; if (btn) btn.disabled = false; }
    else { el.textContent = 'Nom saisi librement : choisissez un client de la liste pour pouvoir ajouter la note à sa fiche.'; if (btn) btn.disabled = true; }
  }

  // titre + client (champs de l'en-tête)
  function saveMeta() {
    var n = byId(_cur); if (!n) return Promise.resolve();
    var t = $('nt-titre'), c = $('nt-client'); if (!t || !c) return Promise.resolve();
    var name = c.value.trim();
    var match = contacts().filter(function(x){ return (x.nom || '').toLowerCase() === name.toLowerCase(); })[0];
    var patch = { titre: t.value.trim(), clientNom: match ? match.nom : name, clientId: match ? match.id : '', secteur: match ? (match.secteur || '') : '', updatedAt: Date.now() };
    if (!name) { patch.clientNom = ''; patch.clientId = ''; patch.secteur = ''; }
    Object.keys(patch).forEach(function(k){ n[k] = patch[k]; });
    refreshClientInfo(n);
    return col().doc(n.id).set(patch, { merge: true }).catch(function(e){ note('Erreur : ' + (e.code || e.message), 'err'); });
  }

  function isEmpty(n) { return !n.titre && !n.cr && !n.transcription && !n.resume && !n.clientNom; }
  function close() {
    var id = _cur, n = byId(id);
    try { Visite.stop(true); } catch(e){}
    var p = Promise.resolve();
    if (n) {
      // reprend d'éventuelles notes non enregistrées du bloc texte
      var ta = $('vis-cr'); if (ta && ta.value !== (n.cr || '')) { n.cr = ta.value; p = col().doc(id).set({ cr: ta.value, updatedAt: Date.now() }, { merge: true }); }
      p = p.then(function(){ return saveMeta(); });
    }
    var ov = $('nt-ov'); if (ov) ov.remove();
    _cur = null;
    p.then(function(){
      if (n && isEmpty(n)) { return col().doc(id).delete().then(function(){ _notes = _notes.filter(function(x){ return x.id !== id; }); renderList(); }); }
    }).catch(function(){});
  }
  function del() {
    var id = _cur; if (!id || !confirm('Supprimer cette note ?')) return;
    try { Visite.stop(true); } catch(e){}
    col().doc(id).delete().then(function(){
      _notes = _notes.filter(function(x){ return x.id !== id; });
      var ov = $('nt-ov'); if (ov) ov.remove(); _cur = null; renderList(); note('Note supprimée', 'ok');
    }).catch(function(e){ note('Erreur : ' + (e.code || e.message), 'err'); });
  }

  // ── Ajouter au compte client (notes de la fiche) ──
  function addToClient() {
    var n = byId(_cur); if (!n) return;
    var ta = $('vis-cr'); if (ta) n.cr = ta.value;
    var c = contacts().filter(function(x){ return x.id === n.clientId; })[0];
    if (!c) { note('Rattachez d\'abord un client de la liste', 'err'); return; }
    var corps = (n.resume || n.cr || '').trim();
    if (!corps) { note('La note est vide', 'err'); return; }
    if (corps.length > 1200) corps = corps.slice(0, 1200) + '…';
    var d = new Date((n.date || ymd(new Date())) + 'T00:00:00').toLocaleDateString('fr-FR');
    c.notes = (c.notes ? c.notes + '\n' : '') + '[' + d + '] ' + (n.titre ? n.titre + ' — ' : '') + corps;
    bcol('contacts').doc(c.id).set({ notes: c.notes }, { merge: true }).then(function(){
      try { localStorage.setItem(CDB_CACHE_KEY(), JSON.stringify(contacts())); } catch(e){}
      try { cdbRender(); } catch(e){}
      n.addedToClient = Date.now();
      return col().doc(n.id).set({ addedToClient: n.addedToClient, cr: n.cr || '', updatedAt: Date.now() }, { merge: true });
    }).then(function(){ note('📌 Ajouté à la fiche de ' + (c.nom || 'ce client'), 'ok'); })
      .catch(function(e){ note('Erreur : ' + (e.code || e.message), 'err'); });
  }

  // ── Style ──
  function css() {
    if ($('nt-css')) return;
    var s = document.createElement('style'); s.id = 'nt-css';
    s.textContent =
      '.nt-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap}'
      + '.nt-title{font-family:"Sora",sans-serif;font-weight:600;font-size:1.35rem;color:#14120F;letter-spacing:-.03em}'
      + '.nt-sub{font-size:.82rem;color:#6E6963;margin-top:2px}'
      + '.nt-new{border:0;background:#FF4D1C;color:#fff;border-radius:99px;padding:10px 18px;font:600 .85rem "Inter",sans-serif;cursor:pointer}'
      + '.nt-bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px}'
      + '.nt-q{flex:1 1 180px;border:1px solid #E3DFD7;border-radius:10px;padding:9px 12px;font:inherit;background:#fff}'
      + '.nt-chips{display:flex;gap:6px;flex-wrap:wrap}'
      + '.nt-chip{border:1px solid #E3DFD7;background:#fff;border-radius:99px;padding:7px 12px;font:600 .78rem "Inter",sans-serif;cursor:pointer;color:#40463c}'
      + '.nt-chip.on{background:#14120F;border-color:#14120F;color:#fff}'
      + '.nt-card{background:#fff;border:1px solid #E3DFD7;border-radius:14px;padding:12px 14px;margin-bottom:9px;cursor:pointer;display:flex;flex-direction:column;gap:6px}'
      + '.nt-card:hover{border-color:#FF4D1C}'
      + '.nt-row{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}'
      + '.nt-ct{font-weight:700;font-size:.92rem;color:#14120F}.nt-when{font-size:.74rem;color:#8a857d}'
      + '.nt-ex{font-size:.82rem;color:#5a554d;line-height:1.4}'
      + '.nt-cli{font-size:.76rem;background:#FFF4EF;color:#E03A0C;border-radius:99px;padding:3px 10px;font-weight:600}'
      + '.nt-nocli{font-size:.76rem;color:#a59f94;border:1px dashed #d6d1c5;border-radius:99px;padding:3px 10px}'
      + '.nt-done{font-size:.72rem;color:#2a7d3f;font-weight:600}'
      + '.nt-empty{padding:28px;text-align:center;color:#8a857d;font-size:.88rem}'
      + '#nt-ov{position:fixed;inset:0;z-index:99996;background:rgba(20,18,15,.55);display:flex;align-items:flex-end;justify-content:center}'
      + '@media(min-width:700px){#nt-ov{align-items:center}}'
      + '.nt-box{background:#fff;color:#1c1a17;width:100%;max-width:560px;max-height:93vh;overflow:auto;border-radius:18px 18px 0 0}'
      + '@media(min-width:700px){.nt-box{border-radius:18px}}'
      + '.nt-top{position:sticky;top:0;z-index:2;background:#14120F;color:#fff;padding:13px 16px;display:flex;align-items:center;justify-content:space-between}'
      + '.nt-x{border:0;background:rgba(255,255,255,.18);color:#fff;width:32px;height:32px;border-radius:50%;font-size:1.1rem;cursor:pointer}'
      + '.nt-body{padding:14px;display:flex;flex-direction:column;gap:12px}'
      + '.nt-in{width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid #ddd;border-radius:9px;font:inherit}'
      + '.nt-lb{font-size:.74rem;font-weight:700;color:#6E6963;display:block;margin-bottom:4px}.nt-opt{font-weight:400;color:#a59f94}'
      + '.nt-hint{font-size:.74rem;color:#8a857d;margin-top:4px}'
      + '.nt-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}'
      + '.nt-b{border:1px solid #ddd;background:#fff;border-radius:99px;padding:9px 14px;font:600 .82rem "Inter",sans-serif;cursor:pointer}'
      + '.nt-b.p{background:#FF4D1C;border-color:#FF4D1C;color:#fff;margin-left:auto}'
      + '.nt-b.danger{color:#b0402f}.nt-b:disabled{opacity:.45;cursor:not-allowed}';
    document.head.appendChild(s);
  }

  window.Notes = { mount: mount, nouvelle: nouvelle, open: open, close: close, saveMeta: saveMeta, del: del,
    addToClient: addToClient, search: search, filter: setFilter };
})();
