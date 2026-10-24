export const MODES = ['select', 'window', 'screen'] as const
export type Mode = (typeof MODES)[number]

export type Display = { nr: number; name: string; isBuiltIn?: boolean }

// What a platform runs. A capture prints the PNG's path and exits 0, exits 3
// when cancelled and 4 when capturing is not allowed; the display list prints
// "number<TAB>name[<TAB>built-in|external]" per line, numbered as capture takes them.
export type Backend = {
  capture: (mode: Mode, nr?: number) => string[]
  displays: string[]
  pasteKey: string
  notAllowed: string
}

export const parseDisplays = (output: string): Display[] =>
  output
    .split('\n')
    .map(line => line.split('\t').map(field => field.trim()))
    .filter(([nr, name]) => /^\d+$/.test(nr ?? '') && !!name)
    .map(([nr, name, kind]) => ({
      nr: Number(nr),
      name: name!,
      ...(kind === 'built-in' || kind === 'external' ? { isBuiltIn: kind === 'built-in' } : {}),
    }))
