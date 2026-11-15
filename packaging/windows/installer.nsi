Unicode true
SetCompressor /SOLID lzma
Name "Minelly"
OutFile "/out/Minelly-0.2.0-windows-x64-setup.exe"
InstallDir "$LOCALAPPDATA\Programs\Minelly"
InstallDirRegKey HKCU "Software\Minelly" "InstallDir"
RequestExecutionLevel user
VIProductVersion "0.2.0.0"
VIAddVersionKey "ProductName" "Minelly"
VIAddVersionKey "FileDescription" "Minelly - estudio bíblico local"
VIAddVersionKey "FileVersion" "0.2.0"
VIAddVersionKey "ProductVersion" "0.2.0"
VIAddVersionKey "LegalCopyright" "Minelly"

Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Section "Minelly (obligatorio)" SecMain
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  File /r "payload\*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\Minelly"
  CreateShortCut "$SMPROGRAMS\Minelly\Minelly.lnk" "$INSTDIR\minelly.exe"
  CreateShortCut "$SMPROGRAMS\Minelly\Desinstalar Minelly.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortCut "$DESKTOP\Minelly.lnk" "$INSTDIR\minelly.exe"
  WriteRegStr HKCU "Software\Minelly" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Minelly" "DisplayName" "Minelly"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Minelly" "DisplayVersion" "0.2.0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Minelly" "Publisher" "Minelly"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Minelly" "DisplayIcon" "$INSTDIR\minelly.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Minelly" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Minelly" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Minelly" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  Delete "$DESKTOP\Minelly.lnk"
  Delete "$SMPROGRAMS\Minelly\Minelly.lnk"
  Delete "$SMPROGRAMS\Minelly\Desinstalar Minelly.lnk"
  RMDir "$SMPROGRAMS\Minelly"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Minelly"
  DeleteRegKey HKCU "Software\Minelly"
SectionEnd
