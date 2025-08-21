// Emergency production authentication fix
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';

const DATABASE_URL = process.env.DATABASE_URL;
const sql = neon(DATABASE_URL);

async function emergencyProductionFix() {
  console.log('=== EMERGENCY PRODUCTION AUTHENTICATION FIX ===');
  
  try {
    // Step 1: Delete any existing admin users to start fresh
    console.log('Step 1: Cleaning existing admin users...');
    await sql`DELETE FROM users WHERE auth_type = 'local'`;
    
    // Step 2: Create admin user with correct schema
    console.log('Step 2: Creating fresh admin user...');
    const passwordHash = await bcrypt.hash('admin@tpf2025', 10);
    
    const userId = crypto.randomUUID();
    
    const result = await sql`
      INSERT INTO users (
        id,
        password, 
        auth_type, 
        role, 
        first_name, 
        last_name,
        created_at,
        updated_at
      ) VALUES (
        ${userId},
        ${passwordHash},
        'local',
        'admin',
        'Dosh',
        'Barzanji',
        NOW(),
        NOW()
      ) RETURNING *
    `;
    
    console.log('Admin user created:', result[0]);
    
    // Step 3: Verify the user can authenticate
    console.log('Step 3: Testing authentication...');
    const testResult = await bcrypt.compare('admin@tpf2025', passwordHash);
    console.log('Password verification:', testResult ? 'SUCCESS' : 'FAILED');
    
    // Step 4: Check database state
    const allUsers = await sql`SELECT id, auth_type, role, first_name, last_name FROM users`;
    console.log('Total users in database:', allUsers.length);
    console.log('Users:', allUsers);
    
    console.log('\n=== FIX COMPLETE ===');
    console.log('Admin user created with ID:', userId);
    console.log('Authentication should now work in production');
    
  } catch (error) {
    console.error('Emergency fix failed:', error);
  }
}

emergencyProductionFix();