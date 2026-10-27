"""Independent state oracle, sealed before measuring the hook. No evaluator imports."""
import hashlib,json
from pathlib import Path
ROOT=Path(__file__).parent

def state(rev,req,status='evaluating',geometry='empty',source='rust',stale=False,current=False,error=None,eligible=True,guard=None):
 return dict(evaluationRevision=rev,request=req,status=status,geometry=geometry,source=source,isStale=stale,current=current,error=error,rustEligible=eligible,interaction=current if guard is None else guard)
def pending(r,q):return state(r,q)
def ready(r,q,g='K',source='rust'):return state(r,q,'ready',g,source,current=True)
def stale(r,q,g='K',source='rust'):return state(r,q,geometry=g,source=source,stale=True)
def ref(r,q,g='K',status='evaluating',eligible=True):return state(r,q,status,g,'reference',current=True,eligible=eligible)
def event(op,expected=None,**kw):return dict(op=op,**kw,**({'expected':expected} if expected else {}))
def mount(file='K',mode='rust'):return event('mount',pending(1,1),file=file,mode=mode)
def edit(file,expected):return event('source',expected,file=file)
def ok(n,expected):return event('resolve',expected,request=n)
def bad(n,expected):return event('reject',expected,request=n)
units=[]
def add(id,events,control): units.append(dict(id=id,events=events,neighbor=control))
add('A1',[mount(),ok(1,ready(1,1)),edit('K2',stale(1,1)),ok(2,ready(2,2))],'A6 fatal edit retains compiled revision; B1 distinct key')
add('A2',[mount(),edit('K2',pending(2,2)),ok(1,pending(2,2)),ok(2,ready(2,2))],'unchanged render does not create a request; A1')
add('A3',[mount(),ok(1,ready(1,1)),edit('L',stale(1,1)),edit('K',stale(1,1)),ok(2,stale(1,1)),ok(3,ready(3,3))],'B1 distinct-key success ownership')
add('A4',[mount(),ok(1,ready(1,1)),event('limit',stale(1,1),value=1),ok(2,ready(1,2,'partial')),event('limit',stale(1,2,'partial'),value=None),ok(3,ready(1,3))],'A1 revision change vs same-revision input change')
add('A5',[mount('D'),ok(1,ready(1,1,'disabled')),event('allow',stale(1,1,'disabled'),value=True),ok(2,ready(1,2,'enabled')),event('allow',stale(1,2,'enabled'),value=False),ok(3,ready(1,3,'disabled'))],'unchanged disabled options rerender; A4 limit option')
add('A6',[mount(),ok(1,ready(1,1)),edit('F',{**ready(1,1),'interaction':False}),edit('K2',stale(1,1)),ok(2,ready(2,2))],'fatal source revision increments without compiled revision change')
add('B1',[mount(),edit('L',pending(2,2)),ok(2,ready(2,2,'L')),ok(1,ready(2,2,'L'))],'A2 same-key old completion first')
add('B2',[mount(),edit('L',pending(2,2)),ok(2,ready(2,2,'L')),bad(1,ready(2,2,'L'))],'B1 older success instead of rejection')
add('B3',[mount(),bad(1,state(1,1,'failed','K','fallback',current=True,error='request-1')),edit('K2',stale(1,1,source='fallback')),ok(2,ready(2,2))],'B4 scalar failure must withhold geometry')
add('B4',[mount('S'),bad(1,state(1,1,'failed',error='request-1',current=True)),edit('S2',stale(1,1,'empty')),ok(2,ready(2,2))],'B3 scalar-free fallback')
add('B5',[mount(),ok(1,ready(1,1)),event('transport',stale(1,1)),event('transport',stale(1,1)),ok(3,ready(1,3)),ok(2,ready(1,3))],'unchanged transport/props rerender issues no request')
add('B6',[mount(),edit('I',ref(2,2,'invalid','idle',False)),ok(1,ref(2,2,'invalid','idle',False)),edit('K',pending(3,3)),ok(2,ready(3,3))],'warning compile is legal; exact missing dependency error; B1')
add('C1',[mount(),edit('L',pending(2,2)),edit('K2',pending(3,3)),event('unmount'),event('remount',pending(3,4)),ok(1,pending(3,4)),bad(2,pending(3,4)),ok(3,pending(3,4)),ok(4,ready(3,4))],'B2 cleanup while mounted; fresh remount identity must increase')
for id,scalar in [('C2',False),('C3',True)]:
 ev=[]
 for mode in ['parity','shadow']:
  if not scalar:
   ev += [event('mount',ref(1,1),file='K',mode=mode),ok(1,ref(1,1,status='ready')),edit('K2',ref(2,2)),edit('L',ref(3,3,'L')),ok(2,ref(3,3,'L')),ok(3,ref(3,3,'L','ready')),event('unmount')]
  else:
   ev += [event('mount',pending(1,1),file='S',mode=mode),ok(1,ready(1,1,source='reference')),edit('S2',pending(2,2)),event('transport',pending(2,3)),bad(2,pending(2,3)),bad(3,state(2,3,'failed',error='request-3',current=True)),event('transport',pending(2,4)),ok(4,ready(2,4,source='reference')),event('unmount')]
 add(id,ev,'C2 non-scalar reference remains current; C3 scalar validation is deferred')
add('C4',[mount(),ok(1,ready(1,1)),event('limit',stale(1,1),value=1),ok(2,ready(1,2,'partial')),event('limit',stale(1,2,'partial'),value=None),ok(3,ready(1,3)),edit('K2',stale(1,3)),ok(4,ready(2,4))],'#295 existing Canvas stale selection/draw readiness controls')
manifest=dict(base='e65f1030e1c93743ac650ee999bdc77d8a5142a5',oracle='Hand coordinates and explicit producer/request ownership; no product measurement used',sources={p.stem:dict(file=p.name,sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p in sorted(ROOT.glob('*.nui'))},units=units)
(ROOT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Frozen',len(units),'primary units;',sum('expected' in e for u in units for e in u['events']),'observable checkpoints')
# Evidence-triggered supplements: no extra random/fuzz inputs.
add('X1',[mount(),ok(1,ready(1,1)),event('mode',ref(1,2,status='idle'),value='reference'),event('mode',stale(1,1),value='rust'),ok(2,ready(1,3))],'trigger: B5 transport epoch failure; same-input mode retry epoch')
add('X2',[mount(),ok(1,ready(1,1)),event('limit',stale(1,1),value=1),event('limit',stale(1,1),value=None),ok(2,stale(1,1)),ok(3,ready(1,3))],'trigger: A4 identity reuse; restore before intermediate completion')
add('R1',[mount(),ok(1,ready(1,1)),edit('K2',stale(1,1))],'minimal temporal reducer: remove ABA, failures, options and second completion; A6 fatal edit passes')
manifest['units']=units
(ROOT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
