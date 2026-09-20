/* ═══════════════════════════════════════════════════════════════════════
   AGENDA — prise de rendez-vous reliée à la base clients (COHOR)
   Module autonome. Stockage : collection partagée bcol('rendez_vous').
   Cloisonnement : un commercial ne voit que SES RDV ; le manager voit tout.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  var _rdv = [];
  var _unsub = null;
  var _cur = new Date();            // mois affiché
  _cur.setDate(1);
  var _view = 'month';              // 'month' | 'list'
  var _selDay = null;               // jour sélectionné (YYYY-MM-DD)
  var _mounted = false;

  var TYPES = ['Visite', 'Appel', 'Rendez-vous', 'Relance', 'Livraison', 'Autre'];
  var MOIS = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  var JOURS = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];

  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function pad(n){ return (n<10?'0':'')+n; }
  function ymd(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
  function todayStr(){ return ymd(new Date()); }
  function isManager(){ try { return typeof isManagerUser==='function' && isManagerUser(); } catch(e){ return false; } }
  function scoped(){ try { return typeof cdbScopedCommercial==='function' && cdbScopedCommercial(); } catch(e){ return false; } }
  function col(){ return bcol('rendez_vous'); }

  // ── Chargement temps réel ──
  function load() {
    try { if (_unsub) { _unsub(); _unsub = null; } } catch(e){}
    var q = col();
    try { if (scoped() && currentUser) q = q.where('owner','==',currentUser.uid); } catch(e){}
    _unsub = q.onSnapshot(function (snap) {
      _rdv = snap.docs.map(function (d) { var x = d.data(); x.id = d.id; return x; });
      _rdv.sort(function(a,b){ return (a.date+'T'+(a.heure||'')).localeCompare(b.date+'T'+(b.heure||'')); });
      render();
      updateReminder();
    }, function (err) { console.warn('[Agenda] load', err && err.code); });
  }

  // ── Rappel visuel : RDV du jour (badge dans le fût + encart dashboard) ──
  function todaysRdv() {
    var t = todayStr();
    return _rdv.filter(function(r){ return r.date === t; });
  }
  function updateReminder() {
    var n = todaysRdv().length;
    // badge sur l'item de navigation Agenda
    document.querySelectorAll('.agenda-navbadge').forEach(function(b){
      if (n>0){ b.textContent = n; b.style.display=''; } else { b.style.display='none'; }
    });
    // encart dashboard
    var host = document.getElementById('agenda-today-dash');
    if (host) host.innerHTML = renderTodayCard();
  }
  function renderTodayCard() {
    var list = todaysRdv();
    if (!list.length) return '';
    var items = list.slice(0,5).map(function(r){
      return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-top:1px solid var(--border);">'
        + '<span style="font-family:\'Sora\',sans-serif;font-weight:700;color:#FF4D1C;min-width:44px;">'+esc(r.heure||'—')+'</span>'
        + '<div><div style="font-weight:600;font-size:.82rem;color:#14120F;">'+esc(r.clientNom||r.objet||'RDV')+'</div>'
        + '<div style="font-size:.7rem;color:#8A8F86;">'+esc(r.type||'')+(r.objet&&r.clientNom?(' · '+esc(r.objet)):'')+'</div></div></div>';
    }).join('');
    return '<div class="card" style="padding:1rem 1.1rem;margin-bottom:1.25rem;border-radius:16px;">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.3rem;">'
      + '<div style="font-family:\'Sora\',sans-serif;font-weight:600;color:#14120F;">📅 Vos rendez-vous du jour</div>'
      + '<a onclick="showSection(\'agenda\',null,this)" style="font-size:.75rem;color:#E03A0C;cursor:pointer;">Ouvrir l\'agenda →</a></div>'
      + items + '</div>';
  }

  // ── Rendu principal ──
  function mount() {
    _mounted = true;
    if (!_unsub) load();
    render();
  }

  function render() {
    var host = document.getElementById('agenda-host');
    if (!host) return;
    var head = '<div class="ag-head">'
      + '<div><div class="ag-title">Agenda</div><div class="ag-sub">Vos rendez-vous' + (isManager() ? ' (toute l\'équipe)' : '') + '</div></div>'
      + '<div class="ag-headctl">'
      +   '<div class="ag-toggle"><button class="ag-tg' + (_view==='month'?' on':'') + '" onclick="Agenda.setView(\'month\')">Mois</button>'
      +   '<button class="ag-tg' + (_view==='list'?' on':'') + '" onclick="Agenda.setView(\'list\')">Liste</button></div>'
      +   '<button class="ag-new" onclick="Agenda.openNew()">+ Nouveau rendez-vous</button>'
      + '</div></div>';
    host.innerHTML = head + (_view==='month' ? renderMonth() : renderList());
  }

  function renderMonth() {
    var y = _cur.getFullYear(), m = _cur.getMonth();
    var first = new Date(y, m, 1);
    var startDow = (first.getDay()+6)%7;   // lundi=0
    var nbDays = new Date(y, m+1, 0).getDate();
    var byDay = {};
    _rdv.forEach(function(r){ (byDay[r.date]=byDay[r.date]||[]).push(r); });
    var t = todayStr();

    var cells = '';
    for (var i=0;i<startDow;i++) cells += '<div class="ag-cell ag-empty"></div>';
    for (var d=1; d<=nbDays; d++) {
      var ds = y+'-'+pad(m+1)+'-'+pad(d);
      var evs = byDay[ds]||[];
      var chips = evs.slice(0,3).map(function(r){
        return '<div class="ag-chip" title="'+esc((r.heure||'')+' '+(r.clientNom||r.objet||''))+'">'
          + '<b>'+esc(r.heure||'')+'</b> '+esc(r.clientNom||r.objet||'RDV')+'</div>';
      }).join('');
      if (evs.length>3) chips += '<div class="ag-more">+'+(evs.length-3)+'</div>';
      cells += '<div class="ag-cell'+(ds===t?' ag-today':'')+'" onclick="Agenda.openNew(\''+ds+'\')">'
        + '<div class="ag-daynum">'+d+(evs.length?' <span class="ag-cnt">'+evs.length+'</span>':'')+'</div>'+chips+'</div>';
    }
    return '<div class="ag-monthbar">'
      + '<button class="ag-nav" onclick="Agenda.move(-1)">‹</button>'
      + '<div class="ag-monthlbl">'+MOIS[m]+' '+y+'</div>'
      + '<button class="ag-nav" onclick="Agenda.move(1)">›</button>'
      + '<button class="ag-nav ag-todaybtn" onclick="Agenda.goToday()">Aujourd\'hui</button></div>'
      + '<div class="ag-grid">'
      + JOURS.map(function(j){ return '<div class="ag-dow">'+j+'</div>'; }).join('')
      + cells + '</div>';
  }

  function renderList() {
    var t = todayStr();
    var up = _rdv.filter(function(r){ return r.date >= t; });
    if (!up.length) return '<div class="ag-empty-msg">Aucun rendez-vous à venir. Cliquez « + Nouveau rendez-vous ».</div>';
    var rows = up.map(function(r){
      var dd = new Date(r.date+'T00:00:00');
      return '<div class="ag-li" onclick="Agenda.openEdit(\''+r.id+'\')">'
        + '<div class="ag-li-date"><div class="ag-li-d">'+dd.getDate()+'</div><div class="ag-li-m">'+MOIS[dd.getMonth()].slice(0,3)+'</div></div>'
        + '<div class="ag-li-main"><div class="ag-li-cli">'+esc(r.clientNom||r.objet||'RDV')+'</div>'
        + '<div class="ag-li-sub">'+esc(r.heure||'')+' · '+esc(r.type||'')+(r.objet&&r.clientNom?(' · '+esc(r.objet)):'')
        + (isManager()&&r.ownerEmail?(' · '+esc(r.ownerEmail)):'')+'</div></div>'
        + '<div class="ag-li-arr">›</div></div>';
    }).join('');
    return '<div class="ag-list">'+rows+'</div>';
  }

  // ── Modale création / édition ──
  function openNew(dateStr) {
    _openModal(null, dateStr || todayStr());
  }
  function openEdit(id) {
    var r = _rdv.find(function(x){ return x.id===id; });
    if (r) _openModal(r, r.date);
  }
  function _openModal(r, dateStr) {
    var clients = (typeof cdbContacts !== 'undefined' && cdbContacts) ? cdbContacts : [];
    var opts = clients.slice().sort(function(a,b){ return (a.nom||'').localeCompare(b.nom||''); })
      .map(function(c){ return '<option value="'+esc(c.nom||'')+'" data-id="'+esc(c.id||'')+'">'; }).join('');
    var typeOpts = TYPES.map(function(t){ return '<option'+((r&&r.type===t)?' selected':'')+'>'+t+'</option>'; }).join('');
    var wrap = document.getElementById('agenda-modal');
    if (!wrap) return;
    wrap.querySelector('#ag-m-title').textContent = r ? 'Modifier le rendez-vous' : 'Nouveau rendez-vous';
    wrap.querySelector('#ag-m-id').value = r ? r.id : '';
    wrap.querySelector('#ag-m-clients').innerHTML = opts;
    wrap.querySelector('#ag-m-client').value = r ? (r.clientNom||'') : '';
    wrap.querySelector('#ag-m-date').value = r ? r.date : dateStr;
    wrap.querySelector('#ag-m-heure').value = r ? (r.heure||'09:00') : '09:00';
    wrap.querySelector('#ag-m-type').innerHTML = typeOpts;
    wrap.querySelector('#ag-m-objet').value = r ? (r.objet||'') : '';
    wrap.querySelector('#ag-m-notes').value = r ? (r.notes||'') : '';
    wrap.querySelector('#ag-m-lieu').value = r ? (r.lieu||'') : '';
    wrap.querySelector('#ag-m-del').style.display = r ? '' : 'none';
    wrap.style.display = 'flex';
  }
  function closeModal() { var w = document.getElementById('agenda-modal'); if (w) w.style.display='none'; }

  function save() {
    var w = document.getElementById('agenda-modal'); if (!w) return;
    var id = w.querySelector('#ag-m-id').value;
    var cliName = w.querySelector('#ag-m-client').value.trim();
    var date = w.querySelector('#ag-m-date').value;
    var heure = w.querySelector('#ag-m-heure').value;
    if (!date) { toast('Choisissez une date', 'err'); return; }
    // retrouver le client (id) dans la base
    var cliId = '', cliSec = '';
    try {
      var match = (cdbContacts||[]).find(function(c){ return (c.nom||'').toLowerCase() === cliName.toLowerCase(); });
      if (match) { cliId = match.id||''; cliSec = match.secteur||''; }
    } catch(e){}
    var data = {
      clientNom: cliName, clientId: cliId,
      date: date, heure: heure,
      type: w.querySelector('#ag-m-type').value,
      objet: w.querySelector('#ag-m-objet').value.trim(),
      notes: w.querySelector('#ag-m-notes').value.trim(),
      lieu: w.querySelector('#ag-m-lieu').value.trim(),
      owner: currentUser ? currentUser.uid : '',
      ownerEmail: currentUser ? (currentUser.email||'').toLowerCase() : '',
      secteur: cliSec,
      updatedAt: Date.now()
    };
    var ref = id ? col().doc(id) : col().doc();
    if (!id) data.createdAt = Date.now();
    ref.set(data, { merge: true }).then(function(){
      toast(id ? '✅ Rendez-vous modifié' : '✅ Rendez-vous créé', 'ok');
      closeModal();
    }).catch(function(e){ toast('Erreur : '+(e.code||e.message), 'err'); });
  }

  function del() {
    var w = document.getElementById('agenda-modal'); if (!w) return;
    var id = w.querySelector('#ag-m-id').value;
    if (!id) return;
    if (!confirm('Supprimer ce rendez-vous ?')) return;
    col().doc(id).delete().then(function(){ toast('Rendez-vous supprimé','ok'); closeModal(); })
      .catch(function(e){ toast('Erreur : '+(e.code||e.message),'err'); });
  }

  function setView(v){ _view = v; render(); }
  function move(n){ _cur.setMonth(_cur.getMonth()+n); render(); }
  function goToday(){ _cur = new Date(); _cur.setDate(1); render(); }

  window.Agenda = {
    mount: mount, setView: setView, move: move, goToday: goToday,
    openNew: openNew, openEdit: openEdit, save: save, del: del, closeModal: closeModal,
    updateReminder: updateReminder, load: load
  };
})();
