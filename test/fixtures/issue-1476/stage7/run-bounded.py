import os,sys,subprocess,time,json,signal,resource,pathlib
out=pathlib.Path(__file__).parent
label=sys.argv[1]; seconds=int(sys.argv[2]);cmd=sys.argv[3:]
def limits():
 os.setsid();resource.setrlimit(resource.RLIMIT_CORE,(0,0));resource.setrlimit(resource.RLIMIT_NOFILE,(1024,1024))
env=dict(os.environ);env.setdefault('NODE_OPTIONS','--max-old-space-size=4096');env.setdefault('CARGO_BUILD_JOBS','2')
start=time.time();timed=False
with (out/(label+'.log')).open('wb') as log:
 p=subprocess.Popen(cmd,stdout=log,stderr=subprocess.STDOUT,env=env,preexec_fn=limits)
 try: code=p.wait(timeout=seconds)
 except subprocess.TimeoutExpired:
  timed=True;os.killpg(p.pid,signal.SIGTERM)
  try: code=p.wait(timeout=5)
  except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);code=p.wait(timeout=5)
result={'command':cmd,'cwd':os.getcwd(),'pid':p.pid,'timeoutSeconds':seconds,'timedOut':timed,'exitCode':code,'elapsedSeconds':time.time()-start,'startedAtUnix':start,'finishedAtUnix':time.time()}
(out/(label+'.result.json')).write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result));sys.exit(code if code>=0 else 128-code)
