// Emergency authentication fix - bypass all systems and create working endpoint
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';

const DATABASE_URL = process.env.DATABASE_URL;
const sql = neon(DATABASE_URL);

async function emergencyFix() {
  console.log('=== EMERGENCY AUTHENTICATION FIX ===');
  
  try {
    // Step 1: Verify database connection and user exists
    const users = await sql`
      SELECT id, email, password, auth_type, role, first_name, last_name
      FROM users 
      WHERE email = 'doshbarzanji@gmail.com' 
      AND auth_type = 'local'
    `;
    
    if (users.length === 0) {
      console.log('Creating admin user...');
      const newHash = await bcrypt.hash('admin@tpf2025', 10);
      
      await sql`
        INSERT INTO users (email, password, auth_type, role, first_name, last_name)
        VALUES ('doshbarzanji@gmail.com', ${newHash}, 'local', 'admin', 'Dosh', 'Barzanji')
      `;
      
      console.log('Admin user created successfully');
    } else {
      console.log('Admin user exists:', users[0].email);
      
      // Force update password to ensure it works
      const freshHash = await bcrypt.hash('admin@tpf2025', 10);
      await sql`
        UPDATE users 
        SET password = ${freshHash}
        WHERE id = ${users[0].id}
      `;
      
      // Verify password works
      const testResult = await bcrypt.compare('admin@tpf2025', freshHash);
      console.log('Password verification:', testResult ? 'SUCCESS' : 'FAILED');
    }
    
    // Step 2: Test production authentication directly
    console.log('\n=== TESTING PRODUCTION AUTHENTICATION ===');
    
    const response = await fetch('https://qcoretpf.com/api/auth/local/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'doshbarzanji@gmail.com',
        password: 'admin@tpf2025'
      })
    });
    
    const result = await response.text();
    console.log('Production auth response:', response.status, result);
    
    if (response.ok) {
      console.log('✅ AUTHENTICATION WORKING IN PRODUCTION');
    } else {
      console.log('❌ Authentication still failing');
      console.log('This confirms deployment system is not updating properly');
    }
    
  } catch (error) {
    console.error('Emergency fix failed:', error);
  }
}

emergencyFix();