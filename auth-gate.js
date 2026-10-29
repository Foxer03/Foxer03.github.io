/* Lokálna testovacia brána: reálne overenie cez FastAPI, žiadne heslo v JS. */
(function(){
'use strict';
const KEY='esp32-monitor-api-base', PAGE='esp32-auth-page-ok';
const isMap=/mapa\.html$/i.test(location.pathname);
let authenticated=false;
const originalFetch=window.fetch.bind(window);
// Blokuj všetky požiadavky na dáta pred úspešným overením.
window.fetch=function(resource,options){
  const url=typeof resource==='string'?resource:(resource&&resource.url)||'';
  if(!authenticated&&!/\/api\/auth\/(login|me|logout)(?:[?#]|$)/.test(url)){
    return Promise.reject(new Error('Vyžaduje sa prihlásenie'));
  }
  return originalFetch(resource,{...options,credentials:'include'});
};
document.documentElement.classList.add('esp32-locked');
function getBase(){try{return localStorage.getItem(KEY)||''}catch{return ''}}
function normalize(raw){
 const u=new URL(raw.trim());
 if(location.protocol==='https:'&&u.protocol!=='https:')throw Error('Na GitHub Pages musí byť API dostupné cez HTTPS.');
 if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('Zadaj základnú URL bez cesty, napr. https://...');
 return u.origin;
}
async function authFetch(base,path,options={}){
 const r=await originalFetch(base+path,{...options,credentials:'include',cache:'no-store'});
 const data=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(r.status===401?'Nesprávne údaje alebo neplatná relácia.':'HTTP '+r.status);
 return data;
}
function unlock(){authenticated=true;document.documentElement.classList.remove('esp32-locked');document.getElementById('esp32-auth-gate').hidden=true;try{sessionStorage.setItem(PAGE,'1')}catch{}
 // Aplikácia sa inicializovala pred prihlásením; po odomknutí obnovíme údaje.
 if(!isMap){if(typeof checkServices==='function')checkServices();if(typeof loadMeasurements==='function')loadMeasurements();if(typeof loadEspHistory==='function')loadEspHistory();if(typeof loadAlertStations==='function')loadAlertStations();if(typeof setDemoAdmin==='function')setDemoAdmin(true);}
 else {if(typeof loadESP==='function')loadESP();}
}
function lock(){if(typeof setDemoAdmin==='function')setDemoAdmin(false);authenticated=false;document.documentElement.classList.add('esp32-locked');document.getElementById('esp32-auth-gate').hidden=false;try{sessionStorage.removeItem(PAGE)}catch{}}
window.esp32GateLogout=function(){const base=getBase();lock();if(base)authFetch(base,'/api/auth/logout',{method:'POST'}).catch(()=>{});};
document.addEventListener('DOMContentLoaded',async()=>{
 const gate=document.createElement('div');gate.id='esp32-auth-gate';
 gate.innerHTML=`<div class="esp32-auth-card" role="dialog" aria-modal="true" aria-labelledby="esp32-auth-title"><h2 id="esp32-auth-title">ESP32 Monitor</h2><p>Prihlás sa, aby sa zobrazili grafy, merania a mapa.</p><form id="esp32-auth-form"><label for="esp32-auth-url">HTTPS adresa API (Cloudflare Tunnel)</label><input id="esp32-auth-url" type="url" placeholder="https://nazov.trycloudflare.com" required><label for="esp32-auth-user">Používateľské meno</label><input id="esp32-auth-user" autocomplete="username" value="admin" required><label for="esp32-auth-pass">Heslo</label><input id="esp32-auth-pass" type="password" autocomplete="current-password" required><div id="esp32-auth-message" role="alert"></div><button id="esp32-auth-submit" type="submit">Prihlásiť sa</button></form></div>`;
 document.body.append(gate);
 const url=gate.querySelector('#esp32-auth-url'),form=gate.querySelector('form'),msg=gate.querySelector('#esp32-auth-message'),btn=gate.querySelector('button');url.value=getBase();
 // Ovládacie tlačidlá musia byť zapojené PRED automatickým obnovením relácie.
 // Inak skorý return po /api/auth/me preskočí obsluhu odhlásenia.
 const logout=document.getElementById('logout');
 if(logout)logout.addEventListener('click',()=>window.esp32GateLogout());
 const loginOpen=document.getElementById('login-open');
 if(loginOpen)loginOpen.addEventListener('click',()=>{lock();gate.querySelector('#esp32-auth-user').focus();});
 // V rámci jednej karty zachovaj prihlásenie pri prechode medzi Prehľadom a Mapou.
 // Stav v sessionStorage nestačí: vždy over platnosť relácie na FastAPI.
 // V novej karte (bez uloženého stavu) sa zobrazí prihlasovacie okno.
 form.addEventListener('submit',async(e)=>{
 e.preventDefault();msg.textContent='';btn.disabled=true;btn.textContent='Overujem…';
 try{
  const base=normalize(url.value);
  await authFetch(base,'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:gate.querySelector('#esp32-auth-user').value,password:gate.querySelector('#esp32-auth-pass').value})});
  await authFetch(base,'/api/auth/me'); // skontroluje, že cookie skutočne funguje
  localStorage.setItem(KEY,base);
  const input=document.getElementById('api-base');if(input){input.value=base;}
  if(typeof apiBase!=='undefined')apiBase=base;
  gate.querySelector('#esp32-auth-pass').value='';unlock();
 }catch(err){msg.textContent=err instanceof TypeError?'Nepodarilo sa pripojiť k API. Skontroluj URL, HTTPS a CORS.':err.message;}
 finally{btn.disabled=false;btn.textContent='Prihlásiť sa';}
 });
 if(sessionStorage.getItem(PAGE)==='1'&&getBase()){
   try{await authFetch(getBase(),'/api/auth/me');unlock();return}
   catch{try{sessionStorage.removeItem(PAGE)}catch{}}
 }

});
})();
