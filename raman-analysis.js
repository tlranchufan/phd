'use strict';
const $=id=>document.getElementById(id);
let spectra=[],uid=0,currentId=null,preview=null,fitResult=null,seeds=[],pickMode=false,lastSvg='',plotGeometry=null;const ratioNumerator=new Set(),ratioDenominator=new Set();
const COLORS=['#315cc6','#d05a43','#209c93','#895bb8','#bd902c','#d34891','#4e728d','#55a33b'];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const csvVal=s=>'"'+String(s??'').replace(/"/g,'""')+'"';

function metadata(name){
 let n=String(name||'').replace(/\.(?:wdf|txt|csv)$/i,'').replace(/\.txt$/i,'').replace(/^output_/i,''),hostMineral='Quartz';
 if(/^CC-/i.test(n)){hostMineral='Calcite';n=n.slice(3);}else if(/^C-/i.test(n)){hostMineral='Corundum';n=n.slice(2);}
 let chunks=n.split('-'),tail=chunks.slice(4).join('-'),compound=chunks[0]||'',mol=(chunks[1]||'').match(/([\d.]+)\s*M/i)?.[1]||'',phaseChunk=chunks[4]||'',ph=(phaseChunk.match(/^(liq(?:uid)?|vap(?:our|or)?|qtz|quartz|solid|gas)/i)||[])[0]||'';
 let phase=/^liq/i.test(ph)?'Liquid':/^(vap|gas)/i.test(ph)?'Vapour':/^(qtz|quartz)/i.test(ph)?'Quartz':ph||'',phaseId=(phaseChunk.match(/^(?:liq(?:uid)?|vap(?:our|or)?|qtz|quartz|solid|gas)(\d+(?:\(\d+\))?|\(\d+\))?/i)||[])[1]||'',temp=(tail.match(/(?:Th\s*)?(\d+(?:\.\d+)?)\s*°?C\b/i)||[])[1]||'',condition=/after\s*run|after\s*th/i.test(tail)?'After Th':/\bTh\s*\d/i.test(tail)?'Th':'No comment';
 return {compound,hostMineral,mol,sample:chunks[2]||'',objective:chunks[3]||'',phase,phaseId,temp,condition};
}
function readWdf(ab){
 let d=new DataView(ab);if(ab.byteLength<512||String.fromCharCode(...new Uint8Array(ab,0,4))!=='WDF1')throw Error('Invalid WDF signature');
 let n=d.getUint32(60,true),count=Number(d.getBigUint64(64,true));if(!n||n>1000000||count!==1)throw Error('Only single-spectrum WDF files are supported');
 let pos=512,X=null,Y=null;while(pos+16<=ab.byteLength){let tag=String.fromCharCode(...new Uint8Array(ab,pos,4)),size=Number(d.getBigUint64(pos+8,true)),start=pos+16;if(size<16||pos+size>ab.byteLength)throw Error('Invalid WDF block length');if(tag==='DATA')Y=Array.from({length:n},(_,i)=>d.getFloat32(start+i*4,true));if(tag==='XLST')X=Array.from({length:n},(_,i)=>d.getFloat32(start+8+i*4,true));pos+=size;}if(!X||!Y)throw Error('Missing WDF DATA or XLST block');return {x:X,y:Y};
}
function readTxt(text){let x=[],y=[];for(const line of text.split(/\r?\n/)){let tok=line.trim().replace(/[,;\t]+/g,' ').split(/\s+/);if(tok.length<2)continue;let a=Number(tok[0]),b=Number(tok[1]);if(Number.isFinite(a)&&Number.isFinite(b)){x.push(a);y.push(b);}}if(x.length<20)throw Error('Expected at least 20 numeric x/y rows');return {x,y};}
function addSpectrum(name,raw,meta,working,extra={}){
 let sorted=raw.x.map((x,i)=>[x,raw.y[i]]).filter(v=>Number.isFinite(v[0])&&Number.isFinite(v[1])).sort((a,b)=>a[0]-b[0]);if(sorted.length<20)throw Error('Too few valid spectral points');
 let x=sorted.map(v=>v[0]),y=sorted.map(v=>v[1]),w=working&&working.length===y.length?working.slice():y.slice();
 spectra.push({id:++uid,name,meta:meta||metadata(name),x,raw:y,working:w,modified:Array.isArray(extra.modified)?extra.modified.slice():[],reviewed:extra.reviewed===true,approved:extra.approved===true,processing:extra.processing||null,fit:extra.fit||null});if(currentId===null)currentId=uid;
}
function current(){return spectra.find(s=>s.id===currentId)||null;}
function renderList(){
 let q=$('search').value.trim().toLowerCase(),shown=spectra.filter(s=>!q||[s.name,...Object.values(s.meta||{})].join(' ').toLowerCase().includes(q));
 $('spectrumList').innerHTML=shown.length?shown.map(s=>'<div class="spectrum-item '+(s.id===currentId?'active':'')+'" data-spectrum="'+s.id+'">'+esc(s.name)+(s.approved?' <span class="fit-chip">Approved</span>':s.reviewed?' <span class="fit-chip">Reviewed</span>':'')+'</div>').join(''):'<div class="hint" style="padding:10px">No spectra match.</div>';
 let s=current();$('metaSummary').innerHTML=s?['compound','hostMineral','mol','phase','phaseId','temp','condition'].map(k=>s.meta?.[k]?'<span class="fit-chip">'+esc(k)+': '+esc(s.meta[k])+'</span>':'').join(' '):'';
 renderReviewUi();
}
function renderReviewUi(){
 let s=current(),reviewed=spectra.filter(v=>v.reviewed).length,approved=spectra.filter(v=>v.approved).length;
 if($('reviewed'))$('reviewed').checked=!!s?.reviewed;
 if($('approved'))$('approved').checked=!!s?.approved;
 if($('reviewStatus'))$('reviewStatus').textContent=spectra.length?(reviewed+' / '+spectra.length+' reviewed · '+approved+' approved'):'';
}
function invalidateReview(s){
 if(!s)return;s.reviewed=false;s.approved=false;s.fit=null;renderReviewUi();renderList();renderApprovedPreview();
}
function restoreStoredFit(s){
 fitResult=s?.fit?JSON.parse(JSON.stringify(s.fit)):null;seeds=fitResult?.seedXs?.slice()||[];ratioNumerator.clear();ratioDenominator.clear();
 for(const i of fitResult?.ratio?.numerator||[])ratioNumerator.add(i);
 for(const i of fitResult?.ratio?.denominator||[])ratioDenominator.add(i);
}
function storeCurrentFit(){
 let s=current();if(!s||!fitResult)return;
 s.fit=JSON.parse(JSON.stringify(fitResult));
 s.fit.ratio={numerator:[...ratioNumerator],denominator:[...ratioDenominator]};
}
function renderApprovedPreview(){
 let host=$('approvedPlot');if(!host)return;let ss=spectra.filter(s=>s.approved);
 if(!ss.length){host.innerHTML='<div style="padding:55px;text-align:center;color:#7b8da3">No approved spectra yet</div>';return;}
 let xmin=Math.max(...ss.map(s=>s.x[0])),xmax=Math.min(...ss.map(s=>s.x.at(-1)));if(!(xmax>xmin)){host.innerHTML='<div style="padding:55px;text-align:center;color:#7b8da3">Approved spectra do not share an overlapping Raman-shift range</div>';return;}
 let w=1180,left=92,right=1090,top=35,row=44,h=Math.max(300,top+ss.length*row+65),XX=x=>left+(x-xmin)/(xmax-xmin)*(right-left),out=['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+w+' '+h+'" width="'+w+'" height="'+h+'" style="background:white"><rect width="100%" height="100%" fill="white"/>'];
 for(let x=Math.ceil(xmin/500)*500;x<=xmax;x+=500){let xx=XX(x);out.push('<line x1="'+xx+'" y1="'+top+'" x2="'+xx+'" y2="'+(h-55)+'" stroke="#edf1f5"/><text x="'+xx+'" y="'+(h-28)+'" text-anchor="middle" font-size="11" fill="#53667d">'+x+'</text>');}
 ss.forEach((s,ri)=>{let ids=s.x.map((x,i)=>i).filter(i=>x>=xmin&&x<=xmax),vals=ids.map(i=>s.working[i]),lo=Math.min(...vals),hi=Math.max(...vals),span=hi-lo||1,base=top+ri*row+28,path=ids.map((i,j)=>(j?'L':'M')+XX(s.x[i]).toFixed(2)+' '+(base-(s.working[i]-lo)/span*28).toFixed(2)).join(' ');out.push('<path d="'+path+'" stroke="'+COLORS[ri%COLORS.length]+'" stroke-width="1.25" fill="none"/><text x="'+(left-10)+'" y="'+(base-8)+'" text-anchor="end" font-size="11" fill="#43546b">'+esc(s.name)+'</text>');});
 out.push('<text x="'+((left+right)/2)+'" y="'+(h-8)+'" text-anchor="middle" font-size="14">Raman shift (cm⁻¹)</text></svg>');host.innerHTML=out.join('');
}
function chooseSpectrum(id){currentId=Number(id);preview=null;let s=current();restoreStoredFit(s);syncProcessingControlsFromSpectrum(s);pickMode=false;$('pickPeaks').classList.remove('primary');$('pickPeaks').textContent='Pick centres on plot';renderList();syncRanges();renderSeeds();renderFit();renderPlot();renderApprovedPreview();if(!s?.processing)refreshProcessingPreview();}
$('spectrumList').onclick=e=>{let id=e.target.closest('[data-spectrum]')?.dataset.spectrum;if(id)chooseSpectrum(id);};
$('search').oninput=renderList;

$('upload').onchange=async e=>{
 let good=0,errors=[];for(const f of [...e.target.files]){try{let raw=/\.wdf$/i.test(f.name)?readWdf(await f.arrayBuffer()):readTxt(await f.text());addSpectrum(f.name,raw,metadata(f.name));good++;}catch(err){errors.push(f.name+': '+err.message);}}
 $('loadStatus').textContent=good+' imported'+(errors.length?' · '+errors.length+' failed':'')+'.';e.target.value='';renderList();syncRanges();syncProcessingControlsFromSpectrum(current());renderPlot();if(!current()?.processing)refreshProcessingPreview();
};
$('openCompiled').onchange=async e=>{
 const f=e.target.files?.[0];if(!f)return;try{let data=JSON.parse(await f.text());if(data.format!=='raman-studio-v1'||!Array.isArray(data.spectra))throw Error('Unsupported compiled Raman dataset');let count=0;for(const a of data.spectra){if(!Array.isArray(a.x)||!Array.isArray(a.raw))continue;addSpectrum(a.name||('Spectrum '+(count+1)),{x:a.x,y:a.raw},a.meta||metadata(a.name||''),Array.isArray(a.corrected)?a.corrected:null,a);count++;}$('loadStatus').textContent='Loaded '+count+' spectra from '+f.name+'.';renderList();syncRanges();syncProcessingControlsFromSpectrum(current());renderPlot();if(!current()?.processing)refreshProcessingPreview();}catch(err){$('loadStatus').textContent='Import failed: '+err.message;}finally{e.target.value='';}
};

function cosmic(y,x){
 const n=y.length,flagged=new Uint8Array(n),median=a=>{let s=a.slice().sort((p,q)=>p-q);return s[Math.floor(s.length/2)]};
 for(let i=4;i<n-4;i++){let neighbors=[...y.slice(i-4,i-1),...y.slice(i+2,i+5)],m=median(neighbors),sigma=1.4826*median(neighbors.map(v=>Math.abs(v-m))),local=Math.max(sigma,Math.sqrt(Math.max(1,Math.abs(m)))*.65,2);if(y[i]-m>8*local&&y[i]>(y[i-1]+y[i+1])/2+6*local)flagged[i]=1;}
 const medianFilter=(a,width)=>{let half=Math.floor(width/2),out=new Array(a.length);for(let i=0;i<a.length;i++){let w=[];for(let j=-half;j<=half;j++)w.push(a[Math.max(0,Math.min(a.length-1,i+j))]);w.sort((p,q)=>p-q);out[i]=w[half];}return out;};
 if(n>=105&&x&&x.length===n){let continuum=medianFilter(y,41),response=y.map((v,i)=>v-continuum[i]),near=medianFilter(y,11),hf=y.map((v,i)=>v-near[i]),trend=medianFilter(hf,101),noise=medianFilter(hf.map((v,i)=>Math.abs(v-trend[i])),101).map(v=>Math.max(1.4826*v,6)),seed=new Uint8Array(n),wings=new Uint8Array(n);for(let i=0;i<n;i++){let eligible=x[i]>=1500&&x[i]<=4150;if(eligible&&response[i]>Math.max(7*noise[i],105))seed[i]=1;if(eligible&&response[i]>Math.max(2.7*noise[i],23))wings[i]=1;}for(let i=0;i<n;i++){if(!seed[i])continue;let a=i,b=i;while(a>1&&a>i-25&&wings[a-1])a--;while(b<n-2&&b<i+25&&wings[b+1])b++;if(b-a+1<=20)for(let j=a;j<=b;j++)flagged[j]=1;}}
 let corrected=y.slice(),modified=[];for(let i=0;i<n;i++){if(!flagged[i])continue;let start=i;while(i+1<n&&flagged[i+1])i++;let end=i;if(start<1||end>=n-1)continue;let x0=x?.[start-1]??start-1,x1=x?.[end+1]??end+1;for(let j=start;j<=end;j++){let xj=x?.[j]??j;corrected[j]=y[start-1]+(y[end+1]-y[start-1])*(xj-x0)/(x1-x0);modified.push(j);}}return {corrected,modified};
}
function sgSmooth(y,w){const c={5:[-3,12,17,12,-3].map(v=>v/35),7:[-2,3,6,7,6,3,-2].map(v=>v/21),9:[-21,14,39,54,59,54,39,14,-21].map(v=>v/231)}[w];if(!c||y.length<w)return y.slice();let h=Math.floor(w/2),out=y.slice();for(let i=h;i<y.length-h;i++){let v=0;for(let j=-h;j<=h;j++)v+=y[i+j]*c[j+h];out[i]=v;}return out;}
function linearEndpointBaseline(y){if(y.length<2)return y.map(()=>0);let a=y[0],b=y.at(-1),n=y.length-1;return y.map((_,i)=>a+(b-a)*i/n);}
function whittakerBaseline(y,weights,lambda){
 const n=y.length;if(n<3)return y.slice();let lam=Math.max(1e-12,Number(lambda)||1),diag=weights.map(w=>Math.max(1e-12,Number(w)||0)),sub1=new Array(n).fill(0),sub2=new Array(n).fill(0);
 for(let i=0;i<n-2;i++){diag[i]+=lam;diag[i+1]+=4*lam;diag[i+2]+=lam;sub1[i+1]-=2*lam;sub1[i+2]-=2*lam;sub2[i+2]+=lam;}
 let l0=new Array(n),l1=new Array(n).fill(0),l2=new Array(n).fill(0),eps=1e-24;l0[0]=Math.sqrt(Math.max(diag[0],eps));l1[1]=sub1[1]/l0[0];l0[1]=Math.sqrt(Math.max(diag[1]-l1[1]*l1[1],eps));
 for(let i=2;i<n;i++){l2[i]=sub2[i]/l0[i-2];l1[i]=(sub1[i]-l2[i]*l1[i-1])/l0[i-1];l0[i]=Math.sqrt(Math.max(diag[i]-l1[i]*l1[i]-l2[i]*l2[i],eps));}
 let rhs=y.map((v,i)=>Math.max(1e-12,Number(weights[i])||0)*v),f=new Array(n),out=new Array(n);f[0]=rhs[0]/l0[0];f[1]=(rhs[1]-l1[1]*f[0])/l0[1];for(let i=2;i<n;i++)f[i]=(rhs[i]-l1[i]*f[i-1]-l2[i]*f[i-2])/l0[i];out[n-1]=f[n-1]/l0[n-1];out[n-2]=(f[n-2]-l1[n-1]*out[n-1])/l0[n-2];for(let i=n-3;i>=0;i--)out[i]=(f[i]-l1[i+1]*out[i+1]-l2[i+2]*out[i+2])/l0[i];return out;
}
function alsBaseline(y,lambda,p,iterations){let asym=Math.max(1e-6,Math.min(.49,Number(p)||.001)),rounds=Math.max(1,Math.min(50,Math.round(iterations)||12)),weights=new Array(y.length).fill(1),base=y.slice();for(let k=0;k<rounds;k++){base=whittakerBaseline(y,weights,lambda);for(let i=0;i<y.length;i++)weights[i]=y[i]>base[i]?asym:1-asym;}return base;}
function airPlsBaseline(y,lambda,iterations){let rounds=Math.max(1,Math.min(50,Math.round(iterations)||12)),weights=new Array(y.length).fill(1),base=y.slice(),total=Math.max(1e-12,y.reduce((s,v)=>s+Math.abs(v),0));for(let k=1;k<=rounds;k++){base=whittakerBaseline(y,weights,lambda);let r=y.map((v,i)=>v-base[i]),neg=r.filter(v=>v<0),dssn=Math.abs(neg.reduce((s,v)=>s+v,0));if(dssn<.001*total)break;for(let i=0;i<weights.length;i++)weights[i]=r[i]>=0?1e-12:Math.exp(Math.min(40,k*Math.abs(r[i])/Math.max(dssn,1e-12)));}return base;}
function isHostReference(s){
 const phase=String(s?.meta?.phase||'').trim().toLowerCase(),host=String(s?.meta?.hostMineral||'').trim().toLowerCase(),code=String(s?.meta?.phaseCode||'').trim().toLowerCase();
 return !!s&&(phase&&host&&phase===host||['crn','cor','corundum','qtz','qz','quartz','qt','cc','cal','calc','calcite','host'].includes(code));
}
function hostCandidates(s){
 if(!s)return [];
 let all=spectra.filter(v=>v.id!==s.id&&isHostReference(v)),sampleId=String(s.meta?.sampleId||s.meta?.sample||'').trim(),compound=String(s.meta?.compound||'').trim(),mol=String(s.meta?.mol||'').trim(),host=String(s.meta?.hostMineral||'').trim();
 return all.sort((a,b)=>{
  const score=v=>(String(v.meta?.sampleId||v.meta?.sample||'').trim()===sampleId?100:0)+(String(v.meta?.compound||'').trim()===compound?20:0)+(String(v.meta?.mol||'').trim()===mol?5:0)+(String(v.meta?.hostMineral||'').trim()===host?3:0);
  return score(b)-score(a)||a.name.localeCompare(b.name);
 });
}
function autoHostReference(s){
 let c=hostCandidates(s),sid=String(s?.meta?.sampleId||s?.meta?.sample||'').trim();
 return c.find(v=>String(v.meta?.sampleId||v.meta?.sample||'').trim()===sid)||c[0]||null;
}
function selectedHostReference(){
 let id=Number($('hostReference').value);return spectra.find(s=>s.id===id)||null;
}
function updateHostUi(){
 let s=current(),box=$('subtractHost'),fields=$('hostSubtractFields'),select=$('hostReference'),cands=hostCandidates(s),was=Number(select.value),storedName=s?.processing?.host?.referenceName||'',auto=autoHostReference(s);
 select.replaceChildren(...cands.map(v=>new Option(v.name,String(v.id))));
 let chosen=cands.find(v=>v.id===was)||cands.find(v=>v.name===storedName)||auto;
 if(chosen)select.value=String(chosen.id);
 let selfHost=isHostReference(s);
 box.disabled=selfHost||!cands.length;
 fields.style.display=box.checked&&!box.disabled?'grid':'none';
 $('hostScale').disabled=$('hostScaleMode').value!=='manual';
 if(selfHost)$('hostStatus').textContent='Current spectrum is the host reference.';
 else if(!cands.length)$('hostStatus').textContent='No matching host reference found in this dataset.';
 else if(chosen)$('hostStatus').textContent='Matched '+chosen.name+'.';
}
function interpolateSeries(xs,ys,targetX){
 let out=new Array(targetX.length).fill(NaN),j=0;if(!xs?.length||xs.length!==ys?.length)return out;
 for(let i=0;i<targetX.length;i++){let x=targetX[i];while(j+1<xs.length&&xs[j+1]<x)j++;if(x<xs[0]||x>xs.at(-1))continue;if(xs[j]===x){out[i]=ys[j];continue;}let k=Math.min(j+1,xs.length-1),dx=xs[k]-xs[j];out[i]=dx?ys[j]+(ys[k]-ys[j])*(x-xs[j])/dx:ys[j];}
 return out;
}
function medianArray(a){let v=a.filter(Number.isFinite).slice().sort((x,y)=>x-y);if(!v.length)return 0;let m=Math.floor(v.length/2);return v.length%2?v[m]:(v[m-1]+v[m])/2;}
function quantileArray(a,q){let v=a.filter(Number.isFinite).slice().sort((x,y)=>x-y);if(!v.length)return 0;let p=Math.max(0,Math.min(1,q))*(v.length-1),i=Math.floor(p),f=p-i;return v[i]+(v[Math.min(i+1,v.length-1)]-v[i])*f;}
function fitHostScale(sampleY,hostSignal){
 let valid=[];for(let i=0;i<sampleY.length;i++)if(Number.isFinite(sampleY[i])&&Number.isFinite(hostSignal[i])&&hostSignal[i]>0)valid.push(i);
 if(valid.length<20)return 1;
 let threshold=quantileArray(valid.map(i=>hostSignal[i]),.72),idx=valid.filter(i=>hostSignal[i]>=threshold);if(idx.length<12)idx=valid;
 let sampleBase=alsBaseline(sampleY,1e6,.001,8),sampleSignal=sampleY.map((v,i)=>v-sampleBase[i]),scale=0;
 const solve=ids=>{let num=0,den=0;for(const i of ids){num+=hostSignal[i]*sampleSignal[i];den+=hostSignal[i]*hostSignal[i];}return den>1e-18?Math.max(0,num/den):0;};
 scale=solve(idx);
 for(let iter=0;iter<3;iter++){let residual=idx.map(i=>sampleSignal[i]-scale*hostSignal[i]),med=medianArray(residual),mad=Math.max(1e-9,1.4826*medianArray(residual.map(v=>Math.abs(v-med)))),keep=idx.filter(i=>Math.abs((sampleSignal[i]-scale*hostSignal[i])-med)<=2.8*mad);if(keep.length<10)break;scale=solve(keep);}
 return Math.max(0,Math.min(100,scale));
}
function subtractHostSignal(sampleY,s){
 let host=selectedHostReference();if(!$('subtractHost').checked||$('subtractHost').disabled||!host)return {y:sampleY.slice(),host:null,scale:null,hostSignal:null};
 let hostY=host.raw.slice();if($('despike').checked)hostY=cosmic(hostY,host.x).corrected;
 let interp=interpolateSeries(host.x,hostY,s.x),valid=interp.map(Number.isFinite),filled=interp.map((v,i)=>Number.isFinite(v)?v:0),hostBase=alsBaseline(filled,1e6,.001,8),hostSignal=filled.map((v,i)=>valid[i]?Math.max(0,v-hostBase[i]):0),mode=$('hostScaleMode').value,scale=mode==='manual'?Math.max(0,Number($('hostScale').value)||0):fitHostScale(sampleY,hostSignal);
 if(mode==='auto')$('hostScale').value=Number.isFinite(scale)?scale.toFixed(3):'1';
 let y=sampleY.map((v,i)=>v-scale*hostSignal[i]);
 return {y,host,scale,hostSignal};
}
function syncProcessingControlsFromSpectrum(s){
 if(!s?.processing){updateBaselineUi();updateHostUi();return;}
 let p=s.processing;$('despike').checked=p.despike!==false;$('smooth').value=String(p.smoothing||0);$('baselineMethod').value=p.baseline||'none';$('lambda').value=p.lambda??1e6;$('asymmetry').value=p.p??.001;$('iterations').value=p.iterations??12;
 if(p.host){$('subtractHost').checked=p.host.enabled===true;$('hostScaleMode').value=p.host.scaleMode||'auto';$('hostScale').value=Number.isFinite(Number(p.host.scale))?Number(p.host.scale):1;}else $('subtractHost').checked=false;
 updateBaselineUi();updateHostUi();
}
function updateBaselineUi(){
 let m=$('baselineMethod').value;
 $('lambdaField').style.display=(m==='als'||m==='airpls')?'grid':'none';
 $('pField').style.display=m==='als'?'grid':'none';
 $('iterationsField').style.display=(m==='als'||m==='airpls')?'grid':'none';
}
function runProcessing(s){
 let y=s.raw.slice(),spikes=[],settings={method:$('baselineMethod').value,lambda:Math.max(1,Number($('lambda').value)||1e6),p:Math.max(1e-6,Math.min(.49,Number($('asymmetry').value)||.001)),iterations:Math.max(1,Math.min(50,Number($('iterations').value)||12))},baseline=null;
 if($('despike').checked){let d=cosmic(y,s.x);y=d.corrected;spikes=d.modified;}
 let hostSub=subtractHostSignal(y,s);y=hostSub.y;
 let w=Number($('smooth').value)||0;if(w)y=sgSmooth(y,w);
 if(settings.method==='linear')baseline=linearEndpointBaseline(y);
 if(settings.method==='als')baseline=alsBaseline(y,settings.lambda,settings.p,settings.iterations);
 if(settings.method==='airpls')baseline=airPlsBaseline(y,settings.lambda,settings.iterations);
 if(baseline)y=y.map((v,i)=>v-baseline[i]);
 return {y,baseline,spikes,method:settings.method,settings,hostSub};
}
function processingActive(){
 return $('despike').checked||($('subtractHost').checked&&!$('subtractHost').disabled)||Number($('smooth').value)!==0||$('baselineMethod').value!=='none';
}
function refreshProcessingPreview(){
 let s=current();if(!s)return;
 if(!processingActive()){
  preview=null;$('applyProcessing').disabled=true;$('discardProcessing').disabled=true;$('processingStatus').textContent='';renderPlot();return;
 }
 preview=runProcessing(s);$('applyProcessing').disabled=false;$('discardProcessing').disabled=false;
 let parts=[];if($('despike').checked)parts.push('auto-despike'+(preview.spikes.length?' · '+preview.spikes.length+' spike point(s) corrected':''));
 if(preview.hostSub?.host)parts.push('host '+preview.hostSub.host.name+' × '+preview.hostSub.scale.toFixed(3));
 if(Number($('smooth').value))parts.push($('smooth').value+'-point smoothing');
 if(preview.method!=='none')parts.push(preview.method+' baseline');
 $('processingStatus').textContent='Previewing '+parts.join(' · ')+'.';
 fitResult=null;ratioNumerator.clear();ratioDenominator.clear();renderFit();renderPlot();
}
$('baselineMethod').onchange=()=>{updateBaselineUi();refreshProcessingPreview();};
for(const id of ['despike','smooth','lambda','asymmetry','iterations','subtractHost','hostReference','hostScaleMode','hostScale'])$(id).addEventListener('input',()=>{updateHostUi();refreshProcessingPreview();});
$('hostScaleMode').addEventListener('change',()=>{updateHostUi();refreshProcessingPreview();});
$('hostReference').addEventListener('change',()=>{updateHostUi();refreshProcessingPreview();});
$('subtractHost').addEventListener('change',()=>{updateHostUi();refreshProcessingPreview();});
updateBaselineUi();updateHostUi();
$('previewProcessing').onclick=refreshProcessingPreview;
$('applyProcessing').onclick=()=>{let s=current();if(!s||!preview)return;s.working=preview.y.slice();s.modified=preview.spikes.slice();s.processing={despike:$('despike').checked,smoothing:Number($('smooth').value)||0,baseline:preview.method,lambda:Number($('lambda').value)||1e6,p:Number($('asymmetry').value)||.001,iterations:Number($('iterations').value)||12,host:{enabled:!!preview.hostSub?.host,referenceName:preview.hostSub?.host?.name||'',referenceSampleId:preview.hostSub?.host?.meta?.sampleId||preview.hostSub?.host?.meta?.sample||'',scaleMode:$('hostScaleMode').value,scale:preview.hostSub?.scale??null},appliedAt:new Date().toISOString()};preview=null;$('applyProcessing').disabled=true;$('discardProcessing').disabled=true;$('processingStatus').textContent='Applied to working spectrum. Raw data retained.';fitResult=null;seeds=[];ratioNumerator.clear();ratioDenominator.clear();invalidateReview(s);renderSeeds();renderFit();renderPlot();};
$('discardProcessing').onclick=()=>{preview=null;$('applyProcessing').disabled=true;$('discardProcessing').disabled=true;$('processingStatus').textContent='Preview discarded.';renderPlot();};
$('resetRaw').onclick=()=>{let s=current();if(!s)return;s.working=s.raw.slice();s.modified=[];s.processing=null;preview=null;fitResult=null;seeds=[];ratioNumerator.clear();ratioDenominator.clear();invalidateReview(s);renderSeeds();renderFit();renderPlot();};
function activeY(){let s=current();return s?(preview?.y||s.working):[];}

function syncRanges(){let s=current();if(!s)return;if($('fitMin').value==='')$('fitMin').value=Math.round(s.x[0]);if($('fitMax').value==='')$('fitMax').value=Math.round(s.x.at(-1));}
function autoSelectPeaks(){
 let s=current();if(!s)return [];
 let lo=Number($('fitMin').value),hi=Number($('fitMax').value);if(!Number.isFinite(lo)||!Number.isFinite(hi)||lo===hi)return [];if(hi<lo)[lo,hi]=[hi,lo];
 let y=activeY(),indices=[];for(let i=0;i<s.x.length;i++)if(s.x[i]>=lo&&s.x[i]<=hi)indices.push(i);if(indices.length<5)return [];
 let vals=indices.map(i=>y[i]),range=(Math.max(...vals)-Math.min(...vals))||1,threshold=range*Math.max(.001,(Number($('autoPeakProminence').value)||5)/100),candidates=[];
 for(let p=2;p<indices.length-2;p++){let i=indices[p];if(!(y[i]>y[i-1]&&y[i]>=y[i+1]))continue;let left=Math.max(indices[0],i-12),right=Math.min(indices.at(-1),i+12),leftMin=y[i],rightMin=y[i];for(let j=left;j<i;j++)leftMin=Math.min(leftMin,y[j]);for(let j=i+1;j<=right;j++)rightMin=Math.min(rightMin,y[j]);let prominence=y[i]-Math.max(leftMin,rightMin);if(prominence>=threshold)candidates.push({x:s.x[i],prominence});}
 candidates.sort((a,b)=>b.prominence-a.prominence);let kept=[],distance=Math.max(0,Number($('autoPeakDistance').value)||10);for(const c of candidates){if(kept.every(k=>Math.abs(k.x-c.x)>=distance))kept.push(c);if(kept.length>=10)break;}
 seeds=kept.map(v=>v.x).sort((a,b)=>a-b);renderSeeds();renderPlot();return seeds;
}
function updatePeakSelectionUi(){
 let auto=$('autoPeaks').checked;$('pickPeaks').disabled=auto;if(auto&&pickMode){pickMode=false;$('pickPeaks').classList.remove('primary');$('pickPeaks').textContent='Pick centres on plot';}
}
$('autoPeaks').onchange=updatePeakSelectionUi;updatePeakSelectionUi();
function renderSeeds(){$('seedList').innerHTML=seeds.length?seeds.map((x,i)=>'<span class="seed">'+(i+1)+': '+x.toFixed(1)+'<button data-seed="'+i+'">×</button></span>').join(''):'<span class="hint">No peak centres selected.</span>';}
$('seedList').onclick=e=>{if(e.target.dataset.seed!==undefined){seeds.splice(Number(e.target.dataset.seed),1);fitResult=null;ratioNumerator.clear();ratioDenominator.clear();renderSeeds();renderFit();renderPlot();}};
$('pickPeaks').onclick=()=>{pickMode=!pickMode;$('pickPeaks').classList.toggle('primary',pickMode);$('pickPeaks').textContent=pickMode?'Picking centres…':'Pick centres on plot';};
$('clearSeeds').onclick=()=>{seeds=[];fitResult=null;ratioNumerator.clear();ratioDenominator.clear();renderSeeds();renderFit();renderPlot();};

function gaussian(x,c,h,w){let q=(x-c)/Math.max(w,1e-9);return h*Math.exp(-4*Math.LN2*q*q);}
function lorentzian(x,c,h,w){let q=(x-c)/Math.max(w,1e-9);return h/(1+4*q*q);}
function peakValue(x,p,profile){if(profile==='gaussian')return gaussian(x,p.c,p.h,p.w);if(profile==='lorentzian')return lorentzian(x,p.c,p.h,p.w);return p.h*(p.eta/(1+4*Math.pow((x-p.c)/Math.max(p.w,1e-9),2))+(1-p.eta)*Math.exp(-4*Math.LN2*Math.pow((x-p.c)/Math.max(p.w,1e-9),2)));}
function peakArea(p,profile){let g=p.h*p.w*Math.sqrt(Math.PI/(4*Math.LN2)),l=p.h*Math.PI*p.w/2;return profile==='gaussian'?g:profile==='lorentzian'?l:(1-p.eta)*g+p.eta*l;}
function solveLinear(A,b){let n=b.length,M=A.map((r,i)=>r.slice().concat([b[i]]));for(let k=0;k<n;k++){let p=k;for(let i=k+1;i<n;i++)if(Math.abs(M[i][k])>Math.abs(M[p][k]))p=i;if(Math.abs(M[p][k])<1e-18)return null;[M[k],M[p]]=[M[p],M[k]];let d=M[k][k];for(let j=k;j<=n;j++)M[k][j]/=d;for(let i=0;i<n;i++){if(i===k)continue;let f=M[i][k];for(let j=k;j<=n;j++)M[i][j]-=f*M[k][j];}}return M.map(r=>r[n]);}
function unpack(params,count,profile){let peaks=[],at=1;for(let i=0;i<count;i++){let p={c:params[at++],h:params[at++],w:params[at++]};p.eta=profile==='pseudo'?params[at++]:profile==='lorentzian'?1:0;peaks.push(p);}return {offset:params[0],peaks};}
function model(xs,params,count,profile){let u=unpack(params,count,profile);return xs.map(x=>u.offset+u.peaks.reduce((s,p)=>s+peakValue(x,p,profile),0));}
function clamp(params,count,profile,xmin,xmax,yr){let o=params.slice(),at=1;o[0]=Math.max(-3*yr,Math.min(3*yr,o[0]));for(let i=0;i<count;i++){o[at]=Math.max(xmin,Math.min(xmax,o[at]));at++;o[at]=Math.max(0,Math.min(20*yr,o[at]));at++;o[at]=Math.max(.2,Math.min(xmax-xmin,o[at]));at++;if(profile==='pseudo'){o[at]=Math.max(0,Math.min(1,o[at]));at++;}}return o;}
function fitNonlinear(xs,ys,seedXs,profile,maxIterations,initialWidth){
 let count=seedXs.length,ymin=Math.min(...ys),ymax=Math.max(...ys),yr=Math.max(1e-12,ymax-ymin),xmin=Math.min(...xs),xmax=Math.max(...xs),params=[ymin];
 for(const c of seedXs){let nearest=0,dist=Infinity;for(let i=0;i<xs.length;i++){let d=Math.abs(xs[i]-c);if(d<dist){dist=d;nearest=i;}}params.push(c,Math.max(yr*.03,ys[nearest]-ymin),Math.max(.2,initialWidth));if(profile==='pseudo')params.push(.5);}
 params=clamp(params,count,profile,xmin,xmax,yr);let damping=1e-2,fit=model(xs,params,count,profile),sse=ys.reduce((s,v,i)=>s+Math.pow(v-fit[i],2),0),iterations=0;
 for(let iter=0;iter<maxIterations;iter++){iterations=iter+1;let m=params.length,n=xs.length,J=Array.from({length:n},()=>new Array(m)),res=ys.map((v,i)=>v-fit[i]);for(let j=0;j<m;j++){let step=Math.max(1e-6,Math.abs(params[j])*1e-5),p2=params.slice();p2[j]+=step;p2=clamp(p2,count,profile,xmin,xmax,yr);let f2=model(xs,p2,count,profile),actual=p2[j]-params[j]||step;for(let i=0;i<n;i++)J[i][j]=(f2[i]-fit[i])/actual;}let A=Array.from({length:m},()=>new Array(m).fill(0)),g=new Array(m).fill(0);for(let i=0;i<n;i++)for(let a=0;a<m;a++){g[a]+=J[i][a]*res[i];for(let b=0;b<=a;b++)A[a][b]+=J[i][a]*J[i][b];}for(let a=0;a<m;a++){for(let b=0;b<a;b++)A[b][a]=A[a][b];A[a][a]+=damping*(A[a][a]+1e-9);}let delta=solveLinear(A,g);if(!delta){damping*=10;continue;}let cand=clamp(params.map((v,i)=>v+delta[i]),count,profile,xmin,xmax,yr),fit2=model(xs,cand,count,profile),sse2=ys.reduce((s,v,i)=>s+Math.pow(v-fit2[i],2),0);if(sse2<sse){let rel=(sse-sse2)/Math.max(sse,1e-18);params=cand;fit=fit2;sse=sse2;damping=Math.max(1e-9,damping/3);if(rel<1e-9)break;}else damping=Math.min(1e12,damping*5);}
 let mean=ys.reduce((a,b)=>a+b,0)/ys.length,sst=ys.reduce((s,v)=>s+Math.pow(v-mean,2),0),u=unpack(params,count,profile);return {offset:u.offset,peaks:u.peaks,seedXs:seedXs.slice(),fit,residual:ys.map((v,i)=>v-fit[i]),sse,rmse:Math.sqrt(sse/ys.length),r2:sst>0?1-sse/sst:1,iterations,profile,xs};
}
$('fitPeaks').onclick=()=>{let s=current();if(!s){$('fitStatus').textContent='Load a spectrum first.';return;}if($('autoPeaks').checked)autoSelectPeaks();if(!seeds.length){$('fitStatus').textContent='No peaks selected. Adjust auto settings or use manual selection.';return;}let lo=Number($('fitMin').value),hi=Number($('fitMax').value);if(!Number.isFinite(lo)||!Number.isFinite(hi)||lo===hi)return;if(hi<lo)[lo,hi]=[hi,lo];let y=activeY(),idx=s.x.map((x,i)=>[x,i]).filter(v=>v[0]>=lo&&v[0]<=hi),valid=seeds.filter(v=>v>=lo&&v<=hi);if(idx.length<20||!valid.length){$('fitStatus').textContent='Fit range/centres are invalid.';return;}fitResult=fitNonlinear(idx.map(v=>v[0]),idx.map(v=>y[v[1]]),valid,$('profile').value,Math.max(10,Math.min(300,Number($('fitIterations').value)||120)),Math.max(.2,Number($('initialWidth').value)||12));ratioNumerator.clear();ratioDenominator.clear();let fitted=current();if(fitted){fitted.reviewed=false;fitted.approved=false;storeCurrentFit();}renderReviewUi();renderList();renderApprovedPreview();renderFit();renderPlot();};
function renderRatio(){
 let r=fitResult;if(!r){$('ratioSummary').textContent='Select numerator (N) and denominator (D) peaks.';return;}
 let num=[...ratioNumerator].filter(i=>r.peaks[i]),den=[...ratioDenominator].filter(i=>r.peaks[i]),numArea=num.reduce((s,i)=>s+peakArea(r.peaks[i],r.profile),0),denArea=den.reduce((s,i)=>s+peakArea(r.peaks[i],r.profile),0);
 if(!num.length||!den.length){$('ratioSummary').textContent='Select numerator (N) and denominator (D) peaks.';return;}
 let nLabel=num.map(i=>r.peaks[i].c.toFixed(1)).join(' + '),dLabel=den.map(i=>r.peaks[i].c.toFixed(1)).join(' + '),ratio=denArea!==0?numArea/denArea:null;
 $('ratioSummary').textContent=ratio===null?'Denominator area is zero.':'Area ratio ('+nLabel+') / ('+dLabel+') = '+ratio.toPrecision(7);
}
function renderFit(){
 let r=fitResult;if(!r){$('fitTable').innerHTML='';$('fitSummary').innerHTML='';$('fitStatus').textContent='No fit calculated.';renderRatio();return;}
 $('fitStatus').textContent='Fit complete · '+r.iterations+' iteration(s).';$('fitSummary').innerHTML='<span>R² <strong>'+r.r2.toFixed(5)+'</strong></span><span>RMSE <strong>'+r.rmse.toPrecision(5)+'</strong></span><span>Offset <strong>'+r.offset.toPrecision(5)+'</strong></span>';
 $('fitTable').innerHTML=r.peaks.map((p,i)=>'<tr><td>'+(i+1)+'</td><td>'+(r.seedXs?.[i]??p.c).toFixed(3)+'</td><td>'+p.c.toFixed(3)+'</td><td>'+p.h.toPrecision(6)+'</td><td>'+p.w.toFixed(3)+'</td><td>'+(r.profile==='pseudo'?p.eta.toFixed(3):r.profile==='lorentzian'?'1.000':'0.000')+'</td><td>'+peakArea(p,r.profile).toPrecision(7)+'</td><td class="ratio-cell"><input type="checkbox" data-ratio="n" data-peak="'+i+'" '+(ratioNumerator.has(i)?'checked':'')+'></td><td class="ratio-cell"><input type="checkbox" data-ratio="d" data-peak="'+i+'" '+(ratioDenominator.has(i)?'checked':'')+'></td></tr>').join('');
 renderRatio();
}
$('fitTable').onchange=e=>{let kind=e.target.dataset.ratio,i=Number(e.target.dataset.peak);if(!kind||!Number.isInteger(i))return;let target=kind==='n'?ratioNumerator:ratioDenominator,other=kind==='n'?ratioDenominator:ratioNumerator;if(e.target.checked){target.add(i);other.delete(i);}else target.delete(i);storeCurrentFit();renderFit();};
$('profile').onchange=()=>{fitResult=null;ratioNumerator.clear();ratioDenominator.clear();renderFit();renderPlot();};

function download(name,blob){let u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1200);}
$('reviewed').onchange=()=>{let s=current();if(!s)return;s.reviewed=$('reviewed').checked;if(!s.reviewed)s.approved=false;renderList();renderReviewUi();renderApprovedPreview();};
$('approved').onchange=()=>{let s=current();if(!s)return;s.approved=$('approved').checked;if(s.approved)s.reviewed=true;renderList();renderReviewUi();renderApprovedPreview();};
$('nextUnreviewed').onclick=()=>{if(!spectra.length)return;let start=Math.max(0,spectra.findIndex(s=>s.id===currentId));for(let n=1;n<=spectra.length;n++){let s=spectra[(start+n)%spectra.length];if(!s.reviewed){chooseSpectrum(s.id);return;}}$('reviewStatus').textContent='All spectra are reviewed.';};
$('saveProcessed').onclick=()=>{let data={format:'raman-studio-v1',workflow:'processed',saved:new Date().toISOString(),spectra:spectra.map(s=>({name:s.name,meta:s.meta,x:s.x,raw:s.raw,corrected:s.working,modified:s.modified||[],keep:true,reviewed:!!s.reviewed,approved:!!s.approved,processing:s.processing||null,fit:s.fit||null}))};download('raman_processed.json',new Blob([JSON.stringify(data)],{type:'application/json'}));};
$('exportAnalysisCsv').onclick=()=>{let s=current(),r=fitResult;if(!s||!r)return;let num=[...ratioNumerator].filter(i=>r.peaks[i]),den=[...ratioDenominator].filter(i=>r.peaks[i]),numArea=num.reduce((sum,i)=>sum+peakArea(r.peaks[i],r.profile),0),denArea=den.reduce((sum,i)=>sum+peakArea(r.peaks[i],r.profile),0),ratio=num.length&&den.length&&denArea!==0?numArea/denArea:'',rows=[['filename','compound','host_mineral','mol_kg','phase','temperature_C','host_subtracted','host_reference','host_scale','baseline_mode','fit_profile','peak','selected_cm-1','fitted_cm-1','height','fwhm_cm-1','eta','area','numerator_selected','denominator_selected','numerator_area_sum','denominator_area_sum','area_ratio','r2','rmse']];r.peaks.forEach((p,i)=>rows.push([s.name,s.meta.compound,s.meta.hostMineral,s.meta.mol,s.meta.phase,s.meta.temp,!!s.processing?.host?.enabled,s.processing?.host?.referenceName||'',s.processing?.host?.scale??'',$('baselineMethod').value,r.profile,i+1,r.seedXs?.[i]??p.c,p.c,p.h,p.w,r.profile==='pseudo'?p.eta:r.profile==='lorentzian'?1:0,peakArea(p,r.profile),ratioNumerator.has(i),ratioDenominator.has(i),numArea,denArea,ratio,r.r2,r.rmse]));download('raman_analysis.csv',new Blob([rows.map(row=>row.map(csvVal).join(',')).join('\n')],{type:'text/csv'}));};

function renderPlot(){
 let s=current();if(!s){$('plot').innerHTML='<div style="padding:70px;text-align:center;color:#7b8da3">Load and select a spectrum to begin analysis</div>';lastSvg='';return;}let y=activeY(),xmin=$('xMin').value===''?s.x[0]:Number($('xMin').value),xmax=$('xMax').value===''?s.x.at(-1):Number($('xMax').value);if(xmax<xmin)[xmin,xmax]=[xmax,xmin];let idx=s.x.map((x,i)=>i).filter(i=>s.x[i]>=xmin&&s.x[i]<=xmax);if(idx.length<2)return;let vals=idx.map(i=>y[i]),ylo=Math.min(...vals),yhi=Math.max(...vals),pad=(Number($('yPad').value)||8)/100*(yhi-ylo||1),residualSpace=$('showResidual').checked&&fitResult?130:0,w=1240,h=680+residualSpace,left=82,right=1170,top=55,bottom=610,YY=v=>bottom-(v-(ylo-pad))/Math.max(1e-12,(yhi+pad)-(ylo-pad))*(bottom-top),XX=x=>left+(x-xmin)/(xmax-xmin)*(right-left);plotGeometry={xmin,xmax,left,right};let out=['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+w+' '+h+'" width="'+w+'" height="'+h+'" style="background:white"><rect width="100%" height="100%" fill="white"/>'];for(let x=Math.ceil(xmin/500)*500;x<=xmax;x+=500){let xx=XX(x);out.push('<line x1="'+xx+'" y1="'+top+'" x2="'+xx+'" y2="'+bottom+'" stroke="#e9edf3"/><text x="'+xx+'" y="'+(bottom+26)+'" text-anchor="middle" font-size="12" fill="#53667d">'+x+'</text>');}out.push('<line x1="'+left+'" y1="'+top+'" x2="'+left+'" y2="'+bottom+'" stroke="#718399"/><line x1="'+left+'" y1="'+bottom+'" x2="'+right+'" y2="'+bottom+'" stroke="#718399"/>');let path=(xs,ys,map)=>xs.map((x,i)=>(i?'L':'M')+XX(x).toFixed(2)+' '+map(ys[i]).toFixed(2)).join(' '),xs=idx.map(i=>s.x[i]);if(preview)out.push('<path d="'+path(xs,idx.map(i=>s.working[i]),YY)+'" stroke="#aab3be" stroke-width="1.2" fill="none"/>');out.push('<path d="'+path(xs,vals,YY)+'" stroke="#315cc6" stroke-width="1.5" fill="none"/>');let visibleSeeds=seeds.filter(c=>c>=xmin&&c<=xmax).sort((a,b)=>a-b),placedSeedLabels=[];
for(let si=0;si<visibleSeeds.length;si++){
 const c=visibleSeeds[si],xx=XX(c);
 let nearest=idx[0],dist=Infinity;
 for(const k of idx){let d=Math.abs(s.x[k]-c);if(d<dist){dist=d;nearest=k;}}
 const peakY=YY(y[nearest]);
 let level=0;
 while(placedSeedLabels.some(p=>Math.abs(p.x-xx)<74&&p.level===level))level++;
 placedSeedLabels.push({x:xx,level});
 let labelY=peakY-30-level*27;
 if(labelY<top+20)labelY=Math.min(bottom-24,peakY+34+level*27);
 let labelX=xx+(level%2?(level%4===1?12:-12):0),text=c.toFixed(1),boxW=Math.max(48,text.length*8.2+14),boxH=23;
 labelX=Math.max(left+boxW/2+3,Math.min(right-boxW/2-3,labelX));
 out.push('<line x1="'+xx+'" y1="'+top+'" x2="'+xx+'" y2="'+bottom+'" stroke="#d05a43" stroke-width="1" stroke-opacity=".52" stroke-dasharray="3 4"/>');
 out.push('<path d="M'+labelX+' '+(labelY+boxH/2)+' L'+xx+' '+Math.max(top+3,Math.min(bottom-3,peakY))+'" stroke="#d05a43" stroke-width="1.15" fill="none" opacity=".9"/>');
 out.push('<rect x="'+(labelX-boxW/2)+'" y="'+(labelY-boxH/2)+'" width="'+boxW+'" height="'+boxH+'" rx="5" fill="white" fill-opacity=".96" stroke="#d05a43" stroke-width="1"/>');
 out.push('<text x="'+labelX+'" y="'+(labelY+5)+'" text-anchor="middle" fill="#b94735" font-family="sans-serif" font-size="14" font-weight="700">'+text+'</text>');
}if(fitResult){let r=fitResult;if($('showComponents').checked)r.peaks.forEach((p,j)=>out.push('<path d="'+path(r.xs,r.xs.map(x=>r.offset+peakValue(x,p,r.profile)),YY)+'" stroke="'+COLORS[(j+1)%COLORS.length]+'" stroke-width="1.1" stroke-dasharray="5 3" fill="none"/>'));out.push('<path d="'+path(r.xs,r.fit,YY)+'" stroke="#232323" stroke-width="2.2" fill="none"/>');if($('showResidual').checked){let rt=650,rb=h-45,rm=Math.max(...r.residual.map(Math.abs),1e-12),RY=v=>(rt+rb)/2-v/rm*(rb-rt)*.42;out.push('<line x1="'+left+'" y1="'+RY(0)+'" x2="'+right+'" y2="'+RY(0)+'" stroke="#b9c2ce"/><text x="'+left+'" y="'+(rt-8)+'" font-size="12" fill="#53677d">Residual</text><path d="'+path(r.xs,r.residual,RY)+'" stroke="#6b7280" stroke-width="1.2" fill="none"/>');}}out.push('<text x="'+((left+right)/2)+'" y="'+(bottom+58)+'" text-anchor="middle" font-size="17">Raman shift (cm⁻¹)</text><text transform="translate(24 '+((top+bottom)/2)+') rotate(-90)" text-anchor="middle" font-size="17">Intensity (a.u.)</text></svg>');lastSvg=out.join('');$('plot').innerHTML=lastSvg;
}
$('plot').onclick=e=>{if(!pickMode||!plotGeometry||!current())return;let svg=$('plot').querySelector('svg'),rect=svg.getBoundingClientRect(),vx=(e.clientX-rect.left)*svg.viewBox.baseVal.width/rect.width;if(vx<plotGeometry.left||vx>plotGeometry.right)return;let x=plotGeometry.xmin+(vx-plotGeometry.left)/(plotGeometry.right-plotGeometry.left)*(plotGeometry.xmax-plotGeometry.xmin),s=current(),nearest=s.x.reduce((best,v)=>Math.abs(v-x)<Math.abs(best-x)?v:best,s.x[0]),i=seeds.findIndex(v=>Math.abs(v-nearest)<=Math.max(2,(plotGeometry.xmax-plotGeometry.xmin)*.004));if(i>=0)seeds.splice(i,1);else if(seeds.length<10)seeds.push(nearest);seeds.sort((a,b)=>a-b);fitResult=null;ratioNumerator.clear();ratioDenominator.clear();renderSeeds();renderFit();renderPlot();};
for(const id of ['xMin','xMax','yPad','showComponents','showResidual'])$(id).addEventListener('input',renderPlot);
for(const id of ['fitMin','fitMax','autoPeakProminence','autoPeakDistance'])$(id).addEventListener('input',()=>{fitResult=null;ratioNumerator.clear();ratioDenominator.clear();renderFit();renderPlot();});
$('autoRange').onclick=()=>{$('xMin').value='';$('xMax').value='';renderPlot();};
$('exportSvg').onclick=()=>{if(lastSvg)download('raman_analysis.svg',new Blob([lastSvg],{type:'image/svg+xml'}));};
$('exportPng').onclick=()=>{if(!lastSvg)return;let blob=new Blob([lastSvg],{type:'image/svg+xml;charset=utf-8'}),url=URL.createObjectURL(blob),im=new Image;im.onload=()=>{let c=document.createElement('canvas');c.width=2200;c.height=Math.round(2200*im.height/im.width);let ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(im,0,0,c.width,c.height);c.toBlob(b=>download('raman_analysis.png',b),'image/png');URL.revokeObjectURL(url);};im.src=url;};

renderList();renderSeeds();renderFit();renderPlot();renderApprovedPreview();