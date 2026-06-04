' MTB Hub silent launcher
Set sh = CreateObject("WScript.Shell")
hub = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
sh.CurrentDirectory = hub
' 0 = window hidden, False = async
sh.Run "cmd /c npx tsx src/index.ts", 0, False
