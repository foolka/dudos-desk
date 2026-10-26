#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <roapi.h>
#include <wrl.h>
#include <wrl/wrappers/corewrappers.h>
#include <windows.ui.shell.h>
#include <delayimp.h>
#include <node_api.h>

using Microsoft::WRL::ComPtr;
using Microsoft::WRL::Wrappers::HStringReference;
using ABI::Windows::UI::Shell::ITaskbarManager;
using ABI::Windows::UI::Shell::ITaskbarManagerStatics;
using ABI::Windows::Foundation::IAsyncInfo;
using ABI::Windows::Foundation::AsyncStatus;

// Node-API is exported by the renamed Electron executable, not a separate node.exe.
static FARPROC WINAPI ResolveNode(unsigned reason, PDelayLoadInfo info) {
    if (reason == dliNotePreLoadLibrary && _stricmp(info->szDll, "node.exe") == 0)
        return reinterpret_cast<FARPROC>(GetModuleHandleW(nullptr));
    return nullptr;
}
extern "C" const PfnDliHook __pfnDliNotifyHook2 = ResolveNode;

static ComPtr<ABI::Windows::Foundation::__FIAsyncOperation_1_boolean_t> pending;
static bool requesting = false;
static const GUID desktopSupport = {0xcdfefd63, 0xe879, 0x4134, {0xb9, 0xa7, 0x82, 0x83, 0xf0, 0x5f, 0x94, 0x80}};

// Respect Microsoft's documented feature gate on older Windows; never change it.
static bool NeedsToken() {
    HKEY key = nullptr;
    const auto opened = RegOpenKeyExW(HKEY_LOCAL_MACHINE,
        L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AppModel\\LimitedAccessFeatures\\com.microsoft.windows.taskbar.pin",
        0, KEY_READ | KEY_WOW64_64KEY, &key);
    if (opened == ERROR_FILE_NOT_FOUND) return false;
    if (opened != ERROR_SUCCESS) return true;
    DWORD value = 0, size = sizeof(value), type = 0;
    const auto read = RegQueryValueExW(key,
        L"4096B239A7295B635C090E647E867B5707DA6AB6CB78340B01FE4E0C8F4953D4",
        nullptr, &type, reinterpret_cast<BYTE*>(&value), &size);
    RegCloseKey(key);
    if (read == ERROR_FILE_NOT_FOUND) return false;
    return read != ERROR_SUCCESS || type != REG_DWORD || value != 0;
}

// Return compact status codes; the renderer owns localized presentation.
static napi_value Result(napi_env env, const char* text) {
    napi_value value;
    napi_create_string_utf8(env, text, NAPI_AUTO_LENGTH, &value);
    return value;
}

// Begin on Electron's UI thread; the JavaScript event loop polls without blocking.
static napi_value Begin(napi_env env, napi_callback_info info) {
    if (pending) return Result(env, "busy");
    napi_value args[2]; size_t argc = 2; bool request = false, isBuffer = false;
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    if (argc != 2 || napi_get_value_bool(env, args[0], &request) != napi_ok ||
        napi_is_buffer(env, args[1], &isBuffer) != napi_ok || !isBuffer) return Result(env, "unavailable");
    void* bytes = nullptr; size_t length = 0;
    napi_get_buffer_info(env, args[1], &bytes, &length);
    if (length != sizeof(HWND)) return Result(env, "unavailable");
    HWND hwnd = *static_cast<HWND*>(bytes);
    DWORD pid = 0;
    const auto thread = GetWindowThreadProcessId(hwnd, &pid);
    if (pid != GetCurrentProcessId() || thread != GetCurrentThreadId()) return Result(env, "unavailable");
    if (request && GetForegroundWindow() != hwnd) return Result(env, "foreground");
    if (NeedsToken()) return Result(env, "manual");
    ComPtr<ITaskbarManagerStatics> factory;
    auto hr = RoGetActivationFactory(HStringReference(RuntimeClass_Windows_UI_Shell_TaskbarManager).Get(), IID_PPV_ARGS(&factory));
    if (FAILED(hr)) return Result(env, "manual");
    ComPtr<IUnknown> marker;
    if (FAILED(factory->QueryInterface(desktopSupport, &marker))) return Result(env, "manual");
    ComPtr<ITaskbarManager> manager;
    boolean supported = false;
    if (FAILED(factory->GetDefault(&manager)) || !manager || FAILED(manager->get_IsSupported(&supported)) || !supported)
        return Result(env, "manual");
    if (request) {
        boolean allowed = false;
        if (FAILED(manager->get_IsPinningAllowed(&allowed)) || !allowed) return Result(env, "notAllowed");
        hr = manager->RequestPinCurrentAppAsync(&pending);
    } else {
        hr = manager->IsCurrentAppPinnedAsync(&pending);
    }
    requesting = request;
    if (FAILED(hr) || !pending) { pending.Reset(); return Result(env, "unavailable"); }
    return Result(env, "pending");
}

// Poll the WinRT operation on the same thread that started it.
static napi_value Poll(napi_env env, napi_callback_info) {
    if (!pending) return Result(env, "unavailable");
    ComPtr<IAsyncInfo> info; AsyncStatus status;
    if (FAILED(pending.As(&info)) || FAILED(info->get_Status(&status))) { pending.Reset(); return Result(env, "unavailable"); }
    if (status == AsyncStatus::Started) return Result(env, "pending");
    boolean pinned = false;
    const auto hr = status == AsyncStatus::Completed ? pending->GetResults(&pinned) : E_FAIL;
    pending.Reset();
    if (FAILED(hr)) return Result(env, "unavailable");
    return Result(env, pinned ? "pinned" : requesting ? "cancelled" : "notPinned");
}

// Abandon a timed-out operation without keeping the application alive.
static napi_value Cancel(napi_env env, napi_callback_info) {
    if (pending) { ComPtr<IAsyncInfo> info; if (SUCCEEDED(pending.As(&info))) info->Cancel(); pending.Reset(); }
    return Result(env, "unavailable");
}

static napi_value Init(napi_env env, napi_value exports) {
    napi_property_descriptor properties[] = {
        {"begin", nullptr, Begin, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"poll", nullptr, Poll, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"cancel", nullptr, Cancel, nullptr, nullptr, nullptr, napi_default, nullptr}
    };
    napi_define_properties(env, exports, 3, properties);
    return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
