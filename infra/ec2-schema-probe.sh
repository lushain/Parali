#cloud-boothook
#!/bin/bash
shutdown -h +30
cat > /opt/parali-schema-probe.sh <<'PROBE'
#!/bin/bash
set -euo pipefail
exec > >(tee -a /var/log/parali-schema-probe.log /dev/console) 2>&1
trap 'echo PARALI_SCHEMA_FINISHED; shutdown -h +3' EXIT
echo PARALI_SCHEMA_START
export OLLAMA_HOST=127.0.0.1:11434
export OLLAMA_NUM_PARALLEL=1
ollama serve >/var/log/parali-ollama.log 2>&1 &
for i in $(seq 1 60); do
  if curl --silent --fail http://127.0.0.1:11434/api/version; then break; fi
  sleep 2
done
ollama pull qwen3:8b >/var/log/parali-model-pull.log 2>&1
python3 - <<'PY'
import json, time, urllib.request
fields={'crop':{'enum':['paddy','wheat',None]},'area':{'type':['number','null'],'minimum':0.01,'maximum':500},'unit':{'enum':['acre','hectare',None]},'village':{'type':['string','null'],'minLength':2},'availableDate':{'type':['string','null']},'deadline':{'type':['string','null']},'access':{'enum':['truck','tractor','restricted',None]}}
schema={'type':'object','required':['patch','reply'],'additionalProperties':False,'properties':{'patch':{'type':'object','additionalProperties':False,'properties':fields},'reply':{'type':'string','minLength':1,'maxLength':450}}}
system='You help a farmer arrange crop-residue collection. Extract ONLY new facts/corrections in latestUtterance into patch. Omit unknown and unchanged fields. Use paddy for धान, acre for एकड़. Reply in natural Hindi with ONE question about the next missing detail. Unknown details: village, availability date, clearing deadline, vehicle access. Do not invent them. Corrections override earlier values. Never calculate tonnes or prices. Current draft is confirmed context. Return JSON matching this schema: '+json.dumps(schema)
draft={}
for text in ['मेरे पास पाँच एकड़ धान की पराली है।','पाँच नहीं, छह एकड़।','गाँव सुनाम है। ट्रैक्टर आ सकता है लेकिन ट्रक नहीं।']:
    payload={'model':'qwen3:8b','stream':False,'think':False,'format':schema,'options':{'num_ctx':4096,'num_predict':250,'num_thread':8,'temperature':0},'messages':[{'role':'system','content':system},{'role':'user','content':json.dumps({'currentDraft':draft,'latestUtterance':text},ensure_ascii=False)}]}
    started=time.monotonic()
    request=urllib.request.Request('http://127.0.0.1:11434/api/chat',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(request,timeout=240) as response: result=json.load(response)
    proposal=json.loads(result['message']['content'])
    print('PARALI_SCHEMA_RESULT',json.dumps({'input':text,'proposal':proposal,'seconds':round(time.monotonic()-started,2),'model':result['model']},ensure_ascii=True),flush=True)
    draft.update(proposal['patch'])
PY
PROBE
runuser -l root -c '/bin/bash /opt/parali-schema-probe.sh' &
