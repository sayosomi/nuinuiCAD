"""Pre-evaluation #1497 oracle. Standard-library matrix algebra and quadrature only.
No product imports or evaluator outputs; Y-up coordinates in millimeters.
"""
import copy
import hashlib
import json
import math
from pathlib import Path
ROOT = Path(__file__).parent
units = []
I = [[1,0,0],[0,1,0],[0,0,1]]
def mul(a,b): return [[sum(a[i][k]*b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]
def translate(p): return [[1,0,p[0]],[0,1,p[1]],[0,0,1]]
def affine(start,end,scale=1,angle=0,mirror=False):
    c,s=math.cos(math.radians(angle)),math.sin(math.radians(angle))
    r=[[scale*c,-scale*s,0],[scale*s,scale*c,0],[0,0,1]]
    f=[[-1 if mirror else 1,0,0],[0,1,0],[0,0,1]]
    return mul(translate(end),mul(r,mul(f,translate((-start[0],-start[1])))))
def reflection(a,b):
    dx,dy=b[0]-a[0],b[1]-a[1]; h=math.hypot(dx,dy); u,v=dx/h,dy/h
    q=[[2*u*u-1,2*u*v,0],[2*u*v,2*v*v-1,0],[0,0,1]]
    return mul(translate(a),mul(q,translate((-a[0],-a[1]))))
def pt(p): return dict(x=p[0],y=p[1])
def xy(p): return p['x'],p['y']
def apply(m,p): return pt([sum(m[i][k]*[p['x'],p['y'],1][k] for k in range(3)) for i in range(2)])
def line(a,b): return dict(kind='line',start=pt(a),end=pt(b))
def bezier(ps): return dict(kind='bezier',**dict(zip(['start','control1','control2','end'],map(pt,ps))))
def arc(c,r,a,sweep):
    polar=lambda t:(c[0]+r*math.cos(math.radians(t)),c[1]+r*math.sin(math.radians(t)))
    return dict(kind='arc',center=pt(c),radius=r,start=pt(polar(a)),end=pt(polar(a+sweep)),sweepAngleDeg=sweep)
def angle(v): return math.degrees(math.atan2(v[1],v[0]))%360

def measure(ss):
    total=0; tolerance=1e-7
    for s in ss:
        a,b=xy(s['start']),xy(s['end'])
        if s['kind']=='line': length=math.dist(a,b)
        elif s['kind']=='arc': length=s['radius']*abs(math.radians(s['sweepAngleDeg']))
        else:
            ps=[s[k] for k in ['start','control1','control2','end']]
            # Composite Simpson integration of the independent quadratic derivative.
            def speed(t):
                return math.hypot(*[3*((1-t)**2*(ps[1][k]-ps[0][k])+2*(1-t)*t*(ps[2][k]-ps[1][k])+t*t*(ps[3][k]-ps[2][k])) for k in ['x','y']])
            def integral(n): return (speed(0)+speed(1)+sum((4 if i%2 else 2)*speed(i/n) for i in range(1,n)))/(3*n)
            length=integral(8192)
            assert abs(length-integral(4096))<1e-9
            # Cubic length is contractually approximated by a 32-edge mesh.
            # Bound its chord error independently from the numerical integral.
            def casteljau(t):
                p=[xy(q) for q in ps]
                while len(p)>1: p=[tuple((1-t)*x+t*y for x,y in zip(a,b)) for a,b in zip(p,p[1:])]
                return p[0]
            mesh=sum(math.dist(casteljau(i/32),casteljau((i+1)/32)) for i in range(32))
            tolerance+=max(0,length-mesh)+1e-7
        s['length']=length; total+=length
    def tangent(s,end=False):
        if s['kind']=='arc':
            p,c=s['end' if end else 'start'],s['center']; v=(p['x']-c['x'],p['y']-c['y'])
            sign=1 if s['sweepAngleDeg']>0 else -1; v=(-sign*v[1],sign*v[0])
        else:
            a,b=(s['control2'],s['end']) if end and s['kind']=='bezier' else (s['start'],s['control1']) if s['kind']=='bezier' else (s['start'],s['end'])
            v=(b['x']-a['x'],b['y']-a['y'])
        return angle(tuple(-z for z in v) if end else v)
    return dict(kind='offsetLine',segments=ss,start=ss[0]['start'],end=ss[-1]['end'],closed=False,length=total,startTangentAngleDeg=tangent(ss[0]),endTangentAngleDeg=tangent(ss[-1],True),lengthTolerance=tolerance)
def transformed(ss,m):
    out=copy.deepcopy(ss); det=m[0][0]*m[1][1]-m[0][1]*m[1][0]
    for s in out:
        for k in ['start','end','control1','control2','center']:
            if k in s:s[k]=apply(m,s[k])
        if s['kind']=='arc': s['radius']*=math.sqrt(abs(det)); s['sweepAngleDeg']*=1 if det>0 else -1
    return measure(out)
def seg(name,a,b): return f'line {name} = segment(start: {a}, end: {b})\n'
def cubic(name,ps):
    p,a,b,q=ps; v=(a[0]-p[0],a[1]-p[1]); w=(q[0]-b[0],q[1]-b[1])
    return f'curve {name} = bezier(start: {p}, end: {q}, startAngle: {angle(v)}, startLength: {math.hypot(*v)}, endAngle: {angle(w)}, endLength: {math.hypot(*w)})\n'
def arcsrc(name,c,r,a,b,cw=False):return f'arc {name} = arc(center: {c}, radius: {r}, start: {a}, end: {b}, direction: {"clockwise" if cw else "counterclockwise"})\n'
def cp(name,refs,start=(7,-4),end=(-11,23),scale=1,angle=0,mirror=False,pure=False):
    return f'{"const "+name+": path" if pure else "line "+name} = transformCopy(startPoint: {start}, endPoint: {end}, scale: {scale}, angleDeg: {angle}, mirrorX: {str(mirror).lower()}, baseLines: [{", ".join("@"+r for r in refs)}])\n'
def mir(name,refs,a=(5,-3),b=(12,8),pure=False): return f'{"const "+name+": path" if pure else "line "+name} = mirrorCopy(axis1: {a}, axis2: {b}, baseLines: [{", ".join("@"+r for r in refs)}])\n'
CONTROL=seg('Control',(201,-103),(238,-103))
def seal(id,body,inputs,outputs,matrices,**extra):
    body=body.replace('6e-06','0.000006').replace('8e-06','0.000008')
    s='nui 1\n// #1497 '+id+'; independently frozen before product evaluation\n'+body+CONTROL
    (ROOT/(id+'.nui')).write_text(s)
    unit=dict(id=id,file=id+'.nui',sha256=hashlib.sha256(s.encode()).hexdigest(),sourcePrimitives=inputs,matrices=matrices,expected=outputs,**extra)
    if 'editBody' in unit:
        e='nui 1\n// #1497 '+id+'; frozen legal recovery checkpoint\n'+unit.pop('editBody')+CONTROL
        file=id+'-recovered.nui';(ROOT/file).write_text(e)
        unit['edit']=dict(file=file,sha256=hashlib.sha256(e.encode()).hexdigest(),expected=unit.pop('editExpected'),errors={},pureErrors={})
    units.append(unit)
ps=[(2,3),(8,19),(24,-7),(31,11)]; B=[bezier(ps)]; bs=cubic('B',ps)
L=[line((3,5),(18,-2)),line((18,-2),(27,16))]; ls=seg('L0',(3,5),(18,-2))+seg('L1',(18,-2),(27,16))
m=affine((7,-4),(-11,23));seal('T1',ls+cp('Copy',['L0','L1']),L,{'Copy':transformed(L,m)},[m])
m=affine((7,-4),(-11,23),1.7,37);seal('T2',bs+cp('Copy',['B'],scale=1.7,angle=37),B,{'Copy':transformed(B,m)},[m])
A=[arc((4,-2),13,327,81)]; ars=arcsrc('A',(4,-2),13,327,48)
m=affine((7,-4),(-11,23),1.3,29,True);seal('T3',ars+cp('Copy',['A'],scale=1.3,angle=29,mirror=True),A,{'Copy':transformed(A,m)},[m])
m1=affine((7,-4),(-11,23),1.2,31,True);m2=affine((-11,23),(7,-4),1.2,-31,True)
seal('T4',bs+cp('Copy',['B'],scale=1.2,angle=31,mirror=True)+cp('Other',['B'],start=(-11,23),end=(7,-4),scale=1.2,angle=-31,mirror=True),B,{'Copy':transformed(B,m1),'Other':transformed(B,m2)},[m1,m2])
m=reflection((9,-7),(9,14));seal('M1',bs+mir('Copy',['B'],(9,-7),(9,14)),B,{'Copy':transformed(B,m)},[m])
A2=[arc((6,2),17,21,-108)];a2=arcsrc('A',(6,2),17,21,273,True)
m=reflection((5,-3),(12,8));seal('M2',a2+mir('Copy',['A']),A2,{'Copy':transformed(A2,m)},[m])
seal('M3',bs+mir('Once',['B'],pure=True)+mir('Copy',['Once']),B,{'Once':transformed(B,m),'Copy':transformed(B,mul(m,m))},[m,mul(m,m)],pure=['Once'])
# Two axes through (5,-3), directions (1,0) and (3,4): rotation 2*atan2(4,3).
r1=reflection((5,-3),(8,-3));r2=reflection((5,-3),(8,1)); prod=mul(r2,r1)
seal('M4',ars+mir('First',['A'],(5,-3),(8,-3))+mir('Copy',['First'],(5,-3),(8,1)),A,{'First':transformed(A,r1),'Copy':transformed(A,prod)},[r1,r2,prod],rotationDeg=2*math.degrees(math.atan2(4,3)))
# Continuous line -> quarter circle -> asymmetric cubic, explicit authored order.
P=[line((-9,-2),(4,-2)),arc((4,8),10,270,90),bezier([(14,8),(20,17),(25,0),(33,12)])]
pbody=seg('L',(-9,-2),(4,-2))+arcsrc('A',(4,8),10,270,0)+cubic('B',[(14,8),(20,17),(25,0),(33,12)])
m=affine((7,-4),(-11,23),1.4,23,True)
seal('P1',pbody+cp('Copy',['L','A','B'],scale=1.4,angle=23,mirror=True),P,{'Copy':transformed(P,m)},[m])
# Straight cubic is an exact parallel-offset control for #1495's signed-side repair.
ops=[(3,5),(43/3,5),(89/3,5),(43,5)]; final=[bezier([(x,y-3) for x,y in ops])]
# Exact scalar source x(t)=3+34t+12t²-6t³, y=5. The documented fitter's
# 0.1 mm sampling tolerance splits the collinear curve; parallel tangents
# force chord/3 handles. Determine partitions from the polynomial, no outputs.
def offset_straight(t0=0,t1=1):
    f=lambda t:3+34*t+12*t*t-6*t*t*t
    x0,x1=f(t0),f(t1)
    error=max(abs(f(t0+(t1-t0)*u)-(x0+(x1-x0)*u)) for u in [.25,.5,.75])
    if error>0.1:return offset_straight(t0,(t0+t1)/2)+offset_straight((t0+t1)/2,t1)
    return [bezier([(x0,2),(x0+(x1-x0)/3,2),(x1-(x1-x0)/3,2),(x1,2)])]
final=offset_straight()
body=cubic('B',ops)+'line Seam = offset(sources: [@B], distance: 3, side: right)\n'
seal('P2',body+cp('Copy',['Seam'],scale=1.7,angle=37)+mir('Mirror',['Seam']),[bezier(ops)],{'Seam':transformed(final,I),'Copy':transformed(final,affine((7,-4),(-11,23),1.7,37)),'Mirror':transformed(final,reflection((5,-3),(12,8)))},[affine((7,-4),(-11,23),1.7,37),reflection((5,-3),(12,8))],known1495Control=True)
body='const Poly: path = polyline(points: [(3,5), (18,-2), (27,16)])\nconst Nested: path = join(paths: [@Poly])\n'
seal('P3',body+cp('Copy',['Nested'],scale=0.8,angle=-41),L,{'Copy':transformed(L,affine((7,-4),(-11,23),0.8,-41))},[affine((7,-4),(-11,23),0.8,-41)],pure=['Poly','Nested'])
bad=ls.replace('start: (18, -2)','start: (19, -2)')+cp('Copy',['L0','L1'])
seal('P4',bad,[L[0],line((19,-2),(27,16))],{},[affine((7,-4),(-11,23))],errors={'Copy':'reverse'},editBody=ls+cp('Copy',['L0','L1']),editExpected={'Copy':transformed(L,affine((7,-4),(-11,23)))})
m=affine((7,-4),(-11,23),1.7,37,True);r=reflection((5,-3),(12,8))
seal('V1',bs+cp('Copy',['B'],scale=1.7,angle=37,mirror=True)+cp('Pure',['B'],scale=1.7,angle=37,mirror=True,pure=True)+mir('Mirror',['B'])+mir('PureMirror',['B'],pure=True),B,{'Copy':transformed(B,m),'Pure':transformed(B,m),'Mirror':transformed(B,r),'PureMirror':transformed(B,r)},[m,r],pure=['Pure','PureMirror'])
body='module Pattern(s: number, a: number, flip: boolean) {\n'+bs+'export '+cp('Copy',['B'],scale='@s',angle='@a',mirror=False).replace('mirrorX: false','mirrorX: @flip')+'export '+cp('Pure',['B'],scale='@s',angle='@a',pure=True).replace('mirrorX: false','mirrorX: @flip')+'}\ninstance First = Pattern(s: 1.3, a: 27, flip: true)\ninstance Second = Pattern(s: 0.7, a: -19, flip: false)\n'
m1=affine((7,-4),(-11,23),1.3,27,True);m2=affine((7,-4),(-11,23),0.7,-19)
body=body.replace('curve B =', 'point Anchor = coordinate(x: 7, y: -4)\npoint Destination = coordinate(x: -11, y: 23)\ncurve B =').replace('startPoint: (7, -4), endPoint: (-11, 23)', 'startPoint: @Anchor, endPoint: @Destination')
seal('V2',body,B,{'First::Copy':transformed(B,m1),'Second::Copy':transformed(B,m2),'First::Pure':transformed(B,m1),'Second::Pure':transformed(B,m2)},[m1,m2],pure=['First::Pure','Second::Pure'])
m=affine((7,-4),(-11,23),2,37,True);vv=transformed([L[0]],m)
body=seg('L0',(3,5),(18,-2))+cp('Copy',['L0'],scale=2,angle=37,mirror=True)+cp('Pure',['L0'],scale=2,angle=37,mirror=True,pure=True)
for name in ['Copy','Pure']:
 body+=f'point {name}At = onLine(from: @{name}.start, ratio: 0.25)\npoint {name}Read = coordinate(x: @{name}.length, y: @{name}.startAngleDeg)\npoint {name}End = coordinate(x: @{name}.endPoint.x, y: @{name}.endAngleDeg)\n'
expected={name:vv for name in ['Copy','Pure']}
for name in ['Copy','Pure']:
 expected[name+'At']={k:vv['start'][k]+0.25*(vv['end'][k]-vv['start'][k]) for k in ['x','y']}
 expected[name+'Read']=dict(x=vv['length'],y=vv['startTangentAngleDeg']);expected[name+'End']=dict(x=vv['end']['x'],y=vv['endTangentAngleDeg'])
seal('V3',body,[L[0]],expected,[m],pure=['Pure'],unchanged={'L0':dict(start=pt((3,5)),end=pt((18,-2)))})
body=ls+cp('Zero',['L0'],scale=0)+cp('Negative',['L0'],scale=-2,pure=True)+mir('Axis',['L0'],(2,4),(2,4))+mir('PureAxis',['L0'],(2,4),(2,4),pure=True)+cp('Broken',['L0','L1'])
bad=body.replace('start: (18, -2)','start: (19, -2)')
fixed=body.replace('scale: 0','scale: 1').replace('scale: -2','scale: 1').replace('axis2: (2, 4)','axis2: (2, 5)')
ex={'Zero':transformed([L[0]],affine((7,-4),(-11,23))),'Negative':transformed([L[0]],affine((7,-4),(-11,23))),'Axis':transformed([L[0]],reflection((2,4),(2,5))),'PureAxis':transformed([L[0]],reflection((2,4),(2,5))),'Broken':transformed(L,affine((7,-4),(-11,23)))}
seal('V4',bad,[L[0],line((19,-2),(27,16))],{},[],errors={'Zero':'0','Axis':'同じ点','Broken':'reverse'},pureErrors={'Negative':'finite positive','PureAxis':'distinct axis points'},editBody=fixed,editExpected=ex)
# X1 is motivated by observed source inconsistency: Reflect::apply compares a
# squared axis length with linear EPSILON, although reflect() admits length>EPSILON.
r=reflection((5,-3),(5.000006,-2.999992))
seal('X1',bs+mir('Copy',['B'],(5,-3),(5.000006,-2.999992))+mir('Pure',['B'],(5,-3),(5.000006,-2.999992),True),B,{'Copy':transformed(B,r),'Pure':transformed(B,r)},[r],pure=['Pure'],activation='Independent source inspection: squared-length threshold disagrees with axis constructor; 1e-5 mm axis is 10000x length epsilon.')
# X3 completes M4's sensitive cubic-handle discriminator with the mixed
# line/arc/cubic chain; arc-only M4 cannot detect a control-point composition bug.
rr1=reflection((5,-3),(8,-3));rr2=reflection((5,-3),(8,1));rr=mul(rr2,rr1)
seal('X3',pbody+mir('First',['L','A','B'],(5,-3),(8,-3))+mir('Copy',['First'],(5,-3),(8,1)),P,{'First':transformed(P,rr1),'Copy':transformed(P,rr)},[rr1,rr2,rr],activation='Primary M4 has arc sweep restoration; add the missing cubic-handle/nonparallel-axis composition discriminator required by its contract.')
# X2: V3 proved the canonical endpoint subset was missing. Exercise all four
# coordinates on both pure copy forms, plus their typed scalar consumers.
one=[line((1,2),(4,6))];m=affine((0,0),(7,-2),1.5,37,True);r=reflection((5,-3),(12,8))
body=seg('L',(1,2),(4,6))+cp('Pure',['L'],start=(0,0),end=(7,-2),scale=1.5,angle=37,mirror=True,pure=True)+mir('Reflected',['L'],pure=True)
ex={}
for name,matrix in [('Pure',m),('Reflected',r)]:
 v=transformed(one,matrix);ex[name]=v
 body+=f'point {name}Start = coordinate(x: @{name}.startPoint.x, y: @{name}.startPoint.y)\npoint {name}End = coordinate(x: @{name}.endPoint.x, y: @{name}.endPoint.y)\nconst {name}X: number = @{name}.endPoint.x\npoint {name}Scalar = coordinate(x: @{name}X, y: 0)\n'
 ex[name+'Start']=v['start'];ex[name+'End']=v['end'];ex[name+'Scalar']={'x':v['end']['x'],'y':0}
seal('X2',body,one,ex,[m,r],pure=['Pure','Reflected'],activation='V3/R2 confirm missing canonical endpoint-property subset. Cover all four coordinates and typed scalar reads for both pure copy forms.')
# Minimal legal discriminators frozen before their first evaluation.
r=reflection((0,0),(0.000006,0.000008)); one=[line((1,2),(4,6))]
seal('R1',seg('L',(1,2),(4,6))+mir('Copy',['L'],(0,0),(0.000006,0.000008))+mir('Pure',['L'],(0,0),(0.000006,0.000008),True),one,{'Copy':transformed(one,r),'Pure':transformed(one,r)},[r],pure=['Pure'],activation='Minimizes X1 to one directed line, short oblique axis, drawable and pure occurrence.')
m=affine((0,0),(0,0)); v=transformed(one,m)
seal('R2',seg('L',(1,2),(4,6))+cp('Pure',['L'],start=(0,0),end=(0,0),pure=True)+'point Read = coordinate(x: @Pure.endPoint.x, y: @Pure.endAngleDeg)\npoint Neighbor = coordinate(x: @Pure.length, y: @Pure.startAngleDeg)\n',one,{'Pure':v,'Read':{'x':4,'y':(math.degrees(math.atan2(4,3))+180)%360},'Neighbor':{'x':5,'y':math.degrees(math.atan2(4,3))}},[m],pure=['Pure'],activation='Minimizes V3 pure transform endpoint property failure while retaining length/angle neighbor.')
(ROOT/'manifest.json').write_text(json.dumps(dict(base='b29186a6a8f48d35f60ab6adb334a3defe7d4a6a',coordinateTolerance=1e-7,lengthMethod='Simpson 8192, convergence 4096 <1e-9; integral-to-independent-32-edge chord gap +1e-7 per cubic',units=units),indent=2)+'\n')
print('SEALED',len(units),'units before evaluation')
