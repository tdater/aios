"""scripts/phone-access.ps1 puts HTTPS in front of AIOS for the owner's tailnet only. It must never publish to the internet."""
import re
from pathlib import Path

SCRIPT = (Path(__file__).resolve().parents[1] / "scripts" / "phone-access.ps1").read_text(encoding="utf-8")
CODE = "\n".join(l for l in SCRIPT.splitlines() if not l.lstrip().startswith("#"))


def test_it_never_runs_funnel_and_checks_for_it():
    assert not re.search(r"(tailscale|\$ts)(\.exe)?['\"]?\s+funnel\b", CODE, re.I)          # never invoked
    assert "Funnel on" in CODE and "serve reset" in CODE                                      # it detects public sharing and switches everything off


def test_it_shares_only_the_aios_port_and_leaves_aios_on_loopback():
    assert "'serve', '--bg', $Port" in CODE and "AIOS_HOST" not in CODE and "0.0.0.0" not in CODE
    assert "allowed-hosts.txt" in CODE and "-Off" in SCRIPT


def test_it_never_hangs_waiting_for_tailscale_to_approve_serve():
    assert "WaitForExit(20000)" in CODE and "Stop-Process" in CODE                          # `tailscale serve` waits forever until Serve is enabled in the browser
    assert "login\.tailscale\.com" in CODE and "Open this link" in CODE                    # so the link it prints is shown to the person
    assert "& $tailscale serve --bg" not in CODE                                                 # and it is never run as a blocking call


def test_it_does_not_reuse_the_name_of_its_own_switch_and_only_blames_https_when_tailscale_does():
    assert not re.search(r"^\s*\$status\s*=", CODE, re.I | re.M)                           # PowerShell names are case-insensitive: $status would collide with the -Status switch
    assert "$serveStatus" in CODE
    assert "-match 'HTTPS|certificate|cert'" in CODE
