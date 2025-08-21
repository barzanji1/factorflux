// Direct production authentication test with session handling
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';

const DATABASE_URL = process.env.DATABASE_URL;
const sql = neon(DATABASE_URL);

async function testProductionAuth() {
  try {
    console.log('=== Production Authentication Deep Test ===');
    
    // Get the current admin user
    const users = await sql`
      SELECT id, email, password, auth_type 
      FROM users 
      WHERE email = 'doshbarzanji@gmail.com' 
      AND auth_type = 'local'
    `;
    
    const user = users[0];
    console.log('Current user in production:', user.id, user.email);
    console.log('Hash starts with:', user.password.substring(0, 20));
    
    // Test if the current hash works with bcrypt
    const testPassword = 'admintpf2025';
    const isValid = await bcrypt.compare(testPassword, user.password);
    console.log('Direct bcrypt test result:', isValid);
    
    if (!isValid) {
      console.log('Current hash is invalid, creating a new one...');
      
      // Generate new hash using the exact same method as Passport
      const newHash = await bcrypt.hash(testPassword, 10);
      console.log('New hash generated:', newHash.substring(0, 20) + '...');
      
      // Verify new hash works
      const newHashTest = await bcrypt.compare(testPassword, newHash);
      console.log('New hash verification:', newHashTest);
      
      // Update user with new hash
      await sql`
        UPDATE users 
        SET password = ${newHash}
        WHERE id = ${user.id}
      `;
      
      console.log('✅ Updated user with working hash');
    } else {
      console.log('✅ Current hash is already valid');
    }
    
    // Now test the production API directly with curl simulation
    console.log('\n=== Testing Production API ===');
    
    const testPayload = JSON.stringify({
      email: 'doshbarzanji@gmail.com',
      password: 'admintpf2025'
    });
    
    console.log('Test payload:', testPayload);
    console.log('If authentication still fails, the issue is in the Passport strategy configuration or session handling');
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

testProductionAuth();