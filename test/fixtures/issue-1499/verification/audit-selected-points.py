"""Verify saved product selections directly, without running another solver."""
import json,math,hashlib,gzip,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
manifest=json.loads((ROOT.parent/'manifest.json').read_text())
saved=Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/'matrix-final.json.gz'
raw=saved.read_bytes(); raw=gzip.decompress(raw) if raw[:2]==b'\x1f\x8b' else raw
run=json.loads(raw)
def residual(g,q,t=None,extended=False):
 if 'segments' in g:return min(residual(s,q,t,extended) for s in g['segments'])
 if g.get('kind') in ['arc','arcLine']:
  c=g['center'];angle=math.degrees(math.atan2(q['y']-c['y'],q['x']-c['x']));sweep=g['sweepAngleDeg']
  travel=((angle-g['startAngleDeg']) if sweep>0 else (g['startAngleDeg']-angle))%360
  if travel>abs(sweep)+1e-6:return math.inf
  return abs(math.hypot(q['x']-c['x'],q['y']-c['y'])-g['radius'])
 a,b=g['start'],g['end']
 if 'control1' in g:
  assert t is not None
  ps=[a,g['control1'],g['control2'],b];v=1-t
  point={k:v**3*ps[0][k]+3*v*v*t*ps[1][k]+3*v*t*t*ps[2][k]+t**3*ps[3][k] for k in ['x','y']}
  return math.hypot(q['x']-point['x'],q['y']-point['y'])
 dx,dy=b['x']-a['x'],b['y']-a['y'];h=math.hypot(dx,dy)
 f=((q['x']-a['x'])*dx+(q['y']-a['y'])*dy)/h**2
 if not extended and not -1e-8<=f<=1+1e-8:return math.inf
 return abs(dx*(q['y']-a['y'])-dy*(q['x']-a['x']))/h
rows=[]
for obs in run['observations']:
 if 'host' not in obs:continue
 unit=next(u for u in manifest['units'] if u['id']==obs['id'])
 pairs=unit['pairs'];expected=unit['expected']
 if obs['file'].endswith('-recovered.nui'):expected=unit['edit']['expected']
 if unit['id']=='N4':pairs=[dict(a='A',b='B',roots=[dict(x=30,y=15)],extensions=False)]
 geometry=obs['payload']['computedGeometry'];pure=[e['value'] for e in obs['payload'].get('computedGeometryValues',[])]
 checked=0;maximum=0
 for name,expect in expected.items():
  if not isinstance(expect,dict) or 'x' not in expect:continue
  matched=[(pair,r) for pair in pairs for r in pair['roots'] if math.hypot(expect['x']-r['x'],expect['y']-r['y'])<1e-8]
  if not matched:continue # downstream offset consumer, not an intersection result
  candidates=[g for g in geometry if g['kind']=='point' and g.get('name')==name.split('::')[-1]]
  if name in unit.get('pure',[]) or name in unit.get('pureErrors',{}):candidates=pure
  assert candidates,(unit['id'],name)
  q=min(candidates,key=lambda q:math.hypot(q['x']-expect['x'],q['y']-expect['y']))
  assert math.hypot(q['x']-expect['x'],q['y']-expect['y'])<1e-6
  pair,r=matched[0]
  for first in [True,False]:
   source=pair['a' if first else 'b']
   if unit['id']=='L2' and name=='Reverse' and first:source='Reversed'
   inputs=[g for g in geometry if g.get('name')==source.split('::')[-1]]
   t=r.get('t') if first else (r['x']+10)/140 if unit['id']=='B2' else None
   value=min(residual(g,q,t,pair['extensions']) for g in inputs)
   assert value<=1e-6,(unit['id'],name,source,value)
   maximum=max(maximum,value)
  checked+=1
 rows.append(dict(unit=unit['id'],file=obs['file'],host=obs['host'],points=checked,maxPrimitiveResidualMm=maximum,status='PASS'))
result=dict(testedHead=run['candidateHead'],savedOutputSha256=hashlib.sha256(raw).hexdigest(),points=sum(r['points'] for r in rows),maxPrimitiveResidualMm=max(r['maxPrimitiveResidualMm'] for r in rows),rows=rows)
(Path(sys.argv[2]) if len(sys.argv)>2 else ROOT/'selected-point-residuals.json').write_text(json.dumps(result,indent=2)+'\n')
print({k:v for k,v in result.items() if k!='rows'})
