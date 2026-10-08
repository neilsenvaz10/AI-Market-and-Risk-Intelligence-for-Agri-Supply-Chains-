/**
 * FASALYTICS welcome email (sent once, after registration is fully complete).
 * Distinct from Firebase's verification email, which only confirms the address.
 * Copy avoids claiming that later-phase features are already live.
 */

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** "+919876543210" -> "+91 ••••••3210" */
export function maskPhone(e164) {
  if (!e164) return 'Not provided';
  const digits = e164.replace(/\D/g, '');
  const country = e164.startsWith('+91') ? '+91' : `+${digits.slice(0, digits.length - 10)}`;
  return `${country} ••••••${digits.slice(-4)}`;
}

export function buildWelcomeEmail({ fullName, email, phoneNumber, dashboardUrl }) {
  const subject = 'Welcome to FASALYTICS — Your Account Is Ready';
  const maskedPhone = maskPhone(phoneNumber);

  const text = [
    `Hello ${fullName},`,
    '',
    'Welcome to FASALYTICS!',
    '',
    'Your farmer account has been successfully registered.',
    '',
    'You can now sign in to your personalised dashboard. Market intelligence features such as mandi',
    'comparisons and crop price insights are being rolled out in upcoming releases, and we will let you',
    'know as they become available.',
    '',
    `Account Email: ${email}`,
    `Registered Mobile: ${maskedPhone}`,
    '',
    dashboardUrl ? `Open your dashboard: ${dashboardUrl}` : null,
    dashboardUrl ? '' : null,
    'Thank you for joining FASALYTICS.',
    '',
    'Smarter Markets. Better Harvest Returns.',
    'Team FASALYTICS',
    '',
    'You received this email because an account was registered with this address. If this was not you, please ignore this email.',
  ].filter((line) => line !== null).join('\n');

  // Inline styles only (email clients strip <style>). Colors from the Stitch design tokens.
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f6fbf1;font-family:Inter,Arial,Helvetica,sans-serif;color:#181d17;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6fbf1;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #c1c9be;">
        <tr><td style="background:#00260d;padding:20px 24px;">
          <span style="font-family:'Barlow Condensed',Arial Narrow,Arial,sans-serif;font-size:26px;font-weight:700;letter-spacing:0.5px;color:#ffffff;text-transform:uppercase;">Fasalytics</span>
        </td></tr>
        <tr><td style="padding:28px 24px 8px;">
          <p style="margin:0 0 16px;font-size:16px;line-height:24px;">Hello ${escapeHtml(fullName)},</p>
          <p style="margin:0 0 12px;font-family:'Barlow Condensed',Arial Narrow,Arial,sans-serif;font-size:22px;line-height:28px;font-weight:600;color:#00260d;">Welcome to FASALYTICS!</p>
          <p style="margin:0 0 12px;font-size:14px;line-height:20px;">Your farmer account has been successfully registered.</p>
          <p style="margin:0 0 20px;font-size:14px;line-height:20px;color:#414941;">You can now sign in to your personalised dashboard. Market intelligence features such as mandi comparisons and crop price insights are being rolled out in upcoming releases, and we will let you know as they become available.</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f5eb;border-radius:8px;">
            <tr><td style="padding:14px 16px;font-size:14px;line-height:22px;">
              <strong>Account Email:</strong> ${escapeHtml(email)}<br>
              <strong>Registered Mobile:</strong> ${escapeHtml(maskedPhone)}
            </td></tr>
          </table>
          ${dashboardUrl ? `<p style="margin:24px 0 8px;"><a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;background:#086d39;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:8px;">Open your dashboard</a></p>` : ''}
          <p style="margin:24px 0 4px;font-size:14px;line-height:20px;">Thank you for joining FASALYTICS.</p>
          <p style="margin:0 0 4px;font-size:14px;line-height:20px;color:#086d39;font-weight:600;">Smarter Markets. Better Harvest Returns.</p>
          <p style="margin:0 0 24px;font-size:14px;line-height:20px;">Team FASALYTICS</p>
        </td></tr>
        <tr><td style="padding:14px 24px;background:#eaefe6;font-size:12px;line-height:16px;color:#414941;">
          You received this email because an account was registered with this address. If this was not you, please ignore this email.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}
