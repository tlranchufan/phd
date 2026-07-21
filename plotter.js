'use strict';

const $ = id => document.getElementById(id);
const state = { pending: null, file: null, rows: [], avgRows: [], sdRows: [], elements: [], codes: [] };

const atomicWeights = {
  Na:22.98976928, Al:26.9815385, Si:28.085, K:39.0983, Ca:40.078, Ti:47.867,
  Cr:51.9961, Mn:54.938044, Fe:55.845, Co:58.933194, Ni:58.6934, Cu:63.546,
  Zn:65.38, Rb:85.4678, Sr:87.62, Y:88.90584, Zr:91.224, Nb:92.90637,
  Cs:132.90545196, Ba:137.327, La:138.90547, Ce:140.116, Pr:140.90766,
  Nd:144.242, Sm:150.36, Eu:151.964, Gd:157.25, Tb:158.92535, Dy:162.5,
  Ho:164.93033, Er:167.259, Tm:168.93422, Yb:173.045, Lu:174.9668,
  Hf:178.49, Ta:180.94788, Pb:207.2, Th:232.0377, U:238.02891
};

const META = new Set(['Code','Compound','Mol/Kg','wt%','Metric','no. inclusions','File','DECISION','K/Cs','Na/Cs','Rb/Cs']);
const num = v => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replaceAll(',','').trim());
  return Number.isFinite(n) ? n : null;
};
const elemSymbol = name => (String(name).match(/^[A-Za-z]+/) || [''])[0];
const sanitizeName = value => {
  const s = String(value || 'laicpms_plot').trim().replace(/[\\/:*?"<>|]+/g,'_').replace(/\s+/g,'_');
  return s || 'laicpms_plot';
};
const selectedValues = select => [...select.selectedOptions].map(o => o.value);
const radioValue = name => document.querySelector(`input[name="${name}"]:checked`)?.value;

function fillDown(rows, columns) {
  const previous = {};
  return rows.map(row => {
    const out = {...row};
    columns.forEach(col => {
      const v = out[col];
      if (v === '' || v === null || v === undefined) out[col] = previous[col] ?? '';
      else previous[col] = v;
    });
    return out;
  });
}

function sortElements(elements) {
  return [...elements].sort((a,b) => {
    const awA = atomicWeights[elemSymbol(a)] ?? Infinity;
    const awB = atomicWeights[elemSymbol(b)] ?? Infinity;
    return awA - awB || a.localeCompare(b, undefined, {numeric:true});
  });
}

function findMetric(rows, target) {
  const t = target.toLowerCase();
  return rows.filter(r => String(r.Metric ?? '').trim().toLowerCase() === t);
}

function rowKey(row, index) {
  const filePart = String(row.File ?? '').trim();
  return `${String(row.Code ?? '').trim()}||${String(row.Compound ?? '').trim()}||${filePart}||${index}`;
}

function parseWorkbook(file, bytes) {
  const wb = XLSX.read(bytes, {type:'array', raw:true});
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, {defval:'', raw:true});
  const required = ['Code','Compound','Mol/Kg','wt%','Metric'];
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const missing = required.filter(h => !headers.includes(h));
  if (missing.length) throw new Error(`Missing required columns: ${missing.join(', ')}`);

  const filled = fillDown(rows, ['Code','Compound','Mol/Kg','wt%']);
  const avgRows = findMetric(filled, 'avg');
  const sdRows = findMetric(filled, 'std dev');
  if (!avgRows.length) throw new Error('No rows with Metric = "avg" were found.');

  const candidateElements = headers.filter(h => !META.has(h));
  const elements = sortElements(candidateElements.filter(h => avgRows.some(r => num(r[h]) !== null)));
  if (!elements.length) throw new Error('No numeric element columns were detected in the avg rows.');

  const sdLookup = new Map();
  sdRows.forEach((r,i) => {
    const key = `${String(r.Code)}||${String(r.Compound)}||${String(r['Mol/Kg'])}||${String(r['wt%'])}`;
    if (!sdLookup.has(key)) sdLookup.set(key, r);
  });
  avgRows.forEach((r,i) => {
    r.__index = i;
    r.__sampleKey = rowKey(r,i);
    const key = `${String(r.Code)}||${String(r.Compound)}||${String(r['Mol/Kg'])}||${String(r['wt%'])}`;
    r.__sd = sdLookup.get(key) || null;
  });

  return {
    name:file.name, size:file.size, sheetName, rows:filled, avgRows, sdRows,
    elements, codes:[...new Set(avgRows.map(r => String(r.Code)).filter(Boolean))].sort()
  };
}

function setOptions(select, values, selected=[]) {
  const chosen = new Set(selected);
  select.innerHTML = values.map(v => `<option value="${String(v).replaceAll('&','&amp;').replaceAll('"','&quot;')}" ${chosen.has(v)?'selected':''}>${v}</option>`).join('');
}

function clearWorkbook() {
  state.pending = null; state.file = null; state.rows=[]; state.avgRows=[]; state.sdRows=[]; state.elements=[]; state.codes=[];
  $('plotFile').value='';
  $('loadPlotFile').disabled=true; $('clearPlotFile').disabled=true;
  $('plotConfig').classList.add('hidden'); $('exportCard').classList.add('hidden');
  $('plotFileSummary').innerHTML=''; $('plotLoadStatus').textContent='Choose a workbook, then click Continue.';
  $('plotStatus').textContent='Load a workbook to begin.'; $('plotWarnings').classList.add('hidden');
  $('resetZoom').disabled=true;
  if (typeof Plotly !== 'undefined') Plotly.purge('plot');
}

function renderLoaded() {
  setOptions($('codes'), state.codes, state.codes);
  setOptions($('elements'), state.elements, state.elements.slice(0, Math.min(6,state.elements.length)));
  setOptions($('numerator'), state.elements, state.elements.slice(0,1));
  setOptions($('denominator'), state.elements, state.elements.slice(1,2));
  $('plotFileSummary').innerHTML = `<div class="file-item"><div class="file-meta"><div class="file-name">${state.file.name}</div><div class="file-detail">Sheet: ${state.file.sheetName} · ${state.avgRows.length} avg rows · ${state.elements.length} elements</div></div></div>`;
  $('plotConfig').classList.remove('hidden'); $('exportCard').classList.remove('hidden');
  $('clearPlotFile').disabled=false; $('resetZoom').disabled=false;
  renderPlot();
}

function nearestSpacing(values) {
  const unique = [...new Set(values.filter(Number.isFinite))].sort((a,b)=>a-b);
  if (unique.length < 2) return Math.max(Math.abs(unique[0] || 1),1);
  let min = Infinity;
  for (let i=1;i<unique.length;i++) if (unique[i]-unique[i-1] > 0) min=Math.min(min, unique[i]-unique[i-1]);
  return Number.isFinite(min) ? min : 1;
}

function applyOffsets(rows, xField, mode, spreadFraction) {
  const copy = rows.map((r,i) => ({...r, __displayX:num(r[xField]), __offset:0, __order:i}));
  if (mode === 'none') return copy;
  const spacing = nearestSpacing(copy.map(r=>r.__displayX));
  const totalSpread = spacing * spreadFraction;
  const groups = new Map();
  copy.forEach(r => {
    if (!Number.isFinite(r.__displayX)) return;
    const key = String(r.__displayX);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });
  groups.forEach(group => {
    const identity = r => mode === 'compound' ? String(r.Compound ?? '') : mode === 'code' ? String(r.Code ?? '') : r.__sampleKey;
    const ids = [...new Set(group.map(identity))];
    if (ids.length <= 1) return;
    const step = totalSpread / Math.max(1, ids.length-1);
    ids.forEach((id,idx) => {
      const offset = -totalSpread/2 + idx*step;
      group.filter(r => identity(r)===id).forEach(r => {r.__displayX += offset; r.__offset=offset;});
    });
  });
  return copy;
}

function subplotDomains(count) {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count/cols);
  const gapX=.07, gapY=.10;
  const w=(1-gapX*(cols-1))/cols, h=(1-gapY*(rows-1))/rows;
  return Array.from({length:count},(_,i)=>{
    const col=i%cols, row=Math.floor(i/cols);
    return {x:[col*(w+gapX), col*(w+gapX)+w], y:[1-(row+1)*h-row*gapY, 1-row*h-row*gapY]};
  });
}

function makeLayout(panelNames, xLabel, yLabel, logY) {
  const layout = {
    margin:{l:70,r:30,t:panelNames.length>1?70:30,b:65},
    legend:{orientation:'h',y:-0.18}, hovermode:'closest', paper_bgcolor:'#fff', plot_bgcolor:'#fff'
  };
  const domains=subplotDomains(panelNames.length);
  panelNames.forEach((name,i)=>{
    const n=i+1, suffix=n===1?'':n;
    layout[`xaxis${suffix}`]={domain:domains[i].x,title:{text:xLabel},showgrid:true,zeroline:false};
    layout[`yaxis${suffix}`]={domain:domains[i].y,title:{text:yLabel},type:logY?'log':'linear',showgrid:true,zeroline:false};
    if(panelNames.length>1) layout.annotations=(layout.annotations||[]).concat({text:name,x:(domains[i].x[0]+domains[i].x[1])/2,y:domains[i].y[1]+.025,xref:'paper',yref:'paper',showarrow:false,font:{size:13}});
  });
  return layout;
}

function buildSimplePlot(rows, xField) {
  const selectedElements = selectedValues($('elements'));
  if (!selectedElements.length) throw new Error('Select at least one element.');
  const yMode=radioValue('yMode');
  const facetElements=$('facetElements').checked, facetCompounds=$('facetCompounds').checked;
  const showErr=$('showErr').checked, logY=$('logY').checked;
  const panelNames = facetElements && facetCompounds
    ? [...new Set(rows.flatMap(r=>selectedElements.map(e=>`${e} · ${r.Compound || 'Unknown'}`)))]
    : facetElements ? selectedElements
    : facetCompounds ? [...new Set(rows.map(r=>String(r.Compound||'Unknown')))]
    : ['Plot'];
  const traces=[];
  panelNames.forEach((panel,panelIndex)=>{
    selectedElements.forEach(element=>{
      const byCompound=new Map();
      rows.forEach(r=>{
        const comp=String(r.Compound||'Unknown');
        const panelMatch = facetElements && facetCompounds ? panel===`${element} · ${comp}` : facetElements ? panel===element : facetCompounds ? panel===comp : true;
        if(!panelMatch) return;
        const raw=num(r[element]); if(raw===null) return;
        const aw=atomicWeights[elemSymbol(element)];
        if(yMode==='mol' && !aw) return;
        const y=yMode==='mol'?raw/aw:raw;
        const sdRaw=num(r.__sd?.[element]); const err=sdRaw===null?null:(yMode==='mol'?sdRaw/aw:sdRaw);
        if(logY && y<=0) return;
        if(!byCompound.has(comp)) byCompound.set(comp,[]);
        byCompound.get(comp).push({r,y,err});
      });
      byCompound.forEach((pts,comp)=>{
        pts.sort((a,b)=>a.r.__displayX-b.r.__displayX);
        const axis=panelIndex+1, suffix=axis===1?'':axis;
        traces.push({
          type:'scatter', mode:'lines+markers', name:panelNames.length>1?`${element} · ${comp}`:`${element}${byCompound.size>1?' · '+comp:''}`,
          x:pts.map(p=>p.r.__displayX), y:pts.map(p=>p.y), xaxis:`x${suffix}`, yaxis:`y${suffix}`,
          marker:{size:10}, line:{width:2},
          error_y:showErr?{type:'data',array:pts.map(p=>p.err??0),visible:true,thickness:1.2,width:4}:undefined,
          customdata:pts.map(p=>[p.r.Code,p.r.Compound,p.r[xField],p.r.__offset,p.r.File||'',element]),
          hovertemplate:'Code: %{customdata[0]}<br>Compound: %{customdata[1]}<br>'+xField+': %{customdata[2]}<br>Display offset: %{customdata[3]:.4g}<br>Element: %{customdata[5]}<br>Y: %{y:.6g}<extra></extra>'
        });
      });
    });
  });
  return {traces, layout:makeLayout(panelNames,xField,yMode==='mol'?'Element (mol/kg)':'ppm',logY)};
}

function buildRatioPlot(rows,xField) {
  const numerator=$('numerator').value, denominator=$('denominator').value;
  if(!numerator||!denominator) throw new Error('Choose numerator and denominator elements.');
  if(numerator===denominator) throw new Error('Choose two different elements.');
  const basis=radioValue('ratioBasis'), logY=$('ratioLogY').checked;
  const numAw=atomicWeights[elemSymbol(numerator)], denAw=atomicWeights[elemSymbol(denominator)];
  if(basis==='mm' && (!numAw || !denAw)) throw new Error('An atomic weight is missing for the selected ratio.');
  const groups=new Map(); let skippedZero=0;
  rows.forEach(r=>{
    const a=num(r[numerator]), b=num(r[denominator]);
    if(a===null||b===null||b===0){ if(b===0) skippedZero++; return; }
    let ratio=basis==='mm'?(a/numAw)/(b/denAw):a/b;
    if(logY && ratio<=0) return;
    const comp=String(r.Compound||'Unknown'); if(!groups.has(comp))groups.set(comp,[]);
    groups.get(comp).push({r,ratio});
  });
  const traces=[];
  groups.forEach((pts,comp)=>{
    pts.sort((a,b)=>a.r.__displayX-b.r.__displayX);
    traces.push({type:'scatter',mode:'lines+markers',name:comp,x:pts.map(p=>p.r.__displayX),y:pts.map(p=>p.ratio),marker:{size:10},line:{width:2},customdata:pts.map(p=>[p.r.Code,p.r.Compound,p.r[xField],p.r.__offset]),hovertemplate:'Code: %{customdata[0]}<br>Compound: %{customdata[1]}<br>'+xField+': %{customdata[2]}<br>Display offset: %{customdata[3]:.4g}<br>Ratio: %{y:.6g}<extra></extra>'});
  });
  return {traces,layout:makeLayout(['Plot'],xField,`${numerator}/${denominator} (${basis==='mm'?'mol/mol':'w/w'})`,logY),warnings:skippedZero?[`${skippedZero} row(s) were skipped because the denominator was zero.`]:[]};
}

function renderPlot() {
  if(!state.file) return;
  try {
    const codes=new Set(selectedValues($('codes')));
    if(!codes.size) throw new Error('Select at least one Code.');
    const xField=radioValue('xunit');
    const rawRows=state.avgRows.filter(r=>codes.has(String(r.Code)) && num(r[xField])!==null);
    const mode=$('offsetMode').value, spread=Number($('offsetSpread').value);
    const rows=applyOffsets(rawRows,xField,mode,spread);
    const result=radioValue('plotMode')==='simple'?buildSimplePlot(rows,xField):buildRatioPlot(rows,xField);
    const warnings=result.warnings||[];
    const width=$('plot').clientWidth||900;
    const auto=$('autoAspect').checked;
    let aspect=Number($('aspectRatio').value)||.7;
    if(auto){
      const faceted=radioValue('plotMode')==='simple' && ($('facetElements').checked||$('facetCompounds').checked);
      const count=faceted ? Math.max(1,(result.layout.annotations||[]).length) : 1;
      aspect=faceted?Math.min(1.6,.58+.16*Math.ceil(Math.sqrt(count))):.7;
    }
    result.layout.height=Math.max(520,Math.round(width*aspect));
    result.layout.autosize=true;
    Plotly.react('plot',result.traces,result.layout,{responsive:true,displaylogo:false,scrollZoom:true,toImageButtonOptions:{format:'png',filename:sanitizeName($('plotName').value),scale:2}});
    $('plotStatus').textContent=`${rawRows.length} sample row(s), ${codes.size} Code(s), x = ${xField}; offset mode: ${mode}.`;
    $('plotWarnings').textContent=warnings.join(' '); $('plotWarnings').classList.toggle('hidden',warnings.length===0);
  } catch(err) {
    Plotly.purge('plot');
    $('plotStatus').textContent=`Cannot plot: ${err.message}`;
  }
}

async function exportImage(format) {
  if(!state.file) return;
  const name=sanitizeName($('plotName').value);
  const width=1400;
  const auto=$('autoAspect').checked;
  const ratio=auto ? (($('plot').clientHeight||700)/Math.max($('plot').clientWidth||1000,1)) : Number($('aspectRatio').value)||.7;
  const height=Math.max(500,Math.round(width*ratio));
  const url=await Plotly.toImage('plot',{format,width,height,scale:format==='png'?2:1});
  const a=document.createElement('a');a.href=url;a.download=`${name}.${format}`;a.click();
}

async function exportPdf() {
  const name=sanitizeName($('plotName').value);
  const width=1400, ratio=$('autoAspect').checked?(($('plot').clientHeight||700)/Math.max($('plot').clientWidth||1000,1)):(Number($('aspectRatio').value)||.7), height=Math.max(500,Math.round(width*ratio));
  const dataUrl=await Plotly.toImage('plot',{format:'png',width,height,scale:2});
  const orientation=width>=height?'landscape':'portrait';
  const {jsPDF}=window.jspdf;
  const pdf=new jsPDF({orientation,unit:'pt',format:'a4'});
  const pageW=pdf.internal.pageSize.getWidth(), pageH=pdf.internal.pageSize.getHeight(), margin=28;
  const scale=Math.min((pageW-2*margin)/width,(pageH-2*margin)/height);
  pdf.addImage(dataUrl,'PNG',(pageW-width*scale)/2,(pageH-height*scale)/2,width*scale,height*scale);
  pdf.save(`${name}.pdf`);
}

function exportHtml() {
  const name=sanitizeName($('plotName').value);
  const graph=$('plot');
  const payload={data:graph.data||[],layout:graph.layout||{}};
  const html=`<!doctype html><html><head><meta charset="utf-8"><title>${name}</title><script src="https://cdn.plot.ly/plotly-2.35.2.min.js"><\/script></head><body><div id="plot" style="width:100%;height:95vh"></div><script>const fig=${JSON.stringify(payload)};Plotly.newPlot('plot',fig.data,fig.layout,{responsive:true,displaylogo:false});<\/script></body></html>`;
  const blob=new Blob([html],{type:'text/html'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${name}.html`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

$('plotFile').addEventListener('change',e=>{
  state.pending=e.target.files[0]||null;
  $('loadPlotFile').disabled=!state.pending;
  $('plotLoadStatus').textContent=state.pending?`${state.pending.name} selected. Click Continue to load it.`:'Choose a workbook, then click Continue.';
});
$('loadPlotFile').addEventListener('click',async()=>{
  if(!state.pending)return;
  try{
    if(typeof XLSX==='undefined')throw new Error('The Excel-reading library did not load.');
    $('loadPlotFile').disabled=true;$('plotLoadStatus').textContent='Reading workbook…';
    const parsed=parseWorkbook(state.pending,await state.pending.arrayBuffer());
    Object.assign(state,{file:parsed,rows:parsed.rows,avgRows:parsed.avgRows,sdRows:parsed.sdRows,elements:parsed.elements,codes:parsed.codes});
    $('plotLoadStatus').textContent='Workbook loaded successfully.';renderLoaded();
  }catch(err){console.error(err);$('plotLoadStatus').textContent=`Error: ${err.message}`;$('loadPlotFile').disabled=false;}
});
$('clearPlotFile').addEventListener('click',clearWorkbook);
$('selectAllCodes').addEventListener('click',()=>{[...$('codes').options].forEach(o=>o.selected=true);renderPlot();});
$('clearCodes').addEventListener('click',()=>{[...$('codes').options].forEach(o=>o.selected=false);renderPlot();});
$('selectAllElements').addEventListener('click',()=>{[...$('elements').options].forEach(o=>o.selected=true);renderPlot();});
$('clearElements').addEventListener('click',()=>{[...$('elements').options].forEach(o=>o.selected=false);renderPlot();});
$('offsetSpread').addEventListener('input',()=>{$('offsetSpreadValue').textContent=`${Math.round(Number($('offsetSpread').value)*100)}%`;renderPlot();});
$('autoAspect').addEventListener('change',()=>{$('aspectWrap').classList.toggle('hidden',$('autoAspect').checked);renderPlot();});
$('resetZoom').addEventListener('click',()=>Plotly.relayout('plot',{'xaxis.autorange':true,'yaxis.autorange':true}));
$('downloadPng').addEventListener('click',()=>exportImage('png'));
$('downloadSvg').addEventListener('click',()=>exportImage('svg'));
$('downloadPdf').addEventListener('click',exportPdf);
$('downloadHtml').addEventListener('click',exportHtml);

document.querySelectorAll('#plotConfig input, #plotConfig select').forEach(el=>el.addEventListener('change',()=>{
  const ratio=radioValue('plotMode')==='ratio';
  $('simpleControls').classList.toggle('hidden',ratio);$('ratioControls').classList.toggle('hidden',!ratio);renderPlot();
}));
$('plotName').addEventListener('change',renderPlot);
window.addEventListener('resize',()=>{if(state.file)renderPlot();});

clearWorkbook();
