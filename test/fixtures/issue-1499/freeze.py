"""Independent pre-run oracle; standard-library algebra and Simpson quadrature.
No product imports. Coordinates mm, Y-up. Re-run to reproduce all sealed inputs.
"""
import hashlib,json,math
from pathlib import Path
ROOT=Path(__file__).parent
units=[]
def p(x,y):return dict(x=x,y=y)
def seg(n,a,b):return f'line {n} = segment(start: {a}, end: {b})\n'
def arc(n,c,r,a,b,cw=False):return f'arc {n} = arc(center: {c}, radius: {r}, start: {a}, end: {b}, direction: {"clockwise" if cw else "counterclockwise"})\n'
def cubic(n,ps):
 a,b,c,d=ps
 v=(b[0]-a[0],b[1]-a[1]);w=(d[0]-c[0],d[1]-c[1])
 angle=lambda v:math.degrees(math.atan2(v[1],v[0]))%360
 return f'curve {n} = bezier(start: {a}, end: {d}, startAngle: {angle(v)}, startLength: {math.hypot(*v)}, endAngle: {angle(w)}, endLength: {math.hypot(*w)})\n'
def ix(n,a='A',b='B',i=0,ext=False,pure=False):return f'{"const "+n+": point" if pure else "point "+n} = intersection(line1: @{a}, line2: @{b}, index: {i}, extensions: {str(ext).lower()})\n'
def length(ps,t):
 def f(u):return math.hypot(*[3*((1-u)**2*(ps[1][k]-ps[0][k])+2*(1-u)*u*(ps[2][k]-ps[1][k])+u*u*(ps[3][k]-ps[2][k])) for k in [0,1]])
 def sim(n):return t*(f(0)+f(t)+sum((4 if j%2 else 2)*f(t*j/n) for j in range(1,n)))/(3*n)
 value=sim(4096);assert abs(value-sim(2048))<1e-8
 return value
CONTROL=seg('Control',(201,-103),(238,-103))
def seal(id,body,expected,evidence,pairs=None,**kw):
 source='nui 1\n// #1499 '+id+' independently sealed before evaluator execution\n'+body+CONTROL
 file=id+'.nui';(ROOT/file).write_text(source)
 u=dict(id=id,file=file,sha256=hashlib.sha256(source.encode()).hexdigest(),expected=expected,evidence=evidence,pairs=pairs or [],**kw)
 if 'editBody' in u:
  source='nui 1\n// #1499 '+id+' sealed legal recovery\n'+u.pop('editBody')+CONTROL
  file=id+'-recovered.nui';(ROOT/file).write_text(source)
  u['edit']=dict(file=file,sha256=hashlib.sha256(source.encode()).hexdigest(),expected=u.pop('editExpected'),errors={},pureErrors={},pairs=[])
 units.append(u)
def pair(a,b,roots,ext=False):return dict(a=a,b=b,roots=roots,extensions=ext)
def root(x,y,d1,d2,t=None,u=None):return dict(x=x,y=y,line1Distance=d1,line2Distance=d2,**({'t':t} if t is not None else {}),**({'u':u} if u is not None else {}))
nohit='交点を見つけられません'
missing='対応する交点はありません'
# L1 exact solving: (3,7)+t(60,30)=(13,47)+u(50,-50), t=5/9,u=7/15.
r=root(109/3,71/3,math.hypot(60,30)*5/9,math.hypot(50,50)*7/15)
body=seg('A',(3,7),(63,37))+seg('B',(13,47),(63,-3))+seg('Miss',(80,70),(90,72))+ix('Hit')+ix('NoHit','A','Miss')
seal('L1',body,{'Hit':p(r['x'],r['y'])},{'equations':'3+60t=13+50u; 7+30t=47-50u; t=5/9,u=7/15','primitives':[[[3,7],[63,37]],[[13,47],[63,-3]]]},[pair('A','B',[r]),pair('A','Miss',[])],errors={'NoHit':nohit})
body=seg('A',(0,0),(10,5))+seg('B',(20,-10),(20,0))+seg('Reversed',(10,5),(0,0))+ix('Finite')+ix('Extended',ext=True)+ix('Reverse','Reversed','B',ext=True)
seal('L2',body,{'Extended':p(20,10),'Reverse':p(20,10)},{'equations':'A:y=x/2, B:x=20; outside both finite sources; reverse same locus','extensionRange':'20 mm << 1e6 mm'},[pair('A','B',[]),pair('A','B',[root(20,10,math.sqrt(500),20)],True)],errors={'Finite':nohit})
poly='line A = polyline(points: [(0,-20),(40,20),(80,-20)])\n';line=seg('B',(-10,0),(90,0))
rr=[root(20,0,math.sqrt(800),30),root(60,0,3*math.sqrt(800),70)]
seal('L3',poly+line+ix('P0')+ix('P1',i=1)+ix('P2',i=2),{'P0':p(20,0),'P1':p(60,0)},{'vertices':[[0,-20],[40,20],[80,-20]],'t':[.5,.5],'order':'cumulative directed segment distances'},[pair('A','B',rr)],errors={'P2':missing})
body='line A = polyline(points: [(80,-20),(40,20),(0,-20)])\n'+line+ix('P0')+ix('P1',i=1)+ix('Swap0','B','A')+ix('Swap1','B','A',1)
seal('L4',body,{'P0':p(60,0),'P1':p(20,0),'Swap0':p(20,0),'Swap1':p(60,0)},{'vertices':[[80,-20],[40,20],[0,-20]],'order':'reverse first path: x60 then20; swapped first horizontal x20 then60'},[pair('A','B',[root(60,0,math.sqrt(800),70),root(20,0,3*math.sqrt(800),30)]),pair('B','A',[root(20,0,30,3*math.sqrt(800)),root(60,0,70,math.sqrt(800))])])
# Arc r=50 at y=20: x=+-sqrt(2100), sweep 10..170 includes both.
x=math.sqrt(2100);alpha=math.degrees(math.asin(.4));d=lambda a:50*math.radians(a)
for id,cw in [('A1',False),('A2',True)]:
 roots=[root(x,20,d(alpha-10),x+70),root(-x,20,d(170-alpha),70-x)]
 if cw:roots=[root(-x,20,d(alpha-10),70-x),root(x,20,d(170-alpha),70+x)]
 body=arc('A',(0,0),50,170 if cw else 10,10 if cw else 170,cw)+seg('B',(-70,20),(70,20))+ix('P0')+ix('P1',i=1)
 seal(id,body,{'P0':p(roots[0]['x'],20),'P1':p(roots[1]['x'],20)},{'circle':[0,0,50],'lineY':20,'angles':[alpha,180-alpha],'sweep':[170,-160] if cw else [10,160],'equation':'x^2+20^2=50^2'},[pair('A','B',roots)])
# Nonconcentric equal circles centers (0,0),(60,0), r50: (30,+-40).
a=math.degrees(math.atan2(40,30));b=180-a
roots=[root(30,40,d(a+70),d(250-b)),root(30,-40,d(70-a),d(250-(360-b)))]
# First arc starts 290, wraps through upper root; lower root comes first.
roots=[root(30,-40,d(70-a),d(250-(360-b))),root(30,40,d(70+a),d(250-b))]
# Second arc CCW 100..260 includes angles126.87,233.13.
roots[0]['line2Distance']=d((360-b)-100);roots[1]['line2Distance']=d(b-100)
seal('A3',arc('A',(0,0),50,290,70)+arc('B',(60,0),50,100,260)+ix('P0')+ix('P1',i=1),{'P0':p(30,-40),'P1':p(30,40)},{'circles':[[0,0,50],[60,0,50]],'equations':'subtract circles: x=30; y^2=1600','angles':[[360-a,a],[360-b,b]],'sweeps':[[290,140],[100,160]]},[pair('A','B',roots)])
body=arc('Original',(0,0),50,10,170)+'line A = transformCopy(startPoint: (0,0), endPoint: (7,-9), baseLines: [@Original])\n'+seg('B',(-63,11),(77,11))+ix('P0')+ix('P1',i=1)
seal('A4',body,{'P0':p(x+7,11),'P1':p(7-x,11)},{'circle':[7,-9,50],'sourceCircle':[0,0,50],'translation':[7,-9],'angles':[alpha,180-alpha],'sweep':[10,160],'known1497Control':True},[pair('A','B',[root(x+7,11,d(alpha-10),70+x),root(7-x,11,d(170-alpha),70-x)])])
ps=[(0,-32),(40,56),(80,-56),(120,32)]
bs=cubic('A',ps);hs=seg('B',(-10,0),(130,0))
rr=[root(120*t,0,length(ps,t),120*t+10,t) for t in [.2,.5,.8]]
evidence={'controls':ps,'powerCoefficients':{'x':[0,120],'y':[-32,264,-600,400]},'factorization':'400(t-.2)(t-.5)(t-.8)','parameters':[.2,.5,.8],'derivativeAtRoots':[72,-36,72],'distanceMethod':'independent composite Simpson 4096 vs2048 difference<1e-8; product mesh distance tolerance0.15mm'}
seal('B1',bs+hs+''.join(ix('P'+str(i),i=i) for i in range(3))+ix('Absent',i=3),{'P0':p(24,0),'P1':p(60,0),'P2':p(96,0)},evidence,[pair('A','B',rr)],errors={'Absent':missing})
straight=[(-10,0),(110/3,0),(250/3,0),(130,0)]
seal('B2',bs+cubic('B',straight)+''.join(ix('P'+str(i),i=i) for i in range(3))+ix('Absent',i=3),{'P0':p(24,0),'P1':p(60,0),'P2':p(96,0)},{**evidence,'secondControls':straight,'secondParameters':[(120*t+10)/140 for t in [.2,.5,.8]],'secondIdentity':'independent B source'},[pair('A','B',rr)],errors={'Absent':missing})
qs=[(-60,30),(-20,-10),(20,-10),(60,30)];radius=math.sqrt(956.25);angle=math.degrees(math.atan2(7.5,30))
seal('B3',cubic('A',qs)+arc('B',(0,0),radius,-20,80)+ix('P0')+ix('Absent',i=1),{'P0':p(30,7.5)},{'controls':qs,'powerCoefficients':{'x':[-60,120],'y':[30,-120,120]},'circle':[0,0,radius],'equation':'y=x^2/120; x^2+x^4/14400=956.25; x^2=900 or -15300','parameters':[.25,.75],'candidatePoints':[[-30,7.5],[30,7.5]],'candidateAngles':[180-angle,angle],'sweep':[-20,100],'excluded':'negative-x circle root angle165.96 outside partial sweep'},[pair('A','B',[root(30,7.5,length(qs,.75),radius*math.radians(angle+20),.75,(angle+20)/100)])],errors={'Absent':missing})
body=bs+'reverse A as reversed ()\n'+hs+''.join(ix('P'+str(i),i=i) for i in range(3))+ix('Absent',i=3)
seal('B4',body,{'P0':p(96,0),'P1':p(60,0),'P2':p(24,0)},{**evidence,'reversedControls':ps[::-1],'parameters':[.2,.5,.8]},[pair('A','B',[root(120*t,0,length(ps,1)-length(ps,t),120*t+10,1-t) for t in [.8,.5,.2]])],errors={'Absent':missing})
# Offset from (10,10)->(130,40) by left 2sqrt17 => (-2,+8).
# Ray (20,80)+s(60,-90); seam (8,18)+t(120,30).
# 80-90s=18+(12+60s)/4 => s=59/105, x=376/7,y=206/7.
nx,ny=376/7,206/7
body=seg('Base',(10,10),(130,40))+f'line Seam = offset(sources: [@Base], distance: {2*math.sqrt(17)}, side: left)\nmodule Notch(seam: path) {{\n'+seg('Ray',(20,80),(80,-10))+'export '+ix('Hit','Ray','seam')+'}\ninstance Draft = Notch(seam: @Seam)\n'
seal('N1',body,{'Draft::Hit':p(nx,ny)},{'base':[[10,10],[130,40]],'offset':[-2,8],'seam':[[8,18],[128,48]],'ray':[[20,80],[80,-10]],'rayParameter':59/105,'equations':'ray y=110-1.5x; seam y=16+x/4; x=376/7','identity':'Hit belongs to Notch source in Draft instance'},[pair('Draft::Ray','Seam',[root(nx,ny,math.hypot(60,90)*59/105,math.hypot(120,30)*((nx-8)/120))])])
body=bs+hs+ix('Draw',i=1)+ix('Pure',i=1,pure=True)+'point Consumer = offset(from: @Pure, dx: 7, dy: -4)\n'
seal('N2',body,{'Draw':p(60,0),'Pure':p(60,0),'Consumer':p(67,-4)},{**evidence,'identity':'Pure occurrence no ElementId; Draw distinct source-owned drawable; legal downstream point'},[pair('A','B',rr)],pure=['Pure'])
body='module Cut(dx: number, dy: number) {\nline A = segment(start: (@dx,@dy), end: (@dx + 60,@dy + 30))\nline B = segment(start: (@dx,@dy + 30), end: (@dx + 60,@dy))\nexport '+ix('Hit')+'export '+ix('Pure',pure=True)+'}\ninstance First = Cut(dx: 7, dy: -4)\ninstance Second = Cut(dx: -19, dy: 23)\npoint UseFirst = offset(from: @First::Pure, dx: 1, dy: 2)\npoint UseSecond = offset(from: @Second::Pure, dx: 1, dy: 2)\n'
seal('N3',body,{'First::Hit':p(37,11),'Second::Hit':p(11,38),'First::Pure':p(37,11),'Second::Pure':p(11,38),'UseFirst':p(38,13),'UseSecond':p(12,40)},{'relativeLines':[[[0,0],[60,30]],[[0,30],[60,0]]],'parameters':[.5,.5],'translations':[[7,-4],[-19,23]],'identity':'same definition source; independent nonempty instance paths and runtime IDs'},[pair('First::A','First::B',[root(37,11,math.sqrt(4500)/2,math.sqrt(4500)/2)]),pair('Second::A','Second::B',[root(11,38,math.sqrt(4500)/2,math.sqrt(4500)/2)])],pure=['First::Pure','Second::Pure'])
body=seg('A',(0,0),(60,30))+seg('B',(0,30),(60,0))+seg('Parallel',(0,5),(60,35))+seg('Overlap',(10,5),(50,25))+ix('Good')+ix('Same','A','A')+ix('ParallelHit','A','Parallel')+ix('OverlapHit','A','Overlap')+ix('BadIndex',i=-1)+ix('Missing',i=5)+ix('PureBad',i=.5,pure=True)+ix('PureMissing',i=4,pure=True)
fixed=body.replace('line2: @A','line2: @B').replace('line2: @Parallel','line2: @B').replace('line2: @Overlap','line2: @B').replace('index: -1','index: 0').replace('index: 5','index: 0').replace('index: 0.5','index: 0').replace('index: 4','index: 0')
seal('N4',body,{'Good':p(30,15)},{'intersection':[30,15],'parameters':[.5,.5],'diagnostics':'same-source, parallel, overlap, invalid index, unavailable root; no computed stale points','recovery':'only intersection inputs/indices revised; Control identity and geometry preserved'},errors={'Same':'同じ線','ParallelHit':nohit,'OverlapHit':'重な','BadIndex':'0以上の整数','Missing':missing},pureErrors={'PureBad':'non-negative integer','PureMissing':'unavailable'},editBody=fixed,editExpected={n:p(30,15) for n in ['Good','Same','ParallelHit','OverlapHit','BadIndex','Missing','PureBad','PureMissing']},pure=['PureBad','PureMissing'])
# Certified distance allowance: each subdivided cubic arc length lies between
# its chord and control-polygon lengths. Parameter interpolation contributes
# at most max|B''|/(8*64^2), since speed is max|B''|-Lipschitz.
def distance_bound(ps):
 def split(points,t):
  levels=[points]
  while len(levels[-1])>1:
   levels.append([tuple((1-t)*a+t*b for a,b in zip(x,y)) for x,y in zip(levels[-1],levels[-1][1:])])
  return [v[0] for v in levels],[v[-1] for v in levels[::-1]]
 deficit=0
 for i in range(64):
  prefix,_=split(ps,(i+1)/64);_,part=split(prefix,i/(i+1))
  deficit+=sum(math.dist(a,b) for a,b in zip(part,part[1:]))-math.dist(part[0],part[-1])
 curvature=max(math.hypot(*[6*(ps[j+2][k]-2*ps[j+1][k]+ps[j][k]) for k in [0,1]]) for j in [0,1])
 return deficit+curvature/(8*64**2)
distanceBounds={'B1_B2_B4_N2':distance_bound(ps),'B3':distance_bound(qs),'arc160deg':50*math.radians(160)**3/(24*29**2)}
assert max(distanceBounds.values())<.15
manifest=dict(base='0fd989e683104944d45bed6830bdac148d9bbc94',coordinateTolerance=1e-6,distanceTolerance=.15,distanceErrorUpperBounds=distanceBounds,units=units,unusedX='X1-X6 NOT_TRIGGERED',unusedR='R1-R6 NOT_TRIGGERED',precision='Double-precision algebra; all simple separated roots; coordinate1e-6mm; arc/bezier distance0.15mm allows sampled-length approximation; ordering separated by many mm. No tangency/epsilon claims.')
(ROOT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('sealed',len(units),'primary units before any product evaluation')
