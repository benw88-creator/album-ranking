// All sound is synthesised here with Web Audio. No samples or copyrighted audio.
export class FlightAudio {
  constructor(){this.enabled=false;this.paused=false;this.ctx=null;}
  init(){
    if(this.ctx){this.ctx.resume();return;}
    this.ctx=new (window.AudioContext||window.webkitAudioContext)();
    this.master=this.ctx.createGain();this.master.gain.value=this.enabled&&!this.paused?.19:0;this.master.connect(this.ctx.destination);
    const buffer=this.ctx.createBuffer(1,this.ctx.sampleRate*2,this.ctx.sampleRate);
    const d=buffer.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;
    this.noise=this.ctx.createBufferSource();this.noise.buffer=buffer;this.noise.loop=true;
    this.filter=this.ctx.createBiquadFilter();this.filter.type='lowpass';this.filter.frequency.value=180;
    this.engine=this.ctx.createGain();this.engine.gain.value=.025;
    this.noise.connect(this.filter);this.filter.connect(this.engine);this.engine.connect(this.master);this.noise.start();
  }
  toggle(){this.enabled=!this.enabled;this.init();this.master.gain.setTargetAtTime(this.enabled&&!this.paused?.19:0,this.ctx.currentTime,.15);return this.enabled;}
  pause(paused){this.paused=paused;if(this.ctx)this.master.gain.setTargetAtTime(this.enabled&&!paused?.19:0,this.ctx.currentTime,.05);}
  async destroy(){
    const ctx=this.ctx;if(!ctx)return;
    this.enabled=false;this.noise.stop();this.master.disconnect();this.ctx=null;
    await ctx.close();
  }
  note(f,t,len=.3,type='sine',volume=.25){
    if(!this.ctx)return;const o=this.ctx.createOscillator(),g=this.ctx.createGain();o.type=type;o.frequency.value=f;
    g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(volume,t+.02);g.gain.exponentialRampToValueAtTime(.001,t+len);
    o.connect(g);g.connect(this.master);o.start(t);o.stop(t+len+.05);
  }
  click(){this.init();this.note(660,this.ctx.currentTime,.12,'sine',.12);}
  launch(grade){
    this.init();const t=this.ctx.currentTime;
    [0,4,7,12,16,19].slice(0,grade+2).forEach((n,i)=>this.note(220*2**(n/12),t+i*.1,.7,'triangle',.22));
    this.engine.gain.cancelScheduledValues(t);this.engine.gain.setValueAtTime(.04,t);this.engine.gain.linearRampToValueAtTime(.5+grade*.22,t+1);
    this.engine.gain.exponentialRampToValueAtTime(.025,t+7);
    this.filter.frequency.setValueAtTime(150,t);this.filter.frequency.exponentialRampToValueAtTime(1300+grade*450,t+2);this.filter.frequency.exponentialRampToValueAtTime(180,t+7);
    this.note(65,t+.5,2,'sine',.6);
  }
}
