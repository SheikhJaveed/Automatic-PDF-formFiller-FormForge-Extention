const express = require('express');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = 5000;

// --- SETUP STORAGE ---
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => cb(null, `doc_${Date.now()}_${file.originalname}`)
});
const upload = multer({ storage });

// --- MIDDLEWARE ---
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use('/files', express.static(UPLOADS_DIR));

// --- HELPER: Sanitize Field Names ---
const sanitizeFieldName = (text) => {
    if (!text) return `field_${Date.now()}`;
    // Remove dots, slashes, and non-alphanumeric chars
    return text.replace(/\./g, '').replace(/[^\w\s-]/g, '').trim();
};

// --- ROUTE 1: UPLOAD PDF ---
app.post('/upload', upload.single('pdf'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ filename: req.file.filename });
});

// --- ROUTE 2: PROCESS PDF (With Font Fix) ---
app.post('/process-pdf', async (req, res) => {
    console.log("Received request at /process-pdf");

    try {
        const { filename, fields } = req.body;

        if (!filename || !fields) {
            return res.status(400).json({ error: 'Missing filename or fields' });
        }

        const filePath = path.join(UPLOADS_DIR, filename);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        const existingPdfBytes = fs.readFileSync(filePath);
        const pdfDoc = await PDFDocument.load(existingPdfBytes);
        
        // 1. EMBED FONT
        const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const form = pdfDoc.getForm();

        // CONSTANT: Matches App.jsx width
        const FRONTEND_WIDTH = 800;

        fields.forEach((fieldData) => {
            const pageIndex = fieldData.page || 0;
            if (pageIndex >= pdfDoc.getPageCount()) return;
            
            const page = pdfDoc.getPage(pageIndex);
            const { width: pageWidth, height: pageHeight } = page.getSize();

            // Calculate Scale
            const scaleFactor = pageWidth / FRONTEND_WIDTH;

            // Scale Coordinates
            const pdfX = fieldData.x * scaleFactor;
            const pdfW = fieldData.w * scaleFactor;
            const pdfH = fieldData.h * scaleFactor;
            const pdfY = pageHeight - (fieldData.y * scaleFactor) - pdfH;

            // Sanitize Name
            let fieldName = sanitizeFieldName(fieldData.name || fieldData.id);
            if (form.getFields().some(f => f.getName() === fieldName)) {
                fieldName = `${fieldName}_${Math.random().toString(36).substr(2, 5)}`;
            }

            if (fieldData.type === 'checkbox') {
                const checkBox = form.createCheckBox(fieldName);
                checkBox.addToPage(page, {
                    x: pdfX,
                    y: pdfY,
                    width: pdfW,
                    height: pdfH,
                });
                if (fieldData.required) checkBox.setRequired();
            } else {
                // --- TEXT FIELD LOGIC ---
                const textField = form.createTextField(fieldName);
                
                // Add to page first
                textField.addToPage(page, {
                    x: pdfX,
                    y: pdfY,
                    width: pdfW,
                    height: pdfH,
                });

                // --- CRITICAL FIX SEQUENCE ---
                // 1. Set temporary text (Required for updateAppearances to work)
                textField.setText(' '); 
                
                // 2. Update Appearances with the Font (Creates the /DA entry)
                textField.updateAppearances(helveticaFont);
                
                // 3. Set Font Size (Now safe because /DA exists)
                const rawFontSize = fieldData.fontSize || 11; 
                const scaledFontSize = rawFontSize * scaleFactor;
                textField.setFontSize(scaledFontSize);

                // 4. Clear the temporary text
                textField.setText('');

                if (fieldData.required) textField.setRequired();
            }
        });

        const pdfBytes = await pdfDoc.save();
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=edited_${filename}`);
        res.send(Buffer.from(pdfBytes));
        console.log("PDF processed successfully.");

    } catch (error) {
        console.error('Processing Error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});