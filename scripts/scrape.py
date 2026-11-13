"""Yahoo Fantasy sayfalarini (giris cerezi ile) okuyup data.json ve transactions.json'u gunceller."""
import datetime, glob, json, os, re, sys, time, urllib.request
from zoneinfo import ZoneInfo
from bs4 import BeautifulSoup

LEAGUE = os.environ.get("LEAGUE_ID", "71722")
BASE = f"https://basketball.fantasysports.yahoo.com/nba/{LEAGUE}"
COOKIE = os.environ.get("YAHOO_COOKIE", "").strip()
LOCAL = os.environ.get("LOCAL_DIR")  # test icin: sayfalari diskten oku
IST = ZoneInfo("Europe/Istanbul"); ET = ZoneInfo("America/New_York")
AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"]
MON = {m: i + 1 for i, m in enumerate(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])}
NOW = datetime.datetime.now(IST)
LOG = []

def log(msg):
    print(msg); LOG.append(msg)

def finish(code=0):
    open("run.log", "w", encoding="utf-8").write("\n".join(LOG) + "\n")
    sys.exit(code)

def fetch(path):
    if LOCAL:
        name = "matchup.html" if path.startswith("/matchup") else ((path + ".html") if path else "home.html")
        return open(os.path.join(LOCAL, name.lstrip("/")), encoding="utf-8").read()
    req = urllib.request.Request(BASE + path, headers={
        "Cookie": COOKIE, "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36"})
    time.sleep(1)
    r = urllib.request.urlopen(req, timeout=40)
    html = r.read().decode("utf-8", "replace")
    if "login.yahoo.com" in r.geturl() or "Sign out" not in html:
        log("HATA: Yahoo girisi gecersiz (cerez suresi dolmus olabilir). YAHOO_COOKIE secret'ini yenile.")
        finish(1)
    return html

def near_year(m, d):
    """Yil bilgisi olmayan tarih icin bugune en yakin yili sec."""
    best = None
    for y in (NOW.year - 1, NOW.year, NOW.year + 1):
        c = datetime.date(y, m, d)
        if best is None or abs((c - NOW.date()).days) < abs((best - NOW.date()).days):
            best = c
    return best

def tr_date(d):
    return f"{d.day} {AYLAR[d.month - 1]}"

def week_label(no, s, e):
    if s.month == e.month:
        return f"Hafta {no} ({s.day}-{e.day} {AYLAR[e.month - 1]})"
    return f"Hafta {no} ({tr_date(s)}-{tr_date(e)})"

def updated_str(final=False):
    s = f"{NOW.day} {AYLAR[NOW.month - 1]} {NOW.year}, {NOW:%H:%M}"
    if final:
        return s + " (final)"
    return s + f" ({tr_date(NOW.date() - datetime.timedelta(days=1))} maçları dahil)"

def to_int(v):
    v = v.strip()
    if not re.fullmatch(r"-?\d+", v):
        raise ValueError(f"sayi degil: {v!r}")
    return int(v)

def pair(v):
    m = re.fullmatch(r"\s*(\d+)\s*/\s*(\d+)\s*", v)
    if not m:
        raise ValueError(f"oran degil: {v!r}")
    return int(m.group(1)), int(m.group(2))

# ---------------- Haftalik toplamlar ----------------
def matchup_links(html, week=None):
    pat = r"/nba/%s/matchup\?week=(\d+)&(?:amp;)?mid1=(\d+)&(?:amp;)?mid2=(\d+)" % LEAGUE
    found = sorted(set(re.findall(pat, html)), key=lambda x: int(x[1]))
    if week is not None:
        found = [f for f in found if int(f[0]) == week]
    return found

def parse_matchup(html):
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text(" | ", strip=True)
    gp = re.search(r"(\d+)/\d+ \| Games Played \| (\d+)/\d+", text)
    if not gp:
        raise ValueError("Games Played bulunamadi")
    days = re.findall(r"\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (\d{1,2})/(\d{1,2})\b", text)
    table = None
    for t in soup.find_all("table"):
        first = t.find("tr")
        if first and [c.get_text(strip=True) for c in first.find_all(["th", "td"])][:2] == ["Team", "FGM/A*"]:
            table = t; break
    if table is None:
        raise ValueError("Toplamlar tablosu bulunamadi")
    head = [c.get_text(strip=True) for c in table.find("tr").find_all(["th", "td"])]
    teams = []
    for i, tr in enumerate(table.find_all("tr")[1:3]):
        cells = [c.get_text(" ", strip=True) for c in tr.find_all(["th", "td"])]
        row = dict(zip(head, cells))
        fgm, fga = pair(row["FGM/A*"]); ftm, fta = pair(row["FTM/A*"])
        t = {"team": row["Team"], "gp": int(gp.group(i + 1)), "fgm": fgm, "fga": fga, "ftm": ftm, "fta": fta,
             "tpm": to_int(row["3PTM"]), "pts": to_int(row["PTS"]), "reb": to_int(row["REB"]), "ast": to_int(row["AST"]),
             "st": to_int(row["ST"]), "blk": to_int(row["BLK"]), "to": to_int(row["TO"])}
        t["_fgpct"] = row["FG%"]
        teams.append(t)
    return teams, days

def week_data(week, links):
    teams, days = [], []
    for w, m1, m2 in links:
        html = fetch(f"/matchup?week={w}&mid1={m1}&mid2={m2}")
        t, d = parse_matchup(html)
        txt = BeautifulSoup(html, "html.parser").get_text(" ", strip=True)
        m = re.search(r"(\d+)\s*/\s*(\d+)\s*Games Played\s*(\d+)\s*/\s*(\d+)", txt)
        if m and len(t) == 2:
            t[0]["games_played"], t[0]["games_total"] = int(m.group(1)), int(m.group(2))
            t[1]["games_played"], t[1]["games_total"] = int(m.group(3)), int(m.group(4))
        teams += t; days = days or d
    s = near_year(int(days[0][0]), int(days[0][1])); e = near_year(int(days[-1][0]), int(days[-1][1]))
    return teams, week_label(week, s, e)

def check(teams, prev_names):
    errs = []
    if len(teams) != 16:
        errs.append(f"{len(teams)} takim bulundu (16 olmali)")
    if prev_names and sorted(t["team"] for t in teams) != sorted(prev_names):
        errs.append("takim isimleri onceki haftayla ayni degil: " + ", ".join(sorted(set(t["team"] for t in teams) ^ set(prev_names))))
    for t in teams:
        if t["fgm"] > t["fga"]: errs.append(f"{t['team']}: FGM > FGA")
        if t["ftm"] > t["fta"]: errs.append(f"{t['team']}: FTM > FTA")
        shown = t.pop("_fgpct")
        if t["fga"] and re.fullmatch(r"\d?\.\d+", shown):
            if abs(t["fgm"] / t["fga"] - float(shown)) > 0.001:
                errs.append(f"{t['team']}: FG% {t['fgm']}/{t['fga']} ekrandaki {shown} ile uyusmuyor")
    return errs

# ---------------- Islemler ----------------
def short(name):
    p = name.split()
    return name if len(p) < 2 else f"{p[0][0]}. {' '.join(p[1:])}"

def parse_transactions(html):
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table", class_="Tst-transaction-table")
    out = []
    if table is None:
        log("UYARI: islem tablosu bulunamadi"); return out
    for tr in table.find_all("tr"):
        tds = tr.find_all("td")
        if len(tds) < 3:
            continue
        icons = [s.get("title", "") for s in tds[0].find_all("span")]
        teams = [a.get_text(strip=True) for a in tds[-1].find_all("a", class_="Tst-team-name")]
        ts = tds[-1].find("span", class_="F-timestamp")
        if not teams or ts is None:
            continue
        m = re.match(r"(\w{3}) (\d{1,2}), (\d{1,2}):(\d{2}) (am|pm)", ts.get_text(strip=True))
        if not m:
            continue
        h = int(m.group(3)) % 12 + (12 if m.group(5) == "pm" else 0)
        d = near_year(MON[m.group(1)], int(m.group(2)))
        t_et = datetime.datetime(d.year, d.month, d.day, h, int(m.group(4)), tzinfo=ET)
        time = t_et.astimezone(IST).strftime("%Y-%m-%d %H:%M")
        players = []
        for div in tds[1].find_all("div", class_="Pbot-xs"):
            a = div.find("a"); pos = div.find("span", class_="F-position"); h6 = div.find("h6")
            if a is None:
                continue
            players.append({"name": short(a.get_text(strip=True)),
                            "pos": pos.get_text(strip=True).split(" - ")[-1] if pos else "",
                            "note": h6.get_text(" ", strip=True) if h6 else ""})
        if any("Trad" in i for i in icons) or len(teams) == 2:
            give = {tm: [] for tm in teams}
            for p in players:
                dest = next((tm for tm in teams if tm in p["note"]), None)
                src = next((tm for tm in teams if tm != dest), None) if dest else None
                if src: give[src].append(p["name"])
            out.append({"time": time, "type": "trade", "teams": teams, "give": give})
            continue
        adds = [p for p in players if "Waiver" in p["note"] and "To Waivers" not in p["note"] or "Free Agent" in p["note"]]
        drops = [p for p in players if p not in adds]
        typ = "add/drop" if adds and drops else ("add" if adds else "drop")
        e = {"time": time, "team": teams[0], "type": typ, "add": [p["name"] for p in adds],
             "drop": [p["name"] for p in drops], "pos": " / ".join(p["pos"] for p in adds + drops)}
        if adds:
            note = adds[0]["note"]
            if "Free Agent" in note:
                e["source"] = "FA"
            else:
                fa = re.search(r"\$(\d+)", note)
                e["faab"] = int(fa.group(1)) if fa else 0
                e["source"] = "W"
        out.append(e)
    return out

def tx_key(e):
    if e["type"] == "trade":
        return (e["time"], tuple(e["teams"]), json.dumps(e["give"], sort_keys=True, ensure_ascii=False))
    return (e["time"], e["team"], tuple(e["add"]), tuple(e["drop"]))

# ---------------- Ana akis ----------------
# ---------------- Oyuncu istatistikleri (Players sayfasi) ----------------
PLAYER_SETS = [("bu_sezon_ort", "S_AS_2026"), ("gecen_sezon_ort", "S_AS_2025"), ("son14_ort", "S_AL14"),
               ("son7_ort", "S_AL7"), ("projeksiyon_kalan", "S_PSR")]
PLAYER_PASSES = [("T", 12), ("A", 8)]   # T: tum kadrolu oyuncular, A: en iyi ~200 serbest oyuncu

def parse_players(html):
    soup = BeautifulSoup(html, "html.parser")
    table = None
    for t in soup.find_all("table"):
        heads = [th.get_text(" ", strip=True) for th in t.find_all("th")]
        if any(h.startswith("Player") or h == "Players" for h in heads) and any("PTS" in h for h in heads):
            table = t; break
    if table is None:
        return [], [], soup
    hrows = table.find("thead").find_all("tr") if table.find("thead") else [table.find("tr")]
    heads = [th.get_text(" ", strip=True) for th in hrows[-1].find_all(["th", "td"])]
    rows = []
    body = table.find("tbody") or table
    for tr in body.find_all("tr"):
        tds = tr.find_all("td")
        if len(tds) < 6:
            continue
        a = tr.find("a", class_=re.compile("name"))
        if not a:
            continue
        rec = {"name": a.get_text(strip=True)}
        pid = re.search(r"/players/(\d+)", a.get("href", ""))
        if pid:
            rec["id"] = int(pid.group(1))
        tp = tr.find("span", class_=re.compile("Fz-xxs"))
        if tp:
            txt = tp.get_text(" ", strip=True)
            if " - " in txt:
                rec["nba"], rec["pos"] = [x.strip() for x in txt.split(" - ", 1)]
        if "nba" not in rec:
            m = POSRX.search(tr.get_text(" ", strip=True))
            if m:
                rec["nba"], rec["pos"] = m.group(1), m.group(2)
        inj = tr.find("span", class_=re.compile("F-injury"))
        if inj:
            rec["status"] = inj.get_text(strip=True)
        cells = [td.get_text(" ", strip=True) for td in tds]
        off = len(heads) - len(cells)
        for i, c in enumerate(cells):
            hi = i + off
            if 0 <= hi < len(heads) and heads[hi] and heads[hi] not in ("Player", "Players", "Action", "Forecast"):
                rec[heads[hi]] = c
        rows.append(rec)
    return rows, heads, soup

def scrape_players():
    os.makedirs("players", exist_ok=True)
    for key, stat in PLAYER_SETS:
        allp, heads, seen = [], [], set()
        for status, maxp in PLAYER_PASSES:
            for p in range(maxp):
                path = f"/players?status={status}&pos=P&cut_type=33&stat1={stat}&myteam=0&sort=AR&sdir=1&count={p*25}"
                try:
                    html = fetch(path)
                except SystemExit:
                    raise
                except Exception as ex:
                    log(f"HATA oyuncular {key} {status} sayfa {p}: {ex}"); break
                rows, h, soup = parse_players(html)
                if not rows:
                    break
                heads = heads or h
                for r in rows:
                    if r["name"] not in seen:
                        seen.add(r["name"]); allp.append(r)
                if len(rows) < 25:
                    break
        json.dump({"updated": NOW.strftime("%Y-%m-%d %H:%M"), "stat": stat, "columns": heads, "players": allp},
                  open(f"players/{key}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=0)
        log(f"Oyuncular {key}: {len(allp)} oyuncu ({sum(1 for x in allp if x.get('Roster Status') not in ('FA', None) and not str(x.get('Roster Status','')).startswith('W ('))} kadrolu) yazildi.")

# ---------------- Kadrolar (takim sayfalari) + draft fiyatlari ----------------
def team_ids(home):
    ids = {}
    for tid, txt in re.findall(r'href="(?:https://basketball\.fantasysports\.yahoo\.com)?/nba/%s/(\d{1,2})"[^>]*>([^<]{2,60})<' % LEAGUE, home):
        txt = txt.strip()
        if txt and not txt.isdigit():
            ids.setdefault(int(tid), txt)
    return ids

POSRX = re.compile(r"\b([A-Z]{2,4}) - ((?:PG|SG|G|SF|PF|F|C)(?:,(?:PG|SG|G|SF|PF|F|C))*)\b")
def parse_roster(html):
    soup = BeautifulSoup(html, "html.parser")
    out = []
    for tr in soup.find_all("tr"):
        a = tr.find("a", class_=re.compile("name"))
        tds = tr.find_all("td")
        if not a or len(tds) < 3:
            continue
        slot_el = tr.find(class_=re.compile("pos-label")) or tds[0]
        slot = (slot_el.get("data-pos") or slot_el.get_text(" ", strip=True)).split(" ")[0]
        rec = {"name": a.get_text(strip=True), "slot": slot}
        pid = re.search(r"/players/(\d+)", a.get("href", ""))
        if pid:
            rec["id"] = int(pid.group(1))
        m = POSRX.search(tr.get_text(" ", strip=True))
        if m:
            rec["nba"], rec["pos"] = m.group(1), m.group(2)
        inj = tr.find("span", class_=re.compile("F-injury"))
        if inj:
            rec["status"] = inj.get_text(strip=True)
        if rec["name"] not in [r["name"] for r in out]:
            out.append(rec)
    return out

def parse_draft(html, ids):
    soup = BeautifulSoup(html, "html.parser")
    out = []
    for tb in soup.find_all("table"):
        th = tb.find("th")
        team = th.get_text(strip=True) if th else ""
        for tr in tb.find_all("tr"):
            a = tr.find("a", class_=re.compile("name"))
            c = tr.find("td", class_=re.compile("cost"))
            if not a or not c:
                continue
            cost = re.search(r"\$(\d+)", c.get_text())
            pid = re.search(r"/players/(\d+)", a.get("href", ""))
            out.append({"name": a.get_text(strip=True), "id": int(pid.group(1)) if pid else None,
                        "cost": int(cost.group(1)) if cost else 0, "team": team})
    return out

TEAM_INFO = {}

def scrape_rosters(home):
    ids = team_ids(home)
    log(f"Kadrolar: {len(ids)} takim bulundu: {ids}")
    draft = []
    try:
        html = fetch("/draftresults?drafttab=team")
        open("probe_draft.html", "w", encoding="utf-8").write(html)
        draft = parse_draft(html, ids)
        json.dump(draft, open("draft.json", "w", encoding="utf-8"), ensure_ascii=False, indent=0)
        log(f"Draft: {len(draft)} secim yazildi.")
    except SystemExit:
        raise
    except Exception as ex:
        log(f"HATA draft: {ex}")
    cost = {d["id"]: d["cost"] for d in draft if d.get("id")}
    cost_n = {d["name"]: d["cost"] for d in draft}
    teams = {}
    for tid in sorted(ids or range(1, 17)):
        try:
            html = fetch(f"/{tid}")
            if tid == 1:
                open("probe_team.html", "w", encoding="utf-8").write(html)
            soup = BeautifulSoup(html, "html.parser")
            name = ids.get(tid) or (soup.title.get_text(strip=True).split("|")[0].strip() if soup.title else str(tid))
            text = soup.get_text(" | ", strip=True)
            info = {}
            for kw in ("FAAB", "Waiver Priority", "Moves", "Trades", "Adds", "Record", "Rank"):
                m = re.search(re.escape(kw) + r"[^|]{0,8}\|?[^|]{0,30}", text)
                if m:
                    info[kw] = m.group(0)
            TEAM_INFO[name] = {"id": tid, **info}
            rows = parse_roster(html)
            for r in rows:
                r["draft"] = cost.get(r.get("id"), cost_n.get(r["name"], "FA"))
            teams[name] = rows
            log(f"Kadro {name}: {len(rows)} oyuncu, IL: {[r['name'] for r in rows if r['slot'].startswith('IL')]}")
        except SystemExit:
            raise
        except Exception as ex:
            log(f"HATA kadro {tid}: {ex}")
    json.dump({"updated": NOW.strftime("%Y-%m-%d %H:%M"), "team_info": TEAM_INFO, "teams": teams},
              open("rosters.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)

# ---------------- Puan durumu ----------------
def generic_tables(html):
    soup = BeautifulSoup(html, "html.parser")
    out = []
    for t in soup.find_all("table"):
        hr = t.find("thead").find_all("tr")[-1] if t.find("thead") else t.find("tr")
        if not hr:
            continue
        heads = [c.get_text(" ", strip=True) for c in hr.find_all(["th", "td"])]
        rows = []
        for tr in (t.find("tbody") or t).find_all("tr"):
            cells = [c.get_text(" ", strip=True) for c in tr.find_all(["td", "th"])]
            if cells and cells != heads and len(cells) >= 3:
                rows.append(dict(zip(heads, cells)) if len(cells) == len(heads) else {"_cells": cells})
        if rows:
            out.append({"headers": heads, "rows": rows})
    return out

CATS = [("FG%", None), ("FT%", None), ("3PM", "tpm"), ("PTS", "pts"), ("REB", "reb"), ("AST", "ast"),
        ("ST", "st"), ("BLK", "blk"), ("TO", "to")]

def cat_result(a, b):
    w = l = t = 0
    for c, k in CATS:
        if c == "FG%":
            x = a["fgm"] / a["fga"] if a["fga"] else 0; y = b["fgm"] / b["fga"] if b["fga"] else 0
            x, y = round(x, 3), round(y, 3)
        elif c == "FT%":
            x = a["ftm"] / a["fta"] if a["fta"] else 0; y = b["ftm"] / b["fta"] if b["fta"] else 0
            x, y = round(x, 3), round(y, 3)
        else:
            x, y = a[k], b[k]
            if c == "TO":
                x, y = -x, -y
        if x > y: w += 1
        elif x < y: l += 1
        else: t += 1
    return w, l, t

def week_pairs(w, ids):
    pairs, done = [], set()
    for tid, name in sorted(ids.items()):
        if name in done:
            continue
        html = fetch(f"/matchup?week={w}&mid1={tid}")
        others = [n for n in ids.values() if n != name and n in html]
        if not others:
            continue
        opp = max(others, key=lambda n: html.count(n))
        pairs.append([name, opp]); done.update([name, opp])
    return pairs

def compute_standings(data):
    tab = {}
    for wk, wd in sorted(data["weeks"].items(), key=lambda kv: int(kv[0])):
        if "(final)" not in wd.get("updated", "") or not wd.get("pairs"):
            continue
        tm = {t["team"]: t for t in wd["teams"]}
        for a, b in wd["pairs"]:
            if a not in tm or b not in tm:
                continue
            w, l, t = cat_result(tm[a], tm[b])
            for n, r in ((a, (w, l, t)), (b, (l, w, t))):
                s = tab.setdefault(n, {"team": n, "W": 0, "L": 0, "T": 0, "mW": 0, "mL": 0, "mT": 0})
                s["W"] += r[0]; s["L"] += r[1]; s["T"] += r[2]
                if r[0] > r[1]: s["mW"] += 1
                elif r[0] < r[1]: s["mL"] += 1
                else: s["mT"] += 1
    rows = list(tab.values())
    for r in rows:
        g = r["W"] + r["L"] + r["T"]
        r["pct"] = round((r["W"] + r["T"] / 2) / g, 3) if g else 0
    rows.sort(key=lambda r: -r["pct"])
    json.dump({"updated": NOW.strftime("%Y-%m-%d %H:%M"), "note": "kategori bazli H2H; sadece biten haftalar",
               "standings": rows}, open("standings.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    log(f"Puan durumu: {len(rows)} takim hesaplandi.")

# ---------------- Tarkus fiksturu (sonraki haftalar) ----------------
MY_TEAM = "tarkus maurelius"

def scrape_schedule(current):
    tid = next((v["id"] for k, v in TEAM_INFO.items() if k.lower() == MY_TEAM), None)
    if tid is None:
        log("UYARI: fikstur icin takim id bulunamadi"); return
    sched = {}
    for w in range(current, current + 4):
        try:
            html = fetch(f"/matchup?week={w}&mid1={tid}")
            if w == current + 1:
                open("probe_matchup_next.html", "w", encoding="utf-8").write(html)
            names = [n for n in TEAM_INFO if n in html and n.lower() != MY_TEAM]
            # en cok gecen rakip ismi
            opp = max(names, key=lambda n: html.count(n)) if names else None
            sched[str(w)] = opp
        except SystemExit:
            raise
        except Exception as ex:
            log(f"HATA fikstur hafta {w}: {ex}")
    json.dump({"updated": NOW.strftime("%Y-%m-%d %H:%M"), "team": MY_TEAM, "opponents": sched},
              open("schedule.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    log(f"Fikstur: {sched}")

# ---------------- Dis kaynaklar (cerezsiz) ----------------
def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json",
                                                })
    return json.loads(urllib.request.urlopen(req, timeout=40).read().decode("utf-8"))

ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"

def espn_events(start, end):
    try:
        evs = get_json(f"{ESPN}/scoreboard?dates={start:%Y%m%d}-{end:%Y%m%d}&limit=1000").get("events", [])
        if evs:
            return evs
    except Exception as ex:
        log(f"ESPN aralik sorgusu olmadi ({ex}), gun gun cekiliyor")
    evs, day = [], start
    while day <= end:
        evs += get_json(f"{ESPN}/scoreboard?dates={day:%Y%m%d}").get("events", [])
        day += datetime.timedelta(days=1)
    return evs

TEAM_ABBR = {"Atlanta Hawks":"ATL","Boston Celtics":"BOS","Brooklyn Nets":"BKN","Charlotte Hornets":"CHA","Chicago Bulls":"CHI",
 "Cleveland Cavaliers":"CLE","Dallas Mavericks":"DAL","Denver Nuggets":"DEN","Detroit Pistons":"DET","Golden State Warriors":"GSW",
 "Houston Rockets":"HOU","Indiana Pacers":"IND","LA Clippers":"LAC","Los Angeles Clippers":"LAC","Los Angeles Lakers":"LAL",
 "Memphis Grizzlies":"MEM","Miami Heat":"MIA","Milwaukee Bucks":"MIL","Minnesota Timberwolves":"MIN","New Orleans Pelicans":"NOP",
 "New York Knicks":"NYK","Oklahoma City Thunder":"OKC","Orlando Magic":"ORL","Philadelphia 76ers":"PHI","Phoenix Suns":"PHX",
 "Portland Trail Blazers":"POR","Sacramento Kings":"SAC","San Antonio Spurs":"SAS","Toronto Raptors":"TOR","Utah Jazz":"UTA",
 "Washington Wizards":"WAS"}
ESPN_TO_YAHOO = {"GS":"GSW","NY":"NYK","NO":"NOP","SA":"SAS","UTAH":"UTA","WSH":"WAS","BRK":"BKN"}

def schedule_from_fixturedownload():
    for slug in ("nba-2026", "nba-2027"):
        try:
            d = get_json(f"https://fixturedownload.com/feed/json/{slug}")
        except Exception as ex:
            log(f"fixturedownload {slug}: {ex}"); continue
        days = {}
        for g in d:
            h, a_ = TEAM_ABBR.get(g.get("HomeTeam")), TEAM_ABBR.get(g.get("AwayTeam"))
            if not h or not a_:
                continue
            dt = datetime.datetime.strptime(g["DateUtc"].replace("Z", "").strip(), "%Y-%m-%d %H:%M:%S").replace(tzinfo=datetime.timezone.utc)
            days.setdefault(dt.astimezone(ET).date().isoformat(), []).append({"away": a_, "home": h})
        first = min(days) if days else ""
        if days and first >= "2026-10-01":
            log(f"Takvim fixturedownload/{slug}: {len(days)} gun, {sum(len(v) for v in days.values())} mac")
            return days
    return None

def scrape_nba_schedule():
    fn = "nba_schedule.json"
    if os.path.exists(fn):
        try:
            old = json.load(open(fn, encoding="utf-8"))
            age = NOW - datetime.datetime.strptime(old["updated"], "%Y-%m-%d %H:%M").replace(tzinfo=NOW.tzinfo)
            if old.get("full_season") and age.days < 7:
                log("NBA takvimi guncel, yeniden cekilmedi.")
                return old["days"]
        except Exception:
            pass
    days = schedule_from_fixturedownload()
    full = days is not None
    if not days:
        today = NOW.date();days = {}
        for ev in espn_events(today - datetime.timedelta(days=7), today + datetime.timedelta(days=35)):
            comp = ev["competitions"][0]
            t = {c["homeAway"]: ESPN_TO_YAHOO.get(c["team"]["abbreviation"], c["team"]["abbreviation"]) for c in comp["competitors"]}
            dt = datetime.datetime.fromisoformat(ev["date"].replace("Z", "+00:00")).astimezone(ET).date().isoformat()
            days.setdefault(dt, []).append({"id": ev["id"], "away": t.get("away"), "home": t.get("home"),
                                            "done": bool(comp["status"]["type"].get("completed"))})
    days = dict(sorted(days.items()))
    json.dump({"updated": NOW.strftime("%Y-%m-%d %H:%M"), "full_season": full, "note": "ABD (ET) tarihi, Yahoo kisaltmalari",
               "days": days}, open(fn, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    log(f"NBA takvimi: {len(days)} gun yazildi (tum sezon: {full}).")
    return days

def scrape_boxscores(days):
    os.makedirs("boxscores", exist_ok=True)
    today = NOW.date()
    for ds, games in days.items():
        dt = datetime.date.fromisoformat(ds)
        if not (today - datetime.timedelta(days=4) <= dt <= today):
            continue
        if games and "id" not in games[0]:
            try:
                games = [{"id": e["id"], "away": "", "home": "", "done": bool(e["competitions"][0]["status"]["type"].get("completed"))}
                         for e in get_json(f"{ESPN}/scoreboard?dates={dt:%Y%m%d}").get("events", [])]
            except Exception as ex:
                log(f"HATA ESPN gun {ds}: {ex}"); continue
        done = [g for g in games if g["done"]]
        if not done or not (today - datetime.timedelta(days=4) <= dt <= today):
            continue
        fn = f"boxscores/{ds}.json"
        old = json.load(open(fn, encoding="utf-8")) if os.path.exists(fn) else {"games": {}}
        if len(old.get("games", {})) >= len(done):
            continue
        out = old.get("games", {})
        for g in done:
            if g["id"] in out:
                continue
            try:
                j = get_json(f"{ESPN}/summary?event={g['id']}")
            except Exception as ex:
                log(f"HATA boxscore {g['id']}: {ex}"); continue
            pl = []
            for tm in j.get("boxscore", {}).get("players", []):
                ab = tm.get("team", {}).get("abbreviation")
                for st in tm.get("statistics", []):
                    lab = st.get("labels") or st.get("names") or []
                    for a in st.get("athletes", []):
                        r = {"n": a.get("athlete", {}).get("displayName"), "t": ab, "st": bool(a.get("starter"))}
                        if a.get("didNotPlay") or not a.get("stats"):
                            r["out"] = a.get("reason") or "DNP"
                        else:
                            v = dict(zip(lab, a["stats"]))
                            r.update({"min": v.get("MIN"), "pts": v.get("PTS"), "reb": v.get("REB"), "ast": v.get("AST"),
                                      "stl": v.get("STL"), "blk": v.get("BLK"), "to": v.get("TO"),
                                      "3pm": (v.get("3PT") or "").split("-")[0], "fg": v.get("FG"), "ft": v.get("FT")})
                        pl.append(r)
            out[g["id"]] = {"match": " / ".join(sorted({p["t"] for p in pl if p.get("t")})), "players": pl}
        json.dump({"date": ds, "games": out}, open(fn, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        log(f"Box score {ds}: {len(out)} mac.")
    for f in glob.glob("boxscores/*.json"):
        try:
            if datetime.date.fromisoformat(os.path.basename(f)[:10]) < today - datetime.timedelta(days=14):
                os.remove(f)
        except ValueError:
            pass

def scrape_injuries():
    d = get_json("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries")
    out = []
    for team in d.get("injuries", []):
        for i in team.get("injuries", []):
            ath = i.get("athlete", {})
            out.append({"name": ath.get("displayName"), "team": team.get("displayName"),
                        "status": i.get("status"), "date": i.get("date"),
                        "return": (i.get("details") or {}).get("returnDate"),
                        "type": (i.get("details") or {}).get("type"),
                        "note": i.get("shortComment") or i.get("longComment")})
    json.dump({"updated": NOW.strftime("%Y-%m-%d %H:%M"), "source": "ESPN", "injuries": out},
              open("injuries.json", "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    log(f"Sakatliklar: {len(out)} kayit.")

def write_manifest():
    files = {}
    for root, dirs, fs in os.walk("."):
        dirs[:] = [x for x in dirs if not x.startswith(".")]
        for f in fs:
            p = os.path.join(root, f)[2:]
            if p.endswith((".json", ".log")) and p != "index.json":
                files[p] = os.path.getsize(p)
    json.dump({"updated": NOW.strftime("%Y-%m-%d %H:%M"), "files": dict(sorted(files.items()))},
              open("index.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)

# ---------------- Lig sayfalari: yoneticiler, takim istatistikleri, sakatliklar, ayarlar, gunluk kadrolar ----------------
GAME_RX = re.compile(r"(\d{1,2}:\d{2}\s*[ap]m)\s*(@|vs)\s*([A-Z]{2,4})")

def save(fn, obj):
    json.dump(obj, open(fn, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

def scrape_league_pages(ids):
    stamp = NOW.strftime("%Y-%m-%d %H:%M")
    for name, path, fn in (("yoneticiler", "/teams", "managers.json"),
                           ("takim kayitlari", "/headtoheadstats?pt=P&type=record", "teamstats_record.json"),
                           ("takim toplamlari", "/headtoheadstats?pt=P&type=stats", "teamstats_totals.json")):
        try:
            tabs = generic_tables(fetch(path))
            save(fn, {"updated": stamp, "tables": tabs})
            log(f"{name}: {sum(len(t['rows']) for t in tabs)} satir.")
        except SystemExit:
            raise
        except Exception as ex:
            log(f"HATA {name}: {ex}")
    try:
        html = fetch("/settings")
        soup = BeautifulSoup(html, "html.parser"); kv = {}
        for tr in soup.find_all("tr"):
            c = [x.get_text(" ", strip=True) for x in tr.find_all(["td", "th"])]
            if len(c) == 2 and c[0] and c[0] != "Setting":
                kv[c[0].rstrip(":")] = c[1]
        save("settings.json", {"updated": stamp, "settings": kv})
        log(f"Ayarlar: {len(kv)} satir.")
    except SystemExit:
        raise
    except Exception as ex:
        log(f"HATA ayarlar: {ex}")
    try:
        soup = BeautifulSoup(fetch("/injuries"), "html.parser"); inj = []
        for tr in soup.find_all("tr"):
            a = tr.find("a", class_=re.compile("name"))
            tds = tr.find_all("td")
            if not a or len(tds) < 3:
                continue
            rec = {"name": a.get_text(strip=True), "note": tds[-2].get_text(" ", strip=True), "status": tds[-1].get_text(" ", strip=True)}
            m = POSRX.search(tr.get_text(" ", strip=True))
            if m:
                rec["nba"], rec["pos"] = m.group(1), m.group(2)
            inj.append(rec)
        save("injuries_yahoo.json", {"updated": stamp, "injuries": inj})
        log(f"Yahoo sakatliklar: {len(inj)} kayit.")
    except SystemExit:
        raise
    except Exception as ex:
        log(f"HATA Yahoo sakatliklar: {ex}")
    names = set(ids.values()); days = {}
    start = NOW.astimezone(ET).date()
    for i in range(8):
        ds = (start + datetime.timedelta(days=i)).isoformat()
        try:
            html = fetch(f"/startingrosters?date={ds}")
            if i == 0:
                open("probe_startingrosters.html", "w", encoding="utf-8").write(html)
            soup = BeautifulSoup(html, "html.parser"); teams = {}
            for tb in soup.find_all("table"):
                prev = tb.find_previous(lambda tag: tag.name == "a" and tag.get_text(strip=True) in names)
                if not prev:
                    continue
                team = prev.get_text(strip=True); rows = []
                for tr in tb.find_all("tr"):
                    a = tr.find("a", class_=re.compile("name")) or tr.find("a", href=re.compile(r"/players?/\d+"))
                    tds = tr.find_all("td")
                    if not a or not tds:
                        continue
                    txt = tr.get_text(" ", strip=True)
                    r = {"slot": tds[0].get_text(" ", strip=True).split(" ")[0], "name": a.get_text(strip=True)}
                    m = POSRX.search(txt)
                    if m:
                        r["nba"], r["pos"] = m.group(1), m.group(2)
                    g = GAME_RX.search(txt)
                    if g:
                        r["game"] = f"{g.group(2)} {g.group(3)} {g.group(1)}"
                    inj = tr.find("span", class_=re.compile("F-injury"))
                    if inj:
                        r["status"] = inj.get_text(strip=True)
                    rows.append(r)
                if rows:
                    teams[team] = rows
            days[ds] = teams
            log(f"Gunluk kadro {ds}: {len(teams)} takim, {sum(1 for t in teams.values() for r in t if 'game' in r)} maci olan oyuncu.")
        except SystemExit:
            raise
        except Exception as ex:
            log(f"HATA gunluk kadro {ds}: {ex}")
    save("startingrosters.json", {"updated": stamp, "note": "Yahoo tarihleri (ABD saati)", "days": days})

def main():
    if not COOKIE and not LOCAL:
        log("HATA: YAHOO_COOKIE secret'i yok."); finish(1)
    home = fetch("")
    links = matchup_links(home)
    if not links:
        log("HATA: lig sayfasinda eslesme bulunamadi."); finish(1)
    current = int(links[0][0])
    log(f"Guncel hafta: {current}")

    data = json.load(open("data.json", encoding="utf-8"))
    data.pop("_diag", None)
    weeks = data.setdefault("weeks", {})
    failed = False

    todo = [current]
    prev = str(current - 1)
    if prev in weeks and "(final)" not in weeks[prev].get("updated", ""):
        todo.insert(0, current - 1)
    for wk in todo:
        wlinks = links if wk == current else [(str(wk), m1, m2) for _, m1, m2 in links]
        try:
            teams, label = week_data(wk, wlinks)
        except Exception as ex:
            log(f"HATA hafta {wk}: {ex}"); failed = True; continue
        ref = weeks.get(str(wk)) or weeks.get(str(wk - 1))
        errs = check(teams, [t["team"] for t in ref["teams"]] if ref else None)
        if errs:
            log(f"HATA hafta {wk}, dosyaya yazilmadi: " + " | ".join(errs)); failed = True; continue
        weeks[str(wk)] = {"label": label, "updated": updated_str(final=wk < current), "teams": teams}
        if wk == current:
            weeks[str(wk)]["pairs"] = [[teams[i]["team"], teams[i + 1]["team"]] for i in range(0, len(teams) - 1, 2)]
        log(f"Hafta {wk} yazildi: {label} | {weeks[str(wk)]['updated']}")

    ids = team_ids(home)
    for wk in sorted(weeks, key=int):
        if not weeks[wk].get("pairs") and len(ids) == 16:
            try:
                weeks[wk]["pairs"] = week_pairs(int(wk), ids)
                log(f"Hafta {wk} eslesmeleri: {weeks[wk]['pairs']}")
            except SystemExit:
                raise
            except Exception as ex:
                log(f"HATA eslesmeler hafta {wk}: {ex}")
    data["weeks"] = dict(sorted(weeks.items(), key=lambda kv: int(kv[0])))
    try:
        compute_standings(data)
    except Exception as ex:
        log(f"HATA puan durumu: {ex}")
    with open("data.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1); f.write("\n")

    # Islemler
    try:
        new = parse_transactions(fetch("/transactions"))
        old = json.load(open("transactions.json", encoding="utf-8")) if os.path.exists("transactions.json") else []
        seen = {tx_key(e) for e in old}
        added = [e for e in new if tx_key(e) not in seen]
        if added:
            allx = sorted(added + old, key=lambda e: e["time"], reverse=True)
            with open("transactions.json", "w", encoding="utf-8") as f:
                f.write("[\n" + ",\n".join("  " + json.dumps(e, ensure_ascii=False, separators=(",", ":")) for e in allx) + "\n]\n")
        log(f"Islemler: {len(added)} yeni kayit eklendi.")
        for e in added:
            log("  + " + json.dumps(e, ensure_ascii=False))
    except Exception as ex:
        log(f"HATA islemler: {ex}"); failed = True

    try:
        scrape_rosters(home)
    except SystemExit:
        raise
    except Exception as ex:
        log(f"HATA kadrolar: {ex}")

    try:
        scrape_league_pages(team_ids(home))
    except SystemExit:
        raise
    except Exception as ex:
        log(f"HATA lig sayfalari: {ex}")
    for name, fn in (("fikstur", lambda: scrape_schedule(current)),
                     ("oyuncular", scrape_players)):
        try:
            fn()
        except SystemExit:
            raise
        except Exception as ex:
            log(f"HATA {name}: {ex}")
    days = {}
    try:
        days = scrape_nba_schedule()
    except Exception as ex:
        log(f"HATA NBA takvimi: {ex}")
    for name, fn in (("box score", lambda: scrape_boxscores(days)), ("sakatliklar", scrape_injuries)):
        try:
            fn()
        except Exception as ex:
            log(f"HATA {name}: {ex}")
    write_manifest()

    finish(1 if failed else 0)

if __name__ == "__main__":
    main()
