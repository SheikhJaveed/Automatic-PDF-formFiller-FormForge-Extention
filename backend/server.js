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

const extractExistingFields = async (filePath) => {
    try {
        const pdfBytes = fs.readFileSync(filePath);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        const form = pdfDoc.getForm();
        const fields = form.getFields();
        if (fields.length === 0) return null;

        const extractedData = [];
        const FRONTEND_WIDTH = 800;

        fields.forEach(field => {
            if (field.acroField.getWidgets) {
                const widgets = field.acroField.getWidgets();
                widgets.forEach(widget => {
                    const rect = widget.getRectangle();
                    const page = pdfDoc.getPage(pdfDoc.getPages().indexOf(widget.P()));
                    const scaleFactor = FRONTEND_WIDTH / page.getSize().width;
                    
                    let type = 'text';
                    let subtype = null;
                    if (field.constructor.name === 'PDFCheckBox') type = 'checkbox';
                    if (field.constructor.name === 'PDFDropdown') { type = 'text'; subtype = 'dropdown'; }

                    extractedData.push({
                        id: field.getName(),
                        type, subtype,
                        options: subtype === 'dropdown' ? field.getOptions() : [],
                        page: pdfDoc.getPages().indexOf(widget.P()),
                        x: rect.x * scaleFactor,
                        y: (page.getSize().height - rect.y - rect.height) * scaleFactor,
                        w: rect.width * scaleFactor,
                        h: rect.height * scaleFactor,
                        name: field.getName(),
                        required: field.isRequired(),
                        fontSize: 0,
                        align: 'left',
                        isMultiline: (type === 'text' && field.isMultiline) ? field.isMultiline() : false
                    });
                });
            }
        });
        return extractedData;
    } catch (e) { return null; }
};

app.post('/upload', upload.single('pdf'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    let detectedFields = await extractExistingFields(req.file.path);
    if (!detectedFields || detectedFields.length === 0) {
        detectedFields = await detectFieldsWithPython(req.file.path);
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
            // TEXT FIELD
            else {
                try {
                    const textField = form.createTextField(fieldName);
                    textField.setText(''); 

                    // --- CRITICAL SIZING LOGIC ---
                    
                    if (fieldData.isMultiline) {
                        // CASE 1: Large Box / Paragraph
                        // We must enable Multiline. Auto-shrink often fails here.
                        // We set a reasonable fixed size (10pt).
                        textField.enableMultiline();
                        
                        const fixedSize = 10;
                        const daString = `/Helv ${fixedSize} Tf 0 g`;
                        textField.acroField.dict.set(PDFName.of('DA'), PDFString.of(daString));
                    } else {
                        // CASE 2: Grid Cell / Single Line
                        // We DISABLE Multiline. We set Font Size 0 (Auto).
                        // This guarantees the "Government Form" auto-shrink behavior.
                        // textField.disableMultiline(); // Default is false, but safe to assume
                        
                        // Force Auto Size
                        const daString = `/Helv 0 Tf 0 g`;
                        textField.acroField.dict.set(PDFName.of('DA'), PDFString.of(daString));
                    }

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
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => console.log(`Server running on ${PORT}`));