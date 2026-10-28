import pathlib,json,collections,hashlib
p=pathlib.Path(__file__).parent
seal=json.loads((p/'input-seal-deterministic.json').read_text());rows={r['id']:r for r in seal['records']}
for phase in ['base','fixed','final']:
 groups={};request=None
 for line in (p/(phase+'-trace.ndjson')).read_text().splitlines():
  if not line.startswith('STAGE7 '):raise ValueError('Unexpected native diagnostic: '+line)
  event=json.loads(line[7:])
  if event['event']=='request-start':request=event['id'];groups[request]=[]
  groups[request].append(event)
 summary=[]
 assert len(groups)==32
 for n,(cell,r) in enumerate(rows.items(),1):
  events=groups[n];start=[e for e in events if e['event']=='readiness-start'];end=[e for e in events if e['event']=='readiness-end'];assert len(start)==len(end)
  queries=[e for e in events if e['event']=='source-order-query'];projection=[e for e in events if e['event']=='candidate-projection'];early=[e for e in events if e['event']=='early'];construct=[e for e in events if e['event']=='construct'];i=json.loads((p/'inputs'/f'{cell}.json').read_text());graph=i['scalarExpressionPayload']['conditionalDependencyGraph'];keys={e[side]['kind']+':'+e[side]['id'] for e in graph['edges'] for side in ['from','to']}
  calls=[{**s,**e,'event':'readiness'} for s,e in zip(start,end)]
  summary.append({'id':cell,'sourceSha256':r['sourceSha256'],'inputSha256':r['inputSha256'],'oracleSha256':r['oracleSha256'],'compiler':'LEGAL','rustEligible':r['rustEligible'],'graph':{'V':len(keys),'E':len(graph['edges']),'bytes':r['graph']['bytes']},'constructionCalls':len(construct),'constructionEdgeRecords':sum(e['E'] for e in construct),'sourceOrderQueries':len(queries),'noResolverQueries':sum(not e['resolver'] for e in queries),'bindingVersionCount':len(i.get('bindingVersions',{}).get('versions',[])),'linearBindingVersionCount':sum(v['control']['kind']=='linear' for v in i.get('bindingVersions',{}).get('versions',[])),'executionPositionCounts':dict(collections.Counter(e['positions'] for e in queries)),'candidateHistogram':dict(collections.Counter(len(e['candidates']) for e in start)),'candidateCountTotal':sum(len(e['candidates']) for e in start),'maxCandidates':max([len(e['candidates']) for e in start]or[0]),'readinessCalls':len(start),'nonemptyCalls':sum(bool(e['candidates']) for e in start),'topologyBuildEdgeVisits':sum(e['edgeVisits'] for e in end),'dependencyEdgeVisits':sum(e['dependencyEdgeVisits'] for e in end),'earlyProjectionCalls':len(early),'earlyProjectionEdgeVisits':sum(e['edgeVisits'] for e in early),'maxEarlyBindings':max([e['early'] for e in early]or[0]),'perCall':calls})
 (p/(phase+'-graph-work.json')).write_text(json.dumps(summary,indent=2)+'\n')
 print(phase)
 for r in summary:print(r['id'],r['graph'],'calls',r['readinessCalls'],'nonempty',r['nonemptyCalls'],'max',r['maxCandidates'],'rebuild',r['topologyBuildEdgeVisits'],'dep',r['dependencyEdgeVisits'],'early',r['earlyProjectionEdgeVisits'])
