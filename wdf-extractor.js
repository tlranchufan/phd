/* WDF ZIP extractor: original binary contents are preserved. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const state = {file:null, zip:null, files:[], scanning:false, exporting:false};
const progress = n => $('wdfProgress').style.width = Math.max(0,Math.min(100,n))+'%';
const status = (s,error=false) => { $('wdfStatus').textContent=s; $('wdfStatus').classList.toggle('error-box',error); };
const basename = p => p.replace(/\\/g,'/').split('/').pop();
const folder = p => {const n=p.lastIndexOf('/');return n===-1?'(ZIP root)':p.slice(0,n);};
const bytes = n => n<1024?n+' B':n<1048576?(n/1024).toFixed(1)+' KB':(n/1048576).toFixed(1)+' MB';
const selection = () => state.files.filter(x=>x.keep);
const blockSystem = p => p.split('/').some(x=>x==='__MACOSX'||x==='.DS_Store'||x.startsWith('._'));
function refreshSummary(){
 const n=selection().length;
 $('wdfSummary').textContent=n+' selected of '+state.files.length+' WDF files';
 $('wdfDownload').disabled=!n||state.scanning||state.exporting;
}
function render(){
 const search=$('wdfSearch').value.trim().toLowerCase();
 const visible=state.files.filter(e=>e.name.toLowerCase().includes(search));
 const body=$('wdfPreview');body.replaceChildren();
 const fragment=document.createDocumentFragment();
 for(const entry of visible){
   const tr=document.createElement('tr');
   const td=document.createElement('td');
   const cb=document.createElement('input');cb.type='checkbox';cb.checked=entry.keep;
   cb.setAttribute('aria-label','Keep '+entry.name);
   cb.addEventListener('change',()=>{entry.keep=cb.checked;refreshSummary();});
   td.appendChild(cb);tr.appendChild(td);
   for(const value of [basename(entry.name),folder(entry.name),bytes(entry.size)]){
      const cell=document.createElement('td');cell.textContent=value;tr.appendChild(cell);
   }
   fragment.appendChild(tr);
 }
 body.appendChild(fragment);
 $('wdfShowing').textContent='Showing '+visible.length+' of '+state.files.length+' files';
 refreshSummary();
}
function reset(file=null){
 state.file=file;state.zip=null;state.files=[];
 $('wdfScan').disabled=!file;$('wdfReset').disabled=!file;$('wdfDownload').disabled=true;
 $('wdfSelection').classList.add('hidden');$('wdfSearch').value='';
 $('wdfPreview').replaceChildren();$('wdfSummary').textContent='';progress(0);
 status(file?'Ready to scan '+file.name+'.':'Choose a ZIP archive to begin.');
}
async function scan(){
 if(!state.file||state.scanning)return;
 if(!state.file.name.toLowerCase().endsWith('.zip')){status('Please choose a ZIP file.',true);return;}
 state.scanning=true;$('wdfScan').disabled=true;$('wdfDownload').disabled=true;
 $('wdfSelection').classList.add('hidden');
 try{
   if(typeof JSZip==='undefined')throw Error('ZIP library unavailable. Reload the page.');
   progress(10);status('Searching ZIP folders…');
   const archive=await JSZip.loadAsync(state.file);
   state.zip=archive;
   state.files=Object.values(archive.files)
     .filter(e=>!e.dir&&/\.wdf$/i.test(e.name)&&!blockSystem(e.name.replace(/\\/g,'/')))
     .map(e=>({name:e.name.replace(/\\/g,'/'),source:e,keep:true,size:e._data?.uncompressedSize??0}));
   state.files.sort((a,b)=>a.name.localeCompare(b.name));
   progress(100);
   if(!state.files.length){status('No .wdf files were found.');return;}
   $('wdfSelection').classList.remove('hidden');
   render();status('Found '+state.files.length+' WDF files. Untick any you want to exclude.');
 }catch(e){console.error(e);status(e.message||'Could not read ZIP.',true);progress(0);}
 finally{state.scanning=false;$('wdfScan').disabled=!state.file;refreshSummary();}
}
function outputName(entry,flat,used){
 const cleaned=entry.name.split('/').filter(s=>s&&s!=='.'&&s!=='..').join('/');
 const initial=flat?basename(cleaned):cleaned;
 let name=initial,idx=2;
 const slash=initial.lastIndexOf('/'),dir=slash>=0?initial.slice(0,slash+1):'';
 const filename=slash>=0?initial.slice(slash+1):initial;
 const pos=filename.lastIndexOf('.'),stem=pos>=0?filename.slice(0,pos):filename,ext=pos>=0?filename.slice(pos):'';
 while(used.has(name.toLowerCase()))name=dir+stem+'_'+idx+++ext;
 used.add(name.toLowerCase());return name;
}
async function download(){
 const chosen=selection();if(!chosen.length||state.exporting)return;
 state.exporting=true;refreshSummary();
 try{
   const zip=new JSZip(),used=new Set();
   const flat=document.querySelector('input[name="wdfLayout"]:checked')?.value!=='retain';
   status('Collecting selected files…');progress(5);
   for(let i=0;i<chosen.length;i++){
     const file=chosen[i];
     // Binary pass-through: no Raman parsing or spectrum modifications.
     const data=await file.source.async('uint8array');
     zip.file(outputName(file,flat,used),data,{date:file.source.date});
     progress(5+Math.round(45*(i+1)/chosen.length));
     if(i%15===0)await new Promise(r=>setTimeout(r,0));
   }
   status('Creating output ZIP…');
   const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}},
     m=>progress(50+Math.round(m.percent*.5)));
   const url=URL.createObjectURL(blob),a=document.createElement('a');
   a.href=url;a.download='selected_wdf_files.zip';document.body.appendChild(a);a.click();a.remove();
   setTimeout(()=>URL.revokeObjectURL(url),30000);
   status('Downloaded '+chosen.length+' selected WDF files.');progress(100);
 }catch(e){console.error(e);status(e.message||'Could not create ZIP.',true);}
 finally{state.exporting=false;refreshSummary();}
}
document.addEventListener('DOMContentLoaded',()=>{
 const input=$('wdfZipFile');
 input.addEventListener('change',()=>reset(input.files[0]||null));
 $('wdfScan').addEventListener('click',scan);
 $('wdfReset').addEventListener('click',()=>{input.value='';reset();});
 $('wdfDownload').addEventListener('click',download);
 $('wdfSearch').addEventListener('input',render);
 $('wdfSelectAll').addEventListener('click',()=>{state.files.forEach(e=>e.keep=true);render();});
 $('wdfDeselectAll').addEventListener('click',()=>{state.files.forEach(e=>e.keep=false);render();});
 const zone=$('wdfDrop');
 zone.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('dragover');});
 zone.addEventListener('dragleave',()=>zone.classList.remove('dragover'));
 zone.addEventListener('drop',e=>{e.preventDefault();zone.classList.remove('dragover');const f=e.dataTransfer.files[0];if(f){input.value='';reset(f);}});
 reset();
});
})();