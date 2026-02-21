const path = require("path");
const fs = require("fs");
const express = require("express");
const multer = require("multer");

const { initDb, run, all, get } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${unique}${ext}`);
  }
});

const allowedMime = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf"
]);

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    if (!allowedMime.has(file.mimetype)) {
      return cb(new Error("Only jpg, png, or pdf files are allowed"));
    }
    cb(null, true);
  }
});

const isValidYm = (ym) => /^\d{4}-(0[1-9]|1[0-2])$/.test(ym);

const buildCalendarDays = (ym) => {
  const [yearStr, monthStr] = ym.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const daysInMonth = new Date(year, month, 0).getDate();

  return Array.from({ length: daysInMonth }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return `${ym}-${day}`;
  });
};

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(uploadsDir));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", async (req, res, next) => {
  try {
    const q = (req.query.q || "").trim();
    const params = [];
    let where = "";

    if (q) {
      where =
        "WHERE company LIKE ? OR prefecture LIKE ? OR tags LIKE ? OR body LIKE ?";
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }

    const reports = await all(
      `SELECT id, date, prefecture, company, title, body, tags, created_at
       FROM reports
       ${where}
       ORDER BY date DESC, created_at DESC`,
      params
    );

    const reportIds = reports.map((r) => r.id);
    let attachmentsByReport = {};

    if (reportIds.length > 0) {
      const placeholders = reportIds.map(() => "?").join(",");
      const attachments = await all(
        `SELECT id, report_id, filename, original_name, mime_type, size, created_at
         FROM attachments
         WHERE report_id IN (${placeholders})
         ORDER BY id ASC`,
        reportIds
      );

      attachmentsByReport = attachments.reduce((acc, item) => {
        if (!acc[item.report_id]) acc[item.report_id] = [];
        acc[item.report_id].push(item);
        return acc;
      }, {});
    }

    res.render("index", { reports, attachmentsByReport, q });
  } catch (err) {
    next(err);
  }
});

app.get("/new", (_req, res) => {
  const initialDate =
    _req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(_req.query.date)
      ? _req.query.date
      : "";
  res.render("new", { error: null, values: { date: initialDate } });
});

app.post("/reports", upload.array("files", 10), async (req, res, next) => {
  try {
    const { date, prefecture, company, title, body, tags } = req.body;
    const safeDate =
      date && date.trim() ? date.trim() : new Date().toISOString().slice(0, 10);
    const safe = (value) => (value && value.trim() ? value.trim() : "");

    const result = await run(
      `INSERT INTO reports (date, prefecture, company, title, body, tags)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        safeDate,
        safe(prefecture),
        safe(company),
        safe(title),
        safe(body),
        safe(tags)
      ]
    );

    const reportId = result.lastInsertRowid;
    const files = req.files || [];

    for (const file of files) {
      await run(
        `INSERT INTO attachments (report_id, filename, original_name, mime_type, size)
         VALUES (?, ?, ?, ?, ?)`,
        [reportId, file.filename, file.originalname, file.mimetype, file.size]
      );
    }

    res.redirect(`/reports/${reportId}`);
  } catch (err) {
    next(err);
  }
});

app.get("/reports/:id/edit", async (req, res, next) => {
  try {
    const report = await get(
      `SELECT id, date, prefecture, company, title, body, tags, created_at
       FROM reports
       WHERE id = ?`,
      [req.params.id]
    );

    if (!report) return res.status(404).send("Not found");

    const attachments = await all(
      `SELECT id, filename, original_name, mime_type, size, created_at
       FROM attachments
       WHERE report_id = ?
       ORDER BY id ASC`,
      [req.params.id]
    );

    res.render("edit", { report, attachments, error: null });
  } catch (err) {
    next(err);
  }
});

app.post("/reports/:id", upload.array("files", 10), async (req, res, next) => {
  try {
    const reportId = req.params.id;
    const { date, prefecture, company, title, body, tags } = req.body;
    const safeDate =
      date && date.trim() ? date.trim() : new Date().toISOString().slice(0, 10);
    const safe = (value) => (value && value.trim() ? value.trim() : "");

    await run(
      `UPDATE reports
       SET date = ?, prefecture = ?, company = ?, title = ?, body = ?, tags = ?
       WHERE id = ?`,
      [
        safeDate,
        safe(prefecture),
        safe(company),
        safe(title),
        safe(body),
        safe(tags),
        reportId
      ]
    );

    const deleteIdsRaw = req.body.deleteAttachments;
    const deleteIds = Array.isArray(deleteIdsRaw)
      ? deleteIdsRaw
      : deleteIdsRaw
      ? [deleteIdsRaw]
      : [];

    for (const deleteId of deleteIds) {
      const attachment = await get(
        `SELECT id, filename FROM attachments WHERE id = ? AND report_id = ?`,
        [deleteId, reportId]
      );
      if (!attachment) continue;

      await run(`DELETE FROM attachments WHERE id = ?`, [attachment.id]);
      const filePath = path.join(uploadsDir, attachment.filename);
      fs.unlink(filePath, () => {});
    }

    const files = req.files || [];
    for (const file of files) {
      await run(
        `INSERT INTO attachments (report_id, filename, original_name, mime_type, size)
         VALUES (?, ?, ?, ?, ?)`,
        [reportId, file.filename, file.originalname, file.mimetype, file.size]
      );
    }

    res.redirect(`/reports/${reportId}`);
  } catch (err) {
    next(err);
  }
});

app.get("/reports/:id", async (req, res, next) => {
  try {
    const report = await get(
      `SELECT id, date, prefecture, company, title, body, tags, created_at
       FROM reports
       WHERE id = ?`,
      [req.params.id]
    );

    if (!report) return res.status(404).send("Not found");

    const attachments = await all(
      `SELECT id, filename, original_name, mime_type, size, created_at
       FROM attachments
       WHERE report_id = ?
       ORDER BY id ASC`,
      [req.params.id]
    );

    res.render("show", { report, attachments });
  } catch (err) {
    next(err);
  }
});

app.get("/monthly", async (_req, res, next) => {
  try {
    const monthlyReports = await all(
      `SELECT ym, title, body, created_at, updated_at
       FROM monthly_reports
       ORDER BY ym DESC`
    );
    res.render("monthly_index", { monthlyReports });
  } catch (err) {
    next(err);
  }
});

app.get("/monthly/new", (_req, res) => {
  const now = new Date();
  const defaultYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  res.render("monthly_new", {
    error: null,
    values: { ym: defaultYm, title: "", body: "" }
  });
});

app.post("/monthly", upload.array("files", 10), async (req, res, next) => {
  try {
    const ym = (req.body.ym || "").trim();
    const title = (req.body.title || "").trim();
    const body = (req.body.body || "").trim();

    if (!isValidYm(ym)) {
      return res.status(400).render("monthly_new", {
        error: "YYYY-MM 形式で入力してください",
        values: { ym, title, body }
      });
    }

    await run(
      `INSERT INTO monthly_reports (ym, title, body, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(ym) DO UPDATE SET
         title = excluded.title,
         body = excluded.body,
         updated_at = datetime('now')`,
      [ym, title, body]
    );

    const monthlyReport = await get(
      `SELECT id, ym FROM monthly_reports WHERE ym = ?`,
      [ym]
    );
    const files = req.files || [];

    for (const file of files) {
      await run(
        `INSERT INTO monthly_attachments (monthly_report_id, filename, original_name, mime_type, size)
         VALUES (?, ?, ?, ?, ?)`,
        [
          monthlyReport.id,
          file.filename,
          file.originalname,
          file.mimetype,
          file.size
        ]
      );
    }

    res.redirect(`/monthly/${ym}`);
  } catch (err) {
    next(err);
  }
});

app.get("/monthly/:ym", async (req, res, next) => {
  try {
    const ym = (req.params.ym || "").trim();
    if (!isValidYm(ym)) return res.status(404).send("Not found");

    const monthlyReport = await get(
      `SELECT id, ym, title, body, created_at, updated_at
       FROM monthly_reports
       WHERE ym = ?`,
      [ym]
    );
    if (!monthlyReport) return res.status(404).send("Not found");

    const attachments = await all(
      `SELECT id, filename, original_name, mime_type, size, created_at
       FROM monthly_attachments
       WHERE monthly_report_id = ?
       ORDER BY id ASC`,
      [monthlyReport.id]
    );

    const calendarDays = buildCalendarDays(ym);
    const dayStart = `${ym}-01`;
    const dayEnd = `${ym}-31`;
    const reportsInMonth = await all(
      `SELECT id, date, created_at
       FROM reports
       WHERE date BETWEEN ? AND ?
       ORDER BY created_at DESC`,
      [dayStart, dayEnd]
    );
    const reportByDate = {};
    for (const report of reportsInMonth) {
      if (!reportByDate[report.date]) reportByDate[report.date] = report;
    }

    const calendar = calendarDays.map((date) => {
      const report = reportByDate[date];
      return {
        date,
        day: date.slice(-2),
        hasReport: Boolean(report),
        url: report ? `/reports/${report.id}` : `/new?date=${date}`
      };
    });

    res.render("monthly_show", { monthlyReport, attachments, calendar });
  } catch (err) {
    next(err);
  }
});

app.get("/monthly/:ym/edit", async (req, res, next) => {
  try {
    const ym = (req.params.ym || "").trim();
    if (!isValidYm(ym)) return res.status(404).send("Not found");

    const monthlyReport = await get(
      `SELECT id, ym, title, body, created_at, updated_at
       FROM monthly_reports
       WHERE ym = ?`,
      [ym]
    );
    if (!monthlyReport) return res.status(404).send("Not found");

    const attachments = await all(
      `SELECT id, filename, original_name, mime_type, size, created_at
       FROM monthly_attachments
       WHERE monthly_report_id = ?
       ORDER BY id ASC`,
      [monthlyReport.id]
    );

    res.render("monthly_edit", { monthlyReport, attachments, error: null });
  } catch (err) {
    next(err);
  }
});

app.post("/monthly/:ym", upload.array("files", 10), async (req, res, next) => {
  try {
    const ym = (req.params.ym || "").trim();
    if (!isValidYm(ym)) return res.status(404).send("Not found");

    const monthlyReport = await get(
      `SELECT id, ym FROM monthly_reports WHERE ym = ?`,
      [ym]
    );
    if (!monthlyReport) return res.status(404).send("Not found");

    const title = (req.body.title || "").trim();
    const body = (req.body.body || "").trim();
    await run(
      `UPDATE monthly_reports
       SET title = ?, body = ?, updated_at = datetime('now')
       WHERE ym = ?`,
      [title, body, ym]
    );

    const deleteIdsRaw = req.body.deleteAttachments;
    const deleteIds = Array.isArray(deleteIdsRaw)
      ? deleteIdsRaw
      : deleteIdsRaw
      ? [deleteIdsRaw]
      : [];

    for (const deleteId of deleteIds) {
      const attachment = await get(
        `SELECT id, filename
         FROM monthly_attachments
         WHERE id = ? AND monthly_report_id = ?`,
        [deleteId, monthlyReport.id]
      );
      if (!attachment) continue;
      await run(`DELETE FROM monthly_attachments WHERE id = ?`, [attachment.id]);
      const filePath = path.join(uploadsDir, attachment.filename);
      fs.unlink(filePath, () => {});
    }

    const files = req.files || [];
    for (const file of files) {
      await run(
        `INSERT INTO monthly_attachments (monthly_report_id, filename, original_name, mime_type, size)
         VALUES (?, ?, ?, ?, ?)`,
        [
          monthlyReport.id,
          file.filename,
          file.originalname,
          file.mimetype,
          file.size
        ]
      );
    }

    res.redirect(`/monthly/${ym}`);
  } catch (err) {
    next(err);
  }
});

app.use((err, _req, res, _next) => {
  if (err && err.message && err.message.includes("Only jpg")) {
    return res.status(400).send(err.message);
  }
  console.error(err);
  res.status(500).send("Internal Server Error");
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to init DB", err);
    process.exit(1);
  });

module.exports = app;
