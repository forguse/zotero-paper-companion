const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PCEdgeTrail:Trail,PCEdgeLight:Light}=require('../addon/content/edge-light.js');

test('fast vertical border movement leaves a continuous bounded sample path',()=>{
  const t=new Trail();t.touch('card',{x:0,y:20},'left',0);t.touch('card',{x:0,y:260},'left',100);
  const points=t.points.filter(p=>p.key==='card');assert.equal(points[0].y,20);assert.equal(points.at(-1).y,260);
  for(let i=1;i<points.length;i++)assert(points[i].y-points[i-1].y<=12);
  assert(points.every(p=>p.x===0&&p.edge==='left'));
});

test('departure keeps the touched side and extends to the new projected height',()=>{
  const t=new Trail();t.touch('card',{x:0,y:30},'left',0);t.depart(100);
  const p=Trail.project({left:50,top:50,width:300,height:500},{x:220,y:350},'left');
  const state=t.extend(p,700);assert.equal(state.last.x,0);assert.equal(state.last.y,300);
  assert(t.points.some(p=>p.y>120&&p.y<280));assert.equal(t.states.get('card').departedAt,100);
});

test('moving during the departure window cannot postpone its fixed expiry',()=>{
  const t=new Trail();t.touch('card',{x:0,y:20},'left',0);t.depart(100);
  for(const now of [500,1100,2000,2500])t.extend({x:0,y:now/10},now);
  assert(t.points.every(p=>p.expires<=2600));assert.equal(t.extend({x:0,y:400},2601),null);
  t.prune(2601);assert.equal(t.active,null);assert.equal(t.states.size,0);assert.equal(t.points.length,0);assert.equal(t.nextExpiry(),null);
});

test('moving to another control lets the old trail expire independently',()=>{
  const t=new Trail();t.touch('first',{x:0,y:10},'left',0);t.touch('second',{x:20,y:0},'top',300);
  assert.equal(t.active,'second');assert.equal(t.states.get('first').departedAt,300);
  t.prune(2600);assert(t.states.has('first'));assert(t.points.some(p=>p.key==='second'));
  t.prune(2801);assert(!t.states.has('first'));assert(t.states.has('second'));
});

test('reentering starts a new stroke but brief edge jitter does not strobe',()=>{
  const t=new Trail();assert(t.touch('card',{x:0,y:0},'left',0).pulse);
  t.depart(50);assert.equal(t.touch('card',{x:0,y:20},'left',100).pulse,false);
  t.depart(150);assert(t.touch('card',{x:0,y:40},'left',400).pulse);
  assert.equal(t.states.get('card').departedAt,null);
});

test('long movements and rapid transitions cannot grow particle history without a bound',()=>{
  const t=new Trail();for(let i=0;i<300;i++)t.touch('card'+(i%15),{x:0,y:i*8},'left',i*3);
  assert(t.points.length<=96);assert(t.states.size<=8);assert(t.states.has(t.active));
  assert(t.points.every(p=>t.states.has(p.key)));
});

test('projection clamps to the border and ignores missing sides',()=>{
  const r={left:100,top:100,width:200,height:300},edges={left:1,top:0,right:0,bottom:0};
  assert.deepEqual(Trail.project(r,{x:200,y:50},null,edges,8),{x:0,y:8,edge:'left'});
  assert.deepEqual(Trail.project(r,{x:800,y:900},'left',edges,8),{x:0,y:292,edge:'left'});
  assert.equal(Trail.project(r,{x:200,y:50},'right',edges),null);
});

test('clear removes active, departing and pending histories immediately',()=>{
  const t=new Trail();t.touch('a',{x:0,y:10},'left',0);t.touch('b',{x:20,y:0},'top',100);t.depart(200);t.clear();
  assert.equal(t.points.length,0);assert.equal(t.states.size,0);assert.equal(t.active,null);assert.equal(t.nextExpiry(),null);
});

test('pointer updates still paint when an embedded document never delivers its animation frame',async()=>{
  let paints=0,requests=0;
  const light=Object.create(Light.prototype);light.win={requestAnimationFrame:()=>++requests,cancelAnimationFrame(){},setTimeout,clearTimeout};light.paint=()=>paints++;
  for(let i=0;i<30;i++)light.schedule();await new Promise(r=>setTimeout(r,55));
  assert.equal(requests,1);assert.equal(paints,1);assert.equal(light.frame,0);assert.equal(light.fallback,null);
  await new Promise(r=>setTimeout(r,45));assert.equal(paints,1);
});

test('overlapping horizontal and vertical reveal stamps share one target-relative color phase',()=>{
  const place=(point)=>{const properties=new Map(),node={style:{setProperty:(key,value)=>properties.set(key,value)},dataset:{}};Light.prototype.placeDot.call({},node,point,.667);return{node,properties};};
  for(const edge of ['top','bottom','left','right']){
    const vertical=edge==='left'||edge==='right';
    const first=place({x:vertical?0:100,y:vertical?100:0,edge}),second=place({x:vertical?0:112,y:vertical?112:0,edge});
    for(const targetCoordinate of [101,106,111]){
      const phase=stamp=>{const origin=parseFloat(stamp.node.style[vertical?'top':'left']),offset=parseFloat(stamp.properties.get(vertical?'--edge-field-y':'--edge-field-x'));return targetCoordinate-origin-offset;};
      assert.equal(phase(first),targetCoordinate);assert.equal(phase(first),phase(second));
    }
    assert.equal(first.node.dataset.edge,edge);assert(Math.abs(parseFloat(first.properties.get('--particle-cross'))-(36+(['right','bottom'].includes(edge)?-1:1)*.667/2))<.0001);
  }
  assert.equal(Trail.radius*2,72);assert.equal(Trail.duration,2500);
});
test('theme border colors keep the approved primary and add real hue separation rather than only brightness variants',()=>{
  const core=require('../addon/content/core.js'),primaries={cloud:'#315F73',blue:'#28548E',warm:'#79415E',dark:'#D9EFFF'};
  const chroma=hex=>{const rgb=[1,3,5].map(offset=>parseInt(hex.slice(offset,offset+2),16)),mean=rgb.reduce((n,v)=>n+v,0)/3,v=rgb.map(n=>n-mean),length=Math.hypot(...v);return v.map(n=>n/length);};
  for(const theme of Object.keys(primaries)){
    const palette=core.surfacePalette(theme);assert.equal(palette.edgeA,primaries[theme]);
    for(const colors of [[palette.edgeA,palette.edgeB,palette.edgeC],[palette.edgeBrightA,palette.edgeBrightB,palette.edgeBrightC]]){
      const signatures=colors.map(chroma);let difference=0;
      for(const one of signatures)for(const two of signatures)difference=Math.max(difference,Math.hypot(...one.map((v,i)=>v-two[i])));
      assert(difference>.55,theme+' has visible related-color hue variation');
    }
  }
});
