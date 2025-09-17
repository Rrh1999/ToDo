require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
let Database = null;
try { Database = require('better-sqlite3'); } catch (_) { /* optional until installed */ }
const app = express();
const PORT = process.env.PORT || 3000;
// Optional override for where JSON data files are stored; defaults to project root
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : __dirname;
if (!fs.existsSync(DATA_DIR)) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { console.error('Failed to create DATA_DIR', e); }
}
// Backups directory for data snapshots
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
if (!fs.existsSync(BACKUP_DIR)) {
  try { fs.mkdirSync(BACKUP_DIR, { recursive: true }); } catch (e) { console.error('Failed to create BACKUP_DIR', e); }
}
// Allow larger JSON payloads so big finance datasets (including pots) persist
app.use(express.json({ limit: '5mb' }));
app.use(express.static(__dirname));
app.get('/shopping', (req, res) => res.sendFile(path.join(__dirname, 'shopping.html')));
app.get('/today', (req, res) => res.sendFile(path.join(__dirname, 'today.html')));
app.get('/gardening', (req, res) => res.sendFile(path.join(__dirname, 'gardening.html')));
app.get('/diy', (req, res) => res.sendFile(path.join(__dirname, 'diy.html')));
app.get('/work', (req, res) => res.sendFile(path.join(__dirname, 'work.html')));
// NEW: temporary test page route for Work (KEEP when merge happens)
app.get('/work-test', (req, res) => res.sendFile(path.join(__dirname, 'work-test.html')));
app.get('/finance', (req, res) => res.sendFile(path.join(__dirname, 'finance.html')));
app.get('/notification', (req, res) => res.sendFile(path.join(__dirname, 'notification.html')));

// --- Local SQLite DB (optional) for Today linking ---
let db = null;
function initSqlite() {
  if (!Database) return; // dependency not installed yet
  const dbPath = path.join(DATA_DIR, 'todo.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS today (
    id INTEGER PRIMARY KEY,
    source TEXT NOT NULL,
    sourceId TEXT NOT NULL,
    name TEXT NOT NULL,
    addedAt TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0
  );`);
}
initSqlite();

// web push for notifications
const webPush = require("web-push");
require("dotenv").config(); // if you're using .env

webPush.setVapidDetails(
  "mailto:your@email.com",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

app.get("/vapidPublicKey", (req, res) => {
  res.send(process.env.VAPID_PUBLIC_KEY);
});

// Store push subscriptions in a file for persistence
const SUBSCRIPTIONS_FILE = path.join(DATA_DIR, 'pushSubscriptions.json');

function loadSubscriptions() {
  try {
    if (fs.existsSync(SUBSCRIPTIONS_FILE)) {
      return JSON.parse(fs.readFileSync(SUBSCRIPTIONS_FILE, 'utf8'));
    }
  } catch (error) {
    console.error('Error loading subscriptions:', error);
  }
  return [];
}

function saveSubscriptions(subscriptions) {
  try {
    fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(subscriptions, null, 2));
    console.log(`Saved ${subscriptions.length} push subscriptions to file`);
  } catch (error) {
    console.error('Error saving subscriptions:', error);
  }
}

// Load subscriptions on server start
let pushSubscriptions = loadSubscriptions();

// Improved subscribe endpoint that handles duplicates better
app.post("/subscribe", express.json(), (req, res) => {
  const subscription = req.body;
  const endpoint = subscription.endpoint;
  
  console.log("Subscription request from:", endpoint);
  
  // Remove any existing subscription with the same endpoint
  const existingIndex = pushSubscriptions.findIndex(sub => sub.endpoint === endpoint);
  if (existingIndex !== -1) {
    console.log("Replacing existing subscription for endpoint:", endpoint);
    pushSubscriptions.splice(existingIndex, 1);
  }
  
  // Add the new subscription
  pushSubscriptions.push({
    ...subscription,
    subscribedAt: new Date().toISOString(),
    userAgent: req.headers['user-agent'] || 'Unknown',
    ip: req.ip || req.connection.remoteAddress || 'Unknown'
  });
  
  // Save to file for persistence
  saveSubscriptions(pushSubscriptions);
  
  console.log(`Total subscriptions: ${pushSubscriptions.length}`);
  res.status(201).json({ 
    message: "Subscription saved",
    total: pushSubscriptions.length
  });
});

// Add an unsubscribe endpoint
app.post("/unsubscribe", express.json(), (req, res) => {
  const { endpoint } = req.body;
  
  if (!endpoint) {
    return res.status(400).json({ error: "Endpoint required" });
  }
  
  const initialCount = pushSubscriptions.length;
  pushSubscriptions = pushSubscriptions.filter(sub => sub.endpoint !== endpoint);
  const removedCount = initialCount - pushSubscriptions.length;
  
  if (removedCount > 0) {
    saveSubscriptions(pushSubscriptions);
    console.log(`Unsubscribed ${removedCount} subscription(s) for endpoint:`, endpoint);
    res.json({ 
      message: `Unsubscribed ${removedCount} subscription(s)`,
      total: pushSubscriptions.length
    });
  } else {
    res.status(404).json({ error: "Subscription not found" });
  }
});

// Enhanced send-push endpoint with better error handling
app.post("/send-push", express.json(), (req, res) => {
  const { title = "ToDo Notification", body = "Test push notification", data = {} } = req.body;
  
  if (pushSubscriptions.length === 0) {
    return res.json({ message: "No subscribers to send to", total: 0 });
  }
  
  const payload = JSON.stringify({
    title,
    body,
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    data,
    actions: [
      { action: 'yes', title: 'Yes' },
      { action: 'no', title: 'No' }
    ]
  });

  const promises = pushSubscriptions.map(subscription => {
    return webPush.sendNotification(subscription, payload)
      .catch(error => {
        console.error(`Push send failed for ${subscription.endpoint}:`, error.message);
        
        // Remove invalid subscriptions (expired, unsubscribed, etc.)
        if (error.statusCode === 410 || error.statusCode === 404) {
          console.log(`Removing invalid subscription: ${subscription.endpoint}`);
          return 'remove';
        }
        return 'error';
      });
  });

  Promise.all(promises)
    .then(results => {
      // Remove invalid subscriptions
      const invalidCount = results.filter(r => r === 'remove').length;
      if (invalidCount > 0) {
        pushSubscriptions = pushSubscriptions.filter((sub, index) => results[index] !== 'remove');
        saveSubscriptions(pushSubscriptions);
        console.log(`Removed ${invalidCount} invalid subscription(s)`);
      }
      
      const successCount = pushSubscriptions.length;
      res.json({ 
        message: `Push sent to ${successCount} subscribers`,
        total: successCount,
        removed: invalidCount
      });
    })
    .catch(error => {
      console.error('Push send error:', error);
      res.status(500).json({ error: error.message });
    });
});

// Enhanced subscriber info endpoint
app.get("/subscribers", (req, res) => {
  const subscribers = pushSubscriptions.map(sub => ({
    endpoint: sub.endpoint.substring(0, 50) + '...',
    subscribedAt: sub.subscribedAt,
    userAgent: sub.userAgent ? sub.userAgent.substring(0, 100) : 'Unknown',
    ip: sub.ip
  }));
  
  res.json({ 
    count: pushSubscriptions.length,
    subscribers: subscribers
  });
});

// index page data
let indexData = {
  projects: [],
  weeklyTasks: [],
  oneOffTasks: [],
  recurringTasks: [],
  stretchTasks: [],
  bigTasks: [],
  deletedTasks: [],
  shoppingList: [],
  longTermList: [],
  generalList: [],
  todayList: [],
  todayQuickHistory: [],
  nextId: 1
};

// today page data (separate file)
let todayData = {
  adHoc: [], // { id, text, createdAt, completedAt|null }
  linked: [], // { id, source: { page, type, id }, name, addedAt }
  nextAdHocId: 1,
  nextLinkedId: 1
};

// work page data
let workData = {
  workProjects: [],
  workTasks: [],
  workNextId: 1,
  maxSubDepth: 7,
  calendarEvents: [],
  calendarNextId: 1,
  meetings: [],
  meetingNextId: 1
};

// diy page data
let diyData = {
  diyProjects: [],
  diyTypes: [],
  diyTasks: [],
  diyBigTasks: [],
  diyShoppingList: [],
  diyNextId: 1,
  maxSubDepth: 7,
  calendarEvents: [],
  calendarNextId: 1
};

// finance page data
let financeData = {
  accounts: [],
  transactions: [],
  nextTransactionId: 1,
  budgetCategories: [],
  budgets: [],
  nextBudgetId: 1,
  rules: [],
  budgetPeriods: [],
  startBalances: { date:'', accounts:{} },
  pots: [],
  nextPotId: 1
};

// gardening page data
let gardeningData = {
  settings: { locations: [], nextLocationId: 1, plantTypes: [], nextPlantTypeId: 1 },
  plants: [],
  nextPlantId: 1,
  garden: [],
  futurePlans: []
};

const INDEX_FILE = path.join(DATA_DIR, 'indexData.json');
const TODAY_FILE = path.join(DATA_DIR, 'todayData.json');
const WORK_FILE = path.join(DATA_DIR, 'workData.json');
const DIY_FILE = path.join(DATA_DIR, 'diyData.json');
const FINANCE_FILE = path.join(DATA_DIR, 'financeData.json');
const GARDENING_FILE = path.join(DATA_DIR, 'gardeningData.json');
const PARENTING_FILE = path.join(DATA_DIR, 'parentingData.json');
const FAMILY_FRIENDS_FILE = path.join(DATA_DIR, 'familyFriendsData.json');
const SOUL_FILE = path.join(DATA_DIR, 'soulData.json');
const RELATIONSHIPS_FILE = path.join(DATA_DIR, 'relationshipsData.json');
const TIME_TRACKER_FILE = path.join(DATA_DIR, 'timeTrackerData.json');
const NOTIF_FILE = path.join(DATA_DIR, 'notificationData.json');
const HEALTH_FILE = path.join(DATA_DIR, 'healthData.json');

function loadJson(file, def) {
  if (fs.existsSync(file)) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      console.error('Failed to read', file, err);
    }
  } else {
    fs.writeFileSync(file, JSON.stringify(def, null, 2));
  }
  return def;
}

function initDb() {
  indexData = loadJson(INDEX_FILE, indexData);
  todayData = loadJson(TODAY_FILE, todayData);
  workData = loadJson(WORK_FILE, workData);
  diyData = loadJson(DIY_FILE, diyData);
  financeData = loadJson(FINANCE_FILE, financeData);
  gardeningData = loadJson(GARDENING_FILE, gardeningData);
  parentingData = loadJson(PARENTING_FILE, parentingData);
  familyFriendsData = loadJson(FAMILY_FRIENDS_FILE, familyFriendsData);
  soulData = loadJson(SOUL_FILE, soulData);
  relationshipsData = loadJson(RELATIONSHIPS_FILE, relationshipsData);
  timeTrackerData = loadJson(TIME_TRACKER_FILE, timeTrackerData);
  notificationStats = loadJson(NOTIF_FILE, notificationStats);
  healthData = loadJson(HEALTH_FILE, healthData);
  // defensive defaults
  gardeningData.settings = gardeningData.settings || { locations: [], nextLocationId: 1, plantTypes: [], nextPlantTypeId: 1 };
  gardeningData.settings.locations = gardeningData.settings.locations || [];
  gardeningData.settings.nextLocationId = gardeningData.settings.nextLocationId || 1;
  gardeningData.settings.plantTypes = gardeningData.settings.plantTypes || [];
  gardeningData.settings.nextPlantTypeId = gardeningData.settings.nextPlantTypeId || 1;
  gardeningData.plants = gardeningData.plants || [];
  gardeningData.nextPlantId = gardeningData.nextPlantId || 1;
  soulData.meditations = soulData.meditations || [];
  soulData.nextMeditationId = soulData.nextMeditationId || 1;
  soulData.journalTypes = soulData.journalTypes || [];
  soulData.nextJournalTypeId = soulData.nextJournalTypeId || 1;
    soulData.journals = (soulData.journals || []).map(j=>({ ...j, media: j.media || [] }));
  soulData.nextJournalId = soulData.nextJournalId || 1;
  soulData.mottos = soulData.mottos || [];
  soulData.nextMottoId = soulData.nextMottoId || 1;
  soulData.gutFeelings = soulData.gutFeelings || [];
  soulData.nextGutFeelingId = soulData.nextGutFeelingId || 1;
  financeData.pots = financeData.pots || [];
  financeData.nextPotId = financeData.nextPotId || 1;
  todayData.adHoc = todayData.adHoc || [];
  todayData.linked = todayData.linked || [];
  todayData.nextAdHocId = todayData.nextAdHocId || 1;
  todayData.nextLinkedId = todayData.nextLinkedId || 1;
}

app.get('/api/index-data', (req, res) => {
  res.json(indexData);
});

app.post('/api/index-data', (req, res) => {
  // Merge incoming changes with existing data to avoid dropping keys not sent by some pages
  const incoming = req.body || {};

  // Defensive defaults for critical arrays
  const defaultArrays = {
    projects: [], weeklyTasks: [], oneOffTasks: [], recurringTasks: [],
    stretchTasks: [], bigTasks: [], deletedTasks: [], shoppingList: [],
    longTermList: [], generalList: [], todayList: [], todayQuickHistory: []
  };

  // Start with current indexData, then apply incoming fields (shallow merge)
  indexData = { ...defaultArrays, ...indexData, ...incoming };

  // Create a timestamped backup before writing
  try {
    if (fs.existsSync(INDEX_FILE)) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(BACKUP_DIR, `indexData-${ts}.json`);
      fs.copyFileSync(INDEX_FILE, backupPath);

      // Retain only the latest 20 backups
      const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('indexData-') && f.endsWith('.json'))
        .sort();
      if (files.length > 20) {
        const toDelete = files.slice(0, files.length - 20);
        toDelete.forEach(f => {
          try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch {}
        });
      }
    }
  } catch (e) {
    console.error('Failed to create backup for indexData.json', e);
  }

  // Persist merged data
  fs.writeFileSync(INDEX_FILE, JSON.stringify(indexData, null, 2));
  res.json({ status: 'ok' });
});

// Optional: list available indexData backups
app.get('/api/index-backups', (req, res) => {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('indexData-') && f.endsWith('.json'))
      .sort()
      .reverse();
    res.json({ backups: files });
  } catch (e) {
    res.status(500).json({ error: 'Failed to list backups' });
  }
});

// Optional: restore a specific backup by filename
app.post('/api/restore-index-backup', (req, res) => {
  try {
    const { filename } = req.body || {};
    if (!filename || filename.includes('..')) return res.status(400).json({ error: 'Invalid filename' });
    const src = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(src)) return res.status(404).json({ error: 'Backup not found' });
    const content = fs.readFileSync(src, 'utf8');
    indexData = JSON.parse(content);
    fs.writeFileSync(INDEX_FILE, JSON.stringify(indexData, null, 2));
    res.json({ status: 'ok', restored: filename });
  } catch (e) {
    console.error('Failed to restore backup', e);
    res.status(500).json({ error: 'Failed to restore backup' });
  }
});

app.get('/api/work-data', (req, res) => {
  res.json(workData);
});

app.post('/api/work-data', (req, res) => {
  const oldWorkData = { ...workData };
  workData = req.body;
  
  // Check for completion changes and propagate to Today
  detectAndPropagateCompletionChanges('work', oldWorkData.workTasks || [], workData.workTasks || []);
  
  fs.writeFileSync(WORK_FILE, JSON.stringify(workData, null, 2));
  res.json({ status: 'ok' });
});

// Work task completion endpoint with Today propagation
app.post('/api/work/complete-task', (req, res) => {
  const { taskId, completed } = req.body;
  if (!taskId) return res.status(400).json({ error: 'taskId required' });
  
  const success = updateWorkTaskCompletion(String(taskId), !!completed);
  res.json({ success, propagated: success });
});


app.get('/api/diy-data', (req, res) => {
  res.json(diyData);
});

app.post('/api/diy-data', (req, res) => {
  const oldDiyData = { ...diyData };
  diyData = req.body;
  
  // Check for completion changes and propagate to Today
  detectAndPropagateCompletionChanges('diy', oldDiyData.diyTasks || [], diyData.diyTasks || []);
  
  fs.writeFileSync(DIY_FILE, JSON.stringify(diyData, null, 2));
  res.json({ status: 'ok' });
});

// DIY task completion endpoint with Today propagation
app.post('/api/diy/complete-task', (req, res) => {
  const { taskId, completed } = req.body;
  if (!taskId) return res.status(400).json({ error: 'taskId required' });
  
  const success = updateDiyTaskCompletion(String(taskId), !!completed);
  res.json({ success, propagated: success });
});

app.get('/api/finance-data', (req, res) => {
  res.json(financeData);
});

app.post('/api/finance-data', (req, res) => {
  financeData = req.body;
  fs.writeFileSync(FINANCE_FILE, JSON.stringify(financeData, null, 2));
  res.json({ status: 'ok' });
});

// gardening endpoints
app.get('/api/gardening-data', (req, res) => {
  res.json(gardeningData);
});

app.post('/api/gardening-data', (req, res) => {
  gardeningData = req.body || gardeningData;
  // ensure structure
  gardeningData.settings = gardeningData.settings || { locations: [], nextLocationId: 1, plantTypes: [], nextPlantTypeId: 1 };
  gardeningData.settings.locations = gardeningData.settings.locations || [];
  gardeningData.settings.nextLocationId = gardeningData.settings.nextLocationId || 1;
  gardeningData.settings.plantTypes = gardeningData.settings.plantTypes || [];
  gardeningData.settings.nextPlantTypeId = gardeningData.settings.nextPlantTypeId || 1;
  gardeningData.plants = gardeningData.plants || [];
  gardeningData.nextPlantId = gardeningData.nextPlantId || 1;
  fs.writeFileSync(GARDENING_FILE, JSON.stringify(gardeningData, null, 2));
  res.json({ status: 'ok' });
});
// Manual backup endpoint
app.post('/save-backup', (req, res) => {
  try {
    const { filename, data } = req.body;
    
    if (!filename || !data) {
      return res.status(400).json({ error: 'Missing filename or data' });
    }
    
    // Ensure filename is safe (no path traversal)
    const safeFilename = path.basename(filename);
    const backupPath = path.join(BACKUP_DIR, safeFilename);
    
    // Write backup file
    fs.writeFileSync(backupPath, JSON.stringify(data, null, 2));
    
    console.log(`Manual backup created: ${backupPath}`);
    res.json({ 
      status: 'ok', 
      message: 'Backup created successfully',
      filename: safeFilename 
    });
    
  } catch (error) {
    console.error('Error creating backup:', error);
    res.status(500).json({ error: 'Failed to create backup' });
  }
});

// parenting page data
let parentingData = {
  skills: [],
  activities: [],
  nextSkillId: 1,
  nextActivityId: 1
};

// family-friends merged data (combines parenting + relationships)
let familyFriendsData = {
  skills: [],
  activities: [],
  nextSkillId: 1,
  nextActivityId: 1,
  people: [],
  entries: [],
  nextEntryId: 1,
  birthdays: [], // { id, name, date (YYYY-MM-DD), notes }
  nextBirthdayId: 1
};

// health tracker data
let healthData = {
  periodCycles: [], // { id, startDate, estEndDate, endDate|null, daily: [{date,intensity:0-3,symptoms:[]}] }
  nextPeriodId: 1,
  healthTypes: [], // ["Headache", "Cold", ...]
  healthNotes: [], // { id, type, startDate, startTime?, hasDuration, endDate, endTime?, intensity, notes }
  nextHealthNoteId: 1
};

app.get('/api/parenting-data', (req, res) => {
  res.json(parentingData);
});

app.post('/api/parenting-data', (req, res) => {
  parentingData = req.body;
  fs.writeFileSync(PARENTING_FILE, JSON.stringify(parentingData, null, 2));
  res.json({ status: 'ok' });
});

// Parenting task completion endpoint with Today propagation
app.post('/api/parenting/complete-task', (req, res) => {
  const { taskId, completed } = req.body;
  if (!taskId) return res.status(400).json({ error: 'taskId required' });
  
  const success = updateParentingTaskCompletion(String(taskId), !!completed);
  res.json({ success, propagated: success });
});

// soul page data
let soulData = {
  meditations: [],
  nextMeditationId: 1,
  journalTypes: [],
  nextJournalTypeId: 1,
  journals: [], // each {id,title,date,type,text,media:[]}
  nextJournalId: 1,
  mottos: [],
  nextMottoId: 1,
  gutFeelings: [],
  nextGutFeelingId: 1
};

// relationships page data
let relationshipsData = {
  people: [],
  entries: [],
  nextEntryId: 1
};

// time tracker data
let timeTrackerData = {
  tasks: [],
  nextId: 1,
  activities: [],
  nextActivityId: 1
};

// notification stats data
let notificationStats = { yes: 0, no: 0, events: [] };

app.get('/api/soul-data', (req, res) => {
  res.json(soulData);
});

app.post('/api/soul-data', (req, res) => {
  soulData = req.body;
  soulData.journals = (soulData.journals || []).map(j=>({ ...j, media: j.media || [] }));
  fs.writeFileSync(SOUL_FILE, JSON.stringify(soulData, null, 2));
  res.json({ status: 'ok' });
});

app.post('/api/add-review-task', (req, res) => {
  try {
    const { name, project, dueDate, taskType } = req.body;
    
    if (!name || !dueDate) {
      return res.status(400).json({ error: 'Name and dueDate are required' });
    }
    
    const task = {
      id: nextId++,
      name,
      project: project || 'Personal',
      dueDate,
      taskType: taskType || 'One-off',
      status: 'open',
      completedDates: [],
      createdDate: new Date().toISOString().slice(0, 10)
    };
    
    oneOffTasks.push(task);
    saveData();
    
    res.json({ status: 'ok', taskId: task.id });
  } catch (error) {
    console.error('Error adding review task:', error);
    res.status(500).json({ error: 'Failed to add review task' });
  }
});

app.get('/api/relationships-data', (req, res) => {
  res.json(relationshipsData);
});

app.post('/api/relationships-data', (req, res) => {
  relationshipsData = req.body;
  fs.writeFileSync(RELATIONSHIPS_FILE, JSON.stringify(relationshipsData, null, 2));
  res.json({ status: 'ok' });
});

// family-friends merged data endpoints
app.get('/api/family-friends-data', (req, res) => {
  res.json(familyFriendsData);
});

app.post('/api/family-friends-data', (req, res) => {
  familyFriendsData = req.body;
  fs.writeFileSync(FAMILY_FRIENDS_FILE, JSON.stringify(familyFriendsData, null, 2));
  res.json({ status: 'ok' });
});

// Family-Friends task completion endpoint with Today propagation
app.post('/api/family-friends/complete-task', (req, res) => {
  const { taskId, completed } = req.body;
  if (!taskId) return res.status(400).json({ error: 'taskId required' });
  
  const success = updateFamilyFriendsTaskCompletion(String(taskId), !!completed);
  res.json({ success, propagated: success });
});

// time tracker endpoints
app.get('/api/time-tracker', (req, res) => {
  // ensure defaults
  if (!Array.isArray(timeTrackerData.tasks)) timeTrackerData.tasks = [];
  if (!Number.isFinite(timeTrackerData.nextId)) timeTrackerData.nextId = 1;
  if (!Array.isArray(timeTrackerData.activities)) timeTrackerData.activities = [];
  if (!Number.isFinite(timeTrackerData.nextActivityId)) timeTrackerData.nextActivityId = 1;
  res.json(timeTrackerData);
});

app.post('/api/time-tracker/start', (req, res) => {
  const { name, source } = req.body || {};
  const now = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/London' }).replace(' ', 'T');
  const task = { id: timeTrackerData.nextId++, name, source, start: now, end: null };
  timeTrackerData.tasks.push(task);
  fs.writeFileSync(TIME_TRACKER_FILE, JSON.stringify(timeTrackerData, null, 2));
  res.json(task);
});

app.post('/api/time-tracker/stop', (req, res) => {
  const { id } = req.body || {};
  const task = timeTrackerData.tasks.find(t => t.id === id && !t.end);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  task.end = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/London' }).replace(' ', 'T');
  fs.writeFileSync(TIME_TRACKER_FILE, JSON.stringify(timeTrackerData, null, 2));
  res.json(task);
});

// Add a manual time entry (from-to or duration)
app.post('/api/time-tracker/add-manual', (req, res) => {
  try {
    const {
      name, source,
      start, end,
      startDate, startTime,
      endDate, endTime,
      durationMinutes,
      activityType, // 'linked' | 'reusable' | 'oneoff'
      link, // optional metadata for linked tasks { page, id, project, type }
      reusableActivityId,
    } = req.body || {};

    if (!name || !source) return res.status(400).json({ error: 'name and source required' });

    // Helper to make "sv-SE" timestamp in Europe/London TZ
    const tzStamp = (d) => new Date(d).toLocaleString('sv-SE', { timeZone: 'Europe/London' }).replace(' ', 'T');

    let startIso = start;
    let endIso = end;

    // If no direct ISO provided, compute from date/time/duration
    if (!startIso || !endIso) {
      // Build from date/time pieces if present
      if (startDate && startTime) {
        startIso = `${startDate}T${startTime}`;
      } else if (startDate && !startTime) {
        startIso = `${startDate}T00:00:00`;
      }
      if (endDate && endTime) {
        endIso = `${endDate}T${endTime}`;
      } else if (endDate && !endTime) {
        endIso = `${endDate}T23:59:59`;
      }

      // If still missing, use duration to derive one side
      const dur = Number(durationMinutes);
      if ((!startIso || !endIso) && Number.isFinite(dur) && dur > 0) {
        if (!endIso && startIso) {
          endIso = new Date(new Date(startIso).getTime() + dur * 60000).toISOString();
        } else if (!startIso && endIso) {
          startIso = new Date(new Date(endIso).getTime() - dur * 60000).toISOString();
        } else if (!startIso && !endIso) {
          // default end now
          const now = new Date();
          endIso = now.toISOString();
          startIso = new Date(now.getTime() - dur * 60000).toISOString();
        }
      }
    }

    if (!startIso || !endIso) return res.status(400).json({ error: 'start/end or duration required' });

    const task = {
      id: timeTrackerData.nextId++,
      name,
      source,
      start: tzStamp(startIso),
      end: tzStamp(endIso),
    };
    if (activityType) task.activityType = activityType;
    if (link && typeof link === 'object') task.link = link;
    if (Number.isFinite(reusableActivityId)) task.reusableActivityId = reusableActivityId;

    if (!Array.isArray(timeTrackerData.tasks)) timeTrackerData.tasks = [];
    timeTrackerData.tasks.push(task);
    if (!Array.isArray(timeTrackerData.activities)) timeTrackerData.activities = [];
    if (!Number.isFinite(timeTrackerData.nextActivityId)) timeTrackerData.nextActivityId = 1;
    fs.writeFileSync(TIME_TRACKER_FILE, JSON.stringify(timeTrackerData, null, 2));
    res.json(task);
  } catch (e) {
    console.error('add-manual failed', e);
    res.status(500).json({ error: 'failed to add manual entry' });
  }
});

// Update an existing tracked task (edit log)
app.post('/api/time-tracker/update', (req, res) => {
  try{
    const { id, name, source, start, end, link, activityType, reusableActivityId } = req.body || {};
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'id required' });
    const t = timeTrackerData.tasks.find(x => x.id === id);
    if (!t) return res.status(404).json({ error: 'Task not found' });
    if (name !== undefined) t.name = name;
    if (source !== undefined) t.source = source;
    if (start) t.start = new Date(start).toLocaleString('sv-SE', { timeZone: 'Europe/London' }).replace(' ', 'T');
    if (end) t.end = new Date(end).toLocaleString('sv-SE', { timeZone: 'Europe/London' }).replace(' ', 'T');
    if (activityType !== undefined) t.activityType = activityType;
    if (link !== undefined) t.link = link;
    if (reusableActivityId !== undefined) t.reusableActivityId = reusableActivityId;
    fs.writeFileSync(TIME_TRACKER_FILE, JSON.stringify(timeTrackerData, null, 2));
    res.json(t);
  }catch(e){
    console.error('update time tracker failed', e);
    res.status(500).json({ error: 'failed to update task' });
  }
});

// Delete a tracked task
app.post('/api/time-tracker/delete', (req, res) => {
  try{
    const { id } = req.body || {};
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'id required' });
    const before = timeTrackerData.tasks.length;
    timeTrackerData.tasks = timeTrackerData.tasks.filter(t => t.id !== id);
    const removed = before - timeTrackerData.tasks.length;
    fs.writeFileSync(TIME_TRACKER_FILE, JSON.stringify(timeTrackerData, null, 2));
    res.json({ success: true, removed });
  }catch(e){
    console.error('delete time tracker failed', e);
    res.status(500).json({ error: 'failed to delete task' });
  }
});

// Reusable activities
app.get('/api/time-tracker/activities', (req, res) => {
  if (!Array.isArray(timeTrackerData.activities)) timeTrackerData.activities = [];
  if (!Number.isFinite(timeTrackerData.nextActivityId)) timeTrackerData.nextActivityId = 1;
  res.json({ activities: timeTrackerData.activities, nextActivityId: timeTrackerData.nextActivityId });
});

app.post('/api/time-tracker/activities', (req, res) => {
  try{
    const { name, source } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name required' });
    const act = { id: timeTrackerData.nextActivityId++, name, source: source || 'custom' };
    if (!Array.isArray(timeTrackerData.activities)) timeTrackerData.activities = [];
    timeTrackerData.activities.push(act);
    fs.writeFileSync(TIME_TRACKER_FILE, JSON.stringify(timeTrackerData, null, 2));
    res.json(act);
  }catch(e){
    console.error('add activity failed', e);
    res.status(500).json({ error: 'failed to add activity' });
  }
});

app.delete('/api/time-tracker/activities/:id', (req, res) => {
  try{
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
    const before = (timeTrackerData.activities || []).length;
    timeTrackerData.activities = (timeTrackerData.activities || []).filter(a => a.id !== id);
    fs.writeFileSync(TIME_TRACKER_FILE, JSON.stringify(timeTrackerData, null, 2));
    res.json({ success: true, removed: before - timeTrackerData.activities.length });
  }catch(e){
    console.error('delete activity failed', e);
    res.status(500).json({ error: 'failed to delete activity' });
  }
});

// Notification stats endpoints
app.get('/api/notification-stats', (req, res) => {
  const { yes = 0, no = 0 } = notificationStats || {};
  res.json({ yes, no });
});

app.post('/api/notification-event', (req, res) => {
  try {
    const { action, id, tag, ts } = req.body || {};
    if (action !== 'yes' && action !== 'no') return res.status(400).json({ error: 'invalid action' });
    if (!notificationStats || typeof notificationStats !== 'object') notificationStats = { yes: 0, no: 0, events: [] };
    notificationStats[action] = (notificationStats[action] || 0) + 1;
  const evt = { action, id, tag, ts: ts || new Date().toISOString() };
  if (!Array.isArray(notificationStats.events)) notificationStats.events = [];
    notificationStats.events.push(evt);
    if (notificationStats.events.length > 100) notificationStats.events = notificationStats.events.slice(-100);
    fs.writeFileSync(NOTIF_FILE, JSON.stringify(notificationStats, null, 2));
    res.json({ status: 'ok', counts: { yes: notificationStats.yes || 0, no: notificationStats.no || 0 } });
  } catch (e) {
    res.status(500).json({ error: 'failed to record event' });
  }
});

// Experience Tracker endpoints
app.get('/api/experiences', (req, res) => {
  const EXPERIENCE_FILE = path.join(DATA_DIR, 'experienceData.json');
  try {
    const experienceData = loadJson(EXPERIENCE_FILE, { experiences: [], responses: [], nextExperienceId: 1, nextResponseId: 1 });
    res.json(experienceData);
  } catch (error) {
    console.error('Error loading experiences:', error);
    res.status(500).json({ error: 'Failed to load experiences' });
  }
});

app.post('/api/experiences', (req, res) => {
  const EXPERIENCE_FILE = path.join(DATA_DIR, 'experienceData.json');
  try {
    const experienceData = loadJson(EXPERIENCE_FILE, { experiences: [], responses: [], nextExperienceId: 1, nextResponseId: 1 });
    const newExperience = req.body;
    newExperience.id = experienceData.nextExperienceId++;
    newExperience.createdAt = new Date().toISOString();
    experienceData.experiences.push(newExperience);
    
    fs.writeFileSync(EXPERIENCE_FILE, JSON.stringify(experienceData, null, 2));
    res.json(newExperience);
  } catch (error) {
    console.error('Error saving experience:', error);
    res.status(500).json({ error: 'Failed to save experience' });
  }
});

app.put('/api/experiences/:id', (req, res) => {
  const EXPERIENCE_FILE = path.join(DATA_DIR, 'experienceData.json');
  try {
    const experienceData = loadJson(EXPERIENCE_FILE, { experiences: [], responses: [], nextExperienceId: 1, nextResponseId: 1 });
    const experienceId = parseInt(req.params.id);
    const updatedExperience = req.body;
    
    const index = experienceData.experiences.findIndex(exp => exp.id === experienceId);
    if (index === -1) {
      return res.status(404).json({ error: 'Experience not found' });
    }
    
    experienceData.experiences[index] = { ...experienceData.experiences[index], ...updatedExperience };
    fs.writeFileSync(EXPERIENCE_FILE, JSON.stringify(experienceData, null, 2));
    res.json(experienceData.experiences[index]);
  } catch (error) {
    console.error('Error updating experience:', error);
    res.status(500).json({ error: 'Failed to update experience' });
  }
});

app.delete('/api/experiences/:id', (req, res) => {
  const EXPERIENCE_FILE = path.join(DATA_DIR, 'experienceData.json');
  try {
    const experienceData = loadJson(EXPERIENCE_FILE, { experiences: [], responses: [], nextExperienceId: 1, nextResponseId: 1 });
    const experienceId = parseInt(req.params.id);
    
    experienceData.experiences = experienceData.experiences.filter(exp => exp.id !== experienceId);
    fs.writeFileSync(EXPERIENCE_FILE, JSON.stringify(experienceData, null, 2));
    res.json({ status: 'ok' });
  } catch (error) {
    console.error('Error deleting experience:', error);
    res.status(500).json({ error: 'Failed to delete experience' });
  }
});

// NOTE: The experience-responses handler below (in the Experience Tracker section)
// manages scheduling logic. The earlier, simpler handler was removed to avoid
// conflicting duplicate routes.

app.post('/api/add-to-today', (req, res) => {
  const { taskType, taskId, taskName } = req.body || {};
  
  // Check if task already exists in today list
  const existingTask = todayData.linked.find(item => 
    item.source.page === String(taskType) && 
    item.source.id === String(taskId)
  );
  
  if (existingTask) {
    return res.json({ 
      status: 'already_exists', 
      message: 'Task is already on today list',
      item: existingTask 
    });
  }
  
  const addedAt = new Date().toISOString();
  // Primary storage: todayData.json (linked task)
  const linkedItem = {
    id: todayData.nextLinkedId++,
    source: { page: String(taskType), type: 'task', id: String(taskId) },
    name: String(taskName || ''),
    addedAt,
    completedAt: null
  };
  todayData.linked.push(linkedItem);
  fs.writeFileSync(TODAY_FILE, JSON.stringify(todayData, null, 2));

  // Mirror minimal info to indexData.todayList for existing UI pieces
  indexData.todayList = indexData.todayList || [];
  indexData.todayList.push({ id: linkedItem.id, type: taskType, originalId: String(taskId), name: linkedItem.name, completed: false, addedAt });
  fs.writeFileSync(INDEX_FILE, JSON.stringify(indexData, null, 2));

  res.json({ status: 'ok', item: linkedItem });
});

// Add ad-hoc Today item
app.post('/api/today/adhoc', (req, res) => {
  const { text } = req.body || {};
  if (!text || !String(text).trim()) return res.status(400).json({ error: 'text required' });
  const item = { id: todayData.nextAdHocId++, text: String(text).trim(), createdAt: new Date().toISOString(), completedAt: null };
  todayData.adHoc.push(item);
  fs.writeFileSync(TODAY_FILE, JSON.stringify(todayData, null, 2));
  res.json({ success: true, item });
});

// Reorder linked Today items by array of ids
app.post('/api/today/reorder', (req, res) => {
  const { linkedOrder } = req.body || {};
  if (!Array.isArray(linkedOrder)) return res.status(400).json({ error: 'linkedOrder must be an array' });
  const map = new Map(todayData.linked.map(i => [Number(i.id), i]));
  const ordered = linkedOrder.map(Number).map(id => map.get(id)).filter(Boolean);
  const remaining = todayData.linked.filter(i => !map.has(Number(i.id)) || !linkedOrder.map(Number).includes(Number(i.id)));
  todayData.linked = [...ordered, ...remaining];
  fs.writeFileSync(TODAY_FILE, JSON.stringify(todayData, null, 2));
  // Mirror basic order to indexData.todayList where ids match
  if (Array.isArray(indexData.todayList)) {
    const pos = new Map(linkedOrder.map((id, idx) => [Number(id), idx]));
    indexData.todayList.sort((a, b) => (pos.get(Number(a.id)) ?? 9999) - (pos.get(Number(b.id)) ?? 9999));
    fs.writeFileSync(INDEX_FILE, JSON.stringify(indexData, null, 2));
  }
  res.json({ success: true });
});

// Health tracker endpoints
app.get('/api/health-data', (req, res) => {
  res.json(healthData);
});

app.post('/api/health-data', (req, res) => {
  healthData = req.body || healthData;
  fs.writeFileSync(HEALTH_FILE, JSON.stringify(healthData, null, 2));
  res.json({ status: 'ok' });
});

// Reorder entire today list (both linked and ad-hoc items)
app.post('/api/today/reorder-all', (req, res) => {
  const { newOrder } = req.body || {};
  if (!Array.isArray(newOrder)) return res.status(400).json({ error: 'newOrder must be an array' });
  
  const linkedMap = new Map(todayData.linked.map(i => [Number(i.id), i]));
  const adHocMap = new Map(todayData.adHoc.map(i => [Number(i.id), i]));
  
  const newLinked = [];
  const newAdHoc = [];
  
  newOrder.forEach(id => {
    const numId = Number(id);
    if (linkedMap.has(numId)) {
      newLinked.push(linkedMap.get(numId));
    } else if (adHocMap.has(numId)) {
      newAdHoc.push(adHocMap.get(numId));
    }
  });
  
  todayData.linked = newLinked;
  todayData.adHoc = newAdHoc;
  fs.writeFileSync(TODAY_FILE, JSON.stringify(todayData, null, 2));
  
  res.json({ success: true });
});

app.get('/api/finance-export', (req, res) => {
  const data = financeData.transactions.map(tx => ({
    Date: tx.date,
    Description: tx.description,
    Amount: tx.amount,
    Account: tx.accountName,
    File: tx.sourceFile || '',
    Uploaded: tx.uploadedAt || '',
    Type: tx.type || '',
    SubType: tx.subType || '',
    Notes: tx.notes || '',
    Month: tx.month || ''
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="finance-master.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// Experience Tracker API endpoints
// Today page endpoints
app.get('/api/today-data', (req, res) => {
  res.json(todayData);
});

app.delete('/api/today/:id', (req, res) => {
  const id = Number(req.params.id);
  // remove from linked
  const beforeLinked = todayData.linked.length;
  todayData.linked = todayData.linked.filter(i => Number(i.id) !== id);
  let removed = beforeLinked !== todayData.linked.length;
  if (!removed) {
    const beforeAd = todayData.adHoc.length;
    todayData.adHoc = todayData.adHoc.filter(i => Number(i.id) !== id);
    removed = beforeAd !== todayData.adHoc.length;
  }
  if (!removed) return res.status(404).json({ error: 'Today item not found' });
  fs.writeFileSync(TODAY_FILE, JSON.stringify(todayData, null, 2));
  // mirror remove from legacy list
  indexData.todayList = (indexData.todayList || []).filter(i => Number(i.id) !== id);
  fs.writeFileSync(INDEX_FILE, JSON.stringify(indexData, null, 2));
  res.json({ success: true });
});
// --- Cross-link helpers for Today <-> source files ---
function updateWorkTaskCompletion(sourceId, completed) {
  try {
    const WORK_FILE = path.join(DATA_DIR, 'workData.json');
    const data = loadJson(WORK_FILE, { workProjects: [], workTasks: [], workNextId: 1, maxSubDepth: 7, calendarEvents: [], calendarNextId: 1, meetings: [], meetingNextId: 1 });
    let changed = false;
    const visit = (list) => {
      for (const t of list) {
        if (t.id === sourceId) {
          if (completed) {
            if (t.recurring) {
              // For recurring, advance due date minimally (keep logic in client elsewhere)
              t.dueDate = t.dueDate || '';
            } else {
              t.status = 'closed';
            }
          } else {
            if (t.status === 'closed') t.status = 'open';
          }
          changed = true;
          return true;
        }
        if (t.subtasks && t.subtasks.length && visit(t.subtasks)) return true;
      }
      return false;
    };
    if (visit(data.workTasks)) {
      fs.writeFileSync(WORK_FILE, JSON.stringify(data, null, 2));
      
      // Propagate back to Today list
      updateTodayItemCompletion('work', sourceId, completed);
    }
    return changed;
  } catch (e) {
    console.warn('Failed to update work task completion:', e.message);
    return false;
  }
}

// Helper function to format ISO date
function formatISO(date) {
  return date.toISOString().split('T')[0];
}

// Helper function to compute next due date for recurring tasks
function computeNextDue(task, fromDate) {
  const from = task.from === 'completed' ? fromDate : new Date(task.dueDate);
  const interval = parseInt(task.interval) || 1;
  const next = new Date(from);
  
  switch (task.unit) {
    case 'days':
      next.setDate(next.getDate() + interval);
      break;
    case 'weeks':
      next.setDate(next.getDate() + (interval * 7));
      break;
    case 'months':
      next.setMonth(next.getMonth() + interval);
      break;
    case 'years':
      next.setFullYear(next.getFullYear() + interval);
      break;
  }
  
  return formatISO(next);
}

// Complete work tasks with proper rules
function completeWorkTask(sourceId) {
  try {
    const data = loadJson(WORK_FILE, { workProjects: [], workTasks: [], workNextId: 1 });
    let changed = false;
    
    const visit = (list) => {
      for (const t of list) {
        if (t.id === sourceId) {
          if (t.recurring) {
            t.dueDate = computeNextDue(t, new Date());
          } else {
            t.status = 'closed';
          }
          changed = true;
          return true;
        }
        if (t.subtasks && t.subtasks.length && visit(t.subtasks)) return true;
      }
      return false;
    };
    
    if (visit(data.workTasks)) {
      fs.writeFileSync(WORK_FILE, JSON.stringify(data, null, 2));
      workData = data; // Update in-memory copy
    }
    return changed;
  } catch (e) {
    console.warn('Failed to complete work task:', e.message);
    return false;
  }
}

// Complete DIY tasks with proper rules
function completeDiyTask(sourceId) {
  try {
    const data = loadJson(DIY_FILE, { diyTasks: [], diyBigTasks: [] });
    let changed = false;
    
    // Check regular DIY tasks
    const visit = (list) => {
      for (const t of list) {
        if (String(t.id) === String(sourceId)) {
          t.status = 'closed';
          changed = true;
          return true;
        }
        if (t.subtasks && t.subtasks.length && visit(t.subtasks)) return true;
      }
      return false;
    };
    
    // Check big DIY tasks
    const bigTask = data.diyBigTasks.find(t => String(t.id) === String(sourceId));
    if (bigTask) {
      bigTask.status = 'closed';
      changed = true;
    } else {
      visit(data.diyTasks || []);
    }
    
    if (changed) {
      fs.writeFileSync(DIY_FILE, JSON.stringify(data, null, 2));
      diyData = data; // Update in-memory copy
    }
    return changed;
  } catch (e) {
    console.warn('Failed to complete DIY task:', e.message);
    return false;
  }
}

// Complete parenting tasks with proper rules
function completeParentingTask(sourceId) {
  try {
    const data = loadJson(PARENTING_FILE, { activities: [] });
    const activity = data.activities.find(a => String(a.id) === String(sourceId));
    
    if (activity) {
      activity.status = 'closed';
      activity.completedDates = activity.completedDates || [];
      activity.completedDates.push(formatISO(new Date()));
      
      fs.writeFileSync(PARENTING_FILE, JSON.stringify(data, null, 2));
      parentingData = data; // Update in-memory copy
      return true;
    }
    return false;
  } catch (e) {
    console.warn('Failed to complete parenting task:', e.message);
    return false;
  }
}

function completeFamilyFriendsTask(sourceId) {
  try {
    const data = loadJson(FAMILY_FRIENDS_FILE, { activities: [] });
    const activity = data.activities.find(a => String(a.id) === String(sourceId));
    
    if (activity) {
      activity.status = 'closed';
      activity.completedDates = activity.completedDates || [];
      activity.completedDates.push(formatISO(new Date()));
      
      fs.writeFileSync(FAMILY_FRIENDS_FILE, JSON.stringify(data, null, 2));
      familyFriendsData = data; // Update in-memory copy
      return true;
    }
    return false;
  } catch (e) {
    console.warn('Failed to complete family-friends task:', e.message);
    return false;
  }
}

// Complete index tasks with proper rules based on task type
function completeIndexTask(sourceId, taskName) {
  try {
    const data = loadJson(INDEX_FILE, { weeklyTasks: [], oneOffTasks: [], bigTasks: [], recurringTasks: [], stretchTasks: [] });
    const today = formatISO(new Date());
    let changed = false;
    
    // Check weekly tasks
    const weeklyTask = data.weeklyTasks.find(t => t.id === sourceId);
    if (weeklyTask) {
      weeklyTask.completedDates = weeklyTask.completedDates || [];
      if (!weeklyTask.completedDates.includes(today)) {
        weeklyTask.completedDates.push(today);
      }
      // Remove from missed dates if present
      weeklyTask.missedDates = (weeklyTask.missedDates || []).filter(d => d !== today);
      changed = true;
    }
    
    // Check one-off tasks
    const oneOffTask = data.oneOffTasks.find(t => t.id === sourceId);
    if (oneOffTask) {
      oneOffTask.completedDates = oneOffTask.completedDates || [];
      oneOffTask.completedDates.push(today);
      oneOffTask.status = 'closed';
      oneOffTask.closedDate = today;
      changed = true;
    }
    
    // Check big tasks
    const bigTask = data.bigTasks.find(t => t.id === sourceId);
    if (bigTask) {
      bigTask.completedDates = bigTask.completedDates || [];
      bigTask.completedDates.push(today);
      bigTask.status = 'closed';
      bigTask.closedDate = today;
      changed = true;
    }
    
    // Check recurring tasks
    const recurringTask = data.recurringTasks.find(t => t.id === sourceId);
    if (recurringTask) {
      recurringTask.completedDates = recurringTask.completedDates || [];
      recurringTask.completedDates.push(recurringTask.dueDate);
      const now = new Date();
      const due = new Date(recurringTask.dueDate);
      recurringTask.lastDiff = Math.floor((now - due) / (1000*60*60*24));
      recurringTask.lastCompleted = formatISO(now);
      recurringTask.dueDate = computeNextDue(recurringTask, now);
      changed = true;
    }
    
    // Check stretch tasks
    const stretchTask = data.stretchTasks.find(t => t.id === sourceId);
    if (stretchTask) {
      stretchTask.completedDates = stretchTask.completedDates || [];
      stretchTask.completedDates.push(today);
      changed = true;
    }
    
    if (changed) {
      fs.writeFileSync(INDEX_FILE, JSON.stringify(data, null, 2));
      indexData = data; // Update in-memory copy
    }
    return changed;
  } catch (e) {
    console.warn('Failed to complete index task:', e.message);
    return false;
  }
}
function updateTodayItemCompletion(sourcePage, sourceId, completed) {
  try {
    let todayChanged = false;
    
    // Update linked items in todayData
    todayData.linked.forEach(item => {
      if (item.source.page === sourcePage && item.source.id === String(sourceId)) {
        item.completedAt = completed ? new Date().toISOString() : null;
        todayChanged = true;
      }
    });
    
    // Update legacy todayList in indexData
    if (indexData.todayList) {
      indexData.todayList.forEach(item => {
        if (item.type === sourcePage && item.originalId === String(sourceId)) {
          item.completed = !!completed;
          todayChanged = true;
        }
      });
    }
    
    if (todayChanged) {
      fs.writeFileSync(TODAY_FILE, JSON.stringify(todayData, null, 2));
      fs.writeFileSync(INDEX_FILE, JSON.stringify(indexData, null, 2));
    }
    
    return todayChanged;
  } catch (e) {
    console.warn('Failed to update today item completion:', e.message);
    return false;
  }
}

// Function to detect completion changes and propagate to Today
function detectAndPropagateCompletionChanges(sourcePage, oldTasks, newTasks) {
  try {
    const getTaskMap = (tasks) => {
      const map = new Map();
      const visit = (list) => {
        list.forEach(task => {
          map.set(String(task.id), task.status);
          if (task.subtasks && task.subtasks.length) {
            visit(task.subtasks);
          }
        });
      };
      visit(tasks);
      return map;
    };
    
    const oldMap = getTaskMap(oldTasks);
    const newMap = getTaskMap(newTasks);
    
    // Check for completion changes
    newMap.forEach((newStatus, taskId) => {
      const oldStatus = oldMap.get(taskId);
      if (oldStatus !== newStatus) {
        const wasCompleted = oldStatus === 'closed';
        const isCompleted = newStatus === 'closed';
        
        if (wasCompleted !== isCompleted) {
          updateTodayItemCompletion(sourcePage, taskId, isCompleted);
        }
      }
    });
  } catch (e) {
    console.warn('Failed to detect completion changes:', e.message);
  }
}

function updateDiyTaskCompletion(sourceId, completed) {
  try {
    const DIY_FILE = path.join(DATA_DIR, 'diyData.json');
    const data = loadJson(DIY_FILE, { diyProjects: [], diyTypes: [], diyTasks: [], diyBigTasks: [], diyShoppingList: [], diyNextId: 1, maxSubDepth: 7, calendarEvents: [], calendarNextId: 1 });
    let changed = false;
    const visit = (list) => {
      for (const t of list) {
        if (String(t.id) === String(sourceId)) {
          t.status = completed ? 'closed' : 'open';
          changed = true; return true;
        }
        if (t.subtasks && t.subtasks.length && visit(t.subtasks)) return true;
      }
      return false;
    };
    if (visit(data.diyTasks || [])) {
      fs.writeFileSync(DIY_FILE, JSON.stringify(data, null, 2));
      
      // Propagate back to Today list
      updateTodayItemCompletion('diy', sourceId, completed);
    }
    return changed;
  } catch (e) {
    console.warn('Failed to update DIY task completion:', e.message);
    return false;
  }
}

function updateParentingTaskCompletion(sourceId, completed) {
  try {
    const PARENTING_FILE = path.join(DATA_DIR, 'parentingData.json');
    const data = loadJson(PARENTING_FILE, { skills: [], activities: [], nextSkillId: 1, nextActivityId: 1 });
    const idx = (data.activities || []).findIndex(a => String(a.id) === String(sourceId));
    if (idx !== -1) {
      const a = data.activities[idx];
      a.status = completed ? 'closed' : 'open';
      if (completed) {
        a.completedDates = a.completedDates || [];
        a.completedDates.push(new Date().toISOString());
      }
      fs.writeFileSync(PARENTING_FILE, JSON.stringify(data, null, 2));
      
      // Propagate back to Today list
      updateTodayItemCompletion('parenting', sourceId, completed);
      
      return true;
    }
    return false;
  } catch (e) {
    console.warn('Failed to update Parenting activity completion:', e.message);
    return false;
  }
}

function updateFamilyFriendsTaskCompletion(sourceId, completed) {
  try {
    const FAMILY_FRIENDS_FILE = path.join(DATA_DIR, 'familyFriendsData.json');
    const data = loadJson(FAMILY_FRIENDS_FILE, { skills: [], activities: [], nextSkillId: 1, nextActivityId: 1, people: [], entries: [], nextEntryId: 1 });
    const idx = (data.activities || []).findIndex(a => String(a.id) === String(sourceId));
    if (idx !== -1) {
      const a = data.activities[idx];
      a.status = completed ? 'closed' : 'open';
      if (completed) {
        a.completedDates = a.completedDates || [];
        a.completedDates.push(new Date().toISOString());
      }
      fs.writeFileSync(FAMILY_FRIENDS_FILE, JSON.stringify(data, null, 2));
      
      // Propagate back to Today list
      updateTodayItemCompletion('family-friends', sourceId, completed);
      
      return true;
    }
    return false;
  } catch (e) {
    console.warn('Failed to update Family-Friends activity completion:', e.message);
    return false;
  }
}

function updateTodayCompletionBySource(type, sourceId, completed) {
  let changed = false;
  (indexData.todayList || []).forEach(item => {
    if (String(item.type) === String(type) && String(item.originalId) === String(sourceId)) {
      item.completed = !!completed;
      changed = true;
      if (db) {
        try { db.prepare('UPDATE today SET completed = ? WHERE id = ?').run(completed ? 1 : 0, item.id); } catch (_) {}
      }
    }
  });
  if (changed) {
    fs.writeFileSync(INDEX_FILE, JSON.stringify(indexData, null, 2));
  }
  return changed;
}

// Generic source completion API
app.post('/api/source/complete', (req, res) => {
  const { type, id, completed = true } = req.body || {};
  if (!type || !id) return res.status(400).json({ error: 'type and id are required' });
  let updated = false;
  switch (type) {
    case 'work':
      updated = updateWorkTaskCompletion(String(id), !!completed);
      break;
    case 'diy':
      updated = updateDiyTaskCompletion(String(id), !!completed);
      break;
    case 'parenting':
    case 'dev':
      updated = updateParentingTaskCompletion(String(id), !!completed);
      break;
    case 'family-friends':
      updated = updateFamilyFriendsTaskCompletion(String(id), !!completed);
      break;
    default:
      return res.status(400).json({ error: 'Unknown type' });
  }
  const todayUpdated = updateTodayCompletionBySource(type, String(id), !!completed);
  res.json({ success: true, sourceUpdated: updated, todayUpdated });
});

// Mark Today item complete and propagate to source
app.post('/api/today/complete', (req, res) => {
  const { todayId, completed = true } = req.body || {};
  if (!todayId) {
    return res.status(400).json({ error: 'todayId required' });
  }
  
  const tid = Number(todayId);
  
  // Find the item in todayData
  const linkedIndex = todayData.linked.findIndex(i => Number(i.id) === tid);
  const adHocIndex = todayData.adHoc.findIndex(i => Number(i.id) === tid);
  
  if (linkedIndex >= 0) {
    const linked = todayData.linked[linkedIndex];
    
    if (completed) {
      // Apply completion rules to source task
      let propagated = false;
      const page = linked.source.page;
      const srcId = String(linked.source.id);
      
      switch (page) {
        case 'work':
          propagated = completeWorkTask(srcId);
          break;
        case 'diy':
          propagated = completeDiyTask(srcId);
          break;
        case 'parenting':
          propagated = completeParentingTask(srcId);
          break;
        case 'family-friends':
          propagated = completeFamilyFriendsTask(srcId);
          break;
        case 'index':
        case 'oneoff':
        case 'weekly':
        case 'recurring':
        case 'stretch':
        case 'big':
          propagated = completeIndexTask(srcId, linked.name);
          break;
      }
      
      // Remove from today list (task is completed, so remove it)
      todayData.linked.splice(linkedIndex, 1);
      
      // Also remove from legacy todayList
      const legacyIndex = (indexData.todayList || []).findIndex(i => Number(i.id) === tid);
      if (legacyIndex >= 0) {
        indexData.todayList.splice(legacyIndex, 1);
        fs.writeFileSync(INDEX_FILE, JSON.stringify(indexData, null, 2));
      }
      
      fs.writeFileSync(TODAY_FILE, JSON.stringify(todayData, null, 2));
      return res.json({ success: true, propagated, removed: true });
    } else {
      // Uncompleting - just mark as incomplete but keep in list
      linked.completedAt = null;
      fs.writeFileSync(TODAY_FILE, JSON.stringify(todayData, null, 2));
      return res.json({ success: true, propagated: false });
    }
  }
  
  if (adHocIndex >= 0) {
    if (completed) {
      // Remove ad-hoc item when completed
      todayData.adHoc.splice(adHocIndex, 1);
      fs.writeFileSync(TODAY_FILE, JSON.stringify(todayData, null, 2));
      return res.json({ success: true, propagated: false, removed: true });
    } else {
      // Uncompleting ad-hoc item
      const adHoc = todayData.adHoc[adHocIndex];
      adHoc.completedAt = null;
      fs.writeFileSync(TODAY_FILE, JSON.stringify(todayData, null, 2));
      return res.json({ success: true, propagated: false });
    }
  }
  
  return res.status(404).json({ error: 'Today item not found' });
});
const EXPERIENCES_FILE = path.join(DATA_DIR, 'experienceData.json');

// Helper functions to read/write experience files
function loadExperienceData() {
  try {
    if (fs.existsSync(EXPERIENCES_FILE)) {
      const data = JSON.parse(fs.readFileSync(EXPERIENCES_FILE, 'utf8'));
      return {
        experiences: data.experiences || [],
        responses: data.responses || [],
        nextExperienceId: data.nextExperienceId || 1,
        nextResponseId: data.nextResponseId || 1
      };
    }
  } catch (error) {
    console.error('Error loading experience data:', error);
  }
  return { experiences: [], responses: [], nextExperienceId: 1, nextResponseId: 1 };
}

function saveExperienceData(data) {
  try {
    fs.writeFileSync(EXPERIENCES_FILE, JSON.stringify(data, null, 2));
    console.log('Experience data saved to file');
  } catch (error) {
    console.error('Error saving experience data:', error);
  }
}

// GET /api/experiences - Load all experiences
app.get('/api/experiences', (req, res) => {
  console.log('GET /api/experiences called');
  const data = loadExperienceData();
  res.json({
    experiences: data.experiences,
    nextExperienceId: data.nextExperienceId
  });
});

// POST /api/experiences - Create new experience
app.post('/api/experiences', (req, res) => {
  console.log('POST /api/experiences called with:', req.body);
  
  const data = loadExperienceData();
  const experience = {
    ...req.body,
    id: data.nextExperienceId++,
    createdAt: new Date().toISOString()
  };
  
  data.experiences.push(experience);
  saveExperienceData(data);
  console.log('Experience saved:', experience);
  
  res.json(experience);
});

// PUT /api/experiences/:id - Update experience
app.put('/api/experiences/:id', (req, res) => {
  const id = parseInt(req.params.id);
  console.log('PUT /api/experiences/' + id + ' called with:', req.body);
  
  const data = loadExperienceData();
  const index = data.experiences.findIndex(exp => exp.id === id);
  
  if (index !== -1) {
    data.experiences[index] = { ...data.experiences[index], ...req.body };
    saveExperienceData(data);
    console.log('Experience updated:', data.experiences[index]);
    res.json(data.experiences[index]);
  } else {
    res.status(404).json({ error: 'Experience not found' });
  }
});

// DELETE /api/experiences/:id - Delete experience
app.delete('/api/experiences/:id', (req, res) => {
  const id = parseInt(req.params.id);
  console.log('DELETE /api/experiences/' + id + ' called');
  
  const data = loadExperienceData();
  const index = data.experiences.findIndex(exp => exp.id === id);
  
  if (index !== -1) {
    data.experiences.splice(index, 1);
    saveExperienceData(data);
    console.log('Experience deleted:', id);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Experience not found' });
  }
});

// POST /api/experience-responses - Save user responses
app.post('/api/experience-responses', (req, res) => {
  console.log('POST /api/experience-responses called with:', req.body);
  
  const data = loadExperienceData();
  const response = {
    ...req.body,
    id: data.nextResponseId++,
    timestamp: new Date().toISOString()
  };
  
  data.responses.push(response);
  // Update experience scheduling based on response
  const idx = data.experiences.findIndex(e => e.id === Number(response.experienceId));
  if (idx !== -1) {
    const exp = data.experiences[idx];
    const isSkipped = response.type === 'skipped' || response.skipped === true;
    if (isSkipped) {
      // On skip, stop waiting and schedule the next occurrence from the last trigger time
      exp.pendingResponse = false;
      if (exp.triggerType === 'recurring') {
        exp.nextTrigger = calculateNextRecurringFromBase(exp.lastTriggeredAt, exp.intervalNumber, exp.intervalType);
      } else if (exp.triggerType === 'set') {
        exp.nextTrigger = calculateNextSetTrigger(exp.timesOfDay || [], exp.daysOfWeek || []);
      }
    } else {
      exp.pendingResponse = false;
      exp.lastRespondedAt = new Date().toISOString();
      if (exp.triggerType === 'recurring') {
        exp.nextTrigger = calculateNextRecurringTrigger(exp.intervalNumber, exp.intervalType);
      } else if (exp.triggerType === 'set') {
        exp.nextTrigger = calculateNextSetTrigger(exp.timesOfDay || [], exp.daysOfWeek || []);
      }
    }
  }
  saveExperienceData(data);
  console.log('Response saved:', response);
  
  res.json({ success: true, response });
});

// GET /api/experience-responses - Get all responses
app.get('/api/experience-responses', (req, res) => {
  console.log('GET /api/experience-responses called');
  const data = loadExperienceData();
  res.json(data.responses);
});

// Experience Notification Scheduler
function calculateNextRecurringTrigger(intervalNumber, intervalType) {
  const now = new Date();
  const nextTrigger = new Date(now);
  
  switch (intervalType) {
    case 'minutes':
      nextTrigger.setMinutes(now.getMinutes() + intervalNumber);
      break;
    case 'hours':
      nextTrigger.setHours(now.getHours() + intervalNumber);
      break;
    case 'days':
      nextTrigger.setDate(now.getDate() + intervalNumber);
      break;
  }
  
  return nextTrigger.toISOString();
}

function calculateNextSetTrigger(timesOfDay, daysOfWeek) {
  const now = new Date();
  let nextTrigger = null;
  
  // Check next 7 days for matching schedule
  for (let i = 0; i < 7; i++) {
    const checkDate = new Date(now);
    checkDate.setDate(now.getDate() + i);
    const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][checkDate.getDay()];
    
    if (daysOfWeek.includes(dayName)) {
      for (const time of timesOfDay) {
        try {
          const [hours, minutes] = time.split(':').map(Number);
          const triggerTime = new Date(checkDate);
          triggerTime.setHours(hours, minutes, 0, 0);
          
          if (triggerTime > now) {
            if (!nextTrigger || triggerTime < nextTrigger) {
              nextTrigger = triggerTime;
            }
          }
        } catch (error) {
          console.error('Error parsing time:', time, error);
        }
      }
    }
  }
  
  return nextTrigger ? nextTrigger.toISOString() : null;
}

// Calculate the next recurring trigger using a base time (e.g., lastTriggeredAt)
// Rolls forward in fixed increments until it's in the future
function calculateNextRecurringFromBase(baseIso, intervalNumber, intervalType) {
  if (!baseIso) {
    return calculateNextRecurringTrigger(intervalNumber, intervalType);
  }
  const base = new Date(baseIso);
  const now = new Date();
  if (isNaN(base.getTime())) {
    return calculateNextRecurringTrigger(intervalNumber, intervalType);
  }
  let next = new Date(base);
  const step = (d) => {
    switch (intervalType) {
      case 'minutes':
        d.setMinutes(d.getMinutes() + intervalNumber);
        break;
      case 'hours':
        d.setHours(d.getHours() + intervalNumber);
        break;
      case 'days':
        d.setDate(d.getDate() + intervalNumber);
        break;
      default:
        d.setMinutes(d.getMinutes() + intervalNumber);
        break;
    }
  };
  // Move at least once from the base
  step(next);
  // Keep stepping until strictly in the future (safety to avoid infinite loop)
  let safety = 0;
  while (next <= now && safety < 10000) {
    step(next);
    safety++;
  }
  return next.toISOString();
}

async function sendExperiencePushNotification(experience) {
  if (pushSubscriptions.length === 0) {
    console.log(`No push subscribers for experience: ${experience.name}`);
    return;
  }

  console.log(`Sending push notification for experience: ${experience.name}`);
  
  const payload = JSON.stringify({
    title: experience.name,
    body: experience.description || `Time for your ${experience.name} experience!`,
    tag: `experience-${experience.id}`,
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    requireInteraction: true,
    data: { 
      experienceId: experience.id,
      responses: experience.responses || [],
      experienceType: experience.responseType
    },
  actions: experience.responseType === '1-2' ? 
      experience.responses.map((response, index) => ({
        action: `response-${index}`,
        title: response
      })) : [
    { action: 'open', title: 'Open Survey' },
    { action: 'skip', title: 'Skip' }
      ]
  });

  const promises = pushSubscriptions.map(subscription => {
    return webPush.sendNotification(subscription, payload)
      .catch(error => {
        console.error("Push send failed:", error);
        // Remove invalid subscriptions
        if (error.statusCode === 410) {
          pushSubscriptions = pushSubscriptions.filter(sub => sub.endpoint !== subscription.endpoint);
        }
      });
  });

  try {
    await Promise.all(promises);
    console.log(`Push notification sent to ${pushSubscriptions.length} subscribers for: ${experience.name}`);
  } catch (error) {
    console.error('Error sending push notifications:', error);
  }
}

function checkAndTriggerExperiences() {
  const data = loadExperienceData();
  const now = new Date();
  let triggeredCount = 0;

  console.log(`Checking ${data.experiences.length} experiences for triggers...`);

  // Check if notifications are currently paused
  const isCurrentlyPaused = checkIfNotificationsPaused();
  if (isCurrentlyPaused) {
    console.log('⏸️  Notifications are currently paused - skipping triggers');
    return;
  }

  // Iterate explicitly to avoid any accidental outer returns and ensure per-experience gating
  (async () => {
    for (const experience of data.experiences) {
      try {
        if (experience.status !== 'active' || !experience.nextTrigger) {
          continue;
        }

        const triggerTime = new Date(experience.nextTrigger);
        // If it's time to trigger this specific experience
        if (triggerTime <= now) {
          // Only block re-triggering of this same experience if awaiting response
          if (experience.pendingResponse) {
            continue;
          }
          console.log(`🔔 TRIGGERING: ${experience.name} (was due: ${triggerTime.toLocaleString()})`);
          triggeredCount++;
          // Mark waiting for response and clear schedule until response received
          experience.pendingResponse = true;
          experience.lastTriggeredAt = new Date().toISOString();
          experience.nextTrigger = null;
          saveExperienceData(data);
          // Send push notification for this experience only
          await sendExperiencePushNotification(experience);
        }
      } catch (e) {
        console.warn('Experience trigger loop error:', e?.message || e);
      }
    }

    if (triggeredCount > 0) {
      console.log(`✅ Triggered ${triggeredCount} experience(s)`);
    }
  })();
}

function checkIfNotificationsPaused() {
  // For now, this is a simple check - you could extend this to read from a file
  // or database if you want pause schedules to persist across server restarts
  const now = new Date();
  const currentTime = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
  const currentDay = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][now.getDay()];
  
  // You can implement server-side pause schedule checking here
  // For now, returning false (never paused) - client-side handles pause schedules
  return false;
}

// Start the notification scheduler
let schedulerInterval = null;

function startExperienceScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
  }
  
  console.log('🚀 Starting Experience Notification Scheduler...');
  console.log('   📊 Checking every 30 seconds for due experiences');
  
  // Check immediately on start
  checkAndTriggerExperiences();
  
  // Then check every 30 seconds
  schedulerInterval = setInterval(checkAndTriggerExperiences, 30000);
}

function stopExperienceScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('⏹️  Experience Notification Scheduler stopped');
  }
}

// Manual trigger endpoint for testing
app.post('/api/trigger-experience/:id', async (req, res) => {
  try {
    const experienceId = parseInt(req.params.id);
    const data = loadExperienceData();
    const experience = data.experiences.find(exp => exp.id === experienceId);
    
    if (!experience) {
      return res.status(404).json({ error: 'Experience not found' });
    }
    
  console.log(`Manual trigger requested for: ${experience.name}`);
  experience.pendingResponse = true;
  experience.lastTriggeredAt = new Date().toISOString();
  experience.nextTrigger = null;
  saveExperienceData(data);
  await sendExperiencePushNotification(experience);
    
    res.json({ success: true, message: `Push notification sent for: ${experience.name}` });
  } catch (error) {
    console.error('Manual trigger failed:', error);
    res.status(500).json({ error: 'Failed to trigger experience' });
  }
});

// Scheduler control endpoints
app.post('/api/scheduler/start', (req, res) => {
  startExperienceScheduler();
  res.json({ success: true, message: 'Experience scheduler started' });
});

app.post('/api/scheduler/stop', (req, res) => {
  stopExperienceScheduler();
  res.json({ success: true, message: 'Experience scheduler stopped' });
});

app.get('/api/scheduler/status', (req, res) => {
  res.json({ 
    running: !!schedulerInterval,
    subscriberCount: pushSubscriptions.length,
    checkInterval: '30 seconds'
  });
});

if (require.main === module) {
  initDb();
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT} (data dir: ${DATA_DIR})`);
    
    // Start the experience scheduler after server starts
    setTimeout(() => {
      startExperienceScheduler();
    }, 2000); // Wait 2 seconds for server to fully initialize
  });
}

module.exports = { app, initDb };