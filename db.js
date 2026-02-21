const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "app.db");
const db = new Database(dbPath);

const run = (sql, params = []) => db.prepare(sql).run(params);

const all = (sql, params = []) => db.prepare(sql).all(params);

const get = (sql, params = []) => db.prepare(sql).get(params);

const initDb = async () => {
  await run(
    `CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      prefecture TEXT NOT NULL,
      company TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      tags TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  );

  await run(
    `CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (report_id) REFERENCES reports(id)
    )`
  );

  await run(
    `CREATE TABLE IF NOT EXISTS monthly_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ym TEXT NOT NULL UNIQUE,
      title TEXT,
      body TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  );

  await run(
    `CREATE TABLE IF NOT EXISTS monthly_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      monthly_report_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (monthly_report_id) REFERENCES monthly_reports(id)
    )`
  );

  await run(
    "CREATE INDEX IF NOT EXISTS idx_reports_date ON reports(date DESC)"
  );
  await run(
    "CREATE INDEX IF NOT EXISTS idx_reports_company ON reports(company)"
  );
  await run(
    "CREATE INDEX IF NOT EXISTS idx_reports_prefecture ON reports(prefecture)"
  );
  await run(
    "CREATE INDEX IF NOT EXISTS idx_monthly_reports_ym ON monthly_reports(ym DESC)"
  );
};

module.exports = {
  db,
  dbPath,
  run,
  all,
  get,
  initDb
};
