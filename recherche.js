/* ═══════════════════════════════════════════════════════════════════════
   RECHERCHE PRODUIT — fiche technique instantanée
   ───────────────────────────────────────────────────────────────────────
   Recherche par REF, EAN ou libellé. Affiche pour chaque produit :
     · REF (code article)          → catalogue PRODUCTS
     · EAN                          → catalogue PRODUCTS
     · Quantité par colis (PCB)     → catalogue PRODUCTS
     · Stock disponible             → import Export.xlsx (bdcStockMap)
     · UVC vendus depuis le 01/01   → cadenciers Mobilogic (bcol cadenciers)
     · DLC garantie                 → saisie manuelle, stockée dans Firestore

   API : RechercheProduit.mount() / .refresh()
   ═══════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var VERSION = 'recherche 2026-07-23 #1';
  var MAX_RESULTATS = 60;

  var state = {
    q: '',
    tri: 'pertinence',      // pertinence | stock | ventes | libelle
    filtreRupture: false,
    ventes: null,           // { CODE: { uvc, clients:{}, derniere } }
    ventesChargees: false,
    dlc: {},                // { CODE: 'texte' }
    dlcCharge: false,
    detail: null            // code du produit ouvert en detail
  };

  /* ═══ Utilitaires ═════════════════════════════════════════════════ */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function norm(s) {
    return String(s || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ').trim();
  }
  function toast(m, t) { if (typeof global.toast === 'function') global.toast(m, t); }
  function nb(n) { return Number(n || 0).toLocaleString('fr-FR'); }

  // Catalogue de la marque active
  function catalogue() {
    if (typeof PRODUCTS !== 'undefined' && PRODUCTS && PRODUCTS.length) return PRODUCTS;
    if (typeof PRODUCTS_MDM !== 'undefined' && PRODUCTS_MDM) return PRODUCTS_MDM;
    return [];
  }

  function stockDe(code) {
    if (typeof bdcStockMap === 'undefined' || !bdcStockMap) return null;
    var v = bdcStockMap[code] !== undefined ? bdcStockMap[code] : bdcStockMap[String(code).toUpperCase()];
    return (v === undefined || v === null) ? null : Number(v);
  }

  /* ═══════════════════════════════════════════════════════════════════
     VENTES DEPUIS LE 1er JANVIER
     Source : cadenciers Mobilogic importes (bcol('cadenciers')).
     Chaque cadencier = un client, avec rows[{code, date, qty, ...}].
     ═══════════════════════════════════════════════════════════════════ */
  function debutAnnee() {
    return new Date().getFullYear() + '-01-01';
  }

  function chargerVentes(cb) {
    if (state.ventesChargees) { cb(); return; }
    if (typeof db === 'undefined' || !db || typeof bcol !== 'function') {
      state.ventes = {}; state.ventesChargees = true; cb(); return;
    }
    var seuil = debutAnnee();
    bcol('cadenciers').get()
      .then(function (snap) {
        var agg = {};
        snap.forEach(function (doc) {
          var d = doc.data();
          var client = d.client || doc.id;
          (d.rows || []).forEach(function (r) {
            if (!r.code || !r.date) return;
            if (r.date < seuil) return;                 // avant le 1er janvier
            var q = Number(r.qty) || 0;
            if (q <= 0) return;
            var k = String(r.code).toUpperCase();
            if (!agg[k]) agg[k] = { uvc: 0, clients: {}, derniere: null };
            agg[k].uvc += q;
            agg[k].clients[client] = (agg[k].clients[client] || 0) + q;
            if (!agg[k].derniere || r.date > agg[k].derniere) agg[k].derniere = r.date;
          });
        });
        state.ventes = agg;
        state.ventesChargees = true;
        cb();
      })
      .catch(function (e) {
        console.warn('[Recherche] cadenciers indisponibles :', e.code || e.message);
        state.ventes = {};
        state.ventesChargees = true;
        cb();
      });
  }

  function ventesDe(code) {
    if (!state.ventes) return null;
    return state.ventes[String(code).toUpperCase()] || null;
  }

  /* ═══════════════════════════════════════════════════════════════════
     DLC GARANTIE — absente de toute source, saisie a la main et conservee
     ═══════════════════════════════════════════════════════════════════ */
  function chargerDlc(cb) {
    if (state.dlcCharge) { cb(); return; }
    if (typeof db === 'undefined' || !db || typeof bcol !== 'function') {
      state.dlcCharge = true; cb(); return;
    }
    bcol('config').doc('dlc_produits').get()
      .then(function (doc) {
        state.dlc = (doc.exists && doc.data() && doc.data().map) ? doc.data().map : {};
        state.dlcCharge = true; cb();
      })
      .catch(function () { state.dlcCharge = true; cb(); });
  }

  function saisirDlc(code) {
    var actuel = state.dlc[code] || '';
    var v = prompt('DLC garantie pour ' + code + '\n(ex : 6 mois, 90 jours, 12/2026)', actuel);
    if (v === null) return;
    v = v.trim();
    if (v) state.dlc[code] = v; else delete state.dlc[code];

    if (typeof db !== 'undefined' && db && typeof bcol === 'function') {
      bcol('config').doc('dlc_produits')
        .set({ map: state.dlc, majAt: Date.now() }, { merge: true })
        .then(function () { toast('DLC enregistrée', 'ok'); })
        .catch(function (e) { toast('Enregistrement impossible : ' + (e.code || e.message), 'err'); });
    }
    render();
  }

  /* ═══ Recherche ═══════════════════════════════════════════════════ */
  function chercher() {
    var q = norm(state.q);
    var termes = q ? q.split(' ').filter(Boolean) : [];
    var out = [];

    catalogue().forEach(function (p) {
      var code = String(p.code || '');
      var ean = String(p.ean || '');
      var lib = String(p.libelle || '');
      var score = 0;

      if (termes.length) {
        var codeN = norm(code), libN = norm(lib);
        var hay = codeN + ' ' + ean + ' ' + libN;
        // tous les termes doivent etre presents
        for (var i = 0; i < termes.length; i++) {
          if (hay.indexOf(termes[i]) === -1) return;
        }
        // pertinence : code exact > debut de code > EAN > libelle
        if (codeN === q) score = 1000;
        else if (ean === state.q.trim()) score = 900;
        else if (codeN.indexOf(q) === 0) score = 500;
        else if (libN.indexOf(q) === 0) score = 300;
        else score = 100;
      }

      var st = stockDe(code);
      if (state.filtreRupture && !(st !== null && st <= 0)) return;

      var v = ventesDe(code);
      out.push({
        p: p, code: code, ean: ean, libelle: lib,
        pcb: Number(p.pcb) || 1,
        stock: st,
        uvc: v ? v.uvc : null,
        nbClients: v ? Object.keys(v.clients).length : 0,
        derniere: v ? v.derniere : null,
        dlc: state.dlc[code] || '',
        score: score
      });
    });

    out.sort(function (a, b) {
      if (state.tri === 'stock') {
        var sa = a.stock === null ? -1 : a.stock, sb = b.stock === null ? -1 : b.stock;
        return sb - sa;
      }
      if (state.tri === 'ventes') return (b.uvc || 0) - (a.uvc || 0);
      if (state.tri === 'libelle') return a.libelle.localeCompare(b.libelle);
      if (b.score !== a.score) return b.score - a.score;
      return a.libelle.localeCompare(b.libelle);
    });

    return out;
  }

  /* ═══ Rendu ═══════════════════════════════════════════════════════ */
  function badgeStock(st) {
    if (st === null) return '<span class="rch-st rch-st-na" title="Aucun stock importé pour cette référence">—</span>';
    if (st <= 0) return '<span class="rch-st rch-st-ko">rupture</span>';
    if (st < 50) return '<span class="rch-st rch-st-low">' + nb(st) + '</span>';
    return '<span class="rch-st rch-st-ok">' + nb(st) + '</span>';
  }

  function ligne(r) {
    var ouvert = state.detail === r.code;
    return '<article class="rch-row' + (ouvert ? ' open' : '') + '">' +
      '<div class="rch-main" onclick="RechercheProduit.detail(\'' + esc(r.code) + '\')">' +
        '<div class="rch-id">' +
          '<b>' + esc(r.libelle || r.code) + '</b>' +
          '<span class="rch-ref">' + esc(r.code) + (r.ean ? ' · ' + esc(r.ean) : '') + '</span>' +
        '</div>' +
        '<div class="rch-cell"><label>Colis</label><span>' + nb(r.pcb) + '</span></div>' +
        '<div class="rch-cell"><label>Stock</label>' + badgeStock(r.stock) + '</div>' +
        '<div class="rch-cell"><label>UVC ' + new Date().getFullYear() + '</label>' +
          '<span>' + (r.uvc !== null ? nb(r.uvc) : '—') + '</span></div>' +
        '<div class="rch-cell"><label>DLC</label>' +
          '<span class="' + (r.dlc ? '' : 'rch-vide') + '">' + (r.dlc ? esc(r.dlc) : '—') + '</span></div>' +
      '</div>' +
      (ouvert ? detailHtml(r) : '') +
    '</article>';
  }

  function detailHtml(r) {
    var v = ventesDe(r.code);
    var topClients = '';
    if (v && v.clients) {
      var arr = Object.keys(v.clients).map(function (c) { return { c: c, q: v.clients[c] }; });
      arr.sort(function (a, b) { return b.q - a.q; });
      topClients = arr.slice(0, 5).map(function (x) {
        return '<li><span>' + esc(x.c) + '</span><b>' + nb(x.q) + '</b></li>';
      }).join('');
    }

    return '<div class="rch-detail">' +
      '<div class="rch-d-grid">' +
        '<div><label>Référence</label><span>' + esc(r.code) + '</span></div>' +
        '<div><label>EAN</label><span>' + (r.ean ? esc(r.ean) : '—') + '</span></div>' +
        '<div><label>Quantité par colis</label><span>' + nb(r.pcb) + '</span></div>' +
        '<div><label>Stock disponible</label><span>' + (r.stock !== null ? nb(r.stock) + ' UVC' : 'non importé') + '</span></div>' +
        '<div><label>Stock en colis</label><span>' + (r.stock !== null ? nb(Math.floor(r.stock / r.pcb)) : '—') + '</span></div>' +
        '<div><label>Prix HT</label><span>' + (r.p.pu_ht ? Number(r.p.pu_ht).toFixed(2).replace('.', ',') + ' €' : '—') + '</span></div>' +
        '<div><label>UVC vendus depuis le 01/01</label><span>' + (r.uvc !== null ? nb(r.uvc) : '—') + '</span></div>' +
        '<div><label>Clients acheteurs</label><span>' + (r.nbClients || '—') + '</span></div>' +
        '<div><label>Dernière commande</label><span>' + (r.derniere ? new Date(r.derniere).toLocaleDateString('fr-FR') : '—') + '</span></div>' +
        '<div><label>DLC garantie</label><span>' + (r.dlc ? esc(r.dlc) : '<i>non renseignée</i>') +
          ' <button class="rch-mini" onclick="event.stopPropagation();RechercheProduit.dlc(\'' + esc(r.code) + '\')">modifier</button></span></div>' +
      '</div>' +
      (topClients
        ? '<div class="rch-top"><div class="rch-top-t">Principaux acheteurs cette année</div><ul>' + topClients + '</ul></div>'
        : '') +
      '<div class="rch-d-act">' +
        '<button class="rch-btn rch-btn-p" onclick="event.stopPropagation();RechercheProduit.commander(\'' + esc(r.code) + '\')">Ajouter au bon de commande</button>' +
      '</div>' +
    '</div>';
  }

  function render() {
    var root = document.getElementById('rch-root');
    if (!root) return;

    var cat = catalogue();
    if (!cat.length) {
      root.innerHTML = '<div class="rch-empty">Catalogue produits indisponible.</div>';
      return;
    }

    var res = chercher();
    var total = res.length;
    var affiches = res.slice(0, MAX_RESULTATS);

    var stockImporte = (typeof bdcStockMap !== 'undefined' && bdcStockMap) ? Object.keys(bdcStockMap).length : 0;
    var ventesOk = state.ventes && Object.keys(state.ventes).length;

    // Fraîcheur du stock : le fichier est mis à jour quotidiennement
    var stockAge = '';
    try {
      if (typeof BDC_STOCK_DATE_KEY === 'function') {
        var t = parseInt(localStorage.getItem(BDC_STOCK_DATE_KEY()) || '0', 10);
        if (t) {
          var jours = Math.floor((Date.now() - t) / 86400000);
          var lib = jours === 0 ? "aujourd'hui" : jours === 1 ? 'hier' : 'il y a ' + jours + ' jours';
          stockAge = (jours >= 2)
            ? ' <span class="rch-warn">(importé ' + lib + ')</span>'
            : ' <span class="rch-frais">(importé ' + lib + ')</span>';
        }
      }
    } catch (e) {}

    var barre =
      '<div class="rch-bar">' +
        '<input id="rch-q" class="rch-input" type="search" autocomplete="off" ' +
          'placeholder="Référence, code-barres ou libellé…" value="' + esc(state.q) + '" ' +
          'oninput="RechercheProduit.setQ(this.value)">' +
        '<select class="rch-sel" onchange="RechercheProduit.setTri(this.value)">' +
          '<option value="pertinence"' + (state.tri === 'pertinence' ? ' selected' : '') + '>Pertinence</option>' +
          '<option value="ventes"' + (state.tri === 'ventes' ? ' selected' : '') + '>Plus vendus</option>' +
          '<option value="stock"' + (state.tri === 'stock' ? ' selected' : '') + '>Stock décroissant</option>' +
          '<option value="libelle"' + (state.tri === 'libelle' ? ' selected' : '') + '>Alphabétique</option>' +
        '</select>' +
        '<label class="rch-check"><input type="checkbox"' + (state.filtreRupture ? ' checked' : '') +
          ' onchange="RechercheProduit.setRupture(this.checked)"> Ruptures seulement</label>' +
        '<button class="rch-btn" onclick="RechercheProduit.importStock()">Mettre à jour les stocks</button>' +
      '</div>' +
      '<div class="rch-sources">' +
        cat.length + ' références · ' +
        (stockImporte ? stockImporte + ' stocks' + stockAge : '<span class="rch-warn">aucun stock importé</span>') + ' · ' +
        (ventesOk ? ventesOk + ' références vendues cette année' : '<span class="rch-warn">aucun cadencier importé</span>') +
      '</div>';

    if (!affiches.length) {
      root.innerHTML = barre +
        '<div class="rch-empty">' +
          (state.q ? 'Aucun produit ne correspond à « ' + esc(state.q) + ' ».' : 'Aucun produit.') +
        '</div>';
      focusChamp();
      return;
    }

    root.innerHTML = barre +
      '<div class="rch-count">' + nb(total) + ' résultat' + (total > 1 ? 's' : '') +
        (total > MAX_RESULTATS ? ' · les ' + MAX_RESULTATS + ' premiers affichés' : '') + '</div>' +
      '<div class="rch-list">' + affiches.map(ligne).join('') + '</div>';
    focusChamp();
  }

  function focusChamp() {
    var el = document.getElementById('rch-q');
    if (el && document.activeElement !== el && state.q) {
      el.focus();
      try { el.setSelectionRange(el.value.length, el.value.length); } catch (e) {}
    }
  }

  /* ═══ Styles ══════════════════════════════════════════════════════ */
  var CSS = [
    '#sec-recherche .rch-bar{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;margin-bottom:.5rem}',
    '#sec-recherche .rch-input{flex:1;min-width:240px;border:1px solid var(--border-med);border-radius:10px;padding:.6rem .85rem;font-size:.92rem;font-family:inherit;background:var(--surface);color:var(--g900)}',
    '#sec-recherche .rch-input:focus{outline:none;border-color:var(--blue-p500);box-shadow:0 0 0 3px var(--blue-p50)}',
    '#sec-recherche .rch-sel{border:1px solid var(--border-med);border-radius:9px;padding:.5rem .7rem;font-size:.82rem;font-family:inherit;background:var(--surface);color:var(--g900)}',
    '#sec-recherche .rch-check{display:flex;align-items:center;gap:.4rem;font-size:.79rem;color:var(--g700)}',
    '#sec-recherche .rch-sources{font-size:.72rem;color:var(--g500);margin-bottom:.9rem}',
    '#sec-recherche .rch-warn{color:var(--amber);font-weight:600}',
    '#sec-recherche .rch-frais{color:var(--blue-p700);font-weight:600}',
    '#sec-recherche .rch-count{font-size:.75rem;color:var(--g500);margin-bottom:.5rem}',
    '#sec-recherche .rch-list{display:flex;flex-direction:column;gap:.4rem}',
    '#sec-recherche .rch-row{background:var(--surface);border:1px solid var(--border);border-radius:11px;overflow:hidden;box-shadow:var(--shadow-xs)}',
    '#sec-recherche .rch-row.open{border-color:var(--blue-p300);box-shadow:var(--shadow-md)}',
    '#sec-recherche .rch-main{display:grid;grid-template-columns:1fr repeat(4,86px);gap:.6rem;align-items:center;padding:.65rem .9rem;cursor:pointer}',
    '#sec-recherche .rch-main:hover{background:var(--surface2)}',
    '#sec-recherche .rch-id{min-width:0}',
    '#sec-recherche .rch-id b{display:block;font-size:.85rem;font-weight:550;color:var(--g900);line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#sec-recherche .rch-ref{font-size:.7rem;color:var(--g500);font-family:var(--fmono)}',
    '#sec-recherche .rch-cell{display:flex;flex-direction:column;gap:.1rem;text-align:right}',
    '#sec-recherche .rch-cell label{font-size:.6rem;text-transform:uppercase;letter-spacing:.05em;color:var(--g400);font-weight:600}',
    '#sec-recherche .rch-cell span{font-size:.84rem;font-family:var(--fmono);color:var(--g800);font-feature-settings:"tnum"}',
    '#sec-recherche .rch-vide{color:var(--g300)!important}',
    '#sec-recherche .rch-st{font-size:.78rem;font-family:var(--fmono);font-weight:600;padding:.1rem .4rem;border-radius:5px;display:inline-block}',
    '#sec-recherche .rch-st-ok{color:var(--blue-p700);background:var(--blue-p50)}',
    '#sec-recherche .rch-st-low{color:var(--amber);background:var(--amber-bg)}',
    '#sec-recherche .rch-st-ko{color:var(--red);background:var(--red-bg);font-size:.7rem}',
    '#sec-recherche .rch-st-na{color:var(--g300)}',
    '#sec-recherche .rch-detail{border-top:1px solid var(--border);padding:.9rem;background:var(--surface2)}',
    '#sec-recherche .rch-d-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:.7rem 1.2rem;margin-bottom:.8rem}',
    '#sec-recherche .rch-d-grid label{display:block;font-size:.64rem;text-transform:uppercase;letter-spacing:.05em;color:var(--g500);font-weight:600;margin-bottom:.1rem}',
    '#sec-recherche .rch-d-grid span{font-size:.86rem;color:var(--g900);font-family:var(--fmono)}',
    '#sec-recherche .rch-d-grid i{color:var(--g400);font-style:italic;font-family:var(--fd)}',
    '#sec-recherche .rch-mini{border:1px solid var(--border-med);background:var(--surface);color:var(--g600);border-radius:6px;padding:.1rem .4rem;font-size:.66rem;font-family:var(--fd);cursor:pointer;margin-left:.3rem}',
    '#sec-recherche .rch-top{border-top:1px solid var(--border);padding-top:.7rem;margin-bottom:.8rem}',
    '#sec-recherche .rch-top-t{font-size:.68rem;text-transform:uppercase;letter-spacing:.05em;color:var(--g500);font-weight:600;margin-bottom:.4rem}',
    '#sec-recherche .rch-top ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.2rem}',
    '#sec-recherche .rch-top li{display:flex;justify-content:space-between;gap:1rem;font-size:.79rem;color:var(--g700)}',
    '#sec-recherche .rch-top li b{font-family:var(--fmono);color:var(--g900)}',
    '#sec-recherche .rch-d-act{display:flex;gap:.4rem;flex-wrap:wrap}',
    '#sec-recherche .rch-btn{border:1px solid var(--border-med);background:var(--surface);color:var(--g700);border-radius:9px;padding:.45rem .8rem;font-size:.79rem;font-weight:600;cursor:pointer;font-family:inherit}',
    '#sec-recherche .rch-btn-p{background:var(--blue-p700);border-color:var(--blue-p700);color:#fff}',
    '#sec-recherche .rch-empty{padding:2.5rem 1rem;text-align:center;color:var(--g500);font-size:.86rem}',
    '@media(max-width:820px){',
      '#sec-recherche .rch-main{grid-template-columns:1fr 70px 70px;grid-template-areas:"id stock uvc";row-gap:.4rem}',
      '#sec-recherche .rch-id{grid-area:id}',
      '#sec-recherche .rch-cell:nth-of-type(1){display:none}',
      '#sec-recherche .rch-cell:nth-of-type(4){display:none}',
    '}'
  ].join('');

  function injectCSS() {
    if (document.getElementById('rch-styles')) return;
    var st = document.createElement('style');
    st.id = 'rch-styles'; st.textContent = CSS;
    document.head.appendChild(st);
  }

  /* ═══ API publique ════════════════════════════════════════════════ */
  global.RechercheProduit = {
    mount: function () {
      console.log('[Recherche] ' + VERSION);
      injectCSS();
      render();
      chargerDlc(function () {
        chargerVentes(function () { render(); });
      });
    },
    refresh: function () {
      state.ventesChargees = false; state.dlcCharge = false;
      this.mount();
    },
    // Rafraichissement leger : le stock vit dans bdcStockMap, il suffit de
    // redessiner. On ne relit ni les cadenciers ni les DLC (inutile et couteux).
    majStock: function () {
      if (!document.getElementById('rch-root')) return;
      injectCSS();
      render();
    },
    setQ: function (v) { state.q = v; state.detail = null; render(); },
    setTri: function (v) { state.tri = v; render(); },
    setRupture: function (v) { state.filtreRupture = !!v; render(); },
    detail: function (code) {
      state.detail = (state.detail === code) ? null : code;
      render();
    },
    dlc: saisirDlc,
    // Reutilise le modal d'import de stock du bon de commande : meme fichier,
    // meme traitement, et le resultat est partage entre les appareils.
    importStock: function () {
      if (typeof openStockImport === 'function') openStockImport();
      else toast('Import de stock indisponible', 'err');
    },
    commander: function (code) {
      if (typeof showSection === 'function') showSection('bdc', null, null);
      setTimeout(function () {
        try {
          if (typeof bdcQtys !== 'undefined') {
            bdcQtys[code] = (Number(bdcQtys[code]) || 0) + 1;
            if (typeof buildTable === 'function') buildTable();
            if (typeof bdcSaveLocal === 'function') bdcSaveLocal();
            if (typeof bdcUpdateRecapBar === 'function') bdcUpdateRecapBar();
            toast('1 colis de ' + code + ' ajouté', 'ok');
          }
        } catch (e) { console.warn('[Recherche] ajout BDC', e); }
      }, 250);
    },
    version: VERSION
  };
})(window);
