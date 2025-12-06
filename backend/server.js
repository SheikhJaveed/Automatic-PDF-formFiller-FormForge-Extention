const express = require('express');
const { PDFDocument, StandardFonts, PDFName, PDFString, TextAlignment, rgb } = require('pdf-lib');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { spawn } = require('child_process'); // <--- CRITICAL IMPORT

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

// --- HELPER: RUN PYTHON SCRIPT ---
const detectFieldsWithPython = (filePath) => {
    return new Promise((resolve, reject) => {
        // Use 'python' for Windows. If on Mac/Linux, you might need 'python3'
        const pythonProcess = spawn('python', ['detector.py', filePath]);

        let dataString = '';
        let errorString = '';

        // Collect data from Python's print() statements
        pythonProcess.stdout.on('data', (data) => {
            dataString += data.toString();
        });

        // Collect errors
        pythonProcess.stderr.on('data', (data) => {
            errorString += data.toString();
        });

        pythonProcess.on('close', (code) => {
            if (errorString) {
                console.warn("Python Warnings/Errors:", errorString);
            }

            if (code !== 0) {
                reject("Python script exited with error code " + code);
                return;
            }

            try {
                // Parse the JSON array printed by Python
                const fields = JSON.parse(dataString);
                resolve(fields);
            } catch (e) {
                console.error("Failed to parse Python response:", dataString);
                reject("Invalid JSON from Python");
            }
        });
    });
};

// --- ROUTE 1: UPLOAD & DETECT ---
app.post('/upload', upload.single('pdf'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        console.log(`Analyzing PDF: ${req.file.filename}...`);

        // 1. Run the Python Auto-Detector
        const detectedFields = await detectFieldsWithPython(req.file.path);

        console.log(`Success! Detected ${detectedFields.length} fields.`);

        // 2. Return Filename AND Fields to Frontend
        res.json({ 
            filename: req.file.filename,
            fields: detectedFields 
        });

    } catch (error) {
        console.error("Detection Error:", error);
        res.status(500).json({ error: "Failed to analyze PDF" });
    }
});

// --- ROUTE 2: PROCESS & DOWNLOAD PDF ---
app.post('/process-pdf', async (req, res) => {
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
            
            // --- SCALING LOGIC ---
            const { width: pdfWidth, height: pdfHeight } = page.getSize();
            const scaleFactor = pdfWidth / FRONTEND_WIDTH;

            const scaledX = fieldData.x * scaleFactor;
            const scaledY = fieldData.y * scaleFactor;
            const scaledW = fieldData.w * scaleFactor;
            const scaledH = fieldData.h * scaleFactor;

            const pdfY = pdfHeight - scaledY - scaledH;

            // --- FIELD NAME HANDLING ---
            let fieldName = fieldData.name || fieldData.id;
            
            // Prevent Duplicate Names Crash
            if (form.getFields().some(f => f.getName() === fieldName)) {
                fieldName = `${fieldName}_${Date.now()}`; 
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
                        backgroundColor: rgb(1, 1, 1),
                    });
                } catch (err) {}
            } else {
                // TEXT FIELD
                try {
                    // Handle periods in names
                    if (fieldName.includes('.')) fieldName = fieldName.replace(/\./g, '_');

                    const textField = form.createTextField(fieldName);
                    textField.setText(''); 

                    const fontSize = (fieldData.fontSize || 11) * scaleFactor;
                    const daString = `/Helv ${fontSize} Tf 0 g`;
                    textField.acroField.dict.set(PDFName.of('DA'), PDFString.of(daString));

                    if (fieldData.align) {
                        switch (fieldData.align) {
                            case 'center': textField.setAlignment(TextAlignment.Center); break;
                            case 'right': textField.setAlignment(TextAlignment.Right); break;
                            case 'left': default: textField.setAlignment(TextAlignment.Left); break;
                        }
                    }

                    if (fieldData.required) textField.enableRequired();

                    textField.addToPage(page, {
                        x: scaledX,
                        y: pdfY,
                        width: scaledW,
                        height: scaledH,
                        font: helveticaFont,
                        borderWidth: 0, 
                        backgroundColor: rgb(1, 1, 1),
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

    } catch (error) {
        console.error('Processing Error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});