require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
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
app.get('/finance', (req, res) => res.sendFile(path.join(__dirname, 'finance.html')));


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

const INDEX_FILE = path.join(DATA_DIR, 'indexData.json');
const WORK_FILE = path.join(DATA_DIR, 'workData.json');
const DIY_FILE = path.join(DATA_DIR, 'diyData.json');
const FINANCE_FILE = path.join(DATA_DIR, 'financeData.json');
const PARENTING_FILE = path.join(DATA_DIR, 'parentingData.json');
const SOUL_FILE = path.join(DATA_DIR, 'soulData.json');
const RELATIONSHIPS_FILE = path.join(DATA_DIR, 'relationshipsData.json');
const TIME_TRACKER_FILE = path.join(DATA_DIR, 'timeTrackerData.json');

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
  workData = loadJson(WORK_FILE, workData);
  diyData = loadJson(DIY_FILE, diyData);
  financeData = loadJson(FINANCE_FILE, financeData);
  parentingData = loadJson(PARENTING_FILE, parentingData);
  soulData = loadJson(SOUL_FILE, soulData);
  relationshipsData = loadJson(RELATIONSHIPS_FILE, relationshipsData);
  timeTrackerData = loadJson(TIME_TRACKER_FILE, timeTrackerData);
  soulData.meditations = soulData.meditations || [];
  soulData.nextMeditationId = soulData.nextMeditationId || 1;
  soulData.journalTypes = soulData.journalTypes || [];
  soulData.nextJournalTypeId = soulData.nextJournalTypeId || 1;
    soulData.journals = (soulData.journals || []).map(j=>({ ...j, media: j.media || [] }));
  soulData.nextJournalId = soulData.nextJournalId || 1;
  soulData.mottos = soulData.mottos || [];
  soulData.nextMottoId = soulData.nextMottoId || 1;
  financeData.pots = financeData.pots || [];
  financeData.nextPotId = financeData.nextPotId || 1;
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
  workData = req.body;
  fs.writeFileSync(WORK_FILE, JSON.stringify(workData, null, 2));
  res.json({ status: 'ok' });
});


app.get('/api/diy-data', (req, res) => {
  res.json(diyData);
});

app.post('/api/diy-data', (req, res) => {
  diyData = req.body;
  fs.writeFileSync(DIY_FILE, JSON.stringify(diyData, null, 2));
  res.json({ status: 'ok' });
});

app.get('/api/finance-data', (req, res) => {
  res.json(financeData);
});

app.post('/api/finance-data', (req, res) => {
  financeData = req.body;
  fs.writeFileSync(FINANCE_FILE, JSON.stringify(financeData, null, 2));
  res.json({ status: 'ok' });
});

// parenting page data
let parentingData = {
  skills: [],
  activities: [],
  nextSkillId: 1,
  nextActivityId: 1
};

app.get('/api/parenting-data', (req, res) => {
  res.json(parentingData);
});

app.post('/api/parenting-data', (req, res) => {
  parentingData = req.body;
  fs.writeFileSync(PARENTING_FILE, JSON.stringify(parentingData, null, 2));
  res.json({ status: 'ok' });
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
  nextMottoId: 1
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
  nextId: 1
};

app.get('/api/soul-data', (req, res) => {
  res.json(soulData);
});

app.post('/api/soul-data', (req, res) => {
  soulData = req.body;
  soulData.journals = (soulData.journals || []).map(j=>({ ...j, media: j.media || [] }));
  fs.writeFileSync(SOUL_FILE, JSON.stringify(soulData, null, 2));
  res.json({ status: 'ok' });
});

app.get('/api/relationships-data', (req, res) => {
  res.json(relationshipsData);
});

app.post('/api/relationships-data', (req, res) => {
  relationshipsData = req.body;
  fs.writeFileSync(RELATIONSHIPS_FILE, JSON.stringify(relationshipsData, null, 2));
  res.json({ status: 'ok' });
});

// time tracker endpoints
app.get('/api/time-tracker', (req, res) => {
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

app.post('/api/add-to-today', (req, res) => {
  const { taskType, taskId, taskName } = req.body;
  
  // Add to todayList in indexData
  const newTodayItem = {
    id: Date.now(), // Simple ID generation
    type: taskType,
    originalId: taskId,
    name: taskName,
    completed: false,
    addedAt: new Date().toISOString()
  };
  
  indexData.todayList.push(newTodayItem);
  fs.writeFileSync(INDEX_FILE, JSON.stringify(indexData, null, 2));
  res.json({ status: 'ok', item: newTodayItem });
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

if (require.main === module) {
  initDb();
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT} (data dir: ${DATA_DIR})`);
  });
}

module.exports = { app, initDb };