/* ============ View routing ============ */
function switchView(view){
  STATE.view = view;
  document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active', el.dataset.view===view));
  document.querySelectorAll('.bn-item').forEach(el=>el.classList.toggle('active', el.dataset.view===view));
  renderApp();
}
function renderCurrentView(){ renderApp(); }

function renderApp(){
  rebuildSessionNumbering();
  const host = document.getElementById('viewHost');
  const title = document.getElementById('viewTitle');
  const subtitle = document.getElementById('viewSubtitle');
  const controls = document.getElementById('topbarControls');

  const titles = { dashboard:'Today', calendar:'Calendar', courses:'Courses', attendance:'Attendance', settings:'Settings' };
  title.textContent = titles[STATE.view] || '';

  if(STATE.view==='dashboard'){
    subtitle.textContent = fmtDateLong(new Date());
    controls.innerHTML = `<button class="btn btn-accent" onclick="openEventModal(null, new Date())">+ Add event</button>`;
    renderDashboard(host);
  }
  else if(STATE.view==='calendar'){
    subtitle.textContent = calendarSubtitleLabel();
    controls.innerHTML = `
      <div class="icon-nav">
        <button class="btn btn-icon btn-ghost" onclick="calPrev()">‹</button>
        <button class="btn btn-sm" onclick="calToday()">Today</button>
        <button class="btn btn-icon btn-ghost" onclick="calNext()">›</button>
      </div>
      <div class="segmented">
        ${['day','week','month','trimester'].map(m=>`<button class="${STATE.calMode===m?'active':''}" onclick="setCalMode('${m}')">${m[0].toUpperCase()+m.slice(1)}</button>`).join('')}
      </div>
      <button class="btn btn-accent" onclick="openEventModal(null, STATE.calDate)">+ Add</button>
    `;
    renderCalendarView(host);
  }
  else if(STATE.view==='courses'){
    subtitle.textContent = `${STATE.courses.length} course${STATE.courses.length===1?'':'s'}`;
    controls.innerHTML = '';
    renderCoursesView(host);
  }
  else if(STATE.view==='attendance'){
    subtitle.textContent = 'Session-by-session record';
    controls.innerHTML = '';
    renderAttendanceView(host);
  }
  else if(STATE.view==='settings'){
    subtitle.textContent = 'Connection, trimesters & appearance';
    controls.innerHTML = '';
    renderSettingsView(host);
  }
}

/* ============ Init ============ */
async function init(){
  initTheme();

  // wire nav
  document.querySelectorAll('.nav-item, .bn-item').forEach(el=>{
    el.addEventListener('click', ()=>switchView(el.dataset.view));
  });
  document.getElementById('themeToggle').addEventListener('click', toggleTheme);

  if(!API.getActiveUser()){
    switchView('settings');
    toast("Choose S or K in Settings to get started");
    return;
  }
  // Belt-and-braces: index.html's inline head script already applies this
  // before first paint, this just keeps things consistent if that ever
  // diverges (e.g. a future code path sets the profile without a reload).
  document.documentElement.setAttribute('data-profile', API.getActiveUser());
  await bootstrapData();
}

// Loads (or reloads) everything for the currently active profile: cache
// first for an instant paint, then a live fetch, then the other person's
// data for the Today tab's cross-visibility panels. Called on startup, on
// manual re-sync, and whenever the active profile is switched.
async function bootstrapData(){
  if(!API.getActiveUser()){
    switchView('settings');
    return;
  }

  const cached = API.loadCache();
  if(cached){
    STATE.trimesters = cached.trimesters||[];
    STATE.courses = cached.courses||[];
    STATE.events = cached.events||[];
    STATE.attendance = cached.attendance||[];
    if(STATE.trimesters.length) STATE.activeTrimesterId = STATE.trimesters[STATE.trimesters.length-1].id;
  }
  renderApp();

  try{
    const data = await API.getAll();
    STATE.trimesters = data.trimesters||[]; STATE.courses = data.courses||[];
    STATE.events = data.events||[]; STATE.attendance = data.attendance||[];
    if(STATE.trimesters.length && !STATE.activeTrimesterId) STATE.activeTrimesterId = STATE.trimesters[STATE.trimesters.length-1].id;
    document.getElementById('syncStatus').textContent = 'Synced';
    renderApp();
  }catch(err){
    document.getElementById('syncStatus').textContent = 'Offline (cached)';
    toast('Could not reach your Google Sheet — showing cached data. Check Settings.', true);
  }

  loadOtherUserData();
}

// Read-only fetch of the other profile's data. Fails silently (no
// trimester set up yet, or a network hiccup) — the Today tab just omits
// their sections rather than surfacing an error for data that isn't ours.
async function loadOtherUserData(){
  const other = API.otherUser();
  if(!other){ STATE.other = null; return; }
  try{
    const data = await API.getAllFor(other);
    STATE.other = { name: other, events: data.events||[], courses: data.courses||[] };
  }catch(err){
    STATE.other = null;
  }
  renderApp();
}

document.addEventListener('DOMContentLoaded', init);
