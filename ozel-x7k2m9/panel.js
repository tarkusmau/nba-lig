// Ozel panel arayuzu (sekmeli surum)
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

// ---------- yardimcilar ----------
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pc = v => Math.round(v * 100) + "%";
const f3 = v => isFinite(v) ? v.toFixed(3).replace(/^0/, "") : "–";
const f1 = v => isFinite(v) ? v.toFixed(1) : "–";
const cls = v => v >= .6 ? "win" : v < .4 ? "loss" : "";
const better = (k, x, y) => k === "to" ? x < y : x > y;
const Q = new URLSearchParams(location.search);
function setQ(o) { const u = new URL(location); Object.entries(o).forEach(([k, v]) => u.searchParams.set(k, v)); history.replaceState(null, "", u); }
function chipRow(box, items, active, onPick) {
  box.replaceChildren(...items.map(([k, l]) => { const b = document.createElement("button"); b.textContent = l; b.dataset.k = k; if (k === active) b.className = "on"; b.onclick = () => onPick(k); return b; }));
  const on = box.querySelector(".on"); if (on) on.scrollIntoView({ block: "nearest", inline: "center" });
}
function teamOpts(id, val, list) { return `<select id="${id}">${list.map(t => `<option${t === val ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>`; }

// ---------- durum ----------
let L = null, DATA = null, NOTES = null;
let cur = Q.get("t") === "mafia" ? "Normal MAFIA" : "tarkus maurelius";
let view = ["win", "tr", "ro", "st", "lg"].includes(Q.get("v")) ? Q.get("v") : "win";
let winWk = Q.get("ww") || "p";
let lgWk = Q.get("w") || null, lgSub = Q.get("s") || "h2h", lgA = null, lgB = Q.get("b") || null, catAll = false;
const tradeCache = {};

// ---------- haftalik veri ----------
function vals(rows, perGame) {
  return rows.map(r => { const g = perGame ? (r.gp || 1) : 1;
    return { team: r.team, gp: r.gp, raw: r, fgp: r.fgm / r.fga, ftp: r.ftm / r.fta, tpm: r.tpm / g, pts: r.pts / g, reb: r.reb / g, ast: r.ast / g, st: r.st / g, blk: r.blk / g, to: r.to / g }; });
}
function addSeason(d) {
  const ks = Object.keys(d.weeks).filter(k => k !== "all").sort((a, b) => a - b); const acc = {};
  ks.forEach(k => d.weeks[k].teams.forEach(t => {
    const a = acc[t.team] || (acc[t.team] = { team: t.team, gp: 0, fgm: 0, fga: 0, ftm: 0, fta: 0, tpm: 0, pts: 0, reb: 0, ast: 0, st: 0, blk: 0, to: 0 });
    ["gp", "fgm", "fga", "ftm", "fta", "tpm", "pts", "reb", "ast", "st", "blk", "to"].forEach(f => a[f] += (t[f] || 0)); }));
  const last = d.weeks[ks[ks.length - 1]];
  d.weeks.all = { label: "Sezon toplamı (Hafta " + ks[0] + "-" + ks[ks.length - 1] + ")", updated: last.updated, teams: Object.values(acc) };
}
const weekKeys = () => Object.keys(DATA.weeks).filter(w => w !== "all").sort((a, b) => a - b);
const weekItems = () => weekKeys().map(w => [w, "H" + w]).concat([["all", "Sezon"]]);
function cmp(a, b) { let w = 0, l = 0; CATS.forEach(k => { if (better(k, a[k], b[k])) w++; else if (better(k, b[k], a[k])) l++; }); return { w, l, t: 9 - w - l }; }

// ---------- KAZANMA ----------
function topOnly(team, c) {
  const out = {}; CATS.forEach(k => out[k] = 0); const opp = L.top.filter(t => t !== team);
  opp.forEach(o => { const oc = L.base[o]; CATS.forEach(k => { out[k] += E.pWin(c, oc, k); }); });
  CATS.forEach(k => out[k] /= opp.length || 1); return out;
}
function weekWin(team, w) {
  const V = vals(DATA.weeks[w].teams, false); const me = V.find(v => v.team === team); if (!me) return null;
  const others = V.filter(v => v !== me), top = others.filter(v => L.top.includes(v.team));
  const sc = (arr, k) => arr.reduce((a, o) => a + (better(k, me[k], o[k]) ? 1 : me[k] === o[k] ? .5 : 0), 0) / (arr.length || 1);
  const all = {}, t6 = {}, rank = {};
  CATS.forEach(k => { all[k] = sc(others, k); t6[k] = sc(top, k); rank[k] = 1 + others.filter(o => better(k, o[k], me[k])).length; });
  return { all, t6, rank, n: others.length };
}
function renderWin() {
  const items = [["p", "Tahmin"]].concat(DATA ? weekItems() : []);
  if (DATA && !items.some(i => i[0] === winWk)) winWk = "p";
  if (!DATA && winWk !== "p") { $("win-desc").textContent = "Haftalık veriler yükleniyor…"; return; }
  chipRow($("win-wk"), items, winWk, k => { winWk = k; setQ({ ww: k }); renderWin(); });
  let r, desc;
  if (winWk === "p") {
    const c = L.base[cur]; r = { all: L.plain(cur, c), t6: topOnly(cur, c), rank: L.probs(cur, c).rank };
    desc = "Güncel kadroyla bir haftada her kategoriyi kazanma olasılığı. Projeksiyon: bu sezon (maç sayısına göre), geçen sezon, Yahoo projeksiyonu + %10 son 14 gün; oyuncu başına haftada 3,5 maç × oynama oranı.";
  } else {
    r = weekWin(cur, winWk);
    const W = DATA.weeks[winWk];
    desc = (W.label || ("Hafta " + winWk)) + " · gerçek sonuç: o kategoride ligdeki diğer takımların yüzde kaçını geçtin (Yahoo toplamları). " + (W.updated ? "Güncelleme: " + W.updated : "");
  }
  $("win-desc").textContent = desc;
  if (!r) { $("win-rows").innerHTML = "<p class='note'>Bu dönem için veri yok.</p>"; $("win-kpi").innerHTML = ""; return; }
  const plan = PLAN[cur];
  $("win-rows").innerHTML = CATS.map(k => {
    const v = r.all[k], tag = plan.punt.includes(k) ? ["punt", "punt"] : plan.pri.includes(k) ? ["öncelik", "pri"] : plan.keep.includes(k) ? ["koru", "keep"] : null;
    return `<div class="wrow"><div class="wl">${LBL[k]}${tag ? ` <span class="tag ${tag[1]}">${tag[0]}</span>` : ""}</div>
<div class="bar"><i class="${cls(v)}" style="width:${Math.max(2, Math.round(v * 100))}%"></i></div><div class="wp ${cls(v)}">${pc(v)}</div>
<div class="ws">İlk 6'ya karşı <b class="${cls(r.t6[k])}">${pc(r.t6[k])}</b> · ${winWk === "p" ? "ort. sıra" : "sıra"} ${winWk === "p" ? r.rank[k].toFixed(1) : r.rank[k] + "/16"}</div></div>`;
  }).join("");
  const counted = CATS.filter(k => !plan.punt.includes(k));
  const good = CATS.filter(k => r.all[k] >= .5).length;
  const avg = counted.reduce((a, k) => a + r.all[k], 0) / counted.length;
  const avg6 = counted.reduce((a, k) => a + r.t6[k], 0) / counted.length;
  $("win-kpi").innerHTML = `<div class="kpi"><span>%50 üstü kategori</span><b>${good} / 9</b></div><div class="kpi"><span>Ortalama · ilk 6 (punt hariç)</span><b>${pc(avg)} · ${pc(avg6)}</b></div>`;
}

// ---------- TAKASLAR ----------
function renderTrades() {
  const r = tradeCache[cur];
  if (!r) { $("tstat").textContent = "Hesaplanıyor…"; setTimeout(() => { const t0 = performance.now(); tradeCache[cur] = L.searchTrades(cur, { limit: 12 }); tradeCache[cur].ms = Math.round(performance.now() - t0); renderTrades(); }, 40); return; }
  const th = $("t-tr").tHead, tb = $("t-tr").tBodies[0], box = $("tr-cards");
  th.innerHTML = "<tr><th>#</th>" + CATS.map(k => `<th>${LBL[k]}</th>`).join("") + "<th>Puan</th></tr>";
  if (!r.list.length) { tb.innerHTML = ""; box.innerHTML = ""; $("tstat").textContent = "Kurallara uyan takas bulunamadı."; return; }
  tb.innerHTML = r.list.map((x, i) => "<tr><td>T" + (i + 1) + "</td>" + CATS.map(k => { const d = x.after[k] - x.before[k];
    return `<td class="ba${d > .005 ? " up" : d < -.005 ? " dn" : ""}"><span class="o">${pc(x.before[k])}</span><span class="n">${pc(x.after[k])}</span></td>`; }).join("") + `<td>+${x.gain.toFixed(2)}</td></tr>`).join("");
  const nm = p => esc(p.name) + " ($" + p.price + (p.status ? ", " + esc(p.status) : "") + ")";
  box.innerHTML = r.list.map((x, i) => {
    const ch = CATS.map(k => [k, Math.round((x.after[k] - x.before[k]) * 100)]).filter(([, d]) => d !== 0).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .map(([k, d]) => `<span class="dch ${d > 0 ? "up" : "dn"}">${LBL[k]} ${d > 0 ? "+" : "−"}${Math.abs(d)}</span>`).join("");
    const ex = [];
    if (x.myDrop) ex.push("Sen bırakırsın: " + esc(x.myDrop.name));
    if (x.give.length > x.get.length) ex.push("Açılan yer stream için kullanılır (bostaki en iyi 20'nin ortalaması)");
    if (x.theirDrop) ex.push(esc(x.partner) + " bırakır: " + esc(x.theirDrop.name));
    ex.push("Draft $ " + x.gPrice + " ↔ " + x.rPrice);
    ex.push(esc(x.partner) + " için genel güç " + (x.pDelta >= 0 ? "+" : "") + (x.pDelta * 100 / 9).toFixed(1) + " puan/kategori");
    ex.push("Takas sonrası ortalama sıralar: " + CATS.map(k => LBL[k] + " " + x.rankAfter[k].toFixed(1)).join(", "));
    return `<details class="tc"><summary><div class="tch"><span>T${i + 1} · ${esc(x.partner)}</span><span class="car">▾</span></div>
<div class="tcb">Ver ${x.give.map(nm).join(" + ")}<br>Al ${x.get.map(nm).join(" + ")}</div>${ch}</summary><ul class="tcx">${ex.map(e => `<li>${e}</li>`).join("")}</ul></details>`;
  }).join("");
  $("tstat").textContent = r.considered + " uygun takas bulundu, en iyi " + r.list.length + " tanesi" + (r.ms != null ? " (" + r.ms + " ms)" : "") + ". Karta dokununca detay açılır.";
}

// ---------- KADRO ----------
function renderRoster() {
  $("repl").textContent = L.repl.toFixed(1);
  $("t-ro").tBodies[0].innerHTML = L.rost[cur].slice().sort((a, b) => b.gv - a.gv).map(p => { const g = p.pg;
    const vc = p.gv > L.repl + 2 ? "win" : p.gv < L.repl ? "loss" : "";
    return `<tr><td>${esc(p.name)}${p.status ? " (" + esc(p.status) + ")" : ""}</td><td>${esc(p.slot || "")}</td><td>$${p.price}</td><td>${pc(p.avail)}</td><td class="${vc}">${p.gv.toFixed(1)}</td>
<td>${f3(g.fgm / g.fga)}</td><td>${f3(g.ftm / g.fta)}</td><td>${f1(g.tpm)}</td><td>${f1(g.pts)}</td><td>${f1(g.reb)}</td><td>${f1(g.ast)}</td><td>${f1(g.st)}</td><td>${f1(g.blk)}</td><td>${f1(g.to)}</td></tr>`; }).join("");
}

// ---------- STRATEJI ----------
function renderStrat() {
  $("strat").innerHTML = STRAT_HTML[cur];
  if (NOTES) { $("notes").textContent = NOTES[cur === "Normal MAFIA" ? "mafia" : "tarkus"] || "Bu takım için henüz not yok."; $("nupd").textContent = NOTES.updated ? "Son not: " + NOTES.updated : ""; }
}

// ---------- LIG ----------
const SUBS = [["h2h", "Eşleşme"], ["all", "Herkese karşı"], ["pow", "Güç"], ["cat", "Kategori"], ["tot", "Toplam"], ["pg", "Maç başı"]];
function standings(V) {
  const out = V.map(a => { let cw = 0, cl = 0, ct = 0, beats = 0; V.forEach(b => { if (a === b) return; const r = cmp(a, b); cw += r.w; cl += r.l; ct += r.t; if (r.w > r.l) beats++; }); return { team: a.team, cw, cl, ct, beats }; });
  out.sort((x, y) => (y.beats - x.beats) || ((y.cw + y.ct / 2) - (x.cw + x.ct / 2))); out.forEach((r, i) => r.rank = i + 1); return out;
}
function renderLeague() {
  if (!DATA) { $("lg-out").innerHTML = "<p class='note'>Lig verisi yükleniyor…</p>"; return; }
  const ks = weekKeys(); if (!lgWk || !DATA.weeks[lgWk]) lgWk = ks[ks.length - 1];
  chipRow($("lg-wk"), weekItems(), lgWk, k => { lgWk = k; setQ({ w: k }); renderLeague(); });
  chipRow($("lg-sub"), SUBS, lgSub, k => { lgSub = k; setQ({ s: k }); renderLeague(); });
  const W = DATA.weeks[lgWk]; $("lg-upd").textContent = (W.label || "") + (W.updated ? " · güncelleme: " + W.updated : "");
  const V = vals(W.teams, false), names = V.map(v => v.team);
  if (!names.includes(lgA)) lgA = names.includes(cur) ? cur : names[0];
  if (!names.includes(lgB) || lgB === lgA) lgB = names.find(t => t !== lgA);
  const sel = t => (t === lgA || (lgSub === "h2h" && t === lgB)) ? "sel" : "";
  const out = $("lg-out"); let h = "";
  if (lgSub === "h2h") {
    const a = V.find(v => v.team === lgA), b = V.find(v => v.team === lgB), r = cmp(a, b);
    h = `<div class="pick">${teamOpts("la", lgA, names)}<span class="vs">VS</span>${teamOpts("lb", lgB, names)}</div>
<div class="score"><span class="a">${r.w}</span> – <span class="b">${r.l}</span></div>
<div class="verdict">${r.w > r.l ? esc(lgA) + " kazanıyor" : r.w < r.l ? esc(lgB) + " kazanıyor" : "Berabere"}${r.t ? " · " + r.t + " kategori berabere" : ""}</div><div class="card">` +
      CATS.map(k => { const x = a[k], y = b[k], mx = Math.max(x, y) || 1, isP = k === "fgp" || k === "ftp", fx = v => isP ? f3(v) : Math.round(v);
        return `<div class="cat"><span class="va${better(k, x, y) ? " wa" : ""}">${fx(x)}</span><div class="track a"><span style="width:${100 * x / mx}%"></span></div><span class="lbl">${LBL[k]}</span><div class="track b"><span style="width:${100 * y / mx}%"></span></div><span class="${better(k, y, x) ? "wb" : ""}">${fx(y)}</span></div>`; }).join("") + "</div>";
  } else if (lgSub === "all") {
    const c = V.find(v => v.team === lgA);
    h = teamOpts("la", lgA, names) + `<div class="tw" style="margin-top:8px"><table><thead><tr><th>Rakip</th><th>G</th><th>M</th><th>B</th><th>Sonuç</th></tr></thead><tbody>` +
      V.filter(o => o !== c).map(o => ({ o, r: cmp(c, o) })).sort((p, q) => (q.r.w - q.r.l) - (p.r.w - p.r.l)).map(({ o, r }) => {
        const res = r.w > r.l ? ["Kazanır", "win"] : r.w < r.l ? ["Kaybeder", "loss"] : ["Berabere", "tie"];
        return `<tr><td>${esc(o.team)}</td><td>${r.w}</td><td>${r.l}</td><td>${r.t}</td><td><span class="pill ${res[1]}">${res[0]}</span></td></tr>`; }).join("") + "</tbody></table></div>";
  } else if (lgSub === "pow") {
    h = `<p class="note">Her takım bu dönemin toplamlarıyla diğer herkese karşı eşleştirilseydi: yendiği rakip sayısı ve toplam kategori sonucu.</p><div class="tw"><table><thead><tr><th>Sıra</th><th class="l">Takım</th><th>Yendiği</th><th>Kat. G</th><th>M</th><th>B</th></tr></thead><tbody>` +
      standings(V).map(r => `<tr class="${sel(r.team)}"><td>${r.rank}</td><td class="l">${esc(r.team)}</td><td>${r.beats}</td><td>${r.cw}</td><td>${r.cl}</td><td>${r.ct}</td></tr>`).join("") + "</tbody></table></div>";
  } else if (lgSub === "cat") {
    const ranks = V.map(a => { const o = { team: a.team }; let s = 0; CATS.forEach(k => { o[k] = 1 + V.filter(b => better(k, b[k], a[k])).length; s += o[k]; }); o.avg = s / 9; return o; }).sort((x, y) => x.avg - y.avg);
    const rc = n => n <= 4 ? "win" : n >= V.length - 3 ? "loss" : "";
    h = `<button class="btn" id="catall">${catAll ? "Tek takım görünümü" : "Tüm takımlar tablosu"}</button>`;
    if (catAll) {
      h += `<p class="note">1 = ligin en iyisi. Ortalama sıraya göre dizildi; ilk 4 yeşil, son 4 kırmızı.</p><div class="tw"><table><thead><tr><th>Takım</th><th>Ort.</th>${CATS.map(k => `<th>${LBL[k]}</th>`).join("")}</tr></thead><tbody>` +
        ranks.map(o => `<tr class="${sel(o.team)}"><td>${esc(o.team)}</td><td>${o.avg.toFixed(1)}</td>${CATS.map(k => `<td class="${rc(o[k])}">${o[k]}</td>`).join("")}</tr>`).join("") + "</tbody></table></div>";
    } else {
      const o = ranks.find(x => x.team === lgA), a = V.find(v => v.team === lgA);
      h += teamOpts("la", lgA, names) + `<div class="card" style="margin-top:8px">` + CATS.map(k => `<div class="wrow" style="grid-template-columns:60px 1fr 52px"><div class="wl">${LBL[k]}</div><div class="mut">${k === "fgp" || k === "ftp" ? f3(a[k]) : Math.round(a[k])}</div><div class="wp ${rc(o[k])}">${o[k]}.</div></div>`).join("") +
        `<div class="wrow" style="grid-template-columns:60px 1fr 52px"><div class="wl">Ort.</div><div></div><div class="wp">${o.avg.toFixed(1)}</div></div></div>`;
    }
  } else if (lgSub === "tot") {
    const order = Object.fromEntries(standings(V).map(r => [r.team, r.rank]));
    h = `<p class="note">Yahoo'daki toplamlar, güç sırasına göre.</p><div class="tw"><table><thead><tr><th>Takım</th><th>Maç</th><th>FGM/A</th><th>FG%</th><th>FTM/A</th><th>FT%</th><th>3PM</th><th>PTS</th><th>REB</th><th>AST</th><th>ST</th><th>BLK</th><th>TO</th></tr></thead><tbody>` +
      V.slice().sort((x, y) => order[x.team] - order[y.team]).map(v => { const r = v.raw;
        return `<tr class="${sel(r.team)}"><td>${esc(r.team)}</td><td>${r.gp ?? "–"}</td><td>${r.fgm}/${r.fga}</td><td>${f3(v.fgp)}</td><td>${r.ftm}/${r.fta}</td><td>${f3(v.ftp)}</td><td>${r.tpm}</td><td>${r.pts}</td><td>${r.reb}</td><td>${r.ast}</td><td>${r.st}</td><td>${r.blk}</td><td>${r.to}</td></tr>`; }).join("") + "</tbody></table></div>";
  } else {
    const PG = vals(W.teams, true);
    const pgs = PG.map(a => { let w = 0; PG.forEach(b => { if (a !== b) CATS.forEach(k => { if (better(k, a[k], b[k])) w++; }); }); return { a, w }; }).sort((x, y) => y.w - x.w);
    h = `<p class="note">Takımlar farklı sayıda maç oynadığı için maç başına ortalamalar. Sıralama, bu ortalamalarla herkese karşı kazanılan kategori sayısına göre; Yahoo skorunu değil takımların gücünü gösterir.</p><div class="tw"><table><thead><tr><th>Sıra</th><th class="l">Takım</th><th>Maç</th><th>Kat. G</th><th>FG%</th><th>FT%</th><th>3PM</th><th>PTS</th><th>REB</th><th>AST</th><th>ST</th><th>BLK</th><th>TO</th></tr></thead><tbody>` +
      pgs.map(({ a, w }, i) => `<tr class="${sel(a.team)}"><td>${i + 1}</td><td class="l">${esc(a.team)}</td><td>${a.gp ?? "–"}</td><td>${w}</td><td>${f3(a.fgp)}</td><td>${f3(a.ftp)}</td>${["tpm", "pts", "reb", "ast", "st", "blk", "to"].map(k => `<td>${f1(a[k])}</td>`).join("")}</tr>`).join("") + "</tbody></table></div>";
  }
  out.innerHTML = h;
  const la = $("la"), lb = $("lb"), ca = $("catall");
  if (la) la.onchange = () => { lgA = la.value; setQ({ a: lgA }); renderLeague(); };
  if (lb) lb.onchange = () => { lgB = lb.value; setQ({ b: lgB }); renderLeague(); };
  if (ca) ca.onclick = () => { catAll = !catAll; renderLeague(); };
}

// ---------- gezinme ----------
function needsModel(v) { return v === "win" || v === "tr" || v === "ro"; }
function render() {
  [...$("teams").children].forEach(b => b.classList.toggle("on", b.dataset.t === cur));
  [...$("tabs").children].forEach(b => b.classList.toggle("on", b.dataset.v === view));
  ["win", "tr", "ro", "st", "lg"].forEach(v => $("v-" + v).hidden = v !== view);
  if (needsModel(view) && !L) return;
  if (view === "win") renderWin(); else if (view === "tr") renderTrades(); else if (view === "ro") renderRoster(); else if (view === "st") renderStrat(); else renderLeague();
}
function init() {
  TEAMS.forEach(t => { const b = document.createElement("button"); b.textContent = SHORT[t]; b.dataset.t = t;
    b.onclick = () => { if (cur === t) return; cur = t; lgA = t; setQ({ t: t === "Normal MAFIA" ? "mafia" : "tarkus" }); render(); }; $("teams").append(b); });
  [...$("tabs").children].forEach(b => b.onclick = () => { view = b.dataset.v; setQ({ v: view }); window.scrollTo(0, 0); render(); });
  if (Q.get("a")) lgA = Q.get("a");
  render();
  const v = "?v=" + Date.now();
  const get = f => fetch("../" + f + v).then(r => { if (!r.ok) throw new Error(f); return r.json(); });
  get("data.json").then(d => { DATA = d; addSeason(d); if (!L && view === "win") $("win-desc").textContent = "Oyuncu verileri yükleniyor…"; render(); }).catch(() => { $("lg-out").innerHTML = "<p class='err'>Lig verisi yüklenemedi. Sayfayı yenile.</p>"; });
  Promise.all([get("players/bu_sezon_ort.json"), get("players/gecen_sezon_ort.json"), get("players/projeksiyon_kalan.json"),
               get("players/son14_ort.json"), get("rosters.json"), get("standings.json"), get("draft.json")])
    .then(([bu, gecen, proj, son14, rosters, standings, draft]) => {
      L = new E.League(E.buildPlayers({ bu, gecen, proj, son14 }), rosters, standings, draft);
      $("pupd").textContent = "Veri: " + (rosters.updated || ""); render();
    }).catch(e => { $("win-desc").innerHTML = "<span class='err'>Veriler yüklenemedi: " + esc(e.message) + "</span>"; $("tstat").textContent = "Veriler yüklenemedi."; });
  fetch("notes.json" + v).then(r => r.ok ? r.json() : null).then(n => { NOTES = n; if (view === "st") renderStrat(); }).catch(() => {});
}
init();
})();
