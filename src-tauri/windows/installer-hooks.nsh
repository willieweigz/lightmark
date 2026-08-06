!macro NSIS_HOOK_POSTINSTALL
  ; Register LightMark as an available Markdown editor without overriding the
  ; user's current Windows default-app choice.
  WriteRegStr SHCTX "Software\Classes\LightMark.Markdown" "" "Markdown 文档"
  WriteRegStr SHCTX "Software\Classes\LightMark.Markdown\DefaultIcon" "" "$INSTDIR\lightmark.exe,0"
  WriteRegStr SHCTX "Software\Classes\LightMark.Markdown\shell\open\command" "" '"$INSTDIR\lightmark.exe" "%1"'

  WriteRegStr SHCTX "Software\Classes\.md\OpenWithProgids" "LightMark.Markdown" ""
  WriteRegStr SHCTX "Software\Classes\.markdown\OpenWithProgids" "LightMark.Markdown" ""

  WriteRegStr SHCTX "Software\Classes\Applications\lightmark.exe" "FriendlyAppName" "轻阅 Markdown"
  WriteRegStr SHCTX "Software\Classes\Applications\lightmark.exe\shell\open\command" "" '"$INSTDIR\lightmark.exe" "%1"'
  WriteRegStr SHCTX "Software\Classes\Applications\lightmark.exe\SupportedTypes" ".md" ""
  WriteRegStr SHCTX "Software\Classes\Applications\lightmark.exe\SupportedTypes" ".markdown" ""

  WriteRegStr SHCTX "Software\LightMark\Capabilities" "ApplicationName" "轻阅 Markdown"
  WriteRegStr SHCTX "Software\LightMark\Capabilities" "ApplicationDescription" "轻量、离线的 Markdown 阅读与编辑器"
  WriteRegStr SHCTX "Software\LightMark\Capabilities\FileAssociations" ".md" "LightMark.Markdown"
  WriteRegStr SHCTX "Software\LightMark\Capabilities\FileAssociations" ".markdown" "LightMark.Markdown"
  WriteRegStr SHCTX "Software\RegisteredApplications" "轻阅 Markdown" "Software\LightMark\Capabilities"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue SHCTX "Software\Classes\.md\OpenWithProgids" "LightMark.Markdown"
  DeleteRegValue SHCTX "Software\Classes\.markdown\OpenWithProgids" "LightMark.Markdown"
  DeleteRegKey SHCTX "Software\Classes\LightMark.Markdown"
  DeleteRegKey SHCTX "Software\Classes\Applications\lightmark.exe"
  DeleteRegValue SHCTX "Software\RegisteredApplications" "轻阅 Markdown"
  DeleteRegKey SHCTX "Software\LightMark"
!macroend
