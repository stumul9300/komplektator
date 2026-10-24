// Ночная копия: выгружает таблицы Supabase в backup/<таблица>.json
import {mkdirSync,writeFileSync} from "node:fs";
import {URL_,H,TABLES} from "./supabase-env.mjs";
mkdirSync("backup",{recursive:true});
const summary={at:new Date().toISOString(),tables:{}};
for(const t of TABLES){
  const rows=[];
  for(let from=0;;from+=1000){
    const r=await fetch(`${URL_}/rest/v1/${t}?select=*&order=id`,{headers:{...H,Range:`${from}-${from+999}`,"Range-Unit":"items"}});
    if(r.status===404||(r.status===400&&t==="audit_events")){console.log(`${t}: таблицы нет, пропускаю`);break}
    if(!r.ok)throw new Error(`${t}: ${r.status} ${await r.text()}`);
    const page=await r.json();rows.push(...page);if(page.length<1000)break;
  }
  writeFileSync(`backup/${t}.json`,JSON.stringify(rows));
  summary.tables[t]=rows.length;console.log(`${t}: ${rows.length}`);
}
if(!summary.tables.items&&!summary.tables.project)throw new Error("База вернула пустые таблицы — копия не сохраняется, чтобы не затереть хорошие");
writeFileSync("backup/summary.json",JSON.stringify(summary,null,1));
