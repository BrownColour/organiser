/**
 * MBA Trimester Organiser — Apps Script backend
 * -----------------------------------------------
 * Serves TWO separate people (named S and K in the app) from one
 * deployment. Each person's data lives in their own sheet tabs — S_Trimesters,
 * K_Trimesters, S_Courses, K_Courses, and so on — so their timetables,
 * courses and attendance never mix, while still letting the app peek at
 * the other person's schedule for the "Today" tab's cross-visibility
 * panels (a plain getAll for the other user — see the front end).
 *
 * Create (not just update) requests accept an optional client-supplied
 * `id` instead of always minting one server-side. The front end generates
 * one with crypto.randomUUID() before the request even goes out, which is
 * what lets it show a new trimester/course/event on screen the instant you
 * hit Save, without waiting on a round trip to find out what id it got.
 *
 * Deploy: Extensions > Apps Script in a Google Sheet, paste this file in as
 * Code.gs, run setup() once (creates all 8 sheets), then Deploy > New
 * deployment > Web app (Execute as: Me, Who has access: Anyone with the
 * link). Paste the /exec URL into js/api.js's DEFAULT_URL (already done)
 * or override it in the organiser's Settings screen.
 */

const USERS = ['S', 'K'];

const HEADERS = {
  Trimesters: ['id','name','startDate','endDate','createdAt'],
  Courses: ['id','trimesterId','name','code','professor','creditType','minSessions','color','notes','createdAt'],
  Events: ['id','trimesterId','courseId','type','title','date','startTime','endTime','room','status','recurringGroupId','linkedTo','description','createdAt','updatedAt'],
  Attendance: ['id','eventId','courseId','date','status','notes','updatedAt'],
};

function assertUser(user){
  if (USERS.indexOf(user) === -1) throw new Error("Invalid or missing user — expected 'S' or 'K', got: " + user);
  return user;
}
function tabName(user, base){
  return assertUser(user) + '_' + base;
}

/* ============ One-time setup ============ */
function setup(){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  USERS.forEach(user=>{
    Object.keys(HEADERS).forEach(base=>{
      const name = tabName(user, base);
      let sheet = ss.getSheetByName(name);
      if(!sheet) sheet = ss.insertSheet(name);
      const headers = HEADERS[base];
      sheet.getRange(1,1,1,headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
    });
  });
  // remove default "Sheet1" if empty and unused
  const def = ss.getSheetByName('Sheet1');
  if(def && ss.getSheets().length > 1) {
    try{ ss.deleteSheet(def); }catch(e){}
  }
  SpreadsheetApp.getUi().alert('Setup complete. Created sheets for: ' + USERS.join(', ') + ' (' + Object.keys(HEADERS).join(', ') + ' each).');
}

/* ============ HTTP entry points ============ */
function doGet(e){
  // A calendar app subscribing to this URL sends a plain GET with simple
  // query params (?action=icsFeed&user=S) — it can't send the JSON-wrapped
  // POST body the rest of the API expects, so this is handled separately,
  // before anything else.
  if(e.parameter.action === 'icsFeed') return icsFeedResponse(e.parameter.user, e.parameter.days);
  return handleRequest(e);
}
function doPost(e){ return handleRequest(e); }

function handleRequest(e){
  let action, payload;
  try{
    if(e.postData && e.postData.contents){
      const body = JSON.parse(e.postData.contents);
      action = body.action;
      payload = body.payload || {};
    } else {
      action = e.parameter.action;
      payload = e.parameter.payload ? JSON.parse(e.parameter.payload) : {};
    }
    const user = assertUser(payload.user);
    const data = route(action, user, payload);
    return jsonOut({ ok:true, data: data });
  }catch(err){
    return jsonOut({ ok:false, error: String(err.message || err) });
  }
}

function jsonOut(obj){
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function route(action, user, payload){
  switch(action){
    case 'getAll': return getAll(user);
    case 'addTrimester': return addTrimester(user, payload);
    case 'addCourse': return addCourse(user, payload);
    case 'updateCourse': return updateCourse(user, payload);
    case 'deleteCourse': return deleteCourse(user, payload);
    case 'addEvent': return addEvent(user, payload);
    case 'addEventsBulk': return addEventsBulk(user, payload);
    case 'updateEvent': return updateEvent(user, payload);
    case 'deleteEvent': return deleteEvent(user, payload);
    case 'setAttendance': return setAttendance(user, payload);
    default: throw new Error('Unknown action: ' + action);
  }
}

/* ============ Generic sheet helpers ============ */
function getSheet(user, base){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const name = tabName(user, base);
  const sheet = ss.getSheetByName(name);
  if(!sheet) throw new Error('Sheet missing: ' + name + '. Run setup() once from the Apps Script editor.');
  return sheet;
}

// Columns that Google Sheets may silently auto-convert to a Date/Time value
// when a plain "2026-01-15" or "09:00" string is written into them. We have
// to know, per column, whether to read a Date cell back as a calendar date
// or as a time-of-day — treating them the same throws the actual time away
// and corrupts every session's start/end time.
const DATE_COLUMNS = { Trimesters:['startDate','endDate'], Events:['date'], Attendance:['date'] };
const TIME_COLUMNS = { Events:['startTime','endTime'] };

function readAll(user, base){
  const sheet = getSheet(user, base);
  const values = sheet.getDataRange().getValues();
  if(values.length < 2) return [];
  const headers = values[0];
  const dateCols = DATE_COLUMNS[base] || [];
  const timeCols = TIME_COLUMNS[base] || [];
  const tz = Session.getScriptTimeZone();
  return values.slice(1)
    .filter(row => row.some(cell => cell !== '' && cell !== null))
    .map(row=>{
      const obj = {};
      headers.forEach((h,i)=>{
        obj[h] = normalizeCell(row[i], h, dateCols, timeCols, tz);
      });
      return obj;
    });
}

function normalizeCell(v, header, dateCols, timeCols, tz){
  if(v instanceof Date){
    if(timeCols.indexOf(header) !== -1) return Utilities.formatDate(v, tz, 'HH:mm');
    if(dateCols.indexOf(header) !== -1) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    // Date-shaped value in a column we don't expect one in (e.g. createdAt) —
    // fall back to a full ISO string rather than guessing.
    return Utilities.formatDate(v, tz, "yyyy-MM-dd'T'HH:mm:ss");
  }
  return v;
}

function appendObject(user, base, obj){
  const sheet = getSheet(user, base);
  const headers = HEADERS[base];
  const row = headers.map(h => obj[h] !== undefined ? obj[h] : '');
  sheet.appendRow(row);
  return obj;
}

function findRowIndexById(sheet, headers, id){
  const idCol = headers.indexOf('id');
  const values = sheet.getDataRange().getValues();
  for(let i=1;i<values.length;i++){
    if(values[i][idCol] === id) return i+1; // 1-based sheet row
  }
  return -1;
}

function updateRowById(user, base, id, patch){
  const sheet = getSheet(user, base);
  const headers = HEADERS[base];
  const rowIdx = findRowIndexById(sheet, headers, id);
  if(rowIdx === -1) throw new Error('Record not found: ' + id);
  const current = {};
  const currentRow = sheet.getRange(rowIdx,1,1,headers.length).getValues()[0];
  headers.forEach((h,i)=> current[h] = currentRow[i]);
  const updated = Object.assign({}, current, patch);
  const row = headers.map(h => updated[h] !== undefined ? updated[h] : '');
  sheet.getRange(rowIdx,1,1,headers.length).setValues([row]);
  return updated;
}

function deleteRowById(user, base, id){
  const sheet = getSheet(user, base);
  const headers = HEADERS[base];
  const rowIdx = findRowIndexById(sheet, headers, id);
  if(rowIdx === -1) return false;
  sheet.deleteRow(rowIdx);
  return true;
}

function newId(prefix){
  return prefix + '_' + Utilities.getUuid().split('-')[0] + Date.now().toString(36);
}
function nowIso(){ return new Date().toISOString(); }

/* ============ Data operations ============ */
function getAll(user){
  return {
    trimesters: readAll(user, 'Trimesters'),
    courses: readAll(user, 'Courses'),
    events: readAll(user, 'Events'),
    attendance: readAll(user, 'Attendance'),
  };
}

function addTrimester(user, p){
  const obj = {
    id: p.id || newId('tri'),
    name: p.name || '',
    startDate: p.startDate || '',
    endDate: p.endDate || '',
    createdAt: nowIso(),
  };
  return appendObject(user, 'Trimesters', obj);
}

function addCourse(user, p){
  const obj = {
    id: p.id || newId('crs'),
    trimesterId: p.trimesterId || '',
    name: p.name || '',
    code: p.code || '',
    professor: p.professor || '',
    creditType: p.creditType || 'full',
    minSessions: p.minSessions || (p.creditType==='half' ? 10 : 20),
    color: p.color || '#e1abf5',
    notes: p.notes || '',
    createdAt: nowIso(),
  };
  return appendObject(user, 'Courses', obj);
}
function updateCourse(user, p){
  if(!p.id) throw new Error('id required');
  return updateRowById(user, 'Courses', p.id, p);
}
function deleteCourse(user, p){
  if(!p.id) throw new Error('id required');
  deleteRowById(user, 'Courses', p.id);
  detachCourseFromEvents(user, p.id);
  return { id: p.id };
}

// Clear courseId on any events that referenced the deleted course, in one
// batched read/write instead of one update call per matching row.
function detachCourseFromEvents(user, courseId){
  const sheet = getSheet(user, 'Events');
  const headers = HEADERS.Events;
  const range = sheet.getDataRange();
  const values = range.getValues();
  const courseCol = headers.indexOf('courseId');
  let changed = false;
  for(let i=1;i<values.length;i++){
    if(values[i][courseCol] === courseId){ values[i][courseCol] = ''; changed = true; }
  }
  if(changed) range.setValues(values);
}

function addEvent(user, p){
  const obj = buildEventObject(p);
  return appendObject(user, 'Events', obj);
}

function buildEventObject(p){
  const now = nowIso();
  return {
    id: p.id || newId('evt'),
    trimesterId: p.trimesterId || '',
    courseId: p.courseId || '',
    type: p.type || 'other',
    title: p.title || '',
    date: p.date || '',
    startTime: p.startTime || '',
    endTime: p.endTime || '',
    room: p.room || '',
    status: p.status || 'scheduled',
    recurringGroupId: p.recurringGroupId || '',
    linkedTo: p.linkedTo || '',
    description: p.description || '',
    createdAt: p.createdAt || now,
    updatedAt: now,
  };
}

// Writes every recurring session in a single setValues() call rather than
// one appendRow() per session, which re-scans the whole sheet on every call
// — for a term's worth of weekly sessions that's what made bulk-adding a
// timetable slow.
function addEventsBulk(user, p){
  const items = p.items || [];
  if(!items.length) return { count:0, items:[] };
  const sheet = getSheet(user, 'Events');
  const headers = HEADERS.Events;
  const created = items.map(item => buildEventObject(item));
  const rows = created.map(obj => headers.map(h => obj[h] !== undefined ? obj[h] : ''));
  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rows.length, headers.length).setValues(rows);
  return { count: created.length, items: created };
}

function updateEvent(user, p){
  if(!p.id) throw new Error('id required');
  p.updatedAt = nowIso();
  return updateRowById(user, 'Events', p.id, p);
}

function deleteEvent(user, p){
  if(!p.id) throw new Error('id required');
  deleteRowById(user, 'Events', p.id);
  // also clean up any attendance record tied to this event
  const att = readAll(user, 'Attendance').find(a=>a.eventId===p.id);
  if(att) deleteRowById(user, 'Attendance', att.id);
  return { id: p.id };
}

function setAttendance(user, p){
  if(!p.eventId) throw new Error('eventId required');
  const existing = readAll(user, 'Attendance').find(a=>a.eventId===p.eventId);
  if(existing){
    return updateRowById(user, 'Attendance', existing.id, {
      status: p.status || 'present', notes: p.notes || '', updatedAt: nowIso(),
      courseId: p.courseId || existing.courseId, date: p.date || existing.date,
    });
  }
  const obj = {
    id: newId('att'),
    eventId: p.eventId,
    courseId: p.courseId || '',
    date: p.date || '',
    status: p.status || 'present',
    notes: p.notes || '',
    updatedAt: nowIso(),
  };
  return appendObject(user, 'Attendance', obj);
}

/* ============ ICS calendar feed ============
   Lets a real calendar app (Google Calendar, Apple Calendar, Outlook...)
   subscribe to this profile's schedule directly — which means it can then
   use THAT app's own native home-screen widget to show it, something a
   web app alone can't do. See the "Using this on your phone" section of
   the README for how to subscribe.

   URL: <your /exec URL>?action=icsFeed&user=S  (optionally &days=90 to
   change how far ahead it includes; defaults to 60).
*/
function icsFeedResponse(user, daysParam){
  try{
    assertUser(user);
    const days = Math.min(Math.max(parseInt(daysParam, 10) || 60, 1), 365);
    const ics = buildIcs(user, days);
    return ContentService.createTextOutput(ics).setMimeType(ContentService.MimeType.ICAL);
  }catch(err){
    return ContentService.createTextOutput('Error generating calendar feed: ' + (err.message || err))
      .setMimeType(ContentService.MimeType.PLAIN_TEXT);
  }
}

const ICS_TYPE_LABELS = {
  session:'Session', test:'Test', individual_assignment:'Individual assignment',
  individual_project:'Individual project', group_assignment:'Group assignment',
  group_project:'Group project', exam:'Term-end exam', extracurricular:'Extra-curricular', other:'Other',
};

function buildIcs(user, days){
  const events = readAll(user, 'Events');
  const courses = readAll(user, 'Courses');
  const courseMap = {};
  courses.forEach(c => { courseMap[c.id] = c; });

  // Plain string date comparison (YYYY-MM-DD sorts correctly as text) —
  // deliberately avoids building Date objects from these strings at all,
  // same reasoning as readAll()'s date handling: no timezone conversion
  // means nothing to get wrong.
  const today = new Date();
  const startBound = Utilities.formatDate(new Date(today.getTime() - 7*86400000), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const endBound = Utilities.formatDate(new Date(today.getTime() + days*86400000), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Trimester Organiser//' + user + '//EN',
    'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Trimester (' + user + ')',
    'REFRESH-INTERVAL;VALUE=DURATION:PT30M', 'X-PUBLISHED-TTL:PT30M',
  ];

  events.forEach(ev => {
    if(ev.status === 'cancelled' || !ev.date) return;
    if(ev.date < startBound || ev.date > endBound) return;

    const course = ev.courseId ? courseMap[ev.courseId] : null;
    const label = ICS_TYPE_LABELS[ev.type] || 'Other';
    const title = ev.title ? (course ? `${ev.title} — ${course.name}` : ev.title) : (course ? course.name : label);

    lines.push('BEGIN:VEVENT');
    lines.push('UID:' + ev.id + '@trimester-organiser');
    lines.push('DTSTAMP:' + Utilities.formatDate(new Date(), 'Etc/UTC', "yyyyMMdd'T'HHmmss'Z'"));
    if(ev.startTime){
      // Floating local time (no Z, no TZID) on purpose: these are wall-clock
      // class times, meant to show at that same clock time regardless of
      // which timezone the phone or this script happens to be in.
      lines.push('DTSTART:' + icsLocal(ev.date, ev.startTime));
      lines.push('DTEND:' + icsLocal(ev.date, ev.endTime || ev.startTime));
    } else {
      lines.push('DTSTART;VALUE=DATE:' + ev.date.replace(/-/g, ''));
    }
    lines.push('SUMMARY:' + icsEscape(title));
    if(ev.room) lines.push('LOCATION:' + icsEscape(ev.room));
    if(ev.description) lines.push('DESCRIPTION:' + icsEscape(ev.description));
    lines.push('END:VEVENT');
  });

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function icsLocal(dateStr, timeStr){
  return dateStr.replace(/-/g, '') + 'T' + (timeStr || '00:00').replace(':', '') + '00';
}
function icsEscape(s){
  return String(s || '').replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
}
