/* ========================================================================
   RENDER LAYER — two-pane command center (engine/data above is unchanged)
   ======================================================================== */
let done=new Set(), notes={}, view='levels', query='', selLevel=1, selTool=0, noteTimer=null;
let revealAll=false, drillCur=null, drillShown=false, drillStats={seen:0,hit:0,streak:0,best:0};
let activeTerm=null; // the single live Terminal instance (levels 0-12 "terminal" sub-tab)
const KEY_PROGRESS="bandit_progress_v3", KEY_NOTES="bandit_notes_v1", KEY_THEME="bandit_theme_v1", KEY_DRILL="bandit_drill_v1";

function esc(s){return String(s).replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));}
function stripTags(s){return String(s).replace(/<[^>]+>/g,'');}
function blob(l){const ef=entryFor(l.from),et=entryFor(l.to);
  return stripTags(['Level '+l.from+' '+l.to,l.t,l.tags.join(' '),l.goal,l.hint,l.source,l.concept,l.gotcha||'',
    l.solve.map(s=>s.n+' '+(s.c||'')).join(' '),ef.cmd,ef.note,et.cmd,et.note].join(' ')).toLowerCase();}
function usedIn(t){return LEVELS.filter(l=>{const txt=[entryFor(l.from).cmd,entryFor(l.to).cmd,...l.solve.map(s=>s.c||'')].join('\n');return t.re.test(txt);}).map(l=>l.to);}
function stepHTML(s){if(s.cap)return `<div class="cap">${s.cap}</div>`;
  const cmd=s.c?`<div class="cmdbox"><button class="copy" data-cmd="${esc(s.c)}">copy</button>${esc(s.c)}</div>`:'';
  return `<li><div class="snote">${s.n}</div>${cmd}</li>`;}
function phaseHTML(p){let inner;
  if(p.cls==='capture')inner=p.steps.map(stepHTML).join('');
  else if(p.steps.length>1)inner=`<ol class="steps">${p.steps.map(stepHTML).join('')}</ol>`;
  else{const s=p.steps[0];inner=`<div class="single"><div class="snote">${s.n}</div>${s.c?`<div class="cmdbox"><button class="copy" data-cmd="${esc(s.c)}">copy</button>${esc(s.c)}</div>`:''}</div>`;}
  return `<div class="phase ${p.cls}"><div class="plabel"><span class="dot">${p.dot}</span>${p.label}</div>${inner}</div>`;}

/* ---- persistence (localStorage — works on GitHub Pages, a local file, or claude.ai) ---- */
const store={
  get(k){try{return localStorage.getItem(k);}catch(e){return null;}},
  set(k,v){try{localStorage.setItem(k,v);}catch(e){}}
};
function loadState(){
  const p=store.get(KEY_PROGRESS); if(p){try{done=new Set(JSON.parse(p));}catch(e){}}
  const n=store.get(KEY_NOTES);    if(n){try{notes=JSON.parse(n);}catch(e){}}
  const ds=store.get(KEY_DRILL);   if(ds){try{Object.assign(drillStats,JSON.parse(ds));}catch(e){}}
  if(store.get(KEY_THEME)==='light'){document.documentElement.setAttribute('data-theme','light');
    const tb=document.getElementById('themeBtn'); if(tb)tb.classList.add('on');}
  selLevel=firstUnsolved(); renderSide(); renderDetail();
  if(window.FX&&FX.init)FX.init();   // no-op safe if fx.js failed to load/init (Task 10)
}
function saveProgress(){store.set(KEY_PROGRESS,JSON.stringify([...done]));}
function saveNotes(){clearTimeout(noteTimer);noteTimer=setTimeout(()=>store.set(KEY_NOTES,JSON.stringify(notes)),400);}

/* ---- clipboard (with execCommand fallback for file:// and non-HTTPS) ---- */
function copyText(text,btn,orig){
  const done=()=>{btn.textContent='copied';setTimeout(()=>btn.textContent=orig,1200);};
  const fail=()=>{try{const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';
    document.body.appendChild(ta);ta.focus();ta.select();document.execCommand('copy');document.body.removeChild(ta);done();}
    catch(e){btn.textContent='select';setTimeout(()=>btn.textContent=orig,1200);}};
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(text).then(done).catch(fail);
  else fail();
}
function firstUnsolved(){const l=LEVELS.find(l=>!done.has(l.to));return l?l.to:33;}

/* ---- filtered lists ---- */
function filteredLevels(){const q=query.toLowerCase();return LEVELS.filter(l=>!q||blob(l).includes(q));}
function filteredTools(){const q=query.toLowerCase();return TOOLS.filter(t=>!q||(t.name+' '+t.desc+' '+t.flags.map(f=>f.join(' ')).join(' ')).toLowerCase().includes(q));}

/* ---- sidebar ---- */
function renderSide(){
  const nl=document.getElementById('navlist'); const nextId=firstUnsolved();
  if(view==='levels'){
    const ls=filteredLevels();
    nl.innerHTML=ls.length?ls.map(l=>{
      const d=done.has(l.to),act=l.to===selLevel,nx=l.to===nextId&&!d;
      return `<button class="lrow${d?' done':''}${act?' active':''}${nx?' next':''}" data-id="${l.to}">
        <span class="ldot"></span><span class="lnum">${String(l.to).padStart(2,'0')}</span><span class="ltxt">${esc(l.t)}</span></button>`;
    }).join(''):'<div class="nores">no matches</div>';
    nl.querySelectorAll('.lrow').forEach(b=>b.onclick=()=>{selLevel=+b.dataset.id;renderSide();renderDetail();closeMobile();});
  }else if(view==='drill'){
    nl.innerHTML=drillSideHTML();
  }else{
    const ts=filteredTools();
    nl.innerHTML=ts.length?ts.map(t=>{const idx=TOOLS.indexOf(t),act=idx===selTool;
      return `<button class="lrow${act?' active':''}" data-idx="${idx}"><span class="ldot tool"></span><span class="ltxt">${esc(t.name)}</span></button>`;
    }).join(''):'<div class="nores">no matches</div>';
    nl.querySelectorAll('.lrow').forEach(b=>b.onclick=()=>{selTool=+b.dataset.idx;renderSide();renderDetail();closeMobile();});
  }
  document.getElementById('doneN').textContent=done.size;
  document.getElementById('barFill').style.width=(done.size/LEVELS.length*100)+'%';
}

/* ---- detail: level ---- */
function levelDetailHTML(l){
  const isDone=done.has(l.to), idx=LEVELS.findIndex(x=>x.to===l.to);
  const phases=compose(l).map(phaseHTML).join('');
  const openC=revealAll?' show':'';
  const hintLbl=revealAll?'▾ hide hint':'▸ hint';
  const walkLbl=revealAll?'▾ hide walkthrough':'▸ reveal walkthrough';
  const script=l.solve.map(s=>s.c).filter(Boolean).join('\n');
  const hasTerm=l.from<=12;
  const subtabsHTML=hasTerm?`<div class="subtabs">
      <button class="subtab on" data-sub="guide">guide</button>
      <button class="subtab" data-sub="terminal">terminal</button>
    </div>`:'';
  const termPaneHTML=hasTerm?`<div class="tpane" data-pane="terminal"><div class="term-mount" id="termMount"></div></div>`:'';
  return `<div class="dwrap">
    <div class="dnav">
      <button class="dbtn" id="prevBtn" ${idx===0?'disabled':''}>← prev</button>
      <span class="dcrumb">Level ${l.from} → ${l.to}</span>
      <button class="dbtn" id="nextBtn" ${idx===LEVELS.length-1?'disabled':''}>next →</button>
    </div>
    ${subtabsHTML}
    <div class="gpane on" data-pane="guide">
      <div class="dhead${isDone?' done':''}">
        <h1 class="dh1"><span class="dhnum">${String(l.to).padStart(2,'0')}</span>${esc(l.t)}</h1>
        <label class="chk"><input type="checkbox" id="clrBox" ${isDone?'checked':''}> cleared</label>
      </div>
      <div class="tags">${l.tags.map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div>
      <div class="goal"><span class="lab">objective</span>${esc(l.goal)}</div>
      <div class="reveals">
        <button class="rbtn" data-r="hint">${hintLbl}</button>
        <div class="panel${openC}" data-p="hint"><p class="hint">${l.hint}</p></div>
        <button class="rbtn" data-r="walk">${walkLbl}</button>
        <div class="panel${openC}" data-p="walk">${phases}
          <div class="concept"><span class="lab">how it works</span>${l.concept}</div>
          ${l.gotcha?`<div class="gotcha"><span class="lab">gotcha</span>${l.gotcha}</div>`:''}
          <button class="copyall" data-cmd="${esc(script)}">⧉ copy all commands</button>
        </div>
      </div>
      <div class="notes-wrap"><div class="nlab">✎ your notes</div>
        <textarea class="notebox" id="noteBox" placeholder="captured values / observations…">${esc(notes[l.to]||'')}</textarea></div>
      <div class="kbdhint">tip: <kbd>↑</kbd><kbd>↓</kbd> pick a level · <kbd>←</kbd><kbd>→</kbd> prev / next</div>
    </div>
    ${termPaneHTML}
  </div>`;
}

/* ---- detail: tool ---- */
function toolDetailHTML(t){
  const lv=usedIn(t);
  const flags=t.flags.length?`<div class="flagtable">${t.flags.map(f=>`<div class="frow"><code>${esc(f[0])}</code><span>${esc(f[1])}</span></div>`).join('')}</div>`:'';
  const chips=lv.length>15?'<span class="uchip" style="cursor:default">most levels — the login flow</span>':lv.map(n=>`<span class="uchip" data-goto="${n}">${String(n).padStart(2,'0')}</span>`).join('');
  return `<div class="dwrap">
    <div class="dnav"><span class="dcrumb">command reference</span></div>
    <div class="dhead"><h1 class="dh1">${esc(t.name)}</h1></div>
    <div class="tdesc">${esc(t.desc)}</div>
    ${t.real?`<div class="treal"><span class="lab">in the field</span>${t.real}</div>`:''}
    ${flags}
    <div class="usedlab">used in</div>
    <div class="usedchips">${chips||'<span class="uchip" style="cursor:default">—</span>'}</div>
  </div>`;
}

/* ---- terminal lifecycle + progress capture ---- */
function teardownTerminal(){if(activeTerm){activeTerm.destroy();activeTerm=null;}}
function addDone(to){if(!done.has(to)){done.add(to);saveProgress();}renderSide();}
function removeDone(to){if(done.has(to)){done.delete(to);saveProgress();}renderSide();}
function markSolved(to){
  addDone(to);
  if(window.FX&&FX.captureCascade)FX.captureCascade(to);   // no-op if fx off (Task 10)
  // The solved level `to` is the one whose terminal we're in, so selLevel===to and the
  // currently-rendered guide pane is this level. Patch its checkbox/heading in place
  // instead of re-rendering (a re-render would destroy the live terminal mid-motd).
  const box=document.getElementById('clrBox'); if(box)box.checked=true;
  const dh=document.querySelector('#detail .dhead'); if(dh)dh.classList.add('done');
}
function terminalCaptureComplete(to){
  // Fires AFTER the SSH-success motd has fully finished typing (never mid-animation).
  // Deliberately does NOT touch selLevel: renderSide()/firstUnsolved() already highlight
  // the next challenge in the sidebar, and advanceTo() drives the terminal independently.
  // Mutating selLevel here would desync it from the still-rendered guide pane, making
  // prev/next/keyboard nav compute off the wrong base (skipping a level).
  if(!activeTerm)return;
  const next=LEVELS.find(x=>x.from===to);
  if(!next)return;
  if(next.from<=12)activeTerm.advanceTo(next);   // same session, in place — no teardown, no truncation
}

/* ---- render detail + wire ---- */
function renderDetail(){
  teardownTerminal();
  const d=document.getElementById('detail');
  if(view==='levels'){
    const l=LEVELS.find(x=>x.to===selLevel)||LEVELS[0];
    d.innerHTML=levelDetailHTML(l); wireLevel(d,l);
    const mt=document.getElementById('mtitle'); if(mt)mt.textContent='Level '+l.from+' → '+l.to;
  }else if(view==='drill'){
    if(drillCur===null)drillCur=randomLevelTo(null);
    const l=LEVELS.find(x=>x.to===drillCur)||LEVELS[0];
    d.innerHTML=drillDetailHTML(l); wireDrill(d,l);
    const mt=document.getElementById('mtitle'); if(mt)mt.textContent='Drill';
  }else{
    const t=TOOLS[selTool]||TOOLS[0];
    d.innerHTML=toolDetailHTML(t); wireTool(d);
    const mt=document.getElementById('mtitle'); if(mt)mt.textContent=t.name;
  }
  d.scrollTop=0;
  d.querySelectorAll('.copy,.copyall').forEach(cp=>{const orig=cp.textContent;cp.onclick=()=>copyText(cp.dataset.cmd,cp,orig);});
}
function wireLevel(d,l){
  d.querySelector('#clrBox').onchange=e=>{
    e.target.checked?addDone(l.to):removeDone(l.to);
    d.querySelector('.dhead').classList.toggle('done',e.target.checked);};
  const step=n=>{const i=LEVELS.findIndex(x=>x.to===selLevel)+n;if(i>=0&&i<LEVELS.length){selLevel=LEVELS[i].to;renderSide();renderDetail();}};
  d.querySelector('#prevBtn').onclick=()=>step(-1);
  d.querySelector('#nextBtn').onclick=()=>step(1);
  d.querySelectorAll('.rbtn').forEach(btn=>btn.onclick=()=>{
    const r=btn.dataset.r,p=d.querySelector(`[data-p="${r}"]`),open=p.classList.toggle('show');
    btn.textContent=r==='hint'?(open?'▾ hide hint':'▸ hint'):(open?'▾ hide walkthrough':'▸ reveal walkthrough');
  });
  const ta=d.querySelector('#noteBox');
  if(ta)ta.oninput=()=>{const v=ta.value;if(v.trim())notes[l.to]=v;else delete notes[l.to];saveNotes();};

  d.querySelectorAll('.subtab').forEach(btn=>btn.onclick=()=>{
    const sub=btn.dataset.sub;
    d.querySelectorAll('.subtab').forEach(b=>b.classList.toggle('on',b===btn));
    d.querySelectorAll('[data-pane]').forEach(p=>p.classList.toggle('on',p.dataset.pane===sub));
    if(sub==='terminal'){
      if(!activeTerm){
        const mountEl=d.querySelector('#termMount');
        activeTerm=new Terminal(mountEl,l,{typed:true,showBanner:true,onCapture:markSolved,onCaptureComplete:terminalCaptureComplete});
        activeTerm.mount();
      }
      activeTerm.focus();
    }else{
      teardownTerminal();
    }
  });
}
function wireTool(d){
  d.querySelectorAll('.uchip[data-goto]').forEach(c=>c.onclick=()=>{
    view='levels';selLevel=+c.dataset.goto;syncTabs();
    document.getElementById('search').style.display='';
    document.getElementById('search').value='';query='';renderSide();renderDetail();});
}

/* ---- drill / active-recall mode ---- */
function randomLevelTo(exclude){
  let t;do{t=LEVELS[Math.floor(Math.random()*LEVELS.length)].to;}while(LEVELS.length>1&&t===exclude);
  return t;
}
function drillSideHTML(){
  const acc=drillStats.seen?Math.round(drillStats.hit/drillStats.seen*100):0;
  return `<div class="drill-stats">
    <div class="dstat streak"><span>current streak</span><b>${drillStats.streak}</b></div>
    <div class="dstat"><span>best streak</span><b>${drillStats.best}</b></div>
    <div class="dstat"><span>accuracy</span><b>${acc}%</b></div>
    <div class="dstat"><span>cards seen</span><b>${drillStats.seen}</b></div>
  </div>`;
}
function drillDetailHTML(l){
  const solve=`<ol class="steps">${l.solve.map(stepHTML).join('')}</ol>`;
  return `<div class="drill">
    <div class="drill-top">
      <span class="dcrumb">drill · active recall</span>
      <button class="dbtn" id="skipCard" style="margin-left:auto">skip →</button>
    </div>
    <div class="card">
      <div class="card-lvl">bandit ${l.from} → ${l.to}</div>
      <div class="card-tags">${l.tags.map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div>
      <div class="card-q">${esc(l.goal)}</div>
      <div class="card-hint">${l.hint}</div>
      ${drillShown?'':'<div class="prompt">— picture the command, then reveal —</div>'}
      <div class="card-a${drillShown?'':' hidden'}">
        <div class="plabel"><span class="dot">⚙</span>solution</div>
        ${solve}
        <div class="concept"><span class="lab">how it works</span>${l.concept}</div>
      </div>
    </div>
    <div class="drill-btns">${drillShown
      ? '<button class="db-miss" data-act="miss">✗ missed it</button><button class="db-hit" data-act="hit">✓ nailed it</button>'
      : '<button class="db-reveal" data-act="reveal">▸ reveal solution</button>'}</div>
  </div>`;
}
function wireDrill(d,l){
  d.querySelector('#skipCard').onclick=()=>{drillCur=randomLevelTo(drillCur);drillShown=false;renderDetail();};
  d.querySelectorAll('[data-act]').forEach(b=>b.onclick=()=>{
    const a=b.dataset.act;
    if(a==='reveal'){drillShown=true;renderDetail();return;}
    drillStats.seen++;
    if(a==='hit'){drillStats.hit++;drillStats.streak++;if(drillStats.streak>drillStats.best)drillStats.best=drillStats.streak;}
    else drillStats.streak=0;
    store.set(KEY_DRILL,JSON.stringify(drillStats));
    drillCur=randomLevelTo(drillCur);drillShown=false;
    renderSide();renderDetail();
  });
}

/* ---- view + nav ---- */
function syncTabs(){document.querySelectorAll('.stab').forEach(s=>s.classList.toggle('on',s.dataset.v===view));}
function setView(v){view=v;syncTabs();const s=document.getElementById('search');s.style.display=(v==='drill')?'none':'';s.value='';query='';renderSide();renderDetail();}
function closeMobile(){document.getElementById('side').classList.remove('open');document.getElementById('scrim').classList.remove('show');}

document.querySelectorAll('.stab').forEach(s=>s.onclick=()=>setView(s.dataset.v));
document.getElementById('search').addEventListener('input',e=>{query=e.target.value;renderSide();});
document.getElementById('resetBtn').onclick=()=>{if(confirm('Clear all cleared-level marks? (Notes are kept.)')){done=new Set();saveProgress();renderSide();renderDetail();}};
document.getElementById('menuBtn').onclick=()=>{document.getElementById('side').classList.toggle('open');document.getElementById('scrim').classList.toggle('show');};
document.getElementById('scrim').onclick=closeMobile;

document.getElementById('themeBtn').onclick=e=>{
  const light=document.documentElement.getAttribute('data-theme')==='light';
  if(light)document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme','light');
  store.set(KEY_THEME,light?'dark':'light');
  e.currentTarget.classList.toggle('on',!light);
  if(window.FX&&FX.onThemeChange)FX.onThemeChange();   // re-resolve auto fx state (Task 10)
};
document.getElementById('fxBtn').onclick=()=>{
  if(window.FX&&FX.setEnabled)FX.setEnabled(!FX.isEnabled());
};
document.getElementById('spoilBtn').onclick=e=>{
  revealAll=!revealAll;
  e.currentTarget.classList.toggle('on',revealAll);
  e.currentTarget.textContent=revealAll?'🙈 hide all':'👁 reveal all';
  if(view==='levels')renderDetail();
};

document.addEventListener('keydown',e=>{
  const tag=(e.target.tagName||'').toLowerCase();
  if(tag==='textarea'||tag==='input')return;
  if(view==='levels'){
    if(e.key==='ArrowLeft'){const i=LEVELS.findIndex(x=>x.to===selLevel)-1;if(i>=0){selLevel=LEVELS[i].to;renderSide();renderDetail();e.preventDefault();}}
    else if(e.key==='ArrowRight'){const i=LEVELS.findIndex(x=>x.to===selLevel)+1;if(i<LEVELS.length){selLevel=LEVELS[i].to;renderSide();renderDetail();e.preventDefault();}}
    else if(e.key==='ArrowDown'||e.key==='j'){const ls=filteredLevels();const i=ls.findIndex(x=>x.to===selLevel);if(i<ls.length-1){selLevel=ls[i+1].to;renderSide();renderDetail();e.preventDefault();}}
    else if(e.key==='ArrowUp'||e.key==='k'){const ls=filteredLevels();const i=ls.findIndex(x=>x.to===selLevel);if(i>0){selLevel=ls[i-1].to;renderSide();renderDetail();e.preventDefault();}}
  }else if(view==='drill'){
    if((e.key===' '||e.key==='Enter')&&!drillShown){drillShown=true;renderDetail();e.preventDefault();}
    else if(e.key==='ArrowRight'){drillCur=randomLevelTo(drillCur);drillShown=false;renderDetail();e.preventDefault();}
  }else{
    if(e.key==='ArrowDown'||e.key==='j'){const ts=filteredTools();const i=ts.findIndex(t=>TOOLS.indexOf(t)===selTool);if(i<ts.length-1){selTool=TOOLS.indexOf(ts[i+1]);renderSide();renderDetail();e.preventDefault();}}
    else if(e.key==='ArrowUp'||e.key==='k'){const ts=filteredTools();const i=ts.findIndex(t=>TOOLS.indexOf(t)===selTool);if(i>0){selTool=TOOLS.indexOf(ts[i-1]);renderSide();renderDetail();e.preventDefault();}}
  }
});

loadState();
