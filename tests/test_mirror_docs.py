import gzip
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("mirror_docs", Path(__file__).resolve().parents[1] / "scripts/mirror_docs.py")
mirror_docs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mirror_docs)

A, B = "a" * 40, "b" * 40


def facts(sha):
    return gzip.compress(json.dumps({"source_commit": sha, "modules": {}}).encode())


def site(*responses):
    """A fetch that answers from `responses` in order, whatever the URL."""
    queue = list(responses)
    return lambda url: queue.pop(0)


class MirrorDocsTests(unittest.TestCase):
    def test_a_pair_describing_one_commit_is_kept(self):
        pair = mirror_docs.consistent_pair(fetch=site(f"{A}\n".encode(), facts(A)))
        self.assertEqual(pair["SOURCE_SHA"], f"{A}\n".encode())
        with tempfile.TemporaryDirectory() as directory:
            mirror_docs.write(Path(directory) / "docs", pair)
            self.assertEqual(sorted(p.name for p in (Path(directory) / "docs").iterdir()),
                             ["SOURCE_SHA", "facts.json.gz"])

    def test_a_deploy_between_the_two_reads_is_read_again(self):
        pair = mirror_docs.consistent_pair(fetch=site(A.encode(), facts(B), B.encode(), facts(B)))
        self.assertEqual(pair["SOURCE_SHA"], B.encode())

    def test_a_pair_that_never_agrees_or_a_bad_marker_is_refused(self):
        with self.assertRaisesRegex(ValueError, "changed between reads"):
            mirror_docs.consistent_pair(fetch=site(*[A.encode(), facts(B)] * 3))
        with self.assertRaisesRegex(ValueError, "does not hold a commit"):
            mirror_docs.consistent_pair(fetch=site(b"<!doctype html>"))


if __name__ == "__main__":
    unittest.main()
