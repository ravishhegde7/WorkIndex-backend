const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

const sendEmail = async (options) => {
  try {
    await resend.emails.send({
      from: 'WorkIndex <onboarding@resend.dev>',
      to: options.email,
      subject: options.subject,
      html: options.message
    });
    console.log('✉️ Email sent to:', options.email);
  } catch (error) {
    console.error('Email error:', error);
    throw error;
  }
};
