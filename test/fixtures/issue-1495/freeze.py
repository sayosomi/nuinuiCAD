"""Independent, pre-execution mathematical oracles for #1495 (stdlib only).

No production geometry imports. Distances are mm, coordinates Y-up. Re-running
this generator must reproduce the sealed source bytes and oracle manifest.
"""
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).parent
units = []
CONTROL = 'line Control = segment(start: (201, -103), end: (238, -103))\nline ControlOffset = offset(sources: [@Control], distance: 7, side: right)\n'

def pt(p):
    return {'x': p[0], 'y': p[1]}

def add(a, b):
    return tuple(x+y for x,y in zip(a,b))

def sub(a,b):
    return tuple(x-y for x,y in zip(a,b))

def norm(a):
    return math.hypot(*a)

def cross(a,b):
    return a[0]*b[1]-a[1]*b[0]

def right(p,v,d):
    return add(p,(d*v[1]/norm(v),-d*v[0]/norm(v)))

def line(a,b):
    return {'kind':'line','start':pt(a),'end':pt(b)}

def intersection(a,b,c,d):
    v,w = sub(b,a),sub(d,c)
    t=cross(sub(c,a),w)/cross(v,w)
    return add(a,(t*v[0],t*v[1]))

def polygon(points,d,closed=False):
    raw=[(right(a,sub(b,a),d),right(b,sub(b,a),d)) for a,b in zip(points,points[1:])]
    out=[list(s) for s in raw]
    for i in range(len(raw) if closed else len(raw)-1):
        j=(i+1)%len(raw)
        p=intersection(*raw[i],*raw[j])
        out[i][1]=out[j][0]=p
    return [line(*s) for s in out]

def chain(points,names=None):
    return ''.join(f'line {(names or ["S"+str(j) for j in range(len(points))])[i]} = segment(start: {a}, end: {b})\n' for i,(a,b) in enumerate(zip(points,points[1:])))

def off(names,d,side='right',name='Seam',closed=False,suppress=False,pure=False):
    return f'{"const "+name+": path" if pure else "line "+name} = offset(sources: [{", ".join("@"+n for n in names)}], distance: {d}, side: {side}, closed: {str(closed).lower()}, suppressTrimWarnings: {str(suppress).lower()})\n'

def seal(id,body,expected,inputs,rationale,**extra):
    source='nui 1\n// #1495 '+id+'; sealed before production evaluation\n'+body+CONTROL
    file=id+'.nui'
    (ROOT/file).write_text(source)
    units.append(dict(id=id,file=file,sha256=hashlib.sha256(source.encode()).hexdigest(),expected=expected,inputs=inputs,rationale=rationale,**extra))

points=[(3,5),(43,5),(43,32)]
seal('L1',chain(points)+off(['S0','S1'],3),{'Seam':{'segments':polygon(points,3)}},points,'Right normals (0,-3),(3,0); infinite-line miter (46,2).')
seal('L2',chain(points)+'reverse S0 ()\nreverse S1 ()\n'+off(['S1','S0'],3,'left'),{'Seam':{'segments':polygon(list(reversed(points)),-3)}},list(reversed(points)),'Reverse both directed owners and authored order; left swaps the normal and reverses the same physical locus.')
rect=[(3,5),(43,5),(43,32),(3,32),(3,5)]
seal('L3',chain(rect)+off(['S0','S1','S2','S3'],4,closed=True),{'Seam':{'segments':polygon(rect,4,True),'closed':True}},rect,'Non-square CCW rectangle expands to x=-1..47,y=1..36; perimeter=166.')
oblique=[(-32,-11),(7,2),(36,48)]
near=[(80,3),(130,3),(180,4)]
seal('L4',chain(oblique)+off(['S0','S1'],2)+chain(near,['N0','N1'])+off(['N0','N1'],3,name='Near'),{'Seam':{'segments':polygon(oblique,2)},'Near':{'segments':polygon(near,3)}},[oblique,near],'Cross-product analytic miters; near-parallel denominator=50, far above 1e-9, forward turn only ~1.146 degrees.')

def arc(c,r,a,b,cw=False):
    return f'arc Arc = arc(center: {c}, radius: {r}, start: {a}, end: {b}, direction: {"clockwise" if cw else "counterclockwise"})\n'

def circle_line(c,r,a,b,near):
    # Orthogonal projection onto the infinite line, then +/- chord half-length.
    v=sub(b,a); u=tuple(x/norm(v) for x in v)
    s=sum(x*y for x,y in zip(sub(c,a),u)); foot=add(a,tuple(s*x for x in u))
    h=math.sqrt(r*r-norm(sub(foot,c))**2)
    roots=[add(foot,tuple(sign*h*x for x in u)) for sign in [1,-1]]
    return min(roots,key=lambda p:norm(sub(p,near))),roots

def arc_expected(c,r,a,b):
    return {'kind':'arc','center':pt(c),'radius':r,'start':pt(a),'end':pt(b)}

a,b=(-30,-20),(0,0); d=3
la,lb=right(a,sub(b,a),d),right(b,sub(b,a),d)
j,roots=circle_line((0,20),23,la,lb,b)
mixed=chain([a,b])+arc((0,20),20,270,0)
seal('A1',mixed+off(['S0','Arc'],d),{'Seam':{'segments':[line(la,j),arc_expected((0,20),23,j,(23,20))]}},[a,b,{'center':[0,20],'radius':20,'angles':[270,360]},roots],'Projection/chord line-circle roots; unique root nearest authored junction.')
# Clockwise arc ending at (20,20), line goes southeast; left side shrinks? CW left is outward.
c=(20,0); a,b=(20,20),(52,4); d=-2
la,lb=right(a,sub(b,a),d),right(b,sub(b,a),d)
j,roots=circle_line(c,22,la,lb,a)
body=arc(c,20,180,90,True)+chain([a,b])
seal('A2',body+off(['Arc','S0'],2,'left')+'reverse Arc ()\nreverse S0 ()\n'+off(['S0','Arc'],2,'right',name='Reversed'),{'Seam':{'segments':[arc_expected(c,22,(-2,0),j),line(j,lb)]},'Reversed':{'segments':[line(lb,j),arc_expected(c,22,j,(-2,0))]}},[{'center':c,'radius':20,'angles':[180,90]},a,b,roots],'CW outward left radius=22; reversed right same locus. Seam uses base snapshots to avoid final-state recipe dependency.',)
# Explicit base reads preserve original arc/line direction for first result.
units[-1]['note']='Seam reads .base; Reversed reads final.'
p=ROOT/'A2.nui'; s=p.read_text().replace('sources: [@Arc, @S0]','sources: [@Arc.base, @S0.base]');p.write_text(s);units[-1]['sha256']=hashlib.sha256(s.encode()).hexdigest()
# Two nonconcentric circles through (20,0): c1=(0,0),r1=20; c2=(20,15),r2=15.
c1,c2=(0,0),(20,15); r1,r2=23,18; sep=25
x=(r1*r1-r2*r2+sep*sep)/(2*sep); h=math.sqrt(r1*r1-x*x)
foot=(x*0.8,x*0.6); roots=[add(foot,(-0.6*h,0.8*h)),add(foot,(0.6*h,-0.8*h))];j=min(roots,key=lambda p:norm(sub(p,(20,0))))
body=arc(c1,20,270,0)+ 'arc Other = arc(center: (20,15), radius: 15, start: 270, end: 20, direction: counterclockwise)\n'
end=add(c2,(18*math.cos(math.radians(20)),18*math.sin(math.radians(20))))
seal('A3',body+off(['Arc','Other'],3),{'Seam':{'segments':[arc_expected(c1,r1,(0,-23),j),arc_expected(c2,r2,j,end)]}},[c1,c2,roots],'Circle radical-axis foot and two perpendicular roots; root near (20,0) is well separated.')
body=mixed+chain([(20,20),(42,48)],['Tail'])+off(['S0','Arc','Tail'],3)+ 'line BadTail = segment(start: (20,21), end: (42,48))\n'+off(['S0','Arc','BadTail'],3,name='Invalid')
taila,tailb=right((20,20),(22,28),3),right((42,48),(22,28),3)
j2,roots2=circle_line((0,20),23,taila,tailb,(20,20))
seal('A4',body,{'Seam':{'segments':[line(right((-30,-20),(30,20),3),j if False else circle_line((0,20),23,*[right(p,(30,20),3) for p in [(-30,-20),(0,0)]],(0,0))[0]),arc_expected((0,20),23,circle_line((0,20),23,*[right(p,(30,20),3) for p in [(-30,-20),(0,0)]],(0,0))[0],j2),line(j2,tailb)]}},[roots2],'Valid mixed triple plus deliberately discontinuous sibling; edit BadTail start y21→20 removes error and matches Seam.',errors={'Invalid':'reverse'},edit={'replace':'start: (20,21)','with':'start: (20,20)'})

def bez(name,ps):
    a,c1,c2,b=ps
    # endAngle is the incoming traversal tangent: control2=end-v*length.
    v,w=sub(c1,a),sub(b,c2)
    return f'curve {name} = bezier(start: {a}, end: {b}, startAngle: {math.degrees(math.atan2(v[1],v[0]))}, startLength: {norm(v)}, endAngle: {math.degrees(math.atan2(w[1],w[0]))}, endLength: {norm(w)})\n'

def endpoint(ps,d,end=False):
    return right(ps[3] if end else ps[0],sub(ps[3],ps[2]) if end else sub(ps[1],ps[0]),d)

q=[(0,0),(0,20),(20,70),(40,60)]
seal('B1',chain([(-40,0),(0,0)])+bez('Curve',q)+off(['S0','Curve'],3),{'Seam':{'start':pt((-40,-3)),'end':pt(endpoint(q,3,True))}},q,'Analytic right-normal endpoints; tangent miter (3,-3), untrimmed body residual <=0.16 mm.',residuals=[{'path':'Seam','cubics':[q],'distance':3,'skipEnds':True}],junction=[3,-3])
q2=[(0,0),(15,30),(40,25),(60,20)]
body=bez('Curve',q2)+chain([(60,20),(60,70)])+off(['Curve.base','S0.base'],2)+'reverse Curve ()\nreverse S0 ()\n'+off(['S0','Curve'],2,'left',name='Reversed')
seal('B2',body,{'Seam':{'start':pt(endpoint(q2,2)),'end':pt((62,70))},'Reversed':{'start':pt((62,70)),'end':pt(endpoint(q2,2))}},q2,'Reversal swaps side and primitive order. Joined end may use sampled trim or tangent fallback; free endpoint exact.',residuals=[{'path':'Seam','cubics':[q2],'distance':2,'skipEnds':True}])
q3=[(60,20),(75,50),(100,55),(115,32)]
seal('B3',bez('First',q2)+bez('Second',q3)+off(['First','Second'],2),{'Seam':{'start':pt(endpoint(q2,2)),'end':pt(endpoint(q3,2,True))}},[q2,q3],'Distinct tangents; joined leaves may change under fixed 96-step trim/tangent rules; all other fitted body samples <=0.16 mm.',residuals=[{'path':'Seam','cubics':[q2,q3],'distance':2,'skipEnds':True}])
q4=[(0,0),(20,30),(40,30),(60,0)]
seal('B4',bez('Curve',q4)+off(['Curve'],35)+off(['Curve'],35,name='Quiet',suppress=True)+off(['Curve'],2,name='Low'),{'Low':{'start':pt(endpoint(q4,2)),'end':pt(endpoint(q4,2,True))}},q4,'At t=.5, signed curvature=-1/20 mm^-1; right 35 scale=1+35*k=-.75, so interior unsafe. Endpoint scales >.7; trim yields two separated groups. d2 stays safe.',warnings=['Seam'],equal=[['Seam','Quiet']],gaps=['Seam'],residuals=[{'path':'Low','cubics':[q4],'distance':2,'skipEnds':False}])
seal('C1',bez('Curve',q)+off(['Curve'],3)+off(['Curve'],3,name='Pure',pure=True)+off(['Curve','Control'],3,name='Invalid')+off(['Curve','Control'],3,name='PureInvalid',pure=True),{'Seam':{'start':pt(endpoint(q,3)),'end':pt(endpoint(q,3,True))}},q,'Identity-free pure and drawable offset share geometry; only drawable allocates element ID. Discontinuous pure/drawable failures use their own diagnostic channels. Replaces invalid line-from-path draft before evaluation.',pure=['Pure'],errors={'Invalid':'reverse'},pureErrors=['PureInvalid'])
module='module Allowance(d: number, side: choice(right, left)) {\n'+chain([(-40,0),(0,0)])+bez('Curve',q)+off(['S0','Curve'],'@d','@side',name='Local')+'}\ninstance First = Allowance(d: 2, side: right)\ninstance Second = Allowance(d: 4, side: left)\n'
seal('C2',module,{'First::Local':{'start':pt((-40,-2)),'end':pt(endpoint(q,2,True))},'Second::Local':{'start':pt((-40,4)),'end':pt(endpoint(q,-4,True))}},q,'Two Module occurrences have distinct IDs, distances and sides; right d2 and left d4 exact free endpoints.')
body=chain(points)+'move [S0, S1] (from: (0,0), to: (17,-9), scale: 1, angleDeg: 90, mirrorX: true)\n'+off(['S0','S1'],3,'left')
transform=lambda p:(17-p[1],-9-p[0])
segs=[{**s,'start':pt(transform(tuple(s['start'].values()))),'end':pt(transform(tuple(s['end'].values())))} for s in polygon(points,3)]
seal('C3',body,{'Seam':{'segments':segs}},points,'Independent affine map R90*mirrorX: (x,y)→(17-y,-9-x), determinant -1. Source right maps to transformed left.')
seal('C4',chain(points)+off(['S0','S1'],3)+'point On = onLine(from: @Seam.start, distance: 7)\npoint OnEnd = onLine(from: @Seam.end, distance: 6)\n',{'Seam':{'segments':polygon(points,3)},'On':pt((10,2)),'OnEnd':pt((46,26))},points,'Downstream path-distance traversal: 7 mm forward from start, 6 mm inward from end; source path unchanged.')
straight=[(0,0),(10,0),(30,0),(50,0)]
seal('R1',bez('Curve',straight)+off(['Curve'],3),{'Seam':{'start':pt((0,-3)),'end':pt((50,-3)),'length':50}},straight,'Minimal legal straight cubic: exact right-offset locus y=-3, length50, no sampling uncertainty. Neighboring ControlOffset y=-110 remains valid.',residuals=[{'path':'Seam','cubics':[straight],'distance':3,'skipEnds':False}])

for unit in units:
    if unit['id'] in ['B1','B2','B3']:
        if unit['id']=='B1':
            unit['junctionTangents']=[[1,0],[0,1]]
        else:
            a=endpoint(q2,2,True); v=sub(q2[3],q2[2])
            b=(62,70) if unit['id']=='B2' else endpoint(q3,2)
            w=(0,1) if unit['id']=='B2' else sub(q3[1],q3[0])
            unit['junction']=list(intersection(a,add(a,v),b,add(b,w)))
            unit['junctionTangents']=[list(v),list(w)]
    if unit['id'] in ['B1','B2','B3','B4','C1','C2']:
        unit['variant']='X'+str(['B1','B2','B3','B4','C1','C2'].index(unit['id'])+1)
        unit['variantReason']='Initial generator encoded end handle as outward rather than incoming tangent. Preserved initial source/oracle/Base run; this pre-execution replacement restores intended control-point sensitivity.'
    if 'edit' in unit:
        source=(ROOT/unit['file']).read_text().replace(unit['edit']['replace'],unit['edit']['with'])
        file=unit['id']+'-edited.nui'
        (ROOT/file).write_text(source)
        unit['edit'].update(file=file,sha256=hashlib.sha256(source.encode()).hexdigest())
(ROOT/'manifest.json').write_text(json.dumps({'base':'39fdfd677813bb2fdc13b29232a621e6f6f9dbac','tolerance':1e-7,'residualToleranceMm':0.16,'units':units},indent=2)+'\n')
