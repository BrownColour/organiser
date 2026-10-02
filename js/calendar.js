/* ============ Calendar rendering ============ */
const CAL_START_MIN = 7*60;   // 7:00 AM
const CAL_END_MIN = 22*60;    // 10:00 PM
const PX_PER_HOUR = 64;
// A 10-20 min event's proportional height is smaller than its own text
// needs (title + course + time can be 3 lines) — never shrink a card below
// this, regardless of how short the actual slot is.
const MIN_EVENT_PX = 58;

function calNext(){
  const d = STATE.calDate;
  if(STATE.calMode==='day') STATE.calDate = addDays(d,1);
  else if(STATE.calMode==='week') STATE.calDate = addDays(d,7);
  else if(STATE.calMode==='month') STATE.calDate = new Date(d.getFullYear(), d.getMonth()+1, 1);
  else if(STATE.calMode==='trimester') STATE.calDate = addDays(d,28);
  renderCurrentView();
}
function calPrev(){
  const d = STATE.calDate;
  if(STATE.calMode==='day') STATE.calDate = addDays(d,-1);
  else if(STATE.calMode==='week') STATE.calDate = addDays(d,-7);
  else if(STATE.calMode==='month') STATE.calDate = new Date(d.getFullYear(), d.getMonth()-1, 1);
  else if(STATE.calMode==='trimester') STATE.calDate = addDays(d,-28);
  renderCurrentView();
}
function calToday(){ STATE.calDate = new Date(); renderCurrentView(); }
function setCalMode(mode){ STATE.calMode = mode; renderCurrentView(); }

function calendarSubtitleLabel(){
  const d = STATE.calDate;
  if(STATE.calMode==='day') return fmtDateLong(d);
  if(STATE.calMode==='week'){
    const s = startOfWeek(d), e = addDays(s,6);
    return `${fmtDateShort(s)} – ${fmtDateShort(e)}, ${e.getFullYear()}`;
  }
  if(STATE.calMode==='month') return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  const tri = activeTrimester();
  return tri ? `${tri.name}` : 'No trimester set';
}

function renderCalendarView(host){
  host.innerHTML = `<div id="calBody"></div>`;
  const body = host.querySelector('#calBody');
  if(STATE.calMode==='day') renderTimeline(body, [STATE.calDate]);
  else if(STATE.calMode==='week') renderTimeline(body, weekDates(STATE.calDate));
  else if(STATE.calMode==='month') renderMonth(body, STATE.calDate);
  else renderTrimesterAgenda(body);
}

function weekDates(anchor){
  const s = startOfWeek(anchor);
  return Array.from({length:7}, (_,i)=>addDays(s,i));
}

/* ---------- Day / Week timeline ---------- */
function renderTimeline(host, days){
  const totalMin = CAL_END_MIN - CAL_START_MIN;
  const hourCount = totalMin/60;

  let hourLabels = '';
  for(let h=0; h<=hourCount; h++){
    const mins = CAL_START_MIN + h*60;
    hourLabels += `<div class="tl-hour-label">${fmtTime(minutesToTime(mins))}</div>`;
  }

  let cols = '';
  days.forEach(day=>{
    const evs = eventsOnDate(day);
    let slots = '';
    for(let h=0; h<hourCount; h++) slots += `<div class="tl-slot"></div>`;

    let evBlocks = '';
    evs.forEach(ev=>{
      if(!ev.startTime) return;
      const startMin = Math.max(timeToMinutes(ev.startTime), CAL_START_MIN);
      const endMin = ev.endTime ? Math.max(timeToMinutes(ev.endTime), startMin+20) : startMin+80;
      const top = (startMin - CAL_START_MIN)/60*PX_PER_HOUR;
      const height = Math.max((endMin-startMin)/60*PX_PER_HOUR, MIN_EVENT_PX);
      const meta = TYPE_META[ev.type]||TYPE_META.other;
      const course = ev.courseId ? courseById(ev.courseId) : null;
      const color = colorForEvent(ev);
      const cancelled = ev.status==='cancelled';
      const deliverable = isDeliverable(ev.type);
      const sNum = sessionNumberFor(ev);
      const titleText = (sNum ? `Session ${sNum}` : '') + (ev.title ? (sNum?' — ':'') + escapeHtml(ev.title) : (sNum?'':escapeHtml(meta.label)));
      const courseLine = course ? `<div class="te-course">${escapeHtml(course.name)}</div>` : '';
      evBlocks += `
        <div class="tl-event ${cancelled?'cancelled':''} ${deliverable?'deliverable':''}" data-id="${ev.id}" style="top:${top}px;height:${height}px;border-left-color:${color};">
          <div class="te-title">${titleText}</div>
          ${courseLine}
          <div class="te-meta">${fmtTime(ev.startTime)}${ev.endTime?' – '+fmtTime(ev.endTime):''}${ev.room?' · Rm '+escapeHtml(ev.room):''}</div>
        </div>`;
    });

    cols += `
      <div class="tl-col" style="grid-template-rows:repeat(${hourCount},${PX_PER_HOUR}px)">
        <div class="tl-col-head ${isToday(day)?'today':''}">
          <div class="dow">${DOW[day.getDay()]}</div>
          <div class="dnum">${day.getDate()}</div>
        </div>
        <div style="position:relative;">
          ${slots}
          ${evBlocks}
        </div>
      </div>`;
  });

  host.innerHTML = `
    <div class="timeline-wrap">
      <div class="tl-hours" style="min-width:56px;">
        <div class="tl-col-head">&nbsp;</div>
        ${hourLabels}
      </div>
      <div class="timeline-scroll">
        <div class="timeline" style="grid-template-columns:repeat(${days.length}, minmax(150px,1fr));">
          ${cols}
        </div>
      </div>
    </div>`;

  host.querySelectorAll('.tl-event').forEach(el=>{
    el.addEventListener('click', ()=>openEventModal(el.dataset.id));
  });
}

/* ---------- Month ---------- */
function renderMonth(host, anchor){
  const year = anchor.getFullYear(), month = anchor.getMonth();
  const first = new Date(year, month, 1);
  const gridStart = startOfWeek(first);
  const cells = Array.from({length:42}, (_,i)=>addDays(gridStart,i));

  let dow = DOW.map(d=>`<div class="month-dow">${d}</div>`).join('');
  let cellsHtml = '';
  cells.forEach(day=>{
    const evs = eventsOnDate(day);
    const otherMonth = day.getMonth()!==month;
    const shown = evs.slice(0,3);
    const more = evs.length - shown.length;
    cellsHtml += `
      <div class="month-cell ${otherMonth?'other-month':''} ${isToday(day)?'today':''}" data-date="${toISO(day)}">
        <div class="cell-date">${day.getDate()}</div>
        ${shown.map(ev=>{
          const sNum = sessionNumberFor(ev);
          const course = ev.courseId ? courseById(ev.courseId) : null;
          const main = sNum ? `Session ${sNum}` : escapeHtml(ev.title||TYPE_META[ev.type]?.label||'');
          const label = course ? `${escapeHtml(course.name)} · ${main}` : main;
          return `<div class="cell-chip ${ev.status==='cancelled'?'cancelled':''} ${isDeliverable(ev.type)?'deliverable':''}" data-id="${ev.id}" style="border-left-color:${colorForEvent(ev)}">${fmtTime(ev.startTime)?fmtTime(ev.startTime)+' · ':''}${label}</div>`;
        }).join('')}
        ${more>0?`<div class="cell-more">+${more} more</div>`:''}
      </div>`;
  });

  host.innerHTML = `<div class="month-grid">${dow}${cellsHtml}</div>`;
  host.querySelectorAll('.cell-chip').forEach(el=>{
    el.addEventListener('click', (e)=>{ e.stopPropagation(); openEventModal(el.dataset.id); });
  });
  host.querySelectorAll('.month-cell').forEach(el=>{
    el.addEventListener('click', ()=>{
      STATE.calDate = fromISO(el.dataset.date);
      STATE.calMode = 'day';
      renderCurrentView();
    });
  });
}

/* ---------- Trimester agenda ---------- */
function renderTrimesterAgenda(host){
  const tri = activeTrimester();
  if(!tri){
    host.innerHTML = `<div class="empty-state"><span class="empty-emoji">🗓️</span>No trimester set up yet.<br><br><button class="btn btn-accent" onclick="openTrimesterModal()">Set up trimester</button></div>`;
    return;
  }
  const start = fromISO(tri.startDate);
  const end = tri.endDate ? fromISO(tri.endDate) : addDays(start, 13*7);
  let weekStart = startOfWeek(start);
  let html = '';
  let guard = 0;
  while(weekStart <= end && guard < 20){
    const weekEnd = addDays(weekStart,6);
    const evs = eventsInRange(weekStart, weekEnd);
    html += `<div class="week-block">
      <div class="week-block-head">${fmtDateShort(weekStart)} – ${fmtDateShort(weekEnd)}</div>
      <div class="card">
        ${evs.length ? evs.map(ev=>agendaItemHtml(ev, true)).join('') : `<div class="empty-state" style="padding:18px;">No events yet</div>`}
      </div>
    </div>`;
    weekStart = addDays(weekStart,7);
    guard++;
  }
  host.innerHTML = html;
  host.querySelectorAll('[data-id]').forEach(el=>{
    el.addEventListener('click', ()=>openEventModal(el.dataset.id));
  });
}

function agendaItemHtml(ev, showDate){
  const meta = TYPE_META[ev.type]||TYPE_META.other;
  const course = ev.courseId ? courseById(ev.courseId) : null;
  const cancelled = ev.status==='cancelled';
  const deliverable = isDeliverable(ev.type);
  const sNum = sessionNumberFor(ev);
  const typeLabel = sNum ? `Session ${sNum}` : meta.label;
  // A cancelled event with a linkedTo was moved rather than dropped; a
  // scheduled event with a linkedTo is where it landed.
  const movedAway = cancelled && ev.linkedTo;
  const movedHere = !cancelled && ev.linkedTo;
  return `
    <div class="agenda-item ${cancelled?'cancelled':''} ${deliverable?'deliverable':''}" data-id="${ev.id}">
      <div class="agenda-time">${showDate?fmtDateShort(fromISO(ev.date))+' · ':''}${fmtTime(ev.startTime)}</div>
      <div class="agenda-bar" style="--bar-color:${colorForEvent(ev)}"></div>
      <div class="agenda-body">
        <div class="agenda-title">${escapeHtml(ev.title || (course?course.name:meta.label))}</div>
        <div class="agenda-meta">
          <span class="badge ${meta.badge}">${typeLabel}</span>
          ${course?`<span>${escapeHtml(course.name)}</span>`:''}
          ${ev.room?`<span>Rm ${escapeHtml(ev.room)}</span>`:''}
          ${movedAway?`<span class="badge badge-warning">Rescheduled</span>`:''}
          ${movedHere?`<span class="badge badge-warning">Make-up session</span>`:''}
          ${cancelled&&!movedAway?`<span class="badge badge-danger">Cancelled</span>`:''}
        </div>
      </div>
    </div>`;
}

function escapeHtml(s){
  return String(s??'').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

/* ---------- other user's events (cross-visibility on the Today tab) ----------
   Read-only: no data-id / click handler, since these events aren't ours to
   open or edit. Course lookups use the other person's own courses array. */
function otherAgendaItemHtml(ev, otherCourses){
  const meta = TYPE_META[ev.type]||TYPE_META.other;
  const courseName = courseNameIn(otherCourses, ev.courseId);
  const cancelled = ev.status==='cancelled';
  return `
    <div class="agenda-item ${cancelled?'cancelled':''} ${isDeliverable(ev.type)?'deliverable':''}">
      <div class="agenda-time">${fmtTime(ev.startTime)}${ev.endTime?' – '+fmtTime(ev.endTime):''}</div>
      <div class="agenda-bar" style="--bar-color:${colorForEventIn(ev, otherCourses)}"></div>
      <div class="agenda-body">
        <div class="agenda-title">${escapeHtml(ev.title || courseName || meta.label)}</div>
        <div class="agenda-meta">
          <span class="badge ${meta.badge}">${meta.label}</span>
          ${courseName?`<span>${escapeHtml(courseName)}</span>`:''}
          ${ev.room?`<span>Rm ${escapeHtml(ev.room)}</span>`:''}
          ${cancelled?`<span class="badge badge-danger">Cancelled</span>`:''}
        </div>
      </div>
    </div>`;
}

function otherWeekBriefHtml(events, otherCourses){
  if(!events.length) return `<div class="empty-state" style="padding:16px;">Nothing scheduled</div>`;
  const byDate = {};
  events.forEach(ev=>{ (byDate[ev.date] ||= []).push(ev); });
  return Object.keys(byDate).sort().map(dISO=>{
    const dayEvs = byDate[dISO].slice().sort((a,b)=>(a.startTime||'').localeCompare(b.startTime||''));
    const chips = dayEvs.map(ev=>{
      const label = ev.title || courseNameIn(otherCourses, ev.courseId) || (TYPE_META[ev.type]||TYPE_META.other).label;
      return `<span class="brief-chip ${ev.status==='cancelled'?'cancelled':''}">${fmtTime(ev.startTime)} ${escapeHtml(label)}</span>`;
    }).join('');
    return `<div class="brief-day">
      <div class="brief-day-label">${fmtDateShort(fromISO(dISO))}</div>
      <div class="brief-chips">${chips}</div>
    </div>`;
  }).join('');
}
