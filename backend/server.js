const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

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
        port: Number(process.env.DB_PORT || 3306),

        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        connectTimeout: 20000,

        // Local / Docker MySQL safe SSL
        ssl: {
          rejectUnauthorized: false
        }
      });

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
        name VARCHAR(255) NOT NULL,
        roll_number VARCHAR(255) NOT NULL,
        class_name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS teacher (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        subject VARCHAR(255) NOT NULL,
        class_name VARCHAR(255) NOT NULL,
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

    /* ---------------- Health Probes ---------------- */

    app.get('/health', (req, res) => {
      res.status(200).json({ status: 'UP' });
    });

    app.get('/ready', async (req, res) => {
      try {
        await db.query('SELECT 1');
        res.status(200).json({ status: 'READY' });
      } catch {
        res.status(500).json({ status: 'NOT_READY' });
      }
    });

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

    /* ---------------- Add Student ---------------- */

    app.post('/addstudent', async (req, res) => {
      try {
        const { name, rollNo, class: className } = req.body;

        if (!name || !rollNo || !className) {
          return res.status(400).json({
            error: 'Invalid payload: name, rollNo, class required'
          });
        }

        await db.query(
          `INSERT INTO student (name, roll_number, class_name)
           VALUES (?, ?, ?)`,
          [name, rollNo, className]
        );

        res.status(201).json({ message: 'Student added successfully' });

      } catch (err) {
        console.error('❌ Error adding student:', err.message);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    /* ---------------- Add Teacher ---------------- */

    app.post('/addteacher', async (req, res) => {
      try {
        const { name, subject, class: className } = req.body;

        if (!name || !subject || !className) {
          return res.status(400).json({
            error: 'Invalid payload'
          });
        }

        await db.query(
          `INSERT INTO teacher (name, subject, class)
           VALUES (?, ?, ?)`,
          [name, subject, className]
        );

        res.status(201).json({ message: 'Teacher added successfully' });

      } catch (err) {
        console.error('❌ Error adding teacher:', err.message);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    /* ---------------- Delete Student ---------------- */

    app.delete('/student/:id', async (req, res) => {
      try {
        await db.query('DELETE FROM student WHERE id = ?', [req.params.id]);
        res.json({ message: 'Student deleted successfully' });
      } catch (err) {
        console.error('❌ Error deleting student:', err.message);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    /* ---------------- Delete Teacher ---------------- */

    app.delete('/teacher/:id', async (req, res) => {
      try {
        await db.query('DELETE FROM teacher WHERE id = ?', [req.params.id]);
        res.json({ message: 'Teacher deleted successfully' });
      } catch (err) {
        console.error('❌ Error deleting teacher:', err.message);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    /* ---------------- Graceful Shutdown ---------------- */

    process.on('SIGINT', async () => {
      console.log('🛑 Shutting down server...');
      await db.end();
      process.exit(0);
    });

    app.listen(3500, () => {
      console.log('🚀 Backend server running on port 3500');
    });

  } catch (error) {
    console.error('❌ Fatal: Could not start server.', error);
    process.exit(1);
  }
})();
