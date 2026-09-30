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
    resetConfirmMsg:"Clear the calculation history?", cancel:"Cancel"
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
    resetConfirmMsg:"Διαγραφή του ιστορικού υπολογισμών;", cancel:"Άκυρο"
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
var data = { hist: [] };
var prefs = { skin:"neko", troll:false, sound:true, lang:"en", theme:"dark" };
var expr = "", lastQuip = false, lastHidden = null, typingTimer = null, moodTimer = null, prevAnswer = null, evalCache = null;

/* Load state */
try{
  var savedData = localStorage.getItem(DATA_KEY);
  if(savedData){ var d = JSON.parse(savedData); if(Array.isArray(d.hist)) data.hist = d.hist; }
  var savedPrefs = localStorage.getItem(PREFS_KEY);
  if(savedPrefs) Object.assign(prefs, JSON.parse(savedPrefs));
  /* Suite-wide lang sync */
  var suiteLang = localStorage.getItem("oros.lang");
  if(suiteLang === "en" || suiteLang === "el") prefs.lang = suiteLang;
}catch(e){}

function saveData(){ localStorage.setItem(DATA_KEY, JSON.stringify(data)); __orosSyncApi && __orosSyncApi.dirty(); }
function savePrefs(){ localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); }
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
var faceEl, exprEl, resEl, padEl, stripEl, modeSw, langBtn, themeBtn, soundBtn, histBtn, histPanel, histList, shareBtn, exportBtn;

/* ===================== FACE SVG ===================== */
function faceSVG(id){
  var open  ='<g class="eyes-open"><g class="pupil-g"><circle cx="42" cy="52" r="4.5" fill="#241a30"/><circle cx="78" cy="52" r="4.5" fill="#241a30"/></g></g>';
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
  r.setProperty("--skin-dark", prefs.theme==="light" ? "#ffffff" : "#1b1230");
  faceEl.innerHTML = faceSVG(sk.id);
  document.querySelectorAll(".skin-dot").forEach(function(d){d.classList.toggle("active",d.dataset.skin===sk.id);});
  if(!silent) KEYSOUND.skin();
  savePrefs();
}
function applyTheme(){
  document.body.classList.toggle("light",prefs.theme==="light");
  var themeBtn = $("themeBtn");
  if(themeBtn) themeBtn.textContent = prefs.theme==="light" ? "☀" : "☾";
  applySkin(prefs.skin,true);
}
function applyLang(){
  document.documentElement.lang = prefs.lang;
  var langBtn = $("langBtn");
  if(langBtn) langBtn.textContent = prefs.lang==="en" ? "ΕΛ" : "EN";
  var str = STRINGS[prefs.lang];
  document.querySelectorAll("[data-i18n]").forEach(function(el){
    el.textContent = str[el.getAttribute("data-i18n")] || el.textContent;
  });
  try{ localStorage.setItem("oros.lang", prefs.lang); }catch(e){}
  renderHist();
  savePrefs();
}
function applyTroll(){
  modeSw.classList.toggle("troll",prefs.troll);
  modeSw.setAttribute("aria-checked",String(prefs.troll));
  shareBtn.classList.toggle("show", prefs.troll && lastHidden!==null);
  savePrefs();
}
function applySound(){
  var soundBtn = $("soundBtn");
  if(soundBtn) soundBtn.textContent = prefs.sound ? "🔊" : "🔇";
}

/* ===================== HISTORY ===================== */
function pushHist(expression,value,isFake){
  data.hist.push({e:expression,v:String(value),f:!!isFake});
  if(data.hist.length>HIST_MAX) data.hist.shift();
  saveData(); renderHist();
}
function renderHist(){
  histList.innerHTML = "";
  var str = STRINGS[prefs.lang];
  if(!data.hist.length){
    histList.innerHTML = '<div class="hist-empty">'+str.histEmpty+'</div>';
  }else{
    data.hist.slice().reverse().forEach(function(h){
      var row = document.createElement("div"); row.className="hist-item";
      var e = document.createElement("span"); e.className="hist-expr"; e.textContent=h.e+" =";
      var v = document.createElement("span"); v.className="hist-val"+(h.f?" fake":""); v.textContent=h.v;
      row.append(e,v); histList.appendChild(row);
    });
    var cl = document.createElement("button"); cl.type="button"; cl.className="hist-clear";
    cl.textContent = str.clear;
    cl.onclick = function(){ data.hist=[]; saveData(); renderHist(); KEYSOUND.util(); };
    histList.appendChild(cl);
  }
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

  if(k==="C"){ expr=""; evalCache=null; showResult("0",false); setMood(null); KEYSOUND.util(); return; }
  if(k==="⌫"){
    if(lastQuip) return;
    if(currentNum()==="" && /[+\-*/]/.test(expr.slice(-1))) expr=expr.slice(0,-1);
    else expr=expr.replace(/(\d+\.?\d*)$/,"");
    expr=expr.replace(/[+\-*/]$/,"");
    updateDisplay(false); KEYSOUND.util(); return;
  }
  if(k==="±"){
    if(lastQuip) return;
    var n = currentNum();
    if(n){ expr = expr.slice(0,expr.length-n.length) + (n.startsWith("-")?n.slice(1):"-"+n); updateDisplay(false); KEYSOUND.util();}
    return;
  }
  if(k==="%"){
    if(lastQuip) return;
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
    evalCache = val; prevAnswer = val;
    var prettyExpr = expr.replace(/\*/g,"×").replace(/\//g,"÷");

    if(val===null){
      showResult(STRINGS[prefs.lang].quips[0],true);
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
  var old = resEl.textContent;
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
    data.hist = []; saveData(); renderHist();
    closeDlg(); chime();
  };
  dlg.addEventListener("close", function(){ if(document.body.contains(dlg)) dlg.remove(); });
  dlg.showModal();
  dlg.addEventListener("click", function(e){ if(e.target===dlg) closeDlg(); });
}

/* ===================== SYNC SLICE ===================== */
function sliceGet(){ return { hist: data.hist }; }
function sliceSet(payload){
  if(payload && Array.isArray(payload.hist)){
    data.hist = payload.hist.slice(0,HIST_MAX);
    renderHist();
  }
}
function mergeFn(remote, local){
  /* Symmetric merge: hist union by position, LWW not needed for simple append */
  var merged = { hist: [] };
  merged.hist = local.hist.concat(remote.hist);
  if(merged.hist.length>HIST_MAX) merged.hist = merged.hist.slice(merged.hist.length-HIST_MAX);
  return merged;
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
  modeSw = $("modeSwitch"); langBtn = $("langBtn"); themeBtn = $("themeBtn");
  soundBtn = $("soundBtn"); histBtn = $("histBtn"); histPanel = $("histPanel");
  histList = $("histList"); shareBtn = $("shareBtn");
  var exportBtn = $("exportBtn");

  padEl.addEventListener("click",function(e){
    var b = e.target.closest(".key"); if(b) pressKey(b.dataset.k);
  });
  modeSw.addEventListener("click",function(){
    prefs.troll=!prefs.troll; applyTroll(); KEYSOUND.op();
    if(!prefs.troll){ shareBtn.classList.remove("show"); lastHidden=null; }
  });
  modeSw.addEventListener("keydown",function(e){
    if(e.key===" "||e.key==="Enter"){e.preventDefault();prefs.troll=!prefs.troll;applyTroll();}
  });
  langBtn.addEventListener("click",function(){ prefs.lang=prefs.lang==="en"?"el":"en"; applyLang(); KEYSOUND.util(); });
  themeBtn.addEventListener("click",function(){ prefs.theme=prefs.theme==="light"?"dark":"light"; applyTheme(); KEYSOUND.util(); });
  soundBtn.addEventListener("click",function(){ prefs.sound=!prefs.sound; applySound(); savePrefs(); if(prefs.sound) chime(); });
  shareBtn.addEventListener("click",sharePrank);
  histBtn.addEventListener("click",function(){ histPanel.classList.toggle("open"); KEYSOUND.util(); });
  if(exportBtn) exportBtn.addEventListener("click",exportCSV);
  var resetBtn = $("resetBtn");
  if(resetBtn) resetBtn.addEventListener("click",resetAll);

  /* Skin strip */
  SKINS.forEach(function(sk){
    var b = document.createElement("button");
    b.type="button"; b.className="skin-dot"; b.dataset.skin=sk.id;
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
  applyTheme(); applySkin(prefs.skin,true); applyTroll(); applySound(); applyLang();
  renderHist(); showResult("0",false);
  wireUI();
}

/* Boot sequence */
load();
})();