# VHS tape file for Claude Session Manager demo
# https://github.com/charmbracelet/vhs

Output "demo.gif"

Require csm

Set Shell "bash"
Set FontSize 16
Set Width 1800
Set Height 800
Set TypingSpeed 40ms
Set Theme "Catppuccin Mocha"
Set Padding 20
Set Framerate 30
Set PlaybackSpeed 0.5
Set CursorBlink false

# ── Scene 1: Verbose table ────────────────────────────────

Type "csm list -v -n 10"
Enter
Sleep 4s

# ── Scene 2: Sort by size ─────────────────────────────────

Type "csm list -s size -n 5"
Enter
Sleep 4s

# ── Scene 3: Search ───────────────────────────────────────

Type "csm find 'refactor'"
Enter
Sleep 4s

# ── Scene 4: Stats ────────────────────────────────────────

Type "csm stats"
Enter
Sleep 4s

# ── Scene 5: Stats by language ────────────────────────────

Type "csm stats --by language"
Enter
Sleep 5s
