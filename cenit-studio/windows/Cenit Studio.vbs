' Abre Cenit Studio: enciende el servidor sin ventana (si no estaba encendido) y abre la pagina en el navegador.
Set sh = CreateObject("WScript.Shell")
carpeta = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.Run "cmd /c """ & carpeta & "\servidor.bat""", 0, False
If WScript.Arguments.Count = 0 Then
  WScript.Sleep 5000
  sh.Run "http://localhost:8080"
End If
