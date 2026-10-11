import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {ArrowRight,ArrowUpRight,Bell,CalendarDays,CheckCircle2,ChevronRight,Leaf,MapPin,Radio,Sprout,Tractor,Truck,Wheat,X} from 'lucide-react';
import {addDays,estimate,indiaToday,prettyDate,type Draft,type SessionView} from '../shared/domain';
import {demoField} from '../shared/field-location';

type Rect={left:number;top:number;width:number;height:number};
type Field={id:string;name:string;initials:string;color:string;draft:Draft;status:string;parcel:Rect;live?:boolean};
export type BuyerTab='supply'|'plan'|'activity';
export function BuyerBrand(){return <div className="buyer-company"><span><Leaf size={34}/></span><strong>Punjab <br/>Bioenergy<small>Sangrur collection desk</small></strong></div>;}

const userParcel:Rect={left:20.1,top:43,width:10.7,height:24.7};
function existingFields():Field[]{
 const today=indiaToday();
 return [
  {id:'PR-1042',name:'Harpreet Singh',initials:'HS',color:'#38bdf8',crop:'paddy',area:4.5,status:'Ready for collection',offset:2,parcel:{left:11,top:10,width:25,height:17}},
  {id:'PR-1039',name:'Gurpreet Kaur',initials:'GK',color:'#fbbf24',crop:'wheat',area:2,status:'Pickup scheduled',offset:1,parcel:{left:43,top:37,width:18,height:17.5}},
  {id:'PR-1036',name:'Baldev Singh',initials:'BS',color:'#c084fc',crop:'paddy',area:3,status:'Offer accepted',offset:3,parcel:{left:44,top:73,width:17,height:17}},
 ].map(f=>({id:f.id,name:f.name,initials:f.initials,color:f.color,status:f.status,parcel:f.parcel,draft:{crop:f.crop as Draft['crop'],area:f.area,unit:'acre',village:'Kheri, Sangrur',locationId:'sangrur-east',availableDate:addDays(today,f.offset),deadline:addDays(today,f.offset+5),access:'truck'}}));
}
const tonnes=(d:Draft)=>{const e=estimate(d);return e?`${e.min}–${e.max}`:'—';};
const statusNames={draft:'Draft',open:'New request',offered:'Offer sent',accepted:'Farmer accepted',planned:'Pickup scheduled',attention:'Needs attention',complete:'Collection complete'};

function ExistingDetails({field:f,onClose}:{field:Field;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const el=dialog.current;el?.showModal();return()=>el?.close();},[]);
 return <dialog ref={dialog} className="modal village-request-dialog" onCancel={onClose}>
  <div className="section-head"><span className="eyebrow">FARMER REQUEST · {f.id}</span><button className="icon-button" aria-label="Close request" onClick={onClose}><X size={20}/></button></div>
  <div className="existing-profile"><span style={{background:f.color+'25'}}>{f.initials}</span><div><h2>{f.name}</h2><p>Kheri village · Sangrur, Punjab</p></div></div>
  <span className="badge">{f.status}</span>
  <dl className="existing-facts"><div><dt>Crop residue</dt><dd>{f.draft.crop==='paddy'?'Paddy':'Wheat'}</dd></div><div><dt>Field area</dt><dd>{f.draft.area} acre</dd></div><div><dt>Estimated residue</dt><dd>{tonnes(f.draft)} tonnes</dd></div><div><dt>Available from</dt><dd>{prettyDate(f.draft.availableDate)}</dd></div><div><dt>Clear field by</dt><dd>{prettyDate(f.draft.deadline)}</dd></div><div><dt>Vehicle access</dt><dd>Truck accessible</dd></div></dl>
  <div className="existing-pickup"><Tractor size={23}/><div><strong>{f.name==='Gurpreet Kaur'?'Baler B-18 · Truck T-07':'Shared village collection'}</strong><p>Punjab Bioenergy · 9 AM–12 PM pickup window</p></div></div>
  <button className="btn" onClick={onClose}>Back to village overview <ArrowRight size={17}/></button>
 </dialog>;
}

export default function BuyerOverview({s,onOpen}:{s:SessionView;onOpen:(tab?:BuyerTab)=>void}){
 const r=s.request;
 const fields:Field[]=[...(r?[{id:r.id,name:'Vyom Bhatnagar',initials:'VB',color:'#c5ff65',draft:r.draft,status:statusNames[r.status],parcel:userParcel,live:true}]:[]),...existingFields()];
 const [selected,setSelected]=useState(''),[opened,setOpened]=useState<Field|null>(null);
 const active=fields.find(f=>f.id===selected)||fields[0];
 const total=fields.reduce((acc,f)=>{const e=estimate(f.draft);return {min:acc.min+(e?.min||0),max:acc.max+(e?.max||0),area:acc.area+(f.draft.area||0)*(f.draft.unit==='hectare'?2.47105:1)};},{min:0,max:0,area:0});
 const open=(f:Field)=>{setSelected(f.id);if(f.live)onOpen('supply');else setOpened(f);};
 return <div className="buyer-shell buyer-overview"><aside className="sidebar"><BuyerBrand/><span className="nav-caption">WORKSPACE</span><button className="nav-item active"><MapPin/>Farmer requests<span className="nav-count">{fields.length}</span></button><button className="nav-item" onClick={()=>onOpen('plan')} disabled={!r}><Tractor/>Collection plan</button><button className="nav-item" onClick={()=>onOpen('activity')}><Radio/>Activity</button><a className="nav-item farmer-switch" href="/farmer"><Wheat/>Open farmer view <ArrowRight size={15}/></a><div className="sidebar-bottom"><Sprout size={26}/><h3>A village, working together.</h3><p>Plan the route. Collect the residue. Make room for the next season.</p><small><span className="dot"/>PLATFORM CONNECTED</small></div></aside>
  <main className="buyer-main village-main">
   <div className="page-heading"><div><span className="eyebrow">SANGRUR · HARVEST COLLECTION</span><h1>Your next collection starts here.</h1><p>Every farmer, every field. One clear view of the village.</p></div><div className="village-date"><CalendarDays size={18}/><span>{prettyDate(indiaToday())}<small>HARVEST SEASON</small></span></div></div>
   {r?<button className="latest-request-banner" onClick={()=>onOpen('supply')} aria-label="Open latest request from Vyom Bhatnagar"><span className="arrival-icon"><Bell size={23}/><i/></span><span className="arrival-copy"><small>{r.status==='open'?'NEW REQUEST RECEIVED':'LATEST FARMER REQUEST'}</small><strong>Vyom’s field is ready.</strong><span>{r.draft.area} {r.draft.unit} · {r.draft.crop==='wheat'?'Wheat':'Paddy'} residue · Clear by {prettyDate(r.draft.deadline)}</span></span><span className="arrival-action">View request <ArrowUpRight size={20}/></span></button>:<div className="latest-request-empty"><Bell size={22}/><div><h2>No farmer request yet.</h2><p>Your new request will appear here as soon as the farmer confirms the field.</p></div><a href="/farmer">Open farmer view <ArrowRight size={17}/></a></div>}
   <section className="village-metrics" aria-label="Village collection summary"><div><span>Farmer requests</span><strong>{String(fields.length).padStart(2,'0')}</strong><small>{r?'Including your latest arrival':'Across Kheri village'}</small></div><div><span>Residue available</span><strong>{total.min.toFixed(1)}–{total.max.toFixed(1)} <em>t</em></strong><small>Estimated collectable residue</small></div><div><span>Land ready to clear</span><strong>{Number(total.area.toFixed(1))} <em>acres</em></strong><small>In one village cluster</small></div><div><span>Collection hub</span><strong className="village-hub">Sangrur <MapPin size={20}/></strong><small>Punjab Bioenergy · 24 km</small></div></section>
   <div className="village-grid">
    <section className="panel request-inbox"><div className="inbox-heading"><div><span className="eyebrow">COLLECTION INBOX</span><h2>Farmer requests <span>{fields.length}</span></h2></div><span className="inbox-sort">Newest first</span></div><div className="request-list" role="list" aria-label="Farmer requests">{fields.map(f=><div role="listitem" key={f.id}><button className={`request-row ${f.live?'request-row-latest':''} ${active?.id===f.id?'request-row-selected':''}`} onClick={()=>open(f)} style={{'--parcel-color':f.color} as CSSProperties} aria-label={`Open request from ${f.name}`}><span className="request-avatar">{f.initials}</span><span className="request-row-content"><span className="request-row-title"><strong>{f.name}</strong>{f.live&&<span className="new-arrival">LATEST</span>}</span><small>{f.draft.village||'Kheri'} · {f.id}</small><span className="request-row-facts"><span>{f.draft.area} {f.draft.unit}</span><i/> <span>{f.draft.crop==='wheat'?'Wheat':'Paddy'}</span><i/><span>{tonnes(f.draft)} t</span></span><span className="request-row-bottom"><span>{f.status}</span><span>Clear by {prettyDate(f.draft.deadline)}</span></span></span><ChevronRight size={18}/></button></div>)}</div><div className="inbox-footnote"><CheckCircle2 size={15}/>New farmer requests appear automatically.</div></section>
    <section className="panel village-map-card"><div className="inbox-heading"><div><span className="eyebrow">VILLAGE SUPPLY MAP</span><h2>Fields, brought together.</h2></div><span className="map-satellite"><i/> Satellite</span></div><div className="village-map" aria-label="Kheri village land parcels"><img src="/maps/kheri-village.jpg" alt="Satellite view of farmland in Kheri, Sangrur"/>{fields.map(f=><button key={f.id} className={`village-parcel ${f.live?'user-parcel':''} ${active?.id===f.id?'parcel-selected':''}`} data-parcel-id={f.id} data-live={f.live?'true':'false'} style={{left:f.parcel.left+'%',top:f.parcel.top+'%',width:f.parcel.width+'%',height:f.parcel.height+'%','--parcel-color':f.color} as CSSProperties} onClick={()=>setSelected(f.id)} aria-label={`${f.name}, ${f.draft.area} ${f.draft.unit}, ${tonnes(f.draft)} tonnes`}><span className="village-parcel-label">{f.name.split(' ')[0]}<small>{f.draft.area} {f.draft.unit}</small></span></button>)}{r&&<span className="map-user-position village-user-dot" style={demoField.position}><i/></span>}<span className="map-location-chip"><MapPin size={13}/>Kheri · Sangrur, Punjab</span><span className="map-north">N ↑</span></div><div className="village-map-selection" style={{'--parcel-color':active.color} as CSSProperties}><span className="selection-colour"/><div><strong>{active.name}</strong><span>{active.draft.area} {active.draft.unit} · {active.draft.crop==='wheat'?'Wheat':'Paddy'} · {tonnes(active.draft)} estimated tonnes</span></div><button aria-label={`View selected request from ${active.name}`} onClick={()=>open(active)}><ArrowUpRight size={20}/></button></div><div className="village-map-legend">{fields.map(f=><button key={f.id} className={active.id===f.id?'selected':''} onClick={()=>setSelected(f.id)}><i style={{background:f.color}}/><span>{f.name}<small>{f.draft.area} {f.draft.unit}</small></span></button>)}</div><p className="map-context-note">Illustrative parcel boundaries and existing farmer records. Residue quantities are estimates.</p></section>
   </div>
   <div className="village-route-note"><Truck size={22}/><div><strong>One village. A smarter collection route.</strong><span>{fields.length} nearby fields can be reviewed together before equipment and transport are assigned.</span></div><span className="village-route-total">{total.min.toFixed(1)}–{total.max.toFixed(1)} t<span>village potential</span></span></div>
  </main>{opened&&<ExistingDetails field={opened} onClose={()=>setOpened(null)}/>}
 </div>;
}
