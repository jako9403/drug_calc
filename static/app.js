/* Drug Half-Life Calculator — front-end logic v3 */
(() => {
  "use strict";
  const STORAGE_KEY = "drugCalcDoseLog", DISCLAIMER_KEY = "drugCalcDisclaimer";
  const COLORS = [
    {line:"#4f6ef7",bg:"rgba(79,110,247,0.15)"},{line:"#e74694",bg:"rgba(231,70,148,0.15)"},
    {line:"#f59e0b",bg:"rgba(245,158,11,0.15)"},{line:"#10b981",bg:"rgba(16,185,129,0.15)"},
    {line:"#8b5cf6",bg:"rgba(139,92,246,0.15)"},{line:"#ef4444",bg:"rgba(239,68,68,0.15)"},
    {line:"#06b6d4",bg:"rgba(6,182,212,0.15)"},{line:"#f97316",bg:"rgba(249,115,22,0.15)"},
  ];
  const $=id=>document.getElementById(id);
  const drugSearch=$("drug-search"),drugSelect=$("drug-select"),drugInfo=$("drug-info"),
    drugCategory=$("drug-category"),drugHalflife=$("drug-halflife"),drugHlRange=$("drug-hl-range"),
    drugTypicalDose=$("drug-typical-dose"),drugMaxDaily=$("drug-max-daily"),
    drugNotes=$("drug-notes"),drugSources=$("drug-sources"),
    doseInput=$("dose-input"),calcBtn=$("calculate-btn"),takeDoseBtn=$("take-dose-btn"),
    placeholder=$("chart-placeholder"),statsDiv=$("stats"),
    timelinePlaceholder=$("timeline-placeholder"),legendDiv=$("legend"),
    doseLogBody=$("dose-log-body"),doseLogEmpty=$("dose-log-empty"),
    doseTableWrap=$("dose-table-wrap"),clearLogBtn=$("clear-log-btn"),
    weightInput=$("weight-input"),ageInput=$("age-input"),genderSelect=$("gender-select"),
    adjPreview=$("adj-preview"),doseTimeInput=$("dose-time-input"),
    doseTimeNowBtn=$("dose-time-now-btn"),scheduleSelect=$("schedule-select"),
    scheduleCount=$("schedule-count"),showRangeCb=$("show-range-cb"),
    saveStatus=$("save-status"),exportCsvBtn=$("export-csv-btn"),exportJsonBtn=$("export-json-btn"),
    customDrugBtn=$("custom-drug-btn"),customDrugModal=$("custom-drug-modal"),
    cdName=$("cd-name"),cdHalflife=$("cd-halflife"),cdDose=$("cd-dose"),
    cdHlMin=$("cd-hl-min"),cdHlMax=$("cd-hl-max"),cdCategory=$("cd-category"),
    cdAdd=$("cd-add"),cdCancel=$("cd-cancel"),
    disclaimerOverlay=$("disclaimer-overlay"),disclaimerAccept=$("disclaimer-accept"),
    disclaimerContinue=$("disclaimer-continue");

  let drugs={},decayChart=null,timelineChart=null,doseLog=[],colorIndex=0,timerInterval=null,lastCalcData=null;

  // Disclaimer
  if(localStorage.getItem(DISCLAIMER_KEY)==="accepted") disclaimerOverlay.classList.add("hidden");
  disclaimerAccept.addEventListener("change",()=>{disclaimerContinue.disabled=!disclaimerAccept.checked;});
  disclaimerContinue.addEventListener("click",()=>{localStorage.setItem(DISCLAIMER_KEY,"accepted");disclaimerOverlay.classList.add("hidden");});

  // Init
  setNow();
  fetch("/api/drugs").then(r=>r.json()).then(data=>{drugs=data;populateSelect("");restoreLog();});
  function setNow(){const d=new Date();d.setMinutes(d.getMinutes()-d.getTimezoneOffset());doseTimeInput.value=d.toISOString().slice(0,16);}
  doseTimeNowBtn.addEventListener("click",setNow);

  // Search
  function populateSelect(f){const lc=f.toLowerCase();drugSelect.innerHTML='<option value="" disabled selected>Choose a drug…</option>';for(const[k,d]of Object.entries(drugs)){if(lc&&!d.name.toLowerCase().includes(lc)&&!k.includes(lc)&&!(d.category||"").toLowerCase().includes(lc))continue;const o=document.createElement("option");o.value=k;o.textContent=d.name;drugSelect.appendChild(o);}}
  drugSearch.addEventListener("input",()=>{populateSelect(drugSearch.value.trim());const opts=drugSelect.querySelectorAll("option:not([disabled])");if(opts.length===1){drugSelect.value=opts[0].value;drugSelect.dispatchEvent(new Event("change"));}});

  // Custom drug
  customDrugBtn.addEventListener("click",()=>customDrugModal.classList.remove("hidden"));
  cdCancel.addEventListener("click",()=>customDrugModal.classList.add("hidden"));
  cdAdd.addEventListener("click",()=>{
    const name=cdName.value.trim(),hl=parseFloat(cdHalflife.value),dose=parseFloat(cdDose.value);
    if(!name||!hl||hl<=0||!dose||dose<=0){alert("Name, half-life, and dose are required.");return;}
    const key="custom_"+Date.now(),hlMin=parseFloat(cdHlMin.value)||null,hlMax=parseFloat(cdHlMax.value)||null;
    drugs[key]={name,half_life_hr:hl,typical_dose_mg:dose,max_daily_mg:0,category:cdCategory.value.trim()||"Custom",notes:"User-defined drug.",sources:[],hl_range_hr:(hlMin&&hlMax)?[hlMin,hlMax]:null,adjustments:{elderly_hl_mult:1,pediatric_hl_mult:1,female_hl_mult:1,male_hl_mult:1,weight_based:false,ref_weight_kg:70}};
    populateSelect("");drugSelect.value=key;drugSelect.dispatchEvent(new Event("change"));customDrugModal.classList.add("hidden");
    cdName.value="";cdHalflife.value="";cdDose.value="";cdHlMin.value="";cdHlMax.value="";cdCategory.value="";
  });

  // Profile
  function getProfile(){return{weight_kg:parseFloat(weightInput.value)||null,age:parseInt(ageInput.value,10)||null,gender:genderSelect.value||null};}
  function adjustedHalfLife(d){let hl=d.half_life_hr;const adj=d.adjustments,p=getProfile(),n=[];if(!adj)return{hl,notes:n};
    if(p.age!=null){if(p.age>=65&&adj.elderly_hl_mult!==1.0){hl*=adj.elderly_hl_mult;n.push("Age ≥65: t½ ×"+adj.elderly_hl_mult);}else if(p.age<18&&adj.pediatric_hl_mult!==1.0){hl*=adj.pediatric_hl_mult;n.push("Age <18: t½ ×"+adj.pediatric_hl_mult);}}
    if(p.gender==="female"&&adj.female_hl_mult!==1.0){hl*=adj.female_hl_mult;n.push("Female: t½ ×"+adj.female_hl_mult);}else if(p.gender==="male"&&adj.male_hl_mult!==1.0){hl*=adj.male_hl_mult;n.push("Male: t½ ×"+adj.male_hl_mult);}
    if(adj.weight_based&&adj.dose_per_kg&&p.weight_kg)n.push("Weight dose: ~"+Math.round(adj.dose_per_kg*p.weight_kg)+" mg ("+adj.dose_per_kg+" mg/kg)");
    return{hl:Math.round(hl*1000)/1000,notes:n};}
  function updateAdjPreview(){const k=drugSelect.value;if(!k||!drugs[k]){adjPreview.classList.add("hidden");return;}const{hl,notes}=adjustedHalfLife(drugs[k]);if(!notes.length){adjPreview.classList.add("hidden");return;}adjPreview.classList.remove("hidden");adjPreview.innerHTML='<strong>Adjusted t½: '+fmtH(hl)+'</strong><span class="adj-base">(base: '+fmtH(drugs[k].half_life_hr)+')</span><ul>'+notes.map(n=>'<li>'+n+'</li>').join('')+'</ul>';}
  weightInput.addEventListener("input",updateAdjPreview);ageInput.addEventListener("input",updateAdjPreview);genderSelect.addEventListener("change",updateAdjPreview);

  // Drug select
  drugSelect.addEventListener("change",()=>{const d=drugs[drugSelect.value];if(!d)return;
    drugCategory.textContent=d.category||"";drugHalflife.textContent=fmtH(d.half_life_hr);
    drugHlRange.textContent=d.hl_range_hr?fmtH(d.hl_range_hr[0])+" – "+fmtH(d.hl_range_hr[1]):"—";
    drugTypicalDose.textContent=d.typical_dose_mg+" mg";drugMaxDaily.textContent=d.max_daily_mg?d.max_daily_mg+" mg":"—";
    drugNotes.textContent=d.notes||"";
    drugSources.innerHTML=(d.sources&&d.sources.length)?'<span class="info-label">Sources:</span> '+d.sources.map(s=>'<a href="'+s.url+'" target="_blank" rel="noopener">'+s.title+'</a>').join(", "):"";
    drugInfo.classList.remove("hidden");doseInput.placeholder=d.typical_dose_mg+" mg (typical)";
    calcBtn.disabled=false;takeDoseBtn.disabled=false;updateAdjPreview();});

  // Calculate
  calcBtn.addEventListener("click",calculate);doseInput.addEventListener("keydown",e=>{if(e.key==="Enter")calculate();});
  showRangeCb.addEventListener("change",()=>{if(lastCalcData)renderDecayChart(lastCalcData);});
  async function calculate(){const k=drugSelect.value;if(!k)return;calcBtn.disabled=true;calcBtn.textContent="Calculating…";
    const payload={drug:k},dv=parseFloat(doseInput.value);if(dv>0)payload.dose_mg=dv;
    const p=getProfile();if(p.age)payload.age=p.age;if(p.gender)payload.gender=p.gender;if(p.weight_kg)payload.weight_kg=p.weight_kg;
    try{const res=await fetch("/api/calculate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      const data=await res.json();if(data.error){alert(data.error);return;}data._hl_range=drugs[k]?.hl_range_hr||null;lastCalcData=data;renderDecayChart(data);renderStats(data);
    }catch(e){console.error(e);alert("Calculation failed.");}finally{calcBtn.disabled=false;calcBtn.textContent="Calculate";}}

  // Take Dose (manual time + schedule)
  takeDoseBtn.addEventListener("click",()=>{const k=drugSelect.value;if(!k)return;const d=drugs[k],doseVal=parseFloat(doseInput.value)||d.typical_dose_mg,{hl}=adjustedHalfLife(d);
    const baseTime=doseTimeInput.value?new Date(doseTimeInput.value):new Date();if(isNaN(baseTime.getTime())){alert("Invalid dose time.");return;}
    const interval=parseFloat(scheduleSelect.value)||0,count=interval?Math.min(parseInt(scheduleCount.value,10)||1,20):1;
    for(let i=0;i<count;i++){const t=new Date(baseTime.getTime()+i*interval*3600000),color=COLORS[colorIndex%COLORS.length];colorIndex++;
      doseLog.push({id:Date.now()+Math.random()+i,drugKey:k,drugName:d.name,dose_mg:doseVal,half_life_hr:hl,base_half_life_hr:d.half_life_hr,category:d.category||"",takenAt:t.toISOString(),color});}
    saveLog();renderDoseTable();renderTimeline();startTimer();});

  // Clear / Export
  clearLogBtn.addEventListener("click",()=>{doseLog=[];colorIndex=0;saveLog();renderDoseTable();renderTimeline();});
  exportCsvBtn.addEventListener("click",()=>{const now=new Date();let csv="Drug,Dose (mg),Time Taken,Half-life (h),Remaining (mg),% Left\n";
    for(const e of doseLog){const t=new Date(e.takenAt),hr=(now-t)/3600000,rem=e.dose_mg*Math.pow(0.5,hr/e.half_life_hr);csv+=[e.drugName,e.dose_mg,t.toISOString(),e.half_life_hr,rem.toFixed(2),(rem/e.dose_mg*100).toFixed(1)].join(",")+"\n";}dl("dose_log.csv",csv,"text/csv");});
  exportJsonBtn.addEventListener("click",()=>{dl("dose_log.json",JSON.stringify(doseLog,null,2),"application/json");});
  function dl(n,c,m){const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([c],{type:m}));a.download=n;a.click();URL.revokeObjectURL(a.href);}

  // localStorage
  function saveLog(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(doseLog));flashSave("Saved locally");}catch(e){}}
  function restoreLog(){try{const r=localStorage.getItem(STORAGE_KEY);if(r){doseLog=JSON.parse(r);colorIndex=doseLog.length;renderDoseTable();renderTimeline();if(doseLog.length)startTimer();}}catch(e){}}
  function flashSave(m){saveStatus.textContent=m;saveStatus.classList.remove("hidden");setTimeout(()=>saveStatus.classList.add("hidden"),2000);}

  // Timer
  function startTimer(){if(timerInterval)return;timerInterval=setInterval(()=>{if(!doseLog.length){clearInterval(timerInterval);timerInterval=null;return;}renderDoseTable();renderTimeline();},1000);}

  // Dose table
  function renderDoseTable(){if(!doseLog.length){doseLogEmpty.classList.remove("hidden");doseTableWrap.classList.add("hidden");clearLogBtn.classList.add("hidden");exportCsvBtn.classList.add("hidden");exportJsonBtn.classList.add("hidden");return;}
    doseLogEmpty.classList.add("hidden");doseTableWrap.classList.remove("hidden");clearLogBtn.classList.remove("hidden");exportCsvBtn.classList.remove("hidden");exportJsonBtn.classList.remove("hidden");
    const now=new Date();doseLogBody.innerHTML="";
    for(const e of doseLog){const t=new Date(e.takenAt),ms=now-t,hr=ms/3600000,rem=e.dose_mg*Math.pow(0.5,Math.max(0,hr)/e.half_life_hr),pct=rem/e.dose_mg*100;
      const tr=document.createElement("tr");tr.innerHTML=
        `<td><span class="color-dot" style="background:${e.color.line}"></span>${e.drugName}</td><td>${e.dose_mg} mg</td><td>${fmtTime(t)}</td><td class="mono">${ms>=0?fmtElapsed(ms):"future"}</td><td>${fmtH(e.half_life_hr)}</td><td class="mono">${rem.toFixed(1)} mg</td><td><span class="pct-badge ${pct<10?"pct-low":pct<50?"pct-mid":"pct-high"}">${pct.toFixed(1)}%</span></td><td><button class="btn-icon" data-id="${e.id}" title="Remove">×</button></td>`;
      doseLogBody.appendChild(tr);}
    doseLogBody.querySelectorAll(".btn-icon").forEach(b=>{b.addEventListener("click",()=>{doseLog=doseLog.filter(e=>e.id!==+b.dataset.id);saveLog();renderDoseTable();renderTimeline();});});}

  // Timeline
  function renderTimeline(){if(!doseLog.length){timelinePlaceholder.classList.remove("hidden");legendDiv.innerHTML="";if(timelineChart){timelineChart.destroy();timelineChart=null;}return;}
    timelinePlaceholder.classList.add("hidden");const now=new Date(),earliest=new Date(Math.min(...doseLog.map(e=>new Date(e.takenAt).getTime()))),wS=earliest,wEm=new Date(earliest.getTime()+24*3600000),wE=wEm>now?wEm:new Date(now.getTime()+2*3600000),tH=(wE-wS)/3600000,N=300,step=tH/N,ds=[];
    for(const e of doseLog){const off=(new Date(e.takenAt)-wS)/3600000,pts=[];for(let i=0;i<=N;i++){const t=i*step,s=t-off;pts.push({x:t,y:s<0?0:Math.round(e.dose_mg*Math.pow(0.5,s/e.half_life_hr)*100)/100});}
      ds.push({label:e.drugName+" ("+e.dose_mg+" mg)",data:pts,borderColor:e.color.line,backgroundColor:e.color.bg,fill:true,tension:.3,pointRadius:0,pointHitRadius:6,borderWidth:2});}
    const nowH=(now-wS)/3600000;if(timelineChart)timelineChart.destroy();
    timelineChart=new Chart($("timeline-chart").getContext("2d"),{type:"line",data:{datasets:ds},
      options:{responsive:true,maintainAspectRatio:false,interaction:{mode:"index",intersect:false},plugins:{legend:{display:false},tooltip:{backgroundColor:"#1a1d24",padding:10,cornerRadius:8,callbacks:{title:items=>{const d=new Date(wS.getTime()+(+items[0].parsed.x)*3600000);return d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});},label:item=>item.dataset.label+": "+item.parsed.y.toFixed(1)+" mg"}},nowLine:{nowHr:nowH}},
        scales:{x:{type:"linear",min:0,max:tH,title:{display:true,text:"Time",font:{weight:"600",size:12}},grid:{color:"rgba(0,0,0,0.04)"},ticks:{font:{size:11},callback:v=>{const d=new Date(wS.getTime()+v*3600000);return d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});},maxTicksLimit:12}},y:{title:{display:true,text:"Concentration (mg)",font:{weight:"600",size:12}},beginAtZero:true,grid:{color:"rgba(0,0,0,0.04)"},ticks:{font:{size:11}}}}},
      plugins:[{id:"nowLine",afterDraw(ch){const nv=ch.options.plugins.nowLine?.nowHr;if(nv==null)return;const xa=ch.scales.x,ya=ch.scales.y,x=xa.getPixelForValue(nv);if(x<xa.left||x>xa.right)return;const c=ch.ctx;c.save();c.strokeStyle="#ef4444";c.lineWidth=1.5;c.setLineDash([4,4]);c.beginPath();c.moveTo(x,ya.top);c.lineTo(x,ya.bottom);c.stroke();c.fillStyle="#ef4444";c.font="600 11px Inter,sans-serif";c.textAlign="center";c.fillText("NOW",x,ya.top-6);c.restore();}}]});
    legendDiv.innerHTML=doseLog.map(e=>`<span class="legend-item"><span class="legend-dot" style="background:${e.color.line}"></span>${e.drugName}</span>`).join("");}

  // Decay chart with range bands
  function renderDecayChart(data){placeholder.classList.add("hidden");const labels=data.curve.map(p=>p.t),values=data.curve.map(p=>p.concentration),hl=data.half_life_hr,dose=data.initial_dose_mg,tH=data.total_hours;
    const ann=[];let n=1;while(hl*n<=tH){ann.push({t:hl*n,c:dose*Math.pow(0.5,n)});n++;}
    if(decayChart)decayChart.destroy();const ctx=$("decay-chart").getContext("2d"),grad=ctx.createLinearGradient(0,0,0,360);grad.addColorStop(0,"rgba(79,110,247,0.25)");grad.addColorStop(1,"rgba(79,110,247,0.01)");
    const ds=[{label:data.drug+" (mg)",data:values,borderColor:"#4f6ef7",backgroundColor:grad,fill:true,tension:.35,pointRadius:0,pointHitRadius:8,borderWidth:2.5,order:2},
      {label:"Half-life markers",data:ann.map(a=>({x:a.t,y:a.c})),borderColor:"transparent",backgroundColor:"#4f6ef7",pointRadius:6,pointBorderColor:"#fff",pointBorderWidth:2,showLine:false,type:"scatter",order:1}];
    const range=data._hl_range;
    if(range&&showRangeCb.checked){const maxHL=range[1],minHL=range[0];
      ds.push({label:"Upper range (t½="+fmtH(maxHL)+")",data:labels.map(t=>dose*Math.pow(0.5,t/maxHL)),borderColor:"rgba(79,110,247,0.3)",borderWidth:1,borderDash:[4,4],fill:false,pointRadius:0,tension:.35,order:3});
      ds.push({label:"Lower range (t½="+fmtH(minHL)+")",data:labels.map(t=>dose*Math.pow(0.5,t/minHL)),borderColor:"rgba(79,110,247,0.3)",borderWidth:1,borderDash:[4,4],fill:"-1",backgroundColor:"rgba(79,110,247,0.06)",pointRadius:0,tension:.35,order:3});}
    decayChart=new Chart(ctx,{type:"line",data:{labels,datasets:ds},
      options:{responsive:true,maintainAspectRatio:false,interaction:{mode:"index",intersect:false},
        plugins:{legend:{display:!!(range&&showRangeCb.checked),position:"bottom",labels:{font:{size:11},usePointStyle:true}},tooltip:{backgroundColor:"#1a1d24",padding:10,cornerRadius:8,callbacks:{title:items=>"t = "+(+items[0].parsed.x).toFixed(2)+" h",label:item=>{if(item.datasetIndex===1){const idx=Math.round(Math.log2(dose/item.parsed.y));return "½-life #"+idx+": "+item.parsed.y.toFixed(2)+" mg";}return item.dataset.label.split("(")[0].trim()+": "+item.parsed.y.toFixed(2)+" mg";}}}},
        scales:{x:{type:"linear",title:{display:true,text:"Time (hours)",font:{weight:"600",size:12}},grid:{color:"rgba(0,0,0,0.04)"},ticks:{font:{size:11}}},y:{title:{display:true,text:"Concentration (mg)",font:{weight:"600",size:12}},beginAtZero:true,grid:{color:"rgba(0,0,0,0.04)"},ticks:{font:{size:11}}}}}});}

  // Stats
  function renderStats(data){const hl=data.half_life_hr,dose=data.initial_dose_mg;$("stat-initial").textContent=dose+" mg";$("stat-halflife").textContent=fmtH(hl)+(data.base_half_life_hr!==hl?" (adj)":"");$("stat-quarter").textContent=fmtH(hl*2);$("stat-ten").textContent=fmtH(hl*Math.log2(10));statsDiv.classList.remove("hidden");}

  // Helpers
  function fmtH(h){if(h<1)return(h*60).toFixed(0)+" min";return h%1===0?h+" h":h.toFixed(1)+" h";}
  function fmtTime(d){return d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"});}
  function fmtElapsed(ms){const s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor(s%3600/60),sec=s%60;return String(h).padStart(2,"0")+":"+String(m).padStart(2,"0")+":"+String(sec).padStart(2,"0");}
})();
