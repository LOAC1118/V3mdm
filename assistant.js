/* ═══════════════════════════════════════════════════════════════════════
   ASSISTANT COHOR — agent IA (étape 1)
   Tu écris ou dictes une phrase ; l'IA la transforme en ACTIONS précises
   (créer un RDV, modifier une fiche client, ajouter une note).
   Rien n'est écrit sans ta validation : chaque action s'affiche sur une
   carte de confirmation. Les écritures passent par ton compte, donc les
   règles Firestore et le cloisonnement par secteur s'appliquent.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  var _actions = [];      // actions proposées { type, data, cands, sel, state }
  var _busy = false;
  var _rec = null, _recOn = false;

  var CHAMPS = { telephone: 'Téléphone', email: 'E-mail', adresse: 'Adresse', cp: 'Code postal', ville: 'Ville', notes: 'Notes' };
  var RDV_TYPES = ['Visite', 'Appel', 'Rendez-vous', 'Relance', 'Livraison', 'Autre'];

  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function pad(n){ return (n<10?'0':'')+n; }
  function ymd(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
  function norm(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim(); }
  function $(id){ return document.getElementById(id); }
  function note(msg, type){ try { toast(msg, type||'ok'); } catch(e){ console.log(msg); } }

  // ── Recherche floue d'un client dans la base (déjà filtrée par rôle) ──
  var STOP = { le:1, la:1, les:1, de:1, du:1, des:1, chez:1, au:1, aux:1, un:1, une:1, et:1, sarl:1, sas:1, bio:0 };
  function findClients(query) {
    var list = (typeof cdbContacts !== 'undefined' && cdbContacts) ? cdbContacts : [];
    var toks = norm(query).split(' ').filter(function(t){ return t && !STOP[t]; });
    if (!toks.length) return [];
    var out = [];
    list.forEach(function(c){
      var hay = norm([c.nom, c.ville, c.numClient, c.groupe].join(' '));
      var nom = norm(c.nom);
      var hit = 0;
      toks.forEach(function(t){ if (hay.indexOf(t) >= 0) hit++; });
      if (!hit) return;
      var score = hit / toks.length;
      if (hit === toks.length) score += 0.5;
      if (nom === norm(query)) score += 1;
      else if (nom.indexOf(norm(query)) >= 0) score += 0.3;
      out.push({ c: c, score: score });
    });
    out.sort(function(a,b){ return b.score - a.score; });
    return out.slice(0, 6);
  }

  // ── Appel IA : phrase → actions JSON ──
  function buildSystem() {
    var now = new Date();
    var jours = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
    return 'Tu es l\'assistant d\'un commercial terrain (CRM). Date du jour : ' + jours[now.getDay()] + ' ' + ymd(now)
      + ', heure ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + '. '
      + 'Transforme la demande en une liste d\'ACTIONS. Types possibles UNIQUEMENT :\n'
      + '1) {"type":"creer_rdv","client":"nom du client tel que dit","date":"YYYY-MM-DD","heure":"HH:MM","rdv_type":"Visite|Appel|Rendez-vous|Relance|Livraison|Autre","objet":"...","lieu":"...","notes":"..."}\n'
      + '2) {"type":"modifier_client","client":"nom du client","champs":{"telephone":"...","email":"...","adresse":"...","cp":"...","ville":"...","notes":"texte À AJOUTER aux notes"}} (n\'inclure que les champs à changer)\n'
      + '3) {"type":"ajouter_note","texte":"...","date":"YYYY-MM-DD"} (note libre ; date = aujourd\'hui si non précisée)\n'
      + 'Résous les dates relatives (« jeudi », « demain », « la semaine prochaine ») en date réelle future. '
      + 'Si l\'heure n\'est pas dite, mets "09:00". N\'invente jamais une information absente de la demande. '
      + 'Si la demande ne correspond à aucune action possible (ex. passer une commande, supprimer), renvoie actions:[] et explique dans "message". '
      + 'Réponds UNIQUEMENT par un objet JSON : {"actions":[...],"message":"courte phrase de synthèse en français"}';
  }
  function parseJson(txt) {
    var s = String(txt||'').trim().replace(/^```(?:json)?/i,'').replace(/```$/,'').trim();
    try { return JSON.parse(s); } catch(e){}
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b+1)); } catch(e){} }
    return null;
  }

  function send() {
    if (_busy) return;
    var ta = $('asst-input'); if (!ta) return;
    var txt = ta.value.trim();
    if (!txt) { note('Écrivez ou dictez une demande', 'err'); return; }
    if (typeof mlAiCall !== 'function') { note('IA indisponible', 'err'); return; }
    setBusy(true);
    mlAiCall(buildSystem(), txt).then(function(res){
      var j = parseJson(res);
      if (!j || !Array.isArray(j.actions)) throw new Error('Réponse IA illisible, reformulez.');
      _actions = j.actions.filter(function(a){ return a && /^(creer_rdv|modifier_client|ajouter_note)$/.test(a.type); })
        .map(function(a){ return prepare(a); });
      renderResult(j.message || '');
    }).catch(function(e){
      renderError(e && e.message === 'no-key' ? 'Aucune clé IA. Configurez-la dans « Assistant IA ».' : (e && e.message) || 'Erreur');
    }).then(function(){ setBusy(false); });
  }

  function prepare(a) {
    var o = { type: a.type, data: a, cands: [], sel: '', state: 'todo' };
    if (a.type === 'creer_rdv' || a.type === 'modifier_client') {
      o.cands = findClients(a.client || '');
      // présélection si un candidat se détache nettement
      if (o.cands.length && (o.cands.length === 1 || o.cands[0].score - o.cands[1].score >= 0.4)) o.sel = o.cands[0].c.id;
    }
    return o;
  }

  // ── Rendu ──
  function setBusy(b) {
    _busy = b;
    var btn = $('asst-send'); if (btn) { btn.disabled = b; btn.textContent = b ? '…' : 'Envoyer'; }
  }
  function renderError(msg) {
    var r = $('asst-result'); if (r) r.innerHTML = '<div class="asst-err">' + esc(msg) + '</div>';
  }
  function dateFr(s) {
    try { return new Date(s+'T00:00:00').toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' }); } catch(e){ return s; }
  }
  function clientPicker(i, o) {
    if (!o.cands.length) return '<div class="asst-warn">Client « ' + esc(o.data.client||'?') + ' » introuvable dans votre base.' + (o.type==='creer_rdv' ? ' Le RDV sera créé sans lien client.' : '') + '</div>';
    var opts = (o.sel ? '' : '<option value="">— Choisir le client —</option>') + o.cands.map(function(x){
      return '<option value="' + esc(x.c.id) + '"' + (x.c.id===o.sel?' selected':'') + '>' + esc(x.c.nom||'') + (x.c.ville ? ' — ' + esc(x.c.ville) : '') + '</option>';
    }).join('');
    return '<select class="asst-sel" onchange="Assistant.pick(' + i + ',this.value)">' + opts + '</select>';
  }
  function cardBody(i, o) {
    var d = o.data, h = '';
    if (o.type === 'creer_rdv') {
      h += '<div class="asst-t">📅 Créer un rendez-vous</div>' + clientPicker(i, o)
        + '<div class="asst-l">' + esc(dateFr(d.date)) + ' à ' + esc(d.heure||'09:00') + ' · ' + esc(d.rdv_type||'Rendez-vous') + '</div>'
        + (d.objet ? '<div class="asst-l">Objet : ' + esc(d.objet) + '</div>' : '')
        + (d.lieu ? '<div class="asst-l">Lieu : ' + esc(d.lieu) + '</div>' : '')
        + (d.notes ? '<div class="asst-l">Notes : ' + esc(d.notes) + '</div>' : '');
    } else if (o.type === 'modifier_client') {
      var c = currentClient(o), ch = d.champs || {};
      h += '<div class="asst-t">✏️ Modifier la fiche client</div>' + clientPicker(i, o);
      Object.keys(ch).forEach(function(k){
        if (!CHAMPS[k] || ch[k] == null || ch[k] === '') return;
        var old = c ? (c[k] || '—') : '…';
        h += '<div class="asst-l"><b>' + CHAMPS[k] + '</b> : ' + (k==='notes' ? 'ajout « ' + esc(ch[k]) + ' »' : esc(old) + ' → <b>' + esc(ch[k]) + '</b>') + '</div>';
      });
    } else {
      h += '<div class="asst-t">📝 Nouvelle note</div><div class="asst-l">' + esc(dateFr(d.date || ymd(new Date()))) + '</div>'
        + '<div class="asst-l">« ' + esc(d.texte||'') + ' »</div>';
    }
    return h;
  }
  function currentClient(o) {
    if (!o.sel) return null;
    var f = o.cands.filter(function(x){ return x.c.id === o.sel; })[0];
    return f ? f.c : null;
  }
  function renderResult(msg) {
    var r = $('asst-result'); if (!r) return;
    if (!_actions.length) { r.innerHTML = '<div class="asst-msg">' + esc(msg || 'Je n\'ai trouvé aucune action à faire. Essayez : « RDV chez Bio Sud jeudi 14h ».') + '</div>'; return; }
    var h = msg ? '<div class="asst-msg">' + esc(msg) + '</div>' : '';
    _actions.forEach(function(o, i){
      var done = o.state === 'ok';
      h += '<div class="asst-card' + (done ? ' done' : '') + '">' + cardBody(i, o)
        + (done ? '<div class="asst-ok">✅ Fait</div>'
          : '<div class="asst-btns"><button class="asst-no" onclick="Assistant.skip(' + i + ')">Ignorer</button><button class="asst-yes" onclick="Assistant.run(' + i + ')">Valider</button></div>')
        + '</div>';
    });
    var pending = _actions.filter(function(o){ return o.state === 'todo'; }).length;
    if (pending > 1) h += '<button class="asst-all" onclick="Assistant.runAll()">Tout valider (' + pending + ')</button>';
    r.innerHTML = h;
  }

  function pick(i, id) { _actions[i].sel = id; renderResult(''); }
  function skip(i) { _actions.splice(i, 1); renderResult(''); }

  // ── Exécution (chaque action = une écriture identique à celle des écrans) ──
  function me() { return (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null; }

  function doRdv(o) {
    var d = o.data, c = currentClient(o), u = me();
    if (!d.date || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return Promise.reject(new Error('Date invalide'));
    var data = {
      clientNom: c ? (c.nom||'') : (d.client||''), clientId: c ? (c.id||'') : '',
      date: d.date, heure: /^\d{2}:\d{2}$/.test(d.heure||'') ? d.heure : '09:00',
      type: RDV_TYPES.indexOf(d.rdv_type) >= 0 ? d.rdv_type : 'Rendez-vous',
      objet: d.objet || '', notes: d.notes || '', lieu: d.lieu || (c && c.ville ? '' : ''),
      owner: u ? u.uid : '', ownerEmail: u ? (u.email||'').toLowerCase() : '',
      secteur: c ? (c.secteur||'') : '',
      createdAt: Date.now(), updatedAt: Date.now()
    };
    return bcol('rendez_vous').doc().set(data);
  }
  function doClient(o) {
    var c = currentClient(o), ch = o.data.champs || {};
    if (!c) return Promise.reject(new Error('Choisissez le client'));
    var changed = false;
    Object.keys(ch).forEach(function(k){
      if (!CHAMPS[k] || ch[k] == null || ch[k] === '') return;
      if (k === 'notes') {
        var stamp = new Date().toLocaleDateString('fr-FR');
        c.notes = (c.notes ? c.notes + '\n' : '') + '[' + stamp + '] ' + ch[k];
      } else { c[k] = String(ch[k]).trim(); }
      changed = true;
    });
    if (!changed) return Promise.reject(new Error('Rien à modifier'));
    return bcol('contacts').doc(c.id).set(c).then(function(){
      try { localStorage.setItem(CDB_CACHE_KEY(), JSON.stringify(cdbContacts)); } catch(e){}
      try { cdbRender(); } catch(e){}
    });
  }
  function doNote(o) {
    var u = me(); if (!u) return Promise.reject(new Error('Non connecté'));
    var date = /^\d{4}-\d{2}-\d{2}$/.test(o.data.date||'') ? o.data.date : ymd(new Date());
    var now = Date.now();
    var c = (typeof cdbContacts !== 'undefined' && cdbContacts) ? cdbContacts.filter(function(x){ return o.data.client && norm(x.nom) === norm(o.data.client); })[0] : null;
    // note libre (section Notes) : privée, rattachable à un client plus tard
    return bcol('carnet').doc().set({ kind: 'note', owner: u.uid, ownerEmail: (u.email||'').toLowerCase(), date: date,
      titre: '', cr: o.data.texte || '', clientNom: c ? c.nom : '', clientId: c ? c.id : '', secteur: c ? (c.secteur||'') : '',
      createdAt: now, updatedAt: now });
  }

  function run(i) {
    var o = _actions[i]; if (!o || o.state !== 'todo') return Promise.resolve();
    if ((o.type === 'modifier_client') && !o.sel) { note('Choisissez d\'abord le client', 'err'); return Promise.resolve(); }
    if (o.type === 'creer_rdv' && o.cands.length && !o.sel) { note('Choisissez le client (ou ignorez)', 'err'); return Promise.resolve(); }
    var p = o.type === 'creer_rdv' ? doRdv(o) : o.type === 'modifier_client' ? doClient(o) : doNote(o);
    return p.then(function(){
      o.state = 'ok'; renderResult('');
      try { if (window.Agenda && o.type==='creer_rdv') { Agenda.load(); } } catch(e){}
    }).catch(function(e){ note('Erreur : ' + (e.code || e.message), 'err'); });
  }
  function runAll() {
    var chain = Promise.resolve();
    _actions.forEach(function(o, i){ if (o.state === 'todo') chain = chain.then(function(){ return run(i); }); });
  }

  // ── Dictée (si le navigateur la propose ; sur iPhone : micro du clavier) ──
  function mic() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { note('Utilisez le micro 🎤 de votre clavier', 'err'); return; }
    var ta = $('asst-input');
    if (_recOn && _rec) { try { _rec.stop(); } catch(e){} return; }
    _rec = new SR(); _rec.lang = 'fr-FR'; _rec.interimResults = false; _rec.continuous = false;
    _rec.onresult = function(ev){ var t = ''; for (var k = ev.resultIndex; k < ev.results.length; k++) t += ev.results[k][0].transcript; ta.value = (ta.value ? ta.value + ' ' : '') + t.trim(); };
    _rec.onend = function(){ _recOn = false; var b = $('asst-mic'); if (b) b.classList.remove('on'); };
    _rec.onerror = function(){ _recOn = false; };
    try { _rec.start(); _recOn = true; var b = $('asst-mic'); if (b) b.classList.add('on'); } catch(e){}
  }

  // ── Interface : bouton flottant + panneau ──
  function open() {
    var p = $('asst-panel'); if (!p) return;
    p.style.display = 'flex';
    setTimeout(function(){ var t = $('asst-input'); if (t) t.focus(); }, 50);
  }
  function close() { var p = $('asst-panel'); if (p) p.style.display = 'none'; }
  function reset() { _actions = []; var t = $('asst-input'); if (t) t.value = ''; var r = $('asst-result'); if (r) r.innerHTML = ''; }

  function build() {
    if ($('asst-fab')) return;
    var css = document.createElement('style');
    css.textContent =
      '#asst-fab{position:fixed;right:22px;bottom:90px;z-index:9990;width:54px;height:54px;border-radius:50%;border:2px solid #FF4D1C;background:#1c1a17;color:#fff;font-size:1.5rem;box-shadow:0 6px 20px rgba(0,0,0,.35);cursor:pointer;display:none}'
      + '@media(max-width:768px){#asst-fab{right:14px;bottom:134px;width:48px;height:48px}}'
      + '#asst-panel{position:fixed;inset:0;z-index:99998;background:rgba(20,18,15,.55);display:none;align-items:flex-end;justify-content:center}'
      + '.asst-box{width:100%;max-width:560px;max-height:88vh;background:#fff;color:#1c1a17;border-radius:18px 18px 0 0;display:flex;flex-direction:column;font-family:inherit}'
      + '@media(min-width:700px){#asst-panel{align-items:center}.asst-box{border-radius:18px}}'
      + '.asst-h{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #eee;font-weight:700}'
      + '.asst-h button{border:0;background:none;font-size:1.3rem;cursor:pointer;color:#666}'
      + '.asst-body{padding:14px 16px;overflow:auto;display:flex;flex-direction:column;gap:10px}'
      + '#asst-input{width:100%;min-height:70px;padding:10px;border:1px solid #ddd;border-radius:10px;font:inherit;resize:vertical;box-sizing:border-box}'
      + '.asst-row{display:flex;gap:8px;align-items:center}'
      + '#asst-send{margin-left:auto;border:0;background:#FF4D1C;color:#fff;border-radius:99px;padding:9px 18px;font-weight:600;cursor:pointer}'
      + '#asst-mic{border:1px solid #ddd;background:#fafafa;border-radius:99px;padding:8px 14px;cursor:pointer}'
      + '#asst-mic.on{background:#FF4D1C;color:#fff;border-color:#FF4D1C}'
      + '.asst-hint{font-size:.72rem;color:#8a857d}'
      + '.asst-card{border:1px solid #e6e2da;border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:6px;background:#faf8f4}'
      + '.asst-card.done{opacity:.6}'
      + '.asst-t{font-weight:700;font-size:.9rem}.asst-l{font-size:.85rem}'
      + '.asst-sel{padding:8px;border:1px solid #ddd;border-radius:8px;font:inherit;max-width:100%}'
      + '.asst-btns{display:flex;gap:8px;justify-content:flex-end;margin-top:4px}'
      + '.asst-yes{border:0;background:#FF4D1C;color:#fff;border-radius:99px;padding:8px 18px;font-weight:600;cursor:pointer}'
      + '.asst-no{border:1px solid #ddd;background:#fff;border-radius:99px;padding:8px 14px;cursor:pointer}'
      + '.asst-all{border:0;background:#1c1a17;color:#fff;border-radius:99px;padding:10px;font-weight:600;cursor:pointer}'
      + '.asst-msg{font-size:.85rem;color:#4a463f}.asst-ok{color:#2a7d3f;font-weight:600;font-size:.85rem}'
      + '.asst-warn{font-size:.8rem;color:#a35a00;background:#fff3df;padding:6px 8px;border-radius:8px}'
      + '.asst-err{font-size:.85rem;color:#b0402f;background:#fdecea;padding:8px;border-radius:8px}';
    document.head.appendChild(css);

    var fab = document.createElement('button');
    fab.id = 'asst-fab'; fab.title = 'Assistant IA'; fab.textContent = '✨';
    fab.onclick = open;
    document.body.appendChild(fab);

    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    var p = document.createElement('div');
    p.id = 'asst-panel';
    p.onclick = function(e){ if (e.target === p) close(); };
    p.innerHTML =
        '<div class="asst-box">'
      +   '<div class="asst-h"><span>✨ Assistant</span><span><button title="Nouvelle demande" onclick="Assistant.reset()">↺</button><button onclick="Assistant.close()">✕</button></span></div>'
      +   '<div class="asst-body">'
      +     '<textarea id="asst-input" placeholder="Ex. : « RDV chez Bio Sud jeudi à 14h pour la mise en place des nouveautés » ou « Le téléphone de Dupont est 06 12 34 56 78 »"></textarea>'
      +     '<div class="asst-row">' + (SR ? '<button id="asst-mic" onclick="Assistant.mic()">🎤</button>' : '') + '<span class="asst-hint">' + (SR ? '' : 'Dictée : micro 🎤 du clavier iPhone') + '</span><button id="asst-send" onclick="Assistant.send()">Envoyer</button></div>'
      +     '<div id="asst-result"></div>'
      +     '<div class="asst-hint">Rien n\'est enregistré sans votre validation.</div>'
      +   '</div>'
      + '</div>';
    document.body.appendChild(p);

    // visible seulement une fois connecté
    setInterval(function(){ fab.style.display = me() ? 'block' : 'none'; }, 1500);
  }

  window.Assistant = { open: open, close: close, send: send, pick: pick, skip: skip, run: run, runAll: runAll, mic: mic, reset: reset };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
