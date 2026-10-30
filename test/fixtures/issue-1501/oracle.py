"""Independent #1501 input/oracle freeze. No product imports or observations.

Lengths use composite Simpson quadrature at 8192 and 16384 intervals.
Cubic length tolerances use rigorous 32-subdivision chord/control-polygon
bounds, rather than treating a sampled chord estimate as an exact length.
"""
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).parent
BASE = '0c82168872543bda24bbbf3faccd65f7619e67cc'
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
                lengthTolerance=sum(p[2]['upper']-p[2]['lower'] for p in parts)+1e-7)


def declaration(c, name='Source'):
    return f'curve {name} = bezier(start: {tuple(c[0])}, end: {tuple(c[3])}, startAngle: {angle(c[0],c[1])}, startLength: {dist(c[0],c[1])}, endAngle: {angle(c[2],c[3])}, endLength: {dist(c[2],c[3])})'


def write_source(id, text):
    file = id+'.nui'
    source = f'nui 1\n// #1501 {id}: frozen independently before product execution\n'+text+'\nline Control = segment(start: (201, -103), end: (238, -103))\n'
    (ROOT/file).write_text(source)
    return dict(file=file, sha256=hashlib.sha256(source.encode()).hexdigest())


def add(id, text, expected, evidence, **kwargs):
    u = dict(id=id, **write_source(id, text), expected=expected, evidence=evidence, **kwargs)
    units.append(u)
    return u


a, b = (3, 7), (99, 79)
q = lerp(a, b, .37)
add('S1', f'line Source = segment(start: {a}, end: {b})\npoint Cut = coordinate(x: {q[0]}, y: {q[1]})\nline Far = split(source: @Source, at: @Cut)',
    dict(Source=line(a,q), Far=line(q,b), Cut=xy(q)), dict(authored=[a,b], parameter=.37, station=44.4), partitions=[['Source','Far']])
q = lerp(a,b,.31)
add('S2', f'''line Source = segment(start: {a}, end: {b})
point StartRatio = onLine(from: @Source.start, ratio: 0.31)
point EndRatio = onLine(from: @Source.end, ratio: 0.69)
point StartDistance = onLine(from: @Source.start, distance: 37.2)
point EndDistance = onLine(from: @Source.end, distance: 82.8)
point Zero = onLine(from: @Source.end, ratio: 0)
point One = onLine(from: @Source.end, ratio: 1)
line Far = split(source: @Source, at: @StartRatio)''',
    dict(Source=line(a,q),Far=line(q,b),**{n:xy(q) for n in ['StartRatio','EndRatio','StartDistance','EndDistance']},Zero=xy(b),One=xy(a)),dict(authored=[a,b],length=120,parameter=.31), partitions=[['Source','Far']])
ps=[(2,3),(32,3),(32,83),(92,83)]; q=(32,34)
def poly(points):
    return dict(kind='polyline', segments=[line(a,b) for a,b in zip(points,points[1:])], start=xy(points[0]),end=xy(points[-1]),length=sum(dist(a,b) for a,b in zip(points,points[1:])))
add('S3', f'''line Source = polyline(points: {ps}, closed: false)
line Reversed = polyline(points: {list(reversed(ps))}, closed: false)
point Cut = onLine(from: @Source.start, distance: 61)
line Far = split(source: @Source, at: @Cut)
line BackFar = split(source: @Reversed, at: @Cut)''',
    dict(Source=poly(ps[:2]+[q]),Far=poly([q]+ps[2:]),Reversed=poly(list(reversed(ps[2:]))+[q]),BackFar=poly([q]+list(reversed(ps[:2]))),Cut=xy(q)),dict(authored=ps,station=61,totalLength=170),partitions=[['Source','Far'],['Reversed','BackFar']])
def guard(y,x):
    return f'line Source = segment(start: (0, 0), end: (80, 0))\npoint Cut = coordinate(x: {x}, y: {y})\nline Far = split(source: @Source, at: @Cut)'
u=add('S4',guard(2,27),dict(Source=line((0,0),(80,0))),dict(offPathDistance=2,endpointGuardMm=.001),errors={'Far':'基準線上にありません'})
u['revisions']=[]
for suffix,x,expected,error in [('endpoint',0,dict(Source=line((0,0),(80,0))),'端点'),('near',.0001,dict(Source=line((0,0),(80,0))),'端点'),('valid',27,dict(Source=line((0,0),(27,0)),Far=line((27,0),(80,0))),None)]:
    u['revisions'].append(dict(**write_source('S4-'+suffix,guard(0,x)),expected=expected,errors={'Far':error} if error else {}, partitions=[['Source','Far']] if not error else []))

c=(11,-9);r=43;a=317;s=128;f=.37;g=arc(c,r,a,s);q=arc(c,r,a,s*f)['end']
def arcsrc(start,end,direction='counterclockwise',name='Source'):
    return f'arc {name} = arc(center: {c}, radius: {r}, start: {start}, end: {end}, direction: {direction})'
add('A1',arcsrc(a,a+s)+f'\npoint Cut = onLine(from: @Source.start, ratio: {f})\nline Far = split(source: @Source, at: @Cut)',
    dict(Source=arc(c,r,a,s*f),Far=arc(c,r,a+s*f,s*(1-f)),Cut=q),dict(center=c,radius=r,start=a,sweep=s,ratio=f,totalLength=g['length']),partitions=[['Source','Far']])
add('A2',arcsrc(a+s,a,'clockwise')+f'''\npoint Cut = onLine(from: @Source.start, ratio: {1-f})
point OtherEnd = onLine(from: @Source.end, distance: {g['length']*f})
line Far = split(source: @Source, at: @Cut)''',
    dict(Source=arc(c,r,a+s,-s*(1-f)),Far=arc(c,r,a+s*f,-s*f),Cut=q,OtherEnd=q),dict(center=c,radius=r,start=a+s,sweep=-s,physicalLocus='A1 reversed'),partitions=[['Source','Far']])
def mixed(suffix=''):
    return '''line Lead = segment(start: (-25, 0), end: (0, 0))
arc Bend = arc(center: (0, 30), radius: 30, start: 270, end: 360)
line Tail = segment(start: (30, 30), end: (90, 30))'''+suffix
ac=arc((0,30),30,270,90);half=arc((0,30),30,270,54);q=tuple(half['end'].values())
def segarc(g):
    return {k:v for k,v in g.items() if k not in ['startTangentAngleDeg','endTangentAngleDeg']} | {'kind':'arc'}
add('A3',mixed()+f'''\nline Source = join(paths: [@Lead, @Bend, @Tail], closed: false)
point Cut = onLine(from: @Source.start, distance: {25+30*math.radians(54)})
point AfterArc = onLine(from: @Source.start, distance: {25+30*math.pi/2+17})
point Back = onLine(from: @Source.end, distance: 43)
line Far = split(source: @Source, at: @Cut)''',
    dict(Cut=xy(q),AfterArc=xy((47,30)),Back=xy((47,30)),Source=dict(kind='joinedPath',segments=[line((-25,0),(0,0)),segarc(half)],length=25+half['length']),Far=dict(kind='joinedPath',segments=[segarc(arc((0,30),30,324,36)),line((30,30),(90,30))],length=30*math.radians(36)+60)),dict(totalLength=25+30*math.pi/2+60,arcStation=25+30*math.radians(54)),partitions=[['Source','Far']])
add('A4',arcsrc(a,a+s)+f'''\nmove Source as shifted(from: (0, 0), to: (17, -23))
const Selected: path = @Source.base
const Alternate: path = @Source.shifted
point Cut = onLine(from: @Selected.start, ratio: {f})
line Far = split(source: @Source.base, at: @Cut)''',
    dict(Source=arc(c,r,a,s*f),Far=arc(c,r,a+s*f,s*(1-f)),Cut=arc(c,r,a,s*f)['end'],Selected=g,Alternate=arc((28,-32),r,a,s)),dict(selectedStage='base',ownerFinalTranslation=[17,-23],ratio=f),pure=['Selected','Alternate'],partitions=[['Source','Far']])

c1=[(4,-7),(31,106),(87,-58),(143,26)]
c2=[(-11,4),(-5,153),(146,-119),(167,31)]
for id,cs,t,extra in [('B1',c1,.371,''),('B2',c2,.437,''),('B4',list(reversed(c1)),.629,'\nreverse Source ()')]:
    authored=c1 if id=='B4' else cs
    left,right=casteljau(cs,t); q=bernstein(cs,t)
    text=declaration(authored)+extra+f'\npoint Cut = coordinate(x: {q[0]}, y: {q[1]})'
    expected=dict(Source=curve([left]),Far=curve([right]),Cut=xy(q))
    if id=='B2':
        full=integral(cs,16384); near=integral(left,16384); bd=bounds(cs)
        tolerance=2*bd['deviation']+2*(bd['upper']-bd['lower'])+1e-7
        text+=f'\npoint Station = onLine(from: @Source.start, distance: {near})\npoint BackStation = onLine(from: @Source.end, distance: {full-near})'
        expected.update(Station=xy(q)|dict(coordinateTolerance=tolerance),BackStation=xy(q)|dict(coordinateTolerance=tolerance))
    text+='\nline Far = split(source: @Source, at: @Cut)'
    add(id,text,expected,dict(authored=authored,directedControls=cs,parameter=t,station=integral(left,16384),totalLength=integral(cs,16384),bounds=bounds(cs),derivativeDirection=angle(left[2],left[3])),input={'Source':curve([cs])},partitions=[['Source','Far']])

cs1=[(0,0),(20,45),(45,30),(65,30)];cs2=[(65,30),(90,30),(112,-35),(157,12)]; t=.413
left,right=casteljau(cs2,t);q=bernstein(cs2,t)
add('B3',f'''point Join = coordinate(x: 65, y: 30)
curve Source = bezier(start: (0, 0), end: (157, 12), startAngle: {angle(cs1[0],cs1[1])}, startLength: {dist(cs1[0],cs1[1])}, endAngle: {angle(cs2[2],cs2[3])}, endLength: {dist(cs2[2],cs2[3])}, intermediates: [@Join: 0: 20: 25: seam])
point Cut = coordinate(x: {q[0]}, y: {q[1]})
line Far = split(source: @Source, at: @Cut)''',dict(Source=curve([cs1,left]),Far=curve([right]),Cut=xy(q)),dict(authored=[cs1,cs2],segmentIndex=1,parameter=t,station=integral(cs1,16384)+integral(left,16384)),partitions=[['Source','Far']],slots={'Source':1,'Far':0})

# Offset input chosen with tangent-continuous line/arc/straight-cubic pieces.
# The cubic is geometrically straight; fitter subdivision is an input detail.
# Its fitted controls are checked by independent de Casteljau, while its physical
# offset locus, length and station remain independently analytic.
P1text=mixed().replace('line Tail = segment(start: (30, 30), end: (90, 30))','curve Tail = bezier(start: (30, 30), end: (30, 100), startAngle: 90, startLength: 20, endAngle: 90, endLength: 25)')
q=(30,30)
# right offset of the upward tangent at arc end increases radius to 35.
qa=(35,65)
add('P1',P1text+'''\nline Source = offset(sources: [@Lead, @Bend, @Tail], distance: 5, side: right, closed: false)
point Cut = onLine(from: @Source.end, distance: 35)
line Far = split(source: @Source, at: @Cut)''',dict(Cut=xy(qa),Source=dict(kind='offsetLine',start=xy((-25,-5)),end=xy(qa),length=25+35*math.pi/2+35),Far=dict(kind='offsetLine',start=xy(qa),end=xy((35,100)),length=35),Bend=ac),dict(offset='right 5; tangent joins; radius 35; collinear cubic tail',sourceSegments=['line','arc','bezier'],station=25+35*math.pi/2+35,totalLength=25+35*math.pi/2+70,tailLine=[(35,30),(35,100)]),partitions=[['Source','Far']])
q=lerp((3,7),b,.43)
add('P2',f'''line Source = segment(start: (3, 7), end: {b})
const Pure: point = onLine(from: @Source.end, ratio: 0.57)
point Cut = onLine(from: @Source.start, distance: 51.6)
point UsePure = offset(from: @Pure, dx: 3, dy: -2)
line Far = split(source: @Source, at: @Cut)''',dict(Pure=xy(q),Cut=xy(q),UsePure=xy((q[0]+3,q[1]-2)),Source=line((3,7),q),Far=line(q,b)),dict(authored=[(3,7),b],station=51.6,pureIdentity='occurrence only'),pure=['Pure'],partitions=[['Source','Far']])
expected={}
for name,dx,dy,length in [('First',7,-4,83),('Second',-19,23,137)]:
    aa=(dx,dy);bb=(dx+length,dy);qq=(dx+.37*length,dy)
    expected.update({name+'::Source':line(aa,qq),name+'::Far':line(qq,bb),name+'::Cut':xy(qq),name+'::UseFar':xy((qq[0]+.4*(bb[0]-qq[0]),dy))})
add('P3','''module Panel(dx: number, dy: number, width: number) {
export line Source = segment(start: (@dx, @dy), end: (@dx + @width, @dy))
point Cut = onLine(from: @Source.start, ratio: 0.37)
export line Far = split(source: @Source, at: @Cut)
export point UseFar = onLine(from: @Far.start, ratio: 0.4)
}
instance First = Panel(dx: 7, dy: -4, width: 83)
instance Second = Panel(dx: -19, dy: 23, width: 137)''',expected,dict(instances=[dict(dx=7,dy=-4,width=83),dict(dx=-19,dy=23,width=137)]),partitions=[['First::Source','First::Far'],['Second::Source','Second::Far']])

# Same legal unit, dimension revision: preserve the first Module and all IDs.
u = next(u for u in units if u['id'] == 'P3')
text = (ROOT/u['file']).read_text().split('// #1501 P3: frozen independently before product execution\n', 1)[1].rsplit('\nline Control', 1)[0]
text = text.replace('width: 137)', 'width: 173)')
expected = dict(u['expected'])
aa, bb, qq = (-19,23), (154,23), (-19+.37*173,23)
expected.update({'Second::Source':line(aa,qq),'Second::Far':line(qq,bb),'Second::Cut':xy(qq),'Second::UseFar':xy((qq[0]+.4*(bb[0]-qq[0]),23))})
u['revisions'] = [dict(**write_source('P3-edited',text), expected=expected, errors={})]


def panel(width):
    text=f'''const Width: number = {width}
group Front {{
line FrontSeam = segment(start: (10, -20), end: (10 + @Width, -20))
line Crossing = segment(start: (47, -51), end: (47, 19))
point Hit = intersection(line1: @FrontSeam, line2: @Crossing)
}}
group Back {{
line BackSeam = split(source: @Front::FrontSeam, at: @Front::Hit)
line CopiedSeam = transformCopy(startPoint: @BackSeam.start, endPoint: (180, -70), angleDeg: 90, scale: 1, mirrorX: false, baseLines: [@BackSeam])
line Allowance = offset(sources: [@CopiedSeam], distance: 5, side: right, closed: false)
point Notch = onLine(from: @CopiedSeam.end, distance: 13)
}}'''
    far=width-37
    return text,dict(FrontSeam=line((10,-20),(47,-20)),BackSeam=line((47,-20),(10+width,-20)),Hit=xy((47,-20)),Crossing=line((47,-51),(47,19)),CopiedSeam=dict(start=xy((180,-70)),end=xy((180,-70+far)),length=far),Allowance=dict(start=xy((185,-70)),end=xy((185,-70+far)),length=far),Notch=xy((180,-70+far-13)))
text,expected=panel(123)
u=add('P4',text,expected,dict(neighborhood='nui1-seam-allowance-copy: two source-backed panels; exact intersection -> split -> transform/offset',intersection=[47,-20],edit='Width 123 -> 159; Front near/Crossing/Hit/Control unchanged'),partitions=[['FrontSeam','BackSeam']])
text,expected=panel(159)
u['revisions']=[dict(**write_source('P4-edited',text),expected=expected,errors={})]

assert len(units)==16
manifest=dict(base=BASE,coordinateTolerance=1e-6,lengthTolerance=1e-6,units=units,
              budget=dict(primary=16,X=0,R=0,maximum=28,unused='NOT_TRIGGERED'),
              oracle='Euclidean lines; analytic directed arcs; Bernstein/de Casteljau and Simpson 8192/16384 with chord/control-polygon length bounds. No product execution or imports.')
(ROOT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Frozen',len(units),'primary units; no product execution')
