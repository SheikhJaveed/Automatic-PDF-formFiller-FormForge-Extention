import sys
import json
import fitz  # PyMuPDF
import cv2
import numpy as np
import pdfplumber
import re
from collections import Counter

# --- REGEX PATTERNS FOR CONTEXT ---
PATTERNS = {
    "SECTION": re.compile(r'^SECTION\s+([A-Z])', re.IGNORECASE),
    "PRINCIPLE": re.compile(r'^PRINCIPLE\s+(\d+)', re.IGNORECASE),
    "INDICATOR": re.compile(r'^(Essential|Leadership)\s+Indicators', re.IGNORECASE),
    "ITEM": re.compile(r'^(\d+)\.\s+(.*)', re.IGNORECASE) 
}

def clean_text(text):
    if not text: return ""
    text = text.replace('-\n', '').replace('\n', ' ')
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

def analyze_page_hierarchy(plumber_page):
    """Scans page text top-to-bottom to map sections."""
    items = []
    words = plumber_page.extract_words()
    lines = {}
    
    for w in words:
        found = False
        for y in lines.keys():
            if abs(y - w['top']) < 5:
                lines[y].append(w['text'])
                found = True
                break
        if not found:
            lines[w['top']] = [w['text']]
            
    sorted_y = sorted(lines.keys())
    
    for y in sorted_y:
        line_text = clean_text(" ".join(lines[y]))
        if PATTERNS["SECTION"].search(line_text):
            items.append({'y': y, 'type': 'SECTION', 'text': line_text})
        elif PATTERNS["PRINCIPLE"].search(line_text):
            items.append({'y': y, 'type': 'PRINCIPLE', 'text': line_text})
        elif PATTERNS["INDICATOR"].search(line_text):
            items.append({'y': y, 'type': 'INDICATOR', 'text': line_text})
        elif PATTERNS["ITEM"].search(line_text):
            items.append({'y': y, 'type': 'ITEM', 'text': line_text})
    return items

def get_active_context(hierarchy, box_y):
    """Finds context above the box."""
    context = {"section": "", "principle": "", "indicator": "", "item": "", "item_num": ""}
    for node in hierarchy:
        if node['y'] > box_y: break
        if node['type'] == 'SECTION':
            match = PATTERNS["SECTION"].search(node['text'])
            if match: context["section"] = f"Section {match.group(1)}"
        elif node['type'] == 'PRINCIPLE':
            match = PATTERNS["PRINCIPLE"].search(node['text'])
            if match: context["principle"] = f"Principle {match.group(1)}"
        elif node['type'] == 'INDICATOR':
            match = PATTERNS["INDICATOR"].search(node['text'])
            if match: context["indicator"] = match.group(1) + " Indicator"
        elif node['type'] == 'ITEM':
            match = PATTERNS["ITEM"].search(node['text'])
            if match:
                context["item_num"] = match.group(1)
                desc = match.group(2)
                context["item"] = desc[:50] + "..." if len(desc) > 50 else desc
    return context

def get_row_label(plumber_page, cell_bbox):
    x, y, w, h = cell_bbox
    # Look Left
    search_bbox = (0, y - 2, x - 5, y + h + 2)
    text = plumber_page.within_bbox(search_bbox).extract_text()
    return clean_text(text)

def get_col_header(plumber_page, cell_bbox):
    x, y, w, h = cell_bbox
    # Look Up (Limit 150px)
    search_bbox = (x - 5, max(0, y - 150), x + w + 5, y - 2)
    words = plumber_page.within_bbox(search_bbox).extract_words()
    
    col_words = [word for word in words if word['x0'] < (x + w) and word['x1'] > x]
    if not col_words: return ""
    
    col_words.sort(key=lambda w: w['top'])
    last_word_bottom = col_words[-1]['bottom']
    final_words = [w['text'] for w in col_words if abs(w['bottom'] - last_word_bottom) < 60]
    
    return clean_text(" ".join(final_words))

def generate_detailed_question(ctx, row, col):
    path_parts = []
    if ctx['section']: path_parts.append(ctx['section'])
    if ctx['principle']: path_parts.append(ctx['principle'])
    
    ind_str = ""
    if ctx['indicator']: ind_str += ctx['indicator']
    if ctx['item_num']: ind_str += f" {ctx['item_num']}"
    if ind_str: path_parts.append(ind_str)
    
    prefix = "Under " + ", ".join(path_parts) if path_parts else "BRSR Disclosure"
    
    subject = col if col else "details"
    target = row if row else "this item"
    
    action = "what is the"
    sub_lower = subject.lower()
    
    if any(w in sub_lower for w in ['whether', 'yes/no', 'status']): action = "indicate"
    elif 'date' in sub_lower: action = "provide the"
    elif 'details' in sub_lower: action = "provide"

    if row and col: return f"{prefix}, {action} {subject} for {target}?"
    elif col and not row: return f"{prefix}, {action} {subject}?"
    elif row and not col: return f"{prefix}, provide details for {row}."
    else:
        desc = ctx.get('item', 'details')
        return f"{prefix}, {desc}"

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
            
            # --- STEP 1: ANALYZE STRUCTURE ---
            page_hierarchy = analyze_page_hierarchy(plumber_page)
            
            # --- STEP 2: OPENCV ---
            zoom = 2.0 
            mat = fitz.Matrix(zoom, zoom)
            pix = page.get_pixmap(matrix=mat)
            img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
            if pix.n >= 3: img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR) 
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            
            thresh = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2)
            thresh = 255 - thresh

            h_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (40, 1))
            v_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 40))
            h_lines = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, h_kernel, iterations=1)
            v_lines = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, v_kernel, iterations=1)
            grid = cv2.addWeighted(h_lines, 1, v_lines, 1, 0)
            grid = cv2.dilate(grid, np.ones((3,3), np.uint8), iterations=1)
            
            contours, _ = cv2.findContours(grid, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
            
            height, width, _ = img.shape
            scale_frontend = 800 / width
            scale_pdf = 1 / zoom 

            boxes = [cv2.boundingRect(c) for c in contours]
            boxes.sort(key=lambda b: (b[1], b[0]))

            for bbox in boxes:
                x, y, w, h = bbox
                if w < 20 or h < 15: continue
                if w > (width * 0.9): continue

                pdf_x, pdf_y = x * scale_pdf, y * scale_pdf
                pdf_w, pdf_h = w * scale_pdf, h * scale_pdf
                
                # Check empty
                inner_bbox = (pdf_x+2, pdf_y+2, pdf_x+pdf_w-2, pdf_y+pdf_h-2)
                if len(clean_text(plumber_page.within_bbox(inner_bbox).extract_text())) > 0:
                    continue

                # --- STEP 3: CONTEXT & NAMING ---
                ctx = get_active_context(page_hierarchy, pdf_y)
                row_label = get_row_label(plumber_page, (pdf_x, pdf_y, pdf_w, pdf_h))
                col_label = get_col_header(plumber_page, (pdf_x, pdf_y, pdf_w, pdf_h))
                final_question = generate_detailed_question(ctx, row_label, col_label)
                
                if final_question in name_counters:
                    name_counters[final_question] += 1
                    display_name = f"{final_question} ({name_counters[final_question]})"
                else:
                    name_counters[final_question] = 1
                    display_name = final_question

                subtype = None
                options = []
                full_text = (row_label + col_label + ctx.get('item', '')).lower()
                if "yes/no" in full_text:
                    subtype = "dropdown"
                    options = ["Select", "Yes", "No"]

                # --- PADDING FIX: Shrink box to stay INSIDE lines ---
                # Add 4px padding (scaled to frontend coords)
                pad_x = 3 * scale_frontend
                pad_y = 3 * scale_frontend

                detected_fields.append({
                    "id": f"auto_{i}_{int(x)}_{int(y)}",
                    "type": "text", "subtype": subtype, "options": options,
                    "page": i,
                    # Apply padding so box sits INSIDE the grid cell
                    "x": (x * scale_frontend) + pad_x,
                    "y": (y * scale_frontend) + pad_y,
                    "w": (w * scale_frontend) - (pad_x * 2),
                    "h": (h * scale_frontend) - (pad_y * 2),
                    "name": display_name, 
                    "required": False, "fontSize": 11, "align": "left", "isMultiline": (h*scale_pdf) > 25
                })

        print(json.dumps(detected_fields))

    except Exception as e:
        print("[]")

if __name__ == "__main__":
    main()