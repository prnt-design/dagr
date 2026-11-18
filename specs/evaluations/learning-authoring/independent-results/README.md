# Independent authoring evidence and skill follow-up

Six fresh author sessions completed the three baseline/guided briefs. All six
initial consumers passed strict TypeScript compilation and production build
against published Explorer 0.2.0. Twelve default-view desktop/phone-emulated
reading flows completed. Those technical results coexist with factual and
relationship defects. There is no human learner or causal-effect evidence.

The canonical skill now adds two bounded corrections supported by these
observations: audit universal claims and declarations versus verified behavior;
distinguish optional learning order and trace workflow retry/update paths.
The reference and runtime are unchanged. No new authoring trial tested the
updated guidance, and efficacy of the additions remains unverified.

## Read the findings

- [Synthesis and frozen initial scores](raw/synthesis.md)
- [Codebase pair](raw/codebase-initial-report.md)
- [Prerequisite pair](raw/prerequisites-initial-report.md)
- [Process pair](raw/process-initial-report.md)
- [Exact reconstructed launch records](raw/launch-records.json)
- [Input verification](raw/launch-input-verification.json)
- [Original output verification](raw/initial-output-verification.json)

The raw synthesis describes the proposed patch at the time of evaluation.
This follow-up applies that proposal. Raw evaluator reports remain unchanged.
The earlier same-context pilot, merged in PR269, is separate evidence and
cannot satisfy the independent comparison by itself.

## Provenance and limits

Launch records are coordinator reconstructions of submitted tool arguments,
not server session exports. Requested model was Claude opus at medium effort;
opus is a provider alias with no immutable backend revision supplied. Source
and skill pin is ccb66cad9dfc3baf650d65338e2bb2ae6c38aae2. All six input sets
and twelve initial output files were hash-verified before evaluation.

The evaluator knows condition labels and had read the skill and pilot. One
sample per brief/condition, no randomization or replication. Process-guided
performed a static Python quote/endpoint check before saving its initial;
checking conditions were not identical. No repairs were made to author files.
Do not turn differences in scores or graph counts into learning outcomes.

Checks covered default-view search, inspect, pointer follow, close, empty
search, keyboard inspect/Escape and outline in headless Chromium at 1280x800
and 390x844 with touch emulation, scale 2, reduced motion enabled. Close focus
return and document overflow were recorded. All-view ID/endpoint checks passed.
Contrast, full clipping, keyboard connection-follow, all custom controls,
real devices, screen readers, human comprehension and animation behavior
remain unverified. Browser/server lifetimes used shared compute protection.

## Archive, privacy and reconstruction

[manifest.json](manifest.json) maps original relative paths to stored files,
with byte counts and SHA256. Raw source/host/checker/config files have a .txt
suffix to keep archived outputs out of repository lint/build discovery. Their
bytes are unchanged. Author hash manifests retain original names, so restore
original paths before running those checks. Browser screenshots are stored as
PNG. Generated dependency installs, dist builds and transpiled validation
copies are excluded; checker scripts/results and logs are retained.

Inspected text artifacts for private home paths, credential markers and private
source. No such material was found. No redactions were applied. Exact /tmp
session paths and public-source references remain for provenance; these paths
are evaluation-host locations, not portable dependencies. Raw author text and
quoted source are preserved, including punctuation. All new report prose uses
the project writing convention.

To verify and restore outside this repository, run this from this directory,
with an empty destination chosen for the restored evidence:

```python
import hashlib, json
from pathlib import Path

archive = Path.cwd()
destination = Path('/tmp/dagr-evidence-restored')
for item in json.loads((archive / 'manifest.json').read_text())['files']:
    data = (archive / item['storedPath']).read_bytes()
    assert hashlib.sha256(data).hexdigest() == item['sha256']
    assert len(data) == item['bytes']
    target = destination / item['originalPath']
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
```

Consumer lockfiles retain exact dependencies. consumer-initial folders contain
the original copied sources and neutral mounting entry/config. Restore files,
install dependencies there, and run tsc/Vite in the compute window. Checker
scripts retain /tmp paths from the original run; adapt their root/module paths
to a restored consumer before reuse. No new consumer/browser run is implied by
archiving or the guidance change. Complete gate/CI/review results are recorded
in the follow-up PR rather than retroactively changing the raw study reports.
