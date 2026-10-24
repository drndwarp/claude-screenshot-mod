import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import { parseArgs, parseDisplays, screenshotPaths } from './register'
import { encodeCommand, windowsBackend } from './windows'

const PATH = '/Users/x/.claude/screenshots/screenshot-20261017-120000.png'
const WIN_PATH = 'C:\\Users\\Andy M\\.claude\\screenshots\\screenshot-20261017-120000.png'

const mac = (on: On) => mock.env(on, {})
const windows = (on: On) => mock.env(on, { OS: 'Windows_NT', SystemRoot: 'C:\\Windows' })

// The command a PowerShell argv runs, -EncodedCommand decoded.
const decode = (argv: readonly string[]) => {
  const bytes = atob(argv[argv.indexOf('-EncodedCommand') + 1] ?? '')
  let text = ''
  for (let i = 0; i < bytes.length; i += 2) text += String.fromCharCode(bytes.charCodeAt(i) | (bytes.charCodeAt(i + 1) << 8))
  return text
}

test('/screenshot captures and writes the path into the prompt', async ($, on) => {
  mac(on)
  const calls: (readonly string[])[] = []
  const fills: string[] = []
  on('process.run', ($, e) => {
    calls.push(e.argv)
    return { value: { exitCode: 0, stdout: PATH, stderr: '' } }
  })
  on('prompt.fill', ($, e) => {
    fills.push(e.text)
    return { isFilled: true }
  })
  const answer = await $.command.run({ command: 'screenshot', args: 'window' })
  const capture = calls.find(argv => argv[0] === '/bin/sh')
  expect(capture?.at(-1)).toBe('window')
  expect(fills).toEqual([`${PATH} `])
  expect(answer.text).toContain(PATH)
  expect(answer.text).toContain('Cmd+V')
})

test('a cancelled capture fills nothing', async ($, on) => {
  mac(on)
  const fills: string[] = []
  on('process.run', () => ({ value: { exitCode: 3, stdout: '', stderr: '' } }))
  on('prompt.fill', ($, e) => {
    fills.push(e.text)
    return { isFilled: true }
  })
  const answer = await $.command.run({ command: 'screenshot', args: '' })
  expect(fills).toEqual([])
  expect(answer.text).toBe('Screenshot cancelled.')
})

test('a screenshot path in the prompt adds the read hint', async ($, on) => {
  const contexts: (readonly string[] | undefined)[] = []
  on('prompt.submit', ($, e) => {
    contexts.push(e.context)
    return { text: e.text, context: e.context }
  })
  await $.prompt.submit({ text: `Look: ${PATH} ` })
  expect(contexts[0]?.[0]).toContain(PATH)
  await $.prompt.submit({ text: `And: "${WIN_PATH}" ` })
  expect(contexts[1]?.[0]).toContain(WIN_PATH)
  await $.prompt.submit({ text: 'no image' })
  expect(contexts[2]).toBeUndefined()
})

test('a missing screen recording permission is explained', async ($, on) => {
  mac(on)
  on('process.run', () => ({ value: { exitCode: 4, stdout: '', stderr: '' } }))
  const answer = await $.command.run({ command: 'screenshot', args: '' })
  expect(answer.text).toContain('Screen & System Audio Recording')
})

test('a button above the prompt captures and fills in the path', async ($, on) => {
  mac(on)
  const fills: string[] = []
  const argv: (readonly string[])[] = []
  on('process.run', ($, e) => {
    if (e.argv[0] === '/bin/sh') argv.push(e.argv)
    return { value: { exitCode: 0, stdout: PATH, stderr: '' } }
  })
  on('prompt.fill', ($, e) => {
    fills.push(e.text)
    return { isFilled: true }
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'screenshot',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 },
    })
    expect(await ui.find({ key: 'select' })).toBeDefined()
    await ui.press({ key: 'window' })
    await ui.unmount()
  }
  expect(fills).toEqual([`${PATH} `, `${PATH} `])
  expect(argv.map(a => a.at(-1))).toEqual(['window', 'window'])
})

test('display list, display number and German aliases are parsed', () => {
  expect(parseDisplays('1\tASUS VP28U (1)\n2\tBuilt-in Retina Display\n3\tASUS VP28U (2)')).toEqual([
    { nr: 1, name: 'ASUS VP28U (1)' },
    { nr: 2, name: 'Built-in Retina Display' },
    { nr: 3, name: 'ASUS VP28U (2)' },
  ])
  expect(parseArgs('screen 2')).toEqual({ mode: 'screen', nr: 2 })
  expect(parseArgs('screen')).toEqual({ mode: 'screen', nr: undefined })
  expect(parseArgs('window 2')).toEqual({ mode: 'window', nr: undefined })
  expect(parseArgs('ganz 3')).toEqual({ mode: 'screen', nr: 3 })
  expect(parseArgs('fenster')).toEqual({ mode: 'window', nr: undefined })
  expect(parseArgs('')).toEqual({ mode: 'select', nr: undefined })
})

test('/screenshot screen 3 captures display 3', async ($, on) => {
  mac(on)
  const argv: (readonly string[])[] = []
  on('process.run', ($, e) => {
    if (e.argv[0] === '/bin/sh') argv.push(e.argv)
    return { value: { exitCode: 0, stdout: PATH, stderr: '' } }
  })
  on('prompt.fill', () => ({ isFilled: true }))
  await $.command.run({ command: 'screenshot', args: 'screen 3' })
  expect(argv[0]?.slice(-2)).toEqual(['screen', '3'])
})

test('on Windows /screenshot runs capture.ps1 in PowerShell and quotes the path', async ($, on) => {
  windows(on)
  const calls: (readonly string[])[] = []
  const fills: string[] = []
  on('process.run', ($, e) => {
    calls.push(e.argv)
    return { value: { exitCode: 0, stdout: WIN_PATH, stderr: '' } }
  })
  on('prompt.fill', ($, e) => {
    fills.push(e.text)
    return { isFilled: true }
  })
  const answer = await $.command.run({ command: 'screenshot', args: 'screen 2' })
  const capture = calls.find(argv => decode(argv).includes('-Mode screen'))
  expect(capture?.[0]).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  expect(capture).toContain('-STA')
  expect(decode(capture ?? [])).toMatch(
    /^& \(\[scriptblock\]::Create\(\[IO\.File\]::ReadAllText\('.*\\hooks\\capture\.ps1'\)\)\) -Mode screen -Nr 2$/,
  )
  expect(fills).toEqual([`"${WIN_PATH}" `])
  expect(answer.text).toContain('Ctrl+V')
})

test('on Windows a policy block is explained', async ($, on) => {
  windows(on)
  on('process.run', () => ({ value: { exitCode: 4, stdout: '', stderr: '' } }))
  const answer = await $.command.run({ command: 'screenshot', args: 'window' })
  expect(answer.text).toContain('Constrained Language Mode')
})

test('Windows display list: names, built-in flag and buttons', async ($, on) => {
  windows(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: {} }))
  on('process.run', ($, e) =>
    decode(e.argv).includes('-Mode displays')
      ? { value: { exitCode: 0, stdout: '1\tDELL U2720Q\texternal\r\n2\tSharp LQ134\tbuilt-in\n3\tDisplay 3\tunknown', stderr: '' } }
      : { value: { exitCode: 3, stdout: '', stderr: '' } },
  )
  expect(parseDisplays('1\tDELL U2720Q\texternal\r\n2\tSharp LQ134\tbuilt-in\n3\tDisplay 3\tunknown')).toEqual([
    { nr: 1, name: 'DELL U2720Q', isBuiltIn: false },
    { nr: 2, name: 'Sharp LQ134', isBuiltIn: true },
    { nr: 3, name: 'Display 3' },
  ])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({
    plugin: 'screenshot',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 },
  })
  expect((await ui.find({ key: 'screen-1' }))?.text).toBe('🖥 DELL U2720Q')
  expect((await ui.find({ key: 'screen-2' }))?.text).toBe('💻 Sharp LQ134')
  expect((await ui.find({ key: 'screen-3' }))?.text).toBe('🖥 Display 3')
  await ui.unmount()
})

test('screenshot paths are found with either separator, quoted or not', () => {
  expect(screenshotPaths(`a ${PATH} b "${WIN_PATH}" c ${PATH}`)).toEqual([PATH, WIN_PATH])
  expect(screenshotPaths('C:\\Users\\x\\.claude\\screenshots\\screenshot-20261017-120000.png')).toEqual([
    'C:\\Users\\x\\.claude\\screenshots\\screenshot-20261017-120000.png',
  ])
  expect(screenshotPaths('/tmp/screenshot-1.png')).toEqual([])
})

test('the PowerShell command is UTF-16LE base64 and quotes the script path', () => {
  expect(encodeCommand('ü')).toBe(btoa('\xfc\x00'))
  expect(decode(['-EncodedCommand', encodeCommand('Grüße'), ''])).toBe('Grüße')
  const backend = windowsBackend('powershell.exe', "C:\\Users\\O'Neil\\screenshot\\hooks\\capture.ps1")
  expect(decode(backend.capture('select'))).toBe(
    "& ([scriptblock]::Create([IO.File]::ReadAllText('C:\\Users\\O''Neil\\screenshot\\hooks\\capture.ps1'))) -Mode select",
  )
  expect(decode(backend.displays)).toMatch(/ -Mode displays$/)
})
