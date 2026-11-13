// Original, deterministic pixel sprites. All geometry is rasterised into small
// offscreen bitmaps and enlarged with nearest-neighbour sampling.
export const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
export const mix=(a,b,t)=>a+(b-a)*t;
export const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a));return t*t*(3-2*t);};
export function seeded(seed=1){return()=>{seed=(Math.imul(1664525,seed)+1013904223)|0;return(seed>>>0)/4294967296;};}
export function bitmap(w,h,draw){const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');x.imageSmoothingEnabled=false;draw?.(x,c);return c;}
export function rect(x,c,a,b,w,h){x.fillStyle=c;x.fillRect(Math.round(a),Math.round(b),Math.round(w),Math.round(h));}
export function pixelCircle(x,c,cx,cy,r){for(let y=-Math.ceil(r);y<=r;y++){const w=Math.floor(Math.sqrt(Math.max(0,r*r-y*y)));if(w)rect(x,c,cx-w,cy+y,w*2+1,1);}}
function noise(x,y){const n=Math.sin(x*127.1+y*311.7)*43758.5453;return n-Math.floor(n);}
function n2(x,y){const ix=Math.floor(x),iy=Math.floor(y);let a=x-ix,b=y-iy;a=a*a*(3-2*a);b=b*b*(3-2*b);return mix(mix(noise(ix,iy),noise(ix+1,iy),a),mix(noise(ix,iy+1),noise(ix+1,iy+1),a),b);}
function fbm(x,y){return n2(x,y)*.53+n2(x*2.1+7,y*2.1)*.27+n2(x*4.3,y*4.3+3)*.13+n2(x*8.7,y*8.7)*.07;}
const RGB=s=>s.match(/\w\w/g).map(v=>parseInt(v,16));
function shaded(c,v){const a=RGB(c);return `rgb(${a.map(n=>Math.round(clamp(n*v,0,255))).join(',')})`;}

export function rocketSprite(){
  return bitmap(27,48,x=>{
    const o='#100c20',red='#eb413b',shade='#982d48',light='#ff7651',white='#fff1ce',cream='#e4ba97',blue='#84cbdf';
    // Silhouette, nozzle and three tail fins.
    [[12,0,3,2],[11,2,5,2],[10,4,7,3],[9,7,9,5],[8,12,11,24],[6,25,3,13],[4,29,3,12],[3,33,3,10],[18,25,3,13],[20,29,3,12],[22,33,2,10],[8,35,11,7],[10,40,7,5],[12,34,3,14]].forEach(r=>rect(x,o,...r));
    rect(x,shade,10,9,7,5);rect(x,red,11,5,5,6);rect(x,red,12,2,3,4);rect(x,light,12,4,1,4);rect(x,'#ffdca5',12,3,1,1);
    rect(x,white,9,14,9,21);rect(x,'#fff8e6',10,15,4,19);rect(x,cream,15,15,3,20);rect(x,'#c2827c',17,15,1,19);
    rect(x,'#f37857',9,12,9,2);rect(x,'#fff1cb',9,14,9,1);
    rect(x,o,11,18,5,6);rect(x,o,10,19,7,4);rect(x,'#b69b86',11,19,5,4);rect(x,'#2d4263',12,19,3,4);rect(x,blue,11,20,4,2);rect(x,'#f0fbec',11,20,2,1);rect(x,'#2d4263',14,22,1,1);
    rect(x,shade,5,31,3,9);rect(x,red,6,28,2,8);rect(x,light,6,30,1,6);rect(x,red,4,35,3,6);rect(x,shade,3,41,3,1);
    rect(x,red,19,28,2,10);rect(x,shade,21,32,2,10);rect(x,light,19,29,1,7);rect(x,red,20,36,3,5);
    rect(x,'#ff824f',9,35,9,3);rect(x,red,9,38,9,2);rect(x,'#ffce71',10,40,7,2);rect(x,'#4d3854',10,42,7,2);
    rect(x,o,12,31,3,15);rect(x,'#e7ab71',13,33,1,12);rect(x,'#fff3c3',13,32,1,2);rect(x,'#352542',13,46,1,2);
    rect(x,'#c28a81',9,29,1,4);rect(x,'#f7dda6',10,34,1,1);
  });
}

export function cloudSprite(seed=1,night=false){
  const rng=seeded(seed),w=180,h=74;
  const puffs=Array.from({length:11},(_,i)=>({x:8+i*15+rng()*10,y:30+rng()*22,rx:15+rng()*22,ry:10+rng()*19}));
  const palette=night?['#d5b5e2','#c39ad8','#a47ac4','#8b5bb2','#634794','#49356f']:['#ffe9b8','#ffd4a0','#ffb29d','#f18ba7','#ca75b0','#9a62a5','#76528c'];
  return bitmap(w,h,x=>{
    for(let y=0;y<h;y++)for(let a=0;a<w;a++){
      let d=9;for(const p of puffs)d=Math.min(d,((a-p.x)/p.rx)**2+((y-p.y)/p.ry)**2);
      const n=fbm(a*.16,y*.16),edge=(n-.5)*.2;
      if(d>1+edge)continue;
      const lighting=clamp((y-18)/53+(n-.5)*.5);
      const index=Math.min(palette.length-1,Math.floor(lighting*palette.length));
      rect(x,palette[index],a,y,1,1);
      if(noise(a*2,y*3)>.93&&d>.72)rect(x,palette[Math.max(0,index-1)],a,y,1,1);
    }
  });
}

export function planetSprite(kind,r=48,seed=9){
  const size=r*2+8,rng=seeded(seed),centre=r+4;
  const craters=Array.from({length:kind==='moon'?26:9},()=>({x:(rng()-.5)*r*1.5,y:(rng()-.5)*r*1.5,r:3+rng()*r*.16}));
  return bitmap(size,size,x=>{
    const image=x.createImageData(size,size),data=image.data;
    const palettes={moon:['d9c8e4','c0add7','a896c6','8d7eaf','706492','51476e'],mars:['f6b17f','e9946f','d97661','bb5a60','98485b','66334f'],jupiter:['f6cf9b','dfb38c','d59b83','bd837d','a86d75','77566d'],saturn:['f3c89c','e8b68b','d99c82','be8181','9e6882','6b4a70'],earth:['6ba9d7','428cd2','2867b9','244fa1','243d85','1e2b62']};
    for(let y=0;y<size;y++)for(let a=0;a<size;a++){
      const nx=(a-centre)/r,ny=(y-centre)/r,d=nx*nx+ny*ny;if(d>1)continue;
      const z=Math.sqrt(1-d),n=fbm(nx*7+seed,ny*7+seed),lit=clamp(nx*-.37+ny*-.42+z*.77);
      let base;
      if(kind==='earth'){
        const lon=Math.atan2(nx,z),lat=Math.asin(ny),land=fbm(lon*3.7+4,lat*4.5+8)+fbm(lon*9,lat*9)*.14;
        base=RGB(land>.61?(land>.72?'d1c68e':land>.66?'83b982':'4c9b82'):'2d72bd');
        const clouds=fbm(lon*10+8,lat*12+19);if(clouds>.64||Math.abs(ny)>.9)base=RGB(clouds>.72?'fcf0df':'b9d8db');
      }else{
        let surface=n;
        if(kind==='jupiter'||kind==='saturn')surface=.5+Math.sin(ny*45+n*4)*.18+Math.sin(ny*87)*.08;
        if(kind==='moon')for(const c of craters){const dd=Math.hypot(a-centre-c.x,y-centre-c.y)/c.r;if(dd<1)surface+=.2-(dd>.75?.25:0);}
        const palette=palettes[kind]||palettes.moon;const idx=Math.floor(clamp(surface*.8+(1-lit)*.7)* (palette.length-1));base=RGB(palette[idx]);
      }
      const level=Math.round((.4+lit*.65)*7)/7,grain=noise(a,y)>.7?1.035:.97;const i=(y*size+a)*4;
      for(let j=0;j<3;j++)data[i+j]=clamp(base[j]*level*grain,0,255);data[i+3]=255;
    }
    x.putImageData(image,0,0);
    // A stepped rim highlight gives the planets the reference's crisp silhouette.
    for(let t=3.55;t<5.4;t+=.022){const a=Math.round(centre+Math.cos(t)*r),b=Math.round(centre+Math.sin(t)*r);rect(x,kind==='earth'?'#86d9f0':'#ebd5e5',a,b,1,1);}
  });
}

export function asteroidSprite(seed=1){
  const rng=seeded(seed),r=9+rng()*7;
  return bitmap(36,36,x=>{
    for(let y=0;y<36;y++)for(let a=0;a<36;a++){
      const dx=a-18,dy=y-18,d=Math.hypot(dx,dy),n=fbm(a*.25+seed,y*.25);
      if(d>r+(n-.5)*7)continue;
      const colors=['#b1a3c2','#9385ac','#74658d','#5b4d74','#3c3558'];
      const k=Math.floor(clamp(d/r*.4+dx/r*.15+dy/r*.2+n*.38)*4);rect(x,colors[k],a,y,1,1);
    }
    for(let i=0;i<4;i++){const a=13+rng()*10,b=12+rng()*11;rect(x,'#4b3f64',a,b,3,2);rect(x,'#a394b6',a,b+2,3,1);}
  });
}

export function satelliteSprite(){return bitmap(51,31,x=>{
  rect(x,'#0d102c',0,5,18,20);rect(x,'#b8dcf1',1,6,16,18);rect(x,'#2c74b5',2,7,14,16);
  rect(x,'#0d102c',33,5,18,20);rect(x,'#b8dcf1',34,6,16,18);rect(x,'#2c74b5',35,7,14,16);
  for(let a=3;a<49;a+=4){if(a>17&&a<33)continue;rect(x,'#69b4dc',a,7,1,16);}rect(x,'#93d0e7',2,14,15,1);rect(x,'#93d0e7',35,14,15,1);
  rect(x,'#9795b9',17,13,17,3);rect(x,'#101128',21,6,9,20);rect(x,'#f8d8a3',22,8,7,15);rect(x,'#b88979',26,8,3,15);rect(x,'#fff2ca',22,8,5,3);rect(x,'#d0c1cc',24,0,2,8);rect(x,'#e6dfda',21,1,8,2);rect(x,'#785f83',23,26,5,4);
});}
export function ufoSprite(){return bitmap(59,30,x=>{
  pixelCircle(x,'#100f2b',30,12,11);pixelCircle(x,'#9ce0e9',30,12,9);rect(x,'#364f74',23,10,15,6);rect(x,'#8edea9',27,7,7,8);rect(x,'#244d4b',28,10,2,2);rect(x,'#244d4b',32,10,2,2);rect(x,'#cef8c9',28,8,2,1);
  for(let y=14;y<25;y++){const width=y<19?(y-13)*7:52-(y-19)*6;rect(x,y<18?'#8e82bc':y<21?'#b1a0d6':'#645783',30-width/2,y,width,1);}
  for(const a of [11,21,31,41,49]){rect(x,'#f8d684',a,21,3,2);rect(x,'#fff0b7',a,21,1,1);}rect(x,'#2d244b',10,25,40,2);
});}
export function astronautSprite(){return bitmap(27,39,x=>{
  const o='#17132c',s='#d3cee3',w='#fff3dc';
  rect(x,o,5,2,18,19);rect(x,o,2,5,24,12);rect(x,s,5,4,18,14);rect(x,w,7,3,12,2);rect(x,'#181d39',7,6,14,10);rect(x,'#454d6d',7,6,11,3);rect(x,'#b2e7eb',8,7,3,2);rect(x,'#f5a1ce',3,10,3,7);rect(x,'#f5a1ce',23,10,3,7);
  rect(x,o,7,20,14,13);rect(x,w,8,21,12,10);rect(x,'#8d8ca9',15,22,4,8);rect(x,'#e69aae',9,23,4,3);rect(x,s,3,20,5,8);rect(x,s,20,21,5,6);rect(x,o,7,32,6,6);rect(x,o,17,31,6,6);rect(x,w,8,32,4,4);rect(x,w,18,31,4,4);
});}

const FONT={R:['11110','10001','10001','11110','10100','10010','10001'],O:['01110','10001','10001','10001','10001','10001','01110'],C:['01111','10000','10000','10000','10000','10000','01111'],K:['10001','10010','10100','11000','10100','10010','10001'],E:['11111','10000','10000','11110','10000','10000','11111'],T:['11111','00100','00100','00100','00100','00100','00100'],U:['10001','10001','10001','10001','10001','10001','01110'],N:['10001','11001','11001','10101','10011','10011','10001']};
export function drawLogo(canvas){
  canvas.width=300;canvas.height=83;const x=canvas.getContext('2d');x.imageSmoothingEnabled=false;
  const stars=(cx,cy,color)=>{rect(x,color,cx-1,cy-5,2,11);rect(x,color,cx-5,cy-1,11,2);rect(x,'#fff5d0',cx,cy,1,1);};
  for(let t=0;t<Math.PI*2;t+=.014){const px=150+Math.cos(t)*105,py=40+Math.sin(t)*32-Math.cos(t)*10;rect(x,'#e5a170',px,py,2,1);}
  const cells=[];[...'ROCKETRUN'].forEach((c,i)=>FONT[c].forEach((row,y)=>[...row].forEach((v,a)=>{if(v==='1')cells.push({a:10+i*30+a*5+Math.floor((6-y)*1.3),b:22+y*5,i,y});})));
  for(const p of cells)rect(x,'#080915',p.a-2,p.b,9,12);
  for(const p of cells)rect(x,'#2d152d',p.a+1,p.b+4,6,7);
  for(const p of cells)rect(x,p.i<6?['#fff8df','#fff0cf','#ffe4b5','#f8d49d','#f4cb92','#ebba83','#dfa574'][p.y]:['#ff8a64','#ff6852','#fc514b','#ed3d44','#d92e3e','#c2273e','#a41e36'][p.y],p.a,p.b,5,5);
  stars(238,10,'#ffe3a5');stars(73,74,'#f5ba80');stars(274,29,'#ffe0a4');
}
