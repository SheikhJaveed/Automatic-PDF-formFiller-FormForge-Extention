import sys
import json
import traceback

def main():
    try:
        # Imports
        import cv2
        import numpy as np
        import fitz  # PyMuPDF (Replaces pdf2image + Poppler)

        if len(sys.argv) < 2:
            raise ValueError("No PDF path provided")

        pdf_path = sys.argv[1]
        detected_fields = []

        # 1. Open PDF with PyMuPDF
        doc = fitz.open(pdf_path)

        # 2. Iterate through pages
        for i in range(len(doc)):
            page = doc[i]
            
            # 3. Render page to image (High Res for OpenCV)
            # Zoom = 2 (approx 144 DPI) or 3 (approx 216 DPI). Let's use 2.5 for clarity.
            zoom = 2.5 
            mat = fitz.Matrix(zoom, zoom)
            pix = page.get_pixmap(matrix=mat)

            # Convert PyMuPDF Pixmap to Numpy Array (OpenCV Format)
            # Check if image has alpha channel (transparency)
            if pix.n - pix.alpha < 4: 
                # RGB
                img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
                if pix.n == 3: # RGB -> BGR for OpenCV
                    img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
            else:
                # RGBA
                img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
                img = cv2.cvtColor(img, cv2.COLOR_RGBA2BGR)

            # --- OPENCV PROCESSING (Same as before) ---
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            
            # Adaptive Threshold to isolate lines
            thresh = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2)
            thresh = 255 - thresh

            # Find Lines
            horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (40, 1))
            horizontal_mask = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, horizontal_kernel, iterations=1)

            vertical_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 40))
            vertical_mask = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, vertical_kernel, iterations=1)

            # Combine to find Grid
            table_mask = cv2.addWeighted(horizontal_mask, 0.5, vertical_mask, 0.5, 0.0)
            table_mask = cv2.threshold(table_mask, 0, 255, cv2.THRESH_BINARY)[1]

            contours, _ = cv2.findContours(table_mask, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)

            # Calculate Scale (Image Width vs Target 800px)
            height, width, _ = img.shape
            TARGET_WIDTH = 800
            scale_factor = TARGET_WIDTH / width

            for c in contours:
                x, y, w, h = cv2.boundingRect(c)

                # Filter valid boxes (Adjusted logic for high-res zoom)
                # w > 30, h > 15 (at 800px scale)
                # We apply scale factor immediately to check valid size in Frontend Units
                
                fe_w = w * scale_factor
                fe_h = h * scale_factor

                if fe_w > 20 and fe_h > 10:
                    
                    # Logic: Table Cells OR Underscores
                    # Table cells are usually taller. Underscores are wide and short.
                    is_table_cell = (fe_h > 15) 
                    is_underscore = (fe_h < 25 and fe_w > 50)

                    if is_table_cell or is_underscore:
                        detected_fields.append({
                            "id": f"py_{i}_{x}_{y}",
                            "type": "text",
                            "page": i,
                            "x": (x * scale_factor) + 2,
                            "y": (y * scale_factor) + 2,
                            "w": fe_w - 4,
                            "h": fe_h - 4,
                            "name": f"Field_{len(detected_fields)+1}",
                            "required": False,
                            "fontSize": 11,
                            "align": "left"
                        })

        # Output JSON
        print(json.dumps(detected_fields))

    except Exception as e:
        sys.stderr.write(f"PYTHON ERROR: {str(e)}\n")
        print("[]")

if __name__ == "__main__":
    main()