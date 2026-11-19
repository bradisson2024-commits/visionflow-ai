# Crea en el Escritorio los iconos "Cenit Studio" y "Detener Cenit Studio", y hace que Cenit Studio
# se encienda solo (sin abrir el navegador) al iniciar Windows.
$aqui = $PSScriptRoot
$w = New-Object -ComObject WScript.Shell
$escritorio = [Environment]::GetFolderPath('Desktop')
$inicio = [Environment]::GetFolderPath('Startup')

$a = $w.CreateShortcut((Join-Path $escritorio 'Cenit Studio.lnk'))
$a.TargetPath = 'wscript.exe'
$a.Arguments = '"' + (Join-Path $aqui 'Cenit Studio.vbs') + '"'
$a.WorkingDirectory = $aqui
$a.IconLocation = 'shell32.dll,13'
$a.Save()

$b = $w.CreateShortcut((Join-Path $escritorio 'Detener Cenit Studio.lnk'))
$b.TargetPath = Join-Path $aqui 'Detener Cenit Studio.bat'
$b.WorkingDirectory = $aqui
$b.IconLocation = 'shell32.dll,27'
$b.Save()

$c = $w.CreateShortcut((Join-Path $inicio 'Cenit Studio (inicio).lnk'))
$c.TargetPath = 'wscript.exe'
$c.Arguments = '"' + (Join-Path $aqui 'Cenit Studio.vbs') + '" inicio'
$c.WorkingDirectory = $aqui
$c.Save()

Write-Host ''
Write-Host 'Listo: en el Escritorio tienes "Cenit Studio" y "Detener Cenit Studio".'
Write-Host 'Cenit Studio se encendera solo cada vez que inicies Windows.'
