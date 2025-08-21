// Direct production database sync for admin user
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('DATABASE_URL not found');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function resetAdminPassword() {
  try {
    console.log('Resetting admin password in production database...');
    
    // Generate a completely fresh hash for the password
    const newPassword = 'admintpf2025';
    const freshHash = await bcrypt.hash(newPassword, 12);
    
    console.log('Generated fresh hash with salt rounds 12');
    
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
    
    console.log('✓ Admin password reset successfully in production');
    console.log('Admin user updated:', result[0]);
    console.log('New hash length:', freshHash.length);
    
  } catch (error) {
    console.error('Password reset failed:', error);
    process.exit(1);
  }
}

resetAdminPassword();