#define MyAppName "Stremio 6 Expanded"
#define MyAppExe "Stremio 6 Expanded.exe"
#define public Dependency_NoExampleSetup
#include "CodeDependencies.iss"

[Setup]
AppId={{A73EA706-283D-4D1F-9580-2EFE5349F72D}
AppName={#MyAppName}
AppVersion={#PreviewVersion}
AppPublisher=Stremio 6 Expanded contributors
AppPublisherURL=https://github.com/kmaustin32/Stremio-6-Expanded
AppUpdatesURL=https://github.com/kmaustin32/Stremio-6-Expanded/releases
DefaultDirName={localappdata}\Programs\{#MyAppName}
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
DisableProgramGroupPage=yes
WizardStyle=modern
OutputBaseFilename=Stremio-6-Expanded-{#PreviewVersion}-x64-Setup
Compression=lzma2
SolidCompression=yes
SetupIconFile=..\images\stremio.ico
UninstallDisplayIcon={app}\{#MyAppExe}

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion
; Keep existing taskbar pins functional; new installations only get the new executable.
Source: "{#PayloadDir}\{#MyAppExe}"; DestDir: "{app}"; DestName: "Stremio6-Custom.exe"; Flags: ignoreversion; Check: HasLegacyExecutable

[InstallDelete]
Type: files; Name: "{userprograms}\Stremio6-Custom.lnk"

[Icons]
Name: "{userprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExe}"

[Run]
Filename: "{app}\{#MyAppExe}"; Description: "Open Stremio 6 Expanded"; Flags: postinstall nowait skipifsilent

[Code]
function HasLegacyExecutable: Boolean;
begin
  Result := FileExists(ExpandConstant('{app}\Stremio6-Custom.exe'));
end;

function InitializeSetup: Boolean;
begin
  Dependency_AddWebView2;
  Result := True;
end;
