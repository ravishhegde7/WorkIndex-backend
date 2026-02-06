const twilio = require('twilio');

let twilioClient = null;

if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

exports.sendSMS = async (phone, message) => {
  try {
    if (!twilioClient) {
      console.log('📱 SMS (Mock):', phone, message);
      return true;
    }
    await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: `+91${phone}`
    });
    return true;
  } catch (error) {
    console.error('SMS error:', error);
    return false;
  }
};

exports.sendOTPSMS = async (phone, otp) => {
  const message = `Your WorkIndex verification code is: ${otp}. Valid for 10 minutes.`;
  return await exports.sendSMS(phone, message);
};
