using System;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Threading;

// A short-lived mouse-only hook. No persistent cursor clipping or keyboard blocking.
internal static class CaptchaInput
{
    private const int MouseHook = 14;
    private const uint Quit = 0x0012;
    private static readonly Stopwatch Clock = new Stopwatch();
    private static readonly HookProc Callback = Mouse;
    private static IntPtr target;
    private static IntPtr hook;
    private static uint thread;
    private static long duration;
    private static long lastPing;
    private static volatile bool stopping;

    private delegate IntPtr HookProc(int code, IntPtr message, IntPtr data);
    [StructLayout(LayoutKind.Sequential)] private struct Point { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)] private struct Message
    {
        public IntPtr Window; public uint Id; public UIntPtr WParam; public IntPtr LParam;
        public uint Time; public Point Position; public uint Private;
    }
    [DllImport("user32.dll")] private static extern IntPtr SetWindowsHookEx(int kind, HookProc callback, IntPtr module, uint threadId);
    [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr value);
    [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr value, int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] private static extern int GetMessage(out Message message, IntPtr window, uint min, uint max);
    [DllImport("user32.dll")] private static extern bool PeekMessage(out Message message, IntPtr window, uint min, uint max, uint remove);
    [DllImport("user32.dll")] private static extern bool TranslateMessage(ref Message message);
    [DllImport("user32.dll")] private static extern IntPtr DispatchMessage(ref Message message);
    [DllImport("user32.dll")] private static extern bool PostThreadMessage(uint threadId, uint message, UIntPtr wparam, IntPtr lparam);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string name);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();

    private static bool ShouldBlock(long elapsed, long limit, bool foreground, bool cancelled)
    {
        return !cancelled && foreground && elapsed >= 0 && elapsed < limit && limit <= 5000;
    }

    private static void Stop()
    {
        stopping = true;
        PostThreadMessage(thread, Quit, UIntPtr.Zero, IntPtr.Zero);
    }

    private static IntPtr Mouse(int code, IntPtr message, IntPtr data)
    {
        if (code >= 0 && ShouldBlock(Clock.ElapsedMilliseconds, duration, GetForegroundWindow() == target, stopping))
            return new IntPtr(1);
        return CallNextHookEx(hook, code, message, data);
    }

    // This mode exercises the deadline policy without any native calls or input hooks.
    private static int SelfTest()
    {
        if (!ShouldBlock(0, 5000, true, false) || !ShouldBlock(4999, 5000, true, false) ||
            ShouldBlock(5000, 5000, true, false) || ShouldBlock(0, 5001, true, false) ||
            ShouldBlock(0, 5000, false, false) || ShouldBlock(0, 5000, true, true)) return 1;
        Console.WriteLine("Mouse deadline, cancellation and foreground policy: OK (no input hooks)");
        return 0;
    }

    public static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--self-test") return SelfTest();
        int parentId;
        long handle, deadline;
        if (args.Length != 3 || !int.TryParse(args[0], out parentId) || parentId <= 0 ||
            !long.TryParse(args[1], NumberStyles.None, CultureInfo.InvariantCulture, out handle) || handle <= 0 ||
            !long.TryParse(args[2], out deadline)) return 2;
        long now = (long)(DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds;
        duration = Math.Min(5000, deadline - now);
        if (duration <= 0) return 2;
        Clock.Start();
        target = new IntPtr(handle);
        uint owner;
        if (GetWindowThreadProcessId(target, out owner) == 0 || owner != parentId || !IsWindowVisible(target)) return 2;
        try
        {
            using (Process parent = Process.GetProcessById(parentId))
            {
                SetForegroundWindow(target);
                if (GetForegroundWindow() != target) { Console.WriteLine("focus-denied"); return 3; }
                thread = GetCurrentThreadId();
                Message message;
                PeekMessage(out message, IntPtr.Zero, 0, 0, 0);
                hook = SetWindowsHookEx(MouseHook, Callback, GetModuleHandle(null), 0);
                if (hook == IntPtr.Zero) { Console.WriteLine("lock-failed"); return 4; }
                var reader = new Thread(() => {
                    try
                    {
                        while (Console.ReadLine() == "ping") Interlocked.Exchange(ref lastPing, Clock.ElapsedMilliseconds);
                    }
                    catch { }
                    finally { Stop(); }
                });
                reader.IsBackground = true;
                reader.Start();
                using (var watchdog = new Timer(_ => {
                    try
                    {
                        if (!ShouldBlock(Clock.ElapsedMilliseconds, duration, GetForegroundWindow() == target, stopping) ||
                            parent.HasExited || Clock.ElapsedMilliseconds - Interlocked.Read(ref lastPing) > 1500) Stop();
                    }
                    catch { Stop(); }
                }, null, 0, 50))
                {
                    Console.WriteLine("locked");
                    while (!stopping && GetMessage(out message, IntPtr.Zero, 0, 0) > 0)
                    {
                        TranslateMessage(ref message);
                        DispatchMessage(ref message);
                    }
                }
            }
            return 0;
        }
        catch { return 5; }
        finally
        {
            stopping = true;
            if (hook != IntPtr.Zero) UnhookWindowsHookEx(hook);
        }
    }
}
