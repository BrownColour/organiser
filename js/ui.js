/* ============ Toasts ============ */
function toast(msg, isError){
  const el = document.createElement('div');
  el.className = 'toast';
  if(isError) el.style.color = 'var(--danger)';
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(()=>el.remove(), 3200);
}

/* ============ Theme ============ */
function initTheme(){
  const saved = localStorage.getItem('mba_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  document.getElementById('themeIcon').textContent = saved==='dark' ? '☾' : '☀';
}
function toggleTheme(){
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur==='dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('mba_theme', next);
  document.getElementById('themeIcon').textContent = next==='dark' ? '☾' : '☀';
}

/* ============ Save helper ============
   This is what makes saving feel instant regardless of network speed:
   `apply()` mutates STATE and closes the modal *before* the network call
   even starts, so the calendar/list updates on the same frame you hit
   Save. The request then runs in the background; on success `reconcile()`
   swaps in the server's authoritative copy (harmless if it's identical),
   and on failure `revert()` undoes the optimistic change and an error
   toast explains why. Every create's id is generated client-side
   (crypto.randomUUID(), see js/api.js) specifically so this can apply
   before the server has even seen the request.
*/
async function optimistic({ apply, revert, request, reconcile, successMsg }){
  const statusEl = document.getElementById('syncStatus');
  apply();
  closeModal();
  renderCurrentView();
  statusEl.textContent = 'Saving…';
  try{
    const result = await request;
    if(reconcile) reconcile(result);
    API.saveCache({ trimesters:STATE.trimesters, courses:STATE.courses, events:STATE.events, attendance:STATE.attendance });
    statusEl.textContent = 'Synced';
    if(successMsg) toast(successMsg);
    renderCurrentView();
  }catch(err){
    revert();
    statusEl.textContent = 'Sync error';
    toast('Error: '+err.message, true);
    renderCurrentView();
  }
}

/* ============ Modal shell ============ */
function openModal(html){
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="modal-backdrop" onclick="closeModal()"></div><div class="modal-sheet">${html}</div>`;
  root.classList.add('open');
  root.setAttribute('aria-hidden','false');
}
function closeModal(){
  const root = document.getElementById('modalRoot');
  root.classList.remove('open');
  root.setAttribute('aria-hidden','true');
  root.innerHTML = '';
}

/* ============ Trimester modal ============ */
function openTrimesterModal(){
  openModal(`
    <div class="modal-head"><h2>New trimester</h2><button class="btn btn-icon btn-ghost" onclick="closeModal()">✕</button></div>
    <div class="form-field"><label>Trimester name</label><input id="triName" placeholder="e.g. Trimester 5"></div>
    <div class="form-field"><label>Start date</label><input id="triStart" type="date"></div>
    <div class="form-field"><label>End date (optional)</label><input id="triEnd" type="date"></div>
    <div class="modal-foot">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-accent" onclick="submitTrimester()">Create</button>
    </div>
  `);
}
function submitTrimester(){
  const name = document.getElementById('triName').value.trim();
  const startDate = document.getElementById('triStart').value;
  const endDate = document.getElementById('triEnd').value;
  if(!name || !startDate){ toast('Name and start date are required', true); return; }
  const id = API.newId('tri');
  const obj = { id, name, startDate, endDate, createdAt: new Date().toISOString() };
  const prevActive = STATE.activeTrimesterId;
  optimistic({
    apply: ()=>{ STATE.trimesters.push(obj); STATE.activeTrimesterId = id; },
    revert: ()=>{ STATE.trimesters = STATE.trimesters.filter(t=>t.id!==id); STATE.activeTrimesterId = prevActive; },
    request: API.addTrimester(obj),
    reconcile: (res)=>{ const i=STATE.trimesters.findIndex(t=>t.id===id); if(i>-1) STATE.trimesters[i]=res; },
    successMsg: 'Trimester created',
  });
}

/* ============ Course modal ============ */
function openCourseModal(id){
  const existing = id ? courseById(id) : null;
  const tri = activeTrimester();
  openModal(`
    <div class="modal-head"><h2>${existing?'Edit course':'New course'}</h2><button class="btn btn-icon btn-ghost" onclick="closeModal()">✕</button></div>
    <div class="form-field"><label>Course name</label><input id="cName" value="${existing?escapeHtml(existing.name):''}" placeholder="e.g. Corporate Finance"></div>
    <div class="form-grid">
      <div class="form-field"><label>Course code (optional)</label><input id="cCode" value="${existing?escapeHtml(existing.code||''):''}"></div>
      <div class="form-field"><label>Professor (optional)</label><input id="cProf" value="${existing?escapeHtml(existing.professor||''):''}"></div>
      <div class="form-field"><label>Credit type</label>
        <select id="cCredit">
          <option value="half" ${existing?.creditType==='half'?'selected':''}>Half credit (min 10 sessions)</option>
          <option value="full" ${!existing||existing?.creditType==='full'?'selected':''}>Full credit (min 20 sessions)</option>
        </select>
      </div>
      <div class="form-field"><label>Colour</label><input id="cColor" type="color" value="${existing?.color||'#e1abf5'}"></div>
    </div>
    <div class="form-field"><label>Notes</label><textarea id="cNotes">${existing?escapeHtml(existing.notes||''):''}</textarea></div>
    <div class="modal-foot">
      ${existing?`<div class="left"><button class="btn btn-danger" onclick="submitDeleteCourse('${existing.id}')">Delete course</button></div>`:''}
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-accent" onclick="submitCourse(${existing?`'${existing.id}'`:'null'})">${existing?'Save':'Add course'}</button>
    </div>
  `);
}
function submitCourse(id){
  const name = document.getElementById('cName').value.trim();
  if(!name){ toast('Course name is required', true); return; }
  const payload = {
    name,
    code: document.getElementById('cCode').value.trim(),
    professor: document.getElementById('cProf').value.trim(),
    creditType: document.getElementById('cCredit').value,
    minSessions: document.getElementById('cCredit').value==='half' ? 10 : 20,
    color: document.getElementById('cColor').value,
    notes: document.getElementById('cNotes').value.trim(),
  };
  if(id){
    const prev = courseById(id);
    const updated = { ...prev, ...payload, id };
    optimistic({
      apply: ()=>{ const i=STATE.courses.findIndex(c=>c.id===id); if(i>-1) STATE.courses[i]=updated; },
      revert: ()=>{ const i=STATE.courses.findIndex(c=>c.id===id); if(i>-1) STATE.courses[i]=prev; },
      request: API.updateCourse({id, ...payload}),
      reconcile: (res)=>{ const i=STATE.courses.findIndex(c=>c.id===id); if(i>-1) STATE.courses[i]=res; },
      successMsg: 'Course updated',
    });
  } else {
    const tri = activeTrimester();
    if(!tri){ toast('Set up a trimester first', true); return; }
    payload.trimesterId = tri.id;
    const newId = API.newId('crs');
    const obj = { id:newId, ...payload, createdAt: new Date().toISOString() };
    optimistic({
      apply: ()=>STATE.courses.push(obj),
      revert: ()=>{ STATE.courses = STATE.courses.filter(c=>c.id!==newId); },
      request: API.addCourse(obj),
      reconcile: (res)=>{ const i=STATE.courses.findIndex(c=>c.id===newId); if(i>-1) STATE.courses[i]=res; },
      successMsg: 'Course added',
    });
  }
}
function submitDeleteCourse(id){
  if(!confirm('Delete this course and keep its events as uncategorised? This cannot be undone.')) return;
  const prevCourses = STATE.courses;
  const prevEvents = STATE.events;
  optimistic({
    apply: ()=>{
      STATE.courses = STATE.courses.filter(c=>c.id!==id);
      STATE.events = STATE.events.map(e=> e.courseId===id ? { ...e, courseId:'' } : e);
    },
    revert: ()=>{ STATE.courses = prevCourses; STATE.events = prevEvents; },
    request: API.deleteCourse({id}),
    successMsg: 'Course deleted',
  });
}

/* ============ Event modal (add / edit / recurrence / reschedule) ============ */
const EVENT_TYPES = Object.keys(TYPE_META);

function openEventModal(id, presetDate){
  const existing = id ? STATE.events.find(e=>e.id===id) : null;
  const tri = activeTrimester();
  const dateVal = existing ? existing.date : (presetDate ? toISO(presetDate) : toISO(STATE.calDate));

  const typeOptions = EVENT_TYPES.map(t=>`<option value="${t}" ${existing?.type===t?'selected':''}>${TYPE_META[t].label}</option>`).join('');
  const courseOptions = `<option value="">— None / extra-curricular —</option>` +
    STATE.courses.filter(c=>!tri || c.trimesterId===tri.id).map(c=>`<option value="${c.id}" ${existing?.courseId===c.id?'selected':''}>${escapeHtml(c.name)}</option>`).join('');

  const isNewSession = !existing;

  openModal(`
    <div class="modal-head"><h2>${existing?'Edit event':'Add event'}</h2><button class="btn btn-icon btn-ghost" onclick="closeModal()">✕</button></div>

    <div class="form-grid">
      <div class="form-field"><label>Type</label><select id="eType" onchange="onEventTypeChange()">${typeOptions}</select></div>
      <div class="form-field"><label>Course</label><select id="eCourse">${courseOptions}</select></div>
    </div>
    <div class="form-field"><label>Title (optional — defaults to course/type)</label><input id="eTitle" value="${existing?escapeHtml(existing.title||''):''}" placeholder="e.g. Mid-term test"></div>
    <div class="form-grid">
      <div class="form-field"><label>Date</label><input id="eDate" type="date" value="${dateVal}"></div>
      <div class="form-field"><label>Room</label><input id="eRoom" value="${existing?escapeHtml(existing.room||''):''}" placeholder="e.g. LT-3"></div>
      <div class="form-field"><label>Start time</label><input id="eStart" type="time" value="${existing?.startTime||'09:00'}" onchange="onStartTimeChange()"></div>
      <div class="form-field"><label>End time</label><input id="eEnd" type="time" value="${existing?.endTime||'10:20'}"></div>
    </div>
    <div class="form-grid">
      <div class="form-field"><label>Status</label>
        <select id="eStatus">
          <option value="scheduled" ${(!existing||existing.status==='scheduled')?'selected':''}>Scheduled</option>
          <option value="cancelled" ${existing?.status==='cancelled'?'selected':''}>Cancelled</option>
        </select>
      </div>
      <div class="form-field"><label>&nbsp;</label><button type="button" class="btn btn-ghost btn-sm" onclick="applyDefaultDuration()">Use default 1h20m</button></div>
    </div>
    <div class="form-field"><label>Notes / description</label><textarea id="eDesc">${existing?escapeHtml(existing.description||''):''}</textarea></div>

    <div id="recurrenceBlock"></div>

    <div class="modal-foot">
      ${existing?`<div class="left">
          <button class="btn btn-danger" onclick="submitDeleteEvent('${existing.id}')">Delete</button>
          ${existing.type==='session'||existing.room?`<button class="btn btn-ghost" onclick="openRescheduleModal('${existing.id}')">Reschedule…</button>`:''}
        </div>`:''}
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-accent" onclick="submitEvent(${existing?`'${existing.id}'`:'null'})">${existing?'Save':'Add'}</button>
    </div>
  `);

  if(isNewSession) renderRecurrenceBlock();
  onEventTypeChange();
}

function onStartTimeChange(){
  applyDefaultDuration();
}
function applyDefaultDuration(){
  const start = document.getElementById('eStart').value;
  if(start) document.getElementById('eEnd').value = addMinutesToTime(start, 80);
}

function onEventTypeChange(){
  const type = document.getElementById('eType').value;
  const block = document.getElementById('recurrenceBlock');
  if(block) block.style.display = (type==='session') ? '' : 'none';
}

function renderRecurrenceBlock(){
  const tri = activeTrimester();
  const defaultUntil = tri?.endDate || toISO(addDays(fromISO(tri?.startDate||toISO(new Date())), 13*7));
  const block = document.getElementById('recurrenceBlock');
  block.innerHTML = `
    <div class="section-label">Repeat weekly (creates the whole timetable slot at once)</div>
    <div class="card">
      <div class="form-field full">
        <label>Days of week</label>
        <div class="dow-picker" id="dowPicker">
          ${DOW.map((d,i)=>`<button type="button" class="dow-chip" data-dow="${i}" onclick="this.classList.toggle('active')">${d}</button>`).join('')}
        </div>
        <div class="hint">Tap the day(s) this course meets weekly. Leave all unselected to add just a single event.</div>
      </div>
      <div class="form-field full">
        <label>Repeat until</label>
        <input id="repeatUntil" type="date" value="${defaultUntil}">
      </div>
    </div>
  `;
}

function submitEvent(id){
  const tri = activeTrimester();
  const type = document.getElementById('eType').value;
  const courseId = document.getElementById('eCourse').value || null;
  const title = document.getElementById('eTitle').value.trim();
  const date = document.getElementById('eDate').value;
  const room = document.getElementById('eRoom').value.trim();
  const startTime = document.getElementById('eStart').value;
  const endTime = document.getElementById('eEnd').value;
  const status = document.getElementById('eStatus').value;
  const description = document.getElementById('eDesc').value.trim();

  if(!date){ toast('Date is required', true); return; }
  if(!tri){ toast('Set up a trimester first', true); return; }

  const base = { trimesterId:tri.id, courseId, type, title, room, startTime, endTime, status, description };

  if(id){
    const prev = STATE.events.find(e=>e.id===id);
    const updated = { ...prev, ...base, id, date };
    optimistic({
      apply: ()=>{ const i=STATE.events.findIndex(e=>e.id===id); if(i>-1) STATE.events[i]=updated; },
      revert: ()=>{ const i=STATE.events.findIndex(e=>e.id===id); if(i>-1) STATE.events[i]=prev; },
      request: API.updateEvent({id, ...base, date}),
      reconcile: (res)=>{ const i=STATE.events.findIndex(e=>e.id===id); if(i>-1) STATE.events[i]=res; },
      successMsg: 'Event updated',
    });
    return;
  }

  // check recurrence
  const dowChips = type==='session' ? Array.from(document.querySelectorAll('#dowPicker .dow-chip.active')).map(el=>Number(el.dataset.dow)) : [];
  const repeatUntilEl = document.getElementById('repeatUntil');

  if(dowChips.length && repeatUntilEl){
    const until = fromISO(repeatUntilEl.value);
    const anchor = fromISO(date);
    const dates = [];
    // walk day by day from the anchor date to 'until', collecting matching weekdays
    let d = new Date(anchor);
    while(d <= until){
      if(dowChips.includes(d.getDay()) && d >= anchor){
        dates.push(toISO(d));
      }
      d = addDays(d,1);
    }
    const recurringGroupId = 'rg_'+Date.now();
    const items = dates.map(dt => ({ id: API.newId('evt'), ...base, date:dt, recurringGroupId, createdAt: new Date().toISOString() }));
    const ids = items.map(it=>it.id);
    optimistic({
      apply: ()=>STATE.events.push(...items),
      revert: ()=>{ STATE.events = STATE.events.filter(e=>!ids.includes(e.id)); },
      request: API.addEventsBulk({items}),
      reconcile: (res)=>{
        res.items.forEach(res_ev=>{ const i=STATE.events.findIndex(e=>e.id===res_ev.id); if(i>-1) STATE.events[i]=res_ev; });
      },
      successMsg: `Added ${items.length} session${items.length===1?'':'s'}`,
    });
  } else {
    const newId = API.newId('evt');
    const obj = { id:newId, ...base, date, createdAt: new Date().toISOString() };
    optimistic({
      apply: ()=>STATE.events.push(obj),
      revert: ()=>{ STATE.events = STATE.events.filter(e=>e.id!==newId); },
      request: API.addEvent(obj),
      reconcile: (res)=>{ const i=STATE.events.findIndex(e=>e.id===newId); if(i>-1) STATE.events[i]=res; },
      successMsg: 'Event added',
    });
  }
}

function submitDeleteEvent(id){
  if(!confirm('Delete this event?')) return;
  const prevEvents = STATE.events;
  const prevAttendance = STATE.attendance;
  optimistic({
    apply: ()=>{
      STATE.events = STATE.events.filter(e=>e.id!==id);
      STATE.attendance = STATE.attendance.filter(a=>a.eventId!==id);
    },
    revert: ()=>{ STATE.events = prevEvents; STATE.attendance = prevAttendance; },
    request: API.deleteEvent({id}),
    successMsg: 'Event deleted',
  });
}

/* ---------- Reschedule ---------- */
function openRescheduleModal(id){
  const ev = STATE.events.find(e=>e.id===id);
  if(!ev) return;
  openModal(`
    <div class="modal-head"><h2>Reschedule</h2><button class="btn btn-icon btn-ghost" onclick="closeModal()">✕</button></div>
    <div class="hint" style="margin-bottom:10px;">The original session will be marked <b>cancelled</b> (it no longer counts toward the session count) and a new, linked session will be created at the new time.</div>
    <div class="form-grid">
      <div class="form-field"><label>New date</label><input id="rDate" type="date" value="${ev.date}"></div>
      <div class="form-field"><label>Room</label><input id="rRoom" value="${escapeHtml(ev.room||'')}"></div>
      <div class="form-field"><label>Start time</label><input id="rStart" type="time" value="${ev.startTime||'09:00'}"></div>
      <div class="form-field"><label>End time</label><input id="rEnd" type="time" value="${ev.endTime||'10:20'}"></div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-accent" onclick="submitReschedule('${id}')">Confirm reschedule</button>
    </div>
  `);
}
function submitReschedule(id){
  const ev = STATE.events.find(e=>e.id===id);
  const date = document.getElementById('rDate').value;
  const room = document.getElementById('rRoom').value.trim();
  const startTime = document.getElementById('rStart').value;
  const endTime = document.getElementById('rEnd').value;

  const newId = API.newId('evt');
  const newObj = {
    id: newId, trimesterId: ev.trimesterId, courseId: ev.courseId, type: ev.type,
    title: ev.title, room, startTime, endTime, date, status: 'scheduled',
    description: ev.description, linkedTo: ev.id, createdAt: new Date().toISOString(),
  };
  const updatedOriginal = { ...ev, status: 'cancelled', linkedTo: newId };

  optimistic({
    apply: ()=>{
      STATE.events.push(newObj);
      const i = STATE.events.findIndex(e=>e.id===id);
      if(i>-1) STATE.events[i] = updatedOriginal;
    },
    revert: ()=>{
      STATE.events = STATE.events.filter(e=>e.id!==newId);
      const i = STATE.events.findIndex(e=>e.id===id);
      if(i>-1) STATE.events[i] = ev;
    },
    // The UI already updated optimistically above, so there's no
    // perceived-speed cost to doing these in order — and it matters for
    // correctness in general (even without a DB-level FK here, the new
    // session should exist before anything points at it).
    request: (async () => {
      const createdRes = await API.addEvent(newObj);
      const updatedRes = await API.updateEvent({ id: ev.id, ...updatedOriginal });
      return [createdRes, updatedRes];
    })(),
    reconcile: ([createdRes, updatedRes])=>{
      const ni = STATE.events.findIndex(e=>e.id===newId); if(ni>-1) STATE.events[ni]=createdRes;
      const oi = STATE.events.findIndex(e=>e.id===id); if(oi>-1) STATE.events[oi]=updatedRes;
    },
    successMsg: 'Session rescheduled',
  });
}

/* ============ Attendance quick modal ============
   Every session defaults to Present — this modal exists mainly to flag an
   Absence, or to undo one. */
function openAttendanceModal(eventId){
  const ev = STATE.events.find(e=>e.id===eventId);
  const existing = attendanceForEvent(eventId);
  const current = effectiveAttendanceStatus(eventId);
  const sNum = sessionNumberFor(ev);
  openModal(`
    <div class="modal-head"><h2>Mark attendance</h2><button class="btn btn-icon btn-ghost" onclick="closeModal()">✕</button></div>
    <div class="hint" style="margin-bottom:10px;">${sNum?`Session ${sNum} · `:''}${escapeHtml(ev.title || (courseById(ev.courseId)?.name||''))} · ${fmtDateShort(fromISO(ev.date))} · ${fmtTime(ev.startTime)}</div>
    <div class="hint" style="margin-bottom:10px;">Sessions count as Present by default — only flag it if you weren't there.</div>
    <div class="form-field full">
      <div class="segmented" id="attSeg" style="width:100%;">
        <button type="button" data-v="present" class="${current==='present'?'active':''}">Present</button>
        <button type="button" data-v="absent" class="${current==='absent'?'active':''}">Absent</button>
      </div>
    </div>
    <div class="form-field"><label>Notes</label><textarea id="attNotes">${existing?escapeHtml(existing.notes||''):''}</textarea></div>
    <div class="modal-foot">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-accent" onclick="submitAttendance('${eventId}')">Save</button>
    </div>
  `);
  document.querySelectorAll('#attSeg button').forEach(b=>{
    b.addEventListener('click', ()=>{
      document.querySelectorAll('#attSeg button').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
    });
  });
}
function submitAttendance(eventId){
  const ev = STATE.events.find(e=>e.id===eventId);
  const status = document.querySelector('#attSeg button.active')?.dataset.v || 'present';
  const notes = document.getElementById('attNotes').value.trim();
  const prev = attendanceForEvent(eventId);
  const obj = { id: eventId, eventId, courseId: ev.courseId, date: ev.date, status, notes, updatedAt: new Date().toISOString() };
  optimistic({
    apply: ()=>{ const i=STATE.attendance.findIndex(a=>a.eventId===eventId); if(i>-1) STATE.attendance[i]=obj; else STATE.attendance.push(obj); },
    revert: ()=>{
      if(prev){ const i=STATE.attendance.findIndex(a=>a.eventId===eventId); if(i>-1) STATE.attendance[i]=prev; }
      else STATE.attendance = STATE.attendance.filter(a=>a.eventId!==eventId);
    },
    request: API.setAttendance({ eventId, courseId: ev.courseId, date: ev.date, status, notes }),
    reconcile: (res)=>{ const i=STATE.attendance.findIndex(a=>a.eventId===eventId); if(i>-1) STATE.attendance[i]=res; },
    successMsg: 'Attendance saved',
  });
}

/* ============ Views ============ */
function renderDashboard(host){
  const today = new Date();
  const tomorrow = addDays(today,1);
  const tri = activeTrimester();
  const todays = eventsOnDate(today);
  const tomorrows = eventsOnDate(tomorrow);
  const dayBounds = computeDayBounds(tomorrows);

  // "Coming week" starts the day after tomorrow, since tomorrow gets its
  // own detailed section above it — avoids showing the same day twice.
  const weekAhead = eventsInRange(addDays(today,2), addDays(today,6));
  const byDate = {};
  weekAhead.forEach(ev=>{ (byDate[ev.date] ||= []).push(ev); });

  const other = STATE.other; // {name, events, courses} or null
  let otherTomorrow = [], otherWeek = [];
  if(other){
    const tISO = toISO(tomorrow);
    otherTomorrow = other.events.filter(e=>e.date===tISO).sort((a,b)=>(a.startTime||'').localeCompare(b.startTime||''));
    const wStart = toISO(tomorrow), wEnd = toISO(addDays(today,6));
    otherWeek = other.events.filter(e=>e.date>=wStart && e.date<=wEnd);
  }

  host.innerHTML = `
    ${tri ? `<div class="card" style="margin-bottom:18px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;">
        <div><div style="font-weight:700;font-size:15px;">${escapeHtml(tri.name)}</div>
        <div class="view-subtitle">Started ${fmtDateShort(fromISO(tri.startDate))}${tri.endDate?' · Ends '+fmtDateShort(fromISO(tri.endDate)):''}</div></div>
        <button class="btn btn-sm" onclick="switchView('calendar')">Open calendar →</button>
      </div>` : `<div class="card" style="margin-bottom:18px;">No trimester set up yet. <button class="btn btn-accent btn-sm" onclick="openTrimesterModal()">Set up trimester</button></div>`}

    <div class="section-label">Today</div>
    <div class="card">
      ${todays.length ? todays.map(ev=>agendaItemHtml(ev,false)).join('') : `<div class="empty-state" style="padding:20px;"><span class="empty-emoji">☕</span>Nothing scheduled today</div>`}
    </div>

    <div class="section-label">Tomorrow</div>
    ${dayBounds ? `<div class="hint" style="margin:-4px 0 8px 2px;">Day starts ${fmtTime(dayBounds.start)} · ends ${fmtTime(dayBounds.end)}</div>` : ''}
    <div class="card">
      ${tomorrows.length ? tomorrows.map(ev=>agendaItemHtml(ev,false)).join('') : `<div class="empty-state" style="padding:20px;">Nothing scheduled</div>`}
    </div>

    ${other ? `
    <div class="section-label">${escapeHtml(other.name)}'s tomorrow</div>
    <div class="card">${otherTomorrow.length ? otherTomorrow.map(ev=>otherAgendaItemHtml(ev, other.courses)).join('') : `<div class="empty-state" style="padding:16px;">Nothing scheduled</div>`}</div>
    ` : ''}

    <div class="section-label">Coming week</div>
    ${Object.keys(byDate).length ? Object.keys(byDate).sort().map(dISO=>`
      <div class="week-block">
        <div class="week-block-head">${fmtDateLong(fromISO(dISO))}</div>
        <div class="card">${byDate[dISO].map(ev=>agendaItemHtml(ev,false)).join('')}</div>
      </div>
    `).join('') : `<div class="empty-state" style="padding:20px;">Nothing coming up yet</div>`}

    ${other ? `
    <div class="section-label">${escapeHtml(other.name)}'s week <span class="hint" style="font-weight:400;text-transform:none;">(brief)</span></div>
    <div class="card">${otherWeekBriefHtml(otherWeek, other.courses)}</div>
    ` : ''}
  `;
  host.querySelectorAll('.agenda-item[data-id]').forEach(el=>el.addEventListener('click', ()=>openEventModal(el.dataset.id)));
}

function renderCoursesView(host){
  const groups = {};
  STATE.trimesters.forEach(t=>groups[t.id]=[]);
  STATE.courses.forEach(c=>{ (groups[c.trimesterId] ||= []).push(c); });

  let html = `<div style="display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap;">
      <button class="btn btn-accent" onclick="openCourseModal()">+ New course</button>
      <button class="btn" onclick="openTrimesterModal()">+ New trimester</button>
    </div>`;

  if(!STATE.trimesters.length){
    html += `<div class="empty-state"><span class="empty-emoji">📚</span>Set up a trimester, then add your courses.</div>`;
  }

  STATE.trimesters.slice().reverse().forEach(tri=>{
    const courses = groups[tri.id]||[];
    html += `<div class="section-label">${escapeHtml(tri.name)}</div>`;
    if(!courses.length){
      html += `<div class="empty-state" style="padding:20px;">No courses added yet</div>`;
    } else {
      courses.forEach(c=>{
        const sessions = courseSessionEvents(c.id);
        const held = sessions.filter(s=>s.status!=='cancelled').length;
        const pct = Math.min(100, Math.round((held / c.minSessions)*100));
        html += `<div class="card course-card" data-id="${c.id}">
          <div class="course-swatch" style="background:${c.color||'var(--accent)'}"></div>
          <div class="course-main">
            <div class="course-name">${escapeHtml(c.name)}</div>
            <div class="course-sub">${c.creditType==='half'?'Half credit':'Full credit'} · min ${c.minSessions} sessions${c.professor?' · '+escapeHtml(c.professor):''}${c.code?' · '+escapeHtml(c.code):''}</div>
            <div class="course-progress"><div class="course-progress-bar" style="width:${pct}%"></div></div>
            <div class="hint">${held} / ${c.minSessions} sessions scheduled${held>c.minSessions?` (${held-c.minSessions} extra/remedial)`:''}</div>
          </div>
          <button class="btn btn-icon btn-ghost" onclick="event.stopPropagation();openCourseModal('${c.id}')">✎</button>
        </div>`;
      });
    }
  });

  host.innerHTML = html;
  host.querySelectorAll('.course-card').forEach(el=>{
    el.addEventListener('click', ()=>{ STATE.view='attendance'; renderApp(); setTimeout(()=>selectAttendanceCourse(el.dataset.id),0); });
  });
}

let attendanceCourseId = null;
function selectAttendanceCourse(id){ attendanceCourseId = id; renderAttendanceView(document.getElementById('viewHost')); }

function renderAttendanceView(host){
  if(!attendanceCourseId && STATE.courses.length) attendanceCourseId = STATE.courses[0].id;

  const summaryRows = STATE.courses.map(c=>{
    const sessions = courseSessionEvents(c.id);
    const held = sessions.filter(s=> new Date(s.date) <= new Date() && s.status!=='cancelled');
    const total = held.length;
    const present = held.filter(s=>effectiveAttendanceStatus(s.id)==='present').length;
    const pct = total ? Math.round(present/total*100) : null;
    return {c, present, total, pct};
  });

  let html = `<div class="section-label">Overview</div><div class="card">`;
  html += summaryRows.length ? summaryRows.map(r=>`
    <div class="agenda-item" data-course="${r.c.id}" style="cursor:pointer;">
      <div class="agenda-bar" style="background:${r.c.color||'var(--accent)'}"></div>
      <div class="agenda-body">
        <div class="agenda-title">${escapeHtml(r.c.name)}</div>
        <div class="agenda-meta">${r.total?`${r.present}/${r.total} present`:'No sessions held yet'}</div>
      </div>
      ${r.pct!==null?`<span class="badge ${r.pct<75?'badge-danger':'badge-success'}">${r.pct}%</span>`:''}
    </div>`).join('') : `<div class="empty-state" style="padding:20px;">Add courses to start tracking attendance</div>`;
  html += `</div>`;

  const course = courseById(attendanceCourseId);
  html += `<div class="section-label">Session by session</div>`;
  if(!course){
    html += `<div class="empty-state" style="padding:20px;">Select a course above</div>`;
  } else {
    const sessions = courseSessionEvents(course.id);
    const todayISO = toISO(new Date());
    html += `<div class="card" style="margin-bottom:10px;font-weight:700;">${escapeHtml(course.name)} <span class="hint">${totalSessionCount(course.id)} / ${course.minSessions} min sessions</span></div>`;
    html += `<div class="card">`;
    html += sessions.length ? sessions.map(s=>{
      const sNum = sessionNumberFor(s);
      let statusBadge;
      if(s.status==='cancelled'){
        statusBadge = `<span class="badge badge-danger">Cancelled</span>`;
      } else if(s.date > todayISO){
        statusBadge = `<span class="badge">Upcoming</span>`;
      } else {
        const eff = effectiveAttendanceStatus(s.id);
        statusBadge = eff==='absent' ? `<span class="badge badge-danger">Absent</span>` : `<span class="badge badge-success">Present</span>`;
      }
      return `<div class="agenda-item" data-mark="${s.id}" style="cursor:pointer;">
        <div class="agenda-time">${fmtDateShort(fromISO(s.date))}</div>
        <div class="agenda-bar" style="background:${course.color||'var(--accent)'}"></div>
        <div class="agenda-body">
          <div class="agenda-title">${sNum?`Session ${sNum}`:'Session'} · ${fmtTime(s.startTime)} ${s.room?'· Rm '+escapeHtml(s.room):''}</div>
        </div>
        ${statusBadge}
      </div>`;
    }).join('') : `<div class="empty-state" style="padding:20px;">No sessions scheduled yet for this course</div>`;
    html += `</div>`;
  }

  host.innerHTML = html;
  host.querySelectorAll('[data-course]').forEach(el=>el.addEventListener('click', ()=>selectAttendanceCourse(el.dataset.course)));
  host.querySelectorAll('[data-mark]').forEach(el=>el.addEventListener('click', ()=>{
    const s = STATE.events.find(e=>e.id===el.dataset.mark);
    if(s.status==='cancelled'){ toast('Session is cancelled'); return; }
    if(s.date > toISO(new Date())){ toast("Session hasn't happened yet"); return; }
    openAttendanceModal(el.dataset.mark);
  }));
}

function renderSettingsView(host){
  const url = API.getUrl();
  const active = API.getActiveUser();
  host.innerHTML = `
    <div class="section-label">Profile</div>
    <div class="card" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
      <div>${active ? `This device is set up for <b>${active}</b>` : `Choose who's using this device — each person has their own courses, events and attendance, and their own accent colour.`}</div>
      <div class="segmented">
        ${API.USERS.map(u=>`<button class="${active===u?'active':''}" onclick="switchProfile('${u}')">${u}</button>`).join('')}
      </div>
    </div>

    <div class="section-label">Google Sheet connection</div>
    <div class="card">
      <div class="form-field full"><label>Apps Script Web App URL</label><input id="apiUrlInput" value="${escapeHtml(url)}" placeholder="https://script.google.com/macros/s/.../exec"></div>
      <div style="display:flex;gap:10px;">
        <button class="btn btn-accent" onclick="saveApiUrl()">Save & sync</button>
        <button class="btn" onclick="manualResync()">Re-sync now</button>
      </div>
    </div>

    <div class="section-label">Trimesters</div>
    <div class="card">
      ${STATE.trimesters.length ? STATE.trimesters.map(t=>`
        <div class="agenda-item">
          <div class="agenda-body">
            <div class="agenda-title">${escapeHtml(t.name)} ${t.id===STATE.activeTrimesterId?'<span class="badge badge-accent">Active</span>':''}</div>
            <div class="agenda-meta">${fmtDateShort(fromISO(t.startDate))}${t.endDate?' – '+fmtDateShort(fromISO(t.endDate)):''}</div>
          </div>
          ${t.id!==STATE.activeTrimesterId?`<button class="btn btn-sm" onclick="setActiveTrimester('${t.id}')">Make active</button>`:''}
        </div>
      `).join('') : `<div class="empty-state" style="padding:20px;">None yet</div>`}
      <div style="margin-top:12px;"><button class="btn" onclick="openTrimesterModal()">+ New trimester</button></div>
    </div>

    <div class="section-label">Appearance</div>
    <div class="card" style="display:flex;align-items:center;justify-content:space-between;">
      <div>Theme</div>
      <div class="segmented">
        <button class="${document.documentElement.getAttribute('data-theme')==='dark'?'active':''}" onclick="setTheme('dark')">Dark</button>
        <button class="${document.documentElement.getAttribute('data-theme')==='light'?'active':''}" onclick="setTheme('light')">Light</button>
      </div>
    </div>

    <div class="section-label">Data</div>
    <div class="card">
      <button class="btn" onclick="downloadBackup()">Download JSON backup</button>
    </div>
  `;
}
function switchProfile(u){
  const cur = API.getActiveUser();
  if(cur===u) return;
  if(cur && !confirm(`Switch this device to ${u}'s organiser? It'll reload ${u}'s courses, events and attendance.`)) return;
  API.setActiveUser(u);
  document.documentElement.setAttribute('data-profile', u);
  STATE.activeTrimesterId = null;
  STATE.other = null;
  toast(`Switched to ${u}`);
  bootstrapData();
}
function saveApiUrl(){
  API.setUrl(document.getElementById('apiUrlInput').value);
  bootstrapData();
}
async function manualResync(){
  await bootstrapData();
  toast('Synced with Google Sheet');
}
function setActiveTrimester(id){ STATE.activeTrimesterId = id; renderCurrentView(); toast('Active trimester updated'); }
function setTheme(t){
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('mba_theme', t);
  document.getElementById('themeIcon').textContent = t==='dark' ? '☾' : '☀';
  renderCurrentView();
}
function downloadBackup(){
  const blob = new Blob([JSON.stringify(STATE,null,2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `mba-organiser-backup-${toISO(new Date())}.json`;
  a.click();
}
