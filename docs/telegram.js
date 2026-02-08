(function(){
  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  function isTelegram(){ return !!tg; }
  function getUser(){ return tg && tg.initDataUnsafe && tg.initDataUnsafe.user ? tg.initDataUnsafe.user : null; }
  function ready(){ try{ if(tg){ tg.ready(); tg.expand(); } }catch(e){} }
  function applyTheme(){
    try{
      if(!tg || !tg.themeParams) return false;
      const p = tg.themeParams;
      if (p.bg_color) document.documentElement.style.setProperty("--bg", p.bg_color);
      if (p.text_color) document.documentElement.style.setProperty("--text", p.text_color);
      if (p.hint_color) document.documentElement.style.setProperty("--muted", p.hint_color);
      if (p.button_color) document.documentElement.style.setProperty("--primary", p.button_color);
      return true;
    }catch(e){ return false; }
  }
  function haptic(type){
    try{
      if(!tg || !tg.HapticFeedback) return;
      if(type==="success") tg.HapticFeedback.notificationOccurred("success");
      else if(type==="error") tg.HapticFeedback.notificationOccurred("error");
      else tg.HapticFeedback.impactOccurred(type||"light");
    }catch(e){}
  }
  function cloudGet(keys){
    return new Promise((resolve)=>{
      if(!tg || !tg.CloudStorage) return resolve(null);
      tg.CloudStorage.getItems(keys, (err, values)=> resolve(err?null:(values||null)));
    });
  }
  function cloudSet(obj){
    return new Promise((resolve)=>{
      if(!tg || !tg.CloudStorage) return resolve(false);
      const entries = Object.entries(obj||{});
      if(!entries.length) return resolve(true);
      let pending = entries.length, ok = true;
      entries.forEach(([k,v])=>{
        tg.CloudStorage.setItem(k, String(v), (err)=>{
          if(err) ok = false;
          pending -= 1;
          if(pending===0) resolve(ok);
        });
      });
    });
  }
  window.TG = { isTelegram, getUser, ready, applyTheme, haptic, cloudGet, cloudSet, _raw: tg };
})();