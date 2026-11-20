'use strict';
/* Multi-region fits and ratios, layered over the existing numerical routines. */
(function(){
const clone=v=>v==null?v:JSON.parse(JSON.stringify(v)),originalAdd=addSpectrum,
 originalFitRender=renderFit,originalPlot=renderPlot,
 originalChoose=chooseSpectrum,originalInvalidate=invalidateReview;
let activeRatio=null,visibleSpectrum=null;
const defaultSettings=s=>({fitMode:'standard',lo:s?.x?.[0]??0,hi:s?.x?.at(-1)??4000,
 autoPeaks:true,prominence:5,distance:10,profile:'pseudo',fitBaseline:'constant',iterations:120,initialWidth:12});
function idNext(list,prefix){let n=0;for(const item of list){let m=String(item.id).match(new RegExp('^'+prefix+'(\\d+)$'));if(m)n=Math.max(n,Number(m[1]));}return prefix+(n+1);}
function init(s){
 if(!s)return;
 if(!Array.isArray(s.fitRegions))s.fitRegions=[];
 if(!s.fitRegions.length){
  let old=clone(s.fit),settings=defaultSettings(s);
  if(old){settings={...settings,fitMode:old.fitMode||'standard',lo:old.xs?.[0]??s.x[0],
   hi:old.xs?.at(-1)??s.x.at(-1),autoPeaks:false,profile:old.profile||'gaussian',fitBaseline:old.baselineMode||'constant'};}
  s.fitRegions.push({id:'r1',name:'Region 1',settings,fit:old,seedXs:old?.seedXs||[],stale:false});
 }
 if(!s.fitRegions.some(r=>r.id===s.activeRegionId))s.activeRegionId=s.fitRegions[0].id;
 if(!Array.isArray(s.savedRatios))s.savedRatios=[];
 if(!s._fitDrafts)s._fitDrafts={};
 if(!s._legacyRatioMigrated){
  let old=s.fit?.ratio,r=s.fitRegions[0];
  if(!s.savedRatios.length&&old?.numerator?.length&&old?.denominator?.length)
   s.savedRatios.push({id:'q1',name:'Legacy peak ratio',nMode:'peaks',dMode:'peaks',
   nRegion:r.id,dRegion:r.id,nPeaks:old.numerator.map(i=>r.id+':'+i),
   dPeaks:old.denominator.map(i=>r.id+':'+i),nMin:2800,nMax:3300,dMin:3300,dMax:3800});
  s._legacyRatioMigrated=true;
 }
}
const activeRegion=(s=current())=>{init(s);return s?.fitRegions.find(r=>r.id===s.activeRegionId)||null;};
function settingsRead(){return {fitMode:$('fitMode').value,lo:Number($('fitMin').value),hi:Number($('fitMax').value),
 autoPeaks:$('autoPeaks').checked,prominence:Number($('autoPeakProminence').value),
 distance:Number($('autoPeakDistance').value),profile:$('profile').value,
 fitBaseline:$('fitBaseline').value,iterations:Number($('fitIterations').value),initialWidth:Number($('initialWidth').value)};}
function settingsWrite(s,src){
 let p={...defaultSettings(s),...(src||{})};
 $('fitMode').value=p.fitMode==='broadOH'?'broadOH':'standard';
 $('fitMin').value=p.lo;$('fitMax').value=p.hi;$('autoPeaks').checked=!!p.autoPeaks;
 $('autoPeakProminence').value=p.prominence;$('autoPeakDistance').value=p.distance;
 $('profile').value=p.profile;$('fitBaseline').value=p.fitBaseline;
 $('fitIterations').value=p.iterations;$('initialWidth').value=p.initialWidth;
 updateFitModeUi(false);
}
function stashRegion(){
 let s=current(),r=activeRegion(s);if(!r||visibleSpectrum!==s.id)return;
 s._fitDrafts[r.id]={settings:settingsRead(),name:$('fitRegionName').value||r.name,
  seedXs:seeds.slice(),fit:clone(fitResult)};
}
function loadRegion(s){
 let r=activeRegion(s);if(!r)return;
 let src=s._fitDrafts[r.id]||r;
 fitResult=clone(src.fit||null);seeds=(src.seedXs||fitResult?.seedXs||[]).slice();
 settingsWrite(s,src.settings);$('fitRegionName').value=src.name||r.name;
 regionUi();
}
function sameSpectrumValues(a,b){
 return !!a&&!!b&&a.length===b.length&&a.every((v,i)=>Number.isFinite(v)&&v===b[i]);
}
function fitInputMatches(r){
 return !r?._pending||!r._fitInput||sameSpectrumValues(r._fitInput,activeY());
}
function regionUi(){
 let s=current(),select=$('fitRegion');
 if(!s){select.replaceChildren();$('fitRegionStatus').textContent='Load a spectrum to select regions.';
  $('saveFitRegion').disabled=true;$('deleteFitRegion').disabled=true;return;}
 init(s);
 select.replaceChildren(...s.fitRegions.map(r=>new Option(r.name+(r.stale?' · refit required':r.fit?' · saved':''),r.id)));
 select.value=s.activeRegionId;let r=activeRegion(s);
 const hasFit=!!fitResult?.peaks?.length,inputMatches=fitInputMatches(r);
 $('deleteFitRegion').disabled=s.fitRegions.length<=1;
 // A preview is on by default. Never disable Save fit solely for that reason.
 $('saveFitRegion').disabled=!hasFit||!inputMatches||(r.stale&&!r._pending)||(!!preview&&!r._pending);
 $('fitRegionStatus').textContent=hasFit&&!inputMatches?'Processing changed after fitting. Fit peaks again before saving.':
 r.stale&&!r._pending?'Processing changed since this fit. Refit and save to use its areas.':
 r._pending&&preview&&!sameSpectrumValues(preview.y,s.working)?
 'Fit complete · Save fit will ask to apply the current processing preview first.':
 r._pending?'Fit complete but not saved · click Save fit.':
 r.fit?'Saved · '+r.fit.peaks.length+' peaks.':'Select peak centres, fit, then Save fit.';
}
function freshRatio(s){
 let region=s?.fitRegions?.find(r=>r.fit&&!r.stale)||activeRegion(s);
 return {id:null,name:'Ratio '+((s?.savedRatios?.length||0)+1),nMode:'range',dMode:'range',
 nRegion:region?.id||'',dRegion:region?.id||'',nMin:2800,nMax:3300,dMin:3300,dMax:3800,nPeaks:[],dPeaks:[]};
}
function ratioRead(){
 if(!activeRatio)return;
 activeRatio.name=$('ratioName').value.trim()||activeRatio.name;
 for(const side of ['n','d']){
  let tag=side==='n'?'Num':'Den';
  activeRatio[side+'Mode']=$('ratio'+tag+'Mode').value;
  activeRatio[side+'Region']=$('ratio'+tag+'Region').value;
  activeRatio[side+'Min']=Number($('region'+tag+'Min').value);
  activeRatio[side+'Max']=Number($('region'+tag+'Max').value);
 }
 // Peak selections are changed explicitly by the fit-table handler.
 // Do not copy transiently cleared checkbox sets back over a saved ratio
 // when another region is fitted or a processing preview is refreshed.
}
function ratioStash(){const s=current();if(s&&activeRatio){ratioRead();s._ratioDraft=clone(activeRatio);}}
function ratioUi(){
 const s=current(),select=$('ratioSelect');if(!s){select.replaceChildren();$('ratioSummary').textContent='Load spectra to calculate ratios.';return;}
 init(s);const options=s.savedRatios.map(q=>new Option(q.name,q.id));
 if(!activeRatio?.id)options.push(new Option('New ratio (unsaved)','__new__'));
 select.replaceChildren(...options);select.value=activeRatio?.id||'__new__';
 $('ratioName').value=activeRatio?.name||'';
 const regions=s.fitRegions.filter(r=>r.fit);
 for(const side of ['n','d']){
  const tag=side==='n'?'Num':'Den',regionSelect=$('ratio'+tag+'Region');
  regionSelect.replaceChildren(...regions.map(r=>new Option(r.name+(r.stale?' · refit required':''),r.id)));
  if(regions.some(r=>r.id===activeRatio?.[side+'Region']))regionSelect.value=activeRatio[side+'Region'];
  else if(regions.length)regionSelect.value=regions[0].id;
  $('ratio'+tag+'Mode').value=activeRatio?.[side+'Mode']||'range';
  $('region'+tag+'Min').value=activeRatio?.[side+'Min']??(side==='n'?2800:3300);
  $('region'+tag+'Max').value=activeRatio?.[side+'Max']??(side==='n'?3300:3800);
  $('ratio'+tag+'Range').style.display=$('ratio'+tag+'Mode').value==='range'?'grid':'none';
 }
 ratioNumerator.clear();ratioDenominator.clear();
 for(const k of activeRatio?.nPeaks||[])ratioNumerator.add(k);
 for(const k of activeRatio?.dPeaks||[])ratioDenominator.add(k);
 $('deleteRatio').disabled=!activeRatio?.id;
 renderRatio();
}
function selectedArea(s,q,side){
 if(q[side+'Mode']==='peaks'){
  let selected=q[side+'Peaks']||[];if(!selected.length)return {error:'Select peaks marked '+side.toUpperCase()+' in a saved fitting region.'};
  let area=0,labels=[];
  for(let item of selected){
   let [rid,n]=String(item).split(':'),r=s.fitRegions.find(v=>v.id===rid),i=Number(n);
   if(!r?.fit||r.stale||!r.fit.peaks?.[i])return {error:'A selected peak is unavailable or needs refitting.'};
   area+=peakArea(r.fit.peaks[i],r.fit.profile);labels.push(r.name+' '+r.fit.peaks[i].c.toFixed(1));
  }
  return {area,label:labels.join(' + ')};
 }
 let r=s.fitRegions.find(v=>v.id===q[side+'Region']),
 lo=q[side+'Min'],hi=q[side+'Max'];
 if(!r?.fit||r.stale)return {error:'Select a saved fitting region that does not need refitting.'};
 if(!Number.isFinite(lo)||!Number.isFinite(hi)||hi<=lo)return {error:'Enter valid increasing integration limits.'};
 if(lo<r.fit.xs[0]-2||hi>r.fit.xs.at(-1)+2)return {error:'Range '+lo+'–'+hi+' extends beyond saved '+r.name+' fit ('+r.fit.xs[0].toFixed(1)+'–'+r.fit.xs.at(-1).toFixed(1)+').'};
 return {area:integrateFitComponents(r.fit,lo,hi),label:r.name+' '+lo+'–'+hi+' cm⁻¹'};
}
function evaluate(s,q){
 if(!s||!q)return {error:'Save your fitted regions first.'};
 let n=selectedArea(s,q,'n'),d=selectedArea(s,q,'d');
 if(n.error||d.error)return {error:n.error||d.error};
 if(!(d.area>0)||!Number.isFinite(n.area)||!Number.isFinite(d.area))return {error:'Invalid integrated area or zero denominator.'};
 return {numerator:n.area,denominator:d.area,ratio:n.area/d.area,nLabel:n.label,dLabel:d.label};
}
renderRatio=function(){
 const s=current();if(!s||!activeRatio){$('ratioSummary').textContent='Save a fit to calculate a ratio.';return;}
 ratioRead();const v=evaluate(s,activeRatio);
 $('ratioSummary').textContent=v.error?v.error:v.nLabel+' / '+v.dLabel+' = '+v.ratio.toPrecision(7);
 $('regionSummary').textContent=v.error?'Select valid peaks or fitted ranges in saved regions.':
  'Numerator '+v.numerator.toPrecision(7)+' · Denominator '+v.denominator.toPrecision(7);
};
renderRegionIntegration=function(){renderRatio();};
function fitGroupRows(r,fit,state,enabled){
 const min=fit?.xs?.[0],max=fit?.xs?.at(-1);
 const limits=Number.isFinite(min)&&Number.isFinite(max)?min.toFixed(0)+'–'+max.toFixed(0)+' cm⁻¹':'fitted region';
 const rows=['<tr class="fit-region-row"><td colspan="9">'+esc(r.name)+' · '+esc(limits)+' · '+fit.peaks.length+' peak(s) · '+esc(state)+'</td></tr>'];
 for(const [i,p] of fit.peaks.entries()){
  const key=r.id+':'+i,disabled=enabled?'':' disabled',
   note=enabled?'':' title="Save or refit this region before selecting its peaks"',
   selected=Number(fit.seedXs?.[i]??p.c),
   height=Number(p.h),width=Number(p.w),position=Number(p.c),
   eta=fit.profile==='pseudo'?Number(p.eta??0).toFixed(3):fit.profile==='lorentzian'?'1.000':'0.000';
  rows.push('<tr><td>'+(i+1)+'</td><td>'+selected.toFixed(3)+'</td><td>'+position.toFixed(3)+'</td><td>'
   +height.toPrecision(6)+'</td><td>'+width.toFixed(3)+'</td><td>'+eta+'</td><td>'
   +Number(peakArea(p,fit.profile)).toPrecision(7)+'</td>'
   +['n','d'].map(side=>'<td class="ratio-cell"><input type="checkbox" aria-label="'+(side==='n'?'Numerator':'Denominator')+' · '+esc(r.name)+' · '+position.toFixed(1)+' cm⁻¹" data-ratio="'+side+'" data-region="'+esc(r.id)+'" data-peak="'+i+'"'
     +((side==='n'?ratioNumerator:ratioDenominator).has(key)?' checked':'')+disabled+note+'></td>').join('')+'</tr>');
 }
 return rows;
}
function renderSavedFitGroups(s){
 const rows=[],currentRegion=activeRegion(s);
 for(const r of s.fitRegions){
  if(r.fit?.peaks?.length)rows.push(...fitGroupRows(r,r.fit,r.stale?'refit required':r._pending?'saved version · newer fit unsaved':'saved',!r.stale));
 }
 // Working fits can be examined, but only saved fits can be selected for a ratio.
 if(currentRegion&&fitResult?.peaks?.length&&(currentRegion._pending||!currentRegion.fit)){
  rows.push(...fitGroupRows({...currentRegion,name:currentRegion.name+' (working fit)'},fitResult,'not saved · click Save fit to select N/D',false));
 }
 $('fitTable').innerHTML=rows.length?rows.join(''):
  '<tr><td colspan="9" style="color:#718096">Fit and save a region to select its peaks for a ratio.</td></tr>';
}
renderFit=function(){
 // The legacy fit action temporarily clears its checkbox sets. Restore
 // selections from the independent ratio draft before drawing the table.
 if(activeRatio){
  ratioNumerator.clear();ratioDenominator.clear();
  for(const key of activeRatio.nPeaks||[])ratioNumerator.add(key);
  for(const key of activeRatio.dPeaks||[])ratioDenominator.add(key);
 }
 originalFitRender();const s=current();
 if(s){init(s);renderSavedFitGroups(s);}
 regionUi();
};
storeCurrentFit=function(){let r=activeRegion();if(r){r._pending=true;r._fitInput=activeY().slice();}regionUi();};
restoreStoredFit=function(s){
 if(!s){fitResult=null;seeds=[];activeRatio=null;regionUi();return;}
 init(s);visibleSpectrum=s.id;loadRegion(s);
 activeRatio=clone(s._ratioDraft||s.savedRatios.find(q=>q.id===s.activeRatioId)||s.savedRatios[0]||freshRatio(s));
 ratioUi();
};
invalidateReview=function(s){
 if(s){init(s);s.fitRegions.forEach(r=>{if(r.fit)r.stale=true;r._pending=false;});s._fitDrafts={};}
 originalInvalidate(s);regionUi();renderRatio();
};
addSpectrum=function(name,raw,meta,working,extra={}){
 originalAdd(name,raw,meta,working,extra);let s=spectra.at(-1);
 if(Array.isArray(extra.fitRegions))s.fitRegions=clone(extra.fitRegions);
 if(Array.isArray(extra.savedRatios))s.savedRatios=clone(extra.savedRatios);
 s.activeRegionId=extra.activeRegionId||null;s.activeRatioId=extra.activeRatioId||null;
 init(s);
};
chooseSpectrum=function(id){
 if(current()){stashRegion();ratioStash();}
 originalChoose(id);visibleSpectrum=current()?.id??null;regionUi();ratioUi();
};
renderPlot=function(){
 const s=current();
 if(s&&visibleSpectrum!==s.id){restoreStoredFit(s);originalFitRender();}
 originalPlot();const svg=$('plot').querySelector('svg'),g=plotGeometry;
 if(!s||!svg||!g||preview)return;
 const xx=x=>g.left+(x-g.xmin)/(g.xmax-g.xmin)*(g.right-g.left),
 yy=y=>g.bottom-(y-g.ymin)/(g.ymax-g.ymin)*(g.bottom-g.top);
 for(const [i,r] of s.fitRegions.entries()){
  if(r.id===s.activeRegionId||r.stale||!r.fit?.xs?.length)continue;
  const path=document.createElementNS('http://www.w3.org/2000/svg','path');
  path.setAttribute('d',r.fit.xs.map((x,j)=>(j?'L':'M')+xx(x).toFixed(2)+' '+yy(r.fit.fit[j]).toFixed(2)).join(' '));
  path.setAttribute('fill','none');path.setAttribute('stroke',COLORS[(i+1)%COLORS.length]);
  path.setAttribute('stroke-width','2');path.setAttribute('stroke-dasharray','6 3');
  svg.appendChild(path);
 }
 lastSvg=new XMLSerializer().serializeToString(svg);
};
$('fitRegion').onchange=()=>{let s=current();if(!s)return;stashRegion();s.activeRegionId=$('fitRegion').value;
 loadRegion(s);pickMode=false;$('pickPeaks').classList.remove('primary');$('pickPeaks').textContent='Pick centres on plot';
 renderSeeds();renderFit();renderPlot();};
$('fitRegionName').oninput=()=>{let r=activeRegion();if(!r)return;r.name=$('fitRegionName').value.trim()||r.name;regionUi();};
$('addFitRegion').onclick=()=>{let s=current();if(!s)return;stashRegion();let id=idNext(s.fitRegions,'r');
 s.fitRegions.push({id,name:'Region '+(s.fitRegions.length+1),settings:defaultSettings(s),seedXs:[],fit:null,stale:false});
 s.activeRegionId=id;loadRegion(s);renderSeeds();renderFit();renderPlot();ratioUi();};
$('saveFitRegion').onclick=()=>{
 const s=current(),r=activeRegion(s);
 if(!s||!r||!fitResult?.peaks?.length||(r.stale&&!r._pending)||!fitInputMatches(r))return;
 if(preview){
  if(!r._pending||preview.error){
   $('fitRegionStatus').textContent='Fit the current processing preview successfully before saving.';
   return;
  }
  if(!sameSpectrumValues(preview.y,s.working)){
   if(!window.confirm('The fit uses a processing preview. Apply that preview to the spectrum and save this fit? Older saved fits will be marked for refitting.'))return;
   const fitted=clone(fitResult),chosenSeeds=seeds.slice(),settings=settingsRead(),
         targetId=s.id,regionId=r.id,expectedY=preview.y.slice();
   $('applyProcessing').onclick();
   if(current()?.id!==targetId||current()?.activeRegionId!==regionId||
      preview||!sameSpectrumValues(s.working,expectedY)){
    $('fitRegionStatus').textContent='Processing preview could not be applied. No fit was saved.';
    return;
   }
   // Applying processing invalidates previous regions; retain only this exact fit.
   fitResult=fitted;seeds=chosenSeeds;r._pending=true;r._fitInput=expectedY.slice();
   settingsWrite(s,settings);
  }
 }
 r.name=$('fitRegionName').value.trim()||r.name;r.settings=settingsRead();
 r.seedXs=seeds.slice();r.fit=clone(fitResult);r.stale=false;r._pending=false;
 delete r._fitInput;delete s._fitDrafts[r.id];s.fit=clone(s.fitRegions[0].fit);
 s.reviewed=false;s.approved=false;
 regionUi();ratioUi();renderList();renderApprovedPreview();renderFit();renderPlot();
};
$('deleteFitRegion').onclick=()=>{let s=current();if(!s||s.fitRegions.length<=1)return;
 if(!window.confirm('Delete this region? Ratios referring to it will become invalid.'))return;
 let id=s.activeRegionId;s.fitRegions=s.fitRegions.filter(r=>r.id!==id);delete s._fitDrafts[id];
 s.activeRegionId=s.fitRegions[0].id;s.fit=clone(s.fitRegions[0].fit);
 loadRegion(s);renderSeeds();renderFit();renderPlot();ratioUi();};
$('fitTable').onchange=e=>{
 const s=current(),regionId=e.target.dataset.region,
  r=s?.fitRegions?.find(v=>v.id===regionId),
  i=Number(e.target.dataset.peak),side=e.target.dataset.ratio;
 if(!r?.fit||r.stale||!r.fit.peaks?.[i]||!Number.isInteger(i)||!['n','d'].includes(side))return;
 const key=r.id+':'+i,own=side==='n'?ratioNumerator:ratioDenominator,
  other=side==='n'?ratioDenominator:ratioNumerator;
 if(e.target.checked){own.add(key);other.delete(key);}else own.delete(key);
 if(activeRatio){activeRatio.nPeaks=[...ratioNumerator];activeRatio.dPeaks=[...ratioDenominator];}
 const tag=side==='n'?'Num':'Den';
 $('ratio'+tag+'Mode').value='peaks';$('ratio'+tag+'Range').style.display='none';
 ratioStash();renderFit();
};
$('ratioSelect').onchange=()=>{let s=current();if(!s)return;
 activeRatio=clone(s.savedRatios.find(q=>q.id===$('ratioSelect').value)||freshRatio(s));
 ratioUi();renderFit();};
$('newRatio').onclick=()=>{let s=current();if(!s)return;
 activeRatio=freshRatio(s);s._ratioDraft=null;ratioUi();renderFit();};
$('saveRatio').onclick=()=>{let s=current();if(!s||!activeRatio)return;
 ratioRead();let result=evaluate(s,activeRatio);if(result.error){$('ratioSummary').textContent=result.error;return;}
 if(!activeRatio.id)activeRatio.id=idNext(s.savedRatios,'q');
 let i=s.savedRatios.findIndex(q=>q.id===activeRatio.id);
 if(i<0)s.savedRatios.push(clone(activeRatio));else s.savedRatios[i]=clone(activeRatio);
 s.activeRatioId=activeRatio.id;s._ratioDraft=clone(activeRatio);ratioUi();renderFit();};
$('deleteRatio').onclick=()=>{let s=current();if(!s||!activeRatio?.id)return;
 if(!window.confirm('Delete the saved ratio?'))return;
 s.savedRatios=s.savedRatios.filter(q=>q.id!==activeRatio.id);
 s.activeRatioId=s.savedRatios[0]?.id||null;s._ratioDraft=null;
 activeRatio=clone(s.savedRatios[0]||freshRatio(s));ratioUi();renderFit();};
for(const id of ['ratioName','ratioNumMode','ratioDenMode','ratioNumRegion','ratioDenRegion','regionNumMin','regionNumMax','regionDenMin','regionDenMax']){
 $(id).addEventListener('input',()=>{
  ratioStash();
  for(const tag of ['Num','Den'])$('ratio'+tag+'Range').style.display=$('ratio'+tag+'Mode').value==='range'?'grid':'none';
  renderRatio();
 });
}
$('fitMode').addEventListener('change',()=>{let r=activeRegion();if(r)r._pending=true;regionUi();});
const oldClearDataset=$('clearDataset').onclick;
$('clearDataset').onclick=()=>{
 oldClearDataset();
 if(!spectra.length){visibleSpectrum=null;activeRatio=null;regionUi();ratioUi();}
};
const oldFitClick=$('fitPeaks').onclick;
$('fitPeaks').onclick=()=>{if(!current())return;
 $('fitRegion').disabled=true;$('addFitRegion').disabled=true;oldFitClick();
 setTimeout(()=>{$('fitRegion').disabled=false;$('addFitRegion').disabled=false;regionUi();},0);
};
$('saveProcessed').onclick=()=>{
 stashRegion();ratioStash();
 let data={format:'raman-studio-v1',workflow:'processed',saved:new Date().toISOString(),
 analysisRegions:(()=>{let b=regionBounds();return b?[b.nMin,b.nMax,b.dMin,b.dMax]:null;})(),
 spectra:spectra.map(s=>({name:s.name,meta:s.meta,x:s.x,raw:s.raw,corrected:s.working,
 modified:s.modified||[],keep:true,reviewed:!!s.reviewed,approved:!!s.approved,
 processing:s.processing||null,fit:s.fit||null,
 fitRegions:s.fitRegions.map(r=>({id:r.id,name:r.name,settings:r.settings,fit:r.fit,seedXs:r.seedXs,stale:!!r.stale})),
 savedRatios:clone(s.savedRatios),activeRegionId:s.activeRegionId,activeRatioId:s.activeRatioId,
 preparedHost:!!s.preparedHost,preparedHostBaseline:s.preparedHostBaseline||null,
 manualBaselinePoints:cleanManualPoints(s.manualBaselinePoints)}))};
 download('raman_processed.json',new Blob([JSON.stringify(data)],{type:'application/json'}));
};
$('exportAnalysisCsv').onclick=()=>{
 let s=current();if(!s)return;init(s);
 let cols=['record_type','filename','compound','host_mineral','mol_kg','phase','temperature_C',
 'baseline_mode','host_subtracted','host_reference','region_id','region_name','fit_min_cm-1','fit_max_cm-1',
 'fit_mode','fit_profile','fit_baseline','fit_stale','peak','selected_cm-1','fitted_cm-1','height',
 'fwhm_cm-1','eta','area','r2','rmse','ratio_id','ratio_name','num_mode','den_mode','num_region',
 'den_region','num_peaks','den_peaks','num_min_cm-1','num_max_cm-1','den_min_cm-1','den_max_cm-1',
 'numerator_area','denominator_area','area_ratio','integration_note'];
 let rows=[cols],add=o=>rows.push(cols.map(c=>o[c]??''));
 let meta={filename:s.name,compound:s.meta?.compound,host_mineral:s.meta?.hostMineral,
 mol_kg:s.meta?.mol,phase:s.meta?.phase,temperature_C:s.meta?.temp,
 baseline_mode:s.processing?.baseline||'',host_subtracted:!!s.processing?.host?.enabled,
 host_reference:s.processing?.host?.referenceName||''};
 for(const r of s.fitRegions){
  if(!r.fit)continue;
  for(const [i,p] of r.fit.peaks.entries())add({...meta,record_type:'peak',
   region_id:r.id,region_name:r.name,'fit_min_cm-1':r.fit.xs?.[0],'fit_max_cm-1':r.fit.xs?.at(-1),
   fit_mode:r.fit.fitMode,fit_profile:r.fit.profile,fit_baseline:r.fit.baselineMode,
   fit_stale:!!r.stale,peak:i+1,'selected_cm-1':r.fit.seedXs?.[i]??p.c,
   'fitted_cm-1':p.c,height:p.h,'fwhm_cm-1':p.w,eta:p.eta??'',
   area:peakArea(p,r.fit.profile),r2:r.fit.r2,rmse:r.fit.rmse});
 }
 for(const q of s.savedRatios){
  let result=evaluate(s,q);
  add({...meta,record_type:'ratio',ratio_id:q.id,ratio_name:q.name,
   num_mode:q.nMode,den_mode:q.dMode,num_region:q.nRegion,den_region:q.dRegion,
   num_peaks:(q.nPeaks||[]).join(';'),den_peaks:(q.dPeaks||[]).join(';'),
   'num_min_cm-1':q.nMin,'num_max_cm-1':q.nMax,
   'den_min_cm-1':q.dMin,'den_max_cm-1':q.dMax,
   numerator_area:result.error?'':result.numerator,denominator_area:result.error?'':result.denominator,
   area_ratio:result.error?'':result.ratio,integration_note:result.error||''});
 }
 download('raman_analysis.csv',new Blob([rows.map(row=>row.map(csvVal).join(',')).join('\n')],{type:'text/csv'}));
};
renderPlot();regionUi();ratioUi();
})();