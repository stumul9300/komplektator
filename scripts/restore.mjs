// Восстановление из расшифрованной копии в папке backup/.
// Позиции и проект записываются поверх текущих (upsert). Позиции, созданные после копии, не удаляются.
// Журнал (audit_events) не перезаписывается: восстановление само попадёт в журнал как изменения.
import {readFileSync,existsSync} from "node:fs";
import {URL_,H} from "./supabase-env.mjs";
const read=t=>existsSync(`backup/${t}.json`)?JSON.parse(readFileSync(`backup/${t}.json`,"utf8")):[];
async function upsert(t,rows){
  for(let k=0;k<rows.length;k+=200){
    const r=await fetch(`${URL_}/rest/v1/${t}`,{method:"POST",headers:{...H,"Content-Type":"application/json",Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows.slice(k,k+200))});
    if(!r.ok)throw new Error(`${t}: ${r.status} ${await r.text()}`);
  }
  console.log(`${t}: восстановлено ${rows.length}`);
}
const items=read("items"),project=read("project");
// у позиций есть номер версии: подставляем текущий, иначе база отклонит запись как «одновременную правку»
const ver=new Map();
for(let from=0;;from+=1000){
  const cur=await fetch(`${URL_}/rest/v1/items?select=id,version&order=id`,{headers:{...H,Range:`${from}-${from+999}`,"Range-Unit":"items"}});
  if(!cur.ok)break;
  const page=await cur.json();page.forEach(r=>ver.set(r.id,r.version));if(page.length<1000)break;
}
const hasVer=items.some(r=>"version" in r);
await upsert("project",project.map(({id,data})=>({id,data})));
await upsert("items",items.map(({id,data,created,version})=>({id,data:{...data,_actor:"восстановление из копии"},created,...(hasVer||ver.size?{version:ver.get(id)??0}:{})})));
