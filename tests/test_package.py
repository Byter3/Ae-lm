"""Offline package-boundary tests; never install a panel or launch After Effects."""

from contextlib import contextmanager
import hashlib
import importlib.util
import json
from pathlib import Path
import posixpath
import re
import shutil
import tempfile
import unittest
from unittest.mock import patch
import zipfile
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET


PROJECT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("aelm_package_test_target", PROJECT / "scripts/package_plugin.py")
BUILDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILDER)


class PackageTests(unittest.TestCase):
    @contextmanager
    def fixture(self):
        with tempfile.TemporaryDirectory(prefix="aelm-package-test-") as directory:
            temporary = Path(directory)
            source = temporary / "source"
            source.mkdir()
            for name in BUILDER.FILES:
                target = source / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(PROJECT / name, target)
            with patch.object(BUILDER, "ROOT", source):
                yield source, temporary

    def read_zip(self, path):
        with zipfile.ZipFile(path) as archive:
            self.assertIsNone(archive.testzip())
            return {name: archive.read(name) for name in archive.namelist()}

    def test_only_allowlisted_files_are_published_and_hashes_cover_payload(self):
        with self.fixture() as (source, temporary):
            private_names = (
                ".env", "auth.json", "artist-shot.aep", ".aelm/artist-shot.aep.json",
                "extension/.env", "extension/lib/local-debug.json",
                "extension/node_modules/unreviewed/index.js", "backups/panel.js",
                "tests/private-diagnostic.txt", "dist/older-package.zip",
            )
            for name in private_names:
                private = source / name
                private.parent.mkdir(parents=True, exist_ok=True)
                private.write_text("SYNTHETIC_PRIVATE_FILE_DO_NOT_PACKAGE", encoding="utf-8")
            output = temporary / "output.zip"
            result = BUILDER.package(output)
            contents = self.read_zip(output)
            expected = {"Ae-lm/" + name for name in BUILDER.FILES}
            self.assertEqual(set(contents), expected | {"Ae-lm/SHA256SUMS.json"})
            self.assertEqual(result["files"], len(contents))
            self.assertEqual(result["sha256"], hashlib.sha256(output.read_bytes()).hexdigest())
            self.assertFalse(any(b"SYNTHETIC_PRIVATE_FILE_DO_NOT_PACKAGE" in body for body in contents.values()))
            manifest = json.loads(contents["Ae-lm/SHA256SUMS.json"])
            self.assertEqual(set(manifest), expected)
            for name in expected:
                self.assertEqual(manifest[name], hashlib.sha256(contents[name]).hexdigest())
                relative = name.removeprefix("Ae-lm/")
                self.assertEqual(contents[name], (source / relative).read_bytes())
                self.assertNotIn("..", Path(name).parts)
                self.assertFalse(Path(name).is_absolute())

    def test_package_bytes_are_deterministic_and_source_change_changes_hash(self):
        with self.fixture() as (source, temporary):
            first = temporary / "first.zip"
            second = temporary / "second.zip"
            BUILDER.package(first)
            # Filesystem timestamps and output location must not affect the ZIP.
            for name in BUILDER.FILES:
                (source / name).touch()
            BUILDER.package(second)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            panel = source / "extension/panel.js"
            panel.write_bytes(panel.read_bytes() + b"\n// Synthetic packaging test change.\n")
            BUILDER.package(second)
            self.assertNotEqual(first.read_bytes(), second.read_bytes())

    def test_packaged_readme_and_document_links_work_without_the_checkout(self):
        with self.fixture() as (_, temporary):
            output = temporary / "artist-download.zip"
            BUILDER.package(output)
            contents = self.read_zip(output)
            self.assertIn("Ae-lm/README.md", contents)
            for name, body in contents.items():
                if not name.endswith(".md"):
                    continue
                for target in re.findall(r"\[[^\]]*\]\(([^)]+)\)", body.decode("utf-8")):
                    target = target.strip("<>")
                    parsed = urlsplit(target)
                    if parsed.scheme or target.startswith("#") or not parsed.path:
                        continue
                    destination = posixpath.normpath(posixpath.join(posixpath.dirname(name), unquote(parsed.path)))
                    self.assertIn(destination, contents, f"Broken packaged link in {name}: {target}")

    def test_missing_source_and_wrong_extension_identity_preserve_existing_output(self):
        with self.fixture() as (source, temporary):
            output = temporary / "previous.zip"
            previous = b"Existing artifact must remain intact on validation failure."
            output.write_bytes(previous)
            missing = source / "extension/panel.js"
            missing.unlink()
            with self.assertRaisesRegex(ValueError, "Invalid package source"):
                BUILDER.package(output)
            self.assertEqual(output.read_bytes(), previous)
        with self.fixture() as (source, temporary):
            output = temporary / "previous.zip"
            output.write_bytes(previous)
            manifest = source / "extension/CSXS/manifest.xml"
            manifest.write_text('<ExtensionManifest ExtensionBundleId="wrong.extension"/>', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Unexpected extension identity"):
                BUILDER.package(output)
            self.assertEqual(output.read_bytes(), previous)

    def test_invalid_geometry_order_preserves_existing_package(self):
        malformed_geometry = (
            "<Size><Width>460</Width><Height>680</Height></Size>",
            "<MinSize><Width>300</Width><Height>340</Height></MinSize>",
            "<MaxSize><Width>1000</Width><Height>1000</Height></MaxSize>",
            "<ScreenPercentage><Width>50</Width><Height>50</Height></ScreenPercentage>",
            "<MinSize/><Size/>",
            "<Size><Height>680</Height><Height>680</Height><Width>460</Width></Size>",
        )
        for contents in malformed_geometry:
            with self.subTest(geometry=contents), self.fixture() as (source, temporary):
                output = temporary / "previous.zip"
                BUILDER.package(output)
                previous = output.read_bytes()
                manifest_path = source / "extension/CSXS/manifest.xml"
                manifest = ET.parse(manifest_path)
                geometry = manifest.find("./DispatchInfoList/Extension/DispatchInfo/UI/Geometry")
                self.assertIsNotNone(geometry)
                geometry.clear()
                geometry.extend(ET.fromstring("<Geometry>" + contents + "</Geometry>"))
                manifest.write(manifest_path, encoding="utf-8", xml_declaration=True)
                with self.assertRaisesRegex(ValueError, "Invalid manifest geometry order"):
                    BUILDER.package(output)
                self.assertEqual(output.read_bytes(), previous)

    def test_geometry_order_allows_optional_dimensions(self):
        with self.fixture() as (source, temporary):
            manifest_path = source / "extension/CSXS/manifest.xml"
            manifest = ET.parse(manifest_path)
            geometry = manifest.find("./DispatchInfoList/Extension/DispatchInfo/UI/Geometry")
            self.assertIsNotNone(geometry)
            geometry.clear()
            geometry.extend(ET.fromstring(
                "<Geometry><ScreenPercentage><Width>50</Width></ScreenPercentage>"
                "<Size><Height>680</Height></Size><MaxSize/><MinSize/></Geometry>"
            ))
            manifest.write(manifest_path, encoding="utf-8", xml_declaration=True)
            output = temporary / "optional-geometry.zip"
            BUILDER.package(output)
            self.assertEqual(self.read_zip(output)["Ae-lm/extension/CSXS/manifest.xml"], manifest_path.read_bytes())

    def test_linked_payload_file_is_rejected(self):
        with self.fixture() as (source, temporary):
            original = source / "extension/panel.js"
            outside = temporary / "external.js"
            outside.write_bytes(original.read_bytes())
            original.unlink()
            try:
                original.symlink_to(outside)
            except (OSError, NotImplementedError) as error:
                self.skipTest("Creating file symlinks is unavailable: " + str(error))
            with self.assertRaisesRegex(ValueError, "Package source is a link"):
                BUILDER.package(temporary / "should-not-exist.zip")
            self.assertFalse((temporary / "should-not-exist.zip").exists())

    def test_linked_ancestor_directory_is_rejected(self):
        with self.fixture() as (source, temporary):
            original = source / "extension/lib"
            outside = temporary / "external-lib"
            self.assertTrue(original.resolve().is_relative_to(temporary.resolve()))
            self.assertTrue(outside.resolve().is_relative_to(temporary.resolve()))
            original.rename(outside)
            try:
                original.symlink_to(outside, target_is_directory=True)
            except (OSError, NotImplementedError) as error:
                self.skipTest("Creating directory symlinks is unavailable: " + str(error))
            with self.assertRaisesRegex(ValueError, "Package source is a link"):
                BUILDER.package(temporary / "should-not-exist.zip")
            self.assertFalse((temporary / "should-not-exist.zip").exists())

    def test_installer_and_package_agree_on_runtime_file_allowlist(self):
        installer = (PROJECT / "scripts/install-dev.ps1").read_text(encoding="utf-8")
        declaration = re.search(r"\$files\s*=\s*@\((.*?)\)", installer, re.DOTALL)
        self.assertIsNotNone(declaration, "Installer must have an explicit runtime-file allowlist")
        installed = {name.replace("\\", "/") for name in re.findall(r"'([^']+)'", declaration.group(1))}
        shipped = {name.removeprefix("extension/") for name in BUILDER.FILES if name.startswith("extension/")}
        self.assertEqual(installed, shipped, "The installer and package must contain the same runtime files")


if __name__ == "__main__":
    unittest.main()
