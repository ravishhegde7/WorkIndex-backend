const mongoose = require('mongoose');

const OptionSchema = new mongoose.Schema({
  
  value: { type: String, required: true },
  label: { type: String, required: true },
  icon:  { type: String },
  desc:  { type: String }
}, { _id: false });

// ── Question schema ──
const QuestionSchema = new mongoose.Schema({
  id:          { type: String, required: true },  // e.g. 'itrTaxpayerType'
  question:    { type: String, required: true },
  type: {
  type: String,
  enum: ['radio', 'checkbox', 'text', 'date', 'textarea', 'select', 'address', 'slider', 'pincode'], default: 'radio' },
  required:    { type: Boolean, default: true },
  alias:       { type: String },                   // e.g. 'urgency' for timeline mapping
  options:     [OptionSchema],
  placeholder:   { type: String },
  subtitle:      { type: String },
  sliderMin:     { type: Number },
  sliderMax:     { type: Number },
  sliderStep:    { type: Number },
  sliderDefault: { type: Number },
  sliderFormat:  { type: String },
  minLength:     { type: Number },
  maxLength:     { type: Number },
  validation:    { type: String },
  useServiceList:{ type: Boolean },
  addressFields: { type: mongoose.Schema.Types.Mixed }
}, { _id: false });

// ── Main ServiceCategory schema ──
const ServiceCategorySchema = new mongoose.Schema({
  // Core identity
  value:       { type: String, required: true, unique: true, lowercase: true, trim: true },
  label:       { type: String, required: true },
  icon:        { type: String, default: '🔧' },
  color:       { type: String, default: '#FC8019' },

  // Marketplace settings
  creditCost:     { type: Number, default: 20, min: 0 },
  maxApproaches:  { type: Number, default: 5,  min: 0 },
  isActive:       { type: Boolean, default: true },

  // Questionnaire steps
  questions:   [QuestionSchema],

  // Search aliases (comma-separated string for simplicity)
  searchAliases: { type: String, default: '' },

  // CTA / pricing guide copy for landing pages
  landingPricing: [{
    label: String,
    range: String,
    desc:  String
  }],

  // Meta
  createdBy:   { type: String, default: 'admin' },
  sortOrder:   { type: Number, default: 99 }

}, { timestamps: true });

// Helper to serialize to services-config.js format
ServiceCategorySchema.methods.toConfigObject = function() {
  var aliases = {};
  (this.searchAliases || '').split(',').forEach(function(alias) {
    var a = alias.trim().toLowerCase();
    if (a) aliases[a] = this.value;
  }.bind(this));

  return {
    value:       this.value,
    label:       this.label,
    icon:        this.icon,
    color:       this.color,
    creditCost:  this.creditCost,
    maxApproaches: this.maxApproaches,
    searchAliases: aliases,
    questionnaire: this.questions.map(function(q) {
      return {
        id:          q.id,
        question:    q.question,
        type:        q.type,
        required:    q.required,
        alias:       q.alias || undefined,
        placeholder: q.placeholder || undefined,
        options:     q.options.map(function(o) {
          return { value: o.value, label: o.label };
        })
      };
    })
  };
};

module.exports = mongoose.models.ServiceCategory ||
  mongoose.model('ServiceCategory', ServiceCategorySchema);
