import nodemailer from 'nodemailer';
import { log } from './utils.js';

// Sends an email over SMTP (e.g. Gmail with an app password). Never throws: a failed email must not stop the bot.
export async function notify(config, subject, text) {
  if (!config.smtp.user || !config.smtp.pass || !config.notifyEmail) {
    log(`email not configured, skipping notification: ${subject}`);
    return false;
  }

  try {
    const transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: { user: config.smtp.user, pass: config.smtp.pass }
    });

    await transport.sendMail({
      from: config.notifyFrom || config.smtp.user,
      to: config.notifyEmail,
      subject,
      text
    });

    log(`email sent to ${config.notifyEmail}: ${subject}`);
    return true;
  } catch (err) {
    log(`failed to send email: ${err.message}`);
    return false;
  }
}
