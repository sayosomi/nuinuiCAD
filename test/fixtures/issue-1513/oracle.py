"""Independent geometric fixtures; never imports or runs subject implementations.

Two-ray fillets use intersection of inward normal offsets (not subject bisector
code). Cubic length uses converged 20000/40000 chord integration. C1 permits
0.25mm endpoint projection and 0.04rad tangent approximation: the cubic's
slope is bounded by 1/30, so those are conservative, not exact-curve claims.
C2 uses exact internal circle/circle tangency with a 0.002mm / 0.02deg budget:
R=1e6, 0.01deg source sweep bounds chord sagitta by 0.00381mm and normal
rotation by 0.01deg. The shorter retained chord has smaller length error.
"""
import hashlib
import json
import math
from pathlib import Path
P = Path(__file__).parent
BASE = 'ebdcdce00727d291067ac6f20b295466caf04843'
units = []
def xy(p): return dict(zip(('x','y'),p))
def line(a,b): return dict(start=xy(a),end=xy(b),length=math.dist(a,b))
def fillet(o,u,v,r):
    # Solve c.o normal equations c.u_perp = +/-r, c.v_perp = +/-r.
    det=u[0]*v[1]-u[1]*v[0]
    sign=1 if det>0 else -1
    n1=(-u[1]*sign,u[0]*sign); n2=(v[1]*sign,-v[0]*sign)
    d=n1[0]*n2[1]-n1[1]*n2[0]
    c=(r*(n2[1]-n1[1])/d,r*(n1[0]-n2[0])/d)
    a=(c[0]-r*n1[0],c[1]-r*n1[1]); b=(c[0]-r*n2[0],c[1]-r*n2[1])
    start=math.degrees(math.atan2(a[1]-c[1],a[0]-c[0]))%360
    sweep=math.degrees(math.atan2((a[0]-c[0])*(b[1]-c[1])-(a[1]-c[1])*(b[0]-c[0]),(a[0]-c[0])*(b[0]-c[0])+(a[1]-c[1])*(b[1]-c[1])))
    shift=lambda p:xy((p[0]+o[0],p[1]+o[1]))
    return dict(kind='arcLine',center=shift(c),start=shift(a),end=shift(b),radius=r,startAngleDeg=start,sweepAngleDeg=sweep,length=r*abs(math.radians(sweep)))
def source(id,text):
    s='nui 1\n// #1513 '+id+': oracle frozen before evaluation\n'+text+'\nline Control = segment(start: (201, -103), end: (238, -103))\n'
    (P/(id+'.nui')).write_text(s)
    return dict(file=id+'.nui',sha256=hashlib.sha256(s.encode()).hexdigest())
def unit(id,text,expected,**kw):
    u=dict(id=id,**source(id,text),expected=expected,**kw); units.append(u); return u

def straight(id,a=(0,0),o=(100,0),b=(100,60),r=10,reverse=False,extra='',error=None,**kw):
    u=tuple((a[i]-o[i])/math.dist(a,o) for i in range(2)); v=tuple((b[i]-o[i])/math.dist(b,o) for i in range(2))
    arc=fillet(o,u,v,r)
    astart,aend=(o,a) if reverse else (a,o)
    end1='start' if reverse else 'end'
    text=f'line A = segment(start: {astart}, end: {aend})\nline B = segment(start: {o}, end: {b})\narc R = corner(end1: @A.{end1}, end2: @B.start, radius: {r})'+extra
    if error:
        expected=dict(A=line(astart,aend),B=line(o,b),R=None)
    else:
        t1=tuple(arc['start'].values());t2=tuple(arc['end'].values())
        expected=dict(A=line(t1,a) if reverse else line(a,t1),B=line(t2,b),R=arc)
    return unit(id,text,expected,errors=error or [],**kw)
straight('S1',b=(100,73),r=13)
straight('S2',a=(100,0),o=(0,0),b=(40,40*math.sqrt(3)),r=7)
straight('S3',a=(90,0),o=(0,0),b=(-60,60*math.sqrt(3)),r=9,reverse=True)
u=straight('S4',extra='\npoint Consumer = coordinate(x: @R.length, y: @A.length + @B.length)')
u['expected']['Consumer']=dict(x=5*math.pi,y=140)
straight('F1',b=(100,10),error=['トリム'],extra='\npoint Consumer = onLine(from: @R.start, ratio: 0.5)') ['errors'].append('依存')
straight('F2',a=(90,0),b=(100,70),error=['トリム'])
straight('F3',b=(100,20),r=30,error=['大きすぎ'])
u=straight('F4',extra=''); s=(P/u['file']).read_text().replace('radius: 10)','radius: 10, index: 0.5)'); (P/u['file']).write_text(s); u['sha256']=hashlib.sha256(s.encode()).hexdigest();u['errors']=['整数'];u['expected']=dict(A=line((0,0),(100,0)),B=line((100,0),(100,60)),R=None)
# A gently curved cubic: true Bernstein locus and a well-separated interior trim.
cubic=((0,0),(30,1),(70,-1),(100,0))
def point(t): return tuple((1-t)**3*cubic[0][i]+3*(1-t)**2*t*cubic[1][i]+3*(1-t)*t*t*cubic[2][i]+t**3*cubic[3][i] for i in range(2))
lo,hi=0,1
for _ in range(80):
    mid=(lo+hi)/2
    if point(mid)[0]<60:lo=mid
    else:hi=mid
t=(lo+hi)/2
def length(n):return sum(math.dist(point(t*i/n),point(t*(i+1)/n)) for i in range(n))
l1,l2=length(20000),length(40000);assert abs(l1-l2)<1e-8
curve=f'curve A = bezier(start: (0, 0), end: (100, 0), startAngle: {math.degrees(math.atan2(1,30))}, startLength: {math.hypot(30,1)}, endAngle: {math.degrees(math.atan2(1,30))}, endLength: {math.hypot(30,1)})'
u=unit('C1',curve+'\nline B = segment(start: (50, -50), end: (50, 50))\narc R = corner(end1: @A.end, end2: @B.start, radius: 10)',dict(A=dict(kind='offsetLine',**line((0,0),(60,0)),lengthTolerance=.3),B=line((50,-10),(50,50)),R=fillet((50,0),(1,0),(0,-1),10)),curveOracle=dict(controls=list(map(xy,cubic)),parameter=t,point=xy(point(t)),length=l2,maxProjection=.25,maxTangentRadians=.04))
R=1e6;theta=math.radians(.01);x=R*math.sin(theta);y=R*(1-math.cos(theta));cx=x-10;cy=R-math.sqrt((R-10)**2-cx*cx);tx=cx*R/(R-10);ty=R+(cy-R)*R/(R-10)
a=math.degrees(math.atan2(ty-cy,tx-cx))%360;sweep=(360-a)%360
unit('C2',f'arc A = arc(center: (0, {R}), radius: {R}, start: 270, end: 270.01, direction: counterclockwise)\nline B = segment(start: ({x}, {y}), end: ({x}, 70))\narc R = corner(end1: @A.end, end2: @B.start, radius: 10)',dict(A=dict(kind='offsetLine',start=xy((0,0)),end=xy((tx,ty)),length=R*math.asin(tx/R),coordinateTolerance=.002,lengthTolerance=.002),B=dict(**line((x,cy),(x,70)),coordinateTolerance=.002,lengthTolerance=.002),R=dict(kind='arcLine',center=xy((cx,cy)),start=xy((tx,ty)),end=xy((x,cy)),radius=10,startAngleDeg=a,sweepAngleDeg=sweep,length=10*math.radians(sweep),coordinateTolerance=.002,angleTolerance=.02,lengthTolerance=.002)),circleOracle=dict(center=xy((0,R)),radius=R,maxLocusError=.004))
unit('C3','line Lead = segment(start: (-40, 0), end: (0, 0))\nline Tail = segment(start: (0, 0), end: (100, 0))\nline A = offset(sources: [@Lead, @Tail], distance: 10, side: right, closed: false)\nline B = segment(start: (100, -10), end: (100, -80))\narc R = corner(end1: @A.end, end2: @B.start, radius: 8)',dict(A=dict(kind='offsetLine',**line((-40,-10),(92,-10)),segments=[dict(kind='line',**line((-40,-10),(0,-10))),dict(kind='line',**line((0,-10),(92,-10)))]),B=line((100,-18),(100,-80)),R=fillet((100,-10),(-1,0),(0,-1),8)))
unit('C4','curve A = bezier(start: (0, 0), end: (120, 0), startAngle: 0, startLength: 30, endAngle: 0, endLength: 40)\ncurve B = bezier(start: (50, -70), end: (50, 80), startAngle: 90, startLength: 40, endAngle: 90, endLength: 30)\narc R = corner(end1: @A.end, end2: @B.start, radius: 12)',dict(A=dict(kind='offsetLine',**line((0,0),(62,0))),B=dict(kind='offsetLine',**line((50,-12),(50,80))),R=fillet((50,0),(1,0),(0,-1),12)))
u=straight('R1',b=(100,10),r=4); v=straight('R1-collapse',b=(100,10),error=['トリム']); units.pop(); w=straight('R1-recover',b=(100,10),r=3);units.pop();u['revisions']=[v,w]
u=straight('R2',b=(100,60),r=8);v=straight('R2-change',a=(0,10),o=(120,10),b=(160,70),r=8);units.pop();u['revisions']=[v]
u=straight('R3',extra='\nconst Original: line = @A.base\nconst Named: line = @A.Kept\nconst Final: line = @A.final')
s=(P/u['file']).read_text().replace('arc R =','extend A.end as Kept(to: (100, 0))\narc R =');(P/u['file']).write_text(s);u['sha256']=hashlib.sha256(s.encode()).hexdigest();u['expected'].update(Original=line((0,0),(100,0)),Named=line((0,0),(100,0)),Final=line((0,0),(90,0)))
# Distinguish all three stage snapshots; the initial no-op stage is retained
# as a chronological control, not counted twice as a new primary.
text='\n'.join((P/u['file']).read_text().splitlines()[2:-1]).replace('as Kept(to: (100, 0))','as Kept(to: (120, 0))')
v=unit('R3-distinct',text,dict(A=line((0,0),(110,0)),B=line((100,10),(100,60)),R=fillet((100,0),(1,0),(0,1),10),Original=line((0,0),(100,0)),Named=line((0,0),(120,0)),Final=line((0,0),(110,0))))
units.pop();u['revisions']=[v]
# Independent groups give disjoint owner identities and a simultaneous failure.
first='group First {\nline A = segment(start: (0, 0), end: (100, 0))\nline B = segment(start: (100, 0), end: (100, 10))\narc R = corner(end1: @A.end, end2: @B.start, radius: 10)\n}'
second='group Second {\nline A = segment(start: (-50, -20), end: (40, -20))\nline B = segment(start: (40, -20), end: (40, 70))\narc R = corner(end1: @A.end, end2: @B.start, radius: 6)\n}'
unit('R4',first+'\n'+second,{'First::A':line((0,0),(100,0)),'First::B':line((100,0),(100,10)),'First::R':None,'Second::A':line((-50,-20),(34,-20)),'Second::B':line((40,-14),(40,70)),'Second::R':fillet((40,-20),(-1,0),(0,1),6)},errors=['トリム'])
# Motivated adjacent controls, plus post-construction final guard reachability.
u=straight('X1',r=5e-8,error=['同じ位置'])
for name in ('A','B'):u['expected'][name].update(coordinateTolerance=1e-12,lengthTolerance=1e-12)
u=straight('X2',extra='');s=(P/u['file']).read_text().replace('radius: 10)','radius: 10, enabled: false)');(P/u['file']).write_text(s);u['sha256']=hashlib.sha256(s.encode()).hexdigest();u['expected']=dict(A=line((0,0),(100,0)),B=line((100,0),(100,60)),R=None)
u=straight('X3',extra='');s=(P/u['file']).read_text().replace('end: (100, 60))','end: (100, 60), enabled: false)');(P/u['file']).write_text(s);u['sha256']=hashlib.sha256(s.encode()).hexdigest();u['expected']=dict(A=line((0,0),(100,0)),B=None,R=None);u['errors']=['評価OFF']
# Minimal independent reducer of F1, without sibling/consumer declarations.
u=unit('Reducer1','line A = segment(start: (0, 0), end: (20, 0))\nline B = segment(start: (20, 0), end: (20, 3))\narc R = corner(end1: @A.end, end2: @B.start, radius: 3)',dict(A=line((0,0),(20,0)),B=line((20,0),(20,3)),R=None),errors=['トリム'])
# Adjacent transaction discriminators exercise each non-straight trim branch.
flatA='curve A = bezier(start: (0, 0), end: (100, 0), startAngle: 0, startLength: 30, endAngle: 0, endLength: 30)'
originalA=dict(kind='bezierCurve',length=100,segments=[dict(start=xy((0,0)),control1=xy((30,0)),control2=xy((70,0)),end=xy((100,0)))])
unit('X4',flatA+'\nline B = segment(start: (100, 0), end: (100, 10))\narc R = corner(end1: @A.end, end2: @B.start, radius: 10)',dict(A=originalA,B=line((100,0),(100,10)),R=None),errors=['トリム'])
flatB='curve B = bezier(start: (100, 0), end: (100, 10), startAngle: 90, startLength: 3, endAngle: 90, endLength: 3)'
originalB=dict(kind='bezierCurve',length=10,segments=[dict(start=xy((100,0)),control1=xy((100,3)),control2=xy((100,7)),end=xy((100,10)))])
unit('X5','line A = segment(start: (0, 0), end: (100, 0))\n'+flatB+'\narc R = corner(end1: @A.end, end2: @B.start, radius: 10)',dict(A=line((0,0),(100,0)),B=originalB,R=None),errors=['トリム'])
u=straight('Reducer2',a=(0,0),o=(14,0),b=(14,7),r=2e-8,error=['同じ位置'])
for name in ('A','B'):u['expected'][name].update(coordinateTolerance=1e-12,lengthTolerance=1e-12)
# Strengthen C4 with genuinely curved cubics on both owners (unique,
# monotone intersection). This is the 28th and last accepted source.
ca=((0,0),(30,.01),(80,-.01),(120,0))
cb=((50,-70),(50.01,-30),(49.99,50),(50,80))
def bez(c,t):return tuple((1-t)**3*c[0][i]+3*(1-t)**2*t*c[1][i]+3*(1-t)*t*t*c[2][i]+t**3*c[3][i] for i in range(2))
def deriv(c,t):return tuple(3*((1-t)**2*(c[1][i]-c[0][i])+2*(1-t)*t*(c[2][i]-c[1][i])+t*t*(c[3][i]-c[2][i])) for i in range(2))
ta,tb=.45,.5
for _ in range(20):
 a,b=bez(ca,ta),bez(cb,tb);da,db=deriv(ca,ta),deriv(cb,tb)
 fx,fy=a[0]-b[0],a[1]-b[1];det=da[1]*db[0]-da[0]*db[1]
 dta=(-fx*db[1]+db[0]*fy)/det;dtb=(da[0]*fy-da[1]*fx)/det
 ta-=dta;tb-=dtb
assert math.dist(bez(ca,ta),bez(cb,tb))<1e-10
corner=bez(ca,ta)
u1=tuple((ca[3][i]-corner[i])/math.dist(ca[3],corner) for i in range(2));u2=tuple((cb[0][i]-corner[i])/math.dist(cb[0],corner) for i in range(2))
arc=fillet(corner,u1,u2,12)
def station(c,axis,target):
 lo,hi=0,1
 for _ in range(80):
  mid=(lo+hi)/2
  if bez(c,mid)[axis]<target:lo=mid
  else:hi=mid
 return (lo+hi)/2
sa=station(ca,0,arc['start']['x']);sb=station(cb,1,arc['end']['y'])
def integrated(c,a,b,n):return sum(math.dist(bez(c,a+(b-a)*i/n),bez(c,a+(b-a)*(i+1)/n)) for i in range(n))
la=integrated(ca,0,sa,40000);lb=integrated(cb,sb,1,40000)
assert abs(la-integrated(ca,0,sa,20000))<1e-8 and abs(lb-integrated(cb,sb,1,20000))<1e-8
for c,t,p in [(ca,sa,arc['start']),(cb,sb,arc['end'])]:
 assert math.dist(bez(c,t),tuple(p.values()))<.01
 tangent=deriv(c,t);radial=tuple(p[k]-arc['center'][k] for k in ['x','y'])
 assert abs(sum(a*b for a,b in zip(tangent,radial))/(math.hypot(*tangent)*12))<.001

def declaration(c,name):
 a=math.degrees(math.atan2(c[1][1]-c[0][1],c[1][0]-c[0][0]));b=math.degrees(math.atan2(c[3][1]-c[2][1],c[3][0]-c[2][0]))
 return f'curve {name} = bezier(start: {c[0]}, end: {c[3]}, startAngle: {a}, startLength: {math.dist(c[0],c[1])}, endAngle: {b}, endLength: {math.dist(c[2],c[3])})'
expected=dict(A=dict(kind='offsetLine',start=xy(ca[0]),end=arc['start'],length=la,lengthTolerance=.02,coordinateTolerance=1e-5),B=dict(kind='offsetLine',start=arc['end'],end=xy(cb[3]),length=lb,lengthTolerance=.02,coordinateTolerance=1e-5),R=dict(**arc,coordinateTolerance=1e-5,angleTolerance=1e-4,lengthTolerance=1e-5))
v=unit('C4-curved',declaration(ca,'A')+'\n'+declaration(cb,'B')+'\narc R = corner(end1: @A.end, end2: @B.start, radius: 12)',expected)
units.pop();next(u for u in units if u['id']=='C4')['revisions']=[v]
manifest=dict(base=BASE,coordinateTolerance=1e-7,lengthTolerance=1e-6,angleTolerance=1e-6,units=units)
(P/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Sealed',len(units),'units plus 5 sealed revisions: 28 accepted sources; exploration closed')
