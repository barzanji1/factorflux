#!/usr/bin/env node

/**
 * Simple script to send QuantumCore desktop installers via email
 * This creates an email with download links instead of attachments
 */

import sgMail from '@sendgrid/mail';

// Configure SendGrid
const apiKey = process.env.SENDGRID_API_KEY;
if (!apiKey) {
  console.error('❌ SENDGRID_API_KEY environment variable is required');
  process.exit(1);
}

sgMail.setApiKey(apiKey);

async function sendInstallerLinks() {
  const recipientEmail = 'doshbarzanji@gmail.com';
  const appUrl = 'https://e603594c-e028-4700-8f9c-83ea4151f86f-00-1yv0wd2mfzho3.janeway.replit.dev';
  
  const emailContent = {
    to: recipientEmail,
    from: 'doshbarzanji@gmail.com', // Must be verified sender in SendGrid
    subject: 'QuantumCore Desktop Installers - Enterprise Ready',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #2563eb;">🚀 QuantumCore Desktop Installers</h1>
        
        <p>Your QuantumCore desktop installers are ready for enterprise distribution!</p>
        
        <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h2 style="color: #1e40af; margin-top: 0;">📥 Download Links</h2>
          
          <div style="margin: 15px 0;">
            <strong>🪟 Windows:</strong><br>
            <a href="${appUrl}/api/download/windows" style="color: #2563eb; text-decoration: none;">
              QuantumCore-Windows-Portable.tar.gz
            </a> (5.7 MB)
          </div>
          
          <div style="margin: 15px 0;">
            <strong>🍎 Mac:</strong><br>
            <a href="${appUrl}/api/download/mac" style="color: #2563eb; text-decoration: none;">
              QuantumCore-Mac-Portable.tar.gz
            </a> (5.7 MB)
          </div>
          
          <div style="margin: 15px 0;">
            <strong>🐧 Linux:</strong><br>
            <a href="${appUrl}/api/download/linux" style="color: #2563eb; text-decoration: none;">
              QuantumCore-Linux-Portable.tar.gz
            </a> (5.7 MB)
          </div>
          
          <div style="margin: 15px 0;">
            <strong>📖 Installation Guide:</strong><br>
            <a href="${appUrl}/api/download/guide" style="color: #2563eb; text-decoration: none;">
              USER-INSTALLATION-GUIDE.md
            </a>
          </div>
        </div>
        
        <h2 style="color: #1e40af;">⚡ Quick Setup Instructions</h2>
        <ol>
          <li><strong>Download</strong> the appropriate installer for your operating system</li>
          <li><strong>Extract</strong> the .tar.gz file using built-in system tools</li>
          <li><strong>Run</strong> the startup script (start-quantumcore.bat or .sh)</li>
          <li><strong>Launch</strong> - QuantumCore opens automatically in your browser</li>
          <li><strong>Create shortcuts</strong> following the provided instructions</li>
        </ol>
        
        <div style="background: #ecfdf5; border-left: 4px solid #10b981; padding: 15px; margin: 20px 0;">
          <h3 style="color: #047857; margin-top: 0;">✅ Working Solution</h3>
          <p style="margin-bottom: 0;">The desktop launch issues have been resolved! These installers use a reliable browser-launcher approach that works on any system with a web browser.</p>
        </div>
        
        <h2 style="color: #1e40af;">🎯 Key Features</h2>
        <ul>
          <li><strong>Zero Dependencies</strong> - Only requires a web browser</li>
          <li><strong>Universal Compatibility</strong> - Works on Windows, Mac, and Linux</li>
          <li><strong>Enterprise Ready</strong> - Simple distribution and deployment</li>
          <li><strong>Professional Experience</strong> - Desktop-like interface</li>
          <li><strong>Same Data</strong> - Connects to live QuantumCore system</li>
        </ul>
        
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
          <p><strong>Live Web App:</strong> <a href="${appUrl}" style="color: #2563eb;">${appUrl}</a></p>
          <p><strong>Download Portal:</strong> <a href="${appUrl}/api/downloads" style="color: #2563eb;">${appUrl}/api/downloads</a></p>
        </div>
        
        <p style="margin-top: 30px; color: #6b7280;">
          Best regards,<br>
          <strong>QuantumCore Development Team</strong>
        </p>
      </div>
    `,
    text: `
QuantumCore Desktop Installers - Enterprise Ready

Your QuantumCore desktop installers are ready for enterprise distribution!

DOWNLOAD LINKS:
• Windows: ${appUrl}/api/download/windows (5.7 MB)
• Mac: ${appUrl}/api/download/mac (5.7 MB)  
• Linux: ${appUrl}/api/download/linux (5.7 MB)
• Installation Guide: ${appUrl}/api/download/guide

QUICK SETUP:
1. Download the appropriate installer for your operating system
2. Extract the .tar.gz file using built-in system tools
3. Run the startup script (start-quantumcore.bat or .sh)
4. Launch - QuantumCore opens automatically in your browser
5. Create shortcuts following the provided instructions

KEY FEATURES:
• Zero Dependencies - Only requires a web browser
• Universal Compatibility - Works on Windows, Mac, and Linux
• Enterprise Ready - Simple distribution and deployment
• Professional Experience - Desktop-like interface
• Same Data - Connects to live QuantumCore system

Live Web App: ${appUrl}
Download Portal: ${appUrl}/api/downloads

Best regards,
QuantumCore Development Team
    `.trim()
  };
  
  try {
    console.log('📧 Sending QuantumCore installer links...');
    console.log(`📍 Recipient: ${recipientEmail}`);
    
    await sgMail.send(emailContent);
    
    console.log('✅ Email sent successfully!');
    console.log('📦 Email contains:');
    console.log('   • Download links for all platforms');
    console.log('   • Installation instructions');
    console.log('   • Enterprise deployment information');
    console.log('   • Live app access');
    console.log('\n🔗 Download Portal: ' + appUrl + '/api/downloads');
    
  } catch (error) {
    console.error('❌ Error sending email:', error);
    if (error.response) {
      console.error('Response body:', error.response.body);
    }
  }
}

// Run the email sender
sendInstallerLinks();