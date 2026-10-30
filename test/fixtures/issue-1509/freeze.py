"""Independent source/physical oracle. No product imports or observations.
Analytic directed lines/circles; cubic quadrature at 16384/32768 panels.
The offset of a cubic is B + d*(B'y,-B'x)/|B'|, never a fitted product cubic.
"""
import bisect, hashlib, json, math
from pathlib import Path
P=Path(__file__).parent
pt=lambda x,y:dict(x=x,y=y)
def line(a,b):return dict(kind='line',start=a,end=b)
def arc(w,r,d=0,reverse=False):
 return dict(kind='arc',center=pt(w,r),radius=r+d,startAngleDeg=0 if reverse else 270,sweepAngleDeg=-90 if reverse else 90)
def cubic(w,b,h,a):return dict(kind='bezier',start=pt(w,0),control1=pt(w+a,0),control2=pt(w+b,h*.6),end=pt(w+b,h))
def xy(s,t):
 if s['kind']=='line':return pt(*[s['start'][k]+t*(s['end'][k]-s['start'][k]) for k in ['x','y']])
 if s['kind']=='arc':
  a=math.radians(s['startAngleDeg']+t*s['sweepAngleDeg']);return pt(s['center']['x']+s['radius']*math.cos(a),s['center']['y']+s['radius']*math.sin(a))
 ps=[s[k] for k in ['start','control1','control2','end']];return pt(*[sum(c*p[k] for c,p in zip([(1-t)**3,3*(1-t)**2*t,3*(1-t)*t*t,t**3],ps)) for k in ['x','y']])
def derivative(s,t):
 if s['kind']=='line':return pt(s['end']['x']-s['start']['x'],s['end']['y']-s['start']['y'])
 if s['kind']=='arc':
  a=math.radians(s['startAngleDeg']+t*s['sweepAngleDeg']);v=math.radians(s['sweepAngleDeg'])*s['radius'];return pt(-math.sin(a)*v,math.cos(a)*v)
 ps=[s[k] for k in ['start','control1','control2','end']];return pt(*[3*((1-t)**2*(ps[1][k]-ps[0][k])+2*(1-t)*t*(ps[2][k]-ps[1][k])+t*t*(ps[3][k]-ps[2][k])) for k in ['x','y']])
def table(s,n):
 speeds=[math.hypot(*derivative(s,i/n).values()) for i in range(n+1)];out=[0.]
 for i in range(n):out.append(out[-1]+(speeds[i]+speeds[i+1])/(2*n))
 return out
def length(s):
 if s['kind']=='line':return math.dist(list(s['start'].values()),list(s['end'].values()))
 if s['kind']=='arc':return abs(math.radians(s['sweepAngleDeg']))*s['radius']
 lo,hi=table(s,16384),table(s,32768);assert abs(lo[-1]-hi[-1])<1e-6;return hi[-1]
def station(segs,distance):
 for s in segs:
  L=length(s)
  if distance<=L+1e-9:
   t=distance/L
   if s['kind']=='bezier':
    tab=table(s,32768);i=bisect.bisect_left(tab,distance);t=(i-1+(distance-tab[i-1])/(tab[i]-tab[i-1]))/32768
   p=xy(s,t);v=derivative(s,t);vlen=math.hypot(*v.values());return p,pt(v['x']/vlen,v['y']/vlen),t
  distance-=L
 raise ValueError('station out of range')
def samples(s,n=256):return [xy(s,i/n) for i in range(n+1)]
def transform(p,c):
 x=(-p['x'] if c.get('mirror') else p['x'])*c.get('scale',1);y=p['y']*c.get('scale',1)
 angle=c.get('angle',0);x,y={0:(x,y),90:(-y,x),270:(y,-x)}[angle]
 return pt(x+c.get('at',[0,0])[0],y+c.get('at',[0,0])[1])
def transformseg(s,c):
 s=dict(s)
 for k in ['start','control1','control2','end','center']:
  if k in s:s[k]=transform(s[k],c)
 if s['kind']=='arc':
  s['radius']*=c.get('scale',1);s['startAngleDeg']=((180-s['startAngleDeg']) if c.get('mirror') else s['startAngleDeg'])+c.get('angle',0)
  s['startAngleDeg']%=360
  if c.get('mirror'):s['sweepAngleDeg']*=-1
 return s
def build(id,c):
 w,r,d=c.get('w',40),c.get('r',30),c.get('d',4);rev=c.get('reverse',False);closed=c.get('closed',False);bez=c.get('bezier',False)
 source=['nui 1',f'// #1509 {id}: frozen independently before evaluation',f'const width: number = {w}',f'const radius: number = {r}',f'const allowance: number = {d}',
 'profile Draft','profile Cut','style Ink {',' width: 2px,',' color: #123456,','}',
 'style SeamInk {',' width: 2px,',' color: #ab5412,',' for @Cut {','  visible: false,',' }','}',
 'style MarkInk {',' width: 2px,',' color: #127a45,',' for @Cut {','  visible: false,',' }','}',
 'group Piece {',' point Origin = coordinate(x: 0, y: 0)',
 f' line Straight = segment(start: ({"@width" if rev else "0"}, 0), end: ({"0" if rev else "@width"}, 0), visible: false)']
 first=line(pt(w,0),pt(0,0)) if rev else line(pt(0,0),pt(w,0))
 if bez:
  b,h,a=c.get('b',100),c.get('h',70),c.get('a',35)
  source.append(f' curve Bend = bezier(start: (@width, 0), end: (@width + {b}, {h}), startAngle: 0, startLength: {a}, endAngle: 90, endLength: {h*.4}, visible: false)')
  bend=cubic(w,b,h,a);contour=[first,bend]
  seam=[line(pt(0,-d),pt(w,-d))]
  qs=[]
  for i in range(513):
   t=i/512;p=xy(bend,t);v=derivative(bend,t);sp=math.hypot(*v.values());qs.append(pt(p['x']+d*v['y']/sp,p['y']-d*v['x']/sp))
  seam.append(dict(kind='numericOffset',points=qs))
 else:
  source.append(f' arc Bend = arc(center: (@width, @radius), radius: @radius, start: {0 if rev else 270}, end: {270 if rev else 360}, direction: {"clockwise" if rev else "counterclockwise"}, visible: false)')
  bend=arc(w,r,reverse=rev);contour=[bend,first] if rev else [first,bend]
  seam=[arc(w,r,-d,True),line(pt(w,d),pt(0,d))] if rev else [line(pt(0,-d),pt(w,-d)),arc(w,r,d)]
 names=['Bend','Straight'] if rev else ['Straight','Bend']
 if closed:
  h=c.get('h',100)
  extra=[line(pt(w+r,r),pt(w+r,h)),line(pt(w+r,h),pt(0,h)),line(pt(0,h),pt(0,0))]
  for name,s in zip(['Right','Top','Left'],extra):source.append(f' line {name} = segment(start: ({s["start"]["x"]}, {s["start"]["y"]}), end: ({s["end"]["x"]}, {s["end"]["y"]}), visible: false)')
  names+=['Right','Top','Left'];contour+=extra
  seam=[line(pt(-d,-d),pt(w,-d)),arc(w,r,d),line(pt(w+r+d,r),pt(w+r+d,h+d)),line(pt(w+r+d,h+d),pt(-d,h+d)),line(pt(-d,h+d),pt(-d,-d))]
 source += [f' line Contour [Ink] = join(paths: [{", ".join("@"+n for n in names)}], closed: {str(closed).lower()})',f' line Allowance [SeamInk] = offset(sources: [@Contour], distance: @allowance, side: right, closed: {str(closed).lower()})']
 total=sum(length(s) for s in contour); marks=[];points={};stations=[]
 specs=c.get('marks',[dict(ratio=.64,length=6)])
 for i,m in enumerate(specs,1):
  dist=m.get('distance',m.get('ratio',0)*total)
  if m.get('nearJoin'):dist=w+.2
  attr=f'distance: @width + 0.2' if m.get('nearJoin') else f'distance: {m["distance"]}' if 'distance' in m else f'ratio: {m["ratio"]}'
  p,v,t=station(contour,dist);angle=m.get('angle',-90);a=math.radians(angle);L=m['length'];tip=pt(p['x']+L*(v['x']*math.cos(a)-v['y']*math.sin(a)),p['y']+L*(v['x']*math.sin(a)+v['y']*math.cos(a)))
  source += [f' point Station{i} = onLine(from: @Contour.start, {attr}, visible: false)',f' point Tip{i} = tangentOffset(line: @Contour, base: @Station{i}, angle: {angle}, distance: {L}, visible: false)',f' line Mark{i} [MarkInk] = segment(start: @Station{i}, end: @Tip{i}, visible: {str(m.get("visible",True)).lower()})']
  marks.append(line(p,tip));points[f'Station{i}']=p;points[f'Tip{i}']=tip;stations.append(dict(distance=dist,t=t,base=p,tip=tip))
 source += ['}','group Control {',' line Calibration [Ink] = segment(start: (0, -15), end: (100, -15))',' line Sibling [SeamInk] = segment(start: (0, -10), end: (3, -6))','}', 'group Unselected {',' line Outside = segment(start: (9000, 9000), end: (9100, 9000))','}', 'layout Pattern {',f' place @Piece(origin: @Piece::Origin, at: ({c.get("at",[0,0])[0]}, {c.get("at",[0,0])[1]}), scale: {c.get("scale",1)}, angle: {c.get("angle",0)}, mirror: {str(c.get("mirror",False)).lower()})',' place @Control(at: (0, 0))','}',f'svg Vector(layout: @Pattern, profile: @{c.get("profile","Draft")}, margin: {c.get("margin",3)})',f'print Paper(layout: @Pattern, profile: @{c.get("profile","Draft")}, paper: a4, orientation: portrait, overlap: 10)','']
 # Independent sibling must survive profile changes as well.
 source=[s.replace('line Sibling [SeamInk]','line Sibling [Ink]') for s in source]
 draw=[dict(name='Contour',segments=contour,color='#123456')]
 if c.get('profile')!='Cut':
  draw.append(dict(name='Allowance',segments=seam,color='#ab5412'))
  draw += [dict(name=f'Mark{i}',segments=[s],color='#127a45') for i,s in enumerate(marks,1) if specs[i-1].get('visible',True)]
 for item in draw:
  out=[]
  for s in item['segments']:
   out.append(dict(kind='numericOffset',points=[transform(p,c) for p in s['points']]) if s['kind']=='numericOffset' else transformseg(s,c))
  item['segments']=out
 draw += [dict(name='Calibration',segments=[line(pt(0,-15),pt(100,-15))],color='#123456'),dict(name='Sibling',segments=[line(pt(0,-10),pt(3,-6))],color='#123456')]
 cloud=[]
 for item in draw:
  for s in item['segments']:cloud += s['points'] if s['kind']=='numericOffset' else samples(s,1024)
 half=25.4/96;minx=min(p['x'] for p in cloud)-half;maxx=max(p['x'] for p in cloud)+half;miny=min(p['y'] for p in cloud)-half;maxy=max(p['y'] for p in cloud)+half
 bounds=dict(minX=minx,maxX=maxx,minY=miny,maxY=maxy,width=maxx-minx,height=maxy-miny);cols=math.ceil(bounds['width']/190);rows=math.ceil(bounds['height']/277)
 oracle=dict(contour=contour,seam=seam,points=points,stations=stations,length=total,closed=closed,drawables=draw,bounds=bounds,svgMm=[bounds['width']+2*c.get('margin',3),bounds['height']+2*c.get('margin',3)],columns=cols,rows=rows,pageOrigins=[pt(minx-10+190*i,miny-10+277*j) for j in range(rows) for i in range(cols)],margin=c.get('margin',3),bezier=bez,profile=c.get('profile','Draft'))
 text='\n'.join(source);seal=json.dumps(oracle,separators=(',',':'));return dict(source=text,sha256=hashlib.sha256(text.encode()).hexdigest(),oracle=oracle,oracleCanonicalJson=seal,oracleSha256=hashlib.sha256(seal.encode()).hexdigest())
units=[]
def add(id,configs):
 cps=[build(id,c) for c in configs];cps.append(cps[0]);units.append(dict(id=id,checkpoints=cps))
add('C1',[dict(w=40,r=30),dict(w=62,r=45),dict(w=25,r=20,d=3)])
add('C2',[dict(bezier=True,w=35,b=100,h=70,a=35,d=3),dict(bezier=True,w=55,b=120,h=90,a=53,d=3),dict(bezier=True,w=25,b=85,h=60,a=22,d=2)])
add('C3',[dict(closed=True,w=55,r=20,h=100,marks=[dict(ratio=.23,length=5),dict(ratio=.68,length=8)]),dict(closed=True,w=85,r=25,h=135,marks=[dict(ratio=.23,length=5),dict(ratio=.68,length=8)]),dict(closed=True,w=45,r=15,h=80,marks=[dict(ratio=.23,length=5),dict(ratio=.68,length=8)])])
add('C4',[dict(w=50,r=35),dict(w=50,r=35,reverse=True),dict(w=35,r=25,reverse=True,d=3)])
add('N1',[dict(w=25,r=35,marks=[dict(distance=50,length=5)]),dict(w=25,r=50,marks=[dict(distance=50,length=5)]),dict(w=25,r=25,marks=[dict(distance=50,length=5)])])
add('N2',[dict(w=w,r=r,marks=[dict(ratio=.52,length=4),dict(ratio=.83,length=9)]) for w,r in [(30,35),(50,50),(20,25)]])
add('N3',[dict(w=20,r=35,reverse=v,marks=[dict(ratio=.3,length=7,angle=90)]) for v in [False,True,False]])
# V2 must be a distinct further revision.
units[-1]['checkpoints'][2]=build('N3',dict(w=20,r=45,reverse=True,marks=[dict(ratio=.3,length=7,angle=90)]))
add('N4',[dict(w=w,r=r,marks=[dict(nearJoin=True,length=5)]) for w,r in [(40,25),(65,40),(25,20)]])
add('O1',[dict(w=40,r=r,d=5,marks=[dict(distance=70,length=15)],margin=m,at=[100,0]) for r,m in [(20,3),(40,5),(60,2)]])
add('O2',[dict(w=w,r=30,d=5) for w in [145,165,355]])
add('O3',[dict(w=40,r=30),dict(w=40,r=30,mirror=True,angle=90,at=[80,20]),dict(w=40,r=30,mirror=True,angle=270,at=[20,90],scale=1.5)])
add('O4',[dict(w=40,r=30,profile='Draft',marks=[dict(ratio=.6,length=5),dict(ratio=.8,length=7)]),dict(w=60,r=40,profile='Cut',marks=[dict(ratio=.6,length=5),dict(ratio=.8,length=7)]),dict(w=25,r=25,profile='Draft',marks=[dict(ratio=.6,length=5),dict(ratio=.8,length=7,visible=False)])])
manifest=dict(base='b9b34b89ceae84681d32b531daf35d527493d699',tolerances=dict(analytic=1e-7,stationBezierMm=.03,tipBezierMm=.04,offsetBezierMm=.11,boundsBezierMm=.11,encodedMm=.00051,pdfArcRadialMm=.04),units=units,extensions=[],reducers=[])
(P/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':'))+'\n')
print(hashlib.sha256((P/'manifest.json').read_bytes()).hexdigest(), '12 sequences / 48 checkpoints frozen')
