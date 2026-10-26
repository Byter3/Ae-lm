param([ValidateSet('select', 'capture', 'discover', 'check')][string]$Mode = 'capture')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

# This fixed helper captures a uniquely detected visible viewer, or an explicitly selected AE rectangle.
# It never opens a host, changes time, evaluates a composition, or starts a render.
$source = @'
using System;
using System.Diagnostics;
using System.Collections.Generic;
using System.Text;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace AeLmVisibleCapture {
    public class CaptureException : Exception {
        public string Code;
        public CaptureException(string code) : base(code) { Code = code; }
    }
    public class Box {
        public int x, y, width, height;
        public Box() {}
        public Box(Rectangle r) { x=r.X; y=r.Y; width=r.Width; height=r.Height; }
        public Rectangle ToRectangle() { return new Rectangle(x,y,width,height); }
    }
    public class Selection {
        public int processId;
        public string processStartTicks, windowHandle, canvasHandle;
        public Box windowRect, clientRect, captureRect;
    }
    public class CaptureResult {
        public string imageBase64;
        public int width, height, sourceWidth, sourceHeight;
        public string capturedAt;
    }
    public static class Native {
        [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
        [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X,Y; }
        public delegate bool EnumProc(IntPtr hwnd, IntPtr extra);
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
        [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr hwnd);
        [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr root, EnumProc callback, IntPtr extra);
        [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder value, int count);
        [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder value, int count);
        [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
        [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
        [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
        [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hwnd, out RECT rect);
        [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hwnd, ref POINT point);
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
        [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr extra);
        [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
        [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
        [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out int value, int size);
        public static void DpiAware() {
            try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; } catch (EntryPointNotFoundException) {}
            SetProcessDPIAware();
        }
        public static Rectangle WindowRectangle(IntPtr hwnd) {
            RECT r; if (!GetWindowRect(hwnd,out r)) throw new CaptureException("capture_window_changed");
            return Rectangle.FromLTRB(r.Left,r.Top,r.Right,r.Bottom);
        }
        public static Rectangle ClientRectangle(IntPtr hwnd) {
            RECT r; POINT p=new POINT();
            if (!GetClientRect(hwnd,out r) || !ClientToScreen(hwnd,ref p)) throw new CaptureException("capture_window_changed");
            return new Rectangle(p.X,p.Y,r.Right-r.Left,r.Bottom-r.Top);
        }
        public static bool Cloaked(IntPtr hwnd) {
            int value; return DwmGetWindowAttribute(hwnd,14,out value,4)==0 && value!=0;
        }
        public static bool Occluded(IntPtr target, Rectangle rect) {
            bool covered=false, found=false;
            EnumWindows(delegate(IntPtr hwnd, IntPtr extra) {
                if (hwnd==target) { found=true; return false; }
                if (IsWindowVisible(hwnd) && !IsIconic(hwnd) && !Cloaked(hwnd)) {
                    RECT r;
                    if (GetWindowRect(hwnd,out r) && Rectangle.FromLTRB(r.Left,r.Top,r.Right,r.Bottom).IntersectsWith(rect)) {
                        covered=true; return false;
                    }
                }
                return true;
            },IntPtr.Zero);
            return covered || !found;
        }
    }
    public sealed class WindowRecord {
        public long handle, parent, root;
        public uint processId, rootProcessId;
        public string className, title;
        public bool visible;
        public Rectangle bounds;
    }
    public static class ViewerDiscovery {
        private const string Drover = "DroverLord - Window Class";
        private static bool Is(WindowRecord record, string title) {
            return record!=null && record.visible && record.className==Drover && record.title==title;
        }
        public static WindowRecord SelectUnique(List<WindowRecord> records) {
            Dictionary<long,WindowRecord> lookup=new Dictionary<long,WindowRecord>();
            foreach(WindowRecord record in records) lookup[record.handle]=record;
            List<WindowRecord> candidates=new List<WindowRecord>();
            foreach(WindowRecord candidate in records) {
                if(candidate.processId==0 || candidate.processId!=candidate.rootProcessId || !Is(candidate,"OS_ViewContainer") || candidate.bounds.Width<64 || candidate.bounds.Height<64) continue;
                bool hasChild=false;
                foreach(WindowRecord child in records) if(child.parent==candidate.handle) {hasChild=true;break;}
                if(hasChild) continue;
                WindowRecord tab, container, frame;
                if(!lookup.TryGetValue(candidate.parent,out tab) || !Is(tab,"DroverLord - TabPanel Window")) continue;
                if(!lookup.TryGetValue(tab.parent,out container) || !Is(container,"OS_ViewContainer")) continue;
                if(!lookup.TryGetValue(container.parent,out frame) || !Is(frame,"DroverLord - Frame Window")) continue;
                if(frame.parent!=candidate.root || frame.root!=candidate.root || tab.root!=candidate.root || container.root!=candidate.root ||
                   frame.processId!=candidate.processId || tab.processId!=candidate.processId || container.processId!=candidate.processId) continue;
                int visibleChildren=0;
                foreach(WindowRecord child in records) if(child.parent==tab.handle && child.visible) visibleChildren++;
                if(visibleChildren!=1 || !tab.bounds.Contains(candidate.bounds) || !container.bounds.Contains(candidate.bounds) || !frame.bounds.Contains(candidate.bounds)) continue;
                candidates.Add(candidate);
            }
            if(candidates.Count==0) throw new CaptureException("capture_viewer_not_found");
            if(candidates.Count!=1) throw new CaptureException("capture_viewer_ambiguous");
            return candidates[0];
        }
        private static WindowRecord Read(IntPtr hwnd, long root, uint rootPid) {
            uint pid; Native.GetWindowThreadProcessId(hwnd,out pid);
            StringBuilder cls=new StringBuilder(256), title=new StringBuilder(256);
            Native.GetClassName(hwnd,cls,cls.Capacity); Native.GetWindowText(hwnd,title,title.Capacity);
            return new WindowRecord {handle=hwnd.ToInt64(),parent=Native.GetParent(hwnd).ToInt64(),root=root,processId=pid,rootProcessId=rootPid,
                className=cls.ToString(),title=title.ToString(),visible=Native.IsWindowVisible(hwnd),bounds=Native.WindowRectangle(hwnd)};
        }
        public static WindowRecord Find() {
            List<WindowRecord> records=new List<WindowRecord>(); bool overflow=false;
            bool enumerated=Native.EnumWindows(delegate(IntPtr hwnd,IntPtr extra) {
                if(!Native.IsWindowVisible(hwnd) || Native.IsIconic(hwnd) || Native.Cloaked(hwnd)) return true;
                uint pid; Native.GetWindowThreadProcessId(hwnd,out pid); if(pid==0) return true;
                try { using(Process process=Process.GetProcessById((int)pid)) {
                    if(!String.Equals(process.ProcessName,"AfterFX",StringComparison.OrdinalIgnoreCase)) return true;
                }} catch {return true;}
                StringBuilder rootClass=new StringBuilder(256); Native.GetClassName(hwnd,rootClass,rootClass.Capacity);
                if(!rootClass.ToString().StartsWith("AE_CApplication_",StringComparison.Ordinal)) return true;
                long root=hwnd.ToInt64();
                Native.EnumChildWindows(hwnd,delegate(IntPtr child,IntPtr unused) {
                    if(records.Count>=4096) {overflow=true;return false;}
                    records.Add(Read(child,root,pid));
                    return true;
                },IntPtr.Zero);
                return !overflow;
            },IntPtr.Zero);
            if(!enumerated || overflow) throw new CaptureException("capture_viewer_not_found");
            return SelectUnique(records);
        }
        private static List<WindowRecord> Fixture(long shift) {
            long root=10+shift; Rectangle box=new Rectangle(100,100,800,600);
            return new List<WindowRecord> {
                new WindowRecord {handle=11+shift,parent=root,root=root,processId=1,rootProcessId=1,className=Drover,title="DroverLord - Frame Window",visible=true,bounds=box},
                new WindowRecord {handle=12+shift,parent=11+shift,root=root,processId=1,rootProcessId=1,className=Drover,title="OS_ViewContainer",visible=true,bounds=box},
                new WindowRecord {handle=13+shift,parent=12+shift,root=root,processId=1,rootProcessId=1,className=Drover,title="DroverLord - TabPanel Window",visible=true,bounds=box},
                new WindowRecord {handle=14+shift,parent=13+shift,root=root,processId=1,rootProcessId=1,className=Drover,title="OS_ViewContainer",visible=true,bounds=new Rectangle(100,150,800,500)}
            };
        }
        private static void Expect(List<WindowRecord> records,string code) {
            try {SelectUnique(records);} catch(CaptureException e) {if(e.Code==code)return;throw;}
            throw new Exception("Discovery self-test failed");
        }
        public static int SelfTest() {
            List<WindowRecord> records=Fixture(0);
            if(SelectUnique(records).handle!=14) throw new Exception("Discovery self-test failed");
            records.AddRange(Fixture(100)); Expect(records,"capture_viewer_ambiguous");
            records=Fixture(0); records[3].visible=false; Expect(records,"capture_viewer_not_found");
            records=Fixture(0); records.Add(new WindowRecord{handle=15,parent=14,root=10,className="Edit",title="",visible=true,bounds=new Rectangle(100,150,100,20)}); Expect(records,"capture_viewer_not_found");
            records=Fixture(0); records[2].title="Different pane"; Expect(records,"capture_viewer_not_found");
            records=Fixture(0); records[1].visible=false; Expect(records,"capture_viewer_not_found");
            records=Fixture(0); records[3].bounds=new Rectangle(100,150,30,20); Expect(records,"capture_viewer_not_found");
            records=Fixture(0); records.Add(new WindowRecord{handle=16,parent=13,root=10,className=Drover,title="Other canvas",visible=true,bounds=new Rectangle(100,150,300,300)}); Expect(records,"capture_viewer_not_found");
            records=Fixture(0); records.Add(new WindowRecord{handle=17,parent=14,root=10,processId=99,rootProcessId=1,className="Chrome_RenderWidgetHostHWND",title="",visible=true,bounds=new Rectangle(100,150,800,500)}); Expect(records,"capture_viewer_not_found");
            records=Fixture(0); records[3].processId=99; Expect(records,"capture_viewer_not_found");
            return 10;
        }
    }
    public sealed class Owner : IWin32Window {
        private IntPtr handle;
        public Owner(IntPtr value) { handle=value; }
        public IntPtr Handle { get { return handle; } }
    }
    public sealed class RegionSelector : Form {
        private Point start;
        private Rectangle picked;
        private bool dragging;
        private Timer deadline;
        public Rectangle Picked { get { return picked; } }
        public RegionSelector(Rectangle bounds) {
            FormBorderStyle=FormBorderStyle.None;
            StartPosition=FormStartPosition.Manual;
            Bounds=bounds;
            TopMost=true;
            ShowInTaskbar=false;
            BackColor=Color.Black;
            Opacity=0.30;
            Cursor=Cursors.Cross;
            KeyPreview=true;
            DoubleBuffered=true;
            deadline=new Timer(); deadline.Interval=45000;
            deadline.Tick += delegate { DialogResult=DialogResult.Cancel; Close(); };
            deadline.Start();
        }
        protected override void OnMouseDown(MouseEventArgs e) {
            if (e.Button!=MouseButtons.Left) return;
            start=e.Location; dragging=true; Capture=true;
        }
        protected override void OnMouseMove(MouseEventArgs e) {
            if (!dragging) return;
            int x=Math.Max(0,Math.Min(ClientSize.Width,e.X));
            int y=Math.Max(0,Math.Min(ClientSize.Height,e.Y));
            picked=Rectangle.FromLTRB(Math.Min(start.X,x),Math.Min(start.Y,y),Math.Max(start.X,x),Math.Max(start.Y,y));
            Invalidate();
        }
        protected override void OnMouseUp(MouseEventArgs e) {
            if (!dragging || e.Button!=MouseButtons.Left) return;
            OnMouseMove(e); dragging=false; Capture=false;
            if (picked.Width<64 || picked.Height<64) { picked=Rectangle.Empty; Invalidate(); return; }
            DialogResult=DialogResult.OK; Close();
        }
        protected override void OnKeyDown(KeyEventArgs e) {
            if (e.KeyCode==Keys.Escape) { DialogResult=DialogResult.Cancel; Close(); }
            base.OnKeyDown(e);
        }
        protected override void OnPaint(PaintEventArgs e) {
            base.OnPaint(e);
            using (Pen pen=new Pen(Color.White,3)) e.Graphics.DrawRectangle(pen,picked);
            using (Font font=new Font(SystemFonts.MessageBoxFont.FontFamily,15)) {
                e.Graphics.DrawString("Drag a rectangle around ONLY the visible Composition image. Esc cancels.",font,Brushes.White,20,20);
            }
        }
        protected override void Dispose(bool disposing) {
            if (disposing && deadline!=null) { deadline.Dispose(); deadline=null; }
            base.Dispose(disposing);
        }
    }
    public static class Capture {
        private static IntPtr Handle(Selection state) {
            long value;
            if (state==null || !long.TryParse(state.windowHandle,out value) || value<=0) throw new CaptureException("capture_bounds");
            return new IntPtr(value);
        }
        private static Process CheckProcess(IntPtr hwnd) {
            uint pid; Native.GetWindowThreadProcessId(hwnd,out pid);
            try {
                Process process=Process.GetProcessById((int)pid);
                if (!String.Equals(process.ProcessName,"AfterFX",StringComparison.OrdinalIgnoreCase)) {
                    process.Dispose(); throw new CaptureException("capture_foreground");
                }
                return process;
            } catch (CaptureException) { throw; } catch { throw new CaptureException("capture_window_changed"); }
        }
        private static void CheckBounds(Rectangle rect, Rectangle client) {
            if (rect.Width<64 || rect.Height<64 || rect.Width>8192 || rect.Height>8192 ||
                (long)rect.Width*rect.Height>33554432 || !client.Contains(rect)) throw new CaptureException("capture_bounds");
            // A region across a monitor gap is never silently filled from the desktop.
            long visible=0;
            foreach (Screen screen in Screen.AllScreens) {
                Rectangle intersection=Rectangle.Intersect(rect,screen.Bounds);
                visible+=(long)intersection.Width*intersection.Height;
            }
            if (visible!=(long)rect.Width*rect.Height) throw new CaptureException("capture_bounds");
        }
        private static void Validate(Selection state, bool requireForeground) {
            IntPtr hwnd=Handle(state);
            if (!Native.IsWindow(hwnd) || !Native.IsWindowVisible(hwnd) || Native.IsIconic(hwnd) || Native.Cloaked(hwnd))
                throw new CaptureException("capture_window_changed");
            using (Process process=CheckProcess(hwnd)) {
                if (process.Id!=state.processId || process.StartTime.ToUniversalTime().Ticks.ToString()!=state.processStartTicks)
                    throw new CaptureException("capture_window_changed");
            }
            if (state.windowRect==null || state.clientRect==null || state.captureRect==null) throw new CaptureException("capture_bounds");
            if (Native.WindowRectangle(hwnd)!=state.windowRect.ToRectangle() || Native.ClientRectangle(hwnd)!=state.clientRect.ToRectangle())
                throw new CaptureException("capture_window_changed");
            CheckBounds(state.captureRect.ToRectangle(),state.clientRect.ToRectangle());
            IntPtr foreground=Native.GetForegroundWindow();
            if (requireForeground && foreground!=hwnd && Native.GetAncestor(foreground,3)!=hwnd) throw new CaptureException("capture_foreground");
            if(!String.IsNullOrEmpty(state.canvasHandle)) {
                WindowRecord candidate=ViewerDiscovery.Find();
                if(candidate.handle.ToString()!=state.canvasHandle || candidate.root!=hwnd.ToInt64() ||
                   Native.ClientRectangle(new IntPtr(candidate.handle))!=state.captureRect.ToRectangle())
                    throw new CaptureException("capture_window_changed");
            }
            if (Native.Occluded(hwnd,state.captureRect.ToRectangle())) throw new CaptureException("capture_occluded");
        }
        public static Selection Discover(string viewerType, bool requireVisible) {
            if(viewerType!="composition") throw new CaptureException("capture_viewer_type");
            WindowRecord candidate=ViewerDiscovery.Find(); IntPtr root=new IntPtr(candidate.root);
            Selection state=new Selection();
            using(Process process=CheckProcess(root)) {
                state.processId=process.Id;state.processStartTicks=process.StartTime.ToUniversalTime().Ticks.ToString();
            }
            state.windowHandle=root.ToInt64().ToString();state.canvasHandle=candidate.handle.ToString();
            state.windowRect=new Box(Native.WindowRectangle(root));state.clientRect=new Box(Native.ClientRectangle(root));
            state.captureRect=new Box(Native.ClientRectangle(new IntPtr(candidate.handle)));
            if(requireVisible) Validate(state,true);return state;
        }
        public static Selection Select() {
            IntPtr foreground=Native.GetForegroundWindow();
            IntPtr owner=Native.GetAncestor(foreground,3);
            IntPtr hwnd=owner!=IntPtr.Zero ? owner : foreground;
            if (hwnd==IntPtr.Zero || !Native.IsWindowVisible(hwnd) || Native.IsIconic(hwnd)) throw new CaptureException("capture_foreground");
            Selection state=new Selection();
            using (Process process=CheckProcess(hwnd)) {
                state.processId=process.Id;
                state.processStartTicks=process.StartTime.ToUniversalTime().Ticks.ToString();
            }
            state.windowHandle=hwnd.ToInt64().ToString();
            state.windowRect=new Box(Native.WindowRectangle(hwnd));
            Rectangle client=Native.ClientRectangle(hwnd);
            state.clientRect=new Box(client);
            using (RegionSelector form=new RegionSelector(client)) {
                if (form.ShowDialog(new Owner(hwnd))!=DialogResult.OK) throw new CaptureException("capture_cancelled");
                Rectangle selection=form.Picked;
                selection.Offset(client.Location);
                state.captureRect=new Box(selection);
            }
            // Selection is user initiated. Capture never activates an application.
            Validate(state,false);
            return state;
        }
        public static CaptureResult Grab(Selection state, int maxWidth, int maxHeight) {
            if (maxWidth<64 || maxWidth>1280 || maxHeight<64 || maxHeight>1280) throw new CaptureException("capture_bounds");
            Validate(state,true);
            Rectangle rect=state.captureRect.ToRectangle();
            using (Bitmap source=new Bitmap(rect.Width,rect.Height,PixelFormat.Format24bppRgb)) {
                using (Graphics graphics=Graphics.FromImage(source)) {
                    graphics.CopyFromScreen(rect.Location,Point.Empty,rect.Size,CopyPixelOperation.SourceCopy);
                }
                // Reject if visible-window state changed during the screen read.
                Validate(state,true);
                double scale=Math.Min(1.0,Math.Min((double)maxWidth/rect.Width,(double)maxHeight/rect.Height));
                int width=Math.Max(1,(int)Math.Round(rect.Width*scale)), height=Math.Max(1,(int)Math.Round(rect.Height*scale));
                using (Bitmap resized=new Bitmap(width,height,PixelFormat.Format24bppRgb)) {
                    using (Graphics graphics=Graphics.FromImage(resized)) {
                        graphics.InterpolationMode=InterpolationMode.HighQualityBicubic;
                        graphics.DrawImage(source,new Rectangle(0,0,width,height));
                    }
                    using (MemoryStream stream=new MemoryStream()) {
                        resized.Save(stream,ImageFormat.Png);
                        if (stream.Length>4*1024*1024) throw new CaptureException("capture_empty");
                        return new CaptureResult { imageBase64=Convert.ToBase64String(stream.ToArray()),
                            width=width,height=height,sourceWidth=rect.Width,sourceHeight=rect.Height,
                            capturedAt=DateTime.UtcNow.ToString("o") };
                    }
                }
            }
        }
    }
}
'@

try {
    Add-Type -TypeDefinition $source -ReferencedAssemblies System.Windows.Forms,System.Drawing -ErrorAction Stop
    [AeLmVisibleCapture.Native]::DpiAware()
    if ($Mode -eq 'check') {
        @{ok=$true; compiled=$true; discoveryTests=[AeLmVisibleCapture.ViewerDiscovery]::SelfTest()} | ConvertTo-Json -Compress
        exit 0
    }
    $inputJson = [Console]::In.ReadToEnd()
    if ($inputJson.Length -gt 16384) { throw 'capture_bounds' }
    $request = $inputJson | ConvertFrom-Json -ErrorAction Stop
    if ($Mode -eq 'select') {
        $state = [AeLmVisibleCapture.Capture]::Select()
        @{ok=$true; region=$state} | ConvertTo-Json -Depth 6 -Compress
    } else {
        if ($request.auto -eq $true -or $Mode -eq 'discover') {
            $state = [AeLmVisibleCapture.Capture]::Discover([string]$request.viewerType,($Mode -ne 'discover'))
        } else {
        $state = New-Object AeLmVisibleCapture.Selection
        $state.processId = [int]$request.region.processId
        $state.processStartTicks = [string]$request.region.processStartTicks
        $state.windowHandle = [string]$request.region.windowHandle
        foreach ($name in @('windowRect','clientRect','captureRect')) {
            $box = New-Object AeLmVisibleCapture.Box
            foreach ($key in @('x','y','width','height')) { $box.$key = [int]$request.region.$name.$key }
            $state.$name = $box
        }
        }
        if ($Mode -eq 'discover') {
            @{ok=$true;region=$state;method='detected-visible-viewer'} | ConvertTo-Json -Depth 6 -Compress
            exit 0
        }
        $result = [AeLmVisibleCapture.Capture]::Grab($state,[int]$request.maxWidth,[int]$request.maxHeight)
        @{ok=$true; mime='image/png'; imageBase64=$result.imageBase64; metadata=@{
            method=$(if ($state.canvasHandle) {'detected-visible-viewer'} else {'selected-visible-region'}); capturedAt=$result.capturedAt;
            width=$result.width; height=$result.height; sourceWidth=$result.sourceWidth; sourceHeight=$result.sourceHeight
        }} | ConvertTo-Json -Depth 4 -Compress
    }
} catch {
    $code = 'capture_unavailable'
    $errorObject = $_.Exception
    while ($null -ne $errorObject) {
        if ($errorObject -is [AeLmVisibleCapture.CaptureException]) { $code=$errorObject.Code; break }
        $errorObject = $errorObject.InnerException
    }
    @{ok=$false; code=$code} | ConvertTo-Json -Compress
    exit 1
}
