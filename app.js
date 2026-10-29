'use strict';
// Cloudflare Quick Tunnel is the only public backend. Never call smart.zilina.sk from the browser.
const API_KEY='esp32-monitor-api-base';
let apiBase='';
try { apiBase=localStorage.getItem(API_KEY)||''; } catch {}
const apiInput=document.getElementById('api-base');
apiInput.value=apiBase;
function apiUrl(path){if(!apiBase)throw Error('Najprv zadaj HTTPS adresu tunela.');return apiBase+path;}
function markService(id,ok,detail){
 const el=document.getElementById(id);
 el.classList.toggle('online',ok===true);
 el.classList.toggle('offline',ok===false);
 el.classList.toggle('checking',ok===null);
 el.setAttribute('aria-label',detail);
 el.textContent='';
 const dot=document.createElement('i');dot.className='api-dot';dot.setAttribute('aria-hidden','true');
 el.append(dot,document.createTextNode(detail));
}
let serviceCheckGeneration=0;
async function probe(path,timeout=12000){const c=new AbortController();const timer=setTimeout(()=>c.abort(),timeout);try{const response=await fetch(apiUrl(path),{signal:c.signal,cache:'no-store'});if(!response.ok)throw Error('HTTP '+response.status);return await response.json();}finally{clearTimeout(timer);}}
async function checkServices(){
 const generation=++serviceCheckGeneration;
 if(!apiBase){
  document.getElementById('api-overall').textContent='Zadaj adresu Cloudflare Quick Tunnel';
  markService('state-esp',null,'ESP32 API: nezistené');
  markService('state-smart',null,'Smart Žilina API: nezistené');
  markService('state-mqtt',null,'MQTT: neoverené');
  return;
 }
 document.getElementById('api-overall').textContent='Overujem dostupnosť API…';
 markService('state-esp',null,'ESP32 API: overujem…');
 markService('state-smart',null,'Smart Žilina API: overujem…');
 markService('state-mqtt',null,'MQTT: overujem…');
 const [esp,smart,mqtt]=await Promise.allSettled([
  probe('/api/devices'),
  probe('/api/smartzilina?station='+encodeURIComponent(stationDefs[0].id)),
  probe('/api/status/mqtt')
 ]);
 if(generation!==serviceCheckGeneration)return;
 markService('state-esp',esp.status==='fulfilled','ESP32 API: '+(esp.status==='fulfilled'?'online':'nedostupné'));
 markService('state-smart',smart.status==='fulfilled','Smart Žilina API: '+(smart.status==='fulfilled'?'online':'nedostupné'));
 const mqttValue=mqtt.status==='fulfilled'?(typeof mqtt.value?.online==='boolean'?mqtt.value.online:(mqtt.value?.status==='online'?true:(mqtt.value?.status==='offline'?false:null))):null;
 markService('state-mqtt',mqttValue,'MQTT: '+(mqttValue===true?'online':mqttValue===false?'nedostupné':'neoverené'));
 document.getElementById('api-overall').textContent=esp.status==='fulfilled'&&smart.status==='fulfilled'?'API sú dostupné':'Skontroluj tunel alebo služby';
 const ownStatus=document.getElementById('api-own-status'),ownData=document.getElementById('api-own-data');
 if(esp.status!=='fulfilled'){ownStatus.textContent='ESP32 API je nedostupné';ownData.hidden=true;return;}
 const devices=esp.value.devices;
 if(!Array.isArray(devices)||!devices.length){ownStatus.textContent='Žiadne zariadenia';ownData.hidden=true;return;}
 const device=String(devices[0]);
 if(!/^[A-Za-z0-9_-]+$/.test(device)){ownStatus.textContent='Neplatný identifikátor zariadenia';return;}
 try{
  const latest=await probe('/api/devices/'+encodeURIComponent(device)+'/latest');
  if(generation!==serviceCheckGeneration)return;
  ownStatus.textContent='Zariadenie '+device+' · aktuálna odpoveď API';ownData.textContent=JSON.stringify(latest,null,2);ownData.hidden=false;
 }catch{
  if(generation!==serviceCheckGeneration)return;
  ownStatus.textContent='Zariadenie '+device+' · zatiaľ bez dostupného merania';ownData.hidden=true;
 }
}
document.getElementById('api-config-form').addEventListener('submit',event=>{
 event.preventDefault();const raw=apiInput.value.trim().replace(/\/+$/,'');
 let url;try{url=new URL(raw);if(url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw Error();}catch{apiInput.setCustomValidity('Zadaj iba HTTPS adresu, napr. https://nazov.trycloudflare.com');apiInput.reportValidity();return;}
 apiInput.setCustomValidity('');apiBase=url.origin;apiInput.value=apiBase;
 try{localStorage.setItem(API_KEY,apiBase);}catch{}
 checkServices();loadMeasurements();loadEspHistory();loadAlertStations();
});
apiInput.addEventListener('input',()=>apiInput.setCustomValidity(''));
setInterval(()=>{if(!document.hidden)checkServices();},30000);
checkServices();

const primaryMetrics=['airTemperature','airHumidity','airPressure','noiseLevel'];
let selectedStation=stationDefs[0].id,requestGeneration=0,activeRequest=null;
const stationName=()=>stationDefs.find(s=>s.id===selectedStation).name;
let selectedMetric='airTemperature',period=24,liveData=null,loading=false,loadFailed=false;
let chartSource='both',customRange=null;
function timeWindow(){return customRange||{start:Date.now()-period*3600000,end:Date.now()};}
let espMeasurements=[],espLoadError=false;
// Reálne polia z CouchDB; ak daný senzor chýba, nevytvárajú sa falošné hodnoty.
const espFieldMap={airTemperature:['temperature'],airHumidity:['humidity'],airPressure:['pressure'],noiseLevel:['slm_dba','noise_dba'],airCo:['co_ppb'],airPm25:['pm25','pm2_5'],airPm10:['pm10'],airPm1:['pm1'],airPm4:['pm4'],lightIntensity:['light_lux','lux'],windSpeed:['wind_speed'],windDirection:['wind_direction'],rainGauge:['rainfall'],airNo2:['no2'],airSo2:['so2']};
function espValue(d,key){const fields=espFieldMap[key]||[];for(const field of fields){if(d[field]!==null&&d[field]!==undefined&&d[field]!==''){const value=Number(d[field]);if(Number.isFinite(value))return value;}}return null;}

function espPoints(key){const {start,end}=timeWindow();return espMeasurements.map(d=>({time:Date.parse(d.timestamp),value:espValue(d,key)})).filter(p=>Number.isFinite(p.time)&&p.value!==null&&p.time>=start&&p.time<=end).sort((a,b)=>a.time-b.time);}
function espLatest(key){return espPoints(key).at(-1);}
async function loadEspHistory(){
 if(!apiBase){espMeasurements=[];render();return;}
 try{const response=await probe('/api/devices/ESP32-001/history?hours=168',20000);if(!Array.isArray(response.measurements))throw Error('Neplatna historia');espMeasurements=response.measurements;espLoadError=false;}
 catch(e){espLoadError=true;console.warn('ESP32 history:',e);}
 render();if(!alertLoading&&espMeasurements.length)alertChecked=true;renderAlerts();
}

const fmt=(v,p=1)=>v.toLocaleString('sk-SK',{minimumFractionDigits:p,maximumFractionDigits:p});
const timeLabel=(t,full=false)=>new Intl.DateTimeFormat('sk-SK',{timeZone:'Europe/Bratislava',...(full?{day:'2-digit',month:'2-digit',year:'numeric'}:{}),hour:'2-digit',minute:'2-digit'}).format(new Date(t));
const latest=key=>liveData?.measurements[key]?.points.filter(p=>p.value!==null).at(-1);
function visiblePoints(key){return(liveData?.measurements[key]?.points||[]).filter(p=>p.time>=timeWindow().start&&p.time<=timeWindow().end);}
function render(){
 window.monitorChart.reset();
 document.getElementById('metrics').innerHTML=primaryMetrics.map(key=>{const [name,unit,p]=metricDefs[key],point=latest(key);return `<button class="metric ${key===selectedMetric?'selected':''}" data-metric="${key}" aria-pressed="${key===selectedMetric}"><span class="metrichead">${name}</span><span class="metricvalue">${point?fmt(point.value,p):'—'} <small>${unit}</small></span><span class="comparison"><b>SmartŽilina · ${stationName()}</b></span><span class="delta" style="display:block">${point?timeLabel(point.time,true):loading?'Načítavam…':key==='noiseLevel'?'Zdroj neposkytuje hluk':'Bez dostupných údajov'}</span><span class="own-pending">${espLatest(key)?'ESP32: '+fmt(espLatest(key).value,p)+' '+unit+(point?' · rozdiel: '+fmt(espLatest(key).value-point.value,p)+' '+unit:''):'ESP32: bez dát · rozdiel: —'}</span></button>`}).join('');
 const picker=document.getElementById('chart-metric');picker.innerHTML=Object.entries(metricDefs).filter(([key])=>primaryMetrics.includes(key)||liveData?.measurements[key]||espMeasurements.some(d=>espValue(d,key)!==null)).map(([key,[name]])=>`<option value="${key}">${name}</option>`).join('');picker.value=selectedMetric;
 const [name,unit,precision]=metricDefs[selectedMetric];document.getElementById('chart-title').textContent=name;document.getElementById('chart-unit').textContent=`${name} (${unit})`;document.getElementById('legend-station').textContent='SmartŽilina · '+stationName();
 document.getElementById('station-source').href='https://smart.zilina.sk/environment?do=dataHistory&itemId='+selectedStation;
 const points=chartSource==='esp'?[]:visiblePoints(selectedMetric),valid=points.filter(p=>p.value!==null),own=chartSource==='smart'?[]:espPoints(selectedMetric),svg=document.getElementById('chart');
 const all=[...valid,...own];
 if(!all.length){svg.innerHTML='<text x="500" y="135" text-anchor="middle">'+(loading?'Načítavam merania…':'Pre vybrané obdobie nie sú dostupné merania.')+'</text>';window.monitorChart.update([],{name,unit,station:stationName(),maxDistance:0});}
 else{
  let lo=Math.min(...all.map(p=>p.value)),hi=Math.max(...all.map(p=>p.value));const pad=Math.max((hi-lo)*.15,.5);lo-=pad;hi+=pad;
  const {start:begin,end}=timeWindow(),x=t=>54+(t-begin)/(end-begin)*920,y=v=>232-(v-lo)/(hi-lo)*206;
  let grid='';for(let i=0;i<5;i++){const val=lo+(hi-lo)*i/4;grid+=`<line x1="54" y1="${y(val)}" x2="974" y2="${y(val)}" stroke="#edf0f6"/><text x="43" y="${y(val)+4}" text-anchor="end">${fmt(val,hi-lo<10?1:0)}</text>`;}
  for(let i=0;i<7;i++){const t=begin+(end-begin)*i/6;const label=end-begin<=86400000?timeLabel(t):new Intl.DateTimeFormat('sk-SK',{timeZone:'Europe/Bratislava',day:'numeric',month:'numeric'}).format(t);grid+=`<text x="${x(t)}" y="269" text-anchor="middle">${label}</text>`;}
  function pathFor(arr,limit){let path='',prev=null;for(const pt of arr){if(pt.value===null){prev=null;continue;}path+=`${prev&&pt.time-prev.time<=limit?'L':'M'}${x(pt.time).toFixed(2)},${y(pt.value).toFixed(2)} `;prev=pt;}return path;}
  svg.innerHTML=`<desc id="chart-desc">${name}. SmartŽilina ${valid.length} meraní, ESP32 ${own.length} meraní.</desc>${grid}<path d="${pathFor(points,5400000)}" fill="none" stroke="#139d91" stroke-width="2.5" stroke-linejoin="round"/><path d="${pathFor(own,180000)}" fill="none" stroke="#2e5bff" stroke-width="2.5" stroke-linejoin="round"/>`;
  window.monitorChart.update([...valid.map(point=>({...point,x:x(point.time),y:y(point.value),source:'SmartŽilina'})),...own.map(point=>({...point,x:x(point.time),y:y(point.value),source:'ESP32'}))].sort((a,b)=>a.time-b.time),{name,unit,station:stationName(),maxDistance:920/(end-begin)*2700000});
 }
 const stats=[['Priemer',a=>a.reduce((s,v)=>s+v,0)/a.length],['Minimum',a=>Math.min(...a)],['Maximum',a=>Math.max(...a)]];
 document.getElementById('summary').innerHTML=stats.map(([label,fn])=>`<tr><td>${label}</td><td>${own.length?fmt(fn(own.map(p=>p.value)),precision)+' '+unit:'—'}</td><td>${valid.length?fmt(fn(valid.map(p=>p.value)),precision)+' '+unit:'—'}</td></tr>`).join('');
 document.querySelector('.legend .blue').parentElement.lastChild.textContent='ESP32 · '+(own.length?own.length+' meraní':'bez dát');
 const p=customRange?'Vlastný rozsah':period+' hodín';document.getElementById('summary-period').textContent=p;document.getElementById('period-caption').textContent=`${p} · ESP32: ${own.length} · Smart Žilina: ${valid.length} · čas Bratislava`; 
 document.querySelectorAll('[data-period]').forEach(button=>{const on=!customRange&&+button.dataset.period===period;button.classList.toggle('active',on);button.setAttribute('aria-pressed',on);});
}
function renderStatus(){const status=document.getElementById('live-status');status.classList.toggle('ota-error',loadFailed);const newest=liveData?Math.max(...Object.keys(liveData.measurements).map(k=>latest(k)?.time||0)):0;if(loading)status.textContent='Načítavam merania: '+stationName()+'…';else if(loadFailed)status.textContent=liveData?`Obnovenie zlyhalo. Zobrazené sú posledné načítané dáta z ${timeLabel(liveData.fetchedAt,true)}.`:'SmartŽilina je momentálne nedostupná. Skús obnoviť dáta.';else status.textContent=`${stationName()} · posledné meranie ${timeLabel(newest,true)}${Date.now()-newest>3*3600000?' · údaje sú staršie než 3 hodiny':''}. Automatická kontrola každých 5 minút.`;}
async function loadMeasurements(){
 activeRequest?.abort();const controller=new AbortController();activeRequest=controller;
 const generation=++requestGeneration,stationId=selectedStation;
 loading=true;document.getElementById('refresh-data').disabled=true;render();renderStatus();
 const timeout=setTimeout(()=>controller.abort(),25000);
 try{
  const response=await fetch(apiUrl('/api/smartzilina?station='+encodeURIComponent(stationId)),{signal:controller.signal});
  if(!response.ok)throw Error('Unavailable');const data=await response.json();
  if(data.station?.id!==stationId||!data.measurements||!Object.keys(data.measurements).length)throw Error('Invalid data');
  if(generation!==requestGeneration)return;
  liveData=data;loadFailed=false;
  if(!primaryMetrics.includes(selectedMetric)&&!liveData.measurements[selectedMetric])selectedMetric='airTemperature';
 }catch{if(generation===requestGeneration)loadFailed=true;}
 finally{clearTimeout(timeout);if(generation===requestGeneration){loading=false;activeRequest=null;document.getElementById('refresh-data').disabled=false;render();renderStatus();}}
}
const stationPicker=document.getElementById('station');
stationPicker.replaceChildren(...stationDefs.map(station=>{const option=document.createElement('option');option.value=station.id;option.textContent=station.name;return option;}));
stationPicker.value=selectedStation;
stationPicker.addEventListener('change',()=>{
 selectedStation=stationPicker.value;liveData=null;loadFailed=false;
 if(!primaryMetrics.includes(selectedMetric))selectedMetric='airTemperature';
 loadMeasurements();
});
document.getElementById('metrics').addEventListener('click',event=>{const button=event.target.closest('[data-metric]');if(button){selectedMetric=button.dataset.metric;render();document.querySelector(`[data-metric="${selectedMetric}"]`).focus({preventScroll:true});}});
document.getElementById('chart-metric').addEventListener('change',event=>{selectedMetric=event.target.value;render();});
document.querySelectorAll('[data-period]').forEach(button=>button.addEventListener('click',()=>{customRange=null;period=+button.dataset.period;document.getElementById('range-notice').textContent='';render();}));
document.querySelectorAll('[data-source]').forEach(button=>button.addEventListener('click',()=>{chartSource=button.dataset.source;document.querySelectorAll('[data-source]').forEach(b=>{const active=b===button;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});render();}));
document.getElementById('apply-range').addEventListener('click',()=>{const start=Date.parse(document.getElementById('range-start').value),end=Date.parse(document.getElementById('range-end').value);const notice=document.getElementById('range-notice');if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end){notice.textContent='Zadaj platný začiatok a koniec obdobia.';return;}customRange={start,end};notice.textContent='Zobrazené budú dostupné merania v zadanom intervale. API momentálne poskytuje najviac 7 dní histórie.';render();});
document.getElementById('reset-range').addEventListener('click',()=>{customRange=null;document.getElementById('range-start').value='';document.getElementById('range-end').value='';document.getElementById('range-notice').textContent='';render();});
document.getElementById('refresh-data').addEventListener('click',loadMeasurements);


// Upozornenia vychádzajú z posledných dostupných meraní, nie zo simulácie.
// Limity sú orientačné a dajú sa upraviť v tomto objekte; nejde o právne limity.
const alertThresholds={
 airTemperature:{max:30},airHumidity:{max:70},noiseLevel:{max:75},
 airPm25:{max:35},airPm10:{max:50},airPm1:{max:25},airPm4:{max:40},
 windSpeed:{max:15},windImpact:{max:20},rainGauge:{max:10},
 co2:{max:1500},tvoc:{max:500}
};
const alertNames={co2:['eCO₂','ppm',0],tvoc:['TVOC','ppb',0]};
const alertEspFields={co2:['ccs811_eco2','eco2','co2'],tvoc:['ccs811_tvoc','tvoc']};
let alertStationData=new Map(),alertLoading=false,alertChecked=false;
const alertMaxAge=3*60*60*1000;
function alertAdd(result,source,key,value,time,stationId=null){
 const rule=alertThresholds[key];if(!rule||!Number.isFinite(value)||!Number.isFinite(time))return;
 if(time>Date.now()+5*60000||Date.now()-time>alertMaxAge)return;
 if(rule.max!==undefined&&value>rule.max){const def=metricDefs[key]||alertNames[key];if(!def)return;
  result.push({source,stationId,name:def[0],value,unit:def[1],limit:rule.max,time,excess:(value-rule.max)/Math.max(rule.max,1)});
 }
}
function latestAlertPoint(data,key){
 const points=data?.measurements?.[key]?.points;if(!Array.isArray(points))return null;
 let best=null;for(const p of points){const t=typeof p.time==='number'?p.time:Date.parse(p.time);const v=Number(p.value);if(p.value===null||p.value===''||!Number.isFinite(v)||!Number.isFinite(t))continue;if(!best||t>best.time)best={value:v,time:t};}return best;
}
function renderAlerts(){
 const panel=document.getElementById('alert-center'),grid=document.getElementById('alert-cards'),more=document.getElementById('alert-more');if(!panel)return;
 const alerts=[];
 for(const station of stationDefs){const data=alertStationData.get(station.id);if(!data)continue;
  for(const key of Object.keys(alertThresholds)){const point=latestAlertPoint(data,key);if(point)alertAdd(alerts,'Smart Žilina · '+station.name,key,point.value,point.time,station.id);}
 }
 // Z ESP32 vyberáme vždy posledné meranie pre daný senzor, aj keď sa v medzičase iné senzory nezmenili.
 for(const key of Object.keys(alertThresholds)){
  let best=null;const fields=alertEspFields[key];
  for(const row of espMeasurements){const time=Date.parse(row.timestamp);if(!Number.isFinite(time))continue;
   let value=null;if(fields){for(const field of fields){if(row[field]!==undefined&&row[field]!==null&&row[field]!==''&&Number.isFinite(Number(row[field]))){value=Number(row[field]);break;}}}else value=espValue(row,key);
   if(value!==null&&(!best||time>best.time))best={value,time};
  }if(best)alertAdd(alerts,'ESP32 · vlastný senzor',key,best.value,best.time,'esp32');
 }
 alerts.sort((a,b)=>b.excess-a.excess||b.time-a.time);
 panel.classList.toggle('has-alerts',alerts.length>0);
 document.getElementById('alert-count').textContent=alerts.length?String(alerts.length):'✓';
 document.getElementById('alert-title').textContent=alerts.length?alerts.length===1?'1 zvýšená hodnota':alerts.length+' zvýšených hodnôt':'Prostredie pod kontrolou';
 document.getElementById('alert-caption').textContent=alerts.length?'Zaznamenali sme prekročenie orientačných hraníc.':'Automatická kontrola ESP32 a staníc Smart Žilina';
 const previousScroll=grid.scrollLeft;grid.replaceChildren();
 if(!alerts.length){const d=document.createElement('div');d.className=alertChecked?'alert-ok':'alert-wait';d.textContent=alertLoading?'Kontrolujem stanice…':!apiBase?'Pripoj Cloudflare Tunnel na kontrolu meraní.':!alertChecked?'Údaje zatiaľ nie sú dostupné – nemožno vyhodnotiť limity.':'Žiadne zvýšené hodnoty z dostupných čerstvých meraní.';grid.append(d);}
 else for(const a of alerts){const item=document.createElement('article');item.className='alert-card severity-'+alertSeverity(a);const label=document.createElement('div');label.className='alert-card-label';label.textContent=a.name;const amount=document.createElement('strong');amount.textContent=a.value.toLocaleString('sk-SK',{maximumFractionDigits:2})+' '+a.unit;const where=document.createElement('div');where.className='where';where.textContent=a.source;const details=document.createElement('div');details.className='details';details.textContent='Hranica: '+a.limit.toLocaleString('sk-SK')+' '+a.unit+' · '+timeLabel(a.time,true);const btn=document.createElement('button');btn.type='button';btn.className='alert-detail-btn';btn.textContent='Podrobnosti';btn.addEventListener('click',()=>openAlertDetail(a));item.append(label,amount,where,details,btn);grid.append(item);}
 grid.scrollLeft=alerts.length?previousScroll:0;requestAnimationFrame(updateAlertArrows);

}
async function loadAlertStations(){
 if(!apiBase){alertStationData.clear();alertChecked=false;renderAlerts();return;}
 alertLoading=true;renderAlerts();
 const base=apiBase;
 // Limit paralelných požiadaviek: iba tri naraz.
 const queue=[...stationDefs];const updates=new Map();
 await Promise.all(Array.from({length:3},async()=>{while(queue.length){const st=queue.shift();try{const data=await probe('/api/smartzilina?station='+encodeURIComponent(st.id),16000);if(base===apiBase&&data.station?.id===st.id&&data.measurements)updates.set(st.id,data);}catch{}}}));
 if(base!==apiBase)return;
 alertStationData=updates;alertLoading=false;alertChecked=updates.size>0||espMeasurements.length>0;renderAlerts();
}
const alertTrack=document.getElementById('alert-cards');
function updateAlertArrows(){const hasOverflow=alertTrack.scrollWidth>alertTrack.clientWidth+3;const max=Math.max(0,alertTrack.scrollWidth-alertTrack.clientWidth);document.getElementById('alert-prev').disabled=!hasOverflow||alertTrack.scrollLeft<3;document.getElementById('alert-next').disabled=!hasOverflow||alertTrack.scrollLeft>=max-3;const count=alertTrack.querySelectorAll('.alert-card').length;document.getElementById('alert-position').textContent=hasOverflow?`${count} výstrah · posúvaj šípkami alebo potiahnutím`:'';}
function slideAlerts(direction){const card=alertTrack.querySelector('.alert-card');alertTrack.scrollBy({left:direction*(card?card.getBoundingClientRect().width+12:260),behavior:'smooth'});}
document.getElementById('alert-prev').addEventListener('click',()=>slideAlerts(-1));
document.getElementById('alert-next').addEventListener('click',()=>slideAlerts(1));
alertTrack.addEventListener('scroll',updateAlertArrows,{passive:true});window.addEventListener('resize',updateAlertArrows);
const alertCoords={
 '651ebcc63d55d70001ff67ba':[49.2075,18.7650],
 '651ebcc63d55d70001ff67bc':[49.2188,18.7508],
 '651ebcc63d55d70001ff67c5':[49.2146,18.7464],
 '651ebcc63d55d70001ff67be':[49.2256,18.7442],
 '651ebcc63d55d70001ff67bb':[49.2227,18.7383],
 '651ebcc63d55d70001ff67b9':[49.2300,18.7040],
 '651ebcc63d55d70001ff67bd':[49.2620,18.7390]
};
const alertDialog=document.getElementById('alert-dialog');let alertMiniMap=null;
// Závažnosť je len relatívna miera prekročenia nastavenej orientačnej hranice.
function alertSeverity(a){const ratio=(a.value-a.limit)/Math.max(Math.abs(a.limit),1);return ratio>=0.5?'high':ratio>=0.2?'medium':'low';}

function openAlertDetail(a){
 document.getElementById('alert-dialog-title').textContent=a.name+' · '+a.source;
 document.getElementById('alert-dialog').dataset.severity=alertSeverity(a);
 const stats=document.getElementById('alert-dialog-stats');stats.replaceChildren();
 const fields=[['Nameraná hodnota',a.value.toLocaleString('sk-SK',{maximumFractionDigits:2})+' '+a.unit],['Orientačná hranica',a.limit.toLocaleString('sk-SK')+' '+a.unit],['Prekročenie', (a.value-a.limit).toLocaleString('sk-SK',{maximumFractionDigits:2})+' '+a.unit],['Čas merania',timeLabel(a.time,true)]];
 for(const [name,value] of fields){const cell=document.createElement('div');cell.className='alert-dialog-stat';const small=document.createElement('span');small.textContent=name;const strong=document.createElement('strong');strong.textContent=value;cell.append(small,strong);stats.append(cell);}
 let coords=alertCoords[a.stationId]||null;let approximate=true;
 if(a.stationId==='esp32'){
  let latestGps=null;for(const measurement of espMeasurements){const lat=Number(measurement.latitude),lon=Number(measurement.longitude),time=Date.parse(measurement.timestamp);if(measurement.latitude!=null&&measurement.longitude!=null&&Number.isFinite(lat)&&Number.isFinite(lon)&&Number.isFinite(time)&&Math.abs(lat)<=90&&Math.abs(lon)<=180&&(lat!==0||lon!==0)&&(!latestGps||time>latestGps.time))latestGps={lat,lon,time};}
  if(latestGps){coords=[latestGps.lat,latestGps.lon];approximate=false;}else coords=[49.223831,18.738880];
 }
 document.getElementById('alert-map-note').textContent=approximate?'Poloha je orientačná, nie overené GPS súradnice.':'GPS poloha nahlásená zariadením.';
 const mapBox=document.getElementById('alert-mini-map');
 mapBox.replaceChildren();
 // OpenStreetMap poskytuje priamo vloženú interaktívnu mapu so svojimi štýlmi.
 // Nespoliehame sa na Leaflet v hlavnej stránke, ktorý tu spôsoboval rozbité dlaždice.
 if(!coords || !Number.isFinite(coords[0]) || !Number.isFinite(coords[1])){
  mapBox.textContent='Poloha stanice nie je dostupná.';
 }else{
  const [lat,lon]=coords;
  const latSpan=0.012,lonSpan=0.020;
  const bbox=[lon-lonSpan,lat-latSpan,lon+lonSpan,lat+latSpan].join(',');
  const iframe=document.createElement('iframe');
  iframe.title='Poloha stanice na mape OpenStreetMap';
  iframe.setAttribute('loading','eager');
  iframe.setAttribute('referrerpolicy','no-referrer-when-downgrade');
  iframe.setAttribute('allowfullscreen','');
  iframe.src='https://www.openstreetmap.org/export/embed.html?bbox='+encodeURIComponent(bbox)+'&layer=mapnik&marker='+encodeURIComponent(lat+','+lon);
  mapBox.appendChild(iframe);
 }
 alertDialog.showModal();
}
function closeAlertDetail(){alertDialog.close();}
document.getElementById('alert-dialog-close').addEventListener('click',closeAlertDetail);
alertDialog.addEventListener('click',e=>{if(e.target===alertDialog)closeAlertDetail();});

// UI-only server upload and per-device approval. No real upload or installation.
const firmwareInput=document.getElementById('firmware');
const otaStart=document.getElementById('ota-start');
const otaCancel=document.getElementById('ota-cancel');
const otaMessage=document.getElementById('ota-message');
const otaApprove=document.getElementById('ota-approve');
const otaRevoke=document.getElementById('ota-revoke');
const otaReleases=new Map();
let otaTimer=null;
function validateFirmware(file){if(!file)return 'Nie je vybraný žiadny súbor.';if(!file.name.toLowerCase().endsWith('.bin'))return 'Vyber súbor firmvéru s príponou .bin.';if(file.size===0)return 'Súbor je prázdny. Vyber platný firmvér.';return null;}
function renderApproval(){
 const release=otaReleases.get(selectedOtaDevice);
 const current=otaDevices[selectedOtaDevice].currentFirmware;
 document.getElementById('current-firmware').textContent=current?.name||'Neznámy — čaká na údaje zo servera';
 document.getElementById('current-version').textContent='Verzia: '+(current?.version||'neznáma');
 document.getElementById('release-version').textContent='Verzia: '+(release?.version||'neznáma');
 document.getElementById('release-file').textContent=release?release.name+' · '+(release.size/1024).toLocaleString('sk-SK',{maximumFractionDigits:1})+' kB':'Zatiaľ nie je dostupný';
 document.getElementById('release-status').hidden=!release;
 document.getElementById('release-status').textContent=!release?'':release.approved?'Povolené · čaká na kontrolu ESP32 (simulácia)':'Pripravené · inštalácia nepovolená (simulácia)';
 otaApprove.disabled=!release||release.approved||otaTimer!==null||!isDemoAdmin;
 otaRevoke.hidden=!release?.approved;otaRevoke.disabled=otaTimer!==null||!isDemoAdmin;
 document.getElementById('approval-message').textContent=release?.approved?'Pri nasledujúcom meraní by si táto stanica mohla stiahnuť a nainštalovať povolený firmvér. Inštalácia zatiaľ nie je potvrdená.':'Povolenie platí iba pre konkrétny firmvér a vybrané zariadenie.';
}
firmwareInput.addEventListener('change',()=>{const file=firmwareInput.files[0],error=validateFirmware(file);otaStart.disabled=!!error;const info=document.getElementById('firmware-info');info.classList.toggle('ota-error',!!file&&!!error);info.textContent=error||`${file.name} · ${(file.size/1024).toLocaleString('sk-SK',{maximumFractionDigits:1})} kB`;document.getElementById('ota-progress-wrap').hidden=true;otaMessage.textContent='Výber súboru nič nemení. Dokončené nahratie nového firmvéru bude vyžadovať nové povolenie.';});
function endOta(message){clearInterval(otaTimer);otaTimer=null;firmwareInput.disabled=false;document.getElementById('firmware-version').disabled=false;document.getElementById('ota-device').disabled=false;otaStart.disabled=!!validateFirmware(firmwareInput.files[0]);otaCancel.hidden=true;otaMessage.textContent=message;renderApproval();}
document.getElementById('ota-form').addEventListener('submit',event=>{
 event.preventDefault();const file=firmwareInput.files[0];if(!isDemoAdmin||otaTimer!==null||validateFirmware(file))return;
 const target=selectedOtaDevice;
 const version=document.getElementById('firmware-version').value.trim();
 document.getElementById('firmware-version').disabled=true;
 firmwareInput.disabled=true;document.getElementById('ota-device').disabled=true;otaStart.disabled=true;otaCancel.hidden=false;otaApprove.disabled=true;otaRevoke.disabled=true;
 document.getElementById('ota-progress-wrap').hidden=false;let value=0;
 const update=()=>{document.getElementById('ota-progress').value=value;document.getElementById('ota-percent').textContent=`${value} %`;document.getElementById('ota-stage').textContent=value<100?'Simulácia · nahrávanie na server':'Simulácia uloženia dokončená';};update();
 otaMessage.textContent=`Simulácia nahrávania pre ${otaDevices[target].name}. Súbor sa nikam neodosiela.`;
 otaTimer=setInterval(()=>{value=Math.min(value+10,100);update();if(value===100){otaReleases.set(target,{name:file.name,size:file.size,version:version||null,approved:false});firmwareInput.value='';document.getElementById('firmware-info').textContent='Nie je vybraný žiadny súbor.';endOta('Firmvér je v ukážke pripravený. Inštalácia zostáva nepovolená, kým ju samostatne nepovolíš.');}},200);
});
otaCancel.addEventListener('click',()=>{endOta('Nahrávanie zrušené. Predchádzajúci firmvér a jeho povolenie zostali nezmenené.');document.getElementById('ota-stage').textContent='Nahrávanie zrušené';});
otaApprove.addEventListener('click',()=>{const release=otaReleases.get(selectedOtaDevice);if(!isDemoAdmin||otaTimer!==null||!release)return;release.approved=true;renderApproval();});
otaRevoke.addEventListener('click',()=>{const release=otaReleases.get(selectedOtaDevice);if(!isDemoAdmin||otaTimer!==null||!release)return;release.approved=false;renderApproval();document.getElementById('approval-message').textContent='Povolenie zrušené (simulácia). V reálnej prevádzke to nezastaví inštaláciu, ktorú už zariadenie začalo.';});
// Prihlasovanie je riadene auth-gate.js a overovane cez Raspberry Pi.
let isDemoAdmin=false;
function showSection(ota){
 ota=Boolean(ota&&isDemoAdmin);
 document.getElementById('overview-panel').hidden=ota;
 document.getElementById('ota-panel').hidden=!ota;
 for(const [id,on] of [['overview-tab',!ota],['ota-tab',ota]]){
  const tab=document.getElementById(id);tab.classList.toggle('active',on);
  if(on)tab.setAttribute('aria-current','page');else tab.removeAttribute('aria-current');
 }
}
function setDemoAdmin(on){
 isDemoAdmin=Boolean(on);
 document.getElementById('ota-tab').hidden=!on;
 document.getElementById('logout').hidden=!on;
 document.getElementById('account-name').hidden=!on;
 document.getElementById('login-open').hidden=on;
 showSection(false);renderApproval();
}
document.getElementById('overview-tab').addEventListener('click',()=>showSection(false));
document.getElementById('ota-tab').addEventListener('click',()=>showSection(true));
document.getElementById('logout').addEventListener('click',()=>{
 if(otaTimer)endOta('Simulácia zrušená odhlásením. Zariadenie sa nezmenilo.');
 document.getElementById('ota-form').reset();
 document.getElementById('ota-progress-wrap').hidden=true;
 document.getElementById('firmware-info').textContent='Nie je vybraný žiadny súbor.';
 otaStart.disabled=true;setDemoAdmin(false);
});
const otaDevices={
 'esp32-01':{name:'Meteostanica 1 · ESP32-01',connection:'SIM800C / GPRS',currentFirmware:null},
 'esp32-02':{name:'Meteostanica 2 · ESP32-02',connection:'SIM800C / GPRS',currentFirmware:null},
 'esp32-03':{name:'Meteostanica 3 · ESP32-03',connection:'SIM800C / GPRS',currentFirmware:null}
};
let selectedOtaDevice='esp32-01';
document.getElementById('ota-device').addEventListener('change',event=>{
 const device=otaDevices[event.target.value];
 if(otaTimer||!device){event.target.value=selectedOtaDevice;return;}
 selectedOtaDevice=event.target.value;
 document.getElementById('ota-device-name').textContent=device.name;
 document.getElementById('ota-device-connection').textContent=device.connection;
 firmwareInput.value='';document.getElementById('firmware-version').value='';otaStart.disabled=true;
 document.getElementById('firmware-info').textContent='Nie je vybraný žiadny súbor.';
 document.getElementById('firmware-info').classList.toggle('ota-error',false);
 document.getElementById('ota-progress-wrap').hidden=true;
 otaMessage.textContent=`Vybrané zariadenie: ${device.name}. Nahraj firmvér na server a potom samostatne povoľ jeho inštaláciu.`;
 renderApproval();
});
if(document.modelContext?.registerTool){try{Promise.resolve(document.modelContext.registerTool({name:'configure_measurement_view',description:'Choose a measured quantity and 24-hour or 7-day view of the SmartŽilina station data.',inputSchema:{type:'object',properties:{metric:{type:'string',enum:Object.keys(metricDefs)},hours:{type:'integer',enum:[24,168]}},required:['metric','hours'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){if(!input||!Object.hasOwn(metricDefs,input.metric)||![24,168].includes(input.hours))throw Error('Invalid view');if(!primaryMetrics.includes(input.metric)&&!liveData?.measurements[input.metric])throw Error('Measurement unavailable');selectedMetric=input.metric;period=input.hours;render();return{metric:selectedMetric,hours:period,points:visiblePoints(selectedMetric).filter(p=>p.value!==null).length}}})).catch(()=>{});}catch{}}

setDemoAdmin(false);
// Spustenie až po inicializácii stavov výstrah a OTA ovládania.
render();
renderAlerts();
loadMeasurements();
loadEspHistory();
loadAlertStations();
setInterval(()=>{if(!document.hidden){loadMeasurements();loadEspHistory();loadAlertStations();}},300000);
