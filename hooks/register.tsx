import type { Engine, Register } from 'claude-code'

type Modus = (typeof MODI)[number]

// Nimmt per screencapture auf, legt das PNG unter ~/.claude/screenshots ab,
// kopiert es als Bild in die Zwischenablage und gibt den Pfad aus.
// $1 = Modus: auswahl (interaktiv, Leertaste = Fenster), fenster, ganz;
// $2 = Bildschirm-Nummer für "ganz" (screencapture -D, 1 = Hauptbildschirm).
const SKRIPT = `
dir="$HOME/.claude/screenshots"
mkdir -p "$dir" || exit 1
datei="$dir/screenshot-$(date +%Y%m%d-%H%M%S).png"
case "$1" in
  fenster) fehler=$(screencapture -i -J window -x "$datei" 2>&1) ;;
  ganz) fehler=$(screencapture -x -D "\${2:-1}" "$datei" 2>&1) ;;
  *) fehler=$(screencapture -i -x "$datei" 2>&1) ;;
esac
case "$fehler" in *"could not create image"*) exit 4 ;; esac
[ -s "$datei" ] || exit 3
osascript -e "set the clipboard to (read (POSIX file \\"$datei\\") as «class PNGf»)" >/dev/null 2>&1 || true
printf '%s' "$datei"
`

const MODI = ['auswahl', 'fenster', 'ganz'] as const
const PFAD = /\S*\/\.claude\/screenshots\/screenshot-[\d-]+\.png/g

// Listet die angeschlossenen Bildschirme in der Reihenfolge, die screencapture -D zählt
// (NSScreen.screens = CGGetActiveDisplayList): je Zeile "Nummer<TAB>Name".
const BILDSCHIRME = `ObjC.import("AppKit"); var s = $.NSScreen.screens, r = [];
for (var i = 0; i < s.count; i++) r.push((i + 1) + "\\t" + s.objectAtIndex(i).localizedName.js);
r.join("\\n")`

export type Bildschirm = { nr: number; name: string }

export const bildschirmeAus = (ausgabe: string): Bildschirm[] =>
  ausgabe
    .split('\n')
    .map(zeile => zeile.split('\t'))
    .filter(([nr, name]) => /^\d+$/.test(nr ?? '') && !!name)
    .map(([nr, name]) => ({ nr: Number(nr), name: name!.trim() }))

export const modusAus = (args: string): { modus: Modus; nr?: number } => {
  const [wort = '', zahl] = args.trim().toLowerCase().split(/\s+/)
  const modus = (MODI as readonly string[]).includes(wort) ? (wort as Modus) : 'auswahl'
  const nr = modus === 'ganz' && zahl && /^\d+$/.test(zahl) ? Number(zahl) : undefined
  return { modus, nr }
}

let bildschirme: Bildschirm[] = []

type Ergebnis = { text: string; imFeld: boolean }

// Nimmt auf, schreibt den Pfad in die Eingabe und sagt, was passiert ist.
const aufnehmen = async ($: Engine, modus: Modus, nr?: number): Promise<Ergebnis> => {
  const lauf = await $.process.run(['/bin/sh', '-c', SKRIPT, 'screenshot', modus, ...(nr ? [String(nr)] : [])], {
    timeoutMs: 300_000,
  })
  if (lauf.exitCode === 3) return { text: 'Aufnahme abgebrochen.', imFeld: false }
  if (lauf.exitCode === 4) {
    return {
      imFeld: false,
      text:
        'Aufnahme nicht erlaubt: macOS-Systemeinstellungen → Datenschutz & Sicherheit → ' +
        '„Bildschirm- & Systemaudioaufnahme“ für Claude (bzw. dein Terminal) einschalten, App neu starten.',
    }
  }
  if (lauf.exitCode !== 0 || !lauf.stdout) {
    return { text: `Aufnahme fehlgeschlagen: ${lauf.stderr.trim() || `Exit ${lauf.exitCode}`}`, imFeld: false }
  }
  const pfad = lauf.stdout.trim()
  const gefuellt = await $.prompt.fill({ text: `${pfad} `, mode: 'insert' })
  return {
    imFeld: gefuellt.isFilled,
    text: gefuellt.isFilled
      ? `Screenshot in der Eingabe: ${pfad} (Bild liegt auch in der Zwischenablage, Cmd+V = Anhang)`
      : `Screenshot gespeichert: ${pfad} – Bild liegt in der Zwischenablage, mit Cmd+V einfügen.`,
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'screenshot',
      description: 'Bildschirmausschnitt aufnehmen und in die Eingabe übernehmen (auswahl | fenster | ganz [Nr])',
      argumentHint: 'auswahl | fenster | ganz [Bildschirm-Nr]',
    })
    void (async () => {
      const lauf = await $.process.run(['osascript', '-l', 'JavaScript', '-e', BILDSCHIRME])
      if (lauf.exitCode === 0) {
        bildschirme = bildschirmeAus(lauf.stdout)
        $.ui.invalidate('ui.render')
      }
    })()
    return next(e)
  })

  on('command.run', { command: 'screenshot' }, async ($, e) => {
    const { modus, nr } = modusAus(e.args)
    return { text: (await aufnehmen($, modus, nr)).text }
  })

  // Knöpfe im Band direkt über dem Eingabefeld.
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button } = $.ui.resolve(e)
    const knopf = (key: string, label: string, modus: Modus, nr?: number) => (
      <Button
        key={key}
        label={label}
        dimColor={modus !== 'auswahl'}
        onPress={async () => {
          const ergebnis = await aufnehmen($, modus, nr)
          if (!ergebnis.imFeld) $.ui.toast(ergebnis.text)
        }}
      />
    )
    const schirmKnoepfe =
      bildschirme.length > 1
        ? bildschirme.map(b =>
            knopf(`ganz-${b.nr}`, `${/integriert|built-in|retina/i.test(b.name) ? '💻' : '🖥'} ${b.name}`, 'ganz', b.nr),
          )
        : [knopf('ganz', 'Ganzer Bildschirm', 'ganz')]
    return (
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {knopf('auswahl', '📸 Screenshot', 'auswahl')}
        {knopf('fenster', 'Fenster', 'fenster')}
        {schirmKnoepfe}
      </Box>
    )
  })

  // Steht ein Screenshot-Pfad im Prompt, sagt ein Kontextblock Claude, dass es
  // ein Bild ist, das es mit dem Read-Werkzeug ansehen soll.
  on('prompt.submit', ($, e, next) => {
    const pfade = [...new Set(e.text.match(PFAD) ?? [])]
    if (pfade.length === 0 || e.command) return next(e)
    const hinweis = `Der Prompt enthält Bildschirmfotos (PNG): ${pfade.join(', ')}. Öffne sie mit dem Read-Werkzeug, um sie zu sehen, bevor du antwortest.`
    return next({ ...e, context: [...(e.context ?? []), hinweis] })
  })
}
