import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("build_data", Path(__file__).resolve().parents[1] / "scripts/build_data.py")
build_data = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build_data)


class MathlibBaselineTests(unittest.TestCase):
    def test_counts_pinned_source_without_build_or_network(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            source.mkdir()
            git = ["git", "-C", str(source)]
            subprocess.run(git + ["init", "-q"], check=True)
            (source / "Mathlib").mkdir()
            (source / "Mathlib/Example.lean").write_text("one\n\nthree\n")
            (source / "Mathlib/Notes.md").write_text("excluded\n" * 100)
            (source / "Mathlib.lean").write_text("import Mathlib.Example\n")
            subprocess.run(git + ["add", "."], check=True)
            commit = git + ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm"]
            subprocess.run(commit + ["baseline"], check=True)
            ref = subprocess.check_output(git + ["rev-parse", "HEAD"], text=True).strip()
            (source / "Mathlib/Example.lean").write_text("newer\n" * 40)
            subprocess.run(git + ["add", "."], check=True)
            subprocess.run(commit + ["newer source"], check=True)
            cache = root / "cache"
            cache.mkdir()
            subprocess.run(["git", "clone", "--quiet", "--bare", str(source), str(cache / "mathlib.git")], check=True)
            project = root / "project"
            project.mkdir()
            (project / "lake-manifest.json").write_text(json.dumps({"packages": [{"name": "mathlib", "rev": ref}]}))
            baseline = build_data.mathlib_baseline(project, cache)
            self.assertEqual(baseline["ref"], ref)
            self.assertEqual(baseline["lines"], 4)

    def test_rejects_noncommit_pin_before_fetch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "lake-manifest.json").write_text('{"packages":[{"name":"mathlib","rev":"master"}]}')
            with self.assertRaises(ValueError):
                build_data.mathlib_baseline(root, root / "cache")


if __name__ == "__main__":
    unittest.main()
