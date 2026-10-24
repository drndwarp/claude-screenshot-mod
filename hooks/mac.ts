import type { Backend } from './backend'

// Captures with screencapture, saves the PNG under ~/.claude/screenshots,
// copies it to the clipboard as an image and prints the path.
// $1 = mode: select (interactive, space toggles window), window, screen;
// $2 = display number for "screen" (screencapture -D, 1 = main display).
const SCRIPT = `
dir="$HOME/.claude/screenshots"
mkdir -p "$dir" || exit 1
file="$dir/screenshot-$(date +%Y%m%d-%H%M%S).png"
case "$1" in
  window) err=$(screencapture -i -J window -x "$file" 2>&1) ;;
  screen) err=$(screencapture -x -D "\${2:-1}" "$file" 2>&1) ;;
  *) err=$(screencapture -i -x "$file" 2>&1) ;;
esac
case "$err" in *"could not create image"*) exit 4 ;; esac
[ -s "$file" ] || exit 3
osascript -e "set the clipboard to (read (POSIX file \\"$file\\") as «class PNGf»)" >/dev/null 2>&1 || true
printf '%s' "$file"
`

// Lists the connected displays in the order screencapture -D counts them
// (NSScreen.screens = CGGetActiveDisplayList): one "number<TAB>name" per line.
const DISPLAYS = `ObjC.import("AppKit"); var s = $.NSScreen.screens, r = [];
for (var i = 0; i < s.count; i++) r.push((i + 1) + "\\t" + s.objectAtIndex(i).localizedName.js);
r.join("\\n")`

export const macBackend: Backend = {
  capture: (mode, nr) => ['/bin/sh', '-c', SCRIPT, 'screenshot', mode, ...(nr ? [String(nr)] : [])],
  displays: ['osascript', '-l', 'JavaScript', '-e', DISPLAYS],
  pasteKey: 'Cmd+V',
  notAllowed:
    'Screen recording not allowed: System Settings → Privacy & Security → ' +
    '"Screen & System Audio Recording", turn it on for Claude (or your terminal), then restart the app.',
}
