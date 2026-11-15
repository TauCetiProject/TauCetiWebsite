import gzip
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts import build_site, sync_docs


class DocsCompatibilityTests(unittest.TestCase):
    def bundle(self, source='a' * 40):
        return gzip.compress(json.dumps({'schema_version': 1, 'source_commit': source,
                                         'modules': {'TauCeti.Example': {}}}).encode())

    def test_mirror_preserves_exact_bundle_and_derives_its_marker(self):
        raw = self.bundle()
        with tempfile.TemporaryDirectory() as directory, patch.object(
                sync_docs.urllib.request, 'urlopen', return_value=io.BytesIO(raw)) as fetch:
            out = Path(directory)
            sync_docs.sync(out / 'data/docs')
            self.assertEqual(fetch.call_count, 1)
            build_site.compatibility_pages(out / 'site', out / 'data')
            self.assertEqual((out / 'site/docs/facts.json.gz').read_bytes(), raw)
            self.assertEqual((out / 'site/docs/SOURCE_SHA').read_text(), 'a' * 40 + '\n')
            for name in ['Statistics', 'statistics', 'docs']:
                page = (out / 'site' / name / 'index.html').read_text()
                self.assertIn('location.search + location.hash', page)
                self.assertIn('http-equiv="refresh"', page)
            self.assertIn('../growth.html', (out / 'site/Statistics/index.html').read_text())

    def test_invalid_download_keeps_previous_bundle_and_marker(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            (out / 'facts.json.gz').write_bytes(b'previous')
            (out / 'SOURCE_SHA').write_text('previous source')
            for raw in [b'not gzip', self.bundle('invalid')]:
                with patch.object(sync_docs.urllib.request, 'urlopen', return_value=io.BytesIO(raw)):
                    with self.assertRaises((ValueError, OSError)):
                        sync_docs.sync(out)
                self.assertEqual((out / 'facts.json.gz').read_bytes(), b'previous')
                self.assertEqual((out / 'SOURCE_SHA').read_text(), 'previous source')

    def test_bounded_compressed_and_expanded_downloads(self):
        for limit in ['COMPRESSED_LIMIT', 'EXPANDED_LIMIT']:
            with tempfile.TemporaryDirectory() as directory, patch.object(sync_docs, limit, 8), patch.object(
                    sync_docs.urllib.request, 'urlopen', return_value=io.BytesIO(self.bundle())):
                with self.assertRaisesRegex(ValueError, 'size limit'):
                    sync_docs.sync(Path(directory))
                self.assertFalse((Path(directory) / 'facts.json.gz').exists())
