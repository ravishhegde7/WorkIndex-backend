const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

exports.sendEmail = async (options) => {
  try {
    await transporter.sendMail({
      from: `WorkIndex <${process.env.EMAIL_USER}>`,
      to: options.email,
      subject: options.subject,
      text: options.message,
      html: options.html
    });
    return true;
  } catch (error) {
    console.error('Email error:', error);
    return false;
  }
};

exports.sendOTPEmail = async (email, otp) => {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #FC8019;">WorkIndex Email Verification</h2>
      <p>Your verification code is:</p>
      <div style="background: #f5f5f5; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px;">
        ${otp}
      </div>
      <p>This code will expire in 10 minutes.</p>
    </div>
  `;
  return await exports.sendEmail({
    email,
    subject: 'WorkIndex - Email Verification Code',
    message: `Your verification code is: ${otp}`,
    html
  });
};
