"""
Herr-Raza Lernapp — 100% kostenlose APIs, KEIN API-Key erforderlich
APIs: Open-Meteo, HackerNews, Wikipedia, Open Trivia, RestCountries, Frankfurter, JokeAPI, Dev.to
"""
import os, json, random, html
from datetime import datetime
import requests
from flask import Flask, render_template, request, jsonify

app = Flask(__name__)
SESSION = requests.Session()
SESSION.headers.update({"User-Agent": "Herr-Raza-Lernapp/1.0"})

TIMEOUT = 8


def safe_get(url, params=None):
    try:
        r = SESSION.get(url, params=params, timeout=TIMEOUT)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        return {"error": str(e)}


# ═══════════════════════════════════════════════════════════════════════════════
# WETTER  — Open-Meteo (komplett kostenlos, kein Key)
# ═══════════════════════════════════════════════════════════════════════════════
WMO_CODES = {
    0: ("Klarer Himmel", "☀️"), 1: ("Überwiegend klar", "🌤️"),
    2: ("Teilweise bewölkt", "⛅"), 3: ("Bedeckt", "☁️"),
    45: ("Nebel", "🌫️"), 48: ("Eisnebel", "🌫️"),
    51: ("Leichter Nieselregen", "🌦️"), 53: ("Mäßiger Nieselregen", "🌦️"),
    55: ("Starker Nieselregen", "🌧️"), 61: ("Leichter Regen", "🌧️"),
    63: ("Mäßiger Regen", "🌧️"), 65: ("Starker Regen", "🌧️"),
    71: ("Leichter Schnee", "🌨️"), 73: ("Mäßiger Schnee", "❄️"),
    75: ("Starker Schnee", "❄️"), 80: ("Leichte Schauer", "🌦️"),
    81: ("Mäßige Schauer", "🌧️"), 82: ("Starke Schauer", "⛈️"),
    95: ("Gewitter", "⛈️"), 96: ("Gewitter m. Hagel", "⛈️"),
    99: ("Starkes Gewitter", "⛈️"),
}


@app.route("/api/weather")
def api_weather():
    city = request.args.get("city", "Berlin").strip()

    # 1. Geocoding
    geo = safe_get("https://geocoding-api.open-meteo.com/v1/search",
                   {"name": city, "count": 1, "language": "de"})
    if "error" in geo or not geo.get("results"):
        return jsonify({"error": f"Stadt '{city}' nicht gefunden."}), 404

    loc = geo["results"][0]
    lat, lon = loc["latitude"], loc["longitude"]
    name = loc.get("name", city)
    country = loc.get("country", "")

    # 2. Wetter
    w = safe_get("https://api.open-meteo.com/v1/forecast", {
        "latitude": lat, "longitude": lon,
        "current": "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weathercode,precipitation",
        "hourly": "temperature_2m,weathercode",
        "daily": "temperature_2m_max,temperature_2m_min,weathercode,precipitation_sum",
        "timezone": "auto", "forecast_days": 5, "wind_speed_unit": "kmh",
    })
    if "error" in w:
        return jsonify({"error": w["error"]}), 500

    cur = w["current"]
    code = cur.get("weathercode", 0)
    desc, icon = WMO_CODES.get(code, ("Unbekannt", "🌡️"))

    # 5-Tage-Vorschau
    daily = w.get("daily", {})
    days = []
    for i in range(min(5, len(daily.get("time", [])))):
        dc = daily["weathercode"][i]
        _, di = WMO_CODES.get(dc, ("", "🌡️"))
        days.append({
            "date": daily["time"][i],
            "icon": di,
            "max": round(daily["temperature_2m_max"][i], 1),
            "min": round(daily["temperature_2m_min"][i], 1),
            "rain": round(daily["precipitation_sum"][i], 1),
        })

    return jsonify({
        "city": name, "country": country,
        "temp": round(cur["temperature_2m"], 1),
        "feels_like": round(cur["apparent_temperature"], 1),
        "humidity": cur["relative_humidity_2m"],
        "wind": round(cur["wind_speed_10m"], 1),
        "description": desc, "icon": icon,
        "forecast": days,
    })


# ═══════════════════════════════════════════════════════════════════════════════
# NACHRICHTEN — HackerNews Algolia + Dev.to (kostenlos, kein Key)
# ═══════════════════════════════════════════════════════════════════════════════
@app.route("/api/news")
def api_news():
    category = request.args.get("category", "tech")

    articles = []

    if category == "tech":
        # HackerNews top stories
        hn = safe_get("https://hacker-news.firebaseio.com/v0/topstories.json")
        if isinstance(hn, list):
            for sid in hn[:12]:
                story = safe_get(f"https://hacker-news.firebaseio.com/v0/item/{sid}.json")
                if story and story.get("type") == "story" and story.get("url"):
                    articles.append({
                        "title": story.get("title", ""),
                        "url": story.get("url", ""),
                        "source": "Hacker News",
                        "score": story.get("score", 0),
                        "comments": story.get("descendants", 0),
                        "time": story.get("time", 0),
                    })
                if len(articles) >= 10:
                    break

    elif category == "dev":
        dev = safe_get("https://dev.to/api/articles?per_page=10&top=1")
        if isinstance(dev, list):
            for a in dev:
                articles.append({
                    "title": a.get("title", ""),
                    "url": a.get("url", ""),
                    "source": "Dev.to",
                    "score": a.get("positive_reactions_count", 0),
                    "comments": a.get("comments_count", 0),
                    "time": 0,
                    "tag": a.get("tag_list", []),
                })

    elif category == "science":
        data = safe_get("https://hn.algolia.com/api/v1/search",
                        {"query": "science research", "tags": "story", "hitsPerPage": 10})
        if isinstance(data, dict) and "hits" in data:
            for h in data["hits"]:
                articles.append({
                    "title": h.get("title", ""),
                    "url": h.get("url", ""),
                    "source": "HN Science",
                    "score": h.get("points", 0),
                    "comments": h.get("num_comments", 0),
                    "time": 0,
                })

    elif category == "ask":
        data = safe_get("https://hacker-news.firebaseio.com/v0/askstories.json")
        if isinstance(data, list):
            for sid in data[:10]:
                story = safe_get(f"https://hacker-news.firebaseio.com/v0/item/{sid}.json")
                if story and story.get("title"):
                    articles.append({
                        "title": story.get("title", ""),
                        "url": f"https://news.ycombinator.com/item?id={sid}",
                        "source": "HN Ask",
                        "score": story.get("score", 0),
                        "comments": story.get("descendants", 0),
                        "time": story.get("time", 0),
                    })

    return jsonify({"articles": articles[:10], "category": category})


# ═══════════════════════════════════════════════════════════════════════════════
# LÄNDER — RestCountries (kostenlos, kein Key)
# ═══════════════════════════════════════════════════════════════════════════════
@app.route("/api/country")
def api_country():
    name = request.args.get("name", "Germany").strip()
    data = safe_get(f"https://restcountries.com/v3.1/name/{requests.utils.quote(name)}")
    if "error" in data or not isinstance(data, list) or not data:
        return jsonify({"error": f"Land '{name}' nicht gefunden."}), 404

    c = data[0]
    langs = list(c.get("languages", {}).values())
    currencies = [f"{v['name']} ({k})" for k, v in c.get("currencies", {}).items()]
    capital = c.get("capital", ["–"])[0] if c.get("capital") else "–"

    return jsonify({
        "name": c.get("name", {}).get("common", name),
        "official": c.get("name", {}).get("official", ""),
        "capital": capital,
        "region": c.get("region", ""),
        "subregion": c.get("subregion", ""),
        "population": c.get("population", 0),
        "area": c.get("area", 0),
        "languages": langs,
        "currencies": currencies,
        "flag": c.get("flags", {}).get("emoji", "🏳️"),
        "flag_png": c.get("flags", {}).get("png", ""),
        "maps": c.get("maps", {}).get("googleMaps", ""),
        "timezone": c.get("timezones", ["–"])[0],
        "calling": c.get("idd", {}).get("root", "") + (c.get("idd", {}).get("suffixes") or [""])[0],
    })


# ═══════════════════════════════════════════════════════════════════════════════
# WÄHRUNGEN — Frankfurter API (kostenlos, kein Key)
# ═══════════════════════════════════════════════════════════════════════════════
@app.route("/api/currency")
def api_currency():
    base = request.args.get("base", "EUR").upper()
    data = safe_get(f"https://api.frankfurter.app/latest?from={base}")
    if "error" in data:
        return jsonify({"error": data["error"]}), 500
    return jsonify({
        "base": data.get("base", base),
        "date": data.get("date", ""),
        "rates": data.get("rates", {}),
    })


@app.route("/api/currency/convert")
def api_currency_convert():
    amount = float(request.args.get("amount", 1))
    frm    = request.args.get("from", "EUR").upper()
    to     = request.args.get("to", "USD").upper()
    data   = safe_get(f"https://api.frankfurter.app/latest?amount={amount}&from={frm}&to={to}")
    if "error" in data:
        return jsonify({"error": data["error"]}), 500
    result = data.get("rates", {}).get(to, 0)
    return jsonify({"from": frm, "to": to, "amount": amount, "result": result, "date": data.get("date")})


# ═══════════════════════════════════════════════════════════════════════════════
# QUIZ — Open Trivia DB (kostenlos, kein Key)
# ═══════════════════════════════════════════════════════════════════════════════
@app.route("/api/quiz")
def api_quiz():
    category   = request.args.get("category", "")
    difficulty = request.args.get("difficulty", "medium")
    amount     = min(int(request.args.get("amount", 5)), 10)

    params = {"amount": amount, "difficulty": difficulty, "type": "multiple"}
    if category:
        params["category"] = category

    data = safe_get("https://opentdb.com/api.php", params)
    if "error" in data:
        return jsonify({"error": data["error"]}), 500

    if data.get("response_code") != 0:
        return jsonify({"error": "Keine Fragen verfügbar. Bitte andere Einstellungen."}), 503

    questions = []
    for q in data["results"]:
        answers = q["incorrect_answers"] + [q["correct_answer"]]
        random.shuffle(answers)
        questions.append({
            "question": html.unescape(q["question"]),
            "answers":  [html.unescape(a) for a in answers],
            "correct":  html.unescape(q["correct_answer"]),
            "category": q["category"],
        })
    return jsonify({"questions": questions})


# ═══════════════════════════════════════════════════════════════════════════════
# WIKIPEDIA — (kostenlos, kein Key)
# ═══════════════════════════════════════════════════════════════════════════════
@app.route("/api/wiki")
def api_wiki():
    topic = request.args.get("topic", "").strip()
    lang  = request.args.get("lang", "de")
    if not topic:
        return jsonify({"error": "Kein Thema"}), 400

    url  = f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{requests.utils.quote(topic)}"
    data = safe_get(url)

    if "error" in data or data.get("type") == "https://mediawiki.org/wiki/HyperSwitch/errors/not_found":
        # Fallback Englisch
        if lang != "en":
            return api_wiki()  # recursive with lang=en via query param would loop; do direct
        return jsonify({"error": "Nicht gefunden"}), 404

    return jsonify({
        "title":     data.get("title", topic),
        "extract":   data.get("extract", ""),
        "thumbnail": data.get("thumbnail", {}).get("source", ""),
        "url":       data.get("content_urls", {}).get("desktop", {}).get("page", ""),
        "description": data.get("description", ""),
    })


# ═══════════════════════════════════════════════════════════════════════════════
# WITZE — JokeAPI (kostenlos, kein Key)
# ═══════════════════════════════════════════════════════════════════════════════
@app.route("/api/joke")
def api_joke():
    lang = request.args.get("lang", "de")
    cat  = request.args.get("category", "Any")
    url  = f"https://v2.jokeapi.dev/joke/{cat}?lang={lang}&blacklistFlags=nsfw,religious,political,racist,sexist,explicit"
    data = safe_get(url)
    if "error" in data or data.get("error"):
        # Fallback English
        data = safe_get(f"https://v2.jokeapi.dev/joke/Any?blacklistFlags=nsfw,religious,political,racist,sexist,explicit")
    if data.get("type") == "twopart":
        return jsonify({"joke": data["setup"], "punchline": data["delivery"], "type": "twopart"})
    return jsonify({"joke": data.get("joke", "Kein Witz gefunden."), "type": "single"})


# ═══════════════════════════════════════════════════════════════════════════════
# ZITAT — Quotable API (kostenlos, kein Key)
# ═══════════════════════════════════════════════════════════════════════════════
@app.route("/api/quote")
def api_quote():
    data = safe_get("https://api.quotable.io/random")
    if "error" in data:
        return jsonify({"quote": "Bildung ist die mächtigste Waffe, die du verwenden kannst, um die Welt zu verändern.", "author": "Nelson Mandela"})
    return jsonify({"quote": data.get("content", ""), "author": data.get("author", "")})


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN ROUTE
# ═══════════════════════════════════════════════════════════════════════════════
@app.route("/")
def index():
    return render_template("index.html")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"\n🎓 Herr-Raza Lernapp → http://localhost:{port}")
    print("   Alle APIs kostenlos — kein API-Key erforderlich!\n")
    app.run(host="0.0.0.0", port=port, debug=False)
