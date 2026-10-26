# Creates a tiny practice project for trying AIOS: a calculator with one deliberate bug and a test that catches it.
# It only ever creates a NEW folder; it refuses to touch a folder that already exists.
param([string]$Path = 'C:\aios-playground\calc')
$ErrorActionPreference = 'Stop'

if (Test-Path $Path) { Write-Error "$Path already exists. Choose another path, for example: scripts\make_practice_project.ps1 -Path C:\aios-playground\calc2"; exit 1 }
New-Item -ItemType Directory -Force $Path | Out-Null

@'
def add(a, b):
    return a - b


def multiply(a, b):
    return a * b
'@ | Set-Content (Join-Path $Path 'calc.py') -Encoding utf8

@'
import unittest
from calc import add, multiply


class CalcTests(unittest.TestCase):
    def test_add(self):
        self.assertEqual(add(2, 3), 5)

    def test_multiply(self):
        self.assertEqual(multiply(2, 3), 6)


if __name__ == "__main__":
    unittest.main()
'@ | Set-Content (Join-Path $Path 'test_calc.py') -Encoding utf8

git -C $Path init -q -b main
git -C $Path add -A
git -C $Path -c user.name=Tester -c user.email=tester@example.com -c commit.gpgsign=false commit -q -m 'Practice project'
Write-Host "Practice project created at $Path"
Write-Host "It has one deliberately failing test. Register this folder in AIOS (Projects -> Register a workspace)."
