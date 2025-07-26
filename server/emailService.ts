import { MailService } from '@sendgrid/mail';
import fs from 'fs';
import path from 'path';

if (!process.env.SENDGRID_API_KEY) {
  throw new Error("SENDGRID_API_KEY environment variable must be set");
}

const mailService = new MailService();
mailService.setApiKey(process.env.SENDGRID_API_KEY);

interface EmailParams {
  to: string;
  from: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: Array<{
    content: string;
    filename: string;
    type: string;
    disposition: string;
  }>;
}

export async function sendEmail(params: EmailParams): Promise<boolean> {
  try {
    await mailService.send({
      to: params.to,
      from: params.from,
      subject: params.subject,
      text: params.text || '',
      html: params.html || '',
      attachments: params.attachments,
    });
    return true;
  } catch (error) {
    console.error('SendGrid email error:', error);
    return false;
  }
}

export async function sendDesktopInstallers(recipientEmail: string): Promise<boolean> {
  try {
    // Read installer files
    const windowsFile = fs.readFileSync(path.join(process.cwd(), 'electron-dist', 'QuantumCore-Windows-Portable.tar.gz'));
    const macFile = fs.readFileSync(path.join(process.cwd(), 'electron-dist', 'QuantumCore-Mac-Portable.tar.gz'));
    const linuxFile = fs.readFileSync(path.join(process.cwd(), 'electron-dist', 'QuantumCore-Linux-Portable.tar.gz'));
    
    // Read installation guide
    const installGuide = fs.readFileSync(path.join(process.cwd(), 'USER-INSTALLATION-GUIDE.md'), 'utf8');

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

    const result = await sendEmail({
      to: recipientEmail,
      from: 'doshbarzanji@gmail.com', // Use verified sender email
      subject: 'QuantumCore Desktop Installers - Ready for Distribution',
      html: emailHtml,
      text: `QuantumCore Desktop Installers\n\nYour desktop installers are ready! Please see the attached files:\n\n- QuantumCore-Windows-Portable.tar.gz (Windows)\n- QuantumCore-Mac-Portable.tar.gz (Mac)\n- QuantumCore-Linux-Portable.tar.gz (Linux)\n- USER-INSTALLATION-GUIDE.md (Installation instructions)\n\nUsers just need to extract and run the startup script. Full instructions are in the guide.\n\nBest regards,\nQuantumCore Development Team`,
      attachments: [
        {
          content: windowsFile.toString('base64'),
          filename: 'QuantumCore-Windows-Portable.tar.gz',
          type: 'application/gzip',
          disposition: 'attachment'
        },
        {
          content: macFile.toString('base64'),
          filename: 'QuantumCore-Mac-Portable.tar.gz',
          type: 'application/gzip',
          disposition: 'attachment'
        },
        {
          content: linuxFile.toString('base64'),
          filename: 'QuantumCore-Linux-Portable.tar.gz',
          type: 'application/gzip',
          disposition: 'attachment'
        },
        {
          content: Buffer.from(installGuide).toString('base64'),
          filename: 'USER-INSTALLATION-GUIDE.md',
          type: 'text/markdown',
          disposition: 'attachment'
        }
      ]
    });

    return result;
  } catch (error) {
    console.error('Error sending desktop installers:', error);
    return false;
  }
}