#ifndef AppVersion
  #error AppVersion is required
#endif
[Setup]
AppId={{5431F79E-B94F-4474-8727-21426CCB251A}
AppName=Dudos Desk
AppVersion={#AppVersion}
AppPublisher=FermionaPlay
AppPublisherURL=https://github.com/foolka/dudos-desk
DefaultDirName={localappdata}\Programs\Dudos Desk
DisableDirPage=yes
UsePreviousAppDir=no
DefaultGroupName=Dudos Desk
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
DisableProgramGroupPage=yes
WizardStyle=modern
SetupIconFile={#PackageDir}\resources\app.ico
UninstallDisplayIcon={app}\DudosDesk.exe
OutputDir={#OutputDir}
OutputBaseFilename=dudos-desk-{#AppVersion}-windows-x64-setup
Compression=lzma2
SolidCompression=yes
CloseApplications=no
RestartApplications=no
[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"
Name: "ru"; MessagesFile: "compiler:Languages\Russian.isl"
Name: "uk"; MessagesFile: "compiler:Languages\Ukrainian.isl"
[Tasks]
Name: "desktopicon"; Description: "Desktop shortcut / Ярлык на рабочем столе / Ярлик на робочому столі"
[Files]
Source: "{#PackageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{group}\Dudos Desk"; Filename: "{app}\DudosDesk.exe"; WorkingDir: "{app}"; AppUserModelID: "com.fermionaplay.dudosdesk"
Name: "{autodesktop}\Dudos Desk"; Filename: "{app}\DudosDesk.exe"; WorkingDir: "{app}"; AppUserModelID: "com.fermionaplay.dudosdesk"; Tasks: desktopicon
[Run]
Filename: "{app}\DudosDesk.exe"; Description: "Launch Dudos Desk"; Flags: postinstall nowait skipifsilent
[Code]
function ProcessGuard(): String;
var Locator, Services, Items: Variant;
begin
  Result := '';
  try
    Locator := CreateOleObject('WbemScripting.SWbemLocator');
    Services := Locator.ConnectServer('.', 'root\CIMV2');
    Items := Services.ExecQuery('SELECT ProcessId FROM Win32_Process WHERE Name = ''DudosDesk.exe''');
    if Items.Count > 0 then Result := 'Close Dudos Desk before installing. Your data will be kept.';
  except
    Result := 'Could not check running applications. Installation cancelled.';
  end;
end;
function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := ProcessGuard();
end;
function InitializeUninstall(): Boolean;
var Reason: String;
begin
  Reason := ProcessGuard(); Result := Reason = '';
  if not Result then MsgBox(Reason, mbInformation, MB_OK);
end;
