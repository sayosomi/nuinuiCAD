"""Independent #1511 input/oracle freeze. No product imports or observations.

Lengths use composite Simpson quadrature at 8192 and 16384 intervals.
Cubic length tolerances use rigorous 32-subdivision chord/control-polygon
bounds, rather than treating a sampled chord estimate as an exact length.
"""
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).parent
BASE = '03ce4e4b5eb28a188ee1904bc1bec36170e938e5'
units = []


def xy(p):
    return dict(zip(('x', 'y'), p))


def lerp(a, b, t):
    return tuple(x + (y-x)*t for x, y in zip(a, b))


def dist(a, b):
    return math.dist(a, b)


def angle(a, b):
    return math.degrees(math.atan2(b[1]-a[1], b[0]-a[0])) % 360


def line(a, b):
    return dict(start=xy(a), end=xy(b), length=dist(a, b))


def arc(c, r, a, sweep):
    def p(d):
        return (c[0]+r*math.cos(math.radians(d)), c[1]+r*math.sin(math.radians(d)))
    sign = 1 if sweep > 0 else -1
    return dict(kind='arcLine', center=xy(c), radius=r, start=xy(p(a)), end=xy(p(a+sweep)),
                startAngleDeg=a, sweepAngleDeg=sweep, length=r*abs(math.radians(sweep)),
                startTangentAngleDeg=(a+sign*90) % 360,
                endTangentAngleDeg=(a+sweep-sign*90) % 360)


def casteljau(c, t):
    a, b, d = [lerp(c[i], c[i+1], t) for i in range(3)]
    e, f = lerp(a, b, t), lerp(b, d, t)
    q = lerp(e, f, t)
    return [c[0], a, e, q], [q, f, d, c[3]]


def bernstein(c, t):
    return tuple((1-t)**3*c[0][i]+3*(1-t)**2*t*c[1][i]+3*(1-t)*t*t*c[2][i]+t**3*c[3][i] for i in range(2))


def integral(c, n):
    def speed(t):
        return math.hypot(*[3*((1-t)**2*(c[1][i]-c[0][i])+2*(1-t)*t*(c[2][i]-c[1][i])+t*t*(c[3][i]-c[2][i])) for i in range(2)])
    return (speed(0)+speed(1)+sum((4 if k % 2 else 2)*speed(k/n) for k in range(1, n)))/(3*n)


def bounds(c):
    pieces = [c]
    for _ in range(5):
        pieces = [p for seg in pieces for p in casteljau(seg, .5)]
    lower = sum(dist(p[0], p[3]) for p in pieces)
    upper = sum(sum(dist(p[i], p[i+1]) for i in range(3)) for p in pieces)
    deviation = max(dist(p[i], lerp(p[0], p[3], i/3)) for p in pieces for i in (1, 2))
    return dict(lower=lower, upper=upper, deviation=deviation)


def cubic(c):
    coarse, fine = integral(c, 8192), integral(c, 16384)
    assert abs(coarse-fine) < 1e-8
    b = bounds(c)
    assert b['lower']-1e-9 <= fine <= b['upper']+1e-9
    return dict(zip(('start', 'control1', 'control2', 'end'), map(xy, c))), fine, b


def curve(cs):
    parts = [cubic(c) for c in cs]
    return dict(kind='bezierCurve', segments=[p[0] for p in parts], length=sum(p[1] for p in parts),
                startTangentAngleDeg=angle(cs[0][0],cs[0][1]), endTangentAngleDeg=angle(cs[-1][3],cs[-1][2]),
                startHandleAngleDeg=angle(cs[0][0],cs[0][1]), startHandleLength=dist(cs[0][0],cs[0][1]),
                endHandleAngleDeg=angle(cs[-1][2],cs[-1][3]), endHandleLength=dist(cs[-1][2],cs[-1][3]),
                lengthTolerance=sum(p[2]['upper']-p[2]['lower'] for p in parts)+1e-7)


def declaration(c, name='Source'):
    return f'curve {name} = bezier(start: {tuple(c[0])}, end: {tuple(c[3])}, startAngle: {angle(c[0],c[1])}, startLength: {dist(c[0],c[1])}, endAngle: {angle(c[2],c[3])}, endLength: {dist(c[2],c[3])})'


def write_source(id, text):
    file = id+'.nui'
    source = f'nui 1\n// #1511 {id}: frozen independently before product execution\n'+text+'\nline Control = segment(start: (201, -103), end: (238, -103))\n'
    (ROOT/file).write_text(source)
    return dict(file=file, sha256=hashlib.sha256(source.encode()).hexdigest())


def add(id, text, expected, evidence, **kwargs):
    u = dict(id=id, **write_source(id, text), expected=expected, evidence=evidence, **kwargs)
    units.append(u)
    return u


def seg(n,a,b): return f'line {n} = segment(start: {a}, end: {b})'
def target(p): return f'({p[0]}, {p[1]})'
def revision(u,suffix,text,expected,**kw):
    u.setdefault('revisions',[]).append(dict(**write_source(u['id']+'-'+suffix,text),expected=expected,**kw))
def snap(n,ref): return f'const {n}: line = @{ref}'
def arcsrc(n,c,r,a,b,d='counterclockwise'): return f'arc {n} = arc(center: {c}, radius: {r}, start: {a}, end: {b}, direction: {d})'
def simple(text): return seg('A',(3,7),(27,25))+'\n'+text
# Exact supporting-line algebra: A=(3,7)+t*(4,3), B=(83,7)+u*(-1,2).
a=(3,7); b=(27,25); d=(83,23); e=(79,31); q=(67,55)
add('E1',seg('A',a,b)+'\n'+seg('B',d,e)+'\nedge [A.end, B.end] as Joined(index: 0)',dict(A=line(a,q),B=line(d,q)),dict(corner=q,parameters=[16,16]))
u=add('E2',seg('A',(0,0),(100,50))+'\n'+seg('B',(0,50),(100,0))+'\nedge [A.end, B.start](index: 0)',dict(A=line((0,0),(50,25)),B=line((50,25),(100,0))),dict(corner=[50,25]))
revision(u,'reverse',seg('A',(100,50),(0,0))+'\n'+seg('B',(100,0),(0,50))+'\nedge [A.start, B.end](index: 0)',dict(A=line((50,25),(0,0)),B=line((100,0),(50,25))))
# Errors are recipe-owned; exact publication is inspected, not assumed drawable.
prefix=seg('A',(0,0),(80,0))+'\n'
u=add('E3',prefix+seg('B',(0,7),(80,7))+'\nedge [A.end, B.start](index: 0)',{},dict(negative='parallel'),errorContains='交点',errorCount=1)
revision(u,'same',prefix+seg('B',(30,-20),(30,20))+'\nedge [A.end, A.start](index: 0)',{},errorContains='同じ線',errorCount=1)
revision(u,'index',prefix+seg('B',(30,-20),(30,20))+'\nedge [A.end, B.start](index: 2)',{},errorContains='交点',errorCount=1)
revision(u,'valid',prefix+seg('B',(30,-20),(30,20))+'\nedge [A.end, B.start](index: 0)',dict(A=line((0,0),(30,0)),B=line((30,0),(30,20))),errorCount=0)
text=seg('A',(0,0),(80,0))+'\n'+seg('B',(30,-20),(30,20))+'''\nextend A.end as First(to: (100, 0))
edge [A.First.end, B.start] as Joined(index: 0)
const Original: line = @A.base
const Checkpoint: line = @A.First
const Branch: line = @A.First.Joined
const RootFinal: line = @A.final
const BStage: line = @B.Joined'''
add('E4',text,dict(A=line((0,0),(100,0)),B=line((30,0),(30,20)),Original=line((0,0),(80,0)),Checkpoint=line((0,0),(100,0)),Branch=line((0,0),(30,0)),RootFinal=line((0,0),(100,0)),BStage=line((30,0),(30,20))),dict(selected='A.First',corner=[30,0]))
a=(3,7); b=(99,79)
u=add('T1',seg('A',a,b)+'\nextend A.end(to: (51, 43))',dict(A=line(a,(51,43))),dict(support=[a,b]))
for suffix,end,p in [('end-out','end',(131,103)),('start-in','start',(35,31)),('start-out','start',(-29,-17))]:
 revision(u,suffix,seg('A',a,b)+f'\nextend A.{end}(to: {p})',dict(A=line(p,b) if end=='start' else line(a,p)))
u=add('T2',seg('A',a,b)+'\nextend A.end(to: (51, 45))',{},dict(negative='off-support'),errorContains='直線上',errorCount=1)
revision(u,'zero',seg('A',a,b)+f'\nextend A.end(to: {a})',{},errorContains='長さが0',errorCount=1)
revision(u,'valid',seg('A',a,b)+'\nextend A.end(to: (51, 43))',dict(A=line(a,(51,43))),errorCount=0)
# Joined line/arc/line is an existing editable segmented line owner.
t3=seg('Lead',(-25,0),(0,0))+'\n'+arcsrc('Bend',(0,30),30,270,360)+'\n'+seg('Tail',(30,30),(30,100))+'\nline A = join(paths: [@Lead, @Bend, @Tail], closed: false)'
def joined(end):
 parts=[dict(kind='line',**line((-25,0),(0,0))),dict(arc((0,30),30,270,90),kind='arc'),dict(kind='line',**line((30,30),end))]
 return dict(kind='joinedPath',closed=False,segments=parts,start=xy((-25,0)),end=xy(end),length=25+15*math.pi+dist((30,30),end),startTangentAngleDeg=0,endTangentAngleDeg=270)
u=add('T3',t3+'\nextend A.end(to: (30, 63))',dict(A=joined((30,63))),dict(topology=['line','arc','line'],untouched=2))
revision(u,'extend',t3+'\nextend A.end(to: (30, 137))',dict(A=joined((30,137))))
add('T4',seg('A',b,a)+'''\nextend A.start as Bypass(to: (1000, 2000), enabled: false)
extend A.end as Changed(to: (-29, -17))
const Disabled: line = @A.Bypass''',dict(A=line(b,(-29,-17)),Disabled=line(b,a)),dict(direction='reverse',disabled=True))
c=(11,-9);r=43
q=arc(c,r,317,128)['end']
add('A1',arcsrc('A',c,r,317,349)+f'\nextend A.end(to: ({q["x"]}, {q["y"]}))',dict(A=arc(c,r,317,128)),dict(wrap=True,sweep=128))
q=arc(c,r,50,0)['start']
u=add('A2',arcsrc('A',c,r,85,317,'clockwise')+f'\nextend A.start(to: ({q["x"]}, {q["y"]}))',dict(A=arc(c,r,50,-93)),dict(clockwise=True))
q2=arc(c,r,85,-83)['end']
revision(u,'trim-end',arcsrc('A',c,r,85,317,'clockwise')+f'\nextend A.end(to: ({q2["x"]}, {q2["y"]}))',dict(A=arc(c,r,85,-83)))
q3=arc(c,r,139,0)['start']
revision(u,'extend-start',arcsrc('A',c,r,85,317,'clockwise')+f'\nextend A.start(to: ({q3["x"]}, {q3["y"]}))',dict(A=arc(c,r,139,-182)))
a=math.degrees(math.atan2(40,30)); q=(30,40)
add('A3',arcsrc('A',(0,0),50,10,300)+'\n'+seg('B',(30,10),(30,20))+'\nedge [A.end, B.end](index: 0)',dict(A=arc((0,0),50,10,a-10),B=line((30,10),q)),dict(lineCircle=q,otherBodyRootExcluded=True))
def a4text(i): return arcsrc('A',(0,0),50,280,440)+'\n'+arcsrc('B',(60,0),50,100,260)+f'\nedge [A.end, B.start](index: {i})'
def a4expected(i):
 p=(30,-40 if i==0 else 40); aa=math.degrees(math.atan2(p[1],p[0]))%360; bb=math.degrees(math.atan2(p[1],p[0]-60))%360
 return dict(A=arc((0,0),50,280,(aa-280)%360),B=arc((60,0),50,bb,(260-bb)%360))
u=add('A4',a4text(0),a4expected(0),dict(circleRoots=[[30,-40],[30,40]],separation=80))
revision(u,'index1',a4text(1),a4expected(1))
c=[(4,-7),(31,106),(87,-58),(143,26)];t=.371;l,h=casteljau(c,t);p=bernstein(c,t)
add('B1',declaration(c,'A')+f'\nextend A.end(to: {p})',dict(A=curve([l])),dict(controls=c,t=t))
c=[(-9,13),(14,88),(103,-45),(161,21)];p=(190,54);ext=[*c[:2],(132,-12),p]
u=add('B2',declaration(c,'A')+f'\nextend A.end(to: {p})',dict(A=curve([ext])),dict(controls=c,extension=[29,33]))
rev=list(reversed(c)); revext=list(reversed(ext))
revision(u,'reversed',declaration(rev,'A')+f'\nextend A.start(to: {p})',dict(A=curve([revext])))
c1=[(0,0),(20,45),(45,30),(65,30)];c2=[(65,30),(90,30),(112,-35),(157,12)];t=.413;p=bernstein(c2,t);l,h=casteljau(c2,t)
text='point Join = coordinate(x: 65, y: 30)\ncurve A = bezier(start: (0, 0), end: (157, 12), startAngle: '+str(angle(c1[0],c1[1]))+', startLength: '+str(dist(c1[0],c1[1]))+', endAngle: '+str(angle(c2[2],c2[3]))+', endLength: '+str(dist(c2[2],c2[3]))+', intermediates: [@Join: 0: 20: 25: seam])\n'+declaration(c,'Neighbor')+f'\nextend A.end(to: {p})'
add('B3',text,dict(A=curve([c1,l]),Neighbor=curve([c])),dict(controls=[c1,c2],t=t,unchangedPrefix=1),slots={'A':1})
c=[(6,50.4),(46,-57.6),(86,-45.6),(126,86.4)]
def b4text(i): return declaration(c,'A')+'\n'+seg('B',(-10,0),(145,0))+f'\nedge [A.end, B.start](index: {i})'
def b4expected(t):
 l,h=casteljau(c,t);p=bernstein(c,t);assert abs(p[1])<1e-11
 return dict(A=curve([l]),B=line(p,(145,0)))
u=add('B4',b4text(0),b4expected(.2),dict(polynomial='x=6+120t; y=360(t-.2)(t-.7)',roots=[.2,.7],derivatives=[-180,180],residual=0))
revision(u,'index1',b4text(1),b4expected(.7))
c=[(0,0),(0,60),(100,40),(100,0)];ext=[(0,0),(0,60),(100,16),(100,-24)];l,h=casteljau(ext,.5)
add('M1',declaration(c,'A')+'\n'+seg('B',(50,-10),(50,10))+'''\nextend A.end as Extended(to: (100, -24))
edge [A.end, B.end] as Joined(index: 0)
const First: path = @A.Extended
const Second: path = @A.Joined''',dict(A=curve([l]),B=line((50,-10),(50,25.5)),First=curve([ext]),Second=curve([l])),dict(firstCornerBefore=[50,37.5],after=[50,25.5],t=.5))
text=seg('A',(0,0),(80,0))+'\n'+seg('B',(30,-20),(30,20))+'''\nedge [A.end, B.start] as Joined(index: 0)
extend A.end as Bypass(to: (900, 800), enabled: false)
extend A.Joined.end as Branch(to: (47, 0))
extend A.end as Root(to: (61, 0))
const Checkpoint: line = @A.Joined
const Branched: line = @A.Joined.Branch
const Disabled: line = @A.Bypass
point ReadBranch = onLine(from: @A.Joined.Branch.end, distance: 9)'''
add('M2',text,dict(A=line((0,0),(61,0)),B=line((30,0),(30,20)),Checkpoint=line((0,0),(30,0)),Branched=line((0,0),(47,0)),Disabled=line((0,0),(30,0)),ReadBranch=xy((38,0))),dict(branch=47,root=61))
text='''module Panel(dx: number, dy: number, width: number) {
export line A = segment(start: (@dx, @dy), end: (@dx + @width, @dy))
export line B = segment(start: (@dx + @width + 17, @dy - 20), end: (@dx + @width + 17, @dy + 20))
extend A.end as Extended(to: (@dx + @width + 9, @dy))
edge [A.end, B.start] as Joined(index: 0)
export point Station = onLine(from: @A.end, distance: 13)
}
instance First = Panel(dx: 7, dy: -4, width: 83)
instance Second = Panel(dx: -19, dy: 23, width: 137)'''
expected={}
for n,dx,dy,w in [('First',7,-4,83),('Second',-19,23,137)]:
 expected.update({n+'::A':line((dx,dy),(dx+w+17,dy)),n+'::B':line((dx+w+17,dy),(dx+w+17,dy+20)),n+'::Station':xy((dx+w+4,dy))})
add('M3',text,expected,dict(instances=['First','Second']))
def panel(w): return f'''const Width: number = {w}
group Front {{
line Seam = segment(start: (10, -20), end: (10 + @Width, -20))
line Side = segment(start: (10 + @Width + 17, -91), end: (10 + @Width + 17, 19))
extend Seam.end as Extended(to: (10 + @Width + 9, -20))
edge [Seam.end, Side.start] as Corner(index: 0)
point Notch = onLine(from: @Seam.end, distance: 13)
}}
group Back {{
line Seam = segment(start: (180, -70), end: (180, -163))
point Notch = onLine(from: @Seam.end, distance: 21)
}}'''
def panelexpected(w): return dict(Seam=line((10,-20),(w+27,-20)),Side=line((w+27,-20),(w+27,19)))
# Groups keep their authored display leaf names; the harness disambiguates via groups.
def pexpected(w): return {'Front::Seam':line((10,-20),(w+27,-20)),'Front::Side':line((w+27,-20),(w+27,19)),'Front::Notch':xy((w+14,-20)),'Back::Seam':line((180,-70),(180,-163)),'Back::Notch':xy((180,-142))}
u=add('M4',panel(123),pexpected(123),dict(revisions=[123,151,97,123],restoresExactSource=True))
for suffix,w in [('V1',151),('V2',97)]: revision(u,suffix,panel(w),pexpected(w))
u['revisions'].append(dict(file=u['file'],sha256=u['sha256'],expected=u['expected']))
# X1: supported intersection discovery may yield an arc tangent-extension
# root that the concrete arc endpoint cannot reach. First move must roll back.
# Circle root (30,40) is valid (A3); the earlier tangent root is independently
# (30, -25*sqrt(3)+5/sqrt(3)). It is not on the supporting circle.
p=(30,-25*math.sqrt(3)+5/math.sqrt(3))
assert abs(math.hypot(*p)-50)>0.01
add('X1',seg('A',(30,10),(30,20))+'\n'+arcsrc('B',(0,0),50,10,300)+'\nedge [A.end, B.end] as Failed(index: 0)',dict(A=line((30,10),(30,20)),B=arc((0,0),50,10,290)),dict(trigger='A3 has a later arc tangent root; E3 never reaches paired relocation',corner=p,circleResidual=abs(math.hypot(*p)-50)),errorCount=1,errorContains='円周上')
# X2: T3 used line terminals; independently cover arc truncation and curved
# terminal tangent append, retaining exact untouched primitive topology.
lead=dict(kind='line',**line((-25,0),(0,0)))
def arcpart(start,sweep):
 d=arc((0,30),30,start,sweep);d['kind']='arc'
 for k in ['startTangentAngleDeg','endTangentAngleDeg']:d.pop(k)
 return d
p=arc((0,30),30,270,36)['end']
prefix=seg('Lead',(-25,0),(0,0))+'\n'+arcsrc('Bend',(0,30),30,270,360)
text=prefix+'\nline A = join(paths: [@Lead, @Bend], closed: false)'
def composite(parts,st,et): return dict(kind='joinedPath',closed=False,segments=parts,start=parts[0]['start'],end=parts[-1]['end'],length=sum(a['length'] for a in parts),startTangentAngleDeg=st,endTangentAngleDeg=et,lengthTolerance=sum(a.get('lengthTolerance',0) for a in parts)+1e-7)
u=add('X2',text+f'\nextend A.end(to: ({p["x"]}, {p["y"]}))',dict(A=composite([lead,arcpart(270,36)],0,216)),dict(trigger='T3 curved primitive truncation and curved terminal append remain untested',parameter=.4,unchangedPrefix=1))
revision(u,'tangent',text+'\nextend A.end(to: (30, 67))',dict(A=composite([lead,arcpart(270,90),dict(kind='line',**line((30,30),(30,67)))],0,270)))
# X3: same segmented kernel has a separate cubic projection/subdivision arm.
c=[(0,0),(0,40),(80,40),(100,0)];l,h=casteljau(c,.37);p=bernstein(c,.37)
text=seg('Lead',(-25,0),(0,0))+'\n'+declaration(c,'Tail')+'\nline A = join(paths: [@Lead, @Tail], closed: false)'
def cubicpart(c):
 segment,length,b=cubic(c);return dict(kind='bezier',**segment,length=length,lengthTolerance=b['upper']-b['lower']+1e-7)
u=add('X3',text+f'\nextend A.end(to: {p})',dict(A=composite([lead,cubicpart(l)],0,angle(l[3],l[2]))),dict(trigger='T3/X2 do not cover the separate cubic segmented projection arm',controls=c,t=.37,unchangedPrefix=1))
revision(u,'tangent',text+'\nextend A.end(to: (110, -20))',dict(A=composite([lead,cubicpart(c),dict(kind='line',**line((100,0),(110,-20)))],0,angle((110,-20),(100,0)))))
(ROOT/'manifest.json').write_text(json.dumps(dict(base=BASE,coordinateTolerance=1e-6,lengthTolerance=1e-6,units=units,conditional={**{f'X{i}':'NOT_TRIGGERED' for i in range(4,7)},**{f'R{i}':'NOT_TRIGGERED' for i in range(1,7)}}),indent=2)+'\n')
print('FROZEN',len(units),'accepted units; no product evaluation')
