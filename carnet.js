/* ═══════════════════════════════════════════════════════════════════════
   CARNET — bloc-notes libre classé par jour, dictée vocale + résumé IA
   Dictée : micro du clavier iOS (natif) sur iPhone ; bouton micro (Web Speech)
   en bonus sur ordinateur/Android. Résumé des points clés via mlAiCall().
   Stockage : bcol('carnet'), un document par (utilisateur, jour). Personnel.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  var _date = todayStr();
  var _doc = { date: _date, texte: '', resume: '' };
  var _rec = null, _recOn = false;

  function pad(n){ return (n<10?'0':'')+n; }
  function todayStr(){ var d=new Date(); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
  function fromYmd(s){ return new Date(s+'T00:00:00'); }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function col(){ return bcol('carnet'); }
  function docId(date){ return (currentUser ? currentUser.uid : 'anon') + '_' + date; }

  function mount(){ loadDay(_date); }

  function loadDay(date){
    _date = date;
    col().doc(docId(date)).get().then(function(s){
      _doc = s.exists ? s.data() : { date: date, texte: '', resume: '' };
      render();
    }).catch(function(e){ _doc = { date: date, texte: '', resume: '' }; render(); console.warn('[Carnet]', e && e.code); });
  }

  function render(){
    var host = document.getElementById('carnet-host'); if (!host) return;
    var d = fromYmd(_date);
    var dstr = d.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    var micBtn = SR ? '<button class="cn-btn" id="carnet-mic" onclick="Carnet.mic()">🎤 Dicter</button>' : '';
    var resumeHtml = (_doc && _doc.resume)
      ? '<div class="cn-resume"><div class="cn-resume-h">✨ Points clés</div><div class="cn-resume-b">' + esc(_doc.resume).replace(/\n/g,'<br>') + '</div></div>'
      : '';
    host.innerHTML =
        '<div class="cn-head"><div><div class="cn-title">Carnet de notes</div>'
      +   '<div class="cn-sub">Vos notes de terrain, classées par jour</div></div></div>'
      + '<div class="cn-datebar">'
      +   '<button class="ag-nav" onclick="Carnet.move(-1)">‹</button>'
      +   '<input type="date" id="carnet-date" value="' + _date + '" onchange="Carnet.goDate(this.value)">'
      +   '<button class="ag-nav" onclick="Carnet.move(1)">›</button>'
      +   '<button class="ag-nav ag-todaybtn" onclick="Carnet.goToday()">Aujourd\'hui</button>'
      +   '<div class="cn-day">' + dstr + '</div>'
      + '</div>'
      + '<div class="cn-editor">'
      +   '<textarea id="carnet-ta" placeholder="Écrivez ou dictez vos notes…&#10;Sur iPhone : appuyez sur le micro 🎤 de votre clavier.">' + esc((_doc && _doc.texte) || '') + '</textarea>'
      +   '<div class="cn-actions">' + micBtn
      +     '<button class="cn-btn" onclick="Carnet.save()">💾 Enregistrer</button>'
      +     '<button class="cn-primary" id="carnet-sum" onclick="Carnet.summarize()">✨ Résumer avec l\'IA</button>'
      +   '</div>'
      + '</div>'
      + resumeHtml;
  }

  function save(silent){
    var ta = document.getElementById('carnet-ta'); if (!ta) return;
    var data = {
      date: _date, texte: ta.value, resume: (_doc && _doc.resume) || '',
      owner: currentUser ? currentUser.uid : '',
      ownerEmail: currentUser ? (currentUser.email||'').toLowerCase() : '',
      updatedAt: Date.now()
    };
    _doc = data;
    col().doc(docId(_date)).set(data, { merge:true })
      .then(function(){ if (!silent) toast('✅ Note enregistrée', 'ok'); })
      .catch(function(e){ toast('Erreur : ' + (e.code||e.message), 'err'); });
  }

  function summarize(){
    var ta = document.getElementById('carnet-ta');
    if (!ta || !ta.value.trim()) { toast('Écrivez ou dictez une note d\'abord', 'err'); return; }
    if (typeof mlAiCall !== 'function') { toast('IA indisponible', 'err'); return; }
    if (typeof mlAiGetKey === 'function' && !mlAiGetKey()) { toast('Configurez l\'IA dans la section « Assistant IA » d\'abord', 'err'); return; }
    var btn = document.getElementById('carnet-sum');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Résumé en cours…'; }
    save(true);
    var sys = 'Tu es un assistant commercial de terrain. À partir des notes brutes (souvent dictées) ci-dessous, produis un résumé en FRANÇAIS sous forme de puces courtes et actionnables. Fais ressortir : les décisions prises, les actions à faire (avec échéance si mentionnée), et les informations importantes sur les clients. Sois concis, n\'invente rien.';
    mlAiCall(sys, ta.value).then(function(txt){
      _doc.resume = txt || '';
      save(true);
      render();
      toast('✅ Résumé généré', 'ok');
    }).catch(function(e){
      toast('Erreur IA : ' + (e.message || e), 'err');
      if (btn) { btn.disabled = false; btn.textContent = '✨ Résumer avec l\'IA'; }
    });
  }

  function mic(){
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('Sur iPhone, utilisez le micro 🎤 de votre clavier', 'ok'); return; }
    var btn = document.getElementById('carnet-mic');
    if (_recOn && _rec) { try { _rec.stop(); } catch(e){} return; }
    _rec = new SR(); _rec.lang = 'fr-FR'; _rec.continuous = true; _rec.interimResults = false;
    _rec.onstart = function(){ _recOn = true; if (btn) { btn.textContent = '⏹ Arrêter'; btn.classList.add('cn-rec'); } };
    _rec.onend   = function(){ _recOn = false; if (btn) { btn.textContent = '🎤 Dicter'; btn.classList.remove('cn-rec'); } };
    _rec.onerror = function(e){ _recOn = false; if (btn) { btn.textContent = '🎤 Dicter'; btn.classList.remove('cn-rec'); } toast('Micro : ' + (e.error||'erreur'), 'err'); };
    _rec.onresult = function(e){
      var ta = document.getElementById('carnet-ta'); if (!ta) return;
      var txt = '';
      for (var i = e.resultIndex; i < e.results.length; i++) { txt += e.results[i][0].transcript; }
      if (txt) ta.value += (ta.value && !/\s$/.test(ta.value) ? ' ' : '') + txt;
    };
    try { _rec.start(); } catch(e){ toast('Micro indisponible', 'err'); }
  }

  function move(n){ var d = fromYmd(_date); d.setDate(d.getDate()+n); loadDay(d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())); }
  function goDate(v){ if (v) loadDay(v); }
  function goToday(){ loadDay(todayStr()); }

  window.Carnet = { mount: mount, save: save, summarize: summarize, mic: mic, move: move, goDate: goDate, goToday: goToday };
})();
