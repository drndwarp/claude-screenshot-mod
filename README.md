# screenshot – Claude-Code-Mod

`/screenshot` nimmt einen Bildschirmausschnitt auf (macOS `screencapture`), legt das PNG unter
`~/.claude/screenshots/` ab, schreibt den Pfad in die Eingabe und legt das Bild zusätzlich in die
Zwischenablage (Cmd+V im Eingabefeld = echter Bildanhang).

- `/screenshot` – Auswahl ziehen (Leertaste wechselt zu Fenster, Esc bricht ab)
- `/screenshot fenster` – Fenster anklicken
- `/screenshot ganz [Nr]` – ganzer Bildschirm (Nr wie `screencapture -D`, 1 = Hauptbildschirm)

Über dem Eingabefeld stehen dieselben Aktionen als Knöpfe: „📸 Screenshot“, „Fenster“ und je angeschlossenem Bildschirm ein Knopf mit dessen Namen.

Steht ein Screenshot-Pfad im abgeschickten Prompt, bekommt Claude einen unsichtbaren Hinweis, das Bild
mit dem Read-Werkzeug zu öffnen.

Nur macOS (nutzt `screencapture` und `osascript`).

## Installation

In einer Claude-Code-Sitzung (Terminal oder Desktop-App) eingeben:

```
/plugin install screenshot --marketplace drndwarp/claude-screenshot-mod
```

Mit `y` den Marketplace hinzufügen und einen Bereich wählen (z. B. „user“ für alle Projekte),
danach `/reload-plugins` oder Claude neu starten.

## Berechtigung „Bildschirmaufnahme“

Ohne sie meldet der Mod „Aufnahme nicht erlaubt“. Unter macOS → Systemeinstellungen →
Datenschutz & Sicherheit → **Bildschirm- & Systemaudioaufnahme** freigeben:

- **Terminal:** das Terminal-Programm, in dem `claude` läuft.
- **Claude-Desktop-App:** nicht nur „Claude“, sondern auch das eingebaute Claude-Code-Programm
  `claude.app` (`com.anthropic.claude-code`). Es liegt unter
  `~/Library/Application Support/Claude/claude-code/<Version>/…/claude.app` – über „+“ und
  Cmd+Shift+G hinzufügen, danach die App neu starten.

## Datenschutz

Die Bilder bleiben lokal unter `~/.claude/screenshots/`, wandern aber mit dem Prompt zu Claude.
Vorher kurz prüfen, was auf dem Bild zu sehen ist.

## Entwicklung

```
claude plugin validate .
claude plugin test .
```
