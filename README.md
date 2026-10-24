# screenshot – a Claude Code mod

Take a screenshot with one click above Claude's prompt and drop it straight into your message,
without a detour through Finder, Explorer or the clipboard. Works on macOS and Windows.

![The screenshot buttons above the prompt in the Claude desktop app](docs/bar.png)

- **📸 Screenshot** – drag a region (space switches to window mode, Esc cancels)
- **Window** – click a window; it is captured on its own, with its shadow
- **One button per display** (e.g. 🖥 Studio Display, 💻 Built-in Retina Display) – captures that whole display

The PNG is saved under `~/.claude/screenshots/` (`%USERPROFILE%\.claude\screenshots\` on Windows),
its path is written into the prompt, and the image is also put on the clipboard (Cmd+V in the
prompt attaches it as a real image; on Windows Ctrl+V in the desktop app, Alt+V in the terminal). When you send a
prompt that contains a screenshot path, Claude gets a hidden hint to open the image with its
Read tool, so it actually looks at it.

The same actions work as a slash command:

```
/screenshot                 drag a region
/screenshot window          click a window
/screenshot screen [n]      whole display n (1 = main display, the order of the buttons)
```

Works in the terminal and in the Claude desktop app, on macOS (`screencapture`, `osascript`) and
on Windows 10/11 (Windows PowerShell 5.1, which ships with Windows; nothing to install).

## Install

In a Claude Code session (terminal or desktop app):

```
/plugin install screenshot --marketplace drndwarp/claude-screenshot-mod
```

Answer `y` to add the marketplace, pick a scope (e.g. "user" for all projects), then run
`/reload-plugins` or restart Claude.

## Windows

- **📸 Screenshot** dims all displays: drag a region, Space switches to window mode, Esc or a
  right click cancels.
- **Window** highlights the window under the mouse; a click captures it as it is on screen
  (whatever covers part of it is in the picture, and there is no shadow as on macOS).
- The display buttons are named after the monitors (💻 for a laptop's built-in screen). Display 1
  is the main display, which can differ from the numbers in Windows' display settings.
- No permission is needed. Where a policy (AppLocker, WDAC) runs PowerShell in Constrained
  Language Mode, the mod cannot capture and says so.
- Each capture starts PowerShell, which takes about a second before the overlay appears.
- If `claude` runs inside WSL, the mod takes it for macOS and does not work there.

## Screen recording permission (macOS)

Without it the mod reports "Screen recording not allowed". Open System Settings → Privacy &
Security → **Screen & System Audio Recording** and allow:

- **Terminal:** the terminal app `claude` runs in.
- **Claude desktop app:** not only "Claude" but also the bundled Claude Code program `claude.app`
  (`com.anthropic.claude-code`). It lives under
  `~/Library/Application Support/Claude/claude-code/<version>/…/claude.app`; add it with "+" and
  Cmd+Shift+G, then restart the app.

## Privacy

Screenshots stay on your computer under `~/.claude/screenshots/`, but whatever you put in a prompt is
sent to Claude. Check what is on the image before you send it, especially terminal windows.

## Development

```
claude plugin validate .
claude plugin test .
```

## License

MIT, see [LICENSE](LICENSE).
