/* ═══════════════════════════════════════════════════════════════════════
   MAIL — messagerie Outlook / Microsoft 365 intégrée au CRM
   Connexion Microsoft (MSAL.js, flux navigateur sans serveur) + Microsoft Graph.
   • Écrire et envoyer un e-mail depuis la fiche client (envoi depuis TA boîte,
     visible dans « Éléments envoyés »), avec rédaction par l'IA.
   • Historique des échanges avec ce client (reçus + envoyés), résumé IA.
   • Option : tracer l'envoi dans les notes de la fiche client.
   Réglages (par appareil) : ID d'application Azure + type de compte.
   Droits demandés : User.Read, Mail.Send, Mail.Read (déléguées, ta boîte seule).
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  var MSAL_URL = 'https://cdn.jsdelivr.net/npm/@azure/msal-browser@2.38.3/lib/msal-browser.min.js';
  var GRAPH = 'https://graph.microsoft.com/v1.0';
  var SCOPES = ['User.Read', 'Mail.Send', 'Mail.Read'];
  var CFG_KEY = 'cohor_ms_cfg_v1', SIG_KEY = 'cohor_ms_sig_v1';

  var _app = null, _c = null, _tab = 'ecrire', _hist = [];

  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function pad(n){ return (n<10?'0':'')+n; }
  function $(id){ return document.getElementById(id); }
  function note(m,t){ try { toast(m,t||'ok'); } catch(e){ console.log(m); } }
  function ymd(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
  function dtFr(iso){ if(!iso) return ''; var d=new Date(iso); return d.toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric'})+' '+pad(d.getHours())+':'+pad(d.getMinutes()); }

  // ── Réglages ──
  function cfg(){ try { return JSON.parse(localStorage.getItem(CFG_KEY) || '{}') || {}; } catch(e){ return {}; } }
  function saveCfg(c){ try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch(e){} }
  function redirectUri(){ return location.origin + location.pathname; }
  function signature(){ try { return localStorage.getItem(SIG_KEY) || ''; } catch(e){ return ''; } }

  // ── MSAL ──
  function loadMsal() {
    return new Promise(function(res, rej){
      if (window.msal) return res();
      if (typeof lazyLoad !== 'function') return rej(new Error('Chargeur indisponible'));
      lazyLoad(MSAL_URL, function(){ window.msal ? res() : rej(new Error('Bibliothèque Microsoft indisponible')); }, function(){ rej(new Error('Bibliothèque Microsoft indisponible (réseau ?)')); });
    });
  }
  function getApp() {
    var c = cfg();
    if (!c.clientId) return Promise.reject(new Error('no-config'));
    return loadMsal().then(function(){
      if (_app && _app._cohorId === c.clientId && _app._cohorAuth === c.authority) return _app;
      _app = new msal.PublicClientApplication({
        auth: { clientId: c.clientId, authority: 'https://login.microsoftonline.com/' + (c.authority || 'organizations'), redirectUri: redirectUri() },
        cache: { cacheLocation: 'localStorage' }
      });
      _app._cohorId = c.clientId; _app._cohorAuth = c.authority;
      return (_app.initialize ? _app.initialize() : Promise.resolve()).then(function(){ return _app.handleRedirectPromise(); }).then(function(){ return _app; });
    });
  }
  function account(app){ var a = app.getAllAccounts(); return a.length ? a[0] : null; }
  function msErr(e) {
    var m = (e && (e.errorMessage || e.message)) || String(e);
    if (/AADSTS65001|consent|AADSTS90094|AADSTS650/.test(m)) return 'Autorisation refusée : votre organisation doit autoriser l\'application (demandez à votre administrateur Microsoft 365).';
    if (/AADSTS50011|redirect/i.test(m)) return 'URI de redirection non enregistrée dans Azure (voir Réglages).';
    if (/AADSTS700016|application.*not found/i.test(m)) return 'ID d\'application inconnu : vérifiez-le dans Réglages.';
    return m;
  }
  function signIn() {
    return getApp().then(function(app){
      return app.loginPopup({ scopes: SCOPES, prompt: 'select_account' }).catch(function(e){
        if (e && /popup|empty_window|window/i.test(e.errorCode || e.message || '')) { sessionStorage.setItem('ml_redirect', '1'); return app.loginRedirect({ scopes: SCOPES }); }
        throw e;
      });
    });
  }
  function token() {
    return getApp().then(function(app){
      var acc = account(app);
      if (!acc) return signIn().then(function(){ return token(); });
      return app.acquireTokenSilent({ scopes: SCOPES, account: acc }).catch(function(e){
        return app.acquireTokenPopup({ scopes: SCOPES, account: acc }).catch(function(e2){
          if (e2 && /popup|empty_window|window/i.test(e2.errorCode || e2.message || '')) return app.acquireTokenRedirect({ scopes: SCOPES, account: acc });
          throw e2;
        });
      });
    }).then(function(r){ return r && r.accessToken; });
  }
  function graph(path, opts) {
    return token().then(function(t){
      if (!t) throw new Error('Connexion en cours…');
      opts = opts || {};
      var h = Object.assign({ Authorization: 'Bearer ' + t }, opts.headers || {});
      if (opts.body) h['Content-Type'] = 'application/json';
      return fetch(GRAPH + path, { method: opts.method || 'GET', headers: h, body: opts.body ? JSON.stringify(opts.body) : undefined });
    }).then(function(r){
      if (r.status === 202 || r.status === 204) return {};
      return r.json().catch(function(){ return {}; }).then(function(j){
        if (!r.ok) { var e = new Error((j.error && j.error.message) || ('Erreur ' + r.status)); e.status = r.status; throw e; }
        return j;
      });
    });
  }

  // ── Conversion texte ⇄ HTML ──
  function htmlToText(h) {
    return String(h || '').replace(/<\/p>\s*<p[^>]*>/gi, '\n\n').replace(/<br\s*\/?>/gi, '\n').replace(/<\/li>/gi, '\n').replace(/<li[^>]*>/gi, '• ')
      .replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/\n{3,}/g, '\n\n').trim();
  }
  function textToHtml(t) {
    return '<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt">' + esc(t).replace(/\n/g, '<br>') + '</div>';
  }
  function parseJson(txt) {
    var s = String(txt || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try { return JSON.parse(s); } catch(e){}
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch(e){} }
    return null;
  }
  function parseAddrs(v) {
    return String(v || '').split(/[;,\s]+/).map(function(x){ return x.trim(); }).filter(function(x){ return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x); });
  }

  // ── Envoi ──
  function send() {
    var to = parseAddrs($('ml-to').value), cc = parseAddrs($('ml-cc').value);
    var sujet = $('ml-sujet').value.trim(), corps = $('ml-corps').value.trim();
    if (!to.length) { note('Indiquez un destinataire valide', 'err'); return; }
    if (!sujet) { note('Indiquez un objet', 'err'); return; }
    if (!corps) { note('Le message est vide', 'err'); return; }
    var sig = signature();
    var html = textToHtml(corps) + (sig ? '<br><br>' + textToHtml(sig) : '');
    var btn = $('ml-send'); btn.disabled = true; btn.textContent = 'Envoi…';
    graph('/me/sendMail', { method: 'POST', body: { message: {
      subject: sujet, body: { contentType: 'HTML', content: html },
      toRecipients: to.map(function(a){ return { emailAddress: { address: a } }; }),
      ccRecipients: cc.map(function(a){ return { emailAddress: { address: a } }; })
    }, saveToSentItems: true } }).then(function(){
      note('✅ E-mail envoyé à ' + to.join(', '), 'ok');
      var tr = $('ml-trace');
      if (tr && tr.checked && _c) return traceInNotes(sujet);
    }).then(function(){ close(); })
      .catch(function(e){ note('Erreur : ' + msErr(e), 'err'); btn.disabled = false; btn.textContent = '📨 Envoyer'; });
  }
  function traceInNotes(sujet) {
    var c = _c; if (!c || !c.id) return Promise.resolve();
    var d = new Date().toLocaleDateString('fr-FR');
    c.notes = (c.notes ? c.notes + '\n' : '') + '[' + d + '] E-mail envoyé : ' + sujet;
    return bcol('contacts').doc(c.id).set({ notes: c.notes }, { merge: true }).then(function(){
      try { localStorage.setItem(CDB_CACHE_KEY(), JSON.stringify(cdbContacts)); } catch(e){}
      try { cdbRender(); } catch(e){}
    }).catch(function(){});
  }

  // ── Rédaction IA ──
  function ia() {
    if (typeof mlAiCall !== 'function') { note('IA indisponible', 'err'); return; }
    var consigne = ($('ml-consigne').value || '').trim() || 'Relance commerciale courtoise après notre dernier échange';
    var btn = $('ml-iabtn'); btn.disabled = true; btn.textContent = '…';
    var c = _c || {}, last = (c.analyses && c.analyses.length) ? c.analyses[c.analyses.length - 1] : null;
    var ctx = 'Client : ' + (c.nom || '') + (c.ville ? ' (' + c.ville + ')' : '') + '.'
      + (last ? ' Dernier point : ' + last.n + ' commandes, panier moyen ' + last.panier + ' €' + (last.tendance != null ? ', tendance paniers ' + last.tendance + ' %' : '') + (last.last ? ', dernière commande le ' + last.last : '') + '.' : '');
    var sys = (typeof ML_AI_SYS !== 'undefined' ? ML_AI_SYS : 'Tu rédiges des e-mails commerciaux B2B en français. Réponds UNIQUEMENT par un JSON {"subject":"...","body_html":"..."}.')
      + ' ' + (typeof mlAiBrandCtx === 'function' ? mlAiBrandCtx() : '') + ' Le texte commence par une formule d\'appel et se termine sans signature (elle est ajoutée automatiquement).';
    mlAiCall(sys, 'Consigne : ' + consigne + '\n' + ctx).then(function(txt){
      var j = parseJson(txt);
      if (!j || !j.body_html) throw new Error('Réponse IA illisible, reformulez.');
      if (j.subject && !$('ml-sujet').value.trim()) $('ml-sujet').value = j.subject;
      $('ml-corps').value = htmlToText(j.body_html);
    }).catch(function(e){ note(e && e.message === 'no-key' ? 'Aucune clé IA configurée' : 'Erreur IA : ' + (e.message || e), 'err'); })
      .then(function(){ btn.disabled = false; btn.textContent = '✨ Rédiger'; });
  }

  // ── Historique des échanges ──
  function loadHist() {
    var box = $('ml-histbox'); if (!box) return;
    var addr = _c && _c.email ? parseAddrs(_c.email)[0] : '';
    if (!addr) { box.innerHTML = '<div class="ml-mut">Aucune adresse e-mail valide sur la fiche de ce client.</div>'; return; }
    box.innerHTML = '<div class="ml-mut">Recherche dans votre boîte…</div>';
    graph('/me/messages?$search="participants:' + addr + '"&$top=25&$select=subject,from,toRecipients,receivedDateTime,sentDateTime,bodyPreview,isDraft').then(function(r){
      _hist = (r.value || []).filter(function(m){ return !m.isDraft; })
        .sort(function(a, b){ return (b.receivedDateTime || b.sentDateTime) < (a.receivedDateTime || a.sentDateTime) ? -1 : 1; });
      renderHist();
    }).catch(function(e){ box.innerHTML = '<div class="ml-err">' + esc(msErr(e)) + '</div>'; });
  }
  function renderHist() {
    var box = $('ml-histbox'); if (!box) return;
    if (!_hist.length) { box.innerHTML = '<div class="ml-mut">Aucun échange trouvé avec cette adresse.</div>'; return; }
    var me = ((account2() || {}).username || '').toLowerCase();
    box.innerHTML = '<div class="ml-act"><button class="ml-b" onclick="Mail.resume()">✨ Résumer les échanges</button></div><div id="ml-res"></div>'
      + _hist.map(function(m, i){
        var from = (m.from && m.from.emailAddress && m.from.emailAddress.address || '').toLowerCase();
        var sortant = me && from === me;
        return '<div class="ml-msg" onclick="Mail.toggle(' + i + ')"><div class="ml-row"><b>' + (sortant ? '↗ Envoyé' : '↙ Reçu') + ' · ' + esc(m.subject || '(sans objet)') + '</b><span class="ml-mut">' + dtFr(m.receivedDateTime || m.sentDateTime) + '</span></div>'
          + '<div class="ml-prev" id="ml-p' + i + '" style="display:none">' + esc(m.bodyPreview || '') + '</div></div>';
      }).join('');
  }
  function account2() { try { return _app ? account(_app) : null; } catch(e){ return null; } }
  function toggle(i) { var el = $('ml-p' + i); if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none'; }
  function resume() {
    if (typeof mlAiCall !== 'function' || !_hist.length) return;
    var el = $('ml-res'); el.innerHTML = '<div class="ml-mut">Résumé en cours…</div>';
    var txt = _hist.slice(0, 12).reverse().map(function(m){ return '[' + (m.receivedDateTime || m.sentDateTime || '').slice(0, 10) + '] ' + (m.subject || '') + ' — ' + (m.bodyPreview || '').slice(0, 300); }).join('\n');
    mlAiCall('Tu résumes pour un commercial terrain les derniers échanges e-mail avec un client (B2B bio). En français : 1) l\'état de la relation en 2 phrases, 2) les points ouverts ou engagements, 3) la prochaine action conseillée. Ne rien inventer. Réponds UNIQUEMENT par un JSON {"resume":"..."}.', txt).then(function(r){
      var j = parseJson(r); el.innerHTML = '<div class="ml-sum">' + esc((j && j.resume) || r) + '</div>';
    }).catch(function(e){ el.innerHTML = '<div class="ml-err">' + esc(e.message || e) + '</div>'; });
  }

  // ── Réglages (UI) ──
  function saveSettings() {
    var id = ($('ml-cid').value || '').trim(), au = ($('ml-auth').value || '').trim() || 'organizations';
    if (!/^[0-9a-f-]{36}$/i.test(id)) { note('ID d\'application invalide (format 8-4-4-4-12)', 'err'); return; }
    saveCfg({ clientId: id, authority: au });
    try { localStorage.setItem(SIG_KEY, $('ml-sig').value); } catch(e){}
    _app = null; note('Réglages enregistrés', 'ok');
    var sg = $('ml-sig'); show('ecrire');
  }
  function connect() {
    var id = ($('ml-cid').value || '').trim(), au = ($('ml-auth').value || '').trim() || 'organizations';
    if (!/^[0-9a-f-]{36}$/i.test(id)) { note('ID d\'application invalide', 'err'); return; }
    saveCfg({ clientId: id, authority: au }); _app = null;
    var st = $('ml-cstate'); st.textContent = 'Connexion…';
    signIn().then(function(r){ st.textContent = '✅ Connecté : ' + ((r && r.account && r.account.username) || ''); })
      .catch(function(e){ st.textContent = '❌ ' + msErr(e); });
  }
  function disconnect() {
    getApp().then(function(app){ var a = account(app); return a ? app.logoutPopup({ account: a }) : null; }).then(function(){ _app = null; note('Déconnecté', 'ok'); show('reglages'); }).catch(function(e){ note(msErr(e), 'err'); });
  }
  function copyUri() { try { navigator.clipboard.writeText(redirectUri()).then(function(){ note('Adresse copiée', 'ok'); }); } catch(e){} }

  // ── Fenêtre ──
  function css() {
    if ($('ml-css')) return;
    var s = document.createElement('style'); s.id = 'ml-css';
    s.textContent =
      '#ml-ov{position:fixed;inset:0;z-index:99996;background:rgba(20,18,15,.55);display:flex;align-items:flex-end;justify-content:center}'
      + '@media(min-width:700px){#ml-ov{align-items:center}}'
      + '.ml-box{background:#fff;color:#1c1a17;width:100%;max-width:620px;max-height:93vh;overflow:auto;border-radius:18px 18px 0 0}'
      + '@media(min-width:700px){.ml-box{border-radius:18px}}'
      + '.ml-top{position:sticky;top:0;z-index:2;background:#14120F;color:#fff;padding:13px 16px;display:flex;align-items:flex-start;justify-content:space-between;gap:10px}'
      + '.ml-top small{display:block;opacity:.7;font-size:.78rem;margin-top:2px}'
      + '.ml-x{border:0;background:rgba(255,255,255,.18);color:#fff;width:32px;height:32px;border-radius:50%;font-size:1.1rem;cursor:pointer}'
      + '.ml-tabs{display:flex;gap:6px;padding:10px 14px 0}'
      + '.ml-tab{border:1px solid #E3DFD7;background:#fff;border-radius:99px;padding:7px 13px;font:600 .8rem "Inter",sans-serif;cursor:pointer}'
      + '.ml-tab.on{background:#14120F;border-color:#14120F;color:#fff}'
      + '.ml-body{padding:14px;display:flex;flex-direction:column;gap:10px}'
      + '.ml-in{width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid #ddd;border-radius:9px;font:inherit}'
      + 'textarea.ml-in{min-height:200px;resize:vertical;line-height:1.5}'
      + '.ml-lb{font-size:.74rem;font-weight:700;color:#6E6963;display:block;margin-bottom:3px}'
      + '.ml-row{display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap}'
      + '.ml-mut{font-size:.78rem;color:#8a857d}.ml-err{font-size:.82rem;color:#b0402f;background:#fdecea;padding:8px;border-radius:8px}'
      + '.ml-act{display:flex;gap:8px;flex-wrap:wrap;align-items:center}'
      + '.ml-b{border:1px solid #ddd;background:#fff;border-radius:99px;padding:9px 15px;font:600 .82rem "Inter",sans-serif;cursor:pointer}'
      + '.ml-b.p{background:#FF4D1C;border-color:#FF4D1C;color:#fff;margin-left:auto}.ml-b:disabled{opacity:.5}'
      + '.ml-msg{border:1px solid #eee;border-radius:10px;padding:9px 11px;cursor:pointer;font-size:.84rem}'
      + '.ml-prev{margin-top:6px;color:#4a463f;font-size:.8rem;white-space:pre-wrap}'
      + '.ml-sum{background:#FFF4EF;border:1px solid #F6C7B4;border-radius:10px;padding:10px;font-size:.84rem;white-space:pre-wrap}'
      + '.ml-step{font-size:.8rem;line-height:1.55;background:#f7f6f2;border-radius:10px;padding:10px 12px}'
      + '.ml-step code{background:#ece9e1;padding:1px 5px;border-radius:5px;font-size:.78rem;word-break:break-all}';
    document.head.appendChild(s);
  }
  function show(tab) {
    _tab = tab;
    var b = $('ml-content'); if (!b) return;
    ['ecrire', 'histo', 'reglages'].forEach(function(t){ var el = $('ml-t-' + t); if (el) el.classList.toggle('on', t === tab); });
    var c = cfg();
    if (tab !== 'reglages' && !c.clientId) tab = 'reglages';
    if (tab === 'ecrire') {
      var email = _c && _c.email ? (parseAddrs(_c.email)[0] || '') : '';
      b.innerHTML =
          '<div><label class="ml-lb">À</label><input id="ml-to" class="ml-in" placeholder="adresse@client.fr" value="' + esc(email) + '"></div>'
        + '<div><label class="ml-lb">Cc (facultatif)</label><input id="ml-cc" class="ml-in"></div>'
        + '<div><label class="ml-lb">Objet</label><input id="ml-sujet" class="ml-in"></div>'
        + '<div class="ml-act"><input id="ml-consigne" class="ml-in" style="flex:1" placeholder="Consigne pour l\'IA : ex. relance après visite, présenter les nouveautés…"><button class="ml-b" id="ml-iabtn" onclick="Mail.ia()">✨ Rédiger</button></div>'
        + '<textarea id="ml-corps" class="ml-in" placeholder="Votre message…"></textarea>'
        + '<label class="ml-mut"><input type="checkbox" id="ml-trace" checked> Noter l\'envoi dans la fiche client</label>'
        + '<div class="ml-act"><span class="ml-mut">' + (signature() ? 'Signature ajoutée automatiquement' : 'Astuce : ajoutez une signature dans Réglages') + '</span><button class="ml-b p" id="ml-send" onclick="Mail.send()">📨 Envoyer</button></div>';
    } else if (tab === 'histo') {
      b.innerHTML = '<div id="ml-histbox"></div>'; loadHist();
    } else {
      b.innerHTML =
          '<div class="ml-step"><b>Configuration (une seule fois par appareil)</b><br>'
        + '1. Allez sur <b>entra.microsoft.com</b> › Applications › Inscriptions d\'applications › <b>Nouvelle inscription</b>.<br>'
        + '2. Type de compte : « Comptes dans un annuaire d\'organisation » (ou multi-locataire).<br>'
        + '3. URI de redirection : plateforme <b>Application monopage (SPA)</b>, valeur : <code>' + esc(redirectUri()) + '</code> <a href="#" onclick="Mail.copyUri();return false">copier</a><br>'
        + '4. Autorisations d\'API › Microsoft Graph › Déléguées : <b>Mail.Send</b> et <b>Mail.Read</b> (User.Read est déjà là).<br>'
        + '5. Copiez ci-dessous l\'<b>ID d\'application (client)</b>.<br>'
        + '<span class="ml-mut">Si votre organisation bloque l\'inscription ou le consentement, il faudra l\'accord de votre administrateur Microsoft 365.</span></div>'
        + '<div><label class="ml-lb">ID d\'application (client)</label><input id="ml-cid" class="ml-in" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value="' + esc(c.clientId || '') + '"></div>'
        + '<div><label class="ml-lb">Annuaire</label><input id="ml-auth" class="ml-in" placeholder="organizations" value="' + esc(c.authority || 'organizations') + '"><div class="ml-mut">« organizations » convient en général ; sinon l\'ID ou le domaine de votre annuaire.</div></div>'
        + '<div><label class="ml-lb">Signature (ajoutée à chaque envoi)</label><textarea id="ml-sig" class="ml-in" style="min-height:80px" placeholder="Christophe SPOTO&#10;Moulin des Moines">' + esc(signature()) + '</textarea></div>'
        + '<div class="ml-act"><button class="ml-b" onclick="Mail.connect()">🔐 Se connecter à Outlook</button><button class="ml-b" onclick="Mail.disconnect()">Déconnecter</button><button class="ml-b p" onclick="Mail.saveSettings()">Enregistrer</button></div>'
        + '<div id="ml-cstate" class="ml-mut"></div>';
    }
  }
  function open(id, tab) {
    css();
    _c = (typeof cdbContacts !== 'undefined' ? cdbContacts : []).filter(function(x){ return x.id === id; })[0] || null;
    var old = $('ml-ov'); if (old) old.remove();
    var ov = document.createElement('div'); ov.id = 'ml-ov';
    ov.onclick = function(e){ if (e.target === ov) close(); };
    ov.innerHTML = '<div class="ml-box"><div class="ml-top"><div><b>✉️ E-mail Outlook</b><small>' + esc(_c ? (_c.nom || '') : 'Réglages') + '</small></div><button class="ml-x" onclick="Mail.close()">✕</button></div>'
      + '<div class="ml-tabs"><button class="ml-tab" id="ml-t-ecrire" onclick="Mail.show(\'ecrire\')">Écrire</button><button class="ml-tab" id="ml-t-histo" onclick="Mail.show(\'histo\')">Historique</button><button class="ml-tab" id="ml-t-reglages" onclick="Mail.show(\'reglages\')">⚙️ Réglages</button></div>'
      + '<div class="ml-body" id="ml-content"></div></div>';
    document.body.appendChild(ov);
    show(tab || 'ecrire');
  }
  function close() { var o = $('ml-ov'); if (o) o.remove(); }

  // retour d'une connexion par redirection (iPhone en app plein écran)
  try { if (sessionStorage.getItem('ml_redirect') && cfg().clientId) { sessionStorage.removeItem('ml_redirect'); getApp().then(function(){ note('Connexion Outlook terminée', 'ok'); }).catch(function(){}); } } catch(e){}

  window.Mail = { open: open, close: close, show: show, send: send, ia: ia, resume: resume, toggle: toggle,
    saveSettings: saveSettings, connect: connect, disconnect: disconnect, copyUri: copyUri,
    _t: { htmlToText: htmlToText, textToHtml: textToHtml, parseAddrs: parseAddrs } };
})();
