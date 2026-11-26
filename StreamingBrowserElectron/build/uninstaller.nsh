; The installer stays one-click. Only the uninstaller gets a choice page.
!ifdef BUILD_UNINSTALLER
  !include Sections.nsh
  !define UNINSTALL_SECTION_NAME "Programmdateien entfernen"
  !define MUI_UNCOMPONENTSPAGE_TEXT_TOP "Was soll entfernt werden?$\r$\n$\r$\nOhne das zweite Häkchen werden nur die Programmdateien entfernt. Deine Daten bleiben für eine Neuinstallation erhalten."
  !define MUI_UNCOMPONENTSPAGE_TEXT_COMPLIST "Zum vollständigen Entfernen auch die lokalen Benutzerdaten auswählen:"

  Var ElfixDataRemovalAllowed
  Var ElfixCleanupFailed

  !macro customHeader
    ; oneClick.nsh has already supplied the existing per-user initialization
    ; and progress page. Disable its automatic confirmation/silent mode/Quit
    ; so the components page and the optional section can actually run.
    !undef ONE_CLICK
  !macroend

  !macro customUnInit
    Call un.ElfixInitDataChoice
  !macroend

  !macro customUnInstallSection
    Section /o "un.Auch alle lokalen Benutzerdaten löschen" ELFIX_USER_DATA_SECTION
      ; Never remove profiles during updates or unattended uninstalls.
      ${If} $ElfixDataRemovalAllowed == "1"
        SetShellVarContext current
        StrCpy $ElfixCleanupFailed "0"
        !insertmacro ElfixRemoveDataDirectory "$APPDATA" "ELFIX"
        ; Otherwise ensureDataDir() would restore the old profile on reinstall.
        !insertmacro ElfixRemoveDataDirectory "$APPDATA" "GlobalSearchHub"
        !insertmacro ElfixRemoveDataDirectory "$LOCALAPPDATA" "elfix-updater"
        ${If} $installMode == "all"
          SetShellVarContext all
        ${EndIf}
        ${If} $ElfixCleanupFailed == "1"
          SetDetailsView show
          MessageBox MB_OK|MB_ICONEXCLAMATION "Die Programmdateien wurden entfernt. Einige lokale Benutzerdaten konnten nicht gelöscht werden, weil Dateien gesperrt sind oder Zugriffsrechte fehlen. Die verbliebenen Ordner stehen unter Details." /SD IDOK
          SetErrorLevel 1
        ${EndIf}
      ${EndIf}
    SectionEnd

    Function un.ElfixInitDataChoice
      StrCpy $ElfixDataRemovalAllowed "1"
      ${If} ${Silent}
      ${OrIf} ${isUpdated}
        StrCpy $ElfixDataRemovalAllowed "0"
      ${EndIf}
      ${GetParameters} $R0
      ClearErrors
      ${GetOptions} $R0 "/KEEP_APP_DATA" $R1
      ${IfNot} ${Errors}
        StrCpy $ElfixDataRemovalAllowed "0"
      ${EndIf}
      ${If} $ElfixDataRemovalAllowed == "0"
        ; Unchecked and disabled, even if another section changes its state.
        SectionSetFlags ${ELFIX_USER_DATA_SECTION} ${SF_RO}
      ${EndIf}

      ; electron-builder otherwise deletes the profile unconditionally for this
      ; old CLI flag, bypassing both the choice and its update/silent guards.
      ClearErrors
      ${GetOptions} $R0 "--delete-app-data" $R1
      ${IfNot} ${Errors}
        IfSilent +2
        MessageBox MB_OK|MB_ICONEXCLAMATION "Bitte starte die Deinstallation ohne --delete-app-data und wähle dort aus, ob deine Benutzerdaten gelöscht werden sollen."
        SetErrorLevel 2
        Quit
      ${EndIf}
    FunctionEnd

    ; NSIS RMDir /r follows directory junctions. Walk ordinary directories
    ; ourselves and remove reparse points without ever visiting their targets.
    Function un.ElfixRemoveTree
      Exch $R0
      Push $R1
      Push $R2
      Push $R3
      System::Call 'kernel32::GetFileAttributesW(w R0) i.R1 ?e'
      Pop $R2
      ${If} $R1 == -1
        ${If} $R2 != 2
        ${AndIf} $R2 != 3
          StrCpy $ElfixCleanupFailed "1"
          DetailPrint "Nicht lesbar: $R0"
        ${EndIf}
      ${Else}
        IntOp $R2 $R1 & 0x10 ; FILE_ATTRIBUTE_DIRECTORY
        ${If} $R2 == 0
          ClearErrors
          Delete "$R0"
        ${Else}
          IntOp $R2 $R1 & 0x400 ; FILE_ATTRIBUTE_REPARSE_POINT
          ${If} $R2 == 0
            FindFirst $R1 $R3 "$R0\*"
            ${DoWhile} $R3 != ""
              ${If} $R3 != "."
              ${AndIf} $R3 != ".."
                Push "$R0\$R3"
                Call un.ElfixRemoveTree
              ${EndIf}
              FindNext $R1 $R3
            ${Loop}
            FindClose $R1
          ${EndIf}
          ClearErrors
          RMDir "$R0"
        ${EndIf}
        ${If} ${Errors}
          StrCpy $ElfixCleanupFailed "1"
          DetailPrint "Nicht vollständig entfernt: $R0"
        ${EndIf}
      ${EndIf}
      Pop $R3
      Pop $R2
      Pop $R1
      Pop $R0
    FunctionEnd
  !macroend

  !macro ElfixRemoveDataDirectory ROOT CHILD
    ; Only fixed app-owned child directories of the current user's shell folders.
    ${If} "${ROOT}" == ""
      StrCpy $ElfixCleanupFailed "1"
    ${Else}
      Push "${ROOT}\${CHILD}"
      Call un.ElfixRemoveTree
    ${EndIf}
  !macroend
!endif
