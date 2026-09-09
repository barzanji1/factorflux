// Direct production database sync for admin user
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';

const NEON_DATABASE_URL = process.env.NEON_DATABASE_URL;

if (!NEON_DATABASE_URL) {
  console.error('NEON_DATABASE_URL not found');
  process.exit(1);
}

const sql = neon(NEON_DATABASE_URL);

async function resetAdminPassword() {
  try {
    console.log('Resetting admin password to "admin@tpf2025"...');
    
    // Generate fresh hash for new password
    const newPassword = 'admin@tpf2025';
    const freshHash = await bcrypt.hash(newPassword, 10);
    
    console.log('Generated fresh hash for admin@tpf2025');
    
    // Verify the fresh hash works
    const testResult = await bcrypt.compare(newPassword, freshHash);
    console.log('Fresh hash verification test:', testResult);
    
    if (!testResult) {
      console.error('Fresh hash failed verification');
      process.exit(1);
    }
    
    // Update the production database with fresh hash
    const result = await sql`
      UPDATE users 
      SET password = ${freshHash}
      WHERE email = 'doshbarzanji@gmail.com' 
      AND auth_type = 'local'
      RETURNING id, email
    `;
    
    console.log('Production database update result:', result);
    
    if (result.length === 0) {
      console.error('No admin user found to update');
      process.exit(1);
    }
    
    console.log('✓ Admin password reset to "admin@tpf2025" successfully');
    console.log('Admin user updated:', result[0]);
    console.log('New credentials: doshbarzanji@gmail.com / admin@tpf2025');
    
  } catch (error) {
    console.error('Password reset failed:', error);
    process.exit(1);
  }
}

resetAdminPassword();