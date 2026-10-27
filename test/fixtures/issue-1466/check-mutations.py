"""Replay task-owned candidate/base counterfactuals; always restore candidate bytes."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[3]
folder = Path(__file__).resolve().parent
base = '17591f7c5aa61d9d227f4096c75e48138eaf4528'
files = json.loads((folder / 'implementation-files.json').read_text())
assert subprocess.check_output(['git', 'branch', '--show-current'], cwd=root, text=True).strip() == 'sayosomi/issue-1466-nested-scalar-geometry-hunt'
candidate = {f: (root / f).read_bytes() for f in files}
original = {f: subprocess.check_output(['git', 'show', base + ':' + f], cwd=root) for f in files}
results = []
tag = sys.argv[1] + '-' if len(sys.argv) > 1 else ''

def restore():
    for path, content in candidate.items():
        (root / path).write_bytes(content)

def run(label, ids, expected):
    label = tag + label
    command = [sys.executable, str(folder / 'run-gate.py'), label, '180', 'env',
               'ISSUE1466_RECORD=' + str(folder / (label + '.json.gz'))]
    if ids:
        command += ['ISSUE1466_ONLY=' + ids]
    command += ['npm', 'test', '--', 'test/issue1466NestedScalarGeometry.integration.test.ts', '--maxWorkers=1']
    result = subprocess.run(command, cwd=root, timeout=200)
    results.append(dict(label=label, expectedExit=expected, exit=result.returncode,
                        implementationSha256={f: hashlib.sha256((root / f).read_bytes()).hexdigest() for f in files}))
    (folder / (tag + 'mutations.json')).write_text(json.dumps(results, indent=2) + '\n')
    assert result.returncode == expected, (label, result.returncode, expected)

try:
    for path, content in original.items():
        (root / path).write_bytes(content)
    run('base-confirmed', None, 1)
    restore()
    run('fixed-before-mutations', None, 0)
    for family, paths, ids in [
        ('F1', ['packages/nui-language/src/scalars/moduleNumericRuntime.ts'], 'R01,A03'),
        ('F2', ['packages/nui-language/src/dsl/expressionReferenceToken.ts'], 'R02,X01,A03'),
        ('F3', ['packages/nui-language/src/scalars/bindingResolution.ts'], 'R03,X07,A03'),
    ]:
        for path in paths:
            (root / path).write_bytes(original[path])
        run('mutation-' + family, ids, 1)
        restore()
    path = 'packages/nui-language/src/dsl/dslDocument.ts'
    text = candidate[path].decode()
    new = 'const instanceLookup = resolveSourceLexicalPath(sourceLexicalNamespace, statementIndex, { ...path, segments: path.segments.slice(0, 1) });'
    assert text.count(new) == 2
    # Restore only F4's two first-segment projections, preserving F5 graph wiring.
    text = text.replace(new, 'const instanceLookup = resolveSourceLexicalDeclaration(sourceLexicalNamespace, statementIndex, path.segments[0]!);')
    (root / path).write_text(text)
    run('mutation-F4', 'R04,X06,R03,A03', 1)
    restore()
    text = candidate[path].decode()
    new = '    materializedNumericBindings: moduleScalarCompilation?.materializedNumericBindings,\n'
    assert text.count(new) == 1
    (root / path).write_text(text.replace(new, ''))
    run('mutation-F5-graph', 'R05,X08,C04', 1)
    restore()
    for path in ['src/geometry/evaluate.ts', 'src/geometry/scalarProgramEvaluation.ts', 'src/scalars/linearMutationEvaluator.ts']:
        (root / path).write_bytes(original[path])
    run('mutation-F5-reference', 'R05,X08,C04', 1)
    restore()
    for path in files:
        if path.startswith('rust-evaluator/'):
            (root / path).write_bytes(original[path])
    run('mutation-F5-production', 'R05,X08,C04', 1)
    restore()
    run('fixed-after-mutations', None, 0)
finally:
    restore()
    assert all((root / f).read_bytes() == b for f, b in candidate.items())
