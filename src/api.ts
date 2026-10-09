import {RoleSchema,type Role,type SessionView} from '../shared/domain';
export type Join={id:string;token:string;role:Role};
const base=(import.meta.env.VITE_API_URL||'').replace(/\/$/,'');
export async function request<T>(path:string,token:string,body?:unknown):Promise<T>{
  const response=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(29000)});
  const data=await response.json();if(!response.ok)throw new Error(data.error||`Request failed (${response.status})`);return data;
}
export const getSession=(j:Join)=>request<SessionView>(`/sessions/${j.id}`,j.token);
export async function openPlatform():Promise<Join>{
  const response=await fetch(import.meta.env.DEV?'/api/platform':'/platform.json',{cache:'no-store'});
  if(!response.ok)throw new Error('Could not open the platform. Please retry.');
  const platform=await response.json() as {id:string;farmer:string;buyer:string};
  const role=location.pathname.startsWith('/buyer')?'buyer':'farmer';
  const j:Join={id:platform.id,token:platform[role],role};
  sessionStorage.setItem('parali-join-'+location.pathname,JSON.stringify(j));
  return j;
}
export function joinLink(id:string,token:string,role:Role){return `${location.origin}/${role}#session=${id}&token=${token}&role=${role}`;}
export function loadJoin():Join|null{const h=new URLSearchParams(location.hash.slice(1));if(h.has('setup')){sessionStorage.removeItem('parali-join-'+location.pathname);return null;}if(h.has('session')&&h.has('token')){const role=RoleSchema.safeParse(h.get('role'));if(!role.success)return null;const j={id:h.get('session')!,token:h.get('token')!,role:role.data};sessionStorage.setItem('parali-join-'+location.pathname,JSON.stringify(j));history.replaceState(null,'',location.pathname);return j;}try{const j=JSON.parse(sessionStorage.getItem('parali-join-'+location.pathname)||'null');return j&&typeof j.id==='string'&&typeof j.token==='string'&&RoleSchema.safeParse(j.role).success?j:null;}catch{return null;}}
