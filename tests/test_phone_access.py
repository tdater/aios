"""scripts/phone-access.ps1 puts HTTPS in front of AIOS for the owner's tailnet only. It must never publish to the internet."""
import re
from pathlib import Path

SCRIPT = (Path(__file__).resolve().parents[1] / "scripts" / "phone-access.ps1").read_text(encoding="utf-8")
CODE = "\n".join(l for l in SCRIPT.splitlines() if not l.lstrip().startswith("#"))


def test_it_never_runs_funnel_and_checks_for_it():
    assert not re.search(r"(tailscale|\$ts)(\.exe)?['\"]?\s+funnel\b", CODE, re.I)          # never invoked
    assert "Funnel on" in CODE and "serve reset" in CODE                                      # it detects public sharing and switches everything off


def test_it_shares_only_the_aios_port_and_leaves_aios_on_loopback():
    assert "serve --bg $Port" in CODE and "AIOS_HOST" not in CODE and "0.0.0.0" not in CODE
    assert "allowed-hosts.txt" in CODE and "-Off" in SCRIPT
