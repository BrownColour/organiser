/* ============ API layer ============
   Talks to a Google Apps Script Web App deployed from Code.gs. One
   deployment serves both people using this organiser — each person's data
   lives in their own set of sheet tabs (S_Trimesters, K_Trimesters, etc.),
   and every request says which one it's for via a `user` field ('S' or
   'K'), added automatically below.

   IDs for new records are generated here, client-side, with
   crypto.randomUUID() — Code.gs accepts a client-supplied id instead of
   always generating its own. That's what lets ui.js apply a create to the
   UI immediately (optimistically) without waiting on a round trip to find
   out what id the new row got: it already knows.
*/
const API = (() => {
  const LS_URL_KEY = 'mba_api_url';
  const LS_USER_KEY = 'mba_user';
  // Baked-in default so this works out of the box; Settings can still
  // override it (e.g. if you redeploy and get a new /exec URL).
  const DEFAULT_URL = 'https://script.google.com/macros/s/AKfycbyL1W1tzfsofyNwksXwTJYfa0qs3XFaFVFtVRIjD7T5gICfUT9uzLRct44Kze1AB8ar/exec';
  const USERS = ['S', 'K'];

  function getUrl(){
    return localStorage.getItem(LS_URL_KEY) || DEFAULT_URL;
  }
  function setUrl(url){
    localStorage.setItem(LS_URL_KEY, url.trim());
  }

  function getActiveUser(){
    const u = localStorage.getItem(LS_USER_KEY);
    return USERS.includes(u) ? u : null;
  }
  function setActiveUser(u){
    if(!USERS.includes(u)) throw new Error('User must be S or K');
    localStorage.setItem(LS_USER_KEY, u);
  }
  function otherUser(){
    const u = getActiveUser();
    return u==='S' ? 'K' : u==='K' ? 'S' : null;
  }

  function cacheKey(user){ return `mba_cache_v1_${user}`; }
  function loadCache(user){
    try{
      return JSON.parse(localStorage.getItem(cacheKey(user||getActiveUser()))) || null;
    }catch(e){ return null; }
  }
  function saveCache(data, user){
    localStorage.setItem(cacheKey(user||getActiveUser()), JSON.stringify(data));
  }

  function newId(prefix){
    return prefix + '_' + crypto.randomUUID();
  }

  async function call(action, payload, userOverride){
    const url = getUrl();
    if(!url){
      throw new Error('No Apps Script URL configured. Add it in Settings.');
    }
    const user = userOverride || getActiveUser();
    if(!user){
      throw new Error('No profile selected. Choose S or K in Settings.');
    }
    let res;
    try{
      res = await fetch(url, {
        method:'POST',
        headers:{'Content-Type':'text/plain;charset=utf-8'}, // avoids CORS preflight on Apps Script
        body: JSON.stringify({ action, payload: { ...(payload||{}), user } })
      });
    }catch(networkErr){
      throw new Error('Could not reach the Apps Script server. Check the URL in Settings and your connection.');
    }
    let json;
    try{ json = await res.json(); }
    catch(e){ throw new Error(`Unexpected response from server (HTTP ${res.status})`); }
    if(!json.ok) throw new Error(json.error || 'Request failed');
    return json.data;
  }

  async function getAll(){
    const data = await call('getAll');
    saveCache(data);
    return data;
  }

  // Read-only fetch of the OTHER person's data, for the Today tab's
  // cross-visibility panels. Never cached under the active user's key.
  async function getAllFor(user){
    return call('getAll', {}, user);
  }

  return {
    getUrl, setUrl, loadCache, saveCache, call, getAll, getAllFor,
    getActiveUser, setActiveUser, otherUser, USERS, newId,
    addTrimester: (p)=>call('addTrimester', p),
    addCourse: (p)=>call('addCourse', p),
    updateCourse: (p)=>call('updateCourse', p),
    deleteCourse: (p)=>call('deleteCourse', p),
    addEvent: (p)=>call('addEvent', p),
    addEventsBulk: (p)=>call('addEventsBulk', p),
    updateEvent: (p)=>call('updateEvent', p),
    deleteEvent: (p)=>call('deleteEvent', p),
    setAttendance: (p)=>call('setAttendance', p),
  };
})();
