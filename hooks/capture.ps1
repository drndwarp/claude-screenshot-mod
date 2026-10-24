# Windows capture for the screenshot mod. Runs under Windows PowerShell 5.1
# (-STA, for the clipboard); the mod passes it as -EncodedCommand.
# -Mode select | window | screen: saves the PNG under
#   %USERPROFILE%\.claude\screenshots, puts it on the clipboard and prints its
#   path; exit 3 = cancelled, 4 = blocked by policy, anything else = failed.
# -Mode displays: one "number<TAB>name<TAB>built-in|external|unknown" line per
#   display, 1 = main display, the same numbers -Nr takes.
param([string]$Mode = 'select', [int]$Nr = 0)

# Add-Type is refused in Constrained Language Mode (AppLocker, WDAC).
if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') { exit 4 }

$source = @'
using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

public static class ClaudeShot
{
    [StructLayout(LayoutKind.Sequential)]
    struct RECT { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct DISPLAY_DEVICE
    {
        public int cb;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceString;
        public int StateFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceID;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceKey;
    }

    delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc proc, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr GetShellWindow();
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd, int index);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool EnumDisplayDevices(string device, uint index, ref DISPLAY_DEVICE info, uint flags);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out RECT value, int size);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out int value, int size);

    // Physical pixels everywhere; without it a scaled display (125 %, 150 %)
    // is captured cropped and the overlay lands in the wrong place.
    public static void DpiAware()
    {
        try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; } // per monitor v2
        catch (EntryPointNotFoundException) { } // before Windows 10 1703
        SetProcessDPIAware();
    }

    // The main display first, then the others, as screencapture -D counts them.
    static Screen[] Screens()
    {
        var list = new List<Screen>();
        foreach (var s in Screen.AllScreens) if (s.Primary) list.Add(s);
        foreach (var s in Screen.AllScreens) if (!s.Primary) list.Add(s);
        return list.ToArray();
    }

    // Each display's monitor device path, in Screens() order ("" when unknown).
    public static string[] DisplayIds()
    {
        var screens = Screens();
        var ids = new string[screens.Length];
        for (int i = 0; i < screens.Length; i++)
        {
            var device = new DISPLAY_DEVICE();
            device.cb = Marshal.SizeOf(device);
            // 1 = EDD_GET_DEVICE_INTERFACE_NAME: DeviceID is the path WMI keys monitors by
            ids[i] = EnumDisplayDevices(screens[i].DeviceName.TrimEnd('\0'), 0, ref device, 1) ? device.DeviceID : "";
        }
        return ids;
    }

    // Captures by mode, saves the PNG to file and copies it; false = cancelled.
    public static bool Capture(string mode, int nr, string file)
    {
        Bitmap image;
        if (mode == "screen")
        {
            var screens = Screens();
            if (nr > screens.Length) throw new ArgumentException(string.Format("There is no display {0}, only {1}.", nr, screens.Length));
            image = Grab(screens[nr < 1 ? 0 : nr - 1].Bounds);
        }
        else
        {
            var area = SystemInformation.VirtualScreen;
            var windows = Windows(area);
            using (var shot = Grab(area))
            using (var overlay = new Overlay(shot, area, windows, mode == "window"))
            {
                overlay.ShowDialog();
                if (overlay.Result.IsEmpty) return false;
                image = shot.Clone(overlay.Result, shot.PixelFormat);
            }
        }
        using (image)
        {
            image.Save(file, ImageFormat.Png);
            Copy(image, file);
        }
        return true;
    }

    static Bitmap Grab(Rectangle area)
    {
        var bitmap = new Bitmap(area.Width, area.Height, PixelFormat.Format32bppRgb);
        using (var g = Graphics.FromImage(bitmap)) g.CopyFromScreen(area.Location, Point.Empty, area.Size);
        return bitmap;
    }

    // As an image, as PNG (what browsers and Electron read) and as the file.
    static void Copy(Bitmap image, string file)
    {
        try
        {
            var data = new DataObject();
            data.SetImage(image);
            var png = new MemoryStream();
            image.Save(png, ImageFormat.Png);
            data.SetData("PNG", false, png);
            var files = new StringCollection();
            files.Add(file);
            data.SetFileDropList(files);
            Clipboard.SetDataObject(data, true, 10, 100);
        }
        catch (Exception) { } // the file and the path in the prompt are what count
    }

    // The windows one can click, topmost first, in screen coordinates.
    static List<Rectangle> Windows(Rectangle area)
    {
        var shell = GetShellWindow();
        var list = new List<Rectangle>();
        EnumWindows(delegate (IntPtr h, IntPtr lParam)
        {
            if (h == shell || !IsWindowVisible(h) || IsIconic(h)) return true;
            int cloaked; // 14 = DWMWA_CLOAKED: other virtual desktops, suspended apps
            if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
            // tool windows, click-through and never-activated windows (overlays)
            if ((GetWindowLong(h, -20) & (0x80 | 0x20 | 0x08000000)) != 0) return true;
            var name = new StringBuilder(64);
            GetClassName(h, name, name.Capacity);
            if (name.ToString() == "Progman" || name.ToString() == "WorkerW") return true;
            RECT r; // 9 = DWMWA_EXTENDED_FRAME_BOUNDS: without the invisible resize border
            if (DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(RECT))) != 0) GetWindowRect(h, out r);
            var bounds = Rectangle.Intersect(Rectangle.FromLTRB(r.Left, r.Top, r.Right, r.Bottom), area);
            if (bounds.Width > 1 && bounds.Height > 1) list.Add(bounds);
            return true;
        }, IntPtr.Zero);
        return list;
    }

    // A frozen, dimmed copy of all displays: drag a region (window mode: click
    // a window), space switches modes, Esc or a right click cancels. Result is
    // the chosen rectangle in shot's coordinates, empty when cancelled.
    class Overlay : Form
    {
        readonly Bitmap shot, dim;
        readonly List<Rectangle> windows = new List<Rectangle>();
        readonly Rectangle hintArea;
        bool windowMode, dragging;
        Point start;
        Rectangle chosen;
        public Rectangle Result { get; private set; }

        public Overlay(Bitmap shot, Rectangle area, List<Rectangle> screenWindows, bool windowMode)
        {
            this.shot = shot;
            this.windowMode = windowMode;
            foreach (var w in screenWindows) windows.Add(new Rectangle(w.X - area.X, w.Y - area.Y, w.Width, w.Height));
            dim = new Bitmap(shot.Width, shot.Height, PixelFormat.Format32bppPArgb);
            using (var g = Graphics.FromImage(dim))
            using (var shade = new SolidBrush(Color.FromArgb(110, 0, 0, 0)))
            {
                g.DrawImageUnscaled(shot, 0, 0);
                g.FillRectangle(shade, 0, 0, shot.Width, shot.Height);
            }
            var main = Screen.PrimaryScreen.Bounds;
            hintArea = new Rectangle(main.X - area.X + main.Width / 2 - 260, main.Y - area.Y + 24, 520, 40);

            Text = "Screenshot";
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            AutoScaleMode = AutoScaleMode.None;
            Bounds = area;
            TopMost = true;
            ShowInTaskbar = false;
            KeyPreview = true;
            Cursor = Cursors.Cross;
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true);
            if (windowMode) chosen = WindowAt(new Point(MousePosition.X - area.X, MousePosition.Y - area.Y));
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            Activate();
        }

        Rectangle WindowAt(Point p)
        {
            foreach (var w in windows) if (w.Contains(p)) return w;
            return Rectangle.Empty;
        }

        void Choose(Rectangle next)
        {
            if (next == chosen) return;
            var old = chosen;
            chosen = next;
            var changed = old.IsEmpty ? next : next.IsEmpty ? old : Rectangle.Union(old, next);
            changed.Inflate(3, 3);
            Invalidate(changed);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.DrawImage(dim, e.ClipRectangle, e.ClipRectangle, GraphicsUnit.Pixel);
            if (!chosen.IsEmpty)
            {
                g.DrawImage(shot, chosen, chosen, GraphicsUnit.Pixel);
                using (var pen = new Pen(Color.FromArgb(0, 120, 215), 2))
                    g.DrawRectangle(pen, chosen.X, chosen.Y, chosen.Width - 1, chosen.Height - 1);
            }
            if (!dragging && (windowMode || chosen.IsEmpty))
            {
                using (var back = new SolidBrush(Color.FromArgb(200, 32, 32, 32)))
                using (var font = new Font("Segoe UI", 11f, FontStyle.Regular, GraphicsUnit.Point))
                using (var format = new StringFormat())
                {
                    format.Alignment = StringAlignment.Center;
                    format.LineAlignment = StringAlignment.Center;
                    g.FillRectangle(back, hintArea);
                    g.DrawString(windowMode
                        ? "Click a window  \u00b7  Space: region  \u00b7  Esc: cancel"
                        : "Drag a region  \u00b7  Space: window  \u00b7  Esc: cancel",
                        font, Brushes.White, hintArea, format);
                }
            }
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Right) { Close(); return; }
            if (e.Button != MouseButtons.Left) return;
            if (windowMode)
            {
                var w = WindowAt(e.Location);
                if (!w.IsEmpty) { Result = w; Close(); }
                return;
            }
            start = e.Location;
            dragging = true;
            Invalidate(hintArea);
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            if (windowMode) Choose(WindowAt(e.Location));
            else if (dragging) Choose(Rectangle.FromLTRB(Math.Min(start.X, e.X), Math.Min(start.Y, e.Y), Math.Max(start.X, e.X), Math.Max(start.Y, e.Y)));
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            if (!dragging || e.Button != MouseButtons.Left) return;
            dragging = false;
            if (chosen.Width >= 4 && chosen.Height >= 4)
            {
                Result = Rectangle.Intersect(chosen, new Rectangle(Point.Empty, shot.Size));
                Close();
            }
            else { Choose(Rectangle.Empty); Invalidate(hintArea); } // a click, not a drag
        }

        protected override void OnKeyDown(KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Escape) Close();
            else if (e.KeyCode == Keys.Space && !dragging)
            {
                windowMode = !windowMode;
                chosen = windowMode ? WindowAt(PointToClient(MousePosition)) : Rectangle.Empty;
                Invalidate();
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) dim.Dispose();
            base.Dispose(disposing);
        }
    }
}
'@

# "\\?\DISPLAY#GSM5B09#4&2d5c&0&UID4353#{e6f0...}" -> "DISPLAY\GSM5B09\4&2d5c&0&UID4353_",
# the start of the monitor's InstanceName in root\wmi.
function Get-InstanceKey([string]$id) {
    $parts = ($id -replace '^\\\\\?\\', '') -split '#'
    if ($parts.Count -lt 3) { return $null }
    ($parts[0..2] -join '\') + '_'
}

# UTF-8 whatever the console's code page ("C:\Users\Müller\..."), and without
# needing a console at all.
function Write-Utf8([IO.Stream]$stream, [string]$text) {
    $bytes = [Text.Encoding]::UTF8.GetBytes($text)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
}

function Find-Instance([hashtable]$table, [string]$key) {
    if (-not $key) { return $null }
    foreach ($name in $table.Keys) {
        if ($name.StartsWith($key, [StringComparison]::OrdinalIgnoreCase)) { return $table[$name] }
    }
    $null
}

try {
    $ErrorActionPreference = 'Stop'
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition $source
    [ClaudeShot]::DpiAware()

    if ($Mode -eq 'displays') {
        $names = @{}
        $kinds = @{}
        try {
            foreach ($m in Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorID) {
                $names[$m.InstanceName] = -join ($m.UserFriendlyName | Where-Object { $_ } | ForEach-Object { [char]$_ })
            }
            # LVDS, embedded DisplayPort, embedded UDI, internal
            foreach ($c in Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorConnectionParams) {
                $kinds[$c.InstanceName] = if (@(6, 11, 13, 2147483648) -contains [long]$c.VideoOutputTechnology) { 'built-in' } else { 'external' }
            }
        } catch { } # no names: "Display n"

        $ids = [ClaudeShot]::DisplayIds()
        $rows = for ($i = 0; $i -lt $ids.Length; $i++) {
            $key = Get-InstanceKey $ids[$i]
            $name = Find-Instance $names $key
            $kind = Find-Instance $kinds $key
            [pscustomobject]@{
                Nr = $i + 1
                Name = $(if ($name) { $name.Trim() } else { "Display $($i + 1)" })
                Kind = $(if ($kind) { $kind } else { 'unknown' })
            }
        }
        # Two monitors of one model get "(1)", "(2)", as macOS names them.
        foreach ($group in @($rows | Group-Object Name | Where-Object { $_.Count -gt 1 })) {
            $k = 0
            foreach ($row in $group.Group) { $k++; $row.Name = "$($row.Name) ($k)" }
        }
        Write-Utf8 ([Console]::OpenStandardOutput()) (@($rows | ForEach-Object { "$($_.Nr)`t$($_.Name)`t$($_.Kind)" }) -join "`n")
        exit 0
    }

    $dir = Join-Path $env:USERPROFILE '.claude\screenshots'
    [void](New-Item -ItemType Directory -Force -Path $dir)
    $file = Join-Path $dir ('screenshot-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.png')
    if (-not [ClaudeShot]::Capture($Mode, $Nr, $file)) { exit 3 }
    Write-Utf8 ([Console]::OpenStandardOutput()) $file
} catch {
    Write-Utf8 ([Console]::OpenStandardError()) $_.Exception.Message
    exit 1
}
