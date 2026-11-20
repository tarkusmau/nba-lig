// Ozel panel hesaplama motoru: oyuncu projeksiyonu, kategori kazanma olasiliklari, takas aramasi.
(function (G) {
"use strict";
const CATS = ["fgp", "ftp", "tpm", "pts", "reb", "ast", "st", "blk", "to"];
const LBL = { fgp: "FG%", ftp: "FT%", tpm: "3PM", pts: "PTS", reb: "REB", ast: "AST", st: "ST", blk: "BLK", to: "TO" };
const COUNT = ["fgm", "fga", "ftm", "fta", "tpm", "pts", "reb", "ast", "st", "blk", "to"];
const GAMES_WEEK = 3.5;           // oyuncu basina haftalik ortalama mac
const ACTIVE = 13;                // aktif kadro yeri (IL haric)
const TOP_N = 4;
const MID_TOL = 0.03;
const SEASON_END = "2027-04-04";   // fantezi sezonunun son gunu (22. hafta)
const HEALTHY = 0.92;              // sakatliktan donen oyuncunun oynama orani
const OUT_DEFAULT_DAYS = 7;        // donus tarihi bilinmeyen Out oyuncu
const FILL_RATE = 0.95;            // bos aktif yere bostan alinan oyuncunun oynama orani               // orta seviye kategoride izin verilen en fazla dusus (3 puan)                  // takaslar ve "ilk N" gorunumu: puan durumunda ilk 4 rakip
const STREAM_GAMES = 4.5;         // acik kadro yeri: haftalik 4 add ile stream
const CV = { tpm: .16, pts: .09, reb: .09, ast: .11, st: .17, blk: .2, to: .12 };
const OVERRIDE_AVAIL = { "Anthony Davis": 0.85 };

const STRAT = {
  "tarkus maurelius": { punt: { ast: -0.1 }, label: "AST punt" },
  "Normal MAFIA": { punt: { tpm: 0 }, label: "3PM punt" },
};

// ---------- yardimcilar ----------
const num = v => { if (v == null) return NaN; const x = parseFloat(String(v).replace(/,/g, "")); return isFinite(x) ? x : NaN; };
const normName = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/[^a-z ]/g, "").replace(/\b(jr|sr|ii|iii|iv)\b/g, "").replace(/\s+/g, " ").trim();
const isoAdd = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const pair = v => { const m = String(v || "").replace(/,/g, "").match(/([\d.]+)\s*\/\s*([\d.]+)/); return m ? [+m[1], +m[2]] : [NaN, NaN]; };
function phi(x) { // standart normal CDF
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

// ---------- oyuncu satiri -> mac basi istatistik ----------
function perGame(row, totals) {
  if (!row) return null;
  const gp = num(row["GP*"]);
  if (!(gp > 0)) return null;
  const [fgm, fga] = pair(row["FGM / A*"]); const [ftm, fta] = pair(row["FTM / A*"]);
  const o = { gp, fgm, fga, ftm, fta, tpm: num(row["3PTM"]), pts: num(row["PTS"]), reb: num(row["REB"]),
              ast: num(row["AST"]), st: num(row["ST"]), blk: num(row["BLK"]), to: num(row["TO"]) };
  if (COUNT.some(k => !isFinite(o[k]))) return null;
  if (totals) COUNT.forEach(k => o[k] /= gp);
  return o;
}

// Agirliklar (Musab'in kurali): bu sezon 0 macta %0, 15 macta %50, 82 macta %100;
// kalan gecen sezon:projeksiyon = 25:30; caylakta gecen sezon payi bu sezon/projeksiyona esit bolunur
// (0 macta %100 projeksiyon); +%10 son form (5 projeksiyondan, 3 bu sezondan, 2 gecen sezondan).
function weights(gpS, hasS, hasL, hasP, hasR) {
  const g = hasS ? Math.min(gpS, 82) : 0;
  let ws = g > 0 ? 1 - Math.pow(1 - g / 82, 3.43) : 0;
  const rem = 1 - ws;
  let wl = rem * 25 / 55, wp = rem * 30 / 55;
  if (!hasL) { if (g > 0) { ws += wl / 2; wp += wl / 2; } else { wp += wl; } wl = 0; }
  let wr = 0;
  if (hasR && g > 0) {
    wr = 0.10;
    const take = [["p", .05], ["s", .03], ["l", .02]];
    const w = { s: ws, l: wl, p: wp }; let short = 0;
    take.forEach(([k, n]) => { const t = Math.min(w[k], n); w[k] -= t; short += n - t; });
    if (short > 0) { const k = ["p", "s", "l"].sort((a, b) => w[b] - w[a])[0]; w[k] = Math.max(0, w[k] - short); }
    ws = w.s; wl = w.l; wp = w.p;
  }
  if (!hasP && wp > 0) { const base = (hasS ? ws : 0) + (hasL ? wl : 0); if (base > 0) { ws += wp * ws / base; wl += wp * wl / base; } else if (hasR) wr += wp; wp = 0; }
  const tot = ws + wl + wp + wr; if (!(tot > 0)) return null;
  return { s: ws / tot, l: wl / tot, p: wp / tot, r: wr / tot };
}

function buildPlayers(src) {
  const byId = {}, idx = {};
  ["bu", "gecen", "proj", "son14"].forEach(k => { idx[k] = {}; (src[k].players || []).forEach(p => { idx[k][p.id] = p; byId[p.id] = byId[p.id] || p; }); });
  // NBA takimlarinin kalan maci: 82 - o takimdan en cok mac oynayan oyuncunun GP'si
  const teamGP = {};
  Object.values(idx.bu).forEach(p => { const g = num(p["GP*"]); if (g > 0) teamGP[p.nba] = Math.max(teamGP[p.nba] || 0, g); });
  const out = {};
  Object.keys(byId).forEach(id => {
    const base = byId[id];
    const S = perGame(idx.bu[id]), L = perGame(idx.gecen[id]), P = perGame(idx.proj[id], true), R = perGame(idx.son14[id]);
    const w = weights(S ? S.gp : 0, !!S, !!L, !!P, !!R);
    if (!w) return;
    const pg = {};
    COUNT.forEach(k => { pg[k] = (S ? w.s * S[k] : 0) + (L ? w.l * L[k] : 0) + (P ? w.p * P[k] : 0) + (R ? w.r * R[k] : 0); });
    const remTeam = Math.max(1, 82 - (teamGP[base.nba] || 0));
    let avail = P ? Math.min(1, P.gp / remTeam) : 0.9;
    if (OVERRIDE_AVAIL[base.name] != null) avail = OVERRIDE_AVAIL[base.name];
    const owner = (idx.bu[id] || base)["Roster Status"] || "";
    const season = S ? { gp: S.gp, mpg: (idx.bu[id] || {})["MPG"] || "", fgp: S.fga ? S.fgm / S.fga : NaN, ftp: S.fta ? S.ftm / S.fta : NaN,
      tpm: S.tpm, pts: S.pts, reb: S.reb, ast: S.ast, st: S.st, blk: S.blk, to: S.to } : null;
    out[id] = { id: +id, name: base.name, nba: base.nba, pos: base.pos, owner, pg, avail, w, pgp: P ? P.gp : null, season,
                gpS: S ? S.gp : 0 };
  });
  return out;
}

// ---------- takim toplamlari ----------
function weekly(p, games) { const g = games != null ? games : GAMES_WEEK * p.avail; const o = {}; COUNT.forEach(k => o[k] = p.pg[k] * g); return o; }
function addTo(t, w, s) { COUNT.forEach(k => t[k] += s * w[k]); }
function zero() { const o = {}; COUNT.forEach(k => o[k] = 0); return o; }
function teamTotals(list) { const t = zero(); list.forEach(x => addTo(t, x.wk, 1)); return t; }
function cats(t) { return { fgp: t.fgm / t.fga, ftp: t.ftm / t.fta, tpm: t.tpm, pts: t.pts, reb: t.reb, ast: t.ast, st: t.st, blk: t.blk, to: t.to, fga: t.fga, fta: t.fta }; }
function sd(c, k) {
  if (k === "fgp") return Math.sqrt(c.fgp * (1 - c.fgp) / Math.max(c.fga, 1)) * 1.25;
  if (k === "ftp") return Math.sqrt(c.ftp * (1 - c.ftp) / Math.max(c.fta, 1)) * 1.25;
  return Math.max(1, CV[k] * c[k]);
}
function pWin(a, b, k) {
  const s = Math.sqrt(sd(a, k) ** 2 + sd(b, k) ** 2);
  const d = k === "to" ? b[k] - a[k] : a[k] - b[k];
  return phi(d / s);
}

// ---------- lig modeli ----------
function League(players, rosters, standings, draft, ctx) {
  this.P = players;
  this.calendar(ctx || {});
  this.price = {};
  (draft || []).forEach(d => { this.price[d.id] = d.cost; });
  this.rost = {};
  Object.entries(rosters.teams).forEach(([team, list]) => {
    this.rost[team] = list.map(r => {
      const p = players[r.id]; if (!p) return null;
      const price = typeof r.draft === "number" ? r.draft : 1;
      return { ...p, slot: r.slot, status: r.status || "", price, wk: weekly(p) };
    }).filter(Boolean);
  });
  this.teams = Object.keys(this.rost);
  const st = (standings && standings.standings) || [];
  this.order = st.slice().sort((a, b) => b.pct - a.pct).map(s => s.team);
  const top = this.order.slice(0, TOP_N + 1);
  this.topFor = team => this.order.filter(t => t !== team).slice(0, TOP_N);
  this.oppW = t => (top.includes(t) ? 2 : 1);
  this.top = top;
  // Bostaki en iyi 20 oyuncunun ortalamasi = acik kadro yeri (stream)
  const fa = Object.values(players).filter(p => p.owner === "FA" || /^W/.test(p.owner));
  this.genericZ(Object.values(players).filter(p => this.isRostered(p)));
  fa.forEach(p => p.gv = this.gv(p));
  const best = fa.sort((a, b) => b.gv - a.gv).slice(0, 20);
  this.repl = best.reduce((a, p) => a + p.gv, 0) / Math.max(1, best.length); // yedek oyuncu seviyesi
  const avgPg = zero(); best.forEach(p => addTo(avgPg, p.pg, 1 / best.length));
  this.filler = { id: -1, name: "Boş yer (FA stream)", nba: "", pos: "", pg: avgPg, avail: 1, price: 0, wk: weekly({ pg: avgPg }, STREAM_GAMES) };
  Object.values(this.rost).flat().forEach(p => { p.gv = this.gv(p); p.fv = this.gv({ ...p, avail: 1 }); this.prep(p); });
  this.raw = {}; this.base = {};
  this.teams.forEach(t => { this.raw[t] = this.seasonTotals(this.rost[t]); this.base[t] = cats(this.raw[t]); });
  // hizli on eleme icin her oyuncunun haftalik ortalama katkisi (en iyi 13'te oynadigi varsayimiyla)
  Object.values(this.rost).flat().forEach(p => { p.sc = {}; COUNT.forEach(k => p.sc[k] = p.pg[k] * p.seasonG * 7 / this.days); });
  this.fillSc = {}; COUNT.forEach(k => this.fillSc[k] = this.filler.pg[k] * GAMES_WEEK * FILL_RATE);
}
// ---------- takvim ve sakatlik ----------
// Kalan sezon (bugunden SEASON_END'e) Pazartesi-Pazar haftalarina bolunur; her NBA takiminin haftalik mac tarihleri.
League.prototype.calendar = function (ctx) {
  const days = (ctx.schedule && ctx.schedule.days) || {};
  const all = Object.keys(days).sort();
  const start = ctx.start || new Date().toISOString().slice(0, 10);
  this.start = start;
  this.teamRem = {};
  all.filter(d => d >= start).forEach(d => days[d].forEach(g => [g.away, g.home].forEach(t => this.teamRem[t] = (this.teamRem[t] || 0) + 1)));
  const weeks = []; let cur = null;
  for (let d = start; d <= SEASON_END; d = isoAdd(d, 1)) {
    const dow = new Date(d + "T12:00:00Z").getUTCDay();
    if (!cur || dow === 1) { cur = { from: d, to: d, n: 0, tg: {} }; weeks.push(cur); }
    cur.to = d; cur.n++;
    (days[d] || []).forEach(g => [g.away, g.home].forEach(t => (cur.tg[t] = cur.tg[t] || []).push(d)));
  }
  const teams = Object.keys(this.teamRem);
  weeks.forEach(w => { w.avg = teams.length ? teams.reduce((a, t) => a + (w.tg[t] || []).length, 0) / teams.length : GAMES_WEEK * w.n / 7; });
  this.weeks = weeks; this.days = weeks.reduce((a, w) => a + w.n, 0) || 7;
  this.inj = {};
  const list = (ctx.injuries && (ctx.injuries.injuries || ctx.injuries)) || [];
  (Array.isArray(list) ? list : []).forEach(x => { this.inj[normName(x.name)] = { status: x.status || "", ret: x.return || null, type: x.type || "" }; });
};
// Oyuncunun kalan sezondaki haftalik beklenen mac sayilari (donus tarihinden once 0)
League.prototype.prep = function (p) {
  const inj = this.inj[normName(p.name)];
  let ret = null;
  if (inj && /^out/i.test(inj.status)) ret = inj.ret && inj.ret > this.start ? inj.ret : isoAdd(this.start, OUT_DEFAULT_DAYS);
  else if (/^(O|INJ)$/.test(p.status || "")) ret = isoAdd(this.start, OUT_DEFAULT_DAYS);
  // oynama orani: Yahoo'nun kalan mac projeksiyonu / takimin (donusten sonraki) kalan maci.
  // Yahoo sakatligi zaten dusmusse cift sayilmaz; dusmemisse oran 1'de kesilir.
  let health;
  const rem = (this.teamRem[p.nba] || 0) - (ret ? this.missed(p.nba, ret) : 0);
  if (OVERRIDE_AVAIL[p.name] != null) health = OVERRIDE_AVAIL[p.name];
  else if (p.pgp != null && rem > 0) health = Math.min(1, p.pgp / rem);
  else health = ret ? HEALTHY : p.avail;
  p.ret = ret; p.health = health; p.injType = inj ? inj.type : "";
  p.gw = this.weeks.map(w => health * (w.tg[p.nba] || []).filter(d => !ret || d >= ret).length);
  p.seasonG = p.gw.reduce((a, b) => a + b, 0);
};
// Kalan sezonun haftalik ortalama takim toplami: her hafta oynayabilen en iyi 13 oyuncu, eksik yerler bostan
// (bostaki en iyi 20'nin ortalamasi). "opened": takasla acilan yer sayisi -> haftalik 4 add ile stream (+mac).
League.prototype.seasonTotals = function (list, opened) {
  const sorted = list.slice().sort((a, b) => b.gv - a.gv);
  const t = zero(); let fill = 0;
  this.weeks.forEach((w, i) => {
    let n = 0;
    for (const x of sorted) { if (n >= ACTIVE) break; const g = x.gw[i]; if (g > 0) { addTo(t, x.pg, g); n++; } }
    fill += (ACTIVE - n) * w.avg * FILL_RATE;
    if (opened) fill += opened * Math.max(0, STREAM_GAMES - w.avg) * w.n / 7;
  });
  addTo(t, this.filler.pg, fill);
  const k = 7 / this.days; COUNT.forEach(c => t[c] *= k);
  return t;
};
League.prototype.missed = function (nba, ret) { return this.weeks.reduce((a, w) => a + (w.tg[nba] || []).filter(d => d < ret).length, 0); };
const rosterCap = list => ACTIVE + Math.min(3, list.filter(x => x.ret).length);
League.prototype.isRostered = function (p) { return p.owner && p.owner !== "FA" && !/^W/.test(p.owner); };
// genel deger: 9 kategori z-skoru (yuzdeler hacimle agirlikli), hafta basina
League.prototype.genericZ = function (pool) {
  const mean = {}, sdv = {};
  const val = (p, k) => {
    const w = weekly(p);
    if (k === "fgp") return w.fgm - w.fga * this.lgFg; if (k === "ftp") return w.ftm - w.fta * this.lgFt;
    return w[k];
  };
  const t = zero(); pool.forEach(p => addTo(t, weekly(p), 1));
  this.lgFg = t.fgm / t.fga; this.lgFt = t.ftm / t.fta;
  CATS.forEach(k => { const v = pool.map(p => val(p, k)); const m = v.reduce((a, b) => a + b, 0) / v.length; mean[k] = m; sdv[k] = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) || 1; });
  this.z = { mean, sdv, val };
};
League.prototype.gv = function (p) { let s = 0; CATS.forEach(k => { const z = (this.z.val(p, k) - this.z.mean[k]) / this.z.sdv[k]; s += k === "to" ? -z : z; }); return s; };

// takimin kategori kazanma olasiliklari (rakip agirlikli) + ortalama sira
League.prototype.probs = function (team, c, overrides) {
  const out = {}; let wsum = 0; const rank = {};
  CATS.forEach(k => { out[k] = 0; rank[k] = 1; });
  this.teams.forEach(o => {
    if (o === team) return;
    const oc = (overrides && overrides[o]) || this.base[o];
    const w = this.oppW(o); wsum += w;
    CATS.forEach(k => { const p = pWin(c, oc, k); out[k] += w * p; rank[k] += 1 - p; });
  });
  CATS.forEach(k => out[k] /= wsum);
  return { p: out, rank };
};
League.prototype.plain = function (team, c, overrides) { // agirliksiz, tum takimlara karsi
  const out = {}; let n = 0; CATS.forEach(k => out[k] = 0);
  this.teams.forEach(o => { if (o === team) return; const oc = (overrides && overrides[o]) || this.base[o]; n++; CATS.forEach(k => out[k] += pWin(c, oc, k)); });
  CATS.forEach(k => out[k] /= n); return out;
};
League.prototype.catWeights = function (team, p) {
  const s = (STRAT[team] || {}).punt || {}; const w = {};
  CATS.forEach(k => { if (k in s) w[k] = s[k]; else if (p[k] >= 0.3 && p[k] <= 0.8) w[k] = 1.3; else if (p[k] > 0.9) w[k] = 0.6; else w[k] = 1; });
  return w;
};
const score = (p, w) => CATS.reduce((a, k) => a + w[k] * p[k], 0);

// ---------- takas aramasi ----------
// Olcu: ilk 4 rakibe karsi haftada beklenen kategori sayisi (punt haric), sezonun kalani icin.
// Partnerin kabulu: oyuncularin saglikli haldeki degeri (fv) ve draft $ dengesi.
const MIN_GAIN = 0.15;      // haftada en az +0,15 kategori
const PART_TOL = 1.0;       // partner en fazla bu kadar deger (z) kaybedebilir
const SHAPES = [[1, 1], [1, 2], [2, 1], [2, 2], [2, 3], [3, 2]];
function combos(arr, n) {
  const out = [];
  const rec = (st, acc) => { if (acc.length === n) { out.push(acc.slice()); return; } for (let i = st; i < arr.length; i++) { acc.push(arr[i]); rec(i + 1, acc); acc.pop(); } };
  rec(0, []); return out;
}
League.prototype.topProbs = function (team, c, overrides) {
  const out = {}; CATS.forEach(k => out[k] = 0); const opp = this.topFor(team);
  opp.forEach(o => { const oc = (overrides && overrides[o]) || this.base[o]; CATS.forEach(k => out[k] += pWin(c, oc, k)); });
  CATS.forEach(k => out[k] /= opp.length || 1); return out;
};
// Haftalik eslesmeyi kazanma olasiligi (9 kategoriden en az 5'i; 4,5 beraberlik yarim sayilmaz) rakip listesine karsi ortalama
League.prototype.weekWin = function (team, c, overrides, opps) {
  opps = opps || this.teams.filter(t => t !== team); let tot = 0;
  opps.forEach(o => { const oc = (overrides && overrides[o]) || this.base[o];
    let dp = [1]; CATS.forEach(k => { const q = pWin(c, oc, k), nx = Array(dp.length + 1).fill(0); dp.forEach((v, i) => { nx[i] += v * (1 - q); nx[i + 1] += v * q; }); dp = nx; });
    tot += dp.slice(5).reduce((a, b) => a + b, 0); });
  return opps.length ? tot / opps.length : 0;
};
League.prototype.objective = function (team, c, overrides) {
  const punt = (STRAT[team] || {}).punt || {}; const p = this.topProbs(team, c, overrides);
  return { v: CATS.reduce((a, k) => a + (k in punt ? 0 : p[k]), 0), p };
};
// Tek bir takasin etkisi (oneri motoru ve "Takas dene" ayni hesabi kullanir)
League.prototype.evalTrade = function (team, partner, give, get, baseObj, baseAll) {
  const punt = (STRAT[team] || {}).punt || {};
  baseObj = baseObj || this.objective(team, this.base[team]);
  baseAll = baseAll || this.plain(team, this.base[team]);
  const me = this.rost[team], them = this.rost[partner], ng = give.length, nr = get.length;
  const newMe = me.filter(x => !give.includes(x)).concat(get);
  let t, myDrop = null;
  if (newMe.length > rosterCap(newMe)) {
    const cand = newMe.filter(x => !x.ret && !get.includes(x)).sort((a, b) => a.fv - b.fv).slice(0, 3);
    let best = null;
    cand.forEach(x => { const tt = this.seasonTotals(newMe.filter(y => y !== x)); const o = this.objective(team, cats(tt)).v; if (!best || o > best.o) best = { x, o, tt }; });
    if (!best) return null;
    myDrop = best.x; t = best.tt;
  } else t = this.seasonTotals(newMe, Math.max(0, ng - nr));
  let newThem = them.filter(x => !get.includes(x)).concat(give), theirDrop = null;
  if (newThem.length > rosterCap(newThem)) { theirDrop = newThem.filter(x => !x.ret && !give.includes(x)).reduce((a, x) => (!a || x.fv < a.fv ? x : a), null); newThem = newThem.filter(x => x !== theirDrop); }
  const uc = cats(this.seasonTotals(newThem, Math.max(0, nr - ng)));
  const ov = { [partner]: uc }, mc = cats(t);
  const obj = this.objective(team, mc, ov), all = this.plain(team, mc, ov);
  const gPrice = give.reduce((a, x) => a + x.price, 0), rPrice = get.reduce((a, x) => a + x.price, 0);
  const fvOut = give.reduce((a, x) => a + x.fv, 0), fvIn = get.reduce((a, x) => a + x.fv, 0);
  const warn = [];
  if (Math.abs(gPrice - rPrice) > Math.max(6, 0.2 * Math.max(gPrice, rPrice))) warn.push({ hard: true, t: "Draft $ dengesi açık: " + gPrice + " ↔ " + rPrice });
  if (fvOut - fvIn < -PART_TOL) warn.push({ hard: true, t: partner + " değer kaybediyor (" + (fvOut - fvIn).toFixed(1) + "): kabul etmesi zor" });
  for (const k of CATS) {
    if (k in punt) continue;
    const b = baseAll[k], a = all[k];
    if (b >= 0.35 && b <= 0.8 && a < b - MID_TOL) warn.push({ hard: true, t: LBL[k] + " orta seviyedeyken düşüyor (" + Math.round(b * 100) + "% → " + Math.round(a * 100) + "%)" });
    else if (b > 0.8 && a < 0.75) warn.push({ hard: true, t: LBL[k] + " güçlüyken ortaya iniyor (" + Math.round(b * 100) + "% → " + Math.round(a * 100) + "%)" });
  }
  get.filter(x => x.ret).forEach(x => warn.push({ hard: false, t: x.name + " sakat, tahmini dönüş " + x.ret }));
  const lgGain = CATS.reduce((a, k) => a + (k in punt ? 0 : all[k] - baseAll[k]), 0);
  const ww = (tm, cc, ov) => ({ top: this.weekWin(tm, cc, ov, this.topFor(tm)), all: this.weekWin(tm, cc, ov) });
  const wMeB = ww(team, this.base[team]), wMeA = ww(team, mc, ov);
  // karsi tarafin gozunden ayni takas
  const pp = (STRAT[partner] || {}).punt || {}, mov = { [team]: mc };
  const pTopB = this.topProbs(partner, this.base[partner]), pTopA = this.topProbs(partner, uc, mov);
  const pAllB = this.plain(partner, this.base[partner]), pAllA = this.plain(partner, uc, mov);
  const sumD = (a, b) => CATS.reduce((t, k) => t + (k in pp ? 0 : a[k] - b[k]), 0);
  const wPB = ww(partner, this.base[partner]), wPA = ww(partner, uc, mov);
  return { partner, give, get, myDrop, theirDrop, gain: obj.v - baseObj.v, lgGain, gPrice, rPrice, fvOut, fvIn,
           before: baseAll, after: all, top: obj.p, topBefore: baseObj.p, warn, win: { b: wMeB, a: wMeA },
           p: { punt: pp, topBefore: pTopB, top: pTopA, gain: sumD(pTopA, pTopB), lgGain: sumD(pAllA, pAllB), win: { b: wPB, a: wPA } } };
};
League.prototype.searchTrades = function (team, opts) {
  opts = opts || {};
  const punt = (STRAT[team] || {}).punt || {};
  const me = this.rost[team];
  const pool = list => list.filter(x => x.fv > this.repl);   // waiver seviyesinin ustu
  const baseObj = this.objective(team, this.base[team]);
  const baseAll = this.plain(team, this.base[team]);
  const res = []; let evaluated = 0;
  const myPool = pool(me);
  const mine = {}; SHAPES.forEach(([ng]) => { if (!mine[ng]) mine[ng] = combos(myPool, ng); });
  for (const partner of this.teams) {
    if (partner === team) continue;
    const them = this.rost[partner], thPool = pool(them), theirs = {};
    for (const [ng, nr] of SHAPES) {
      if (!theirs[nr]) theirs[nr] = combos(thPool, nr);
      for (const give of mine[ng]) {
        const gPrice = give.reduce((a, x) => a + x.price, 0), gFv = give.reduce((a, x) => a + x.fv, 0);
        for (const get of theirs[nr]) {
          const rPrice = get.reduce((a, x) => a + x.price, 0);
          if (Math.abs(gPrice - rPrice) > Math.max(6, 0.2 * Math.max(gPrice, rPrice))) continue;
          const rFv = get.reduce((a, x) => a + x.fv, 0);
          if (gFv - rFv < -PART_TOL) continue;           // partner fazla deger kaybetmesin
          // hizli on eleme (dogrusal yaklasim): umut yoksa tam hesaba girme
          {
            const q = { ...this.raw[team] }; give.forEach(x => addTo(q, x.sc, -1)); get.forEach(x => addTo(q, x.sc, 1));
            if (ng > nr) addTo(q, this.fillSc, ng - nr);
            if (nr > ng) { const lo = me.filter(x => !give.includes(x) && !x.ret).sort((a, b) => a.fv - b.fv).slice(0, nr - ng); lo.forEach(x => addTo(q, x.sc, -1)); }
            const qu = { ...this.raw[partner] }; get.forEach(x => addTo(qu, x.sc, -1)); give.forEach(x => addTo(qu, x.sc, 1));
            if (this.objective(team, cats(q), { [partner]: cats(qu) }).v - baseObj.v < (opts.minGain != null ? opts.minGain : MIN_GAIN) - 0.06) continue;
          }
          evaluated++;
          const ev = this.evalTrade(team, partner, give, get, baseObj, baseAll);
          if (!ev || ev.gain < (opts.minGain != null ? opts.minGain : MIN_GAIN) || ev.warn.some(w => w.hard)) continue;
          res.push(ev);
        }
      }
    }
  }
  res.sort((a, b) => b.gain - a.gain);
  const out = [], perP = {}, perGive = {};
  for (const r of res) {
    const gk = r.give.map(x => x.id).join(",");
    if ((perP[r.partner] || 0) >= 3 || (perGive[gk] || 0) >= 2) continue;
    perP[r.partner] = (perP[r.partner] || 0) + 1; perGive[gk] = (perGive[gk] || 0) + 1;
    out.push(r); if (out.length >= (opts.limit || 15)) break;
  }
  return { base: baseObj, list: out, considered: res.length, evaluated };
};

G.FantasyEngine = { CATS, LBL, STRAT, buildPlayers, League, weights, cats, teamTotals, pWin, normName, isoAdd, phi };
if (typeof module !== "undefined") module.exports = G.FantasyEngine;
})(typeof globalThis !== "undefined" ? globalThis : this);
