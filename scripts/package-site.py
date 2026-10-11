"""Package Vite output with explicit directories for Amplify manual deployments."""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
import json
root = Path(__file__).resolve().parent.parent
build = root / "dist"
archive = root / ".local/packages/parali-frontend.zip"
# These are deliberately public, bounded application capabilities for the one
# shared prototype field. Never publish the setup key, organizer token or AWS keys.
live = json.loads((root / ".local/live-demo.json").read_text(encoding="utf-8-sig"))
(build / "platform.json").write_text(json.dumps({"id": live["session"]["id"], "farmer": live["tokens"]["farmer"], "buyer": live["tokens"]["buyer"]}), encoding="utf-8")
with ZipFile(archive, "w", ZIP_DEFLATED) as package:
    for item in sorted(build.rglob("*")):
        package.write(item, item.relative_to(build).as_posix())
with ZipFile(archive) as package:
    if package.testzip() is not None:
        raise RuntimeError("Frontend archive is corrupt")
