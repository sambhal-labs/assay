# VHS tape for the README hero GIF — render with: vhs demo/demo.tape
# https://github.com/charmbracelet/vhs

Output demo/assay-demo.gif

Set FontSize 15
Set Width 900
Set Height 620
Set Theme "Catppuccin Mocha"
Set Padding 12
Set TypingSpeed 40ms

Type "npx assaydev skill fixtures/skills/mediocre"
Sleep 500ms
Enter
Sleep 4s

Type "npx assaydev ci fixtures/skills/mediocre --threshold B"
Sleep 500ms
Enter
Sleep 4s

Type "# every deduction has a rule id, a fix, and a grade impact"
Sleep 2s
