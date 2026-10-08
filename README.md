# Herr Raza Quiz

Deutschsprachige Quiz-App mit bis zu 50 Fragen, eigenem Lerntext, optionalen Bildern, Vorlesen, Offline-HTML und gemeinsamem QR-Klassenquiz.

## Einfache Sprache

Die App verwendet kurze, klare Texte und bekannte Wörter. Auch die KI erhält diese Vorgabe für Fragen, Antworten und Erklärungen. Nötige Fachwörter sollen kurz erklärt werden. Die gewählte fachliche Schwierigkeit bleibt erhalten. Fakten, Zahlen, Einheiten und wörtliche Belege dürfen dabei nicht verändert werden.

## Quiz erstellen und prüfen

Thema oder Lerntext eingeben. PDF und JPG/PNG/WebP lassen sich im Browser einlesen; bei gescannten Seiten läuft die deutsche und englische Texterkennung auf dem Gerät. Erst nach Kontrolle über „Als Lerntext übernehmen“ oder „An Lerntext anhängen“ wird der Text ins Quizformular übernommen. Dateien werden dabei nicht auf einen Server hochgeladen. Bei der anschließenden KI-Erstellung wird der übernommene Lerntext wie bisher an die Quiz-API gesendet.

Neue Quizze öffnen zunächst die Fragenvorschau. Dort können Titel, Fragen, vier Antworten, richtige Antwort, Erklärung, Reihenfolge und Bilder bearbeitet werden. Unvollständige Fragen verhindern Start, Speicherung und Export. Änderungen an Inhalten entfernen veraltete Quellenbelege und die Kennzeichnung als KI-geprüft. Eigene Quizze können auch ohne KI angelegt werden.

Die unabhängige KI-Prüfung bewertet die einfache Sprache der erstellten Fragen, Antworten und Erklärungen. Wörtliche Quellenbelege bleiben unverändert und werden getrennt auf ihre Aussage geprüft. Auch ein oder zwei vollständig geprüfte Fragen können verwendet werden. Die App zeigt die tatsächliche Zahl im Verhältnis zur gewünschten Zahl; sie ergänzt keine ungeprüften Füllfragen. Bei einer Ablehnung protokolliert der Server nur Anzahlen und Kriterien, keine Lerntexte oder Fragen.

## Sammlung und Sicherung

Die Quiz-Sammlung verwendet den lokalen Browserspeicher; sie ist kein geräteübergreifendes Konto. Quizze lassen sich suchen, erneut öffnen, bearbeiten, archivieren und wiederherstellen. JSON-Sicherungen können über „Quiz importieren“ auf anderen Geräten geöffnet werden. Vollständige Lerntexte werden nicht in der Sammlung oder Sicherung gespeichert. Browser-Speicherfehler werden angezeigt und überschreiben keine beschädigte Sammlung.

Offline-HTML enthält alle fertigen Fragen, Vorlesen und eine Antwortübersicht nach Abschluss. Verfügbare Bilder werden beim Download eingebettet. JSON dient zum Weiterbearbeiten; HTML dient zum Offline-Spielen.

## Auswertung

Nach jedem Durchgang zeigt die App gewählte und richtige Antworten samt Erklärung. Der Klassenmodus übermittelt die ursprünglichen Antwortindizes einmalig zusammen mit dem vorhandenen Abschluss-Ergebnis über die verschlüsselte Verbindung. Die Lehrkraft sieht pro Frage Antwortverteilung, richtige Antworten und abgelaufene Timer; Fragen mit vielen Fehlern stehen zuerst. Die aggregierte Auswertung und die Teilnehmerliste lassen sich als CSV speichern. Ergebnisse älterer Gäste ohne Antwortdaten werden in der Fragenstatistik nicht mitgezählt. Die Lehrerseite während des Unterrichts geöffnet lassen und die CSV vor dem Schließen sichern.

## Betrieb und Kostenkontrolle

Die KI-API prüft vor jeder Modellanfrage die aktuellen Preise und nutzt nur vollständig als kostenlos bestätigte Modelle. Auch die unabhängige Fragenprüfung verwendet dieselbe Preisprüfung. Kostenpflichtige oder unklar bepreiste Modelle werden abgewiesen. Externe kostenlose Dienste haben eigene Limits; unbegrenzte oder dauerhaft kostenlose Verfügbarkeit wird nicht garantiert.

Bei einem KI-Limit meldet die API 429 und die Wartezeit. Die App respektiert diese Wartezeit auch nach dem Neuladen und startet keine automatischen Wiederholungen. Bis zu drei fertig geprüfte KI-Quizze werden bei gleichen Eingaben in dieser Browser-Sitzung wiederverwendet (bekannte Fakten: höchstens 24 Stunden; neue Informationen: zwei Minuten). Der Ausgangstext wird nur durch einen SHA-256-Fingerabdruck zugeordnet und nicht vollständig gespeichert. Fertige Fragen und ihre Belege bleiben auf diesem Gerät. Gespeicherte Quizze und eigene Fragen bleiben während eines KI-Limits nutzbar.

PDF.js 6.4.299 (Apache-2.0) und Tesseract.js 7.0.0 (Apache-2.0) werden beim Import bedarfsweise von jsDelivr geladen. OCR-Sprachdaten werden im Browser zwischengespeichert. Für den ersten Import ist Internet erforderlich. Fertige Offline-Quizze benötigen diese Bibliotheken nicht.

## Prüfen

Node.js 24, `npm ci`, anschließend `npm test`. Die 92 Tests prüfen die KI-Preis- und Qualitätsgrenzen, komplette Quizze mit 50 Fragen, Bildlizenzen, Offline-Spiel, Vorschau und Bearbeitung, Sammlung und Sicherungen, echte PDF-Texterkennung, Import-Abbruch sowie Klassenergebnisse mit ursprünglichen Antwortindizes. Sie prüfen auch die tatsächliche Punkteanzeige, verspätete Verbindungsereignisse, ungültige Ergebnisnachrichten und den Schutz vor alten Texten nach einem fehlgeschlagenen Import. Nicht lesbare Seiten werden ausdrücklich gemeldet. Die Quellenbelege und vollständig geprüfte Teilquizze sind zusätzlich abgesichert. Wiederverwendung, Ablauf, doppelte Anfragen und das KI-Limit nach dem Neuladen werden ebenfalls geprüft.

Vor dem Unterricht das fertige Quiz prüfen und als HTML speichern. So kann es auch bei einem Ausfall der kostenlosen KI offline gespielt werden. Der Klassenmodus braucht Internet; die Lehrerseite muss offen bleiben. Automatische Tests und die KI-Prüfung ersetzen keine fachliche Prüfung der Fragen durch die Lehrkraft.
