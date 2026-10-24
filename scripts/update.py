"""Yahoo Fantasy API'den haftalık kategori toplamlarını çekip data.json'a yazar."""
import base64, hashlib, json, os, sys, datetime
import xml.etree.ElementTree as ET
import requests
from cryptography.fernet import Fernet

CID = os.environ["YAHOO_CLIENT_ID"]; CSEC = os.environ["YAHOO_CLIENT_SECRET"]
KEY = os.environ.get("ENC_KEY", ""); CODE = os.environ.get("YAHOO_AUTH_CODE", "").strip()
LEAGUE = os.environ.get("LEAGUE_ID", "71722")
REDIRECT = "https://localhost"
TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token"
NS = {"y": "http://fantasysports.yahooapis.com/fantasy/v2/base.rng"}
if not KEY:
    sys.exit("ENC_KEY secret eksik.")
fern = Fernet(base64.urlsafe_b64encode(hashlib.sha256(KEY.encode()).digest()))

def token_request(data):
    r = requests.post(TOKEN_URL, data=data, auth=(CID, CSEC), timeout=30)
    if r.status_code != 200:
        sys.exit(f"Yahoo token hatası {r.status_code}: {r.text[:300]}")
    return r.json()

def get_access_token():
    tok = None
    if os.path.exists("token.enc"):
        try:
            refresh = fern.decrypt(open("token.enc", "rb").read()).decode()
            tok = token_request({"grant_type": "refresh_token", "refresh_token": refresh, "redirect_uri": REDIRECT})
        except Exception as e:
            print("Kayıtlı anahtar kullanılamadı:", str(e)[:200])
    if tok is None:
        if not CODE:
            sys.exit("İlk kurulum için YAHOO_AUTH_CODE secret gerekli.")
        tok = token_request({"grant_type": "authorization_code", "code": CODE, "redirect_uri": REDIRECT})
    open("token.enc", "wb").write(fern.encrypt(tok["refresh_token"].encode()))
    print("Token alındı. Alanlar:", sorted(k for k in tok if k not in ("access_token","refresh_token","id_token")),
          "| scope:", tok.get("scope"), "| tip:", tok.get("token_type"))
    return tok["access_token"]

AT = get_access_token()
def api(path):
    r = requests.get("https://fantasysports.yahooapis.com/fantasy/v2/" + path,
                     headers={"Authorization": "Bearer " + AT}, timeout=30)
    if r.status_code != 200:
        sys.exit(f"Yahoo API hatası {r.status_code} ({path}): {r.text[:300]}")
    return ET.fromstring(r.content)

for test in ("game/nba", "users;use_login=1"):
    r = requests.get("https://fantasysports.yahooapis.com/fantasy/v2/" + test, headers={"Authorization": "Bearer " + AT}, timeout=30)
    print("TEST", test, "->", r.status_code, r.text[:160].replace("\n", " "))
# Liginin tam anahtarını (ör. 466.l.71722) kullanıcının liglerinden bul
league_key = None
try:
    ul = api("users;use_login=1/games;game_codes=nba/leagues")
    for l in ul.iterfind(".//y:league", NS):
        if l.findtext("y:league_id", namespaces=NS) == LEAGUE:
            league_key = l.findtext("y:league_key", namespaces=NS)
except SystemExit as e:
    print("Kullanıcı ligleri okunamadı:", e)
if not league_key:
    sys.exit("Lig bulunamadı: Yahoo hesabının bu ligde olduğundan ve uygulamanın Fantasy Sports izni olduğundan emin ol.")
print("Lig anahtarı:", league_key)
lg = api(f"league/{league_key}").find("y:league", NS)
current = int(lg.findtext("y:current_week", default="1", namespaces=NS))
start = int(lg.findtext("y:start_week", default="1", namespaces=NS))
lname = lg.findtext("y:name", default="Lig", namespaces=NS)

def num(v):
    try: return float(v)
    except: return 0.0
def pair(v):
    try:
        a, b = v.split("/"); return int(a), int(b)
    except: return 0, 0

weeks = {}
for wk in range(start, current + 1):
    root = api(f"league/{league_key}/scoreboard;week={wk}")
    teams, ws, we = [], None, None
    for m in root.iterfind(".//y:matchup", NS):
        ws = ws or m.findtext("y:week_start", namespaces=NS)
        we = we or m.findtext("y:week_end", namespaces=NS)
        for t in m.iterfind("y:teams/y:team", NS):
            st = {s.findtext("y:stat_id", namespaces=NS): s.findtext("y:value", default="", namespaces=NS)
                  for s in t.iterfind("y:team_stats/y:stats/y:stat", NS)}
            fgm, fga = pair(st.get("9004003", "")); ftm, fta = pair(st.get("9007006", ""))
            tot = t.find("y:team_remaining_games/y:total", NS)
            gp = None
            if tot is not None:
                gp = int(num(tot.findtext("y:completed_games", default="0", namespaces=NS)) + num(tot.findtext("y:live_games", default="0", namespaces=NS)))
            teams.append({"team": t.findtext("y:name", namespaces=NS), "gp": gp,
                          "fgm": fgm, "fga": fga, "ftm": ftm, "fta": fta,
                          "tpm": int(num(st.get("10"))), "pts": int(num(st.get("12"))), "reb": int(num(st.get("15"))),
                          "ast": int(num(st.get("16"))), "st": int(num(st.get("17"))), "blk": int(num(st.get("18"))),
                          "to": int(num(st.get("19")))})
    if not teams:
        continue
    def d(s):
        try: return datetime.date.fromisoformat(s).strftime("%d.%m")
        except: return ""
    label = f"Hafta {wk}" + (f" ({d(ws)}–{d(we)})" if ws and we else "")
    weeks[str(wk)] = {"label": label, "teams": teams}

now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=3)))
for w in weeks.values():
    w["updated"] = now.strftime("%d.%m.%Y %H:%M")
json.dump({"league": lname, "weeks": weeks}, open("data.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"{len(weeks)} hafta yazıldı (güncel hafta {current}).")
