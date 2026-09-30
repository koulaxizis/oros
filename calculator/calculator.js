// ===== CALCULATOR.JS v0.1.0 BOOT =====
(function(){
"use strict";
var SCRIPT_V = "";
(function(){ var m=(document.currentScript && document.currentScript.src||"").match(/[?&]v=([^&#]+)/);
  SCRIPT_V = m?m[1]:""; console.log("calculator.js v"+(SCRIPT_V||"?")+" boot"); })();

/* ===================== CONSTANTS ===================== */
var APP_ID = "calculator";
var DATA_KEY = "oros-calculator-data";
var PREFS_KEY = "oros-cal-prefs";
var HIST_MAX = 20;
var TRUTH_REVEAL_CHANCE = 1/15;

/* ===================== I18N ===================== */
var STRINGS = {
  en:{
    appName:"Calculator", history:"History", clear:"Clear",
    sharePrank:"📋 Copy the joke", modeNormal:"Normal", modeTroll:"Troll",
    histEmpty:"No calculations yet.", copied:"Copied!",
    shareText:"I asked a calculator:\n{q}\nIt said:\n\"{a}\"\n(psst… it's actually {n})",
    revealPrefix:["Okay, fine — it's ","Alright, alright… ","Ugh. It's ","Fine!! It's "],
    revealSuffix:". Happy now?","Are you proud?"," Don't tell anyone."," Sheesh.",
    quips:[
      "I have no idea.","How should I know?","Leave me alone!",
      "I don't know how to count...","Math is hard.",
      "I ate the answer. It was tasty.","My paw slipped on the keys.",
      "Error 404: answer not found.","Have you tried asking a human?",
      "*pretends to think*","Numbers are scary!!",
      "The dog deleted my homework.","Zzz... were you talking to me?",
      "Does it LOOK like I do math?","According to my calculations... nope.",
      "42? No wait, that one's taken.","I was busy licking my fur."
    ],
    calc:"Calculate", sound:"Sound", theme:"Theme", lang:"Language",
    skin:"Skin", resetAll:"Reset All", exportCSV:"Export CSV",
    resetConfirmMsg:"Clear the calculation history?", cancel:"Cancel", error:"Error"
  },
  el:{
    appName:"Αριθμομηχανή", history:"Ιστορικό", clear:"Καθαρισμός",
    sharePrank:"📋 Αντίγραψε την πλάκα", modeNormal:"Κανονική", modeTroll:"Απάτη",
    histEmpty:"Καμία πράξη ακόμα.", copied:"Αντιγράφηκε!",
    shareText:"Ρώτησα έναν υπολογιστή:\n{q}\nΜου είπε:\n\"{a}\"\n(ψιτ… στην πραγματικότητα είναι {n})",
    revealPrefix:["Εντάξει, εντάξει — είναι ","Αρκετά… ","Ουφ. Είναι ","Άκρη το βρήκα! Τo "],
    revealSuffix:". Χαρούμενος τώρα;",". Είσαι περήφανος;",". Μη το πεις σε κανέναν.",". Τι τα θες τόσα…"],
    quips:[
      "Δεν έχω ιδέα.","Πώς να το ξέρω;","Άφησέ με ήσυχο!",
      "Δεν ξέρω να μετράω...","Τα μαθηματικά είναι δύσκολα.",
      "Έφαγα την απάντηση. Ήταν νόστιμη.","Η πατούσα μου γλίστρησε.",
      "Λάθος 404: δεν βρέθηκε απάντηση.","Δοκίμασες να ρωτήσεις άνθρωπο;",
      "*προσποιείται ότι σκέφτεται*","Οι αριθμοί τρομάζουν!!",
      "Ο σκύλος έφαγε την εργασία μου.","Ζζζ... μιλούσες σε μένα;",
      "ΣΟΥ ΦΑΙΝΕΤΑΙ ότι κάνω μαθηματικά;","Σύμφωνα με τους υπολογισμούς μου... όχι.",
      "42; Όχι, αυτό το πήρε άλλος.","Ήμουν απασχολημένος με το γλείψιμο."
    ],
    calc:"Υπολογισμός", sound:"Ήχος", theme:"Θέμα", lang:"Γλώσσα",
    skin:"Δερματικό", resetAll:"Επαναφορά", exportCSV:"Εξαγωγή CSV",
    resetConfirmMsg:"Διαγραφή του ιστορικού υπολογισμών;", cancel:"Άκυρο", error:"Σφάλμα"
  }
};

/* ===================== SKINS ===================== */
var SKINS = [
  {id:"neko",  a:"#ff8fc7", b:"#c77dff", fur:"#ffb3d9", furDark:"#e98bc4", blush:"#ff6fa8"},
  {id:"dog",   a:"#ffb95e", b:"#f08a5d", fur:"#ffd9a0", furDark:"#e8a765", blush:"#ff9e6d"},
  {id:"alien", a:"#8aff80", b:"#39d98a", fur:"#b8ffb0", furDark:"#8fe888", blush:"#5cff8f"},
  {id:"robot", a:"#7cd5ff", b:"#679bff", fur:"#cfeaff", furDark:"#9fd4f5", blush:"#a0e9ff"},
  {id:"duck",  a:"#ffe066", b:"#ffab4a", fur:"#fff3b0", furDark:"#ffe066", blush:"#ffc94d"}
];

/* ===================== STATE ===================== */
/* Ενιαίο synced slice (έγκριση: «Όλα sync»).
   Schema: { ver:1, hist:[{id,e,v,f,mtime}], tombs{},
             skin, troll, sound, sm:{skin,troll,sound} }
   sm = per-field mtime stamps (Pet fm pattern) για LWW merge. */
var data = { ver:1, hist: [], tombs: {},
             skin:"neko", troll:false, sound:true,
             sm:{ skin:0, troll:0, sound:0 } };
/* prefs = runtime mirror μόνο (lang = render-only, shell-owned) */
var prefs = { lang:"en", skin:"neko", troll:false, sound:true };
var expr = "", lastQuip = false, lastHidden = null, typingTimer = null, moodTimer = null, prevAnswer = null;

/* Load state */
try{
  var savedData = localStorage.getItem(DATA_KEY);
  if(savedData){
    var d = JSON.parse(savedData);
    if(typeof d === "object" && d !== null){
      if(Array.isArray(d.hist)) data.hist = d.hist;
      if(d.tombs && typeof d.tombs === "object") data.tombs = d.tombs;
      if(typeof d.skin === "string"){ data.skin = d.skin; prefs.skin = d.skin; }
      if(typeof d.troll === "boolean"){ data.troll = d.troll; prefs.troll = d.troll; }
      if(typeof d.sound === "boolean"){ data.sound = d.sound; prefs.sound = d.sound; }
      if(d.sm && typeof d.sm === "object") data.sm = d.sm;
    }
  }
  /* Shell language (το shell είναι owner της γλώσσας) */
  var shellLang = localStorage.getItem("oros.lang");
  if(shellLang === "en" || shellLang === "el") prefs.lang = shellLang;
}catch(e){}

function saveData(){
  localStorage.setItem(DATA_KEY, JSON.stringify(data));
  if(window.__orosSyncApi) window.__orosSyncApi.dirty();
}
function setPref(field, value){
  /* LWW: κάθε αλλαγή pref σφραγίζει και το sm[field] */
  if(data[field] === value) return;
  data[field] = value; prefs[field] = value;
  data.sm[field] = Date.now();
  saveData();
}
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function shellIsLight(){
  /* Ανίχνευση shell theme μέσω --bg luminance (graceful, χωρίς fake data) */
  try{
    var bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    var m = bg.match(/^#([0-9a-f]{6})$/i);
    if(!m) return false;
    var r = parseInt(m[1].slice(0,2),16), g = parseInt(m[1].slice(2,4),16), b = parseInt(m[1].slice(4,6),16);
    return (0.2126*r + 0.7152*g + 0.0722*b) > 128;
  }catch(e){ return false; }
}
function t(key){ return STRINGS[prefs.lang][key] || STRINGS.en[key] || key; }
function esc(x){ return String(x).replace(/[<>&"'`]/g,function(c){return "&#"+c.charCodeAt(0)+";";}); }

/* ===================== AUDIO ===================== */
var actx = null;
function audioCtx(){
  if(!prefs.sound) return null;
  try{
    if(!actx) actx = new (window.AudioContext||window.webkitAudioContext)();
    if(actx.state==="suspended") actx.resume();
    return actx;
  }catch(e){ return null; }
}
function blip(freq,dur,type,vol,slideTo){
  var c = audioCtx(); if(!c) return;
  try{
    var o = c.createOscillator(), g = c.createGain();
    o.type = type||"sine"; o.frequency.value = freq;
    if(slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime+dur);
    g.gain.setValueAtTime(vol||0.06, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime+dur);
    o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime+dur+0.02);
  }catch(e){}
}
function voiceNeko(){
  var c = audioCtx(); if(!c) return;
  try{
    [[520,0.06],[780,0.03]].forEach(function(pair){
      var f = pair[0], v = pair[1];
      var o = c.createOscillator(), g = c.createGain();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(f*0.7,c.currentTime);
      o.frequency.linearRampToValueAtTime(f*1.25,c.currentTime+0.12);
      o.frequency.linearRampToValueAtTime(f*0.85,c.currentTime+0.32);
      g.gain.setValueAtTime(0.0001,c.currentTime);
      g.gain.linearRampToValueAtTime(v,c.currentTime+0.05);
      g.gain.exponentialRampToValueAtTime(0.0001,c.currentTime+0.35);
      var lp = c.createBiquadFilter(); lp.type="lowpass"; lp.frequency.value=1600;
      o.connect(lp); lp.connect(g); g.connect(c.destination);
      o.start(); o.stop(c.currentTime+0.4);
    });
  }catch(e){}
}
function voiceDog(){
  var c = audioCtx(); if(!c) return;
  try{
    var o = c.createOscillator(), g = c.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(170,c.currentTime);
    o.frequency.exponentialRampToValueAtTime(95,c.currentTime+0.18);
    g.gain.setValueAtTime(0.0001,c.currentTime);
    g.gain.linearRampToValueAtTime(0.11,c.currentTime+0.03);
    g.gain.exponentialRampToValueAtTime(0.0001,c.currentTime+0.24);
    var lp = c.createBiquadFilter(); lp.type="lowpass"; lp.frequency.value=600; lp.Q.value=2;
    o.connect(lp); lp.connect(g); g.connect(c.destination);
    o.start(); o.stop(c.currentTime+0.28);
    setTimeout(function(){
      var c2 = audioCtx(); if(!c2) return;
      var o2 = c2.createOscillator(), g2 = c2.createGain();
      o2.type = "sawtooth";
      o2.frequency.setValueAtTime(150,c2.currentTime);
      o2.frequency.exponentialRampToValueAtTime(85,c2.currentTime+0.15);
      g2.gain.setValueAtTime(0.0001,c2.currentTime);
      g2.gain.linearRampToValueAtTime(0.07,c2.currentTime+0.02);
      g2.gain.exponentialRampToValueAtTime(0.0001,c2.currentTime+0.2);
      var lp2 = c2.createBiquadFilter(); lp2.type="lowpass"; lp2.frequency.value=550;
      o2.connect(lp2); lp2.connect(g2); g2.connect(c2.destination);
      o2.start(); o2.stop(c2.currentTime+0.24);
    },170);
  }catch(e){}
}
function voiceAlien(){
  var c = audioCtx(); if(!c) return;
  try{
    [[380,0],[520,120]].forEach(function(pair){
      var f = pair[0], delay = pair[1];
      var o = c.createOscillator(), g = c.createGain(),
          lfo = c.createOscillator(), lg = c.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(f,c.currentTime+delay/1000);
      lfo.frequency.value=14; lg.gain.value=f*0.05;
      lfo.connect(lg); lg.connect(o.frequency);
      g.gain.setValueAtTime(0.0001,c.currentTime+delay/1000);
      g.gain.linearRampToValueAtTime(0.07,c.currentTime+delay/1000+0.02);
      g.gain.exponentialRampToValueAtTime(0.0001,c.currentTime+delay/1000+0.16);
      o.connect(g); g.connect(c.destination);
      o.start(c.currentTime+delay/1000); o.stop(c.currentTime+delay/1000+0.18);
      lfo.start(c.currentTime+delay/1000); lfo.stop(c.currentTime+delay/1000+0.18);
    });
  }catch(e){}
}
function voiceRobot(){
  var c = audioCtx(); if(!c) return;
  try{
    var o = c.createOscillator(), g = c.createGain(),
        lfo = c.createOscillator(), lg = c.createGain();
    o.type = "square";
    o.frequency.setValueAtTime(240,c.currentTime);
    o.frequency.linearRampToValueAtTime(200,c.currentTime+0.3);
    lfo.type="square"; lfo.frequency.value=32; lg.gain.value=55;
    lfo.connect(lg); lg.connect(o.frequency);
    g.gain.setValueAtTime(0.0001,c.currentTime);
    g.gain.linearRampToValueAtTime(0.05,c.currentTime+0.02);
    g.gain.setValueAtTime(0.05,c.currentTime+0.24);
    g.gain.exponentialRampToValueAtTime(0.0001,c.currentTime+0.34);
    var hp = c.createBiquadFilter(); hp.type="highpass"; hp.frequency.value=150;
    o.connect(hp); hp.connect(g); g.connect(c.destination);
    o.start(); o.stop(c.currentTime+0.36);
    lfo.start(); lfo.stop(c.currentTime+0.36);
  }catch(e){}
}
function voiceDuck(){
  var c = audioCtx(); if(!c) return;
  try{
    var o = c.createOscillator(), g = c.createGain(),
        am = c.createOscillator(), ag = c.createGain();
    o.type = "square";
    o.frequency.setValueAtTime(340,c.currentTime);
    o.frequency.linearRampToValueAtTime(290,c.currentTime+0.14);
    am.frequency.value=38; ag.gain.value=0.04;
    am.connect(ag); ag.connect(g.gain);
    g.gain.setValueAtTime(0.05,c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001,c.currentTime+0.16);
    var bp = c.createBiquadFilter(); bp.type="bandpass"; bp.frequency.value=700; bp.Q.value=1.5;
    o.connect(bp); bp.connect(g); g.connect(c.destination);
    o.start(); o.stop(c.currentTime+0.18);
    am.start(); am.stop(c.currentTime+0.18);
    setTimeout(function(){
      var c2 = audioCtx(); if(!c2) return;
      var o2 = c2.createOscillator(), g2 = c2.createGain();
      o2.type = "square";
      o2.frequency.setValueAtTime(395,c2.currentTime);
      o2.frequency.linearRampToValueAtTime(320,c2.currentTime+0.12);
      g2.gain.setValueAtTime(0.045,c2.currentTime);
      g2.gain.exponentialRampToValueAtTime(0.0001,c2.currentTime+0.14);
      var bp2 = c2.createBiquadFilter(); bp2.type="bandpass"; bp2.frequency.value=760; bp2.Q.value=1.5;
      o2.connect(bp2); bp2.connect(g2); g2.connect(c2.destination);
      o2.start(); o2.stop(c2.currentTime+0.16);
    },140);
  }catch(e){}
}
function speak(){
  ({neko:voiceNeko,dog:voiceDog,alien:voiceAlien,robot:voiceRobot,duck:voiceDuck}[prefs.skin]||voiceNeko)();
}
function chime(){ blip(880,0.18,"sine",0.05,1320); setTimeout(function(){blip(1180,0.22,"sine",0.045,1560);},90); }

var KEYSOUND = {
  digit:function(n){ blip(520+parseInt(n)*38,0.06,"triangle",0.05); },
  op: function(){ blip(420,0.09,"square",0.045); },
  util:function(){ blip(330,0.08,"triangle",0.05); },
  eq: function(){ blip(660,0.16,"sine",0.06,880); },
  skin:function(){ blip(500,0.12,"sine",0.05,900); },
  tick:function(){ blip(880,0.02,"square",0.018); }
};

/* ===================== UI HELPERS ===================== */
var $ = function(id){ return document.getElementById(id); };
var faceEl, exprEl, resEl, padEl, stripEl, modeSw, soundBtn, histBtn, histPanel, histList, shareBtn, exportBtn;

/* ===================== FACE SVG ===================== */
function faceSVG(id){
  var open  ='<g class="eyes-open eyeblink"><g class="pupil-g"><circle cx="42" cy="52" r="4.5" fill="#241a30"/><circle cx="78" cy="52" r="4.5" fill="#241a30"/></g></g>';
  var smug  ='<g class="eyes-smug"><path d="M35 53 Q42 47 49 53" stroke="#241a30" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M71 53 Q78 47 85 53" stroke="#241a30" stroke-width="3.5" fill="none" stroke-linecap="round"/></g>';
  var think ='<g class="eyes-think"><circle cx="42" cy="52" r="4.5" fill="#241a30"/><circle cx="78" cy="52" r="4.5" fill="#241a30"/><path d="M31 43 Q42 38 53 42" stroke="#241a30" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M67 42 Q78 38 89 43" stroke="#241a30" stroke-width="3" fill="none" stroke-linecap="round"/></g>';
  var mIdle ='<g class="mouth-idle"><path d="M52 66 Q60 73 68 66" stroke="#241a30" stroke-width="3" fill="none" stroke-linecap="round"/></g>';
  var mSmug ='<g class="mouth-smug"><path d="M50 68 Q55 63 60 68 Q65 73 70 68" stroke="#241a30" stroke-width="3" fill="none" stroke-linecap="round"/><ellipse cx="35" cy="63" rx="5" ry="3" fill="var(--blush)" opacity=".7"/><ellipse cx="85" cy="63" rx="5" ry="3" fill="var(--blush)" opacity=".7"/></g>';
  var mThink='<g class="mouth-think"><path d="M52 67 L68 67" stroke="#241a30" stroke-width="3" stroke-linecap="round"/></g>';
  var eyes=open+smug+think, mouths=mIdle+mSmug+mThink;
  var shapes={
    neko:'<path d="M18 34 L24 8 L40 26 Z" fill="var(--fur)"/><path d="M102 34 L96 8 L80 26 Z" fill="var(--fur)"/>'+
         '<ellipse cx="60" cy="58" rx="46" ry="42" fill="var(--fur)"/>',
    dog:'<ellipse cx="20" cy="58" rx="12" ry="24" fill="var(--furDark)"/><ellipse cx="100" cy="58" rx="12" ry="24" fill="var(--furDark)"/>'+
        '<ellipse cx="60" cy="60" rx="46" ry="42" fill="var(--fur)"/>',
    alien:'<path d="M52 10 L60 26 L68 10" stroke="var(--fur)" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="52" cy="10" r="3.5" fill="var(--accent)"/>'+
          '<ellipse cx="60" cy="62" rx="42" ry="40" fill="var(--fur)"/>',
    robot:'<rect x="16" y="22" width="88" height="76" rx="16" fill="var(--fur)"/><path d="M60 22 L60 8" stroke="var(--fur)" stroke-width="4"/><circle cx="60" cy="7" r="5" fill="var(--accent)"/>'+
          '<rect x="46" y="14" width="28" height="8" rx="4" fill="var(--fur)"/>',
    duck:'<circle cx="60" cy="58" r="46" fill="var(--fur)"/><path d="M46 68 Q60 84 74 68 Q60 76 46 68 Z" fill="var(--accent)"/>'
  };
  var deco = id==="neko" ? '' : id==="dog" ? '<path d="M30 30 Q22 20 26 10" stroke="var(--furDark)" stroke-width="4" fill="none" stroke-linecap="round"/>' : id==="duck" ? '<circle cx="60" cy="18" r="6" fill="var(--fur)"/>' : '';
  return '<svg viewBox="0 0 120 104" aria-hidden="true"><g class="wobble">'+shapes[id]+deco+eyes+mouths+'</g></svg>';
}

/* ===================== SKIN / THEME / LANG ===================== */
function applySkin(id,silent){
  var sk = SKINS.find(function(s){return s.id===id;}) || SKINS[0];
  prefs.skin = sk.id;
  var r = document.documentElement.style;
  r.setProperty("--skin-a",sk.a); r.setProperty("--skin-b",sk.b);
  r.setProperty("--btn-op",sk.a); r.setProperty("--fur",sk.fur);
  r.setProperty("--furDark",sk.furDark); r.setProperty("--blush",sk.blush);
  r.setProperty("--skin-dark", shellIsLight() ? "#ffffff" : "#1b1230");
  faceEl.innerHTML = faceSVG(sk.id);
  document.querySelectorAll(".calc-skin-dot").forEach(function(d){d.classList.toggle("active",d.dataset.skin===sk.id);});
  if(!silent) KEYSOUND.skin();
  setPref("skin", sk.id);
}
/* applyTheme() removed — theme is shell-owned (G3, Bible Part II) */
function applyLang(){
  document.documentElement.lang = prefs.lang;
  var str = STRINGS[prefs.lang];
  document.querySelectorAll("[data-i18n]").forEach(function(el){
    el.textContent = str[el.getAttribute("data-i18n")] || el.textContent;
  });
  document.querySelectorAll("[data-i18n-title]").forEach(function(el){
    var tk = el.getAttribute("data-i18n-title");
    if(str[tk]) el.title = str[tk];
  });
  renderHist();
}
function applyTroll(){
  modeSw.classList.toggle("troll",prefs.troll);
  modeSw.setAttribute("aria-checked",String(prefs.troll));
  shareBtn.classList.toggle("show", prefs.troll && lastHidden!==null);
  setPref("troll", prefs.troll);
}
function applySound(){
  var soundBtn = $("soundBtn");
  if(soundBtn) soundBtn.textContent = prefs.sound ? "🔊" : "🔇";
}

/* ===================== HISTORY ===================== */
function pushHist(expression,value,isFake){
  data.hist.push({id:uid(), e:expression, v:String(value), f:!!isFake, mtime:Date.now()});
  if(data.hist.length>HIST_MAX){
    /* Cap 20: οι trimmed εγγραφές ΣΒΗΝΟΥΝ με tombstone (R17),
       ώστε να μην ανασταίνονται από remote που δεν είχε κάνει ακόμα cap */
    var drop = data.hist.shift();
    data.tombs[drop.id] = Math.max(data.tombs[drop.id]||0, drop.mtime);
  }
  saveData(); renderHist();
}
function renderHist(){
  histList.innerHTML = "";
  var str = STRINGS[prefs.lang];
  var alive = data.hist.filter(function(h){
    return !data.tombs[h.id] || h.mtime > data.tombs[h.id];
  });
  if(!alive.length){
    histList.innerHTML = '<div class="calc-hist-empty">'+str.histEmpty+'</div>';
  }else{
    alive.slice().reverse().forEach(function(h){
      var row = document.createElement("div"); row.className="calc-hist-item";
      var e = document.createElement("span"); e.className="calc-hist-expr"; e.textContent=h.e+" =";
      var v = document.createElement("span"); v.className="calc-hist-val"+(h.f?" fake":""); v.textContent=h.v;
      row.append(e,v); histList.appendChild(row);
    });
    var cl = document.createElement("button"); cl.type="button"; cl.className="calc-hist-clear";
    cl.textContent = str.clear;
    cl.onclick = function(){ clearHistory(); };
    histList.appendChild(cl);
  }
}
function clearHistory(){
  /* R17: delete wins — κάθε εγγραφή παίρνει fresh tombstone,
     ώστε να μην αναστηθεί από άλλη συσκευή μετά από merge */
  var now = Date.now();
  data.hist.forEach(function(h){
    data.tombs[h.id] = Math.max(data.tombs[h.id]||0, now);
  });
  data.hist = [];
  saveData(); renderHist(); KEYSOUND.util();
}
function fakeValue(real){
  var mag = Math.abs(real);
  if(mag<2) return Math.round((real + (Math.random()<0.5?-1:1)*(1+Math.random()*8))*10)/10;
  var err = 1+(Math.random()<0.5?-1:1)*(0.08+Math.random()*0.5);
  var f = real*err;
  f = Math.round(f*10)/10;
  if(Math.abs(f-real)<0.1) f = real+ (mag<10?2:Math.round(mag*0.2));
  return f;
}

/* ===================== CALCULATION ===================== */
function currentNum(){
  var m = expr.match(/(\d+\.?\d*)$/); return m?m[1]:"";
}
function pressKey(k){
  clearTypewriter();
  if(lastQuip){ expr=""; lastQuip=false; setMood(null); }

  if(k==="C"){ expr=""; showResult("0",false); setMood(null); KEYSOUND.util(); return; }
  if(k==="⌫"){
    if(currentNum()==="" && /[+\-*/]/.test(expr.slice(-1))) expr=expr.slice(0,-1);
    else expr=expr.replace(/(\d+\.?\d*)$/,"");
    updateDisplay(false); KEYSOUND.util(); return;
  }
  if(k==="±"){
    var n = currentNum();
    if(n){
      var head = expr.slice(0, expr.length - n.length);
      var neg = head.endsWith("-");
      var unary = neg && (head.length === 1 || /[+\-*/]/.test(head.charAt(head.length-2)));
      if(unary)     expr = head.slice(0,-1) + n;
      else if(!neg) expr = head + "-" + n;
      updateDisplay(false); KEYSOUND.util();
    }
    return;
  }
  if(k==="%"){
    var n = currentNum(); if(!n) return;
    expr = expr.slice(0,expr.length-n.length)+String(parseFloat(n)/100);
    updateDisplay(false); KEYSOUND.util(); return;
  }
  if(k==="="){ doEquals(); return; }

  if(/[+\-*/]/.test(k)){
    if(expr===""){ if(k!=="-" && prevAnswer==null) return; if(expr==="") expr=String(prevAnswer??0); }
    if(/[+\-*/]$/.test(expr)) expr=expr.slice(0,-1);
    expr+=k; updateDisplay(false); KEYSOUND.op(); return;
  }
  if(k==="."){
    if(currentNum().includes(".")) return;
    if(currentNum()==="") expr+="0";
    expr+=k; updateDisplay(false); KEYSOUND.digit("."); return;
  }
  if(/^\d$/.test(k)){
    if(currentNum()==="0") expr=expr.slice(0,-1);
    expr+=k; updateDisplay(false); KEYSOUND.digit(k); return;
  }
}

function doEquals(){
  if(lastQuip){ lastQuip=false; }
  if(expr===""||/[+\-*/.]$/.test(expr)){ updateDisplay(false); return; }
  setMood("calc");
  KEYSOUND.eq();
  setTimeout(function(){
    var val;
    try{
      var safe = expr;
      if(!/^[\d+\-.*\/ ()]+$/.test(safe)) throw 0;
      val = Function('"use strict";return('+safe+')')();
      if(typeof val!=="number"||!isFinite(val)) throw 0;
    }catch(e){ val=null; }
    prevAnswer = val;
    var prettyExpr = expr.replace(/\*/g,"×").replace(/\//g,"÷");

    if(val===null){
      if(prefs.troll) showResult(STRINGS[prefs.lang].quips[0],true);
      else showResult(t("error"),false);
      setMood(null); return;
    }

    if(prefs.troll){
      var reveal = Math.random()<TRUTH_REVEAL_CHANCE;
      if(reveal){
        lastQuip=false; lastHidden=null; shareBtn.classList.remove("show");
        var str = STRINGS[prefs.lang];
        var pre = str.revealPrefix[Math.floor(Math.random()*str.revealPrefix.length)];
        var suf = str.revealSuffix[Math.floor(Math.random()*str.revealSuffix.length)];
        var msg = pre+fmt(val)+suf;
        setMood("mock"); speak(); chime();
        typeOut(msg);
        pushHist(prettyExpr,val,false);
      }else{
        lastQuip=true; lastHidden={expr:prettyExpr, real:fmt(val)};
        shareBtn.classList.add("show");
        var q = STRINGS[prefs.lang].quips;
        var quip = q[Math.floor(Math.random()*q.length)];
        var extra = { neko:{en:"Nyan~ numbers are scary!",el:"Νιάου~ οι αριθμοί τρομάζουν!"},
                      dog:{en:"Woof. I chase balls, not digits.",el:"Γάβ. Κυνηγάω μπαλάκια, όχι ψηφία."},
                      alien:{en:"Your Earth math is irrelevant here.",el:"Τα γήινα μαθηματικά δεν με αφορούν."},
                      robot:{en:"BZZT. Logic module on vacation.",el:"ΜΠΡΡΡ. Η λογική μονάδα κάνει διακοπές."},
                      duck:{en:"Quack. I only count breadcrumbs.",el:"Κουάκ. Μετράω μόνο ψίχουλα."}}[prefs.skin];
        if(extra && Math.random()<0.4) quip = prefs.lang==="en"?extra.en:extra.el;
        setMood("mock"); speak();
        typeOut(quip);
        pushHist(prettyExpr, fakeValue(val), true);
      }
    }else{
      showResult(fmt(val),false);
      setMood(null);
      pushHist(prettyExpr,val,false);
    }
  },260);
}

function fmt(v){
  if(v===null||v===undefined) return "???";
  var r = Math.round(v*1e10)/1e10;
  return String(r);
}
function updateDisplay(){
  exprEl.textContent = expr||"0";
  var n = currentNum();
  showResult(n||"0",false);
}
function showResult(txt,isQuip){
  resEl.textContent = txt;
  resEl.classList.toggle("quip",isQuip);
}
function typeOut(text){
  clearTypewriter();
  resEl.classList.add("quip"); resEl.textContent="";
  var i=0;
  typingTimer = setInterval(function(){
    resEl.textContent = text.slice(0,++i);
    if(i%3===0) KEYSOUND.tick();
    if(i>=text.length){ clearInterval(typingTimer); typingTimer=null; }
  },26);
}
function clearTypewriter(){ if(typingTimer){clearInterval(typingTimer);typingTimer=null;} }

/* ===================== SHARE ===================== */
function sharePrank(){
  if(!lastHidden) return;
  var str = STRINGS[prefs.lang];
  var txt = str.shareText
    .replace("{q}",lastHidden.expr)
    .replace("{a}",resEl.textContent||str.quips[0])
    .replace("{n}",lastHidden.real);
  var done = function(){ chime(); flashToast(str.copied); };
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(txt).then(done).catch(function(){fallbackCopy(txt,done);});
  }else fallbackCopy(txt,done);
}
function fallbackCopy(txt,done){
  try{
    var ta = document.createElement("textarea");
    ta.value=txt; ta.style.position="fixed"; ta.style.opacity="0";
    document.body.appendChild(ta); ta.select();
    document.execCommand("copy"); document.body.removeChild(ta);
    done();
  }catch(e){ flashToast("Ctrl+C"); }
}
function flashToast(msg){
  var d = document.createElement("div");
  d.textContent = msg;
  d.style.cssText = "position:fixed;left:50%;top:20px;transform:translateX(-50%);"+
    "background:var(--skin-a);color:var(--skin-dark);padding:8px 18px;border-radius:20px;"+
    "font-size:.8rem;font-weight:700;z-index:99;transition:opacity .4s;pointer-events:none;";
  document.body.appendChild(d);
  setTimeout(function(){d.style.opacity="0";setTimeout(function(){d.remove();},450);},1400);
}

/* ===================== MOOD ===================== */
function setMood(m){
  if(moodTimer){clearTimeout(moodTimer);moodTimer=null;}
  faceEl.classList.remove("mock","calc");
  if(m==="mock"){ faceEl.classList.add("mock");
    moodTimer=setTimeout(function(){faceEl.classList.remove("mock");},4000);
  }
  else if(m==="calc"){ faceEl.classList.add("calc"); }
}

/* ===================== EXPORT ===================== */
function exportCSV(){
  var csv = "Expression,Result,Fake\n";
  data.hist.forEach(function(h){
    csv += '"'+h.e.replace(/"/g,'""')+'",'+h.v+','+(h.f?"TRUE":"FALSE")+"\n";
  });
  var blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url; a.download = "calculator-history.csv";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  chime();
}
function resetAll(){
  var dlg = document.createElement("dialog");
  dlg.className = "calc-dialog";
  var str = STRINGS[prefs.lang];
  dlg.innerHTML = '<p>'+esc(str.resetConfirmMsg)+'</p>'+
    '<div class="calc-dialog-actions">'+
    '<button type="button" class="calc-dialog-cancel">'+esc(str.cancel)+'</button>'+
    '<button type="button" class="calc-dialog-danger">'+esc(str.resetAll)+'</button></div>';
  document.body.appendChild(dlg);
  var closeDlg = function(){ dlg.close(); dlg.remove(); };
  dlg.querySelector(".calc-dialog-cancel").onclick = closeDlg;
  dlg.querySelector(".calc-dialog-danger").onclick = function(){
    clearHistory();
    closeDlg(); chime();
  };
  dlg.addEventListener("close", function(){ if(document.body.contains(dlg)) dlg.remove(); });
  dlg.showModal();
  dlg.addEventListener("click", function(e){ if(e.target===dlg) closeDlg(); });
}

/* ===================== SYNC SLICE ===================== */
function sliceGet(){
  return { ver:data.ver, hist:data.hist, tombs:data.tombs,
           skin:data.skin, troll:data.troll, sound:data.sound, sm:data.sm };
}
function sliceSet(payload){
  if(!payload || typeof payload !== "object") return;
  window.__orosSyncApi._suppress = true; /* R6: pull-fed setters NEVER dirty */
  try{
    if(Array.isArray(payload.hist)) data.hist = payload.hist;
    if(payload.tombs && typeof payload.tombs === "object") data.tombs = payload.tombs;
    if(payload.sm && typeof payload.sm === "object") data.sm = payload.sm;
    if(typeof payload.skin === "string"){
      data.skin = payload.skin; prefs.skin = payload.skin;
      applySkin(payload.skin, true);
    }
    if(typeof payload.troll === "boolean"){
      data.troll = payload.troll; prefs.troll = payload.troll;
      applyTroll();
    }
    if(typeof payload.sound === "boolean"){
      data.sound = payload.sound; prefs.sound = payload.sound;
      applySound();
    }
    renderHist();
  } finally { window.__orosSyncApi._suppress = false; }
}
function mergeFn(remote, local){
  /* R5: merge(A,B) === merge(B,A). mtime → lexicographic JSON tie-break. */
  var out = { ver:1, hist:[], tombs:{},
              skin:"neko", troll:false, sound:true,
              sm:{ skin:0, troll:0, sound:0 } };
  var byId = {};
  function absorb(list){
    (list||[]).forEach(function(it){
      /* Strict sanitizer: DROP invalid rows (Bible Part IV) */
      if(!it || typeof it.id !== "string" ||
         typeof it.mtime !== "number" || typeof it.e !== "string") return;
      var cur = byId[it.id];
      if(!cur){ byId[it.id]=it; return; }
      if(it.mtime > cur.mtime) byId[it.id]=it;
      else if(it.mtime === cur.mtime && JSON.stringify(it) > JSON.stringify(cur)) byId[it.id]=it;
    });
  }
  absorb(remote && remote.hist); absorb(local && local.hist);
  /* Tombstones: max-ts union, delete wins ties (R17) */
  var rT = (remote && remote.tombs) || {}, lT = (local && local.tombs) || {};
  Object.keys(rT).forEach(function(k){ out.tombs[k] = Math.max(out.tombs[k]||0, rT[k]); });
  Object.keys(lT).forEach(function(k){ out.tombs[k] = Math.max(out.tombs[k]||0, lT[k]); });
  Object.keys(byId).forEach(function(k){
    if(!out.tombs[k] || byId[k].mtime > out.tombs[k]) out.hist.push(byId[k]);
  });
  out.hist.sort(function(a,b){ return a.mtime - b.mtime; }); /* χρονολογική σειρά */
  if(out.hist.length > HIST_MAX) out.hist = out.hist.slice(out.hist.length-HIST_MAX);
  /* Scalar prefs: per-field LWW via sm, lexicographic value tie-break */
  ["skin","troll","sound"].forEach(function(f){
    var rs = (remote && remote.sm) ? (remote.sm[f]||0) : 0;
    var ls = (local  && local.sm)  ? (local.sm[f]||0)  : 0;
    var rv = remote ? remote[f] : undefined;
    var lv = local  ? local[f]  : undefined;
    if(rv === undefined && lv === undefined) return;
    if(rv === undefined) out[f] = lv;
    else if(lv === undefined) out[f] = rv;
    else if(rs > ls) out[f] = rv;
    else if(ls > rs) out[f] = lv;
    else out[f] = (String(rv) > String(lv)) ? rv : lv;
    out.sm[f] = Math.max(rs, ls);
  });
  return out;
}
function registerSync(){
  var api = (window.parent && window.parent.orosSync) || window.orosSync;
  window.__orosSyncApi = { _suppress:false,
    dirty:function(){ if(this._suppress)return;
      if(api&&typeof api.markDirty==="function") api.markDirty(); } };
  if(!api||typeof api.registerSlice!=="function")return;
  api.registerSlice(APP_ID, sliceGet, sliceSet, DATA_KEY, mergeFn);
}

/* ===================== DEEP LINK ===================== */
window.__orosCalculatorOpen = function(){
  /* No deep link params needed - just focus app */
};

/* ===================== SHORTCUT FORWARDING ===================== */
(function(){
  document.addEventListener("keydown", function(e){
    if(!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
    var p = window.parent;
    if(!(p && p.orosShortcuts && typeof p.orosShortcuts.handle==="function")) return;
    if(p.orosShortcuts.handle(e)) e.stopPropagation();
  }, true);
})();

/* ===================== UI WIRING ===================== */
function wireUI(){
  faceEl = $("face"); exprEl = $("expr"); resEl = $("result");
  padEl = $("pad"); stripEl = $("skinStrip");
  modeSw = $("modeSwitch");
  soundBtn = $("soundBtn"); histBtn = $("histBtn"); histPanel = $("histPanel");
  histList = $("histList"); shareBtn = $("shareBtn");
  var exportBtn = $("exportBtn");

  padEl.addEventListener("click",function(e){
    var b = e.target.closest(".calc-key"); if(b) pressKey(b.dataset.k);
  });
  modeSw.addEventListener("click",function(){
    prefs.troll=!prefs.troll; applyTroll(); KEYSOUND.op();
    if(!prefs.troll){ shareBtn.classList.remove("show"); lastHidden=null; }
  });
  modeSw.addEventListener("keydown",function(e){
    if(e.key===" "||e.key==="Enter"){e.preventDefault();prefs.troll=!prefs.troll;applyTroll();}
  });
  soundBtn.addEventListener("click",function(){ prefs.sound=!prefs.sound; applySound(); setPref("sound", prefs.sound); if(prefs.sound) chime(); });
  /* Shell language changes propagate via storage event (iframe, same origin) */
  window.addEventListener("storage", function(ev){
    if(ev.key === "oros.lang" && (ev.newValue === "en" || ev.newValue === "el")){
      prefs.lang = ev.newValue; applyLang();
    }
  });
  shareBtn.addEventListener("click",sharePrank);
  histBtn.addEventListener("click",function(){ histPanel.classList.toggle("open"); KEYSOUND.util(); });
  if(exportBtn) exportBtn.addEventListener("click",exportCSV);
  var resetBtn = $("resetBtn");
  if(resetBtn) resetBtn.addEventListener("click",resetAll);

  /* Skin strip */
  SKINS.forEach(function(sk){
    var b = document.createElement("button");
    b.type="button"; b.className="calc-skin-dot"; b.dataset.skin=sk.id;
    b.title=sk.id.charAt(0).toUpperCase()+sk.id.slice(1);
    b.setAttribute("aria-label",b.title+" skin");
    b.innerHTML = faceSVG(sk.id)
      .replace(/var\(--fur\)/g,sk.fur).replace(/var\(--furDark\)/g,sk.furDark)
      .replace(/var\(--accent\)/g,sk.b).replace(/var\(--blush\)/g,sk.blush);
    b.onclick = function(){ applySkin(sk.id); };
    stripEl.appendChild(b);
  });

  /* Keyboard */
  document.addEventListener("keydown",function(e){
    if(e.ctrlKey||e.metaKey||e.altKey) return;
    var map={"Enter":"=","Backspace":"⌫","Escape":"C","Delete":"C","+":"+","-":"-","*":"*","/":"/","%":"%",".":"."};
    if(/^[0-9]$/.test(e.key)) pressKey(e.key);
    else if(map[e.key]){ e.preventDefault(); pressKey(map[e.key]); }
  });
}

/* ===================== INIT ===================== */
function load(){
  wireUI();
  applySkin(prefs.skin,true); applyTroll(); applySound(); applyLang();
  renderHist(); showResult("0",false);
  registerSync();
}

/* Boot sequence */
load();
})();