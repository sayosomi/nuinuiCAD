import json,math,pathlib,sys,hashlib,copy
p=pathlib.Path(__file__).parent
phase=sys.argv[1] if len(sys.argv)>1 else 'base'
def load(f):return json.loads((p/f).read_text())
def equal(a,b,path=''):
 if isinstance(b,(float,int)) and not isinstance(b,bool): assert isinstance(a,(float,int)) and abs(a-b)<1e-8*max(1,abs(b)),(path,a,b)
 elif isinstance(b,dict):
  for k,v in b.items(): assert k in a,(path,k,a);equal(a[k],v,path+'.'+k)
 elif isinstance(b,list):
  assert len(a)==len(b),(path,len(a),len(b))
  for i,(av,bv) in enumerate(zip(a,b)):equal(av,bv,path+f'[{i}]')
 else: assert a==b,(path,a,b)
def check(cell,input,d,o):
 elements=input['elements']; byid={e['id']:e for e in elements}; rows=d.get('forGroupGeneratedRows',[]);rowbyid={r['generatedElementId']:r for r in rows}
 def q(eid):
  e=byid[eid]; parent=e.get('parentGroupId');parts=[]
  while parent:
   par=byid[parent]
   if par['type']=='moduleInstance':parts.insert(0,par['name'])
   parent=par.get('parentGroupId')
  return '::'.join(parts+[e['name']])
 def key(g): return q(rowbyid[g['elementId']]['templateElementId'] if g['elementId'] in rowbyid else g['elementId'])
 groups={}
 for g in d['computedGeometry']: groups.setdefault(key(g),[]).append(g)
 expect={**o['geometry'],**o['padPoints']}
 assert set(groups)==set(expect),(cell,'drawable membership',set(groups)^set(expect))
 def geom(a,b):
  kind=b['kind']
  if kind in ['point','line','text']:
   equal(a,b)
   if kind=='text':assert a['anchor'] is None
   if kind=='line':
    dx=b['end']['x']-b['start']['x'];dy=b['end']['y']-b['start']['y'];angle=math.degrees(math.atan2(dy,dx))%360
    equal(a,{'length':math.hypot(dx,dy),'startAngleDeg':angle,'endAngleDeg':(angle+180)%360,'startTangentAngleDeg':angle,'endTangentAngleDeg':(angle+180)%360})
  elif kind=='arc':
   equal(a,{'kind':'arcLine','center':b['center'],'radius':b['radius'],'startAngleDeg':b['startDeg'],'endAngleDeg':b['endDeg'],'sweepAngleDeg':-220,'length':40*220*math.pi/180,'startTangentAngleDeg':285,'endTangentAngleDeg':245})
   for name,deg in [('start',15),('end',155)]:equal(a[name],{'x':40*math.cos(math.radians(deg)),'y':40*math.sin(math.radians(deg))})
  elif kind=='polyline':
   equal(a,{'kind':'offsetLine','closed':False,'offsetSide':'right','offsetDistance':abs(b['points'][0]['y']),'start':b['points'][0],'end':b['points'][1],'length':10,'startTangentAngleDeg':0,'endTangentAngleDeg':180})
   equal(a['segments'],[{'kind':'line','start':b['points'][0],'end':b['points'][1],'length':10}])
 for name,expected in expect.items():
  es=expected if isinstance(expected,list) else [expected];assert len(groups[name])==len(es),(cell,name,len(groups[name]),len(es))
  for actual,b in zip(groups[name],es):geom(actual,b)
 assert d['errors']==o['errors'];assert d['warnings']==o['warnings'];assert d.get('geometryValueErrors',[])==[]
 assert len(set(g['elementId'] for g in d['computedGeometry']))==len(d['computedGeometry'])
 assert d['evaluatedElementIds']==[e['id'] for e in elements],(cell,'authored order')
 # No in-place transformations are authored; every construction snapshot is unchanged.
 equal(d.get('preMutationGeometry',[]),d['computedGeometry'])
 pure=d.get('computedGeometryValues',[]); entries=input.get('geometryValueProgram',[])
 assert len(pure)==len(o.get('pure',{}))==len(entries),(cell,'pure membership')
 for actual,entry,b in zip(pure,entries,o.get('pure',{}).values()):
  assert actual['occurrence']==entry['occurrence'],(cell,'pure occurrence identity')
  if b['kind']=='point':equal(actual['value'],{'kind':'point','x':b['x'],'y':b['y']})
  else:
   # Pure line endpoints omit drawable point metadata by contract.
   expected=copy.deepcopy(b);expected['start'].pop('kind');expected['end'].pop('kind');equal(actual['value'],expected)
 traces=d.get('conditionEvaluationTraces',[])
 conditions=o.get('conditions', [False,True] if cell.startswith('R4') else [])
 equal([t['trace']['finalEvaluation']['value']['value'] for t in traces],conditions)
 if cell.startswith('R5'):
  for t in traces:equal([n['evaluation']['value']['value'] for n in t['trace']['nodes'] if n['kind']=='geometryProperty'],[50])
 scalar=d.get('computedScalarBindings',[])
 if cell.startswith('R4'):
  versions=input['bindingVersions']['versions'];history=d['computedScalarBindingVersions'];assert len(versions)==len(history)==9
  expected=[10,10,2,2,2,None,40,10,10]
  histories={h['versionId']:h for h in history}
  for v,value in zip(versions,expected):
   h=histories[v['versionId']];assert h['bindingId']==v['bindingId'];assert h['statementId']==v['statementId']
   if value is None:assert h['status']=='inactive-control';assert 'evaluation' not in h
   else:equal(h,{'status':'executed','evaluation':{'status':'ok','value':{'kind':'number','value':value}}})
  assert len(scalar)==3
  for s in scalar:equal(s,{'evaluation':{'status':'ok','value':{'kind':'number','value':10}}})
 else:
  expected=o.get('scalars',{});assert len(scalar)==len(expected),(cell,'scalar membership',len(scalar),len(expected))
  if cell.startswith('R7'):
   expectedbyid={c['bindingId']:expected[c['bindingId'].rsplit(':',1)[1]] for c in input['bindingVersions']['immutableForGroups'][0]['carries']}
  else:expectedbyid={s['bindingId']:v for s,v in zip(input.get('scalarProgram',{}).get('statements',[]),expected.values())}
  for s in scalar:equal(s['evaluation'],{'status':'ok','value':{'value':expectedbyid[s['bindingId']]}})
 if cell.startswith('R4'):
  expectedrows=[]
  for group in (e for e in elements if e['type']=='forGroup'):
   templates=[]
   for e in elements:
    parent=e.get('parentGroupId')
    while parent and parent!=group['id']:parent=byid[parent].get('parentGroupId')
    if parent==group['id']:templates.append(e)
   for index,n in enumerate([1,2]):
    for e in templates:expectedrows.append({'forGroupId':group['id'],'templateElementId':e['id'],'generatedElementId':f"{e['id']}@{group['id']}:{index}",'iterationIndex':index,'occurrencePath':[{'templateForGroupId':group['id'],'iterationIndex':index}],'variableName':'i','variableValue':n,'elementName':f"[i={n}] {e['name']}",'elementType':e['type']})
  assert rows==expectedrows,(cell,'rows/occurrence/order')
 else:assert rows==[]
 # Module snapshots must contain exactly their independently validated descendants,
 # with generated occurrence IDs and source instance order preserved.
 expected_snapshots=[]
 for instance in input.get('moduleMaterialization',{}).get('instances',[]):
  descendants=set(instance['descendantIds'])
  contents=[g for g in d['computedGeometry'] if (rowbyid[g['elementId']]['templateElementId'] if g['elementId'] in rowbyid else g['elementId']) in descendants]
  expected_snapshots.append({'instanceId':instance['instanceId'],'geometry':contents})
 equal(d.get('instanceBaseGeometry',[]),expected_snapshots)
 return {'geometryCount':len(d['computedGeometry']),'scalarCount':len(scalar),'pureCount':len(pure),'rowCount':len(rows),'conditions':conditions}
results=[]
for obs in load(phase+'-observations.json'):
 c=obs['id'];i=load('inputs/'+c+'.json');o=load('oracles/'+c+'.json');failures=[];proof={}
 for boundary in ['reference','actual']:
  try:proof[boundary]=check(c,i,obs[boundary],o)
  except Exception as e:failures.append(boundary+': '+str(e))
 results.append({'id':c,'semanticOracle':'FAIL' if failures else 'PASS','parity':obs['parity'],'failures':failures,'proof':proof})
(p/(phase+'-semantic-results.json')).write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results,indent=2))
assert all(x['semanticOracle']=='PASS' for x in results)
