// utils/emailService.js

const https = require('https');

function otpEmailHTML(otp, purpose) {
  const purposeText = {
    signup:          'verify your email address and activate your account',
    forgot_password: 'reset your password'
  }[purpose] || 'verify your account';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0"
        style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#FC8019;padding:32px 40px;text-align:center;">
            <div style="font-size:28px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">WorkIndex</div>
            <div style="font-size:13px;color:rgba(255,255,255,0.85);margin-top:4px;">Find Verified Professionals</div>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <h2 style="font-size:22px;font-weight:700;color:#1a1a1a;margin:0 0 12px;">Your verification code</h2>
            <p style="font-size:15px;color:#666666;line-height:1.6;margin:0 0 32px;">
              Use this code to ${purposeText}.<br>
              It expires in <strong>10 minutes</strong>.
            </p>
            <div style="background:#fff8f3;border:2px dashed #FC8019;border-radius:12px;padding:28px;text-align:center;margin-bottom:32px;">
              <div style="font-size:46px;font-weight:800;color:#FC8019;letter-spacing:14px;font-family:'Courier New',monospace;">
                ${otp}
              </div>
            </div>
            <p style="font-size:13px;color:#999999;line-height:1.6;margin:0;">
              If you didn't request this code, you can safely ignore this email.<br>
              <strong>Never share this code with anyone.</strong>
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f8f8f8;padding:20px 40px;text-align:center;border-top:1px solid #eeeeee;">
            <p style="font-size:12px;color:#bbbbbb;margin:0;">
              © ${new Date().getFullYear()} WorkIndex &nbsp;·&nbsp; All rights reserved
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendOTPEmail({ to, name, otp, purpose }) {
  const subjects = {
    signup:          `${otp} is your WorkIndex verification code`,
    forgot_password: `${otp} is your WorkIndex password reset code`
  };

  const payload = JSON.stringify({
    sender: { name: 'WorkIndex', email: process.env.BREVO_SMTP_USER },
    to: [{ email: to, name: name || to }],
    subject: subjects[purpose] || `${otp} — Your WorkIndex code`,
    htmlContent: otpEmailHTML(otp, purpose)
  });

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.brevo.com',
      path: '/v3/smtp/email',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'api-key': process.env.BREVO_API_KEY
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 201) {
          console.log(`✅ OTP email sent to ${to}`);
          resolve({ success: true });
        } else {
          console.error('❌ Brevo API error:', res.statusCode, data);
          resolve({ success: false, error: data });
        }
      });
    });

    req.on('error', (err) => {
      console.error('❌ Brevo request error:', err.message);
      resolve({ success: false, error: err.message });
    });

    req.write(payload);
    req.end();
  });
}

module.exports = { sendOTPEmail };
