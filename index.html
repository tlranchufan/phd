/* REE Excel Processor — GitHub Pages edition */
'use strict';

const state = { files: [], pendingFiles: [], elements: [], denom: null, numerators: [], colors: [] };
const $ = id => document.getElementById(id);
const elementRx = /^[A-Za-z]{1,2}\d+$/;
const sym = s => (String(s).match(/^[A-Za-z]{1,2}/) || [''])[0];
const isLt = v => v != null && String(v).trim().startsWith('<');
const numeric = v => {
  if (v == null || v === '' || isLt(v)) return null;
  const n = Number(String(v).replaceAll(',', '').trim());
  return Number.isFinite(n) ? n : null;
};
const mean = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : null;
const sd = a => {
  if (a.length < 2) return null;
  const m = mean(a); return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1));
};
const stats = values => {
  const nums = values.map(numeric).filter(v=>v!==null);
  const m=mean(nums), s=sd(nums); return { mean:m, sd:s, rsd:(m===null||m===0||s===null)?null:s/m, n:nums.length };
};
const fmt = v => typeof v === 'number' && Number.isFinite(v) ? v.toFixed(2) : (v ?? '');
const baseName = n => n.replace(/\.(xls|xlsx)$/i,'');
const fileKey = file => `${file.name}::${file.size}::${file.lastModified}`;
const humanSize = bytes => bytes < 1024 ? `${bytes} B` : bytes < 1024**2 ? `${(bytes/1024).toFixed(1)} KB` : `${(bytes/1024**2).toFixed(1)} MB`;

const downloadBlob = (blob,name) => { const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1500); };


function renderPendingSelection(){
  const n=state.pendingFiles.length;
  $('continueUpload').disabled=n===0;
  $('clearSelection').disabled=n===0;
  $('selectionStatus').textContent=n
    ? `${n} file(s) selected and ready. Click Continue to read and add them.`
    : 'Choose one or more files, then click Continue.';
}

function clearCurrentSelection(){
  state.pendingFiles=[];
  $('files').value='';
  renderPendingSelection();
}

function parseSections(grid) {
  const anchors=[];
  for(let r=0;r<grid.length;r++) if(/^(SAMPLES|HOSTS):\s+.+/.test(String(grid[r]?.[0]??''))) anchors.push(r);
  const sections=[];
  anchors.forEach((a,i)=>{
    const end=(i+1<anchors.length?anchors[i+1]:grid.length)-1;
    const label=String(grid[a][0]);
    const m=label.match(/^(SAMPLES|HOSTS):\s*(.+)$/); if(!m) return;
    const headers=(grid[a+1]||[]).map(v=>String(v??'').trim());
    let last=-1; headers.forEach((h,j)=>{if(h)last=j;}); if(last<0)return;
    const names=[]; const seen={};
    for(let c=0;c<=last;c++){let h=headers[c]||`X${c+1}`; seen[h]=(seen[h]||0)+1; names.push(seen[h]>1?`${h}_${seen[h]}`:h);}
    const data=[];
    for(let r=a+3;r<=end;r++){
      const row=(grid[r]||[]).slice(0,last+1); if(row.every(v=>v==null||String(v).trim()===''))continue;
      const obj={}; names.forEach((h,c)=>obj[h]=row[c]??''); data.push(obj);
    }
    sections.push({scope:m[1],type:m[2].trim(),data});
  });
  return sections;
}
function getSection(sections,scope,type){return sections.find(s=>s.scope===scope&&s.type===type)?.data||null;}

function refreshElements(){
  const allElements=new Set();
  state.files.forEach(f=>f.elements.forEach(e=>allElements.add(e)));
  state.elements=[...allElements].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
}

async function loadFiles(fileList){
  const existing=new Set(state.files.map(f=>f.key));
  let added=0, skipped=0;
  for(const file of fileList){
    const key=fileKey(file);
    if(existing.has(key)){ skipped++; continue; }
    const bytes=await file.arrayBuffer();
    const wb=XLSX.read(bytes,{type:'array',raw:true});
    const ws=wb.Sheets[wb.SheetNames[0]];
    const grid=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true});
    const sections=parseSections(grid);
    const comp=getSection(sections,'SAMPLES','Composition Summary');
    const lod=getSection(sections,'SAMPLES','Limits of Detection Summary');
    if(!comp||!comp.length||!Object.hasOwn(comp[0],'File')) throw new Error(`${file.name}: missing SAMPLES: Composition Summary or File column.`);
    const elements=Object.keys(comp[0]).filter(h=>elementRx.test(h));
    state.files.push({key,name:file.name,size:file.size,lastModified:file.lastModified,comp,lod,elements,keep:Array(comp.length).fill(true),preview:null});
    existing.add(key); added++;
  }
  refreshElements();
  return {added,skipped};
}

function renderLoadedFiles(){
  const box=$('loadedFiles');
  box.innerHTML='';
  state.files.forEach((f,i)=>{
    const row=document.createElement('div'); row.className='file-item';
    row.innerHTML=`<div class="file-meta"><div class="file-name">${f.name}</div><div class="file-detail">${humanSize(f.size)} · ${f.comp.length} composition rows</div></div>`;
    const btn=document.createElement('button'); btn.type='button'; btn.className='file-remove'; btn.textContent='Remove'; btn.onclick=()=>removeFile(i);
    row.appendChild(btn); box.appendChild(row);
  });
  $('clearFiles').disabled=state.files.length===0;
  $('loadStatus').textContent=state.files.length ? `Loaded ${state.files.length} file(s); discovered ${state.elements.length} element columns. Add more files at any time, including from other folders.` : 'No files loaded.';
}

function resetDownstream(){
  state.denom=null; state.numerators=[]; state.colors=[];
  $('configCard').classList.add('hidden');
  $('reviewCard').classList.add('hidden');
  $('downloadCard').classList.add('hidden');
  $('reviewFile').innerHTML=''; $('reviewTable').innerHTML=''; $('reviewSummary').innerHTML=''; $('buildStatus').textContent='';
}

function removeFile(index){
  state.files.splice(index,1);
  refreshElements();
  resetDownstream();
  renderLoadedFiles();
  if(state.files.length) renderConfig();
}

function clearAllFiles(){
  state.files.length=0; state.pendingFiles.length=0; state.elements.length=0;
  resetDownstream();
  $('files').value='';
  renderPendingSelection();
  renderLoadedFiles();
}

function checkbox(label,value,checked,group){
  const el=document.createElement('label');
  el.innerHTML=`<input type="checkbox" value="${value}" ${checked?'checked':''} data-group="${group}"><span>${label}</span>`; return el;
}
function renderConfig(){
  $('denom').innerHTML=state.elements.map(e=>`<option ${e==='Cs133'?'selected':''}>${e}</option>`).join('');
  renderNumerators(); renderColors(); $('configCard').classList.remove('hidden');
}
function renderNumerators(){
  const d=$('denom').value; const defaults=['Na23','K39','Rb85']; const box=$('numerators'); box.innerHTML='';
  state.elements.filter(e=>e!==d).forEach(e=>box.appendChild(checkbox(e,e,defaults.includes(e),'num')));
}
function selected(group){return [...document.querySelectorAll(`input[data-group="${group}"]:checked`)].map(x=>x.value);}
function renderColors(){
  const d=$('denom').value, nums=selected('num'); const ratios=nums.map(n=>`${sym(n)}/${sym(d)}`); const choices=[...state.elements,...ratios];
  const defaults=['Y89','La139','Nd146','Yb172',`Na/${sym(d)}`,`K/${sym(d)}`,`Rb/${sym(d)}`]; const box=$('colorColumns'); box.innerHTML='';
  choices.forEach(e=>box.appendChild(checkbox(e,e,defaults.includes(e),'color')));
}

function buildPreview(f){
  const rows=f.comp.map(r=>{const o={File:r.File}; f.elements.forEach(e=>o[e]=r[e]??'');
    state.numerators.forEach(n=>{const rn=`${sym(n)}/${sym(state.denom)}`; const nv=r[n],dv=r[state.denom];
      if(isLt(nv))o[rn]=String(nv); else if(isLt(dv))o[rn]=String(dv); else {const a=numeric(nv),b=numeric(dv);o[rn]=(a===null||b===null||b===0)?'':a/b;}
    }); return o;});
  const candidates=Object.keys(rows[0]||{}).filter(c=>c!=='File');
  const valid=candidates.filter(c=>rows.map(r=>numeric(r[c])).filter(x=>x!==null).length>=2||state.colors.includes(c));
  f.preview=rows.map(r=>Object.fromEntries(['File',...valid].map(c=>[c,r[c]])));
}
function styleCode(v,s){
  if(isLt(v))return'gray'; const n=numeric(v); if(n===null||s.mean===null||s.sd===null||s.sd===0)return'';
  const d=Math.abs(n-s.mean); return d<=s.sd?'green':d<=2*s.sd?'blue':d<=3*s.sd?'orange':'red';
}
function currentStats(f){
  const kept=f.preview.filter((_,i)=>f.keep[i]); const out={}; state.colors.forEach(c=>{if(c in (f.preview[0]||{}))out[c]=stats(kept.map(r=>r[c]));}); return out;
}
function renderReview(){
  $('reviewFile').innerHTML=state.files.map((f,i)=>`<option value="${i}">${f.name}</option>`).join('');
  $('reviewCard').classList.remove('hidden'); $('downloadCard').classList.remove('hidden'); renderTable();
}
function renderTable(){
  const f=state.files[Number($('reviewFile').value)||0], st=currentStats(f); const cols=Object.keys(f.preview[0]||{});
  $('reviewSummary').innerHTML=`<span class="stat-pill">Kept ${f.keep.filter(Boolean).length} / ${f.keep.length}</span>`+Object.entries(st).map(([c,s])=>`<span class="stat-pill"><b>${c}</b>: ${s.mean===null?'—':fmt(s.mean)} ± ${s.sd===null?'—':fmt(s.sd)} (n=${s.n})</span>`).join('');
  const t=$('reviewTable'); t.innerHTML=`<thead><tr><th>Decision</th>${cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead><tbody></tbody>`; const tb=t.querySelector('tbody');
  f.preview.forEach((r,i)=>{const tr=document.createElement('tr'); if(!f.keep[i])tr.className='excluded';
    const dc=document.createElement('td'); dc.className='decision'; dc.textContent=f.keep[i]?'KEEP':'EXCLUDE'; dc.onclick=()=>{f.keep[i]=!f.keep[i];renderTable();}; tr.appendChild(dc);
    cols.forEach(c=>{const td=document.createElement('td'); td.textContent=fmt(r[c]); if(state.colors.includes(c)){const sc=styleCode(r[c],st[c]||{});if(sc)td.classList.add(`bg-${sc}`);} tr.appendChild(td);}); tb.appendChild(tr);
  });
}

function styleCell(cell,code){const fills={gray:'BFBFBF',green:'C6EFCE',blue:'BDD7EE',orange:'F8CBAD',red:'FFC7CE'};if(fills[code])cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF'+fills[code]}};}
function addFormattedSheet(wb,f,sheetName){
  const ws=wb.addWorksheet(sheetName.slice(0,31).replace(/[:\\/?*\[\]]/g,'_')||'Sheet');
  const kept=f.preview.filter((_,i)=>f.keep[i]); const cols=Object.keys(f.preview[0]||{}); const sts={}; cols.filter(c=>c!=='File').forEach(c=>sts[c]=stats(kept.map(r=>r[c])));
  ws.addRow(cols); kept.forEach(r=>ws.addRow(cols.map(c=>{const n=numeric(r[c]);return isLt(r[c])?String(r[c]):n===null?String(r[c]??''):n;})));
  ['Average','Std Dev','RSD'].forEach((lab,k)=>ws.addRow(cols.map(c=>c==='File'?lab:[sts[c]?.mean,sts[c]?.sd,sts[c]?.rsd][k])));
  ws.getRow(1).font={bold:true}; ws.getRow(1).border={bottom:{style:'thin'}};
  for(let r=2;r<=kept.length+1;r++) for(let c=2;c<=cols.length;c++){const cell=ws.getCell(r,c);cell.numFmt='0.00';const col=cols[c-1];if(state.colors.includes(col))styleCell(cell,styleCode(kept[r-2][col],sts[col]));}
  for(let r=kept.length+2;r<=kept.length+4;r++){ws.getCell(r,1).font={bold:true};for(let c=2;c<=cols.length;c++)ws.getCell(r,c).numFmt='0.00';}
  if(f.lod?.length){ws.addRow([]);ws.addRow([]);ws.addRow([]);ws.addRow(['SAMPLES: Limits of Detection Summary']);ws.lastRow.font={bold:true};
    const keptNames=new Set(kept.map(r=>String(r.File))); const lodRows=f.lod.filter(r=>keptNames.has(String(r.File))); const lodCols=['File',...f.elements.filter(e=>Object.hasOwn(f.lod[0]||{},e))]; ws.addRow(lodCols);ws.lastRow.font={bold:true};
    lodRows.forEach(r=>ws.addRow(lodCols.map(c=>{const n=numeric(r[c]);return isLt(r[c])?String(r[c]):n===null?String(r[c]??''):n;})));
  }
  ws.columns.forEach(col=>{let m=10;col.eachCell({includeEmpty:true},cell=>m=Math.max(m,String(cell.value??'').length+2));col.width=Math.min(m,28);}); ws.views=[{state:'frozen',ySplit:1}];
  return {cols,sts,keptCount:kept.length};
}
async function workbookBlob(f){const wb=new ExcelJS.Workbook();addFormattedSheet(wb,f,'Processed');return new Blob([await wb.xlsx.writeBuffer()],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});}
function csvFor(f){const rows=[['source_file','File','decision','timestamp']];const ts=new Date().toISOString().slice(0,19).replace('T',' ');f.comp.forEach((r,i)=>rows.push([f.name,r.File,f.keep[i]?'KEEP':'EXCLUDE',ts]));return rows.map(row=>row.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\r\n');}
async function downloadZip(){
  $('buildStatus').textContent='Building files…'; const zip=new JSZip();
  for(const f of state.files){zip.file(`${baseName(f.name)}_processed.xlsx`,await workbookBlob(f));zip.file(`${baseName(f.name)}_keep_exclude.csv`,csvFor(f));}
  downloadBlob(await zip.generateAsync({type:'blob'}),'ree_processed_outputs.zip'); $('buildStatus').textContent='Processed ZIP created.';
}
async function downloadCollated(){
  $('buildStatus').textContent='Building collated workbook…'; const wb=new ExcelJS.Workbook(); const summary=wb.addWorksheet('Collated_Summary'); const blocks=[]; const allCols=new Set();
  state.files.forEach(f=>{const info=addFormattedSheet(wb,f,baseName(f.name));Object.keys(info.sts).forEach(c=>allCols.add(c));blocks.push({code:baseName(f.name),...info});});
  const cols=[...allCols]; summary.addRow(['Code','Metric',...cols,'no. inclusions']);
  blocks.forEach(b=>['avg','std dev','rsd'].forEach((metric,k)=>summary.addRow([k===0?b.code:'',metric,...cols.map(c=>[b.sts[c]?.mean,b.sts[c]?.sd,b.sts[c]?.rsd][k]??null),k===0?b.keptCount:null])));
  summary.getRow(1).font={bold:true};summary.getRow(1).border={bottom:{style:'thin'}};summary.views=[{state:'frozen',ySplit:1}];summary.columns.forEach(c=>c.width=16);
  for(let r=2;r<=summary.rowCount;r++){for(let c=3;c<=summary.columnCount;c++)summary.getCell(r,c).numFmt='0.00';if(summary.getCell(r,2).value==='avg')state.colors.forEach(col=>{const ci=cols.indexOf(col);if(ci>=0)styleCell(summary.getCell(r,ci+3),'green');});}
  downloadBlob(new Blob([await wb.xlsx.writeBuffer()],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),'_collated.xlsx');$('buildStatus').textContent='Collated workbook created.';
}

$('files').addEventListener('change',e=>{
  state.pendingFiles=[...e.target.files];
  renderPendingSelection();
});
$('continueUpload').addEventListener('click',async()=>{
  if(!state.pendingFiles.length)return;
  try{
    if(typeof XLSX==='undefined') throw new Error('The Excel-reading library did not load. Check your internet connection or browser content-blocking settings, then reload the page.');
    $('continueUpload').disabled=true;
    $('clearSelection').disabled=true;
    $('loadStatus').textContent=`Reading ${state.pendingFiles.length} selected file(s)…`;
    const batch=[...state.pendingFiles];
    const result=await loadFiles(batch);
    clearCurrentSelection();
    resetDownstream();
    renderLoadedFiles();
    if(state.files.length) renderConfig();
    $('loadStatus').textContent=`Added ${result.added} file(s). ${state.files.length} file(s) are now loaded.`+(result.skipped?` Skipped ${result.skipped} duplicate file(s).`:'');
  }catch(err){
    console.error(err);
    $('loadStatus').textContent=`Error: ${err.message}`;
    renderPendingSelection();
  }
});
$('clearSelection').addEventListener('click',clearCurrentSelection);
$('clearFiles').addEventListener('click',clearAllFiles);
$('denom').addEventListener('change',()=>{renderNumerators();renderColors();});
$('numerators').addEventListener('change',renderColors);
$('applyConfig').addEventListener('click',()=>{state.denom=$('denom').value;state.numerators=selected('num').filter(x=>x!==state.denom);state.colors=selected('color');if(!state.numerators.length){alert('Select at least one numerator.');return;}state.files.forEach(buildPreview);renderReview();});
$('reviewFile').addEventListener('change',renderTable);
$('downloadZip').addEventListener('click',downloadZip);
$('downloadCollated').addEventListener('click',downloadCollated);

renderPendingSelection();
renderLoadedFiles();
