const express = require('express');
const { PDFDocument, StandardFonts, PDFName, PDFString, TextAlignment, rgb, PDFBool } = require('pdf-lib');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { spawn } = require('child_process');

const app = express();
const PORT = 5000;

// Setup Storage
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => cb(null, `doc_${Date.now()}_${file.originalname}`)
});
const upload = multer({ storage });

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use('/files', express.static(UPLOADS_DIR));

// --- HELPER: Detect Fields via Python ---
const detectFieldsWithPython = (filePath) => {
    return new Promise((resolve, reject) => {
        const cmd = process.platform === "win32" ? "python" : "python3";
        const pythonProcess = spawn(cmd, ['detector.py', filePath]);
        let dataString = '';
        pythonProcess.stdout.on('data', (d) => dataString += d.toString());
        pythonProcess.on('close', (code) => {
            try { resolve(JSON.parse(dataString)); } catch (e) { resolve([]); }
        });
    });
};

// --- HELPER: Extract EXISTING Fields (FIXED) ---
const extractExistingFields = async (filePath) => {
    try {
        const pdfBytes = fs.readFileSync(filePath);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        const form = pdfDoc.getForm();
        const fields = form.getFields();
        
        if (fields.length === 0) return null;

        console.log(`Found ${fields.length} raw PDF fields. Mapping to pages...`);

        const extractedData = [];
        const FRONTEND_WIDTH = 800;
        
        // 1. BUILD PAGE REFERENCE MAP
        // This is the fix. We map the internal PDF reference string to the Page Index.
        const pageRefMap = new Map();
        pdfDoc.getPages().forEach((p, i) => {
            pageRefMap.set(p.ref.toString(), i);
        });

        fields.forEach(field => {
            try {
                if (!field.acroField.getWidgets) return;
                const widgets = field.acroField.getWidgets();
                
                widgets.forEach(widget => {
                    const rect = widget.getRectangle();
                    
                    // 2. LOOKUP PAGE INDEX SAFELY
                    const pRef = widget.P();
                    const pageIndex = pageRefMap.get(pRef.toString());

                    if (pageIndex === undefined) {
                        console.warn(`Orphan widget found for field: ${field.getName()}`);
                        return; 
                    }

                    const page = pdfDoc.getPage(pageIndex);
                    const scaleFactor = FRONTEND_WIDTH / page.getSize().width;
                    const pageHeight = page.getSize().height;

                    let type = 'text';
                    let subtype = null;
                    let options = [];
                    
                    if (field.constructor.name === 'PDFCheckBox') type = 'checkbox';
                    if (field.constructor.name === 'PDFDropdown') { 
                        type = 'text'; 
                        subtype = 'dropdown';
                        options = field.getOptions();
                    }

                    // Check if critical (custom logic would rely on naming conventions here)
                    const isCritical = field.getName().includes("_CRITICAL"); 

                    extractedData.push({
                        id: field.getName(),
                        type: type,
                        subtype: subtype,
                        options: options,
                        page: pageIndex,
                        x: rect.x * scaleFactor,
                        y: (pageHeight - rect.y - rect.height) * scaleFactor,
                        w: rect.width * scaleFactor,
                        h: rect.height * scaleFactor,
                        name: field.getName().replace('_CRITICAL', ''), // Clean name for display
                        required: field.isRequired(),
                        isCritical: isCritical,
                        fontSize: 11, // Assume auto for re-loaded fields
                        align: 'center', // Default align
                        isMultiline: (type === 'text' && field.isMultiline) ? field.isMultiline() : false
                    });
                });
            } catch (e) {
                console.warn("Skipping field:", field.getName(), e.message);
            }
        });
        return extractedData;
    } catch (e) {
        console.error("Extraction Error:", e);
        return null;
    }
};

// --- ROUTES ---

app.post('/upload', upload.single('pdf'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    
    console.log(`Processing: ${req.file.filename}`);

    // 1. Try Existing
    let detectedFields = await extractExistingFields(req.file.path);

    // 2. If None, Run AI
    if (!detectedFields || detectedFields.length === 0) {
        console.log("No existing fields found. Starting Python AI...");
        detectedFields = await detectFieldsWithPython(req.file.path);
    } else {
        console.log(`Successfully restored ${detectedFields.length} fields from PDF.`);
    }

    res.json({ filename: req.file.filename, fields: detectedFields });
});

app.post('/process-pdf', async (req, res) => {
    try {
        const { filename, fields } = req.body;
        const filePath = path.join(UPLOADS_DIR, filename);
        if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File lost' });

        const existingPdfBytes = fs.readFileSync(filePath);
        const pdfDoc = await PDFDocument.load(existingPdfBytes);
        const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const form = pdfDoc.getForm();
        const FRONTEND_WIDTH = 800;

        // Wipe old fields
        form.getFields().map(f => f.getName()).forEach(name => { try { form.removeField(form.getField(name)); } catch(e){} });

        fields.forEach((fieldData) => {
            const pageIndex = fieldData.page || 0;
            if (pageIndex >= pdfDoc.getPageCount()) return;
            const page = pdfDoc.getPage(pageIndex);
            const scaleFactor = page.getSize().width / FRONTEND_WIDTH;

            const scaledX = fieldData.x * scaleFactor;
            const scaledY = fieldData.y * scaleFactor;
            const scaledW = fieldData.w * scaleFactor;
            const scaledH = fieldData.h * scaleFactor;
            const pdfY = page.getSize().height - scaledY - scaledH;

            let fieldName = fieldData.name || fieldData.id;
            fieldName = fieldName.replace(/\./g, ' ').trim();
            if (fieldData.isCritical) fieldName += "_CRITICAL"; // Save state in name

            // DROPDOWN
            if (fieldData.subtype === 'dropdown') {
                try {
                    const dropdown = form.createDropdown(fieldName);
                    dropdown.setOptions(fieldData.options || ['Yes', 'No']);
                    if (fieldData.required) dropdown.enableRequired();
                    
                    const da = `/Helv 10 Tf 0 g`;
                    dropdown.acroField.dict.set(PDFName.of('DA'), PDFString.of(da));
                    dropdown.addToPage(page, { x: scaledX, y: pdfY, width: scaledW, height: scaledH, borderWidth: 0, backgroundColor: rgb(1,1,1), font: helveticaFont });
                } catch(e){}
            } 
            // CHECKBOX
            else if (fieldData.type === 'checkbox') {
                try {
                    const checkBox = form.createCheckBox(fieldName);
                    if (fieldData.required) checkBox.enableRequired();
                    checkBox.addToPage(page, { x: scaledX, y: pdfY, width: scaledW, height: scaledH, borderWidth: 0, backgroundColor: rgb(1,1,1) });
                } catch(e){}
            } 
            // TEXT
            else {
                try {
                    const textField = form.createTextField(fieldName);
                    textField.setText(''); 

                    if (fieldData.isMultiline) textField.enableMultiline();

                    // Font Size: 0 = Auto.
                    const fontSize = fieldData.fontSize;
                    const finalSize = (fontSize === 0 || fontSize === '0') ? 0 : (fontSize * scaleFactor);
                    const daString = `/Helv ${finalSize} Tf 0 g`;
                    textField.acroField.dict.set(PDFName.of('DA'), PDFString.of(daString));

                    if (fieldData.align === 'center') textField.setAlignment(TextAlignment.Center);
                    else if (fieldData.align === 'right') textField.setAlignment(TextAlignment.Right);
                    else textField.setAlignment(TextAlignment.Left);

                    if (fieldData.required) textField.enableRequired();

                    textField.addToPage(page, { x: scaledX, y: pdfY, width: scaledW, height: scaledH, font: helveticaFont, borderWidth: 0, backgroundColor: rgb(1,1,1) });
                } catch(e){}
            }
        });

        const acroForm = pdfDoc.catalog.lookup(PDFName.of('AcroForm'));
        if (acroForm) acroForm.set(PDFName.of('NeedAppearances'), PDFBool.True);

        const pdfBytes = await pdfDoc.save();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=edited_${filename}`);
        res.send(Buffer.from(pdfBytes));

    } catch (error) {
        console.error("Save Error:", error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => console.log(`Server running on ${PORT}`));