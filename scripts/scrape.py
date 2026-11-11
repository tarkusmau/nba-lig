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
        t, d = parse_matchup(fetch(f"/matchup?week={w}&mid1={m1}&mid2={m2}"))
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
        tp = tr.find("span", class_=re.compile("Fz-xxs"))
        if tp:
            txt = tp.get_text(" ", strip=True)
            if " - " in txt:
                rec["nba"], rec["pos"] = [x.strip() for x in txt.split(" - ", 1)]
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
        tp = tr.find("span", class_=re.compile("Fz-xxs"))
        if tp and " - " in tp.get_text(" ", strip=True):
            rec["nba"], rec["pos"] = [x.strip() for x in tp.get_text(" ", strip=True).split(" - ", 1)]
        inj = tr.find("span", class_=re.compile("F-injury"))
        if inj:
            rec["status"] = inj.get_text(strip=True)
        if rec["name"] not in [r["name"] for r in out]:
            out.append(rec)
    return out

def parse_draft(html, ids):
    soup = BeautifulSoup(html, "html.parser")
    out = []
    for tr in soup.find_all("tr"):
        a = tr.find("a", class_=re.compile("name")) or tr.find("a", href=re.compile(r"/players?/\d+"))
        cost = re.search(r"\$(\d+)", tr.get_text(" ", strip=True))
        if not a or not cost:
            continue
        team = ""
        ta = tr.find("a", href=re.compile(r"/nba/%s/\d{1,2}$" % LEAGUE))
        if ta:
            team = ta.get_text(strip=True) or ids.get(int(ta["href"].rstrip("/").split("/")[-1]), "")
        if not team:
            team = (tr.get("title") or "").strip() or tr.find_all("td")[-1].get_text(" ", strip=True)
        out.append({"name": a.get_text(strip=True), "cost": int(cost.group(1)), "team": team})
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
    cost = {d["name"]: d["cost"] for d in draft}
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
                r["draft"] = cost.get(r["name"], "FA")
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

def scrape_standings():
    html = fetch("/standings")
    open("probe_standings.html", "w", encoding="utf-8").write(html)
    tabs = generic_tables(html)
    json.dump({"updated": NOW.strftime("%Y-%m-%d %H:%M"), "tables": tabs},
              open("standings.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    log(f"Puan durumu: {len(tabs)} tablo yazildi.")

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
                                                "Referer": "https://www.nba.com/", "Origin": "https://www.nba.com"})
    return json.loads(urllib.request.urlopen(req, timeout=40).read().decode("utf-8"))

YAHOO_ABBR = {"GSW": "GS", "NYK": "NY", "NOP": "NO", "SAS": "SA", "PHX": "PHO"}

def scrape_nba_schedule():
    d = get_json("https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json")
    today = NOW.date()
    days = {}
    for gd in d["leagueSchedule"]["gameDates"]:
        dt = datetime.datetime.strptime(gd["gameDate"].split(" ")[0], "%m/%d/%Y").date()
        if not (today - datetime.timedelta(days=21) <= dt <= today + datetime.timedelta(days=28)):
            continue
        games = []
        for g in gd["games"]:
            a, h = g["awayTeam"].get("teamTricode"), g["homeTeam"].get("teamTricode")
            if a and h:
                games.append({"id": g["gameId"], "away": a, "home": h, "status": g.get("gameStatus")})
        if games:
            days[dt.isoformat()] = games
    json.dump({"updated": NOW.strftime("%Y-%m-%d %H:%M"), "note_dates": "ABD (ET) tarihi",
               "yahoo_abbr": YAHOO_ABBR, "days": days},
              open("nba_schedule.json", "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    log(f"NBA takvimi: {len(days)} gun yazildi.")
    return days

def mins(v):
    m = re.match(r"PT(\d+)M([\d.]+)S", v or "")
    return round(int(m.group(1)) + float(m.group(2)) / 60, 1) if m else 0

def scrape_boxscores(days):
    os.makedirs("boxscores", exist_ok=True)
    today = NOW.date()
    for ds, games in sorted(days.items()):
        dt = datetime.date.fromisoformat(ds)
        if not (today - datetime.timedelta(days=4) <= dt < today + datetime.timedelta(days=1)):
            continue
        fn = f"boxscores/{ds}.json"
        done = [g for g in games if g["status"] == 3]
        if not done:
            continue
        old = json.load(open(fn, encoding="utf-8")) if os.path.exists(fn) else {}
        if old and len(old.get("games", {})) >= len(done):
            continue
        out = {}
        for g in done:
            try:
                b = get_json(f"https://cdn.nba.com/static/json/liveData/boxscore/boxscore_{g['id']}.json")["game"]
            except Exception as ex:
                log(f"HATA boxscore {g['id']}: {ex}"); continue
            pl = []
            for side in ("awayTeam", "homeTeam"):
                tm = b[side]["teamTricode"]
                for p in b[side]["players"]:
                    s = p.get("statistics", {})
                    r = {"n": p.get("name"), "t": tm, "st": p.get("starter") == "1", "min": mins(s.get("minutes"))}
                    if r["min"] > 0:
                        r.update({"pts": s.get("points"), "reb": s.get("reboundsTotal"), "ast": s.get("assists"),
                                  "stl": s.get("steals"), "blk": s.get("blocks"), "3pm": s.get("threePointersMade"),
                                  "to": s.get("turnovers"), "fg": f"{s.get('fieldGoalsMade')}/{s.get('fieldGoalsAttempted')}",
                                  "ft": f"{s.get('freeThrowsMade')}/{s.get('freeThrowsAttempted')}"})
                    elif p.get("notPlayingReason") or p.get("status") == "INACTIVE":
                        r["out"] = p.get("notPlayingDescription") or p.get("notPlayingReason") or "INACTIVE"
                    pl.append(r)
            out[g["id"]] = {"match": f"{g['away']}@{g['home']}", "players": pl}
        if out:
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
        pairs = [[teams[i]["team"], teams[i + 1]["team"]] for i in range(0, len(teams) - 1, 2)]
        weeks[str(wk)] = {"label": label, "updated": updated_str(final=wk < current), "teams": teams, "pairs": pairs}
        log(f"Hafta {wk} yazildi: {label} | {weeks[str(wk)]['updated']}")

    data["weeks"] = dict(sorted(weeks.items(), key=lambda kv: int(kv[0])))
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

    for name, fn in (("puan durumu", scrape_standings), ("fikstur", lambda: scrape_schedule(current)),
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
