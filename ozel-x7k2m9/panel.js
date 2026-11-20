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
let L = null, DATA = null, NOTES = null, SR = null, bwOpp = Q.get("o") || null;
let cur = Q.get("t") === "mafia" ? "Normal MAFIA" : "tarkus maurelius";
let view = ["win", "tr", "ro", "st", "lg"].includes(Q.get("v")) ? Q.get("v") : "win";
let winWk = Q.get("ww") || "p";
let lgWk = Q.get("w") || null, lgSub = Q.get("s") || "h2h", lgA = null, lgB = Q.get("b") || null, catAll = false;
const tradeCache = {};
let trMode = Q.get("m") === "sim" ? "sim" : "auto", simP = null; const simGive = new Set(), simGet = new Set();

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
  const out = {}; CATS.forEach(k => out[k] = 0); const opp = L.topFor(team);
  opp.forEach(o => { const oc = L.base[o]; CATS.forEach(k => { out[k] += E.pWin(c, oc, k); }); });
  CATS.forEach(k => out[k] /= opp.length || 1); return out;
}
function weekWin(team, w) {
  const V = vals(DATA.weeks[w].teams, false); const me = V.find(v => v.team === team); if (!me) return null;
  const others = V.filter(v => v !== me), top = others.filter(v => L.topFor(team).includes(v.team));
  const sc = (arr, k) => arr.reduce((a, o) => a + (better(k, me[k], o[k]) ? 1 : me[k] === o[k] ? .5 : 0), 0) / (arr.length || 1);
  const all = {}, t6 = {}, rank = {};
  CATS.forEach(k => { all[k] = sc(others, k); t6[k] = sc(top, k); rank[k] = 1 + others.filter(o => better(k, o[k], me[k])).length; });
  return { all, t6, rank, n: others.length };
}
// ---------- BU HAFTA (gercek rakibe karsi kalan gunler) ----------
const TRM = { ocak: 1, şubat: 2, mart: 3, nisan: 4, mayıs: 5, haziran: 6, temmuz: 7, ağustos: 8, eylül: 9, ekim: 10, kasım: 11, aralık: 12 };
const GUN = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
function includedDate(upd, ref) {
  const m = String(upd || "").match(/(\d{1,2})\s+(\S+)\s+maçları dahil/i); if (!m) return null;
  const mo = TRM[m[2].toLocaleLowerCase("tr")]; if (!mo) return null;
  let y = +ref.slice(0, 4); const rm = +ref.slice(5, 7); if (mo - rm > 6) y--; else if (rm - mo > 6) y++;
  return y + "-" + String(mo).padStart(2, "0") + "-" + String(+m[1]).padStart(2, "0");
}
function dayPlayers(team, d) {
  const rows = ((SR.days[d] || {})[team]) || [];
  const roster = L.rost[team] || [];
  const ps = rows.filter(r => r.game && !/^IL/.test(r.slot || "")).map(r => {
    const n = E.normName(r.name); return roster.find(p => E.normName(p.name) === n);
  }).filter(p => p && !(p.ret && d < p.ret));
  return ps.sort((a, b) => b.gv - a.gv).slice(0, 10);
}
function thisWeek(team, opp) {
  const ks = weekKeys(), W = DATA.weeks[ks[ks.length - 1]];
  const all = Object.keys(SR.days).sort(); const first = all[0];
  const inc = includedDate(W.updated, first) || E.isoAdd(first, -1);
  let end = E.isoAdd(inc, 1); while (new Date(end + "T12:00:00Z").getUTCDay() !== 0) end = E.isoAdd(end, 1);
  const days = all.filter(d => d > inc && d <= end);
  const C = ["fgm", "fga", "ftm", "fta", "tpm", "pts", "reb", "ast", "st", "blk", "to"];
  const side = t => { const m = {}, v = {}; C.forEach(k => { m[k] = 0; v[k] = 0; }); const per = [];
    days.forEach(d => { const ps = dayPlayers(t, d); per.push(ps.length); ps.forEach(p => C.forEach(k => { m[k] += p.pg[k]; v[k] += Math.max(p.pg[k], .3); })); });
    const cur = W.teams.find(x => x.team === t) || {}; return { m, v, per, cur }; };
  const A = side(team), B = side(opp), p = {}, now = {}, fin = {};
  ["fgp", "ftp"].forEach(k => { const mk = k === "fgp" ? "fgm" : "ftm", ak = k === "fgp" ? "fga" : "fta";
    const na = A.cur[ak] + A.m[ak], nb = B.cur[ak] + B.m[ak], fa = (A.cur[mk] + A.m[mk]) / na, fb = (B.cur[mk] + B.m[mk]) / nb;
    now[k] = [A.cur[mk] / A.cur[ak], B.cur[mk] / B.cur[ak]]; fin[k] = [fa, fb];
    p[k] = E.phi((fa - fb) / Math.sqrt(fa * (1 - fa) / na + fb * (1 - fb) / nb || 1e-6)); });
  ["tpm", "pts", "reb", "ast", "st", "blk", "to"].forEach(k => { const x = A.cur[k] + A.m[k], y = B.cur[k] + B.m[k];
    now[k] = [A.cur[k], B.cur[k]]; fin[k] = [x, y]; const sdv = Math.sqrt(A.v[k] + B.v[k]) || 1;
    p[k] = E.phi((k === "to" ? y - x : x - y) / sdv); });
  let dp = [1]; CATS.forEach(k => { const q = p[k], nx = Array(dp.length + 1).fill(0); dp.forEach((v, i) => { nx[i] += v * (1 - q); nx[i + 1] += v * q; }); dp = nx; });
  const wp = dp.slice(5).reduce((a, b) => a + b, 0), ex = CATS.reduce((a, k) => a + p[k], 0);
  return { W, days, p, now, fin, wp, ex, perA: A.per, perB: B.per };
}
function renderThisWeek() {
  const ks = weekKeys(), W = DATA.weeks[ks[ks.length - 1]], names = W.teams.map(t => t.team);
  const pr = (W.pairs || []).find(x => x.includes(cur)); const def = pr ? pr.find(t => t !== cur) : names.find(t => t !== cur);
  if (!names.includes(bwOpp) || bwOpp === cur) bwOpp = def;
  const r = thisWeek(cur, bwOpp), pct = k => k === "fgp" || k === "ftp";
  const fx = (k, v) => pct(k) ? f3(v) : Math.round(v);
  $("win-desc").textContent = (W.label || "") + " · " + (W.updated || "") + ". Mevcut skor + kalan günlerde maçı olan oyuncular (günde en çok 10, IL ve dönmemiş sakatlar hariç).";
  const plan = PLAN[cur];
  $("win-rows").innerHTML = `<div class="pick" style="margin-bottom:8px;grid-template-columns:auto 1fr"><span class="mut">Rakip</span> ${teamOpts("bwo", bwOpp, names.filter(t => t !== cur))}</div>` +
    CATS.map(k => { const v = r.p[k], tag = plan.punt.includes(k) ? ["punt", "punt"] : null;
      return `<div class="wrow"><div class="wl">${LBL[k]}${tag ? ` <span class="tag ${tag[1]}">${tag[0]}</span>` : ""}</div>
<div class="bar"><i class="${cls(v)}" style="width:${Math.max(2, Math.round(v * 100))}%"></i></div><div class="wp ${cls(v)}">${pc(v)}</div>
<div class="ws">Şu an ${fx(k, r.now[k][0])} – ${fx(k, r.now[k][1])} · tahmin <b>${fx(k, r.fin[k][0])} – ${fx(k, r.fin[k][1])}</b></div></div>`; }).join("") +
    (r.days.length ? `<div class="tw" style="margin-top:10px"><table><thead><tr><th>Gün</th>${r.days.map(d => `<th>${GUN[new Date(d + "T12:00:00Z").getUTCDay()]} ${+d.slice(8)}</th>`).join("")}<th>Top.</th></tr></thead><tbody>
<tr><td>${esc(SHORT[cur] || cur)}</td>${r.perA.map(n => `<td class="${n < 10 ? "win" : ""}">${n}</td>`).join("")}<td>${r.perA.reduce((a, b) => a + b, 0)}</td></tr>
<tr><td>Rakip</td>${r.perB.map(n => `<td>${n}</td>`).join("")}<td>${r.perB.reduce((a, b) => a + b, 0)}</td></tr></tbody></table></div>
<p class="note">Oynayacak oyuncu sayısı. Yeşil günlerde boş aktif yer var: stream için uygun.</p>` : `<p class="note">Bu hafta kalan maç günü yok.</p>`);
  $("win-kpi").innerHTML = `<div class="kpi"><span>Beklenen kategori</span><b>${r.ex.toFixed(1)} – ${(9 - r.ex).toFixed(1)}</b></div><div class="kpi"><span>Haftayı alma</span><b>${pc(r.wp)}</b></div>`;
  const s = $("bwo"); if (s) s.onchange = () => { bwOpp = s.value; setQ({ o: bwOpp }); renderWin(); };
}
function renderWin() {
  const items = [["p", "Sezon tahmini"]].concat(DATA && SR ? [["bw", "Bu hafta"]] : []).concat(DATA ? weekItems() : []);
  if (DATA && !items.some(i => i[0] === winWk)) winWk = "p";
  if (!DATA && winWk !== "p") { $("win-desc").textContent = "Haftalık veriler yükleniyor…"; return; }
  chipRow($("win-wk"), items, winWk, k => { winWk = k; setQ({ ww: k }); renderWin(); });
  if (winWk === "bw") return renderThisWeek();
  let r, desc;
  if (winWk === "p") {
    const c = L.base[cur]; r = { all: L.plain(cur, c), t6: topOnly(cur, c), rank: L.probs(cur, c).rank };
    desc = "Sezonun kalanı (4 Nisan'a kadar) için haftalık ortalama kazanma olasılığı. Projeksiyon: bu sezon (maç sayısına göre), geçen sezon, Yahoo projeksiyonu + %10 son 14 gün; gerçek NBA takvimi. Sakatlar tahmini dönüş tarihine kadar sayılmaz, o haftalarda yerleri bostaki en iyi 20'nin ortalamasıyla dolar; her hafta en iyi 13 oyuncu oynar.";
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
<div class="ws">İlk 4'e karşı <b class="${cls(r.t6[k])}">${pc(r.t6[k])}</b> · ${winWk === "p" ? "ort. sıra" : "sıra"} ${winWk === "p" ? r.rank[k].toFixed(1) : r.rank[k] + "/16"}</div></div>`;
  }).join("");
  const counted = CATS.filter(k => !plan.punt.includes(k));
  const good = CATS.filter(k => r.all[k] >= .5).length;
  const avg = counted.reduce((a, k) => a + r.all[k], 0) / counted.length;
  const avg6 = counted.reduce((a, k) => a + r.t6[k], 0) / counted.length;
  $("win-kpi").innerHTML = `<div class="kpi"><span>%50 üstü kategori</span><b>${good} / 9</b></div><div class="kpi"><span>Ortalama · ilk 4 (punt hariç)</span><b>${pc(avg)} · ${pc(avg6)}</b></div>`;
}

// ---------- TAKASLAR ----------
function renderTrades() {
  [...$("tr-sub").children].forEach(b => { b.classList.toggle("on", b.dataset.m === trMode); b.onclick = () => { trMode = b.dataset.m; setQ({ m: trMode }); renderTrades(); }; });
  $("tr-auto").hidden = trMode !== "auto"; $("tr-sim").hidden = trMode !== "sim";
  if (trMode === "sim") return renderSim();
  const r = tradeCache[cur];
  if (!r) { $("tstat").textContent = "Hesaplanıyor… (1.000'lerce takas deneniyor, birkaç saniye sürebilir)"; setTimeout(() => { try { if (typeof L.evalTrade !== "function") throw new Error("Eski motor dosyası önbellekte kalmış; sayfayı tamamen kapatıp yeniden aç."); const t0 = performance.now(); tradeCache[cur] = L.searchTrades(cur, { limit: 12 }); tradeCache[cur].ms = Math.round(performance.now() - t0); renderTrades(); } catch (e) { $("tstat").innerHTML = "<span class='err'>Takaslar hesaplanamadı: " + esc(e.message) + "</span>"; } }, 40); return; }
  const th = $("t-tr").tHead, tb = $("t-tr").tBodies[0], box = $("tr-cards");
  th.innerHTML = "<tr><th>#</th>" + CATS.map(k => `<th>${LBL[k]}</th>`).join("") + "<th>Kat.</th></tr>";
  if (!r.list.length) { tb.innerHTML = ""; box.innerHTML = ""; $("tstat").textContent = "Anlamlı takas yok: " + r.evaluated + " aday hesaplandı, hiçbiri ilk 4'e karşı haftada +0,15 kategori kazandırmıyor (veya bir kuralı bozuyor)."; return; }
  tb.innerHTML = r.list.map((x, i) => "<tr><td>T" + (i + 1) + "</td>" + CATS.map(k => { const d = x.top[k] - x.topBefore[k];
    return `<td class="ba${d > .005 ? " up" : d < -.005 ? " dn" : ""}"><span class="o">${pc(x.topBefore[k])}</span><span class="n">${pc(x.top[k])}</span></td>`; }).join("") + `<td>+${x.gain.toFixed(2)}</td></tr>`).join("");
  const nm = p => esc(p.name) + " ($" + p.price + (p.status ? ", " + esc(p.status) : "") + ")";
  box.innerHTML = r.list.map((x, i) => {
    const ch = CATS.map(k => [k, Math.round((x.top[k] - x.topBefore[k]) * 100)]).filter(([, d]) => d !== 0).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .map(([k, d]) => `<span class="dch ${d > 0 ? "up" : "dn"}">${LBL[k]} ${d > 0 ? "+" : "−"}${Math.abs(d)}</span>`).join("");
    const ex = [];
    if (x.myDrop) ex.push("Sen bırakırsın: " + esc(x.myDrop.name));
    if (x.give.length > x.get.length) ex.push("Açılan yer stream için kullanılır (bostaki en iyi 20'nin ortalaması)");
    if (x.theirDrop) ex.push(esc(x.partner) + " bırakır: " + esc(x.theirDrop.name));
    ex.push("İlk 4'e karşı haftada +" + x.gain.toFixed(2) + " kategori (sezonun kalanı, sakatlar dönüş tarihinden sonra)");
    ex.push("Draft $ " + x.gPrice + " ↔ " + x.rPrice);
    ex.push("Oyuncu değeri (sağlıklı hal): verdiğin " + x.fvOut.toFixed(1) + " · aldığın " + x.fvIn.toFixed(1) + " → " + esc(x.partner) + " için " + (x.fvOut - x.fvIn >= 0 ? "+" : "") + (x.fvOut - x.fvIn).toFixed(1));
    ex.push("Lig geneli kazanma: " + CATS.map(k => LBL[k] + " " + pc(x.before[k]) + "→" + pc(x.after[k])).join(", "));
    return `<details class="tc"><summary><div class="tch"><span>T${i + 1} · ${esc(x.partner)}</span><span class="car">▾</span></div>
<div class="tcb">Ver ${x.give.map(nm).join(" + ")}<br>Al ${x.get.map(nm).join(" + ")}</div>${ch}</summary><ul class="tcx">${ex.map(e => `<li>${e}</li>`).join("")}</ul></details>`;
  }).join("");
  $("tstat").textContent = r.evaluated + " aday hesaplandı, " + r.considered + " tanesi eşiği geçti; en iyi " + r.list.length + " tanesi" + (r.ms != null ? " (" + (r.ms / 1000).toFixed(1) + " sn)" : "") + ". Tablo: ilk 4'e karşı kategori kazanma %, son sütun haftada kazanılan ek kategori. Karta dokununca detay açılır.";
}

// ---------- TAKAS DENE ----------
let simRes = null;
const shortName = n => { const w = String(n).split(" "); return w.length > 1 ? w[0][0] + ". " + w.slice(1).join(" ") : n; };
const sgn = v => { const r = Math.round(v * 100) / 100; return (r > 0 ? "+" : r < 0 ? "−" : "±") + Math.abs(r).toFixed(2).replace(".", ","); };
const dcls = (d, punt) => punt ? "cm" : d > .005 ? "cu" : d < -.005 ? "cd" : "";
function selRow(p, set, side) {
  const rt = p.ret ? " · " + esc(p.status || "O") + " " + (+p.ret.slice(8)) + "." + (+p.ret.slice(5, 7)) : (p.status ? " · " + esc(p.status) : "");
  return `<label class="sp"><input type="checkbox" data-s="${side}" data-id="${p.id}"${set.has(p.id) ? " checked" : ""}>
<span><span>${esc(shortName(p.name))}</span><span class="sm${p.ret ? " cd" : ""}">$${p.price} · ${p.fv.toFixed(1)}${rt}</span></span></label>`;
}
function catBox(title, before, after, punt) {
  const head = CATS.map(k => `<span class="k">${LBL[k]}</span>`).join("");
  const r1 = CATS.map(k => `<span class="o">${Math.round(before[k] * 100)}</span>`).join("");
  const r2 = CATS.map(k => `<span class="a ${dcls(after[k] - before[k], k in punt)}">${Math.round(after[k] * 100)}</span>`).join("");
  const r3 = CATS.map(k => { const d = Math.round((after[k] - before[k]) * 100); return `<span class="d ${dcls(after[k] - before[k], k in punt)}">${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d)}</span>`; }).join("");
  return `<div class="ibox"><div class="secl">${title}</div>
<div class="igrid"><span class="rl h"></span>${head}<span class="rl">Önce</span>${r1}<span class="rl">Sonra</span>${r2}</div>
<div class="fgrid"><span class="rl">Fark</span>${r3}</div></div>`;
}
function pCards(list, other, kind) {
  const val = (p, k) => { const s = p.season; if (!s) return NaN; return s[k]; };
  const avg = k => { const v = other.map(p => val(p, k)).filter(isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; };
  const cell = (p, k) => { const v = val(p, k), o = avg(k), pct = k === "fgp" || k === "ftp";
    const w = isFinite(v) && isFinite(o) && (k === "to" ? v < o : v > o);
    return `<span><span class="sk">${LBL[k]}</span><span class="sv${w ? " w" : ""}">${!isFinite(v) ? "–" : pct ? f3(v) : f1(v)}</span></span>`; };
  return list.map(p => { const s = p.season, mp = s && s.mpg ? " · " + parseInt(s.mpg, 10) + " dk" : "";
    return `<div class="pcard ${kind}"><span class="plb ${kind === "g" ? "cd" : "cu"}">${kind === "g" ? "Veriyorsun" : "Alıyorsun"}</span>
<div class="nm">${esc(shortName(p.name))}</div><div class="sm">$${p.price} · ${esc(p.pos || "")}${s ? " · " + s.gp + " maç" + mp : " · bu sezon maç yok"}${p.ret ? " · dönüş " + (+p.ret.slice(8)) + "." + (+p.ret.slice(5, 7)) : ""}</div>
<div class="sg5">${["fgp", "ftp", "tpm", "pts", "reb"].map(k => cell(p, k)).join("")}</div>
<div class="sg4">${["ast", "st", "blk", "to"].map(k => cell(p, k)).join("")}</div></div>`; }).join("");
}
function simResult(x) {
  const me = SHORT[cur] || cur, punt = (E.STRAT[cur] || {}).punt || {};
  const hard = x.warn.filter(w => w.hard), soft = x.warn.filter(w => !w.hard);
  const cls = hard.length ? "bad" : x.gain >= .15 ? "ok" : "neu";
  const verdict = hard.length ? hard.length + " kural uyarısı" : x.gain >= .15 ? "Uygun ✓" : "Kazanç küçük";
  const val = x.fvIn - x.fvOut;
  const drops = [x.myDrop ? "Sen bırakırsın: " + esc(x.myDrop.name) : "", x.give.length > x.get.length ? "Açılan yer stream için kullanılır" : "", x.theirDrop ? esc(x.partner) + " bırakır: " + esc(x.theirDrop.name) : ""].filter(Boolean);
  const pg = x.p;
  return `<div id="sim-res">
<div class="rhd"><span class="rttl">${esc(me)} tarafı</span><span class="plb ${cls === "bad" ? "cd" : cls === "ok" ? "cu" : "cm"}">${verdict}</span></div>
<div class="sm" style="margin-bottom:6px">${x.give.map(p => esc(shortName(p.name))).join(" + ")} → ${x.get.map(p => esc(shortName(p.name))).join(" + ")} · ${esc(x.partner)}</div>
<div class="hero ${cls}"><div><div class="l">İlk 4'e karşı</div><div class="n">${sgn(x.gain)} <small>kat./hafta</small></div></div><div><div class="l">Lig geneli</div><div class="n">${sgn(x.lgGain)} <small>kat./hafta</small></div></div></div>
${hard.concat(soft).map(w => `<p class="warnl${w.hard ? "" : " s"}">${w.hard ? "⚠ " : ""}${esc(w.t)}</p>`).join("")}
${catBox("Kategori etkisi · ilk 4'e karşı kazanma %", x.topBefore, x.top, punt)}
<div class="hrl"></div>
<div class="secl">Oyuncular · bu sezon maç başı</div>
<div class="pcs"><div>${pCards(x.give, x.get, "g")}</div><div>${pCards(x.get, x.give, "r")}</div></div>
<div class="rfoot"><span>Draft $ ${x.gPrice} ↔ ${x.rPrice}</span><span>Değer: sen ${val >= 0 ? "+" : "−"}${Math.abs(val).toFixed(1)} · ${esc(x.partner)} ${-val >= 0 ? "+" : "−"}${Math.abs(val).toFixed(1)}</span></div>
${drops.length ? `<div class="sm" style="margin-top:4px">${drops.join(" · ")}</div>` : ""}
<div class="psep">Karşı taraf</div>
<div class="rhd"><span class="rttl">${esc(x.partner)} tarafı</span></div>
<div class="hero neu"><div><div class="l">İlk 4'e karşı</div><div class="n ${pg.gain > .02 ? "cu" : pg.gain < -.02 ? "cd" : ""}">${sgn(pg.gain)} <small>kat./hafta</small></div></div><div><div class="l">Lig geneli</div><div class="n ${pg.lgGain > .02 ? "cu" : pg.lgGain < -.02 ? "cd" : ""}">${sgn(pg.lgGain)} <small>kat./hafta</small></div></div></div>
<div class="sm" style="margin-top:6px">Değer: ${-val >= 0 ? "+" : "−"}${Math.abs(val).toFixed(1)} · Draft $ ${x.rPrice} ↔ ${x.gPrice}</div>
${catBox("Kategori etkisi · " + esc(x.partner) + " için ilk 4'e karşı kazanma %", pg.topBefore, pg.top, pg.punt)}
<button class="btns" id="sim-new" style="width:100%;margin-top:14px">↑ Yeni takas dene</button></div>`;
}
function renderSim() {
  const others = L.teams.filter(t => t !== cur).sort((a, b) => a.localeCompare(b, "tr"));
  if (!others.includes(simP)) { simP = others[0]; simGet.clear(); simRes = null; }
  const mine = L.rost[cur].slice().sort((a, b) => b.fv - a.fv), theirs = L.rost[simP].slice().sort((a, b) => b.fv - a.fv);
  [...simGive].forEach(id => { if (!mine.some(p => p.id === id)) simGive.delete(id); });
  [...simGet].forEach(id => { if (!theirs.some(p => p.id === id)) simGet.delete(id); });
  const give = mine.filter(p => simGive.has(p.id)), get = theirs.filter(p => simGet.has(p.id));
  const sc = $("sc"), keep = sc ? sc.scrollTop : 0;
  const sum = give.length || get.length ? `Ver: ${give.map(p => esc(shortName(p.name))).join(", ") || "–"} · Al: ${get.map(p => esc(shortName(p.name))).join(", ") || "–"}` : "Vereceklerini solda, alacaklarını sağda işaretle.";
  $("tr-sim").innerHTML = `<div class="pick" style="margin-bottom:8px;grid-template-columns:auto 1fr"><span class="mut">Karşı takım</span> ${teamOpts("simp", simP, others)}</div>
<div class="scol"><div class="card"><div class="secl">Ver · ${esc(SHORT[cur] || cur)}</div>${mine.map(p => selRow(p, simGive, "g")).join("")}</div>
<div class="card"><div class="secl">Al · ${esc(simP)}</div>${theirs.map(p => selRow(p, simGet, "r")).join("")}</div></div>
<div class="sm" style="margin:6px 0 0">${sum}</div>
<div class="sbar"><button class="btnp" id="sim-go"${give.length && get.length ? "" : " disabled"}>Hesapla ↓</button><button class="btns" id="sim-clr">Temizle</button></div>` +
    (simRes === null ? "" : simRes === false ? `<p class="note">Bu takas kadro sınırı nedeniyle hesaplanamadı.</p>` : simResult(simRes));
  if (sc) sc.scrollTop = keep;
  $("simp").onchange = e => { simP = e.target.value; simGet.clear(); simRes = null; renderSim(); };
  $("tr-sim").querySelectorAll("input[type=checkbox]").forEach(cb => cb.onchange = () => {
    const set = cb.dataset.s === "g" ? simGive : simGet, id = +cb.dataset.id; cb.checked ? set.add(id) : set.delete(id); simRes = null; renderSim(); });
  $("sim-go").onclick = () => { simRes = L.evalTrade(cur, simP, give, get) || false; renderSim(); const r = $("sim-res"); if (r) r.scrollIntoView({ behavior: "smooth", block: "start" }); };
  $("sim-clr").onclick = () => { simGive.clear(); simGet.clear(); simRes = null; renderSim(); };
  const nb = $("sim-new"); if (nb) nb.onclick = () => { simGive.clear(); simGet.clear(); simRes = null; renderSim(); if (sc) sc.scrollTo({ top: 0, behavior: "smooth" }); };
}

// ---------- KADRO ----------
function renderRoster() {
  $("repl").textContent = L.repl.toFixed(1);
  $("t-ro").tBodies[0].innerHTML = L.rost[cur].slice().sort((a, b) => b.gv - a.gv).map(p => { const g = p.pg;
    const vc = p.gv > L.repl + 2 ? "win" : p.gv < L.repl ? "loss" : "";
    const rt = p.ret ? " · dönüş " + (+p.ret.slice(8)) + "." + (+p.ret.slice(5, 7)) : "";
    return `<tr><td>${esc(p.name)}${p.status || rt ? " (" + esc(p.status || "") + rt + ")" : ""}</td><td>${esc(p.slot || "")}</td><td>$${p.price}</td><td>${pc(p.health)}</td><td class="${vc}">${p.gv.toFixed(1)}</td>
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
    b.onclick = () => { if (cur === t) return; cur = t; lgA = t; simGive.clear(); simGet.clear(); simP = null; simRes = null; setQ({ t: t === "Normal MAFIA" ? "mafia" : "tarkus" }); render(); }; $("teams").append(b); });
  [...$("tabs").children].forEach(b => b.onclick = () => { view = b.dataset.v; setQ({ v: view }); window.scrollTo(0, 0); render(); });
  if (Q.get("a")) lgA = Q.get("a");
  render();
  const v = "?v=" + Date.now();
  const get = f => fetch("../" + f + v).then(r => { if (!r.ok) throw new Error(f); return r.json(); });
  get("data.json").then(d => { DATA = d; addSeason(d); if (!L && view === "win") $("win-desc").textContent = "Oyuncu verileri yükleniyor…"; render(); }).catch(() => { $("lg-out").innerHTML = "<p class='err'>Lig verisi yüklenemedi. Sayfayı yenile.</p>"; });
  Promise.all([get("players/bu_sezon_ort.json"), get("players/gecen_sezon_ort.json"), get("players/projeksiyon_kalan.json"),
               get("players/son14_ort.json"), get("rosters.json"), get("standings.json"), get("draft.json"),
               get("nba_schedule.json"), get("injuries.json").catch(() => null), get("startingrosters.json").catch(() => null)])
    .then(([bu, gecen, proj, son14, rosters, standings, draft, schedule, injuries, sr]) => {
      SR = sr && sr.days ? sr : null;
      const start = SR ? Object.keys(SR.days).sort()[0] : undefined;
      L = new E.League(E.buildPlayers({ bu, gecen, proj, son14 }), rosters, standings, draft, { schedule, injuries, start });
      $("pupd").textContent = "Veri: " + (rosters.updated || ""); render();
    }).catch(e => { $("win-desc").innerHTML = "<span class='err'>Veriler yüklenemedi: " + esc(e.message) + "</span>"; $("tstat").textContent = "Veriler yüklenemedi."; });
  fetch("notes.json" + v).then(r => r.ok ? r.json() : null).then(n => { NOTES = n; if (view === "st") renderStrat(); }).catch(() => {});
}
init();
})();
