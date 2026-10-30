"""Bounded, reproducible final gates. Run from the repository root."""
import datetime
import gzip
import json
import subprocess
import sys
from pathlib import Path
P=Path(__file__).parent
rust=['--manifest-path','rust-evaluator/Cargo.toml']
groups={
 'static':[['npm','run','build'],['npm','run','lint'],['npm','run','docs:dsl:check']],
 'final-regression':[['npm','test','--','--maxWorkers=2']],
 'javascript':[['npm','test','--','--maxWorkers=2'],['npm','run','test:parity']],
 'rust':[['cargo','fmt',*rust,'--check'],['cargo','check',*rust],['cargo','test',*rust],['cargo','clippy',*rust,'--all-targets','--','-D','warnings']],
}
results=[]
for i,cmd in enumerate(groups[sys.argv[1]]):
 start=datetime.datetime.now(datetime.timezone.utc)
 try:
  r=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=600)
  code=r.returncode;data=r.stdout
 except subprocess.TimeoutExpired as e:
  code=124;data=e.stdout or b''
 log=f'{sys.argv[1]}-{i}.log.gz'
 (P/log).write_bytes(gzip.compress(data,mtime=0))
 results.append(dict(command=cmd,startedAt=start.isoformat(),finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),exit=code,log=log))
 (P/(sys.argv[1]+'-results.json')).write_text(json.dumps(results,indent=2)+'\n')
 print(' '.join(cmd),'EXIT',code,flush=True)
 print(data.decode(errors='replace')[-1800:],flush=True)
 if code:sys.exit(code)
