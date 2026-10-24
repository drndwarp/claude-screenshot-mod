import { test, expect } from 'claude-code/testing'

const PFAD = '/Users/x/.claude/screenshots/screenshot-20261017-120000.png'

test('/screenshot nimmt auf und schreibt den Pfad in die Eingabe', async ($, on) => {
  const aufrufe: (readonly string[])[] = []
  const eingaben: string[] = []
  on('process.run', ($, e) => {
    aufrufe.push(e.argv)
    return { value: { exitCode: 0, stdout: PFAD, stderr: '' } }
  })
  on('prompt.fill', ($, e) => {
    eingaben.push(e.text)
    return { isFilled: true }
  })
  const antwort = await $.command.run({ command: 'screenshot', args: 'fenster' })
  expect(aufrufe[0]?.[0]).toBe('/bin/sh')
  expect(aufrufe[0]?.at(-1)).toBe('fenster')
  expect(eingaben).toEqual([`${PFAD} `])
  expect(antwort.text).toContain(PFAD)
})

test('abgebrochene Aufnahme füllt nichts', async ($, on) => {
  const eingaben: string[] = []
  on('process.run', () => ({ value: { exitCode: 3, stdout: '', stderr: '' } }))
  on('prompt.fill', ($, e) => {
    eingaben.push(e.text)
    return { isFilled: true }
  })
  const antwort = await $.command.run({ command: 'screenshot', args: '' })
  expect(eingaben).toEqual([])
  expect(antwort.text).toBe('Aufnahme abgebrochen.')
})

test('ein Screenshot-Pfad im Prompt bringt den Lese-Hinweis mit', async ($, on) => {
  const kontexte: (readonly string[] | undefined)[] = []
  on('prompt.submit', ($, e) => {
    kontexte.push(e.context)
    return { text: e.text, context: e.context }
  })
  await $.prompt.submit({ text: `Schau mal: ${PFAD} ` })
  expect(kontexte[0]?.[0]).toContain(PFAD)
  await $.prompt.submit({ text: 'ohne Bild' })
  expect(kontexte[1]).toBeUndefined()
})

test('fehlende Bildschirmaufnahme-Berechtigung wird erklärt', async ($, on) => {
  on('process.run', () => ({ value: { exitCode: 4, stdout: '', stderr: '' } }))
  const antwort = await $.command.run({ command: 'screenshot', args: '' })
  expect(antwort.text).toContain('Bildschirm- & Systemaudioaufnahme')
})

test('Knopf über der Eingabe nimmt auf und füllt den Pfad ein', async ($, on) => {
  const eingaben: string[] = []
  const argv: (readonly string[])[] = []
  on('process.run', ($, e) => {
    argv.push(e.argv)
    return { value: { exitCode: 0, stdout: PFAD, stderr: '' } }
  })
  on('prompt.fill', ($, e) => {
    eingaben.push(e.text)
    return { isFilled: true }
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'screenshot',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 },
    })
    expect(await ui.find({ key: 'auswahl' })).toBeDefined()
    await ui.press({ key: 'fenster' })
    await ui.unmount()
  }
  expect(eingaben).toEqual([`${PFAD} `, `${PFAD} `])
  expect(argv.map(a => a.at(-1))).toEqual(['fenster', 'fenster'])
})

test('Bildschirmliste und Nummer für "ganz" werden gelesen', async () => {
  const { bildschirmeAus, modusAus } = await import('./register')
  expect(bildschirmeAus('1\tASUS VP28U (1)\n2\tIntegriertes Retina-Display\n3\tASUS VP28U (2)')).toEqual([
    { nr: 1, name: 'ASUS VP28U (1)' },
    { nr: 2, name: 'Integriertes Retina-Display' },
    { nr: 3, name: 'ASUS VP28U (2)' },
  ])
  expect(modusAus('ganz 2')).toEqual({ modus: 'ganz', nr: 2 })
  expect(modusAus('ganz')).toEqual({ modus: 'ganz', nr: undefined })
  expect(modusAus('fenster 2')).toEqual({ modus: 'fenster', nr: undefined })
})

test('/screenshot ganz 3 nimmt Bildschirm 3 auf', async ($, on) => {
  const argv: (readonly string[])[] = []
  on('process.run', ($, e) => {
    argv.push(e.argv)
    return { value: { exitCode: 0, stdout: PFAD, stderr: '' } }
  })
  on('prompt.fill', () => ({ isFilled: true }))
  await $.command.run({ command: 'screenshot', args: 'ganz 3' })
  expect(argv[0]?.slice(-2)).toEqual(['ganz', '3'])
})
