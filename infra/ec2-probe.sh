#cloud-boothook
#!/bin/bash
# cloud-init has no HOME; run the benchmark under a normal root login environment.
shutdown -h +30
cat > /opt/parali-probe.sh <<'PARALI_SCRIPT'
#!/bin/bash
# Disposable, no-credentials compute probe. No inbound ports or IAM role required.
set -euo pipefail
exec > >(tee -a /var/log/parali-probe.log /dev/console) 2>&1
shutdown -h +30
trap 'echo PARALI_PROBE_FINISHED; shutdown -h +3' EXIT
echo PARALI_PROBE_START
dnf install -y zstd tar python3
curl --fail --location --retry 2 --max-time 600 https://ollama.com/download/ollama-linux-amd64.tar.zst -o /tmp/parali-ollama.tar.zst
tar --zstd -xf /tmp/parali-ollama.tar.zst -C /usr
export OLLAMA_HOST=127.0.0.1:11434
export OLLAMA_NUM_PARALLEL=1
ollama serve >/var/log/parali-ollama.log 2>&1 &
for i in $(seq 1 60); do
  if curl --silent --fail http://127.0.0.1:11434/api/version; then break; fi
  sleep 2
done
echo PARALI_MODEL_DOWNLOAD
ollama pull qwen3:4b >/var/log/parali-model-pull.log 2>&1
python3 - <<'PY'
import json, time, urllib.request
system = 'Help a farmer collect crop residue. Return JSON only with patch and reply. patch may include crop (paddy/wheat), area (number), unit (acre/hectare), village. Extract only explicit facts; corrections override earlier values. reply must be one short relevant Hindi follow-up. Never invent a village, date, estimate or price.'
messages = [{'role':'system','content':system}]
for utterance in ['मेरे पास पाँच एकड़ धान की पराली है।', 'पाँच नहीं, छह एकड़।']:
    messages.append({'role':'user','content':utterance})
    body = {'model':'qwen3:4b','messages':messages,'stream':False,'think':False,'format':'json','options':{'num_ctx':2048,'num_predict':180,'num_thread':8,'temperature':0.1}}
    start = time.monotonic()
    request = urllib.request.Request('http://127.0.0.1:11434/api/chat',data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(request,timeout=300) as response:
        result = json.load(response)
    content = result['message']['content']
    print('PARALI_LLM_RESULT', json.dumps({'input':utterance,'output':content,'seconds':round(time.monotonic()-start,2),'model':result.get('model'),'tokens':result.get('eval_count')},ensure_ascii=True),flush=True)
    json.loads(content)
    messages.append({'role':'assistant','content':content})
PY
PARALI_SCRIPT
runuser -l root -c '/bin/bash /opt/parali-probe.sh' &
