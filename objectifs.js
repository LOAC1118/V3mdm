/* =======================================================================
   objectifs.js  —  Suivi vs objectifs (MDM V3, module 4)
   -----------------------------------------------------------------------
   - Objectifs mensuels + annuel, saisis et persistés dans
     bcol('config').doc('objectifs') (scopé marque/utilisateur).
   - CA réalisé lu via CRMData.caParMois() (tes commandes).
   - Affiche : mois en cours (jauge + "il te manque X"), cumul annuel,
     mini-histogramme mensuel réalisé vs objectif.
   API : Objectifs.mount(el?)
   ======================================================================= */
(function () {
  'use strict';

  var MOIS = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  var euro = function (n) {
    return (Math.round(n) || 0).toLocaleString('fr-FR') + ' €';
  };
  var keyMois = function (d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  };

  var CSS = [
    '.obj-wrap{max-width:760px;margin:0 auto;padding:4px 2px 90px}',
    '.obj-h{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin:6px 2px 16px}',
    '.obj-h h2{font:600 20px/1.1 "Fraunces",Georgia,serif;margin:0;color:var(--ink,#1a1a1a)}',
    '.obj-yr{font:600 13px/1 "Inter",sans-serif;color:#6b7280}',
    '.obj-card{background:#fff;border:1px solid #e7e9e5;border-radius:16px;padding:18px 18px 20px;',
    '  margin-bottom:14px;box-shadow:0 1px 2px rgba(0,0,0,.03)}',
    '.obj-lbl{font:600 11.5px/1 "Inter",sans-serif;letter-spacing:.04em;text-transform:uppercase;color:#8a8f87;margin:0 0 10px}',
    '.obj-big{font:600 30px/1 "IBM Plex Mono",monospace;color:var(--accent,#266327)}',
    '.obj-sub{font:500 13px/1.4 "Inter",sans-serif;color:#6b7280;margin-top:6px}',
    '.obj-gauge{height:12px;border-radius:999px;background:#eef0ec;overflow:hidden;margin:14px 0 8px}',
    '.obj-gfill{height:100%;border-radius:999px;background:linear-gradient(90deg,var(--accent,#266327),#3ea16a);transition:width .6s cubic-bezier(.2,.7,.2,1)}',
    '.obj-gfill.over{background:linear-gradient(90deg,#1f8a4c,#28c76f)}',
    '.obj-flex{display:flex;gap:12px;flex-wrap:wrap}',
    '.obj-flex .obj-card{flex:1 1 220px;margin-bottom:0}',
    '.obj-row2{display:flex;gap:12px;margin-bottom:14px}',
    '.obj-miss{font:600 14px/1 "Inter",sans-serif;color:#b45309}',
    '.obj-miss.ok{color:var(--accent,#266327)}',
    '.obj-chart{display:flex;align-items:flex-end;gap:5px;height:130px;margin-top:6px;padding-top:10px}',
    '.obj-bar{flex:1;position:relative;display:flex;flex-direction:column;justify-content:flex-end;height:100%}',
    '.obj-bg{position:absolute;inset:0;top:auto;width:100%;background:#eef0ec;border-radius:5px 5px 0 0}',
    '.obj-fg{position:relative;width:100%;background:var(--accent,#266327);border-radius:5px 5px 0 0;min-height:2px;transition:height .5s}',
    '.obj-fg.miss{background:#d97706}',
    '.obj-obj{position:absolute;left:0;right:0;height:2px;background:#111;opacity:.5}',
    '.obj-mlbl{text-align:center;font:500 9.5px/1 "Inter",sans-serif;color:#9aa096;margin-top:5px}',
    '.obj-btn{appearance:none;border:1px solid var(--accent,#266327);background:var(--accent,#266327);color:#fff;',
    '  font:600 13px/1 "Inter",sans-serif;padding:10px 15px;border-radius:10px;cursor:pointer}',
    '.obj-btn.ghost{background:#fff;color:var(--accent,#266327)}',
    '.obj-edit{display:none;margin-top:14px}.obj-edit.show{display:block}',
    '.obj-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;margin:10px 0}',
    '.obj-cell label{display:block;font:600 10.5px/1 "Inter",sans-serif;color:#8a8f87;margin-bottom:3px}',
    '.obj-cell input{width:100%;box-sizing:border-box;padding:8px;border:1px solid #d8dcd4;border-radius:8px;',
    '  font:500 13px "IBM Plex Mono",monospace;text-align:right}',
    '.obj-legend{font:500 11px/1.4 "Inter",sans-serif;color:#9aa096;margin-top:8px}'
  ].join('');

  function injectCSS() {
    if (document.getElementById('obj-style')) return;
    var s = document.createElement('style'); s.id = 'obj-style'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  var state = { annee: new Date().getFullYear(), mensuel: {}, annuel: 0 };

  async function load() {
    try {
      var d = await bcol('config').doc('objectifs').get();
      if (d.exists) {
        var data = d.data() || {};
        state.annee   = data.annee   || state.annee;
        state.mensuel = data.mensuel || {};
        state.annuel  = data.annuel  || 0;
      }
    } catch (e) { console.warn('[Objectifs] load:', e && e.message); }
  }
  async function save() {
    try {
      await bcol('config').doc('objectifs').set({
        annee: state.annee, mensuel: state.mensuel, annuel: state.annuel,
        maj: Date.now()
      }, { merge: true });
    } catch (e) { alert('Erreur enregistrement objectifs : ' + (e && e.message)); }
  }

  function objMois(k) { return Number(state.mensuel[k] || 0); }
  function objAnnuel() {
    if (state.annuel) return state.annuel;
    // sinon somme des mensuels
    return Object.keys(state.mensuel).reduce(function (s, k) { return s + Number(state.mensuel[k] || 0); }, 0);
  }

  async function render(host) {
    injectCSS();
    var ca = await CRMData.caParMois();
    var now = new Date();
    var an = state.annee;
    var moisAct = keyMois(now);
    var caMois = ca[moisAct] || 0;
    var objM = objMois(moisAct);
    var pctM = objM ? Math.min(100, (caMois / objM) * 100) : 0;
    var manque = Math.max(0, objM - caMois);

    // cumul annuel réalisé
    var caAnnuel = 0;
    for (var m = 1; m <= 12; m++) {
      var k = an + '-' + String(m).padStart(2, '0');
      caAnnuel += ca[k] || 0;
    }
    var oAn = objAnnuel();
    var pctA = oAn ? Math.min(100, (caAnnuel / oAn) * 100) : 0;

    // barres mensuelles
    var maxVal = 1;
    for (var i = 1; i <= 12; i++) {
      var kk = an + '-' + String(i).padStart(2, '0');
      maxVal = Math.max(maxVal, ca[kk] || 0, objMois(kk));
    }
    var bars = '';
    for (var j = 0; j < 12; j++) {
      var mk = an + '-' + String(j + 1).padStart(2, '0');
      var real = ca[mk] || 0, obj = objMois(mk);
      var hReal = Math.round((real / maxVal) * 100);
      var atteint = obj && real >= obj;
      var objTop = obj ? (100 - Math.round((obj / maxVal) * 100)) : null;
      bars += '<div class="obj-bar" title="' + MOIS[j] + ' : ' + euro(real) + (obj ? ' / ' + euro(obj) : '') + '">'
        + '<div class="obj-bg"></div>'
        + '<div class="obj-fg ' + (obj && !atteint ? 'miss' : '') + '" style="height:' + hReal + '%"></div>'
        + (objTop != null ? '<div class="obj-obj" style="top:' + objTop + '%"></div>' : '')
        + '</div>';
    }
    var lbls = MOIS.map(function (m) { return '<div class="obj-mlbl">' + m.slice(0, 3) + '</div>'; }).join('');

    host.innerHTML =
      '<div class="obj-wrap">'
      + '<div class="obj-h"><h2>Objectifs</h2><span class="obj-yr">Année ' + an + '</span></div>'

      + '<div class="obj-card">'
      +   '<p class="obj-lbl">Mois en cours · ' + MOIS[now.getMonth()] + '</p>'
      +   '<div class="obj-big">' + euro(caMois) + (objM ? ' <span style="font-size:15px;color:#9aa096">/ ' + euro(objM) + '</span>' : '') + '</div>'
      +   '<div class="obj-gauge"><div class="obj-gfill ' + (pctM >= 100 ? 'over' : '') + '" style="width:' + pctM + '%"></div></div>'
      +   (objM
            ? '<div class="' + (manque ? 'obj-miss' : 'obj-miss ok') + '">'
              + (manque ? 'Il te manque ' + euro(manque) + ' pour l\'objectif' : '✓ Objectif atteint ('+Math.round(pctM)+'%)') + '</div>'
            : '<div class="obj-sub">Aucun objectif défini pour ce mois — clique sur « Définir les objectifs ».</div>')
      + '</div>'

      + '<div class="obj-row2">'
      +   '<div class="obj-card" style="flex:1">'
      +     '<p class="obj-lbl">Cumul ' + an + '</p>'
      +     '<div class="obj-big">' + euro(caAnnuel) + '</div>'
      +     '<div class="obj-gauge"><div class="obj-gfill ' + (pctA >= 100 ? 'over' : '') + '" style="width:' + pctA + '%"></div></div>'
      +     '<div class="obj-sub">' + (oAn ? Math.round(pctA) + '% de ' + euro(oAn) : 'Objectif annuel non défini') + '</div>'
      +   '</div>'
      + '</div>'

      + '<div class="obj-card">'
      +   '<p class="obj-lbl">Réalisé vs objectif — ' + an + '</p>'
      +   '<div class="obj-chart">' + bars + '</div>'
      +   '<div class="obj-chart" style="height:auto;align-items:flex-start;padding-top:0;margin-top:2px">' + lbls + '</div>'
      +   '<div class="obj-legend">Barre = CA réalisé · trait noir = objectif du mois · orange = objectif non atteint</div>'
      +   '<div style="margin-top:14px"><button class="obj-btn ghost" id="obj-toggle">Définir les objectifs</button></div>'
      +   '<div class="obj-edit" id="obj-edit"></div>'
      + '</div>'

      + '</div>';

    host.querySelector('#obj-toggle').onclick = function () { toggleEdit(host); };
  }

  function toggleEdit(host) {
    var box = host.querySelector('#obj-edit');
    if (box.classList.contains('show')) { box.classList.remove('show'); return; }
    var an = state.annee;
    var cells = '';
    for (var i = 0; i < 12; i++) {
      var k = an + '-' + String(i + 1).padStart(2, '0');
      cells += '<div class="obj-cell"><label>' + MOIS[i].slice(0, 4) + '</label>'
        + '<input type="number" inputmode="numeric" data-k="' + k + '" value="' + (state.mensuel[k] || '') + '" placeholder="0"></div>';
    }
    box.innerHTML =
      '<div class="obj-grid">' + cells + '</div>'
      + '<div class="obj-cell" style="max-width:220px;margin-bottom:12px"><label>Objectif annuel (0 = somme des mois)</label>'
      + '<input type="number" inputmode="numeric" id="obj-annuel" value="' + (state.annuel || '') + '" placeholder="auto"></div>'
      + '<button class="obj-btn" id="obj-save">Enregistrer</button>'
      + ' <button class="obj-btn ghost" id="obj-cancel">Annuler</button>';
    box.classList.add('show');
    box.querySelector('#obj-cancel').onclick = function () { box.classList.remove('show'); };
    box.querySelector('#obj-save').onclick = async function () {
      box.querySelectorAll('input[data-k]').forEach(function (inp) {
        var v = Number(inp.value || 0);
        if (v > 0) state.mensuel[inp.dataset.k] = v; else delete state.mensuel[inp.dataset.k];
      });
      state.annuel = Number(box.querySelector('#obj-annuel').value || 0);
      await save();
      render(host);
    };
  }

  async function mount(target) {
    var host = typeof target === 'string' ? document.querySelector(target)
             : (target || document.getElementById('sec-objectifs'));
    if (!host) { console.warn('[Objectifs] conteneur introuvable'); return; }
    host.innerHTML = '<div style="padding:40px;text-align:center;color:#9aa096">Chargement…</div>';
    await load();
    await render(host);
  }

  window.Objectifs = { mount: mount, _state: state };
})();
