import type { Backend, Mode } from './backend'

// Windows PowerShell 5.1 ships with every Windows 10 and 11; -STA for the clipboard.
const FLAGS = ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass']

// What -EncodedCommand takes: the command as UTF-16LE, in base64.
export const encodeCommand = (command: string): string => {
  let bytes = ''
  for (let i = 0; i < command.length; i++) {
    const unit = command.charCodeAt(i)
    bytes += String.fromCharCode(unit & 0xff, unit >> 8)
  }
  return btoa(bytes)
}

// Runs capture.ps1 as a script block made from its text: an execution policy
// (AllSigned, RemoteSigned from a group policy) governs script files, not
// script blocks, and the command line stays short.
export const windowsBackend = (powershell: string, scriptFile: string): Backend => {
  const run = (mode: Mode | 'displays', nr?: number) => {
    const file = scriptFile.replaceAll("'", "''")
    const params = ['-Mode', mode, ...(nr ? ['-Nr', String(nr)] : [])].join(' ')
    const command = `& ([scriptblock]::Create([IO.File]::ReadAllText('${file}'))) ${params}`
    return [powershell, ...FLAGS, '-EncodedCommand', encodeCommand(command)]
  }
  return {
    capture: run,
    displays: run('displays'),
    pasteKey: 'Ctrl+V or, in the terminal, Alt+V',
    notAllowed:
      'Screenshots are blocked here: PowerShell runs in Constrained Language Mode ' +
      '(a policy such as AppLocker or WDAC), so the mod cannot capture the screen.',
  }
}
