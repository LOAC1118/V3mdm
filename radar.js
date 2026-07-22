/* ═══════════════════════════════════════════════════════════════════════
   RADAR CLIENTS — moteur d'alertes commerciales
   ───────────────────────────────────────────────────────────────────────
   Source de données : dashCaRows (commandes_stats) + cdbContacts
   Aucune dépendance externe. Styles préfixés "rdr-".
   API publique : RadarClients.mount() / .refresh() / .unmount()
                  RadarClients.analyse()  -> tableau d'analyses clients
   ═══════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var MS_DAY = 86400000;
  var MOUNTED = false;

  /* ─── Réglages (persistés par marque) ─────────────────────────────── */
  var CFG_DEFAULT = {
    seuilRetard: 1.4,   // décrochage si joursDepuis > rythme × seuil
    seuilBaisse: 0.85,  // baisse si CA 12m < CA 12m précédents × seuil
    minCmds: 2,         // nb mini de commandes pour calculer un rythme
    horizonDormant: 400 // au-delà : client considéré perdu, pas prioritaire
  };
  var cfg = Object.assign({}, CFG_DEFAULT);

  function brandKey(suffix) {
    var b = (typeof CURRENT_BRAND !== 'undefined') ? CURRENT_BRAND : 'mdm';
    return 'radar_' + suffix + '_' + b;
  }
  function cfgLoad() {
    try {
      var raw = localStorage.getItem(brandKey('cfg'));
      if (raw) cfg = Object.assign({}, CFG_DEFAULT, JSON.parse(raw));
    } catch (e) { cfg = Object.assign({}, CFG_DEFAULT); }
  }
  function cfgSave() {
    try { localStorage.setItem(brandKey('cfg'), JSON.stringify(cfg)); } catch (e) {}
  }

  /* ─── Report ("je m'en occupe plus tard") ─────────────────────────── */
  var snooze = {};
  function snoozeLoad() {
    try { snooze = JSON.parse(localStorage.getItem(brandKey('snooze')) || '{}'); }
    catch (e) { snooze = {}; }
    var now = Date.now(), changed = false;
    Object.keys(snooze).forEach(function (k) {
      if (snooze[k] < now) { delete snooze[k]; changed = true; }
    });
    if (changed) snoozeSave();
  }
  function snoozeSave() {
    try { localStorage.setItem(brandKey('snooze'), JSON.stringify(snooze)); } catch (e) {}
  }
  function snoozeAdd(key, jours) {
    snooze[key] = Date.now() + jours * MS_DAY;
    snoozeSave();
    render();
  }

  /* ─── Utilitaires ─────────────────────────────────────────────────── */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function eur(n) {
    n = Number(n || 0);
    if (Math.abs(n) >= 1000) return Math.round(n).toLocaleString('fr-FR') + ' €';
    return n.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €';
  }
  function normName(s) {
    return String(s || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ').trim();
  }
  function normCode(s) {
    var str = String(s || '').trim();
    if (str.endsWith('.0')) str = str.slice(0, -2);
    return { full: str, noZero: str.replace(/^0+/, '') || str };
  }
  function mediane(arr) {
    if (!arr.length) return null;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function dateCmd(r) {
    return r.dateCmd || r.dateRef || r.dateFac || r.dateLiv || null;
  }
  function fmtJours(j) {
    if (j == null) return '—';
    if (j < 31) return j + ' j';
    var m = Math.round(j / 30.4);
    return m < 24 ? m + ' mois' : Math.round(j / 365) + ' ans';
  }

  /* ═══════════════════════════════════════════════════════════════════
     MOTEUR D'ANALYSE
     Retourne, pour chaque client ayant commandé, un objet complet.
     Réutilisable ailleurs : RadarClients.analyse()
     ═══════════════════════════════════════════════════════════════════ */
  function analyse() {
    var rows = (typeof dashCaRows !== 'undefined' && dashCaRows) ? dashCaRows : [];
    if (!rows.length) return [];

    var now = new Date();
    var lim12 = new Date(now.getTime() - 365 * MS_DAY);
    var lim24 = new Date(now.getTime() - 730 * MS_DAY);

    /* 1. Regroupement des commandes par client -------------------------- */
    var map = {};
    rows.forEach(function (r) {
      if (!r || r.statut === 'avoir') return;      // on ignore les avoirs
      var ca = Number(r.ca || 0);
      if (!(ca > 0)) return;
      var d = dateCmd(r);
      if (!d || isNaN(d)) return;

      var code = normCode(r.codeClient);
      var key = code.noZero ? 'C:' + code.noZero : 'N:' + normName(r.clientNomKey || r.client);
      if (key === 'N:') return;

      if (!map[key]) {
        map[key] = {
          key: key,
          code: code.full || '',
          nom: r.client || r.clientNomKey || '—',
          dates: [], caTotal: 0, ca12: 0, caPrec12: 0, nbCmds: 0
        };
      }
      var c = map[key];
      if (r.client && c.nom === '—') c.nom = r.client;
      c.dates.push(d.getTime());
      c.caTotal += ca;
      c.nbCmds++;
      if (d >= lim12) c.ca12 += ca;
      else if (d >= lim24) c.caPrec12 += ca;
    });

    /* 2. Index des contacts pour rattacher les coordonnées -------------- */
    var contacts = (typeof cdbContacts !== 'undefined' && cdbContacts) ? cdbContacts : [];
    var byCode = {}, byCodeNZ = {}, byNom = {};
    contacts.forEach(function (ct) {
      if (ct.numClient) {
        var n = normCode(ct.numClient);
        byCode[n.full] = ct; byCodeNZ[n.noZero] = ct;
      }
      if (ct.nom) byNom[normName(ct.nom)] = ct;
    });

    /* 3. Calcul des indicateurs ---------------------------------------- */
    var out = [];
    Object.keys(map).forEach(function (k) {
      var c = map[k];
      c.dates.sort(function (a, b) { return a - b; });

      var derniere = new Date(c.dates[c.dates.length - 1]);
      var joursDepuis = Math.floor((now - derniere) / MS_DAY);

      // Rythme = médiane des écarts entre commandes (robuste aux trous)
      var ecarts = [];
      for (var i = 1; i < c.dates.length; i++) {
        var e = Math.round((c.dates[i] - c.dates[i - 1]) / MS_DAY);
        if (e > 0) ecarts.push(e);
      }
      // On ne garde que les 8 derniers écarts : le rythme récent prime
      if (ecarts.length > 8) ecarts = ecarts.slice(-8);
      var rythme = (c.nbCmds >= cfg.minCmds && ecarts.length) ? Math.round(mediane(ecarts)) : null;
      var retard = rythme ? (joursDepuis / rythme) : null;

      var panier = c.nbCmds ? c.caTotal / c.nbCmds : 0;
      var evo = (c.caPrec12 > 0) ? (c.ca12 - c.caPrec12) / c.caPrec12 : null;

      // Rattachement contact
      var ct = null;
      if (c.code) {
        var nc = normCode(c.code);
        ct = byCode[nc.full] || byCodeNZ[nc.noZero] || null;
      }
      if (!ct) ct = byNom[normName(c.nom)] || null;

      /* --- Motifs d'alerte --- */
      var motifs = [], tags = {};

      if (rythme && retard > cfg.seuilRetard && joursDepuis <= cfg.horizonDormant) {
        tags.decrochage = true;
        motifs.push({
          type: 'decrochage', ton: 'red',
          txt: joursDepuis + ' j sans commande (rythme habituel : ' + rythme + ' j)'
        });
      }
      if (joursDepuis > cfg.horizonDormant) {
        tags.dormant = true;
        motifs.push({
          type: 'dormant', ton: 'grey',
          txt: 'Aucune commande depuis ' + fmtJours(joursDepuis)
        });
      }
      if (evo !== null && evo < (cfg.seuilBaisse - 1) && c.caPrec12 > 500) {
        tags.baisse = true;
        motifs.push({
          type: 'baisse', ton: 'amber',
          txt: 'CA 12 mois en baisse de ' + Math.round(Math.abs(evo) * 100) + '% (' +
               eur(c.caPrec12) + ' → ' + eur(c.ca12) + ')'
        });
      }
      if (evo !== null && evo > 0.25 && c.ca12 > 500) {
        tags.hausse = true;
        motifs.push({
          type: 'hausse', ton: 'green',
          txt: 'CA en progression de ' + Math.round(evo * 100) + '% — compte à sécuriser'
        });
      }
      if (rythme && retard !== null && retard > 0.85 && retard <= cfg.seuilRetard) {
        tags.bientot = true;
        motifs.push({
          type: 'bientot', ton: 'blue',
          txt: 'Prochaine commande attendue sous ' + Math.max(0, rythme - joursDepuis) + ' j'
        });
      }

      /* --- Score de priorité ---
         importance (poids économique, échelle log) × urgence (signaux)   */
      var importance = Math.log10(1 + Math.max(c.ca12, c.caTotal / Math.max(1, (c.dates.length ? (now - new Date(c.dates[0])) / (365 * MS_DAY) : 1))));
      var urgence = 0;
      if (tags.decrochage) urgence += Math.min(3, retard - cfg.seuilRetard + 1) * 2;
      if (tags.baisse)     urgence += 1.5;
      if (tags.bientot)    urgence += 0.8;
      if (tags.hausse)     urgence += 0.4;
      if (tags.dormant)    urgence += 0.3;
      var score = urgence > 0 ? importance * urgence : 0;

      out.push({
        key: c.key, code: c.code, nom: c.nom,
        contact: ct,
        nbCmds: c.nbCmds, caTotal: c.caTotal, ca12: c.ca12, caPrec12: c.caPrec12,
        panier: panier, evo: evo,
        derniere: derniere, joursDepuis: joursDepuis,
        dates: c.dates.slice(),
        rythme: rythme, retard: retard,
        motifs: motifs, tags: tags,
        score: score
      });
    });

    out.sort(function (a, b) { return b.score - a.score; });
    return out;
  }

  /* ═══════════════════════════════════════════════════════════════════
     ÉTAT + RENDU
     ═══════════════════════════════════════════════════════════════════ */
  var state = { filtre: 'prio', search: '', limit: 25 };
  var data = [];

  var FILTRES = [
    { id: 'prio',       label: 'Priorités',    test: function (c) { return c.score > 0 && !c.tags.dormant; } },
    { id: 'decrochage', label: 'Décrochage',   test: function (c) { return c.tags.decrochage; } },
    { id: 'baisse',     label: 'Baisse de CA', test: function (c) { return c.tags.baisse; } },
    { id: 'bientot',    label: 'À recontacter',test: function (c) { return c.tags.bientot; } },
    { id: 'hausse',     label: 'En hausse',    test: function (c) { return c.tags.hausse; } },
    { id: 'dormant',    label: 'Endormis',     test: function (c) { return c.tags.dormant; } },
    { id: 'tous',       label: 'Tous',         test: function () { return true; } }
  ];

  function filtered() {
    var f = FILTRES.find(function (x) { return x.id === state.filtre; }) || FILTRES[0];
    var q = normName(state.search);
    return data.filter(function (c) {
      if (snooze[c.key]) return false;
      if (!f.test(c)) return false;
      if (q && normName(c.nom + ' ' + c.code).indexOf(q) < 0) return false;
      return true;
    });
  }

  function render() {
    var root = document.getElementById('rdr-root');
    if (!root) return;

    if (!data.length) {
      root.innerHTML =
        '<div class="rdr-empty">' +
        '<div class="rdr-empty-ico">📡</div>' +
        '<h3>Aucun historique de ventes chargé</h3>' +
        '<p>Le radar s\'appuie sur le suivi des commandes du Dashboard. ' +
        'Importe ton fichier de ventes, puis reviens ici.</p>' +
        '<button class="btn btn-primary" onclick="showSection(\'dashboard\',null,null)">Aller au Dashboard</button> ' +
        '<button class="btn btn-ghost" onclick="RadarClients.refresh()">Réessayer</button>' +
        '</div>';
      return;
    }

    var list = filtered();

    /* --- KPI --- */
    var nbDecro = data.filter(function (c) { return c.tags.decrochage; }).length;
    var caRisque = data.filter(function (c) { return c.tags.decrochage || c.tags.baisse; })
                       .reduce(function (s, c) { return s + c.ca12; }, 0);
    var nbActifs = data.filter(function (c) { return c.joursDepuis <= 180; }).length;
    var nbRepris = Object.keys(snooze).length;

    var kpis =
      '<div class="rdr-kpis">' +
      kpi('À traiter', list.length, 'clients dans ce filtre', 'blue') +
      kpi('Décrochages', nbDecro, 'rythme d\'achat rompu', 'red') +
      kpi('CA à risque', eur(caRisque), 'sur 12 mois glissants', 'amber') +
      kpi('Clients actifs', nbActifs, 'commande < 6 mois', 'green') +
      '</div>';

    /* --- Filtres --- */
    var chips = '<div class="rdr-chips">' + FILTRES.map(function (f) {
      var n = data.filter(function (c) { return !snooze[c.key] && f.test(c); }).length;
      return '<button class="rdr-chip' + (state.filtre === f.id ? ' active' : '') +
             '" onclick="RadarClients.setFiltre(\'' + f.id + '\')">' +
             esc(f.label) + '<span class="rdr-chip-n">' + n + '</span></button>';
    }).join('') + '</div>';

    /* --- Barre outils --- */
    var tools =
      '<div class="rdr-tools">' +
      '<input id="rdr-search" class="rdr-input" type="search" placeholder="Rechercher un client…" ' +
      'value="' + esc(state.search) + '" oninput="RadarClients.setSearch(this.value)">' +
      '<button class="rdr-btn-ghost" onclick="RadarClients.refresh()" title="Recalculer">↻</button>' +
      (nbRepris ? '<button class="rdr-btn-ghost" onclick="RadarClients.clearSnooze()" title="Réafficher les clients reportés">Reportés (' + nbRepris + ')</button>' : '') +
      '</div>';

    /* --- Cartes --- */
    var cards;
    if (!list.length) {
      cards = '<div class="rdr-none">Rien à signaler dans ce filtre. C\'est bon signe.</div>';
    } else {
      cards = list.slice(0, state.limit).map(carte).join('');
      if (list.length > state.limit) {
        cards += '<button class="rdr-more" onclick="RadarClients.plus()">Afficher ' +
                 Math.min(25, list.length - state.limit) + ' clients de plus (' +
                 (list.length - state.limit) + ' restants)</button>';
      }
    }

    root.innerHTML = kpis + chips + tools + '<div class="rdr-list">' + cards + '</div>';
  }

  function kpi(label, val, sub, ton) {
    return '<div class="rdr-kpi rdr-t-' + ton + '">' +
           '<div class="rdr-kpi-v">' + esc(val) + '</div>' +
           '<div class="rdr-kpi-l">' + esc(label) + '</div>' +
           '<div class="rdr-kpi-s">' + esc(sub) + '</div></div>';
  }

  function carte(c) {
    var ct = c.contact;
    var tel = ct && ct.telephone ? String(ct.telephone).replace(/[^\d+]/g, '') : '';
    var mail = ct && ct.email ? ct.email : '';
    var ville = ct ? [ct.cp, ct.ville].filter(Boolean).join(' ') : '';

    var motifs = c.motifs.map(function (m) {
      return '<div class="rdr-motif rdr-m-' + m.ton + '">' + esc(m.txt) + '</div>';
    }).join('');

    var jauge = '';
    if (c.rythme) {
      var pct = Math.min(100, Math.round((c.joursDepuis / (c.rythme * 2)) * 100));
      var ton = c.retard > cfg.seuilRetard ? 'red' : (c.retard > 0.85 ? 'amber' : 'green');
      jauge = '<div class="rdr-jauge"><div class="rdr-jauge-f rdr-j-' + ton + '" style="width:' + pct + '%"></div>' +
              '<span class="rdr-jauge-mark" style="left:50%"></span></div>' +
              '<div class="rdr-jauge-l">' + c.joursDepuis + ' j écoulés · rythme ' + c.rythme + ' j</div>';
    }

    var actions = '<div class="rdr-actions">';
    if (tel)  actions += '<a class="rdr-act" href="tel:' + esc(tel) + '">📞 Appeler</a>';
    if (mail) actions += '<a class="rdr-act" href="mailto:' + esc(mail) + '">✉️ Écrire</a>';
    if (ct)   actions += '<button class="rdr-act rdr-act-p" onclick="RadarClients.commande(\'' + esc(ct.id) + '\')">🛒 Commande</button>';
    if (ct)   actions += '<button class="rdr-act" onclick="RadarClients.fiche(\'' + esc(ct.id) + '\')">👤 Fiche</button>';
    if (ct && typeof Visites !== 'undefined') {
      actions += '<button class="rdr-act" onclick="RadarClients.visite(\'' + esc(ct.id) + '\')">📝 CR</button>';
    }
    actions += '<button class="rdr-act rdr-act-mute" onclick="RadarClients.reporter(\'' + esc(c.key) + '\')">⏱ Reporter 14 j</button>';
    actions += '</div>';

    var evoTxt = c.evo === null ? '—'
      : (c.evo >= 0 ? '+' : '') + Math.round(c.evo * 100) + '%';

    return '<article class="rdr-card">' +
      '<header class="rdr-card-h">' +
        '<div class="rdr-card-t">' +
          '<h4>' + esc(c.nom) + '</h4>' +
          '<div class="rdr-card-sub">' + (c.code ? 'Code ' + esc(c.code) : '') +
            (ville ? ' · ' + esc(ville) : '') +
            (ct ? '' : ' · <span class="rdr-warn">non rattaché à la base clients</span>') +
          '</div>' +
        '</div>' +
        '<div class="rdr-badge">' + Math.round(c.score * 10) + '</div>' +
      '</header>' +
      '<div class="rdr-motifs">' + motifs + '</div>' +
      jauge +
      '<div class="rdr-stats">' +
        stat('CA 12 mois', eur(c.ca12)) +
        stat('Évolution', evoTxt, c.evo === null ? '' : (c.evo < 0 ? 'red' : 'green')) +
        stat('Panier moyen', eur(c.panier)) +
        stat('Commandes', c.nbCmds) +
        stat('Dernière', c.derniere.toLocaleDateString('fr-FR')) +
      '</div>' +
      actions +
      '</article>';
  }

  function stat(l, v, ton) {
    return '<div class="rdr-stat"><span class="rdr-stat-l">' + esc(l) + '</span>' +
           '<span class="rdr-stat-v' + (ton ? ' rdr-v-' + ton : '') + '">' + esc(v) + '</span></div>';
  }

  /* ═══════════════════════════════════════════════════════════════════
     STYLES
     ═══════════════════════════════════════════════════════════════════ */
  var CSS = [
    '#sec-radar .rdr-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.75rem;margin-bottom:1rem}',
    '#sec-radar .rdr-kpi{background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--g400);border-radius:12px;padding:.85rem 1rem;box-shadow:var(--shadow-xs)}',
    '#sec-radar .rdr-t-red{border-left-color:var(--red)}#sec-radar .rdr-t-amber{border-left-color:var(--amber)}',
    '#sec-radar .rdr-t-green{border-left-color:var(--green)}#sec-radar .rdr-t-blue{border-left-color:var(--blue)}',
    '#sec-radar .rdr-kpi-v{font-size:1.5rem;font-weight:700;color:var(--g900);line-height:1.1}',
    '#sec-radar .rdr-kpi-l{font-size:.78rem;font-weight:600;color:var(--g700);margin-top:.15rem}',
    '#sec-radar .rdr-kpi-s{font-size:.68rem;color:var(--g500)}',
    '#sec-radar .rdr-chips{display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:.75rem}',
    '#sec-radar .rdr-chip{border:1px solid var(--border-med);background:var(--surface);color:var(--g700);border-radius:999px;padding:.35rem .75rem;font-size:.76rem;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:.35rem}',
    '#sec-radar .rdr-chip.active{background:var(--blue-p700);border-color:var(--blue-p700);color:#fff}',
    '#sec-radar .rdr-chip-n{background:rgba(8,50,110,.10);border-radius:999px;padding:0 .35rem;font-size:.68rem}',
    '#sec-radar .rdr-chip.active .rdr-chip-n{background:rgba(255,255,255,.22)}',
    '#sec-radar .rdr-tools{display:flex;gap:.5rem;margin-bottom:1rem}',
    '#sec-radar .rdr-input{flex:1;border:1px solid var(--border-med);border-radius:10px;padding:.5rem .75rem;font-size:.85rem;background:var(--surface);color:var(--g900);font-family:inherit}',
    '#sec-radar .rdr-btn-ghost{border:1px solid var(--border-med);background:var(--surface);border-radius:10px;padding:.5rem .8rem;font-size:.8rem;color:var(--g700);cursor:pointer}',
    '#sec-radar .rdr-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:.85rem}',
    '#sec-radar .rdr-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:1rem;box-shadow:var(--shadow-xs);display:flex;flex-direction:column;gap:.6rem}',
    '#sec-radar .rdr-card-h{display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem}',
    '#sec-radar .rdr-card-h h4{margin:0;font-size:.95rem;font-weight:700;color:var(--g900);line-height:1.25}',
    '#sec-radar .rdr-card-sub{font-size:.7rem;color:var(--g500);margin-top:.15rem}',
    '#sec-radar .rdr-warn{color:var(--amber)}',
    '#sec-radar .rdr-badge{flex-shrink:0;background:var(--blue-p50);color:var(--blue-p700);border:1px solid var(--blue-p300);border-radius:8px;padding:.15rem .45rem;font-size:.72rem;font-weight:700}',
    '#sec-radar .rdr-motifs{display:flex;flex-direction:column;gap:.3rem}',
    '#sec-radar .rdr-motif{font-size:.76rem;font-weight:600;padding:.35rem .55rem;border-radius:8px;line-height:1.3}',
    '#sec-radar .rdr-m-red{background:var(--red-bg);color:var(--red)}',
    '#sec-radar .rdr-m-amber{background:var(--amber-bg);color:var(--amber)}',
    '#sec-radar .rdr-m-green{background:var(--green-bg);color:var(--green)}',
    '#sec-radar .rdr-m-blue{background:var(--blue-bg);color:var(--blue-p700)}',
    '#sec-radar .rdr-m-grey{background:var(--g100);color:var(--g600)}',
    '#sec-radar .rdr-jauge{position:relative;height:6px;background:var(--g200);border-radius:999px;overflow:hidden}',
    '#sec-radar .rdr-jauge-f{height:100%;border-radius:999px}',
    '#sec-radar .rdr-j-red{background:var(--red)}#sec-radar .rdr-j-amber{background:var(--amber)}#sec-radar .rdr-j-green{background:var(--green)}',
    '#sec-radar .rdr-jauge-mark{position:absolute;top:-2px;width:1px;height:10px;background:var(--g600);opacity:.5}',
    '#sec-radar .rdr-jauge-l{font-size:.66rem;color:var(--g500);margin-top:-.3rem}',
    '#sec-radar .rdr-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(88px,1fr));gap:.4rem;border-top:1px solid var(--border);padding-top:.55rem}',
    '#sec-radar .rdr-stat{display:flex;flex-direction:column}',
    '#sec-radar .rdr-stat-l{font-size:.62rem;color:var(--g500);text-transform:uppercase;letter-spacing:.03em}',
    '#sec-radar .rdr-stat-v{font-size:.82rem;font-weight:700;color:var(--g800)}',
    '#sec-radar .rdr-v-red{color:var(--red)}#sec-radar .rdr-v-green{color:var(--green)}',
    '#sec-radar .rdr-actions{display:flex;flex-wrap:wrap;gap:.35rem;border-top:1px solid var(--border);padding-top:.55rem}',
    '#sec-radar .rdr-act{border:1px solid var(--border-med);background:var(--surface2);color:var(--g700);border-radius:8px;padding:.35rem .55rem;font-size:.72rem;font-weight:600;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;font-family:inherit}',
    '#sec-radar .rdr-act:active{transform:scale(.97)}',
    '#sec-radar .rdr-act-p{background:var(--blue-p700);border-color:var(--blue-p700);color:#fff}',
    '#sec-radar .rdr-act-mute{color:var(--g500);margin-left:auto}',
    '#sec-radar .rdr-more{grid-column:1/-1;border:1px dashed var(--border-med);background:transparent;border-radius:10px;padding:.65rem;font-size:.8rem;color:var(--g600);cursor:pointer;font-family:inherit}',
    '#sec-radar .rdr-none{grid-column:1/-1;text-align:center;padding:2rem;color:var(--g500);font-size:.85rem}',
    '#sec-radar .rdr-empty{text-align:center;padding:3rem 1rem;color:var(--g600)}',
    '#sec-radar .rdr-empty-ico{font-size:2.5rem}',
    '#sec-radar .rdr-empty h3{margin:.5rem 0 .25rem;color:var(--g900);font-size:1rem}',
    '#sec-radar .rdr-empty p{font-size:.85rem;max-width:420px;margin:0 auto 1rem}',
    '@media(max-width:640px){#sec-radar .rdr-list{grid-template-columns:1fr}#sec-radar .rdr-kpis{grid-template-columns:1fr 1fr}}'
  ].join('');

  function injectCSS() {
    if (document.getElementById('rdr-styles')) return;
    var st = document.createElement('style');
    st.id = 'rdr-styles';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  /* ═══════════════════════════════════════════════════════════════════
     API PUBLIQUE
     ═══════════════════════════════════════════════════════════════════ */
  var retryTimer = null;

  function refresh() {
    cfgLoad();
    snoozeLoad();
    data = analyse();
    render();
    // Les ventes se chargent en asynchrone depuis Firestore : on retente
    if (!data.length) {
      var tries = 0;
      clearInterval(retryTimer);
      retryTimer = setInterval(function () {
        tries++;
        data = analyse();
        if (data.length || tries > 12) { clearInterval(retryTimer); render(); }
      }, 1200);
    }
  }

  var API = {
    mount: function () {
      injectCSS();
      MOUNTED = true;
      refresh();
    },
    unmount: function () { MOUNTED = false; clearInterval(retryTimer); },
    refresh: refresh,
    analyse: analyse,
    setFiltre: function (id) { state.filtre = id; state.limit = 25; render(); },
    setSearch: function (v) {
      state.search = v; state.limit = 25;
      render();
      var el = document.getElementById('rdr-search');
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    },
    plus: function () { state.limit += 25; render(); },
    reporter: function (key) {
      snoozeAdd(key, 14);
      if (typeof toast === 'function') toast('Client reporté de 14 jours', 'ok');
    },
    clearSnooze: function () { snooze = {}; snoozeSave(); render(); },
    commande: function (id) {
      if (typeof cdbNewOrder === 'function') cdbNewOrder(id);
      else if (typeof toast === 'function') toast('Module commande indisponible', 'err');
    },
    visite: function (id) {
      if (typeof Visites !== 'undefined') Visites.nouvelle(id);
    },
    fiche: function (id) {
      if (typeof showSection === 'function') showSection('contacts-db', null, null);
      setTimeout(function () { if (typeof cdbOpenEdit === 'function') cdbOpenEdit(id); }, 200);
    },
    config: function (patch) { Object.assign(cfg, patch || {}); cfgSave(); refresh(); }
  };

  global.RadarClients = API;
})(window);
