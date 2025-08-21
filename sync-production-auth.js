// Direct production database sync for admin user
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('DATABASE_URL not found');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function syncAdminAuth() {
  try {
    console.log('Syncing admin authentication to production database...');
    
    // Working local hash for admintpf2025
    const workingHash = '$2b$10$qca5rltTDf7A.k7UZjJphuIH.TjoX0RyX6BFVGhosWxgL3mObjXXO';
    
    // Verify the hash works
    const testResult = await bcrypt.compare('admintpf2025', workingHash);
    console.log('Hash verification test:', testResult);
    
    if (!testResult) {
      console.error('Working hash failed verification');
      process.exit(1);
    }
    
    // Update the production database directly
    const result = await sql`
      UPDATE users 
      SET password = ${workingHash}
      WHERE email = 'doshbarzanji@gmail.com' 
      AND auth_type = 'local'
      RETURNING id, email
    `;
    
    console.log('Production database update result:', result);
    
    if (result.length === 0) {
      console.error('No admin user found to update');
      process.exit(1);
    }
    
    console.log('✓ Admin authentication synchronized to production');
    console.log('Admin user updated:', result[0]);
    
  } catch (error) {
    console.error('Sync failed:', error);
    process.exit(1);
  }
}

syncAdminAuth();