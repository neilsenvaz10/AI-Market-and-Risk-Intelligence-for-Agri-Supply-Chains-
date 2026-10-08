"""Build static address options from dated LGD CSV exports; no database access.

Usage: python scripts/build-location-data.py .location-source
See public/locations/README.md for source URLs and extraction commands.
"""
import csv
import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / '.location-source'
DATE = '30Apr2026'
OUTPUT = ROOT / 'public' / 'locations'
OUTPUT.mkdir(parents=True, exist_ok=True)

def clean(value):
    return ' '.join(unicodedata.normalize('NFC', value or '').split())

def records(name):
    with (SOURCE / f'{name}.{DATE}.csv').open(encoding='utf-8-sig', newline='') as stream:
        yield from csv.DictReader(stream)

def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')

source_text = (ROOT / 'src/constants/profile.js').read_text(encoding='utf-8')
states_block = re.search(r'INDIAN_STATES = \[(.*?)\];', source_text, re.S).group(1)
canonical = {name.casefold(): name for name in re.findall(r"'([^']+)'", states_block)}
states = {}
districts = {}
places = {}
for row in records('states'):
    source_name = clean(row['State Name (In English)']).removeprefix('The ')
    name = canonical[source_name.casefold()]
    states[row['State Code']] = {'code': row['State Code'], 'name': name, 'districts': []}
assert len(states) == len(canonical) == 36

for row in records('districts'):
    code, state = row['District Code'], row['State Code']
    district = {'code': code, 'name': clean(row['District Name(In English)'])}
    assert code not in districts and state in states
    districts[code] = (state, district)
    states[state]['districts'].append(district)
    places[code] = {}

excluded = {'unmappedParent': 0, 'unsupportedName': 0}
punctuation = set(" .,'()-/&@+[]\"")
def add_place(code, name, state=None):
    name = clean(name)
    if code not in districts or (state is not None and districts[code][0] != state):
        excluded['unmappedParent'] += 1
        return
    if not 2 <= len(name) <= 100 or not name[0].isalnum() or any(
        not (c.isalnum() or unicodedata.category(c).startswith('M') or c in punctuation) for c in name
    ):
        excluded['unsupportedName'] += 1
        return
    places[code].setdefault(name.casefold(), name)

village_rows = 0
for row in records('villages'):
    village_rows += 1
    add_place(row['District Code'], row['Village Name (In English)'], row['State Code'])

town_rows = 0
for row in records('statewise_ulbs_coverage'):
    town_rows += 1
    # Coverage gives the actual district relationship, including towns spanning
    # more than one district. Never infer a town's district from its name.
    add_place(row['District Code'], row['Local Body Name (In English)'])

index = sorted(states.values(), key=lambda state: state['name'])
for state in index:
    state['districts'].sort(key=lambda district: district['name'].casefold())
    for district in state['districts']:
        names = sorted(places[district['code']].values(), key=str.casefold)
        district['placeCount'] = len(names)
        write(OUTPUT / f"{district['code']}.json", {
            'stateCode': state['code'], 'districtCode': district['code'], 'names': names,
        })
data_dir = ROOT / 'src/data'
data_dir.mkdir(exist_ok=True)
write(data_dir / 'location-index.json', index)

sources = ['states', 'districts', 'villages', 'statewise_ulbs_coverage']
manifest = {
    'snapshot': '2026-04-30', 'source': 'Local Government Directory, Government of India',
    'sourceUrl': 'https://lgdirectory.gov.in/downloadDirectory.do',
    'archiveUrl': 'https://ramseraph.github.io/opendata/lgd/',
    'states': len(states), 'districts': len(districts), 'villageSourceRows': village_rows,
    'townCoverageSourceRows': town_rows, 'placeOptions': sum(len(p) for p in places.values()),
    'excludedRows': excluded,
    'sourceSha256': {f'{name}.{DATE}.csv': hashlib.sha256((SOURCE / f'{name}.{DATE}.csv').read_bytes()).hexdigest() for name in sources},
}
write(OUTPUT / 'manifest.json', manifest)
print(json.dumps({key: manifest[key] for key in ['states', 'districts', 'placeOptions', 'excludedRows']}))
