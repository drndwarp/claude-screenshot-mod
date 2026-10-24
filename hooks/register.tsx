import type { EngineInterface as Engine, Register } from 'claude-code'
import { MODES, parseDisplays, type Backend, type Display, type Mode } from './backend'
import { macBackend } from './mac'
import { windowsBackend } from './windows'

export { parseDisplays, type Display }

// German aliases, kept for the commands people already type.
const ALIASES: Record<string, Mode> = { auswahl: 'select', fenster: 'window', ganz: 'screen' }
// A screenshot path as the mod writes it: macOS or Windows separators, in
// quotes when the path holds a space ("C:\Users\Andy M\.claude\...").
const SCREENSHOT_FILE = String.raw`[\\/]\.claude[\\/]screenshots[\\/]screenshot-[\d-]+\.png`
const SCREENSHOT_PATH = new RegExp(`"[^"\\n]*${SCREENSHOT_FILE}"|[^\\s"]*${SCREENSHOT_FILE}`, 'g')

export const parseArgs = (args: string): { mode: Mode; nr?: number } => {
  const [word = '', number] = args.trim().toLowerCase().split(/\s+/)
  const mode = (MODES as readonly string[]).includes(word) ? (word as Mode) : (ALIASES[word] ?? 'select')
  const nr = mode === 'screen' && number && /^\d+$/.test(number) ? Number(number) : undefined
  return { mode, nr }
}

export const screenshotPaths = (text: string): string[] => [
  ...new Set((text.match(SCREENSHOT_PATH) ?? []).map(path => path.replace(/^"|"$/g, ''))),
]

const quoted = (path: string) => (/\s/.test(path) ? `"${path}"` : path)

// Windows by its OS variable (set in every Windows process), else macOS.
const pickBackend = async ($: Engine): Promise<Backend> => {
  if ((await $.env.get('OS')) !== 'Windows_NT') return macBackend
  const systemRoot = await $.env.get('SystemRoot')
  const powershell = systemRoot ? `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` : 'powershell.exe'
  return windowsBackend(powershell, `${$.plugin.root}\\hooks\\capture.ps1`)
}

let backend: Promise<Backend> | undefined
let displays: Display[] = []

const getBackend = ($: Engine) => (backend ??= pickBackend($))

type Result = { text: string; isInPrompt: boolean }

// Captures, writes the path into the prompt and says what happened.
const capture = async ($: Engine, mode: Mode, nr?: number): Promise<Result> => {
  const platform = await getBackend($)
  const run = await $.process.run(platform.capture(mode, nr), { timeoutMs: 300_000 })
  if (run.exitCode === 3) return { text: 'Screenshot cancelled.', isInPrompt: false }
  if (run.exitCode === 4) return { text: platform.notAllowed, isInPrompt: false }
  if (run.exitCode !== 0 || !run.stdout) {
    return { text: `Screenshot failed: ${run.stderr.trim() || `exit ${run.exitCode}`}`, isInPrompt: false }
  }
  const path = run.stdout.trim()
  const filled = await $.prompt.fill({ text: `${quoted(path)} `, mode: 'insert' })
  return {
    isInPrompt: filled.isFilled,
    text: filled.isFilled
      ? `Screenshot in the prompt: ${path} (also on the clipboard, ${platform.pasteKey} attaches it)`
      : `Screenshot saved: ${path} - it is on the clipboard, paste it with ${platform.pasteKey}.`,
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'screenshot',
      description: 'Capture a region, window or display and put it into the prompt (select | window | screen [n])',
      argumentHint: 'select | window | screen [display number]',
    })
    backend = undefined
    void (async () => {
      const platform = await getBackend($)
      const run = await $.process.run(platform.displays).catch(() => undefined)
      if (run?.exitCode === 0) {
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
    const isBuiltIn = (d: Display) => d.isBuiltIn ?? /integriert|built-in|retina/i.test(d.name)
    const displayButtons =
      displays.length > 1
        ? displays.map(d => button(`screen-${d.nr}`, `${isBuiltIn(d) ? '💻' : '🖥'} ${d.name}`, 'screen', d.nr))
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
    const paths = screenshotPaths(e.text)
    if (paths.length === 0 || e.command) return next(e)
    const hint = `The prompt contains screenshots (PNG): ${paths.join(', ')}. Open them with the Read tool to see them before you answer.`
    return next({ ...e, context: [...(e.context ?? []), hint] })
  })
}
