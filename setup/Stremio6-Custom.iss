#define MyAppName "Stremio6-Custom"
#define MyAppExe "Stremio6-Custom.exe"
#define public Dependency_NoExampleSetup
#include "CodeDependencies.iss"

[Setup]
AppId={{A73EA706-283D-4D1F-9580-2EFE5349F72D}
AppName={#MyAppName}
AppVersion={#PreviewVersion}
AppPublisher=Stremio6-Custom contributors
AppPublisherURL=https://github.com/kmaustin32/Stremio6-Custom
AppUpdatesURL=https://github.com/kmaustin32/Stremio6-Custom/releases
DefaultDirName={localappdata}\Programs\{#MyAppName}
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
DisableProgramGroupPage=yes
WizardStyle=modern
OutputBaseFilename={#MyAppName}-{#PreviewVersion}-x64-Setup
Compression=lzma2
SolidCompression=yes
SetupIconFile=..\images\stremio.ico
UninstallDisplayIcon={app}\{#MyAppExe}

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{userprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExe}"

[Run]
Filename: "{app}\{#MyAppExe}"; Description: "Open Stremio6-Custom"; Flags: postinstall nowait skipifsilent

[Code]
function InitializeSetup: Boolean;
begin
  Dependency_AddWebView2;
  Result := True;
end;
