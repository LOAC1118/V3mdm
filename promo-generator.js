/* ============================================================
   PROMO GENERATOR — module intégrable CRM MDM V3 / NATURALINE
   Styles + JS préfixés "pgm-" et isolés sous .pgm-root
   API :
     PromoGenerator.mount(container, options)
     PromoGenerator.setCatalogue(array)   // rafraîchir après chargement Firebase
     PromoGenerator.unmount()
   options = {
     catalogue : [ ...produits du CRM ],
     map       : { name, ref, ean, price, weight, pcb, tva, brand, img },
     brand     : 'mdm' | 'natura',
     contact   : { name, phone, email },
     products  : [ ...produits pré-sélectionnés ]   // optionnel
   }
   Dépendance PDF (html2pdf) chargée automatiquement si absente.
   ============================================================ */
(function (global) {
  'use strict';

  var PRESETS = {
    mdm:    { brand:'#6a9c3a', accent:'#e8871e', name:'Moulin des Moines', tag:'Créateur & producteur bio depuis 1873' },
    natura: { brand:'#2f7d6b', accent:'#c9a227', name:'NATURALINE',        tag:'La sélection nature & bio' }
  };

  var DEFAULT_MAP = { name:'designation', ref:'code', ean:'ean', price:'prixHT',
                      weight:'poids', pcb:'pcb', tva:'tva', brand:'marque', img:'image' };

  var S = null;        // état de l'instance active
  var ROOT = null;     // container DOM
  var CATALOGUE = [];  // catalogue normalisé
  var MAP = DEFAULT_MAP;

  /* ---------- utils ---------- */
  function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  function eur(n){return Number(n||0).toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';}
  function num(v){var n=parseFloat(String(v).replace(',','.'));return isNaN(n)?0:n;}
  function computePromo(p){
    if(p.promo!=null && p.promo!=='' && !isNaN(p.promo)) return Number(p.promo);
    if(p.remise && p.price) return Math.round(p.price*(1-p.remise/100)*100)/100;
    return null;
  }
  function fileToDataURL(file){return new Promise(function(res,rej){var r=new FileReader();r.onload=function(){res(r.result);};r.onerror=rej;r.readAsDataURL(file);});}
  function shade(hex,pct,soft){
    hex=String(hex).replace('#','');if(hex.length===3)hex=hex.split('').map(function(c){return c+c;}).join('');
    var r=parseInt(hex.slice(0,2),16),g=parseInt(hex.slice(2,4),16),b=parseInt(hex.slice(4,6),16);
    if(soft){r=Math.round(r+(255-r)*0.90);g=Math.round(g+(255-g)*0.90);b=Math.round(b+(255-b)*0.90);}
    else{r=Math.min(255,Math.max(0,Math.round(r+r*pct/100)));g=Math.min(255,Math.max(0,Math.round(g+g*pct/100)));b=Math.min(255,Math.max(0,Math.round(b+b*pct/100)));}
    return '#'+[r,g,b].map(function(x){return x.toString(16).padStart(2,'0');}).join('');
  }
  function initial(s){return (String(s||'?').trim()[0]||'?').toUpperCase();}

  /* ---------- catalogue ---------- */
  function normalize(list){
    return (list||[]).map(function(o){
      return {
        name:  o[MAP.name]   != null ? o[MAP.name]   : (o.name||o.libelle||''),
        ref:   o[MAP.ref]    != null ? o[MAP.ref]    : (o.ref||o.code||''),
        ean:   o[MAP.ean]    != null ? o[MAP.ean]    : (o.ean||''),
        price: num(o[MAP.price]!=null? o[MAP.price]  : (o.price||o.prixHT||0)),
        weight:o[MAP.weight] != null ? o[MAP.weight] : (o.weight||o.poids||''),
        pcb:   o[MAP.pcb]    != null ? o[MAP.pcb]    : (o.pcb||''),
        tva:   o[MAP.tva]    != null ? o[MAP.tva]    : (o.tva||''),
        brand: o[MAP.brand]  != null ? o[MAP.brand]  : (o.brand||o.marque||''),
        img:   o[MAP.img]    != null ? o[MAP.img]    : (o.img||o.image||null)
      };
    });
  }

  /* ---------- state ---------- */
  function defaultState(opt){
    var b = PRESETS[(opt&&opt.brand)||'mdm'] || PRESETS.mdm;
    var c = (opt&&opt.contact)||{};
    return {
      layout:'liste',
      zoom:1,
      editIndex:-1,
      doc:{
        brand:b.brand, accent:b.accent, brandName:b.name, brandTag:b.tag, logo:null,
        eyebrow:'Offre promotionnelle',
        title:'Offres promotionnelles',
        subtitle:'',
        accroche:'',
        validity:'',
        conditions:'Prix HT indicatifs, hors taxes. Offre valable dans la limite des stocks disponibles.',
        contactName:c.name||'', contactPhone:c.phone||'', contactEmail:c.email||''
      },
      products:(opt&&opt.products)?JSON.parse(JSON.stringify(opt.products)):[]
    };
  }

  /* ---------- styles (injectées une fois) ---------- */
  function injectStyles(){
    if(document.getElementById('pgm-styles')) return;
    if(!document.getElementById('pgm-fonts')){
      var l=document.createElement('link');l.id='pgm-fonts';l.rel='stylesheet';
      l.href='https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&family=Pacifico&display=swap';
      document.head.appendChild(l);
    }
    var css = document.createElement('style'); css.id='pgm-styles';
    css.textContent = PGM_CSS;
    document.head.appendChild(css);
  }

  /* ---------- html2pdf loader ---------- */
  function ensurePdf(){
    return new Promise(function(res,rej){
      if(global.html2pdf) return res();
      var s=document.createElement('script');
      s.src='https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
      s.onload=function(){res();};s.onerror=function(){rej(new Error('html2pdf indisponible (hors-ligne ?)'));};
      document.head.appendChild(s);
    });
  }

  /* ======================= MOUNT ======================= */
  function mount(container, options){
    options = options||{};
    injectStyles();
    ROOT = (typeof container==='string')?document.querySelector(container):container;
    MAP = Object.assign({}, DEFAULT_MAP, options.map||{});
    CATALOGUE = normalize(options.catalogue||[]);
    S = defaultState(options);
    ROOT.classList.add('pgm-root');
    ROOT.innerHTML = buildShell();
    wire();
    renderCatalogueList('');
    renderProductList();
    renderDoc();
    syncInputs();
    setTimeout(fitZoom,60);
    return PGM;
  }
  function unmount(){ if(ROOT){ROOT.innerHTML='';ROOT.classList.remove('pgm-root');} S=null; }
  function setCatalogue(list){ CATALOGUE = normalize(list||[]); if(S) renderCatalogueList(q('#pgm-catsearch')?q('#pgm-catsearch').value:''); }

  function q(sel){return ROOT.querySelector(sel);}
  function qa(sel){return Array.prototype.slice.call(ROOT.querySelectorAll(sel));}

  /* ---------- shell HTML ---------- */
  function buildShell(){
    return ''+
    '<div class="pgm-app">'+
      '<aside class="pgm-side">'+

        '<div class="pgm-sec">'+
          '<h2>Marque & couleurs</h2>'+
          '<div class="pgm-presets">'+
            '<button class="pgm-preset" data-preset="mdm"><span class="pgm-sw" style="background:#6a9c3a"></span>MDM</button>'+
            '<button class="pgm-preset" data-preset="natura"><span class="pgm-sw" style="background:#2f7d6b"></span>NATURALINE</button>'+
          '</div>'+
          '<label>Nom affiché</label><input id="pgm-brandName" data-bind="brandName">'+
          '<label>Baseline</label><input id="pgm-brandTag" data-bind="brandTag">'+
          '<label>Logo image (optionnel)</label><input type="file" id="pgm-logo" accept="image/*">'+
          '<div class="pgm-row2">'+
            '<div><label>Principale</label><input type="color" id="pgm-cBrand" class="pgm-color"></div>'+
            '<div><label>Accent</label><input type="color" id="pgm-cAccent" class="pgm-color"></div>'+
          '</div>'+
        '</div>'+

        '<div class="pgm-sec">'+
          '<h2>Document</h2>'+
          '<label>Bandeau</label><input id="pgm-eyebrow" data-bind="eyebrow">'+
          '<label>Titre</label><input id="pgm-title" data-bind="title">'+
          '<label>Sous-titre</label><input id="pgm-subtitle" data-bind="subtitle">'+
          '<label>Accroche manuscrite</label><input id="pgm-accroche" data-bind="accroche" placeholder="ex : Les tofus à griller">'+
          '<label>Validité</label><input id="pgm-validity" data-bind="validity" placeholder="Du 1er au 31 juillet 2026">'+
        '</div>'+

        '<div class="pgm-sec">'+
          '<h2>Depuis le catalogue</h2>'+
          '<input id="pgm-catsearch" placeholder="Rechercher : désignation, code, EAN…">'+
          '<div class="pgm-row2" style="margin-top:8px">'+
            '<div><label>Remise à appliquer %</label><input type="number" id="pgm-defremise" value="15" step="1"></div>'+
            '<div><label>Badge auto</label><input id="pgm-defbadge" placeholder="(aucun)"></div>'+
          '</div>'+
          '<div class="pgm-catlist" id="pgm-catlist"></div>'+
        '</div>'+

        '<div class="pgm-sec">'+
          '<h2>Produits sélectionnés</h2>'+
          '<div class="pgm-plist" id="pgm-plist"></div>'+
          '<details class="pgm-manual"><summary>+ Ajouter manuellement</summary>'+
            '<label>Libellé</label><input id="pgm-f_name">'+
            '<div class="pgm-row2"><div><label>Code art.</label><input id="pgm-f_ref"></div><div><label>EAN</label><input id="pgm-f_ean"></div></div>'+
            '<div class="pgm-row3"><div><label>Poids</label><input id="pgm-f_weight"></div><div><label>PCB</label><input id="pgm-f_pcb"></div><div><label>Badge</label><input id="pgm-f_badge"></div></div>'+
            '<div class="pgm-row3"><div><label>Prix HT</label><input id="pgm-f_price" type="number" step="0.01"></div><div><label>Remise %</label><input id="pgm-f_remise" type="number" step="1"></div><div><label>Promo HT</label><input id="pgm-f_promo" type="number" step="0.01" placeholder="auto"></div></div>'+
            '<label>Photo</label><input type="file" id="pgm-f_img" accept="image/*">'+
            '<div class="pgm-btnrow"><button class="pgm-btn pgm-add" id="pgm-saveProd">Ajouter</button><button class="pgm-btn pgm-ghost" id="pgm-resetForm">Vider</button></div>'+
          '</details>'+
        '</div>'+

        '<div class="pgm-sec">'+
          '<h2>Pied de page</h2>'+
          '<label>Conditions</label><textarea id="pgm-conditions" data-bind="conditions"></textarea>'+
          '<label>Contact commercial</label><input id="pgm-contactName" data-bind="contactName">'+
          '<div class="pgm-row2"><div><label>Téléphone</label><input id="pgm-contactPhone" data-bind="contactPhone"></div><div><label>Email</label><input id="pgm-contactEmail" data-bind="contactEmail"></div></div>'+
        '</div>'+

        '<div class="pgm-sec">'+
          '<h2>Projet</h2>'+
          '<div class="pgm-btnrow"><button class="pgm-btn pgm-ghost" id="pgm-save">💾 Sauver .json</button><button class="pgm-btn pgm-ghost" id="pgm-loadBtn">📂 Charger</button></div>'+
          '<input type="file" id="pgm-load" accept="application/json" style="display:none">'+
        '</div>'+

      '</aside>'+

      '<main class="pgm-work">'+
        '<div class="pgm-toolbar">'+
          '<div class="pgm-modes">'+
            '<button class="pgm-mode pgm-on" data-mode="liste">☰ Liste</button>'+
            '<button class="pgm-mode" data-mode="grille">▦ Grille visuelle</button>'+
          '</div>'+
          '<div class="pgm-sp"></div>'+
          '<div class="pgm-zoom">Zoom <button class="pgm-ic" id="pgm-zout">−</button><span id="pgm-zlabel">100%</span><button class="pgm-ic" id="pgm-zin">+</button></div>'+
          '<button class="pgm-btn pgm-ghost pgm-auto" id="pgm-print">Imprimer</button>'+
          '<button class="pgm-btn pgm-primary pgm-auto" id="pgm-pdf">⬇ Exporter PDF</button>'+
        '</div>'+
        '<div class="pgm-stage"><div class="pgm-stage-in" id="pgm-stagein"><div class="pgm-page" id="pgm-page"></div></div></div>'+
      '</main>'+
    '</div>';
  }

  /* ---------- events ---------- */
  function wire(){
    qa('[data-bind]').forEach(function(el){el.addEventListener('input',function(){S.doc[el.getAttribute('data-bind')]=el.value;renderDoc();});});
    qa('.pgm-preset').forEach(function(b){b.addEventListener('click',function(){applyPreset(b.getAttribute('data-preset'));});});
    q('#pgm-cBrand').addEventListener('input',onColor);
    q('#pgm-cAccent').addEventListener('input',onColor);
    q('#pgm-logo').addEventListener('change',onLogo);
    q('#pgm-catsearch').addEventListener('input',function(e){renderCatalogueList(e.target.value);});
    q('#pgm-saveProd').addEventListener('click',saveProduct);
    q('#pgm-resetForm').addEventListener('click',resetForm);
    qa('.pgm-mode').forEach(function(b){b.addEventListener('click',function(){setMode(b.getAttribute('data-mode'));});});
    q('#pgm-zin').addEventListener('click',function(){zoom(0.1);});
    q('#pgm-zout').addEventListener('click',function(){zoom(-0.1);});
    q('#pgm-print').addEventListener('click',function(){window.print();});
    q('#pgm-pdf').addEventListener('click',exportPDF);
    q('#pgm-save').addEventListener('click',saveProject);
    q('#pgm-loadBtn').addEventListener('click',function(){q('#pgm-load').click();});
    q('#pgm-load').addEventListener('change',loadProject);
  }

  function applyPreset(k){var p=PRESETS[k];if(!p)return;S.doc.brand=p.brand;S.doc.accent=p.accent;S.doc.brandName=p.name;S.doc.brandTag=p.tag;syncInputs();renderDoc();}
  function onColor(){S.doc.brand=q('#pgm-cBrand').value;S.doc.accent=q('#pgm-cAccent').value;renderDoc();}
  function onLogo(e){var f=e.target.files[0];if(!f)return;fileToDataURL(f).then(function(d){S.doc.logo=d;renderDoc();});}

  function syncInputs(){
    var d=S.doc;
    ['brandName','brandTag','eyebrow','title','subtitle','accroche','validity','conditions','contactName','contactPhone','contactEmail']
      .forEach(function(k){var el=q('#pgm-'+k);if(el)el.value=d[k]||'';});
    q('#pgm-cBrand').value=d.brand;q('#pgm-cAccent').value=d.accent;
  }

  /* ---------- catalogue picker ---------- */
  function renderCatalogueList(term){
    var el=q('#pgm-catlist');if(!el)return;
    term=(term||'').toLowerCase().trim();
    if(!CATALOGUE.length){el.innerHTML='<div class="pgm-hint">Aucun catalogue fourni. Utilise « Ajouter manuellement » ou branche <code>catalogue</code>.</div>';return;}
    var res=CATALOGUE;
    if(term){res=CATALOGUE.filter(function(p){return (p.name+' '+p.ref+' '+p.ean).toLowerCase().indexOf(term)>=0;});}
    res=res.slice(0,40);
    if(!res.length){el.innerHTML='<div class="pgm-hint">Aucun résultat.</div>';return;}
    el.innerHTML=res.map(function(p){
      return '<button class="pgm-catrow" data-ref="'+esc(p.ref)+'" data-ean="'+esc(p.ean)+'">'+
        '<span class="pgm-cr-nm">'+esc(p.name)+'</span>'+
        '<span class="pgm-cr-meta">'+esc(p.ref||'')+(p.weight?' · '+esc(p.weight):'')+' · '+eur(p.price)+'</span>'+
      '</button>';
    }).join('');
    qa('.pgm-catrow').forEach(function(b){b.addEventListener('click',function(){
      var src=CATALOGUE.find(function(p){return String(p.ref)===b.getAttribute('data-ref')&&String(p.ean)===b.getAttribute('data-ean');});
      if(src)addFromCatalogue(src);
    });});
  }
  function addFromCatalogue(src){
    var remise=num(q('#pgm-defremise').value);
    var badge=q('#pgm-defbadge').value.trim();
    S.products.push({name:src.name,ref:src.ref,ean:src.ean,weight:src.weight,pcb:src.pcb,
      price:src.price,remise:remise,promo:null,badge:badge,img:src.img||null});
    renderProductList();renderDoc();
  }

  /* ---------- produits ---------- */
  function saveProduct(){
    var name=q('#pgm-f_name').value.trim();if(!name){q('#pgm-f_name').focus();return;}
    var imgFile=q('#pgm-f_img').files[0];
    var base=(S.editIndex>=0)?S.products[S.editIndex].img:null;
    var build=function(img){
      var p={name:name,ref:q('#pgm-f_ref').value.trim(),ean:q('#pgm-f_ean').value.trim(),
        weight:q('#pgm-f_weight').value.trim(),pcb:q('#pgm-f_pcb').value.trim(),badge:q('#pgm-f_badge').value.trim(),
        price:num(q('#pgm-f_price').value),remise:num(q('#pgm-f_remise').value),
        promo:(q('#pgm-f_promo').value==='')?null:num(q('#pgm-f_promo').value),img:img};
      if(S.editIndex>=0){S.products[S.editIndex]=p;S.editIndex=-1;}else{S.products.push(p);}
      resetForm();renderProductList();renderDoc();
    };
    if(imgFile)fileToDataURL(imgFile).then(build);else build(base);
  }
  function editProduct(i){
    S.editIndex=i;var p=S.products[i];
    var set=function(id,v){q('#pgm-'+id).value=(v==null?'':v);};
    set('f_name',p.name);set('f_ref',p.ref);set('f_ean',p.ean);set('f_weight',p.weight);set('f_pcb',p.pcb);
    set('f_badge',p.badge);set('f_price',p.price);set('f_remise',p.remise);set('f_promo',p.promo);
    q('#pgm-saveProd').textContent='Mettre à jour';
    var det=q('.pgm-manual');if(det)det.open=true;
    renderProductList();
  }
  function resetForm(){
    S.editIndex=-1;
    ['f_name','f_ref','f_ean','f_weight','f_pcb','f_badge','f_price','f_remise','f_promo'].forEach(function(id){q('#pgm-'+id).value='';});
    q('#pgm-f_img').value='';q('#pgm-saveProd').textContent='Ajouter';renderProductList();
  }
  function delProduct(i){S.products.splice(i,1);if(S.editIndex===i)resetForm();renderProductList();renderDoc();}
  function dupProduct(i){S.products.splice(i+1,0,JSON.parse(JSON.stringify(S.products[i])));renderProductList();renderDoc();}
  function moveProduct(i,d){var j=i+d;if(j<0||j>=S.products.length)return;var t=S.products[i];S.products[i]=S.products[j];S.products[j]=t;renderProductList();renderDoc();}
  function setRemise(i,v){S.products[i].remise=num(v);S.products[i].promo=null;renderProductList();renderDoc();}

  function renderProductList(){
    var el=q('#pgm-plist');
    if(!S.products.length){el.innerHTML='<div class="pgm-hint">Aucun produit. Ajoute depuis le catalogue ci-dessus.</div>';return;}
    el.innerHTML=S.products.map(function(p,i){
      var promo=computePromo(p);
      var pr=(promo!=null)?('<span class="pgm-old">'+eur(p.price)+'</span><span class="pgm-new">'+eur(promo)+'</span>'):('<span class="pgm-new">'+eur(p.price)+'</span>');
      return '<div class="pgm-pitem'+(i===S.editIndex?' pgm-editing':'')+'">'+
        '<div class="pgm-pi-top">'+
          '<div class="pgm-pi-info"><div class="pgm-pi-nm">'+esc(p.name)+'</div>'+
            '<div class="pgm-pi-rf">'+esc(p.ref||'')+(p.weight?' · '+esc(p.weight):'')+'</div>'+
            '<div class="pgm-pi-pr">'+pr+'</div></div>'+
          '<div class="pgm-acts">'+
            '<button class="pgm-ic" data-a="up" data-i="'+i+'" title="Monter">↑</button>'+
            '<button class="pgm-ic" data-a="down" data-i="'+i+'" title="Descendre">↓</button>'+
            '<button class="pgm-ic" data-a="dup" data-i="'+i+'" title="Dupliquer">⧉</button>'+
            '<button class="pgm-ic" data-a="edit" data-i="'+i+'" title="Modifier">✎</button>'+
            '<button class="pgm-ic pgm-del" data-a="del" data-i="'+i+'" title="Retirer">✕</button>'+
          '</div>'+
        '</div>'+
        '<div class="pgm-pi-remise"><span>Remise</span>'+
          '<input type="number" step="1" value="'+(p.remise||0)+'" data-a="remise" data-i="'+i+'"><span>%</span></div>'+
      '</div>';
    }).join('');
    qa('#pgm-plist [data-a]').forEach(function(b){
      var i=+b.getAttribute('data-i'),a=b.getAttribute('data-a');
      if(a==='remise'){b.addEventListener('change',function(){setRemise(i,b.value);});}
      else b.addEventListener('click',function(){
        if(a==='up')moveProduct(i,-1);else if(a==='down')moveProduct(i,1);else if(a==='dup')dupProduct(i);
        else if(a==='edit')editProduct(i);else if(a==='del')delProduct(i);
      });
    });
  }

  /* ---------- mode & zoom ---------- */
  function setMode(m){S.layout=m;qa('.pgm-mode').forEach(function(b){b.classList.toggle('pgm-on',b.getAttribute('data-mode')===m);});renderDoc();}
  function zoom(d){S.zoom=Math.min(1.4,Math.max(0.35,Math.round((S.zoom+d)*10)/10));applyZoom();}
  function applyZoom(){q('#pgm-stagein').style.transform='scale('+S.zoom+')';q('#pgm-zlabel').textContent=Math.round(S.zoom*100)+'%';}
  function fitZoom(){var st=q('.pgm-stage');if(!st)return;var avail=st.clientWidth-32;if(avail<794)S.zoom=Math.max(0.35,Math.round(avail/794*10)/10);applyZoom();}

  /* ---------- rendu document ---------- */
  function renderDoc(){
    var d=S.doc,page=q('#pgm-page');
    page.style.setProperty('--pgm-brand',d.brand);
    page.style.setProperty('--pgm-brand-dark',shade(d.brand,-18));
    page.style.setProperty('--pgm-accent',d.accent);
    page.style.setProperty('--pgm-brand-soft',shade(d.brand,0,true));
    var logoHtml=d.logo?('<img class="pgm-logo-img" src="'+d.logo+'">'):('<div class="pgm-logo-tx">'+esc(d.brandName||'')+(d.brandTag?'<small>'+esc(d.brandTag)+'</small>':'')+'</div>');
    var head=''+
      '<div class="pgm-dhead">'+
        '<div class="pgm-dh-top"><div class="pgm-logo-wrap">'+logoHtml+'</div>'+
          (d.validity?'<div class="pgm-valid">'+esc(d.validity)+'</div>':'')+'</div>'+
        (d.eyebrow?'<div class="pgm-eyebrow">'+esc(d.eyebrow)+'</div>':'<div style="height:6mm"></div>')+
        '<h1 class="pgm-dtitle">'+esc(d.title)+'</h1>'+
        (d.subtitle?'<p class="pgm-dsub">'+esc(d.subtitle)+'</p>':'')+
      '</div>'+
      (d.accroche?'<div class="pgm-accroche">'+esc(d.accroche)+'</div>':'');
    var body = (S.layout==='grille')?renderGrid():renderList();
    var foot=''+
      '<div class="pgm-dfoot"><div class="pgm-cond">'+esc(d.conditions).replace(/\n/g,'<br>')+'</div>'+
      '<div class="pgm-contact">'+(d.contactName?'<b>'+esc(d.contactName)+'</b><br>':'')+
      (d.contactPhone?esc(d.contactPhone)+'<br>':'')+(d.contactEmail?esc(d.contactEmail):'')+'</div></div>';
    page.innerHTML=head+body+foot;
  }

  function badgesHtml(p){
    if((p.badge||'').toUpperCase()==='NOUVEAU')return '<span class="pgm-bdg pgm-bdg-new">Nouveau</span>';
    if(p.badge)return '<span class="pgm-bdg pgm-bdg-cus">'+esc(p.badge)+'</span>';
    return '';
  }

  function renderList(){
    if(!S.products.length)return '<div class="pgm-empty">Ajoutez des produits pour construire le document.</div>';
    var rows=S.products.map(function(p){
      var promo=computePromo(p),has=(promo!=null&&promo<Number(p.price));
      var refline=[p.ref?esc(p.ref):'',p.ean?'EAN '+esc(p.ean):''].filter(Boolean).join(' · ');
      var specs=[];if(p.weight)specs.push('<b>'+esc(p.weight)+'</b>');if(p.pcb)specs.push('PCB '+esc(p.pcb));
      var price=has?('<div class="pgm-oldp">'+eur(p.price)+'</div>'+(p.remise?'<div class="pgm-rchip">-'+p.remise+'%</div>':'')+'<div class="pgm-newp">'+eur(promo)+'<small>HT promo</small></div>')
                   :('<div class="pgm-newp">'+eur(p.price)+'<small>HT</small></div>');
      return '<div class="pgm-prow">'+
        '<div class="pgm-pmain">'+(p.img?'<img class="pgm-thumb" src="'+p.img+'">':'')+
          '<div style="min-width:0"><div class="pgm-pn">'+esc(p.name)+'</div><div class="pgm-badges">'+badgesHtml(p)+'</div>'+
          (refline?'<div class="pgm-pref">'+refline+'</div>':'')+'</div></div>'+
        '<div class="pgm-pspecs">'+specs.join('<br>')+'</div>'+
        '<div class="pgm-pprice">'+price+'</div></div>';
    }).join('');
    return '<div class="pgm-products"><div class="pgm-colhead"><span>Produit</span><span>Conditionnement</span><span>Tarif</span></div>'+rows+'</div>';
  }

  function renderGrid(){
    if(!S.products.length)return '<div class="pgm-empty">Ajoutez des produits pour construire le document.</div>';
    var cards=S.products.map(function(p){
      var promo=computePromo(p),has=(promo!=null&&promo<Number(p.price));
      var media=p.img?('<img class="pgm-c-img" src="'+p.img+'">'):('<div class="pgm-c-ph">'+initial(p.name)+'</div>');
      var top='';
      var b=badgesHtml(p);if(b)top+='<div class="pgm-c-badge">'+b+'</div>';
      if(has&&p.remise)top+='<div class="pgm-c-remise">-'+p.remise+'%</div>';
      var price=has?('<span class="pgm-c-old">'+eur(p.price)+'</span><span class="pgm-c-new">'+eur(promo)+'</span>')
                   :('<span class="pgm-c-new">'+eur(p.price)+'</span>');
      var meta=[p.weight?esc(p.weight):'',p.pcb?'PCB '+esc(p.pcb):''].filter(Boolean).join(' · ');
      return '<div class="pgm-card">'+
        '<div class="pgm-c-media">'+media+top+'</div>'+
        '<div class="pgm-c-body">'+
          '<div class="pgm-c-nm">'+esc(p.name)+'</div>'+
          (meta?'<div class="pgm-c-meta">'+meta+'</div>':'')+
          (p.ref?'<div class="pgm-c-ref">'+esc(p.ref)+'</div>':'')+
          '<div class="pgm-c-price">'+price+'</div>'+
        '</div></div>';
    }).join('');
    return '<div class="pgm-grid">'+cards+'</div>';
  }

  /* ---------- export / projet ---------- */
  function exportPDF(){
    var btn=q('#pgm-pdf'),prev=btn.textContent;btn.textContent='Génération…';btn.disabled=true;
    var inner=q('#pgm-stagein'),saved=inner.style.transform;inner.style.transform='scale(1)';
    ensurePdf().then(function(){
      return (document.fonts&&document.fonts.ready)?document.fonts.ready.catch(function(){}):null;
    }).then(function(){
      var name=(S.doc.title||'promo').toLowerCase().replace(/[^\w\-]+/g,'-').replace(/^-+|-+$/g,'')||'promo';
      return global.html2pdf().set({
        margin:0,filename:name+'.pdf',image:{type:'jpeg',quality:0.98},
        html2canvas:{scale:2,useCORS:true,backgroundColor:'#ffffff',windowWidth:794},
        jsPDF:{unit:'mm',format:'a4',orientation:'portrait'},pagebreak:{mode:['css','legacy']}
      }).from(q('#pgm-page')).save();
    }).catch(function(e){
      alert('Export PDF impossible : '+e.message+'\nUtilise « Imprimer » puis « Enregistrer en PDF ».');
    }).then(function(){inner.style.transform=saved;btn.textContent=prev;btn.disabled=false;});
  }
  function saveProject(){
    var blob=new Blob([JSON.stringify(S,null,2)],{type:'application/json'});
    var a=document.createElement('a');a.href=URL.createObjectURL(blob);
    a.download=(S.doc.title||'projet-promo').toLowerCase().replace(/[^\w\-]+/g,'-')+'.json';a.click();URL.revokeObjectURL(a.href);
  }
  function loadProject(e){
    var f=e.target.files[0];if(!f)return;
    f.text().then(function(t){var o=JSON.parse(t);if(!o.doc||!o.products)throw 0;S=o;S.editIndex=-1;syncInputs();renderProductList();renderDoc();applyZoom();})
      .catch(function(){alert('Fichier projet invalide.');});
    e.target.value='';
  }

  /* ---------- CSS string ---------- */
  var PGM_CSS = ''+
  '.pgm-root{font-family:"Poppins",system-ui,sans-serif;color:#e8eef5}'+
  '.pgm-root *{box-sizing:border-box}'+
  '.pgm-app{display:grid;grid-template-columns:360px 1fr;min-height:640px;height:100%;background:#0a1826;border-radius:12px;overflow:hidden}'+
  '.pgm-side{background:linear-gradient(180deg,#0e2740,#12314f);border-right:1px solid #1d4066;overflow-y:auto;max-height:calc(100vh - 40px)}'+
  '.pgm-sec{padding:15px 16px;border-bottom:1px solid #1d4066}'+
  '.pgm-sec h2{font-size:11px;text-transform:uppercase;letter-spacing:1.1px;color:#8fa6bd;margin:0 0 11px;font-weight:600}'+
  '.pgm-root label{display:block;font-size:12px;color:#cdd9e6;margin:9px 0 4px;font-weight:500}'+
  '.pgm-root input,.pgm-root select,.pgm-root textarea{width:100%;background:#0b2036;border:1px solid #274a6b;color:#e8eef5;border-radius:8px;padding:8px 10px;font-family:inherit;font-size:13px;outline:none}'+
  '.pgm-root input:focus,.pgm-root textarea:focus{border-color:#2f9e6b}'+
  '.pgm-root textarea{resize:vertical;min-height:50px}'+
  '.pgm-root input.pgm-color{width:100%;height:34px;padding:2px;cursor:pointer}'+
  '.pgm-row2{display:grid;grid-template-columns:1fr 1fr;gap:8px}.pgm-row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px}'+
  '.pgm-hint{font-size:11px;color:#8fa6bd;line-height:1.4;margin-top:6px}.pgm-hint code{color:#7fd6a3}'+
  '.pgm-presets{display:flex;gap:8px}.pgm-preset{flex:1;border:1px solid #274a6b;background:#0b2036;border-radius:8px;padding:8px;cursor:pointer;font-size:12px;font-weight:600;color:#cdd9e6}'+
  '.pgm-preset:hover{border-color:#2f9e6b}.pgm-sw{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:middle}'+
  '.pgm-catlist{margin-top:10px;display:flex;flex-direction:column;gap:5px;max-height:230px;overflow-y:auto}'+
  '.pgm-catrow{text-align:left;background:#0b2036;border:1px solid #274a6b;border-radius:7px;padding:7px 9px;cursor:pointer;display:block}'+
  '.pgm-catrow:hover{border-color:#2f9e6b}.pgm-cr-nm{display:block;font-size:12.5px;font-weight:600;color:#e8eef5}.pgm-cr-meta{display:block;font-size:10.5px;color:#8fa6bd;margin-top:2px}'+
  '.pgm-plist{display:flex;flex-direction:column;gap:8px;margin-bottom:10px}'+
  '.pgm-pitem{background:#0b2036;border:1px solid #274a6b;border-radius:9px;padding:9px}'+
  '.pgm-pitem.pgm-editing{border-color:#2f9e6b;box-shadow:0 0 0 1px #2f9e6b}'+
  '.pgm-pi-top{display:flex;justify-content:space-between;gap:8px}'+
  '.pgm-pi-info{min-width:0}.pgm-pi-nm{font-weight:600;font-size:13px;line-height:1.25}.pgm-pi-rf{font-size:11px;color:#8fa6bd;margin-top:2px}'+
  '.pgm-pi-pr{font-size:12px;margin-top:3px}.pgm-old{color:#8fa6bd;text-decoration:line-through;margin-right:6px}.pgm-new{color:#7fd6a3;font-weight:700}'+
  '.pgm-acts{display:flex;gap:4px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end;max-width:96px}'+
  '.pgm-ic{border:1px solid #274a6b;background:transparent;color:#a9bdd0;width:26px;height:26px;border-radius:6px;cursor:pointer;font-size:13px;padding:0}'+
  '.pgm-ic:hover{color:#fff;border-color:#2f9e6b}.pgm-del:hover{border-color:#d9534f;background:#d9534f;color:#fff}'+
  '.pgm-pi-remise{display:flex;align-items:center;gap:6px;margin-top:8px;font-size:11px;color:#8fa6bd}.pgm-pi-remise input{width:60px;padding:4px 6px}'+
  '.pgm-manual{margin-top:4px;border:1px dashed #274a6b;border-radius:9px;padding:0 11px}'+
  '.pgm-manual summary{cursor:pointer;padding:9px 0;font-size:12px;font-weight:600;color:#cdd9e6}.pgm-manual[open]{padding-bottom:11px}'+
  '.pgm-btn{border:none;border-radius:8px;padding:10px;font-family:inherit;font-weight:600;font-size:12.5px;cursor:pointer}'+
  '.pgm-btn:hover{filter:brightness(1.08)}.pgm-primary{background:#2f9e6b;color:#fff}.pgm-ghost{background:transparent;border:1px solid #274a6b;color:#cdd9e6}.pgm-add{background:linear-gradient(135deg,#6a9c3a,#54812c);color:#fff}'+
  '.pgm-btnrow{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}'+
  '.pgm-work{display:flex;flex-direction:column;overflow:hidden;background:#0a1826}'+
  '.pgm-toolbar{display:flex;align-items:center;gap:10px;padding:11px 14px;border-bottom:1px solid #17324c;background:#0c1e30;flex-wrap:wrap}'+
  '.pgm-modes{display:flex;background:#0b2036;border:1px solid #274a6b;border-radius:8px;overflow:hidden}'+
  '.pgm-mode{background:transparent;border:none;color:#a9bdd0;padding:8px 13px;font-family:inherit;font-size:12.5px;font-weight:600;cursor:pointer}'+
  '.pgm-mode.pgm-on{background:#2f9e6b;color:#fff}.pgm-sp{flex:1}'+
  '.pgm-zoom{display:flex;align-items:center;gap:6px;color:#8fa6bd;font-size:12px}'+
  '.pgm-auto{width:auto;padding:9px 13px}'+
  '.pgm-stage{flex:1;overflow:auto;padding:24px;display:flex;justify-content:center;align-items:flex-start}'+
  '.pgm-stage-in{transform-origin:top center}'+
  /* ---- document ---- */
  '.pgm-page{width:210mm;min-height:297mm;background:#fff;color:#222;box-shadow:0 12px 40px rgba(0,0,0,.4);display:flex;flex-direction:column;font-size:11pt}'+
  '.pgm-dhead{background:var(--pgm-brand);color:#fff;padding:15mm 14mm 9mm;position:relative;overflow:hidden}'+
  '.pgm-dhead::after{content:"";position:absolute;right:-30mm;top:-30mm;width:80mm;height:80mm;border-radius:50%;background:rgba(255,255,255,.08)}'+
  '.pgm-dh-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10mm;position:relative;z-index:2}'+
  '.pgm-logo-img{max-height:20mm;max-width:55mm;object-fit:contain;background:#fff;border-radius:6px;padding:4px}'+
  '.pgm-logo-tx{font-weight:800;font-size:15pt;line-height:1.05}.pgm-logo-tx small{display:block;font-weight:500;font-size:8pt;opacity:.85}'+
  '.pgm-valid{background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.35);border-radius:999px;padding:5px 12px;font-size:8.5pt;font-weight:600;white-space:nowrap}'+
  '.pgm-eyebrow{display:inline-block;background:var(--pgm-accent);color:#fff;font-weight:700;font-size:8.5pt;letter-spacing:1.4px;text-transform:uppercase;padding:4px 12px;border-radius:5px;margin:9mm 0 5mm;position:relative;z-index:2}'+
  '.pgm-dtitle{font-size:24pt;font-weight:800;line-height:1.05;margin:0;position:relative;z-index:2;max-width:150mm}'+
  '.pgm-dsub{font-size:11pt;font-weight:500;opacity:.92;margin:3mm 0 0;position:relative;z-index:2}'+
  '.pgm-accroche{font-family:"Pacifico",cursive;color:var(--pgm-accent);font-size:22pt;padding:6mm 14mm 0;line-height:1.1}'+
  '.pgm-products{padding:8mm 14mm 6mm;flex:1}'+
  '.pgm-colhead{display:grid;grid-template-columns:1fr 34mm 44mm;gap:6mm;padding:0 3mm 5px;font-size:7.5pt;text-transform:uppercase;letter-spacing:.6px;color:#9aa4ac;font-weight:600;border-bottom:2px solid var(--pgm-brand)}'+
  '.pgm-colhead span:nth-child(2){text-align:center}.pgm-colhead span:nth-child(3){text-align:right}'+
  '.pgm-prow{display:grid;grid-template-columns:1fr 34mm 44mm;gap:6mm;align-items:center;padding:5mm 3mm;border-bottom:1px solid #ecefe9;page-break-inside:avoid;break-inside:avoid}'+
  '.pgm-prow:nth-child(even){background:var(--pgm-brand-soft)}'+
  '.pgm-pmain{display:flex;gap:9px;align-items:center;min-width:0}.pgm-thumb{width:16mm;height:16mm;border-radius:8px;object-fit:cover;flex-shrink:0;border:1px solid #e6e6e6}'+
  '.pgm-pn{font-weight:700;font-size:11pt;line-height:1.2;color:#1f2a1a}.pgm-badges{margin-top:3px;display:flex;gap:5px;flex-wrap:wrap}'+
  '.pgm-bdg{font-size:7pt;font-weight:800;letter-spacing:.5px;text-transform:uppercase;padding:2px 7px;border-radius:4px}.pgm-bdg-new{background:#e23b3b;color:#fff}.pgm-bdg-cus{background:var(--pgm-accent);color:#fff}'+
  '.pgm-pref{font-size:8pt;color:#8a8f86;margin-top:3px}'+
  '.pgm-pspecs{font-size:8.5pt;color:#5c6358;text-align:center;line-height:1.5}.pgm-pspecs b{color:#333;font-weight:600}'+
  '.pgm-pprice{text-align:right;line-height:1.15}.pgm-oldp{color:#a2a7a0;text-decoration:line-through;font-size:9.5pt}'+
  '.pgm-rchip{display:inline-block;background:var(--pgm-accent);color:#fff;font-weight:800;font-size:8pt;padding:2px 7px;border-radius:4px;margin:2px 0}'+
  '.pgm-newp{font-size:17pt;font-weight:800;color:var(--pgm-brand-dark)}.pgm-newp small{font-size:8pt;font-weight:600;color:#7c8175;display:block;margin-top:-2px}'+
  /* grille */
  '.pgm-grid{padding:8mm 12mm 6mm;flex:1;display:grid;grid-template-columns:repeat(3,1fr);gap:6mm}'+
  '.pgm-card{border:1px solid #e6e9e1;border-radius:10px;overflow:hidden;display:flex;flex-direction:column;page-break-inside:avoid;break-inside:avoid;background:#fff}'+
  '.pgm-c-media{position:relative;height:38mm;background:var(--pgm-brand-soft);display:flex;align-items:center;justify-content:center;overflow:hidden}'+
  '.pgm-c-img{width:100%;height:100%;object-fit:cover}'+
  '.pgm-c-ph{font-size:26pt;font-weight:800;color:var(--pgm-brand);opacity:.55}'+
  '.pgm-c-badge{position:absolute;top:6px;left:6px}.pgm-c-badge .pgm-bdg{font-size:6.5pt}'+
  '.pgm-c-remise{position:absolute;top:6px;right:6px;background:var(--pgm-accent);color:#fff;font-weight:800;font-size:9pt;padding:3px 8px;border-radius:5px}'+
  '.pgm-c-body{padding:8px 10px 11px;display:flex;flex-direction:column;flex:1}'+
  '.pgm-c-nm{font-weight:700;font-size:10pt;line-height:1.2;color:#1f2a1a}'+
  '.pgm-c-meta{font-size:7.5pt;color:#5c6358;margin-top:3px}.pgm-c-ref{font-size:7pt;color:#9aa096;margin-top:1px}'+
  '.pgm-c-price{margin-top:auto;padding-top:7px;display:flex;align-items:baseline;gap:7px;flex-wrap:wrap}'+
  '.pgm-c-old{color:#a2a7a0;text-decoration:line-through;font-size:8.5pt}.pgm-c-new{font-size:15pt;font-weight:800;color:var(--pgm-brand-dark)}'+
  '.pgm-dfoot{background:var(--pgm-brand-dark);color:#fff;padding:6mm 14mm;display:flex;justify-content:space-between;gap:10mm;font-size:8.5pt;margin-top:auto}'+
  '.pgm-cond{max-width:105mm;opacity:.92;line-height:1.5}.pgm-contact{text-align:right;line-height:1.5}.pgm-contact b{font-size:9.5pt}'+
  '.pgm-empty{padding:40mm 14mm;text-align:center;color:#aaa;font-size:11pt}'+
  '@media (max-width:920px){.pgm-app{grid-template-columns:1fr}.pgm-side{max-height:none}.pgm-stage{padding:14px 6px}}';

  /* ---------- API ---------- */
  var PGM = { mount:mount, unmount:unmount, setCatalogue:setCatalogue, PRESETS:PRESETS };
  global.PromoGenerator = PGM;

})(window);
