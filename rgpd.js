/* ═══════════════════════════════════════════════════════════════════════
   CONFORMITÉ — outils RGPD opérationnels
   ───────────────────────────────────────────────────────────────────────
   Ce module fournit les CAPACITÉS TECHNIQUES qu'exige la conformité :
     · droit d'accès et portabilité  → export complet d'une personne
     · droit d'effacement            → suppression des données relationnelles
     · durées de conservation        → revue des contacts dormants
     · registre des traitements      → généré depuis les données réelles

   ⚠️ Il ne rend PAS conforme à lui seul. La conformité suppose aussi un
      registre tenu à jour, des mentions d'information diffusées, et un
      contrat de sous-traitance signé avec chaque client. Voir CONFORMITE.md

   API : RGPD.mount()
   ═══════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  // Recommandation CNIL pour la prospection commerciale B2B
  var CONSERVATION_MOIS = 36;
  // Obligation comptable française (code de commerce, art. L123-22)
  var CONSERVATION_COMPTABLE_ANS = 10;

  var state = { vue: 'personne', recherche: '', cible: null, dossier: null, dormants: null };

  /* ═══ Utilitaires ═════════════════════════════════════════════════ */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function normName(s) {
    return String(s || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ').trim();
  }
  function normCode(s) {
    var t = String(s || '').trim();
    if (t.endsWith('.0')) t = t.slice(0, -2);
    return t.replace(/^0+/, '') || t;
  }
  function jour(ts) {
    if (!ts) return '—';
    try { return new Date(ts).toLocaleDateString('fr-FR'); } catch (e) { return '—'; }
  }
  function toast(m, t) { if (typeof global.toast === 'function') global.toast(m, t); }
  function contacts() {
    return (typeof cdbContacts !== 'undefined' && cdbContacts) ? cdbContacts : [];
  }
  function marque() {
    return (typeof CURRENT_BRAND !== 'undefined' && CURRENT_BRAND === 'naturaline')
      ? 'NATURALINE' : 'Moulin des Moines';
  }

  /* ═══════════════════════════════════════════════════════════════════
     CONSTITUTION DU DOSSIER D'UNE PERSONNE
     Rassemble tout ce que le CRM détient sur elle, toutes collections.
     ═══════════════════════════════════════════════════════════════════ */
  function construireDossier(contactId, cb) {
    var c = contacts().find(function (x) { return x.id === contactId; });
    if (!c) { cb(null); return; }

    var dossier = {
      genereLe: new Date().toISOString(),
      marque: marque(),
      fiche: c,
      visites: [],
      photos: 0,
      cadenciers: [],
      commandes: [],
      caLignes: []
    };

    // Historique commercial : déjà en mémoire (commandes_stats)
    if (typeof dashCaRows !== 'undefined' && dashCaRows) {
      var nk = normName(c.nom), code = normCode(c.numClient);
      dossier.caLignes = dashCaRows.filter(function (r) {
        if (code && normCode(r.codeClient) === code) return true;
        return nk && normName(r.client) === nk;
      });
    }

    if (typeof db === 'undefined' || !db) { cb(dossier); return; }

    var restant = 3;
    function fini() { if (--restant === 0) cb(dossier); }

    bcol('visites').where('clientId', '==', contactId).get()
      .then(function (snap) {
        snap.forEach(function (d) { var v = d.data(); v.id = d.id; dossier.visites.push(v); });
        dossier.photos = dossier.visites.reduce(function (s, v) { return s + (v.nbPhotos || 0); }, 0);
        fini();
      }).catch(fini);

    bcol('cadenciers').get()
      .then(function (snap) {
        snap.forEach(function (d) {
          var v = d.data();
          if (normName(v.client) === normName(c.nom)) { v.id = d.id; dossier.cadenciers.push(v); }
        });
        fini();
      }).catch(fini);

    bcol('commandes').get()
      .then(function (snap) {
        snap.forEach(function (d) {
          var v = d.data();
          var nom = v.magasin || v.client || '';
          if (normName(nom) === normName(c.nom)) { dossier.commandes.push({ id: d.id, date: v.createdAt, nb: (v.lignes || []).length }); }
        });
        fini();
      }).catch(fini);
  }

  /* ═══ Export portabilité (JSON) ═══════════════════════════════════ */
  function exporterJson() {
    if (!state.dossier) return;
    var blob = new Blob([JSON.stringify(state.dossier, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'donnees_' + normName(state.dossier.fiche.nom).replace(/[^a-z0-9]+/g, '_') + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
    journaliser('Export des données', state.dossier.fiche.nom);
  }

  /* ═══ Export portabilité (PDF lisible) ════════════════════════════ */
  function exporterPdf() {
    if (!state.dossier) return;
    if (typeof withJsPdf !== 'function') { toast('Générateur PDF indisponible', 'err'); return; }
    withJsPdf(function () {
      var d = state.dossier, c = d.fiche;
      var doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
      var W = 210, M = 18, y = M;

      doc.setFillColor(4, 44, 83); doc.rect(0, 0, W, 24, 'F');
      doc.setTextColor(255); doc.setFontSize(14); doc.setFont(undefined, 'bold');
      doc.text('Données personnelles détenues', M, 12);
      doc.setFontSize(9); doc.setFont(undefined, 'normal');
      doc.text(marque() + '  ·  édité le ' + jour(Date.now()), M, 19);
      y = 34;

      function titre(t) {
        if (y > 260) { doc.addPage(); y = M; }
        doc.setTextColor(4, 44, 83); doc.setFontSize(11); doc.setFont(undefined, 'bold');
        doc.text(t, M, y); y += 6;
        doc.setFont(undefined, 'normal'); doc.setFontSize(9.5); doc.setTextColor(40);
      }
      function ligne(l, v) {
        if (v == null || v === '') return;
        if (y > 275) { doc.addPage(); y = M; }
        doc.setTextColor(120); doc.text(l, M, y);
        doc.setTextColor(30); doc.text(String(v), M + 42, y);
        y += 5;
      }

      titre('Identification');
      ligne('Raison sociale', c.nom);
      ligne('Code client', c.numClient);
      ligne('Contact', c.contact);
      ligne('Email', c.email);
      ligne('Téléphone', c.telephone);
      ligne('Adresse', [c.adresse, c.cp, c.ville].filter(Boolean).join(', '));
      ligne('Groupe / réseau', c.groupe);
      ligne('Statut', c.prospect ? 'Prospect' : 'Client');
      if (typeof c.lat === 'number') ligne('Coordonnées', c.lat.toFixed(5) + ', ' + c.lng.toFixed(5));
      y += 4;

      titre('Comptes rendus de visite');
      if (!d.visites.length) { ligne('', 'Aucun'); }
      else d.visites.forEach(function (v) {
        if (y > 270) { doc.addPage(); y = M; }
        doc.setTextColor(30);
        doc.text('• ' + jour(v.date) + ' — ' + (v.type || 'Visite') + (v.objet ? ' : ' + v.objet : ''), M, y);
        y += 5;
        if (v.compteRendu) {
          doc.setTextColor(90); doc.setFontSize(8.5);
          doc.splitTextToSize(v.compteRendu, W - 2 * M - 4).forEach(function (l) {
            if (y > 278) { doc.addPage(); y = M; }
            doc.text(l, M + 4, y); y += 4;
          });
          doc.setFontSize(9.5);
        }
        y += 2;
      });
      y += 4;

      titre('Historique commercial');
      ligne('Commandes enregistrées', d.commandes.length);
      ligne('Lignes de chiffre d\'affaires', d.caLignes.length);
      ligne('Cadenciers', d.cadenciers.length);
      ligne('Photos rattachées', d.photos);
      y += 6;

      if (y > 250) { doc.addPage(); y = M; }
      doc.setDrawColor(200); doc.setFillColor(248, 250, 252);
      doc.roundedRect(M, y, W - 2 * M, 26, 2, 2, 'FD');
      doc.setFontSize(8); doc.setTextColor(90);
      doc.splitTextToSize(
        'Ce document recense les données détenues dans le CRM à la date d\'édition. ' +
        'Les pièces comptables (commandes, factures) sont conservées ' + CONSERVATION_COMPTABLE_ANS +
        ' ans au titre des obligations légales et ne peuvent être supprimées avant ce terme.',
        W - 2 * M - 8).forEach(function (l, i) { doc.text(l, M + 4, y + 6 + i * 4); });

      doc.save('donnees_' + normName(c.nom).replace(/[^a-z0-9]+/g, '_') + '.pdf');
      journaliser('Export PDF des données', c.nom);
      toast('✅ Document généré', 'ok');
    }, function () { toast('Impossible de charger le générateur PDF', 'err'); });
  }

  /* ═══════════════════════════════════════════════════════════════════
     DROIT À L'EFFACEMENT
     Supprime les données relationnelles. Conserve les pièces comptables.
     ═══════════════════════════════════════════════════════════════════ */
  function supprimer() {
    var d = state.dossier;
    if (!d) return;
    var c = d.fiche;

    var saisie = prompt(
      'Suppression définitive des données de :\n\n' + c.nom + '\n\n' +
      'Seront supprimés : la fiche, ' + d.visites.length + ' compte(s) rendu(s), ' +
      d.photos + ' photo(s), ' + d.cadenciers.length + ' cadencier(s).\n\n' +
      'Seront CONSERVÉS : ' + d.commandes.length + ' commande(s) et ' + d.caLignes.length +
      ' ligne(s) de CA — pièces comptables, conservation légale de ' + CONSERVATION_COMPTABLE_ANS + ' ans.\n\n' +
      'Pour confirmer, recopie le nom exactement :');

    if (saisie === null) return;
    if (normName(saisie) !== normName(c.nom)) { toast('Nom incorrect, suppression annulée', 'err'); return; }
    if (typeof db === 'undefined' || !db) { toast('Non connecté', 'err'); return; }

    var taches = [];

    // Photos puis comptes rendus
    d.visites.forEach(function (v) {
      taches.push(
        bcol('visites_photos').where('visiteId', '==', v.id).get().then(function (snap) {
          var sup = [];
          snap.forEach(function (p) { sup.push(bcol('visites_photos').doc(p.id).delete()); });
          return Promise.all(sup);
        }).then(function () { return bcol('visites').doc(v.id).delete(); })
      );
    });

    d.cadenciers.forEach(function (cd) {
      taches.push(bcol('cadenciers').doc(cd.id).delete());
    });

    taches.push(bcol('contacts').doc(c.id).delete());

    Promise.all(taches)
      .then(function () {
        var i = contacts().findIndex(function (x) { return x.id === c.id; });
        if (i >= 0) cdbContacts.splice(i, 1);
        try { localStorage.setItem(CDB_CACHE_KEY(), JSON.stringify(cdbContacts)); } catch (e) {}
        journaliser('Effacement des données', c.nom);
        toast('✅ Données supprimées', 'ok');
        state.dossier = null; state.cible = null;
        render();
        if (typeof cdbRenderPage === 'function') try { cdbRenderPage(); } catch (e) {}
      })
      .catch(function (e) { toast('Erreur : ' + e.message, 'err'); });
  }

  /* ═══ Journalisation (traçabilité des demandes traitées) ══════════ */
  function journaliser(action, sujet) {
    if (typeof logActivite === 'function') {
      try { logActivite('RGPD — ' + action + ' : ' + sujet, 'violet'); } catch (e) {}
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
     REVUE DES DURÉES DE CONSERVATION
     ═══════════════════════════════════════════════════════════════════ */
  function calculerDormants() {
    var limite = Date.now() - CONSERVATION_MOIS * 30.44 * 24 * 3600 * 1000;
    var parClient = {};

    if (typeof dashCaRows !== 'undefined' && dashCaRows) {
      dashCaRows.forEach(function (r) {
        if (r.statut === 'avoir') return;
        var d = r.dateCmd || r.dateFac || r.dateLiv || r.dateRef;
        var t = d ? new Date(d).getTime() : 0;
        if (!t) return;
        var k = normCode(r.codeClient) || normName(r.client);
        if (!parClient[k] || t > parClient[k]) parClient[k] = t;
      });
    }

    var visitesPar = {};
    (state.visitesCache || []).forEach(function (v) {
      if (!v.clientId) return;
      if (!visitesPar[v.clientId] || v.date > visitesPar[v.clientId]) visitesPar[v.clientId] = v.date;
    });

    return contacts().map(function (c) {
      var k = normCode(c.numClient) || normName(c.nom);
      var dernier = Math.max(parClient[k] || 0, visitesPar[c.id] || 0);
      return { c: c, dernier: dernier };
    }).filter(function (x) {
      return x.dernier < limite;
    }).sort(function (a, b) { return a.dernier - b.dernier; });
  }

  function chargerVisitesCache(cb) {
    if (state.visitesCache) { cb(); return; }
    if (typeof db === 'undefined' || !db) { state.visitesCache = []; cb(); return; }
    bcol('visites').get().then(function (snap) {
      state.visitesCache = [];
      snap.forEach(function (d) { var v = d.data(); v.id = d.id; state.visitesCache.push(v); });
      cb();
    }).catch(function () { state.visitesCache = []; cb(); });
  }

  /* ═══════════════════════════════════════════════════════════════════
     REGISTRE DES TRAITEMENTS
     Pré-rempli à partir des traitements réellement présents dans l'app.
     ═══════════════════════════════════════════════════════════════════ */
  function traitements() {
    var nbContacts = contacts().length;
    var nbGeo = contacts().filter(function (c) { return typeof c.lat === 'number'; }).length;
    return [
      {
        nom: 'Gestion de la relation client et prospection',
        finalite: 'Suivi commercial des clients et prospects, prise de commande, facturation',
        base: 'Intérêt légitime (prospection B2B) / exécution du contrat pour les clients',
        personnes: 'Contacts professionnels des clients et prospects',
        categories: 'Raison sociale, nom du contact, email, téléphone, adresse postale, historique de commandes',
        volume: nbContacts + ' fiches',
        conservation: CONSERVATION_MOIS + ' mois après le dernier contact (prospects) ; durée de la relation puis ' +
                      CONSERVATION_COMPTABLE_ANS + ' ans pour les pièces comptables',
        destinataires: 'Commercial concerné, direction',
        soustraitants: 'Google Firebase (hébergement)'
      },
      {
        nom: 'Comptes rendus de visite',
        finalite: 'Historisation des échanges commerciaux, préparation des visites suivantes',
        base: 'Intérêt légitime',
        personnes: 'Contacts professionnels des clients et prospects',
        categories: 'Notes de visite en texte libre, photographies de points de vente, étiquettes de qualification',
        volume: (state.visitesCache ? state.visitesCache.length + ' comptes rendus' : 'à calculer'),
        conservation: CONSERVATION_MOIS + ' mois après le dernier contact',
        destinataires: 'Commercial rédacteur, direction',
        soustraitants: 'Google Firebase (hébergement)',
        vigilance: 'Texte libre : risque de commentaires excessifs ou subjectifs. Mention de rappel affichée à la saisie.'
      },
      {
        nom: 'Géolocalisation des points de vente',
        finalite: 'Organisation des tournées commerciales',
        base: 'Intérêt légitime',
        personnes: 'Établissements clients et prospects',
        categories: 'Coordonnées géographiques de l\'adresse professionnelle',
        volume: nbGeo + ' établissements géocodés',
        conservation: 'Identique à la fiche client',
        destinataires: 'Commercial concerné',
        soustraitants: 'API Adresse (DINUM, France) pour le géocodage ; OpenStreetMap pour le fond de carte',
        vigilance: 'Ce traitement porte sur des ADRESSES D\'ÉTABLISSEMENTS, non sur la position des salariés. ' +
                   'Toute évolution permettant à un tiers de suivre la position d\'un commercial relèverait de la ' +
                   'géolocalisation de salariés : information individuelle, consultation du CSE et analyse d\'impact.'
      },
      {
        nom: 'Gestion des comptes utilisateurs',
        finalite: 'Authentification et attribution des droits d\'accès',
        base: 'Exécution du contrat de travail / de prestation',
        personnes: 'Utilisateurs du CRM',
        categories: 'Nom, email, rôle, date de création, journal d\'activité',
        volume: 'Variable',
        conservation: 'Durée de la relation puis suppression',
        destinataires: 'Administrateur',
        soustraitants: 'Google Firebase Authentication'
      }
    ];
  }

  function registrePdf() {
    if (typeof withJsPdf !== 'function') { toast('Générateur PDF indisponible', 'err'); return; }
    withJsPdf(function () {
      var doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
      var W = 210, M = 16, y = M;

      doc.setFillColor(4, 44, 83); doc.rect(0, 0, W, 24, 'F');
      doc.setTextColor(255); doc.setFontSize(14); doc.setFont(undefined, 'bold');
      doc.text('Registre des activités de traitement', M, 12);
      doc.setFontSize(9); doc.setFont(undefined, 'normal');
      doc.text(marque() + '  ·  version du ' + jour(Date.now()), M, 19);
      y = 32;

      doc.setFontSize(8); doc.setTextColor(120);
      doc.splitTextToSize(
        'Document de travail généré depuis le CRM. À compléter (identité du responsable de traitement, ' +
        'coordonnées, mesures de sécurité détaillées) et à faire valider avant usage officiel.',
        W - 2 * M).forEach(function (l) { doc.text(l, M, y); y += 4; });
      y += 6;

      traitements().forEach(function (t, i) {
        if (y > 240) { doc.addPage(); y = M; }
        doc.setFillColor(238, 244, 251);
        doc.rect(M, y - 4.5, W - 2 * M, 7, 'F');
        doc.setTextColor(4, 44, 83); doc.setFontSize(10); doc.setFont(undefined, 'bold');
        doc.text((i + 1) + '. ' + t.nom, M + 2, y); y += 8;

        doc.setFont(undefined, 'normal'); doc.setFontSize(8.5);
        [['Finalité', t.finalite], ['Base légale', t.base], ['Personnes concernées', t.personnes],
         ['Données traitées', t.categories], ['Volume', t.volume], ['Conservation', t.conservation],
         ['Destinataires', t.destinataires], ['Sous-traitants', t.soustraitants],
         ['Point de vigilance', t.vigilance]].forEach(function (p) {
          if (!p[1]) return;
          if (y > 275) { doc.addPage(); y = M; }
          doc.setTextColor(120); doc.text(p[0], M + 2, y);
          doc.setTextColor(p[0] === 'Point de vigilance' ? 180 : 30, p[0] === 'Point de vigilance' ? 90 : 30, 30);
          var lignes = doc.splitTextToSize(String(p[1]), W - 2 * M - 46);
          lignes.forEach(function (l, k) {
            if (y > 278) { doc.addPage(); y = M; }
            doc.text(l, M + 46, y); if (k < lignes.length - 1) y += 4;
          });
          y += 5.5;
        });
        y += 4;
      });

      doc.save('registre_traitements_' + normName(marque()).replace(/[^a-z0-9]+/g, '_') + '.pdf');
      toast('✅ Registre généré', 'ok');
    }, function () { toast('Impossible de charger le générateur PDF', 'err'); });
  }

  /* ═══ Rendu ═══════════════════════════════════════════════════════ */
  function render() {
    var root = document.getElementById('rgpd-root');
    if (!root) return;

    var onglets = [['personne', '👤 Droits des personnes'],
                   ['conservation', '🗓️ Durées de conservation'],
                   ['registre', '📋 Registre des traitements']]
      .map(function (o) {
        return '<button class="rgp-tab' + (state.vue === o[0] ? ' on' : '') +
               '" onclick="RGPD.vue(\'' + o[0] + '\')">' + o[1] + '</button>';
      }).join('');

    var corps = state.vue === 'personne' ? vuePersonne()
              : state.vue === 'conservation' ? vueConservation()
              : vueRegistre();

    root.innerHTML = '<div class="rgp-tabs">' + onglets + '</div>' + corps;
  }

  function vuePersonne() {
    var q = normName(state.recherche);
    var res = q ? contacts().filter(function (c) {
      return normName(c.nom).indexOf(q) >= 0 ||
             normName(c.email).indexOf(q) >= 0 ||
             String(c.numClient || '').indexOf(state.recherche.trim()) >= 0;
    }).slice(0, 8) : [];

    var html =
      '<div class="rgp-intro">Recherche une personne pour répondre à une demande d\'accès, ' +
      'de portabilité ou d\'effacement. L\'export rassemble tout ce que le CRM détient sur elle.</div>' +
      '<input class="rgp-input" type="search" placeholder="Nom, email ou code client…" ' +
      'value="' + esc(state.recherche) + '" oninput="RGPD.chercher(this.value)">';

    if (res.length) {
      html += '<div class="rgp-res">' + res.map(function (c) {
        return '<button class="rgp-res-i" onclick="RGPD.dossier(\'' + esc(c.id) + '\')">' +
          '<strong>' + esc(c.nom) + '</strong>' +
          '<span>' + esc([c.numClient, c.email, c.ville].filter(Boolean).join(' · ')) + '</span></button>';
      }).join('') + '</div>';
    } else if (state.recherche && !state.dossier) {
      html += '<div class="rgp-vide">Aucun résultat</div>';
    }

    if (state.dossier) {
      var d = state.dossier, c = d.fiche;
      html +=
        '<div class="rgp-dossier">' +
          '<div class="rgp-dossier-h"><strong>' + esc(c.nom) + '</strong>' +
            '<button class="rgp-btn" onclick="RGPD.fermer()">Fermer</button></div>' +

          '<div class="rgp-bloc">' +
            '<div class="rgp-bloc-t">Données supprimables sur demande</div>' +
            '<ul>' +
              '<li>Fiche client : identité, coordonnées, adresse' +
                (typeof c.lat === 'number' ? ', coordonnées géographiques' : '') + '</li>' +
              '<li>' + d.visites.length + ' compte(s) rendu(s) de visite, ' + d.photos + ' photo(s)</li>' +
              '<li>' + d.cadenciers.length + ' cadencier(s)</li>' +
            '</ul>' +
          '</div>' +

          '<div class="rgp-bloc rgp-bloc-legal">' +
            '<div class="rgp-bloc-t">Données conservées malgré une demande d\'effacement</div>' +
            '<ul>' +
              '<li>' + d.commandes.length + ' commande(s)</li>' +
              '<li>' + d.caLignes.length + ' ligne(s) de chiffre d\'affaires</li>' +
            '</ul>' +
            '<p>Pièces comptables : conservation obligatoire de ' + CONSERVATION_COMPTABLE_ANS +
            ' ans (code de commerce, art. L123-22). Le droit à l\'effacement ne s\'y applique pas. ' +
            'La personne doit en être informée dans ta réponse.</p>' +
          '</div>' +

          '<div class="rgp-acts">' +
            '<button class="rgp-btn rgp-btn-p" onclick="RGPD.exporterPdf()">📄 Export PDF (droit d\'accès)</button>' +
            '<button class="rgp-btn" onclick="RGPD.exporterJson()">⬇️ Export JSON (portabilité)</button>' +
            '<button class="rgp-btn rgp-btn-d" onclick="RGPD.supprimer()">🗑 Effacer les données</button>' +
          '</div>' +
        '</div>';
    }
    return html;
  }

  function vueConservation() {
    if (!state.dormants) {
      chargerVisitesCache(function () { state.dormants = calculerDormants(); render(); });
      return '<div class="rgp-vide">Analyse en cours…</div>';
    }
    var d = state.dormants;
    var html =
      '<div class="rgp-intro">La CNIL recommande de ne pas conserver les données de prospection ' +
      'au-delà de <strong>' + CONSERVATION_MOIS + ' mois sans contact</strong>. Voici les fiches concernées : ' +
      'à supprimer, ou à requalifier si la relation est toujours active hors CRM.</div>';

    if (!d.length) return html + '<div class="rgp-ok">✅ Aucune fiche ne dépasse la durée recommandée.</div>';

    html += '<div class="rgp-compte">' + d.length + ' fiche(s) sans activité depuis plus de ' +
            CONSERVATION_MOIS + ' mois</div><div class="rgp-liste">';
    html += d.slice(0, 100).map(function (x) {
      return '<div class="rgp-l">' +
        '<div><strong>' + esc(x.c.nom) + '</strong>' +
        '<span>' + esc([x.c.numClient, x.c.ville].filter(Boolean).join(' · ')) +
        (x.c.prospect ? ' · prospect' : '') + '</span></div>' +
        '<div class="rgp-l-d">' + (x.dernier ? 'dernier contact ' + jour(x.dernier) : 'aucun contact enregistré') + '</div>' +
        '<button class="rgp-btn" onclick="RGPD.dossier(\'' + esc(x.c.id) + '\')">Examiner</button>' +
      '</div>';
    }).join('') + '</div>';
    if (d.length > 100) html += '<div class="rgp-vide">… et ' + (d.length - 100) + ' autres</div>';
    return html;
  }

  function vueRegistre() {
    var html =
      '<div class="rgp-intro">Registre pré-rempli à partir des traitements réellement présents dans ton CRM. ' +
      'Il te reste à compléter l\'identité du responsable de traitement et le détail des mesures de sécurité, ' +
      'puis à le faire valider.</div>' +
      '<button class="rgp-btn rgp-btn-p" onclick="RGPD.registrePdf()">📄 Exporter le registre en PDF</button>' +
      '<div class="rgp-reg">';

    traitements().forEach(function (t, i) {
      html += '<div class="rgp-t">' +
        '<div class="rgp-t-h">' + (i + 1) + '. ' + esc(t.nom) + '</div>' +
        '<dl>' +
          '<dt>Finalité</dt><dd>' + esc(t.finalite) + '</dd>' +
          '<dt>Base légale</dt><dd>' + esc(t.base) + '</dd>' +
          '<dt>Données</dt><dd>' + esc(t.categories) + '</dd>' +
          '<dt>Volume</dt><dd>' + esc(t.volume) + '</dd>' +
          '<dt>Conservation</dt><dd>' + esc(t.conservation) + '</dd>' +
          '<dt>Sous-traitants</dt><dd>' + esc(t.soustraitants) + '</dd>' +
        '</dl>' +
        (t.vigilance ? '<div class="rgp-vig">⚠️ ' + esc(t.vigilance) + '</div>' : '') +
      '</div>';
    });
    return html + '</div>';
  }

  /* ═══ Styles ══════════════════════════════════════════════════════ */
  var CSS = [
    '#sec-rgpd .rgp-tabs{display:flex;gap:.3rem;flex-wrap:wrap;margin-bottom:1rem;border-bottom:1px solid var(--border);padding-bottom:.6rem}',
    '#sec-rgpd .rgp-tab{border:1px solid var(--border-med);background:var(--surface);color:var(--g600);border-radius:9px;padding:.45rem .8rem;font-size:.79rem;font-weight:600;cursor:pointer;font-family:inherit}',
    '#sec-rgpd .rgp-tab.on{background:var(--blue-p700);border-color:var(--blue-p700);color:#fff}',
    '#sec-rgpd .rgp-intro{font-size:.83rem;color:var(--g600);line-height:1.55;margin-bottom:.9rem;max-width:760px}',
    '#sec-rgpd .rgp-input{width:100%;max-width:440px;border:1px solid var(--border-med);border-radius:10px;padding:.55rem .8rem;font-size:.88rem;font-family:inherit;background:var(--surface);color:var(--g900)}',
    '#sec-rgpd .rgp-res{display:flex;flex-direction:column;gap:.3rem;margin-top:.5rem;max-width:440px}',
    '#sec-rgpd .rgp-res-i{display:flex;flex-direction:column;align-items:flex-start;gap:.1rem;text-align:left;border:1px solid var(--border);background:var(--surface);border-radius:9px;padding:.5rem .7rem;cursor:pointer;font-family:inherit}',
    '#sec-rgpd .rgp-res-i strong{font-size:.85rem;color:var(--g900)}',
    '#sec-rgpd .rgp-res-i span{font-size:.71rem;color:var(--g500)}',
    '#sec-rgpd .rgp-dossier{margin-top:1.1rem;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:1.1rem;box-shadow:var(--shadow-xs);max-width:760px}',
    '#sec-rgpd .rgp-dossier-h{display:flex;justify-content:space-between;align-items:center;margin-bottom:.9rem}',
    '#sec-rgpd .rgp-dossier-h strong{font-size:1rem;color:var(--g900)}',
    '#sec-rgpd .rgp-bloc{border:1px solid var(--border);border-radius:11px;padding:.75rem .9rem;margin-bottom:.7rem;background:var(--surface2)}',
    '#sec-rgpd .rgp-bloc-t{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--g600);margin-bottom:.4rem}',
    '#sec-rgpd .rgp-bloc ul{margin:0;padding-left:1.1rem;font-size:.82rem;color:var(--g700);line-height:1.6}',
    '#sec-rgpd .rgp-bloc-legal{background:var(--amber-bg);border-color:var(--amber)}',
    '#sec-rgpd .rgp-bloc-legal p{margin:.5rem 0 0;font-size:.76rem;color:var(--amber);line-height:1.5}',
    '#sec-rgpd .rgp-acts{display:flex;gap:.4rem;flex-wrap:wrap;border-top:1px solid var(--border);padding-top:.8rem}',
    '#sec-rgpd .rgp-btn{border:1px solid var(--border-med);background:var(--surface);color:var(--g700);border-radius:9px;padding:.45rem .8rem;font-size:.79rem;font-weight:600;cursor:pointer;font-family:inherit}',
    '#sec-rgpd .rgp-btn-p{background:var(--blue-p700);border-color:var(--blue-p700);color:#fff}',
    '#sec-rgpd .rgp-btn-d{color:var(--red);border-color:var(--red)}',
    '#sec-rgpd .rgp-vide,#sec-rgpd .rgp-ok{padding:1.2rem 0;color:var(--g500);font-size:.85rem}',
    '#sec-rgpd .rgp-ok{color:var(--green)}',
    '#sec-rgpd .rgp-compte{font-size:.8rem;font-weight:700;color:var(--amber);margin-bottom:.6rem}',
    '#sec-rgpd .rgp-liste{display:flex;flex-direction:column;gap:.35rem;max-width:820px}',
    '#sec-rgpd .rgp-l{display:flex;align-items:center;gap:.7rem;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:.55rem .8rem}',
    '#sec-rgpd .rgp-l>div:first-child{flex:1;display:flex;flex-direction:column;min-width:0}',
    '#sec-rgpd .rgp-l strong{font-size:.84rem;color:var(--g900)}',
    '#sec-rgpd .rgp-l span{font-size:.7rem;color:var(--g500)}',
    '#sec-rgpd .rgp-l-d{font-size:.72rem;color:var(--amber);font-weight:600;white-space:nowrap}',
    '#sec-rgpd .rgp-reg{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:.8rem;margin-top:1rem}',
    '#sec-rgpd .rgp-t{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:.9rem;box-shadow:var(--shadow-xs)}',
    '#sec-rgpd .rgp-t-h{font-size:.88rem;font-weight:700;color:var(--blue-p700);margin-bottom:.6rem}',
    '#sec-rgpd .rgp-t dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:.25rem .6rem;font-size:.76rem}',
    '#sec-rgpd .rgp-t dt{color:var(--g500);font-weight:600;white-space:nowrap}',
    '#sec-rgpd .rgp-t dd{margin:0;color:var(--g800);line-height:1.45}',
    '#sec-rgpd .rgp-vig{margin-top:.6rem;font-size:.73rem;color:var(--amber);background:var(--amber-bg);border-radius:8px;padding:.45rem .6rem;line-height:1.45}',
    '@media(max-width:640px){#sec-rgpd .rgp-reg{grid-template-columns:1fr}#sec-rgpd .rgp-l{flex-wrap:wrap}}'
  ].join('');

  function injectCSS() {
    if (document.getElementById('rgp-styles')) return;
    var st = document.createElement('style');
    st.id = 'rgp-styles'; st.textContent = CSS;
    document.head.appendChild(st);
  }

  /* ═══ API publique ════════════════════════════════════════════════ */
  global.RGPD = {
    mount: function () { injectCSS(); render(); },
    vue: function (v) { state.vue = v; render(); },
    chercher: function (v) {
      state.recherche = v;
      if (!v) state.dossier = null;
      render();
      var el = document.querySelector('#rgpd-root .rgp-input');
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    },
    dossier: function (id) {
      state.vue = 'personne';
      construireDossier(id, function (d) {
        state.dossier = d;
        state.recherche = d ? d.fiche.nom : '';
        render();
      });
    },
    fermer: function () { state.dossier = null; state.recherche = ''; render(); },
    exporterJson: exporterJson,
    exporterPdf: exporterPdf,
    supprimer: supprimer,
    registrePdf: registrePdf
  };
})(window);
