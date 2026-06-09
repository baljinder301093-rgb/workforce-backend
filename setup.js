import pg from "pg";
import bcrypt from "bcryptjs";

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL environment variable is not set.");
  console.error("Set it like: export DATABASE_URL=postgres://user:pass@host:5432/db");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

const TABLES = [
  `CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'worker',
    status TEXT NOT NULL DEFAULT 'pending',
    phone TEXT,
    profile_photo TEXT,
    skills TEXT,
    experience TEXT,
    company_name TEXT,
    suspension_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    location TEXT NOT NULL,
    required_skills TEXT NOT NULL,
    workers_required INTEGER NOT NULL DEFAULT 1,
    start_date TIMESTAMP WITH TIME ZONE NOT NULL,
    end_date TIMESTAMP WITH TIME ZONE NOT NULL,
    working_hours TEXT NOT NULL,
    salary_amount REAL NOT NULL,
    payment_rate REAL NOT NULL DEFAULT 0,
    payment_type TEXT NOT NULL DEFAULT 'daily',
    status TEXT NOT NULL DEFAULT 'pending',
    manager_id INTEGER,
    client_id INTEGER,
    client_approved BOOLEAN NOT NULL DEFAULT false,
    rejection_reason TEXT,
    budget REAL,
    safety_instructions TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS applications (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL,
    worker_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    cover_note TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS assignments (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL,
    worker_id INTEGER NOT NULL,
    manager_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    start_date TIMESTAMP WITH TIME ZONE,
    end_date TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    worker_id INTEGER NOT NULL,
    project_id INTEGER NOT NULL,
    assignment_id INTEGER,
    amount REAL NOT NULL,
    payment_type TEXT NOT NULL DEFAULT 'fixed',
    status TEXT NOT NULL DEFAULT 'pending',
    transaction_id TEXT,
    released_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    sender_id INTEGER NOT NULL,
    receiver_id INTEGER NOT NULL,
    project_id INTEGER,
    content TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    type VARCHAR(60) NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    related_id INTEGER,
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    id SERIAL PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'string',
    label TEXT NOT NULL,
    group TEXT NOT NULL DEFAULT 'general',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS commissions (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL,
    payment_id INTEGER,
    worker_id INTEGER NOT NULL,
    project_amount REAL NOT NULL,
    worker_commission_pct REAL NOT NULL DEFAULT 0,
    client_commission_pct REAL NOT NULL DEFAULT 0,
    worker_commission_amt REAL NOT NULL DEFAULT 0,
    client_commission_amt REAL NOT NULL DEFAULT 0,
    platform_revenue REAL NOT NULL DEFAULT 0,
    worker_payout REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'calculated',
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )`,
];

const DEFAULT_SETTINGS = [
  { key: "general.site_name", value: "WorkForce Pro", type: "string", label: "Site Name", group: "general" },
  { key: "general.contact_email", value: "admin@workforce.com", type: "string", label: "Contact Email", group: "general" },
  { key: "general.contact_phone", value: "", type: "string", label: "Contact Phone", group: "general" },
  { key: "general.currency", value: "INR", type: "string", label: "Currency", group: "general" },
  { key: "general.currency_symbol", value: "\u20b9", type: "string", label: "Currency Symbol", group: "general" },
  { key: "general.timezone", value: "Asia/Kolkata", type: "string", label: "Timezone", group: "general" },
  { key: "general.maintenance_mode", value: "false", type: "boolean", label: "Maintenance Mode", group: "general" },
  { key: "security.otp_enabled", value: "false", type: "boolean", label: "Enable OTP", group: "security" },
  { key: "security.captcha_enabled", value: "false", type: "boolean", label: "Enable CAPTCHA", group: "security" },
  { key: "security.session_timeout", value: "86400", type: "number", label: "Session Timeout (seconds)", group: "security" },
  { key: "security.max_login_attempts", value: "5", type: "number", label: "Max Login Attempts", group: "security" },
  { key: "commission.enabled", value: "true", type: "boolean", label: "Enable Commission System", group: "commission" },
  { key: "commission.worker_pct", value: "10", type: "number", label: "Worker Commission %", group: "commission" },
  { key: "commission.client_pct", value: "10", type: "number", label: "Client Commission %", group: "commission" },
];

async function setup() {
  console.log("\n===== WorkForce Pro Setup =====\n");

  for (const sql of TABLES) {
    const tableName = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)?.[1];
    try {
      await pool.query(sql);
      console.log(`  Table created: ${tableName}`);
    } catch (err) {
      console.error(`  ERROR creating ${tableName}:`, err.message);
      process.exit(1);
    }
  }

  console.log("\n  All tables ready.");

  const { rows: adminRows } = await pool.query("SELECT * FROM users WHERE role = 'admin' LIMIT 1");
  if (adminRows.length === 0) {
    const password = "password";
    const passwordHash = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role, status)
       VALUES ($1, $2, $3, $4, $5)`,
      ["Admin User", "admin@workforce.com", passwordHash, "admin", "active"]
    );
    console.log("\n  Admin user created:");
    console.log("    Email:    admin@workforce.com");
    console.log("    Password: password");
  } else {
    console.log("\n  Admin user already exists (skipping creation).");
  }

  for (const s of DEFAULT_SETTINGS) {
    const { rows } = await pool.query("SELECT * FROM settings WHERE key = $1", [s.key]);
    if (rows.length === 0) {
      await pool.query(
        `INSERT INTO settings (key, value, type, label, group)
         VALUES ($1, $2, $3, $4, $5)`,
        [s.key, s.value, s.type, s.label, s.group]
      );
    }
  }
  console.log("  Default settings seeded.");

  console.log("\n===== Setup Complete =====");
  console.log("  You can now login with:");
  console.log("    Email:    admin@workforce.com");
  console.log("    Password: password");
  console.log("\n  Change the admin password after first login!");
  console.log("\n");

  await pool.end();
}

setup().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
