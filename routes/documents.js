const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { protect } = require('../middleware/auth');
const Document = require('../models/Document');
const AccessRequest = require('../models/AccessRequest');

// ⭐ Configure multer for document uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/documents/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'doc-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: function (req, file, cb) {
    const allowedTypes = /pdf|doc|docx|xls|xlsx|jpg|jpeg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype) || 
                     file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                     file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: PDF, DOC, DOCX, XLS, XLSX, Images'));
    }
  }
});

// Helper function to determine file type
function getFileType(mimetype, ext) {
  if (mimetype.includes('pdf')) return 'pdf';
  if (mimetype.includes('word') || ext === '.doc' || ext === '.docx') return 'word';
  if (mimetype.includes('excel') || mimetype.includes('spreadsheet') || ext === '.xls' || ext === '.xlsx') return 'excel';
  if (mimetype.includes('image')) return 'image';
  return 'other';
}

// ⭐ Upload document
router.post('/upload', protect, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: 'No file uploaded' 
      });
    }
    
    const { description, category, requestId, isPublic } = req.body;
    
    const ext = path.extname(req.file.originalname).toLowerCase();
    const fileType = getFileType(req.file.mimetype, ext);
    
    const document = await Document.create({
      owner: req.user.id,
      request: requestId || null,
      fileName: req.file.filename,
      originalFileName: req.file.originalname,
      fileType,
      mimeType: req.file.mimetype,
      fileSize: req.file.size,
      fileUrl: '/uploads/documents/' + req.file.filename,
      description: description || '',
      category: category || 'other',
      isPublic: isPublic === 'true' || false
    });
    
    res.json({
      success: true,
      message: 'Document uploaded successfully',
      document: {
        id: document._id,
        fileName: document.originalFileName,
        fileType: document.fileType,
        fileSize: document.fileSize,
        category: document.category,
        uploadedAt: document.createdAt
      }
    });
  } catch (error) {
    console.error('Upload document error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Error uploading document' 
    });
  }
});

// ⭐ Get my documents
router.get('/my-documents', protect, async (req, res) => {
  try {
    const { category, requestId } = req.query;
    
    const query = { owner: req.user.id };
    if (category) query.category = category;
    if (requestId) query.request = requestId;
    
    const documents = await Document.find(query)
      .populate('request', 'title service')
      .sort('-createdAt')
      .lean();
    
    res.json({
      success: true,
      count: documents.length,
      documents
    });
  } catch (error) {
    console.error('Get documents error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching documents' 
    });
  }
});

// ⭐ Get single document (with access control)
router.get('/:id', protect, async (req, res) => {
  try {
    const document = await Document.findById(req.params.id)
      .populate('owner', 'name email')
      .populate('request', 'title');
    
    if (!document) {
      return res.status(404).json({ 
        success: false, 
        message: 'Document not found' 
      });
    }
    
    // Check access
    const isOwner = document.owner._id.toString() === req.user.id;
    const hasAccess = document.grantedAccess.some(
      access => access.expert.toString() === req.user.id
    );
    
    if (!isOwner && !hasAccess && !document.isPublic) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Please request access from the owner.',
        canRequestAccess: true
      });
    }
    
    // Increment view count
    document.viewCount += 1;
    await document.save();
    
    res.json({
      success: true,
      document: {
        id: document._id,
        fileName: document.originalFileName,
        fileType: document.fileType,
        fileSize: document.fileSize,
        fileUrl: isOwner || hasAccess ? document.fileUrl : null,
        description: document.description,
        category: document.category,
        owner: document.owner,
        canDownload: isOwner || hasAccess,
        uploadedAt: document.createdAt
      }
    });
  } catch (error) {
    console.error('Get document error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching document' 
    });
  }
});

// ⭐ Download document (with access control)
router.get('/:id/download', protect, async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);
    
    if (!document) {
      return res.status(404).json({ 
        success: false, 
        message: 'Document not found' 
      });
    }
    
    // Check access
    const isOwner = document.owner.toString() === req.user.id;
    const hasAccess = document.grantedAccess.some(
      access => access.expert.toString() === req.user.id
    );
    
    if (!isOwner && !hasAccess && !document.isPublic) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied' 
      });
    }
    
    // Increment download count
    document.downloadCount += 1;
    await document.save();
    
    // Send file
    const filePath = path.join(__dirname, '..', document.fileUrl);
    res.download(filePath, document.originalFileName);
    
  } catch (error) {
    console.error('Download document error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error downloading document' 
    });
  }
});

// ⭐ Delete document
router.delete('/:id', protect, async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);
    
    if (!document) {
      return res.status(404).json({ 
        success: false, 
        message: 'Document not found' 
      });
    }
    
    if (document.owner.toString() !== req.user.id) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized' 
      });
    }
    
    // Delete file from disk (optional - be careful)
    // const fs = require('fs');
    // const filePath = path.join(__dirname, '..', document.fileUrl);
    // fs.unlinkSync(filePath);
    
    await document.deleteOne();
    
    res.json({
      success: true,
      message: 'Document deleted successfully'
    });
  } catch (error) {
    console.error('Delete document error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error deleting document' 
    });
  }
});

// ⭐ Update document details
router.put('/:id', protect, async (req, res) => {
  try {
    const { description, category, isPublic } = req.body;
    
    const document = await Document.findById(req.params.id);
    
    if (!document) {
      return res.status(404).json({ 
        success: false, 
        message: 'Document not found' 
      });
    }
    
    if (document.owner.toString() !== req.user.id) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized' 
      });
    }
    
    if (description !== undefined) document.description = description;
    if (category) document.category = category;
    if (isPublic !== undefined) document.isPublic = isPublic;
    
    await document.save();
    
    res.json({
      success: true,
      message: 'Document updated successfully',
      document
    });
  } catch (error) {
    console.error('Update document error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error updating document' 
    });
  }
});

// ⭐ Get documents for a specific request (with access control)
router.get('/request/:requestId', protect, async (req, res) => {
  try {
    const documents = await Document.find({ 
      request: req.params.requestId 
    })
    .populate('owner', 'name')
    .lean();
    
    // Filter based on access
    const accessibleDocs = documents.map(doc => {
      const isOwner = doc.owner._id.toString() === req.user.id;
      const hasAccess = doc.grantedAccess?.some(
        access => access.expert.toString() === req.user.id
      );
      
      return {
        ...doc,
        canAccess: isOwner || hasAccess || doc.isPublic,
        isLocked: !isOwner && !hasAccess && !doc.isPublic
      };
    });
    
    res.json({
      success: true,
      count: accessibleDocs.length,
      documents: accessibleDocs
    });
  } catch (error) {
    console.error('Get request documents error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching documents' 
    });
  }
});

module.exports = router;
