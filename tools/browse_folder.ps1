# Native Windows folder-picker for the "Browse..." button in the app's
# Render menu — the app itself is a local browser page, and a website has
# no way to let the user pick an arbitrary WRITE destination on disk (a
# plain <input type=file> only reads files the user already picked, it
# can't hand back a folder path). This runs server-side instead — the
# server IS the user's own machine here — and prints the chosen path to
# stdout for server/index.mjs's /api/browse-folder route to read back.
# -STA (see the powershell invocation) is required: FolderBrowserDialog is
# WinForms, which needs a single-threaded apartment.
Add-Type -AssemblyName System.Windows.Forms
$dlg = New-Object System.Windows.Forms.FolderBrowserDialog
$dlg.Description = "Choose where to save the rendered reel"
$dlg.ShowNewFolderButton = $true
$result = $dlg.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output $dlg.SelectedPath
}
