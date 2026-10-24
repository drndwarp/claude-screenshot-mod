import { test, expect } from 'claude-code/testing'

const PATH = '/Users/x/.claude/screenshots/screenshot-20261017-120000.png'

test('/screenshot captures and writes the path into the prompt', async ($, on) => {
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
  expect(calls[0]?.[0]).toBe('/bin/sh')
  expect(calls[0]?.at(-1)).toBe('window')
  expect(fills).toEqual([`${PATH} `])
  expect(answer.text).toContain(PATH)
})

test('a cancelled capture fills nothing', async ($, on) => {
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
  await $.prompt.submit({ text: 'no image' })
  expect(contexts[1]).toBeUndefined()
})

test('a missing screen recording permission is explained', async ($, on) => {
  on('process.run', () => ({ value: { exitCode: 4, stdout: '', stderr: '' } }))
  const answer = await $.command.run({ command: 'screenshot', args: '' })
  expect(answer.text).toContain('Screen & System Audio Recording')
})

test('a button above the prompt captures and fills in the path', async ($, on) => {
  const fills: string[] = []
  const argv: (readonly string[])[] = []
  on('process.run', ($, e) => {
    argv.push(e.argv)
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

test('display list, display number and German aliases are parsed', async () => {
  const { parseDisplays, parseArgs } = await import('./register')
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
  const argv: (readonly string[])[] = []
  on('process.run', ($, e) => {
    argv.push(e.argv)
    return { value: { exitCode: 0, stdout: PATH, stderr: '' } }
  })
  on('prompt.fill', () => ({ isFilled: true }))
  await $.command.run({ command: 'screenshot', args: 'screen 3' })
  expect(argv[0]?.slice(-2)).toEqual(['screen', '3'])
})
