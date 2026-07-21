/* ═══════════════════════════════════════════════════════════════════════
   VISITES — comptes rendus de visite client, photos et export PDF
   ───────────────────────────────────────────────────────────────────────
   Stockage : bcol('visites')        1 document léger par visite
              bcol('visites_photos') 1 document par photo (base64)
   → les deux DOIVENT figurer dans BRAND_SCOPED_COLLECTIONS
   PDF      : withJsPdf() (jsPDF déjà utilisé par les notes de frais)

   API publique : Visites.mount() / .nouvelle(contactId) / .refresh()
   ═══════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var MAX_DIM = 1400;        // px — côté le plus long après redimensionnement
  var QUALITE = 0.68;        // compression JPEG initiale
  var POIDS_MAX = 700 * 1024; // octets — au-delà on recompresse
  var MAX_PHOTOS = 8;

  var TYPES = ['Visite', 'Rendez-vous', 'Appel', 'Salon', 'Livraison', 'Réclamation'];
  var TAGS = ['Commande passée', 'Devis à envoyer', 'Nouveauté présentée', 'Litige',
              'Concurrence', 'Mise en avant rayon', 'À relancer', 'Prospection'];

  var state = {
    visites: [],
    charge: false,
    search: '',
    filtreClient: '',
    edit: null,        // brouillon en cours
    photosEdit: []     // [{ id?, data, legende, nouveau:true }]
  };

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
  function toast(m, t) { if (typeof global.toast === 'function') global.toast(m, t); }
  function contacts() {
    return (typeof cdbContacts !== 'undefined' && cdbContacts) ? cdbContacts : [];
  }
  function jour(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function isoJour(ts) {
    var d = ts ? new Date(ts) : new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
           '-' + String(d.getDate()).padStart(2, '0');
  }
  function marque() {
    return (typeof CURRENT_BRAND !== 'undefined' && CURRENT_BRAND === 'naturaline')
      ? 'NATURALINE' : 'Moulin des Moines';
  }

  /* ═══ Chargement ══════════════════════════════════════════════════ */
  function charger(cb) {
    if (typeof db === 'undefined' || !db || typeof currentUser === 'undefined' || !currentUser) {
      state.charge = true; if (cb) cb(); return;
    }
    bcol('visites').orderBy('date', 'desc').limit(300).get()
      .then(function (snap) {
        state.visites = [];
        snap.forEach(function (d) {
          var v = d.data(); v.id = d.id;
          state.visites.push(v);
        });
        state.charge = true;
        if (cb) cb(); else render();
      })
      .catch(function (e) {
        // orderBy échoue si le champ manque sur d'anciens docs : repli sans tri
        console.warn('[Visites] chargement', e);
        bcol('visites').get().then(function (snap) {
          state.visites = [];
          snap.forEach(function (d) { var v = d.data(); v.id = d.id; state.visites.push(v); });
          state.visites.sort(function (a, b) { return (b.date || 0) - (a.date || 0); });
          state.charge = true;
          if (cb) cb(); else render();
        }).catch(function () { state.charge = true; if (cb) cb(); else render(); });
      });
  }

  function photosDe(visiteId, cb) {
    if (typeof db === 'undefined' || !db) { cb([]); return; }
    bcol('visites_photos').where('visiteId', '==', visiteId).get()
      .then(function (snap) {
        var out = [];
        snap.forEach(function (d) { var p = d.data(); p.id = d.id; out.push(p); });
        out.sort(function (a, b) { return (a.ordre || 0) - (b.ordre || 0); });
        cb(out);
      })
      .catch(function (e) { console.warn('[Visites] photos', e); cb([]); });
  }

  /* ═══ Compression photo ═══════════════════════════════════════════ */
  function compresser(file, cb) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
        var cv = document.createElement('canvas');
        cv.width = Math.round(img.width * scale);
        cv.height = Math.round(img.height * scale);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);

        var q = QUALITE, data = cv.toDataURL('image/jpeg', q);
        // Deuxième passe si le document dépasserait la limite Firestore
        while (data.length * 0.75 > POIDS_MAX && q > 0.35) {
          q -= 0.12;
          data = cv.toDataURL('image/jpeg', q);
        }
        cb(data, Math.round(data.length * 0.75 / 1024));
      };
      img.onerror = function () { cb(null); };
      img.src = e.target.result;
    };
    reader.onerror = function () { cb(null); };
    reader.readAsDataURL(file);
  }

  function ajouterPhotos(input) {
    var files = Array.prototype.slice.call(input.files || []);
    if (!files.length) return;
    var place = MAX_PHOTOS - state.photosEdit.length;
    if (place <= 0) { toast('Maximum ' + MAX_PHOTOS + ' photos par visite', 'err'); return; }
    files = files.slice(0, place);

    var restant = files.length;
    files.forEach(function (f) {
      compresser(f, function (data, ko) {
        if (data) state.photosEdit.push({ data: data, legende: '', ko: ko, nouveau: true });
        if (--restant === 0) { input.value = ''; renderEditPhotos(); }
      });
    });
  }

  /* ═══ Édition ═════════════════════════════════════════════════════ */
  function nouvelle(contactId) {
    var c = contactId ? contacts().find(function (x) { return x.id === contactId; }) : null;
    state.edit = {
      id: null,
      clientId: c ? c.id : '',
      clientNom: c ? c.nom : '',
      numClient: c ? (c.numClient || '') : '',
      date: Date.now(),
      type: 'Visite',
      objet: '',
      compteRendu: '',
      tags: [],
      relanceLe: '',
      nbPhotos: 0
    };
    state.photosEdit = [];
    ouvrirSection();
    render();
  }

  function ouvrir(id) {
    var v = state.visites.find(function (x) { return x.id === id; });
    if (!v) return;
    state.edit = JSON.parse(JSON.stringify(v));
    state.photosEdit = [];
    render();
    if (v.nbPhotos) {
      photosDe(id, function (ps) {
        state.photosEdit = ps.map(function (p) {
          return { id: p.id, data: p.data, legende: p.legende || '' };
        });
        renderEditPhotos();
      });
    }
  }

  function annuler() { state.edit = null; state.photosEdit = []; render(); }

  function champ(k, v) {
    if (!state.edit) return;
    if (k === 'date') state.edit.date = new Date(v + 'T12:00:00').getTime();
    else state.edit[k] = v;
  }
  function toggleTag(t) {
    if (!state.edit) return;
    var i = state.edit.tags.indexOf(t);
    if (i >= 0) state.edit.tags.splice(i, 1); else state.edit.tags.push(t);
    renderTags();
  }
  function legende(i, v) { if (state.photosEdit[i]) state.photosEdit[i].legende = v; }
  function retirerPhoto(i) {
    var p = state.photosEdit[i];
    if (p && p.id && typeof db !== 'undefined' && db) {
      bcol('visites_photos').doc(p.id).delete().catch(function () {});
    }
    state.photosEdit.splice(i, 1);
    renderEditPhotos();
  }

  function enregistrer() {
    var e = state.edit;
    if (!e) return;
    if (!e.clientId && !e.clientNom) { toast('Sélectionne un client', 'err'); return; }
    if (!e.compteRendu.trim() && !state.photosEdit.length) {
      toast('Ajoute au moins un commentaire ou une photo', 'err'); return;
    }
    if (typeof db === 'undefined' || !db || typeof currentUser === 'undefined' || !currentUser) {
      toast('Non connecté', 'err'); return;
    }

    var doc = {
      clientId: e.clientId || '',
      clientNom: e.clientNom || '',
      numClient: e.numClient || '',
      date: e.date || Date.now(),
      type: e.type || 'Visite',
      objet: (e.objet || '').trim(),
      compteRendu: (e.compteRendu || '').trim(),
      tags: e.tags || [],
      relanceLe: e.relanceLe || '',
      nbPhotos: state.photosEdit.length,
      createdBy: currentUser.uid,
      majAt: Date.now()
    };

    var btn = document.getElementById('vis-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement…'; }

    var ref = e.id ? bcol('visites').doc(e.id) : bcol('visites').doc();
    if (!e.id) doc.createdAt = Date.now();

    ref.set(doc, { merge: true })
      .then(function () {
        var id = ref.id;
        var nouvelles = state.photosEdit.filter(function (p) { return p.nouveau; });
        var majLeg = state.photosEdit.filter(function (p) { return p.id; });

        var promesses = nouvelles.map(function (p, i) {
          return bcol('visites_photos').add({
            visiteId: id, data: p.data, legende: p.legende || '',
            ordre: state.photosEdit.indexOf(p), createdAt: Date.now()
          });
        }).concat(majLeg.map(function (p) {
          return bcol('visites_photos').doc(p.id)
            .set({ legende: p.legende || '', ordre: state.photosEdit.indexOf(p) }, { merge: true });
        }));

        return Promise.all(promesses).then(function () { return id; });
      })
      .then(function (id) {
        if (typeof logActivite === 'function') {
          logActivite((e.id ? 'CR modifié' : 'CR de visite') + ' — ' + doc.clientNom, 'violet');
        }
        toast('✅ Compte rendu enregistré', 'ok');
        state.edit = null; state.photosEdit = [];
        charger();
      })
      .catch(function (err) {
        toast('Erreur : ' + err.message, 'err');
        if (btn) { btn.disabled = false; btn.textContent = 'Enregistrer'; }
      });
  }

  function supprimer(id) {
    if (!confirm('Supprimer ce compte rendu et ses photos ?')) return;
    photosDe(id, function (ps) {
      ps.forEach(function (p) { bcol('visites_photos').doc(p.id).delete().catch(function () {}); });
      bcol('visites').doc(id).delete()
        .then(function () { toast('Compte rendu supprimé', 'ok'); state.edit = null; charger(); })
        .catch(function (e) { toast('Erreur : ' + e.message, 'err'); });
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     EXPORT PDF
     ═══════════════════════════════════════════════════════════════════ */
  function exporterPdf(id) {
    var v = state.visites.find(function (x) { return x.id === id; });
    if (!v) return;
    toast('Préparation du PDF…', 'ok');
    photosDe(id, function (photos) {
      withJsPdf(function () { construirePdf([{ v: v, photos: photos }], v.clientNom); },
        function () { toast('Impossible de charger le générateur PDF', 'err'); });
    });
  }

  // Dossier complet : toutes les visites d'un client
  function exporterDossier(clientNom) {
    var lot = state.visites.filter(function (x) { return x.clientNom === clientNom; });
    if (!lot.length) return;
    toast('Préparation du dossier (' + lot.length + ' visites)…', 'ok');
    var out = [], reste = lot.length;
    lot.forEach(function (v, i) {
      photosDe(v.id, function (ps) {
        out[i] = { v: v, photos: ps };
        if (--reste === 0) {
          withJsPdf(function () { construirePdf(out, clientNom); },
            function () { toast('Impossible de charger le générateur PDF', 'err'); });
        }
      });
    });
  }

  function construirePdf(blocs, titreClient) {
    var doc = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    var W = 210, H = 297, M = 18;
    var y = M;

    function pied() {
      var n = doc.internal.getNumberOfPages();
      for (var i = 1; i <= n; i++) {
        doc.setPage(i);
        doc.setFontSize(8); doc.setTextColor(150);
        doc.text(marque() + ' — compte rendu de visite', M, H - 10);
        doc.text(i + '/' + n, W - M, H - 10, { align: 'right' });
      }
    }
    function page() { doc.addPage(); y = M; }
    function place(h) { if (y + h > H - 20) page(); }

    blocs.forEach(function (b, idx) {
      if (idx > 0) page();
      var v = b.v;

      // ── En-tête
      doc.setFillColor(4, 44, 83);
      doc.rect(0, 0, W, 26, 'F');
      doc.setTextColor(255); doc.setFontSize(15); doc.setFont(undefined, 'bold');
      doc.text('Compte rendu de visite', M, 13);
      doc.setFontSize(9); doc.setFont(undefined, 'normal');
      doc.text(marque(), M, 20);
      doc.text(jour(v.date), W - M, 20, { align: 'right' });
      y = 36;

      // ── Client
      doc.setTextColor(4, 44, 83); doc.setFontSize(13); doc.setFont(undefined, 'bold');
      doc.text(String(v.clientNom || '—'), M, y); y += 6;
      doc.setFont(undefined, 'normal'); doc.setFontSize(9); doc.setTextColor(110);
      var sous = [];
      if (v.numClient) sous.push('Code client ' + v.numClient);
      sous.push(v.type || 'Visite');
      var ct = contacts().find(function (c) { return c.id === v.clientId; });
      if (ct && (ct.cp || ct.ville)) sous.push([ct.cp, ct.ville].filter(Boolean).join(' '));
      doc.text(sous.join('  ·  '), M, y); y += 8;

      doc.setDrawColor(210); doc.line(M, y, W - M, y); y += 8;

      // ── Objet
      if (v.objet) {
        doc.setTextColor(60); doc.setFontSize(11); doc.setFont(undefined, 'bold');
        doc.text(String(v.objet), M, y); y += 7;
      }

      // ── Compte rendu
      if (v.compteRendu) {
        doc.setFont(undefined, 'normal'); doc.setFontSize(10); doc.setTextColor(40);
        var lignes = doc.splitTextToSize(String(v.compteRendu), W - 2 * M);
        lignes.forEach(function (l) {
          place(6);
          doc.text(l, M, y); y += 5.2;
        });
        y += 4;
      }

      // ── Tags
      if (v.tags && v.tags.length) {
        place(12);
        var x = M;
        doc.setFontSize(8);
        v.tags.forEach(function (t) {
          var w = doc.getTextWidth(t) + 6;
          if (x + w > W - M) { x = M; y += 7; place(10); }
          doc.setFillColor(222, 237, 251); doc.setTextColor(24, 95, 165);
          doc.roundedRect(x, y - 4, w, 6, 1.5, 1.5, 'F');
          doc.text(t, x + 3, y); x += w + 3;
        });
        y += 10;
      }

      // ── Relance
      if (v.relanceLe) {
        place(10);
        doc.setFillColor(253, 243, 227); doc.setDrawColor(201, 124, 26);
        doc.roundedRect(M, y - 4, W - 2 * M, 9, 2, 2, 'FD');
        doc.setTextColor(201, 124, 26); doc.setFontSize(9); doc.setFont(undefined, 'bold');
        doc.text('Relance prévue le ' + jour(new Date(v.relanceLe + 'T12:00:00').getTime()), M + 4, y + 1.5);
        y += 14;
      }

      // ── Photos : 2 par page, pleine largeur
      if (b.photos && b.photos.length) {
        page();
        doc.setTextColor(4, 44, 83); doc.setFontSize(11); doc.setFont(undefined, 'bold');
        doc.text('Photos — ' + String(v.clientNom || ''), M, y); y += 8;

        b.photos.forEach(function (p) {
          var prop;
          try { prop = doc.getImageProperties(p.data); }
          catch (e) { return; }
          var maxW = W - 2 * M, maxH = 105;
          var ratio = Math.min(maxW / prop.width, maxH / prop.height);
          var w = prop.width * ratio, h = prop.height * ratio;

          if (y + h + 12 > H - 20) { page(); }
          doc.addImage(p.data, 'JPEG', M, y, w, h);
          y += h + 4;
          if (p.legende) {
            doc.setFont(undefined, 'italic'); doc.setFontSize(8.5); doc.setTextColor(110);
            doc.splitTextToSize(String(p.legende), maxW).forEach(function (l) {
              doc.text(l, M, y); y += 4.2;
            });
            doc.setFont(undefined, 'normal');
          }
          y += 8;
        });
      }
    });

    pied();
    var nom = 'CR_' + normName(titreClient || 'visite').replace(/[^a-z0-9]+/g, '_') +
              '_' + isoJour(Date.now()) + '.pdf';
    doc.save(nom);
    toast('✅ PDF généré', 'ok');
  }

  /* ═══════════════════════════════════════════════════════════════════
     ONGLET « VISITES » DANS LA FICHE CLIENT
     Appelé par cdbSwitchTab('visites') — voir index.html
     ═══════════════════════════════════════════════════════════════════ */
  function fermerModale() {
    var m = document.getElementById('cdb-modal-edit');
    if (m) m.classList.add('hidden');
  }

  function tabFiche(clientId, elId) {
    injectCSS();
    var el = document.getElementById(elId || 'cdb-tab-visites');
    if (!el) return;

    if (!clientId) {
      el.innerHTML = '<div class="vis-fiche-vide">Enregistre d\'abord la fiche client, ' +
        'puis reviens ici pour y attacher des comptes rendus.</div>';
      return;
    }

    function dessiner() {
      var c = contacts().find(function (x) { return x.id === clientId; });
      var nom = c ? c.nom : '';
      var lot = state.visites.filter(function (v) { return v.clientId === clientId; });

      var entete =
        '<div class="vis-fiche-h">' +
          '<span class="vis-fiche-n">' +
            (lot.length ? lot.length + ' compte' + (lot.length > 1 ? 's' : '') + ' rendu' + (lot.length > 1 ? 's' : '') +
                          ' · dernier le ' + jour(lot[0].date)
                        : 'Aucun compte rendu') +
          '</span>' +
          '<span style="display:flex;gap:.4rem;flex-wrap:wrap">' +
            '<button class="vis-btn vis-btn-p" onclick="Visites.depuisFiche(\'' + esc(clientId) + '\')">+ Compte rendu</button>' +
            (lot.length
              ? '<button class="vis-btn" onclick="Visites.exporterDossier(\'' +
                esc(nom).replace(/'/g, "\\'") + '\')">📄 Dossier PDF</button>'
              : '') +
          '</span>' +
        '</div>';

      if (!lot.length) {
        el.innerHTML = entete +
          '<div class="vis-fiche-vide">Rien n\'a encore été noté pour ce client.<br>' +
          'Après ta prochaine visite, note ce qui s\'est dit et prends une photo du linéaire.</div>';
        return;
      }

      el.innerHTML = entete + '<div class="vis-list">' + lot.map(ligneFiche).join('') + '</div>';
    }

    if (!state.charge) {
      el.innerHTML = '<div class="vis-none">Chargement des comptes rendus…</div>';
      charger(dessiner);
    } else {
      dessiner();
    }
  }

  // Carte compacte, sans le nom du client (on est déjà sur sa fiche)
  function ligneFiche(v) {
    var tags = (v.tags || []).slice(0, 3).map(function (t) {
      return '<span class="vis-tag">' + esc(t) + '</span>';
    }).join('');
    var extrait = String(v.compteRendu || '').slice(0, 200);
    return '<article class="vis-card">' +
      '<header class="vis-card-h">' +
        '<div>' +
          '<strong>' + esc(v.objet || v.type || 'Visite') + '</strong>' +
          '<div class="vis-card-s">' + jour(v.date) + ' · ' + esc(v.type || 'Visite') +
            (v.nbPhotos ? ' · 📷 ' + v.nbPhotos : '') + '</div>' +
        '</div>' +
        (v.relanceLe ? '<span class="vis-relance">Relance ' + jour(new Date(v.relanceLe + 'T12:00:00').getTime()) + '</span>' : '') +
      '</header>' +
      (extrait ? '<p class="vis-extrait">' + esc(extrait) + (v.compteRendu.length > 200 ? '…' : '') + '</p>' : '') +
      (tags ? '<div class="vis-tags">' + tags + '</div>' : '') +
      '<div class="vis-acts">' +
        '<button class="vis-act" onclick="Visites.ouvrirDepuisFiche(\'' + esc(v.id) + '\')">Ouvrir</button>' +
        '<button class="vis-act" onclick="Visites.exporterPdf(\'' + esc(v.id) + '\')">📄 PDF</button>' +
      '</div>' +
      '</article>';
  }

  /* ═══ Rendu ═══════════════════════════════════════════════════════ */
  function ouvrirSection() {
    if (typeof showSection === 'function') showSection('visites', null, null);
  }

  function filtrees() {
    var q = normName(state.search);
    return state.visites.filter(function (v) {
      if (state.filtreClient && v.clientNom !== state.filtreClient) return false;
      if (!q) return true;
      return normName([v.clientNom, v.objet, v.compteRendu, (v.tags || []).join(' ')].join(' '))
        .indexOf(q) >= 0;
    });
  }

  function render() {
    var root = document.getElementById('vis-root');
    if (!root) return;
    if (state.edit) { renderEdit(root); return; }

    if (!state.charge) {
      root.innerHTML = '<div class="vis-none">Chargement des comptes rendus…</div>';
      return;
    }

    var liste = filtrees();
    var clients = {};
    state.visites.forEach(function (v) { if (v.clientNom) clients[v.clientNom] = 1; });

    var barre =
      '<div class="vis-bar">' +
        '<button class="vis-btn vis-btn-p" onclick="Visites.nouvelle()">+ Nouveau compte rendu</button>' +
        '<input class="vis-input" type="search" placeholder="Rechercher…" value="' + esc(state.search) + '"' +
          ' oninput="Visites.setSearch(this.value)">' +
        '<select class="vis-input" onchange="Visites.setClient(this.value)">' +
          '<option value="">Tous les clients</option>' +
          Object.keys(clients).sort().map(function (n) {
            return '<option value="' + esc(n) + '"' + (state.filtreClient === n ? ' selected' : '') + '>' + esc(n) + '</option>';
          }).join('') +
        '</select>' +
        (state.filtreClient
          ? '<button class="vis-btn" onclick="Visites.exporterDossier(\'' + esc(state.filtreClient).replace(/'/g, "\\'") + '\')">📄 Dossier client PDF</button>'
          : '') +
      '</div>';

    if (!liste.length) {
      root.innerHTML = barre +
        '<div class="vis-empty"><div class="vis-empty-ico">📝</div>' +
        '<h3>' + (state.visites.length ? 'Aucun résultat' : 'Aucun compte rendu') + '</h3>' +
        '<p>' + (state.visites.length
          ? 'Change de filtre ou de recherche.'
          : 'Après chaque visite, note ce qui s\'est dit et prends une photo du linéaire. Tout est retrouvable et exportable ensuite.') + '</p></div>';
      return;
    }

    root.innerHTML = barre + '<div class="vis-list">' + liste.map(ligne).join('') + '</div>';
  }

  function ligne(v) {
    var tags = (v.tags || []).slice(0, 3).map(function (t) {
      return '<span class="vis-tag">' + esc(t) + '</span>';
    }).join('');
    var extrait = String(v.compteRendu || '').slice(0, 160);
    return '<article class="vis-card">' +
      '<header class="vis-card-h">' +
        '<div>' +
          '<strong>' + esc(v.clientNom || '—') + '</strong>' +
          '<div class="vis-card-s">' + jour(v.date) + ' · ' + esc(v.type || 'Visite') +
            (v.nbPhotos ? ' · 📷 ' + v.nbPhotos : '') + '</div>' +
        '</div>' +
        (v.relanceLe ? '<span class="vis-relance">Relance ' + jour(new Date(v.relanceLe + 'T12:00:00').getTime()) + '</span>' : '') +
      '</header>' +
      (v.objet ? '<div class="vis-objet">' + esc(v.objet) + '</div>' : '') +
      (extrait ? '<p class="vis-extrait">' + esc(extrait) + (v.compteRendu.length > 160 ? '…' : '') + '</p>' : '') +
      (tags ? '<div class="vis-tags">' + tags + '</div>' : '') +
      '<div class="vis-acts">' +
        '<button class="vis-act" onclick="Visites.ouvrir(\'' + esc(v.id) + '\')">Ouvrir</button>' +
        '<button class="vis-act" onclick="Visites.exporterPdf(\'' + esc(v.id) + '\')">📄 PDF</button>' +
        (v.clientId ? '<button class="vis-act" onclick="Visites.commande(\'' + esc(v.clientId) + '\')">🛒</button>' : '') +
      '</div>' +
      '</article>';
  }

  function renderEdit(root) {
    var e = state.edit;
    var opts = contacts().slice().sort(function (a, b) {
      return String(a.nom || '').localeCompare(String(b.nom || ''));
    }).map(function (c) {
      return '<option value="' + esc(c.id) + '"' + (e.clientId === c.id ? ' selected' : '') + '>' +
             esc(c.nom) + (c.ville ? ' — ' + esc(c.ville) : '') + '</option>';
    }).join('');

    root.innerHTML =
      '<div class="vis-form">' +
        '<div class="vis-form-h">' +
          '<h3>' + (e.id ? 'Modifier le compte rendu' : 'Nouveau compte rendu') + '</h3>' +
          '<button class="vis-btn" onclick="Visites.annuler()">Retour</button>' +
        '</div>' +

        '<div class="vis-grid">' +
          '<label>Client' +
            '<select onchange="Visites.setClient2(this.value)">' +
              '<option value="">— Sélectionner —</option>' + opts +
            '</select>' +
          '</label>' +
          '<label>Date' +
            '<input type="date" value="' + isoJour(e.date) + '" onchange="Visites.champ(\'date\',this.value)">' +
          '</label>' +
          '<label>Type' +
            '<select onchange="Visites.champ(\'type\',this.value)">' +
              TYPES.map(function (t) {
                return '<option' + (e.type === t ? ' selected' : '') + '>' + esc(t) + '</option>';
              }).join('') +
            '</select>' +
          '</label>' +
          '<label>Relance prévue' +
            '<input type="date" value="' + esc(e.relanceLe || '') + '" onchange="Visites.champ(\'relanceLe\',this.value)">' +
          '</label>' +
        '</div>' +

        '<label class="vis-full">Objet' +
          '<input type="text" placeholder="Ex : présentation gamme épeautre" value="' + esc(e.objet || '') + '"' +
          ' oninput="Visites.champ(\'objet\',this.value)">' +
        '</label>' +

        '<label class="vis-full">Compte rendu' +
          '<textarea rows="7" placeholder="Ce qui s\'est dit, les décisions, les objections, ce qu\'il faudra ressortir la prochaine fois…"' +
          ' oninput="Visites.champ(\'compteRendu\',this.value)">' + esc(e.compteRendu || '') + '</textarea>' +
        '</label>' +
        '<button class="vis-btn vis-dictee" onclick="Visites.dictee()">🎤 Dicter</button>' +

        '<div class="vis-lbl">Étiquettes</div>' +
        '<div id="vis-tags" class="vis-tagbox">' + tagsHtml() + '</div>' +

        '<div class="vis-lbl">Photos <span class="vis-mute">(' + MAX_PHOTOS + ' max, compressées automatiquement)</span></div>' +
        '<input id="vis-file" type="file" accept="image/*" capture="environment" multiple' +
        ' style="display:none" onchange="Visites.ajouterPhotos(this)">' +
        '<button class="vis-btn" onclick="document.getElementById(\'vis-file\').click()">📷 Ajouter des photos</button>' +
        '<div id="vis-photos" class="vis-photos">' + photosHtml() + '</div>' +

        '<div class="vis-form-a">' +
          '<button id="vis-save" class="vis-btn vis-btn-p" onclick="Visites.enregistrer()">Enregistrer</button>' +
          (e.id ? '<button class="vis-btn" onclick="Visites.exporterPdf(\'' + esc(e.id) + '\')">📄 PDF</button>' +
                  '<button class="vis-btn vis-btn-d" onclick="Visites.supprimer(\'' + esc(e.id) + '\')">Supprimer</button>' : '') +
        '</div>' +
      '</div>';
  }

  function tagsHtml() {
    var sel = (state.edit && state.edit.tags) || [];
    return TAGS.map(function (t) {
      return '<button class="vis-tagbtn' + (sel.indexOf(t) >= 0 ? ' on' : '') + '"' +
             ' onclick="Visites.toggleTag(\'' + esc(t).replace(/'/g, "\\'") + '\')">' + esc(t) + '</button>';
    }).join('');
  }
  function renderTags() {
    var el = document.getElementById('vis-tags');
    if (el) el.innerHTML = tagsHtml();
  }

  function photosHtml() {
    if (!state.photosEdit.length) return '<div class="vis-mute vis-nophoto">Aucune photo</div>';
    return state.photosEdit.map(function (p, i) {
      return '<figure class="vis-photo">' +
        '<img src="' + p.data + '" alt="">' +
        '<input type="text" placeholder="Légende…" value="' + esc(p.legende || '') + '"' +
        ' oninput="Visites.legende(' + i + ',this.value)">' +
        '<button class="vis-photo-x" onclick="Visites.retirerPhoto(' + i + ')" title="Retirer">✕</button>' +
        (p.ko ? '<figcaption>' + p.ko + ' Ko</figcaption>' : '') +
      '</figure>';
    }).join('');
  }
  function renderEditPhotos() {
    var el = document.getElementById('vis-photos');
    if (el) el.innerHTML = photosHtml();
  }

  /* ═══ Dictée vocale ═══════════════════════════════════════════════ */
  var reco = null;
  function dictee() {
    var SR = global.SpeechRecognition || global.webkitSpeechRecognition;
    if (!SR) { toast('Dictée non supportée par ce navigateur', 'err'); return; }
    if (reco) { reco.stop(); reco = null; return; }
    reco = new SR();
    reco.lang = 'fr-FR';
    reco.continuous = true;
    reco.interimResults = false;
    reco.onresult = function (ev) {
      var txt = '';
      for (var i = ev.resultIndex; i < ev.results.length; i++) txt += ev.results[i][0].transcript;
      if (!state.edit) return;
      state.edit.compteRendu = (state.edit.compteRendu ? state.edit.compteRendu + ' ' : '') + txt.trim();
      var ta = document.querySelector('#vis-root textarea');
      if (ta) ta.value = state.edit.compteRendu;
    };
    reco.onend = function () { reco = null; toast('Dictée terminée', 'ok'); };
    reco.onerror = function () { reco = null; toast('Erreur de dictée', 'err'); };
    reco.start();
    toast('🎤 Parle — reclique pour arrêter', 'ok');
  }

  /* ═══ Styles ══════════════════════════════════════════════════════
     %S% est remplacé par chaque portée : la section autonome ET
     l'onglet « Visites » de la modale fiche client.                  */
  var CSS_TPL = [
    '%S% .vis-bar{display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:1rem}',
    '%S% .vis-btn{border:1px solid var(--border-med);background:var(--surface);color:var(--g700);border-radius:9px;padding:.45rem .8rem;font-size:.8rem;font-weight:600;cursor:pointer;font-family:inherit}',
    '%S% .vis-btn-p{background:var(--blue-p700);border-color:var(--blue-p700);color:#fff}',
    '%S% .vis-btn-d{color:var(--red);border-color:var(--red)}',
    '%S% .vis-input{border:1px solid var(--border-med);border-radius:9px;padding:.45rem .7rem;font-size:.82rem;background:var(--surface);color:var(--g900);font-family:inherit}',
    '%S% .vis-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:.8rem}',
    '%S% .vis-card{background:var(--surface);border:1px solid var(--border);border-radius:13px;padding:.9rem;box-shadow:var(--shadow-xs);display:flex;flex-direction:column;gap:.5rem}',
    '%S% .vis-card-h{display:flex;justify-content:space-between;gap:.5rem;align-items:flex-start}',
    '%S% .vis-card-h strong{font-size:.92rem;color:var(--g900)}',
    '%S% .vis-card-s{font-size:.7rem;color:var(--g500);margin-top:.1rem}',
    '%S% .vis-relance{flex-shrink:0;font-size:.66rem;font-weight:700;background:var(--amber-bg);color:var(--amber);padding:.15rem .4rem;border-radius:6px}',
    '%S% .vis-objet{font-size:.82rem;font-weight:600;color:var(--g800)}',
    '%S% .vis-extrait{margin:0;font-size:.78rem;color:var(--g600);line-height:1.45}',
    '%S% .vis-tags{display:flex;flex-wrap:wrap;gap:.25rem}',
    '%S% .vis-tag{font-size:.66rem;font-weight:600;background:var(--blue-p50);color:var(--blue-p700);border:1px solid var(--blue-p300);padding:.1rem .4rem;border-radius:999px}',
    '%S% .vis-acts{display:flex;gap:.3rem;flex-wrap:wrap;border-top:1px solid var(--border);padding-top:.5rem}',
    '%S% .vis-act{border:1px solid var(--border-med);background:var(--surface2);color:var(--g700);border-radius:7px;padding:.3rem .55rem;font-size:.72rem;font-weight:600;cursor:pointer;font-family:inherit}',
    '%S% .vis-form{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:1.1rem;box-shadow:var(--shadow-sm);max-width:820px}',
    '%S% .vis-form-h{display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem}',
    '%S% .vis-form-h h3{margin:0;font-size:1rem;color:var(--g900)}',
    '%S% .vis-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:.7rem;margin-bottom:.7rem}',
    '%S% .vis-form label,%S% .vis-full{display:flex;flex-direction:column;gap:.2rem;font-size:.72rem;font-weight:600;color:var(--g600);margin-bottom:.7rem}',
    '%S% .vis-form input,%S% .vis-form select,%S% .vis-form textarea{border:1px solid var(--border-med);border-radius:9px;padding:.5rem .7rem;font-size:.85rem;background:var(--surface);color:var(--g900);font-family:inherit;font-weight:400}',
    '%S% .vis-form textarea{resize:vertical;line-height:1.5}',
    '%S% .vis-dictee{margin-bottom:1rem}',
    '%S% .vis-lbl{font-size:.72rem;font-weight:700;color:var(--g600);margin:.4rem 0 .4rem;text-transform:uppercase;letter-spacing:.03em}',
    '%S% .vis-mute{color:var(--g500);font-weight:400;text-transform:none;letter-spacing:0}',
    '%S% .vis-tagbox{display:flex;flex-wrap:wrap;gap:.3rem;margin-bottom:1rem}',
    '%S% .vis-tagbtn{border:1px solid var(--border-med);background:var(--surface);color:var(--g600);border-radius:999px;padding:.3rem .65rem;font-size:.73rem;font-weight:600;cursor:pointer;font-family:inherit}',
    '%S% .vis-tagbtn.on{background:var(--blue-p700);border-color:var(--blue-p700);color:#fff}',
    '%S% .vis-photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:.6rem;margin:.6rem 0 1rem}',
    '%S% .vis-nophoto{grid-column:1/-1;font-size:.8rem;padding:.5rem 0}',
    '%S% .vis-photo{position:relative;margin:0;background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:.4rem;display:flex;flex-direction:column;gap:.3rem}',
    '%S% .vis-photo img{width:100%;height:110px;object-fit:cover;border-radius:7px;display:block}',
    '%S% .vis-photo input{font-size:.72rem!important;padding:.3rem .45rem!important}',
    '%S% .vis-photo figcaption{font-size:.62rem;color:var(--g500);text-align:right}',
    '%S% .vis-photo-x{position:absolute;top:.6rem;right:.6rem;border:none;background:rgba(0,0,0,.55);color:#fff;width:22px;height:22px;border-radius:50%;font-size:.72rem;cursor:pointer;line-height:1}',
    '%S% .vis-form-a{display:flex;gap:.5rem;flex-wrap:wrap;border-top:1px solid var(--border);padding-top:.9rem}',
    '%S% .vis-none,%S% .vis-empty{text-align:center;padding:2.5rem 1rem;color:var(--g600)}',
    '%S% .vis-empty-ico{font-size:2.5rem}',
    '%S% .vis-empty h3{margin:.5rem 0 .25rem;color:var(--g900);font-size:1rem}',
    '%S% .vis-empty p{font-size:.85rem;max-width:440px;margin:0 auto;line-height:1.5}'
  ].join('');

  /* Styles propres à l'onglet de la fiche client (espace plus contraint) */
  var CSS_FICHE = [
    '#cdb-tab-visites .vis-list{grid-template-columns:1fr;gap:.6rem}',
    '#cdb-tab-visites .vis-card{padding:.75rem;border-radius:11px}',
    '#cdb-tab-visites .vis-fiche-h{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;justify-content:space-between;margin-bottom:.85rem}',
    '#cdb-tab-visites .vis-fiche-n{font-size:.78rem;color:var(--g600)}',
    '#cdb-tab-visites .vis-fiche-vide{text-align:center;padding:1.75rem 1rem;color:var(--g500);font-size:.83rem;line-height:1.5}',
    '#cdb-tab-visites .vis-empty,#cdb-tab-visites .vis-none{padding:1.5rem 1rem}'
  ].join('');

  var CSS = CSS_TPL.split('%S%').join('#sec-visites') + '\n' +
            CSS_TPL.split('%S%').join('#cdb-tab-visites') + '\n' +
            CSS_FICHE + '\n' +
            '@media(max-width:640px){#sec-visites .vis-list{grid-template-columns:1fr}#sec-visites .vis-bar .vis-input{flex:1;min-width:130px}}';

  function injectCSS() {
    if (document.getElementById('vis-styles')) return;
    var st = document.createElement('style');
    st.id = 'vis-styles'; st.textContent = CSS;
    document.head.appendChild(st);
  }

  /* ═══ API publique ════════════════════════════════════════════════ */
  var API = {
    mount: function () {
      injectCSS();
      if (!state.charge) charger(); else render();
    },
    refresh: function () { state.charge = false; charger(); },
    nouvelle: nouvelle,
    ouvrir: ouvrir,
    tabFiche: tabFiche,
    // Depuis la modale fiche client : on ferme la modale puis on bascule
    depuisFiche: function (clientId) {
      fermerModale();
      nouvelle(clientId);
    },
    ouvrirDepuisFiche: function (id) {
      fermerModale();
      if (typeof showSection === 'function') showSection('visites', null, null);
      setTimeout(function () { injectCSS(); ouvrir(id); }, 120);
    },
    annuler: annuler,
    champ: champ,
    setClient2: function (id) {
      var c = contacts().find(function (x) { return x.id === id; });
      if (!state.edit) return;
      state.edit.clientId = c ? c.id : '';
      state.edit.clientNom = c ? c.nom : '';
      state.edit.numClient = c ? (c.numClient || '') : '';
    },
    setSearch: function (v) {
      state.search = v; render();
      var el = document.querySelector('#vis-root .vis-input[type="search"]');
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    },
    setClient: function (v) { state.filtreClient = v; render(); },
    toggleTag: toggleTag,
    ajouterPhotos: ajouterPhotos,
    legende: legende,
    retirerPhoto: retirerPhoto,
    dictee: dictee,
    enregistrer: enregistrer,
    supprimer: supprimer,
    exporterPdf: exporterPdf,
    exporterDossier: exporterDossier,
    // Dernière visite connue pour un client (utilisé par Radar / Tournées)
    derniere: function (clientId) {
      var lot = state.visites.filter(function (v) { return v.clientId === clientId; });
      return lot.length ? lot[0] : null;
    },
    commande: function (id) {
      if (typeof cdbNewOrder === 'function') cdbNewOrder(id);
      else toast('Module commande indisponible', 'err');
    }
  };

  global.Visites = API;
})(window);
