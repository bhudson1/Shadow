import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';

// Geometry-accurate sunlight testing using a BVH; no raster intermediates.
THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
const $ = id => document.getElementById(id);
const sceneCanvas = $('scene');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#24353d');
scene.fog = new THREE.FogExp2('#24353d', 0.00065);
const renderer = new THREE.WebGLRenderer({antialias:true, preserveDrawingBuffer:false});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.65;
sceneCanvas.appendChild(renderer.domElement);
const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 10000);
camera.position.set(190, 175, 230);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = .07;
controls.target.set(0, 14, 0);
controls.maxPolarAngle = Math.PI * .493;
controls.maxDistance = 1800;
controls.minDistance = 5;
const ambient = new THREE.HemisphereLight(0xd8eaff, 0x354848, 2.1);
scene.add(ambient);
const sunlight = new THREE.DirectionalLight(0xffefce, 3.3);
sunlight.castShadow = true;
sunlight.shadow.mapSize.set(2048, 2048);
sunlight.shadow.bias = -.00011;
sunlight.shadow.normalBias = .045;
sunlight.shadow.camera.near = 1;
sunlight.shadow.camera.far = 3000;
scene.add(sunlight, sunlight.target);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(3200,3200).rotateX(-Math.PI/2),new THREE.MeshStandardMaterial({color:'#52635c',roughness:1,metalness:0}));
ground.receiveShadow=true;
ground.name='Flat ground receiver';
scene.add(ground);
const grid = new THREE.GridHelper(1200, 120, '#687b76', '#4b655e');
grid.position.y=.06;
grid.material.transparent=true;
grid.material.opacity=.30;
scene.add(grid);
const contextGroup = new THREE.Group(); scene.add(contextGroup);
const terrainGroup = new THREE.Group(); scene.add(terrainGroup);
const proposalAnchor = new THREE.Group();scene.add(proposalAnchor);
const roadGroup = new THREE.Group();scene.add(roadGroup);
const overlayGroup = new THREE.Group();scene.add(overlayGroup);
let proposalObject = null, contextSource='demo', terrainLoaded=false, contextDetailed=false, proposalDetailed=false;
let samples=[], overlay=null, daily=null, snapshotCache=new Map(), dataRevision=0;
let generation=0, analysing=false, activeTime=720, playing=false, playStamp=0, lastSnapshot=null;
const UNIT_UP = new THREE.Vector3(0,1,0);
const fromAbove = new THREE.Vector3(0,-1,0);
const snapshotColours = {existing:new THREE.Color('#368ee4'), added:new THREE.Color('#f36d5e'), sun:new THREE.Color('#c6e3c8'), night:new THREE.Color('#53616a')};
const durationPalette=[new THREE.Color('#d9e5ce'),new THREE.Color('#f9d790'),new THREE.Color('#ff8a6d'),new THREE.Color('#c84956')];
const materialContext = new THREE.MeshStandardMaterial({color:'#a9bec1',roughness:.88,metalness:.07,side:THREE.DoubleSide});
const materialProposal = new THREE.MeshStandardMaterial({color:'#d5a979',roughness:.77,metalness:.05,side:THREE.DoubleSide});
const materialTerrain = new THREE.MeshStandardMaterial({color:'#779080',roughness:.96,metalness:0,side:THREE.DoubleSide});
const raycaster = new THREE.Raycaster(); raycaster.firstHitOnly=true; raycaster.near=.003;raycaster.far=5000;
function status(msg){$('sceneStatus').textContent=msg;}
function fmt(v,n=0){return Number.isFinite(v)?v.toLocaleString('en-CA',{maximumFractionDigits:n}):'—';}
function fieldNum(id, fallback){const n=Number($(id).value);return Number.isFinite(n)?n:fallback;}
function coords(){return {lat:fieldNum('latitude',49.2827),lon:fieldNum('longitude',-123.1179)};}
function geoToLocal(lat,lon){const c=coords();return {x:(lon-c.lon)*111320*Math.cos(c.lat*Math.PI/180), z:-(lat-c.lat)*111320};}
function localToGeo(x,z){const c=coords();return [c.lon+x/(111320*Math.cos(c.lat*Math.PI/180)),c.lat-z/111320];}
function registerMeshes(obj,mat=null){obj.traverse(child=>{if(!child.isMesh)return;child.castShadow=true;child.receiveShadow=true;if(mat)child.material=mat; if(child.geometry && !child.geometry.boundsTree){try{child.geometry.computeBoundsTree({maxLeafTris:20});}catch(e){console.warn('BVH',e);}}});}
function clearGroup(group){while(group.children.length){const c=group.children[0];group.remove(c);c.traverse(o=>{if(o.geometry){if(o.geometry.disposeBoundsTree)o.geometry.disposeBoundsTree();o.geometry.dispose();}if(o.material && o.material!==materialContext && o.material!==materialProposal && o.material!==materialTerrain){(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose());}});}}
function invalidate(){dataRevision++;samples=[];daily=null;lastSnapshot=null;snapshotCache.clear();$('dailyAreaHours').textContent='—';$('affectedArea').textContent='—';$('downloadBtn').disabled=true;clearOverlay();}
function updateQuality(){let msg=[];if(terrainLoaded)msg.push('MESH TERRAIN');else msg.push('FLAT TERRAIN');if(contextDetailed)msg.push('3D CONTEXT');else msg.push(contextSource==='osm'?'OSM MASSING':'DEMO BUILDINGS');if(proposalDetailed)msg.push('UPLOADED PROPOSAL');else msg.push('DEMO PROPOSAL');const rigorous=terrainLoaded&&contextDetailed&&proposalDetailed;$('contextQuality').textContent=msg.join(' · ');$('qualityBadge').textContent=rigorous?'MESH INPUTS · VERIFY ALIGNMENT':'ILLUSTRATIVE INPUTS';$('qualityBadge').style.color=rigorous?'#8fe1c8':'#fac487';}
function rebuildDemo(){clearGroup(contextGroup);clearGroup(roadGroup);const buildings=[[-83,-50,24,34,18],[-49,-60,34,22,31],[-8,-68,25,31,42],[39,-57,29,43,28],[78,-42,26,28,18],[-91,21,35,30,35],[-50,22,24,29,20],[46,35,37,40,46],[88,18,27,34,23],[-87,76,22,28,24],[-31,71,28,23,16],[35,85,25,39,26],[85,77,22,27,37]];
  buildings.forEach(([x,z,w,d,h],i)=>{const box=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),materialContext);box.position.set(x,h/2,z);contextGroup.add(box);if(i%3===0){const roof=new THREE.Mesh(new THREE.BoxGeometry(w*.44,2,d*.5),materialContext);roof.position.set(x,h+1,z);contextGroup.add(roof);}});
  for(let z of [-100,0,110])addRoad(-170,z,170,z,12);
  for(let x of [-110,9,115])addRoad(x,-180,x,160,13);
  registerMeshes(contextGroup); contextSource='demo';contextDetailed=false;updateQuality();invalidate();status('Demo context active · replace with OpenStreetMap or surveyed meshes');}
function addRoad(x1,z1,x2,z2,width=8){const len=Math.hypot(x2-x1,z2-z1);const road=new THREE.Mesh(new THREE.PlaneGeometry(len,width).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({color:'#83918b',side:THREE.DoubleSide,transparent:true,opacity:.52,depthWrite:false}));road.position.set((x1+x2)/2,.087,(z1+z2)/2);road.rotation.y=-Math.atan2(z2-z1,x2-x1);roadGroup.add(road);}
function makeDemoProposal(){clearGroup(proposalAnchor);const main=new THREE.Mesh(new THREE.BoxGeometry(26,34,31),materialProposal);main.position.y=17;proposalAnchor.add(main);const top=new THREE.Mesh(new THREE.BoxGeometry(18,14,24),materialProposal);top.position.set(0,41,1);proposalAnchor.add(top);const mechanical=new THREE.Mesh(new THREE.BoxGeometry(7,3,8),materialProposal);mechanical.position.set(-4,49,0);proposalAnchor.add(mechanical);registerMeshes(proposalAnchor);proposalObject=proposalAnchor;proposalDetailed=false;applyProposalTransform();updateQuality();invalidate();}
function resize(){const w=sceneCanvas.clientWidth,h=sceneCanvas.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
new ResizeObserver(resize).observe(sceneCanvas);
function render(ts){requestAnimationFrame(render);controls.update();if(playing&&!analysing){if(!playStamp)playStamp=ts;if(ts-playStamp>115){playStamp=ts;let m=activeTime+15;if(m>1200)m=360;$('timeSlider').value=m;setSolarTime(m,false);}}renderer.render(scene,camera);}
requestAnimationFrame(render);

// Meeus mean equinox approximation: sufficient for selecting the local calendar day.
function equinoxDay(){const y=fieldNum('year',2026);const t=(y-2000)/1000;const spring=$('equinox').value==='spring';const jde=spring ? 2451623.80984+365242.37404*t+.05169*t*t-.00411*t**3-.00057*t**4 : 2451810.21715+365242.01767*t-.11575*t*t+.00337*t**3+.00078*t**4;
  const d=new Date((jde-2440587.5)*86400000-7*3600000);return d.toISOString().slice(0,10);}
function localToUTC(dateString, minuteOfDay){const [year,month,day]=dateString.split('-').map(Number);return new Date(Date.UTC(year,month-1,day,0,0,0)+(minuteOfDay+420)*60000);}
// SunCalc/NOAA-style solar ephemeris, east +X, south +Z, up +Y.
function solarPosition(minuteOfDay){const date=localToUTC(equinoxDay(),minuteOfDay),{lat,lon}=coords(),rad=Math.PI/180;
  const d=date.valueOf()/86400000-0.5+2440588-2451545, m=rad*(357.5291+.98560028*d),c=rad*(1.9148*Math.sin(m)+.02*Math.sin(2*m)+.0003*Math.sin(3*m));
  const l=m+c+rad*102.9372+Math.PI,eps=rad*23.4397,dec=Math.asin(Math.sin(eps)*Math.sin(l)),ra=Math.atan2(Math.sin(l)*Math.cos(eps),Math.cos(l));
  const h=rad*(280.16+360.9856235*d+lon)-ra,p=lat*rad;
  const alt=Math.asin(Math.sin(p)*Math.sin(dec)+Math.cos(p)*Math.cos(dec)*Math.cos(h));
  const az=Math.atan2(Math.sin(h),Math.cos(h)*Math.sin(p)-Math.tan(dec)*Math.cos(p));
  const direction=new THREE.Vector3(-Math.sin(az)*Math.cos(alt),Math.sin(alt),Math.cos(az)*Math.cos(alt)).normalize();
  const compass=(180+az/rad+360)%360;return {direction,alt:alt/rad,az:compass};}
function setSolarTime(m,doSnapshot=true){activeTime=+m;const h=String(Math.floor(m/60)).padStart(2,'0'),mins=String(m%60).padStart(2,'0');$('timeLabel').textContent=`${h}:${mins}`;const sun=solarPosition(activeTime);$('sunData').textContent=`Solar altitude ${sun.alt.toFixed(1)}° · azimuth ${sun.az.toFixed(0)}° · ${equinoxDay()}`;
  const r=Math.max(150,fieldNum('studyRadius',100)*3);sunlight.position.copy(sun.direction).multiplyScalar(r*2.6);sunlight.target.position.set(0,0,0);sunlight.target.updateMatrixWorld();sunlight.intensity=sun.alt>0?3.3:0;
  const cameraShadow=sunlight.shadow.camera;cameraShadow.left=-r*1.4;cameraShadow.right=r*1.4;cameraShadow.top=r*1.4;cameraShadow.bottom=-r*1.4;cameraShadow.updateProjectionMatrix();
  if(doSnapshot&&!analysing)requestSnapshot();}
let snapshotQueued=false;
function requestSnapshot(){if(snapshotQueued)return;snapshotQueued=true;setTimeout(()=>{snapshotQueued=false;if(!analysing){try{analyseFrame(activeTime);}catch(e){console.error(e);status('Frame calculation error: '+e.message);}}},80);}
function getReceiverHits(){const radius=Math.min(500,Math.max(20,fieldNum('studyRadius',100)));const spacing=fieldNum('gridSize',2);if(radius/spacing>350){status('Too many cells: increase spacing or reduce radius');return [];}const receiverObjs=[contextGroup, ...(terrainLoaded?[terrainGroup]:[ground])];const result=[];const start=-Math.floor(radius/spacing)*spacing;const end=Math.floor(radius/spacing)*spacing;
  for(let x=start;x<=end;x+=spacing)for(let z=start;z<=end;z+=spacing){if(x*x+z*z>radius*radius)continue;raycaster.set(new THREE.Vector3(x,3000,z),fromAbove);const hits=raycaster.intersectObjects(receiverObjs,true);if(!hits.length)continue;
    const hit=hits[0];const p=hit.point;const n=hit.face?.normal?.clone().transformDirection(hit.object.matrixWorld)||new THREE.Vector3(0,1,0);if(n.y<0)n.negate();
    // Building-covered ground is not a receiving surface in the proposed condition.
    if(proposalAnchor.children.length){raycaster.set(new THREE.Vector3(x,3001,z),fromAbove);const blocked=raycaster.intersectObject(proposalAnchor,true);if(blocked.length&&blocked[0].point.y>p.y+.10)continue;}
    result.push({x,z,y:p.y,n,existingMin:0,newMin:0});
  }return result;}
function setupSamples(){if(samples.length)return true;samples=getReceiverHits();if(!samples.length){status('No receivers inside the selected area. Check model alignment.');return false;}
  clearOverlay();const s=fieldNum('gridSize',2);const geo=new THREE.PlaneGeometry(s*.92,s*.92).rotateX(-Math.PI/2);
  const mat=new THREE.MeshBasicMaterial({color:0xffffff,vertexColors:false,transparent:true,opacity:.83,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2});
  overlay=new THREE.InstancedMesh(geo,mat,samples.length);overlay.frustumCulled=false;overlay.renderOrder=40;
  const dummy=new THREE.Object3D();samples.forEach((pt,i)=>{dummy.position.set(pt.x,pt.y+.18,pt.z);dummy.quaternion.setFromUnitVectors(UNIT_UP,pt.n);dummy.scale.setScalar(1);dummy.updateMatrix();overlay.setMatrixAt(i,dummy.matrix);overlay.setColorAt(i,snapshotColours.sun);});overlay.instanceMatrix.needsUpdate=true;overlay.instanceColor.needsUpdate=true;overlayGroup.add(overlay);return true;}
function clearOverlay(){if(overlay){overlayGroup.remove(overlay);overlay.geometry.dispose();overlay.material.dispose();overlay=null;}}
function hitSun(pt,dir,objs){const origin=new THREE.Vector3(pt.x,pt.y,pt.z).addScaledVector(pt.n,.12);raycaster.set(origin,dir);raycaster.near=.01;raycaster.far=3500;return raycaster.intersectObjects(objs,true).length>0;}
function shadowMask(minute){const cacheKey=`${dataRevision}:${minute}`;const cached=snapshotCache.get(cacheKey);if(cached)return cached;
  const sun=solarPosition(minute),existing=new Uint8Array(samples.length),added=new Uint8Array(samples.length);if(sun.alt<=.05){const ret={existing,added,sun};snapshotCache.set(cacheKey,ret);return ret;}
  const occluders=[contextGroup,...(terrainLoaded?[terrainGroup]:[])];
  for(let i=0;i<samples.length;i++){const pt=samples[i];if(hitSun(pt,sun.direction,occluders)){existing[i]=1;}else if(proposalAnchor.children.length&&hitSun(pt,sun.direction,[proposalAnchor]))added[i]=1;}
  const ret={existing,added,sun};snapshotCache.set(cacheKey,ret);if(snapshotCache.size>90){const key=snapshotCache.keys().next().value;snapshotCache.delete(key);}return ret;}
function paint(mask){if(!overlay)return;const duration=$('viewMode').value==='duration'&&daily;
  for(let i=0;i<samples.length;i++){let col;if(duration){const d=samples[i].newMin;const max=Math.max(60,daily.maxMinutes);if(d<=0)col=mask.existing[i]?snapshotColours.existing:snapshotColours.sun;else{const u=Math.min(1,d/max);if(u<.5)col=durationPalette[0].clone().lerp(durationPalette[1],u*2);else col=durationPalette[1].clone().lerp(durationPalette[3],(u-.5)*2);}}else col=mask.sun.alt<=0?snapshotColours.night:mask.existing[i]?snapshotColours.existing:mask.added[i]?snapshotColours.added:snapshotColours.sun;
    overlay.setColorAt(i,col);}
  overlay.instanceColor.needsUpdate=true;}
function analyseFrame(minute){if(!setupSamples())return;const mask=shadowMask(minute);lastSnapshot=mask;paint(mask);let e=0,n=0;for(let i=0;i<samples.length;i++){e+=mask.existing[i];n+=mask.added[i];}const a=fieldNum('gridSize',2)**2;$('existingArea').textContent=fmt(e*a);$('newArea').textContent=fmt(n*a);status(`Computed ${fmt(samples.length)} receiving cells · ${fmt(a,2)} m² each · geometry ray tests`);}
function showProgress(show,msg='',percent=0){$('progressWrap').classList.toggle('hidden',!show);$('progressText').textContent=msg;$('progressFill').style.width=`${Math.round(percent)}%`;}
function uiYield(){return new Promise(resolve=>setTimeout(resolve,0));}
async function analyseDay(){if(analysing)return;if(!setupSamples())return;analysing=true;playing=false;$('playBtn').textContent='▶';const thisGen=++generation;const step=fieldNum('interval',30);samples.forEach(s=>{s.existingMin=0;s.newMin=0;});const slotStats=[];let processed=0;
  const slots=[];for(let min=360+step/2;min<1200;min+=step){if(solarPosition(min).alt>.05)slots.push(min);}showProgress(true,'Preparing geometric sunlight analysis…',0);$('fullDayBtn').disabled=true;
  try{for(const min of slots){if(thisGen!==generation){status('Analysis cancelled');return;}const mask=shadowMask(min);let ex=0,added=0;for(let i=0;i<samples.length;i++){if(mask.existing[i]){samples[i].existingMin+=step;ex++;}if(mask.added[i]){samples[i].newMin+=step;added++;}}
      const cellA=fieldNum('gridSize',2)**2;slotStats.push({local_time:`${String(Math.floor(min/60)).padStart(2,'0')}:${String(min%60).padStart(2,'0')}`,minute_of_day:min,existing_shadow_m2:ex*cellA,net_new_shadow_m2:added*cellA,altitude_deg:Number(mask.sun.alt.toFixed(2)),azimuth_deg:Number(mask.sun.az.toFixed(2))});processed++;showProgress(true,`Ray tracing daylight: ${processed} / ${slots.length} sun positions`,100*processed/slots.length);await uiYield();}
    const area=fieldNum('gridSize',2)**2;const duration=samples.map(s=>s.newMin);const total=duration.reduce((a,b)=>a+b,0),aff=duration.filter(d=>d>0).length;let maximum=0;for(const val of duration)if(val>maximum)maximum=val;
    daily={date:equinoxDay(),center:coords(),stepMin:step,cellSize:fieldNum('gridSize',2),cellCount:samples.length,areaHours:total/60*area,affectedArea:aff*area,maxMinutes:maximum,slotStats,source:{existing:contextDetailed?'uploaded mesh':contextSource,terrain:terrainLoaded?'uploaded mesh':'flat plane',proposal:proposalDetailed?'uploaded mesh':'demonstration model'},method:'BVH geometric ray cast, sample centres, projected horizontal area, discrete daylight time steps'};
    $('dailyAreaHours').textContent=fmt(daily.areaHours,1);$('affectedArea').textContent=fmt(daily.affectedArea);$('downloadBtn').disabled=false;status(`Equinox analysis complete · ${slots.length} sun positions × ${fmt(samples.length)} receiving cells`);}
  catch(e){console.error(e);status('Analysis failed: '+e.message);}finally{analysing=false;$('fullDayBtn').disabled=false;showProgress(false);if(thisGen===generation)analyseFrame(activeTime);}}
function exportDay(){if(!daily)return;const features=samples.filter(p=>p.newMin>0||p.existingMin>0).map(pt=>({type:'Feature',geometry:{type:'Point',coordinates:localToGeo(pt.x,pt.z)},properties:{duration_new_min:pt.newMin,duration_existing_min:pt.existingMin,ground_height_local_m:Number(pt.y.toFixed(3)),sample_area_m2:daily.cellSize*daily.cellSize}}));
  const geojson={type:'FeatureCollection',name:'Equinox shadow receivers',properties:daily,features};download(JSON.stringify(geojson),'application/geo+json',`shadow-receivers-${daily.date}.geojson`);
  const rows=['date,local_time,solar_altitude_deg,solar_azimuth_deg,existing_shadow_m2,net_new_shadow_m2',...daily.slotStats.map(s=>`${daily.date},${s.local_time},${s.altitude_deg},${s.azimuth_deg},${s.existing_shadow_m2},${s.net_new_shadow_m2}`)];download(rows.join('\n'),'text/csv',`shadow-areas-${daily.date}.csv`);
  download(JSON.stringify(daily,null,2),'application/json',`shadow-summary-${daily.date}.json`);}
function download(text,type,name){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1200);}
function updateProposalPlacement(){if(!proposalAnchor.children.length)return;proposalAnchor.position.set(fieldNum('proposalEast',0),fieldNum('proposalHeight',0),-fieldNum('proposalNorth',0));proposalAnchor.rotation.set(0,fieldNum('proposalRotation',0)*Math.PI/180,0);proposalAnchor.updateMatrixWorld(true);invalidate();requestSnapshot();}
function applyProposalTransform(){updateProposalPlacement();}
function fileObject(file){const ext=file.name.split('.').pop().toLowerCase(),url=URL.createObjectURL(file);return new Promise((resolve,reject)=>{const finish=o=>{URL.revokeObjectURL(url);resolve(o);},error=e=>{URL.revokeObjectURL(url);reject(e);};if(ext==='glb'||ext==='gltf'){new GLTFLoader().load(url,g=>finish(g.scene),undefined,error);}else if(ext==='obj'){new OBJLoader().load(url,finish,undefined,error);}else if(ext==='stl'){new STLLoader().load(url,geo=>finish(new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color:'#c0cfbf',side:THREE.DoubleSide}))),undefined,error);}else error(new Error('Use GLB, OBJ or STL'));});}
async function uploadModel(kind,file){if(!file)return;status(`Reading ${file.name}…`);try{const obj=await fileObject(file);obj.updateMatrixWorld(true);
    if(kind==='proposal'){
      clearGroup(proposalAnchor); // Proposal is intentionally centred on the site, then offset via the controls.
      const box=new THREE.Box3().setFromObject(obj);const c=new THREE.Vector3();box.getCenter(c);obj.position.x-=c.x;obj.position.z-=c.z;obj.position.y-=box.min.y;proposalAnchor.add(obj);
      registerMeshes(obj,materialProposal);proposalObject=proposalAnchor;proposalDetailed=true;$('proposalFileName').textContent=file.name;applyProposalTransform();
    }else if(kind==='context'){
      // Uploaded detailed context replaces OSM; shared local origin is required.
      clearGroup(contextGroup);clearGroup(roadGroup);contextGroup.add(obj);registerMeshes(obj,materialContext);contextSource='mesh';contextDetailed=true;$('contextFileName').textContent=file.name;invalidate();
    }else if(kind==='terrain'){
      clearGroup(terrainGroup);terrainGroup.add(obj);registerMeshes(obj,materialTerrain);terrainLoaded=true;$('terrainFileName').textContent=file.name;ground.visible=false;grid.visible=false;invalidate();
    }
    updateQuality();status(`${file.name} loaded. Confirm coordinates, units and the common elevation datum.`);requestSnapshot();}
  catch(e){console.error(e);status(`Could not read ${file.name}: ${e.message||e}`);}}
function waitFetch(url,ms=30000){const ctr=new AbortController();const timer=setTimeout(()=>ctr.abort(),ms);return fetch(url,{signal:ctr.signal}).finally(()=>clearTimeout(timer));}
async function loadOSM(){const {lat,lon}=coords();if(lat<-85||lat>85||lon<-180||lon>180){status('Invalid latitude/longitude');return;}const r=Math.min(500,Math.max(20,fieldNum('studyRadius',100)));const searchRadius=r+100;const dx=searchRadius/(111320*Math.max(.1,Math.cos(lat*Math.PI/180))),dy=searchRadius/111320;
  const bbox=`${(lat-dy).toFixed(6)},${(lon-dx).toFixed(6)},${(lat+dy).toFixed(6)},${(lon+dx).toFixed(6)}`;
  const q=`[out:json][timeout:30];(way["building"](${bbox});way["highway"](${bbox}););out geom;`;
  $('osmBtn').disabled=true;status('Fetching open map building footprints and roads…');
  try{let data;let lastError;for(const host of ['https://overpass.kumi.systems/api/interpreter','https://overpass-api.de/api/interpreter']){try{const response=await waitFetch(`${host}?data=${encodeURIComponent(q)}`,29000);if(!response.ok)throw new Error('HTTP '+response.status);data=await response.json();break;}catch(e){lastError=e;}}
    if(!data)throw lastError||new Error('Overpass servers did not respond');const parts=[];let count=0,heightCount=0,roads=0;
    // Rebuild as an accelerated single mesh, with no per-feature raycasting loop.
    for(const element of data.elements||[]){const pts=element.geometry||[];if(pts.length<2)continue;const arr=pts.map(p=>geoToLocal(p.lat,p.lon));if(element.tags?.building){if(arr.length<4)continue;let h=parseFloat(element.tags.height);if(Number.isFinite(h)&&h>0)heightCount++;else{let lv=parseFloat(element.tags['building:levels']);h=Number.isFinite(lv)&&lv>0?lv*3.1:12;}h=Math.min(400,Math.max(2,h));
        try{const shape=new THREE.Shape();arr.forEach((p,i)=>i?shape.lineTo(p.x,-p.z):shape.moveTo(p.x,-p.z));shape.closePath();const geo=new THREE.ExtrudeGeometry(shape,{depth:h,bevelEnabled:false,steps:1,curveSegments:1});geo.rotateX(-Math.PI/2);parts.push(geo);count++;}catch(e){console.warn('Skipped malformed footprint',e);}}
      else if(element.tags?.highway){const usable=['motorway','trunk','primary','secondary','tertiary','residential','living_street','service','pedestrian'];if(!usable.includes(element.tags.highway))continue;for(let i=1;i<arr.length;i++){const a=arr[i-1],b=arr[i];if(Math.hypot(b.x-a.x,b.z-a.z)<1)continue;addRoad(a.x,a.z,b.x,b.z,element.tags.highway==='residential'?6:9);roads++;}}}
    if(!parts.length)throw new Error('No building polygons returned for the selected area');
    const merged=mergeGeometries(parts,false);parts.forEach(g=>g.dispose());if(!merged)throw new Error('Could not merge OSM building geometry');
    clearGroup(contextGroup); // previously parsed geometry retained until after successful fetch
    const mesh=new THREE.Mesh(merged,materialContext);contextGroup.add(mesh);registerMeshes(contextGroup);contextSource='osm';contextDetailed=false;updateQuality();invalidate();
    $('osmInfo').textContent=`${fmt(count)} mapped building footprints; ${fmt(heightCount)} tagged with actual heights (${fmt(100*heightCount/count,0)}%). Others estimated from floors/defaults. Roofs are generalized.`;
    status(`OSM loaded · ${count} footprints, ${heightCount} measured heights · approximate massing only`);requestSnapshot();}
  catch(e){console.warn(e);clearGroup(roadGroup);$('osmInfo').textContent=`OSM service unavailable: ${e.message}. The demo context remains available; retry later.`;status('OpenStreetMap unavailable; retained the current buildings.');}
  finally{$('osmBtn').disabled=false;}}

$('timeSlider').addEventListener('input',e=>setSolarTime(Number(e.target.value)));
$('snapshotBtn').onclick=()=>analyseFrame(activeTime);
$('playBtn').onclick=()=>{playing=!playing;playStamp=0;$('playBtn').textContent=playing?'Ⅱ':'▶';};
$('fullDayBtn').onclick=analyseDay;
$('downloadBtn').onclick=exportDay;
$('cancelBtn').onclick=()=>{generation++;};
$('osmBtn').onclick=loadOSM;
$('viewMode').onchange=()=>{if(lastSnapshot)paint(lastSnapshot);};
for(const id of ['proposalEast','proposalNorth','proposalHeight','proposalRotation'])$(id).addEventListener('change',updateProposalPlacement);
for(const id of ['latitude','longitude','studyRadius','gridSize','equinox','year','interval'])$(id).addEventListener('change',()=>{invalidate();if(id==='latitude'||id==='longitude'){$('coordinateBadge').textContent=`${coords().lat.toFixed(5)}° N, ${Math.abs(coords().lon).toFixed(5)}° W`;}if(id==='latitude'||id==='longitude')status('Study centre updated. Reload OSM context for this location.');setSolarTime(activeTime);});
for(const [id,kind] of [['proposalFile','proposal'],['contextFile','context'],['terrainFile','terrain']])$(id).addEventListener('change',e=>uploadModel(kind,e.target.files?.[0]));
$('helpBtn').onclick=()=>$('helpDialog').showModal();$('closeHelp').onclick=()=>$('helpDialog').close();

rebuildDemo();makeDemoProposal();updateQuality();resize();setSolarTime(720,false);setTimeout(()=>analyseFrame(720),300);
