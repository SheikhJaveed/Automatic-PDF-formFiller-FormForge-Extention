import sys
import json
import fitz  # PyMuPDF
import cv2
import numpy as np
import pdfplumber
import re
from collections import Counter

# --- TEXT UTILS ---
def clean_text(text):
    if not text: return ""
    text = text.replace('-\n', '').replace('\n', ' ')
    
    # Common Typo Fixes
    corrections = {
        r'\bare\s*ness\b': 'awareness',
        r'\bawa\s*re\s*ness\b': 'awareness',
        r'\bm\s*plaints\b': 'complaints', 
        r'\bco\s*mplaints\b': 'complaints',
        r'\bfi\s*nancial\b': 'financial',
        r'\bprin\s*ciple\b': 'principle'
    }
    for p, r in corrections.items():
        text = re.sub(p, r, text, flags=re.IGNORECASE)

    text = re.sub(r'^[\d\w]+\.\s*', '', text)
    text = re.sub(r'^\([\w\d]+\)\s*', '', text)
    return re.sub(r'\s+', ' ', text).strip()

# --- CONTEXT ---
def get_page_context_map(plumber_page, y_limit):
    context = { "section": "", "principle": "", "indicator": "", "item": "" }
    try:
        header_crop = plumber_page.crop((0, 0, plumber_page.width, y_limit))
        text = header_crop.extract_text()
        if not text: return context
        
        lines = text.split('\n')
        for line in lines:
            line = line.strip()
            if not line: continue
            
            if re.search(r'SECTION\s+([A-Z])', line, re.IGNORECASE):
                context["section"] = line
            if re.search(r'Principle\s+(\d+)', line, re.IGNORECASE):
                context["principle"] = line
            if "Essential" in line: context["indicator"] = "Essential Indicator"
            if "Leadership" in line: context["indicator"] = "Leadership Indicator"
            
            # Capture Item numbers like "1. Details..." or "[Item 4]"
            if re.match(r'^\[Item\s+\w+\]', line):
                 context["item"] = line
            elif re.match(r'^\d+\.\s+', line):
                 context["item"] = line
    except: pass
    return context

def construct_question(context, row_label, col_label, is_table):
    parts = ["For BRSR"]
    if context['section']: parts.append(f"Under {context['section']}")
    if context['principle']: parts.append(context['principle'])
    if context['indicator']: parts.append(context['indicator'])
    
    # If we found an exact item header like [Item 5a], prioritize it
    if context['item']: parts.append(context['item'])

    prefix = ", ".join(parts)
    
    subject = col_label if col_label else "details"
    target = row_label if row_label else ""

    action = "provide the"
    if "number" in subject.lower(): action = "what is the"
    elif "%" in subject.lower(): action = "what is the percentage of"
    elif "whether" in subject.lower(): action = "indicate whether"

    if is_table and target:
        q = f"{prefix}, {action} {subject} for {target}?"
    else:
        q = f"{prefix}, {action} {subject}?"

    return re.sub(r'\s+', ' ', q).replace(" ,", ",")

# --- MAIN LOGIC ---
def is_box_really_empty(plumber_page, x, y, w, h):
    try:
        # Check center region to avoid borders
        bbox = (x+2, y+2, x+w-2, y+h-2)
        text = plumber_page.within_bbox(bbox).extract_text()
        
        # If box has letters/numbers, it's not a field.
        if text and len(re.sub(r'[^a-zA-Z0-9]', '', text)) > 0: 
            return False
        return True
    except: return True

def main():
    try:
        if len(sys.argv) < 2: return
        pdf_path = sys.argv[1]
        doc = fitz.open(pdf_path)
        plumber_pdf = pdfplumber.open(pdf_path)
        detected_fields = []
        name_counters = Counter()

        for i in range(len(doc)):
            page = doc[i]
            plumber_page = plumber_pdf.pages[i]
            
            zoom = 2.0 
            mat = fitz.Matrix(zoom, zoom)
            pix = page.get_pixmap(matrix=mat)
            if pix.n < 4: img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
            else: img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
            
            if pix.n == 3: img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)

            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            thresh = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2)
            thresh = 255 - thresh

            h_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (40, 1))
            v_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 40))
            mask = cv2.addWeighted(cv2.morphologyEx(thresh, cv2.MORPH_OPEN, h_kernel), 0.5, cv2.morphologyEx(thresh, cv2.MORPH_OPEN, v_kernel), 0.5, 0)
            mask = cv2.threshold(mask, 0, 255, cv2.THRESH_BINARY)[1]

            contours, _ = cv2.findContours(mask, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
            
            height, width, _ = img.shape
            scale_frontend = 800 / width
            scale_pdf = 1 / zoom 

            boxes = [cv2.boundingRect(c) for c in contours]
            boxes.sort(key=lambda b: (b[1], b[0]))

            for bbox in boxes:
                x, y, w, h = bbox
                fe_w = w * scale_frontend
                fe_h = h * scale_frontend
                
                if fe_w > 20 and fe_h > 15:
                    pdf_x = x * scale_pdf
                    pdf_y = y * scale_pdf
                    pdf_w = w * scale_pdf
                    pdf_h = h * scale_pdf

                    if not is_box_really_empty(plumber_page, pdf_x, pdf_y, pdf_w, pdf_h): continue

                    is_tall = fe_h > 25
                    is_table_cell = is_tall or (fe_h > 18 and fe_w < 300)

                    ctx = get_page_context_map(plumber_page, pdf_y)
                    
                    # Labels (Simplified for brevity)
                    row_bbox = (0, pdf_y-2, pdf_x-2, pdf_y+pdf_h+2)
                    row_label = clean_text(plumber_page.within_bbox(row_bbox).extract_text())
                    
                    col_bbox = (pdf_x-5, max(0, pdf_y-150), pdf_x+pdf_w+5, pdf_y-2)
                    col_label = clean_text(plumber_page.within_bbox(col_bbox).extract_text())
                    
                    question = construct_question(ctx, row_label, col_label, is_table_cell)

                    subtype = None
                    options = []
                    if "yes/no" in (row_label + col_label).lower():
                        subtype = "dropdown"
                        options = ["Select", "Yes", "No"]
                    
                    if question in name_counters:
                        name_counters[question] += 1
                        display_name = f"{question} ({name_counters[question]})"
                    else:
                        name_counters[question] = 1
                        display_name = question

                    detected_fields.append({
                        "id": f"auto_{i}_{int(x)}_{int(y)}",
                        "type": "text", "subtype": subtype, "options": options,
                        "page": i,
                        "x": (x * scale_frontend) + 2,
                        "y": (y * scale_frontend) + 2,
                        "w": fe_w - 4,
                        "h": fe_h - 4,
                        "name": display_name,
                        "required": False, "fontSize": 0, "align": "center" if is_table_cell else "left",
                        "isMultiline": is_tall
                    })
        print(json.dumps(detected_fields))
    except Exception as e:
        print("[]")

if __name__ == "__main__":
    main()