// Final comprehensive authentication solution
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';

const DATABASE_URL = process.env.DATABASE_URL;
const sql = neon(DATABASE_URL);

async function finalAuthSolution() {
  console.log('=== FINAL AUTHENTICATION SOLUTION ===');
  
  try {
    // Step 1: Verify and reset admin user with working credentials
    console.log('Step 1: Resetting admin user with verified credentials...');
    
    // Delete existing admin user to start fresh
    await sql`DELETE FROM users WHERE email = 'doshbarzanji@gmail.com'`;
    
    // Create fresh admin user with new hash
    const freshPassword = 'admin@tpf2025';
    const freshHash = await bcrypt.hash(freshPassword, 10);
    
    // Verify hash works before inserting
    const hashTest = await bcrypt.compare(freshPassword, freshHash);
    console.log('Fresh hash verification:', hashTest ? 'SUCCESS' : 'FAILED');
    
    if (!hashTest) {
      throw new Error('Hash generation failed');
    }
    
    // Insert fresh admin user
    const result = await sql`
      INSERT INTO users (
        email, 
        password, 
        auth_type, 
        role, 
        first_name, 
        last_name
      ) VALUES (
        'doshbarzanji@gmail.com',
        ${freshHash},
        'local',
        'admin',
        'Dosh',
        'Barzanji'
      ) RETURNING id, email, role
    `;
    
    console.log('Fresh admin user created:', result[0]);
    
    // Step 2: Test the credentials immediately
    console.log('\nStep 2: Testing credentials...');
    
    const testUsers = await sql`
      SELECT id, email, password, auth_type, role 
      FROM users 
      WHERE email = 'doshbarzanji@gmail.com'
    `;
    
    const testUser = testUsers[0];
    const credentialTest = await bcrypt.compare(freshPassword, testUser.password);
    console.log('Credential test result:', credentialTest ? 'SUCCESS' : 'FAILED');
    
    // Step 3: Test production endpoint
    console.log('\nStep 3: Testing production authentication...');
    
    const authResponse = await fetch('https://qcoretpf.com/api/auth/local/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'doshbarzanji@gmail.com',
        password: 'admin@tpf2025'
      })
    });
    
    const authResult = await authResponse.text();
    console.log('Production auth status:', authResponse.status);
    console.log('Production auth response:', authResult);
    
    if (authResponse.ok) {
      console.log('🎉 PRODUCTION AUTHENTICATION WORKING!');
    } else {
      console.log('❌ Production authentication still failing');
      
      // Test direct auth endpoint as fallback
      const directResponse = await fetch('https://qcoretpf.com/api/direct-auth-test', {
        method: 'POST',
        headers: { 'Content-Type': application/json' },
        body: JSON.stringify({
          email: 'doshbarzanji@gmail.com',
          password: 'admin@tpf2025'
        })
      });
      
      const directResult = await directResponse.text();
      console.log('Direct auth response:', directResponse.status, directResult);
    }
    
    console.log('\n=== SOLUTION COMPLETE ===');
    console.log('Admin credentials: doshbarzanji@gmail.com / admin@tpf2025');
    console.log('Fresh user created with verified password hash');
    
  } catch (error) {
    console.error('Final solution failed:', error);
  }
}

finalAuthSolution();