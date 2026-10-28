/* ═══════════════════════════════════════════════════════════════════════
   GROUPEMENT « GRAP » — rattache à la base clients les magasins du réseau GRAP
   (liste Réseau Grap × clients MDM, mars 2026 / export clients fin octobre).
   Le bouton « 🏷️ Réseau GRAP » (Base clients) affiche les clients trouvés puis,
   après confirmation, met leur champ Groupe à « GRAP ».
   L'ancien groupe est conservé (champ groupeAvantGrap) ; la coopérative d'origine
   (GRAP, CAAP, COOPALIM…) est mémorisée dans le champ reseauGrap.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  var NOM = 'GRAP';
  var LISTE = [
    { code: '004776', nom: 'La Carline', cp: '26155', ville: 'Die', coop: 'GRAP' },
    { code: '005025', nom: 'Épicerie du Coing', cp: '73470', ville: 'Novalaise', coop: 'GRAP' },
    { code: '005850', nom: 'Fournil des Bruyères', cp: '03160', ville: 'Bourbon-l’Archambault', coop: 'CAAP' },
    { code: '006131', nom: 'Au Tournesol', cp: '07800', ville: 'Beauchastel', coop: 'GRAP' },
    { code: '007461', nom: 'Croc Bauges (Biobauges)', cp: '73340', ville: 'Lescheraines', coop: 'GRAP' },
    { code: '007474', nom: 'Le Bieristan', cp: '69100', ville: 'Villeurbanne', coop: 'GRAP' },
    { code: '010734', nom: 'Epices & nous', cp: '38850', ville: 'Charavines', coop: 'GRAP' },
    { code: '011653', nom: 'La P’tite Distrib', cp: '69007', ville: 'Lyon', coop: 'GRAP' },
    { code: '011692', nom: 'Baptiste, pâtissier éthicurien (La Clairière)', cp: '43500', ville: 'Chomelix', coop: 'CAAP' },
    { code: '012597', nom: 'Atelier Végétal', cp: '07360', ville: 'St Michel de Chabrillanoux', coop: 'GRAP' },
    { code: 'P000686', nom: 'Vrac en Vert', cp: '42000', ville: 'Saint-Etienne', coop: 'GRAP' },
    { code: 'P000745', nom: 'La Boutique bio', cp: '39500', ville: 'Tavaux', coop: 'COOPALIM' }
  ];
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function nz(s){ var t = String(s == null ? '' : s).trim(); if (t.slice(-2) === '.0') t = t.slice(0, -2); return t.replace(/^0+/, '') || t; }
  function contacts(){ try { return (typeof cdbContacts !== 'undefined' && cdbContacts) ? cdbContacts : []; } catch(e){ return []; } }

  function match() {
    var C = contacts(), byCode = {};
    C.forEach(function(c){ if (c.numClient) byCode[nz(c.numClient)] = c; });
    return LISTE.map(function(x){
      var c = byCode[nz(x.code)] || null;
      if (!c) c = C.filter(function(k){ return String(k.cp || '').trim() === x.cp && String(k.nom || '').toLowerCase().indexOf(x.nom.toLowerCase().split(' ')[0]) !== -1; })[0] || null;
      return { x: x, c: c };
    });
  }
  function open() {
    if (!contacts().length) { try { toast('Base clients pas encore chargée', 'err'); } catch(e){} return; }
    var old = document.getElementById('grap-ov'); if (old) old.remove();
    var M = match(), found = M.filter(function(m){ return m.c; }), todo = found.filter(function(m){ return m.c.groupe !== NOM; });
    var ov = document.createElement('div'); ov.id = 'grap-ov';
    ov.style.cssText = 'position:fixed;inset:0;z-index:99995;background:rgba(20,18,15,.55);display:flex;align-items:flex-end;justify-content:center';
    ov.onclick = function(e){ if (e.target === ov) close(); };
    ov.innerHTML = '<div style="background:#fff;border-radius:16px 16px 0 0;width:100%;max-width:640px;max-height:90vh;overflow:auto;padding:16px 16px calc(20px + env(safe-area-inset-bottom,0px));box-sizing:border-box;font-family:inherit">'
      + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><b style="font-size:1.05rem;flex:1">🏷️ Groupement GRAP</b><button class="btn btn-ghost" onclick="Grap.close()">✕</button></div>'
      + '<div style="font-size:.82rem;color:#8a857d;margin-bottom:10px">' + found.length + ' client(s) du réseau GRAP retrouvé(s) dans votre base sur ' + LISTE.length + ' de la liste' + (todo.length ? ' · <b>' + todo.length + ' à modifier</b>' : ' · tous déjà en GRAP') + '.</div>'
      + M.map(function(m){
        var c = m.c;
        return '<div style="display:flex;gap:8px;align-items:center;padding:7px 0;border-top:1px solid #eee;font-size:.84rem"><div style="flex:1;min-width:0"><b>' + esc(c ? c.nom : m.x.nom) + '</b> <span style="color:#8a857d">· ' + esc(m.x.ville) + ' · ' + esc(m.x.coop) + '</span>'
          + '<div style="font-size:.72rem;color:' + (c ? '#8a857d' : '#c0392b') + '">' + (c ? 'groupe actuel : ' + esc(c.groupe || '—') + (c.groupe === NOM ? ' ✓' : ' → GRAP') : 'introuvable dans la base (code ' + esc(m.x.code) + ')') + '</div></div></div>';
      }).join('')
      + '<div style="display:flex;gap:8px;margin-top:14px"><button class="btn btn-primary" style="flex:1" ' + (todo.length ? '' : 'disabled') + ' onclick="Grap.apply()">Appliquer GRAP à ' + todo.length + ' client(s)</button><button class="btn btn-ghost" onclick="Grap.filter()">Voir les GRAP</button></div></div>';
    document.body.appendChild(ov);
  }
  function close() { var o = document.getElementById('grap-ov'); if (o) o.remove(); }
  function filter() {
    close(); var s = document.getElementById('cdb-filter-group'); if (!s) return;
    if (![].some.call(s.options, function(o){ return o.value === NOM; })) { var o = document.createElement('option'); o.value = NOM; o.textContent = NOM; s.appendChild(o); }
    s.value = NOM; try { cdbRender(); } catch(e){}
  }
  function apply() {
    var todo = match().filter(function(m){ return m.c && m.c.groupe !== NOM; }), ok = 0, ko = 0;
    if (!todo.length) { close(); return; }
    Promise.all(todo.map(function(m){
      var c = m.c, upd = { groupe: NOM, reseauGrap: m.x.coop, groupeAvantGrap: c.groupe || '', updatedAt: Date.now() };
      return bcol('contacts').doc(c.id).update(upd).then(function(){ for (var k in upd) c[k] = upd[k]; ok++; }).catch(function(){ ko++; });
    })).then(function(){
      try { localStorage.removeItem(CDB_CACHE_KEY()); } catch(e){}
      try { cdbRender(); } catch(e){}
      try { toast(ok + ' client(s) passé(s) en GRAP' + (ko ? ' · ' + ko + ' erreur(s) (droits ?)' : ''), ko ? 'err' : 'ok'); } catch(e){}
      close(); if (ok) filter();
    });
  }
  window.Grap = { open: open, close: close, apply: apply, filter: filter, _match: match, LISTE: LISTE };
})();
