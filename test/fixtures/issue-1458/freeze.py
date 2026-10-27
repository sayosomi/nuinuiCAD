"""Independent authored physical oracles. Run before observing exported artifacts.
No product modules or observed output are read. Coordinates use complex mm vectors.
"""
import cmath
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).parent
CASES = []
INK = 'style Ink {\n width: 2px,\n color: #123456,\n}\n'
HIDDEN = 'style Hidden {\n visible: false,\n}\n'
FILL = 'style Fill {\n width: 2px,\n color: #123456,\n fill: #eebb99,\n fillOpacity: 0.35,\n}\n'
HALF = 25.4 / 96
DEFAULT = dict(origin=[0, 0], at=[0, 0], scale=1, angle=0, mirror=False)
COMPOUND = dict(origin=[3, -4], at=[41, -23], scale=1.7, angle=37, mirror=True)

def line(a, b, **kw): return dict(type='line', points=[a, b], **kw)
def cubic(length=40): return dict(type='cubic', points=[[0, 0], [0, length], [-30, 5], [10, 5]])
def polygon(points, **kw): return dict(type='contour', points=points, **kw)
def text(value='AB\n日本', **kw): return dict(type='text', value=value, points=[[5, 2]], size=4, **kw)
def point(p, t):
    z = complex(*p) - complex(*t['origin'])
    if t['mirror']: z = complex(-z.real, z.imag)
    z = z * t['scale'] * cmath.exp(1j * math.radians(t['angle'])) + complex(*t['at'])
    return [z.real, z.imag]

def curve_extrema(ps):
    # Derivative in Bernstein form -> quadratic, evaluated by de Casteljau.
    values = [ps[0], ps[-1]]
    for axis in [0, 1]:
        ds = [ps[i+1][axis]-ps[i][axis] for i in range(3)]
        a,b,c = ds[0]-2*ds[1]+ds[2], 2*(ds[1]-ds[0]), ds[0]
        roots = []
        if abs(a)<1e-12:
            if abs(b)>1e-12: roots=[-c/b]
        elif b*b-4*a*c>=0:
            roots=[(-b+s*math.sqrt(b*b-4*a*c))/(2*a) for s in [-1,1]]
        for u in roots:
            if 0<u<1:
                q=ps
                while len(q)>1: q=[[x*(1-u)+y*u for x,y in zip(v,w)] for v,w in zip(q,q[1:])]
                values += q
    return values

def world(shape, t):
    s={**shape, 'points':[point(p,t) for p in shape.get('points',[])]}
    s['width']=shape.get('width',2)*25.4/96
    s['color']=shape.get('color','#123456')
    s['dash']=shape.get('dash','solid')
    if s['type']=='arc':
        s['center']=point(shape['center'],t)
        s['radius']=shape['radius']*t['scale']
        s['start']=(t['angle']+(180-shape['start'] if t['mirror'] else shape['start']))%360
        s['sweep']=shape['sweep']*(-1 if t['mirror'] else 1)
    if s['type']=='mixed': s['segments']=[world(part,t) for part in shape['segments']]
    if s['type']=='text':
        s['size']*=t['scale']; s['angle']=t['angle']; s['mirror']=t['mirror']
        s['widths']=[sum(1 if ord(c)>0x2e80 else .62 for c in row)*s['size'] for row in s['value'].split('\n')]
    return s

def bounds(shapes):
    allpts=[]
    for s in shapes:
        if s['type']=='mixed':
            b=bounds(s['segments']); allpts += [[b[0],b[1]],[b[2],b[3]]]; continue
        ps=s['points']
        half=s['width']/2
        if s['type']=='cubic': ps=curve_extrema(ps)
        if s['type']=='arc':
            start,end=s['start'],s['start']+s['sweep']
            angles=[start,end]+[a for a in range(-720,1081,90) if min(start,end)<=a<=max(start,end)]
            ps=[[s['center'][0]+s['radius']*math.cos(math.radians(a)),s['center'][1]+s['radius']*math.sin(math.radians(a))] for a in angles]
        if s['type']=='text':
            half=0
            ps=[]
            for i,w in enumerate(s['widths']):
                for x in [0,w]:
                    for y in [-i*s['size']*1.2-s['size']*.2,-i*s['size']*1.2+s['size']*.8]:
                        ps.append(point([x,y],dict(DEFAULT,at=s['points'][0],angle=s['angle'],mirror=s['mirror'])))
        lo=[min(p[k] for p in ps)-half for k in [0,1]]
        hi=[max(p[k] for p in ps)+half for k in [0,1]]
        allpts += [lo,hi]
    return [min(p[0] for p in allpts),min(p[1] for p in allpts),max(p[0] for p in allpts),max(p[1] for p in allpts)]

def add(id, variant, body, shapes, *, placements=None, pre='', margin=3, paper='a4', landscape=False, overlap=10, profile='', error=None, invalid=False):
    placements=placements or [DEFAULT]
    source='nui 1\n'+pre+INK+HIDDEN+FILL+'group G {\n point Origin = coordinate(x: 3, y: -4)\n'+body+'\n}\nlayout L {\n'
    for t in placements:
        origin='origin: @G::Origin, ' if t['origin']==[3,-4] else ''
        source+=f" place @G({origin}at: ({t['at'][0]}, {t['at'][1]}), scale: {t['scale']}, angle: {t['angle']}, mirror: {str(t['mirror']).lower()})\n"
    source+='}\n'
    if overlap == 105: source=source.replace('nui 1\n','nui 1\nconst Overlap: number = 105\n',1)
    prof=f', profile: @{profile}' if profile else ''
    source+=f'svg S(layout: @L, margin: {margin}{prof})\nprint P(layout: @L, paper: {paper}, orientation: {"landscape" if landscape else "portrait"}, overlap: {"@Overlap" if overlap == 105 else overlap}{prof})\n'
    ws=[world(s,t) for t in placements for s in shapes]
    bs=bounds(ws)
    sheet=([420,297] if landscape else [297,420]) if paper=='a3' else ([297,210] if landscape else [210,297])
    cols=max(1,math.ceil((bs[2]-bs[0])/(sheet[0]-2*overlap))) if sheet[0]>2*overlap else 0
    rows=max(1,math.ceil((bs[3]-bs[1])/(sheet[1]-2*overlap))) if sheet[1]>2*overlap else 0
    c=dict(id=id,variant=variant,source=source,sha256=hashlib.sha256(source.encode()).hexdigest(),shapes=ws,bounds=bs,margin=margin,paper=sheet,overlap=overlap,columns=cols,rows=rows)
    if error: c['error']=error
    if invalid: c['invalid']=True
    CASES.append(c)

edge=' line Edge [Ink] = segment(start: (0, 0), end: (30, 15))'
curve=lambda n=40: f' curve Curve [Ink] = bezier(start: (0, 0), end: (10, 5), startAngle: 90, startLength: {n}, endAngle: 0, endLength: 40)'
for v,ref in [('dependent','@Later.start'),('independent','(5, 2)')]:
    add('S1',v,f' line First [Ink] = segment(start: {ref}, end: (22, 14))\n line Later [Ink] = segment(start: (5, 2), end: (12, 7))',[line([5,2],[22,14]),line([5,2],[12,7])])
for v,t in [('compound',COMPOUND),('unmirrored',dict(COMPOUND,mirror=False))]: add('S2',v,curve(),[cubic()],placements=[t],margin=7)
for v,start,sweep in [('positive',30,120),('negative',150,-120),('wraparound',-60,120)]:
    add('S3',v,f' arc Curve [Ink] = arc(center: (3, -5), radius: 17, start: {start}, end: {start+sweep}, direction: {"clockwise" if sweep < 0 else "counterclockwise"})',[dict(type='arc',center=[3,-5],radius=17,start=start,sweep=sweep)],placements=[dict(COMPOUND,scale=1.4,angle=29)])
joined=''' line A [Hidden] = segment(start: (0, 0), end: (250, 0))
 line B [Hidden] = segment(start: (250, 0), end: (0, 40))
 line C [Hidden] = segment(start: (0, 40), end: (0, 0))
 line Joined [Fill] = join(paths: [@A, @B, @C], closed: true)'''
triangle=polygon([[0,0],[250,0],[0,40],[0,0]],fill='#eebb99',opacity=.35,segmented=True,closed=True)
for v,filled in [('filled',True),('stroke',False)]:
    sh={**triangle}; body=joined
    if not filled: sh.pop('fill');body=body.replace('[Fill]','[Ink]')
    # Offset is independently known: CCW rectangular outline inset 2 mm on its left.
    body+='\n line Base [Hidden] = polyline(points: [(280, 0), (310, 0), (310, 20), (280, 20)], closed: true)\n line Offset [Fill] = offset(sources: [@Base], distance: 2, side: left, closed: true, suppressTrimWarnings: false)'
    add('S4',v,body,[sh,polygon([[282,2],[308,2],[308,18],[282,18],[282,2]],fill='#eebb99',opacity=.35,segmented=True,closed=True)],placements=[dict(DEFAULT,at=[-51,-22],angle=17)])
loop=''' for i in range(min: 0, max: 1, step: 1, showGenerated: true) {
 line Edge [Ink] = segment(start: (@i * 20, 0), end: (@i * 20 + 8, 3))
 }'''
for v,ts in [('repeated',[DEFAULT,dict(DEFAULT,at=[70,-20],scale=.7,angle=21)]),('single',[DEFAULT])]: add('S5',v,loop,[line([0,0],[8,3]),line([20,0],[28,3])],placements=ts)
profile='''profile Print
style ProfileInk {
 width: 2px,
 color: #123456,
 for @Print {
 width: 4px,
 lineType: dashed,
 }
}
style Far {
 for @Print {
 visible: false,
 }
}
'''
profilebody=' line Edge [ProfileInk] = segment(start: (0, 0), end: (30, 15))\n line FarEdge [Far] = segment(start: (-400, -20), end: (500, 20))'
for v,p in [('selected','Print'),('default','')]:
    ss=[line([0,0],[30,15],width=4 if p else 2,dash='dashed' if p else 'solid')]
    if not p: ss+=[line([-400,-20],[500,20],width=1,color='#31322f')]
    add('S6',v,profilebody,ss,pre=profile,profile=p,placements=[DEFAULT,dict(DEFAULT,at=[70,0],scale=2.5)])
for v,t in [('compound',COMPOUND),('upright',DEFAULT)]: add('S7',v,' text Label = label(text: "AB\\n日本", anchor: (5, 2), size: 4)',[text(color='#31322f',width=1)],placements=[t])
for v,m in [('zero',0),('positive',11)]: add('S8',v,' line Edge [Ink] = segment(start: (-10000, -700), end: (500, -300))',[line([-10000,-700],[500,-300])],margin=m)
for v,x in [('threshold',190-2*HALF),('crossing',190-2*HALF+.002)]: add('P1',v,f' line Edge [Ink] = segment(start: (-31, -47), end: ({x-31}, -47))',[line([-31,-47],[x-31,-47])])
for v,o in [('overlap',10),('zero',0)]: add('P2',v,' line Edge [Ink] = segment(start: (-40, -50), end: (260, 350))',[line([-40,-50],[260,350])],overlap=o)
for paper in ['a3','a4']: add('P3',paper,' line Edge [Ink] = polyline(points: [(-37, -41), (313, -21), (73, 209)], closed: false)',[polygon([[-37,-41],[313,-21],[73,209]],closed=False)],paper=paper,landscape=True)
for v,t in [('corner',dict(COMPOUND,scale=12,angle=31)),('neighbor',dict(DEFAULT,scale=2))]: add('P4',v,curve(),[cubic()],placements=[t])
for v,filled in [('filled',True),('stroke',False)]:
    s={**triangle}
    if not filled: s.pop('fill')
    add('P5',v,joined if filled else joined.replace('[Fill]','[Ink]'),[s],placements=[dict(DEFAULT,at=[-65,-20])])
for v,scale in [('large',2),('small',.5)]:
    add('P6',v,' line Dash [Dash] = segment(start: (0, 0), end: (1100, 0))\n line Dot [Dot] = segment(start: (0, 12), end: (50, 20))',[line([0,0],[1100,0],dash='dashed',width=3),line([0,12],[50,20],dash='dotted',width=3)],pre='style Dash {\n width: 3px,\n lineType: dashed,\n color: #123456,\n}\nstyle Dot {\n width: 3px,\n lineType: dotted,\n color: #123456,\n}\n',placements=[dict(DEFAULT,scale=scale)],overlap=.2)
for v,p in [('hidden','Print'),('visible','')]:
    ss=[line([0,0],[30,15],width=4 if p else 2,dash='dashed' if p else 'solid')]
    if not p:ss+=[line([-400,-20],[500,20],width=1,color='#31322f')]
    add('P7',v,profilebody,ss,pre=profile,profile=p)
for v,o in [('invalid',105),('valid',10)]: add('P8',v,edge,[line([0,0],[30,15])],overlap=o,error='print usable width' if o==105 else None)
# Deliberate revision sequences. Every pair is one matrix unit.
for v,n in [('before',40),('after',63)]: add('R1',v,curve(n),[cubic(n)],placements=[COMPOUND],pre=f'const Reach: number = {n}\n') ; CASES[-1]['source']=CASES[-1]['source'].replace(f'startLength: {n}', 'startLength: @Reach'); CASES[-1]['sha256']=hashlib.sha256(CASES[-1]['source'].encode()).hexdigest()
for v,t in [('before',COMPOUND),('after',dict(COMPOUND,scale=.8,angle=113,mirror=False))]:add('R2',v,curve(),[cubic()],placements=[t])
r3lines=' line First [Ink] = segment(start: @Later.start, end: (22, 14))\n line Later [Ink] = segment(start: @Anchor, end: (12, 7))\n point Anchor = coordinate(x: 5, y: 2)'
for v,body in [('before', r3lines+'\n point Scheduling = coordinate(x: 0, y: 0)'),('after',' point Scheduling = coordinate(x: 0, y: 0)\n'+r3lines)]:
    add('R3',v,body,[line([5,2],[22,14]),line([5,2],[12,7])])
for v,w in [('before',4),('after',7)]:add('R4',v,profilebody,[line([0,0],[30,15],width=w,dash='dashed')],pre=profile.replace('width: 4px',f'width: {w}px'),profile='Print')
for v,x in [('before',189),('after',191)]:add('R5',v,f' line Edge [Ink] = segment(start: (-50, -20), end: ({x-50}, -20))',[line([-50,-20],[x-50,-20])])
for v,x in [('before',30),('after',51)]:add('R6',v,f' line Edge [Ink] = segment(start: (0, 0), end: ({x}, 15))',[line([0,0],[x,15])])
for v,o in [('before',10),('invalid',105),('after',7)]:add('R7',v,edge,[line([0,0],[30,15])],overlap=o,error='print usable width' if o==105 else None)
for v,x in [('before',30),('after',47)]:add('R8',v,f' // preserve this comment\n line Edge [Ink] = segment(start: (0, 0), end: ({x}, 15))\n\n line Control [Ink] = segment(start: (0, -10), end: (10, -10))',[line([0,0],[x,15]),line([0,-10],[10,-10])])
# X2: S4 exercises only straight continuations. A closed mixed contour crosses
# SVG path_continuation and PDF cubic/arc continuations that its unit tests omit.
mixedbody=''' line A [Hidden] = segment(start: (0, 0), end: (20, 0))
 arc B [Hidden] = arc(center: (20, 10), radius: 10, start: -90, end: 90)
 curve C [Hidden] = bezier(start: (20, 20), end: (0, 0), startAngle: 180, startLength: 10, endAngle: 270, endLength: 10)
 line Joined [Fill] = join(paths: [@A, @B, @C], closed: true)'''
mixed=dict(type='mixed',segments=[line([0,0],[20,0]),dict(type='arc',center=[20,10],radius=10,start=-90,sweep=180),dict(type='cubic',points=[[20,20],[10,20],[0,10],[0,0]])],fill='#eebb99',opacity=.35,closed=True,segmented=True)
for variant,filled in [('filled',True),('stroke',False)]:
    shape={**mixed}
    if not filled: shape.pop('fill')
    add('X2',variant,mixedbody if filled else mixedbody.replace('[Fill]','[Ink]'),[shape],placements=[dict(COMPOUND,angle=23)])
# X3: S4 does not discriminate scoped opacity resources across overlapping fills
# with different styles, followed by an ordinary unfilled stroke.
pre='''style Blue {
 width: 2px,
 color: #123456,
 fill: #3366cc,
 fillOpacity: 0.75,
}
'''
a=polygon([[0,0],[40,0],[40,30],[0,30],[0,0]],fill='#eebb99',opacity=.35,closed=True)
b=polygon([[10,10],[30,10],[30,20],[10,20],[10,10]],fill='#3366cc',opacity=.75,closed=True)
for variant,reverse in [('nested',False),('reversed',True)]:
    decls=[' line Outer [Fill] = polyline(points: [(0, 0), (40, 0), (40, 30), (0, 30)], closed: true)',' line Inner [Blue] = polyline(points: [(10, 10), (30, 10), (30, 20), (10, 20)], closed: true)']
    shapes=[a,b]
    if reverse: decls.reverse(); shapes=list(reversed(shapes))
    add('X3',variant,'\n'.join(decls)+'\n line Edge [Ink] = segment(start: (0, 15), end: (40, 15))',shapes+[line([0,15],[40,15])],pre=pre)
# F1 removes all placement complexity; its vector neighbor discriminates text axes.
add('F1','text',' text Label = label(text: "A", anchor: (0, 0), size: 4)',[dict(type='text',value='A',points=[[0,0]],size=4,color='#31322f',width=1)])
add('F1','vector',' line Edge [Ink] = segment(start: (0, 0), end: (0, 3.2))',[line([0,0],[0,3.2])])
# X4: primary S7 exposes the text-axis boundary. A blank middle row and narrow
# versus wide Latin letters discriminate baseline counting and prescribed advance.
add('X4','blank-row',' text Label = label(text: "Wi\\n\\n日本", anchor: (5, 2), size: 4)',[text('Wi\n\n日本',color='#31322f',width=1)],placements=[dict(COMPOUND,angle=113)])
# X8: P8 leaves the distinct, known-before-write encoder text rejection branch
# uncovered; use legal source and actual stdio export, with supported neighbor.
for variant,value in [('unsupported','😀'),('supported','日')]:
    add('X8',variant,f' text Label = label(text: "{value}", anchor: (5, 2), size: 4)',[text(value,color='#31322f',width=1)])
    if variant=='unsupported': CASES[-1]['encodeError']='U+1F600'
ROOT.joinpath('cases.json').write_text(json.dumps(CASES,ensure_ascii=False,indent=2)+'\n')
print(f'Frozen {len(CASES)} variants for {len(set(c["id"] for c in CASES))} units (24 primary, conditional X and reducers)')
