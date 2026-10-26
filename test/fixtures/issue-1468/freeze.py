"""Sealed pre-execution design ledger. Uses no nuinuiCAD compiler/evaluator/output."""
import hashlib,json,math
from pathlib import Path
root=Path(__file__).parent
point=lambda x,y:{'x':x,'y':y}
def line(a,b):return {'kind':'line','start':point(*a),'end':point(*b)}
def curve(points):return {'kind':'bezierCurve','segments':[dict(zip(['start','control1','control2','end'],[point(*p) for p in points]))]}
header='''nui 1
// sewing workflow: preserve this comment and blank lines
profile Plot
style Ink {
  width: 1px,
  color: #123456,
  for @Plot {
    width: 2px,
  }
}

'''
tail='\n// end sentinel\n'
f1=header+'''const width: number = 80 // editable bust
const height: number = 140 // independent length

group Bodice [Ink] {
  point Origin = coordinate(x: 0, y: 0)
  point Waist = coordinate(x: @width, y: 0)
  line Bottom = segment(start: @Origin, end: @Waist)
  line Side = segment(start: @Waist, end: (@width - 10, @height - 10))
  curve Neck = bezier(start: (0, @height), end: (40, @height - 20), startAngle: 0, startLength: 20, endAngle: 270, endLength: 10)
  line Reference = segment(start: (0, -20), end: (100, -20))
  text Caption = label(text: "BODICE", anchor: (5, 5), size: 3)
}
group Control [Ink] {
  line Edge = segment(start: (0, 0), end: (13, 7))
}
layout Sheet {
  place @Bodice(at: (13, -7), scale: 1, angle: 0, mirror: false)
  place @Control(at: (160, -10), scale: 1, angle: 0, mirror: false)
}
svg Vector(layout: @Sheet, profile: @Plot, margin: 3)
print Paper(layout: @Sheet, profile: @Plot, paper: a4, orientation: portrait, overlap: 10)
'''+tail
f2=header+'''module Sleeve(span: number = 60, lift: number = 40) {
  export curve Cap = bezier(start: (0, 0), end: (@span, @lift), startAngle: 90, startLength: 20, endAngle: 0, endLength: 15)
  move Cap as staged(from: (0, 0), to: (7, -3), scale: 1, angleDeg: 0, mirrorX: false)
  reverse Cap as turned()
  export line Hem = segment(start: (0, -20), end: (@span, -20))
}
group Sleeves [Ink] {
  instance Left = Sleeve(span: 60, lift: 40)
  instance Right = Sleeve(span: 85, lift: 25)
  move Right(from: (0, 0), to: (120, -10), scale: 1, angleDeg: 0, mirrorX: false)
  const count: number = 2
  const chosen: number = 1
  for i in range(min: 0, max: @count, step: 1) {
    line Tick = segment(start: (@i * 10, -40), end: (@i * 10, -35))
  }
  point Pick = offset(from: @Tick[@chosen].end, dx: 2, dy: 3)
  line Probe = segment(start: (0, -32), end: @Pick)
  path Stage = from(source: @Left::Cap.turned)
  text Caption = label(text: "SLEEVE", anchor: (3, -10), size: 3)
}
layout Sheet {
  place @Sleeves(at: (11, 5), scale: 1, angle: 0, mirror: false)
}
svg Vector(layout: @Sheet, profile: @Plot, margin: 3)
print Paper(layout: @Sheet, profile: @Plot, paper: a4, orientation: portrait, overlap: 10)
'''+tail
f3=header+'''group Front [Ink] {
  point Base = coordinate(x: 3, y: -4)
  point Tip = coordinate(x: 103, y: -4)
  line Reference = segment(start: @Base, end: @Tip)
  move Reference as shifted(from: (0, 0), to: (7, 11), scale: 1, angleDeg: 0, mirrorX: false)
  line Outline = polyline(points: [(3, -4), (33, -4), (23, 46), (3, 66)], closed: false)
  text Caption = label(text: "FRONT", anchor: (5, 10), size: 3)
}
group Back [Ink] {
  point Base = coordinate(x: -5, y: 2)
  line Edge = segment(start: @Base, end: (45, 22))
  text Caption = label(text: "BACK", anchor: (0, 10), size: 3)
}
layout Sheet(scale: 1) {
  place @Front(origin: @Front::Base, at: (20, -30), scale: 1, angle: 0, mirror: false)
  place @Back(origin: @Back::Base, at: (240, 50), angle: 0, mirror: false)
}
svg Vector(layout: @Sheet, profile: @Plot, margin: 3)
print Paper(layout: @Sheet, profile: @Plot, paper: a4, orientation: portrait, overlap: 10)
'''+tail
# Design-level transforms, independent of the production compiler and planner.
def mapped(g,fn):
 if isinstance(g,dict):
  if set(g)=={'x','y'}:return point(*fn(g['x'],g['y']))
  return {k:mapped(v,fn) for k,v in g.items()}
 if isinstance(g,list):return [mapped(v,fn) for v in g]
 return g
pad=25.4/96 # 2px stroke / 2, physical width is not scaled by placement.
def output(bounds,drawables,paper=(210,297),overlap=10):
 b=[bounds[0]-pad,bounds[1]-pad,bounds[2]+pad,bounds[3]+pad]
 w,h=b[2]-b[0],b[3]-b[1]
 sx,sy=paper[0]-2*overlap,paper[1]-2*overlap
 cols,rows=math.ceil(w/sx),math.ceil(h/sy)
 return {'bounds':dict(zip(['minX','minY','maxX','maxY'],b)),'drawables':drawables,'svgMm':[w+6,h+6], 'paperMm':paper,'overlap':overlap,'stride':[sx,sy],'columns':cols,'rows':rows,'pageOrigins':[[b[0]-overlap+c*sx,b[1]-overlap+r*sy] for r in range(rows) for c in range(cols)]}
def a(w=80,h=140):
 geom={'Bodice::Origin':{'kind':'point',**point(0,0)},'Bodice::Waist':{'kind':'point',**point(w,0)},'Bodice::Bottom':line((0,0),(w,0)),'Bodice::Side':line((w,0),(w-10,h-10)),'Bodice::Neck':curve([(0,h),(20,h),(40,h-10),(40,h-20)]),'Bodice::Reference':line((0,-20),(100,-20)),'Control::Edge':line((0,0),(13,7))}
 draw={k:mapped(g,lambda x,y:(x+13,y-7)) for k,g in geom.items() if g['kind'] not in ['point'] and k!='Control::Edge'}
 draw['Control::Edge']=line((160,-10),(173,-3))
 return geom,output([13,-27,173,h-7],draw)
def b(span=60,lift=40,count=2,chosen=1,turned=False):
 g={}
 for name,w,h,dx,dy in [('Left',span,lift,0,0),('Right',85,25,120,-10)]:
  pts=[(0,0),(0,20),(w-15,h),(w,h)]
  fn=(lambda x,y:(7-y,-3-x)) if turned else (lambda x,y:(x+7,y-3))
  cap=mapped(curve(list(reversed(pts))),lambda x,y:tuple(sum(p) for p in zip(fn(x,y),(dx,dy))))
  g['Sleeves::'+name+'::Cap']=cap
  g['Sleeves::'+name+'::Hem']=line((dx,-20+dy),(w+dx,-20+dy))
 g['Sleeves::Stage']={**g['Sleeves::Left::Cap']} # materializedPath preserves the concrete source geometry kind.
 g['Sleeves::Pick']={'kind':'point',**point(10*chosen+2,-32)}
 g['Sleeves::Probe']=line((0,-32),(10*chosen+2,-32))
 bounds=[7-lift,-98,205,-3] if turned else [0,-40,212,max(lift-3,12)]
 draw={k:mapped(v,lambda x,y:(x+11,y+5)) for k,v in g.items() if v['kind']!='point'}
 for i in range(count+1):draw['Tick['+str(i)+']']=line((10*i+11,-35),(10*i+11,-30))
 return g,output(bounds if False else [bounds[0]+11,bounds[1]+5,bounds[2]+11,bounds[3]+5],draw)
def c(tip=103,baked=False,rotated=False):
 g={'Front::Base':{'kind':'point',**point(3,-4)},'Front::Tip':{'kind':'point',**point(tip,-4)},'Front::Reference':line((10,7),(tip+7,7)),'Front::Outline':{'kind':'polyline','segments':[line((3,-4),(33,-4)),line((33,-4),(23,46)),line((23,46),(3,66))]},'Back::Edge':line((-5,2),(45,22))}
 if baked:g['Front::Reference_bake']=line((10,7),(110,7))
 draw={}
 for k,v in g.items():
  if v['kind']=='point':continue
  fn=(lambda x,y:(-20-2*(y+4),40-2*(x-3))) if rotated else (lambda x,y:(20+x-3,-30+y+4))
  if k.startswith('Back'):fn=(lambda x,y:(260-1.5*(x+5),-50-1.5*(y-2))) if rotated else (lambda x,y:(240+x+5,50+y-2))
  draw[k]=mapped(v,fn)
 bounds=[-160,40-2*(tip+4),260,40] if rotated else [20,-30,290,70]
 return g,output(bounds,draw,paper=(297,210) if rotated else (210,297),overlap=12 if rotated else 10)
units=[]
def step(source,revision,oracle,action,**extra):
 geom,out=oracle if oracle else ({},None)
 return {'action':action,'source':source,'sha256':hashlib.sha256(source.encode()).hexdigest(),'sourceRevision':revision,'geometry':geom,'output':out,**extra}
def unit(id,fixture,steps):units.append({'id':id,'fixture':fixture,'checkpoints':steps})
s=f1
unit('A1','F1',[step(s,1,a(),'commitText initial; compile; production Rust; plan and encode SVG/PDF')])
s=s.replace('number = 80','number = 83')
unit('A2','F1',[step(s,2,a(83),'commitLineSplices width 80→83')])
s3=s.replace('number = 83','number = 87');s4=s3.replace('number = 140','number = 144')
unit('A3','F1',[step(s3,3,a(87),'commit width 83→87'),step(s4,4,a(87,144),'commit height 140→144'),step(s3,5,a(87),'source history undo'),step(s,6,a(83),'source history undo')])
s=s.replace('const width:','const bustWidth:').replace('@width','@bustWidth')
unit('A4','F1',[step(s,7,a(83),'planDslRenameEditsResult + canonical semantic rename splices width→bustWidth'),step(s.replace('number = 83','number = 84'),8,a(84),'queryDslSourceValueStep 83→84; editor commitText')])
s=f2;s2=s.replace('Left = Sleeve(span: 60','Left = Sleeve(span: 63')
unit('B1','F2',[step(s,1,b(),'initial production Rust + Module Preview arguments span60 lift40'),step(s2,2,b(63),'single Left argument patch; independent Right at offset120,-10; preview ephemeral root span63 lift40')])
s3=s2.replace('count: number = 2','count: number = 3');s4=s3.replace('chosen: number = 1','chosen: number = 2')
unit('B2','F2',[step(s3,3,b(63,count=3),'count 2→3; inclusive occurrences 0..3'),step(s4,4,b(63,count=3,chosen=2),'selector 1→2; Pick22,-32; Probe length22')])
s5=s4.replace('angleDeg: 0, mirrorX: false)\n  reverse','angleDeg: 90, mirrorX: true)\n  reverse')
unit('B3','F2',[step(s5,5,b(63,count=3,chosen=2,turned=True),'change Module stage: mirror X then rotate90 then shift7,-3 then reverse')])
s6=s5.replace('Left = Sleeve(span: 63, lift: 40)','Left = Sleeve(span: 63, lift: @MissingLift)');s7=s5.replace('Left = Sleeve(span: 63, lift: 40)','Left = Sleeve(span: 63, lift: 44)')
unit('B4','F2',[step(s6,6,None,'invalid dependency; diagnostics; MCP must not return evaluated/current success',expectedStatus='source-unavailable-or-ineligible'),step(s7,7,b(63,44,count=3,chosen=2,turned=True),'correct newer source; reject any result/projection for earlier revision; persistent Rust + encode')])
s=f3
bake='  line Reference_bake = segment(start: (10, 7), end: (110, 7))\n'
s2=s.replace('  move Reference',bake+'  move Reference')
unit('C1','F3',[step(s,1,c(),'initial production pipeline'),step(s2,2,c(baked=True),'planBakeGeometry current Front::Reference; applyBakePlan source insertion; preserve original recipe')])
converted='  point Tip = offset(\n    from: @Base,\n    dx: 100,\n    dy: 0,\n  )'
s3=s2.replace('  point Tip = coordinate(x: 103, y: -4)',converted);s4=s3.replace('dx: 100','dx: 101')
unit('C2','F3',[step(s3,3,c(baked=True),'coordinate conversion Tip relative Base xy100,0; canonical splice'),step(s4,4,c(104,True),'Source Value Step dx100→101; baked100 reference and Back unaffected')])
s5=s4.replace('Sheet(scale: 1)','Sheet(scale: 1.5)').replace('at: (20, -30), scale: 1, angle: 0, mirror: false','at: (-20, 40), scale: 2, angle: 90, mirror: true').replace('at: (240, 50), angle: 0','at: (260, -50), angle: 180').replace('orientation: portrait, overlap: 10','orientation: landscape, overlap: 12')
unit('C3','F3',[step(s5,5,c(104,True,True),'one supported source-splice commit: profile widths remain2px, layout fallback scale1.5, Front explicit2 mirror/rotate90, Back rotate180, asymmetric placement, A4 landscape overlap12')])
unit('C4','F3',[step(s5,1,c(104,True,True),'save exact single-file bytes; fresh canonical store reopen starts sourceRevision1; MCP saved-source hash matches'),step(s5.replace('dx: 101','dx: 102'),2,c(105,True,True),'Source Value Step reopened dx101→102; save; Rust; exact-current projections; SVG/PDF')])
manifest={'issue':1468,'base':'c7ae3500f16d6e17dfb7bffd57365c967e1c4e5c','sealedBeforeExploration':True,'series':'A1→A4, B1→B4, C1→C4; cumulative within each fixture','tolerances':{'geometryMm':1e-7,'encodedSvgMm':0.00051,'encodedPdfPt':0.00051},'independentDerivation':'Cartesian endpoint/handle vector arithmetic; mirror local X before rotation then translation; reversal swaps controls/endpoints. Curves chosen coordinate-monotonic so endpoint bounds exact. Stroke halfwidth=25.4/96 mm. SVG x=x-bounds.minX+3; y=bounds.maxY+3-y. PDF x=(x-page.origin.x)*72/25.4; y=(y-page.origin.y)*72/25.4. Page counts ceil stroke-inclusive extent/(paper-2*overlap), row-major origins. Text strictly inside bounds; labels BODICE/SLEEVE/FRONT/BACK must encode. No approximate curve-length oracle claimed.','sourceInvariants':['every untouched physical line/comment byte identical','every existing statement/element identity retained through edits and source history','new Bake declaration independent from original live source','new source and request revisions cannot accept stale results','fresh reopen resets document identities; compare source-qualified geometry not generated ID strings'],'negativeControls':['wrong nonzero dimension delta must fail numeric oracle','swap Left/Right or leak sibling edit must fail','wrong generated index/count must fail','omit mirror or reverse must fail endpoints/controls','stale source hash/revision or prior valid geometry must not count as new success','remove Bake must fail declaration/geometry check','use CSS pixels as mm or omit72/25.4 must fail encoded reference/page measures','floor tile count or single-inset stride must fail page origins/count'],'operationSupport':'existing production source-command planners and store commitText/commitLineSplices/undo; no GUI or TS evaluator substitute','artifactAssertions':['parse actual SVG paths/mm dimensions/viewBox; cubic control geometry and lines in authored order','parse actual PDF pages, MediaBox points, content m/l/c operators, physical reference geometry on each tile, text operators and guide positions','both encoders through the same persistent Rust stdio process as evaluation'],'units':units,'limits':{'primary':12,'X':8,'R':8},'quota':'UNAVAILABLE'}
root.joinpath('manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
for name,source in [('F1',f1),('F2',f2),('F3',f3)]:root.joinpath(name+'.nui').write_text(source)
