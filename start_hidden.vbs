Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "E:\Claude\Motionist"
WshShell.Run "cmd /c npm run app", 0, False
