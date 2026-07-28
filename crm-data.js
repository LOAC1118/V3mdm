/* =======================================================================
   crm-data.js  —  Couche d'accès données partagée (MDM V3)
   -----------------------------------------------------------------------
   Calé sur les vraies structures de bdcmdm26 :
     • clients   : bcol('clients')   -> { raison, ville, cp, ... }
     • commandes : bcol('commandes') -> { clientNom, numClient, montant,
                     createdAt, lignes:[{code, qty|qt, total_ht|total|pu_ht}] }
       (les commandes BDC ont clientId=null : on relie au client par NOM)
     • PRODUCTS  : { code, libelle, ean, pu_ht, stock, ... } (pas de catégorie)

   Si un module affiche 0 / vide, c'est un nom de champ à ajuster dans CFG.
   Dépend des globales : bcol(name), PRODUCTS.
   ======================================================================= */
(function () {
  'use strict';

  var CFG = {
    client: {
      id:   ['id'],
      nom:  ['raison', 'nom', 'enseigne', 'name'],
      ville:['ville', 'city'],
      cp:   ['cp', 'codePostal']
    },
    commande: {
      nom:     ['clientNom', 'raison', 'nom', 'client'],     // nom du magasin/client
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
      prix:    ['pu_ht', 'puHT', 'prix']
    }
  };

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
    return {
      id:    norm(docId),
      key:   slug(nom),                    // clé de jointure = slug du nom
      nom:   nom,
      ville: norm(pick(raw, CFG.client.ville) || ''),
      cp:    norm(pick(raw, CFG.client.cp) || ''),
      _raw: raw
    };
  }
  function normLigne(raw) {
    return {
      code:    norm(pick(raw, CFG.ligne.code)),
      qte:     num(pick(raw, CFG.ligne.qte)) || 1,
      montant: num(pick(raw, CFG.ligne.montant))
    };
  }
  function normCommande(raw, docId) {
    var lignesRaw = pick(raw, CFG.commande.lignes);
    var lignes = [];
    if (Array.isArray(lignesRaw)) {
      lignes = lignesRaw.map(normLigne).filter(function (l) { return l.code; });
    }
    var montant = num(pick(raw, CFG.commande.montant));
    if (!montant && lignes.length) {
      montant = lignes.reduce(function (s, l) { return s + l.montant; }, 0);
    }
    var nom = norm(pick(raw, CFG.commande.nom));
    return {
      id:      docId,
      nom:     nom,
      key:     slug(nom),                  // relie à client.key
      date:    pick(raw, CFG.commande.date) || null,
      montant: montant,
      lignes:  lignes,
      _raw: raw
    };
  }
  function normProduit(raw) {
    return {
      code:    norm(pick(raw, CFG.produit.code)),
      libelle: norm(pick(raw, CFG.produit.libelle)),
      ean:     norm(pick(raw, CFG.produit.ean)),
      prix:    num(pick(raw, CFG.produit.prix))
    };
  }

  var _cache = { clients: null, commandes: null, catalogue: null };
  function invalidate() { _cache = { clients: null, commandes: null, catalogue: null }; }

  async function clients(force) {
    if (_cache.clients && !force) return _cache.clients;
    var out = [];
    try {
      var snap = await bcol('clients').get();
      snap.forEach(function (d) { out.push(normClient(d.data(), d.id)); });
    } catch (e) { console.warn('[CRMData] clients:', e && e.message); }
    _cache.clients = out;
    return out;
  }

  async function commandes(force) {
    if (_cache.commandes && !force) return _cache.commandes;
    var out = [];
    try {
      var snap = await bcol('commandes').get();
      snap.forEach(function (d) { out.push(normCommande(d.data(), d.id)); });
    } catch (e) { console.warn('[CRMData] commandes:', e && e.message); }
    _cache.commandes = out;
    return out;
  }

  function catalogue() {
    if (_cache.catalogue) return _cache.catalogue;
    var src = (typeof PRODUCTS !== 'undefined' && Array.isArray(PRODUCTS)) ? PRODUCTS : [];
    _cache.catalogue = src.map(normProduit).filter(function (p) { return p.code; });
    return _cache.catalogue;
  }
  function catalogueMap() {
    var m = {};
    catalogue().forEach(function (p) { m[p.code] = p; });
    return m;
  }

  function cmDate(v) {
    if (!v) return null;
    if (v.toDate) { try { return v.toDate(); } catch (e) {} }
    if (v.seconds) return new Date(v.seconds * 1000);
    if (typeof v === 'number') return new Date(v);
    var d = new Date(v); return isNaN(d) ? null : d;
  }

  // CA par mois "YYYY-MM" -> montant (d'après createdAt)
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

  // Commandes par client -> { clientKey: [commandes] }
  async function commandesParClient() {
    var cmds = await commandes();
    var acc = {};
    cmds.forEach(function (c) {
      if (!c.key) return;
      (acc[c.key] = acc[c.key] || []).push(c);
    });
    return acc;
  }

  // Codes commandés par client -> { clientKey: { code: qteCumulée } }
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

  // Popularité produit = nb de clients distincts l'ayant commandé
  async function popularite() {
    var byClient = await codesCommandesParClient();
    var pop = {};
    Object.keys(byClient).forEach(function (k) {
      Object.keys(byClient[k]).forEach(function (code) {
        pop[code] = (pop[code] || 0) + 1;
      });
    });
    return pop;
  }

  window.CRMData = {
    CFG: CFG,
    invalidate: invalidate,
    clients: clients,
    commandes: commandes,
    catalogue: catalogue,
    catalogueMap: catalogueMap,
    caParMois: caParMois,
    commandesParClient: commandesParClient,
    codesCommandesParClient: codesCommandesParClient,
    popularite: popularite,
    _pick: pick, _num: num, _norm: norm, _slug: slug, _date: cmDate
  };
})();
