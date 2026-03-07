"""
Herr-Raza Lernapp — KI-gestützte Lernplattform für den Unterricht
Verwendet kostenlose APIs: Wikipedia, Open Trivia DB + Claude Haiku (optional)
"""
import os
import json
import random
import requests
from flask import Flask, render_template, request, jsonify

app = Flask(__name__)

# ── Anthropic (optional) ─────────────────────────────────────────────────────
try:
    import anthropic
    _anthropic_client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
    AI_AVAILABLE = bool(os.environ.get("ANTHROPIC_API_KEY"))
except ImportError:
    _anthropic_client = None
    AI_AVAILABLE = False

MODEL = "claude-haiku-4-5"   # Günstigstes Modell ~$0.001 pro Anfrage

# ── Hilfsfunktionen ──────────────────────────────────────────────────────────

def ask_claude(system: str, user: str, max_tokens: int = 1024) -> str:
    """Sendet eine Anfrage an Claude Haiku."""
    if not AI_AVAILABLE or not _anthropic_client:
        return "KI-Tutor nicht verfügbar. Bitte ANTHROPIC_API_KEY setzen."
    try:
        response = _anthropic_client.messages.create(
            model=MODEL,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        return response.content[0].text
    except Exception as exc:
        return f"Fehler beim KI-Tutor: {exc}"


def get_wikipedia_summary(topic: str, lang: str = "de") -> dict:
    """Holt eine Wikipedia-Zusammenfassung (komplett kostenlos)."""
    url = f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{requests.utils.quote(topic)}"
    try:
        r = requests.get(url, timeout=8)
        if r.status_code == 200:
            data = r.json()
            return {
                "title": data.get("title", topic),
                "extract": data.get("extract", "Kein Inhalt gefunden."),
                "thumbnail": data.get("thumbnail", {}).get("source", ""),
                "url": data.get("content_urls", {}).get("desktop", {}).get("page", ""),
            }
        # Fallback zu Englisch
        if lang != "en":
            return get_wikipedia_summary(topic, lang="en")
    except Exception:
        pass
    return {"title": topic, "extract": "Wikipedia nicht erreichbar.", "thumbnail": "", "url": ""}


def get_trivia_questions(category_id: int | None, difficulty: str, amount: int = 5) -> list:
    """
    Holt Quizfragen von Open Trivia DB (komplett kostenlos, kein API-Key nötig).
    Kategorien: 9=Allgemeinwissen, 17=Wissenschaft, 23=Geschichte, 18=Informatik,
                21=Sport, 22=Geografie, 25=Kunst, 26=Prominente
    """
    url = "https://opentdb.com/api.php"
    params = {"amount": amount, "difficulty": difficulty, "type": "multiple"}
    if category_id:
        params["category"] = category_id
    try:
        r = requests.get(url, params=params, timeout=8)
        if r.status_code == 200:
            data = r.json()
            if data.get("response_code") == 0:
                questions = []
                for q in data["results"]:
                    answers = q["incorrect_answers"] + [q["correct_answer"]]
                    random.shuffle(answers)
                    questions.append({
                        "question": q["question"],
                        "answers": answers,
                        "correct": q["correct_answer"],
                        "category": q["category"],
                        "difficulty": q["difficulty"],
                    })
                return questions
    except Exception:
        pass
    return []


# ── Routen ───────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html", ai_available=AI_AVAILABLE)


@app.route("/api/quiz", methods=["POST"])
def api_quiz():
    """Liefert Quizfragen (Open Trivia DB oder KI-generiert)."""
    data = request.get_json()
    mode = data.get("mode", "trivia")       # "trivia" | "ai"
    topic = data.get("topic", "")
    category_id = data.get("category_id")  # Open Trivia Kategorie-ID
    difficulty = data.get("difficulty", "medium")
    amount = min(int(data.get("amount", 5)), 10)

    if mode == "trivia" or not AI_AVAILABLE:
        questions = get_trivia_questions(category_id, difficulty, amount)
        if not questions:
            return jsonify({"error": "Keine Fragen verfügbar. Bitte später versuchen."}), 503
        return jsonify({"questions": questions, "source": "Open Trivia DB"})

    # KI-generierte Fragen
    system = (
        "Du bist ein erfahrener Lehrer. Erstelle Multiple-Choice-Fragen auf Deutsch. "
        "Antworte NUR mit einem JSON-Array ohne Markdown-Code-Blöcke. "
        "Format: [{\"question\":\"...\",\"answers\":[\"A\",\"B\",\"C\",\"D\"],\"correct\":\"A\"}, ...]"
    )
    user = (
        f"Erstelle {amount} {difficulty}-Schwierigkeits-Multiple-Choice-Fragen über '{topic}'. "
        "Jede Frage hat genau 4 Antwortmöglichkeiten, davon genau eine richtige."
    )
    raw = ask_claude(system, user, max_tokens=1500)
    try:
        questions = json.loads(raw)
        return jsonify({"questions": questions, "source": "Claude Haiku KI"})
    except json.JSONDecodeError:
        return jsonify({"error": "KI-Antwort konnte nicht verarbeitet werden.", "raw": raw}), 500


@app.route("/api/tutor", methods=["POST"])
def api_tutor():
    """KI-Tutor-Chat (Claude Haiku)."""
    data = request.get_json()
    question = data.get("question", "").strip()
    subject = data.get("subject", "Allgemein")
    history = data.get("history", [])   # [{role, content}, ...]

    if not question:
        return jsonify({"error": "Keine Frage angegeben."}), 400

    system = (
        f"Du bist ein freundlicher, geduldiger Schullehrer für das Fach '{subject}'. "
        "Erkläre Sachverhalte klar und verständlich auf Schülerniveau (Gymnasium). "
        "Verwende Beispiele, Analogien und kurze strukturierte Antworten. "
        "Antworte auf Deutsch, es sei denn, der Schüler schreibt in einer anderen Sprache."
    )

    messages = []
    for h in history[-10:]:   # Max. 10 vorherige Nachrichten für Kontext
        if h.get("role") in ("user", "assistant"):
            messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": question})

    if not AI_AVAILABLE or not _anthropic_client:
        return jsonify({"answer": "KI-Tutor nicht verfügbar. Bitte ANTHROPIC_API_KEY setzen."})

    try:
        response = _anthropic_client.messages.create(
            model=MODEL,
            max_tokens=800,
            system=system,
            messages=messages,
        )
        return jsonify({"answer": response.content[0].text})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/api/explain", methods=["POST"])
def api_explain():
    """Erklärt einen Begriff via Wikipedia + optionalem KI-Summary."""
    data = request.get_json()
    topic = data.get("topic", "").strip()
    lang = data.get("lang", "de")

    if not topic:
        return jsonify({"error": "Kein Thema angegeben."}), 400

    wiki = get_wikipedia_summary(topic, lang)

    # Optionales KI-Summary
    ai_summary = ""
    if AI_AVAILABLE and wiki["extract"] and wiki["extract"] != "Wikipedia nicht erreichbar.":
        system = (
            "Du bist ein Schullehrer. Fasse den folgenden Wikipedia-Text in 3-4 "
            "einfachen, schülergerechten Sätzen zusammen. Antworte nur mit der Zusammenfassung."
        )
        ai_summary = ask_claude(system, wiki["extract"][:2000], max_tokens=200)

    return jsonify({
        "title": wiki["title"],
        "extract": wiki["extract"],
        "thumbnail": wiki["thumbnail"],
        "url": wiki["url"],
        "ai_summary": ai_summary,
    })


@app.route("/api/flashcards", methods=["POST"])
def api_flashcards():
    """Generiert Lernkarten zu einem Thema (KI)."""
    data = request.get_json()
    topic = data.get("topic", "").strip()
    amount = min(int(data.get("amount", 8)), 15)

    if not topic:
        return jsonify({"error": "Kein Thema angegeben."}), 400

    system = (
        "Du bist ein Lehrer. Erstelle Lernkarten (Flashcards) auf Deutsch. "
        "Antworte NUR mit einem JSON-Array ohne Markdown-Code-Blöcke. "
        "Format: [{\"front\":\"Begriff/Frage\",\"back\":\"Erklärung/Antwort\"}, ...]"
    )
    user = f"Erstelle {amount} Lernkarten über '{topic}' für Gymnasialschüler."

    raw = ask_claude(system, user, max_tokens=1200)
    try:
        cards = json.loads(raw)
        return jsonify({"cards": cards, "topic": topic})
    except json.JSONDecodeError:
        return jsonify({"error": "KI-Antwort konnte nicht verarbeitet werden.", "raw": raw}), 500


@app.route("/api/status")
def api_status():
    return jsonify({"ai_available": AI_AVAILABLE, "model": MODEL if AI_AVAILABLE else None})


# ── Start ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    print(f"🎓 Herr-Raza Lernapp läuft auf http://localhost:{port}")
    print(f"   KI-Tutor: {'✅ aktiv (' + MODEL + ')' if AI_AVAILABLE else '❌ kein API-Key'}")
    app.run(host="0.0.0.0", port=port, debug=debug)
