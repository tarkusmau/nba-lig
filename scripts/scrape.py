"""Yahoo Fantasy sayfalarini (giris cerezi ile) okuyup data.json ve transactions.json'u gunceller."""
import datetime, json, os, re, sys, urllib.request
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

    finish(1 if failed else 0)

if __name__ == "__main__":
    main()
