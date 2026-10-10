import {readFile,writeFile,mkdir} from 'node:fs/promises';
const raw=await readFile('.secrets.txt','utf8');const keys=raw.match(/\bAAPT[A-Za-z0-9_.=-]{100,2000}/g);if(keys?.length!==1||raw.trim()!==keys[0])throw Error('Expected one Esri AAPT key');const key=keys[0];
// Rectangle selected in the user's annotated map: x 20.1–30.8%, y 43–67.7%.
const ring=[[75.873012,30.192294],[75.873012,30.193279],[75.873717,30.193279],[75.873717,30.192294],[75.873012,30.192294]];
const base={centerX:'75.875',centerY:'30.193',zoom:'17',width:'1000',height:'700',format:'jpeg',attribution:'light',referenceDetails:'all'};
if(process.argv.includes('--village')){
 const p=new URLSearchParams({...base,x:base.centerX,y:base.centerY,symbolStyle:'none'});
 const r=await fetch('https://static-maps-api.arcgis.com/arcgis/rest/services/static-maps-service/v1/static-maps/arcgis/imagery/with-point?'+p,{headers:{Authorization:'Bearer '+key}});
 if(!r.ok||!r.headers.get('content-type')?.startsWith('image/'))throw Error('Esri village map request failed: '+r.status);
 await mkdir('public/maps',{recursive:true});await writeFile('public/maps/kheri-village.jpg',Buffer.from(await r.arrayBuffer()));console.log({status:r.status,map:'Unmarked village imagery'});
 process.exit(0);
}
const p=new URLSearchParams({...base,polygon:JSON.stringify(ring),fillColor:'BDFF4F35',outlineColor:'BDFF4F',outlineWidth:'4'});
const r=await fetch('https://static-maps-api.arcgis.com/arcgis/rest/services/static-maps-service/v1/static-maps/arcgis/imagery/with-polygon?'+p,{headers:{Authorization:'Bearer '+key}});console.log({status:r.status,type:r.headers.get('content-type')});if(r.ok&&r.headers.get('content-type')?.startsWith('image/')){await mkdir('public/maps',{recursive:true});await writeFile('public/maps/kheri-field-parcel.jpg',Buffer.from(await r.arrayBuffer()));}else throw Error('Esri map request failed: '+r.status);
