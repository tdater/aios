# Release checklist

Publishing is outward-facing, so each step that leaves this computer needs the owner's say-so.

1. `main` is green: backend `pytest`, web `npm test`, `tsc`, `npm run build`, secret scan (`python scripts/scan_secrets.py`), and the CI run on the merge commit.
2. Real-browser e2e passes: `cd apps\web; npm run build; node e2e\mobile.e2e.mjs`.
3. Optional but recommended before a release: run `scripts\run_calibration.py --model opus` once and note the scorecard in the release notes.
4. Update `CHANGELOG.md` (move "Unreleased" under the new version and date) and `docs/HANDOFF.md`.
5. Bump the version in `pyproject.toml` and `apps/web/package.json` (and `versionName` in the Android project if an APK is attached).
6. Re-read the diff for private data: no tokens, keystores, personal paths, imported history or state. The repo is public.
7. Tag and publish (owner approves each): `git tag -a v0.3.0 -m "AIOS 0.3.0"`, `git push origin v0.3.0`, then `gh release create v0.3.0 --title "AIOS 0.3.0" --notes-file <notes>`.
8. Attach assets only if they exist and were built from the tag: a debug APK is for testers, not a store release. A signed release APK needs the owner's keystore, which never goes in the repo.
9. The project is MIT licensed (`LICENSE`). Keep the copyright line current.
