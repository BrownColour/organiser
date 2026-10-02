/* ============ State ============ */
const STATE = {
  trimesters: [],
  courses: [],
  events: [],
  attendance: [],
  view: 'dashboard',
  calMode: 'week',        // day | week | month | trimester
  calDate: new Date(),    // anchor date for calendar navigation
  activeTrimesterId: null,
  // Read-only snapshot of the OTHER person's data (name + events + courses
  // only — enough for the Today tab's cross-visibility panels). null until
  // loaded, or if they haven't set up a trimester yet.
  other: null,
};

const TYPE_META = {
  session:              { label:'Session',              color:'var(--accent)', badge:'badge-accent' },
  test:                 { label:'Test',                 color:'var(--warning)', badge:'badge-warning' },
  individual_assignment:{ label:'Individual assignment',color:'var(--info)', badge:'badge-deliverable' },
  individual_project:   { label:'Individual project',   color:'var(--info)', badge:'badge-deliverable' },
  group_assignment:     { label:'Group assignment',     color:'var(--info)', badge:'badge-deliverable' },
  group_project:        { label:'Group project',        color:'var(--info)', badge:'badge-deliverable' },
  exam:                 { label:'Term-end exam',        color:'var(--danger)', badge:'badge-danger' },
  extracurricular:      { label:'Extra-curricular',     color:'#f5a6d9', badge:'badge' },
  other:                { label:'Other',                color:'var(--text-dim)', badge:'badge' },
};

// Case studies, presentations and flip-classroom activities are all just
// "session" type events (per user instruction) — no separate type needed.
// These four must read as visually distinct "deliverables" rather than
// in-class sessions.
const DELIVERABLE_TYPES = ['individual_assignment','individual_project','group_assignment','group_project'];
function isDeliverable(type){ return DELIVERABLE_TYPES.indexOf(type) !== -1; }

const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

/* ---------- date helpers (local dates, ISO 'YYYY-MM-DD' strings for storage) ---------- */
function toISO(d){
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function fromISO(s){
  const [y,m,d] = s.split('-').map(Number);
  return new Date(y, m-1, d);
}
function addDays(d, n){ const r = new Date(d); r.setDate(r.getDate()+n); return r; }
function startOfWeek(d){ const r = new Date(d); const day = r.getDay(); return addDays(r, -day); } // Sunday start
function isSameDay(a,b){ return toISO(a)===toISO(b); }
function isToday(d){ return isSameDay(d, new Date()); }
function fmtDateLong(d){ return `${DOW[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`; }
function fmtDateShort(d){ return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0,3)}`; }
function fmtTime(t){
  if(!t) return '';
  const [h,m] = t.split(':').map(Number);
  const ampm = h>=12 ? 'PM':'AM';
  const h12 = h%12===0 ? 12 : h%12;
  return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
}
function timeToMinutes(t){ const [h,m]=t.split(':').map(Number); return h*60+m; }
function minutesToTime(mins){
  mins = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(mins/60), m = mins%60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}
function addMinutesToTime(t, add){ return minutesToTime(timeToMinutes(t)+add); }

/* ---------- lookups ---------- */
function courseById(id){ return STATE.courses.find(c=>c.id===id); }
function trimesterById(id){ return STATE.trimesters.find(t=>t.id===id); }
function activeTrimester(){ return trimesterById(STATE.activeTrimesterId) || STATE.trimesters[0]; }

function eventsInTrimester(trimesterId){
  return STATE.events.filter(e=>e.trimesterId===trimesterId);
}
function eventsOnDate(dateObj){
  const iso = toISO(dateObj);
  return STATE.events.filter(e=>e.date===iso).sort((a,b)=> (a.startTime||'').localeCompare(b.startTime||''));
}
function eventsInRange(startD, endD){ // inclusive
  const s = toISO(startD), e = toISO(endD);
  return STATE.events.filter(ev => ev.date >= s && ev.date <= e)
    .sort((a,b)=> a.date===b.date ? (a.startTime||'').localeCompare(b.startTime||'') : a.date.localeCompare(b.date));
}
function attendanceForEvent(eventId){ return STATE.attendance.find(a=>a.eventId===eventId); }
function attendanceForCourse(courseId){ return STATE.attendance.filter(a=>a.courseId===courseId); }

function courseSessionEvents(courseId){
  return STATE.events.filter(e=>e.courseId===courseId && e.type==='session')
    .sort((a,b)=> a.date===b.date ? (a.startTime||'').localeCompare(b.startTime||'') : a.date.localeCompare(b.date));
}

/* ---------- session numbering ----------
   "Session N" is computed fresh from the current data every time, counting
   only non-cancelled sessions in date order. That means cancelling a
   session automatically renumbers everything after it — there's nothing to
   store or keep in sync. */
let SESSION_NUMBERS = {};
function rebuildSessionNumbering(){
  SESSION_NUMBERS = {};
  const byCourse = {};
  STATE.events.forEach(e=>{
    if(e.type==='session' && e.courseId){ (byCourse[e.courseId] ||= []).push(e); }
  });
  Object.keys(byCourse).forEach(cid=>{
    const list = byCourse[cid].slice().sort((a,b)=> a.date===b.date ? (a.startTime||'').localeCompare(b.startTime||'') : a.date.localeCompare(b.date));
    let n = 0;
    list.forEach(ev=>{
      if(ev.status !== 'cancelled'){ n++; SESSION_NUMBERS[ev.id] = n; }
      else SESSION_NUMBERS[ev.id] = null;
    });
  });
}
function sessionNumberFor(ev){
  return (ev.type==='session') ? (SESSION_NUMBERS[ev.id] ?? null) : null;
}
function totalSessionCount(courseId){
  return STATE.events.filter(e=>e.courseId===courseId && e.type==='session' && e.status!=='cancelled').length;
}

/* ---------- attendance defaults ----------
   Every held session (date has passed, not cancelled) is treated as
   Present unless there's an explicit Absent record — so "marking
   attendance" really only means flagging absences. */
function effectiveAttendanceStatus(eventId){
  const rec = attendanceForEvent(eventId);
  return rec ? rec.status : 'present';
}

function colorForEvent(ev){
  const course = ev.courseId ? courseById(ev.courseId) : null;
  if(course && course.color) return course.color;
  return (TYPE_META[ev.type]||TYPE_META.other).color;
}

/* ---------- cross-user helpers ----------
   The other person's course IDs are meaningless against STATE.courses (own
   dataset only), so these take an explicit courses array instead of
   assuming the global one. */
function courseNameIn(courses, id){
  if(!id) return null;
  const c = (courses||[]).find(c=>c.id===id);
  return c ? c.name : null;
}
function colorForEventIn(ev, courses){
  const c = ev.courseId ? (courses||[]).find(c=>c.id===ev.courseId) : null;
  if(c && c.color) return c.color;
  return (TYPE_META[ev.type]||TYPE_META.other).color;
}

// Earliest start / latest end among a day's non-cancelled timed events —
// used to show "day starts at X, ends at Y" for tomorrow.
function computeDayBounds(events){
  const timed = events.filter(e=>e.status!=='cancelled' && e.startTime);
  if(!timed.length) return null;
  let start = null, end = null;
  timed.forEach(e=>{
    if(start===null || e.startTime < start) start = e.startTime;
    const e2 = e.endTime || e.startTime;
    if(end===null || e2 > end) end = e2;
  });
  return { start, end };
}
