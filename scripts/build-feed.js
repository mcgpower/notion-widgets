/*  Builds index.html (Instagram-style feed) from the Notion database
    "Dinamita - content planing". Runs in GitHub Actions on Node 20+.
    Requires env var NOTION_TOKEN (Notion internal integration secret). */

const fs = require("fs");
const path = require("path");

const DATABASE_ID = "39e3cb1163a6807182aef562ae2c9322";
const ROOT = path.join(__dirname, "..");
const COVERS_DIR = path.join(ROOT, "covers");

const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };

async function main() {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error("NOTION_TOKEN env var is missing");

  // --- query the database (paginated) ---
  let results = [];
  let cursor = undefined;
  do {
    const resp = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ page_size: 100, start_cursor: cursor })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.message || `Notion API error ${resp.status}`);
    results = results.concat(data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  // --- map rows ---
  const posts = results.map(pg => {
    const p = pg.properties || {};
    const file = (p["cover"] && p["cover"].files && p["cover"].files[0]) || null;
    return {
      id: pg.id.replace(/-/g, ""),
      title: ((p["Nombre"] && p["Nombre"].title) || []).map(t => t.plain_text).join("") || "Sin título",
      estado: (p["Estado"] && p["Estado"].status && p["Estado"].status.name) || "Sin empezar",
      tags: ((p["Etiquetas"] && p["Etiquetas"].multi_select) || []).map(o => o.name),
      fecha: (p["Fecha"] && p["Fecha"].date && p["Fecha"].date.start) || null,
      coverUrl: file ? ((file.file && file.file.url) || (file.external && file.external.url) || null) : null,
      cover: null, // local path, filled below
      url: pg.url
    };
  });

  // Newest scheduled first, undated drafts at the end
  posts.sort((a, b) => {
    if (!a.fecha && !b.fecha) return 0;
    if (!a.fecha) return 1;
    if (!b.fecha) return -1;
    return a.fecha < b.fecha ? 1 : -1;
  });

  // --- download covers into ./covers (stable local copies) ---
  fs.mkdirSync(COVERS_DIR, { recursive: true });
  const keep = new Set();
  for (const post of posts) {
    if (!post.coverUrl) continue;
    try {
      const resp = await fetch(post.coverUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const ext = EXT[(resp.headers.get("content-type") || "").split(";")[0]] || "jpg";
      const name = `${post.id}.${ext}`;
      fs.writeFileSync(path.join(COVERS_DIR, name), Buffer.from(await resp.arrayBuffer()));
      post.cover = `covers/${name}`;
      keep.add(name);
    } catch (e) {
      console.warn(`Cover download failed for "${post.title}": ${e.message}`);
    }
  }
  // remove covers for deleted/changed posts
  for (const f of fs.readdirSync(COVERS_DIR)) {
    if (!keep.has(f)) fs.unlinkSync(path.join(COVERS_DIR, f));
  }

  // --- write the page ---
  const publicPosts = posts.map(({ coverUrl, id, ...rest }) => rest);
  // GITHUB_REPOSITORY ("owner/repo") is set automatically inside GitHub Actions
  const repo = process.env.GITHUB_REPOSITORY || "";
  const actionsUrl = repo ? `https://github.com/${repo}/actions/workflows/update-feed.yml` : "";
  fs.writeFileSync(path.join(ROOT, "index.html"), renderPage(publicPosts, actionsUrl));
  console.log(`Wrote index.html with ${posts.length} posts (${keep.size} covers).`);
}

const NOTION_DB_URL = "https://app.notion.com/p/39e3cb1163a6807182aef562ae2c9322?v=39e3cb1163a6808e86c6000c23dd1844";

function renderPage(posts, actionsUrl) {
  const json = JSON.stringify({ posts }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Dinamita — Content Feed</title>
<style>
  :root{
    --paper:#FDFCFA; --card:#FFFFFF; --ink:#221D18; --muted:#8A8178;
    --line:#EBE5DD; --accent:#A65B3F; --chipbg:#F4EFE9;
    --ok:#3E7C4F; --ok-bg:#EAF2EC;
    --prog:#4A6FA5; --prog-bg:#EBF0F7;
    --todo:#8A8178; --todo-bg:#F1EDE8;
    --shadow:0 1px 2px rgba(34,29,24,.05);
  }
  @media (prefers-color-scheme: dark){
    :root{
      --paper:#131110; --card:#1B1917; --ink:#EDE8E2; --muted:#9A9189;
      --line:#2A2622; --accent:#C98A6F; --chipbg:#242019;
      --ok:#8FBF9B; --ok-bg:#1E2A21;
      --prog:#93AFD4; --prog-bg:#1D2431;
      --todo:#9A9189; --todo-bg:#242019;
      --shadow:0 1px 2px rgba(0,0,0,.4);
    }
  }
  html,body{background:var(--paper);}
  body{
    font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    color:var(--ink); margin:0; -webkit-font-smoothing:antialiased;
  }
  .wrap{max-width:420px; margin:0 auto; padding:16px 12px 48px;}

  .profile{display:flex; align-items:center; gap:14px; padding:4px 4px 14px;}
  .avatar{
    width:52px; height:52px; border-radius:50%; flex:none;
    display:grid; place-items:center;
    background:linear-gradient(135deg,#A3B18A,#A65B3F);
    color:#FDFCFA; font-family:Georgia,serif; font-size:22px; font-style:italic;
  }
  .who{min-width:0;}
  .handle{font-weight:600; font-size:15px; letter-spacing:.01em;}
  .sub{color:var(--muted); font-size:12.5px; margin-top:2px;}
  .counts{margin-left:auto; text-align:right; flex:none;}
  .counts b{font-size:17px; font-variant-numeric:tabular-nums; display:block;}
  .counts span{color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.08em;}

  .actionbar{display:flex; gap:8px; justify-content:flex-end; padding:0 4px 12px;}
  .abtn{
    display:inline-flex; align-items:center; gap:6px;
    font-size:12px; font-weight:600; text-decoration:none; cursor:pointer;
    padding:6px 13px; border-radius:999px; letter-spacing:.02em;
  }
  .abtn.primary{background:var(--accent); color:#FDFCFA;}
  .abtn.primary:hover{filter:brightness(1.08);}
  .abtn.ghost{border:1px solid var(--line); background:var(--card); color:var(--ink);}
  .abtn.ghost:hover{border-color:var(--accent); color:var(--accent);}
  .abtn:focus-visible{outline:2px solid var(--accent); outline-offset:2px;}
  .abtn svg{display:block;}

  .controls{
    position:sticky; top:0; z-index:5; background:var(--paper);
    padding:8px 0 10px; display:flex; gap:8px; align-items:center;
    border-bottom:1px solid var(--line); margin-bottom:14px;
  }
  .chips{display:flex; gap:6px; overflow-x:auto; scrollbar-width:none;}
  .chips::-webkit-scrollbar{display:none;}
  .chip{
    border:1px solid var(--line); background:var(--card); color:var(--muted);
    font-size:12px; padding:5px 11px; border-radius:999px; cursor:pointer;
    white-space:nowrap; font-family:inherit;
  }
  .chip[aria-pressed="true"]{background:var(--ink); color:var(--paper); border-color:var(--ink);}
  .chip:focus-visible,.viewbtn:focus-visible,.openlink:focus-visible{outline:2px solid var(--accent); outline-offset:2px;}
  .viewtoggle{margin-left:auto; display:flex; border:1px solid var(--line); border-radius:8px; overflow:hidden; flex:none;}
  .viewbtn{background:var(--card); border:none; padding:5px 9px; cursor:pointer; color:var(--muted); display:grid; place-items:center;}
  .viewbtn[aria-pressed="true"]{background:var(--ink); color:var(--paper);}
  .viewbtn svg{display:block;}

  .feed{display:flex; flex-direction:column; gap:22px;}
  .post{background:var(--card); border:1px solid var(--line); border-radius:12px; box-shadow:var(--shadow); overflow:hidden;}
  .post-head{display:flex; align-items:center; gap:9px; padding:10px 12px;}
  .post-head .avatar{width:30px; height:30px; font-size:13px;}
  .post-meta{min-width:0;}
  .post-handle{font-size:13px; font-weight:600;}
  .post-date{font-size:11.5px; color:var(--muted); font-variant-numeric:tabular-nums;}
  .status{margin-left:auto; flex:none; font-size:11px; font-weight:600; padding:3px 9px; border-radius:999px; letter-spacing:.02em;}
  .s-done{color:var(--ok); background:var(--ok-bg);}
  .s-prog{color:var(--prog); background:var(--prog-bg);}
  .s-todo{color:var(--todo); background:var(--todo-bg);}

  .cover{position:relative; aspect-ratio:1/1; display:flex; align-items:flex-end; padding:18px; box-sizing:border-box; color:#fff; overflow:hidden;}
  .cover::after{content:""; position:absolute; inset:0;
    background:radial-gradient(120% 90% at 15% 0%, rgba(255,255,255,.22), transparent 55%),
               linear-gradient(to top, rgba(20,14,10,.38), transparent 55%);
    pointer-events:none;}
  .cover.has-img{padding:0;}
  .cover.has-img::after{background:none;}
  .cover img{position:absolute; inset:0; width:100%; height:100%; object-fit:cover; display:block;}
  .cover .eyebrow{position:absolute; top:16px; left:18px; font-size:10.5px; letter-spacing:.16em; text-transform:uppercase; opacity:.9; z-index:1;}
  .cover h2{
    position:relative; z-index:1; margin:0;
    font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
    font-weight:500; font-size:clamp(20px,6vw,26px); line-height:1.18; text-wrap:balance;
    text-shadow:0 1px 8px rgba(20,14,10,.25);
  }
  .p-instagram{background:linear-gradient(140deg,#B98ABF,#7D4E86);}
  .p-substack{background:linear-gradient(140deg,#E5A268,#B96E33);}
  .p-linkedin{background:linear-gradient(140deg,#7FA3C6,#3E6A96);}
  .p-none{background:linear-gradient(140deg,#C4B49C,#8C7A60);}

  .body{padding:11px 14px 14px;}
  .rowline{display:flex; align-items:center; gap:8px; flex-wrap:wrap;}
  .cardtitle{font-size:13.5px; font-weight:600; width:100%; margin:0 0 2px;}
  .tag{font-size:11px; font-weight:600; letter-spacing:.04em; background:var(--chipbg); color:var(--muted); padding:3px 9px; border-radius:999px;}
  .openlink{margin-left:auto; font-size:11.5px; color:var(--accent); text-decoration:none; white-space:nowrap;}
  .openlink:hover{text-decoration:underline;}

  .grid{display:grid; grid-template-columns:repeat(3,1fr); gap:3px;}
  .grid a.cell{position:relative; display:block; aspect-ratio:1/1; overflow:hidden; color:#fff; text-decoration:none;}
  .cell .cover{position:absolute; inset:0; padding:10px;}
  .cell .cover.has-img{padding:0;}
  .cell .cover h2{font-size:12.5px; line-height:1.25; text-shadow:0 1px 6px rgba(20,14,10,.35);}
  .cell .cover.has-img h2{display:none;}
  .cell .cover .eyebrow{display:none;}
  .cell .dot{position:absolute; left:9px; bottom:9px; z-index:2; width:8px; height:8px; border-radius:50%; box-shadow:0 0 0 2px rgba(255,255,255,.75);}
  .d-done{background:#4C9960;} .d-prog{background:#6E93C4;} .d-todo{background:#B9B0A6;}
  .cell .celldate{position:absolute; right:9px; bottom:7px; z-index:2; font-size:10px; font-variant-numeric:tabular-nums; text-shadow:0 1px 4px rgba(0,0,0,.5);}

  .legend{display:flex; gap:14px; flex-wrap:wrap; margin-top:14px; color:var(--muted); font-size:11px;}
  .legend i{width:8px; height:8px; border-radius:50%; display:inline-block; margin-right:5px;}
  .empty{border:1px dashed var(--line); border-radius:12px; color:var(--muted); text-align:center; padding:44px 24px; font-size:13.5px; line-height:1.6;}
  .foot{margin-top:26px; text-align:center; color:var(--muted); font-size:11px; line-height:1.6;}
  [hidden]{display:none !important;}
</style>
</head>
<body>
<div class="wrap">
  <header class="profile">
    <div class="avatar">d</div>
    <div class="who">
      <div class="handle">Dinamita · content planning</div>
      <div class="sub">Sincronizado desde Notion</div>
    </div>
    <div class="counts"><b id="count">0</b><span>posts</span></div>
  </header>

  <div class="actionbar">
    <a class="abtn ghost" href="${NOTION_DB_URL}" target="_blank" rel="noopener">
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 1.5v9M1.5 6h9"/></svg>
      Nuevo post
    </a>
    ${actionsUrl ? `<a class="abtn primary" href="${actionsUrl}" target="_blank" rel="noopener" title="Abre GitHub y pulsa 'Run workflow' para actualizar al momento">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M10.5 6a4.5 4.5 0 1 1-1.3-3.2M9.5 1v2.3H7.2"/></svg>
      Actualizar ahora
    </a>` : ""}
  </div>

  <div class="controls">
    <div class="chips" id="chips" role="group" aria-label="Filtrar por plataforma">
      <button class="chip" data-f="all" aria-pressed="true">Todos</button>
      <button class="chip" data-f="Instagram" aria-pressed="false">Instagram</button>
      <button class="chip" data-f="substack" aria-pressed="false">Substack</button>
      <button class="chip" data-f="linkedin" aria-pressed="false">LinkedIn</button>
    </div>
    <div class="viewtoggle" role="group" aria-label="Vista">
      <button class="viewbtn" id="btnFeed" aria-pressed="true" title="Vista feed">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="1.5" y="1.5" width="11" height="4.4" rx="1"/><rect x="1.5" y="8.1" width="11" height="4.4" rx="1"/></svg>
      </button>
      <button class="viewbtn" id="btnGrid" aria-pressed="false" title="Vista grid">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="1.5" y="1.5" width="4.4" height="4.4" rx="1"/><rect x="8.1" y="1.5" width="4.4" height="4.4" rx="1"/><rect x="1.5" y="8.1" width="4.4" height="4.4" rx="1"/><rect x="8.1" y="8.1" width="4.4" height="4.4" rx="1"/></svg>
      </button>
    </div>
  </div>

  <main id="feed" class="feed" aria-live="polite"></main>
  <main id="grid" class="grid" hidden></main>
  <div class="empty" id="empty" hidden>
    Nada por aquí todavía.<br>
    Añade posts a la base <b>&ldquo;Dinamita - content planing&rdquo;</b> en Notion.
  </div>

  <div class="legend" id="legend" hidden>
    <span><i class="d-done"></i>Publicado</span>
    <span><i class="d-prog"></i>Planificado</span>
    <span><i class="d-todo"></i>Sin empezar</span>
  </div>

  <p class="foot">Se actualiza solo cada 30 min · “Actualizar ahora” abre GitHub: pulsa allí <b>Run workflow</b> y en ~2 min recarga esta página.</p>
</div>

<script>
const DATA = ${json};
const POSTS = DATA.posts || [];

const STATUS = {
  "Publicado":  {cls:"s-done", dot:"d-done"},
  "Planificado":{cls:"s-prog", dot:"d-prog"},
  "Sin empezar":{cls:"s-todo", dot:"d-todo"}
};
const platClass = tags => {
  const t = ((tags && tags[0]) || "").toLowerCase();
  return t.indexOf("insta") >= 0 ? "p-instagram" : t.indexOf("sub") >= 0 ? "p-substack" : t.indexOf("link") >= 0 ? "p-linkedin" : "p-none";
};
const fmtDate = d => d ? new Date(d.slice(0,10) + "T12:00:00").toLocaleDateString("es-ES",{day:"numeric",month:"short",year:"numeric"}) : "Sin fecha";
const shortDate = d => d ? new Date(d.slice(0,10) + "T12:00:00").toLocaleDateString("es-ES",{day:"numeric",month:"short"}) : "";
const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");

function coverHTML(p){
  if(p.cover){
    return '<div class="cover has-img"><img src="' + esc(p.cover) + '" alt="' + esc(p.title) + '" loading="lazy"></div>';
  }
  return '<div class="cover ' + platClass(p.tags) + '">'
    + '<span class="eyebrow">' + (p.tags.length ? esc(p.tags.join(" · ")) : "Sin plataforma") + '</span>'
    + '<h2>' + esc(p.title) + '</h2></div>';
}

function renderFeed(list){
  return list.map(function(p){
    const st = STATUS[p.estado] || STATUS["Sin empezar"];
    return '<article class="post">'
      + '<div class="post-head"><div class="avatar">d</div>'
      +   '<div class="post-meta"><div class="post-handle">dinamita</div>'
      +   '<div class="post-date">' + fmtDate(p.fecha) + '</div></div>'
      +   '<span class="status ' + st.cls + '">' + esc(p.estado) + '</span></div>'
      + coverHTML(p)
      + '<div class="body">'
      +   (p.cover ? '<p class="cardtitle">' + esc(p.title) + '</p>' : '')
      +   '<div class="rowline">'
      +   p.tags.map(function(t){ return '<span class="tag">' + esc(t) + '</span>'; }).join("")
      +   '<a class="openlink" href="' + esc(p.url) + '" target="_blank" rel="noopener">Abrir en Notion ↗</a>'
      + '</div></div></article>';
  }).join("");
}

function renderGrid(list){
  return list.map(function(p){
    const st = STATUS[p.estado] || STATUS["Sin empezar"];
    return '<a class="cell" href="' + esc(p.url) + '" target="_blank" rel="noopener" title="' + esc(p.title) + ' · ' + esc(p.estado) + '">'
      + coverHTML(p)
      + '<span class="dot ' + st.dot + '"></span>'
      + (p.fecha ? '<span class="celldate">' + shortDate(p.fecha) + '</span>' : '')
      + '</a>';
  }).join("");
}

let filter = "all", view = "feed";
const $ = function(id){ return document.getElementById(id); };

function draw(){
  const list = POSTS.filter(function(p){ return filter === "all" || p.tags.indexOf(filter) >= 0; });
  $("count").textContent = list.length;
  $("empty").hidden = list.length > 0;
  $("feed").hidden = view !== "feed" || list.length === 0;
  $("grid").hidden = view !== "grid" || list.length === 0;
  $("legend").hidden = view !== "grid" || list.length === 0;
  if(view === "feed"){ $("feed").innerHTML = renderFeed(list); }
  else { $("grid").innerHTML = renderGrid(list); }
}

$("chips").addEventListener("click", function(e){
  const b = e.target.closest(".chip"); if(!b) return;
  filter = b.dataset.f;
  document.querySelectorAll(".chip").forEach(function(c){ c.setAttribute("aria-pressed", c === b ? "true" : "false"); });
  draw();
});
$("btnFeed").addEventListener("click", function(){ view = "feed"; syncView(); });
$("btnGrid").addEventListener("click", function(){ view = "grid"; syncView(); });
function syncView(){
  $("btnFeed").setAttribute("aria-pressed", view === "feed" ? "true" : "false");
  $("btnGrid").setAttribute("aria-pressed", view === "grid" ? "true" : "false");
  draw();
}
draw();
</script>
</body>
</html>`;
}

main().catch(e => { console.error(e); process.exit(1); });
