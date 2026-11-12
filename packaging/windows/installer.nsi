Unicode true
SetCompressor /SOLID lzma
Name "Teoamoxtli"
OutFile "/out/Teoamoxtli-0.1.0-windows-x64-setup.exe"
InstallDir "$LOCALAPPDATA\Programs\Teoamoxtli"
InstallDirRegKey HKCU "Software\Teoamoxtli" "InstallDir"
RequestExecutionLevel user
VIProductVersion "0.1.0.0"
VIAddVersionKey "ProductName" "Teoamoxtli"
VIAddVersionKey "FileDescription" "Teoamoxtli - estudio bíblico local"
VIAddVersionKey "FileVersion" "0.1.0"
VIAddVersionKey "ProductVersion" "0.1.0"
VIAddVersionKey "LegalCopyright" "Teoamoxtli"

Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Section "Teoamoxtli (obligatorio)" SecMain
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  File /r "payload\*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\Teoamoxtli"
  CreateShortCut "$SMPROGRAMS\Teoamoxtli\Teoamoxtli.lnk" "$INSTDIR\teoamoxtli.exe"
  CreateShortCut "$SMPROGRAMS\Teoamoxtli\Desinstalar Teoamoxtli.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortCut "$DESKTOP\Teoamoxtli.lnk" "$INSTDIR\teoamoxtli.exe"
  WriteRegStr HKCU "Software\Teoamoxtli" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Teoamoxtli" "DisplayName" "Teoamoxtli"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Teoamoxtli" "DisplayVersion" "0.1.0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Teoamoxtli" "Publisher" "Teoamoxtli"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Teoamoxtli" "DisplayIcon" "$INSTDIR\teoamoxtli.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Teoamoxtli" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Teoamoxtli" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Teoamoxtli" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  Delete "$DESKTOP\Teoamoxtli.lnk"
  Delete "$SMPROGRAMS\Teoamoxtli\Teoamoxtli.lnk"
  Delete "$SMPROGRAMS\Teoamoxtli\Desinstalar Teoamoxtli.lnk"
  RMDir "$SMPROGRAMS\Teoamoxtli"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Teoamoxtli"
  DeleteRegKey HKCU "Software\Teoamoxtli"
SectionEnd
