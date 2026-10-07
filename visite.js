/* ═══════════════════════════════════════════════════════════════════════
   VISITE — compte-rendu de rendez-vous (notes, dictée, enregistrement
   audio + transcription et résumé par l'IA). Branché dans la fenêtre du
   rendez-vous de l'Agenda (#vis-box). Données stockées dans le document
   du RDV : cr (notes), transcription, resume, crUpdatedAt.
   L'audio n'est PAS conservé : seule la transcription est enregistrée.
   Transcription audio : nécessite le fournisseur Gemini.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  var MAX_SEC = 40 * 60;                 // 40 min max (reste sous la limite d'envoi)
  var _r = null;                         // RDV courant
  var _stream = null, _mr = null, _chunks = [], _blob = null, _mime = '';
  var _timer = null, _t0 = 0, _wake = null, _sr = null, _srOn = false;
  var _busy = false;

  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function pad(n){ return (n<10?'0':'')+n; }
  function $(id){ return document.getElementById(id); }
  function note(m,t){ try { toast(m,t||'ok'); } catch(e){ console.log(m); } }
  function css() {
    if ($('vis-css')) return;
    var s = document.createElement('style'); s.id = 'vis-css';
    s.textContent =
      '.vis-wrap{border:1px solid #e6e2da;border-radius:12px;padding:12px;background:#faf8f4;display:flex;flex-direction:column;gap:8px}'
      + '.vis-h{font-weight:700;font-size:.88rem}'
      + '.vis-ta{width:100%;min-height:90px;box-sizing:border-box;padding:8px;border:1px solid #ddd;border-radius:8px;font:inherit}'
      + '.vis-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}'
      + '.vis-b{border:1px solid #ddd;background:#fff;border-radius:99px;padding:7px 12px;font:600 .8rem inherit;cursor:pointer}'
      + '.vis-b.p{background:#FF4D1C;border-color:#FF4D1C;color:#fff}'
      + '.vis-b.rec{background:#c62828;border-color:#c62828;color:#fff}'
      + '.vis-b:disabled{opacity:.5;cursor:not-allowed}'
      + '.vis-small{font-size:.74rem;color:#8a857d}'
      + '.vis-res{background:#fff;border:1px solid #eadfce;border-radius:8px;padding:8px;font-size:.84rem;white-space:pre-wrap}'
      + '.vis-det summary{cursor:pointer;font-size:.8rem;font-weight:600}'
      + '.vis-det div{font-size:.8rem;white-space:pre-wrap;max-height:220px;overflow:auto;margin-top:6px}';
    document.head.appendChild(s);
  }

  // ── Affichage ──
  function bind(r) {
    css(); stopAll(true);
    _r = r || null; _blob = null; _chunks = [];
    render();
  }
  function render() {
    var box = $('vis-box'); if (!box) return;
    if (!_r) { box.innerHTML = '<div class="vis-small">💡 Enregistrez d\'abord le rendez-vous : vous pourrez ensuite y ajouter un compte-rendu, dicter ou enregistrer la conversation.</div>'; return; }
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    var canRec = !!(navigator.mediaDevices && window.MediaRecorder);
    box.innerHTML =
      '<div class="vis-wrap">'
      + '<div class="vis-h">📝 Compte-rendu de visite</div>'
      + '<textarea id="vis-cr" class="vis-ta" placeholder="Notes de la visite… (sur iPhone : micro 🎤 du clavier)">' + esc(_r.cr||'') + '</textarea>'
      + '<div class="vis-row">'
      +   (SR ? '<button class="vis-b" id="vis-dic" onclick="Visite.dicter()">🎤 Dicter</button>' : '')
      +   '<button class="vis-b p" onclick="Visite.save()">💾 Enregistrer le compte-rendu</button>'
      + '</div>'
      + (canRec
        ? '<div class="vis-row" style="margin-top:4px">'
        +   '<label class="vis-small"><input type="checkbox" id="vis-consent"> J\'ai informé mon interlocuteur de l\'enregistrement</label></div>'
        + '<div class="vis-row"><button class="vis-b" id="vis-rec" onclick="Visite.toggleRec()">⏺ Enregistrer la conversation</button>'
        +   '<span id="vis-time" class="vis-small"></span></div>'
        + '<div id="vis-audio"></div>'
        : '<div class="vis-small">Enregistrement audio indisponible sur ce navigateur.</div>')
      + '<div id="vis-out">' + outHtml() + '</div>'
      + '</div>';
  }
  function outHtml() {
    var h = '';
    if (_r && _r.resume) h += '<div class="vis-h">✨ Résumé</div><div class="vis-res">' + esc(_r.resume) + '</div>';
    if (_r && _r.transcription) h += '<details class="vis-det"><summary>Transcription complète</summary><div>' + esc(_r.transcription) + '</div></details>';
    if (_r && (_r.resume || _r.transcription)) h += '<div class="vis-row"><button class="vis-b" onclick="Visite.toCarnet()">📓 Ajouter le résumé au Carnet</button></div>';
    return h;
  }

  // ── Dictée (Web Speech, si disponible) ──
  function dicter() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) return;
    var ta = $('vis-cr'), b = $('vis-dic');
    if (_srOn && _sr) { try { _sr.stop(); } catch(e){} return; }
    _sr = new SR(); _sr.lang = 'fr-FR'; _sr.interimResults = false; _sr.continuous = true;
    _sr.onresult = function(ev){ var t=''; for (var k=ev.resultIndex;k<ev.results.length;k++) if (ev.results[k].isFinal) t += ev.results[k][0].transcript + ' ';
      if (t) ta.value = (ta.value ? ta.value + ' ' : '') + t.trim(); };
    _sr.onend = function(){ _srOn = false; if (b) { b.classList.remove('rec'); b.textContent = '🎤 Dicter'; } };
    _sr.onerror = function(){ _srOn = false; };
    try { _sr.start(); _srOn = true; b.classList.add('rec'); b.textContent = '⏹ Stop'; } catch(e){}
  }

  // ── Enregistrement audio ──
  function pickMime() {
    var c = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
    for (var i = 0; i < c.length; i++) { try { if (MediaRecorder.isTypeSupported(c[i])) return c[i]; } catch(e){} }
    return '';
  }
  function toggleRec() {
    if (_mr && _mr.state === 'recording') { _mr.stop(); return; }
    if (!$('vis-consent') || !$('vis-consent').checked) { note('Cochez d\'abord : interlocuteur informé de l\'enregistrement', 'err'); return; }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream){
      _stream = stream; _chunks = []; _blob = null; _mime = pickMime();
      var opt = { audioBitsPerSecond: 32000 }; if (_mime) opt.mimeType = _mime;
      try { _mr = new MediaRecorder(stream, opt); } catch(e){ _mr = new MediaRecorder(stream); }
      _mr.ondataavailable = function(ev){ if (ev.data && ev.data.size) _chunks.push(ev.data); };
      _mr.onstop = onStop;
      _mr.start(1000);
      _t0 = Date.now();
      var b = $('vis-rec'); b.classList.add('rec'); b.textContent = '⏹ Arrêter';
      $('vis-audio').innerHTML = '';
      _timer = setInterval(tick, 500);
      try { if (navigator.wakeLock) navigator.wakeLock.request('screen').then(function(w){ _wake = w; }).catch(function(){}); } catch(e){}
    }).catch(function(){ note('Micro refusé ou indisponible', 'err'); });
  }
  function tick() {
    var s = Math.floor((Date.now() - _t0) / 1000);
    var el = $('vis-time'); if (el) el.textContent = '● ' + pad(Math.floor(s/60)) + ':' + pad(s%60) + ' (écran à garder allumé)';
    if (s >= MAX_SEC && _mr && _mr.state === 'recording') _mr.stop();
  }
  function onStop() {
    clearInterval(_timer); _timer = null;
    try { _stream.getTracks().forEach(function(t){ t.stop(); }); } catch(e){}
    try { if (_wake) { _wake.release(); _wake = null; } } catch(e){}
    var b = $('vis-rec'); if (b) { b.classList.remove('rec'); b.textContent = '⏺ Enregistrer la conversation'; }
    var el = $('vis-time'); if (el) el.textContent = '';
    _blob = new Blob(_chunks, { type: (_mr && _mr.mimeType) || _mime || 'audio/mp4' });
    var box = $('vis-audio'); if (!box) return;
    var url = URL.createObjectURL(_blob);
    var mb = (_blob.size / 1048576).toFixed(1);
    var ext = /mp4|m4a|aac/.test(_blob.type) ? 'm4a' : 'webm';
    box.innerHTML = '<audio controls src="' + url + '" style="width:100%"></audio>'
      + '<div class="vis-row"><button class="vis-b p" id="vis-tr" onclick="Visite.transcribe()">✨ Transcrire et résumer</button>'
      + '<a class="vis-b" download="visite-' + (_r && _r.date || '') + '.' + ext + '" href="' + url + '">⬇ Audio (' + mb + ' Mo)</a></div>'
      + '<div class="vis-small">L\'audio n\'est pas conservé dans le CRM : transcrivez avant de fermer cette fenêtre (ou gardez le fichier).</div>';
  }
  function stopAll(silent) {
    try { if (_mr && _mr.state === 'recording') { _mr.onstop = null; _mr.stop(); } } catch(e){}
    try { if (_stream) _stream.getTracks().forEach(function(t){ t.stop(); }); } catch(e){}
    try { if (_sr && _srOn) _sr.stop(); } catch(e){}
    try { if (_wake) { _wake.release(); _wake = null; } } catch(e){}
    clearInterval(_timer); _timer = null; _mr = null; _stream = null;
  }

  // ── Transcription (Gemini accepte l'audio directement) ──
  function b64(blob) {
    return new Promise(function(res, rej){
      var fr = new FileReader();
      fr.onload = function(){ res(String(fr.result).split(',')[1]); };
      fr.onerror = function(){ rej(new Error('Lecture audio impossible')); };
      fr.readAsDataURL(blob);
    });
  }
  function geminiAudio(base64, mime) {
    var key = mlAiGetKey();
    var sys = 'Tu retranscris un rendez-vous commercial B2B (produits bio) en français. '
      + 'Tu produis : 1) "transcription" : texte fidèle, avec « Commercial : » et « Client : » si les voix se distinguent ; '
      + '2) "resume" : points clés en puces courtes (besoins, objections, décisions, chiffres/quantités cités) ; '
      + '3) "actions" : liste des actions à faire / relances, une par ligne. N\'invente rien. Si l\'audio est inaudible, dis-le dans "resume".';
    var schema = { type: 'OBJECT', properties: { transcription: { type: 'STRING' }, resume: { type: 'STRING' }, actions: { type: 'STRING' } }, required: ['transcription', 'resume'] };
    var doCall = function(model){
      var body = {
        systemInstruction: { parts: [{ text: sys }] },
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType: mime, data: base64 } }, { text: 'Transcris et résume ce rendez-vous.' }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 32768, responseMimeType: 'application/json', responseSchema: schema, thinkingConfig: { thinkingBudget: 0 } }
      };
      return fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body)
      }).then(function(r){
        if (!r.ok) return r.json().catch(function(){ return {}; }).then(function(j){
          var e = new Error((j && j.error && j.error.message) || ('Erreur HTTP ' + r.status)); e.status = r.status; throw e; });
        return r.json();
      }).then(function(d){
        var c = d && d.candidates && d.candidates[0];
        var t = c && c.content && c.content.parts ? c.content.parts.map(function(p){ return p.text || ''; }).join('') : '';
        if (!t) throw new Error('Réponse vide de Gemini — réessayez.');
        return t;
      });
    };
    return mlAiRunGemini(key, doCall);
  }
  function transcribe() {
    if (_busy || !_blob) return;
    if (typeof mlAiGetProvider !== 'function' || mlAiGetProvider() !== 'gemini') { note('La transcription audio demande le fournisseur Gemini (section Assistant IA).', 'err'); return; }
    if (!mlAiGetKey()) { note('Aucune clé IA configurée (section Assistant IA).', 'err'); return; }
    _busy = true;
    var btn = $('vis-tr'); if (btn) { btn.disabled = true; btn.textContent = 'Transcription en cours…'; }
    var mime = String(_blob.type || 'audio/mp4').split(';')[0];
    b64(_blob).then(function(data){ return geminiAudio(data, mime); }).then(function(txt){
      var j = null;
      try { j = JSON.parse(txt); } catch(e){}
      var transcription = j ? (j.transcription || '') : txt;
      var resume = j ? (j.resume || '') : '';
      if (j && j.actions) resume += (resume ? '\n\n' : '') + 'À faire :\n' + j.actions;
      _r.transcription = transcription; _r.resume = resume;
      return persist({ transcription: transcription, resume: resume }).then(function(){
        var out = $('vis-out'); if (out) out.innerHTML = outHtml();
        note('✅ Transcription enregistrée', 'ok');
      });
    }).catch(function(e){ note('Erreur : ' + (e.message || e), 'err'); })
      .then(function(){ _busy = false; if (btn) { btn.disabled = false; btn.textContent = '✨ Transcrire et résumer'; } });
  }

  // ── Sauvegarde ──
  function persist(fields) {
    if (!_r || !_r.id) return Promise.reject(new Error('RDV non enregistré'));
    fields.crUpdatedAt = Date.now();
    return bcol('rendez_vous').doc(_r.id).set(fields, { merge: true });
  }
  function save() {
    var ta = $('vis-cr'); if (!ta || !_r) return;
    _r.cr = ta.value;
    persist({ cr: ta.value }).then(function(){ note('✅ Compte-rendu enregistré', 'ok'); })
      .catch(function(e){ note('Erreur : ' + (e.code || e.message), 'err'); });
  }
  function toCarnet() {
    var u = (typeof currentUser !== 'undefined') ? currentUser : null;
    if (!u || !_r) return;
    var ref = bcol('carnet').doc(u.uid + '_' + _r.date);
    var titre = 'Visite ' + (_r.clientNom || '') + (_r.heure ? ' (' + _r.heure + ')' : '');
    var corps = _r.resume || _r.cr || '';
    // Lecture d'un jour sans note : refusée par les règles (doc inexistant) → on considère « vide »
    ref.get().catch(function(){ return { exists: false }; }).then(function(s){
      var old = s.exists ? (s.data().texte || '') : '';
      return ref.set({ date: _r.date, texte: (old ? old + '\n\n' : '') + titre + ' —\n' + corps,
        owner: u.uid, ownerEmail: (u.email || '').toLowerCase(), updatedAt: Date.now() }, { merge: true });
    }).then(function(){ note('📓 Ajouté au Carnet du ' + _r.date, 'ok'); })
      .catch(function(e){ note('Erreur : ' + (e.code || e.message), 'err'); });
  }

  window.Visite = { bind: bind, dicter: dicter, toggleRec: toggleRec, transcribe: transcribe, save: save, toCarnet: toCarnet, stop: stopAll };
})();
