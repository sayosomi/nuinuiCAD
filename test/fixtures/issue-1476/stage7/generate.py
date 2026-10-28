import pathlib,json,hashlib,subprocess,datetime
repo=pathlib.Path('/Users/yosomi/Code/nuinuiCAD'); out=pathlib.Path(__file__).parent
roots=['nui1-typed-geometry-property-forward','nui1-geometry-value-module-runtime-order','nui1-geometry-value-module-export','nui1-module-scalar-blocking','nui1-element-property-conditional','nui1-choice-geometry-properties','nui1-linear-mutation-terminal','nui1-geometry-value-coordinate-line']
def p(x,y): return {'kind':'point','x':x,'y':y}
def l(a,b): return {'kind':'line','start':p(*a),'end':p(*b)}
# These expectations are arithmetic from immutable authored sources and normative spec,
# established before compiler preparation or either evaluator executes.
oracles=[
 {'geometry':{'A':p(0,0),'B':p(10,0),'Later':l((0,0),(10,0)),'C':p(10,0)},'scalars':{'x':10},'lengths':{'Later':10}},
 {'geometry':{'EarlierA':p(-10,1),'EarlierB':p(-20,2),'EarlierC':p(-30,3),'Source':p(0,42),'Use':l((7,42),(0,42))},'pure':{'I::P':p(7,42)}},
 {'geometry':{'Use':l((10,20),(30,20))},'pure':{'I::P':p(10,20),'I::L':l((10,20),(30,20))}},
 {'geometry':{'Base':p(10,0),'X::A':l((0,0),(10,0)),'X::P':p(10,0),'Y::Q':p(10,0),'LoopInstance::P':[p(1,1),p(2,1)],'OuterInstance::Nested::NestedPoint':[p(1,2),p(2,2)],'CallerInstance::CallerPoint':[p(1,3),p(2,3)],'ConditionalTrue::CallerPoint':p(40,3),'MixedInstance::MixedPoint':[p(11,4),p(12,4)]},'absent':['ConditionalFalse::CallerPoint'],'moduleScalars':{'X::length':10,'Y::width':10,'LoopInstance::local':[1,2],'OuterInstance::Nested::width':[1,2],'CallerInstance::x':[1,2],'ConditionalTrue::x':40,'MixedInstance::base':10,'MixedInstance::local':[10,10]},'iterationValues':[1,2],'lengths':{'X::A':10}},
 {'geometry':{'A':p(0,0),'B':p(30,40),'AB':l((0,0),(30,40)),'Active':p(1,1),'AlwaysShown':p(4,4)},'absent':['Inactive','NeverShown'],'conditions':[True,False],'lengths':{'AB':50}},
 {'geometry':{'A':p(0,0),'B':p(10,0),'Base':l((0,0),(10,0)),'Arc':{'kind':'arc','center':p(0,0),'radius':40,'startDeg':15,'endDeg':155,'direction':'clockwise'},'Off':{'kind':'polyline','points':[p(0,-10),p(10,-10)],'closed':False},'Off2':{'kind':'polyline','points':[p(0,-20),p(10,-20)],'closed':False},'Note':{'kind':'text','text':'clockwise=true','fontSize':3}},'scalars':{'direction':'clockwise','isClockwise':True,'copied':'clockwise'},'lengths':{'Base':10}},
 {'geometry':{'A':p(0,0),'B':p(3,4),'AB':l((0,0),(3,4)),'Marker':p(1,1),'Label':{'kind':'text','text':'new 7','fontSize':3}},'scalars':{'value':7,'mirror':7,'label':'new','flag':True,'side':'left'},'carryInitial':{'value':5,'mirror':0,'label':'old','flag':False,'side':'right'},'carryIncoming':[{'value':5,'mirror':0,'label':'old','flag':False,'side':'right'},{'value':7,'mirror':5,'label':'new','flag':True,'side':'left'}],'carryNext':[{'value':7,'mirror':5,'label':'new','flag':True,'side':'left'},{'value':7,'mirror':7,'label':'new','flag':True,'side':'left'}],'iterationValues':[0,1],'lengths':{'AB':5}},
 {'geometry':{'L':l((10,20),(30,20))},'pure':{'P':p(10,20)}}]
def bjson(v): return (json.dumps(v,ensure_ascii=False,indent=2)+'\n').encode()
def h(b): return hashlib.sha256(b).hexdigest()
ledger=[]
for ri,(root,oracle) in enumerate(zip(roots,oracles),1):
 original=(repo/'test/fixtures/evaluation'/f'{root}.nui').read_bytes()
 assert original==subprocess.check_output(['git','show',f'd69e1baf31bf48344f7da8df5118e5944f073e3e:test/fixtures/evaluation/{root}.nui'],cwd=repo)
 assert original.startswith(b'nui 1\n')
 assert b'Stage7Pad' not in original
 for si,count in enumerate([0,64,64,256]):
  pads=''.join(f'point Stage7Pad{n:03d} = coordinate(x: {n}, y: 0 - {n})\n' for n in range(1,count+1)).encode()
  source=original if si==0 else original[:6]+pads+original[6:] if si==1 else original+(b'' if original.endswith(b'\n') else b'\n')+pads
  cell=f'R{ri}-S{si}'
  expected={**oracle,'padPoints':{f'Stage7Pad{n:03d}':p(n,-n) for n in range(1,count+1)},'errors':[],'warnings':[],'relativeOrder':'authored original declarations and deterministic zero-based loop occurrences; prefix padding may shift absolute indices'}
  ob=bjson(expected)
  sp=out/'sources'/f'{cell}.nui';op=out/'oracles'/f'{cell}.json'
  assert not sp.exists() and not op.exists()
  sp.write_bytes(source);op.write_bytes(ob)
  ledger.append({'id':cell,'root':root+'.nui','originalSha256':h(original),'sourceSha256':h(source),'oracleSha256':h(ob),'pads':count})
(out/'source-oracle-seal.json').write_bytes(bjson({'base':'d69e1baf31bf48344f7da8df5118e5944f073e3e','sealedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'normativeSpecSha256':h((repo/'docs/nui1/spec.md').read_bytes()),'cells':ledger}))
print('Frozen exactly',len(ledger),'sources and source-derived independent oracles before execution')
