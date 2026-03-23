import fs from 'fs';
import path from 'path';

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
    console.log("========================================");
    console.log("EMAIL FALLBACK TRIGGERED");
    console.log("To:", params.to);
    console.log("From:", params.from);
    console.log("Subject:", params.subject);
    console.log("Text:", params.text || "");
    console.log("HTML:", params.html || "");
    console.log("Attachments:", params.attachments?.length || 0);
    console.log("Time:", new Date().toISOString());
    console.log("========================================");

    return true;
  } catch (error) {
    console.error("Fallback email logger error:", error);
    return false;
  }
}

export async function sendDesktopInstallers(recipientEmail: string): Promise<boolean> {
  try {
    const windowsPath = path.join(
      process.cwd(),
      'electron-dist',
      'FactorFlux-Windows-Portable.tar.gz'
    );
    const macPath = path.join(
      process.cwd(),
      'electron-dist',
      'FactorFlux-Mac-Portable.tar.gz'
    );
    const linuxPath = path.join(
      process.cwd(),
      'electron-dist',
      'FactorFlux-Linux-Portable.tar.gz'
    );
    const guidePath = path.join(
      process.cwd(),
      'USER-INSTALLATION-GUIDE.md'
    );

    const attachments: EmailParams["attachments"] = [];

    if (fs.existsSync(windowsPath)) {
      attachments.push({
        content: fs.readFileSync(windowsPath).toString('base64'),
        filename: 'FactorFlux-Windows-Portable.tar.gz',
        type: 'application/gzip',
        disposition: 'attachment'
      });
    }

    if (fs.existsSync(macPath)) {
      attachments.push({
        content: fs.readFileSync(macPath).toString('base64'),
        filename: 'FactorFlux-Mac-Portable.tar.gz',
        type: 'application/gzip',
        disposition: 'attachment'
      });
    }

    if (fs.existsSync(linuxPath)) {
      attachments.push({
        content: fs.readFileSync(linuxPath).toString('base64'),
        filename: 'FactorFlux-Linux-Portable.tar.gz',
        type: 'application/gzip',
        disposition: 'attachment'
      });
    }

    if (fs.existsSync(guidePath)) {
      const installGuide = fs.readFileSync(guidePath, 'utf8');
      attachments.push({
        content: Buffer.from(installGuide).toString('base64'),
        filename: 'USER-INSTALLATION-GUIDE.md',
        type: 'text/markdown',
        disposition: 'attachment'
      });
    }

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #2563eb;">FactorFlux Desktop Installers</h1>
        <p>Hello,</p>
        <p>Your FactorFlux desktop installers are ready! I've attached the portable versions for all operating systems.</p>
        <p>Best regards,<br>FactorFlux Development Team</p>
      </div>
    `;

    return await sendEmail({
      to: recipientEmail,
      from: 'dosh@truckingprosfinancial.com',
      subject: 'FactorFlux Desktop Installers - Ready for Distribution',
      html: emailHtml,
      text: `FactorFlux Desktop Installers

Your desktop installers are ready.

Best regards,
FactorFlux Development Team`,
      attachments,
    });
  } catch (error) {
    console.error('Error preparing desktop installers:', error);
    return false;
  }
}