"""Build an allowlisted development package without AE, network or credentials."""
from pathlib import Path
import argparse
import hashlib
import json
import stat
import zipfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
FILES = (
    "extension/CSXS/manifest.xml", "extension/index.html", "extension/panel.css", "extension/panel.js",
    "extension/host/aelm.jsx", "extension/lib/bridge.js", "extension/lib/controller.js",
    "extension/lib/context.js", "extension/lib/history.js", "extension/lib/protocol.js", "extension/lib/transport.js", "extension/lib/settings.js",
    "extension/lib/visuals.js", "extension/lib/image-input.js", "extension/lib/image-headers.js", "extension/lib/visible-capture.js", "extension/capture/visible-capture.ps1", "docs/visual-workflow.md",
    "scripts/install-dev.ps1", "docs/install.md", "docs/validation.md", "docs/first-milestone.md", "LICENSE",
    "README.md", "SECURITY.md", "CONTRIBUTING.md", "docs/architecture.md", "docs/assistant-conventions.md", "docs/releasing.md",
)

def validate_manifest_geometry_order(manifest):
    """Check only CEP 7 geometry child sequences, not the complete manifest schema."""
    # Adobe-CEP/CEP-Resources: CEP_7.x/ExtensionManifest_v_7_0.xsd.
    # All members of these sequences are optional, but cannot repeat or reorder.
    geometry_order = ("ScreenPercentage", "Size", "MaxSize", "MinSize")
    dimension_order = ("Height", "Width")
    for geometry in manifest.findall("./DispatchInfoList/Extension/DispatchInfo/UI/Geometry"):
        names = [child.tag for child in geometry]
        if names != [name for name in geometry_order if name in names]:
            raise ValueError("Invalid manifest geometry order: expected ScreenPercentage, Size, MaxSize, MinSize")
        for dimensions in geometry:
            names = [child.tag for child in dimensions]
            if names != [name for name in dimension_order if name in names]:
                raise ValueError(f"Invalid manifest geometry order: {dimensions.tag} expects Height before Width")


def package(output):
    payload = {}
    for name in FILES:
        source = ROOT / name
        current = source
        while current != ROOT:
            try:
                attributes = getattr(current.lstat(), "st_file_attributes", 0)
            except FileNotFoundError as exc:
                raise ValueError(f"Invalid package source: {name}") from exc
            if current.is_symlink() or attributes & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0):
                raise ValueError(f"Package source is a link: {name}")
            current = current.parent
        if not source.is_file() or not source.resolve().is_relative_to(ROOT.resolve()):
            raise ValueError(f"Invalid package source: {name}")
        payload["Ae-lm/" + name] = source.read_bytes()
    manifest = ET.fromstring(payload["Ae-lm/extension/CSXS/manifest.xml"])
    if manifest.attrib["ExtensionBundleId"] != "studio.aelm":
        raise ValueError("Unexpected extension identity")
    validate_manifest_geometry_order(manifest)
    hashes = {name: hashlib.sha256(data).hexdigest() for name, data in payload.items()}
    payload["Ae-lm/SHA256SUMS.json"] = (json.dumps(hashes, indent=2) + "\n").encode()
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(payload.items()):
            info = zipfile.ZipInfo(name, (2026, 10, 22, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data)
    with zipfile.ZipFile(output) as archive:
        assert archive.testzip() is None
        assert set(archive.namelist()) == set(payload)
    return {"path": str(output.resolve()), "files": len(payload), "sha256": hashlib.sha256(output.read_bytes()).hexdigest()}

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "dist/Ae-lm-0.1.0-dev.1-windows.zip")
    args = parser.parse_args()
    print(json.dumps(package(args.output), indent=2))
