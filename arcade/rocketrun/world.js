import { altitudeToY } from './data.js';
import { bitmap,rocketSprite,planetSprite,satelliteSprite,ufoSprite,astronautSprite,asteroidSprite,seeded,clamp,mix,smooth,rect,pixelCircle } from './pixels.js';

const lerpColor=(a,b,t)=>{const n=s=>s.slice(1).match(/../g).map(v=>parseInt(v,16));const c=n(a),d=n(b);return `rgb(${c.map((v,i)=>Math.round(mix(v,d[i],t))).join(',')})`;};

export class RocketWorld {
  constructor(el,onUpdate){
    this.el=el;this.onUpdate=onUpdate;this.canvas=document.createElement('canvas');this.canvas.setAttribute('aria-label','Live pixel-art rocket flight');
    this.ctx=this.canvas.getContext('2d',{alpha:false});el.append(this.canvas);
    this.altitude=0;this.targetAltitude=0;this.flight=null;this.power=0;this.time=0;this.layout='menu';this.rocketScreenY=0;this.particles=[];this.bursts=[];
    this.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;this.low=false;this.paused=false;
    this.rng=seeded(1306);this.images={};this.ready=false;
    this.sprites={rocket:rocketSprite(),moon:planetSprite('moon',47,8),mars:planetSprite('mars',33,5),jupiter:planetSprite('jupiter',60,7),saturn:planetSprite('saturn',32,3),earth:planetSprite('earth',310,4),satellite:satelliteSprite(),ufo:ufoSprite(),astronaut:astronautSprite()};
    this.rocks=Array.from({length:8},(_,i)=>asteroidSprite(i*13+2));
    this.stars=Array.from({length:190},()=>({x:this.rng(),y:this.rng(),size:this.rng()>.93?3:1,t:this.rng()*9,color:['#f7d3ce','#c79ce5','#7070ad','#ffe4ac'][Math.floor(this.rng()*4)],depth:.1+this.rng()*.5}));
    this.clouds=Array.from({length:18},(_,i)=>({x:(i%2?this.rng()*.3+.68:this.rng()*.3-.2),y:this.rng()*1000,scale:.55+this.rng()*.8,speed:.13+this.rng()*.4,sprite:i%8}));
    this.asteroids=Array.from({length:22},(_,i)=>({x:i%2?.7+this.rng()*.3:this.rng()*.27,y:1280+this.rng()*570,sprite:i%8,scale:.45+this.rng()*.7}));
    this.galaxy=this.makeGalaxy();this.trailClock=0;this.fps=60;this.ringedSaturn=this.makeSaturn();
    this.blackHoleFrames=Array.from({length:8},(_,i)=>this.makeBlackHoleFrame(i*Math.PI/4));
    this.loadImages();this.resize();this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(el);
    this.last=performance.now();this.frame=this.frame.bind(this);this.frameId=requestAnimationFrame(this.frame);
    this.onVisibility=()=>this.syncClock();document.addEventListener('visibilitychange',this.onVisibility);
  }
  async loadImages(){
    const base=new URL('./',import.meta.url).href;
    const entries=[['city','neon-city.png'],['clouds','cloudbreak.png'],['cosmos','deep-cosmos.png'],['cloudWisp','cloud-wisp.png'],['atlas','planet-atlas.png']].map(([key,file])=>[key,`${base}art/${file}`]);
    await Promise.all(entries.map(([key,url])=>new Promise(resolve=>{const i=new Image();i.onload=()=>{this.images[key]=i;resolve();};i.onerror=()=>resolve();i.src=url;})));
    if(this.destroyed)return;
    if(this.images.atlas){
      const atlas=this.images.atlas,scale=atlas.width/1280;
      const cut=(sx,sy,sw,sh,w,h)=>bitmap(w,h,c=>c.drawImage(atlas,sx*scale,sy*scale,sw*scale,sh*scale,0,0,w,h));
      this.sprites.moon=cut(45,65,480,480,96,96);
      this.ringedSaturn=cut(590,105,640,410,150,96);
      this.sprites.mars=cut(115,740,370,370,70,70);
      this.sprites.jupiter=cut(580,600,630,630,130,130);
    }
    this.ready=true;document.body.dataset.artReady='true';
  }
  resize(){const bounds=this.el.getBoundingClientRect();this.W=320;this.H=Math.round(bounds.height/Math.max(1,bounds.width)*this.W);this.canvas.width=this.W;this.canvas.height=this.H;this.ctx.imageSmoothingEnabled=false;if(!this.rocketScreenY)this.rocketScreenY=this.H*.851-27;}
  setLayout(mode){this.layout=mode;}
  setQuality(low){this.low=low;}
  setPaused(value){
    if(value===this.paused)return;this.paused=value;this.syncClock();
  }
  syncClock(){
    const now=performance.now(),blocked=this.paused||document.hidden;
    if(blocked&&this.frozenAt==null)this.frozenAt=now;
    if(!blocked&&this.frozenAt!=null){
      if(this.flight)this.flight.start+=now-Math.max(this.frozenAt,this.flight.start);
      this.frozenAt=null;
    }
    this.last=now;
  }
  destroy(){
    this.destroyed=true;cancelAnimationFrame(this.frameId);this.resizeObserver.disconnect();
    document.removeEventListener('visibilitychange',this.onVisibility);
    this.flight=null;this.onUpdate=null;this.canvas.remove();
  }
  jump(altitude){this.flight=null;this.altitude=altitude;this.targetAltitude=altitude;this.power=0;this.bursts=[];this.particles=[];}
  launch(gain,power,onComplete){
    this.power=power;this.targetAltitude=this.altitude+gain;
    this.flight={from:this.altitude,to:this.targetAltitude,start:performance.now(),duration:this.reduced?2600:8600+power*1200,onComplete};
    const colors=power>.9?['#ffb2f4','#e772ff','#fff0bd','#8bd9ff']:power>.8?['#ffe3a1','#ffb75f','#fff4d1']:power>.6?['#f8c4f1','#ba97ff','#fff0cd']:power>.4?['#89edcd','#d6f6c7']:['#ffe3b3','#d3bfdc'];
    for(let i=0;i<35+power*55;i++)this.bursts.push({x:this.W/2,y:this.H*.41,vx:(this.rng()-.5)*(50+power*100),vy:(this.rng()-.6)*110,life:1.3+this.rng(),max:2.3,size:this.rng()>.8?3:1,color:colors[i%colors.length]});
  }
  makeGalaxy(){return bitmap(280,240,x=>{const rng=seeded(42);for(let i=0;i<6500;i++){const r=Math.pow(rng(),.7)*112,a=r*.06+(i%3)*Math.PI*2/3+(rng()-.5)*.5;const px=140+Math.cos(a)*r,py=120+Math.sin(a)*r*.52;rect(x,['#6b307d','#ad4cba','#e184d4','#ffe3cd','#8253ab'][i%5],px,py,r<15?2:1,1);}});}
  makeSaturn(){return bitmap(150,100,c=>{c.save();c.translate(75,50);c.rotate(-.35);const ring=front=>{for(let t=front?0:Math.PI;t<(front?Math.PI:Math.PI*2);t+=.012)for(let r=42;r<61;r++)rect(c,['#9c6e91','#e1a58f','#f3c29a','#9c698e','#d89b8a'][Math.floor((r-42)/4)],Math.cos(t)*r,Math.sin(t)*r*.27,2,1);};ring(false);c.drawImage(this.sprites.saturn,-36,-36);ring(true);c.restore();});}
  image(key,x,y,w,h,alpha=1){const im=this.images[key];if(!im||alpha<=0)return;this.ctx.globalAlpha=clamp(alpha);this.ctx.drawImage(im,Math.round(x),Math.round(y),Math.round(w),Math.round(h));this.ctx.globalAlpha=1;}
  star(x,y,size,color,alpha=1){const c=this.ctx;c.globalAlpha=clamp(alpha);rect(c,color,x,y,1,1);if(size>1){rect(c,color,x-size,y,size*2+1,1);rect(c,color,x,y-size,1,size*2+1);rect(c,'#fff6d7',x,y,1,1);}c.globalAlpha=1;}
  drawSky(y,t){
    const c=this.ctx,W=this.W,H=this.H,space=smooth(290,730,y);
    const g=c.createLinearGradient(0,0,0,H);g.addColorStop(0,lerpColor('#20234e','#0b0d25',space));g.addColorStop(.5,lerpColor('#4d3184','#111336',space));g.addColorStop(1,lerpColor('#ec779e','#182147',space));c.fillStyle=g;c.fillRect(0,0,W,H);
    this.image('cosmos',-5,-20-Math.max(0,y-700)*.035,W+10,H+200,smooth(670,1300,y));
    this.stars.forEach(s=>{const sy=((s.y*H+y*s.depth*.2)%(H+20))-10;this.star(s.x*W,sy,s.size,s.color,(.4+Math.sin(t*1.3+s.t)*.23)*smooth(20,500,y));});
  }
  drawCity(y,t,boost){
    const W=this.W,H=this.H,c=this.ctx;
    const cityFade=1-smooth(130,400,y),cloudFade=smooth(65,260,y)*(1-smooth(390,710,y));
    this.image('city',0,y*.66,W,H,cityFade);
    this.image('clouds',0,(y-230)*.31,W,H,cloudFade);
    if(y<145){
      c.globalAlpha=(1-smooth(60,145,y))*(.55+Math.sin(t*2)*.1);
      for(let i=0;i<8;i++)rect(c,i%2?'#ffdc7a':'#ffc062',W*.4+i*9,H*.851+y*.66,4,1);
      c.globalAlpha=1;
      for(const [a,b] of [[.055,.77],[.77,.84],[.056,.37],[.965,.38],[.144,.627],[.142,.64],[.806,.65],[.913,.7],[.29,.69],[.665,.73],[.39,.79]]){c.globalAlpha=.5+Math.sin(t*2+a*25)*.4;rect(c,'#ffe4a0',W*a,H*b+y*.66,1,2);}c.globalAlpha=1;
    }
    if(y<740){
      // Independently scrolling transparent cloud sprites maintain the reference
      // palette and cluster shading; the dense painted cloud sea sits behind them.
      this.clouds.slice(0,7).forEach((p,i)=>{
        const py=((p.y+y*p.speed*1.8)%(H+180))-95;
        const alpha=(y<3?.20:smooth(0,45,y)*.8)*(1-smooth(480,740,y));
        const sprite=this.images.cloudWisp;if(!sprite)return;
        c.globalAlpha=alpha;c.drawImage(sprite,Math.round(p.x*W+Math.sin(t*.07+i)*9),Math.round(py),Math.round(155*p.scale),Math.round(52*p.scale));
      });c.globalAlpha=1;
      if(y>180&&y<400){const a=((t*3)%420)-50,b=H*.39;rect(c,'#a699ce',a,b,17,2);rect(c,'#dfcae4',a+6,b-2,5,5);rect(c,'#a699ce',a+9,b-6,2,13);if(Math.sin(t*5)>.5)rect(c,'#ffa89d',a+9,b+6,1,1);}
      if(!this.reduced&&y>220&&y<350&&Math.sin(t*1.7)>.998){c.globalAlpha=.12;c.fillStyle='#ddcbff';c.fillRect(0,0,W,H);c.globalAlpha=1;}
    }
    if(boost>.6&&y<100){c.globalAlpha=.06*boost;rect(c,'#ffe9aa',0,H*.8,W,H*.2);c.globalAlpha=1;}
  }
  drawEarth(y){
    const c=this.ctx,W=this.W,H=this.H,alpha=smooth(300,570,y)*(1-smooth(1050,1500,y));if(alpha<.01)return;
    const size=W*2.1,cx=W*.48,cy=H+size*.34+Math.max(0,y-870)*.5;
    c.globalAlpha=alpha;
    pixelCircle(c,'#213e98',cx,cy,size*.505+9);pixelCircle(c,'#498cce',cx,cy,size*.505+5);pixelCircle(c,'#a4e4ef',cx,cy,size*.505+2);
    c.drawImage(this.sprites.earth,Math.round(cx-size*.52),Math.round(cy-size*.52),Math.round(size*1.04),Math.round(size*1.04));c.globalAlpha=1;
  }
  landmark(sprite,x,worldY,y,scale=1,rate=.5){
    const c=this.ctx,py=this.H*.29+(y-worldY)*rate,sp=typeof sprite==='string'?this.sprites[sprite]:sprite;
    if(py<-200||py>this.H+200)return;
    const alpha=smooth(620,790,y);c.globalAlpha=alpha;c.drawImage(sp,Math.round(x-sp.width*scale/2),Math.round(py-sp.height*scale/2),Math.round(sp.width*scale),Math.round(sp.height*scale));c.globalAlpha=1;
  }
  drawSaturn(cx,cy,scale=1){this.ctx.drawImage(this.ringedSaturn,Math.round(cx-75*scale),Math.round(cy-50*scale),Math.round(150*scale),Math.round(100*scale));}
  drawSpace(y,t){
    const c=this.ctx,W=this.W,H=this.H;
    this.drawEarth(y);
    this.landmark('moon',W*.82,1200,y,.9);
    if(y>800&&y<1900){const py=H*.27+(y-1460)*.5;if(py>-100&&py<H+120)this.drawSaturn(W*.18,py,.78);}
    this.landmark('mars',W*.23,1680,y,.72);
    this.landmark('jupiter',W*.85,1780,y,.87);
    this.asteroids.forEach(a=>{const py=H*.4+(y-a.y)*.85;if(py<-35||py>H+35)return;c.drawImage(this.rocks[a.sprite],Math.round(a.x*W),Math.round(py),Math.round(36*a.scale),Math.round(36*a.scale));});
    if(y>580&&y<1250){
      const py=H*.7+(y-900)*.6;c.save();c.translate(Math.round(W*.19),Math.round(py));c.rotate(-.27+Math.sin(t*.3)*.03);c.drawImage(this.sprites.satellite,-25,-15);c.restore();
    }
    if(y>800&&y<2200){
      const py=H*.65+(y-1390)*.5,ux=W*.82+Math.sin(t*.35)*6;c.save();c.translate(Math.round(ux),Math.round(py));
      c.globalAlpha=.1+(Math.sin(t*2)+1)*.03;c.fillStyle='#9ea0fa';c.beginPath();c.moveTo(-7,10);c.lineTo(-24,80);c.lineTo(24,80);c.lineTo(7,10);c.fill();c.globalAlpha=1;c.drawImage(this.sprites.ufo,-29,-15);c.restore();
      const ay=H*.54+(y-1620)*.45;c.save();c.translate(W*.19,ay);c.rotate(Math.sin(t*.3)*.15);c.drawImage(this.sprites.astronaut,-13,-19);c.restore();
      if(ay>100&&ay<H-100){rect(c,'#ded4ec',W*.19+13,ay-28,14,12);rect(c,'#2c2249',W*.19+18,ay-25,2,6);rect(c,'#2c2249',W*.19+15,ay-20,4,2);}
    }
    if(y>1500&&y<2460){const py=H*.36+(y-1970)*.35;c.save();c.globalAlpha=smooth(1500,1830,y);c.translate(W*.65,py);c.rotate(-.45);c.drawImage(this.galaxy,-130,-120);c.restore();}
    if(y>2130)this.drawBlackHole(y,t);
  }
  makeBlackHoleFrame(phase){
    return bitmap(190,120,c=>{const r=26;c.translate(95,60);c.rotate(-.28);
    for(let k=8;k>=0;k--){for(let a=0;a<Math.PI*2;a+=.018){const rr=r+k*.9;rect(c,['#fff3c2','#ffd986','#eab582','#c78ba3','#9965a5','#64417f','#422c61','#2c204a','#211a3d'][k],Math.cos(a)*rr,Math.sin(a)*rr,1,1);}}
    pixelCircle(c,'#08081a',0,0,r-1);
    for(let rr=36;rr<80;rr++)for(let a=0;a<Math.PI*2;a+=.018){
      const px=Math.cos(a)*rr,py=Math.sin(a)*rr*.2+4;if(a>Math.PI&&Math.abs(px)<r-2)continue;
      const colors=['#ffefd0','#ffc480','#e88e93','#aa5c92','#5e3976'];const i=Math.min(4,Math.floor((rr-36)/9));
      if(Math.sin(rr*.8+a*3-phase)>.05)rect(c,colors[i],px,py,1,1);
    }
    });
  }
  drawBlackHole(y,t){
    const c=this.ctx,cx=this.W*.68,cy=this.H*.30+Math.min(90,(y-2400)*.3),alpha=smooth(2130,2380,y);
    c.globalAlpha=alpha;c.drawImage(this.blackHoleFrames[Math.floor(t*8)%8],Math.round(cx-95),Math.round(cy-60));
    for(let i=0;i<24;i++){const a=t*.12+i*.31,rr=78+(i%4)*8;this.star(cx+Math.cos(a)*rr,cy+Math.sin(a)*rr*.42,1,i%2?'#bb8ed3':'#ffe0ab',alpha*.6);}c.globalAlpha=1;
  }
  drawExhaust(x,y,power,t){
    const c=this.ctx,length=5+power*53,flameWidth=3+power*3;
    c.save();c.globalCompositeOperation='screen';const g=c.createRadialGradient(x,y+8,1,x,y+8,22+power*9);g.addColorStop(0,'#ffb22c55');g.addColorStop(1,'#ff6f1600');c.fillStyle=g;c.fillRect(x-35,y-26,70,100);c.restore();
    for(let row=0;row<length;row++){
      const wave=Math.sin(row*.65+t*34)*.7,width=Math.max(1,Math.round(flameWidth*(1-row/length)+wave));
      rect(c,row<length*.45?'#ff8a3e':row<length*.75?'#ee6348':'#f6a95b',x-width,y+row,width*2,1);
      if(row<length*.75){const w=Math.max(1,Math.floor(width*.66));rect(c,row<length*.33?'#fff5cf':'#ffd780',x-w,y+row,w*2,1);}
    }
  }
  updateParticles(dt,x,y,boost,ignition){
    const c=this.ctx;this.trailClock+=dt;const count=this.low?1:2;
    if(this.trailClock>.025){this.trailClock=0;for(let i=0;i<count;i++)this.particles.push({x:x+(this.rng()-.5)*5,y:y+2,vx:(this.rng()-.5)*(ignition?40:12),vy:ignition?-4-this.rng()*10:14+boost*85,life:.3+this.rng()*(ignition?1.5:.7),max:1.5,size:ignition?3+this.rng()*7:1+this.rng()*2,color:ignition?['#d6add3','#a17fae','#ecc3c9'][i%3]:['#ffdfa1','#f8a764','#f3d7ba','#d69cb8'][Math.floor(this.rng()*4)],smoke:ignition});}
    for(let i=this.particles.length-1;i>=0;i--){const p=this.particles[i];p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;if(p.life<=0){this.particles.splice(i,1);continue;}c.globalAlpha=clamp(p.life/p.max)*.9;if(p.smoke){const size=p.size*(1.6-p.life*.4);rect(c,p.color,p.x-size/2,p.y-size/2,size,size*.7);}else rect(c,p.color,p.x,p.y,p.size,p.size);c.globalAlpha=1;}
    for(let i=this.bursts.length-1;i>=0;i--){const p=this.bursts[i];p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=25*dt;if(p.life<=0){this.bursts.splice(i,1);continue;}this.star(p.x,p.y,p.size,p.color,Math.min(1,p.life*2));}
  }
  frame(now){
    if(this.destroyed)return;this.frameId=requestAnimationFrame(this.frame);if(document.hidden||this.paused){this.last=now;return;}
    const dt=Math.min(.05,(now-this.last)/1000);this.last=now;this.time+=dt;this.fps=mix(this.fps,1/Math.max(dt,.001),.03);
    let boost=0,p=0,ignition=false;
    if(this.flight){p=clamp((now-this.flight.start)/this.flight.duration);const wait=this.reduced?.03:.10;const travel=clamp((p-wait)/(1-wait)),eased=travel*travel*(3-2*travel);this.altitude=mix(this.flight.from,this.flight.to,eased);ignition=p<wait;boost=ignition?.15:Math.sin(travel*Math.PI)*this.power;if(p>=1){const done=this.flight.onComplete;this.flight=null;done?.();}}
    const y=altitudeToY(this.altitude),c=this.ctx,W=this.W,H=this.H,t=this.time;c.save();
    if(!this.reduced&&boost>.5)c.translate(Math.round(Math.sin(t*71)*boost),Math.round(Math.cos(t*59)*boost));
    this.drawSky(y,t);this.drawCity(y,t,boost);this.drawSpace(y,t);
    const target=this.altitude<1?H*.851-27:(this.layout==='flight'?H*.57:H*.70);this.rocketScreenY=mix(this.rocketScreenY,target,1-Math.exp(-dt*(this.reduced?12:2.8)));
    const rx=W*.5+(this.reduced?0:Math.sin(t*1.1)*1.3)+(ignition?Math.round(Math.sin(t*90)):0),ry=this.rocketScreenY;
    if(!this.reduced&&boost>.3){for(let i=0;i<16;i++){const sx=(i*43.7)%W,sy=((i*53+t*(130+boost*170))%(H+60))-30;c.globalAlpha=boost*.25;rect(c,'#d7bbeb',sx,sy,1,5+boost*13);}c.globalAlpha=1;}
    this.drawExhaust(rx,ry+24,ignition?.3:this.altitude<1?.035:.15+boost,t);this.updateParticles(dt,rx,ry+27,boost,ignition||this.altitude<1);
    c.save();c.translate(Math.round(rx),Math.round(ry));if(!this.reduced)c.rotate(Math.sin(t*2)*.015*boost);c.drawImage(this.sprites.rocket,-17,-31,34,58);c.restore();
    if(this.flight&&!this.reduced){const boom=p*5-1.1;if(boom>0&&boom<1&&this.power>.6){c.globalAlpha=(1-boom)*.55;c.strokeStyle=this.power>.9?'#ffc7f4':'#ffe8b5';c.lineWidth=1;c.beginPath();c.ellipse(rx,ry+24+boom*18,12+boom*125,3+boom*21,0,0,Math.PI*2);c.stroke();c.globalAlpha=1;}if(p>.105&&p<.125){c.globalAlpha=.12*this.power;rect(c,'#fff1c5',0,0,W,H);c.globalAlpha=1;}}
    c.restore();this.onUpdate?.({altitude:this.altitude,boost,speed:boost*(200+this.power*1800),progress:p,y,fps:this.fps,ready:this.ready,paused:this.paused});
  }
}
