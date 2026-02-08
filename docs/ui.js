const DISTRICTS = [
  { id:"mkr5",  name:"5-й мкр", icon:"./assets/mkr5.svg", palette:["#0e1a33","#16254a","#1f3563","#2a4580"] },
  { id:"mkr5a", name:"5а мкр",  icon:"./assets/mkr5a.svg", palette:["#111b2c","#1b2b43","#263b5c","#2f4a7a"] },
  { id:"mkr6",  name:"6-й мкр", icon:"./assets/mkr6.svg", palette:["#13172f","#1a2350","#223069","#2d4090"] },
  { id:"mkr6a", name:"6а мкр",  icon:"./assets/mkr6a.svg", palette:["#0f1f2c","#17314a","#1f4365","#2a5a86"] },
  { id:"mkr7",  name:"7-й мкр", icon:"./assets/mkr7.svg", palette:["#14162a","#201d3b","#2d2552","#3c2f6f"] },
  { id:"mkr7a", name:"7а мкр",  icon:"./assets/mkr7a.svg", palette:["#171628","#241a3d","#34205a","#452a7a"] },
  { id:"pad9",  name:"9-я площадка", icon:"./assets/pad9.svg", palette:["#0e1c2a","#15344a","#1d4d6a","#2b6b92"] },
  { id:"prom",  name:"Промрайон", icon:"./assets/prom.svg", palette:["#151a22","#232a36","#313a4a","#465368"] },
];

const STORE = {
  weapons: [
    { id:"blaster",  name:"Бластер",  icon:"./assets/blaster.svg", price:0,   desc:"Стартовое. Стабильный урон.", type:"weapon" },
    { id:"rifle",    name:"Винтовка", icon:"./assets/rifle.svg",   price:260, desc:"Дальше и точнее, средний темп.", type:"weapon" },
    { id:"smg",      name:"SMG",      icon:"./assets/smg.svg",     price:320, desc:"Очень быстрый, для толпы.", type:"weapon" },
    { id:"shotgun",  name:"Дробовик", icon:"./assets/shotgun.svg", price:520, desc:"Разлёт дроби. Близко — мощь.", type:"weapon" },
    { id:"sniper",   name:"Снайперка",icon:"./assets/sniper.svg",  price:680, desc:"Редко стреляет, но больно.", type:"weapon" },
  ],
  gear: [
    { id:"boots",  name:"Ботинки", icon:"./assets/boots.svg",  price:180, desc:"+10% скорость.", type:"gear" },
    { id:"armor",  name:"Броня",   icon:"./assets/armor.svg",  price:240, desc:"+40 Shield на старте.", type:"gear" },
  ],
  skins: [
    { id:"skin_camo", name:"Скин: Камо", icon:"./assets/skin_camo.svg", price:160, desc:"Камуфляжный стиль.", type:"skin" },
    { id:"skin_neon", name:"Скин: Неон", icon:"./assets/skin_neon.svg", price:160, desc:"Неоновый стиль.", type:"skin" },
  ],
  boosts: [
    { id:"medkit", name:"Аптечка", icon:"./assets/medkit.svg", price:90, desc:"+35 HP на старте.", type:"boost" },
    { id:"shield", name:"Щит",     icon:"./assets/shield.svg", price:120, desc:"+30 Shield на старте.", type:"boost" },
  ]
};

const STORAGE_KEY = "bks_iso_state_v1";

function $(id){ return document.getElementById(id); }
function hasTG(){ return typeof window.TG !== "undefined" && window.TG; }

function toast(msg, ms=1800){
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(()=> el.hidden = true, ms);
}

function defaultState(){
  return {
    version: 1,
    districtId: null,
    coins: 0,
    owned: { blaster:true },
    equipped: { weapon:"blaster", skin:null, gear:[], boosts:[] },
    bestWaveByDistrict: {},
    user: null,
  };
}
let state = defaultState();

window.APPSTATE = { get:()=>state, set:(s)=>{state=s;}, districts:DISTRICTS, store:STORE, save, toast };

function load(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw) state = { ...defaultState(), ...JSON.parse(raw) };
  }catch(e){ state = defaultState(); }
}

async function cloudPull(){
  if(!hasTG() || !TG.isTelegram()) return;
  const values = await TG.cloudGet(["bks_iso_state"]);
  if(values && values.bks_iso_state){
    try{
      const cloud = JSON.parse(values.bks_iso_state);
      // выбираем более "богатое" состояние
      const scoreCloud = (cloud.coins||0) + Object.keys(cloud.owned||{}).length*50;
      const scoreLocal = (state.coins||0) + Object.keys(state.owned||{}).length*50;
      if(scoreCloud > scoreLocal) state = { ...defaultState(), ...cloud };
    }catch(e){}
  }
}
async function cloudPush(){
  if(!hasTG() || !TG.isTelegram()) return;
  try{ await TG.cloudSet({ "bks_iso_state": JSON.stringify(state) }); }catch(e){}
}

function save(sync=true){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if(sync) cloudPush();
}

function setScreen(id){
  $("screenStart").hidden = (id !== "start");
  $("screenMenu").hidden  = (id !== "menu");
  $("screenHow").hidden   = (id !== "how");
}

function renderDistricts(){
  const grid = $("districtGrid");
  grid.innerHTML = "";
  let selected = state.districtId;

  DISTRICTS.forEach(d=>{
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "district";
    btn.setAttribute("aria-pressed", String(selected === d.id));
    const best = state.bestWaveByDistrict[d.id] || 0;
    btn.innerHTML = `
      <img src="${d.icon}" alt="${d.name}">
      <div>
        <div class="district__name">${d.name}</div>
        <div class="district__meta">Рекорд: волна ${best}</div>
      </div>
    `;
    btn.addEventListener("click", ()=>{
      selected = d.id;
      state.districtId = d.id;
      save();
      [...grid.children].forEach(c=>c.setAttribute("aria-pressed","false"));
      btn.setAttribute("aria-pressed","true");
      $("btnPlay").disabled = false;
      if(hasTG()) TG.haptic("light");
    });
    grid.appendChild(btn);
  });

  $("btnPlay").disabled = !state.districtId;
}

function updateHud(extra={}){
  $("hudCoins").textContent = String(state.coins||0);
  const weapon = state.equipped.weapon || "blaster";
  $("hudWeapon").textContent = weapon;
  if(typeof extra.hp !== "undefined") $("hudHp").textContent = String(extra.hp);
  if(typeof extra.shield !== "undefined") $("hudShield").textContent = String(extra.shield);
  if(typeof extra.wave !== "undefined") $("hudWave").textContent = String(extra.wave);
  if(typeof extra.zone !== "undefined") $("hudZone").textContent = String(extra.zone);
}

function openShop(tab="weapons"){
  $("shopModal").hidden = false;
  renderShop(tab);
}
function closeShop(){ $("shopModal").hidden = true; }

function renderShop(tab){
  document.querySelectorAll(".tab").forEach(b=>{
    const on = b.getAttribute("data-tab") === tab;
    b.setAttribute("aria-pressed", on ? "true":"false");
  });
  $("shopCoins").textContent = String(state.coins||0);
  const list = $("shopList");
  list.innerHTML = "";

  (STORE[tab] || []).forEach(it=>{
    const owned = !!state.owned[it.id];
    const equipped =
      (it.type==="weapon" && state.equipped.weapon===it.id) ||
      (it.type==="skin" && state.equipped.skin===it.id) ||
      (it.type==="gear" && state.equipped.gear.includes(it.id)) ||
      (it.type==="boost" && state.equipped.boosts.includes(it.id));

    const row = document.createElement("div");
    row.className = "shopItem";
    row.innerHTML = `
      <img src="${it.icon}" alt="${it.name}">
      <div class="shopItem__body">
        <div class="shopItem__title">${it.name}</div>
        <div class="shopItem__desc">${it.desc}</div>
      </div>
      <div class="shopItem__meta">
        <div class="price">🪙 ${it.price}</div>
        <div class="badge">${owned ? (equipped ? "Экипировано" : "Куплено") : "Не куплено"}</div>
        <button class="buyBtn">${owned ? (equipped ? "ОК" : "Надеть") : (it.price===0 ? "Взять" : "Купить")}</button>
      </div>
    `;

    row.querySelector(".buyBtn").addEventListener("click", ()=>{
      if(!state.owned[it.id]){
        if((state.coins||0) < it.price){
          toast("Не хватает монет.");
          if(hasTG()) TG.haptic("error");
          return;
        }
        state.coins -= it.price;
        state.owned[it.id] = true;
        if(hasTG()) TG.haptic("success");
      } else {
        if(hasTG()) TG.haptic("light");
      }

      if(it.type==="weapon") state.equipped.weapon = it.id;
      if(it.type==="skin") state.equipped.skin = it.id;
      if(it.type==="gear"){
        const idx = state.equipped.gear.indexOf(it.id);
        if(idx>=0) state.equipped.gear.splice(idx,1); else state.equipped.gear.push(it.id);
      }
      if(it.type==="boost"){
        const idx = state.equipped.boosts.indexOf(it.id);
        if(idx>=0) state.equipped.boosts.splice(idx,1); else state.equipped.boosts.push(it.id);
      }

      save();
      updateHud();
      renderShop(tab);
      window.dispatchEvent(new CustomEvent("bks_equipment_changed"));
    });

    list.appendChild(row);
  });
}

function resetAll(){
  if(!confirm("Сбросить прогресс?")) return;
  state = defaultState();
  save();
  setScreen("start");
  renderDistricts();
  updateHud();
  toast("Сброшено.");
}

function telegramInfo(){
  if(hasTG()){
    TG.ready();
    TG.applyTheme();
    const u = TG.getUser();
    if(u){
      state.user = { id:u.id, first_name:u.first_name, last_name:u.last_name, username:u.username };
      save(false);
      $("tgInfo").textContent = `Открыто в Telegram как ${u.first_name || "user"}${u.username ? " (@"+u.username+")":""}.`;
    } else $("tgInfo").textContent = "Открыто в Telegram.";
  } else {
    $("tgInfo").textContent = "Открыто в браузере (не Telegram).";
  }
}

async function initUI(){
  load();
  telegramInfo();
  await cloudPull();
  save(false);

  renderDistricts();
  updateHud();

  $("btnPlay").addEventListener("click", ()=>{
    setScreen("none");
    $("hud").hidden = false;
    window.dispatchEvent(new CustomEvent("bks_start_game"));
  });

  $("btnHow").addEventListener("click", ()=> setScreen("how"));
  $("btnHowBack").addEventListener("click", ()=> setScreen("start"));

  $("btnMenu").addEventListener("click", ()=>{
    setScreen("menu");
    window.dispatchEvent(new CustomEvent("bks_pause_game"));
  });
  $("btnCloseMenu").addEventListener("click", ()=>{
    setScreen("none");
    window.dispatchEvent(new CustomEvent("bks_resume_game"));
  });
  $("btnResume").addEventListener("click", ()=>{
    setScreen("none");
    window.dispatchEvent(new CustomEvent("bks_resume_game"));
  });

  $("btnChangeDistrict").addEventListener("click", ()=>{
    setScreen("start");
    $("hud").hidden = true;
    window.dispatchEvent(new CustomEvent("bks_stop_game"));
    renderDistricts();
  });

  $("btnReset").addEventListener("click", ()=>{
    window.dispatchEvent(new CustomEvent("bks_stop_game"));
    $("hud").hidden = true;
    resetAll();
  });

  $("btnShop").addEventListener("click", ()=> openShop("weapons"));
  $("btnShop2").addEventListener("click", ()=> openShop("weapons"));
  $("shopClose").addEventListener("click", closeShop);
  $("btnCloseShop").addEventListener("click", closeShop);

  document.querySelectorAll(".tab").forEach(b=>{
    b.addEventListener("click", ()=> renderShop(b.getAttribute("data-tab")));
  });

  const isTouch = matchMedia("(pointer: coarse)").matches;
  document.getElementById("touch").hidden = !isTouch;
}
initUI();

window.UI = { openShop, closeShop, toast, updateHud, setScreen };
