/* =======================================================================
   paie-sim.js  —  Simulateur de salaire net (MDM V3)
   -----------------------------------------------------------------------
   Reprend la cascade d'une fiche de paie MDM à partir de la commission du
   mois déjà calculée par le module Commissions :
       Brut      = base fixe + commission + avantage véhicule
       − charges salariales (taux paramétrable)
       = net social
       − avantage véhicule (repris, non versé en cash)
       − prélèvement à la source (taux paramétrable)
       = NET À PAYER estimé
   Les paramètres (base, véhicule, taux charges, taux PAS) sont modifiables
   et stockés dans bcol('config').doc('paie_params') (défauts = fiche fournie).
   C'est une ESTIMATION : les cotisations plafonnées font varier légèrement
   le taux réel de charges d'un montant de commission à l'autre.
   Branché via un appel PaieSim.setCommission(total,ca,moisLabel) à la fin de
   commRender().  API : PaieSim.mount(el?), PaieSim.setCommission(...)
   ======================================================================= */
(function () {
  'use strict';

  var DEFAULTS = { baseBrut: 1871.06, vehicule: 376.90, tauxCharges: 22.61, tauxPAS: 0 };

  var _params = null, _comm = 0, _ca = 0, _mois = '', _host = null, _open = false;

  function eur(n) {
    return (n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }
  function nf(v, d) { var n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? d : n; }

  var CSS = [
    '.psim{background:#fff;border:1px solid #e7e9e5;border-radius:14px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.03)}',
    '.psim-top{background:linear-gradient(135deg,#266327,#2f7a34);color:#fff;padding:14px 16px}',
    '.psim-top .t{font:600 14px/1 "Inter",sans-serif;display:flex;align-items:center;gap:7px}',
    '.psim-top .net{font:700 30px/1 "IBM Plex Mono",monospace;margin-top:9px;letter-spacing:-.5px}',
    '.psim-top .sub{font:500 11.5px/1.3 "Inter",sans-serif;opacity:.85;margin-top:4px}',
    '.psim-body{padding:6px 16px 12px}',
    '.psim-l{display:flex;justify-content:space-between;align-items:baseline;padding:7px 0;border-top:1px solid #f2f3f0;font:500 13px/1.3 "Inter",sans-serif;color:#40463c}',
    '.psim-l:first-child{border-top:0}',
    '.psim-l .v{font:600 13.5px "IBM Plex Mono",monospace;color:var(--g900,#1a1a1a)}',
    '.psim-l.minus .v{color:#c2410c}',
    '.psim-l.sum{border-top:2px solid #e0e3dd;margin-top:2px}',
    '.psim-l.sum .lbl{font-weight:700;color:var(--g900,#1a1a1a)}',
    '.psim-l small{color:#9aa096;font-weight:500;font-size:11px;margin-left:4px}',
    '.psim-foot{display:flex;align-items:center;justify-content:space-between;padding:9px 16px;border-top:1px solid #eef0ec;background:#fafbf9}',
    '.psim-est{font:500 11px/1.3 "Inter",sans-serif;color:#b3b8ac;font-style:italic;flex:1;padding-right:10px}',
    '.psim-gear{appearance:none;border:1px solid #d8dcd4;background:#fff;color:#6b7280;font:600 12px "Inter",sans-serif;padding:6px 11px;border-radius:8px;cursor:pointer;flex:0 0 auto}',
    '.psim-set{padding:12px 16px;border-top:1px solid #eef0ec;background:#f7f8f5;display:none}',
    '.psim-set.open{display:block}',
    '.psim-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}',
    '.psim-f label{display:block;font:600 10.5px/1 "Inter",sans-serif;text-transform:uppercase;letter-spacing:.04em;color:#8a8f87;margin-bottom:4px}',
    '.psim-f input{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #d8dcd4;border-radius:8px;font:600 13px "IBM Plex Mono",monospace;background:#fff}',
    '.psim-save{margin-top:10px;width:100%;appearance:none;border:0;background:#266327;color:#fff;font:600 13px "Inter",sans-serif;padding:10px;border-radius:9px;cursor:pointer}'
  ].join('');

  function injectCSS() {
    if (document.getElementById('psim-style')) return;
    var s = document.createElement('style'); s.id = 'psim-style'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  async function loadParams() {
    if (_params) return _params;
    var p = Object.assign({}, DEFAULTS);
    try {
      var doc = await bcol('config').doc('paie_params').get();
      if (doc.exists) {
        var d = doc.data() || {};
        ['baseBrut', 'vehicule', 'tauxCharges', 'tauxPAS'].forEach(function (k) {
          if (d[k] !== undefined && d[k] !== null && d[k] !== '') p[k] = nf(d[k], DEFAULTS[k]);
        });
      }
    } catch (e) { /* défauts */ }
    _params = p; return p;
  }

  async function saveParams(p) {
    _params = p;
    try {
      await bcol('config').doc('paie_params').set({
        baseBrut: p.baseBrut, vehicule: p.vehicule, tauxCharges: p.tauxCharges, tauxPAS: p.tauxPAS,
        majAt: (window.firebase && firebase.firestore) ? firebase.firestore.FieldValue.serverTimestamp() : Date.now()
      }, { merge: true });
      if (typeof toast === 'function') toast('✅ Paramètres de paie enregistrés', 'ok');
    } catch (e) {
      if (typeof toast === 'function') toast('Paramètres gardés pour cette session', 'ok');
    }
  }

  function compute() {
    var p = _params || DEFAULTS;
    var base = p.baseBrut, veh = p.vehicule;
    var brut = base + _comm + veh;
    var charges = brut * (p.tauxCharges / 100);
    var netSocial = brut - charges;
    var netAvantIR = netSocial - veh;
    var ir = netAvantIR * (p.tauxPAS / 100);
    var net = netAvantIR - ir;
    return { base: base, veh: veh, comm: _comm, brut: brut, charges: charges,
             netSocial: netSocial, netAvantIR: netAvantIR, ir: ir, net: net, p: p };
  }

  function render() {
    if (!_host) return;
    injectCSS();
    var c = compute();
    var moisTxt = _mois ? ('estimé pour ' + _mois) : 'estimation du mois en cours';
    _host.innerHTML =
      '<div class="psim">'
      + '<div class="psim-top"><div class="t">💶 Salaire net estimé</div>'
      +   '<div class="net">' + eur(c.net) + '</div>'
      +   '<div class="sub">' + moisTxt + ' · commission ' + eur(c.comm) + ' sur CA facturé' + (_ca ? ' (' + Math.round(_ca).toLocaleString('fr-FR') + ' €)' : '') + '</div></div>'
      + '<div class="psim-body">'
      +   line('Salaire de base (brut)', eur(c.base))
      +   line('Commission du mois', eur(c.comm), '', '1 % du CA + 2 % du dépassement')
      +   line('Avantage véhicule', eur(c.veh))
      +   line('Salaire brut', eur(c.brut), 'sum')
      +   line('Charges salariales (' + fmtPct(c.p.tauxCharges) + ')', '– ' + eur(c.charges), 'minus')
      +   line('Net social', eur(c.netSocial), 'sum')
      +   line('Avantage véhicule (repris)', '– ' + eur(c.veh), 'minus')
      +   (c.p.tauxPAS > 0 ? line('Prélèvement à la source (' + fmtPct(c.p.tauxPAS) + ')', '– ' + eur(c.ir), 'minus') : '')
      +   line('Net à payer', eur(c.net), 'sum')
      + '</div>'
      + '<div class="psim-foot"><div class="psim-est">Estimation — le taux de charges réel varie un peu selon les plafonds. Recale les paramètres si besoin.</div>'
      +   '<button class="psim-gear" id="psim-gear">⚙︎ Paramètres</button></div>'
      + '<div class="psim-set' + (_open ? ' open' : '') + '" id="psim-set">'
      +   '<div class="psim-grid">'
      +     field('psim-base', 'Base brute €', c.p.baseBrut)
      +     field('psim-veh', 'Avantage véhicule €', c.p.vehicule)
      +     field('psim-tc', 'Taux charges %', c.p.tauxCharges)
      +     field('psim-pas', 'Taux PAS %', c.p.tauxPAS)
      +   '</div>'
      +   '<button class="psim-save" id="psim-save">Enregistrer</button>'
      + '</div>'
      + '</div>';

    _host.querySelector('#psim-gear').onclick = function () {
      _open = !_open;
      _host.querySelector('#psim-set').classList.toggle('open', _open);
    };
    _host.querySelector('#psim-save').onclick = function () {
      var p = {
        baseBrut: nf(val('psim-base'), DEFAULTS.baseBrut),
        vehicule: nf(val('psim-veh'), DEFAULTS.vehicule),
        tauxCharges: nf(val('psim-tc'), DEFAULTS.tauxCharges),
        tauxPAS: nf(val('psim-pas'), DEFAULTS.tauxPAS)
      };
      saveParams(p).then(render);
    };
  }

  function fmtPct(n) { return (Math.round(n * 100) / 100).toString().replace('.', ',') + ' %'; }
  function val(id) { var e = document.getElementById(id); return e ? e.value : ''; }
  function field(id, lbl, v) {
    return '<div class="psim-f"><label>' + lbl + '</label><input id="' + id + '" type="number" step="0.01" value="' + v + '"></div>';
  }
  function line(lbl, v, cls, note) {
    return '<div class="psim-l ' + (cls || '') + '"><span class="lbl">' + lbl
      + (note ? '<small>' + note + '</small>' : '') + '</span><span class="v">' + v + '</span></div>';
  }

  async function mount(target) {
    _host = typeof target === 'string' ? document.querySelector(target)
          : (target || document.getElementById('paie-sim-host'));
    if (!_host) return;
    await loadParams();
    render();
  }

  // Appelé par commRender() : total commission du mois + CA facturé + libellé mois.
  function setCommission(total, ca, moisLabel) {
    _comm = (typeof total === 'number' && !isNaN(total)) ? total : 0;
    _ca = (typeof ca === 'number' && !isNaN(ca)) ? ca : 0;
    _mois = moisLabel || _mois;
    if (_host && _params) render();
  }

  window.PaieSim = { mount: mount, setCommission: setCommission };
})();
