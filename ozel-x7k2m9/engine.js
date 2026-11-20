// Ozel panel hesaplama motoru: oyuncu projeksiyonu, kategori kazanma olasiliklari, takas aramasi.
(function (G) {
"use strict";
const CATS = ["fgp", "ftp", "tpm", "pts", "reb", "ast", "st", "blk", "to"];
const LBL = { fgp: "FG%", ftp: "FT%", tpm: "3PM", pts: "PTS", reb: "REB", ast: "AST", st: "ST", blk: "BLK", to: "TO" };
const COUNT = ["fgm", "fga", "ftm", "fta", "tpm", "pts", "reb", "ast", "st", "blk", "to"];
const GAMES_WEEK = 3.5;           // oyuncu basina haftalik ortalama mac
const STREAM_GAMES = 4.5;         // acik kadro yeri: haftalik 4 add ile stream
const CV = { tpm: .16, pts: .09, reb: .09, ast: .11, st: .17, blk: .2, to: .12 };
const OVERRIDE_AVAIL = { "Anthony Davis": 0.85 };

const STRAT = {
  "tarkus maurelius": { punt: { ast: -0.1 }, label: "AST punt" },
  "Normal MAFIA": { punt: { tpm: 0 }, label: "3PM punt" },
};

// ---------- yardimcilar ----------
const num = v => { if (v == null) return NaN; const x = parseFloat(String(v).replace(/,/g, "")); return isFinite(x) ? x : NaN; };
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
    out[id] = { id: +id, name: base.name, nba: base.nba, pos: base.pos, owner, pg, avail, w,
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
function League(players, rosters, standings, draft) {
  this.P = players;
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
  const top = st.slice().sort((a, b) => b.pct - a.pct).slice(0, 6).map(s => s.team);
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
  Object.values(this.rost).flat().forEach(p => p.gv = this.gv(p));
  this.base = {}; this.teams.forEach(t => this.base[t] = cats(teamTotals(this.rost[t])));
}
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
function combos(arr, n) { if (n === 1) return arr.map(x => [x]); const out = []; for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) out.push([arr[i], arr[j]]); return out; }

League.prototype.searchTrades = function (team, opts) {
  opts = opts || {};
  // waiver'dan alinabilecek seviyedeki oyuncularin takas degeri yok: sadece yedek seviyesinin ustundekiler
  const tradeable = list => list.filter(x => x.gv > this.repl);
  const me = this.rost[team]; const base = this.probs(team, this.base[team]);
  const W = this.catWeights(team, base.p); const baseScore = score(base.p, W);
  const res = [];
  const sumW = list => { const t = zero(); list.forEach(x => addTo(t, x.wk, 1)); return t; };
  const myTot = teamTotals(me);
  const shapes = opts.shapes || [[1, 1], [2, 1], [1, 2], [2, 2]];
  for (const partner of this.teams) {
    if (partner === team) continue;
    const them = this.rost[partner]; const theirTot = teamTotals(them);
    const pBase = this.plain(partner, this.base[partner]);
    const pBaseSum = CATS.reduce((a, k) => a + pBase[k], 0);
    for (const [ng, nr] of shapes) {
      for (const give of combos(tradeable(me), ng)) {
        const gPrice = give.reduce((a, x) => a + x.price, 0);
        const gGv = give.reduce((a, x) => a + x.gv, 0);
        for (const get of combos(tradeable(them), nr)) {
          const rPrice = get.reduce((a, x) => a + x.price, 0);
          if (Math.abs(gPrice - rPrice) > Math.max(6, 0.2 * Math.max(gPrice, rPrice))) continue;
          const rGv = get.reduce((a, x) => a + x.gv, 0);
          if (rGv - gGv < -1.5) continue; // bariz kotu takaslari ele
          // benim yeni toplamim
          const t = { ...myTot }; addTo(t, sumW(give), -1); addTo(t, sumW(get), 1);
          let myDrop = null;
          if (nr > ng) { // fazla oyuncu: en az kayipla birini birak
            let best = null;
            me.filter(x => !give.includes(x)).concat(get).forEach(x => { const tt = { ...t }; addTo(tt, x.wk, -1); const s = score(this.probs(team, cats(tt)).p, W); if (!best || s > best.s) best = { x, s, tt }; });
            myDrop = best.x; Object.assign(t, best.tt);
          } else if (ng > nr) { addTo(t, this.filler.wk, ng - nr); }
          // partnerin yeni toplami
          const u = { ...theirTot }; addTo(u, sumW(get), -1); addTo(u, sumW(give), 1);
          let theirDrop = null;
          if (ng > nr) { const pool = them.filter(x => !get.includes(x)).concat(give); theirDrop = pool.reduce((a, x) => (!a || x.gv < a.gv ? x : a), null); addTo(u, theirDrop.wk, -1); }
          else if (nr > ng) addTo(u, this.filler.wk, nr - ng);
          const uc = cats(u);
          const ov = { [partner]: uc };
          const np = this.probs(team, cats(t), ov);
          // kisitlar: orta seviye kategori dusmesin, guclu kategori ortaya inmesin
          let bad = false;
          for (const k of CATS) {
            if (W[k] <= 0) continue;
            const b = base.p[k], a = np.p[k];
            if (b >= 0.35 && b <= 0.8 && a < b - 0.015) { bad = true; break; }
            if (b > 0.8 && a < 0.75) { bad = true; break; }
          }
          if (bad) continue;
          const gain = score(np.p, W) - baseScore;
          if (gain <= 0.02) continue;
          // partner icin kabul edilebilirlik: genel 9-kat gucu fazla dusmesin
          const pAfter = this.plain(partner, uc, { [team]: cats(t) });
          const pDelta = CATS.reduce((a, k) => a + pAfter[k], 0) - pBaseSum;
          if (pDelta < -0.12) continue;
          res.push({ partner, give, get, myDrop, theirDrop, gain, pDelta, before: base.p, after: np.p, rankAfter: np.rank, gPrice, rPrice });
        }
      }
    }
  }
  res.sort((a, b) => b.gain - a.gain);
  // cesitlilik: ortaga en fazla 2, ayni oyuncuyu veren en fazla 3 takas
  const out = [], perP = {}, perGive = {};
  for (const r of res) {
    const gk = r.give.map(x => x.id).join(",");
    if ((perP[r.partner] || 0) >= 2 || (perGive[gk] || 0) >= 2) continue;
    perP[r.partner] = (perP[r.partner] || 0) + 1; perGive[gk] = (perGive[gk] || 0) + 1;
    out.push(r); if (out.length >= (opts.limit || 12)) break;
  }
  return { base, W, list: out, considered: res.length };
};

G.FantasyEngine = { CATS, LBL, STRAT, buildPlayers, League, weights, cats, teamTotals, pWin };
if (typeof module !== "undefined") module.exports = G.FantasyEngine;
})(typeof globalThis !== "undefined" ? globalThis : this);
