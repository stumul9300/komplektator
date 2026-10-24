// Supabase Edge Function «preview»: по ссылке на товар возвращает фото, название и цену.
// Вызов: GET /functions/v1/preview?url=https://...
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function decode(s: string) {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
function attrs(tag: string) {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z_:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    out[m[1].toLowerCase()] = decode(m[3] ?? m[4] ?? m[5] ?? "");
  }
  return out;
}
function toNum(v: unknown) {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/[\s  ]/g, "").replace(",", ".").replace(/[^\d.]/g, ""));
  return isFinite(n) ? n : 0;
}
export function parse(html: string, base: string) {
  const metas: Record<string, string> = {};
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const key = (a.property || a.name || a.itemprop || "").toLowerCase();
    if (key && a.content && !(key in metas)) metas[key] = a.content;
  }
  let image = metas["og:image"] || metas["og:image:url"] || metas["og:image:secure_url"] || metas["twitter:image"] || metas["twitter:image:src"] || metas["image"] || "";
  let title = metas["og:title"] || metas["twitter:title"] || (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "");
  let price = toNum(metas["product:price:amount"] || metas["og:price:amount"] || metas["price"]);
  // JSON-LD: offers.price, image, name
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (o: any) => {
        if (!o || typeof o !== "object") return;
        if (Array.isArray(o)) return o.forEach(walk);
        const t = [].concat(o["@type"] || []).join(",");
        if (/Product/i.test(t)) {
          if (!image && o.image) image = typeof o.image === "string" ? o.image : (Array.isArray(o.image) ? (typeof o.image[0] === "string" ? o.image[0] : o.image[0]?.url) : o.image.url) || "";
          if (!title && o.name) title = o.name;
        }
        if (!price && o.offers) {
          for (const x of [].concat(o.offers)) { const n = toNum((x as any).price ?? (x as any).lowPrice); if (n) { price = n; break; } }
        }
        Object.values(o).forEach(walk);
      };
      walk(JSON.parse(m[1].trim()));
    } catch (_) { /* битый JSON-LD пропускаем */ }
  }
  // Микроразметка itemprop="price" без content
  if (!price) { const m = html.match(/itemprop=["']price["'][^>]*>([^<]{1,40})</i); if (m) price = toNum(m[1]); }
  if (!image) { const m = html.match(/<link[^>]*rel=["']image_src["'][^>]*>/i); if (m) image = attrs(m[0]).href || ""; }
  if (image) { try { image = new URL(image, base).href; } catch (_) { image = ""; } }
  return { image, title: decode(title.trim()).slice(0, 200), price };
}

if (typeof Deno !== "undefined") Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const params = new URL(req.url).searchParams;
  // Режим ?img=: отдаём саму картинку с CORS, чтобы сайт мог убрать у неё фон
  const img = params.get("img") || "";
  if (img) {
    if (!/^https?:\/\//i.test(img)) return json({ error: "bad img" }, 400);
    try {
      const r = await fetch(img, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36", "Accept": "image/*" } });
      const type = r.headers.get("content-type") || "";
      if (!r.ok || !type.startsWith("image/")) return json({ error: "not an image", status: r.status }, 502);
      return new Response(await r.arrayBuffer(), { headers: { ...CORS, "Content-Type": type, "Cache-Control": "public, max-age=86400" } });
    } catch (e) { return json({ error: String(e) }, 502); }
  }
  const url = params.get("url") || "";
  if (!/^https?:\/\//i.test(url)) return json({ error: "Нужна ссылка, начинающаяся с http" }, 400);
  try {
    const r = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
      },
    });
    const html = (await r.text()).slice(0, 3_000_000);
    return json({ ...parse(html, r.url || url), status: r.status });
  } catch (e) {
    return json({ error: String(e) }, 502);
  }
});
