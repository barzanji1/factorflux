// Test bcrypt functionality directly in production environment
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';

const NEON_DATABASE_URL = process.env.NEON_DATABASE_URL;
const sql = neon(NEON_DATABASE_URL);

async function debugProduction() {
  try {
    console.log('=== Production Bcrypt Debug ===');
    
    // Get current admin user from production
    const users = await sql`
      SELECT id, email, password, auth_type 
      FROM users 
      WHERE email = 'doshbarzanji@gmail.com' 
      AND auth_type = 'local'
    `;
    
    if (users.length === 0) {
      console.error('No admin user found');
      return;
    }
    
    const user = users[0];
    console.log('Found user:', user.id, user.email);
    console.log('Password hash length:', user.password?.length);
    console.log('Hash starts with:', user.password?.substring(0, 10));
    
    // Test bcrypt comparison with known password
    const testPassword = 'admintpf2025';
    console.log('Testing password:', testPassword);
    
    try {
      const result = await bcrypt.compare(testPassword, user.password);
      console.log('Bcrypt compare result:', result);
    } catch (bcryptError) {
      console.error('Bcrypt compare error:', bcryptError);
    }
    
    // Test with a fresh hash generated right now
    console.log('\n=== Fresh Hash Test ===');
    const freshHash = await bcrypt.hash(testPassword, 10);
    console.log('Fresh hash:', freshHash);
    
    const freshTest = await bcrypt.compare(testPassword, freshHash);
    console.log('Fresh hash test:', freshTest);
    
    // Update user with fresh hash and test again
    console.log('\n=== Update and Test ===');
    await sql`
      UPDATE users 
      SET password = ${freshHash}
      WHERE id = ${user.id}
    `;
    
    console.log('Updated user with fresh hash');
    console.log('Password should now work in production');
    
  } catch (error) {
    console.error('Debug failed:', error);
  }
}

debugProduction();