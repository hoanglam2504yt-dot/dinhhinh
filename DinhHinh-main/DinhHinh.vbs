Option Explicit

Dim fso, jsxPath, appRef
jsxPath = "L:\Decal\Tool_DinhHinh\DinhHinh-main\DinhHinh.jsx"

Set fso = CreateObject("Scripting.FileSystemObject")

If Not fso.FileExists(jsxPath) Then
    WScript.Echo "Khong tim thay file JSX tai duong dan: " & jsxPath
    Set fso = Nothing
    WScript.Quit 1
End If

On Error Resume Next
Set appRef = CreateObject("Illustrator.Application")

If Err.Number <> 0 Then
    WScript.Echo "Loi khi khoi dong Adobe Illustrator: " & Err.Description
    Err.Clear
    Set fso = Nothing
    WScript.Quit 1
End If

appRef.DoJavaScriptFile jsxPath

If Err.Number <> 0 Then
    WScript.Echo "Loi khi thuc thi DinhHinh.jsx: " & Err.Description
    Err.Clear
End If
On Error GoTo 0

Set appRef = Nothing
Set fso = Nothing
