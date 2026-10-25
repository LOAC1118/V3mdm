/* =======================================================================
   bdc-mail.js — « 📥 Importer une commande » : une seule entrée pour les commandes
   reçues par MAIL (texte collé), EXCEL / CSV ou PDF. Le CRM repère les codes
   articles (ou EAN, ou libellé), les quantités et les produits à retirer, affiche
   un aperçu modifiable puis ajoute le tout au bon de commande en cours (BDC).
   • codes reconnus d'après le catalogue de la marque active (PRODUCTS)
   • code inconnu ou mal écrit → suggestions par ressemblance du libellé
   • lignes « supprimer / retirer … CODE » → proposées en retrait du bon
   • cumul avec les quantités déjà présentes dans le bon
   API : BdcMail.open()
   ======================================================================= */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function note(m, t) { try { if (typeof toast === 'function') return toast(m, t || 'ok'); } catch (e) {} }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
  function stem(w) { return w.length > 4 ? w.replace(/(s|x)$/, '') : w; }
  function words(s) { return norm(s).split(' ').filter(function (w) { return w.length > 2 && ['bio', 'les', 'des', 'aux', 'the', 'avec', 'sans', 'pour', 'une'].indexOf(w) === -1; }).map(stem); }

  function catalogue() { var P = []; try { P = (typeof PRODUCTS !== 'undefined' && PRODUCTS) ? PRODUCTS : []; } catch (e) {} return P; }

  // Suggestions : produits dont le libellé ressemble au texte de la ligne
  function suggest(label, P, k, code) {
    var L = words(label); if (!L.length) return [];
    var dg = String(code || '').replace(/\D/g, '');
    return P.map(function (p) {
      var W = words(p.libelle), hit = 0;
      L.forEach(function (a) { if (W.some(function (b) { return b === a || (a.length >= 4 && b.indexOf(a) === 0) || (b.length >= 4 && a.indexOf(b) === 0); })) hit++; });
      var bonus = (dg && (String(p.code).slice(-dg.length) === dg || new RegExp('\\b' + dg + ' ?(g|kg|cl|ml)\\b', 'i').test(p.libelle))) ? 0.1 : 0;
      return { p: p, s: hit / L.length - 0.02 * Math.max(0, W.length - L.length) + bonus };
    }).filter(function (x) { return x.s >= 0.5; }).sort(function (a, b) { return b.s - a.s; }).slice(0, k || 4);
  }

  function qtyOf(line) {
    var m = line.match(/(?:^|\s)(?:x|×)\s*(\d{1,3})\b/i) || line.match(/\b(\d{1,3})\s*(?:x|×)(?:\s|$)/i)
      || line.match(/(?:qt[ée]?|quantit[ée]|qte)\s*[:=]?\s*(\d{1,3})\b/i) || line.match(/^\s*[-•*]?\s*(\d{1,3})\s*(?:[-–:]\s*|\s+)(?=[A-Za-zÀ-ÿ])/);
    return m ? Math.max(1, parseInt(m[1], 10)) : 1;
  }

  // Analyse du texte → { add:[{code,lib,qty,line}], remove:[{code,lib,line}], unknown:[{label,qty,sugg,line,remove}], reglement:bool }
  function parse(text, P, bdc) {
    var byCode = {}; P.forEach(function (p) { byCode[String(p.code).toUpperCase()] = p; });
    var res = { add: [], remove: [], unknown: [], reglement: /règlement|reglement|paiement|échéance|echeance/i.test(text) }, seen = {};
    String(text || '').split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim(); if (!line) return;
      var isRemove = /supprim|retir|enlev|annul|sans (?:les|le|la)\b|plus de /i.test(line);
      var toks = (line.match(/[A-Z0-9][A-Z0-9]{2,}/g) || []).filter(function (t) { return /[A-Z]/.test(t); });
      var known = toks.filter(function (t) { return byCode[t] || (isRemove && bdc[t] > 0); });
      var label = line.replace(/\.{2,}.*$/, '').replace(/\s{2,}.*$/, '').replace(/^[-•*\d.)\s]+/, '').replace(/\([A-Z0-9]+\)/g, '').trim();
      if (known.length) {
        known.forEach(function (c) {
          if (seen[(isRemove ? 'r' : 'a') + c]) return; seen[(isRemove ? 'r' : 'a') + c] = 1;
          if (isRemove) res.remove.push({ code: c, lib: byCode[c] ? byCode[c].libelle : c, line: line, inBdc: !!(bdc[c] > 0) });
          else res.add.push({ code: c, lib: byCode[c].libelle, qty: qtyOf(line), line: line, stock: byCode[c].stock, inBdc: bdc[c] || 0 });
        });
        return;
      }
      // pas de code connu : ligne de liste avec un code inconnu à la fin, ou ligne de suppression avec un code entre parenthèses
      var tail = line.match(/(?:\.{2,}|…|\s{2,}|\t|\()\s*([A-Z][A-Z0-9]{3,})\s*\)?\s*$/) || (isRemove ? line.match(/\(([A-Z][A-Z0-9]{3,})\)/) : null);
      if (tail) {
        var lab = isRemove ? (line.replace(/^.*?(?:supprimer|retirer|enlever)\s+(?:les\s+|le\s+|la\s+|l')?/i, '').replace(/\(.*$/, '').trim() || tail[1]) : label;
        res.unknown.push({ label: lab, code: tail[1], qty: qtyOf(line), sugg: suggest(lab, P, 4, tail[1]), line: line, remove: isRemove });
      }
    });
    return res;
  }


  // ── Excel / CSV ──
  function toNum(v) { var n = parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? null : n; }
  function parseSheet(aoa, P) {
    var byCode = {}, byEan = {}; P.forEach(function (p) { byCode[String(p.code).toUpperCase()] = p; if (p.ean) { byEan[String(p.ean).replace(/\D/g, '').replace(/^0+/, '')] = p; } });
    var H = { code: /^(code|réf|ref|référence|reference|article|sku|code article|cod\.?)/i, ean: /(ean|gencod|gtin|code.?barre)/i, lib: /(désignation|designation|libell|produit|nom|description|intitul)/i, qty: /(quantit|qté|qte|qty|colis|nb |commandé|commande|unité|uvc|pièces|carton)/i };
    var hi = -1, cols = {};
    for (var i = 0; i < Math.min(aoa.length, 25) && hi < 0; i++) {
      var c = {}; (aoa[i] || []).forEach(function (cell, j) { var t = String(cell || '').trim(); if (!t) return; ['qty', 'ean', 'code', 'lib'].forEach(function (k) { if (c[k] == null && H[k].test(t)) c[k] = j; }); });
      if (c.qty != null && (c.code != null || c.ean != null || c.lib != null)) { hi = i; cols = c; }
    }
    var start = hi + 1;
    if (hi < 0) {   // pas d'en-têtes : on devine par le contenu
      start = 0; var best = { n: 0 }, ncol = Math.max.apply(null, aoa.slice(0, 40).map(function (r) { return (r || []).length; }).concat([0]));
      for (var j = 0; j < ncol; j++) {
        var hc = 0, he = 0; aoa.slice(0, 200).forEach(function (r) { var v = String((r || [])[j] == null ? '' : r[j]).trim(); if (byCode[v.toUpperCase()]) hc++; else if (byEan[v.replace(/\D/g, '').replace(/^0+/, '')]) he++; });
        if (hc > best.n) best = { n: hc, j: j, t: 'code' }; if (he > best.n) best = { n: he, j: j, t: 'ean' };
      }
      if (!best.n) return { add: [], remove: [], unknown: [], err: 'Aucune colonne code article / EAN reconnue dans ce fichier.' };
      cols[best.t] = best.j;
      for (var q = 0; q < ncol && cols.qty == null; q++) { if (q === best.j) continue; var ints = 0, tot = 0; aoa.slice(0, 200).forEach(function (r) { var n = toNum((r || [])[q]); if ((r || [])[q] !== '' && (r || [])[q] != null) { tot++; if (n != null && n > 0 && n < 1000 && n === Math.floor(n)) ints++; } }); if (tot > 2 && ints / tot > 0.8) cols.qty = q; }
    }
    var res = { add: [], remove: [], unknown: [], reglement: false, unitHint: '' };
    if (hi >= 0 && cols.qty != null) { var qh = String(aoa[hi][cols.qty]); if (/uvc|unit|pièce|piece/i.test(qh)) res.unitHint = 'uvc'; else if (/colis|carton|ctn/i.test(qh)) res.unitHint = 'colis'; }
    var seen = {};
    for (var r = start; r < aoa.length; r++) {
      var row = aoa[r] || [], qty = cols.qty != null ? toNum(row[cols.qty]) : 1;
      if (qty == null || qty <= 0) continue; qty = Math.round(qty);
      var rawC = cols.code != null ? String(row[cols.code] == null ? '' : row[cols.code]).trim() : '', rawE = cols.ean != null ? String(row[cols.ean] == null ? '' : row[cols.ean]).replace(/\D/g, '').replace(/^0+/, '') : '';
      var lab = cols.lib != null ? String(row[cols.lib] || '').trim() : '', pr = byCode[rawC.toUpperCase()] || (rawE && byEan[rawE]) || null;
      var line = row.filter(function (x) { return x !== '' && x != null; }).join(' · ');
      if (pr) { if (seen[pr.code]) { var ex = res.add.filter(function (a) { return a.code === pr.code; })[0]; if (ex) ex.qty += qty; continue; } seen[pr.code] = 1; res.add.push({ code: pr.code, lib: pr.libelle, qty: qty, line: line, stock: pr.stock, inBdc: 0, pcb: pr.pcb }); }
      else if (rawC || rawE || lab) res.unknown.push({ label: lab || rawC || rawE, code: rawC || rawE, qty: qty, sugg: suggest(lab || rawC, P, 4, rawC), line: line, remove: false });
    }
    return res;
  }
  // ── PDF : lignes de texte → codes / EAN + quantité ──
  function parsePdfLines(lines, P) {
    var byCode = {}, byEan = {}; P.forEach(function (p) { byCode[String(p.code).toUpperCase()] = p; if (p.ean) byEan[String(p.ean).replace(/\D/g, '')] = p; });
    var res = { add: [], remove: [], unknown: [], reglement: lines.some(function (l) { return /règlement|reglement|paiement/i.test(l); }), unitHint: '' }, seen = {}, nl = 0;
    lines.forEach(function (raw) {
      var line = raw.replace(/\s+/g, ' ').trim(); if (!line) return; nl++;
      var pr = null, used = '';
      (line.match(/[A-Z0-9][A-Z0-9]{2,}/g) || []).some(function (t) { if (/[A-Z]/.test(t) && byCode[t]) { pr = byCode[t]; used = t; return true; } return false; });
      if (!pr) (line.match(/\b\d{12,14}\b/g) || []).some(function (t) { if (byEan[t] || byEan[t.replace(/^0+/, '')]) { pr = byEan[t] || byEan[t.replace(/^0+/, '')]; used = t; return true; } return false; });
      var rest = line.replace(used, ' ').replace(/\d+[.,]\d{1,3}\s*(€|eur)?/gi, ' ').replace(/\b\d{8,}\b/g, ' ').replace(/\b\d+\s?(g|kg|cl|ml|l)\b/gi, ' ');
      var m = rest.match(/(?:^|\s|x|×)(\d{1,3})(?=\s|$)/); var qty = m ? parseInt(m[1], 10) : 1; if (!qty) qty = 1;
      if (pr) { if (seen[pr.code]) return; seen[pr.code] = 1; res.add.push({ code: pr.code, lib: pr.libelle, qty: qty, line: line, stock: pr.stock, inBdc: 0 }); return; }
      var lab = line.replace(/\d+[.,]\d+/g, ' ').replace(/[^A-Za-zÀ-ÿ'0-9 ]+/g, ' ').replace(/\b\d{1,3}\b(?!\s?(g|kg|cl|ml|l)\b)/gi, ' ').replace(/\s+/g, ' ').trim();
      if (lab.length >= 8 && /\d/.test(line)) { var sg = suggest(lab, P, 3); if (sg.length && sg[0].s >= 0.75) res.unknown.push({ label: lab, code: '', qty: qty, sugg: sg, line: line, remove: false }); }
    });
    res.nLines = nl; return res;
  }
  function pdfToLines(file) {
    return new Promise(function (ok, ko) {
      var go = function () {
        file.arrayBuffer().then(function (buf) { return pdfjsLib.getDocument({ data: buf }).promise; }).then(function (pdf) {
          var out = [], chain = Promise.resolve();
          for (var p = 1; p <= pdf.numPages; p++) (function (pn) { chain = chain.then(function () { return pdf.getPage(pn); }).then(function (pg) { return pg.getTextContent(); }).then(function (tc) {
            var items = tc.items.filter(function (it) { return it.str && it.str.trim(); }).sort(function (a, b) { var dy = Math.round(b.transform[5]) - Math.round(a.transform[5]); return dy !== 0 ? dy : a.transform[4] - b.transform[4]; });
            var cur = [], last = null; items.forEach(function (it) { var y = Math.round(it.transform[5]); if (last !== null && Math.abs(y - last) > 4) { if (cur.length) out.push(cur.join(' ')); cur = []; } cur.push(it.str); last = y; }); if (cur.length) out.push(cur.join(' '));
          }); })(p);
          return chain.then(function () { ok(out); });
        }).catch(ko);
      };
      if (typeof pdfjsLib !== 'undefined') return go();
      if (typeof withPdfJs === 'function') withPdfJs(go, function () { ko(new Error('Lecteur PDF indisponible')); }); else ko(new Error('Lecteur PDF indisponible'));
    });
  }
  function fileChosen(inp) {
    var f = inp && inp.files && inp.files[0]; if (!f) return;
    var ext = f.name.split('.').pop().toLowerCase(), st = $('bml-st'); if (st) st.textContent = 'Lecture de « ' + f.name + ' »…';
    var P = catalogue(), done = function (R) { if (st) st.textContent = '« ' + f.name + ' » lu'; setResult(R); };
    var fail = function (e) { if (st) st.textContent = 'Lecture impossible : ' + ((e && e.message) || e); };
    if (ext === 'pdf') {
      pdfToLines(f).then(function (lines) { var R = parsePdfLines(lines, P); if (!lines.length) R.err = 'PDF sans texte exploitable (document scanné ?). Saisissez ou collez le contenu à la place.'; else if (!R.add.length && !R.unknown.length) R.err = 'Aucun code article ni EAN reconnu dans ce PDF.'; done(R); }).catch(fail);
    } else if (ext === 'csv' || ext === 'txt' || ext === 'eml') {
      var rd = new FileReader(); rd.onload = function (e) {
        var t = String(e.target.result || '');
        if (ext === 'csv') { var rows = t.split(/\r?\n/).filter(function (l) { return l.trim(); }), sep = (rows[0].match(/;/g) || []).length > (rows[0].match(/,/g) || []).length ? ';' : ','; done(parseSheet(rows.map(function (l) { return l.split(sep).map(function (c) { return c.trim().replace(/^["']|["']$/g, ''); }); }), P)); }
        else { var ta = $('bml-txt'); if (ta) ta.value = t; analyse(); if (st) st.textContent = '« ' + f.name + ' » lu'; }
      }; rd.readAsText(f, 'UTF-8');
    } else {
      var go = function () { var rd2 = new FileReader(); rd2.onload = function (e) { try { var wb = XLSX.read(e.target.result, { type: 'array' }); done(parseSheet(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true }), P)); } catch (err) { fail(err); } }; rd2.readAsArrayBuffer(f); };
      if (typeof XLSX !== 'undefined') go(); else if (typeof withXLSX === 'function') withXLSX(go); else fail(new Error('Lecteur Excel indisponible'));
    }
  }

  function open() {
    var P = catalogue();
    if (!P.length) { note('Catalogue indisponible', 'err'); return; }
    var old = $('bml-ov'); if (old) old.remove();
    css();
    var ov = document.createElement('div'); ov.id = 'bml-ov';
    ov.innerHTML = '<div class="bml-box"><div class="bml-top"><b>📥 Importer une commande</b><button class="bml-x" onclick="BdcMail.close()">✕</button></div>'
      + '<div class="bml-body"><div class="bml-mut">Mail, Excel ou PDF : collez le texte du mail ou choisissez le fichier. Le CRM prépare les lignes à ajouter au bon en cours.</div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><label class="bml-b" style="cursor:pointer">📂 Excel · CSV · PDF<input type="file" accept=".xlsx,.xls,.csv,.pdf,.txt,.eml" style="display:none" onchange="BdcMail.file(this)"></label>'
      + '<label class="bml-mut">Quantités du client en <select id="bml-unit" class="bml-sel" style="width:auto" onchange="BdcMail.refresh()"><option value="colis">colis</option><option value="uvc">unités (UVC)</option></select></label><span id="bml-st" class="bml-mut"></span></div>'
      + '<textarea id="bml-txt" placeholder="Collez ici le mail du client…" oninput="BdcMail.analyse()"></textarea><div id="bml-res"></div></div>'
      + '<div class="bml-foot"><button class="bml-b" onclick="BdcMail.close()">Annuler</button><button class="bml-b p" id="bml-ok" onclick="BdcMail.apply()" disabled>Ajouter au bon</button></div></div>';
    document.body.appendChild(ov);
    setTimeout(function () { var t = $('bml-txt'); if (t) t.focus(); }, 60);
  }
  var _R = null, _P = [];
  function bdcNow() { try { return (typeof bdcQtys !== 'undefined' && bdcQtys) ? bdcQtys : {}; } catch (e) { return {}; } }
  function unitIsUvc() { var u = $('bml-unit'); return !!u && u.value === 'uvc'; }
  function pcbOf(code) { var p = _P.filter(function (x) { return x.code === code; })[0]; return (p && parseInt(p.pcb, 10)) || 1; }
  function toColis(code, n) { return unitIsUvc() ? Math.max(1, Math.ceil(n / pcbOf(code))) : n; }
  function analyse() { _P = catalogue(); setResult(parse(($('bml-txt') || {}).value, _P, bdcNow())); }
  function setResult(R) { _P = catalogue(); _R = R; if (R && R.unitHint) { var u = $('bml-unit'); if (u) u.value = R.unitHint; } render(); }
  function hint() { document.querySelectorAll('.bml-cv').forEach(function (e) { var q = document.querySelector('.bml-q[data-k="' + e.getAttribute('data-k') + '"]'); var n = Math.max(1, parseInt(q && q.value, 10) || 1); e.textContent = unitIsUvc() ? '= ' + toColis(e.getAttribute('data-code'), n) + ' colis (PCB ' + pcbOf(e.getAttribute('data-code')) + ')' : ''; }); }
  function render() {
    var R = _R || { add: [], remove: [], unknown: [] }, h = '';
    if (R.add.length) {
      h += '<div class="bml-grp">À ajouter (' + R.add.length + ')</div>' + R.add.map(function (a, i) {
        var warn = (a.stock != null && a.stock <= 0) ? '<span class="bml-w">rupture</span>' : '';
        return '<label class="bml-row"><input type="checkbox" class="bml-ck" data-k="a' + i + '" checked><span class="bml-l"><b>' + esc(a.lib) + '</b><br><span class="bml-mut">' + esc(a.code) + (a.inBdc ? ' · déjà ' + a.inBdc + ' au bon' : '') + '</span> ' + warn + ' <span class="bml-mut bml-cv" data-k="a' + i + '" data-code="' + esc(a.code) + '"></span>'
          + '</span><input type="number" min="1" class="bml-q" data-k="a' + i + '" value="' + a.qty + '" oninput="BdcMail.hint()"></label>'; }).join('');
    }
    if (R.remove.length) {
      h += '<div class="bml-grp">À retirer du bon (' + R.remove.length + ')</div>' + R.remove.map(function (a, i) {
        return '<label class="bml-row"><input type="checkbox" class="bml-ck" data-k="r' + i + '"' + (a.inBdc ? ' checked' : '') + '><span class="bml-l"><b>' + esc(a.lib) + '</b><br><span class="bml-mut">' + esc(a.code) + (a.inBdc ? '' : ' · pas dans le bon') + '</span></span></label>'; }).join('');
    }
    if (R.unknown.length) {
      h += '<div class="bml-grp">À vérifier (' + R.unknown.length + ')</div>' + R.unknown.map(function (u, i) {
        var opts = '<option value="">— ' + (u.remove ? 'ignorer' : 'ne pas ajouter') + ' —</option>' + u.sugg.map(function (x, j) { return '<option value="' + esc(x.p.code) + '"' + (j === 0 && x.s >= 0.7 && (!u.remove || bdcNow()[x.p.code] > 0) && (!u.sugg[1] || u.sugg[1].s < x.s - 0.001) ? ' selected' : '') + '>' + esc(x.p.libelle) + ' (' + esc(x.p.code) + ')</option>'; }).join('');
        return '<div class="bml-row" style="flex-wrap:wrap"><span class="bml-l"><b>' + esc(u.label) + '</b><br><span class="bml-mut">code « ' + esc(u.code) + ' » inconnu' + (u.remove ? ' · à retirer' : '') + '</span></span>'
          + (u.remove ? '' : '<input type="number" min="1" class="bml-q" data-k="u' + i + '" value="' + u.qty + '">')
          + '<select class="bml-sel" data-k="u' + i + '">' + opts + '</select></div>'; }).join('');
    }
    if (R.reglement) h += '<div class="bml-note">💬 Le client demande vos <b>conditions de règlement</b> : pensez à les rappeler dans votre réponse.</div>';
    if (R.err) h = '<div class="bml-note" style="background:#fff3df">⚠️ ' + esc(R.err) + '</div>' + h;
    else if (!R.add.length && !R.remove.length && !R.unknown.length) h = ($('bml-txt') || {}).value ? '<div class="bml-mut">Aucun code article reconnu dans ce texte.</div>' : '';
    $('bml-res').innerHTML = h; hint();
    $('bml-ok').disabled = !(R.add.length || R.remove.length || R.unknown.length);
  }
  function apply() {
    if (!_R || typeof bdcQtys === 'undefined') return;
    var q = bdcQtys, added = 0, removed = 0;
    function val(sel) { var e = document.querySelector(sel); return e; }
    _R.add.forEach(function (a, i) {
      var ck = val('.bml-ck[data-k="a' + i + '"]'), qi = val('.bml-q[data-k="a' + i + '"]');
      if (!ck || !ck.checked) return; var n = toColis(a.code, Math.max(1, parseInt(qi && qi.value, 10) || 1));
      q[a.code] = (parseInt(q[a.code], 10) || 0) + n; added++;
    });
    _R.remove.forEach(function (a, i) {
      var ck = val('.bml-ck[data-k="r' + i + '"]'); if (!ck || !ck.checked) return;
      if (q[a.code] > 0) { delete q[a.code]; removed++; }
    });
    _R.unknown.forEach(function (u, i) {
      var sel = val('.bml-sel[data-k="u' + i + '"]'), code = sel && sel.value; if (!code) return;
      if (u.remove) { if (q[code] > 0) { delete q[code]; removed++; } return; }
      var n = toColis(code, Math.max(1, parseInt((val('.bml-q[data-k="u' + i + '"]') || {}).value, 10) || 1));
      q[code] = (parseInt(q[code], 10) || 0) + n; added++;
    });
    if (!added && !removed) { note('Aucune ligne cochée', 'err'); return; }
    try { if (typeof buildTable === 'function') buildTable(); } catch (e) {}
    try { if (typeof bdcUpdateTotals === 'function') bdcUpdateTotals(); } catch (e) {}
    note('✅ ' + added + ' ligne(s) ajoutée(s)' + (removed ? ' · ' + removed + ' retirée(s)' : '') + ' — vérifiez le magasin et les quantités', 'ok');
    close();
  }
  function close() { var o = $('bml-ov'); if (o) o.remove(); }
  function css() {
    if ($('bml-css')) return;
    var s = document.createElement('style'); s.id = 'bml-css';
    s.textContent = '#bml-ov{position:fixed;inset:0;z-index:10002;background:rgba(20,18,15,.55);display:flex;align-items:flex-end;justify-content:center}@media(min-width:700px){#bml-ov{align-items:center}}'
      + '.bml-box{background:#f7f6f2;width:100%;max-width:640px;max-height:92vh;display:flex;flex-direction:column;border-radius:18px 18px 0 0;overflow:hidden;color:#1c1a17}@media(min-width:700px){.bml-box{border-radius:18px}}'
      + '.bml-top{background:#14120F;color:#fff;padding:13px 16px;display:flex;justify-content:space-between;align-items:center}.bml-x{border:0;background:rgba(255,255,255,.18);color:#fff;width:30px;height:30px;border-radius:50%;cursor:pointer}'
      + '.bml-body{padding:12px 14px;overflow:auto;display:flex;flex-direction:column;gap:8px}.bml-mut{font-size:.76rem;color:#8a857d}'
      + '#bml-txt{width:100%;min-height:150px;border:1px solid #ddd;border-radius:10px;padding:10px;font:inherit;font-size:.85rem;resize:vertical}'
      + '.bml-grp{font:700 .68rem inherit;letter-spacing:.06em;text-transform:uppercase;color:#8a857d;margin-top:6px}'
      + '.bml-row{display:flex;align-items:center;gap:8px;background:#fff;border:1px solid #e7e4dc;border-radius:10px;padding:8px 10px;font-size:.84rem}.bml-l{flex:1;min-width:0}'
      + '.bml-q{width:62px;padding:6px;border:1px solid #ddd;border-radius:8px;font:inherit;text-align:center}.bml-sel{width:100%;padding:7px;border:1px solid #ddd;border-radius:8px;font:inherit;font-size:.8rem}'
      + '.bml-w{background:#fde8e8;color:#b42318;border-radius:99px;padding:1px 8px;font-size:.7rem;font-weight:700}.bml-note{background:#eef3f8;border-radius:10px;padding:9px 11px;font-size:.82rem}'
      + '.bml-foot{display:flex;gap:8px;justify-content:flex-end;padding:11px 14px;background:#fff;border-top:1px solid #e7e4dc}.bml-b{border:1px solid #ddd;background:#fff;border-radius:99px;padding:9px 16px;font:600 .84rem inherit;cursor:pointer}.bml-b.p{background:var(--brand,#c8561f);border-color:var(--brand,#c8561f);color:#fff}.bml-b:disabled{opacity:.45}';
    document.head.appendChild(s);
  }
  window.BdcMail = { open: open, close: close, analyse: analyse, apply: apply, file: fileChosen, hint: hint, refresh: render, _parse: parse, _sheet: parseSheet, _pdf: parsePdfLines };
})();
