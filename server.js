require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());
app.use(express.static(__dirname));
app.get('/shopping', (req, res) => res.sendFile(path.join(__dirname, 'shopping.html')));
app.get('/today', (req, res) => res.sendFile(path.join(__dirname, 'today.html')));
app.get('/gardening', (req, res) => res.sendFile(path.join(__dirname, 'gardening.html')));
app.get('/diy', (req, res) => res.sendFile(path.join(__dirname, 'diy.html')));
app.get('/work', (req, res) => res.sendFile(path.join(__dirname, 'work.html')));
app.get('/spending', (req, res) => res.sendFile(path.join(__dirname, 'spending.html')));
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

// spending page data
let spendingData = {
  projects: [],
  shoppingList: [],
  longTermList: [],
  canBuyList: [],
  nextId: 1
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
  startBalances: { date:'', accounts:{} }
};

const INDEX_FILE = path.join(__dirname, 'indexData.json');
const WORK_FILE = path.join(__dirname, 'workData.json');
const SPENDING_FILE = path.join(__dirname, 'spendingData.json');
const DIY_FILE = path.join(__dirname, 'diyData.json');
const FINANCE_FILE = path.join(__dirname, 'financeData.json');

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
  spendingData = loadJson(SPENDING_FILE, spendingData);
  diyData = loadJson(DIY_FILE, diyData);
  financeData = loadJson(FINANCE_FILE, financeData);
}

app.get('/api/index-data', (req, res) => {
  res.json(indexData);
});

app.post('/api/index-data', (req, res) => {
  indexData = req.body;
  fs.writeFileSync(INDEX_FILE, JSON.stringify(indexData, null, 2));
  res.json({ status: 'ok' });
});

app.get('/api/work-data', (req, res) => {
  res.json(workData);
});

app.post('/api/work-data', (req, res) => {
  workData = req.body;
  fs.writeFileSync(WORK_FILE, JSON.stringify(workData, null, 2));
  res.json({ status: 'ok' });
});

app.get('/api/spending-data', (req, res) => {
  res.json(spendingData);
});

app.post('/api/spending-data', (req, res) => {
  spendingData = req.body;
  fs.writeFileSync(SPENDING_FILE, JSON.stringify(spendingData, null, 2));
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

initDb();
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
