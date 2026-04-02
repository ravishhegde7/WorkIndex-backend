/**
 * routes/serviceCategories.js
 * Mounted at: /api/admin/service-categories
 * 
 * Manages service categories + questionnaires.
 * On create/update/delete, regenerates services-config.js
 * and pushes it to GitHub so Vercel auto-deploys.
 */

const express  = require('express');
const router   = express.Router();
const jwt      = require('jsonwebtoken');
const Admin    = require('../models/Admin');
const ServiceCategory = require('../models/ServiceCategory');

// ── Reuse admin protect middleware ──────────────────────────
const protect = async (req, res, next) => {
  try {
    const token = req.headers.authorization && req.headers.authorization.replace('Bearer ', '');
    if (!token) return res.status(401).json({ success: false, message: 'No token' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.isAdmin) return res.status(403).json({ success: false });
    req.admin = await Admin.findById(decoded.id);
    if (!req.admin || !req.admin.isActive) return res.status(403).json({ success: false });
    next();
  } catch (e) { res.status(401).json({ success: false }); }
};

function superOnly(req, res, next) {
  if (req.admin.role !== 'super_admin') {
    return res.status(403).json({ success: false, message: 'Super admin only' });
  }
  next();
}

// ── GitHub helpers ──────────────────────────────────────────
function githubApiGet(path, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path, method: 'GET',
      headers: {
        'Authorization': 'token ' + token,
        'User-Agent': 'WorkIndex-Admin',
        'Accept': 'application/vnd.github.v3+json'
      }
    };
    const req = require('https').request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) resolve(JSON.parse(data));
        else reject(new Error('GitHub GET ' + res.statusCode + ': ' + data.substring(0, 200)));
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function githubApiPut(path, token, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path, method: 'PUT',
      headers: {
        'Authorization': 'token ' + token,
        'User-Agent': 'WorkIndex-Admin',
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = require('https').request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 201)
          resolve(JSON.parse(data));
        else
          reject(new Error('GitHub PUT ' + res.statusCode + ': ' + data.substring(0, 200)));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Generate services-config.js content from DB ────────────
function generateServicesConfig(categories) {
  // Build the list, labels, colors, icons
  const list = categories.map(c => ({
    value: c.value,
    label: c.label,
    icon:  c.icon,
    color: c.color
  }));

  // Build search aliases merged from all categories
  const allAliases = {};
  categories.forEach(c => {
    (c.searchAliases || '').split(',').forEach(alias => {
      const a = alias.trim().toLowerCase();
      if (a) allAliases[a] = c.value;
    });
    // Always include the value itself as an alias
    allAliases[c.value] = c.value;
    allAliases[c.label.toLowerCase()] = c.value;
  });

  // Build creditCost and maxApproaches maps
  const creditCost = {}, maxApproaches = {};
  categories.forEach(c => {
    creditCost[c.value]    = c.creditCost    || 20;
    maxApproaches[c.value] = c.maxApproaches || 5;
  });

   // ── Build nested questionnaire structure ──
  const byService = {};
  categories.forEach(c => {
    byService[c.value] = (c.questions || []).map(q => ({
      id:          q.id,
      key:         q.id,   // key = id for service-specific questions
      type:        q.type === 'radio'    ? 'single' :
                   q.type === 'checkbox' ? 'multi'  : q.type,
      title:       q.question,
      required:    q.required,
      ...(q.alias       ? { alias: q.alias }             : {}),
      ...(q.placeholder ? { placeholder: q.placeholder } : {}),
      options: (q.options || []).map(o => ({
        value: o.value,
        label: o.label
      }))
    }));
  });
 
  const questionnaire = `  questionnaire: {
 
    serviceSelection: {
      id: 'service', key: 'service',
      type: 'service-picker', required: true,
      title: 'What service do you need?',
      subtitle: 'Select the category that best matches your requirement',
      useServiceList: true,
    },
 
    byService: ${JSON.stringify(byService, null, 6)},
 
    common: {
      serviceLocationType: {
        id: 'service_location_type', key: 'serviceLocationType',
        type: 'single', required: true,
        title: 'Where do you need the service?',
        options: [
          { value: 'online',              label: 'Online / Remotely',          icon: '💻' },
          { value: 'my-location',         label: 'At my location',             icon: '🏠' },
          { value: 'professional-office', label: 'At professional office',     icon: '🏢' },
        ],
      },
      fullAddress: {
        id: 'full_address', key: 'fullAddress',
        type: 'address', required: true,
        title: 'Enter your address',
        fields: [
          { key: 'building', label: 'Flat / Building / House No.', placeholder: 'e.g. 4B, Sunrise Apartments', required: true },
          { key: 'area',     label: 'Area / Street / Locality',    placeholder: 'e.g. Koramangala 5th Block',  required: true },
          { key: 'pincode',  label: 'Pincode',                     placeholder: 'e.g. 560095',                required: true, type: 'pincode' },
          { key: 'city',     label: 'City',                        placeholder: 'e.g. Bengaluru',             required: true },
          { key: 'state',    label: 'State',                       placeholder: 'e.g. Karnataka',             required: true },
          { key: 'landmark', label: 'Landmark (optional)',         placeholder: 'e.g. Near Indiranagar metro', required: false },
        ],
      },
      clientLocation: {
        id: 'client_location', key: 'clientLocation',
        type: 'address-simple', required: true,
        title: 'Where are you based?',
        fields: [
          { key: 'pincode', label: 'Pincode', placeholder: 'e.g. 560095', required: true, type: 'pincode' },
          { key: 'city',    label: 'City',    placeholder: 'e.g. Bengaluru', required: true },
          { key: 'state',   label: 'State',   placeholder: 'e.g. Karnataka', required: true },
        ],
      },
      urgency: {
        id: 'urgency', key: 'urgency',
        type: 'single', required: true,
        title: 'When do you need this done?',
        options: [
          { value: 'immediate', label: 'Immediately (within 24 hours)', icon: '🔴' },
          { value: '2-3days',   label: 'Within 2–3 days',               icon: '🟠' },
          { value: 'week',      label: 'Within a week',                  icon: '🟡' },
          { value: 'month',     label: 'Within a month',                 icon: '🟢' },
          { value: 'flexible',  label: 'Flexible / No rush',             icon: '🔵' },
        ],
      },
      budget: {
        id: 'budget', key: 'budget',
        type: 'budget', required: false,
        title: 'What is your budget?',
        min: 100, max: 500000, step: 100, currency: '₹',
        placeholder: 'Enter your budget in ₹',
      },
      description: {
        id: 'description', key: 'description',
        type: 'textarea', required: true,
        title: 'Describe your requirement',
        placeholder: 'Please describe what you need in detail...',
        minLength: 20,
      },
      preferredProfessional: {
        id: 'preferred_professional', key: 'preferredProfessional',
        type: 'single', required: false,
        title: 'What type of professional do you prefer?',
        options: [
          { value: 'individual_ca', label: 'Individual CA / Freelancer', icon: '👤' },
          { value: 'firm',          label: 'CA Firm / Agency',           icon: '🏢' },
          { value: 'no_preference', label: 'No preference',              icon: '🤷' },
        ],
      },
      contactMethod: {
        id: 'contact_method', key: 'contactMethod',
        type: 'single', required: true,
        title: 'How should professionals contact you?',
        options: [
          { value: 'platform_chat', label: 'Chat on WorkIndex',     icon: '💬' },
          { value: 'phone',         label: 'Phone call / WhatsApp', icon: '📞' },
          { value: 'email',         label: 'Email',                  icon: '✉️' },
          { value: 'any',           label: 'Any method is fine',     icon: '✅' },
        ],
      },
    },
 
    expert: [
      {
        id: 'expert_services', key: 'servicesOffered',
        type: 'multi', required: true,
        title: 'What services do you offer?',
        useServiceList: true,
      },
      {
        id: 'expert_specialization', key: 'specialization',
        type: 'single', required: true,
        title: 'What is your primary specialization?',
        options: [
          { value: 'Chartered Accountant', label: 'Chartered Accountant (CA)', icon: '🎓' },
          { value: 'Cost Accountant',       label: 'Cost Accountant (CMA)',     icon: '🎓' },
          { value: 'Tax Consultant',        label: 'Tax Consultant',            icon: '📄' },
          { value: 'GST Consultant',        label: 'GST Consultant',            icon: '🧾' },
          { value: 'Bookkeeper',            label: 'Bookkeeper / Accountant',   icon: '📊' },
          { value: 'Photographer',         label: 'Photographer',              icon: '📷' },
          { value: 'Web Developer',        label: 'Web / App Developer',       icon: '💻' },
          { value: 'Other',                label: 'Other Professional',         icon: '🔧' },
        ],
      },
      {
        id: 'expert_experience', key: 'yearsOfExperience',
        type: 'single', required: true,
        title: 'How many years of experience do you have?',
        options: [
          { value: '0-1',  label: 'Less than 1 year',   icon: '🌱' },
          { value: '1-3',  label: '1 – 3 years',        icon: '📈' },
          { value: '3-5',  label: '3 – 5 years',        icon: '📈' },
          { value: '5-10', label: '5 – 10 years',       icon: '⭐' },
          { value: '10+',  label: 'More than 10 years', icon: '🏆' },
        ],
      },
      {
        id: 'expert_location', key: 'serviceLocationType',
        type: 'single', required: true,
        title: 'Where do you prefer to work?',
        options: [
          { value: 'online', label: 'Online / Remotely only',      icon: '💻' },
          { value: 'local',  label: 'Local (in-person preferred)', icon: '📍' },
          { value: 'both',   label: 'Both online and in-person',  icon: '🌐' },
        ],
      },
      {
        id: 'expert_city', key: 'city',
        type: 'single', required: true,
        title: 'Which city are you based in?',
        options: [], placeholder: 'Enter your city', isTextInput: true,
      },
      {
        id: 'expert_state', key: 'state',
        type: 'single', required: true,
        title: 'Which state are you in?',
        options: [
          { value: 'Karnataka',      label: 'Karnataka' },
          { value: 'Maharashtra',    label: 'Maharashtra' },
          { value: 'Tamil Nadu',     label: 'Tamil Nadu' },
          { value: 'Delhi',          label: 'Delhi' },
          { value: 'Telangana',      label: 'Telangana' },
          { value: 'Gujarat',        label: 'Gujarat' },
          { value: 'Rajasthan',      label: 'Rajasthan' },
          { value: 'West Bengal',    label: 'West Bengal' },
          { value: 'Uttar Pradesh',  label: 'Uttar Pradesh' },
          { value: 'Kerala',         label: 'Kerala' },
          { value: 'Andhra Pradesh', label: 'Andhra Pradesh' },
          { value: 'Punjab',         label: 'Punjab' },
          { value: 'Haryana',        label: 'Haryana' },
          { value: 'Madhya Pradesh', label: 'Madhya Pradesh' },
          { value: 'Bihar',          label: 'Bihar' },
          { value: 'Other',          label: 'Other' },
        ],
      },
      {
        id: 'expert_pincode', key: 'pincode',
        type: 'single', required: true,
        title: 'What is your pincode?',
        options: [], placeholder: 'Enter 6-digit pincode', isTextInput: true,
      },
      {
        id: 'expert_bio', key: 'bio',
        type: 'textarea', required: true,
        title: 'Tell clients about yourself',
        placeholder: 'e.g. I am a CA with 8 years of experience...',
        minLength: 50,
      },
    ],
 
  },`;

  // Build answerTagFormatters — simple string-based representation
  // (Runtime eval not used — we generate a static JS object)
  const formatterLines = [];
  categories.forEach(c => {
    (c.questions || []).forEach(q => {
      let fmt = null;
      if (q.id.includes('Income') || q.id.includes('Turnover'))
        fmt = `function(v){ return v.replace('above','> ').replace('below','< '); }`;
      else if (q.type === 'checkbox')
        fmt = `function(v){ return Array.isArray(v) ? v.join(', ') : v; }`;
      else if (q.id.includes('Type') || q.id.includes('taxpayer'))
        fmt = `function(v){ return v.charAt(0).toUpperCase() + v.slice(1); }`;
      else if (q.id.includes('Frequency') || q.id.includes('Duration') || q.id.includes('Timeline'))
        fmt = `function(v){ return v.replace(/-/g,' '); }`;
      else if (q.id.includes('audit'))
        fmt = `function(v){ return v.replace(/_/g,' ') + ' audit'; }`;
      else if (q.id.includes('Transactions'))
        fmt = `function(v){ return v + ' txns/mo'; }`;

      if (fmt) {
        formatterLines.push(`    ${q.id}: ${fmt}`);
      }
    });
  });

  return `/**
 * WorkIndex — Service Category & Questionnaire Configuration
 * ============================================================
 * AUTO-GENERATED by WorkIndex Admin CMS.
 * DO NOT edit manually — use the admin panel to modify.
 * Generated: ${new Date().toISOString()}
 */

const WI_SERVICES = {

  // ─── Master list of all service categories ──────────────
  list: ${JSON.stringify(list, null, 4)},

  // ─── Quick lookup maps (auto-generated from list) ───────
  get labels() {
    const m = {};
    this.list.forEach(s => m[s.value] = s.label);
    return m;
  },
  get colors() {
    const m = {};
    this.list.forEach(s => m[s.value] = s.color);
    return m;
  },
  get icons() {
    const m = {};
    this.list.forEach(s => m[s.value] = s.icon);
    return m;
  },

  // ─── Landing page search aliases ────────────────────────
  searchAliases: ${JSON.stringify(allAliases, null, 4)},

  // ─── Credit cost per service ─────────────────────────────
  creditCost: ${JSON.stringify(creditCost, null, 4)},

  // ─── Max approaches per request ──────────────────────────
  maxApproaches: ${JSON.stringify(maxApproaches, null, 4)},

  // ─── Questionnaire steps per service ─────────────────────
  questionnaire: ${JSON.stringify(questionnaire, null, 4)},

  // ─── Answer tag formatters (for browse cards) ────────────
  answerTagFormatters: {
${formatterLines.join(',\n')}
  },

};

Object.freeze(WI_SERVICES);
`;
}

// ── Push services-config.js to GitHub ──────────────────────
async function pushServicesConfig(content) {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_REPO  = 'ravishhegde7/WorkIndex';
  const FILE_PATH    = 'services-config.js';

  if (!GITHUB_TOKEN) throw new Error('GITHUB_TOKEN not set in Railway env vars');

  let sha = null;
  try {
    const existing = await githubApiGet(
      '/repos/' + GITHUB_REPO + '/contents/' + FILE_PATH,
      GITHUB_TOKEN
    );
    sha = existing.sha;
  } catch(e) { /* file doesn't exist yet */ }

  const body = JSON.stringify({
    message: 'Update services-config.js via Admin CMS',
    content: Buffer.from(content).toString('base64'),
    ...(sha ? { sha } : {})
  });

  return githubApiPut(
    '/repos/' + GITHUB_REPO + '/contents/' + FILE_PATH,
    GITHUB_TOKEN,
    body
  );
}

// ── Regenerate and push config ──────────────────────────────
async function syncToGitHub() {
  const categories = await ServiceCategory.find({ isActive: true }).sort({ sortOrder: 1, createdAt: 1 });
  const content = generateServicesConfig(categories);
  await pushServicesConfig(content);
  return content;
}

// ===========================================================
// ROUTES
// ===========================================================

// GET all categories
router.get('/', protect, async (req, res) => {
  try {
    const categories = await ServiceCategory.find({}).sort({ sortOrder: 1, createdAt: 1 });
    res.json({ success: true, categories, total: categories.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET single category
router.get('/:id', protect, async (req, res) => {
  try {
    const cat = await ServiceCategory.findById(req.params.id);
    if (!cat) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, category: cat });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// CREATE category
router.post('/', protect, superOnly, async (req, res) => {
  try {
    const { value, label, icon, color, creditCost, maxApproaches,
            questions, searchAliases, sortOrder, landingPricing } = req.body;

    if (!value || !label) {
      return res.status(400).json({ success: false, message: 'value and label are required' });
    }

    // Sanitise value
    const cleanValue = value.toLowerCase().replace(/[^a-z0-9_]/g, '_');

    const exists = await ServiceCategory.findOne({ value: cleanValue });
    if (exists) return res.status(400).json({ success: false, message: 'Service value "' + cleanValue + '" already exists' });

    const cat = await ServiceCategory.create({
      value:       cleanValue,
      label,
      icon:        icon  || '🔧',
      color:       color || '#FC8019',
      creditCost:  creditCost  || 20,
      maxApproaches: maxApproaches || 5,
      questions:   questions  || [],
      searchAliases: searchAliases || '',
      sortOrder:   sortOrder  || 99,
      landingPricing: landingPricing || [],
      createdBy:   req.admin.adminId
    });

    // Push updated config to GitHub
    let githubPushed = false;
    try {
      await syncToGitHub();
      githubPushed = true;
    } catch(e) {
      console.error('GitHub push failed (non-fatal):', e.message);
    }

    res.status(201).json({
      success: true,
      message: 'Category created' + (githubPushed ? ' and services-config.js updated on GitHub (Vercel deploys in ~60s)' : ' — GitHub push failed, check GITHUB_TOKEN'),
      category: cat,
      githubPushed
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// UPDATE category
router.put('/:id', protect, superOnly, async (req, res) => {
  try {
    const cat = await ServiceCategory.findById(req.params.id);
    if (!cat) return res.status(404).json({ success: false, message: 'Not found' });

    const allowed = ['label','icon','color','creditCost','maxApproaches',
                     'questions','searchAliases','sortOrder','isActive','landingPricing'];
    allowed.forEach(field => {
      if (req.body[field] !== undefined) {
        cat[field] = req.body[field];
      }
    });

    // Mark nested arrays as modified for Mongoose
    if (req.body.questions)     cat.markModified('questions');
    if (req.body.landingPricing) cat.markModified('landingPricing');

    await cat.save();

    let githubPushed = false;
    try {
      await syncToGitHub();
      githubPushed = true;
    } catch(e) {
      console.error('GitHub push failed (non-fatal):', e.message);
    }

    res.json({
      success: true,
      message: 'Category updated' + (githubPushed ? ' and GitHub synced' : ' — GitHub push failed'),
      category: cat,
      githubPushed
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE category
router.delete('/:id', protect, superOnly, async (req, res) => {
  try {
    const cat = await ServiceCategory.findById(req.params.id);
    if (!cat) return res.status(404).json({ success: false, message: 'Not found' });

    await ServiceCategory.findByIdAndDelete(req.params.id);

    let githubPushed = false;
    try {
      await syncToGitHub();
      githubPushed = true;
    } catch(e) {
      console.error('GitHub push failed (non-fatal):', e.message);
    }

    res.json({
      success: true,
      message: 'Category deleted' + (githubPushed ? ' and GitHub synced' : ' — GitHub push failed'),
      githubPushed
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PREVIEW generated config (without pushing to GitHub)
router.get('/preview/config', protect, async (req, res) => {
  try {
    const categories = await ServiceCategory.find({ isActive: true }).sort({ sortOrder: 1 });
    const content = generateServicesConfig(categories);
    res.json({ success: true, content });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// FORCE PUSH current DB state to GitHub
router.post('/sync', protect, superOnly, async (req, res) => {
  try {
    await syncToGitHub();
    res.json({ success: true, message: 'services-config.js pushed to GitHub. Vercel deploys in ~60s.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'GitHub push failed: ' + err.message });
  }
});

// SEED default categories from existing services-config.js values
// POST /api/admin/service-categories/seed
router.post('/seed', protect, superOnly, async (req, res) => {
  try {
    const existing = await ServiceCategory.countDocuments();
    if (existing > 0) {
      return res.status(400).json({ success: false, message: existing + ' categories already exist. Delete them first or use PUT to update.' });
    }

    const defaults = [
      {
        value: 'itr', label: 'ITR Filing', icon: '📄', color: '#8b5cf6',
        creditCost: 20, maxApproaches: 5, sortOrder: 1,
        searchAliases: 'itr filing,income tax,tax',
        questions: [
          { id: 'itrTaxpayerType', question: 'What is your taxpayer type?', type: 'radio', required: true, options: [
            { value: 'salaried',   label: '💼 Salaried Employee' },
            { value: 'business',   label: '🏢 Business Owner / Self-Employed' },
            { value: 'freelancer', label: '💻 Freelancer / Consultant' },
            { value: 'nri',        label: '🌍 NRI (Non-Resident Indian)' }
          ]},
          { id: 'itrAnnualIncome', question: 'What is your approximate annual income?', type: 'radio', required: true, options: [
            { value: 'below5L',  label: 'Below ₹5 Lakhs' },
            { value: '5L-10L',   label: '₹5 – ₹10 Lakhs' },
            { value: '10L-20L',  label: '₹10 – ₹20 Lakhs' },
            { value: 'above20L', label: 'Above ₹20 Lakhs' }
          ]},
          { id: 'itrUrgency', question: 'When do you need it filed?', type: 'radio', required: true, alias: 'urgency', options: [
            { value: 'immediate', label: '🔴 Immediately (within 24 hours)' },
            { value: '2-3days',   label: '🟠 Within 2–3 days' },
            { value: 'week',      label: '🟡 Within a week' },
            { value: 'flexible',  label: '🔵 Flexible / Before deadline' }
          ]}
        ]
      },
      {
        value: 'gst', label: 'GST Services', icon: '🧾', color: '#3b82f6',
        creditCost: 20, maxApproaches: 5, sortOrder: 2,
        searchAliases: 'gst,gst services',
        questions: [
          { id: 'gstServiceType', question: 'What GST service do you need?', type: 'radio', required: true, options: [
            { value: 'new_registration', label: '📋 New GST Registration' },
            { value: 'monthly_filing',   label: '📊 Monthly GSTR Filing' },
            { value: 'annual_return',    label: '📁 Annual GST Return (GSTR-9)' },
            { value: 'notice_handling',  label: '⚠️ GST Notice / Scrutiny' },
            { value: 'itc_reconciliation', label: '🔁 ITC Reconciliation' }
          ]},
          { id: 'gstTurnover', question: 'What is your monthly business turnover?', type: 'radio', required: true, options: [
            { value: 'below5L',  label: 'Below ₹5 Lakhs' },
            { value: '5L-20L',   label: '₹5 – ₹20 Lakhs' },
            { value: '20L-50L',  label: '₹20 – ₹50 Lakhs' },
            { value: 'above50L', label: 'Above ₹50 Lakhs' }
          ]},
          { id: 'gstUrgency', question: 'When do you need this?', type: 'radio', required: true, alias: 'urgency', options: [
            { value: 'immediate', label: '🔴 Immediately' },
            { value: '2-3days',   label: '🟠 Within 2–3 days' },
            { value: 'week',      label: '🟡 This week' },
            { value: 'flexible',  label: '🔵 Flexible' }
          ]}
        ]
      },
      {
        value: 'accounting', label: 'Accounting', icon: '📊', color: '#10b981',
        creditCost: 20, maxApproaches: 5, sortOrder: 3,
        searchAliases: 'accounting,bookkeeping',
        questions: [
          { id: 'accountingServiceType', question: 'What accounting service do you need?', type: 'radio', required: true, options: [
            { value: 'bookkeeping',     label: '📚 Monthly Bookkeeping' },
            { value: 'payroll',         label: '👥 Payroll Processing' },
            { value: 'annual_accounts', label: '📋 Annual Accounts Preparation' },
            { value: 'tds_filing',      label: '📄 TDS Filing' }
          ]},
          { id: 'accountingFrequency', question: 'How often do you need accounting support?', type: 'radio', required: true, options: [
            { value: 'monthly',   label: '📅 Monthly (ongoing)' },
            { value: 'quarterly', label: '🗓️ Quarterly' },
            { value: 'annual',    label: '📆 One-time / Annual' }
          ]},
          { id: 'accountingTransactions', question: 'How many transactions per month approximately?', type: 'radio', required: true, options: [
            { value: 'below50',  label: 'Below 50' },
            { value: '50-200',   label: '50 – 200' },
            { value: '200-500',  label: '200 – 500' },
            { value: 'above500', label: 'Above 500' }
          ]}
        ]
      },
      {
        value: 'audit', label: 'Audit', icon: '🔍', color: '#f59e0b',
        creditCost: 20, maxApproaches: 5, sortOrder: 4,
        searchAliases: 'audit,statutory audit',
        questions: [
          { id: 'auditType', question: 'What type of audit do you need?', type: 'radio', required: true, options: [
            { value: 'statutory_audit', label: '📋 Statutory Audit' },
            { value: 'tax_audit',       label: '📄 Tax Audit (Section 44AB)' },
            { value: 'internal_audit',  label: '🔍 Internal Audit' },
            { value: 'gst_audit',       label: '🧾 GST Audit' }
          ]},
          { id: 'auditTurnover', question: 'What is your annual business turnover?', type: 'radio', required: true, options: [
            { value: 'below1Cr',  label: 'Below ₹1 Crore' },
            { value: '1Cr-5Cr',   label: '₹1 – ₹5 Crore' },
            { value: '5Cr-20Cr',  label: '₹5 – ₹20 Crore' },
            { value: 'above20Cr', label: 'Above ₹20 Crore' }
          ]}
        ]
      },
      {
        value: 'photography', label: 'Photography', icon: '📷', color: '#ec4899',
        creditCost: 10, maxApproaches: 5, sortOrder: 5,
        searchAliases: 'photography,photo,photographer',
        questions: [
          { id: 'photographyType', question: 'What type of photography do you need?', type: 'radio', required: true, options: [
            { value: 'wedding',     label: '💍 Wedding Photography' },
            { value: 'portrait',    label: '🤳 Portrait / Headshots' },
            { value: 'product',     label: '📦 Product / E-Commerce' },
            { value: 'corporate',   label: '🏢 Corporate / Event' },
            { value: 'real_estate', label: '🏠 Real Estate / Architecture' }
          ]},
          { id: 'photographyDuration', question: 'How long is the shoot?', type: 'radio', required: true, alias: 'urgency', options: [
            { value: '1-2hours',  label: '1–2 hours' },
            { value: 'half-day',  label: 'Half day (3–5 hours)' },
            { value: 'full-day',  label: 'Full day' },
            { value: 'multi-day', label: 'Multiple days' }
          ]}
        ]
      },
      {
        value: 'development', label: 'Development', icon: '💻', color: '#06b6d4',
        creditCost: 15, maxApproaches: 5, sortOrder: 6,
        searchAliases: 'development,dev,web,website,app',
        questions: [
          { id: 'devProjectType', question: 'What type of project do you need?', type: 'radio', required: true, options: [
            { value: 'website',     label: '🌐 Website (informational)' },
            { value: 'ecommerce',   label: '🛒 E-Commerce Store' },
            { value: 'webapp',      label: '💻 Web Application / SaaS' },
            { value: 'mobile-app',  label: '📱 Mobile App (Android / iOS)' },
            { value: 'api',         label: '🔌 API / Backend Development' },
            { value: 'redesign',    label: '🎨 Website Redesign / Revamp' },
            { value: 'maintenance', label: '🔧 Maintenance / Bug Fix' }
          ]},
          { id: 'devTimeline', question: 'What is your project timeline?', type: 'radio', required: true, alias: 'urgency', options: [
            { value: 'immediate', label: '🔴 ASAP (within 1 week)' },
            { value: '2-3days',   label: '🟠 Within 2–4 weeks' },
            { value: 'month',     label: '🟡 1–3 months' },
            { value: 'flexible',  label: '🔵 Flexible' }
          ]}
        ]
      }
    ];

    const created = await ServiceCategory.insertMany(defaults);
    res.json({ success: true, message: 'Seeded ' + created.length + ' default categories', count: created.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
