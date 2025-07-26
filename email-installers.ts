#!/usr/bin/env tsx

import { MailService } from '@sendgrid/mail';
import fs from 'fs';
import path from 'path';

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;

if (!SENDGRID_API_KEY) {
  console.error('❌ SENDGRID_API_KEY environment variable is required');
  process.exit(1);
}

const mailService = new MailService();
mailService.setApiKey(SENDGRID_API_KEY);

async function sendDesktopInstallers(recipientEmail: string): Promise<boolean> {
  try {
    console.log('📦 Reading installer files...');
    
    // Check if installer files exist
    const installerDir = path.join(process.cwd(), 'electron-dist');
    const windowsFile = path.join(installerDir, 'QuantumCore-Windows-Portable.tar.gz');
    const macFile = path.join(installerDir, 'QuantumCore-Mac-Portable.tar.gz');
    const linuxFile = path.join(installerDir, 'QuantumCore-Linux-Portable.tar.gz');
    const guideFile = path.join(process.cwd(), 'USER-INSTALLATION-GUIDE.md');

    // Check if all files exist
    for (const file of [windowsFile, macFile, linuxFile, guideFile]) {
      if (!fs.existsSync(file)) {
        console.error(`❌ File not found: ${file}`);
        return false;
      }
    }

    // Read files
    const windowsData = fs.readFileSync(windowsFile);
    const macData = fs.readFileSync(macFile);
    const linuxData = fs.readFileSync(linuxFile);
    const guideData = fs.readFileSync(guideFile, 'utf8');

    console.log('📧 Preparing email...');

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #2563eb;">QuantumCore Desktop Installers</h1>
        
        <p>Hello,</p>
        
        <p>Your QuantumCore desktop installers are ready! I've attached the portable versions for all operating systems.</p>
        
        <h2 style="color: #1e40af;">📦 What's Included:</h2>
        <ul>
          <li><strong>QuantumCore-Windows-Portable.tar.gz</strong> - For Windows users</li>
          <li><strong>QuantumCore-Mac-Portable.tar.gz</strong> - For Mac users</li>
          <li><strong>QuantumCore-Linux-Portable.tar.gz</strong> - For Linux users</li>
          <li><strong>USER-INSTALLATION-GUIDE.md</strong> - Complete installation instructions</li>
        </ul>
        
        <h2 style="color: #1e40af;">🚀 Quick Start for Users:</h2>
        <ol>
          <li>Download the file for their operating system</li>
          <li>Extract the archive using built-in tools</li>
          <li>Run the startup script (start-quantumcore.bat or start-quantumcore.sh)</li>
          <li>QuantumCore opens automatically in their browser</li>
        </ol>
        
        <h2 style="color: #1e40af;">✅ Key Benefits:</h2>
        <ul>
          <li>No installation required - just extract and run</li>
          <li>Works offline for core features</li>
          <li>Professional desktop application feel</li>
          <li>Same database as web version</li>
          <li>Cross-platform compatibility</li>
        </ul>
        
        <p style="background: #f3f4f6; padding: 15px; border-radius: 8px;">
          <strong>Note:</strong> Users need Node.js installed on their computers. 
          If they don't have it, they can download it from <a href="https://nodejs.org/">nodejs.org</a>
        </p>
        
        <p>The complete installation guide is attached with troubleshooting steps and system requirements.</p>
        
        <p>Best regards,<br>
        QuantumCore Development Team</p>
      </div>
    `;

    await mailService.send({
      to: recipientEmail,
      from: 'DoshBarzanji@gmail.com', // Use your verified email as sender
      subject: 'QuantumCore Desktop Installers - Ready for Distribution',
      html: emailHtml,
      text: `QuantumCore Desktop Installers\n\nYour desktop installers are ready! Please see the attached files:\n\n- QuantumCore-Windows-Portable.tar.gz (Windows)\n- QuantumCore-Mac-Portable.tar.gz (Mac)\n- QuantumCore-Linux-Portable.tar.gz (Linux)\n- USER-INSTALLATION-GUIDE.md (Installation instructions)\n\nUsers just need to extract and run the startup script. Full instructions are in the guide.\n\nBest regards,\nQuantumCore Development Team`,
      attachments: [
        {
          content: windowsData.toString('base64'),
          filename: 'QuantumCore-Windows-Portable.tar.gz',
          type: 'application/gzip',
          disposition: 'attachment'
        },
        {
          content: macData.toString('base64'),
          filename: 'QuantumCore-Mac-Portable.tar.gz',
          type: 'application/gzip',
          disposition: 'attachment'
        },
        {
          content: linuxData.toString('base64'),
          filename: 'QuantumCore-Linux-Portable.tar.gz',
          type: 'application/gzip',
          disposition: 'attachment'
        },
        {
          content: Buffer.from(guideData).toString('base64'),
          filename: 'USER-INSTALLATION-GUIDE.md',
          type: 'text/markdown',
          disposition: 'attachment'
        }
      ]
    });

    return true;
  } catch (error) {
    console.error('❌ Error sending email:', error);
    return false;
  }
}

async function main() {
  console.log('🚀 QuantumCore Desktop Installer Email Service');
  console.log('📧 Sending installers to DoshBarzanji@gmail.com...');
  
  const success = await sendDesktopInstallers('DoshBarzanji@gmail.com');
  
  if (success) {
    console.log('✅ Desktop installers sent successfully!');
    console.log('📧 Check your email for:');
    console.log('   • QuantumCore-Windows-Portable.tar.gz (5.7 MB)');
    console.log('   • QuantumCore-Mac-Portable.tar.gz (5.7 MB)');
    console.log('   • QuantumCore-Linux-Portable.tar.gz (5.7 MB)');
    console.log('   • USER-INSTALLATION-GUIDE.md');
    console.log('');
    console.log('🎉 Ready to distribute to your users!');
  } else {
    console.log('❌ Failed to send installers. Check the error logs above.');
    process.exit(1);
  }
}

main();