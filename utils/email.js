const { Resend } = require('resend');

const sendEmail = async (options) => {
  if (!process.env.RESEND_API_KEY) {
    console.log('📧 EMAIL OTP:', options.message.match(/\d{6}/)?.[0] || 'No OTP found');
    return;
  }

  const resend = new Resend(process.env.RESEND_API_KEY);

  try {
    await resend.emails.send({
      from: 'WorkIndex <onboarding@resend.dev>',
      to: options.email,
      subject: options.subject,
      html: options.message
    });
    console.log('✉️ Email sent to:', options.email);
  } catch (error) {
    console.error('❌ Email error:', error);
    throw error;
  }
};

module.exports = sendEmail;
