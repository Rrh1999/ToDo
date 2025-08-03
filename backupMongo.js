require('dotenv').config();
const fs = require('fs');
const { MongoClient } = require('mongodb');

async function run(){
  const uri = process.env.MONGO_URI;
  if(!uri){
    console.error('MONGO_URI not set');
    return;
  }
  const dbName = process.env.MONGO_DB || 'taskdb';
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, ignoreUndefined: true });
  try {
    await client.connect();
    const col = client.db(dbName).collection('state');
    const doc = await col.findOne({ _id: 'main' });
    if(doc && doc.data){
      fs.writeFileSync('mongo-backup.json', JSON.stringify(doc.data, null, 2));
      console.log('Backup written to mongo-backup.json');
    } else {
      console.log('No data found to backup');
    }
  } catch(err){
    console.error('Failed to backup', err);
  } finally {
    await client.close();
  }
}

run();
