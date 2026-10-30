"""Supplemental saved-output audit; no evaluator calls or new source inputs."""
from pathlib import Path
import json,math,gzip
root=Path(__file__).parent
path=root/'matrix-final.json'
p=json.loads(path.read_text() if path.exists() else gzip.decompress((root/'matrix-final.json.gz').read_bytes()))
# Frozen B2 Bernstein controls, independent of product geometry.
c=[(-11,4),(-5,153),(146,-119),(167,31)]
def at(t,k):return (1-t)**3*c[0][k]+3*(1-t)**2*t*c[1][k]+3*(1-t)*t*t*c[2][k]+t**3*c[3][k]
def length(t):
 def speed(s):return math.hypot(*[3*((1-s)**2*(c[1][k]-c[0][k])+2*(1-s)*s*(c[2][k]-c[1][k])+s*s*(c[3][k]-c[2][k])) for k in range(2)])
 n=16384
 return t*(speed(0)+speed(t)+sum((4 if i%2 else 2)*speed(t*i/n) for i in range(1,n)))/(3*n)
expected_t=.437;expected_point=(at(expected_t,0),at(expected_t,1));expected_station=length(expected_t);total=length(1)
results=[]
for o in p['observations']:
 if o.get('id')!='B2' or 'host' not in o:continue
 for g in o['payload']['computedGeometry']:
  if g.get('name') not in ['Station','BackStation']:continue
  lo,hi=0.,1.
  for _ in range(60):
   mid=(lo+hi)/2
   if at(mid,0)<g['x']:lo=mid
   else:hi=mid
  t=(lo+hi)/2
  residual=abs(at(t,1)-g['y'])
  assert residual<1e-6
  results.append(dict(host=o['host'],name=g['name'],t=t,pointErrorMm=math.dist((g['x'],g['y']),expected_point),curveResidualMm=residual,physicalStationErrorMm=length(t)-expected_station))
report=dict(expectedParameter=expected_t,expectedPoint=expected_point,expectedStationMm=expected_station,totalLengthMm=total,observations=results,limitation='Existing 32-chord traversal approximation; this is an audit of saved points, not a claim of exact arc-length inversion.')
(root/'station-residuals.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
