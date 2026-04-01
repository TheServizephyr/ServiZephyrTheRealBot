!macro customInstall
  SetOutPath "$INSTDIR\resources"
  File /oname=servizephyr-icon.ico "${BUILD_RESOURCES_DIR}\icon.ico"
  Delete "$SMPROGRAMS\Electron.lnk"
  Delete "$DESKTOP\Electron.lnk"

  !ifndef DO_NOT_CREATE_START_MENU_SHORTCUT
    Delete "$newStartMenuLink"
    CreateShortCut "$newStartMenuLink" "$appExe" "" "$INSTDIR\resources\servizephyr-icon.ico" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
  !endif

  !ifndef DO_NOT_CREATE_DESKTOP_SHORTCUT
    ${ifNot} ${isNoDesktopShortcut}
      Delete "$newDesktopLink"
      CreateShortCut "$newDesktopLink" "$appExe" "" "$INSTDIR\resources\servizephyr-icon.ico" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
    ${endIf}
  !endif
!macroend
