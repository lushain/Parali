import { readFile,writeFile,mkdir } from 'node:fs/promises';
const key=await readFile('.local/setup-key','utf8');
const response=await fetch('http://127.0.0.1:8787/api/sessions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:'{}'});
if(!response.ok)throw new Error('Local API must be running before creating join links.');
const {session,tokens}=await response.json();
const origin=process.env.DEMO_ORIGIN||'http://localhost:5173';
const links=Object.fromEntries(Object.entries(tokens as Record<string,string>).map(([role,token])=>[role,`${origin}/${role}#session=${session.id}&token=${token}&role=${role}`]));
await mkdir('.local',{recursive:true});await writeFile('.local/demo-links.json',JSON.stringify({label:session.label,id:session.id,links},null,2));await writeFile('.local/demo-links.md',`# Private rehearsal links — ${session.label}\n\nKeep these capability links out of public recordings and Git.\n\n`+Object.entries(links).map(([role,url])=>`- [Open ${role}](${url})`).join('\n'));
console.log(`Created fresh ${session.label}. Private join links: .local/demo-links.md`);
