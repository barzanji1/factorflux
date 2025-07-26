// Simple script to send desktop installers via email
import { sendDesktopInstallers } from './dist/emailService.js';

async function main() {
  console.log('📧 Sending QuantumCore desktop installers to DoshBarzanji@gmail.com...');
  
  try {
    const success = await sendDesktopInstallers('DoshBarzanji@gmail.com');
    
    if (success) {
      console.log('✅ Desktop installers sent successfully!');
      console.log('📧 Check your email for:');
      console.log('   • QuantumCore-Windows-Portable.tar.gz');
      console.log('   • QuantumCore-Mac-Portable.tar.gz');
      console.log('   • QuantumCore-Linux-Portable.tar.gz');
      console.log('   • USER-INSTALLATION-GUIDE.md');
    } else {
      console.log('❌ Failed to send installers. Check the logs for details.');
    }
  } catch (error) {
    console.error('❌ Error sending installers:', error.message);
  }
}

main();