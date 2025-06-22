
console.log("🔍 MONGO_URI:", process.env.MONGO_URI);
const express = require('express');
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.MONGO_DB || 'taskdb';
app.use(express.json());
app.use(express.static(__dirname));

let data = { projects: [], weeklyTasks: [], oneOffTasks: [], recurringTasks: [], deletedTasks: [], nextId: 1 };
let collection;
const DATA_FILE = path.join(__dirname, 'data.json');
let useMongo = !!MONGO_URI;

async function initDb() {
  if (useMongo) {
    try {
      const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 5000, ignoreUndefined: true });
      await client.connect();
      const db = client.db(DB_NAME);
      collection = db.collection('state');
      const doc = await collection.findOne({ _id: 'main' });
      if (doc && doc.data) {
        data = doc.data;
      } else {
        await collection.updateOne({ _id: 'main' }, { $set: { data } }, { upsert: true });
      }
      return;
    } catch (err) {
      console.error('Mongo connection error', err);
      useMongo = false;
    }
  }
  // fallback to file storage
  if (fs.existsSync(DATA_FILE)) {
    try {
      data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (err) {
      console.error('Failed to read data file', err);
    }
  } else {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  }
}

app.get('/api/data', (req, res) => {
  res.json(data);
});

app.post('/api/data', async (req, res) => {
  data = req.body;
  try {
    if (useMongo) {
      await collection.updateOne({ _id: 'main' }, { $set: { data } }, { upsert: true });
    } else {
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    }
    res.json({ status: 'ok' });
  } catch (e) {
    console.error('Failed to save', e);
    res.status(500).json({ error: 'Failed to save' });
  }
});

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Mongo connection error', err);
  process.exit(1);
});
