#!/usr/bin/env python3
"""Koulaxizis Apps in an emulator against the real repositories (APPS-M1).

Installs the debug APK, opens it and checks that every project's signed
repository was read (orOS, NULL JSFX and Noxpress headers with their
apps), that the daily check posts its update notice for an older app
that was left after the screen showed it, then installs one small real app through the manager, answering
Android's own confirmation, and checks that Android has it. Screenshots
and UI dumps go to the output folder.

    python3 koulaxizis-apps/tests/device_test.py <debug.apk> <out dir>
"""
import os
import re
import subprocess
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET

PKG = "gr.koulaxizis.apps.debug"
TARGET = "tech.nulljsfx.remote.mixers"  # about 4 MB, minSdk 26
# An older Remote for DAWs, so one update waits (the daily check's notice).
OLD = "tech.nulljsfx.remote.daws"
OLD_APK = "https://github.com/koulaxizis/null-jsfx/releases/download/4.0/NULL-JSFX-Remote-DAWs-Android.apk"
OUT = sys.argv[2] if len(sys.argv) > 2 else "device-shots"
step = 0


def adb(*args, check=True):
    r = subprocess.run(["adb", *args], capture_output=True, text=True, timeout=120)
    if check and r.returncode != 0:
        raise SystemExit(f"adb {' '.join(args)} failed: {r.stdout}{r.stderr}")
    return r.stdout


def shot(name):
    global step
    step += 1
    path = os.path.join(OUT, f"{step:02d}-{name}")
    with open(path + ".png", "wb") as f:
        f.write(subprocess.run(["adb", "exec-out", "screencap", "-p"], capture_output=True, timeout=60).stdout)
    return path


def dump():
    adb("shell", "uiautomator", "dump", "/sdcard/ui.xml", check=False)
    xml = adb("shell", "cat", "/sdcard/ui.xml", check=False)
    try:
        return ET.fromstring(xml[xml.index("<?xml"):] if "<?xml" in xml else xml)
    except (ET.ParseError, ValueError):
        return None


def texts(root):
    return [] if root is None else [n.get("text", "") for n in root.iter("node")]


def center(node):
    a, b, c, d = map(int, re.findall(r"\d+", node.get("bounds")))
    return (a + c) // 2, (b + d) // 2


def wait_for(pred, what, seconds=120):
    end = time.time() + seconds
    while time.time() < end:
        root = dump()
        got = pred(root)
        # An Element without children is falsy, so test for None/False.
        if got is not None and got is not False:
            return root, got
        time.sleep(2)
    path = shot("timeout")
    seen = "\n".join(texts(dump()))
    log = adb("logcat", "-d", "-v", "brief", "AndroidRuntime:E", "System.err:W", "PackageInstaller:*", "KoulaxizisApps:*", "*:S", check=False)
    with open(path + ".txt", "w") as f:
        f.write(seen + "\n\n" + log)
    print("--- screen texts ---\n" + seen + "\n--- logcat ---\n" + log[-6000:])
    raise SystemExit(f"timed out waiting for {what}")


def screen():
    m = re.search(r"(\d+)x(\d+)", adb("shell", "wm", "size"))
    return int(m.group(1)), int(m.group(2))


def swipe(up):
    w, h = screen()
    a, b = (h * 3 // 4, h // 3) if up else (h // 3, h * 3 // 4)
    adb("shell", "input", "swipe", str(w // 2), str(a), str(w // 2), str(b), "300")


def scroll_to(text, seconds=120):
    end = time.time() + seconds
    while time.time() < end:
        root = dump()
        for n in [] if root is None else root.iter("node"):
            if n.get("text") == text:
                return root, n
        swipe(True)
        time.sleep(1)
    raise SystemExit(f"{text} not found in the list")


def main():
    os.makedirs(OUT, exist_ok=True)
    adb("uninstall", TARGET, check=False)
    adb("uninstall", OLD, check=False)
    adb("install", "-r", sys.argv[1])
    old = os.path.join(OUT, "old-daws.apk")
    urllib.request.urlretrieve(OLD_APK, old)
    adb("install", old)
    # The one-time "install unknown apps" switch the person turns on.
    adb("shell", "appops", "set", PKG, "REQUEST_INSTALL_PACKAGES", "allow")
    # Android 13+ asks once for notices (the daily check); answered here.
    adb("shell", "pm", "grant", PKG, "android.permission.POST_NOTIFICATIONS", check=False)
    # A freshly booted emulator can need a while before its Wi-Fi carries
    # traffic; the app's first check would then rightly show "could not reach".
    end = time.time() + 120
    while time.time() < end:
        # Android marks a network VALIDATED once it reached the internet
        # (ICMP ping is blocked on hosted runners, so no ping here).
        if "VALIDATED" in adb("shell", "dumpsys", "connectivity", check=False):
            break
        time.sleep(3)
    else:
        print("network not up after 120 s:", adb("shell", "dumpsys", "connectivity", check=False)[-2000:])
    adb("shell", "am", "start", "-W", "-n", f"{PKG}/gr.koulaxizis.apps.MainActivity")

    # "VALIDATED" can also be read in a request list before any network
    # carries traffic, so the first check may still fail (seen in CI:
    # "network" for all three while the repositories answered). Like a
    # person would, press Refresh while every repository is unreachable.
    tapped = [time.time()]

    def loaded(root):
        t = texts(root)
        if "orOS" in t and "orOS Drive" in t and any(x.startswith("Repositories updated") for x in t):
            return True
        unreachable = sum(1 for x in t if x.startswith("Could not reach the repository"))
        if root is not None and unreachable >= 3 and time.time() - tapped[0] > 15:
            for n in root.iter("node"):
                if (n.get("resource-id") or "").endswith(":id/refresh") or n.get("content-desc") == "Check for updates":
                    adb("shell", "input", "tap", *map(str, center(n)), check=False)
                    tapped[0] = time.time()
                    print("all repositories unreachable: pressed Refresh")
                    break
        return False

    wait_for(loaded, "the verified orOS list", 240)
    shot("list-top")
    # The daily check is in place (APPS-M2).
    jobs = adb("shell", "dumpsys", "jobscheduler", PKG, check=False)
    if "UpdateJob" not in jobs:
        print(jobs[-3000:])
        raise SystemExit("the daily check was not scheduled")
    # The screen showed the waiting update and the person left it: the
    # daily check still tells about it (Chris 2026-11-19, no notices at all).
    adb("shell", "input", "keyevent", "KEYCODE_HOME")
    adb("shell", "cmd", "jobscheduler", "run", "-f", PKG, "1")
    end = time.time() + 120
    while time.time() < end:
        notes = adb("shell", "dumpsys", "notification", "--noredact", check=False)
        if re.search(r"pkg=" + re.escape(PKG) + r"\b.*?id=1\b", notes):
            break
        time.sleep(3)
    else:
        print(notes[-3000:])
        raise SystemExit("the daily check posted no update notice")
    adb("shell", "cmd", "statusbar", "expand-notifications", check=False)
    time.sleep(2)
    shot("update-notice")
    adb("shell", "cmd", "statusbar", "collapse", check=False)
    adb("shell", "am", "start", "-W", "-n", f"{PKG}/gr.koulaxizis.apps.MainActivity")
    # The other projects are further down the one list (a small screen).
    scroll_to("NULL JSFX")
    scroll_to("Remote for DAWs")
    root, _ = scroll_to("Noxpress")
    shot("list-noxpress")
    for name in ("Site Bridge", "Live Operator"):
        scroll_to(name)
    # Glarolykoi is its own section at the end, read from the orOS repository (APPS-M3).
    scroll_to("Glarolykoi")
    shot("list-glarolykoi")
    # Back up to NULL JSFX and install Remote for Mixers through the manager.
    for _ in range(40):
        swipe(False)
    root, node = scroll_to("Remote for Mixers")
    row = None
    for parent in root.iter("node"):
        kids = list(parent.iter("node"))
        if node in kids and any(k.get("class") == "android.widget.Button" for k in kids) and len(kids) < 12:
            row = parent
    if row is None:
        raise SystemExit("no row for Remote for Mixers")
    button = [k for k in row.iter("node") if k.get("class") == "android.widget.Button"][0]
    if button.get("text", "").lower() != "install":  # Material buttons show it in capitals
        raise SystemExit(f"button says {button.get('text')!r}, expected Install")
    adb("shell", "input", "tap", *map(str, center(button)))
    shot("install-tapped")

    # Android's own confirmation ("Do you want to install this app?").
    def confirm(root):
        for n in [] if root is None else root.iter("node"):
            # Android's package installer, not the manager's own button.
            if n.get("text", "").lower() in ("install", "update") and n.get("package", "") != PKG \
                    and n.get("clickable") == "true":
                return n
        return None

    _, ok = wait_for(confirm, "Android's install confirmation", 180)
    shot("android-confirm")
    adb("shell", "input", "tap", *map(str, center(ok)))

    end = time.time() + 180
    while time.time() < end:
        if TARGET in adb("shell", "pm", "list", "packages", TARGET, check=False):
            break
        time.sleep(3)
    else:
        shot("not-installed")
        raise SystemExit(f"{TARGET} was not installed")
    time.sleep(3)
    adb("shell", "am", "start", "-W", "-n", f"{PKG}/gr.koulaxizis.apps.MainActivity")
    root, node = scroll_to("Remote for Mixers")
    shot("installed")
    print("ok: lists verified and", TARGET, "installed through the manager")


if __name__ == "__main__":
    main()
