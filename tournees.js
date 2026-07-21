/* ═══════════════════════════════════════════════════════════════════════
   TOURNÉES — géolocalisation clients et préparation de tournée
   ───────────────────────────────────────────────────────────────────────
   Géocodage  : API Adresse (BAN, data.gouv.fr) — endpoint CSV en masse
   Cartographie : Leaflet 1.9 (chargé à la demande depuis unpkg)
   Stockage   : lat/lng écrits sur les contacts (mémoire + bcol('contacts'))
   Priorités  : réutilise RadarClients.analyse() si le module est présent

   API publique : Tournees.mount() / .refresh() / .geocoder()
   ═══════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var BAN_CSV = 'https://api-adresse.data.gouv.fr/search/csv/';
  var BAN_ONE = 'https://api-adresse.data.gouv.fr/search/';
  var LOT = 500;          // lignes par requête CSV
  var SCORE_MIN = 0.4;    // en dessous : géocodage jugé douteux
  var LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
  var LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';

  var state = {
    pos: null,            // { lat, lng, label }
    rayon: 25,            // km
    tri: 'urgence',       // 'urgence' | 'distance'
    seulementAlertes: false,
    selection: {},        // id -> true (clients retenus pour la tournée)
    geoEnCours: false
  };
  var map = null, layer = null, analyses = null;

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
    var str = String(s || '').trim();
    if (str.endsWith('.0')) str = str.slice(0, -2);
    return { full: str, noZero: str.replace(/^0+/, '') || str };
  }
  function toast(m, t) { if (typeof global.toast === 'function') global.toast(m, t); }

  // Distance à vol d'oiseau (km)
  function distance(a, b) {
    var R = 6371, r = Math.PI / 180;
    var dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(a.lat * r) * Math.cos(b.lat * r) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  /* ═══ CSV : écriture et lecture ═══════════════════════════════════ */
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csvParse(txt) {
    var rows = [], row = [], cur = '', q = false;
    for (var i = 0; i < txt.length; i++) {
      var c = txt[i];
      if (q) {
        if (c === '"') { if (txt[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c !== '\r') cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    if (!rows.length) return [];
    var head = rows.shift();
    return rows.filter(function (r) { return r.length > 1; }).map(function (r) {
      var o = {};
      head.forEach(function (h, j) { o[h] = r[j]; });
      return o;
    });
  }

  /* ═══ Contacts : sélection de ceux à géocoder ═════════════════════ */
  function contacts() {
    return (typeof cdbContacts !== 'undefined' && cdbContacts) ? cdbContacts : [];
  }
  function aUneAdresse(c) {
    return !!(String(c.adresse || '').trim() || String(c.ville || '').trim());
  }
  function estGeocode(c) {
    return typeof c.lat === 'number' && typeof c.lng === 'number' &&
           !isNaN(c.lat) && !isNaN(c.lng);
  }

  /* ═══════════════════════════════════════════════════════════════════
     GÉOCODAGE via l'API Adresse (BAN)
     ═══════════════════════════════════════════════════════════════════ */
  function geocoder(forcerTout) {
    if (state.geoEnCours) { toast('Géocodage déjà en cours', 'err'); return; }

    var cibles = contacts().filter(function (c) {
      if (!aUneAdresse(c)) return false;
      return forcerTout ? true : !estGeocode(c);
    });

    if (!cibles.length) {
      toast(forcerTout ? 'Aucun contact avec adresse' : 'Tout est déjà géocodé', 'ok');
      return;
    }

    state.geoEnCours = true;
    var total = cibles.length, traites = 0, ok = 0, douteux = 0, echecs = 0;
    var lots = [];
    for (var i = 0; i < cibles.length; i += LOT) lots.push(cibles.slice(i, i + LOT));

    progres(0, total, 'Préparation…');

    function lotSuivant(k) {
      if (k >= lots.length) {
        state.geoEnCours = false;
        progres(total, total,
          ok + ' géocodés' + (douteux ? ' · ' + douteux + ' approximatifs' : '') +
          (echecs ? ' · ' + echecs + ' échecs' : ''));
        sauvegarder(cibles.filter(estGeocode));
        setTimeout(function () { render(); }, 400);
        return;
      }

      var lot = lots[k];
      var csv = 'id,adresse,cp,ville\n' + lot.map(function (c) {
        return [csvCell(c.id), csvCell(c.adresse || ''),
                csvCell(c.cp || ''), csvCell(c.ville || '')].join(',');
      }).join('\n');

      var fd = new FormData();
      fd.append('data', new Blob([csv], { type: 'text/csv' }), 'adresses.csv');
      fd.append('columns', 'adresse');
      fd.append('columns', 'ville');
      fd.append('postcode', 'cp');

      progres(traites, total, 'Lot ' + (k + 1) + '/' + lots.length + '…');

      fetch(BAN_CSV, { method: 'POST', body: fd })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.text();
        })
        .then(function (txt) {
          var index = {};
          lot.forEach(function (c) { index[c.id] = c; });

          csvParse(txt).forEach(function (row) {
            var c = index[row.id];
            if (!c) return;
            var lat = parseFloat(row.latitude), lng = parseFloat(row.longitude);
            var score = parseFloat(row.result_score) || 0;
            if (!isNaN(lat) && !isNaN(lng)) {
              c.lat = lat; c.lng = lng;
              c.geoScore = Math.round(score * 100) / 100;
              c.geoLabel = row.result_label || '';
              c.geoAt = Date.now();
              ok++;
              if (score < SCORE_MIN) douteux++;
            } else {
              echecs++;
            }
          });
          traites += lot.length;
          lotSuivant(k + 1);
        })
        .catch(function (e) {
          console.warn('[Tournees] Lot ' + (k + 1) + ' en échec', e);
          echecs += lot.length;
          traites += lot.length;
          lotSuivant(k + 1);
        });
    }
    lotSuivant(0);
  }

  // Reprise unitaire pour un contact précis (après correction d'adresse)
  function geocoderUn(id) {
    var c = contacts().find(function (x) { return x.id === id; });
    if (!c) return;
    var q = [c.adresse, c.cp, c.ville].filter(Boolean).join(' ');
    if (!q.trim()) { toast('Aucune adresse sur cette fiche', 'err'); return; }
    fetch(BAN_ONE + '?q=' + encodeURIComponent(q) + '&limit=1')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var f = j.features && j.features[0];
        if (!f) { toast('Adresse introuvable', 'err'); return; }
        c.lng = f.geometry.coordinates[0];
        c.lat = f.geometry.coordinates[1];
        c.geoScore = Math.round((f.properties.score || 0) * 100) / 100;
        c.geoLabel = f.properties.label || '';
        c.geoAt = Date.now();
        sauvegarder([c]);
        toast('Position trouvée : ' + c.geoLabel, 'ok');
        render();
      })
      .catch(function () { toast('Erreur de géocodage', 'err'); });
  }

  /* ═══ Écriture Firestore (par lots de 400) ════════════════════════ */
  function sauvegarder(liste) {
    if (!liste.length) return;
    try { localStorage.setItem(CDB_CACHE_KEY(), JSON.stringify(cdbContacts)); } catch (e) {}
    if (typeof firebase === 'undefined' || !firebase.firestore) return;
    if (!firebase.apps || !firebase.apps.length) return;

    var fdb = firebase.firestore();
    var BATCH = 400;

    function envoyer(start) {
      if (start >= liste.length) { console.log('[Tournees] positions enregistrées'); return; }
      var end = Math.min(start + BATCH, liste.length);
      var batch = fdb.batch();
      for (var i = start; i < end; i++) {
        var c = liste[i];
        batch.set(bcol('contacts').doc(c.id), {
          lat: c.lat, lng: c.lng,
          geoScore: c.geoScore || null,
          geoLabel: c.geoLabel || '',
          geoAt: c.geoAt || Date.now()
        }, { merge: true });
      }
      batch.commit()
        .then(function () { envoyer(end); })
        .catch(function (e) { console.warn('[Tournees] batch', e); });
    }
    envoyer(0);
  }

  /* ═══ Position de départ ══════════════════════════════════════════ */
  function maPosition() {
    if (!navigator.geolocation) { toast('Géolocalisation indisponible', 'err'); return; }
    toast('📍 Localisation en cours…', 'ok');
    navigator.geolocation.getCurrentPosition(function (p) {
      state.pos = { lat: p.coords.latitude, lng: p.coords.longitude, label: 'Ma position' };
      render();
    }, function (err) {
      toast(err.code === 1 ? 'Autorise la localisation dans les réglages du navigateur'
                           : 'Position indisponible', 'err');
      render();
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }

  function departDepuisClient(id) {
    var c = contacts().find(function (x) { return x.id === id; });
    if (!c || !estGeocode(c)) return;
    state.pos = { lat: c.lat, lng: c.lng, label: c.nom };
    render();
  }

  /* ═══════════════════════════════════════════════════════════════════
     POINT DE DÉPART SAISI À LA MAIN
     Permet de préparer une tournée sans être sur place : on tape une
     adresse, l'autocomplétion BAN propose, on choisit.
     ═══════════════════════════════════════════════════════════════════ */
  var DEP_CLE = 'trn_departs';
  var suggTimer = null;

  function departsEnregistres() {
    try { return JSON.parse(localStorage.getItem(DEP_CLE) || '[]'); }
    catch (e) { return []; }
  }
  function sauverDeparts(liste) {
    try { localStorage.setItem(DEP_CLE, JSON.stringify(liste.slice(0, 8))); } catch (e) {}
  }

  function chercherAdresse(q) {
    var box = document.getElementById('trn-sugg');
    if (!box) return;
    if (suggTimer) clearTimeout(suggTimer);

    q = String(q || '').trim();
    if (q.length < 4) { box.innerHTML = ''; box.style.display = 'none'; return; }

    suggTimer = setTimeout(function () {
      fetch(BAN_ONE + '?q=' + encodeURIComponent(q) + '&limit=5&autocomplete=1')
        .then(function (r) { return r.json(); })
        .then(function (j) {
          state.suggestions = (j.features || []).map(function (f) {
            return {
              label: f.properties.label || '',
              contexte: f.properties.context || '',
              lat: f.geometry.coordinates[1],
              lng: f.geometry.coordinates[0]
            };
          });
          if (!state.suggestions.length) {
            box.innerHTML = '<div class="trn-sugg-vide">Aucune adresse trouvée</div>';
            box.style.display = 'block';
            return;
          }
          box.innerHTML = state.suggestions.map(function (s, i) {
            return '<button class="trn-sugg-i" onclick="Tournees.choisirAdresse(' + i + ')">' +
              '<strong>' + esc(s.label) + '</strong>' +
              '<span>' + esc(s.contexte) + '</span></button>';
          }).join('');
          box.style.display = 'block';
        })
        .catch(function () {
          box.innerHTML = '<div class="trn-sugg-vide">Recherche indisponible (réseau)</div>';
          box.style.display = 'block';
        });
    }, 300);
  }

  function choisirAdresse(i) {
    var s = state.suggestions && state.suggestions[i];
    if (!s) return;
    state.pos = { lat: s.lat, lng: s.lng, label: s.label };
    state.suggestions = null;
    render();
  }

  function enregistrerDepart() {
    if (!state.pos) return;
    var nom = prompt('Nom de ce point de départ (ex : Domicile, Dépôt, Hôtel Lyon) :',
                     state.pos.label.split(',')[0]);
    if (!nom || !nom.trim()) return;
    var liste = departsEnregistres().filter(function (d) {
      return normName(d.nom) !== normName(nom);
    });
    liste.unshift({ nom: nom.trim(), lat: state.pos.lat, lng: state.pos.lng, adresse: state.pos.label });
    sauverDeparts(liste);
    toast('✅ Départ « ' + nom.trim() + ' » enregistré', 'ok');
    render();
  }

  function utiliserDepart(i) {
    var d = departsEnregistres()[i];
    if (!d) return;
    state.pos = { lat: d.lat, lng: d.lng, label: d.nom };
    render();
  }

  function oublierDepart(i) {
    var liste = departsEnregistres();
    if (!liste[i]) return;
    if (!confirm('Retirer « ' + liste[i].nom + ' » des départs enregistrés ?')) return;
    liste.splice(i, 1);
    sauverDeparts(liste);
    render();
  }

  /* ═══ Croisement avec le Radar ════════════════════════════════════ */
  function chargerAnalyses() {
    if (typeof RadarClients === 'undefined') { analyses = {}; return; }
    try {
      var arr = RadarClients.analyse();
      var idx = {};
      arr.forEach(function (a) {
        if (a.contact && a.contact.id) idx[a.contact.id] = a;
      });
      analyses = idx;
    } catch (e) { analyses = {}; }
  }

  /* ═══ Liste calculée ══════════════════════════════════════════════ */
  function liste() {
    var out = contacts().filter(estGeocode).map(function (c) {
      var a = analyses ? analyses[c.id] : null;
      return {
        c: c,
        a: a,
        score: a ? a.score : 0,
        alerte: !!(a && (a.tags.decrochage || a.tags.baisse || a.tags.bientot)),
        dist: state.pos ? distance(state.pos, { lat: c.lat, lng: c.lng }) : null
      };
    });

    if (state.pos && state.rayon) {
      out = out.filter(function (x) { return x.dist <= state.rayon; });
    }
    if (state.seulementAlertes) {
      out = out.filter(function (x) { return x.alerte; });
    }

    out.sort(function (x, y) {
      if (state.tri === 'distance') {
        if (x.dist == null) return 1;
        if (y.dist == null) return -1;
        return x.dist - y.dist;
      }
      if (y.score !== x.score) return y.score - x.score;
      return (x.dist || 0) - (y.dist || 0);
    });
    return out;
  }

  /* ═══ Optimisation d'itinéraire (plus proche voisin) ══════════════ */
  function itineraire() {
    var sel = liste().filter(function (x) { return state.selection[x.c.id]; });
    if (!sel.length) { toast('Sélectionne au moins un client', 'err'); return; }
    if (!state.pos) { toast('Définis d\'abord un point de départ', 'err'); return; }

    var reste = sel.slice(), courant = state.pos, ordre = [];
    while (reste.length) {
      var meilleur = 0, dMin = Infinity;
      for (var i = 0; i < reste.length; i++) {
        var d = distance(courant, { lat: reste[i].c.lat, lng: reste[i].c.lng });
        if (d < dMin) { dMin = d; meilleur = i; }
      }
      var suivant = reste.splice(meilleur, 1)[0];
      suivant.ordre = ordre.length + 1;
      suivant.legKm = dMin;
      ordre.push(suivant);
      courant = { lat: suivant.c.lat, lng: suivant.c.lng };
    }

    // Google Maps limite les waypoints ; on tronque à 10 étapes
    var etapes = ordre.slice(0, 10);
    var pts = etapes.map(function (x) { return x.c.lat + ',' + x.c.lng; });
    var url = 'https://www.google.com/maps/dir/?api=1' +
      '&origin=' + state.pos.lat + ',' + state.pos.lng +
      '&destination=' + pts[pts.length - 1] +
      (pts.length > 1 ? '&waypoints=' + pts.slice(0, -1).join('|') : '') +
      '&travelmode=driving';

    var km = ordre.reduce(function (s, x) { return s + x.legKm; }, 0);
    afficherItineraire(ordre, km, url, etapes.length < ordre.length);
  }

  function afficherItineraire(ordre, km, url, tronque) {
    var box = document.getElementById('trn-itin');
    if (!box) return;
    box.style.display = 'block';
    box.innerHTML =
      '<div class="trn-itin-h">' +
        '<strong>Tournée proposée</strong>' +
        '<span>' + ordre.length + ' arrêts · ~' + Math.round(km) + ' km à vol d\'oiseau</span>' +
      '</div>' +
      '<ol class="trn-itin-l">' + ordre.map(function (x) {
        return '<li><span class="trn-itin-n">' + x.ordre + '</span>' +
               '<span class="trn-itin-t">' + esc(x.c.nom) + '</span>' +
               '<span class="trn-itin-d">' + x.legKm.toFixed(1) + ' km</span></li>';
      }).join('') + '</ol>' +
      (tronque ? '<p class="trn-note">Google Maps n\'accepte que 10 étapes : seules les 10 premières sont ouvertes dans l\'itinéraire.</p>' : '') +
      '<div class="trn-itin-a">' +
        '<a class="trn-btn trn-btn-p" href="' + url + '" target="_blank" rel="noopener">Ouvrir dans Google Maps</a>' +
        '<button class="trn-btn" onclick="Tournees.viderSelection()">Vider la sélection</button>' +
      '</div>';
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /* ═══ Carte Leaflet ═══════════════════════════════════════════════ */
  function chargerLeaflet(cb) {
    if (global.L) { cb(); return; }
    if (!document.getElementById('trn-leaflet-css')) {
      var l = document.createElement('link');
      l.id = 'trn-leaflet-css'; l.rel = 'stylesheet'; l.href = LEAFLET_CSS;
      document.head.appendChild(l);
    }
    var s = document.createElement('script');
    s.src = LEAFLET_JS;
    s.onload = cb;
    s.onerror = function () {
      var el = document.getElementById('trn-map');
      if (el) el.innerHTML = '<div class="trn-map-err">Carte indisponible (réseau). La liste reste utilisable.</div>';
    };
    document.head.appendChild(s);
  }

  function dessinerCarte(items) {
    var el = document.getElementById('trn-map');
    if (!el || !global.L) return;

    if (!map) {
      map = L.map(el, { scrollWheelZoom: false });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '© OpenStreetMap'
      }).addTo(map);
    }
    if (layer) map.removeLayer(layer);
    layer = L.layerGroup().addTo(map);

    var pts = [];

    if (state.pos) {
      L.circleMarker([state.pos.lat, state.pos.lng], {
        radius: 8, color: '#185fa5', fillColor: '#2070c8', fillOpacity: 1, weight: 3
      }).bindPopup('<strong>' + esc(state.pos.label) + '</strong>').addTo(layer);
      pts.push([state.pos.lat, state.pos.lng]);
    }

    items.forEach(function (x) {
      var couleur = x.a && x.a.tags.decrochage ? '#c0392b'
                  : x.a && x.a.tags.baisse ? '#c97c1a'
                  : x.a && x.a.tags.bientot ? '#2070c8'
                  : '#5080a0';
      var m = L.circleMarker([x.c.lat, x.c.lng], {
        radius: 6, color: '#fff', weight: 2, fillColor: couleur, fillOpacity: .9
      }).addTo(layer);
      m.bindPopup(
        '<strong>' + esc(x.c.nom) + '</strong><br>' +
        (x.dist != null ? x.dist.toFixed(1) + ' km<br>' : '') +
        (x.a && x.a.motifs.length ? esc(x.a.motifs[0].txt) + '<br>' : '') +
        (x.c.telephone ? '<a href="tel:' + esc(String(x.c.telephone).replace(/[^\d+]/g, '')) + '">Appeler</a>' : '')
      );
      pts.push([x.c.lat, x.c.lng]);
    });

    if (pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 13 });
    else map.setView([46.6, 2.3], 5);
    setTimeout(function () { map.invalidateSize(); }, 150);
  }

  /* ═══ Rendu ═══════════════════════════════════════════════════════ */
  function progres(fait, total, txt) {
    var el = document.getElementById('trn-progres');
    if (!el) return;
    var pct = total ? Math.round((fait / total) * 100) : 0;
    el.style.display = 'block';
    el.innerHTML =
      '<div class="trn-prog-t">' + esc(txt) + ' — ' + fait + '/' + total + '</div>' +
      '<div class="trn-prog-b"><div class="trn-prog-f" style="width:' + pct + '%"></div></div>';
  }

  function render() {
    var root = document.getElementById('trn-root');
    if (!root) return;

    var tous = contacts();
    var avecAdresse = tous.filter(aUneAdresse).length;
    var geocodes = tous.filter(estGeocode).length;
    var manquants = avecAdresse - geocodes;
    var sansAdresse = tous.length - avecAdresse;

    if (!tous.length) {
      root.innerHTML =
        '<div class="trn-empty"><div class="trn-empty-ico">🗺️</div>' +
        '<h3>Base clients vide</h3>' +
        '<p>Importe ta base clients, puis reviens ici pour géocoder les adresses.</p>' +
        '<button class="trn-btn trn-btn-p" onclick="showSection(\'contacts-db\',null,null)">Aller à la base clients</button></div>';
      return;
    }

    /* Bandeau géocodage */
    var geo =
      '<div class="trn-geo">' +
        '<div class="trn-geo-txt">' +
          '<strong>' + geocodes + '</strong> clients positionnés sur ' + avecAdresse + ' avec adresse' +
          (sansAdresse ? ' <span class="trn-mute">(' + sansAdresse + ' sans adresse)</span>' : '') +
        '</div>' +
        '<div class="trn-geo-act">' +
          (manquants > 0
            ? '<button class="trn-btn trn-btn-p" onclick="Tournees.geocoder(false)">Géocoder les ' + manquants + ' manquants</button>'
            : '') +
          '<button class="trn-btn" onclick="Tournees.geocoder(true)">Tout regéocoder</button>' +
        '</div>' +
      '</div>' +
      '<div id="trn-progres" class="trn-prog" style="display:none"></div>';

    if (!geocodes) {
      root.innerHTML = geo +
        '<div class="trn-empty"><div class="trn-empty-ico">📍</div>' +
        '<h3>Aucune position enregistrée</h3>' +
        '<p>Lance le géocodage : les adresses de ta base sont converties en coordonnées via l\'API Adresse (data.gouv.fr), puis stockées. C\'est à faire une seule fois.</p></div>';
      return;
    }

    /* Bloc « point de départ » : GPS, adresse saisie, ou départ enregistré */
    var favoris = departsEnregistres();
    var dejaEnregistre = state.pos && favoris.some(function (d) {
      return Math.abs(d.lat - state.pos.lat) < 0.0002 && Math.abs(d.lng - state.pos.lng) < 0.0002;
    });

    var barre =
      '<div class="trn-depart">' +
        '<div class="trn-depart-t">Point de départ</div>' +
        '<div class="trn-bar">' +
          '<button class="trn-btn trn-btn-p" onclick="Tournees.maPosition()">📍 Ma position</button>' +
          '<div class="trn-adr">' +
            '<input id="trn-dep-input" class="trn-adr-in" type="search" autocomplete="off"' +
            ' placeholder="ou saisis une adresse de départ…"' +
            ' oninput="Tournees.chercherAdresse(this.value)">' +
            '<div id="trn-sugg" class="trn-sugg" style="display:none"></div>' +
          '</div>' +
        '</div>' +
        (favoris.length
          ? '<div class="trn-favs">' + favoris.map(function (d, i) {
              return '<span class="trn-fav">' +
                '<button onclick="Tournees.utiliserDepart(' + i + ')" title="' + esc(d.adresse || '') + '">' +
                  esc(d.nom) + '</button>' +
                '<button class="trn-fav-x" onclick="Tournees.oublierDepart(' + i + ')" title="Retirer">✕</button>' +
              '</span>';
            }).join('') + '</div>'
          : '') +
        '<div class="trn-pos-l">' +
          (state.pos
            ? '<span class="trn-pos-ok">Départ : <strong>' + esc(state.pos.label) + '</strong></span>' +
              (dejaEnregistre ? '' : '<button class="trn-btn trn-btn-s" onclick="Tournees.enregistrerDepart()">☆ Enregistrer ce départ</button>')
            : '<span class="trn-pos">Aucun point de départ — les distances ne sont pas calculées</span>') +
        '</div>' +
      '</div>' +
      '<div class="trn-filtres">' +
        '<label>Rayon' +
          '<select onchange="Tournees.setRayon(this.value)">' +
            [10, 25, 50, 100, 0].map(function (r) {
              return '<option value="' + r + '"' + (state.rayon === r ? ' selected' : '') + '>' +
                     (r ? r + ' km' : 'Tous') + '</option>';
            }).join('') +
          '</select>' +
        '</label>' +
        '<label>Tri' +
          '<select onchange="Tournees.setTri(this.value)">' +
            '<option value="urgence"' + (state.tri === 'urgence' ? ' selected' : '') + '>Priorité commerciale</option>' +
            '<option value="distance"' + (state.tri === 'distance' ? ' selected' : '') + '>Distance</option>' +
          '</select>' +
        '</label>' +
        '<label class="trn-check">' +
          '<input type="checkbox"' + (state.seulementAlertes ? ' checked' : '') +
          ' onchange="Tournees.setAlertes(this.checked)"> Alertes uniquement' +
        '</label>' +
      '</div>';

    var items = liste();
    var nbSel = Object.keys(state.selection).length;

    var actions = nbSel
      ? '<div class="trn-actions"><span>' + nbSel + ' client' + (nbSel > 1 ? 's' : '') + ' sélectionné' + (nbSel > 1 ? 's' : '') + '</span>' +
        '<button class="trn-btn trn-btn-p" onclick="Tournees.itineraire()">Calculer la tournée</button>' +
        '<button class="trn-btn" onclick="Tournees.viderSelection()">Vider</button></div>'
      : '';

    var lignes = items.length
      ? items.map(carte).join('')
      : '<div class="trn-none">Aucun client dans ce rayon. Élargis le rayon ou change de point de départ.</div>';

    root.innerHTML =
      geo + barre +
      '<div id="trn-map" class="trn-map"></div>' +
      '<div id="trn-itin" class="trn-itin" style="display:none"></div>' +
      actions +
      '<div class="trn-list">' + lignes + '</div>';

    chargerLeaflet(function () { dessinerCarte(items); });
  }

  function carte(x) {
    var c = x.c, a = x.a;
    var tel = c.telephone ? String(c.telephone).replace(/[^\d+]/g, '') : '';
    var motif = a && a.motifs.length ? a.motifs[0] : null;
    var douteux = typeof c.geoScore === 'number' && c.geoScore < SCORE_MIN;

    return '<article class="trn-card' + (state.selection[c.id] ? ' sel' : '') + '">' +
      '<label class="trn-card-h">' +
        '<input type="checkbox"' + (state.selection[c.id] ? ' checked' : '') +
        ' onchange="Tournees.toggle(\'' + esc(c.id) + '\',this.checked)">' +
        '<span class="trn-card-t">' +
          '<strong>' + esc(c.nom) + '</strong>' +
          '<span class="trn-card-s">' + esc([c.cp, c.ville].filter(Boolean).join(' ')) +
          (douteux ? ' · <span class="trn-warn">position approximative</span>' : '') + '</span>' +
        '</span>' +
        (x.dist != null ? '<span class="trn-dist">' + x.dist.toFixed(1) + '<small>km</small></span>' : '') +
      '</label>' +
      (motif ? '<div class="trn-motif trn-m-' + motif.ton + '">' + esc(motif.txt) + '</div>' : '') +
      '<div class="trn-acts">' +
        (tel ? '<a class="trn-act" href="tel:' + esc(tel) + '">📞</a>' : '') +
        '<a class="trn-act" href="https://www.google.com/maps/dir/?api=1&destination=' +
          c.lat + ',' + c.lng + '&travelmode=driving" target="_blank" rel="noopener">🧭 Y aller</a>' +
        '<button class="trn-act" onclick="Tournees.depart(\'' + esc(c.id) + '\')">Partir d\'ici</button>' +
        '<button class="trn-act" onclick="Tournees.commande(\'' + esc(c.id) + '\')">🛒</button>' +
        (typeof Visites !== 'undefined'
          ? '<button class="trn-act" onclick="Tournees.visite(\'' + esc(c.id) + '\')">📝 CR</button>' : '') +
        (douteux ? '<button class="trn-act" onclick="Tournees.geocoderUn(\'' + esc(c.id) + '\')">Corriger</button>' : '') +
      '</div>' +
      '</article>';
  }

  /* ═══ Styles ══════════════════════════════════════════════════════ */
  var CSS = [
    '#sec-tournees .trn-geo{display:flex;flex-wrap:wrap;gap:.6rem;align-items:center;justify-content:space-between;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:.75rem 1rem;margin-bottom:.75rem;box-shadow:var(--shadow-xs)}',
    '#sec-tournees .trn-geo-txt{font-size:.85rem;color:var(--g700)}',
    '#sec-tournees .trn-mute{color:var(--g500)}',
    '#sec-tournees .trn-geo-act{display:flex;gap:.4rem;flex-wrap:wrap}',
    '#sec-tournees .trn-btn{border:1px solid var(--border-med);background:var(--surface);color:var(--g700);border-radius:9px;padding:.45rem .75rem;font-size:.78rem;font-weight:600;cursor:pointer;font-family:inherit;text-decoration:none;display:inline-flex;align-items:center}',
    '#sec-tournees .trn-btn-p{background:var(--blue-p700);border-color:var(--blue-p700);color:#fff}',
    '#sec-tournees .trn-prog{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:.7rem 1rem;margin-bottom:.75rem}',
    '#sec-tournees .trn-prog-t{font-size:.78rem;color:var(--g600);margin-bottom:.35rem}',
    '#sec-tournees .trn-prog-b{height:6px;background:var(--g200);border-radius:999px;overflow:hidden}',
    '#sec-tournees .trn-prog-f{height:100%;background:var(--blue-p600);border-radius:999px;transition:width .3s}',
    '#sec-tournees .trn-depart{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:.8rem 1rem;margin-bottom:.75rem;box-shadow:var(--shadow-xs)}',
    '#sec-tournees .trn-depart-t{font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--g500);margin-bottom:.5rem}',
    '#sec-tournees .trn-bar{display:flex;gap:.5rem;align-items:flex-start;flex-wrap:wrap}',
    '#sec-tournees .trn-adr{position:relative;flex:1;min-width:230px}',
    '#sec-tournees .trn-adr-in{width:100%;box-sizing:border-box;border:1px solid var(--border-med);border-radius:9px;padding:.45rem .7rem;font-size:.82rem;font-family:inherit;background:var(--surface);color:var(--g900)}',
    '#sec-tournees .trn-sugg{position:absolute;top:calc(100% + 4px);left:0;right:0;background:var(--surface);border:1px solid var(--border-med);border-radius:10px;box-shadow:0 10px 28px rgba(30,45,78,.16);z-index:50;overflow:hidden}',
    '#sec-tournees .trn-sugg-i{display:flex;flex-direction:column;align-items:flex-start;gap:.05rem;width:100%;text-align:left;border:none;background:none;padding:.5rem .7rem;cursor:pointer;font-family:inherit;border-bottom:1px solid var(--border)}',
    '#sec-tournees .trn-sugg-i:last-child{border-bottom:none}',
    '#sec-tournees .trn-sugg-i:hover{background:var(--blue-p50)}',
    '#sec-tournees .trn-sugg-i strong{font-size:.81rem;color:var(--g900);font-weight:600}',
    '#sec-tournees .trn-sugg-i span{font-size:.69rem;color:var(--g500)}',
    '#sec-tournees .trn-sugg-vide{padding:.6rem .7rem;font-size:.78rem;color:var(--g500)}',
    '#sec-tournees .trn-favs{display:flex;gap:.35rem;flex-wrap:wrap;margin-top:.6rem}',
    '#sec-tournees .trn-fav{display:inline-flex;align-items:stretch;border:1px solid var(--border-med);border-radius:999px;overflow:hidden;background:var(--surface2)}',
    '#sec-tournees .trn-fav button{border:none;background:none;font-family:inherit;font-size:.73rem;font-weight:600;color:var(--g700);padding:.28rem .6rem;cursor:pointer}',
    '#sec-tournees .trn-fav button:hover{background:var(--blue-p50);color:var(--blue-p700)}',
    '#sec-tournees .trn-fav-x{color:var(--g400)!important;padding:.28rem .5rem .28rem .3rem!important;border-left:1px solid var(--border)!important}',
    '#sec-tournees .trn-pos-l{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin-top:.6rem;padding-top:.6rem;border-top:1px solid var(--border)}',
    '#sec-tournees .trn-pos-ok{font-size:.79rem;color:var(--g700)}',
    '#sec-tournees .trn-pos-ok strong{color:var(--blue-p700)}',
    '#sec-tournees .trn-btn-s{padding:.28rem .6rem;font-size:.72rem}',
    '#sec-tournees .trn-pos{font-size:.79rem;color:var(--g500)}',
    '#sec-tournees .trn-filtres{display:flex;gap:.75rem;flex-wrap:wrap;align-items:center;margin-bottom:.75rem}',
    '#sec-tournees .trn-filtres label{font-size:.72rem;color:var(--g600);display:flex;flex-direction:column;gap:.15rem}',
    '#sec-tournees .trn-filtres select{border:1px solid var(--border-med);border-radius:8px;padding:.35rem .5rem;font-size:.8rem;background:var(--surface);color:var(--g900);font-family:inherit}',
    '#sec-tournees .trn-check{flex-direction:row!important;align-items:center;gap:.35rem!important;font-size:.78rem!important;color:var(--g700)!important}',
    '#sec-tournees .trn-map{height:320px;border-radius:14px;border:1px solid var(--border);overflow:hidden;margin-bottom:.75rem;background:var(--g100)}',
    '#sec-tournees .trn-map-err{display:flex;align-items:center;justify-content:center;height:100%;font-size:.82rem;color:var(--g500);padding:1rem;text-align:center}',
    '#sec-tournees .trn-itin{background:var(--surface);border:1px solid var(--blue-p300);border-radius:14px;padding:1rem;margin-bottom:.75rem}',
    '#sec-tournees .trn-itin-h{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:.4rem;margin-bottom:.6rem}',
    '#sec-tournees .trn-itin-h strong{color:var(--g900);font-size:.92rem}',
    '#sec-tournees .trn-itin-h span{font-size:.75rem;color:var(--g600)}',
    '#sec-tournees .trn-itin-l{list-style:none;padding:0;margin:0 0 .75rem}',
    '#sec-tournees .trn-itin-l li{display:flex;align-items:center;gap:.5rem;padding:.3rem 0;border-bottom:1px solid var(--border);font-size:.82rem}',
    '#sec-tournees .trn-itin-n{flex-shrink:0;width:20px;height:20px;border-radius:50%;background:var(--blue-p700);color:#fff;font-size:.68rem;font-weight:700;display:flex;align-items:center;justify-content:center}',
    '#sec-tournees .trn-itin-t{flex:1;color:var(--g800);font-weight:600}',
    '#sec-tournees .trn-itin-d{color:var(--g500);font-size:.74rem}',
    '#sec-tournees .trn-itin-a{display:flex;gap:.4rem;flex-wrap:wrap}',
    '#sec-tournees .trn-note{font-size:.72rem;color:var(--amber);margin:.25rem 0 .6rem}',
    '#sec-tournees .trn-actions{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;background:var(--blue-p50);border:1px solid var(--blue-p300);border-radius:10px;padding:.5rem .75rem;margin-bottom:.75rem;font-size:.8rem;color:var(--blue-p700);font-weight:600}',
    '#sec-tournees .trn-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:.7rem}',
    '#sec-tournees .trn-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:.75rem;box-shadow:var(--shadow-xs);display:flex;flex-direction:column;gap:.5rem}',
    '#sec-tournees .trn-card.sel{border-color:var(--blue-p500);box-shadow:0 0 0 2px var(--blue-p100)}',
    '#sec-tournees .trn-card-h{display:flex;align-items:flex-start;gap:.55rem;cursor:pointer}',
    '#sec-tournees .trn-card-h input{margin-top:.2rem;flex-shrink:0;width:17px;height:17px;accent-color:var(--blue-p700)}',
    '#sec-tournees .trn-card-t{flex:1;display:flex;flex-direction:column;min-width:0}',
    '#sec-tournees .trn-card-t strong{font-size:.9rem;color:var(--g900);line-height:1.25}',
    '#sec-tournees .trn-card-s{font-size:.7rem;color:var(--g500)}',
    '#sec-tournees .trn-warn{color:var(--amber)}',
    '#sec-tournees .trn-dist{flex-shrink:0;font-size:1rem;font-weight:700;color:var(--blue-p700)}',
    '#sec-tournees .trn-dist small{font-size:.6rem;font-weight:600;color:var(--g500);margin-left:1px}',
    '#sec-tournees .trn-motif{font-size:.74rem;font-weight:600;padding:.3rem .5rem;border-radius:7px;line-height:1.3}',
    '#sec-tournees .trn-m-red{background:var(--red-bg);color:var(--red)}',
    '#sec-tournees .trn-m-amber{background:var(--amber-bg);color:var(--amber)}',
    '#sec-tournees .trn-m-green{background:var(--green-bg);color:var(--green)}',
    '#sec-tournees .trn-m-blue{background:var(--blue-bg);color:var(--blue-p700)}',
    '#sec-tournees .trn-m-grey{background:var(--g100);color:var(--g600)}',
    '#sec-tournees .trn-acts{display:flex;gap:.3rem;flex-wrap:wrap;border-top:1px solid var(--border);padding-top:.5rem}',
    '#sec-tournees .trn-act{border:1px solid var(--border-med);background:var(--surface2);color:var(--g700);border-radius:7px;padding:.3rem .5rem;font-size:.72rem;font-weight:600;cursor:pointer;text-decoration:none;font-family:inherit}',
    '#sec-tournees .trn-none{grid-column:1/-1;text-align:center;padding:2rem;color:var(--g500);font-size:.85rem}',
    '#sec-tournees .trn-empty{text-align:center;padding:2.5rem 1rem;color:var(--g600)}',
    '#sec-tournees .trn-empty-ico{font-size:2.5rem}',
    '#sec-tournees .trn-empty h3{margin:.5rem 0 .25rem;color:var(--g900);font-size:1rem}',
    '#sec-tournees .trn-empty p{font-size:.85rem;max-width:460px;margin:0 auto 1rem;line-height:1.5}',
    '@media(max-width:640px){#sec-tournees .trn-list{grid-template-columns:1fr}#sec-tournees .trn-map{height:260px}}'
  ].join('');

  function injectCSS() {
    if (document.getElementById('trn-styles')) return;
    var st = document.createElement('style');
    st.id = 'trn-styles';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  /* ═══ API publique ════════════════════════════════════════════════ */
  var API = {
    mount: function () { injectCSS(); chargerAnalyses(); render(); },
    unmount: function () { if (map) { map.remove(); map = null; layer = null; } },
    refresh: function () { chargerAnalyses(); render(); },
    geocoder: geocoder,
    geocoderUn: geocoderUn,
    maPosition: maPosition,
    chercherAdresse: chercherAdresse,
    choisirAdresse: choisirAdresse,
    enregistrerDepart: enregistrerDepart,
    utiliserDepart: utiliserDepart,
    oublierDepart: oublierDepart,
    depart: departDepuisClient,
    setRayon: function (v) { state.rayon = Number(v); render(); },
    setTri: function (v) { state.tri = v; render(); },
    setAlertes: function (v) { state.seulementAlertes = !!v; render(); },
    toggle: function (id, v) {
      if (v) state.selection[id] = true; else delete state.selection[id];
      render();
    },
    viderSelection: function () { state.selection = {}; render(); },
    itineraire: itineraire,
    visite: function (id) {
      if (typeof Visites !== 'undefined') Visites.nouvelle(id);
    },
    commande: function (id) {
      if (typeof cdbNewOrder === 'function') cdbNewOrder(id);
      else toast('Module commande indisponible', 'err');
    }
  };

  global.Tournees = API;
})(window);
