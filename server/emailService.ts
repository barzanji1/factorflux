import fs from 'fs';
import path from 'path';
import { sendResendEmail } from "./resendTransport.js";

interface EmailParams {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: Array<{
    content: string;
    filename: string;
    type: string;
    disposition: string;
    content_id?: string;
  }>;
}

const EMAIL_LOGO_CID = "factorflux-emboss-logo";
const EMAIL_LOGO_MARKUP = `<div style="margin: 0 0 16px 0;"><img src="cid:${EMAIL_LOGO_CID}" alt="FactorFlux" width="48" style="display:block;width:48px;height:auto;border:0;" /></div>`;

function emailLogoPath(): string | undefined {
  const candidates = [
    path.resolve(process.cwd(), "client/public/images/ff-logo-emboss.png"),
    path.resolve(process.cwd(), "dist/public/images/ff-logo-emboss.png"),
  ];
  return candidates.find(candidate => fs.existsSync(candidate));
}

function insertEmailLogo(html: string): string {
  const firstContainer = /<(div|table)\b[^>]*>/i;
  return firstContainer.test(html)
    ? html.replace(firstContainer, match => `${match}${EMAIL_LOGO_MARKUP}`)
    : `${EMAIL_LOGO_MARKUP}${html}`;
}

/**
 * Core delivery function — used by both sendEmail() and sendEmailTracked().
 * Returns the Resend acceptance ID. Never reports success without provider acceptance.
 */
async function deliver(params: EmailParams): Promise<{ success: boolean; messageId?: string }> {
  try {
    const msg: EmailParams = {
      to:      params.to,
      subject: params.subject,
      text:    params.text ?? (params.html ? "" : " "),
    };

    let attachments = params.attachments ? [...params.attachments] : [];
    if (params.html) {
      const logoPath = emailLogoPath();
      if (logoPath) {
        msg.html = insertEmailLogo(params.html);
        attachments.push({
          content: fs.readFileSync(logoPath).toString("base64"),
          filename: "ff-logo-emboss.png",
          type: "image/png",
          disposition: "inline",
          content_id: EMAIL_LOGO_CID,
        });
      } else {
        msg.html = params.html;
      }
    }
    if (attachments.length) msg.attachments = attachments;

    const messageId = await sendResendEmail(msg);

    console.log(
      `[email] accepted → ${params.to} | subject="${params.subject}" | msgId=${messageId}`,
    );

    return { success: true, messageId };
  } catch (err: any) {
    const detail = err?.message ?? "Email delivery failed";
    console.error(`[email] Resend error → ${params.to} | subject="${params.subject}"`, detail);
    return { success: false };
  }
}

/**
 * sendEmail — drop-in replacement for the old console-only stub.
 * All existing callers (carrier notifications, support messages, welcome emails)
 * use the single Resend transport.
 */
export async function sendEmail(params: EmailParams): Promise<boolean> {
  const { success } = await deliver(params);
  return success;
}

/**
 * sendEmailTracked — same as sendEmail but also returns the provider acceptance ID.
 */
export async function sendEmailTracked(
  params: EmailParams,
): Promise<{ success: boolean; messageId?: string }> {
  return deliver(params);
}

/**
 * sendDesktopInstallers — attaches build artifacts and emails them to a recipient.
 * Silently skips any artifact file that does not exist on disk.
 */
export async function sendDesktopInstallers(recipientEmail: string): Promise<boolean> {
  try {
    const files = [
      {
        filePath: path.join(process.cwd(), 'electron-dist', 'FactorFlux-Windows-Portable.tar.gz'),
        filename: 'FactorFlux-Windows-Portable.tar.gz',
        type:     'application/gzip',
      },
      {
        filePath: path.join(process.cwd(), 'electron-dist', 'FactorFlux-Mac-Portable.tar.gz'),
        filename: 'FactorFlux-Mac-Portable.tar.gz',
        type:     'application/gzip',
      },
      {
        filePath: path.join(process.cwd(), 'electron-dist', 'FactorFlux-Linux-Portable.tar.gz'),
        filename: 'FactorFlux-Linux-Portable.tar.gz',
        type:     'application/gzip',
      },
      {
        filePath: path.join(process.cwd(), 'USER-INSTALLATION-GUIDE.md'),
        filename: 'USER-INSTALLATION-GUIDE.md',
        type:     'text/markdown',
      },
    ];

    const attachments: EmailParams["attachments"] = files
      .filter(f => fs.existsSync(f.filePath))
      .map(f => ({
        content:     fs.readFileSync(f.filePath).toString('base64'),
        filename:    f.filename,
        type:        f.type,
        disposition: 'attachment',
      }));

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #2563eb;">FactorFlux Desktop Installers</h1>
        <p>Hello,</p>
        <p>Your FactorFlux desktop installers are ready. Portable versions for all operating systems are attached.</p>
        <p>Best regards,<br>FactorFlux Development Team</p>
      </div>
    `;

    return sendEmail({
      to:          recipientEmail,
      subject:     'FactorFlux Desktop Installers - Ready for Distribution',
      html,
      text:        'Your FactorFlux desktop installers are attached.\n\nBest regards,\nFactorFlux Development Team',
      attachments,
    });
  } catch (error) {
    console.error('[email] sendDesktopInstallers error:', error);
    return false;
  }
}
