/* =======================================================================
   crm-data.js  —  Couche d'accès données partagée (MDM V3)  [v2]
   -----------------------------------------------------------------------
   Source unique, mise en cache une seule fois par session -> évite que
   chaque module relise toute la collection `commandes`.
   v2 (santé) : déduplication des lectures concurrentes, préchargement,
   péremption douce du cache (TTL), invalidation ciblée, accès stock.

   Calé sur bdcmdm26 :
     • clients   : bcol('clients')   -> { raison, ville, cp, ... }
     • commandes : bcol('commandes') -> { clientNom, montant, createdAt,
                     lignes:[{code, qty|qt, total_ht|total|pu_ht}] }
       (les BDC ont clientId=null : jointure commande→client par NOM)
     • PRODUCTS  : { code, libelle, ean, pu_ht, stock, ... }
     • stock live : global bdcStockMap {code: dispo}
   Si un module affiche 0 / vide, c'est un nom de champ à ajuster dans CFG.
   ======================================================================= */
(function () {
  'use strict';

  var CFG = {
    client: {
      nom:  ['raison', 'nom', 'enseigne', 'name'],
      ville:['ville', 'city'],
      cp:   ['cp', 'codePostal']
    },
    commande: {
      nom:     ['clientNom', 'raison', 'nom', 'client'],
      montant: ['montant', 'total', 'totalHT', 'ca'],
      date:    ['createdAt', 'date', 'ts'],
      lignes:  ['lignes', 'lines', 'items', 'produits']
    },
    ligne: {
      code:    ['code', 'ref', 'ean'],
      qte:     ['qty', 'qt', 'qte', 'quantite'],
      montant: ['total_ht', 'total', 'montant', 'pu_ht']
    },
    produit: {
      code:    ['code', 'ref'],
      libelle: ['libelle', 'designation', 'nom'],
      ean:     ['ean', 'gencod'],
      prix:    ['pu_ht', 'puHT', 'prix'],
      stock:   ['stock']
    }
  };

  var TTL = 5 * 60 * 1000; // 5 min : au-delà, un nouvel accès relit

  function pick(obj, names) {
    if (!obj) return undefined;
    for (var i = 0; i < names.length; i++) {
      var k = names[i];
      if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
    }
    return undefined;
  }
  function num(v) {
    if (typeof v === 'number') return v;
    if (v == null) return 0;
    var n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
    return isNaN(n) ? 0 : n;
  }
  function norm(s) { return String(s == null ? '' : s).trim(); }
  function slug(s) {
    return norm(s).toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '');
  }

  function normClient(raw, docId) {
    var nom = norm(pick(raw, CFG.client.nom) || docId);
    return { id: norm(docId), key: slug(nom), nom: nom,
             ville: norm(pick(raw, CFG.client.ville) || ''),
             cp: norm(pick(raw, CFG.client.cp) || ''), _raw: raw };
  }
  function normLigne(raw) {
    return { code: norm(pick(raw, CFG.ligne.code)),
             qte: num(pick(raw, CFG.ligne.qte)) || 1,
             montant: num(pick(raw, CFG.ligne.montant)) };
  }
  function normCommande(raw, docId) {
    var lignesRaw = pick(raw, CFG.commande.lignes);
    var lignes = Array.isArray(lignesRaw) ? lignesRaw.map(normLigne).filter(function (l) { return l.code; }) : [];
    var montant = num(pick(raw, CFG.commande.montant));
    if (!montant && lignes.length) montant = lignes.reduce(function (s, l) { return s + l.montant; }, 0);
    var nom = norm(pick(raw, CFG.commande.nom));
    return { id: docId, nom: nom, key: slug(nom),
             date: pick(raw, CFG.commande.date) || null,
             montant: montant, lignes: lignes, _raw: raw };
  }
  function normProduit(raw) {
    var st = pick(raw, CFG.produit.stock);
    return { code: norm(pick(raw, CFG.produit.code)),
             libelle: norm(pick(raw, CFG.produit.libelle)),
             ean: norm(pick(raw, CFG.produit.ean)),
             prix: num(pick(raw, CFG.produit.prix)),
             stock: (st === undefined || st === null) ? null : num(st) };
  }

  // Cache par ressource : { data, at (timestamp), inflight (promesse) }
  var _c = { clients: {}, commandes: {}, catalogue: null };

  function fresh(entry) { return entry && entry.data && (Date.now() - entry.at) < TTL; }

  function loadColl(name, normFn) {
    var entry = _c[name];
    if (fresh(entry)) return Promise.resolve(entry.data);         // cache chaud
    if (entry.inflight) return entry.inflight;                    // lecture déjà en cours -> on la partage
    entry.inflight = (async function () {
      var out = [];
      try {
        var snap = await bcol(name).get();
        snap.forEach(function (d) { out.push(normFn(d.data(), d.id)); });
      } catch (e) { console.warn('[CRMData] ' + name + ':', e && e.message); }
      entry.data = out; entry.at = Date.now(); entry.inflight = null;
      return out;
    })();
    return entry.inflight;
  }

  function clients(force) { if (force) _c.clients = {}; return loadColl('clients', normClient); }
  function commandes(force) { if (force) _c.commandes = {}; return loadColl('commandes', normCommande); }

  function catalogue() {
    if (_c.catalogue) return _c.catalogue;
    var src = (typeof PRODUCTS !== 'undefined' && Array.isArray(PRODUCTS)) ? PRODUCTS : [];
    _c.catalogue = src.map(normProduit).filter(function (p) { return p.code; });
    return _c.catalogue;
  }
  function catalogueMap() {
    var m = {}; catalogue().forEach(function (p) { m[p.code] = p; }); return m;
  }

  // Stock disponible d'un code : bdcStockMap (live) puis stock catalogue. null = inconnu.
  function stockDispo(code) {
    try {
      if (typeof bdcStockMap !== 'undefined' && bdcStockMap && bdcStockMap[code] !== undefined) return num(bdcStockMap[code]);
    } catch (e) {}
    var p = catalogueMap()[code];
    return (p && p.stock != null) ? p.stock : null;
  }

  function cmDate(v) {
    if (!v) return null;
    if (v.toDate) { try { return v.toDate(); } catch (e) {} }
    if (v.seconds) return new Date(v.seconds * 1000);
    if (typeof v === 'number') return new Date(v);
    var d = new Date(v); return isNaN(d) ? null : d;
  }

  async function caParMois() {
    var cmds = await commandes();
    var acc = {};
    cmds.forEach(function (c) {
      var d = cmDate(c.date);
      var k = d ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') : '?';
      acc[k] = (acc[k] || 0) + c.montant;
    });
    return acc;
  }

  async function commandesParClient() {
    var cmds = await commandes();
    var acc = {};
    cmds.forEach(function (c) { if (c.key) (acc[c.key] = acc[c.key] || []).push(c); });
    return acc;
  }

  async function codesCommandesParClient() {
    var cmds = await commandes();
    var acc = {};
    cmds.forEach(function (c) {
      if (!c.key) return;
      var set = acc[c.key] || (acc[c.key] = {});
      c.lignes.forEach(function (l) { set[l.code] = (set[l.code] || 0) + l.qte; });
    });
    return acc;
  }

  async function popularite() {
    var byClient = await codesCommandesParClient();
    var pop = {};
    Object.keys(byClient).forEach(function (k) {
      Object.keys(byClient[k]).forEach(function (code) { pop[code] = (pop[code] || 0) + 1; });
    });
    return pop;
  }

  function median(arr) {
    if (!arr.length) return 0;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
  }

  // Commande type d'un client : par code -> {qte suggérée, fréquence, nbFois, dernière qté}
  async function paniersType(clientKey) {
    var parClient = await commandesParClient();
    var cmds = (parClient[clientKey] || []).filter(function (c) { return c.lignes.length; });
    var nbCmd = cmds.length;
    if (!nbCmd) return { nbCmd: 0, lignes: [] };
    var byCode = {};
    cmds.forEach(function (c) {
      var dt = cmDate(c.date) || new Date(0);
      c.lignes.forEach(function (l) {
        var e = byCode[l.code] || (byCode[l.code] = { code: l.code, qtes: [], nb: 0, lastDt: new Date(0), lastQte: 0 });
        e.qtes.push(l.qte); e.nb++;
        if (dt >= e.lastDt) { e.lastDt = dt; e.lastQte = l.qte; }
      });
    });
    var lignes = Object.keys(byCode).map(function (code) {
      var e = byCode[code];
      return { code: code, qte: median(e.qtes) || e.lastQte || 1,
               nbFois: e.nb, freq: e.nb / nbCmd, lastQte: e.lastQte, lastDt: e.lastDt };
    });
    lignes.sort(function (a, b) { return b.freq - a.freq || b.nbFois - a.nbFois; });
    return { nbCmd: nbCmd, lignes: lignes };
  }

  // Préchargement après login (les 3 sources), pour que le 1er onglet soit instantané.
  function preload() {
    try { catalogue(); clients(); commandes(); } catch (e) {}
  }
  // Invalidation ciblée : invalidate('commandes') ou invalidate() (tout).
  function invalidate(name) {
    if (name === 'clients' || name === 'commandes') _c[name] = {};
    else if (name === 'catalogue') _c.catalogue = null;
    else _c = { clients: {}, commandes: {}, catalogue: null };
  }

  window.CRMData = {
    CFG: CFG,
    invalidate: invalidate,
    preload: preload,
    clients: clients,
    commandes: commandes,
    catalogue: catalogue,
    catalogueMap: catalogueMap,
    stockDispo: stockDispo,
    caParMois: caParMois,
    commandesParClient: commandesParClient,
    codesCommandesParClient: codesCommandesParClient,
    popularite: popularite,
    paniersType: paniersType,
    _pick: pick, _num: num, _norm: norm, _slug: slug, _date: cmDate
  };
})();
