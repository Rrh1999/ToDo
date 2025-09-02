const test = require('node:test');
const assert = require('node:assert');

const { app, initDb } = require('./server');

test('GET /shopping returns HTML', async (t) => {
  initDb();
  const server = app.listen(0);
  t.after(() => server.close());
  const port = server.address().port;
  const res = await fetch(`http://localhost:${port}/shopping`);
  assert.strictEqual(res.status, 200);
  const text = await res.text();
  assert.ok(text.includes('<title>Shopping</title>'));
});

