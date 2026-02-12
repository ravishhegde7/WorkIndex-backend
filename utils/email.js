// Simple email utility (no external dependencies)
// For production, integrate with SendGrid, AWS SES, or Nodemailer

const sendOTPEmail = async (email, otp) => {
  try {
    // Log to console instead of actually sending
    console.log(`📧 [EMAIL] OTP for ${email}: ${otp}`);
    console.log(`📧 In production, integrate with SendGrid/SES/Nodemailer`);
    return true;
  } catch (error) {
    console.error('Email send error:', error);
    return false;
  }
};

const sendWelcomeEmail = async (email, name) => {
  try {
    console.log(`📧 [EMAIL] Welcome email sent to ${name} (${email})`);
    return true;
  } catch (error) {
    console.error('Welcome email error:', error);
    return false;
  }
};

const sendNotificationEmail = async (email, subject, message) => {
  try {
    console.log(`📧 [EMAIL] To: ${email}`);
    console.log(`📧 [EMAIL] Subject: ${subject}`);
    console.log(`📧 [EMAIL] Message: ${message}`);
    return true;
  } catch (error) {
    console.error('Notification email error:', error);
    return false;
  }
};

module.exports = {
  sendOTPEmail,
  sendWelcomeEmail,
  sendNotificationEmail
};
