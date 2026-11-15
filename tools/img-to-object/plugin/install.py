#!/usr/bin/env python3
"""Install the lts-object-spec emission target into the forge's plugin home.

Copies plugin.json, steps.json and emit_object_spec.py to $IMG2_HOME/plugins/lts-object-spec
(IMG2_HOME defaults to ~/.img2, as in the forge) and adds or replaces its row in plugins.json.
Re-running it updates the install. Then, in an action-ready workspace:

    python3 forge/stage3_build/emit_target.py --spec <object-sculpt-spec.json> --target lts-object-spec

Copyright the LuminosiTS contributors. MIT OR Apache-2.0.
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import shutil
import sys
from pathlib import Path

PLUGIN_ID = "lts-object-spec"
FILES = ("plugin.json", "steps.json", "emit_object_spec.py")
HERE = Path(__file__).resolve().parent


def install(home: Path) -> Path:
    target = home / "plugins" / PLUGIN_ID
    target.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    for name in FILES:
        shutil.copyfile(HERE / name, target / name)
        digest.update((HERE / name).read_bytes())
    registry_path = home / "plugins.json"
    registry = json.loads(registry_path.read_text(encoding="utf-8")) if registry_path.is_file() else {"plugins": []}
    rows = [row for row in registry.get("plugins", []) if not (isinstance(row, dict) and row.get("id") == PLUGIN_ID)]
    rows.append({
        "id": PLUGIN_ID,
        "repo": "Hedronite/luminosi-ts",
        "ref": "tools/img-to-object/plugin",
        # The determinism cache keys on this, so a changed emitter is never served a stale artifact.
        "resolvedSha": f"local-{digest.hexdigest()[:16]}",
        "addedAt": datetime.date.today().isoformat(),
    })
    registry["plugins"] = rows
    registry_path.write_text(json.dumps(registry, indent=2) + "\n", encoding="utf-8")
    return target


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Install the lts-object-spec emission target.")
    parser.add_argument("--home", type=Path, default=None, help="plugin home (default: $IMG2_HOME or ~/.img2)")
    args = parser.parse_args(argv)
    home = args.home or Path(os.environ.get("IMG2_HOME") or Path.home() / ".img2")
    print(install(home))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
