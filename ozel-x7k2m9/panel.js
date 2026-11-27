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
let L = null, DATA = null, NOTES = null, SR = null, RAW = null, GD = {}, bwOpp = Q.get("o") || null;
let cur = Q.get("t") === "mafia" ? "Normal MAFIA" : "tarkus maurelius";
let view = ["win", "tr", "ro", "fo", "st", "lg"].includes(Q.get("v")) ? Q.get("v") : "win";
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
function dayPlayers(team, d, extra) {
  const rows = ((SR.days[d] || {})[team]) || [];
  const roster = L.rost[team] || [];
  const ps = rows.filter(r => r.game && !/^IL/.test(r.slot || "") && !/^(O|INJ|D)$/.test(r.status || "")).map(r => {
    const n = E.normName(r.name); return roster.find(p => E.normName(p.name) === n);
  }).filter(p => p && !(p.ret && d < p.ret));
  (extra || []).forEach(x => { if (GD[x.nba] && GD[x.nba].has(d) && !(x.ret && d < x.ret)) ps.push(x); });
  return ps.sort((a, b) => b.gv - a.gv).slice(0, 10);
}
function weekDays() {
  // Kalan gunler: Yahoo gunluk kadro verisinin ilk gunu (ABD'de "bugun", maclari henuz oynanmamis) ile o haftanin Pazar'i arasi
  const all = Object.keys(SR.days).sort(); const first = all[0];
  let end = first; while (new Date(end + "T12:00:00Z").getUTCDay() !== 0) end = E.isoAdd(end, 1);
  return all.filter(d => d <= end);
}
function thisWeek(team, opp, extra) {
  const ks = weekKeys(), W = DATA.weeks[ks[ks.length - 1]];
  const days = weekDays();
  const C = ["fgm", "fga", "ftm", "fta", "tpm", "pts", "reb", "ast", "st", "blk", "to"];
  const side = t => { const m = {}, v = {}; C.forEach(k => { m[k] = 0; v[k] = 0; }); const per = [];
    days.forEach(d => { const ps = dayPlayers(t, d, t === team ? extra : null); per.push(ps.length); ps.forEach(p => C.forEach(k => { m[k] += p.pg[k]; v[k] += Math.max(p.pg[k], .3); })); });
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
function winHero(w, cls, gain, lgGain) {
  const cell = (lbl, b, a, g) => { const d = Math.round((a - b) * 100);
    const dc = cls === "neu" ? (d > 0 ? "cu" : d < 0 ? "cd" : "") : "";
    return `<div><div class="l">${lbl}</div><div class="n ${dc}">${d > 0 ? "+" : d < 0 ? "−" : "±"}%${Math.abs(d)}</div><div class="l">${Math.round(b * 100)}% → ${Math.round(a * 100)}% · ${sgn(g)} kat.</div></div>`; };
  return `<div class="sm" style="margin:2px 0 4px">Haftalık eşleşmeyi kazanma olasılığı (sezonun kalanı)</div><div class="hero ${cls}">${cell("İlk 4'e karşı", w.b.top, w.a.top, gain)}${cell("Lig geneli", w.b.all, w.a.all, lgGain)}</div>`;
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
${winHero(x.win, cls, x.gain, x.lgGain)}
${hard.concat(soft).map(w => `<p class="warnl${w.hard ? "" : " s"}">${w.hard ? "⚠ " : ""}${esc(w.t)}</p>`).join("")}
${catBox("Kategori etkisi · ilk 4'e karşı kazanma %", x.topBefore, x.top, punt)}
<div class="hrl"></div>
<div class="secl">Oyuncular · bu sezon maç başı</div>
<div class="pcs"><div>${pCards(x.give, x.get, "g")}</div><div>${pCards(x.get, x.give, "r")}</div></div>
<div class="rfoot"><span>Draft $ ${x.gPrice} ↔ ${x.rPrice}</span><span>Değer: sen ${val >= 0 ? "+" : "−"}${Math.abs(val).toFixed(1)} · ${esc(x.partner)} ${-val >= 0 ? "+" : "−"}${Math.abs(val).toFixed(1)}</span></div>
${drops.length ? `<div class="sm" style="margin-top:4px">${drops.join(" · ")}</div>` : ""}
<div class="psep">Karşı taraf</div>
<div class="rhd"><span class="rttl">${esc(x.partner)} tarafı</span></div>
${winHero(pg.win, "neu", pg.gain, pg.lgGain)}
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

// ---------- FIRSATLAR ----------
const BOXMAP = { NY: "NYK", GS: "GSW", UTAH: "UTA", WSH: "WAS", NO: "NOP", SA: "SAS", PHO: "PHX" };
const KS = ["fgp", "ftp", "tpm", "pts", "reb", "ast", "st", "blk", "to"];
const PERS = [["bu", "Bu sezon"], ["s14", "Son 14 gün"], ["s7", "Son 7 gün"], ["gec", "Geçen sezon"], ["proj", "Projeksiyon"]];
const GUNK = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
let foTab = ["pl", "gen", "inj", "fit"].includes(Q.get("f")) ? Q.get("f") : "gen";
const FL = { q: "", nba: "", own: "FA", pos: "", per: "s14", sort: "val", g: 0, cats: new Set(), healthy: true, up: false, min20: false };
let OPP = null; const FIT = {};
function loadOpp(get, start) {
  const ds = [1, 2, 3, 4].map(i => E.isoAdd(start, -i));
  Promise.all([get("players/son7_ort.json").catch(() => null)].concat(ds.map(d => get("boxscores/" + d + ".json").catch(() => null))))
    .then(([s7, ...bx]) => { RAW.son7 = s7; RAW.box = bx.map((b, i) => b ? { d: ds[i], b } : null).filter(Boolean).reverse(); OPP = null; if (view === "fo") renderOpp(); });
}
const num = x => { const v = parseFloat(String(x).replace(/,/g, "")); return isFinite(v) ? v : NaN; };
const mins = x => { const m = String(x || "").match(/^(\d+):(\d+)/); return m ? +m[1] + (+m[2]) / 60 : NaN; };
function rowStats(r, totals) {
  if (!r) return null; const gp = num(r["GP*"]); if (!(gp > 0)) return null;
  const fg = String(r["FGM / A*"] || "").split("/").map(num), ft = String(r["FTM / A*"] || "").split("/").map(num), k = totals ? 1 / gp : 1;
  const s = { gp, mpg: mins(r.MPG), fgm: fg[0] * k, fga: fg[1] * k, ftm: ft[0] * k, fta: ft[1] * k, tpm: num(r["3PTM"]) * k, pts: num(r.PTS) * k,
    reb: num(r.REB) * k, ast: num(r.AST) * k, st: num(r.ST) * k, blk: num(r.BLK) * k, to: num(r.TO) * k };
  s.fgp = s.fga > 0 ? s.fgm / s.fga : NaN; s.ftp = s.fta > 0 ? s.ftm / s.fta : NaN; return s;
}
function boxStats(q) {
  const fg = String(q.fg || "0-0").split("-").map(Number), ft = String(q.ft || "0-0").split("-").map(Number), n = x => +x || 0;
  return { mpg: n(q.min), fgm: fg[0], fga: fg[1], ftm: ft[0], fta: ft[1], tpm: n(q["3pm"]), pts: n(q.pts), reb: n(q.reb), ast: n(q.ast), st: n(q.stl), blk: n(q.blk), to: n(q.to),
    fgp: fg[1] ? fg[0] / fg[1] : NaN, ftp: ft[1] ? ft[0] / ft[1] : NaN };
}
function avgStats(arr) {
  if (!arr.length) return null; const o = {}; ["mpg", "fgm", "fga", "ftm", "fta", "tpm", "pts", "reb", "ast", "st", "blk", "to"].forEach(k => o[k] = arr.reduce((a, s) => a + s[k], 0) / arr.length);
  o.fgp = o.fga ? o.fgm / o.fga : NaN; o.ftp = o.fta ? o.ftm / o.fta : NaN; o.gp = arr.length; return o;
}
// kategori z-skorlari (yuzde kategoriler hacim agirlikli); asist her zaman ayri tutulur
function zRef(list) {
  const pool = list.filter(s => s && s.mpg >= 15); const R = {};
  const mfg = pool.reduce((a, s) => a + s.fgm, 0) / Math.max(1, pool.reduce((a, s) => a + s.fga, 0));
  const mft = pool.reduce((a, s) => a + s.ftm, 0) / Math.max(1, pool.reduce((a, s) => a + s.fta, 0));
  const f = { fgp: s => s.fgm - mfg * s.fga, ftp: s => s.ftm - mft * s.fta, tpm: s => s.tpm, pts: s => s.pts, reb: s => s.reb, ast: s => s.ast, st: s => s.st, blk: s => s.blk, to: s => -s.to };
  KS.forEach(k => { const v = pool.map(f[k]); const m = v.reduce((a, b) => a + b, 0) / (v.length || 1); const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length || 1)) || 1; R[k] = { f: f[k], m, sd }; });
  return R;
}
const zc = (s, R, k) => s ? (R[k].f(s) - R[k].m) / R[k].sd : NaN;
function zval(s, R, punt) { if (!s) return -99; return KS.reduce((a, k) => a + (k in punt ? 0 : (zc(s, R, k) || 0)), 0); }
function buildOpp() {
  const idx = f => { const m = {}; ((RAW[f] || {}).players || []).forEach(r => m[r.id] = r); return m; };
  const src = { bu: idx("bu"), s14: idx("son14"), s7: idx("son7"), gec: idx("gecen"), proj: idx("proj") };
  const box = {};
  RAW.box.forEach(({ d, b }) => Object.values(b.games || {}).forEach(g => (g.players || []).forEach(q => {
    if (!("min" in q)) return; const n = E.normName(q.n); (box[n] = box[n] || []).push({ d, st5: !!q.st, s: boxStats(q) }); })));
  const inj = {}; ((RAW.injuries || {}).injuries || []).forEach(x => inj[E.normName(x.name)] = x);
  const wk = weekDays(); let mon = wk[0]; while (new Date(mon + "T12:00:00Z").getUTCDay() !== 1) mon = E.isoAdd(mon, -1);
  const allWeek = [0, 1, 2, 3, 4, 5, 6].map(i => E.isoAdd(mon, i));
  const list = Object.values(src.bu).map(r => {
    const n = E.normName(r.name), own = r["Roster Status"] || "FA", fa = own === "FA" || /^W/.test(own);
    const per = {}; Object.keys(src).forEach(k => per[k] = rowStats(src[k][r.id], k === "proj"));
    const ij = inj[n] || null, out = !!(ij && /^out/i.test(ij.status)) || /^(O|INJ)$/.test(r.status || "");
    const P = L.P[r.id] || null;
    return { id: r.id, name: r.name, nba: r.nba, pos: r.pos || "", own: fa ? "FA" : own, waiver: /^W/.test(own) ? own : "", fa, status: r.status || "", per, bx: (box[n] || []).slice(-5), inj: ij, out,
      ret: out && ij && ij.return ? ij.return : null, pg: P && P.pg, nameN: n,
      days: allWeek.map(d => !!(GD[r.nba] && GD[r.nba].has(d))), left: wk.filter(d => GD[r.nba] && GD[r.nba].has(d)).length, wkn: allWeek.filter(d => GD[r.nba] && GD[r.nba].has(d)).length };
  });
  const REF = {}; PERS.forEach(([k]) => REF[k] = zRef(list.map(p => p.per[k])));
  list.forEach(p => { p.last2 = avgStats(p.bx.slice(-2).map(b => b.s)); p.lastMin = p.bx.length ? p.bx[p.bx.length - 1].s.mpg : NaN;
    const base = p.per.bu ? p.per.bu.mpg : NaN; p.trend = p.last2 && isFinite(base) ? p.last2.mpg - base : (p.last2 ? p.last2.mpg : NaN); });
  OPP = { list, allWeek, wk, REF };
}
const short = n => { const w = String(n).split(" "); return w.length > 1 ? w[0][0] + ". " + w.slice(1).join(" ") : n; };
function wkStrip(p, light) {
  return `<div class="fwk">${OPP.allWeek.map((d, i) => { const g = p.days[i], past = !OPP.wk.includes(d);
    return `<span class="${g ? (light && light.has(d) && !past ? "gl" : "g") : ""}${past ? " past" : ""}">${GUNK[i]}</span>`; }).join("")}</div>`;
}
function statRow(s) {
  const v = (k) => !s ? "–" : (k === "fgp" || k === "ftp") ? f3(s[k]) : f1(s[k]);
  return `<div class="fst">${KS.map(k => `<span><span class="k">${LBL[k]}</span><span class="n">${v(k)}</span></span>`).join("")}</div>`;
}
const boxLine = b => `${Math.round(b.s.mpg)} dk ${b.s.pts}p ${b.s.reb}r${b.s.tpm ? " " + b.s.tpm + "x3" : ""}${b.s.st ? " " + b.s.st + "st" : ""}${b.s.blk ? " " + b.s.blk + "b" : ""}${b.st5 ? " (ilk 5)" : ""}`;
function fcard(p, right, ctx, light) {
  const s = p.per.bu;
  return `<div class="fc" data-pid="${p.id}"><div class="ftop"><span class="fnm">${esc(p.name)} <small>${esc(p.nba)} · ${esc(p.pos)}${p.fa ? "" : " · " + esc(p.own)}${p.waiver ? " · waiver" : ""}${p.status ? " · " + esc(p.status) : ""}</small></span>${right || ""}</div>
${wkStrip(p, light)}${statRow(s)}<div class="fln">${s ? "Bu sezon " + s.gp + " maç, " + Math.round(s.mpg || 0) + " dk" : "Bu sezon maç yok"}${p.bx.length ? " · Son: " + p.bx.slice(-2).map(boxLine).join(" · ") : ""}${ctx ? " · " + ctx : ""}</div></div>`;
}
// takim arkadasi sakatliklari (son 3 gun, MPG >= 18)
function recentInjuries() {
  const now = Date.now(), byName = {}; OPP.list.forEach(p => byName[p.nameN] = p);
  return ((RAW.injuries || {}).injuries || []).filter(x => /^out|day/i.test(x.status) && x.date && now - Date.parse(x.date) < 3.5 * 864e5)
    .map(x => ({ x, p: byName[E.normName(x.name)] })).filter(o => o.p && o.p.per.bu && o.p.per.bu.mpg >= 18 && /^out/i.test(o.x.status))
    .sort((a, b) => b.p.per.bu.mpg - a.p.per.bu.mpg);
}
function teamInjCtx(p, inj) { const o = inj.filter(i => i.p.nba === p.nba && i.p.id !== p.id); return o.length ? o.slice(0, 2).map(i => short(i.p.name) + " yok").join(", ") : ""; }
function renderOpp() {
  if (!RAW || !RAW.box) return; if (!OPP) buildOpp();
  $("fo-out").onclick = e => { const c = e.target.closest(".fc[data-pid]"); if (c) openPlayer(+c.dataset.pid); };
  [...$("fo-sub").children].forEach(b => { b.classList.toggle("on", b.dataset.f === foTab); b.onclick = () => { foTab = b.dataset.f; setQ({ f: foTab }); renderOpp(); }; });
  const box = $("fo-out"), inj = recentInjuries(), R = OPP.REF;
  const pool = OPP.list.filter(p => p.fa && !p.out);
  if (foTab === "gen") {
    const L2 = pool.filter(p => p.last2 && p.lastMin >= 16).map(p => ({ p, sc: zval(p.last2, R.bu, { ast: 1 }) + 0.12 * Math.max(0, p.trend || 0) })).sort((a, b) => b.sc - a.sc).slice(0, 15);
    box.innerHTML = `<p class="note">Bostaki en formda oyuncular: son 2 maçın değeri (asist hariç) ve dakika artışı. Takvimde yeşil: bu hafta maçı olan günler.</p>` +
      (L2.map(({ p }) => fcard(p, `<span class="fr ${p.trend >= 4 ? "cu" : ""}">${p.trend >= 4 ? "↑ " : ""}${Math.round(p.last2.mpg)} dk</span>`, teamInjCtx(p, inj))).join("") || `<p class="note">Son maçlarda öne çıkan serbest oyuncu yok.</p>`);
  } else if (foTab === "inj") {
    const blocks = inj.map(({ x, p }) => {
      const mates = pool.filter(q => q.nba === p.nba && q.id !== p.id && (q.lastMin >= 12 || (q.per.bu && q.per.bu.mpg >= 12)))
        .sort((a, b) => (b.lastMin || 0) - (a.lastMin || 0)).slice(0, 3);
      if (!mates.length) return "";
      const rt = x.return ? (+x.return.slice(8)) + "." + (+x.return.slice(5, 7)) : "?";
      return `<div class="finj"><div class="fih">${esc(p.name)} · ${esc(p.nba)} <small>${esc(p.fa ? "FA" : p.own)}</small></div><div class="sm">${esc(x.type || "")} · ${esc(x.status)} · tahmini dönüş ${rt} · sezon ${Math.round(p.per.bu.mpg)} dk</div></div>` +
        mates.map(q => fcard(q, `<span class="fr">${isFinite(q.lastMin) ? Math.round(q.lastMin) + " dk" : ""}</span>`, "")).join("");
    }).filter(Boolean);
    box.innerHTML = `<p class="note">Son 3 günde sakatlanan rotasyon oyuncuları (sezonda 18+ dk) ve takımında dakika alabilecek serbest oyuncular.</p>` + (blocks.join("") || `<p class="note">Son 3 günde yerden fırsat yaratan sakatlık yok.</p>`);
  } else if (foTab === "fit") renderFit(box, pool, inj);
  else renderPlayers(box);
}
function renderFit(box, pool, inj) {
  if (!DATA || !SR) { box.innerHTML = `<p class="note">Haftalık veri yükleniyor…</p>`; return; }
  const ks = weekKeys(), W = DATA.weeks[ks[ks.length - 1]]; const pr = (W.pairs || []).find(x => x.includes(cur)); if (!pr) { box.innerHTML = `<p class="note">Bu hafta eşleşme bulunamadı.</p>`; return; }
  const opp = pr.find(t => t !== cur), punt = (E.STRAT[cur] || {}).punt || {};
  const key = cur + "|" + W.updated;
  if (!FIT[key]) {
    const exP = r => CATS.reduce((a, k) => a + (k in punt ? 0 : r.p[k]), 0);
    const base = thisWeek(cur, opp), b0 = exP(base);
    const cand = pool.filter(p => p.pg && p.left > 0 && ((p.lastMin >= 15) || (p.per.bu && p.per.bu.mpg >= 18)));
    const rows = cand.map(p => { const r = thisWeek(cur, opp, [{ id: p.id, name: p.name, nba: p.nba, pg: p.pg, gv: -50, ret: p.ret }]); return { p, d: exP(r) - b0 }; })
      .sort((a, b) => b.d - a.d).slice(0, 15);
    const light = new Set(base.days.filter((d, i) => base.perA[i] < 8));
    FIT[key] = { rows, opp, b0, wp: base.wp, light };
  }
  const F = FIT[key];
  box.innerHTML = `<p class="note">${esc(SHORT[cur] || cur)} · bu haftaki rakip <b>${esc(F.opp)}</b>. Sağdaki sayı: oyuncu kalan maçlarında kadroya eklenirse haftada kazanılan ek kategori (punt hariç). Koyu yeşil: maç var ve o gün kadronda boş yer çok.</p>` +
    F.rows.map(({ p, d }) => fcard(p, `<span class="fr ${d >= .15 ? "cu" : d < 0 ? "cd" : ""}">${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(2).replace(".", ",")} kat.</span>`, teamInjCtx(p, inj), F.light)).join("");
}
function renderPlayers(box) {
  const R = OPP.REF[FL.per], teams = [...new Set(OPP.list.map(p => p.nba))].sort(), owners = [...new Set(OPP.list.filter(p => !p.fa).map(p => p.own))].sort((a, b) => a.localeCompare(b, "tr"));
  const sel = (id, val, opts) => `<select id="${id}">${opts.map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(val) ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
  const chip = (k, t, on) => `<button class="fch${on ? " on" : ""}" data-c="${k}">${t}</button>`;
  let L1 = OPP.list.filter(p => {
    if (FL.q && !p.nameN.includes(E.normName(FL.q))) return false;
    if (FL.nba && p.nba !== FL.nba) return false;
    if (FL.own === "FA" && !p.fa) return false; if (FL.own && FL.own !== "FA" && p.own !== FL.own) return false;
    if (FL.pos && !p.pos.split(",").includes(FL.pos)) return false;
    if (FL.g && p.wkn < FL.g) return false;
    if (FL.healthy && p.out) return false;
    const s = p.per[FL.per]; if (!s) return false;
    if (FL.min20 && !(s.mpg >= 20)) return false;
    if (FL.up && !(p.trend >= 4)) return false;
    for (const k of FL.cats) if (!(zc(s, R, k) > 0.4)) return false;
    return true;
  });
  const key = p => FL.sort === "val" ? zval(p.per[FL.per], R, { ast: 1 }) : FL.sort === "fgp" || FL.sort === "ftp" ? zc(p.per[FL.per], R, FL.sort) : FL.sort === "to" ? -p.per[FL.per].to : p.per[FL.per][FL.sort];
  L1.sort((a, b) => (key(b) || -99) - (key(a) || -99)); const n = L1.length; L1 = L1.slice(0, 60);
  const v = (s, k) => (k === "fgp" || k === "ftp") ? f3(s[k]) : f1(s[k]);
  box.innerHTML = `<input id="fq" type="search" placeholder="Oyuncu ara" value="${esc(FL.q)}" class="fsrch">
<div class="fgr">
<label>NBA takımı ${sel("f-nba", FL.nba, [["", "Tümü"]].concat(teams.map(t => [t, t])))}</label>
<label>Fantezi takımı ${sel("f-own", FL.own, [["", "Tümü"], ["FA", "Boşta (FA)"]].concat(owners.map(t => [t, t])))}</label>
<label>Pozisyon ${sel("f-pos", FL.pos, [["", "Tümü"], ["PG", "PG"], ["SG", "SG"], ["SF", "SF"], ["PF", "PF"], ["C", "C"]])}</label>
<label>Dönem ${sel("f-per", FL.per, PERS)}</label>
<label>Sırala ${sel("f-sort", FL.sort, [["val", "Değer (asist hariç)"], ["pts", "PTS"], ["reb", "REB"], ["tpm", "3PM"], ["st", "ST"], ["blk", "BLK"], ["fgp", "FG%"], ["ftp", "FT%"], ["to", "Düşük TO"], ["ast", "AST"]])}</label>
<label>Bu hafta maç ${sel("f-g", FL.g, [[0, "Hepsi"], [2, "2+"], [3, "3+"], [4, "4"]])}</label></div>
<div class="sm">Kategori filtresi (seçilenlerde lig ortalamasının üstü)</div>
<div class="fchips">${["fgp", "ftp", "tpm", "pts", "reb", "st", "blk", "to"].map(k => chip(k, k === "to" ? "Düşük TO" : LBL[k], FL.cats.has(k))).join("")}</div>
<div class="fchips">${chip("healthy", "Sağlıklı", FL.healthy)}${chip("up", "Dakika ↑", FL.up)}${chip("min20", "Min. 20 dk", FL.min20)}</div>
<p class="sm">${n} oyuncu${n > 60 ? " (ilk 60)" : ""} · oyuncuya dokununca detay penceresi açılır</p>
<div class="tw"><table class="small fpt"><thead><tr><th>Oyuncu</th>${KS.map(k => `<th>${LBL[k]}</th>`).join("")}</tr></thead><tbody>${L1.map(p => { const s = p.per[FL.per];
    return `<tr data-id="${p.id}"><td><b>${esc(short(p.name))}</b><div class="sm">${esc(p.nba)} · ${esc(p.pos)} · <span class="${p.fa ? "cu" : ""}">${esc(p.fa ? "FA" : p.own)}</span> · ${p.wkn}</div></td>${KS.map(k => `<td class="${FL.cats.has(k) ? "hl" : ""}">${v(s, k)}</td>`).join("")}</tr>` +
""; }).join("")}</tbody></table></div>`;
  const re = () => renderPlayers(box);
  $("fq").oninput = e => { FL.q = e.target.value; const pos = e.target.selectionStart; re(); const q = $("fq"); q.focus(); q.setSelectionRange(pos, pos); };
  [["f-nba", "nba"], ["f-own", "own"], ["f-pos", "pos"], ["f-per", "per"], ["f-sort", "sort"], ["f-g", "g"]].forEach(([id, k]) => $(id).onchange = e => { FL[k] = k === "g" ? +e.target.value : e.target.value; re(); });
  box.querySelectorAll(".fch").forEach(b => b.onclick = () => { const c = b.dataset.c; if (["healthy", "up", "min20"].includes(c)) FL[c] = !FL[c]; else FL.cats.has(c) ? FL.cats.delete(c) : FL.cats.add(c); re(); });
  box.querySelectorAll("tr[data-id]").forEach(tr => tr.onclick = () => openPlayer(+tr.dataset.id));
}

// ---------- OYUNCU PENCERESI ----------
let PM = null, PMtab = "g", GL = null, GLI = null, DRAFT = null, TX = null;
const getX = f => fetch("../" + f + "?h=" + Math.floor(Date.now() / 36e5)).then(r => r.ok ? r.json() : null).catch(() => null);
function openPlayer(id) {
  if (!OPP) return; const p = OPP.list.find(x => x.id === id); if (!p) return;
  PM = p; PMtab = "g"; $("pm").hidden = false; document.body.style.overflow = "hidden";
  if (!history.state || !history.state.pm) history.pushState({ pm: 1 }, "");
  renderPM();
  if (!GL || GL.miss) Promise.all([getX("gamelog.json"), getX("draft.json"), getX("transactions.json")]).then(([g, d, t]) => {
    GL = g || { p: {}, miss: 1 }; GLI = {}; Object.keys(GL.p).forEach(k => GLI[E.normName(k)] = GL.p[k]);
    DRAFT = {}; (d || []).forEach(x => DRAFT[x.id] = x); TX = t || []; if (PM) renderPM(); });
}
function closePM() { PM = null; $("pm").hidden = true; document.body.style.overflow = ""; }
window.addEventListener("popstate", () => { if (PM) closePM(); });
const ddmm = d => (+d.slice(8)) + "." + (+d.slice(5, 7));
function glStats(r) { return { mpg: r[4], pts: r[5], reb: r[6], ast: r[7], st: r[8], blk: r[9], to: r[10], tpm: r[11], fgm: r[12], fga: r[13], ftm: r[14], fta: r[15], fgp: r[13] ? r[12] / r[13] : NaN, ftp: r[15] ? r[14] / r[15] : NaN }; }
function pmGames(p) { return ((GLI || {})[p.nameN] || []).slice().reverse(); }
function renderPM() {
  const p = PM; if (!p) return; const dr = DRAFT && DRAFT[p.id];
  const price = dr ? "$" + dr.cost : DRAFT ? "draft dışı" : "";
  $("pm-h").innerHTML = `<div class="pmn">${esc(p.name)}</div><div class="sm">${esc(p.nba)} · ${esc(p.pos)} · <span class="${p.fa ? "cu" : ""}">${esc(p.fa ? (p.waiver ? "Waiver" : "Boşta (FA)") : p.own)}</span>${price ? " · " + price : ""}${p.status ? ` · <span class="cd">${esc(p.status)}</span>` : ""}</div>`;
  [...$("pm-sub").children].forEach(b => { b.classList.toggle("on", b.dataset.t === PMtab); b.onclick = () => { PMtab = b.dataset.t; renderPM(); }; });
  const box = $("pm-out"); box.scrollTop = 0;
  if (!GL) { box.innerHTML = `<p class="note">Maç kayıtları yükleniyor…</p>`; return; }
  box.innerHTML = PMtab === "g" ? pmLog(p) : pmSum(p);
}
function pmLog(p) {
  const gs = pmGames(p), played = gs.filter(r => r.length > 5).map(glStats);
  if (GL.miss) return `<p class="note">Maç kayıtları (gamelog.json) şu an yüklenemedi. Pencereyi kapatıp tekrar açınca yeniden denenir.</p>`;
  if (!gs.length) return `<p class="note">Bu oyuncu için kayıtlı maç yok.</p>`;
  const fgc = s => s.fga >= 5 ? (s.fgp >= .55 ? "cu" : s.fgp < .4 ? "cd" : "") : "", ftc = s => s.fta >= 3 ? (s.ftp >= .85 ? "cu" : s.ftp < .65 ? "cd" : "") : "";
  const avgRow = (lbl, arr) => { const a = avgStats(arr); return a ? `<tr class="pavg"><td colspan="2">${lbl}</td><td>${Math.round(a.mpg)}</td><td>${f3(a.fgp)}</td><td>${f3(a.ftp)}</td>${["tpm", "pts", "reb", "st", "blk", "to", "ast"].map(k => `<td>${f1(a[k])}</td>`).join("")}</tr>` : ""; };
  const first = gl => (GL.dates || [])[0];
  return `<p class="sm">${played.length} maç oynadı${gs.length > played.length ? ", " + (gs.length - played.length) + " maçta yok" : ""} · kayıtlar ${ddmm(first() || gs[gs.length - 1][0])} tarihinden beri · ● ilk 5 · FG/FT yeşil iyi, kırmızı kötü</p>
<div class="tw"><table class="small plog"><thead><tr><th>Tarih</th><th>Rakip</th><th>DK</th><th>FG</th><th>FT</th><th>3P</th><th>PTS</th><th>REB</th><th>ST</th><th>BLK</th><th>TO</th><th>AST</th></tr></thead><tbody>
${avgRow("Son 5 ort.", played.slice(0, 5))}${played.length > 5 ? avgRow("Tümü ort.", played) : ""}
${gs.map(r => { if (r.length <= 5) return `<tr class="dnp"><td>${ddmm(r[0])}</td><td>${esc(r[2])}</td><td colspan="10">Oynamadı · ${esc(String(r[4]).toLowerCase())}</td></tr>`;
    const s = glStats(r); return `<tr><td>${ddmm(r[0])}${r[3] ? " ●" : ""}</td><td>${esc(r[2])}</td><td>${s.mpg}</td><td class="${fgc(s)}">${s.fgm}-${s.fga}</td><td class="${ftc(s)}">${s.ftm}-${s.fta}</td><td>${s.tpm}</td><td>${s.pts}</td><td>${s.reb}</td><td>${s.st}</td><td>${s.blk}</td><td>${s.to}</td><td class="mut">${s.ast}</td></tr>`; }).join("")}
</tbody></table></div>`;
}
function pmSum(p) {
  const R = OPP.REF.bu, s = p.per.bu, gs = pmGames(p), played = gs.filter(r => r.length > 5).map(glStats);
  const l3 = avgStats(played.slice(0, 3)), punt = (E.STRAT[cur] || {}).punt || { ast: 1 };
  const out = [];
  // durum
  const ij = p.inj, raw = ((RAW.bu || {}).players || []).find(r => r.id === p.id) || {};
  out.push(`<h4>Durum</h4><div class="pgrid">
<div><span>Sahibi</span><b>${esc(p.fa ? (p.waiver ? "Waiver" : "Boşta") : p.own)}</b></div>
<div><span>Draft</span><b>${DRAFT && DRAFT[p.id] ? "$" + DRAFT[p.id].cost : "–"}</b></div>
<div><span>Sahiplik</span><b>${esc(raw["% Ros"] || "–")}</b></div>
<div><span>Bu hafta</span><b>${p.left} maç kaldı</b></div></div>
${ij ? `<div class="pinj"><b>${esc(ij.status)}</b> · ${esc(ij.type || "")}${ij.return ? " · tahmini dönüş " + ddmm(ij.return) : ""}<div class="sm">${esc(ij.note || "")}</div></div>` : ""}${wkStrip(p)}`);
  out.push(`<h4>Bu sezon ortalaması</h4><div class="psea">${s ? `<div class="sm">${s.gp} maç · ${Math.round(s.mpg || 0)} dk</div>` + statRow(s) : `<p class="note">Bu sezon maç yok.</p>`}</div>`);
  // donemler
  const rows = [["Son 3 maç", l3]].concat(PERS.map(([k, t]) => [t, p.per[k]]));
  const better = (k, a, b) => k === "to" ? a < b : a > b, thr = { fgp: .02, ftp: .03, mpg: 2, tpm: .3, pts: 2, reb: 1, ast: 1, st: .2, blk: .2, to: .3 };
  out.push(`<h4>Dönem karşılaştırması</h4><p class="sm">Renkler bu sezona göre: yeşil daha iyi, kırmızı daha kötü.</p><div class="tw"><table class="small plog"><thead><tr><th></th><th>DK</th>${KS.map(k => `<th>${LBL[k]}</th>`).join("")}</tr></thead><tbody>
${rows.map(([t, x]) => `<tr><td><b>${t}</b></td>${["mpg"].concat(KS).map(k => { if (!x || !isFinite(x[k])) return "<td>–</td>"; const v = k === "fgp" || k === "ftp" ? f3(x[k]) : k === "mpg" ? Math.round(x[k]) : f1(x[k]);
    const c = t === "Bu sezon" || !s || !isFinite(s[k]) || k === "ast" ? "" : Math.abs(x[k] - s[k]) < thr[k] ? "" : better(k, x[k], s[k]) ? "cu" : "cd"; return `<td class="${c}">${v}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div>`);
  // kategori profili
  if (s) {
    const z = {}; KS.forEach(k => z[k] = zc(s, R, k));
    const all = OPP.list.filter(q => q.per.bu && q.per.bu.mpg >= 10).map(q => zval(q.per.bu, R, { ast: 1 })).sort((a, b) => b - a), my = zval(s, R, { ast: 1 }), rank = all.filter(v => v > my).length + 1;
    out.push(`<h4>Kategori profili (bu sezon)</h4><p class="sm">Asist hariç değer sıralaması: <b>${rank}.</b> / ${all.length} oyuncu (10+ dk). Çubuk: lig ortalamasına göre.</p>
<div class="pbars">${KS.map(k => { const v = Math.max(-2.5, Math.min(2.5, z[k] || 0)), w = Math.abs(v) / 2.5 * 50;
      return `<div class="pbar${k in punt ? " pun" : ""}"><span>${LBL[k]}</span><div class="pt"><i class="${v >= 0 ? "pos" : "neg"}" style="${v >= 0 ? "left:50%" : "right:50%"};width:${w}%"></i></div><em>${(z[k] >= 0 ? "+" : "") + (z[k] || 0).toFixed(1)}</em></div>`; }).join("")}</div>`);
  }
  // oneriler
  const tips = [], zs = s ? KS.filter(k => !(k in punt)).map(k => [k, zc(s, R, k)]) : [];
  const good = zs.filter(x => x[1] >= .7).sort((a, b) => b[1] - a[1]).map(x => LBL[x[0]]), bad = zs.filter(x => x[1] <= -.7).sort((a, b) => a[1] - b[1]).map(x => LBL[x[0]]);
  if (good.length) tips.push(`Güçlü olduğu kategoriler: <b>${good.join(", ")}</b>${bad.length ? ` · zayıf: <b class="cd">${bad.join(", ")}</b>` : ""}.`);
  else if (bad.length) tips.push(`Belirgin güçlü kategorisi yok; zayıf: <b class="cd">${bad.join(", ")}</b>.`);
  if (s && l3 && l3.mpg - s.mpg >= 4) tips.push(`Dakikası artıyor: son 3 maçta ${Math.round(l3.mpg)} dk, sezonda ${Math.round(s.mpg)} dk.`);
  if (s && l3 && s.mpg - l3.mpg >= 4) tips.push(`Dakikası düşüyor: son 3 maçta ${Math.round(l3.mpg)} dk, sezonda ${Math.round(s.mpg)} dk.`);
  const st5 = played.slice(0, 5).length ? gs.filter(r => r.length > 5).slice(0, 5).filter(r => r[3]).length : 0;
  if (played.length >= 3) tips.push(st5 ? `Son ${Math.min(5, played.length)} maçta ${st5} kez ilk 5'te başladı.` : `Son ${Math.min(5, played.length)} maçta hep yedekten girdi.`);
  const mates = ((RAW.injuries || {}).injuries || []).map(x => ({ x, q: OPP.list.find(q => q.nameN === E.normName(x.name)) }))
    .filter(o => o.q && o.q.nba === p.nba && o.q.id !== p.id && /^out/i.test(o.x.status) && o.q.per.bu && o.q.per.bu.mpg >= 20);
  if (mates.length) tips.push(`Takımda eksik: ${mates.map(o => `${esc(short(o.q.name))} (${o.x.return ? "dönüş " + ddmm(o.x.return) : "dönüş belirsiz"})`).join(", ")}.${l3 && s && l3.mpg - s.mpg >= 4 ? " Artan dakikası bu eksiklere bağlı olabilir; dönüşlerinde rolü küçülebilir." : ""}`);
  if (p.left >= 3) tips.push(`Bu hafta ${p.left} maçı kaldı; stream için takvimi uygun.`); else if (p.left <= 1) tips.push(`Bu hafta en fazla ${p.left} maçı kaldı.`);
  if (p.ret) tips.push(`Sakat; tahmini dönüş ${ddmm(p.ret)}. Dönüşe yakın ucuza alınabilir.`);
  const dr = DRAFT && DRAFT[p.id];
  if (s && dr && dr.cost <= 10 && zval(s, R, { ast: 1 }) > 3) tips.push(`Draft fiyatı ($${dr.cost}) üretimine göre düşük; takas hedefi olabilir.`);
  if (s && dr && dr.cost >= 30 && zval(s, R, { ast: 1 }) < 0) tips.push(`Draft fiyatına ($${dr.cost}) göre beklentinin altında üretiyor.`);
  if (p.fa && p.pg && DATA && SR && !p.out) {
    const ks = weekKeys(), W = DATA.weeks[ks[ks.length - 1]], pr = (W.pairs || []).find(x => x.includes(cur));
    if (pr) { const opp = pr.find(t => t !== cur), ex = r => CATS.reduce((a, k) => a + (k in punt ? 0 : r.p[k]), 0);
      const d = ex(thisWeek(cur, opp, [{ id: p.id, name: p.name, nba: p.nba, pg: p.pg, gv: -50, ret: p.ret }])) - ex(thisWeek(cur, opp));
      tips.push(`${esc(SHORT[cur] || cur)} için bu hafta (${esc(opp)} maçı): <b class="${d >= .15 ? "cu" : ""}">${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(2).replace(".", ",")} kategori</b> ekler.`); }
  }
  out.push(`<h4>Değerlendirme</h4><ul class="ptips">${tips.map(t => `<li>${t}</li>`).join("")}</ul>`);
  // islemler
  const sn = short(p.name), tx = (TX || []).filter(t => (t.add || []).includes(sn) || (t.drop || []).includes(sn)).slice(0, 8);
  if (tx.length) out.push(`<h4>Ligdeki işlemler</h4><ul class="ptips">${tx.map(t => `<li>${ddmm(t.time.slice(0, 10))} · ${esc(t.team)} ${(t.add || []).includes(sn) ? "aldı" : "bıraktı"}${t.type === "trade" ? " (takas)" : ""}</li>`).join("")}</ul>`);
  return out.join("");
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
const SUBS = [["h2h", "Eşleşme"], ["all", "Herkese karşı"], ["pow", "Güç"], ["cat", "Kategori"], ["tot", "Toplam"], ["pg", "Maç başı"], ["val", "Değerler"]];
let DEG = null, degM = Q.get("dm") === "tm" ? "tm" : "pl", degT = Q.get("dt") || "", degS = "v";
function loadDeg() {
  if (DEG) return; DEG = 0;
  fetch("degerler.json?v=" + Date.now()).then(r => r.ok ? r.json() : null).then(d => { DEG = d || { players: [] }; if (view === "lg" && lgSub === "val") renderLeague(); })
    .catch(() => { DEG = null; $("lg-out").innerHTML = "<p class='err'>Değerler yüklenemedi. Sayfayı yenile.</p>"; });
}
function renderDeg() {
  const out = $("lg-out");
  if (!DEG) { loadDeg(); out.innerHTML = "<p class='note'>Değerler yükleniyor…</p>"; return; }
  const P = DEG.players, tn = t => t === "FA" ? "FA" : (SHORT[t] || t);
  const dif = p => p.d == null ? null : p.v - p.d;
  const fx = x => x == null ? "<td class='mut'>–</td>" : `<td class="${x > 0 ? "win" : x < 0 ? "loss" : "mut"}">${x > 0 ? "+" : ""}${x}</td>`;
  const T = {}; P.forEach(p => { if (p.t === "FA") return; const o = T[p.t] = T[p.t] || { t: p.t, d: 0, v: 0 }; o.d += p.d || 0; o.v += p.v; });
  const TL = Object.values(T).sort((a, b) => b.v - a.v);
  let h = `<p class="note">Güncel $: sezon öncesi hedef fiyat + 9-kat z-skoru + haftalık kazanma (H2H, punt) karışımı; bu sezonun verisi ağırlığı maç sayısıyla artar. Draft $: lig draft fiyatı (FA = draftta seçilmedi, fark hesaplanmaz). Güncelleme: ${esc(DEG.updated || "")}.</p>
<div class="msel" id="dg-m"><button data-m="pl"${degM === "pl" ? ' class="on"' : ""}>Oyuncular</button><button data-m="tm"${degM === "tm" ? ' class="on"' : ""}>Takımlar</button></div>`;
  if (degM === "tm") {
    h += `<p class="note">Takıma dokun: o takımın oyuncuları açılır. Fark, waiver'dan alınan oyuncuların kazancını da içerir.</p><div class="tw"><table><thead><tr><th>#</th><th class="l">Takım</th><th>Draft $</th><th>Güncel $</th><th>Fark</th></tr></thead><tbody>` +
      TL.map((o, i) => `<tr data-t="${esc(o.t)}" class="${o.t === cur ? "sel" : ""}" style="cursor:pointer"><td>${i + 1}</td><td class="l">${esc(o.t)}</td><td>${o.d}</td><td><b>${o.v}</b></td>${fx(o.v - o.d)}</tr>`).join("") + "</tbody></table></div>";
  } else {
    const opts = [["", "Tüm oyuncular"], ...TL.map(o => [o.t, o.t]), ["FA", "Serbest (FA)"]];
    h += `<div class="pick" style="gap:8px;display:flex"><select id="dg-t" style="flex:1;min-width:0">${opts.map(([k, l]) => `<option value="${esc(k)}"${k === degT ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>
<select id="dg-s" style="flex:1;min-width:0">${[["v", "Güncel değere göre"], ["up", "En çok kazanan"], ["dn", "En çok kaybeden"]].map(([k, l]) => `<option value="${k}"${k === degS ? " selected" : ""}>${l}</option>`).join("")}</select></div>`;
    let L2 = P.filter(p => !degT || p.t === degT);
    if (degS !== "v") L2 = L2.filter(p => p.d != null).sort((a, b) => degS === "up" ? dif(b) - dif(a) : dif(a) - dif(b));
    if (degT && T[degT]) { const o = T[degT]; h += `<div class="kpis" style="margin:8px 0;grid-template-columns:repeat(3,1fr)"><div class="kpi"><span>Draft $</span><b>${o.d}</b></div><div class="kpi"><span>Güncel $</span><b>${o.v}</b></div><div class="kpi"><span>Fark</span><b class="${o.v - o.d >= 0 ? "win" : "loss"}">${o.v - o.d > 0 ? "+" : ""}${o.v - o.d}</b></div></div>`; }
    h += `<div class="tw" style="margin-top:8px"><table class="small"><thead><tr><th>#</th><th class="l">Oyuncu</th>${degT ? "" : "<th>Takım</th>"}<th>Draft $</th><th>Güncel $</th><th>Fark</th></tr></thead><tbody>` +
      L2.map((p, i) => `<tr${p.id ? ` data-pid="${p.id}"` : ""} class="${p.t === cur ? "sel" : ""}" style="cursor:pointer"><td>${i + 1}</td><td class="l" style="white-space:normal">${esc(p.n)}</td>${degT ? "" : `<td class="mut" style="max-width:74px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.68rem;text-align:left">${esc(tn(p.t))}</td>`}<td>${p.d == null ? "FA" : "$" + p.d}</td><td><b>${p.v}</b></td>${fx(dif(p))}</tr>`).join("") + "</tbody></table></div>";
  }
  out.innerHTML = h;
  [...$("dg-m").children].forEach(b => b.onclick = () => { degM = b.dataset.m; setQ({ dm: degM }); renderDeg(); });
  const st = $("dg-t"), ss = $("dg-s");
  if (st) st.onchange = () => { degT = st.value; setQ({ dt: degT }); renderDeg(); };
  if (ss) ss.onchange = () => { degS = ss.value; renderDeg(); };
  out.onclick = e => { const r = e.target.closest("tr[data-t]"); if (r) { degM = "pl"; degT = r.dataset.t; setQ({ dm: degM, dt: degT }); renderDeg(); window.scrollTo(0, 0); return; }
    const p = e.target.closest("tr[data-pid]"); if (p) openPlayer(+p.dataset.pid); };
}
function standings(V) {
  const out = V.map(a => { let cw = 0, cl = 0, ct = 0, beats = 0; V.forEach(b => { if (a === b) return; const r = cmp(a, b); cw += r.w; cl += r.l; ct += r.t; if (r.w > r.l) beats++; }); return { team: a.team, cw, cl, ct, beats }; });
  out.sort((x, y) => (y.beats - x.beats) || ((y.cw + y.ct / 2) - (x.cw + x.ct / 2))); out.forEach((r, i) => r.rank = i + 1); return out;
}
function renderLeague() {
  if (lgSub === "val") { $("lg-wk").hidden = true; $("lg-upd").textContent = ""; chipRow($("lg-sub"), SUBS, lgSub, k => { lgSub = k; setQ({ s: k }); renderLeague(); }); renderDeg(); return; }
  $("lg-wk").hidden = false; $("lg-out").onclick = null;
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
function needsModel(v) { return v === "win" || v === "tr" || v === "ro" || v === "fo"; }
function render() {
  [...$("teams").children].forEach(b => b.classList.toggle("on", b.dataset.t === cur));
  [...$("tabs").children].forEach(b => b.classList.toggle("on", b.dataset.v === view));
  ["win", "tr", "ro", "fo", "st", "lg"].forEach(v => $("v-" + v).hidden = v !== view);
  if (needsModel(view) && !L) return;
  if (view === "win") renderWin(); else if (view === "tr") renderTrades(); else if (view === "ro") renderRoster(); else if (view === "fo") renderOpp(); else if (view === "st") renderStrat(); else renderLeague();
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
      RAW = { bu, gecen, proj, son14, injuries, schedule, son7: null, box: [] };
      Object.entries((schedule && schedule.days) || {}).forEach(([d, gs]) => gs.forEach(g => [g.away, g.home].forEach(t => (GD[t] = GD[t] || new Set()).add(d))));
      const start = SR ? Object.keys(SR.days).sort()[0] : undefined;
      L = new E.League(E.buildPlayers({ bu, gecen, proj, son14 }), rosters, standings, draft, { schedule, injuries, start });
      $("pupd").textContent = "Veri: " + (rosters.updated || ""); render();
      loadOpp(get, start);
    }).catch(e => { $("win-desc").innerHTML = "<span class='err'>Veriler yüklenemedi: " + esc(e.message) + "</span>"; $("tstat").textContent = "Veriler yüklenemedi."; });
  fetch("notes.json" + v).then(r => r.ok ? r.json() : null).then(n => { NOTES = n; if (view === "st") renderStrat(); }).catch(() => {});
}
init();
})();
