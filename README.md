# 🎓 Herr-Raza Lernapp

KI-gestützte Lernplattform für den Schulunterricht — läuft komplett mit kostenlosen APIs.

## Features

| Bereich | Beschreibung | API |
|---------|-------------|-----|
| **Quiz** | Multiple-Choice-Fragen aus tausenden Kategorien | Open Trivia DB (kostenlos) |
| **KI-Tutor** | Chat-Tutor für alle Schulfächer | Claude Haiku (optional) |
| **Nachschlagen** | Begriffe mit Wikipedia-Erklärung + KI-Summary | Wikipedia REST API (kostenlos) |
| **Lernkarten** | KI-generierte Flashcards zum Üben | Claude Haiku (optional) |
| **Fortschritt** | Statistiken und gelernte Themen | localStorage (lokal) |

## Verwendete APIs (komplett kostenlos)

- **[Open Trivia Database](https://opentdb.com)** — Kein API-Key, über 4.000 Fragen
- **[Wikipedia REST API](https://www.mediawiki.org/wiki/API)** — Kein API-Key, Deutsch & Englisch
- **[Claude Haiku](https://www.anthropic.com)** — Optionaler API-Key, ~$0.001/Anfrage (sehr günstig)

## Installation & Start

```bash
# 1. Abhängigkeiten installieren
pip install -r requirements.txt

# 2. (Optional) Claude API Key setzen für KI-Funktionen
export ANTHROPIC_API_KEY="sk-ant-..."

# 3. App starten
python app.py
```

Dann im Browser öffnen: **http://localhost:5000**

## Ohne API-Key

Die App funktioniert **vollständig ohne API-Key** mit:
- Open Trivia DB Quizze (alle Kategorien, alle Schwierigkeitsgrade)
- Wikipedia Nachschlagen (Deutsch & Englisch)
- Fortschrittsverfolgung

Mit API-Key kommen zusätzlich KI-Tutor, KI-Quiz und Lernkarten hinzu.

## Struktur

```
Herr-Raza/
├── app.py              # Flask Backend (Routen & API-Calls)
├── requirements.txt
├── templates/
│   └── index.html      # Haupt-UI
└── static/
    ├── style.css        # Design
    └── script.js        # Frontend-Logik
```
