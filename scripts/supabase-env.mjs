// Адрес базы и публичный ключ берём из index.html, чтобы не хранить их в двух местах
import {readFileSync} from "node:fs";
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
export const URL_=process.env.SUPABASE_URL||html.match(/const SUPABASE_URL="([^"]+)"/)[1];
export const KEY=process.env.SUPABASE_KEY||html.match(/const SUPABASE_KEY="([^"]+)"/)[1];
export const H={apikey:KEY,Authorization:`Bearer ${KEY}`};
export const TABLES=["items","project","audit_events"];
