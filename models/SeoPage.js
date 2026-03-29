const mongoose = require('mongoose');

const seoPageSchema = new mongoose.Schema({
  slug:            { type: String, required: true, unique: true },
  title:           { type: String, required: true },
  metaDescription: { type: String, required: true },
  metaKeywords:    { type: String },
  service:         { type: String },
  city:            { type: String },
  state:           { type: String },
  heroEyebrow:     { type: String },
  heroH1:          { type: String },
  heroH1Span:      { type: String },
  heroP:           { type: String },
  statsLabel:      { type: String },
  statsPrice:      { type: String },
  step1Title: String, step1P: String,
  step2Title: String, step2P: String,
  step3Title: String, step3P: String,
  step4Title: String, step4P: String,
  price1Label: String, price1Range: String, price1Desc: String,
  price2Label: String, price2Range: String, price2Desc: String,
  price3Label: String, price3Range: String, price3Desc: String,
  price4Label: String, price4Range: String, price4Desc: String,
  faq1Q: String, faq1A: String,
  faq2Q: String, faq2A: String,
  faq3Q: String, faq3A: String,
  faq4Q: String, faq4A: String,
  faq5Q: String, faq5A: String,
  ctaH2: String, ctaP: String,
  footerLinks: [{ href: String, label: String }],
  createdBy: { type: String },
  liveUrl: { type: String }
}, { timestamps: true });

module.exports = mongoose.models.SeoPage || mongoose.model('SeoPage', seoPageSchema);
