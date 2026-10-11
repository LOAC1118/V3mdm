/* ═══════════════════════════════════════════════════════════════════════
   MAIL — e-mails clients depuis le CRM (messagerie Exchange de l'entreprise)
   Le serveur de messagerie n'étant pas accessible depuis une page web, le CRM :
   • prépare le message (destinataire, objet, texte rédigé par l'IA, signature)
     puis l'ouvre dans TA messagerie (Mail sur iPhone, Outlook sur ordinateur)
     — c'est toi qui valides l'envoi, depuis ta boîte ;
   • trace l'e-mail dans les notes de la fiche client ;
   • permet de « Noter un échange » (mail reçu, appel…) avec résumé IA d'un
     texte collé ou dicté.
   Aucune donnée de messagerie n'est lue ni stockée en dehors de la fiche client.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  var SIG_KEY = 'cohor_mail_sig_v1';
  var MAILTO_MAX = 1800;     // au-delà, certains clients mail tronquent le corps

  var _c = null;

  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function $(id){ return document.getElementById(id); }
  function note(m,t){ try { toast(m,t||'ok'); } catch(e){ console.log(m); } }
  function signature(){ try { return localStorage.getItem(SIG_KEY) || localStorage.getItem('cohor_ms_sig_v1') || ''; } catch(e){ return ''; } }

  function htmlToText(h) {
    return String(h || '').replace(/<\/p>\s*<p[^>]*>/gi, '\n\n').replace(/<br\s*\/?>/gi, '\n').replace(/<\/li>/gi, '\n').replace(/<li[^>]*>/gi, '• ')
      .replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/\n{3,}/g, '\n\n').trim();
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
  function fullBody() {
    var corps = ($('ml-corps').value || '').trim(), sig = signature();
    return corps + (sig ? '\n\n' + sig : '');
  }

  // ── Ouvrir dans la messagerie ──
  function mailtoUrl(to, cc, sujet, body) {
    var q = [];
    if (cc.length) q.push('cc=' + encodeURIComponent(cc.join(',')));
    q.push('subject=' + encodeURIComponent(sujet));
    q.push('body=' + encodeURIComponent(body.replace(/\n/g, '\r\n')));
    return 'mailto:' + to.join(',') + '?' + q.join('&');     // adresses déjà validées : on garde le @ tel quel
  }
  function openInMail() {
    var to = parseAddrs($('ml-to').value), cc = parseAddrs($('ml-cc').value);
    var sujet = $('ml-sujet').value.trim(), body = fullBody();
    if (!to.length) { note('Indiquez un destinataire valide', 'err'); return; }
    if (!sujet) { note('Indiquez un objet', 'err'); return; }
    if (!($('ml-corps').value || '').trim()) { note('Le message est vide', 'err'); return; }
    var url = mailtoUrl(to, cc, sujet, body);
    if (url.length > MAILTO_MAX + 300) {
      // message long : on le copie aussi, au cas où la messagerie tronquerait le texte
      try { navigator.clipboard.writeText(body); note('Message long : copié aussi dans le presse-papiers (collez-le si besoin)', 'ok'); } catch(e){}
    }
    var tr = $('ml-trace'), p = (tr && tr.checked && _c) ? traceInNotes('E-mail préparé : ' + sujet) : Promise.resolve();
    p.then(function(){ window.location.href = url; });
  }
  function copyMsg() {
    var txt = 'Objet : ' + ($('ml-sujet').value || '') + '\n\n' + fullBody();
    try { navigator.clipboard.writeText(txt).then(function(){ note('Message copié', 'ok'); }); } catch(e){ note('Copie impossible', 'err'); }
  }

  // ── Trace dans la fiche client ──
  function traceInNotes(ligne) {
    var c = _c; if (!c || !c.id) return Promise.resolve();
    var d = new Date().toLocaleDateString('fr-FR');
    c.notes = (c.notes ? c.notes + '\n' : '') + '[' + d + '] ' + ligne;
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

  // ── Noter un échange (mail reçu, appel…) ──
  function resumer() {
    var t = ($('ml-echange').value || '').trim();
    if (!t) { note('Collez ou dictez d\'abord le contenu de l\'échange', 'err'); return; }
    if (typeof mlAiCall !== 'function') { note('IA indisponible', 'err'); return; }
    var btn = $('ml-sumbtn'); btn.disabled = true; btn.textContent = '…';
    mlAiCall('Tu résumes pour un commercial terrain un échange avec un client (B2B bio). En français, 2 à 4 lignes : ce que demande ou propose le client, les engagements, la prochaine action. Ne rien inventer. Réponds UNIQUEMENT par un JSON {"resume":"..."}.', t.slice(0, 6000)).then(function(r){
      var j = parseJson(r); $('ml-echange').value = ((j && j.resume) || r).trim();
    }).catch(function(e){ note(e && e.message === 'no-key' ? 'Aucune clé IA configurée' : 'Erreur IA : ' + (e.message || e), 'err'); })
      .then(function(){ btn.disabled = false; btn.textContent = '✨ Résumer'; });
  }
  function addEchange() {
    var t = ($('ml-echange').value || '').trim(), type = $('ml-type').value;
    if (!t) { note('Rien à ajouter', 'err'); return; }
    if (!_c || !_c.id) { note('Client introuvable', 'err'); return; }
    traceInNotes(type + ' : ' + t.replace(/\n+/g, ' ')).then(function(){ note('📌 Ajouté à la fiche de ' + (_c.nom || 'ce client'), 'ok'); close(); });
  }

  // ── Réglages (signature) ──
  function saveSig() {
    try { localStorage.setItem(SIG_KEY, $('ml-sig').value); note('Signature enregistrée', 'ok'); } catch(e){ note('Enregistrement impossible', 'err'); }
  }

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
      + '.ml-tabs{display:flex;gap:6px;padding:10px 14px 0;flex-wrap:wrap}'
      + '.ml-tab{border:1px solid #E3DFD7;background:#fff;border-radius:99px;padding:7px 13px;font:600 .8rem "Inter",sans-serif;cursor:pointer}'
      + '.ml-tab.on{background:#14120F;border-color:#14120F;color:#fff}'
      + '.ml-body{padding:14px;display:flex;flex-direction:column;gap:10px}'
      + '.ml-in{width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid #ddd;border-radius:9px;font:inherit}'
      + 'textarea.ml-in{min-height:200px;resize:vertical;line-height:1.5}'
      + '.ml-lb{font-size:.74rem;font-weight:700;color:#6E6963;display:block;margin-bottom:3px}'
      + '.ml-mut{font-size:.78rem;color:#8a857d}'
      + '.ml-act{display:flex;gap:8px;flex-wrap:wrap;align-items:center}'
      + '.ml-b{border:1px solid #ddd;background:#fff;border-radius:99px;padding:9px 15px;font:600 .82rem "Inter",sans-serif;cursor:pointer}'
      + '.ml-b.p{background:#FF4D1C;border-color:#FF4D1C;color:#fff;margin-left:auto}.ml-b:disabled{opacity:.5}'
      + '.ml-step{font-size:.8rem;line-height:1.55;background:#f7f6f2;border-radius:10px;padding:10px 12px}';
    document.head.appendChild(s);
  }
  function show(tab) {
    var b = $('ml-content'); if (!b) return;
    ['ecrire', 'echange', 'reglages'].forEach(function(t){ var el = $('ml-t-' + t); if (el) el.classList.toggle('on', t === tab); });
    if (tab === 'ecrire') {
      var email = _c && _c.email ? (parseAddrs(_c.email)[0] || '') : '';
      b.innerHTML =
          '<div><label class="ml-lb">À</label><input id="ml-to" class="ml-in" placeholder="adresse@client.fr" value="' + esc(email) + '"></div>'
        + '<div><label class="ml-lb">Cc (facultatif)</label><input id="ml-cc" class="ml-in"></div>'
        + '<div><label class="ml-lb">Objet</label><input id="ml-sujet" class="ml-in"></div>'
        + '<div class="ml-act"><input id="ml-consigne" class="ml-in" style="flex:1" placeholder="Consigne pour l\'IA : ex. relance après visite, présenter les nouveautés…"><button class="ml-b" id="ml-iabtn" onclick="Mail.ia()">✨ Rédiger</button></div>'
        + '<textarea id="ml-corps" class="ml-in" placeholder="Votre message…"></textarea>'
        + '<label class="ml-mut"><input type="checkbox" id="ml-trace" checked> Noter l\'e-mail dans la fiche client</label>'
        + '<div class="ml-act"><button class="ml-b" onclick="Mail.copyMsg()">📋 Copier</button><span class="ml-mut">' + (signature() ? 'Signature ajoutée à l\'ouverture' : 'Astuce : ajoutez votre signature dans Réglages') + '</span><button class="ml-b p" onclick="Mail.openInMail()">✉️ Ouvrir dans ma messagerie</button></div>'
        + '<div class="ml-mut">Votre messagerie s\'ouvre avec le message prêt : vous relisez puis envoyez depuis votre boîte.</div>';
    } else if (tab === 'echange') {
      b.innerHTML =
          '<div class="ml-step">Gardez la trace d\'un échange dans la fiche du client : collez un e-mail reçu, ou dictez un résumé d\'appel (micro 🎤 du clavier), puis résumez-le avec l\'IA si besoin.</div>'
        + '<div><label class="ml-lb">Type d\'échange</label><select id="ml-type" class="ml-in"><option>E-mail reçu</option><option>E-mail envoyé</option><option>Appel</option><option>Message</option></select></div>'
        + '<textarea id="ml-echange" class="ml-in" style="min-height:160px" placeholder="Collez ou dictez l\'échange…"></textarea>'
        + '<div class="ml-act"><button class="ml-b" id="ml-sumbtn" onclick="Mail.resumer()">✨ Résumer</button><button class="ml-b p" onclick="Mail.addEchange()">📌 Ajouter à la fiche</button></div>';
    } else {
      b.innerHTML =
          '<div><label class="ml-lb">Signature (ajoutée à chaque e-mail)</label><textarea id="ml-sig" class="ml-in" style="min-height:100px" placeholder="Christophe SPOTO&#10;Moulin des Moines">' + esc(signature()) + '</textarea></div>'
        + '<div class="ml-act"><button class="ml-b p" onclick="Mail.saveSig()">Enregistrer</button></div>'
        + '<div class="ml-mut">La signature est enregistrée sur cet appareil.</div>';
    }
  }
  function open(id, tab) {
    css();
    _c = (typeof cdbContacts !== 'undefined' ? cdbContacts : []).filter(function(x){ return x.id === id; })[0] || null;
    var old = $('ml-ov'); if (old) old.remove();
    var ov = document.createElement('div'); ov.id = 'ml-ov';
    ov.onclick = function(e){ if (e.target === ov) close(); };
    ov.innerHTML = '<div class="ml-box"><div class="ml-top"><div><b>✉️ E-mail</b><small>' + esc(_c ? (_c.nom || '') : '') + '</small></div><button class="ml-x" onclick="Mail.close()">✕</button></div>'
      + '<div class="ml-tabs"><button class="ml-tab" id="ml-t-ecrire" onclick="Mail.show(\'ecrire\')">Écrire</button><button class="ml-tab" id="ml-t-echange" onclick="Mail.show(\'echange\')">Noter un échange</button><button class="ml-tab" id="ml-t-reglages" onclick="Mail.show(\'reglages\')">⚙️ Signature</button></div>'
      + '<div class="ml-body" id="ml-content"></div></div>';
    document.body.appendChild(ov);
    show(tab || 'ecrire');
  }
  function close() { var o = $('ml-ov'); if (o) o.remove(); }

  window.Mail = { open: open, close: close, show: show, ia: ia, openInMail: openInMail, copyMsg: copyMsg,
    resumer: resumer, addEchange: addEchange, saveSig: saveSig, _t: { mailtoUrl: mailtoUrl, htmlToText: htmlToText, parseAddrs: parseAddrs } };
})();
