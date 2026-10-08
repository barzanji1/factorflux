#!/usr/bin/env node

/**
 * QuantumCore Desktop Installer Email Distribution
 * Sends desktop installers to specified email address
 */

import { sendDesktopInstallers } from './server/emailService.js';

async function emailInstallers() {
  const recipientEmail = 'doshbarzanji@gmail.com';
  
  console.log('📧 Sending QuantumCore desktop installers...');
  console.log(`📍 Recipient: ${recipientEmail}`);
  
  try {
    const success = await sendDesktopInstallers(recipientEmail);
    
    if (success) {
      console.log('✅ Desktop installers sent successfully!');
      console.log('📦 Included files:');
      console.log('   • QuantumCore-Windows-Portable.tar.gz (5.7 MB)');
      console.log('   • QuantumCore-Mac-Portable.tar.gz (5.7 MB)');
      console.log('   • QuantumCore-Linux-Portable.tar.gz (5.7 MB)');
      console.log('   • USER-INSTALLATION-GUIDE.md');
      console.log('\n🎯 Email contains:');
      console.log('   • Download links for all platforms');
      console.log('   • Installation instructions');
      console.log('   • Enterprise deployment guide');
      console.log('   • Troubleshooting information');
    } else {
      console.log('❌ Failed to send installers');
      console.log('Check the Resend connection and verified sending domain');
    }
  } catch (error) {
    console.error('❌ Error sending installers:', error);
  }
}

// Run the email distribution
emailInstallers();