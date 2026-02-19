# AutoFormForge

**AutoFormForge** is an advanced, full-stack PDF editor designed to convert static PDF documents into interactive, fillable forms automatically.

It leverages **Computer Vision (OpenCV)** and **PDF Text Analysis** to detect grid tables, lines, and questions, automatically placing interactive form fields. It also supports "Round-Trip" editing, allowing you to re-upload previously generated forms and continue editing them.

![Project Status](https://img.shields.io/badge/Status-Active-success)
![Tech Stack](https://img.shields.io/badge/Stack-MERN_%2B_Python-blue)

---

## 🚀 Key Features

### 🧠 Intelligent Automation
*   **Auto-Detection:** Uses Python (PyMuPDF + OpenCV) to visually scan PDFs for tables, boxes, and underlines to auto-generate fields.
*   **Smart Naming:** Context-aware algorithms read row labels and column headers to generate precise field names (e.g., *"For BRSR Under Section C... what is the percentage...?"*).
*   **Typo Correction:** Built-in dictionary fixes common PDF extraction typos (e.g., `areness` -> `awareness`).

### ✍️ Powerful Editor
*   **Drag & Drop Interface:** Fully interactive UI to move, resize, and delete fields.
*   **Field Types:** Supports **Text Boxes** (Single/Multi-line), **Checkboxes**, and **Yes/No Dropdowns**.
*   **Smart Text Sizing:** Text fields support **Auto-Shrink** (text gets smaller to fit the box) or fixed formatting.
*   **Multi-Select:** `Ctrl + Click` to select multiple fields and delete them in bulk.
*   **Duplicate Detection:** Highlights duplicate field names in red to prevent data conflicts.

### 🔄 Advanced Workflows
*   **Round-Trip Editing:** Upload a PDF you previously created with AutoFormForge, and it will recognize and restore all interactive fields for further editing.
*   **Update Background PDF:** Swap the underlying PDF file (e.g., to fix a typo in the document) while keeping all your placed form fields intact.

---

## 🛠️ Tech Stack

### **Frontend**
*   **React (Vite):** Fast, modern UI.
*   **react-pdf:** Rendering PDF pages in the browser.
*   **react-rnd:** Handling draggable and resizable components.
*   **Tailwind CSS:** Styling and layout.

### **Backend**
*   **Node.js & Express:** API server for handling uploads and file processing.
*   **pdf-lib:** Powerful library for generating AcroForms and manipulating PDF internals.
*   **Multer:** File upload management.

### **Microservice (AI/Logic)**
*   **Python:** Runs as a child process spawned by Node.js.
*   **PyMuPDF (Fitz):** High-performance PDF rendering and text extraction.
*   **OpenCV:** Computer vision for detecting visual boxes and table grids.
*   **pdfplumber:** Supplementary text extraction.

---

## 📦 Installation & Setup

### Prerequisites
1.  **Node.js** (v16+ recommended)
2.  **Python** (v3.8+)
3.  **Pip** (Python Package Manager)

### 1. Backend Setup

Navigate to the `server` directory and install dependencies.

```bash
cd backend

# 1. Install Node dependencies
npm install

# 2. Install Python dependencies
# (Note: We use PyMuPDF, so Poppler is NOT required)
pip install pymupdf opencv-python-headless numpy pdfplumber

# 3. Create uploads folder
mkdir uploads
```

### 2. Frontend Setup
Open a new terminal, navigate to the client directory.
```
cd frontend

# 1. Install dependencies
npm install

# 2. Start the development server
npm run dev
```
### 3. Running the App
Start Backend:
```
# In the backend/ directory
node server.js
Server runs on port 5000.
```
Start Frontend:
```
# In the frontend/ directory
npm run dev
```

# 📖 Usage Guide

## 1. Uploading a New PDF
- Click **“Select File”** or drag a PDF onto the homepage.
- The system will analyze the PDF. This may take a few seconds as the Python script scans for fields.
- You will be redirected to the **Editor** with fields automatically placed.

## 2. Editing Fields
- **Move:** Drag fields to position them.
- **Resize:** Drag the edges of a field.
- **Multi-Select:** Hold **Ctrl** (or **Cmd**) and click multiple fields to select them.  
  Use the floating bar to delete all selected fields.
- **Properties:** Click a field to open the popup menu:
  - Change field name
  - Toggle **Required** or **Critical**
  - Change font size (select **Auto** for dynamic sizing)
  - Switch field type (**Text / Dropdown / Checkbox**)

## 3. Updating the Background PDF
If you realize the original table in your PDF is too small:
1. Edit your source document (Word / Excel) to increase row size.
2. Save it as a new PDF.
3. In **AutoFormForge**, click the yellow **“Update PDF”** icon in the navbar.
4. Upload the new PDF.

Your existing fields will remain on screen — simply drag them to fit the new table rows.

## 4. Download
- Click **Download**.
- The backend will generate a standard PDF with **AcroForms**, compatible with **Adobe Acrobat**, **Chrome**, and **Edge**.

