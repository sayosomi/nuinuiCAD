import subprocess as s,json,os,hashlib
from pathlib import Path
base='ebdcdce00727d291067ac6f20b295466caf04843'
paths=['src/geometry/cornerRadiusArcEvaluator.ts','rust-evaluator/src/evaluation/corner_radius_evaluator.rs']
fixed={p:Path(p).read_bytes() for p in paths}
original={p:s.check_output(['git','show',base+':'+p]) for p in paths}
records=[]
def run(name,versions):
 for p,v in versions.items():Path(p).write_bytes(v)
 env=dict(os.environ,ISSUE1513_RECORD='/tmp/issue1513-'+name+'.json')
 with open('/tmp/issue1513-'+name+'.log','w') as log:
  r=s.run(['npx','vitest','run','test/issue1513CornerRadiusConformance.integration.test.ts','--maxWorkers=1'],env=env,stdout=log,stderr=s.STDOUT,timeout=180)
 data=json.load(open('/tmp/issue1513-'+name+'.json'))
 fails=sorted(set(o['id'] for o in data['observations'] if o.get('status')=='FAIL'))
 records.append(dict(name=name,exit=r.returncode,failures=fails,sourceSha256={p:hashlib.sha256(v).hexdigest() for p,v in versions.items()}))
 print(name,r.returncode,fails,flush=True)
 assert r.returncode==1 and fails
try:
 run('base-complete',original)
 # Keep the final invalid-arc guard fixed, remove only dual-trim atomicity.
 old={p:v.decode() for p,v in original.items()}
 p=paths[0];v=old[p];a=v.index('  if (samePoint(arc.start, arc.end))');b=v.index('\n  return true;',a)
 guard=v[a:b].replace('\n  }','\n    return true;\n  }')
 v=v[:a]+v[b:];a=v.index('  if (\n    !updateTrimmedGeometry');v=v[:a]+guard+'\n\n'+v[a:];old[p]=v
 p=paths[1];v=old[p];a=v.index('    let same_endpoints = points_same_from_geometry(&arc);');v=v[:a]+'''    insert_geometry(state, id, arc.geometry);
}
''';a=v.index('    if !update_trimmed_geometry');v=v[:a]+'''    if points_same_from_geometry(&arc) {
        state.errors.push(geometry_error(element, format!("{name} の始点と終点が同じ位置です。")));
        return;
    }
'''+v[a:];old[p]=v
 run('remove-atomicity',{p:v.encode() for p,v in old.items()})
 assert 'X1' not in records[-1]['failures'] and 'F1' in records[-1]['failures']
 # Keep atomic dual-trim preparation fixed, restore the invalid final guard's
 # original placement after publication of all three geometries.
 altered={p:v.decode() for p,v in fixed.items()}
 p=paths[0];v=altered[p];a=v.index('  if (samePoint(arc.start, arc.end))');b=v.index('\n\n  computedGeometry.set',a);guard=v[a:b];v=v[:a]+v[b:];a=v.index('\n  return true;\n};',v.index('  computedGeometry.set(element.endpoint1'));v=v[:a]+'\n'+guard+v[a:];altered[p]=v
 p=paths[1];v=altered[p];a=v.index('    if points_same_from_geometry(&arc)');b=v.index('\n\n    insert_geometry',a);guard=v[a:b];v=v[:a]+v[b:];v=v.replace('    insert_geometry(state, line1_id, trimmed1);','    let same_endpoints = points_same_from_geometry(&arc);\n    insert_geometry(state, line1_id, trimmed1);');guard=guard.replace('points_same_from_geometry(&arc)','same_endpoints');a=v.rindex('\n}');v=v[:a]+'\n'+guard+v[a:];altered[p]=v
 run('remove-final-guard',{p:v.encode() for p,v in altered.items()})
 assert records[-1]['failures']==['Reducer2','X1']
finally:
 for p,v in fixed.items():Path(p).write_bytes(v)
 Path('test/fixtures/issue-1513/verification/counterfactuals.json').write_text(json.dumps(records,indent=2)+'\n')
 assert all(Path(p).read_bytes()==v for p,v in fixed.items())
