import fs from 'fs';
import path from 'path';

interface EmailParams {
  to: string;
  from: string;
  replyTo?: string;
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

/**
 * Core delivery function — used by both sendEmail() and sendEmailTracked().
 * Returns { success, messageId? } so callers can capture the SendGrid x-message-id.
 * Falls back to console-log when SENDGRID_API_KEY is absent (dev / test environments).
 */
async function deliver(params: EmailParams): Promise<{ success: boolean; messageId?: string }> {
  const apiKey = process.env.SENDGRID_API_KEY;

  if (!apiKey) {
    console.warn(
      "[email] No SENDGRID_API_KEY — message NOT sent (log-only mode).\n" +
      `  To: ${params.to}\n  Subject: ${params.subject}`,
    );
    return { success: false };
  }

  try {
    const sgMail = (await import("@sendgrid/mail")).default;
    sgMail.setApiKey(apiKey);

    const msg: Record<string, unknown> = {
      to:      params.to,
      from:    params.from,
      subject: params.subject,
      text:    params.text ?? (params.html ? "" : " "),
    };
    if (params.replyTo) msg.replyTo = params.replyTo;

    if (params.html)        msg.html        = params.html;
    if (params.attachments?.length) msg.attachments = params.attachments;

    const [response] = await sgMail.send(msg as any);

    const messageId =
      (response.headers as Record<string, string>)?.["x-message-id"] ??
      (response.headers as Record<string, string>)?.["X-Message-Id"];

    console.log(
      `[email] ✓ delivered → ${params.to} | subject="${params.subject}" | msgId=${messageId ?? "none"}`,
    );

    return { success: true, messageId };
  } catch (err: any) {
    const detail = err?.response?.body ?? err?.message ?? String(err);
    console.error(`[email] ✗ SendGrid error → ${params.to} | subject="${params.subject}"`, detail);
    return { success: false };
  }
}

/**
 * sendEmail — drop-in replacement for the old console-only stub.
 * All existing callers (carrier notifications, support messages, welcome emails)
 * now actually deliver via SendGrid.
 */
export async function sendEmail(params: EmailParams): Promise<boolean> {
  const { success } = await deliver(params);
  return success;
}

/**
 * sendEmailTracked — same as sendEmail but also returns the SendGrid message ID
 * so the broker follow-up engine can store it for delivery-status webhook matching.
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
      from:        'dosh@truckingprosfinancial.com',
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
