/* ═══════════════════════════════════════════════════════════════════════
   CLIENTS À REVISITER — carte du tableau de bord
   Croise la base clients, le CA (fichier commandes) et la date du dernier relevé.
   Priorité = clients qui pèsent le plus et qu'on n'a pas vus depuis longtemps.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  var _all = false, _lv = null, _t = null;
  var KEY = 'rv_days';
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function norm(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,' ').trim(); }
  function days(){ try { return parseInt(localStorage.getItem(KEY), 10) || 45; } catch(e){ return 45; } }
  function setDays(v){ try { localStorage.setItem(KEY, String(v)); } catch(e){} render(); }
  function today(){ var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function diff(a, b){ return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000); }
  function eur0(n){ return Math.round(n).toLocaleString('fr-FR') + ' €'; }
  function contacts(){ try { return (typeof cdbContacts !== 'undefined' && cdbContacts) ? cdbContacts : []; } catch(e){ return []; } }

  function compute() {
    var t = today(), lim = days(), out = [];
    contacts().forEach(function(c){
      var st = c._stats || {}, ca = st.caYear || 0, tot = st.caTotal || 0;
      if (!(tot > 0 || ca > 0)) return;                                  // clients qui commandent (ou ont commandé)
      var last = (_lv && (_lv.byId[c.id] || _lv.byName[norm(c.nom)])) || '';
      var since = last ? diff(last, t) : null;
      if (since != null && since < lim) return;
      var score = (ca || tot / 3 || 1) * (since == null ? 2 : Math.min(since, 365) / lim);
      out.push({ c: c, last: last, since: since, ca: ca, tot: tot, score: score });
    });
    out.sort(function(a, b){ return b.score - a.score; });
    return out;
  }
  function render() {
    var host = document.getElementById('agenda-revisit-dash'); if (!host) return;
    if (!contacts().length || !_lv) { host.innerHTML = ''; return; }
    var L = compute(); if (!L.length) { host.innerHTML = ''; return; }
    var rows = L.slice(0, _all ? 30 : 6).map(function(x){
      var c = x.c;
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--border);">'
        + '<div style="flex:1;min-width:0"><div style="font-weight:600;font-size:.86rem;color:#14120F;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(c.nom) + (c.ville ? ' <span style="font-weight:500;color:#8A8F86">· ' + esc(c.ville) + '</span>' : '') + '</div>'
        + '<div style="font-size:.72rem;color:' + (x.since == null ? '#c0392b' : '#8A8F86') + '">' + (x.since == null ? 'jamais relevé' : 'dernier relevé il y a ' + x.since + ' j') + (x.ca ? ' · CA ' + eur0(x.ca) + ' cette année' : x.tot ? ' · CA total ' + eur0(x.tot) : '') + '</div></div>'
        + '<button class="btn btn-ghost" style="padding:8px 12px;font-size:.78rem;white-space:nowrap" data-id="' + esc(c.id) + '" onclick="Revisiter.go(this.getAttribute(\'data-id\'))">▶ Visiter</button></div>';
    }).join('');
    var opts = [30, 45, 60, 90].map(function(d){ return '<option value="' + d + '"' + (d === days() ? ' selected' : '') + '>&gt; ' + d + ' j</option>'; }).join('');
    host.innerHTML = '<div class="card" style="padding:1rem 1.1rem;margin-bottom:1.25rem;border-radius:16px;">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:.3rem;flex-wrap:wrap">'
      + '<div style="font-family:\'Sora\',sans-serif;font-weight:600;color:#14120F;">🔁 Clients à revisiter <span style="font-weight:500;color:#8A8F86;font-size:.8rem">(' + L.length + ')</span></div>'
      + '<select onchange="Revisiter.setDays(this.value)" style="font-size:16px;padding:4px 8px;border-radius:8px;border:1px solid #ddd">' + opts + '</select></div>'
      + rows + (L.length > 6 ? '<a onclick="Revisiter.toggle()" style="display:block;padding-top:8px;font-size:.78rem;color:var(--brand-d);cursor:pointer">' + (_all ? 'Réduire' : 'Voir les ' + Math.min(L.length, 30) + ' premiers') + ' →</a>' : '') + '</div>';
  }
  function toggle(){ _all = !_all; render(); }
  function go(id) {
    var c = contacts().filter(function(x){ return String(x.id) === String(id); })[0]; if (!c) return;
    if (window.Releves && Releves.demarrer) Releves.demarrer({ clientId: c.id, nom: c.nom, ville: c.ville || '', ens: (_lv && _lv.ensById && _lv.ensById[c.id]) || 'catalogue' });
  }
  function load() {
    if (!(window.Releves && Releves.lastVisits)) return;
    Releves.lastVisits().then(function(v){ _lv = v; render(); }).catch(function(){});
  }
  function boot() {
    load();
    [3000, 8000, 15000, 30000].forEach(function(ms){ setTimeout(function(){ load(); }, ms); });   // la base clients et le CA arrivent après l'ouverture
    window.addEventListener('cohor-actions', function(){ setTimeout(load, 100); });
    var orig = window.showSection;
    if (typeof orig === 'function' && !orig.__rv) {
      var w = function(name){ var r = orig.apply(this, arguments); if (name === 'dashboard') setTimeout(load, 200); return r; };
      w.__rv = 1; window.showSection = w;
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function(){ setTimeout(boot, 1500); }); else setTimeout(boot, 1500);
  window.Revisiter = { render: render, setDays: setDays, toggle: toggle, go: go, load: load };
})();
