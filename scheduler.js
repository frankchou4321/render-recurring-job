// scheduler.js（Node.js + node-cron）
const mysql = require('mysql2/promise');
const cron  = require('node-cron');

const pool = mysql.createPool({
  host:     process.env.DB_HOST,
  user:     process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port:     process.env.DB_PORT || 3306
});

// 每日 00:05（UTC 時區；可改為 Asia/Taipei）
cron.schedule('5 0 * * *', async () => {
  const today     = new Date();
  const todayStr  = today.toISOString().slice(0,10); // YYYY‑MM‑DD
  const conn      = await pool.getConnection();
  try {
    // 1. 撈當前有效的 recurring_config（含 note 欄位）
    const [cfgs] = await conn.query(`
      SELECT config_id, user_id, category_id, amount, cycle, start_date, note
        FROM recurring_config
       WHERE start_date <= ?
         AND (end_date IS NULL OR end_date >= ?)
    `, [ todayStr, todayStr ]);

    for (const c of cfgs) {
      // 2. 判斷 cycle 是否到執行日
      const startDate = new Date(c.start_date);
      let shouldRun = false;
      switch (c.cycle) {
        case 'daily':   shouldRun = true; break;
        case 'weekly':  shouldRun = today.getDay() === startDate.getDay(); break;
        case 'monthly': shouldRun = today.getDate() === startDate.getDate(); break;
        case 'yearly':  shouldRun = today.getDate() === startDate.getDate()
                               && today.getMonth() === startDate.getMonth();
                         break;
      }
      if (!shouldRun) continue;

      // 3. 檢查今日是否已存在該筆流水
      const [exists] = await conn.query(`
        SELECT 1 
          FROM transaction_log
         WHERE user_id = ? 
           AND category_id = ? 
           AND txn_date = ?
         LIMIT 1
      `, [ c.user_id, c.category_id, todayStr ]);
      if (exists.length) continue;

      // 4. 插入到 transaction_log（對應表結構）
      await conn.query(`
        INSERT INTO transaction_log
          (user_id, category_id, txn_date, amount, note)
        VALUES (?, ?, ?, ?, ?)
      `, [
        c.user_id,
        c.category_id,
        todayStr,
        c.amount,
        c.note  // 若不需要備註，可改成 NULL 或空字串
      ]);
    }

    console.log(`排程完成：共掃描 ${cfgs.length} 筆設定`);
  } catch (err) {
    console.error('排程錯誤：', err);
  } finally {
    conn.release();
  }
});

console.log('Scheduler 已啟動，每日 00:05 執行一次');
