const express = require('express');
const { PDFDocument, StandardFonts, PDFName, PDFString, TextAlignment, rgb } = require('pdf-lib');
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

// --- ROUTE 1: UPLOAD PDF ---
app.post('/upload', upload.single('pdf'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ filename: req.file.filename });
});

// --- ROUTE 2: PROCESS PDF (Using YOUR Custom Logic) ---
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
        
        // Embed Font
        const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const form = pdfDoc.getForm();

        // CONSTANT: Matches Frontend Width
        const FRONTEND_WIDTH = 800;

        fields.forEach((fieldData) => {
            const pageIndex = fieldData.page || 0;
            if (pageIndex >= pdfDoc.getPageCount()) return;
            
            const page = pdfDoc.getPage(pageIndex);
            
            // --- YOUR SCALING LOGIC ---
            const { width: pdfWidth, height: pdfHeight } = page.getSize();
            const scaleFactor = pdfWidth / FRONTEND_WIDTH;

            const scaledX = fieldData.x * scaleFactor;
            const scaledY = fieldData.y * scaleFactor;
            const scaledW = fieldData.w * scaleFactor;
            const scaledH = fieldData.h * scaleFactor;

            // PDF Coordinate Calculation (Bottom-Left Origin)
            const pdfY = pdfHeight - scaledY - scaledH;

            // --- FIELD NAME HANDLING ---
            // We attempt to use the EXACT name. 
            // If it ends in a dot, we append a space to prevent the crash.
            let fieldName = fieldData.name || fieldData.id;
            
            // Prevent Duplicate Names Crash
            if (form.getFields().some(f => f.getName() === fieldName)) {
                fieldName = `${fieldName} (Copy)`; // Simple suffix
            }

            if (fieldData.type === 'checkbox') {
                try {
                    const checkBox = form.createCheckBox(fieldName);
                    if (fieldData.required) checkBox.enableRequired();
                    
                    checkBox.addToPage(page, {
                        x: scaledX,
                        y: pdfY,
                        width: scaledW,
                        height: scaledH,
                        borderWidth: 0,
                        backgroundColor: rgb(1, 1, 1), // White background
                    });
                } catch (err) {
                    console.error(`Skipping Checkbox "${fieldName}": ${err.message}`);
                }
            } else {
                // TEXT FIELD LOGIC
                try {
                    let textField;
                    try {
                        textField = form.createTextField(fieldName);
                    } catch (err) {
                        // FALLBACK: If "Periods" error, append a space to make it valid but keep the dot
                        if (err.message.includes('Periods in PDF field names')) {
                            console.warn(`Fixing invalid name: "${fieldName}" -> "${fieldName} "`);
                            textField = form.createTextField(fieldName + ' ');
                        } else {
                            throw err;
                        }
                    }

                    textField.setText(''); 

                    // --- YOUR FONT SIZE & DA LOGIC ---
                    const fontSize = (fieldData.fontSize || 11) * scaleFactor;
                    
                    // Manually set Default Appearance string (Your old code logic)
                    const daString = `/Helv ${fontSize} Tf 0 g`;
                    textField.acroField.dict.set(PDFName.of('DA'), PDFString.of(daString));

                    // --- ALIGNMENT ---
                    if (fieldData.align) {
                        switch (fieldData.align) {
                            case 'center': textField.setAlignment(TextAlignment.Center); break;
                            case 'right': textField.setAlignment(TextAlignment.Right); break;
                            case 'left': default: textField.setAlignment(TextAlignment.Left); break;
                        }
                    }

                    if (fieldData.required) textField.enableRequired();

                    // --- ADD TO PAGE (Using your specific styles) ---
                    textField.addToPage(page, {
                        x: scaledX,
                        y: pdfY,
                        width: scaledW,
                        height: scaledH,
                        font: helveticaFont, // Helper for widget appearance
                        borderWidth: 0, 
                        backgroundColor: rgb(1, 1, 1), // White background
                    });

                } catch (err) {
                    console.error(`Skipping Field "${fieldName}": ${err.message}`);
                }
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