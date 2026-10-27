const db = require('./config/db');

const createIndexes = async () => {
  try {
    console.log('Creating enterprise database indexes...');

    const queries = [
      // 1. Telemetry History performance
      'CREATE INDEX IF NOT EXISTS idx_telemetry_machine_date ON telemetry_history (machine_name, created_at DESC);',
      'CREATE INDEX IF NOT EXISTS idx_telemetry_created_at ON telemetry_history (created_at DESC);',

      // 2. Machines foreign keys and lookup
      'CREATE INDEX IF NOT EXISTS idx_machines_ro_id ON machines (ro_id);',
      'CREATE INDEX IF NOT EXISTS idx_machines_name ON machines (name);',
      'CREATE INDEX IF NOT EXISTS idx_machines_status ON machines (status);',

      // 3. RO foreign keys and lookup
      'CREATE INDEX IF NOT EXISTS idx_ro_omc_id ON ro (omc_id);',
      'CREATE INDEX IF NOT EXISTS idx_ro_contact ON ro (contact);',

      // 4. Alerts query optimization
      'CREATE INDEX IF NOT EXISTS idx_alerts_machine_id ON alerts (machine_id);',
      'CREATE INDEX IF NOT EXISTS idx_alerts_machine_status ON alerts (machine_id, status);',
      'CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alerts (timestamp DESC);',

      // 5. Feedbacks lookup
      'CREATE INDEX IF NOT EXISTS idx_feedbacks_machine_id ON feedbacks (machine_id);',
      'CREATE INDEX IF NOT EXISTS idx_feedbacks_ro_omc ON feedbacks (ro_id, omc_id);',
      'CREATE INDEX IF NOT EXISTS idx_feedbacks_created_at ON feedbacks (created_at DESC);',

      // 6. Users lookup
      'CREATE INDEX IF NOT EXISTS idx_users_omc_ro ON users (omc_id, ro_id);',
      'CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);'
    ];

    for (const q of queries) {
      await db.query(q);
    }

    console.log('All enterprise indexes created successfully! ⚡');
    process.exit(0);
  } catch (error) {
    console.error('Error creating indexes:', error);
    process.exit(1);
  }
};

createIndexes();
