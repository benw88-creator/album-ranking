// Destinations and the camera curve, unchanged from the prototype.
export const ENVIRONMENTS = [
  {name:'Neon City', subtitle:'The journey starts here', altitude:0, y:0, color:'#bda0ff'},
  {name:'Cloudbreak', subtitle:'Through the electric sky',altitude:650,y:230,color:'#ffc1c1'},
  {name:'The Edge of Earth',subtitle:'A whole new perspective',altitude:2500,y:510,color:'#75d8ff'},
  {name:'Low Earth Orbit',subtitle:'Hello, weightlessness',altitude:5000,y:830,color:'#9aa9ff'},
  {name:'The Moon',subtitle:'A little further from home',altitude:8000,y:1180,color:'#e3ddfb'},
  {name:'Solar Playground',subtitle:'Between giants',altitude:11000,y:1550,color:'#ffb475'},
  {name:'Deep Cosmos',subtitle:'Beyond the familiar',altitude:16000,y:1970,color:'#ee9def'},
  {name:'The Unknown',subtitle:'All the rules bend here',altitude:24000,y:2400,color:'#ffc77f'}
];
export function environmentAt(alt){return ENVIRONMENTS.findLast(e=>alt>=e.altitude)||ENVIRONMENTS[0];}
export function altitudeToY(alt){
  let i=ENVIRONMENTS.findLastIndex(e=>alt>=e.altitude); i=Math.max(0,i);
  const a=ENVIRONMENTS[i], b=ENVIRONMENTS[i+1];
  if(!b)return a.y+(alt-a.altitude)*.025;
  // Monotone cubic interpolation keeps the camera's velocity continuous across
  // destinations without overshooting their exact altitude checkpoints.
  const slope=j=>(ENVIRONMENTS[j+1].y-ENVIRONMENTS[j].y)/(ENVIRONMENTS[j+1].altitude-ENVIRONMENTS[j].altitude);
  const d=slope(i),harmonic=(u,v)=>2*u*v/(u+v),width=b.altitude-a.altitude;
  const m0=i===0?d:harmonic(slope(i-1),d);
  const m1=i===ENVIRONMENTS.length-2?.025:harmonic(d,slope(i+1));
  const t=Math.max(0,Math.min(1,(alt-a.altitude)/width)),t2=t*t,t3=t2*t;
  return (2*t3-3*t2+1)*a.y+(t3-2*t2+t)*width*m0+(-2*t3+3*t2)*b.y+(t3-t2)*width*m1;
}
