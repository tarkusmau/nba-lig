// Ozel panel arayuzu
(function () {
"use strict";
const E = window.FantasyEngine, CATS = E.CATS, LBL = E.LBL;
const TEAMS = ["tarkus maurelius", "Normal MAFIA"];
const SHORT = { "tarkus maurelius": "Tarkus", "Normal MAFIA": "Normal MAFIA" };
const PLAN = {
  "tarkus maurelius": { punt: ["ast"], pri: ["reb", "fgp", "pts"], keep: ["to", "st", "blk", "ftp", "tpm"] },
  "Normal MAFIA": { punt: ["tpm"], pri: [], keep: [] },
};
const STRAT_HTML = {
  "tarkus maurelius": `
<h3>Ana plan</h3>
<ul>
<li><b>AST punt.</b> Asist için oyuncu alınmaz; asisti daha da düşüren takaslar tercih edilir.</li>
<li><b>Öncelik:</b> REB, FG%, PTS (yazı-tura kategoriler). <b>Korunacaklar:</b> TO, ST, BLK, FT%, 3PM.</li>
<li>9 kategoriden 5'ini almak haftayı kazandırır, ama hedef haftalık olarak olabildiğince çok kategori kazanmak.</li>
<li>Orta seviyedeki kategorileri (FG%, FT%, TO, PTS gibi) yükseltmek, %90+ olan kategorileri korumaktan önemli; çok güçlü kategoriden biraz verilebilir. Hiçbir takas orta seviye kategoriyi düşürmemeli; güçlü (“çapa”) kategori ortaya inmemeli.</li>
<li>Takaslar ligin en güçlü takımlarına karşı değerlendirilir, ortalamaya karşı değil.</li>
</ul>
<h3>Takas kuralları</h3>
<ul>
<li>Draft $ dengesi sıkı olmalı ($29'a $40 fazla açık). Değerli oyuncu verilirse yanında parça alınır.</li>
<li>Değerinden ucuza draft edilmiş oyuncular hedeflenir; ama kabul edilebilirlik sadece draft $'a değil güncel üretime göre (ör. Ajay Mitchell draft fiyatının çok üstünde).</li>
<li>Waiver'dan $1'a alınmış oyuncuların, düzenli üretmedikçe takas değeri yok.</li>
<li>Sakat oyuncuyu dönüşüne yakın ucuza almak düşünülür; takım arkadaşı dönünce rolü sürecek mi kontrol edilir.</li>
<li>Karşı tarafın kadro ihtiyacı (ör. sağlıklı C sayısı) kontrol edilir; takas sadece onlar için kabul edilebilir olmalı, kârlı olması gerekmez.</li>
<li>2'ye 1 takaslar yer açar: haftalık 4 add ile boş günlerde stream = haftada ~2-3 ekstra maç.</li>
<li>Takas Yahoo'da gönderildikten 2 sabah sonra 10:00'da işlenir; haftanın son maçlarına yetişir.</li>
</ul>
<h3>Simülasyon</h3>
<ul>
<li>Bu sezon ağırlığı maç sayısıyla artar (0 maç %0, 15 maç %50, 82 maç %100); kalan geçen sezon:projeksiyon = 25:30; çaylakta geçen sezon payı bölünür; +%10 son form.</li>
<li>Anthony Davis'in oynama oranı %85 alınır.</li>
<li>Bir oyuncuyu tek maça göre değil süreklilik gösteren projeksiyona göre değerlendir.</li>
</ul>`,
  "Normal MAFIA": `
<h3>Ana plan</h3>
<ul>
<li><b>3PM punt.</b> Üçlük için oyuncu alınmaz; 3PM'i düşüren ama diğer kategorileri yükselten takaslar tercih edilir.</li>
<li>SGA dahil herkes takaslanabilir.</li>
<li>Büyük ve çok adımlı (zincirleme) takaslar uygundur: önce bir takasla değer toplanıp ikinci takasla hedef oyuncuya gidilebilir.</li>
</ul>
<h3>Takas kuralları</h3>
<ul>
<li>Aynı genel kurallar: draft $ dengesi sıkı, waiver seviyesi oyuncunun takas değeri yok, karşı tarafın kadro ihtiyacı kontrol edilir.</li>
<li>Otomatik liste SGA gibi büyük isimleri tek tek değerlendirir; zincirleme takasları Claude notlarında ayrıca ele alırız.</li>
</ul>`,
};

const $ = id => document.getElementById(id);
const pc = v => Math.round(v * 100) + "%";
const f3 = v => isFinite(v) ? v.toFixed(3).replace(/^0/, "") : "–";
const f1 = v => isFinite(v) ? v.toFixed(1) : "–";
const el = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };
const q = (n, d) => new URLSearchParams(location.search).get(n) || d;

let L = null, cur = q("t", "tarkus maurelius") === "mafia" ? "Normal MAFIA" : "tarkus maurelius";
const cache = {};

function topOnly(team, c) {
  const out = {}; CATS.forEach(k => out[k] = 0); const opp = L.top.filter(t => t !== team);
  // L.probs agirlikli; burada sadece ilk 6
  opp.forEach(o => { const oc = L.base[o]; CATS.forEach(k => { out[k] += pWin(c, oc, k); }); });
  CATS.forEach(k => out[k] /= opp.length || 1); return out;
}
let pWin = null;

function renderWin() {
  const c = L.base[cur]; const all = L.plain(cur, c); const pr = L.probs(cur, c); const top = topOnly(cur, c);
  const plan = PLAN[cur]; const tb = $("t-win").tBodies[0]; tb.textContent = "";
  CATS.forEach(k => {
    const tr = el("tr"); tr.append(el("td", LBL[k]));
    const a = el("td", pc(all[k])); const bar = el("span", null, "bar2"); bar.style.width = Math.round(all[k] * 60) + "px"; a.append(bar);
    a.className = all[k] >= .6 ? "win" : all[k] < .4 ? "loss" : ""; tr.append(a);
    const t = el("td", pc(top[k])); t.className = top[k] >= .6 ? "win" : top[k] < .4 ? "loss" : ""; tr.append(t);
    tr.append(el("td", pr.rank[k].toFixed(1)));
    const p = el("td"); const tag = plan.punt.includes(k) ? ["punt", "punt"] : plan.pri.includes(k) ? ["öncelik", "pri"] : plan.keep.includes(k) ? ["koru", "keep"] : null;
    if (tag) p.append(el("span", tag[0], "tag " + tag[1])); tr.append(p); tb.append(tr);
  });
}

function renderTrades() {
  $("tstat").textContent = "Hesaplanıyor…";
  setTimeout(() => {
    const t0 = performance.now();
    const r = cache[cur] || (cache[cur] = L.searchTrades(cur, { limit: 12 }));
    const th = $("t-tr").tHead; th.textContent = ""; const hr = el("tr"); hr.append(el("th", "#"));
    CATS.forEach(k => hr.append(el("th", LBL[k]))); hr.append(el("th", "Puan +")); th.append(hr);
    const tb = $("t-tr").tBodies[0]; tb.textContent = ""; const ex = $("tr-ex"); ex.textContent = "";
    if (!r.list.length) { $("tstat").textContent = "Kurallara uyan takas bulunamadı."; return; }
    r.list.forEach((x, i) => {
      const tr = el("tr"); tr.append(el("td", "T" + (i + 1)));
      CATS.forEach(k => {
        const d = x.after[k] - x.before[k]; const td = el("td", null, "ba" + (d > .005 ? " up" : d < -.005 ? " dn" : ""));
        td.append(el("span", pc(x.before[k]), "o"), el("span", pc(x.after[k]), "n")); tr.append(td);
      });
      tr.append(el("td", "+" + x.gain.toFixed(2))); tb.append(tr);
      const li = el("li");
      const nm = p => p.name + " ($" + p.price + (p.status ? ", " + p.status : "") + ")";
      li.append(el("b", "T" + (i + 1) + " — " + x.partner + ": "));
      li.append(document.createTextNode("Ver " + x.give.map(nm).join(" + ") + " · Al " + x.get.map(nm).join(" + ")));
      const extra = [];
      if (x.myDrop) extra.push("sen bırakırsın: " + x.myDrop.name);
      if (x.give.length > x.get.length) extra.push("açılan yer stream için kullanılır");
      if (x.theirDrop) extra.push(x.partner + " bırakır: " + x.theirDrop.name);
      extra.push("draft $ " + x.gPrice + " ↔ " + x.rPrice);
      extra.push(x.partner + " için genel güç " + (x.pDelta >= 0 ? "+" : "") + (x.pDelta * 100 / 9).toFixed(1) + " puan/kategori");
      li.append(el("span", " — " + extra.join(" · "), "muted")); ex.append(li);
    });
    $("tstat").textContent = r.considered + " uygun takas bulundu, en iyi " + r.list.length + " tanesi (" + Math.round(performance.now() - t0) + " ms).";
  }, 30);
}

function renderRoster() {
  $("repl").textContent = L.repl.toFixed(1);
  const tb = $("t-ro").tBodies[0]; tb.textContent = "";
  L.rost[cur].slice().sort((a, b) => b.gv - a.gv).forEach(p => {
    const g = p.pg; const tr = el("tr");
    tr.append(el("td", p.name + (p.status ? " (" + p.status + ")" : "")), el("td", p.slot), el("td", "$" + p.price), el("td", pc(p.avail)));
    const v = el("td", p.gv.toFixed(1)); v.className = p.gv > L.repl + 2 ? "win" : p.gv < L.repl ? "loss" : ""; tr.append(v);
    tr.append(el("td", f3(g.fgm / g.fga)), el("td", f3(g.ftm / g.fta)), el("td", f1(g.tpm)), el("td", f1(g.pts)), el("td", f1(g.reb)), el("td", f1(g.ast)), el("td", f1(g.st)), el("td", f1(g.blk)), el("td", f1(g.to)));
    tb.append(tr);
  });
}

function renderStrat() { $("strat").innerHTML = STRAT_HTML[cur]; }

let NOTES = null;
function renderNotes() {
  if (!NOTES) return;
  const key = cur === "Normal MAFIA" ? "mafia" : "tarkus";
  $("notes").textContent = NOTES[key] || "Bu takım için henüz not yok.";
  $("nupd").textContent = NOTES.updated ? "Son not: " + NOTES.updated : "";
}

function renderAll() {
  [...$("teams").children].forEach(b => b.classList.toggle("on", b.dataset.t === cur));
  renderWin(); renderRoster(); renderStrat(); renderNotes(); renderTrades();
}

function init() {
  TEAMS.forEach(t => { const b = el("button", SHORT[t]); b.dataset.t = t; b.onclick = () => {
    cur = t; const u = new URL(location); u.searchParams.set("t", t === "Normal MAFIA" ? "mafia" : "tarkus"); history.replaceState(null, "", u); renderAll(); }; $("teams").append(b); });
  const v = "?v=" + Date.now();
  const get = f => fetch("../" + f + v).then(r => { if (!r.ok) throw new Error(f); return r.json(); });
  Promise.all([get("players/bu_sezon_ort.json"), get("players/gecen_sezon_ort.json"), get("players/projeksiyon_kalan.json"),
               get("players/son14_ort.json"), get("rosters.json"), get("standings.json"), get("draft.json")])
    .then(([bu, gecen, proj, son14, rosters, standings, draft]) => {
      const P = E.buildPlayers({ bu, gecen, proj, son14 });
      L = new E.League(P, rosters, standings, draft);
      pWin = E.pWin;
      $("pupd").textContent = "Veri: " + (rosters.updated || "");
      renderAll();
    }).catch(e => { $("tstat").textContent = "Veriler yüklenemedi: " + e.message; });
  fetch("notes.json" + v).then(r => r.ok ? r.json() : null).then(n => { NOTES = n; if (L) renderNotes(); }).catch(() => {});
}
init();
})();
