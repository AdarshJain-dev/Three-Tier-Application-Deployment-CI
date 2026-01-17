const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());
const fs = require('fs');

let db;

/* =========================================================
   🔐 Fail-fast: Required Environment Variables Check
   ========================================================= */
const REQUIRED_ENV_VARS = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];

REQUIRED_ENV_VARS.forEach((key) => {
  if (!process.env[key]) {
    console.error(`❌ Missing required environment variable: ${key}`);
    process.exit(1);
  }
});

/* =========================================================
   🔁 MySQL Connection with Retry Logic
   ========================================================= */
const connectWithRetry = async (retries = 10, delay = 3000) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: 3306,
      
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
      
        ssl: {
          ca: fs.readFileSync('/app/global-bundle.pem')
        }
      });

      // Test connection
      await pool.query('SELECT 1');

      console.log(`✅ Connected to MySQL (Attempt ${attempt})`);
      return pool;

    } catch (error) {
      console.error(
        `❌ MySQL connection failed (Attempt ${attempt}/${retries}):`,
        error.message
      );

      if (attempt === retries) throw error;

      console.log(`⏳ Retrying in ${delay / 1000}s...`);
      await new Promise(res => setTimeout(res, delay));
    }
  }
};

/* =========================================================
   🧱 Ensure Required Tables Exist
   ========================================================= */
const ensureTables = async (db) => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS student (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255),
        roll_number VARCHAR(255),
        class VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS teacher (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255),
        subject VARCHAR(255),
        class VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('✅ Tables ensured successfully (student, teacher)');
  } catch (error) {
    console.error('❌ Error ensuring tables:', error);
    throw error;
  }
};

/* =========================================================
   🚀 App Initialization
   ========================================================= */
(async () => {
  try {
    db = await connectWithRetry();
    await ensureTables(db);

    /* ---------------- Health Probes (K8s / Istio) ---------------- */

    // Liveness probe
    app.get('/health', (req, res) => {
      res.status(200).json({ status: 'UP' });
    });

    // Readiness probe
    app.get('/ready', async (req, res) => {
      try {
        await db.query('SELECT 1');
        res.status(200).json({ status: 'READY' });
      } catch (err) {
        res.status(500).json({ status: 'NOT_READY' });
      }
    });

    /* ---------------- Utility Functions ---------------- */

    const getLastStudentID = async () => {
      const [result] = await db.query('SELECT MAX(id) AS lastID FROM student');
      return result[0].lastID || 0;
    };

    const getLastTeacherID = async () => {
      const [result] = await db.query('SELECT MAX(id) AS lastID FROM teacher');
      return result[0].lastID || 0;
    };

    /* ---------------- Routes ---------------- */

    app.get('/', async (req, res) => {
      const [data] = await db.query('SELECT * FROM student');
      res.json({ message: 'From Backend', studentData: data });
    });

    app.get('/student', async (req, res) => {
      const [data] = await db.query('SELECT * FROM student');
      res.json(data);
    });

    app.get('/teacher', async (req, res) => {
      const [data] = await db.query('SELECT * FROM teacher');
      res.json(data);
    });

    app.post('/addstudent', async (req, res) => {
      const { name, rollNo, class: className } = req.body;
      const nextID = (await getLastStudentID()) + 1;

      await db.query(
        `INSERT INTO student (id, name, roll_number, class)
         VALUES (?, ?, ?, ?)`,
        [nextID, name, rollNo, className]
      );

      res.json({ message: 'Student added successfully' });
    });

    app.post('/addteacher', async (req, res) => {
      const { name, subject, class: className } = req.body;
      const nextID = (await getLastTeacherID()) + 1;

      await db.query(
        `INSERT INTO teacher (id, name, subject, class)
         VALUES (?, ?, ?, ?)`,
        [nextID, name, subject, className]
      );

      res.json({ message: 'Teacher added successfully' });
    });

    app.delete('/student/:id', async (req, res) => {
      const studentId = req.params.id;

      await db.query('DELETE FROM student WHERE id = ?', [studentId]);

      const [rows] = await db.query('SELECT id FROM student ORDER BY id');
      await Promise.all(
        rows.map((row, index) =>
          db.query('UPDATE student SET id = ? WHERE id = ?', [index + 1, row.id])
        )
      );

      res.json({ message: 'Student deleted successfully' });
    });

    app.delete('/teacher/:id', async (req, res) => {
      const teacherId = req.params.id;

      await db.query('DELETE FROM teacher WHERE id = ?', [teacherId]);

      const [rows] = await db.query('SELECT id FROM teacher ORDER BY id');
      await Promise.all(
        rows.map((row, index) =>
          db.query('UPDATE teacher SET id = ? WHERE id = ?', [index + 1, row.id])
        )
      );

      res.json({ message: 'Teacher deleted successfully' });
    });

    /* ---------------- Graceful Shutdown ---------------- */

    process.on('SIGINT', async () => {
      console.log('🛑 Shutting down server...');
      await db.end();
      process.exit(0);
    });

    /* ---------------- Start Server ---------------- */

    app.listen(3500, () => {
      console.log('🚀 Backend server running on port 3500');
    });

  } catch (error) {
    console.error('❌ Fatal: Could not start server.', error);
    process.exit(1);
  }
})();
