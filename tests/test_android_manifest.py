"""The Android manifest keeps its hardening (one permission, no backups, no cleartext) while also installing on Android TV."""
import re
from pathlib import Path

MANIFEST = (Path(__file__).resolve().parents[1] / "apps" / "web" / "android" / "app" / "src" / "main" / "AndroidManifest.xml").read_text(encoding="utf-8")


def test_only_the_internet_permission_is_requested():
    assert re.findall(r'<uses-permission android:name="([^"]+)"', MANIFEST) == ["android.permission.INTERNET"]


def test_the_hardening_is_intact():
    for needle in ('android:allowBackup="false"', 'android:usesCleartextTraffic="false"', 'android:networkSecurityConfig='):
        assert needle in MANIFEST
    assert MANIFEST.count('android:exported="true"') == 1                       # a single exported component


def test_the_app_can_be_installed_and_launched_on_android_tv():
    assert re.search(r'android.hardware.touchscreen"\s+android:required="false"', MANIFEST)       # a remote-only box has no touchscreen
    assert re.search(r'android.software.leanback"\s+android:required="false"', MANIFEST)           # TV capable, still a normal phone app
    assert "android.intent.category.LEANBACK_LAUNCHER" in MANIFEST and "android.intent.category.LAUNCHER" in MANIFEST
    assert "android:banner=" in MANIFEST
