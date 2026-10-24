import type { Engine, Register } from 'claude-code'

type Mode = (typeof MODES)[number]

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

const MODES = ['select', 'window', 'screen'] as const
// German aliases, kept for the commands people already type.
const ALIASES: Record<string, Mode> = { auswahl: 'select', fenster: 'window', ganz: 'screen' }
const SCREENSHOT_PATH = /\S*\/\.claude\/screenshots\/screenshot-[\d-]+\.png/g

// Lists the connected displays in the order screencapture -D counts them
// (NSScreen.screens = CGGetActiveDisplayList): one "number<TAB>name" per line.
const DISPLAYS = `ObjC.import("AppKit"); var s = $.NSScreen.screens, r = [];
for (var i = 0; i < s.count; i++) r.push((i + 1) + "\\t" + s.objectAtIndex(i).localizedName.js);
r.join("\\n")`

export type Display = { nr: number; name: string }

export const parseDisplays = (output: string): Display[] =>
  output
    .split('\n')
    .map(line => line.split('\t'))
    .filter(([nr, name]) => /^\d+$/.test(nr ?? '') && !!name)
    .map(([nr, name]) => ({ nr: Number(nr), name: name!.trim() }))

export const parseArgs = (args: string): { mode: Mode; nr?: number } => {
  const [word = '', number] = args.trim().toLowerCase().split(/\s+/)
  const mode = (MODES as readonly string[]).includes(word) ? (word as Mode) : (ALIASES[word] ?? 'select')
  const nr = mode === 'screen' && number && /^\d+$/.test(number) ? Number(number) : undefined
  return { mode, nr }
}

let displays: Display[] = []

type Result = { text: string; isInPrompt: boolean }

// Captures, writes the path into the prompt and says what happened.
const capture = async ($: Engine, mode: Mode, nr?: number): Promise<Result> => {
  const run = await $.process.run(['/bin/sh', '-c', SCRIPT, 'screenshot', mode, ...(nr ? [String(nr)] : [])], {
    timeoutMs: 300_000,
  })
  if (run.exitCode === 3) return { text: 'Screenshot cancelled.', isInPrompt: false }
  if (run.exitCode === 4) {
    return {
      isInPrompt: false,
      text:
        'Screen recording not allowed: System Settings → Privacy & Security → ' +
        '"Screen & System Audio Recording", turn it on for Claude (or your terminal), then restart the app.',
    }
  }
  if (run.exitCode !== 0 || !run.stdout) {
    return { text: `Screenshot failed: ${run.stderr.trim() || `exit ${run.exitCode}`}`, isInPrompt: false }
  }
  const path = run.stdout.trim()
  const filled = await $.prompt.fill({ text: `${path} `, mode: 'insert' })
  return {
    isInPrompt: filled.isFilled,
    text: filled.isFilled
      ? `Screenshot in the prompt: ${path} (also on the clipboard, Cmd+V attaches it)`
      : `Screenshot saved: ${path} - it is on the clipboard, paste it with Cmd+V.`,
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'screenshot',
      description: 'Capture a region, window or display and put it into the prompt (select | window | screen [n])',
      argumentHint: 'select | window | screen [display number]',
    })
    void (async () => {
      const run = await $.process.run(['osascript', '-l', 'JavaScript', '-e', DISPLAYS])
      if (run.exitCode === 0) {
        displays = parseDisplays(run.stdout)
        $.ui.invalidate('ui.render')
      }
    })()
    return next(e)
  })

  on('command.run', { command: 'screenshot' }, async ($, e) => {
    const { mode, nr } = parseArgs(e.args)
    return { text: (await capture($, mode, nr)).text }
  })

  // Buttons in the band right above the prompt.
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button } = $.ui.resolve(e)
    const button = (key: string, label: string, mode: Mode, nr?: number) => (
      <Button
        key={key}
        label={label}
        dimColor={mode !== 'select'}
        onPress={async () => {
          const result = await capture($, mode, nr)
          if (!result.isInPrompt) $.ui.toast(result.text)
        }}
      />
    )
    const displayButtons =
      displays.length > 1
        ? displays.map(d =>
            button(`screen-${d.nr}`, `${/integriert|built-in|retina/i.test(d.name) ? '💻' : '🖥'} ${d.name}`, 'screen', d.nr),
          )
        : [button('screen', 'Full screen', 'screen')]
    return (
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {button('select', '📸 Screenshot', 'select')}
        {button('window', 'Window', 'window')}
        {displayButtons}
      </Box>
    )
  })

  // When a screenshot path is in the prompt, a context block tells Claude it is
  // an image to open with the Read tool.
  on('prompt.submit', ($, e, next) => {
    const paths = [...new Set(e.text.match(SCREENSHOT_PATH) ?? [])]
    if (paths.length === 0 || e.command) return next(e)
    const hint = `The prompt contains screenshots (PNG): ${paths.join(', ')}. Open them with the Read tool to see them before you answer.`
    return next({ ...e, context: [...(e.context ?? []), hint] })
  })
}
