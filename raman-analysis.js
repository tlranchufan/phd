'use strict';
const $=id=>document.getElementById(id);
let spectra=[],uid=0,currentId=null,preview=null,fitResult=null,seeds=[],pickMode=false,lastSvg='',plotGeometry=null,datasetGeneration=0,manualDrawMode=false,manualDragIndex=null;const ratioNumerator=new Set(),ratioDenominator=new Set();
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
 spectra.push({id:++uid,name,meta:meta||metadata(name),x,raw:y,working:w,modified:Array.isArray(extra.modified)?extra.modified.slice():[],reviewed:extra.reviewed===true,approved:extra.approved===true,processing:extra.processing||null,fit:extra.fit||null,preparedHost:extra.preparedHost===true,preparedHostBaseline:Array.isArray(extra.preparedHostBaseline)?extra.preparedHostBaseline.slice():null,manualBaselinePoints:cleanManualPoints(extra.manualBaselinePoints||extra.processing?.manualPoints||[])});if(currentId===null)currentId=uid;
}
function current(){return spectra.find(s=>s.id===currentId)||null;}
function renderList(){
 $('clearDataset').disabled=!spectra.length;
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
 ss.forEach((s,ri)=>{let ids=s.x.map((x,i)=>i).filter(i=>s.x[i]>=xmin&&s.x[i]<=xmax),vals=ids.map(i=>s.working[i]),lo=Math.min(...vals),hi=Math.max(...vals),span=hi-lo||1,base=top+ri*row+28,path=ids.map((i,j)=>(j?'L':'M')+XX(s.x[i]).toFixed(2)+' '+(base-(s.working[i]-lo)/span*28).toFixed(2)).join(' ');out.push('<path d="'+path+'" stroke="'+COLORS[ri%COLORS.length]+'" stroke-width="1.25" fill="none"/><text x="'+(left-10)+'" y="'+(base-8)+'" text-anchor="end" font-size="11" fill="#43546b">'+esc(s.name)+'</text>');});
 out.push('<text x="'+((left+right)/2)+'" y="'+(h-8)+'" text-anchor="middle" font-size="14">Raman shift (cm⁻¹)</text></svg>');host.innerHTML=out.join('');
}
function chooseSpectrum(id){manualDrawMode=false;manualDragIndex=null;currentId=Number(id);preview=null;let s=current();restoreStoredFit(s);syncProcessingControlsFromSpectrum(s);pickMode=false;$('pickPeaks').classList.remove('primary');$('pickPeaks').textContent='Pick centres on plot';renderList();syncRanges();renderSeeds();renderFit();renderPlot();renderApprovedPreview();if(!s?.processing)refreshProcessingPreview();}
$('spectrumList').onclick=e=>{let id=e.target.closest('[data-spectrum]')?.dataset.spectrum;if(id)chooseSpectrum(id);};
$('search').oninput=renderList;

$('clearDataset').onclick=()=>{
 if(!spectra.length||!window.confirm('Clear all '+spectra.length+' loaded spectra and reset the processing workspace? Unsaved processing, reviews and fits will be lost. Save the processed dataset first if needed.'))return;
 datasetGeneration++;
 spectra=[];uid=0;currentId=null;preview=null;fitResult=null;seeds=[];pickMode=false;manualDrawMode=false;manualDragIndex=null;lastSvg='';plotGeometry=null;
 ratioNumerator.clear();ratioDenominator.clear();
 $('upload').value='';$('openCompiled').value='';$('search').value='';
 $('xMin').value='';$('xMax').value='';$('yPad').value=8;
 $('fitMin').value='';$('fitMax').value='';$('fitMode').value='standard';
 $('autoPeaks').checked=true;$('autoPeakProminence').value=5;$('autoPeakDistance').value=10;
 $('profile').value='pseudo';$('fitBaseline').value='constant';$('fitIterations').value=120;$('initialWidth').value=12;
 $('showComponents').checked=true;$('showResidual').checked=true;
 $('regionNumMin').value=2800;$('regionNumMax').value=3300;$('regionDenMin').value=3300;$('regionDenMax').value=3800;
 $('pickPeaks').classList.remove('primary');$('pickPeaks').textContent='Pick centres on plot';$('fitPeaks').disabled=false;
 $('applyProcessing').disabled=true;$('discardProcessing').disabled=true;
 $('hostReference').dataset.hostTarget='';
 syncProcessingControlsFromSpectrum(null);updateFitModeUi(false);
 $('processingStatus').textContent='';$('loadStatus').textContent='No spectra loaded.';
 renderList();renderSeeds();renderFit();renderPlot();renderApprovedPreview();
};

$('upload').onchange=async e=>{
 const generation=datasetGeneration;
 let good=0,errors=[];for(const f of [...e.target.files]){try{let raw=/\.wdf$/i.test(f.name)?readWdf(await f.arrayBuffer()):readTxt(await f.text());if(generation!==datasetGeneration)return;addSpectrum(f.name,raw,metadata(f.name));good++;}catch(err){errors.push(f.name+': '+err.message);}}
 if(generation!==datasetGeneration)return;
 $('loadStatus').textContent=good+' imported'+(errors.length?' · '+errors.length+' failed':'')+'.';e.target.value='';renderList();syncRanges();syncProcessingControlsFromSpectrum(current());renderPlot();if(!current()?.processing)refreshProcessingPreview();
};
$('openCompiled').onchange=async e=>{
 const generation=datasetGeneration,f=e.target.files?.[0];if(!f)return;try{let data=JSON.parse(await f.text());if(generation!==datasetGeneration)return;if(Array.isArray(data.analysisRegions)&&data.analysisRegions.length===4&&data.analysisRegions.every(Number.isFinite)){['regionNumMin','regionNumMax','regionDenMin','regionDenMax'].forEach((id,i)=>$(id).value=String(data.analysisRegions[i]));renderRegionIntegration();}if(data.format!=='raman-studio-v1'||!Array.isArray(data.spectra))throw Error('Unsupported compiled Raman dataset');let count=0;for(const a of data.spectra){if(!Array.isArray(a.x)||!Array.isArray(a.raw))continue;addSpectrum(a.name||('Spectrum '+(count+1)),{x:a.x,y:a.raw},a.meta||metadata(a.name||''),Array.isArray(a.corrected)?a.corrected:null,a);count++;}$('loadStatus').textContent='Loaded '+count+' spectra from '+f.name+'.';renderList();syncRanges();syncProcessingControlsFromSpectrum(current());renderPlot();if(!current()?.processing)refreshProcessingPreview();}catch(err){if(generation===datasetGeneration)$('loadStatus').textContent='Import failed: '+err.message;}finally{if(generation===datasetGeneration)e.target.value='';}
};

function cosmic(y,x){
 const n=y.length,flagged=new Uint8Array(n),median=a=>{let s=a.slice().sort((p,q)=>p-q);return s[Math.floor(s.length/2)]};
 for(let i=4;i<n-4;i++){let neighbors=[...y.slice(i-4,i-1),...y.slice(i+2,i+5)],m=median(neighbors),sigma=1.4826*median(neighbors.map(v=>Math.abs(v-m))),local=Math.max(sigma,Math.sqrt(Math.max(1,Math.abs(m)))*.65,2);if(y[i]-m>8*local&&y[i]>(y[i-1]+y[i+1])/2+6*local)flagged[i]=1;}
 const medianFilter=(a,width)=>{let half=Math.floor(width/2),out=new Array(a.length);for(let i=0;i<a.length;i++){let w=[];for(let j=-half;j<=half;j++)w.push(a[Math.max(0,Math.min(a.length-1,i+j))]);w.sort((p,q)=>p-q);out[i]=w[half];}return out;};
 if(n>=105&&x&&x.length===n){let continuum=medianFilter(y,41),response=y.map((v,i)=>v-continuum[i]),near=medianFilter(y,11),hf=y.map((v,i)=>v-near[i]),trend=medianFilter(hf,101),noise=medianFilter(hf.map((v,i)=>Math.abs(v-trend[i])),101).map(v=>Math.max(1.4826*v,6)),seed=new Uint8Array(n),wings=new Uint8Array(n);for(let i=0;i<n;i++){let eligible=x[i]>=1500&&x[i]<=4150;if(eligible&&response[i]>Math.max(7*noise[i],105))seed[i]=1;if(eligible&&response[i]>Math.max(2.7*noise[i],23))wings[i]=1;}for(let i=0;i<n;i++){if(!seed[i])continue;let a=i,b=i;while(a>1&&a>i-25&&wings[a-1])a--;while(b<n-2&&b<i+25&&wings[b+1])b++;if(b-a+1<=20)for(let j=a;j<=b;j++)flagged[j]=1;}}
 let corrected=y.slice(),modified=[];for(let i=0;i<n;i++){if(!flagged[i])continue;let start=i;while(i+1<n&&flagged[i+1])i++;let end=i;if(start<1||end>=n-1)continue;let x0=x?.[start-1]??start-1,x1=x?.[end+1]??end+1;for(let j=start;j<=end;j++){let xj=x?.[j]??j;corrected[j]=y[start-1]+(y[end+1]-y[start-1])*(xj-x0)/(x1-x0);modified.push(j);}}return {corrected,modified};
}
function sgSmooth(y,w){const c={5:[-3,12,17,12,-3].map(v=>v/35),7:[-2,3,6,7,6,3,-2].map(v=>v/21),9:[-21,14,39,54,59,54,39,14,-21].map(v=>v/231)}[w];if(!c||y.length<w)return y.slice();let h=Math.floor(w/2),out=y.slice();for(let i=h;i<y.length-h;i++){let v=0;for(let j=-h;j<=h;j++)v+=y[i+j]*c[j+h];out[i]=v;}return out;}
// A shape-preserving piecewise cubic curve avoids overshoot between manual anchors.
function cleanManualPoints(points){
 if(!Array.isArray(points))return [];
 const sorted=points.map(p=>({x:Number(p?.x),y:Number(p?.y)})).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)).sort((a,b)=>a.x-b.x);
 return sorted.filter((p,i)=>!i||p.x-sorted[i-1].x>1e-6).slice(0,40);
}
function manualBaselineFunction(points){
 const p=cleanManualPoints(points),n=p.length;
 if(n<2)return null;
 const h=[],d=[];
 for(let i=0;i<n-1;i++){h.push(p[i+1].x-p[i].x);d.push((p[i+1].y-p[i].y)/h[i]);}
 const m=new Array(n);
 m[0]=d[0];m[n-1]=d[n-2];
 for(let i=1;i<n-1;i++){
  if(d[i-1]*d[i]<=0)m[i]=0;
  else{let w1=2*h[i]+h[i-1],w2=h[i]+2*h[i-1];m[i]=(w1+w2)/(w1/d[i-1]+w2/d[i]);}
 }
 return x=>{
  if(x<p[0].x||x>p[n-1].x)return null; // No unconstrained extrapolation.
  if(x===p[n-1].x)return p[n-1].y;
  let lo=0,hi=n-1;
  while(lo+1<hi){let mid=(lo+hi)>>1;if(p[mid].x<=x)lo=mid;else hi=mid;}
  let t=(x-p[lo].x)/h[lo],t2=t*t,t3=t2*t;
  return (2*t3-3*t2+1)*p[lo].y+(t3-2*t2+t)*h[lo]*m[lo]+(-2*t3+3*t2)*p[lo+1].y+(t3-t2)*h[lo]*m[lo+1];
 };
}
function manualBaselineSeries(xs,points){
 const at=manualBaselineFunction(points);
 return at?xs.map(x=>at(x)??0):null;
}
function manualOverlayPath(s){
 if(!s||!plotGeometry)return '';
 const at=manualBaselineFunction(s.manualBaselinePoints);
 if(!at)return '';
 const p=cleanManualPoints(s.manualBaselinePoints),g=plotGeometry,lo=Math.max(g.xmin,p[0].x),hi=Math.min(g.xmax,p.at(-1).x);
 if(hi<=lo)return '';
 const XX=x=>g.left+(x-g.xmin)/(g.xmax-g.xmin)*(g.right-g.left),
  YY=y=>g.bottom-(y-g.ymin)/(g.ymax-g.ymin)*(g.bottom-g.top);
 const count=Math.min(700,Math.max(2,Math.ceil((hi-lo)/2)));
 return Array.from({length:count+1},(_,i)=>{let x=lo+(hi-lo)*i/count;return (i?'L':'M')+XX(x).toFixed(2)+' '+YY(at(x)).toFixed(2);}).join(' ');
}
function updateManualOverlayOnly(){
 const s=current(),svg=$('plot').querySelector('svg'),g=plotGeometry;
 if(!s||!svg||!g)return;
 const path=svg.querySelector('.manual-baseline-curve');
 if(path)path.setAttribute('d',manualOverlayPath(s));
 const XX=x=>g.left+(x-g.xmin)/(g.xmax-g.xmin)*(g.right-g.left),
  YY=y=>g.bottom-(y-g.ymin)/(g.ymax-g.ymin)*(g.bottom-g.top);
 for(const circle of svg.querySelectorAll('[data-baseline-index]')){
  const p=s.manualBaselinePoints[Number(circle.dataset.baselineIndex)];
  if(p){circle.setAttribute('cx',XX(p.x));circle.setAttribute('cy',YY(p.y));}
 }
}
function updateManualModeUi(){
 const manual=$('baselineMethod').value==='manual',btn=$('editBaseline');
 if(!manual)manualDrawMode=false;
 $('manualBaselineTools').style.display=manual?'grid':'none';
 btn.textContent=manualDrawMode?'Finish drawing':'Draw on spectrum';
 btn.classList.toggle('primary',manualDrawMode);
 $('plot').style.touchAction=manualDrawMode?'none':'';
 $('plot').style.cursor=manualDrawMode?'crosshair':'';
}
function plotPointerCoords(e){
 const svg=$('plot').querySelector('svg'),g=plotGeometry;
 if(!svg||!g)return null;
 const rect=svg.getBoundingClientRect(),vb=svg.viewBox.baseVal;
 if(!rect.width||!rect.height)return null;
 const xx=(e.clientX-rect.left)*vb.width/rect.width,yy=(e.clientY-rect.top)*vb.height/rect.height;
 if(xx<g.left||xx>g.right||yy<g.top||yy>g.bottom)return null;
 return {x:g.xmin+(xx-g.left)/(g.right-g.left)*(g.xmax-g.xmin),
  y:g.ymax-(yy-g.top)/(g.bottom-g.top)*(g.ymax-g.ymin)};
}
$('editBaseline').onclick=()=>{
 if(!current()){$('processingStatus').textContent='Load a spectrum before drawing a baseline.';return;}
 if($('baselineMethod').value!=='manual'){$('baselineMethod').value='manual';updateBaselineUi();refreshProcessingPreview();}
 manualDrawMode=!manualDrawMode;pickMode=false;
 $('pickPeaks').classList.remove('primary');$('pickPeaks').textContent='Pick centres on plot';
 updateManualModeUi();renderPlot();
};
$('clearBaselinePoints').onclick=()=>{
 let s=current();if(!s)return;
 s.manualBaselinePoints=[];refreshProcessingPreview();
};
$('plot').addEventListener('pointerdown',e=>{
 if(!manualDrawMode||!current()||e.button!==0)return;
 let coords=plotPointerCoords(e);if(!coords)return;
 const s=current(),points=s.manualBaselinePoints;
 let pointIndex=Number(e.target.closest('[data-baseline-index]')?.dataset.baselineIndex);
 if(!e.target.closest('[data-baseline-index]')||!Number.isInteger(pointIndex)||pointIndex<0||pointIndex>=points.length){
  if(points.length>=40){$('processingStatus').textContent='Maximum 40 manual baseline anchors.';return;}
  pointIndex=points.findIndex(p=>Math.abs(p.x-coords.x)<3);
  if(pointIndex<0){pointIndex=points.findIndex(p=>p.x>coords.x);if(pointIndex<0)pointIndex=points.length;points.splice(pointIndex,0,coords);}
 }
 manualDragIndex=pointIndex;
 e.preventDefault();renderPlot();
});
document.addEventListener('pointermove',e=>{
 if(manualDragIndex===null||!manualDrawMode||!current())return;
 const coords=plotPointerCoords(e);if(!coords)return;
 const p=current().manualBaselinePoints,i=manualDragIndex,g=plotGeometry;
 p[i]={x:Math.max(i? p[i-1].x+2:g.xmin,Math.min(i<p.length-1?p[i+1].x-2:g.xmax,coords.x)),y:coords.y};
 updateManualOverlayOnly();
});
function finishManualDrag(){
 if(manualDragIndex===null)return;
 manualDragIndex=null;
 refreshProcessingPreview();
}
document.addEventListener('pointerup',finishManualDrag);
document.addEventListener('pointercancel',finishManualDrag);
$('plot').addEventListener('contextmenu',e=>{
 if(!manualDrawMode||!current())return;
 const pts=current().manualBaselinePoints,c=plotPointerCoords(e);
 if(!c)return;
 e.preventDefault();
 const k=pts.findIndex(p=>Math.abs(p.x-c.x)<Math.max(8,(plotGeometry.xmax-plotGeometry.xmin)*.01)&&
  Math.abs(p.y-c.y)<(plotGeometry.ymax-plotGeometry.ymin)*.05);
 if(k>=0){pts.splice(k,1);refreshProcessingPreview();}
});

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
function normSampleKey(v){return String(v??'').trim().toLowerCase().replace(/[‐‑–—]/g,'-').replace(/\s+/g,'');}
function filenameSampleKey(s){
 let n=String(s?.name||'').replace(/\.(?:wdf|txt|csv)$/i,'').replace(/^output_/i,''),m=n.match(/^(.+?)-(?:liq(?:uid)?|vap(?:our|or)?|dc|crn|cor|corundum|qtz|qz|quartz|qt|cc|cal|calc|calcite|melt\d*|white\d*|solid|gas)(?:[-_（(]|$)/i);
 return normSampleKey(m?.[1]||'');
}
function sampleKey(s){
 let sid=normSampleKey(s?.meta?.sampleId||'');if(sid)return sid;
 let compound=normSampleKey(s?.meta?.compound||''),mol=normSampleKey(s?.meta?.mol||''),sample=normSampleKey(s?.meta?.sample||'');
 if(compound||mol||sample)return [compound,mol,sample].join('|');
 return filenameSampleKey(s);
}
function runState(s){
 let t=(String(s?.name||'')+' '+String(s?.meta?.condition||'')).toLowerCase();
 if(/after\s*[-_ ]?\s*run|afterrun/.test(t))return 'after';
 if(/(^|[^a-z])th(?:[^a-z]|$)/.test(t))return 'th';
 return 'normal';
}
function finiteMetaNumber(s,key){let v=Number(s?.meta?.[key]);return Number.isFinite(v)?v:null;}
function hostMatchScore(target,cand){
 let tm=target?.meta||{},cm=cand?.meta||{},score=0,tr=runState(target),cr=runState(cand);
 score+=tr===cr?5000:-1500;
 let tt=finiteMetaNumber(target,'temp'),ct=finiteMetaNumber(cand,'temp');
 if(tt!==null&&ct!==null){let d=Math.abs(tt-ct);score+=d<.5?4000:Math.max(0,1200-d*8);}
 for(const [key,w] of [['objective',500],['power',400],['seconds',350],['accum',300],['hostMineral',250]]){
  let a=normSampleKey(tm[key]),b=normSampleKey(cm[key]);if(a&&b&&a===b)score+=w;
 }
 return score;
}
function hostCandidates(s){
 if(!s)return [];
 let all=spectra.filter(v=>v.id!==s.id&&isHostReference(v)),key=sampleKey(s),compound=normSampleKey(s.meta?.compound),mol=normSampleKey(s.meta?.mol),host=normSampleKey(s.meta?.hostMineral),filtered;
 if(key)filtered=all.filter(v=>sampleKey(v)===key);
 else filtered=all.filter(v=>(!compound||normSampleKey(v.meta?.compound)===compound)&&(!mol||normSampleKey(v.meta?.mol)===mol)&&(!host||normSampleKey(v.meta?.hostMineral)===host));
 return filtered.sort((a,b)=>hostMatchScore(s,b)-hostMatchScore(s,a)||a.name.localeCompare(b.name));
}
function autoHostReference(s){
 let c=hostCandidates(s);
 return c[0]||null;
}
function selectedHostReference(){
 let id=Number($('hostReference').value);return spectra.find(s=>s.id===id)||null;
}
function updateHostUi(){
 let s=current(),box=$('subtractHost'),fields=$('hostSubtractFields'),select=$('hostReference'),cands=hostCandidates(s),targetKey=String(s?.id??''),sameTarget=select.dataset.hostTarget===targetKey,was=sameTarget?Number(select.value):NaN,storedName=s?.processing?.host?.referenceName||'',auto=autoHostReference(s);
 select.replaceChildren(...cands.map(v=>new Option(v.name+(v.preparedHost?' · prepared':''),String(v.id))));
 let chosen=(sameTarget?cands.find(v=>v.id===was):null)||cands.find(v=>v.name===storedName)||auto;
 if(chosen)select.value=String(chosen.id);
 select.dataset.hostTarget=targetKey;
 let selfHost=isHostReference(s),ready=!!chosen?.preparedHost,bgReady=ready&&Array.isArray(chosen?.preparedHostBaseline)&&chosen.preparedHostBaseline.length===chosen.x.length;
 box.disabled=selfHost||!cands.length||!ready;
 if(box.disabled&&box.checked)box.checked=false;
 fields.style.display=(box.checked||$('subtractHostBackground').checked)&&!selfHost&&!!cands.length?'grid':'none';
 $('hostScale').disabled=$('hostScaleMode').value!=='manual';
 $('subtractHostBackground').disabled=selfHost||!bgReady;
 if($('subtractHostBackground').disabled&&$('subtractHostBackground').checked)$('subtractHostBackground').checked=false;
 $('hostBackgroundFields').style.display=$('subtractHostBackground').checked&&!$('subtractHostBackground').disabled?'grid':'none';
 $('hostBgScale').disabled=$('hostBgScaleMode').value!=='manual';
 if($('hostPrepStatus')){
  if(!s)$('hostPrepStatus').textContent='';
  else if(selfHost)$('hostPrepStatus').textContent=s?.preparedHost?'Prepared host ✓ · '+(s.processing?.baseline==='already'?'already corrected before import':s.processing?.baseline||'baseline corrected'):'Host reference · choose a baseline correction (or Already corrected) and Apply to prepare it for subtraction.';
  else if(!cands.length)$('hostPrepStatus').textContent='No host reference found for sample '+(s?.meta?.sampleId||s?.meta?.sample||filenameSampleKey(s)||'unknown')+'.';
  else if(!ready){let sameTemp=finiteMetaNumber(s,'temp')!==null&&finiteMetaNumber(chosen,'temp')!==null&&Math.abs(finiteMetaNumber(s,'temp')-finiteMetaNumber(chosen,'temp'))<.5,sameRun=runState(s)===runState(chosen);$('hostPrepStatus').textContent='Matched '+chosen.name+(sameTemp&&sameRun?'':' · closest available host condition')+', but it is not prepared yet. Open that host spectrum, choose a baseline correction (or Already corrected), then Apply.';}
  else {let bands=hostPeakBands(chosen.x,chosen.working),tt=finiteMetaNumber(s,'temp'),ht=finiteMetaNumber(chosen,'temp'),mismatch=tt!==null&&ht!==null&&Math.abs(tt-ht)>30;$('hostPrepStatus').textContent='Prepared host: '+chosen.name+' · '+bands.length+' narrow band(s) detected across the full Raman range. Broad features (>110 cm⁻¹ FWHM) are protected.'+(mismatch?' Caution: host '+ht+' °C vs sample '+tt+' °C; their broad background shapes may differ.':'');}
 }
 if($('hostStatus'))$('hostStatus').textContent=chosen&&ready?'Host peak subtraction: overlap-aware joint fitting of narrow bands below 2500 cm⁻¹; conservative OH-safe subtraction above 2500 cm⁻¹.':'';
 if($('hostBgStatus')){
  if(selfHost)$('hostBgStatus').textContent='';
  else if(chosen&&!bgReady)$('hostBgStatus').textContent='Prepared host peaks are available. Separate host-background subtraction requires a saved baseline curve; none is available for this host.';
  else if(bgReady)$('hostBgStatus').textContent='Host background shape will be scaled outside the OH region and subtracted separately from the narrow host peaks.';
  else $('hostBgStatus').textContent='';
 }
}
function interpolateSeries(xs,ys,targetX){
 let out=new Array(targetX.length).fill(NaN),j=0;if(!xs?.length||xs.length!==ys?.length)return out;
 for(let i=0;i<targetX.length;i++){let x=targetX[i];while(j+1<xs.length&&xs[j+1]<x)j++;if(x<xs[0]||x>xs.at(-1))continue;if(xs[j]===x){out[i]=ys[j];continue;}let k=Math.min(j+1,xs.length-1),dx=xs[k]-xs[j];out[i]=dx?ys[j]+(ys[k]-ys[j])*(x-xs[j])/dx:ys[j];}
 return out;
}
function medianArray(a){let v=a.filter(Number.isFinite).slice().sort((x,y)=>x-y);if(!v.length)return 0;let m=Math.floor(v.length/2);return v.length%2?v[m]:(v[m-1]+v[m])/2;}
function quantileArray(a,q){let v=a.filter(Number.isFinite).slice().sort((x,y)=>x-y);if(!v.length)return 0;let p=Math.max(0,Math.min(1,q))*(v.length-1),i=Math.floor(p),f=p-i;return v[i]+(v[Math.min(i+1,v.length-1)]-v[i])*f;}
function hostPeakBands(x,y){
 if(!x?.length||x.length!==y?.length)return [];
 let valid=[];for(let i=1;i<y.length;i++)if(x[i]>=150&&Number.isFinite(y[i])&&Number.isFinite(y[i-1]))valid.push(y[i]-y[i-1]);
 let dmed=medianArray(valid),noise=Math.max(1e-9,1.4826*medianArray(valid.map(v=>Math.abs(v-dmed)))/Math.SQRT2);
 let region=y.filter((v,i)=>x[i]>=150&&Number.isFinite(v)),lo=quantileArray(region,.08),hi=quantileArray(region,.995),dynamic=Math.max(1e-9,hi-lo),threshold=Math.max(7*noise,.012*dynamic),cand=[];
 for(let i=2;i<y.length-2;i++){
  if(x[i]<150||!Number.isFinite(y[i])||!(y[i]>y[i-1]&&y[i]>=y[i+1]))continue;
  let left=i,right=i;
  while(left>0&&x[i]-x[left]<160)left--;
  while(right<y.length-1&&x[right]-x[i]<160)right++;
  let leftVals=y.slice(left,i+1).filter(Number.isFinite),rightVals=y.slice(i,right+1).filter(Number.isFinite);if(leftVals.length<4||rightVals.length<4)continue;
  let localBase=Math.max(Math.min(...leftVals),Math.min(...rightVals)),prom=y[i]-localBase;if(prom<threshold)continue;
  let half=localBase+prom*.5,l=i,r=i;
  while(l>left&&y[l]>half)l--;
  while(r<right&&y[r]>half)r++;
  if(l===left||r===right)continue;
  let fwhm=x[r]-x[l];if(!Number.isFinite(fwhm)||fwhm<1.5||fwhm>110)continue;
  cand.push({i,prom,fwhm});
 }
 cand.sort((a,b)=>b.prom-a.prom);let kept=[];
 for(const p of cand){
  if(kept.some(k=>Math.abs(x[k.i]-x[p.i])<Math.max(10,.45*Math.max(k.fwhm,p.fwhm))))continue;
  kept.push(p);if(kept.length>=30)break;
 }
 kept.sort((a,b)=>a.i-b.i);
 return kept.map(p=>({center:x[p.i],fwhm:p.fwhm,prominence:p.prom,halfWidth:Math.max(12,Math.min(90,p.fwhm*1.65+8))}));
}
function localDetrendedSignal(x,y,center,halfWidth){
 let idx=[];for(let i=0;i<x.length;i++)if(Math.abs(x[i]-center)<=halfWidth)idx.push(i);if(idx.length<8)return {idx,signal:idx.map(()=>0),baseline:idx.map(()=>0)};
 let edge=Math.max(3,Math.floor(idx.length*.22)),fitIdx=idx.slice(0,edge).concat(idx.slice(-edge)),scale=Math.max(1e-9,halfWidth),A=[[0,0,0],[0,0,0],[0,0,0]],b=[0,0,0];
 for(const i of fitIdx){let q=(x[i]-center)/scale,v=[1,q,q*q];for(let r=0;r<3;r++){b[r]+=v[r]*y[i];for(let k=0;k<3;k++)A[r][k]+=v[r]*v[k];}}
 let coeff=solveLinear(A,b)||[medianArray(fitIdx.map(i=>y[i])),0,0],baseline=idx.map(i=>{let q=(x[i]-center)/scale;return coeff[0]+coeff[1]*q+coeff[2]*q*q;});
 return {idx,baseline,signal:idx.map((i,j)=>y[i]-baseline[j])};
}
// Overlapping corundum bands are fitted as one local template so shared intensity
// cannot be subtracted repeatedly. The template is derived from the prepared host,
// not from an independently re-baselined liquid spectrum.
function mergeHostBands(bands){
 let groups=[];
 for(const band of bands.filter(b=>b.center<2500)){
  let lo=band.center-band.halfWidth,hi=band.center+band.halfWidth,last=groups.at(-1);
  if(last&&lo<=last.hi+2){last.hi=Math.max(last.hi,hi);last.bands.push(band);}
  else groups.push({lo,hi,bands:[band]});
 }
 return groups;
}
function detrendHostGroup(x,y,lo,hi){
 let idx=[],flank=[],span=20,mid=(lo+hi)/2;
 for(let i=0;i<x.length;i++){
  if(x[i]>=lo&&x[i]<=hi)idx.push(i);
  else if((x[i]>=lo-span&&x[i]<lo)||(x[i]>hi&&x[i]<=hi+span))flank.push(i);
 }
 if(idx.length<8||flank.length<12)return {idx:[],signal:[]};
 let z=flank.map(i=>x[i]-mid),mz=medianArray(z),my=medianArray(flank.map(i=>y[i])),
  num=0,den=0;
 for(let j=0;j<flank.length;j++){let q=z[j]-mz;num+=q*(y[flank[j]]-my);den+=q*q;}
 let slope=den>1e-12?num/den:0;
 return {idx,signal:idx.map(i=>y[i]-(my+slope*(x[i]-mid-mz)))};
}
function subtractOverlappingHostGroups(x,sampleY,template,bands,mode,manual){
 let out=sampleY.slice(),used=[];
 for(const group of mergeHostBands(bands)){
  let hs=detrendHostGroup(x,template,group.lo,group.hi),
      ss=detrendHostGroup(x,sampleY,group.lo,group.hi);
  if(hs.idx.length<8||hs.idx.length!==ss.idx.length)continue;
  let h=hs.signal.map(v=>Math.max(0,v)),hmax=Math.max(...h);
  if(hmax<=1e-12)continue;
  let num=0,den=0,ss2=0,core=0,caps=[];
  const diffs=[];
  for(let j=1;j<ss.signal.length;j++)diffs.push(ss.signal[j]-ss.signal[j-1]);
  let dm=medianArray(diffs),noise=Math.max(1,1.4826*medianArray(diffs.map(v=>Math.abs(v-dm)))/Math.SQRT2);
  for(let j=0;j<h.length;j++){
   if(h[j]>.20*hmax){num+=h[j]*ss.signal[j];den+=h[j]*h[j];ss2+=ss.signal[j]*ss.signal[j];core++;}
   if(h[j]>.30*hmax)caps.push((ss.signal[j]+Math.max(4,.5*noise))/h[j]);
  }
  if(core<5||den<=1e-12||!caps.length)continue;
  let corr=ss2>1e-12?num/Math.sqrt(den*ss2):0;
  if(mode==='auto'&&corr<.55)continue;
  let headroom=Math.max(0,quantileArray(caps,.15)*1.03),
      scale=Math.min(mode==='manual'?manual:Math.max(0,num/den),headroom,3);
  if(!(scale>0))continue;
  let edge=Math.min(8,(group.hi-group.lo)*.15);
  for(let j=0;j<hs.idx.length;j++){
   let i=hs.idx[j],dist=Math.min(x[i]-group.lo,group.hi-x[i]),taper=edge>0&&dist<edge?.5-.5*Math.cos(Math.PI*Math.max(0,dist)/edge):1;
   out[i]-=scale*h[j]*taper;
  }
  for(const band of group.bands)used.push({...band,scale,correlation:corr,grouped:true,groupSize:group.bands.length});
 }
 return {y:out,used};
}
function subtractHostSignal(sampleY,s){
 let host=selectedHostReference();if(!$('subtractHost').checked||$('subtractHost').disabled||!host?.preparedHost)return {y:sampleY.slice(),host:null,scale:null,bands:[]};
 let template=interpolateSeries(host.x,host.working,s.x).map(v=>Number.isFinite(v)?v:0),bands=hostPeakBands(s.x,template),mode=$('hostScaleMode').value,manual=Math.max(0,Number($('hostScale').value)||0),
 grouped=subtractOverlappingHostGroups(s.x,sampleY,template,bands,mode,manual),out=grouped.y,used=grouped.used;
 for(const band of bands){
  if(band.center<2500)continue; // Narrow lower-frequency bands have already been jointly subtracted.
  let hs=localDetrendedSignal(s.x,template,band.center,band.halfWidth),ss=localDetrendedSignal(s.x,sampleY,band.center,band.halfWidth);if(hs.idx.length<8||ss.idx.length!==hs.idx.length)continue;
  let num=0,den=0,ss2=0,hostPeak=0,samplePeak=0,centerJ=0,centerDist=Infinity;
  for(let j=0;j<hs.idx.length;j++){
   let hv=Math.max(0,hs.signal[j]),sv=ss.signal[j],dist=Math.abs(s.x[hs.idx[j]]-band.center);if(dist<centerDist){centerDist=dist;centerJ=j;}
   hostPeak=Math.max(hostPeak,hv);samplePeak=Math.max(samplePeak,sv);
   if(hv<=0)continue;num+=hv*sv;den+=hv*hv;ss2+=sv*sv;
  }
  if(hostPeak<=1e-12||den<=1e-12)continue;
  let corr=ss2>1e-12?num/Math.sqrt(den*ss2):0,centerHost=Math.max(0,hs.signal[centerJ]),centerSample=Math.max(0,ss.signal[centerJ]),aggressive=band.center<2500;
  let minCorr=aggressive?.45:.58;if(mode==='auto'&&(corr<minCorr||centerHost<=1e-12||centerSample<=0))continue;
  let rawScale=mode==='manual'?manual:Math.max(0,num/den),scale=0;
  if(mode==='manual')scale=manual;
  else if(aggressive){
   let centerCap=centerHost>1e-12?1.05*centerSample/centerHost:0,peakCap=1.05*Math.max(0,samplePeak)/hostPeak;
   scale=Math.min(rawScale,centerCap,peakCap,3);
  }else{
   let centerCap=centerHost>1e-12?.88*centerSample/centerHost:0,peakCap=.88*Math.max(0,samplePeak)/hostPeak;
   scale=Math.min(rawScale,centerCap,peakCap,2.5);
  }
  if(scale<=0)continue;
  for(let j=0;j<hs.idx.length;j++){
   let i=hs.idx[j],hv=Math.max(0,hs.signal[j]),d=Math.abs(s.x[i]-band.center)/band.halfWidth,taper=.5*(1+Math.cos(Math.PI*Math.min(1,d))),requested=scale*hv*taper,localSignal=Math.max(0,ss.signal[j]),localHeadroom=localSignal*(aggressive?1.02:.92);
   out[i]-=Math.min(requested,localHeadroom);
  }
  used.push({center:band.center,scale,correlation:corr,regime:aggressive?'aggressive':'OH-safe',halfWidth:band.halfWidth,fwhm:band.fwhm,prominence:band.prominence});
 }
 let scale=used.length?medianArray(used.map(v=>v.scale)):0;if(mode==='auto')$('hostScale').value=scale.toFixed(3);
 return {y:out,host,scale,bands:used};
}
function fitHostBackgroundScale(sampleY,s,host){
 let lo=Number($('hostBgMin').value),hi=Number($('hostBgMax').value);if(!Number.isFinite(lo))lo=1500;if(!Number.isFinite(hi))hi=2700;if(hi<lo)[lo,hi]=[hi,lo];
 let interp=interpolateSeries(host.x,host.preparedHostBaseline||[],s.x),idx=[];for(let i=0;i<s.x.length;i++)if(s.x[i]>=lo&&s.x[i]<=hi&&Number.isFinite(interp[i])&&Number.isFinite(sampleY[i]))idx.push(i);
 if(idx.length<20)return {scale:0,lo,hi,intercept:0,hostBaseline:interp,referencePoints:idx.length};
 let hmed=medianArray(idx.map(i=>interp[i])),xv=idx.map(i=>interp[i]-hmed),ymed=medianArray(idx.map(i=>sampleY[i])),yv=idx.map(i=>sampleY[i]-ymed),num=0,den=0;
 for(let j=0;j<idx.length;j++){num+=xv[j]*yv[j];den+=xv[j]*xv[j];}
 let scale=den>1e-18?Math.max(0,Math.min(20,num/den)):0;
 for(let iter=0;iter<3;iter++){
  let residual=idx.map((i,j)=>sampleY[i]-(ymed+scale*(interp[i]-hmed))),med=medianArray(residual),mad=Math.max(1e-9,1.4826*medianArray(residual.map(v=>Math.abs(v-med)))),keep=[];
  for(let j=0;j<idx.length;j++)if(Math.abs(residual[j]-med)<=2.8*mad)keep.push(idx[j]);
  if(keep.length<20)break;
  let hm=medianArray(keep.map(i=>interp[i])),ym=medianArray(keep.map(i=>sampleY[i]));num=0;den=0;
  for(const i of keep){let hx=interp[i]-hm,yy=sampleY[i]-ym;num+=hx*yy;den+=hx*hx;}
  if(den>1e-18){scale=Math.max(0,Math.min(20,num/den));hmed=hm;ymed=ym;idx=keep;}
 }
 return {scale,lo,hi,intercept:ymed,hmed,hostBaseline:interp,referencePoints:idx.length};
}
// Do not apply a low-frequency host continuum when its extrapolated shape
// would cause large negative residuals outside the OH integration range.
function hostBackgroundExtrapolationWarning(sampleY,s,host,fit,scale){
 if(!(scale>0)||fit.referencePoints<20)return '';
 const interp=fit.hostBaseline,hmed=Number.isFinite(fit.hmed)?fit.hmed:medianArray(interp.filter(Number.isFinite));
 let anchor=[],upper=[];
 for(let i=0;i<s.x.length;i++){
  if(!Number.isFinite(interp[i])||!Number.isFinite(sampleY[i]))continue;
  const x=s.x[i],v=sampleY[i]-scale*(interp[i]-hmed);
  if(x>=fit.lo&&x<=fit.hi)anchor.push(v);
  if(x>=3900&&x<=4150)upper.push(v);
 }
 if(anchor.length<20||upper.length<20)return '';
 const reference=medianArray(anchor),end=medianArray(upper);
 if(end>=-Math.max(100,.25*Math.abs(reference))||end-reference>=-.7*Math.max(150,Math.abs(reference)))return '';
 const sampleTemp=finiteMetaNumber(s,'temp'),hostTemp=finiteMetaNumber(host,'temp'),
  mismatch=sampleTemp!==null&&hostTemp!==null&&Math.abs(sampleTemp-hostTemp)>30;
 return 'Host background auto-fit skipped: extrapolation produces a strongly negative 3900–4150 cm⁻¹ residual ('+Math.round(end)+' a.u.).'
  +(mismatch?' The '+hostTemp+' °C reference and '+sampleTemp+' °C sample have different background shapes.':'')
  +' Use a sample-specific baseline or a temperature-matched host. Manual scaling remains available.';
}
function subtractHostBackground(sampleY,s){
 let host=selectedHostReference();if(!$('subtractHostBackground').checked||$('subtractHostBackground').disabled||!host?.preparedHostBaseline)return {y:sampleY.slice(),host:null,scale:null,lo:null,hi:null};
 let fit=fitHostBackgroundScale(sampleY,s,host),mode=$('hostBgScaleMode').value,scale=mode==='manual'?Math.max(0,Number($('hostBgScale').value)||0):fit.scale;
 if(mode==='auto')$('hostBgScale').value=Number.isFinite(scale)?scale.toFixed(3):'0';
 const warning=mode==='auto'?hostBackgroundExtrapolationWarning(sampleY,s,host,fit,scale):'';
 if(warning)return {y:sampleY.slice(),host:null,scale:null,lo:fit.lo,hi:fit.hi,warning};
 let interp=fit.hostBaseline,hmed=Number.isFinite(fit.hmed)?fit.hmed:medianArray(interp.filter(Number.isFinite)),y=sampleY.map((v,i)=>Number.isFinite(interp[i])?v-scale*(interp[i]-hmed):v);
 return {y,host,scale,lo:fit.lo,hi:fit.hi,referencePoints:fit.referencePoints};
}
function syncProcessingControlsFromSpectrum(s){
 if(!s?.processing){$('despike').checked=true;$('smooth').value='0';$('baselineMethod').value='none';$('lambda').value=1000000;$('asymmetry').value=.001;$('iterations').value=12;$('subtractHost').checked=false;$('hostScaleMode').value='auto';$('hostScale').value=1;$('subtractHostBackground').checked=false;$('hostBgScaleMode').value='auto';$('hostBgScale').value=1;$('hostBgMin').value=1500;$('hostBgMax').value=2700;updateBaselineUi();updateHostUi();return;}
 let p=s.processing;$('despike').checked=p.despike!==false;$('smooth').value=String(p.smoothing||0);$('baselineMethod').value=p.baseline||'none';$('lambda').value=p.lambda??1e6;$('asymmetry').value=p.p??.001;$('iterations').value=p.iterations??12;
 if(p.host){$('subtractHost').checked=p.host.enabled===true;$('hostScaleMode').value=p.host.scaleMode||'auto';$('hostScale').value=Number.isFinite(Number(p.host.scale))?Number(p.host.scale):1;$('subtractHostBackground').checked=p.host.backgroundEnabled===true;$('hostBgScaleMode').value=p.host.backgroundScaleMode||'auto';$('hostBgScale').value=Number.isFinite(Number(p.host.backgroundScale))?Number(p.host.backgroundScale):1;$('hostBgMin').value=Number.isFinite(Number(p.host.backgroundMin))?Number(p.host.backgroundMin):1500;$('hostBgMax').value=Number.isFinite(Number(p.host.backgroundMax))?Number(p.host.backgroundMax):2700;}else {$('subtractHost').checked=false;$('subtractHostBackground').checked=false;}
 updateBaselineUi();updateHostUi();
}
function updateBaselineUi(){
 let m=$('baselineMethod').value;
 $('lambdaField').style.display=(m==='als'||m==='airpls')?'grid':'none';
 $('pField').style.display=m==='als'?'grid':'none';
 $('iterationsField').style.display=(m==='als'||m==='airpls')?'grid':'none';
 $('alreadyBaselineHint').style.display=m==='already'?'block':'none';
 updateManualModeUi();
}
function runProcessing(s){
 let y=s.raw.slice(),spikes=[],settings={method:$('baselineMethod').value,lambda:Math.max(1,Number($('lambda').value)||1e6),p:Math.max(1e-6,Math.min(.49,Number($('asymmetry').value)||.001)),iterations:Math.max(1,Math.min(50,Number($('iterations').value)||12))},baseline=null;
 if($('despike').checked){let d=cosmic(y,s.x);y=d.corrected;spikes=d.modified;}
 let hostSub=subtractHostSignal(y,s);y=hostSub.y;
 let hostBg=subtractHostBackground(y,s);y=hostBg.y;
 let w=Number($('smooth').value)||0;if(w)y=sgSmooth(y,w);
 if(settings.method==='linear')baseline=linearEndpointBaseline(y);
 if(settings.method==='als')baseline=alsBaseline(y,settings.lambda,settings.p,settings.iterations);
 if(settings.method==='airpls')baseline=airPlsBaseline(y,settings.lambda,settings.iterations);
 const beforeBaseline=y.slice();
 let error='';
 if(settings.method==='manual'){
  baseline=manualBaselineSeries(s.x,s.manualBaselinePoints);
  if(!baseline)error='Place at least two manual baseline points on the spectrum before applying.';
 }
 if(baseline)y=y.map((v,i)=>v-baseline[i]);
 return {y,baseline,beforeBaseline,spikes,error,method:settings.method,settings,hostSub,hostBg};
}
function processingActive(){
 return $('despike').checked||($('subtractHost').checked&&!$('subtractHost').disabled)||($('subtractHostBackground').checked&&!$('subtractHostBackground').disabled)||Number($('smooth').value)!==0||$('baselineMethod').value!=='none';
}
function refreshProcessingPreview(){
 let s=current();if(!s)return;
 if(!processingActive()){
  preview=null;$('applyProcessing').disabled=true;$('discardProcessing').disabled=true;$('processingStatus').textContent='';renderPlot();return;
 }
 preview=runProcessing(s);$('applyProcessing').disabled=!!preview.error;$('discardProcessing').disabled=false;
 let parts=[];if($('despike').checked)parts.push('auto-despike'+(preview.spikes.length?' · '+preview.spikes.length+' spike point(s) corrected':''));
 if(preview.hostSub?.host)parts.push('prepared host peaks '+preview.hostSub.host.name+' · '+preview.hostSub.bands.length+' band(s) · median × '+preview.hostSub.scale.toFixed(3));
 if(preview.hostBg?.host)parts.push('host background × '+preview.hostBg.scale.toFixed(3)+' from '+Math.round(preview.hostBg.lo)+'–'+Math.round(preview.hostBg.hi)+' cm⁻¹');
 if(preview.hostBg?.warning)parts.push(preview.hostBg.warning);
 if(Number($('smooth').value))parts.push($('smooth').value+'-point smoothing');
 if(preview.method==='already')parts.push('baseline already corrected before import (no additional baseline removed)');
 else if(preview.method!=='none')parts.push(preview.method+' baseline');
 $('processingStatus').textContent=preview.error?preview.error:'Previewing '+parts.join(' · ')+'.'+(preview.method==='manual'?' Manual baseline applied only between outermost anchors.':'');
 fitResult=null;ratioNumerator.clear();ratioDenominator.clear();renderFit();renderPlot();
}
$('baselineMethod').onchange=()=>{if($('baselineMethod').value==='already'){$('despike').checked=false;$('smooth').value='0';}updateBaselineUi();refreshProcessingPreview();};
for(const id of ['despike','smooth','lambda','asymmetry','iterations','subtractHost','hostReference','hostScaleMode','hostScale','subtractHostBackground','hostBgMin','hostBgMax','hostBgScaleMode','hostBgScale'])$(id).addEventListener('input',()=>{updateHostUi();refreshProcessingPreview();});
for(const id of ['hostScaleMode','hostReference','subtractHost','subtractHostBackground','hostBgScaleMode'])$(id).addEventListener('change',()=>{updateHostUi();refreshProcessingPreview();});
updateBaselineUi();updateHostUi();
$('previewProcessing').onclick=refreshProcessingPreview;
$('applyProcessing').onclick=()=>{let s=current();if(!s||!preview||preview.error)return;if(isHostReference(s)&&preview.method==='none'){$('processingStatus').textContent='Choose and preview a baseline correction before preparing a host reference.';return;}s.working=preview.y.slice();s.modified=preview.spikes.slice();s.preparedHost=isHostReference(s)&&preview.method!=='none';s.preparedHostBaseline=preview.method==='already'?null:(s.preparedHost&&Array.isArray(preview.baseline)?preview.baseline.slice():s.preparedHostBaseline);s.processing={manualPoints:s.manualBaselinePoints.map(p=>({...p})),despike:$('despike').checked,smoothing:Number($('smooth').value)||0,baseline:preview.method,lambda:Number($('lambda').value)||1e6,p:Number($('asymmetry').value)||.001,iterations:Number($('iterations').value)||12,host:{enabled:!!preview.hostSub?.host,referenceName:preview.hostSub?.host?.name||preview.hostBg?.host?.name||'',referenceSampleId:preview.hostSub?.host?.meta?.sampleId||preview.hostSub?.host?.meta?.sample||preview.hostBg?.host?.meta?.sampleId||preview.hostBg?.host?.meta?.sample||'',scaleMode:$('hostScaleMode').value,scale:preview.hostSub?.scale??null,bands:preview.hostSub?.bands||[],backgroundEnabled:!!preview.hostBg?.host,backgroundWarning:preview.hostBg?.warning||'',backgroundScaleMode:$('hostBgScaleMode').value,backgroundScale:preview.hostBg?.scale??null,backgroundMin:Number($('hostBgMin').value)||1500,backgroundMax:Number($('hostBgMax').value)||2700},appliedAt:new Date().toISOString()};preview=null;$('applyProcessing').disabled=true;$('discardProcessing').disabled=true;$('processingStatus').textContent=s.preparedHost?'Prepared host reference saved. Raw data retained.':'Applied to working spectrum. Raw data retained.';manualDrawMode=false;updateManualModeUi();updateHostUi();fitResult=null;seeds=[];ratioNumerator.clear();ratioDenominator.clear();invalidateReview(s);renderSeeds();renderFit();renderPlot();};
$('discardProcessing').onclick=()=>{let s=current();if(s)s.manualBaselinePoints=cleanManualPoints(s.processing?.manualPoints||[]);manualDrawMode=false;updateManualModeUi();preview=null;$('applyProcessing').disabled=true;$('discardProcessing').disabled=true;$('processingStatus').textContent='Preview discarded.';renderPlot();};
$('resetRaw').onclick=()=>{let s=current();if(!s)return;s.working=s.raw.slice();s.modified=[];s.manualBaselinePoints=[];manualDrawMode=false;$('baselineMethod').value='none';updateBaselineUi();s.processing=null;s.preparedHost=false;s.preparedHostBaseline=null;preview=null;fitResult=null;seeds=[];ratioNumerator.clear();ratioDenominator.clear();invalidateReview(s);renderSeeds();renderFit();renderPlot();};
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
function updateFitModeUi(resetFit=true){
 let broad=$('fitMode').value==='broadOH',s=current();$('broadOhHint').style.display=broad?'block':'none';
 if(broad){
  $('autoPeaks').checked=false;$('autoPeaks').disabled=true;$('autoPeakProminence').disabled=true;$('autoPeakDistance').disabled=true;
  // Set defaults only on entering Broad OH mode, not every time Fit peaks is clicked.
  if(resetFit){$('profile').value='gaussian';$('fitBaseline').value='linear';$('initialWidth').value=220;$('fitIterations').value=Math.max(200,Number($('fitIterations').value)||200);}
  if(s){
   if(resetFit||$('fitMin').value==='')$('fitMin').value=Math.max(2800,Math.ceil(s.x[0]));
   if(resetFit||$('fitMax').value==='')$('fitMax').value=Math.min(3800,Math.floor(s.x.at(-1)));
  }
 }else{
  $('autoPeaks').disabled=false;$('autoPeakProminence').disabled=false;$('autoPeakDistance').disabled=false;
 }
 updatePeakSelectionUi();
 if(resetFit){fitResult=null;ratioNumerator.clear();ratioDenominator.clear();renderFit();renderPlot();}
}
$('fitMode').addEventListener('change',()=>updateFitModeUi(true));
function renderSeeds(){$('seedList').innerHTML=seeds.length?seeds.map((x,i)=>'<span class="seed">'+(i+1)+': '+x.toFixed(1)+'<button data-seed="'+i+'">×</button></span>').join(''):'<span class="hint">No peak centres selected.</span>';}
$('seedList').onclick=e=>{if(e.target.dataset.seed!==undefined){seeds.splice(Number(e.target.dataset.seed),1);fitResult=null;ratioNumerator.clear();ratioDenominator.clear();renderSeeds();renderFit();renderPlot();}};
$('pickPeaks').onclick=()=>{if(!pickMode&&manualDrawMode){manualDrawMode=false;updateManualModeUi();renderPlot();}pickMode=!pickMode;$('pickPeaks').classList.toggle('primary',pickMode);$('pickPeaks').textContent=pickMode?'Picking centres…':'Pick centres on plot';};
$('clearSeeds').onclick=()=>{seeds=[];fitResult=null;ratioNumerator.clear();ratioDenominator.clear();renderSeeds();renderFit();renderPlot();};

function gaussian(x,c,h,w){let q=(x-c)/Math.max(w,1e-9);return h*Math.exp(-4*Math.LN2*q*q);}
function lorentzian(x,c,h,w){let q=(x-c)/Math.max(w,1e-9);return h/(1+4*q*q);}
function peakValue(x,p,profile){if(profile==='gaussian')return gaussian(x,p.c,p.h,p.w);if(profile==='lorentzian')return lorentzian(x,p.c,p.h,p.w);return p.h*(p.eta/(1+4*Math.pow((x-p.c)/Math.max(p.w,1e-9),2))+(1-p.eta)*Math.exp(-4*Math.LN2*Math.pow((x-p.c)/Math.max(p.w,1e-9),2)));}
function peakArea(p,profile){let g=p.h*p.w*Math.sqrt(Math.PI/(4*Math.LN2)),l=p.h*Math.PI*p.w/2;return profile==='gaussian'?g:profile==='lorentzian'?l:(1-p.eta)*g+p.eta*l;}
function solveLinear(A,b){let n=b.length,M=A.map((r,i)=>r.slice().concat([b[i]]));for(let k=0;k<n;k++){let p=k;for(let i=k+1;i<n;i++)if(Math.abs(M[i][k])>Math.abs(M[p][k]))p=i;if(Math.abs(M[p][k])<1e-18)return null;[M[k],M[p]]=[M[p],M[k]];let d=M[k][k];for(let j=k;j<=n;j++)M[k][j]/=d;for(let i=0;i<n;i++){if(i===k)continue;let f=M[i][k];for(let j=k;j<=n;j++)M[i][j]-=f*M[k][j];}}return M.map(r=>r[n]);}
function baselineParamCount(mode){return mode==='quadratic'?3:mode==='linear'?2:1;}
function unpack(params,count,profile,baselineMode){let nb=baselineParamCount(baselineMode),baseline=params.slice(0,nb),peaks=[],at=nb;for(let i=0;i<count;i++){let p={c:params[at++],h:params[at++],w:params[at++]};p.eta=profile==='pseudo'?params[at++]:profile==='lorentzian'?1:0;peaks.push(p);}return {baseline,offset:baseline[0],peaks};}
function fitBaselineAt(x,coeffs,xmin,xmax){let mid=(xmin+xmax)/2,half=Math.max(1e-9,(xmax-xmin)/2),q=(x-mid)/half;return (coeffs[0]||0)+(coeffs[1]||0)*q+(coeffs[2]||0)*q*q;}
function model(xs,params,count,profile,baselineMode){let u=unpack(params,count,profile,baselineMode),xmin=xs[0],xmax=xs.at(-1);return xs.map(x=>fitBaselineAt(x,u.baseline,xmin,xmax)+u.peaks.reduce((s,p)=>s+peakValue(x,p,profile),0));}
function clamp(params,count,profile,xmin,xmax,yr,baselineMode,fitMode='standard',seedXs=[]){
 let o=params.slice(),nb=baselineParamCount(baselineMode),at=nb;
 for(let i=0;i<nb;i++)o[i]=Math.max(-10*yr,Math.min(10*yr,o[i]));
 for(let i=0;i<count;i++){
  let seed=seedXs[i]??((xmin+xmax)/2),cmin=fitMode==='broadOH'?Math.max(xmin,seed-100):xmin,cmax=fitMode==='broadOH'?Math.min(xmax,seed+100):xmax;
  o[at]=Math.max(cmin,Math.min(cmax,o[at]));at++;
  o[at]=Math.max(0,Math.min(20*yr,o[at]));at++;
  let wmin=fitMode==='broadOH'?60:.2,wmax=fitMode==='broadOH'?Math.min(600,xmax-xmin):xmax-xmin;
  o[at]=Math.max(wmin,Math.min(Math.max(wmin,wmax),o[at]));at++;
  if(profile==='pseudo'){o[at]=Math.max(0,Math.min(fitMode==='broadOH'?.7:1,o[at]));at++;}
 }
 return o;
}
function broadOhMaskRanges(s,lo,hi){
 let bands=s?.processing?.host?.bands||[],ranges=[];
 for(const b of bands){
  let c=Number(b.center);if(!Number.isFinite(c)||c<lo||c>hi||c<2500)continue;
  let half=Math.max(20,Math.min(100,Number(b.halfWidth)||((Number(b.fwhm)||20)*1.5)));
  ranges.push({lo:c-half,hi:c+half,center:c});
 }
 ranges.sort((a,b)=>a.lo-b.lo);let merged=[];
 for(const r of ranges){let last=merged.at(-1);if(last&&r.lo<=last.hi){last.hi=Math.max(last.hi,r.hi);last.centers.push(r.center);}else merged.push({lo:r.lo,hi:r.hi,centers:[r.center]});}
 return merged;
}
function fitWeightsForRanges(xs,ranges){return xs.map(x=>ranges.some(r=>x>=r.lo&&x<=r.hi)?0:1);}
function seedInRanges(seed,ranges){return ranges.some(r=>seed>=r.lo&&seed<=r.hi);}
function fitNonlinear(xs,ys,seedXs,profile,maxIterations,initialWidth,baselineMode='constant',fitMode='standard',weights=null,maskedRanges=[]){
 let wts=Array.isArray(weights)&&weights.length===ys.length?weights.slice():ys.map(()=>1),active=ys.filter((_,i)=>wts[i]>0),seedsUsed=fitMode==='broadOH'?seedXs.slice(0,5):seedXs.slice(),count=seedsUsed.length,ymin=Math.min(...(active.length?active:ys)),ymax=Math.max(...(active.length?active:ys)),yr=Math.max(1e-12,ymax-ymin),xmin=Math.min(...xs),xmax=Math.max(...xs),nb=baselineParamCount(baselineMode),params=[ymin];
 if(nb>=2)params.push((ys.at(-1)-ys[0])/2);if(nb>=3)params.push(0);
 for(const c of seedsUsed){
  let nearest=0,dist=Infinity;for(let i=0;i<xs.length;i++){if(wts[i]<=0)continue;let d=Math.abs(xs[i]-c);if(d<dist){dist=d;nearest=i;}}
  let width=fitMode==='broadOH'?Math.max(80,Math.min(450,initialWidth)):Math.max(.2,initialWidth);
  params.push(c,Math.max(yr*.03,ys[nearest]-ymin),width);if(profile==='pseudo')params.push(fitMode==='broadOH'?.3:.5);
 }
 params=clamp(params,count,profile,xmin,xmax,yr,baselineMode,fitMode,seedsUsed);let damping=1e-2,fit=model(xs,params,count,profile,baselineMode),sse=ys.reduce((s,v,i)=>s+wts[i]*Math.pow(v-fit[i],2),0),iterations=0;
 for(let iter=0;iter<maxIterations;iter++){
  iterations=iter+1;let m=params.length,n=xs.length,J=Array.from({length:n},()=>new Array(m)),res=ys.map((v,i)=>v-fit[i]);
  for(let j=0;j<m;j++){
   let step=Math.max(1e-6,Math.abs(params[j])*1e-5),p2=params.slice();p2[j]+=step;p2=clamp(p2,count,profile,xmin,xmax,yr,baselineMode,fitMode,seedsUsed);let f2=model(xs,p2,count,profile,baselineMode),actual=p2[j]-params[j]||step;
   for(let i=0;i<n;i++)J[i][j]=(f2[i]-fit[i])/actual;
  }
  let A=Array.from({length:m},()=>new Array(m).fill(0)),g=new Array(m).fill(0);
  for(let i=0;i<n;i++){let wi=wts[i];if(wi<=0)continue;for(let a=0;a<m;a++){g[a]+=wi*J[i][a]*res[i];for(let b=0;b<=a;b++)A[a][b]+=wi*J[i][a]*J[i][b];}}
  for(let a=0;a<m;a++){for(let b=0;b<a;b++)A[b][a]=A[a][b];A[a][a]+=damping*(A[a][a]+1e-9);}
  let delta=solveLinear(A,g);if(!delta){damping*=10;continue;}
  let cand=clamp(params.map((v,i)=>v+delta[i]),count,profile,xmin,xmax,yr,baselineMode,fitMode,seedsUsed),fit2=model(xs,cand,count,profile,baselineMode),sse2=ys.reduce((s,v,i)=>s+wts[i]*Math.pow(v-fit2[i],2),0);
  if(sse2<sse){let rel=(sse-sse2)/Math.max(sse,1e-18);params=cand;fit=fit2;sse=sse2;damping=Math.max(1e-9,damping/3);if(rel<1e-9)break;}else damping=Math.min(1e12,damping*5);
 }
 let wsum=wts.reduce((a,b)=>a+b,0)||1,mean=ys.reduce((a,v,i)=>a+wts[i]*v,0)/wsum,sst=ys.reduce((s,v,i)=>s+wts[i]*Math.pow(v-mean,2),0),u=unpack(params,count,profile,baselineMode),baseline=xs.map(x=>fitBaselineAt(x,u.baseline,xmin,xmax));
 let pairs=u.peaks.map((p,i)=>({p,seed:seedsUsed[i]}));
 if(fitMode==='broadOH'){let minHeight=Math.max(yr*.002,1e-12);pairs=pairs.filter(v=>v.p.h>minHeight);}
 let peaks=pairs.map(v=>v.p),cleanSeeds=pairs.map(v=>v.seed);
 return {offset:u.offset,baselineCoeffs:u.baseline,baselineMode,baseline,peaks,seedXs:cleanSeeds,fit,residual:ys.map((v,i)=>v-fit[i]),sse,rmse:Math.sqrt(sse/wsum),r2:sst>0?1-sse/sst:1,iterations,profile,xs,fitMode,maskedRanges,maskedPoints:wts.filter(v=>v<=0).length,fitPoints:wts.filter(v=>v>0).length};
}
$('fitPeaks').onclick=()=>{
 let s=current();if(!s){$('fitStatus').textContent='Load a spectrum first.';return;}
 let fitMode=$('fitMode').value;
 if(fitMode==='broadOH')updateFitModeUi(false);
 if(fitMode==='standard'&&$('autoPeaks').checked)autoSelectPeaks();
 if(!seeds.length){$('fitStatus').textContent=fitMode==='broadOH'?'Pick 1–5 broad OH component centres manually first.':'No peaks selected. Adjust auto settings or use manual selection.';return;}
 let lo=Number($('fitMin').value),hi=Number($('fitMax').value);if(!Number.isFinite(lo)||!Number.isFinite(hi)||lo===hi){$('fitStatus').textContent='Enter a valid fit minimum and maximum.';return;}if(hi<lo)[lo,hi]=[hi,lo];
 let y=activeY(),idx=s.x.map((x,i)=>[x,i]).filter(v=>v[0]>=lo&&v[0]<=hi),ranges=fitMode==='broadOH'?broadOhMaskRanges(s,lo,hi):[],valid=seeds.filter(v=>v>=lo&&v<=hi&&!seedInRanges(v,ranges));
 if(fitMode==='broadOH'&&valid.length>5)valid=valid.slice(0,5);
 if(idx.length<20||!valid.length){$('fitStatus').textContent=fitMode==='broadOH'&&ranges.length?'No usable OH centres remain after excluding prepared-host bands. Pick centres outside the shaded host regions.':'Fit range/centres are invalid.';return;}
 let xs=idx.map(v=>v[0]),ys=idx.map(v=>y[v[1]]),weights=fitMode==='broadOH'?fitWeightsForRanges(xs,ranges):null,usable=weights?weights.reduce((n,w)=>n+(w>0?1:0),0):xs.length;
 if(usable<20){$('fitStatus').textContent='Too few unmasked points remain for fitting.';return;}
 $('fitStatus').textContent='Fitting '+valid.length+' '+(fitMode==='broadOH'?'broad OH':'Raman')+' component'+(valid.length===1?'':'s')+'…';
 $('fitPeaks').disabled=true;
 const generation=datasetGeneration,targetId=s.id;
 setTimeout(()=>{
  if(generation!==datasetGeneration||currentId!==targetId)return;
  try{
   fitResult=fitNonlinear(xs,ys,valid,$('profile').value,Math.max(10,Math.min(300,Number($('fitIterations').value)||120)),Math.max(.2,Number($('initialWidth').value)||12),$('fitBaseline').value,fitMode,weights,ranges);
   if(!fitResult||!Number.isFinite(fitResult.rmse)||!fitResult.peaks?.length)throw new Error('Fit did not converge to a usable solution.');
   ratioNumerator.clear();ratioDenominator.clear();let fitted=current();if(fitted){fitted.reviewed=false;fitted.approved=false;storeCurrentFit();}
   renderReviewUi();renderList();renderApprovedPreview();renderFit();renderPlot();
  }catch(err){
   fitResult=null;$('fitStatus').textContent='Fit failed: '+(err?.message||String(err));console.error('Raman fit failed',err);
  }finally{$('fitPeaks').disabled=false;}
 },0);
};
function renderRatio(){
 let r=fitResult;if(!r){$('ratioSummary').textContent='Select numerator (N) and denominator (D) peaks.';return;}
 let num=[...ratioNumerator].filter(i=>r.peaks[i]),den=[...ratioDenominator].filter(i=>r.peaks[i]),numArea=num.reduce((s,i)=>s+peakArea(r.peaks[i],r.profile),0),denArea=den.reduce((s,i)=>s+peakArea(r.peaks[i],r.profile),0);
 if(!num.length||!den.length){$('ratioSummary').textContent='Select numerator (N) and denominator (D) peaks.';return;}
 let nLabel=num.map(i=>r.peaks[i].c.toFixed(1)).join(' + '),dLabel=den.map(i=>r.peaks[i].c.toFixed(1)).join(' + '),ratio=denArea!==0?numArea/denArea:null;
 $('ratioSummary').textContent=ratio===null?'Denominator area is zero.':'Area ratio ('+nLabel+') / ('+dLabel+') = '+ratio.toPrecision(7);
}
// Integrate the sum of fitted components, not the fitted baseline or raw intensities.
function regionBounds(){
 const ids=['regionNumMin','regionNumMax','regionDenMin','regionDenMax'],v=ids.map(id=>$(id).value.trim());
 if(v.some(s=>s===''))return null;
 const n=v.map(Number);
 return n.every(Number.isFinite)?{nMin:n[0],nMax:n[1],dMin:n[2],dMax:n[3]}:null;
}
function integrateFitComponents(r,lo,hi){
 const steps=Math.max(1,Math.ceil((hi-lo)*2)),dx=(hi-lo)/steps;
 const height=x=>r.peaks.reduce((sum,p)=>sum+peakValue(x,p,r.profile),0);
 let total=(height(lo)+height(hi))*.5;
 for(let i=1;i<steps;i++)total+=height(lo+i*dx);
 return total*dx;
}
function fittedRegionAreas(r){
 const bounds=regionBounds();
 if(!bounds||!(bounds.nMin<bounds.nMax&&bounds.dMin<bounds.dMax))
  return {bounds,error:'Enter two valid integration ranges with increasing limits.'};
 if(!r?.peaks?.length||!r?.xs?.length)
  return {bounds,error:'Fit peaks to calculate integrated areas.'};
 const fitLo=r.xs[0],fitHi=r.xs.at(-1);
 // Allow a small tolerance for the first/last sampled point not falling exactly on a whole-number limit.
 if(Math.min(bounds.nMin,bounds.dMin)<fitLo-2||Math.max(bounds.nMax,bounds.dMax)>fitHi+2)
  return {bounds,error:'Integration regions exceed the fitted range ('+fitLo.toFixed(1)+'–'+fitHi.toFixed(1)+' cm⁻¹). Extend the fit and refit; no extrapolated ratio was calculated.'};
 const numerator=integrateFitComponents(r,bounds.nMin,bounds.nMax),
       denominator=integrateFitComponents(r,bounds.dMin,bounds.dMax);
 if(!Number.isFinite(numerator)||!Number.isFinite(denominator)||denominator<=0)
  return {bounds,error:'Cannot calculate a finite ratio: check the fit and denominator area.'};
 return {bounds,numerator,denominator,ratio:numerator/denominator,error:null};
}
function renderRegionIntegration(){
 const result=fittedRegionAreas(fitResult),el=$('regionSummary');
 if(result.error){el.textContent=result.error;return;}
 const b=result.bounds;
 el.textContent='A'+b.nMin+'–'+b.nMax+' = '+result.numerator.toPrecision(7)
  +' · A'+b.dMin+'–'+b.dMax+' = '+result.denominator.toPrecision(7)
  +' · Ratio = '+result.ratio.toPrecision(7);
}
for(const id of ['regionNumMin','regionNumMax','regionDenMin','regionDenMax'])
 $(id).addEventListener('input',renderRegionIntegration);

function renderFit(){
 let r=fitResult;if(!r){$('fitTable').innerHTML='';$('fitSummary').innerHTML='';$('fitStatus').textContent='No fit calculated.';renderRatio();renderRegionIntegration();return;}
 $('fitStatus').textContent='Fit complete · '+r.iterations+' iteration(s)'+(r.maskedRanges?.length?' · '+r.maskedRanges.length+' host-band window(s) excluded':'')+'.';$('fitSummary').innerHTML='<span>Mode <strong>'+esc(r.fitMode==='broadOH'?'Broad OH':'Standard')+'</strong></span><span>R² <strong>'+r.r2.toFixed(5)+'</strong></span><span>RMSE <strong>'+r.rmse.toPrecision(5)+'</strong></span><span>Fit baseline <strong>'+esc(r.baselineMode||'constant')+'</strong></span><span>Offset <strong>'+r.offset.toPrecision(5)+'</strong></span>'+(r.maskedRanges?.length?'<span>Host windows excluded <strong>'+r.maskedRanges.length+'</strong></span>':'');
 $('fitTable').innerHTML=r.peaks.map((p,i)=>'<tr><td>'+(i+1)+'</td><td>'+(r.seedXs?.[i]??p.c).toFixed(3)+'</td><td>'+p.c.toFixed(3)+'</td><td>'+p.h.toPrecision(6)+'</td><td>'+p.w.toFixed(3)+'</td><td>'+(r.profile==='pseudo'?p.eta.toFixed(3):r.profile==='lorentzian'?'1.000':'0.000')+'</td><td>'+peakArea(p,r.profile).toPrecision(7)+'</td><td class="ratio-cell"><input type="checkbox" data-ratio="n" data-peak="'+i+'" '+(ratioNumerator.has(i)?'checked':'')+'></td><td class="ratio-cell"><input type="checkbox" data-ratio="d" data-peak="'+i+'" '+(ratioDenominator.has(i)?'checked':'')+'></td></tr>').join('');
 renderRatio();renderRegionIntegration();
}
$('fitTable').onchange=e=>{let kind=e.target.dataset.ratio,i=Number(e.target.dataset.peak);if(!kind||!Number.isInteger(i))return;let target=kind==='n'?ratioNumerator:ratioDenominator,other=kind==='n'?ratioDenominator:ratioNumerator;if(e.target.checked){target.add(i);other.delete(i);}else target.delete(i);storeCurrentFit();renderFit();};
for(const id of ['profile','fitBaseline'])$(id).onchange=()=>{fitResult=null;ratioNumerator.clear();ratioDenominator.clear();renderFit();renderPlot();};

function download(name,blob){let u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1200);}
$('reviewed').onchange=()=>{let s=current();if(!s)return;s.reviewed=$('reviewed').checked;if(!s.reviewed)s.approved=false;renderList();renderReviewUi();renderApprovedPreview();};
$('approved').onchange=()=>{let s=current();if(!s)return;s.approved=$('approved').checked;if(s.approved)s.reviewed=true;renderList();renderReviewUi();renderApprovedPreview();};
$('nextUnreviewed').onclick=()=>{if(!spectra.length)return;let start=Math.max(0,spectra.findIndex(s=>s.id===currentId));for(let n=1;n<=spectra.length;n++){let s=spectra[(start+n)%spectra.length];if(!s.reviewed){chooseSpectrum(s.id);return;}}$('reviewStatus').textContent='All spectra are reviewed.';};
$('saveProcessed').onclick=()=>{let data={format:'raman-studio-v1',workflow:'processed',saved:new Date().toISOString(),analysisRegions:(()=>{let b=regionBounds();return b?[b.nMin,b.nMax,b.dMin,b.dMax]:null;})(),spectra:spectra.map(s=>({name:s.name,meta:s.meta,x:s.x,raw:s.raw,corrected:s.working,modified:s.modified||[],keep:true,reviewed:!!s.reviewed,approved:!!s.approved,processing:s.processing||null,fit:s.fit||null,preparedHost:!!s.preparedHost,preparedHostBaseline:s.preparedHostBaseline||null,manualBaselinePoints:cleanManualPoints(s.manualBaselinePoints)}))};download('raman_processed.json',new Blob([JSON.stringify(data)],{type:'application/json'}));};
$('exportAnalysisCsv').onclick=()=>{let s=current(),r=fitResult;if(!s||!r)return;let num=[...ratioNumerator].filter(i=>r.peaks[i]),den=[...ratioDenominator].filter(i=>r.peaks[i]),numArea=num.reduce((sum,i)=>sum+peakArea(r.peaks[i],r.profile),0),denArea=den.reduce((sum,i)=>sum+peakArea(r.peaks[i],r.profile),0),ratio=num.length&&den.length&&denArea!==0?numArea/denArea:'',rows=[['filename','compound','host_mineral','mol_kg','phase','temperature_C','host_subtracted','host_reference','host_scale','host_background_subtracted','host_background_scale','host_background_range','baseline_mode','fit_mode','fit_profile','fit_baseline','peak','selected_cm-1','fitted_cm-1','height','fwhm_cm-1','eta','area','numerator_selected','denominator_selected','numerator_area_sum','denominator_area_sum','area_ratio','r2','rmse']];r.peaks.forEach((p,i)=>rows.push([s.name,s.meta.compound,s.meta.hostMineral,s.meta.mol,s.meta.phase,s.meta.temp,!!s.processing?.host?.enabled,s.processing?.host?.referenceName||'',s.processing?.host?.scale??'',!!s.processing?.host?.backgroundEnabled,s.processing?.host?.backgroundScale??'',s.processing?.host?.backgroundEnabled?((s.processing?.host?.backgroundMin??1500)+'-'+(s.processing?.host?.backgroundMax??2700)):'',$('baselineMethod').value,r.fitMode||'standard',r.profile,r.baselineMode||'constant',i+1,r.seedXs?.[i]??p.c,p.c,p.h,p.w,r.profile==='pseudo'?p.eta:r.profile==='lorentzian'?1:0,peakArea(p,r.profile),ratioNumerator.has(i),ratioDenominator.has(i),numArea,denArea,ratio,r.r2,r.rmse]));let reg=fittedRegionAreas(r),b=reg.bounds||{},fields=['region_num_min_cm-1','region_num_max_cm-1','region_den_min_cm-1','region_den_max_cm-1','region_numerator_area','region_denominator_area','region_area_ratio','region_integration_note'];rows[0].push(...fields,'manual_baseline_points');for(const row of rows.slice(1))row.push(b.nMin??'',b.nMax??'',b.dMin??'',b.dMax??'',reg.error?'':reg.numerator,reg.error?'':reg.denominator,reg.error?'':reg.ratio,reg.error||'',JSON.stringify(s.processing?.baseline==='manual'?s.processing.manualPoints||[]:[]));download('raman_analysis.csv',new Blob([rows.map(row=>row.map(csvVal).join(',')).join('\n')],{type:'text/csv'}));};

function renderPlot(){
 let s=current();if(!s){$('plot').innerHTML='<div style="padding:70px;text-align:center;color:#7b8da3">Load and select a spectrum to begin analysis</div>';lastSvg='';return;}let y=activeY(),xmin=$('xMin').value===''?s.x[0]:Number($('xMin').value),xmax=$('xMax').value===''?s.x.at(-1):Number($('xMax').value);if(xmax<xmin)[xmin,xmax]=[xmax,xmin];let idx=s.x.map((x,i)=>i).filter(i=>s.x[i]>=xmin&&s.x[i]<=xmax);if(idx.length<2)return;let vals=idx.map(i=>y[i]),manualGuide=$('baselineMethod').value==='manual'&&preview?.beforeBaseline?idx.map(i=>preview.beforeBaseline[i]):null,ylo=Math.min(...vals,...(manualGuide||[])),yhi=Math.max(...vals,...(manualGuide||[])),pad=(Number($('yPad').value)||8)/100*(yhi-ylo||1),residualSpace=$('showResidual').checked&&fitResult?130:0,w=1240,h=680+residualSpace,left=82,right=1170,top=55,bottom=610,YY=v=>bottom-(v-(ylo-pad))/Math.max(1e-12,(yhi+pad)-(ylo-pad))*(bottom-top),XX=x=>left+(x-xmin)/(xmax-xmin)*(right-left);plotGeometry={xmin,xmax,left,right,top,bottom,ymin:ylo-pad,ymax:yhi+pad};let out=['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+w+' '+h+'" width="'+w+'" height="'+h+'" style="background:white"><rect width="100%" height="100%" fill="white"/>'];for(let x=Math.ceil(xmin/500)*500;x<=xmax;x+=500){let xx=XX(x);out.push('<line x1="'+xx+'" y1="'+top+'" x2="'+xx+'" y2="'+bottom+'" stroke="#e9edf3"/><text x="'+xx+'" y="'+(bottom+26)+'" text-anchor="middle" font-size="12" fill="#53667d">'+x+'</text>');}out.push('<line x1="'+left+'" y1="'+top+'" x2="'+left+'" y2="'+bottom+'" stroke="#718399"/><line x1="'+left+'" y1="'+bottom+'" x2="'+right+'" y2="'+bottom+'" stroke="#718399"/>');let path=(xs,ys,map)=>xs.map((x,i)=>(i?'L':'M')+XX(x).toFixed(2)+' '+map(ys[i]).toFixed(2)).join(' '),xs=idx.map(i=>s.x[i]);if(fitResult?.fitMode==='broadOH'&&fitResult.maskedRanges?.length){for(const r of fitResult.maskedRanges){let a=Math.max(xmin,r.lo),b=Math.min(xmax,r.hi);if(b>a)out.push('<rect x="'+XX(a)+'" y="'+top+'" width="'+Math.max(0,XX(b)-XX(a))+'" height="'+(bottom-top)+'" fill="#eef1f5" fill-opacity=".55"/>');}}if(preview)out.push('<path d="'+path(xs,manualGuide||idx.map(i=>s.working[i]),YY)+'" stroke="#aab3be" stroke-width="1.2" fill="none"/>');out.push('<path d="'+path(xs,vals,YY)+'" stroke="#315cc6" stroke-width="1.5" fill="none"/>');if($('baselineMethod').value==='manual'){
 out.push('<path class="manual-baseline-curve" d="'+manualOverlayPath(s)+'" stroke="#ad4c91" stroke-width="2.4" stroke-dasharray="7 3" fill="none" pointer-events="none"/>');
 (s.manualBaselinePoints||[]).forEach((p,i)=>{if(p.x<xmin||p.x>xmax)return;out.push('<circle data-baseline-index="'+i+'" cx="'+XX(p.x)+'" cy="'+YY(p.y)+'" r="'+(manualDrawMode?7:5)+'" fill="#fff" stroke="#ad4c91" stroke-width="2.5"/>');});
}
let visibleSeeds=seeds.filter(c=>c>=xmin&&c<=xmax).sort((a,b)=>a-b),placedSeedLabels=[];
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
}if(fitResult){let r=fitResult;if($('showComponents').checked)r.peaks.forEach((p,j)=>out.push('<path d="'+path(r.xs,r.xs.map((x,i)=>(r.baseline?.[i]??r.offset)+peakValue(x,p,r.profile)),YY)+'" stroke="'+COLORS[(j+1)%COLORS.length]+'" stroke-width="1.1" stroke-dasharray="5 3" fill="none"/>'));out.push('<path d="'+path(r.xs,r.fit,YY)+'" stroke="#232323" stroke-width="2.2" fill="none"/>');if($('showResidual').checked){let rt=650,rb=h-45,masked=i=>r.maskedRanges?.some(g=>r.xs[i]>=g.lo&&r.xs[i]<=g.hi),resVals=r.residual.filter((_,i)=>!masked(i)),rm=Math.max(...resVals.map(Math.abs),1e-12),RY=v=>(rt+rb)/2-v/rm*(rb-rt)*.42,resPath='',pen=false;for(let i=0;i<r.xs.length;i++){if(masked(i)){pen=false;continue;}resPath+=(pen?'L':'M')+XX(r.xs[i]).toFixed(2)+' '+RY(r.residual[i]).toFixed(2)+' ';pen=true;}out.push('<line x1="'+left+'" y1="'+RY(0)+'" x2="'+right+'" y2="'+RY(0)+'" stroke="#b9c2ce"/><text x="'+left+'" y="'+(rt-8)+'" font-size="12" fill="#53677d">Residual'+(r.maskedRanges?.length?' · host windows omitted':'')+'</text><path d="'+resPath+'" stroke="#6b7280" stroke-width="1.2" fill="none"/>');}}out.push('<text x="'+((left+right)/2)+'" y="'+(bottom+58)+'" text-anchor="middle" font-size="17">Raman shift (cm⁻¹)</text><text transform="translate(24 '+((top+bottom)/2)+') rotate(-90)" text-anchor="middle" font-size="17">Intensity (a.u.)</text></svg>');lastSvg=out.join('');$('plot').innerHTML=lastSvg;
}
$('plot').onclick=e=>{if(!pickMode||!plotGeometry||!current())return;let svg=$('plot').querySelector('svg'),rect=svg.getBoundingClientRect(),vx=(e.clientX-rect.left)*svg.viewBox.baseVal.width/rect.width;if(vx<plotGeometry.left||vx>plotGeometry.right)return;let x=plotGeometry.xmin+(vx-plotGeometry.left)/(plotGeometry.right-plotGeometry.left)*(plotGeometry.xmax-plotGeometry.xmin),s=current(),nearest=s.x.reduce((best,v)=>Math.abs(v-x)<Math.abs(best-x)?v:best,s.x[0]),i=seeds.findIndex(v=>Math.abs(v-nearest)<=Math.max(2,(plotGeometry.xmax-plotGeometry.xmin)*.004));if(i>=0)seeds.splice(i,1);else if(seeds.length<10)seeds.push(nearest);seeds.sort((a,b)=>a-b);fitResult=null;ratioNumerator.clear();ratioDenominator.clear();renderSeeds();renderFit();renderPlot();};
for(const id of ['xMin','xMax','yPad','showComponents','showResidual'])$(id).addEventListener('input',renderPlot);
for(const id of ['fitMin','fitMax','autoPeakProminence','autoPeakDistance'])$(id).addEventListener('input',()=>{fitResult=null;ratioNumerator.clear();ratioDenominator.clear();renderFit();renderPlot();});
$('autoRange').onclick=()=>{$('xMin').value='';$('xMax').value='';renderPlot();};
$('exportSvg').onclick=()=>{if(lastSvg)download('raman_analysis.svg',new Blob([lastSvg],{type:'image/svg+xml'}));};
$('exportPng').onclick=()=>{if(!lastSvg)return;let blob=new Blob([lastSvg],{type:'image/svg+xml;charset=utf-8'}),url=URL.createObjectURL(blob),im=new Image;im.onload=()=>{let c=document.createElement('canvas');c.width=2200;c.height=Math.round(2200*im.height/im.width);let ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(im,0,0,c.width,c.height);c.toBlob(b=>download('raman_analysis.png',b),'image/png');URL.revokeObjectURL(url);};im.src=url;};

updateFitModeUi(false);renderList();renderSeeds();renderFit();renderPlot();renderApprovedPreview();