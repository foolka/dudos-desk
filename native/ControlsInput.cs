using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

// Temporary user-mode remapping. No drivers, settings changes or input recording.
internal static class ControlsInput
{
	private const uint KeyUp = 0x0002, ScanCode = 0x0008;
	private const uint MouseMove = 0x0001, VirtualDesk = 0x4000, Absolute = 0x8000;
	private static readonly uint[] Scans = { 0x11, 0x1f, 0x1e, 0x20 };
	private static readonly HashSet<uint> Held = new HashSet<uint>();
	private static readonly Stopwatch Clock = new Stopwatch();
	private static readonly HookProc KeyboardCallback = Keyboard, MouseCallback = Mouse;
	private static IntPtr target, keyboardHook, mouseHook;
	private static uint thread;
	private static long duration, lastPing;
	private static volatile bool stopping;
	private static bool keyboardMode, keyboardStarted;
	private static string reason = "inputFinished";
	private static readonly object StopLock = new object();
	private delegate IntPtr HookProc(int code, IntPtr message, IntPtr data);
	[StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }
	[StructLayout(LayoutKind.Sequential)] private struct Message
	{
		public IntPtr Window; public uint Id; public UIntPtr WParam; public IntPtr LParam;
		public uint Time; public Point Position; public uint Private;
	}
	[StructLayout(LayoutKind.Sequential)] private struct KeyboardData
	{
		public uint Vk, Scan, Flags, Time; public UIntPtr Extra;
	}
	[StructLayout(LayoutKind.Sequential)] private struct MouseData
	{
		public Point Position; public uint Data, Flags, Time; public UIntPtr Extra;
	}
	[StructLayout(LayoutKind.Sequential)] private struct KeyboardInput
	{
		public ushort Vk, Scan; public uint Flags, Time; public UIntPtr Extra;
	}
	[StructLayout(LayoutKind.Sequential)] private struct MouseInput
	{
		public int X, Y; public uint Data, Flags, Time; public UIntPtr Extra;
	}
	[StructLayout(LayoutKind.Explicit)] private struct InputUnion
	{
		[FieldOffset(0)] public KeyboardInput Key;
		[FieldOffset(0)] public MouseInput Mouse;
	}
	[StructLayout(LayoutKind.Sequential)] private struct Input
	{
		public uint Type; public InputUnion Value;
	}
	[DllImport("user32.dll")] private static extern IntPtr SetWindowsHookEx(int kind, HookProc callback, IntPtr module, uint threadId);
	[DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hook);
	[DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
	[DllImport("user32.dll")] private static extern uint SendInput(uint count, Input[] inputs, int size);
	[DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
	[DllImport("user32.dll")] private static extern IntPtr GetShellWindow();
	[DllImport("user32.dll")] private static extern IntPtr GetDesktopWindow();
	[DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
	[DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
	[DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
	[DllImport("user32.dll")] private static extern uint MapVirtualKey(uint code, uint type);
	[DllImport("user32.dll")] private static extern bool GetCursorPos(out Point point);
	[DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
	[DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr context);
	[DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
	[DllImport("user32.dll")] private static extern int GetMessage(out Message message, IntPtr window, uint min, uint max);
	[DllImport("user32.dll")] private static extern bool PeekMessage(out Message message, IntPtr window, uint min, uint max, uint remove);
	[DllImport("user32.dll")] private static extern bool TranslateMessage(ref Message message);
	[DllImport("user32.dll")] private static extern IntPtr DispatchMessage(ref Message message);
	[DllImport("user32.dll")] private static extern bool PostThreadMessage(uint threadId, uint message, UIntPtr wparam, IntPtr lparam);
	[DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string name);
	[DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();

	private static uint Opposite(uint scan)
	{
		switch (scan) { case 0x11: return 0x1f; case 0x1f: return 0x11; case 0x1e: return 0x20; case 0x20: return 0x1e; default: return 0; }
	}
	private static bool Allowed(long elapsed, long limit, long ping, bool foreground, bool parentAlive, bool cancelled)
	{
		return !cancelled && foreground && parentAlive && limit > 0 && limit <= 120000 && elapsed >= 0 && elapsed < limit && elapsed - ping <= 1500;
	}
	private static int Invert(int origin, int next, int minimum, int length)
	{
		return (int)Math.Max(minimum, Math.Min((long)minimum + length - 1, 2L * origin - next));
	}
	private static int Coordinate(int value, int minimum, int length)
	{
		return (int)Math.Round(((long)value - minimum) * 65535.0 / Math.Max(1, length - 1));
	}
	private static bool Down(int key) { return (GetAsyncKeyState(key) & 0x8000) != 0; }
	private static bool Key(uint scan, bool up)
	{
		var input = new Input { Type = 1, Value = new InputUnion { Key = new KeyboardInput { Scan = (ushort)scan, Flags = ScanCode | (up ? KeyUp : 0) } } };
		return SendInput(1, new[] { input }, Marshal.SizeOf(typeof(Input))) == 1;
	}
	private static void Stop(string cause)
	{
		lock (StopLock) { if (stopping) return; reason = cause; stopping = true; }
		PostThreadMessage(thread, 0x0012, UIntPtr.Zero, IntPtr.Zero);
	}
	private static bool Active()
	{
		if (GetForegroundWindow() != target) { Stop("inputFocusLost"); return false; }
		if (!Allowed(Clock.ElapsedMilliseconds, duration, Interlocked.Read(ref lastPing), true, true, stopping)) { Stop("inputFinished"); return false; }
		return true;
	}
	private static IntPtr Keyboard(int code, IntPtr message, IntPtr data)
	{
		if (code < 0) return CallNextHookEx(keyboardHook, code, message, data);
		try
		{
			var key = (KeyboardData)Marshal.PtrToStructure(data, typeof(KeyboardData));
			if ((key.Flags & 0x10) != 0) return CallNextHookEx(keyboardHook, code, message, data);
			bool up = message.ToInt64() == 0x101 || message.ToInt64() == 0x105;
			bool down = message.ToInt64() == 0x100 || message.ToInt64() == 0x104;
			if (down && key.Vk == 0x7b && Down(0x11) && Down(0x10)) Stop("inputEmergency");
			uint mapped = Opposite(key.Scan);
			if (keyboardMode && (down || up) && mapped != 0 && (key.Flags & 1) == 0 && Active())
			{
				// Alt/Win combinations remain native; key-up still releases a mapped key.
				if (up && !Held.Contains(key.Scan)) return CallNextHookEx(keyboardHook, code, message, data);
				if (down && !Held.Contains(key.Scan) && (Down(0x12) || Down(0x5b) || Down(0x5c))) return CallNextHookEx(keyboardHook, code, message, data);
				if (!Key(mapped, up)) { Stop("inputSendFailed"); return CallNextHookEx(keyboardHook, code, message, data); }
				if (up) Held.Remove(key.Scan); else Held.Add(key.Scan);
				return new IntPtr(1);
			}
		}
		catch { Stop("inputUnavailable"); }
		return CallNextHookEx(keyboardHook, code, message, data);
	}
	private static IntPtr Mouse(int code, IntPtr message, IntPtr data)
	{
		if (code < 0 || message.ToInt64() != 0x200) return CallNextHookEx(mouseHook, code, message, data);
		try
		{
			var mouse = (MouseData)Marshal.PtrToStructure(data, typeof(MouseData));
			if ((mouse.Flags & 1) != 0 || !Active()) return CallNextHookEx(mouseHook, code, message, data);
			Point origin;
			if (!GetCursorPos(out origin)) { Stop("inputUnavailable"); return CallNextHookEx(mouseHook, code, message, data); }
			int left = GetSystemMetrics(76), top = GetSystemMetrics(77), width = GetSystemMetrics(78), height = GetSystemMetrics(79);
			if (width <= 1 || height <= 1) { Stop("inputUnavailable"); return CallNextHookEx(mouseHook, code, message, data); }
			var input = new Input { Type = 0, Value = new InputUnion { Mouse = new MouseInput {
				X = Coordinate(Invert(origin.X, mouse.Position.X, left, width), left, width),
				Y = Coordinate(Invert(origin.Y, mouse.Position.Y, top, height), top, height), Flags = MouseMove | Absolute | VirtualDesk } } };
			if (SendInput(1, new[] { input }, Marshal.SizeOf(typeof(Input))) != 1) { Stop("inputSendFailed"); return CallNextHookEx(mouseHook, code, message, data); }
			return new IntPtr(1);
		}
		catch { Stop("inputUnavailable"); }
		return CallNextHookEx(mouseHook, code, message, data);
	}
	private static void ReleaseKeys(bool restore)
	{
		foreach (uint scan in Scans) Key(scan, true);
		if (restore) foreach (uint scan in Held) Key(scan, false);
		Held.Clear();
	}
	// Pure policy/geometry checks only: no hooks, SendInput or foreground calls.
	private static int SelfTest()
	{
		foreach (uint scan in Scans) if (Opposite(Opposite(scan)) != scan || Opposite(scan) == scan) return 1;
		if (Opposite(0x01) != 0 || Opposite(0x57) != 0 || Marshal.SizeOf(typeof(Input)) != 40) return 1;
		if (!Allowed(19999, 20000, 19900, true, true, false) || Allowed(20000, 20000, 19900, true, true, false) ||
			Allowed(0, 120001, 0, true, true, false) || Allowed(1600, 20000, 0, true, true, false) ||
			Allowed(0, 20000, 0, false, true, false) || Allowed(0, 20000, 0, true, false, false) || Allowed(0, 20000, 0, true, true, true)) return 1;
		if (Invert(100, 110, 0, 1920) != 90 || Invert(-50, -60, -1920, 3840) != -40 || Invert(0, 20, 0, 1920) != 0 ||
			Coordinate(-1920, -1920, 3840) != 0 || Coordinate(1919, -1920, 3840) != 65535) return 1;
		Console.WriteLine("Controls mapping, deadlines, watchdog and virtual-screen geometry: OK (no input hooks)");
		return 0;
	}
	public static int Main(string[] args)
	{
		if (args.Length == 1 && args[0] == "--self-test") return SelfTest();
		// Recovery after an abnormal helper exit releases keys but never installs hooks.
		if (args.Length == 1 && args[0] == "--release-keys") { ReleaseKeys(false); return 0; }
		int parentId; long deadline;
		if (args.Length != 3 || !int.TryParse(args[0], out parentId) || parentId <= 0 ||
			(args[1] != "invert_wasd" && args[1] != "invert_mouse") || !long.TryParse(args[2], out deadline)) return 2;
		duration = Math.Min(120000, deadline - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
		if (duration <= 0) return 2;
		// Keep hook coordinates, cursor position and virtual-screen bounds in physical pixels.
		try { if (!SetProcessDpiAwarenessContext(new IntPtr(-4))) SetProcessDPIAware(); }
		catch (EntryPointNotFoundException) { SetProcessDPIAware(); }
		keyboardMode = args[1] == "invert_wasd";
		target = GetForegroundWindow();
		uint owner;
		if (target == IntPtr.Zero || target == GetShellWindow() || target == GetDesktopWindow() || !IsWindowVisible(target) ||
			GetWindowThreadProcessId(target, out owner) == 0 || owner == parentId) { Console.WriteLine("inputTargetUnavailable"); return 3; }
		Clock.Start();
		try
		{
			using (Process parent = Process.GetProcessById(parentId))
			{
				thread = GetCurrentThreadId();
				Message message; PeekMessage(out message, IntPtr.Zero, 0, 0, 0);
				keyboardHook = SetWindowsHookEx(13, KeyboardCallback, GetModuleHandle(null), 0);
				if (!keyboardMode) mouseHook = SetWindowsHookEx(14, MouseCallback, GetModuleHandle(null), 0);
				if (keyboardHook == IntPtr.Zero || (!keyboardMode && mouseHook == IntPtr.Zero)) { reason = "inputUnavailable"; return 4; }
				if (keyboardMode && Active() && !parent.HasExited)
				{
					keyboardStarted = true;
					foreach (uint scan in Scans) if (Down((int)MapVirtualKey(scan, 3))) Held.Add(scan);
					foreach (uint scan in Held) { if (!Active()) break; if (!Key(scan, true)) Stop("inputSendFailed"); }
					foreach (uint scan in Held) { if (!Active()) break; if (!Key(Opposite(scan), false)) Stop("inputSendFailed"); }
				}
				var reader = new Thread(() => {
					try { while (Console.ReadLine() == "ping") Interlocked.Exchange(ref lastPing, Clock.ElapsedMilliseconds); }
					catch { }
					finally { Stop("inputFinished"); }
				});
				reader.IsBackground = true; reader.Start();
				using (var watchdog = new Timer(_ => {
					try {
						if (GetForegroundWindow() != target) Stop("inputFocusLost");
						else if (!Allowed(Clock.ElapsedMilliseconds, duration, Interlocked.Read(ref lastPing), true, !parent.HasExited, stopping)) Stop("inputFinished");
					} catch { Stop("inputUnavailable"); }
				}, null, 0, 50))
				{
					Console.WriteLine("ready");
					while (!stopping && GetMessage(out message, IntPtr.Zero, 0, 0) > 0) { TranslateMessage(ref message); DispatchMessage(ref message); }
				}
			}
			return 0;
		}
		catch { reason = "inputUnavailable"; return 5; }
		finally
		{
			stopping = true;
			if (keyboardHook != IntPtr.Zero) UnhookWindowsHookEx(keyboardHook);
			if (mouseHook != IntPtr.Zero) UnhookWindowsHookEx(mouseHook);
			if (keyboardStarted) ReleaseKeys(GetForegroundWindow() == target && reason == "inputFinished");
			Console.WriteLine(reason);
		}
	}
}
