// Simple SMS utility (no external dependencies)
// For production, integrate with Twilio, MSG91, or SMS Gateway

const sendOTPSMS = async (phone, otp) => {
  try {
    // Log to console instead of actually sending
    console.log(`📱 [SMS] OTP for +91${phone}: ${otp}`);
    console.log(`📱 In production, integrate with Twilio/MSG91`);
    return true;
  } catch (error) {
    console.error('SMS send error:', error);
    return false;
  }
};

const sendWelcomeSMS = async (phone, name) => {
  try {
    console.log(`📱 [SMS] Welcome SMS sent to ${name} (+91${phone})`);
    return true;
  } catch (error) {
    console.error('Welcome SMS error:', error);
    return false;
  }
};

const sendNotificationSMS = async (phone, message) => {
  try {
    console.log(`📱 [SMS] To: +91${phone}`);
    console.log(`📱 [SMS] Message: ${message}`);
    return true;
  } catch (error) {
    console.error('Notification SMS error:', error);
    return false;
  }
};

module.exports = {
  sendOTPSMS,
  sendWelcomeSMS,
  sendNotificationSMS
};
