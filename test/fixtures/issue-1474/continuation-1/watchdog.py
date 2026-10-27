import os,sys,time,json,subprocess,signal
limit=float(sys.argv[1]);log=sys.argv[2];cmd=sys.argv[3:]
started=time.monotonic();peak=0;reason=None
with open(log,'wb') as out:
 p=subprocess.Popen(cmd,stdout=out,stderr=subprocess.STDOUT,start_new_session=True)
 last_size=0;progress=started;heartbeat=started
 while p.poll() is None:
  now=time.monotonic();size=os.stat(log).st_size
  if size!=last_size: progress=now;last_size=size
  rows=subprocess.check_output(['ps','-axo','pid=,ppid=,rss='],text=True)
  table=[list(map(int,r.split())) for r in rows.splitlines() if len(r.split())==3]
  owned={p.pid}
  for _ in range(10):
   found={pid for pid,ppid,rss in table if ppid in owned}
   if found<=owned: break
   owned|=found
  rss=sum(r for pid,ppid,r in table if pid in owned);peak=max(peak,rss)
  if now-started>limit:reason='wall deadline'
  elif now-progress>150:reason='no log progress for 150s'
  elif rss>6*1024*1024:reason='owned RSS exceeded 6GiB'
  if reason:
   os.killpg(p.pid,signal.SIGTERM)
   try:p.wait(5)
   except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait()
   break
  if now-heartbeat>20:
   print(json.dumps({'running':cmd,'elapsed':round(now-started,1),'rssKiB':rss,'logBytes':size}),flush=True);heartbeat=now
  time.sleep(.5)
 result={'command':cmd,'exit':p.returncode,'elapsedSeconds':time.monotonic()-started,'peakOwnedRssKiB':peak,'stopReason':reason}
open(log+'.result.json','w').write(json.dumps(result,indent=2)+'\n')
print(json.dumps(result),flush=True)
sys.exit(p.returncode if p.returncode is not None and p.returncode>=0 else 1)
