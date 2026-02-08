/* Baikonur ISO Shooter — game.js (псевдо-3D изометрия)
   Важно: это оффлайн MVP (без сетевого PvP).
*/
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d", { alpha:false });

const isTouch = matchMedia("(pointer: coarse)").matches;

function clamp(n,a,b){ return Math.max(a, Math.min(b,n)); }
function rand(a,b){ return a + Math.random()*(b-a); }
function dist2(ax,ay,bx,by){ const dx=ax-bx, dy=ay-by; return dx*dx+dy*dy; }

const IMG = {};
function loadImage(name, src){
  return new Promise((resolve)=>{ const img=new Image(); img.onload=()=>{IMG[name]=img; resolve();}; img.src=src; });
}
async function loadAssets(){
  await Promise.all([
    loadImage("player","./assets/player.svg"),
    loadImage("enemy","./assets/enemy.svg"),
  ]);
}

let running=false, paused=false, lastTs=0;

const WORLD = { w: 2400, h: 1600 };

// --- ISO projection ---
const ISO = { tileW: 74, tileH: 38, height: 44 }; // pseudo height for buildings
function worldToIso(x,y){
  // convert world coords (x,y) to iso plane coordinates (u,v)
  const u = (x - y) * (ISO.tileW / (2*ISO.tileW)); // normalize a bit
  const v = (x + y) * (ISO.tileH / (2*ISO.tileH));
  // We'll scale properly in draw using tileW/H multipliers
  return { u:(x-y)/2, v:(x+y)/2 };
}
function isoToScreen(ix,iy, cam){
  // ix/iy are iso plane coords in "world units"
  const sx = (ix - cam.ix) * (ISO.tileW / 44) + canvas.width/2;
  const sy = (iy - cam.iy) * (ISO.tileH / 44) + canvas.height/2;
  return { x:sx, y:sy };
}
function worldToScreen(x,y, cam){
  const {u,v}=worldToIso(x,y);
  return isoToScreen(u,v,cam);
}

function camera(){
  // camera in iso plane centered on player
  const pIso = worldToIso(player.x, player.y);
  return { ix: pIso.u, iy: pIso.v };
}

// --- Map, obstacles, zones ---
function buildMap(districtId){
  const d = APPSTATE.districts.find(x=>x.id===districtId);
  const palette = d ? d.palette : ["#0e1a33","#16254a","#1f3563","#2a4580"];

  const seed = (districtId||"x").split("").reduce((a,c)=>a+c.charCodeAt(0),0);
  function sr(n){ return (Math.sin(n*999 + seed*13.7) * 10000) % 1; }

  const obstacles=[];
  // border
  obstacles.push({x:0,y:0,w:WORLD.w,h:26},{x:0,y:WORLD.h-26,w:WORLD.w,h:26},{x:0,y:0,w:26,h:WORLD.h},{x:WORLD.w-26,y:0,w:26,h:WORLD.h});

  // blocks (buildings)
  for(let i=0;i<22;i++){
    const x = 140 + Math.floor(Math.abs(sr(i+1))*(WORLD.w-360));
    const y = 140 + Math.floor(Math.abs(sr(i+31))*(WORLD.h-360));
    const w = 130 + Math.floor(Math.abs(sr(i+61))*240);
    const h = 110 + Math.floor(Math.abs(sr(i+91))*220);
    if(Math.abs(x-WORLD.w/2)<240 && Math.abs(y-WORLD.h/2)<200) continue;
    obstacles.push({x,y,w,h});
  }

  // zones: mini-quests
  const zones = [
    { id:"dvory", name:"Дворы",      rect:{x:180,y:220,w:520,h:420} },
    { id:"alleya",name:"Аллея",      rect:{x:820,y:240,w:560,h:380} },
    { id:"plosh", name:"Площадь",    rect:{x:980,y:820,w:520,h:420} },
    { id:"garaji",name:"Гаражи",     rect:{x:260,y:880,w:520,h:420} },
  ];

  // portals
  const portals=[
    { x: 110, y: WORLD.h/2-70, r: 28, to:{ x: WORLD.w-160, y: WORLD.h/2-70 } },
    { x: WORLD.w-110, y: WORLD.h/2+70, r: 28, to:{ x: 160, y: WORLD.h/2+70 } },
  ];

  return { palette, obstacles, portals, zones };
}

// --- Entities ---
const player = {
  x: WORLD.w/2, y: WORLD.h/2,
  vx:0, vy:0, r:18,
  hp:100, shield:0,
  speed:250, dashCd:0, dashTime:0,
  aimX:1, aimY:0,
  weapon:"blaster", skin:null,
  speedMul:1.0, shieldStart:0, hpStart:0,
};

let bullets=[], enemies=[], pickups=[], particles=[];

const game = {
  wave: 1,
  coinsEarned: 0,
  map: null,
  activeZone: null,
  zoneQuest: null, // {zoneId, type, goal, progress, reward, timer}
};

function weaponStats(mode){
  if(mode==="smg")    return { rate:0.07, dmg:7,  spread:0.17, speed:760, pellets:1 };
  if(mode==="shotgun")return { rate:0.55, dmg:9,  spread:0.30, speed:720, pellets:7 };
  if(mode==="rifle")  return { rate:0.18, dmg:16, spread:0.08, speed:860, pellets:1 };
  if(mode==="sniper") return { rate:0.85, dmg:44, spread:0.03, speed:1100,pellets:1 };
  return              { rate:0.14, dmg:12, spread:0.10, speed:820, pellets:1 }; // blaster
}

function applyEquipment(){
  const s = APPSTATE.get();
  const eq = s.equipped || {};
  player.weapon = eq.weapon || "blaster";
  player.skin = eq.skin || null;

  player.speedMul = 1.0;
  player.shieldStart = 0;
  player.hpStart = 0;

  (eq.gear||[]).forEach(id=>{
    if(id==="boots") player.speedMul *= 1.10;
    if(id==="armor") player.shieldStart += 40;
  });
  (eq.boosts||[]).forEach(id=>{
    if(id==="medkit") player.hpStart += 35;
    if(id==="shield") player.shieldStart += 30;
  });
}

function resetRun(){
  const s = APPSTATE.get();
  bullets=[]; enemies=[]; pickups=[]; particles=[];
  game.wave=1; game.coinsEarned=0; game.activeZone=null; game.zoneQuest=null;
  game.map = buildMap(s.districtId);

  applyEquipment();

  player.x=WORLD.w/2; player.y=WORLD.h/2; player.vx=0; player.vy=0;
  player.hp = clamp(100 + player.hpStart, 1, 160);
  player.shield = clamp(player.shieldStart, 0, 160);
  player.dashCd=0; player.dashTime=0;

  UI.updateHud({ hp: Math.round(player.hp), shield: Math.round(player.shield), wave: game.wave, zone:"—" });
  APPSTATE.toast("Район загружен. Ищи зоны и лут!");
}

function addCoins(n){
  const s = APPSTATE.get();
  s.coins = (s.coins||0) + n;
  game.coinsEarned += n;
  APPSTATE.save();
  UI.updateHud();
}

function inRect(x,y, r){
  return (x>=r.x && y>=r.y && x<=r.x+r.w && y<=r.y+r.h);
}

function chooseZone(){
  const zones = game.map.zones;
  const inside = zones.find(z=> inRect(player.x, player.y, z.rect));
  if(inside){
    if(game.activeZone !== inside.id){
      game.activeZone = inside.id;
      UI.updateHud({ zone: inside.name });
      spawnZoneQuest(inside);
    }
  } else if(game.activeZone){
    game.activeZone = null;
    UI.updateHud({ zone:"—" });
  }
}

function spawnZoneQuest(zone){
  // create a simple quest: clear N kills inside zone OR survive T seconds
  const types = ["clear","hold"];
  const type = types[Math.floor(Math.random()*types.length)];
  if(type==="clear"){
    const goal = 6 + Math.floor(game.wave*1.2);
    game.zoneQuest = { zoneId: zone.id, type, goal, progress:0, reward: 60 + game.wave*12 };
    APPSTATE.toast(`Зона: ${zone.name} • Квест: зачисти ${goal} врагов в зоне`);
  } else {
    const timer = 12 + Math.floor(game.wave*1.2);
    game.zoneQuest = { zoneId: zone.id, type, timer, t:timer, reward: 50 + game.wave*10 };
    APPSTATE.toast(`Зона: ${zone.name} • Квест: удерживай ${timer} сек`);
  }
  if(window.TG) TG.haptic("light");
}

function completeQuest(){
  if(!game.zoneQuest) return;
  addCoins(game.zoneQuest.reward);
  APPSTATE.toast(`Квест зоны выполнен! +${game.zoneQuest.reward} монет`);
  if(window.TG) TG.haptic("success");
  game.zoneQuest = null;
}

function spawnWave(){
  const count = 4 + Math.floor(game.wave * 1.8);

  for(let i=0;i<count;i++){
    const side=Math.floor(Math.random()*4);
    let x,y;
    if(side===0){ x=70; y=rand(70,WORLD.h-70); }
    if(side===1){ x=WORLD.w-70; y=rand(70,WORLD.h-70); }
    if(side===2){ x=rand(70,WORLD.w-70); y=70; }
    if(side===3){ x=rand(70,WORLD.w-70); y=WORLD.h-70; }

    // enemy type distribution
    const roll = Math.random();
    let kind="grunt";
    if(roll>0.84) kind="sniper";
    else if(roll>0.70) kind="tank";
    else if(roll>0.60) kind="kamikaze";

    const baseHp = 36 + game.wave*9;
    const baseSpd = 110 + game.wave*6;

    let hp=baseHp, spd=baseSpd, dmg=10+game.wave*1.2, shoot=false, shootRate=0, shootCd=0, range=0, explode=false;
    if(kind==="tank"){ hp*=2.4; spd*=0.62; dmg*=1.3; }
    if(kind==="sniper"){ hp*=1.1; spd*=0.85; shoot=true; shootRate=1.0; range=520; dmg=18+game.wave*1.0; }
    if(kind==="kamikaze"){ hp*=0.75; spd*=1.35; explode=true; dmg=28+game.wave*1.6; }

    enemies.push({
      kind, x,y, vx:0,vy:0, r:18,
      hp, spd, dmg,
      hitT:0,
      shoot, shootRate, shootCd, range,
      explode
    });
  }

  UI.updateHud({ wave: game.wave });
  APPSTATE.toast(`Волна ${game.wave}: врагов ${count}`);
}

function rectCircleCollides(o,cx,cy,r){
  const x=clamp(cx,o.x,o.x+o.w);
  const y=clamp(cy,o.y,o.y+o.h);
  return dist2(cx,cy,x,y)<=r*r;
}
function pushOut(ent,o){
  const px=clamp(ent.x,o.x,o.x+o.w);
  const py=clamp(ent.y,o.y,o.y+o.h);
  const dx=ent.x-px, dy=ent.y-py;
  const d=Math.sqrt(dx*dx+dy*dy)||1;
  const overlap=ent.r-d;
  if(overlap>0){ ent.x+=(dx/d)*overlap; ent.y+=(dy/d)*overlap; }
}
function collide(ent){
  for(const o of game.map.obstacles){
    if(rectCircleCollides(o,ent.x,ent.y,ent.r)) pushOut(ent,o);
  }
}

// --- Controls ---
const keys={};
addEventListener("keydown",(e)=>{ keys[e.key.toLowerCase()]=true; if(e.key===" ") e.preventDefault(); });
addEventListener("keyup",(e)=>{ keys[e.key.toLowerCase()]=false; });

let mouse={x:canvas.width/2,y:canvas.height/2,down:false};
canvas.addEventListener("pointermove",(e)=>{
  const r=canvas.getBoundingClientRect();
  mouse.x=(e.clientX-r.left)*(canvas.width/r.width);
  mouse.y=(e.clientY-r.top)*(canvas.height/r.height);
});
canvas.addEventListener("pointerdown",()=> mouse.down=true);
addEventListener("pointerup",()=> mouse.down=false);

// touch joystick
const joy = document.getElementById("joy");
const joyStick = document.getElementById("joyStick");
const btnShoot = document.getElementById("btnShoot");
const btnDash  = document.getElementById("btnDash");
let joyState={active:false,id:null,dx:0,dy:0};
if(isTouch){
  const center=()=>{ const r=joy.getBoundingClientRect(); return {cx:r.left+r.width/2, cy:r.top+r.height/2, rad:r.width*0.38}; };
  joy.addEventListener("pointerdown",(e)=>{
    joyState.active=true; joyState.id=e.pointerId; joy.setPointerCapture(e.pointerId);
    const c=center(); const dx=e.clientX-c.cx, dy=e.clientY-c.cy;
    const len=Math.hypot(dx,dy)||1; const m=Math.min(c.rad,len);
    joyState.dx=(dx/len)*(m/c.rad); joyState.dy=(dy/len)*(m/c.rad);
    joyStick.style.transform=`translate(${joyState.dx*42-50}%, ${joyState.dy*42-50}%)`;
  });
  joy.addEventListener("pointermove",(e)=>{
    if(!joyState.active||joyState.id!==e.pointerId) return;
    const c=center(); const dx=e.clientX-c.cx, dy=e.clientY-c.cy;
    const len=Math.hypot(dx,dy)||1; const m=Math.min(c.rad,len);
    joyState.dx=(dx/len)*(m/c.rad); joyState.dy=(dy/len)*(m/c.rad);
    joyStick.style.transform=`translate(${joyState.dx*42-50}%, ${joyState.dy*42-50}%)`;
  });
  const up=()=>{ joyState.active=false; joyState.id=null; joyState.dx=0; joyState.dy=0; joyStick.style.transform="translate(-50%,-50%)"; };
  joy.addEventListener("pointerup",up); joy.addEventListener("pointercancel",up);

  btnShoot.addEventListener("pointerdown",()=> mouse.down=true);
  btnShoot.addEventListener("pointerup",()=> mouse.down=false);
  btnShoot.addEventListener("pointercancel",()=> mouse.down=false);
  btnDash.addEventListener("click",()=> dash());
}

// --- Combat ---
let shootCd=0;
function dash(){
  if(player.dashCd>0 || player.dashTime>0) return;
  player.dashCd=1.1; player.dashTime=0.14;
  if(window.TG) TG.haptic("success");
}

function shoot(){
  if(shootCd>0) return;
  const w=weaponStats(player.weapon);
  shootCd=w.rate;

  // Aim: desktop -> from mouse (approximate direction), touch -> auto to nearest enemy
  let ax=player.aimX, ay=player.aimY;

  if(isTouch){
    let best=null, bestD=1e18;
    for(const e of enemies){
      const d=dist2(player.x,player.y,e.x,e.y);
      if(d<bestD){ bestD=d; best=e; }
    }
    if(best){
      const dx=best.x-player.x, dy=best.y-player.y;
      const l=Math.hypot(dx,dy)||1; ax=dx/l; ay=dy/l;
    }
  } else {
    // convert mouse to approximate world direction (not perfect iso inverse; good enough for aim)
    const cx = canvas.width/2, cy=canvas.height/2;
    const dx = mouse.x - cx, dy = mouse.y - cy;
    const l=Math.hypot(dx,dy)||1;
    ax=dx/l; ay=dy/l;
  }
  player.aimX=ax; player.aimY=ay;

  for(let p=0;p<w.pellets;p++){
    const ang=Math.atan2(ay,ax) + rand(-w.spread,w.spread);
    const vx=Math.cos(ang)*w.speed;
    const vy=Math.sin(ang)*w.speed;
    bullets.push({ x:player.x+ax*(player.r+6), y:player.y+ay*(player.r+6), vx,vy, r:4, dmg:w.dmg, life:1.0, from:"player" });
  }
  if(window.TG) TG.haptic("light");
}

function hurt(amount){
  let dmg=amount;
  if(player.shield>0){
    const absorb = Math.min(player.shield, dmg*0.75);
    player.shield -= absorb;
    dmg -= absorb;
  }
  player.hp -= dmg;
  UI.updateHud({ hp:Math.max(0,Math.round(player.hp)), shield:Math.max(0,Math.round(player.shield)) });
  if(player.hp<=0) gameOver(); else if(window.TG) TG.haptic("error");
}

function gameOver(){
  paused=true; running=false;
  const s=APPSTATE.get(); const d=s.districtId;
  s.bestWaveByDistrict[d] = Math.max(s.bestWaveByDistrict[d]||0, game.wave);
  APPSTATE.save();
  UI.setScreen("menu");
  APPSTATE.toast(`Ты пал. Рекорд района: волна ${s.bestWaveByDistrict[d]}.` , 2400);
}

// pickups
function spawnPickup(x,y, kind){
  pickups.push({ x,y, r:16, kind, t: 18 });
}
function dropLoot(e){
  const roll=Math.random();
  if(roll<0.55) spawnPickup(e.x,e.y,"coin");
  else if(roll<0.74) spawnPickup(e.x,e.y,"medkit");
  else spawnPickup(e.x,e.y,"shield");
}

// --- Update & AI ---
function update(dt){
  if(paused) return;

  // movement
  let ix=0, iy=0;
  if(keys["w"]||keys["arrowup"]) iy-=1;
  if(keys["s"]||keys["arrowdown"]) iy+=1;
  if(keys["a"]||keys["arrowleft"]) ix-=1;
  if(keys["d"]||keys["arrowright"]) ix+=1;
  if(isTouch){ ix=joyState.dx; iy=joyState.dy; }

  const il=Math.hypot(ix,iy)||1;
  if(il>0.001){ ix/=il; iy/=il; }

  const sp = player.speed*player.speedMul*(player.dashTime>0?2.25:1.0);
  player.vx=ix*sp; player.vy=iy*sp;
  player.x += player.vx*dt; player.y += player.vy*dt;
  collide(player);

  // portals
  for(const p of game.map.portals){
    if(dist2(player.x,player.y,p.x,p.y) < (p.r+player.r)*(p.r+player.r)){
      player.x=p.to.x; player.y=p.to.y;
      APPSTATE.toast("Портал: переход");
      if(window.TG) TG.haptic("success");
    }
  }

  // cooldowns
  shootCd=Math.max(0,shootCd-dt);
  player.dashCd=Math.max(0,player.dashCd-dt);
  player.dashTime=Math.max(0,player.dashTime-dt);
  if(keys["shift"]) dash();

  if(mouse.down) shoot();

  // bullets
  for(let i=bullets.length-1;i>=0;i--){
    const b=bullets[i];
    b.x+=b.vx*dt; b.y+=b.vy*dt; b.life-=dt;
    let hitWall=false;
    for(const o of game.map.obstacles){ if(rectCircleCollides(o,b.x,b.y,b.r)){ hitWall=true; break; } }
    if(hitWall || b.life<=0 || b.x<0||b.y<0||b.x>WORLD.w||b.y>WORLD.h){ bullets.splice(i,1); continue; }

    if(b.from==="player"){
      for(let j=enemies.length-1;j>=0;j--){
        const e=enemies[j];
        if(dist2(b.x,b.y,e.x,e.y) <= (b.r+e.r)*(b.r+e.r)){
          e.hp -= b.dmg;
          e.hitT = 0.08;
          bullets.splice(i,1);
          if(e.hp<=0){
            enemies.splice(j,1);
            addCoins(10 + Math.floor(game.wave*1.1));
            dropLoot(e);

            // quest progress if inside zone
            if(game.zoneQuest && game.activeZone===game.zoneQuest.zoneId && game.zoneQuest.type==="clear"){
              game.zoneQuest.progress += 1;
              if(game.zoneQuest.progress >= game.zoneQuest.goal) completeQuest();
            }

            // particles
            for(let k=0;k<14;k++) particles.push({x:e.x,y:e.y,vx:rand(-140,140),vy:rand(-140,140),t:0.45});
            if(window.TG) TG.haptic("success");
          }
          break;
        }
      }
    } else {
      // enemy bullet hits player
      if(dist2(b.x,b.y,player.x,player.y) <= (b.r+player.r)*(b.r+player.r)){
        hurt(b.dmg);
        bullets.splice(i,1);
      }
    }
  }

  // enemies AI
  for(let i=enemies.length-1;i>=0;i--){
    const e=enemies[i];
    const dx=player.x-e.x, dy=player.y-e.y;
    const l=Math.hypot(dx,dy)||1;
    const ux=dx/l, uy=dy/l;

    // move
    e.vx = ux*e.spd;
    e.vy = uy*e.spd;
    e.x += e.vx*dt;
    e.y += e.vy*dt;
    collide(e);

    // melee / explode
    const near = dist2(player.x,player.y,e.x,e.y) <= (player.r+e.r+10)*(player.r+e.r+10);
    if(near){
      if(e.explode){
        // kamikaze boom
        hurt(e.dmg);
        for(let k=0;k<20;k++) particles.push({x:e.x,y:e.y,vx:rand(-220,220),vy:rand(-220,220),t:0.55});
        enemies.splice(i,1);
        continue;
      } else {
        hurt(e.dmg*dt);
      }
    }

    // ranged sniper
    if(e.shoot){
      e.shootCd = Math.max(0, e.shootCd - dt);
      const inRange = dist2(player.x,player.y,e.x,e.y) <= e.range*e.range;
      if(inRange && e.shootCd<=0){
        e.shootCd = e.shootRate;
        // shoot at player
        const bx = ux*980, by=uy*980;
        bullets.push({ x:e.x+ux*(e.r+6), y:e.y+uy*(e.r+6), vx:bx, vy:by, r:4, dmg: 12 + game.wave*0.7, life: 1.2, from:"enemy" });
      }
    }

    e.hitT = Math.max(0,e.hitT-dt);
  }

  // pickups
  for(let i=pickups.length-1;i>=0;i--){
    const p=pickups[i];
    p.t -= dt;
    if(p.t<=0){ pickups.splice(i,1); continue; }
    if(dist2(player.x,player.y,p.x,p.y) <= (player.r+p.r)*(player.r+p.r)){
      if(p.kind==="coin"){ addCoins(18); APPSTATE.toast("+монеты"); }
      if(p.kind==="medkit"){ player.hp = clamp(player.hp+32, 1, 160); UI.updateHud({ hp:Math.round(player.hp) }); APPSTATE.toast("+HP"); }
      if(p.kind==="shield"){ player.shield = clamp(player.shield+28, 0, 160); UI.updateHud({ shield:Math.round(player.shield) }); APPSTATE.toast("+Shield"); }
      pickups.splice(i,1);
      if(window.TG) TG.haptic("light");
    }
  }

  // particles
  for(let i=particles.length-1;i>=0;i--){
    const p=particles[i]; p.x+=p.vx*dt; p.y+=p.vy*dt; p.vx*=0.90; p.vy*=0.90; p.t-=dt;
    if(p.t<=0) particles.splice(i,1);
  }

  // zone quest update
  chooseZone();
  if(game.zoneQuest && game.activeZone===game.zoneQuest.zoneId && game.zoneQuest.type==="hold"){
    game.zoneQuest.t -= dt;
    if(game.zoneQuest.t <= 0) completeQuest();
  }

  // wave cleared
  if(enemies.length===0){
    game.wave += 1;
    spawnWave();
    UI.updateHud({ wave: game.wave });
  }
}

// --- Drawing (isometric) ---
function drawDiamond(cx, cy, w, h, fill, stroke, alpha=1){
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(cx, cy - h/2);
  ctx.lineTo(cx + w/2, cy);
  ctx.lineTo(cx, cy + h/2);
  ctx.lineTo(cx - w/2, cy);
  ctx.closePath();
  if(fill){ ctx.fillStyle = fill; ctx.fill(); }
  if(stroke){ ctx.strokeStyle = stroke; ctx.lineWidth=1; ctx.stroke(); }
  ctx.globalAlpha = 1;
}

function drawBox(worldRect, cam, colTop, colSideA, colSideB){
  // draw an isometric extruded box for building
  const x0=worldRect.x, y0=worldRect.y, x1=worldRect.x+worldRect.w, y1=worldRect.y+worldRect.h;

  // corners in screen
  const p00 = worldToScreen(x0,y0,cam);
  const p10 = worldToScreen(x1,y0,cam);
  const p01 = worldToScreen(x0,y1,cam);
  const p11 = worldToScreen(x1,y1,cam);

  const h = ISO.height;

  // top face (raised)
  ctx.beginPath();
  ctx.moveTo(p00.x, p00.y-h);
  ctx.lineTo(p10.x, p10.y-h);
  ctx.lineTo(p11.x, p11.y-h);
  ctx.lineTo(p01.x, p01.y-h);
  ctx.closePath();
  ctx.fillStyle = colTop;
  ctx.fill();

  // left face
  ctx.beginPath();
  ctx.moveTo(p00.x, p00.y);
  ctx.lineTo(p00.x, p00.y-h);
  ctx.lineTo(p01.x, p01.y-h);
  ctx.lineTo(p01.x, p01.y);
  ctx.closePath();
  ctx.fillStyle = colSideA;
  ctx.fill();

  // right face
  ctx.beginPath();
  ctx.moveTo(p00.x, p00.y);
  ctx.lineTo(p00.x, p00.y-h);
  ctx.lineTo(p10.x, p10.y-h);
  ctx.lineTo(p10.x, p10.y);
  ctx.closePath();
  ctx.fillStyle = colSideB;
  ctx.fill();

  // outline
  ctx.strokeStyle = "rgba(234,240,255,0.10)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function draw(){
  const cam = camera();
  ctx.fillStyle = "#070b14";
  ctx.fillRect(0,0,canvas.width,canvas.height);

  const pal = game.map.palette;

  // draw ground tiles around camera
  const tileStep = 66; // world units step for tile sampling
  const radiusX = 22, radiusY = 16;
  for(let gy=-radiusY; gy<=radiusY; gy++){
    for(let gx=-radiusX; gx<=radiusX; gx++){
      const wx = player.x + gx*tileStep;
      const wy = player.y + gy*tileStep;
      if(wx<0||wy<0||wx>WORLD.w||wy>WORLD.h) continue;
      const s = worldToScreen(wx, wy, cam);
      const k = (Math.floor(wx/120)+Math.floor(wy/120)) & 3;
      drawDiamond(s.x, s.y, ISO.tileW, ISO.tileH, pal[k], "rgba(255,255,255,0.05)", 1);
    }
  }

  // zones overlay
  for(const z of game.map.zones){
    const cx = z.rect.x + z.rect.w/2;
    const cy = z.rect.y + z.rect.h/2;
    const s = worldToScreen(cx,cy,cam);
    ctx.fillStyle = (game.activeZone===z.id) ? "rgba(90,225,255,0.12)" : "rgba(255,255,255,0.06)";
    drawDiamond(s.x, s.y, ISO.tileW*2.8, ISO.tileH*2.8, ctx.fillStyle, "rgba(255,255,255,0.06)", 1);
    ctx.font = "bold 12px system-ui,-apple-system,Segoe UI,Roboto,Arial";
    ctx.fillStyle = "rgba(234,240,255,0.80)";
    ctx.fillText(z.name, s.x-28, s.y-ISO.tileH);
  }

  // portals
  for(const p of game.map.portals){
    const s = worldToScreen(p.x,p.y,cam);
    drawDiamond(s.x, s.y, ISO.tileW*0.9, ISO.tileH*0.9, "rgba(90,225,255,0.14)", "rgba(90,225,255,0.38)", 1);
  }

  // sort draw list by y (painter)
  const drawList = [];

  // buildings
  for(const o of game.map.obstacles){
    // skip borders for buildings
    if(o.w>=WORLD.w-10 || o.h>=WORLD.h-10) continue;
    drawList.push({ kind:"building", y:o.y+o.h, obj:o });
  }

  // pickups
  for(const p of pickups){
    drawList.push({ kind:"pickup", y:p.y, obj:p });
  }

  // enemies
  for(const e of enemies){
    drawList.push({ kind:"enemy", y:e.y, obj:e });
  }

  // player
  drawList.push({ kind:"player", y:player.y, obj:player });

  // bullets (above)
  for(const b of bullets){
    drawList.push({ kind:"bullet", y:b.y, obj:b });
  }

  drawList.sort((a,b)=>a.y-b.y);

  for(const it of drawList){
    if(it.kind==="building"){
      const o=it.obj;
      drawBox(o, cam, "rgba(255,255,255,0.10)", "rgba(0,0,0,0.26)", "rgba(0,0,0,0.18)");
    }
    if(it.kind==="pickup"){
      const p=it.obj;
      const s=worldToScreen(p.x,p.y,cam);
      const col = p.kind==="coin" ? "rgba(255,211,107,0.85)" : (p.kind==="medkit" ? "rgba(255,90,107,0.78)" : "rgba(177,199,255,0.78)");
      drawDiamond(s.x, s.y-18, ISO.tileW*0.55, ISO.tileH*0.55, col, "rgba(255,255,255,0.10)", 1);
    }
    if(it.kind==="enemy"){
      const e=it.obj;
      const s=worldToScreen(e.x,e.y,cam);
      const size=44;
      ctx.globalAlpha = e.hitT>0 ? 0.65 : 1.0;
      ctx.drawImage(IMG.enemy, s.x-size/2, s.y-size-22, size, size);
      ctx.globalAlpha = 1.0;

      // type marker
      ctx.font="bold 10px system-ui,-apple-system,Segoe UI,Roboto,Arial";
      ctx.fillStyle="rgba(234,240,255,0.75)";
      const tag = e.kind==="tank"?"TANK":(e.kind==="sniper"?"SNIPER":(e.kind==="kamikaze"?"BOOM":""));
      if(tag) ctx.fillText(tag, s.x-18, s.y-size-28);

      // hp bar
      const maxHp = (e.kind==="tank")? (36+game.wave*9)*2.4 : (e.kind==="sniper")?(36+game.wave*9)*1.1 : (e.kind==="kamikaze")?(36+game.wave*9)*0.75 : (36+game.wave*9);
      const hp = clamp(e.hp/maxHp,0,1);
      ctx.fillStyle="rgba(0,0,0,0.35)";
      ctx.fillRect(s.x-22, s.y-size-12, 44, 6);
      ctx.fillStyle="rgba(255,90,107,0.90)";
      ctx.fillRect(s.x-22, s.y-size-12, 44*hp, 6);
    }
    if(it.kind==="player"){
      const s=worldToScreen(player.x,player.y,cam);
      const size=48;
      // shadow
      drawDiamond(s.x, s.y-6, ISO.tileW*0.62, ISO.tileH*0.62, "rgba(0,0,0,0.22)", null, 1);
      ctx.drawImage(IMG.player, s.x-size/2, s.y-size-26, size, size);

      // skin tint
      if(player.skin==="skin_camo"){
        drawDiamond(s.x, s.y-32, ISO.tileW*0.55, ISO.tileH*0.55, "rgba(124,255,154,0.12)", null, 1);
      }
      if(player.skin==="skin_neon"){
        drawDiamond(s.x, s.y-32, ISO.tileW*0.55, ISO.tileH*0.55, "rgba(195,107,255,0.12)", null, 1);
      }
    }
    if(it.kind==="bullet"){
      const b=it.obj;
      const s=worldToScreen(b.x,b.y,cam);
      ctx.beginPath();
      ctx.arc(s.x, s.y-18, b.r, 0, Math.PI*2);
      ctx.fillStyle = b.from==="player" ? "rgba(90,225,255,0.95)" : "rgba(255,211,107,0.9)";
      ctx.fill();
    }
  }

  // particles
  for(const p of particles){
    const s=worldToScreen(p.x,p.y,cam);
    ctx.fillStyle="rgba(255,255,255,0.30)";
    ctx.fillRect(s.x, s.y-20, 2, 2);
  }

  // quest HUD (top-left overlay)
  ctx.fillStyle="rgba(0,0,0,0.25)";
  ctx.fillRect(12,12,320,64);
  ctx.strokeStyle="rgba(255,255,255,0.14)";
  ctx.strokeRect(12,12,320,64);
  ctx.font="bold 14px system-ui,-apple-system,Segoe UI,Roboto,Arial";
  ctx.fillStyle="rgba(234,240,255,0.88)";
  ctx.fillText(`⚔️ Волна ${game.wave}  🪙 +${game.coinsEarned}`, 22, 36);
  ctx.font="12px system-ui,-apple-system,Segoe UI,Roboto,Arial";
  ctx.fillStyle="rgba(234,240,255,0.68)";
  if(game.zoneQuest && game.activeZone===game.zoneQuest.zoneId){
    if(game.zoneQuest.type==="clear"){
      ctx.fillText(`Зона-квест: ${game.zoneQuest.progress}/${game.zoneQuest.goal}  (+${game.zoneQuest.reward})`, 22, 56);
    } else {
      ctx.fillText(`Зона-квест: удержи ${Math.ceil(game.zoneQuest.t)} сек  (+${game.zoneQuest.reward})`, 22, 56);
    }
  } else {
    ctx.fillText("Зайди в зону — получишь мини‑квест и бонус.", 22, 56);
  }
}

function loop(ts){
  if(!running) return;
  const dt = Math.min(0.033, (ts-lastTs)/1000 || 0);
  lastTs=ts;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

function startGame(){
  paused=false; running=true; lastTs=performance.now();
  resetRun(); spawnWave();
  requestAnimationFrame(loop);
}
function pauseGame(){ paused=true; }
function resumeGame(){ paused=false; lastTs=performance.now(); }
function stopGame(){ running=false; paused=false; }

window.addEventListener("bks_equipment_changed", ()=>{
  if(running){ applyEquipment(); APPSTATE.toast("Экипировка обновлена."); }
});

window.addEventListener("bks_start_game", async ()=>{
  if(!IMG.player) await loadAssets();
  startGame();
});
window.addEventListener("bks_pause_game", ()=> pauseGame());
window.addEventListener("bks_resume_game", ()=> resumeGame());
window.addEventListener("bks_stop_game", ()=> stopGame());
