
let csvFiles=[];
const file=document.getElementById('file');
const drop=document.getElementById('drop');
['dragover','dragenter'].forEach(e=>drop.addEventListener(e,x=>x.preventDefault()));
drop.addEventListener('drop',e=>{e.preventDefault();load(e.dataTransfer.files[0]);});
file.onchange=e=>load(e.target.files[0]);
async function load(f){
 if(!f)return;
 const zip=await JSZip.loadAsync(f);
 csvFiles=[]; rows.innerHTML='';
 let n=0;
 for(const [p,o] of Object.entries(zip.files)){
   if(o.dir||p.startsWith('__MACOSX')||p.endsWith('.DS_Store'))continue;
   if(p.toLowerCase().endsWith('.csv')){
     const b=await o.async('blob');
     csvFiles.push({path:p,name:p.split('/').pop(),blob:b,size:b.size});
     rows.insertAdjacentHTML('beforeend',`<tr><td>${p.split('/').pop()}</td><td>${p.includes('/')?p.substring(0,p.lastIndexOf('/')):''}</td><td>${b.size}</td></tr>`);
     n++;
   }
 }
 status.textContent=`Found ${n} CSV file(s).`;
 download.disabled=n===0;
}
download.onclick=async()=>{
 const out=new JSZip(),used={},flat=flatten.checked;
 for(const f of csvFiles){
  let t=flat?f.name:f.path;
  while(flat&&used[t]){const i=t.lastIndexOf('.');t=t.slice(0,i)+'_copy'+t.slice(i);}
  used[t]=1; out.file(t,f.blob);
 }
 const blob=await out.generateAsync({type:'blob'});
 const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='csv_extract.zip';a.click();
};
