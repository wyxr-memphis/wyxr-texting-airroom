// Quick script to check if messages are in the database
require('dotenv').config();
const pool = require('./server/config/database');

async function checkMessages() {
  try {
    const result = await pool.query(`
      SELECT id, phone, text, timestamp, read
      FROM messages
      ORDER BY timestamp DESC
      LIMIT 10
    `);

    console.log(`\n📊 Total messages found: ${result.rows.length}\n`);

    if (result.rows.length === 0) {
      console.log('❌ No messages in database');
    } else {
      result.rows.forEach((msg, i) => {
        console.log(`${i + 1}. ${msg.phone} at ${msg.timestamp}`);
        console.log(`   "${msg.text}"`);
        console.log(`   Read: ${msg.read}\n`);
      });
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkMessages();
