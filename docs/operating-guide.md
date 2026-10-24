# Operating guide

## Fresh setup
```powershell
cd C:\aios
.\scripts\setup.ps1                       # venv, deps, web build
.\.venv\Scripts\python.exe scripts\seed_sample.py   # optional sample workspace at C:\aios-workspaces\sample-project
.\scripts\start.ps1                       # http://127.0.0.1:8765
.\scripts\stop.ps1
```
Environment overrides: `AIOS_STATE_DIR`, `AIOS_WORKSPACES_DIR`, `AIOS_PORT`. `AIOS_HOST` must stay loopback.
Logs: `C:\aios-state\logs\server.{out,err}.log`.

## First run in the UI
1. **Projects** -> register a folder (AIOS only ever reads registered folders).
2. **Tasks** -> New task, kind `audit.workspace`, pick the project -> Run.
3. **Runs** -> open the run: timeline, steps, evidence, artifacts (audit report with sha256).
4. **Providers** shows real capability and billing mode. Gemini/Claude/Perplexity tasks never fake output:
   unavailable providers block the run; Claude/Perplexity produce a task packet you run yourself, then use
   **Import result** (stored as an unverified claim).
5. **Approvals** lists exact actions awaiting a decision; approvals are single use and bound to the action.
6. **Health** -> Back up now. Restore into an empty, separate directory with
   `python -c "from pathlib import Path; from aios import backup; from aios.config import load_settings; backup.restore_backup(Path(r'<zip>'), Path(r'<empty dir>'), load_settings())"` (run with `PYTHONPATH=apps\api`).

## Tests
```powershell
.\.venv\Scripts\python.exe -m pytest        # backend + API
cd apps\web; npm test; npm run build        # UI unit tests, typecheck, production build
```

## After a crash or reboot
Start normally. Startup reconciles: runs that were `running` become `interrupted` (never auto-restarted).
Open the run and press Resume. A run with an unfinished side-effect step stays blocked until you verify the
effect by hand; AIOS will not repeat it.

## Obsidian (optional, Phase 2 content)
Open `C:\aios-state\vault` as a vault in Obsidian. The DB and credentials are outside the vault. Obsidian is
never the scheduler or executor.
