#!/usr/bin/env python3
"""Mirror the published facts bundle for reporters using the earlier custom-domain URL.

The HTML API reference stays on TauCeti's Pages site. Derive SOURCE_SHA from this
single bundle download so a concurrent upstream deployment cannot mix identities.
"""
import argparse
import gzip
import io
import json
from pathlib import Path
import re
import urllib.request

DOCS = 'https://taucetiproject.github.io/TauCeti/docs/'
COMPRESSED_LIMIT = 64 * 1024 * 1024
EXPANDED_LIMIT = 512 * 1024 * 1024


def sync(out):
    request = urllib.request.Request(DOCS + 'facts.json.gz', headers={'User-Agent': 'TauCetiWebsite/1.0'})
    with urllib.request.urlopen(request, timeout=120) as response:
        raw = response.read(COMPRESSED_LIMIT + 1)
    if len(raw) > COMPRESSED_LIMIT:
        raise ValueError('Documentation facts exceed the compressed size limit')
    with gzip.GzipFile(fileobj=io.BytesIO(raw)) as stream:
        expanded = stream.read(EXPANDED_LIMIT + 1)
    if len(expanded) > EXPANDED_LIMIT:
        raise ValueError('Documentation facts exceed the expanded size limit')
    bundle = json.loads(expanded)
    source = bundle.get('source_commit', '')
    if (bundle.get('schema_version') != 1 or not re.fullmatch('[0-9a-f]{40}', source)
            or not isinstance(bundle.get('modules'), dict) or not bundle['modules']):
        raise ValueError('Invalid documentation facts bundle')
    out.mkdir(parents=True, exist_ok=True)
    # Validate before replacing either retained file. The build runs after this step.
    for name, data in [('facts.json.gz', raw), ('SOURCE_SHA', (source + '\n').encode())]:
        temporary = out / (name + '.tmp')
        temporary.write_bytes(data)
        temporary.replace(out / name)
    print(f'Mirrored documentation facts from {source} ({len(raw)} bytes)')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    sync(parser.parse_args().out)
